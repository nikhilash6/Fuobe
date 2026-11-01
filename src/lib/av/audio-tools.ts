import type { ChainSlot, Engine, GenerationRequest } from "@/lib/catalog/types";
import { cloudLoopLength, cloudLoopPasses, crossfadeProblem, joinedLength, loopSeams, type CurveShape } from "./crossfade";

/**
 * The Audio hub's Loop / extend and Join tools (r4/faceless-plus): plain data and the planner shared by the
 * page and the server (src/server/audio-tools.ts), which turns a plan into one createPipeline batch.
 *
 * - Open engine (ComfyUI, CPU): one job each — audio-loop-crossfade extends a clip to any length up to
 *   10 minutes with a crossfade at every seam and a fade-out; audio-join-crossfade joins up to 10 clips with a
 *   crossfade at every seam. The provider writes the fade curve.
 * - Cloud (fal merge-audios): whole plays and hard joins, 2–5 files a call, so longer loops and joins of
 *   more clips run as a chain of calls. A loop comes out a whole number of plays long.
 */

export const LOOP_FEATURE = "audio-loop";
export const JOIN_FEATURE = "audio-join";

export const AUDIO_TOOL_MODELS: Record<Engine, { loop: string; join: string }> = {
  cloud: { loop: "join-audio", join: "join-audio" },
  open: { loop: "oss-audio-loop", join: "oss-audio-join" },
};

/** The longest loop: the open graph's limit, kept on the cloud too so both engines offer the same. */
export const LOOP_MAX_SECONDS = 600;
export const JOIN_MAX_CLIPS = 10;
/** fal merge-audios takes 2–5 files a call. */
export const CLOUD_PER_CALL = 5;
export const CROSSFADE_MAX = 10;
export const DEFAULT_LOOP_CROSSFADE = 2;
export const DEFAULT_JOIN_CROSSFADE = 1;
/** Lengths a loop offers at a click (seconds). */
export const LOOP_PRESETS = [60, 120, 180, 300, 600];

export interface ToolStep {
  key: string;
  request: GenerationRequest;
  after?: string[];
  chain?: ChainSlot[];
}

export interface ToolPlan {
  steps: ToolStep[];
  /** Seconds the result runs (null: a clip's length is unknown). */
  length: number | null;
  /** What it will do, in a sentence. */
  summary: string;
  /** Things to know (the cloud's whole plays, its hard joins). */
  notes: string[];
}

/** What the server answers for `?preview=1`: the plan in words and its price. */
export interface AudioToolPreview {
  summary: string;
  notes: string[];
  /** Seconds the result runs (null: a clip's length is unknown). */
  length: number | null;
  steps: number;
  costUsd: number | null;
  demo: boolean;
  /** Split soundtrack: about how long the open engine takes (seconds, a range), and the DBS model the host would pick. */
  estimate?: { low: number; high: number };
  hostPick?: "fast" | "best";
  /** The ComfyUI host's device type ("cpu", "cuda"…), when it said. */
  device?: string;
  /** The DBS models the host has on disk, when it said (the page marks one that isn't there). */
  installed?: ("fast" | "best")[];
  /** The file's channel count from its header, when the server could read it (the page then needn't decode the file). */
  channels?: number;
  /** Clean up voice: the RE-USE files the host has (when it said), the rate the model would run at, and the file's length. */
  reuse?: { installed?: ("voice" | "laughter")[]; rate: number; seconds?: number };
}

export interface LoopInput {
  engine: Engine;
  audio: string;
  name?: string;
  /** The clip's length (seconds). */
  sourceDuration: number;
  /** The length to make. */
  duration: number;
  crossfade?: number;
  curve?: CurveShape;
}

export interface JoinInput {
  engine: Engine;
  clips: { url: string; name?: string; duration?: number }[];
  crossfade?: number;
  curve?: CurveShape;
}

/** "2:05", "0:07.5" */
export function clock(seconds: number): string {
  // Rounded to tenths first, so 7.96 s reads 0:08, not 0:07.10.
  const s = Math.round(Math.max(0, seconds) * 10) / 10;
  const whole = Math.floor(s + 1e-6);
  const tenth = Math.round((s - whole) * 10);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}${tenth && s < 60 ? `.${tenth}` : ""}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fade = (x: number | undefined, fallback: number) => Math.min(CROSSFADE_MAX, Math.max(0.1, Math.round((x ?? fallback) * 10) / 10));

