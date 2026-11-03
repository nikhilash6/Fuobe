import { currentModelId } from "@/lib/catalog/replaced";
import type { ChainSlot, Engine, Generation, GenerationRequest } from "@/lib/catalog/types";
import { FRAME_MODEL, frameParams } from "./frames";

/**
 * Katana: rebuild a reference edit with your own subject. The reference is cut into segments (fixed
 * length, or at the scene cuts the browser finds with a frame-difference pass); for each segment the
 * first frame gets your subject (an edit model with your photos), then the segment is regenerated with
 * the reference's motion; the new segments are joined at the original cut times and the reference's
 * soundtrack goes back on. Planned as plain data (client and server); run with createPipeline.
 */
export const KATANA_FEATURE = "katana";

export const KATANA_LIMITS = { maxReference: 30, minReference: 1, maxPhotos: 5, maxSegments: 12, maxInstructions: 2000 };

export interface MotionModel {
  id: string;
  label: string;
  /** "v2v": the model edits the segment with reference images; "motion-transfer": a character image follows the segment's motion. */
  op: "v2v" | "motion-transfer";
  /** Segment length the model takes (seconds). */
  min: number;
  max: number;
  /** Reference images it takes besides the keyframe (photos of the subject). */
  maxRefs: number;
}

/**
 * Gemini Omni Flash's edit endpoint is left out on purpose: it takes the clip and a text instruction only
 * (no reference images), so it can't put the subject from your photos into the segment.
 */
export const MOTION_MODELS: Record<Engine, MotionModel[]> = {
  cloud: [
    { id: "kling-o3", label: "Kling O3 edit", op: "v2v", min: 3, max: 10, maxRefs: 4 },
    { id: "fuobe-genjutsu-motion", label: "Fuobe Genjutsu · Motion", op: "motion-transfer", min: 3, max: 10, maxRefs: 1 },
    { id: "kling-motion-control", label: "Kling 3.0 Motion Control", op: "motion-transfer", min: 3, max: 10, maxRefs: 1 },
  ],
  open: [
    { id: "fuobe-genjutsu-motion", label: "Fuobe Genjutsu · Motion (Wan Animate 2)", op: "motion-transfer", min: 1, max: 5, maxRefs: 1 },
    { id: "oss-wan22-fun-control", label: "Wan 2.2 Fun Control", op: "motion-transfer", min: 1, max: 5, maxRefs: 1 },
  ],
};

/** The keyframe edit: Nano Banana Pro in the cloud; on your GPU Qwen-Image 2.1 Turbo (8 steps, up to 4 images). */
export const KEYFRAME_MODEL: Record<Engine, string> = { cloud: "nano-banana-pro", open: "oss-qwen-image-21-turbo" };
/** Your photos the open keyframe edit takes beside the frame (Qwen-Image 2.1 Turbo: the frame and three photos). */
export const OPEN_KEYFRAME_PHOTOS = 3;

/** Katana's earlier open motion model, now Fuobe Genjutsu's Original (a saved job or an API call may still name it). */
export const RETIRED_MOTION_MODELS: Record<string, string> = { "oss-wan22-animate": "fuobe-genjutsu-motion" };

/** The motion model a saved job or an API call means: a retired one (src/lib/catalog/replaced.ts too) gives way to what replaced it. */
export const currentMotionModel = (id: string): string => RETIRED_MOTION_MODELS[id] ?? currentModelId(id);

export const motionModel = (engine: Engine, id?: string): MotionModel => {
  const want = id && currentMotionModel(id);
  return MOTION_MODELS[engine].find((m) => m.id === want) ?? MOTION_MODELS[engine][0];
};

export interface Segment {
  start: number;
  end: number;
}

const r2 = (t: number) => Math.round(t * 100) / 100;
/** Times that must not fall before the moment they stand for (a cut, the clip's end) round up / down. */
const up2 = (t: number) => Math.ceil(t * 100 - 1e-6) / 100;
const down2 = (t: number) => Math.floor(t * 100 + 1e-6) / 100;

/**
 * Where scene cuts are in a frame-difference pass: `diffs[i]` is the change between samples i and i+1.
 * A cut is a spike well above the clip's usual change (its median), at least `minGap` seconds apart;
 * returns i for each (the cut lies between samples i and i+1).
 */