/** A clip extended to `duration`; throws what's in the way (in words the page shows). */
export function planLoop(i: LoopInput): ToolPlan {
  const L = i.sourceDuration;
  if (!(L > 0)) throw new Error("This clip's length can't be read — try a WAV, MP3, FLAC or M4A file");
  if (!(i.duration > L)) throw new Error(`The clip is already ${clock(L)} long — pick a longer length`);
  if (i.duration > LOOP_MAX_SECONDS) throw new Error(`Loops run up to ${LOOP_MAX_SECONDS / 60} minutes`);
  const duration = Math.round(i.duration * 10) / 10;
  const titleFor = (made: number) => `Loop · ${i.name ? `${i.name} ` : ""}to ${clock(made)}`;
  const models = AUDIO_TOOL_MODELS[i.engine];
  if (i.engine === "open") {
    const title = titleFor(duration);
    const base = { feature: LOOP_FEATURE, batchTitle: title } satisfies Partial<GenerationRequest>;
    const x = fade(i.crossfade, DEFAULT_LOOP_CROSSFADE);
    const problem = crossfadeProblem([L], x, "loop");
    if (problem) throw new Error(problem);
    const seams = loopSeams(L, duration, x).length;
    return {
      steps: [
        {
          key: "loop",
          request: {
            ...base,
            modelId: models.loop,
            op: "audio-loop",
            inputs: { audio: i.audio },
            params: { duration, crossfade: x, sourceDuration: L, ...(i.curve === "linear" && { extra: { curve: "linear" } }) },
            title,
            step: { label: `${plural(seams, "seam")} · ${x} s crossfades`, index: 0, of: 1 },
          },
        },
      ],
      length: duration,
      summary: `Loops it to ${clock(duration)} with ${plural(seams, "crossfaded seam")} (${x} s each), then fades out over the last ${x} s.`,
      notes: [],
    };
  }
  // The cloud repeats the whole clip: every call lists it 2–5 times, and each call's result is the next one's clip.
  const passes = cloudLoopPasses(L, duration, CLOUD_PER_CALL);
  const length = cloudLoopLength(L, passes);
  const plays = passes.reduce((a, b) => a * b, 1);
  // Titled by what it makes (whole plays), not by what was asked.
  const title = titleFor(length);
  const base = { feature: LOOP_FEATURE, batchTitle: title } satisfies Partial<GenerationRequest>;
  // Each call's clip and length are rounded together (ms), so the route counts exactly `p` plays.
  let clip = Math.round(L * 1000) / 1000;
  const steps: ToolStep[] = passes.map((p, k) => {
    const made = Math.round(clip * p * 1000) / 1000;
    const step: ToolStep = {
      key: `loop-${k + 1}`,
      request: {
        ...base,
        modelId: models.loop,
        op: "audio-loop",
        ...(k === 0 && { inputs: { audio: i.audio } }),
        params: { duration: made, sourceDuration: clip },
        ...(k === passes.length - 1 && { title }),
        step: { label: `${p} plays${passes.length > 1 ? ` · call ${k + 1} of ${passes.length}` : ""}`, index: k, of: passes.length },
      },
      ...(k > 0 && { after: [`loop-${k}`], chain: [{ slot: "audio" as const }] }),
    };
    clip = made;
    return step;
  });
  return {
    steps,
    length,
    summary: `Plays it ${plural(plays, "time")} back to back${passes.length > 1 ? ` (${passes.length} calls of up to ${CLOUD_PER_CALL})` : ""}: ${clock(length)}.`,
    notes: [
      ...(length - duration > 0.05 ? [`The cloud repeats the whole clip, so this comes out ${clock(length)}, not ${clock(duration)}.`] : []),
      "For smooth seams and an exact length, switch to Open source.",
    ],
  };
}

/** Clips one after another; throws what's in the way. */
export function planJoin(i: JoinInput): ToolPlan {
  const clips = i.clips;
  if (clips.length < 2) throw new Error("Add at least two clips to join");
  if (clips.length > JOIN_MAX_CLIPS) throw new Error(`Join up to ${JOIN_MAX_CLIPS} clips at a time`);
  const lengths = clips.map((c) => c.duration);
  const known = lengths.every((l): l is number => typeof l === "number" && l > 0);
  const title = `Join · ${plural(clips.length, "clip")}`;
  const base = { feature: JOIN_FEATURE, batchTitle: title } satisfies Partial<GenerationRequest>;
  const models = AUDIO_TOOL_MODELS[i.engine];
  if (i.engine === "open") {
    const x = fade(i.crossfade, DEFAULT_JOIN_CROSSFADE);
    const problem = known ? crossfadeProblem(lengths as number[], x, "join") : null;
    if (problem) throw new Error(problem);
    return {
      steps: [
        {
          key: "join",
          request: {
            ...base,
            modelId: models.join,
            op: "audio-join",
            inputs: { audios: clips.map((c) => c.url) },
            params: { crossfade: x, ...(i.curve === "linear" && { extra: { curve: "linear" } }) },
            title,
            step: { label: `${plural(clips.length - 1, "seam")} · ${x} s crossfades`, index: 0, of: 1 },
          },
        },
      ],
      length: known ? joinedLength(lengths as number[], x) : null,
      summary: `Joins ${plural(clips.length, "clip")} in this order with a ${x} s crossfade at ${plural(clips.length - 1, "seam")}.`,
      notes: [],
    };
  }
  // The cloud joins end to end, up to 5 files a call: more clips continue from the last call's result.
  const steps: ToolStep[] = [];
  let at = 0;
  while (at < clips.length) {
    const k = steps.length + 1;
    const take = clips.slice(at, at + (k === 1 ? CLOUD_PER_CALL : CLOUD_PER_CALL - 1));
    at += take.length;
    const last = at >= clips.length;
    steps.push({
      key: `join-${k}`,
      request: { ...base, modelId: models.join, op: "audio-join", inputs: { audios: take.map((c) => c.url) }, ...(last && { title }) },
      ...(k > 1 && { after: [`join-${k - 1}`], chain: [{ slot: "audios" as const, position: "first" as const }] }),
    });
  }
  steps.forEach((s, k) => (s.request.step = { label: `Hard cuts${steps.length > 1 ? ` · call ${k + 1} of ${steps.length}` : ""}`, index: k, of: steps.length }));
  return {
    steps,
    length: known ? joinedLength(lengths as number[], 0) : null,
    summary: `Joins ${plural(clips.length, "clip")} end to end${steps.length > 1 ? ` (${steps.length} calls of up to ${CLOUD_PER_CALL})` : ""}.`,
    notes: ["The clips meet with a hard cut here. For crossfades, switch to Open source."],
  };
}