export function detectCutIndices(diffs: number[], times: number[], o: { minGap?: number; floor?: number; ratio?: number } = {}): number[] {
  if (diffs.length < 2) return [];
  const sorted = [...diffs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const threshold = Math.max(o.floor ?? 0.12, median * (o.ratio ?? 4));
  const minGap = o.minGap ?? 0.8;
  const out: number[] = [];
  for (let i = 0; i < diffs.length; i++) {
    const d = diffs[i];
    // A local peak above the threshold.
    if (d < threshold || d < (diffs[i - 1] ?? 0) || d < (diffs[i + 1] ?? 0)) continue;
    if (out.length && times[i + 1] - times[out.at(-1)! + 1] < minGap) continue;
    out.push(i);
  }
  return out;
}

/**
 * Scene cuts from a frame-difference pass sampled at `times`. Each cut is placed at the first sample of
 * the new shot (the later sample of the jump), never between the samples, so a segment starting there
 * opens on the new shot (its keyframe is the right shot). Refine with refineCut for frame accuracy.
 */
export function detectCuts(diffs: number[], times: number[], o: { minGap?: number; floor?: number; ratio?: number } = {}): number[] {
  return detectCutIndices(diffs, times, o).map((i) => up2(times[i + 1]));
}

/**
 * A cut found between two coarse samples, pinned down with finer ones: `times` run from the last sample
 * of the old shot to the first of the new one, `diffs[i]` is the change between times[i] and times[i+1];
 * the cut is the sample right after the biggest jump.
 */
export function refineCut(diffs: number[], times: number[]): number {
  let best = 0;
  diffs.forEach((d, i) => {
    if (d > diffs[best]) best = i;
  });
  return up2(times[best + 1] ?? times.at(-1)!);
}

/** Fine sample times between two coarse samples (both ends included). */
export function refineTimes(a: number, b: number, steps = 5): number[] {
  return Array.from({ length: steps + 1 }, (_, i) => a + ((b - a) * i) / steps);
}

/** How far into a segment its keyframe is taken (s): clear of a cut's blended or late frame. */
export const KEYFRAME_OFFSET = 0.1;

/** Split [a, b] into equal pieces no longer than `max`. */
function pieces(a: number, b: number, max: number): Segment[] {
  const n = Math.max(1, Math.ceil((b - a) / max - 1e-9));
  return Array.from({ length: n }, (_, i) => ({ start: r2(a + ((b - a) * i) / n), end: r2(a + ((b - a) * (i + 1)) / n) }));
}

/**
 * The segments to regenerate: every `length` seconds, or at the scene cuts. Segments shorter than `min`
 * join a neighbour, longer than `max` are split evenly; the whole clip is covered without gaps.
 */
export function planSegments(o: { duration: number; mode: "fixed" | "scenes"; length?: number; cuts?: number[]; min: number; max: number; maxSegments?: number }): Segment[] {
  // Rounded down: the last segment must not ask for time past the end of the file.
  const duration = down2(Math.min(o.duration, KATANA_LIMITS.maxReference));
  if (!(duration > 0)) return [];
  const min = Math.min(o.min, duration);
  let segs: Segment[];
  if (o.mode === "fixed") {
    const len = Math.max(min, Math.min(o.max, o.length ?? o.max));
    segs = pieces(0, duration, len);
    // A short tail joins the previous piece (then that piece is split again if too long).
    const last = segs.at(-1)!;
    if (segs.length > 1 && last.end - last.start < min) {
      const prev = segs[segs.length - 2];
      segs = [...segs.slice(0, -2), ...pieces(prev.start, last.end, o.max)];
    }
  } else {
    const cuts = [...new Set((o.cuts ?? []).map(r2))].filter((c) => c > 0 && c < duration).sort((a, b) => a - b);
    const bounds = [0, ...cuts, duration];
    const raw = bounds.slice(1).map((end, i) => ({ start: bounds[i], end }));
    // Merge short scenes into the shorter neighbour until none is short.
    const merged = raw.slice();
    for (;;) {
      const i = merged.findIndex((s) => s.end - s.start < min);
      if (i < 0 || merged.length === 1) break;
      const left = merged[i - 1];
      const right = merged[i + 1];
      const intoLeft = left && (!right || left.end - left.start <= right.end - right.start);
      if (intoLeft) merged.splice(i - 1, 2, { start: left.start, end: merged[i].end });
      else merged.splice(i, 2, { start: merged[i].start, end: right!.end });
    }
    segs = merged.flatMap((s) => pieces(s.start, s.end, o.max));
  }
  const cap = o.maxSegments ?? KATANA_LIMITS.maxSegments;
  if (segs.length > cap) throw new Error(`That makes ${segs.length} segments — Katana takes up to ${cap}. Use a shorter clip or longer segments`);
  return segs;
}

/** The nearest aspect ratio the steps render at. */
export function nearestAspect(width: number, height: number): "16:9" | "9:16" | "1:1" {
  const r = width / Math.max(1, height);
  return r > 1.3 ? "16:9" : r < 0.77 ? "9:16" : "1:1";
}

export interface KatanaInput {
  engine: Engine;
  reference: string;
  photos: string[];
  instructions?: string;
  segments: Segment[];
  motionModel?: string;
  aspectRatio?: string;
  /** Keep the reference's soundtrack (default on). */
  keepAudio?: boolean;
  title?: string;
}

export interface KatanaStep {
  key: string;
  request: GenerationRequest;
  after?: string | string[];
  chain?: ChainSlot[];
}

const tidy = (s?: string) => (s ?? "").trim().replace(/[.\s]+$/, "");

/** The keyframe edit: the segment's first frame with your subject in it. */
export function keyframePrompt(instructions?: string, photos = 1): string {
  const refs = photos > 1 ? `the subject shown in images 2 to ${photos + 1}` : "the subject from image 2";
  const extra = tidy(instructions);
  return `Replace the main subject of image 1 with ${refs}, keeping their identity, face, outfit and details. Keep image 1's pose, framing, camera angle, lighting, background and composition exactly.${extra ? ` ${extra}.` : ""}`;
}

export function motionPrompt(instructions?: string): string {
  const extra = tidy(instructions);
  return `Recreate the source clip with the new subject: the same camera motion, timing, action and framing, cut for cut.${extra ? ` ${extra}.` : ""}`;
}

/** Every step of a Katana run, for createPipeline. The final video is the step keyed "final" (or "join" without audio). */
export function katanaSteps(o: KatanaInput): KatanaStep[] {
  if (!o.photos.length) throw new Error("Add at least one photo of your subject");
  if (o.photos.length > KATANA_LIMITS.maxPhotos) throw new Error(`Add up to ${KATANA_LIMITS.maxPhotos} photos`);
  if (!o.segments.length) throw new Error("The reference needs at least one segment");
  if ((o.instructions?.length ?? 0) > KATANA_LIMITS.maxInstructions) throw new Error(`Keep the instructions under ${KATANA_LIMITS.maxInstructions} characters`);
  const m = motionModel(o.engine, o.motionModel);
  const tooLong = o.segments.find((s) => s.end - s.start > m.max + 0.05);
  if (tooLong) throw new Error(`${m.label} takes segments up to ${m.max} s — split the clip finer`);
  const tooShort = o.segments.find((s) => s.end - s.start < m.min - 0.05);
  if (tooShort) throw new Error(`${m.label} needs segments of at least ${m.min} s`);
  const base = { feature: KATANA_FEATURE, ...(o.title && { batchTitle: o.title }) };
  const n = o.segments.length;
  const steps: KatanaStep[] = [];
  const aspect = o.aspectRatio ?? "16:9";
  o.segments.forEach((s, i) => {
    const label = (what: string) => ({ label: `Segment ${i + 1} of ${n} · ${what}`, index: i, of: n });
    const span = { startTime: r2(s.start), endTime: r2(s.end) };
    // Cut the segment (the open engine resamples it to the motion model's frame rate and size), take its first frame.
    steps.push(
      o.engine === "open"
        ? { key: `cut${i}`, request: { ...base, modelId: "oss-segment", op: "trim", inputs: { video: o.reference }, params: { ...span, aspectRatio: aspect, resolution: "480p" }, step: label("cut") } }
        : { key: `cut${i}`, request: { ...base, modelId: "trim-video", op: "trim", inputs: { video: o.reference }, params: span, step: label("cut") } },
    );
    // The keyframe a few frames in on the open engine (frame accurate); the cloud tool takes the first frame.
    const pick = o.engine === "open" ? { at: KEYFRAME_OFFSET } : ("first" as const);
    steps.push({ key: `frame${i}`, after: `cut${i}`, chain: [{ slot: "video" }], request: { ...base, modelId: FRAME_MODEL[o.engine], op: "frame", params: frameParams(o.engine, pick), step: label("first frame") } });
    // Your subject in that frame (Qwen-Image 2.1 Turbo takes up to 4 images: the frame and three photos).
    const photos = o.engine === "open" ? o.photos.slice(0, OPEN_KEYFRAME_PHOTOS) : o.photos;
    steps.push({ key: `key${i}`, after: `frame${i}`, chain: [{ slot: "images", position: "first" }], request: { ...base, modelId: KEYFRAME_MODEL[o.engine], op: "edit", prompt: keyframePrompt(o.instructions, photos.length), inputs: { images: photos }, step: label("your subject") } });
    // Open models render as long as they're told (Wan Fun Control defaults to 81 frames ≈ 5 s): ask for the segment's length.
    // The engine is named: a Fuobe Original (Genjutsu's motion) runs on both.
    const motion: GenerationRequest = { ...base, engine: o.engine, modelId: m.id, op: m.op, prompt: motionPrompt(o.instructions), params: { aspectRatio: aspect, ...(o.engine === "open" && { resolution: "480p", duration: r2(s.end - s.start) }) }, step: label("motion") };
    if (m.op === "v2v") {
      // The segment is edited with the new keyframe first among its references, then the photos.
      steps.push({ key: `move${i}`, after: [`cut${i}`, `key${i}`], chain: [{ slot: "video" }, { slot: "images", position: "first" }], request: { ...motion, inputs: { images: o.photos.slice(0, m.maxRefs - 1) } } });
    } else {
      const refs = m.maxRefs > 1 ? o.photos.slice(0, m.maxRefs - 1) : [];
      steps.push({ key: `move${i}`, after: [`key${i}`, `cut${i}`], chain: [{ slot: "images", position: "first" }, { slot: "video" }], request: { ...motion, ...(refs.length && { inputs: { images: refs } }) } });
    }
  });
  // Join the regenerated segments in order (the open join takes 4 clips at a time: fold).
  const join = o.engine === "open" ? "oss-join-clips" : "join-clips";
  const max = o.engine === "open" ? 4 : 24;
  let level = o.segments.map((_, i) => `move${i}`);
  let j = 0;
  const joinStep = (keys: string[], key: string): KatanaStep => ({
    key,
    after: keys,
    chain: keys.map(() => ({ slot: "videos" as const })),
    request: { ...base, modelId: join, op: "concat", prompt: o.title ?? "Katana", params: { aspectRatio: aspect, resolution: o.engine === "open" ? "480p" : "720p" }, step: { label: "Joining the segments", index: n, of: n + 1 } },
  });
  if (level.length === 1) {
    // Nothing to join: the one segment is the edit.
  } else {
    while (level.length > max) {
      const key = `join${j++}`;
      steps.push(joinStep(level.slice(0, max), key));
      level = [key, ...level.slice(max)];
    }
    steps.push(joinStep(level, "join"));
    level = ["join"];
  }
  if (o.keepAudio !== false) {
    steps.push({
      key: "final",
      after: level[0],
      chain: [{ slot: "video" }],
      request: { ...base, modelId: o.engine === "open" ? "oss-mux" : "merge-audio-video", op: "mux", inputs: { audio: o.reference }, step: { label: "Original soundtrack", index: n, of: n + 1 } },
    });
  }
  return steps;
}

/** The steps a retry makes again: the failed ones and every step after them (in pipeline order). */
export function stepsToRedo(steps: KatanaStep[], failed: string[]): string[] {
  const redo = new Set(failed);
  for (let grew = true; grew; ) {
    grew = false;
    for (const st of steps) {
      if (redo.has(st.key) || !(st.after === undefined ? [] : [st.after].flat()).some((a) => redo.has(a))) continue;
      redo.add(st.key);
      grew = true;
    }
  }
  return steps.filter((st) => redo.has(st.key)).map((st) => st.key);
}

/**
 * The steps a one-tap button makes again: every step for Run again (a new run of the same input), else the failed ones
 * and every step after them, as retryKatana does (Retry failed steps). Null when the plan can't be read again.
 */
export function againKeys(j: KatanaJobView, all: boolean): string[] | null {
  if (all) return Object.keys(j.steps);
  const failed = Object.entries(j.steps)
    .filter(([, id]) => {
      const g = j.generations[id];
      return !g || g.status === "failed" || g.status === "canceled";
    })
    .map(([k]) => k);
  try {
    return stepsToRedo(katanaSteps(j), failed);
  } catch {
    return null;
  }
}

/** The key of the step that makes the finished video. */
export function finalKey(steps: KatanaStep[]): string {
  return steps.some((s) => s.key === "final") ? "final" : steps.some((s) => s.key === "join") ? "join" : "move0";
}

export interface KatanaJob {
  id: string;
  title: string;
  engine: Engine;
  reference: string;
  photos: string[];
  instructions?: string;
  motionModel: string;
  segments: Segment[];
  keepAudio: boolean;
  /** The render shape (older runs: 16:9). */
  aspectRatio?: string;
  batchId: string;
  /** Generation id per step key. */
  steps: Record<string, string>;
  /** Steps made again by a retry: the generations they replaced, by step key. */
  replaced?: Record<string, string[]>;
  final: string;
  createdAt: number;
  updatedAt: number;
}

export interface KatanaJobView extends KatanaJob {
  generations: Record<string, Generation>;
}

export type KatanaStage = "running" | "done" | "failed";

export function katanaStage(j: KatanaJobView): KatanaStage {
  const gs = Object.values(j.steps).map((id) => j.generations[id]);
  if (gs.some((g) => !g || g.status === "failed" || g.status === "canceled")) return "failed";
  return j.generations[j.steps[j.final]]?.status === "succeeded" ? "done" : "running";
}

/** Share of the steps finished (for one progress bar). */
export function katanaProgress(j: KatanaJobView): number {
  const gs = Object.values(j.steps).map((id) => j.generations[id]);
  if (!gs.length) return 0;
  return gs.reduce((acc, g) => acc + (g?.status === "succeeded" ? 1 : g?.status === "running" ? (g.progress ?? 0.3) : 0), 0) / gs.length;
}
