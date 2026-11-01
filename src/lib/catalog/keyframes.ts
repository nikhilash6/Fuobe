/**
 * Frames mode (Kling 4.0's "Frames", Higgsfield gap G02): up to 10 stills, each at its own time in
 * the clip, the first one the start frame. Pure logic shared by the Video studio composer, the
 * planner and the open engine's keyframe film (src/server/chains.ts createKeyframeFilm):
 *
 * - Frame positions are kept as fractions of the clip (0 = start, 1 = end), so a longer or shorter
 *   clip stretches them; they become seconds, snapped to 0.1 s, only when shown or sent.
 * - What a model does with them: every frame at its time (FLUX 3 Max keyframes-to-video, or the
 *   open engine's chain of start/end-frame clips), only the first and the last (start + end frame
 *   models such as Kling O3), or nothing (start-frame-only and text-only models: a blocker).
 * - The open plan: one start/end-frame clip per pair of neighbouring frames, each as long as the gap
 *   between them in the workflow's own frame steps (Wan 2.2: n·4 + 1 frames at 16 fps), then joined.
 *
 * No catalog import (types only), so the composer can use it in the browser.
 */
import type { Engine, GenerationRequest, ModelDef, ModelRoute, Operation } from "./types";

/**
 * Up to 10 frames, as Kling 4.0's own app and FLUX 3 Max keyframes-to-video take. Frames mode runs on FLUX 3 Max in the
 * cloud, never on Kling 4.0: its hosted API (fal and Replicate, read 2026-11-01) takes a start frame, up to 8 middle
 * frames in order and an end frame, with no time for any of them, so a frame can't be placed where the strip puts it.
 * Kling 4.0 runs here as a start + end frame model (only the first and the last frame).
 */
export const MAX_KEYFRAMES = 10;
/** Frame times snap to a tenth of a second. */
export const KEYFRAME_SNAP = 0.1;
/** The open chain's shortest clip between two frames (a start/end-frame clip under half a second is a jump cut). */
export const OPEN_MIN_GAP = 0.5;
/** Clip lengths the open chain offers in Frames mode (it joins as many clips as the frames need). */
export const CHAIN_DURATIONS = [3, 5, 8, 10, 15, 20, 30];

export const FRAMES_HINT = "Up to 10 frames. The first is the start frame.";

const EPS = 1e-6;
const snap = (s: number) => Math.round(s / KEYFRAME_SNAP) * KEYFRAME_SNAP;
const round1 = (s: number) => Math.round(s * 10) / 10;
/** "2.5 s", "3 s". */
export const secondsLabel = (s: number) => `${round1(s).toFixed(round1(s) % 1 ? 1 : 0)} s`;

// ---------------------------------------------------------------------------
// What a model does with frames

/** "all": every frame at its time · "ends": the first and the last only · "start": the first only · "none": no frames. */
export type FrameSupport = "all" | "ends" | "start" | "none";

/** A ComfyUI keyframes route that runs as a chain of its start/end-frame workflow (one clip per pair, joined). */
export function keyframeChain(model: Pick<ModelDef, "routes">): ModelRoute | undefined {
  return model.routes.find((r) => r.op === "keyframes" && r.chained);
}

export function frameSupport(model: Pick<ModelDef, "routes" | "options">): FrameSupport {
  const ops = new Set(model.routes.map((r) => r.op));
  if (ops.has("keyframes")) return "all";
  if (ops.has("flf2v") || (ops.has("i2v") && model.options.endFrame)) return "ends";
  return ops.has("i2v") ? "start" : "none";
}

/**
 * The model to suggest for every frame on each engine (it must be in the Video studio's list). On the open
 * engine that's Wan 2.2 14B: its start/end-frame workflow is the one every pair runs on (Lightning has no
 * 4-step version of it), so the whole film comes out at one quality, with up to 7 s between frames.
 */
export const FRAMES_MODELS: Record<Engine, { id: string; name: string }> = {
  cloud: { id: "flux-3-max", name: "FLUX 3 Max" },
  open: { id: "oss-wan22-14b", name: "Wan 2.2 14B" },
};

/**
 * Why a chained route can't be a step that waits (a Canvas node fed by another node, a pipeline step): its steps
 * are planned from its inputs when it's created (a film's clips; the open text-to-3D route's still).
 */
export const chainedWaitMessage = (name: string, op?: Operation) =>
  op === "text-to-3d"
    ? `${name} draws the object first, then builds it in 3D, from words typed in when it starts — give it a typed description, not another step's output`
    : `${name} builds this film from several clips of the images you add when it starts — give it uploaded images and a typed prompt, not another step's output`;

/**
 * A keyframe film some of whose frames earlier steps make (Turnaround video: the sides the Angles app draws): every
 * chain slot is a frame with its place among the request's own (ChainSlot.at). The open engine's film can wait for those,
 * clip by clip; any other chained input is refused as before (chainedWaitMessage).
 */
export function framesWait(req: Pick<GenerationRequest, "chain">): boolean {
  return !!req.chain?.length && req.chain.every((s) => s.slot === "images" && s.at !== undefined && s.at >= 0);
}

/** What stops Generate in Frames mode before the planner speaks: no start frame, or a model that can't follow frames. */
export function framesBlocker(model: Pick<ModelDef, "name" | "engine" | "routes" | "options">, count: number): { message: string; slot?: "frames" } | null {
  const support = frameSupport(model);
  const alt = FRAMES_MODELS[model.engine].name;
  if (support === "start") return { message: `${model.name} takes a start frame only — pick ${alt} to follow your frames, or turn Frames off` };
  if (support === "none") return { message: `${model.name} can't start from frames — pick ${alt}, or turn Frames off` };
  if (!count) return { message: "Add the start frame", slot: "frames" };
  return null;
}

type NoteModel = Pick<ModelDef, "id" | "name" | "engine" | "routes" | "options">;

/**
 * The line under the strip: what the model will do with the frames (said before anything runs).
 * Null when every frame is used as placed. `suggested` is the engine's FRAMES_MODELS model, when the
 * catalog has it: an open chain whose pairs run on that model's own workflow says it gains nothing there
 * (Wan 2.2 14B Lightning: the same full-quality start/end-frame clips, shorter gaps, and only the stretch
 * after the last frame, `tail`, a fast one).
 */
export function framesNote(model: NoteModel, count: number, lastAt = 1, ctx: { suggested?: NoteModel; tail?: boolean } = {}): string | null {
  const support = frameSupport(model);
  const chain = keyframeChain(model);
  const { suggested } = ctx;
  const theirs = suggested && keyframeChain(suggested);
  if (support === "all" && count >= 2 && chain && theirs && suggested.id !== model.id && theirs.endpoint === chain.endpoint) {
    const longer = chainTiming(suggested).maxSeconds > chainTiming(model).maxSeconds + EPS;
    const more = longer ? ` and allows up to ${secondsLabel(chainTiming(suggested).maxSeconds)} between frames` : "";
    const tail = ctx.tail ? " (only the stretch after the last frame is a fast clip)" : "";
    return `${model.name} has no fast start/end-frame clips: the clips between frames render at ${suggested.name}'s full quality${tail} — ${suggested.name} takes as long${more}.`;
  }
  if (support !== "ends" || count < 2) return null;
  const alt = FRAMES_MODELS[model.engine].name;
  if (count > 2) {
    const middle = count - 2;
    return `${model.name} takes a start and an end frame, so it uses frames 1 and ${count} and leaves out the ${middle === 1 ? "middle one" : `${middle} in between`} — ${alt} follows every frame.`;
  }
  return lastAt < 1 - EPS ? `${model.name} puts the last frame at the end of the clip — ${alt} keeps it at its time.` : null;
}

/** What a frame is to the clip, as Kling 4.0 names them: the start frame, the end frame (the last one, at the end), or a middle frame. */
export function frameRole(i: number, count: number, at: number): "Start frame" | "End frame" | "Middle frame" {
  if (i === 0) return "Start frame";
  return i === count - 1 && at >= 1 - EPS ? "End frame" : "Middle frame";
}

/** Clip lengths to offer in Frames mode: the open chain's own list, else the model's. */
export function framesDurations(model: Pick<ModelDef, "routes" | "options">): number[] {
  if (keyframeChain(model)) return CHAIN_DURATIONS;
  return model.options.durations?.length ? model.options.durations : [5];
}

/** The clip length Frames mode uses: the one asked for when the model offers it, else the nearest it does. */
export function framesDuration(model: Pick<ModelDef, "routes" | "options" | "defaults">, asked: number | undefined): number {
  const list = framesDurations(model);
  const want = asked ?? model.defaults?.duration ?? list[0];
  return list.reduce((best, d) => (Math.abs(d - want) < Math.abs(best - want) ? d : best), list[0]);
}

// ---------------------------------------------------------------------------
// Positions (fractions of the clip)

/** n frames spread evenly from the start to the end. */
export function spread(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];
  return Array.from({ length: n }, (_, i) => i / (n - 1));
}

const isSpread = (ats: number[]) => ats.length > 1 && spread(ats.length).every((x, i) => Math.abs(x - ats[i]) < 0.005);

/**
 * Where the frames sit after one more is added at the end: evenly spaced frames stay evenly spaced
 * (start, then end, then the middle); frames you placed keep their places and the new one goes at
 * the end (the old last frame steps to halfway when it was there already).
 */
export function addFrameAt(ats: number[]): number[] {
  const n = ats.length;
  if (n === 0) return [0];
  if (n === 1 || isSpread(ats)) return spread(n + 1);
  if (ats[n - 1] < 1 - EPS) return [...ats, 1];
  return [...ats.slice(0, -1), (ats[n - 2] + 1) / 2, 1];
}

/** Where the frames sit after frame i goes: evenly spaced ones re-space; the first is always the start frame. */
export function removeFrameAt(ats: number[], i: number): number[] {
  const left = ats.filter((_, j) => j !== i);
  if (isSpread(ats)) return spread(left.length);
  if (left.length) left[0] = 0;
  return left;
}

/**
 * The frames as seconds in a clip of `duration`: snapped to 0.1 s, the first at 0, each at least
 * 0.1 s after the one before and none past the end (frames squeezed at the end step back).
 */
export function frameTimes(ats: number[], duration: number): number[] {
  const out = ats.map((a, i) => (i === 0 ? 0 : round1(snap(Math.max(0, Math.min(1, a)) * duration))));
  for (let i = 1; i < out.length; i++) out[i] = round1(Math.max(out[i], out[i - 1] + KEYFRAME_SNAP));
  for (let i = out.length - 1; i > 0; i--) out[i] = round1(Math.min(out[i], i === out.length - 1 ? duration : out[i + 1] - KEYFRAME_SNAP));
  return out;
}

/** The range frame i can be dragged in (s): after the frame before it, before the next (or the clip's end). The first never moves. */
export function frameRange(times: number[], i: number, duration: number): [number, number] {
  if (i <= 0) return [0, 0];
  const lo = round1(times[i - 1] + KEYFRAME_SNAP);
  const hi = round1(i === times.length - 1 ? duration : times[i + 1] - KEYFRAME_SNAP);
  return [lo, Math.max(lo, hi)];
}

/** Frame i moved to `seconds` (snapped to 0.1 s and kept between its neighbours), as new positions. */
export function moveFrameAt(ats: number[], i: number, seconds: number, duration: number): number[] {
  if (i <= 0 || i >= ats.length || duration <= 0) return ats;
  const times = frameTimes(ats, duration);
  const [lo, hi] = frameRange(times, i, duration);
  const t = round1(Math.min(hi, Math.max(lo, snap(seconds))));
  return ats.map((a, j) => (j === i ? t / duration : j === 0 ? 0 : times[j] / duration));
}

/** Positions back from seconds (Reuse of a keyframes run). */
export function positionsFrom(times: number[], duration: number): number[] {
  return times.map((t, i) => (i === 0 || duration <= 0 ? 0 : Math.max(0, Math.min(1, t / duration))));
}

/**
 * The inputs Frames mode sends for the model: every frame with its time, the first and the last as
 * start and end frame, or the start frame alone. One frame is a plain image-to-video start.
 */
export function framesInputs(refs: string[], times: number[], support: FrameSupport): { images?: string[]; endImage?: string; keyframeTimes?: number[] } {
  if (!refs.length) return {};
  if (refs.length === 1 || support === "start" || support === "none") return { images: [refs[0]] };
  if (support === "ends") return { images: [refs[0]], endImage: refs[refs.length - 1] };
  return { images: refs, keyframeTimes: times };
}

// ---------------------------------------------------------------------------
// Checks and the open engine's plan

/** The open chain starts its film on the first frame: nothing comes before it. */
export const FIRST_AT_ZERO = "The first frame is the start frame — give it the time 0";

export interface ChainTiming {
  /** The model's name, for messages. */
  name: string;
  /** The longest clip the model makes between two frames (s). */
  maxSeconds: number;
  /** The shortest (s). */
  minSeconds?: number;
}

/** The open chain's limits for a model: its longest clip is the longest gap between two frames. */
export function chainTiming(model: Pick<ModelDef, "name" | "options">): ChainTiming {
  return { name: model.name, maxSeconds: Math.max(...(model.options.durations ?? [5])) };
}

/**
 * The open chain's rule for the gaps: each pair of neighbouring frames (and the stretch after the
 * last frame, when it isn't at the end) is one clip the model can make. Returns the message for the
 * first gap that doesn't fit, or null.
 */
export function chainGapProblem(times: number[], duration: number, t: ChainTiming): string | null {
  const min = t.minSeconds ?? OPEN_MIN_GAP;
  // One frame is one clip from it alone (a plain image-to-video), as long as the model makes.
  if (times.length === 1) {
    const one = round1(duration - times[0]);
    return one > t.maxSeconds + EPS ? `One frame makes a clip of up to ${secondsLabel(t.maxSeconds)} on ${t.name} — add more frames or make the clip shorter` : null;
  }
  for (let i = 1; i < times.length; i++) {
    const gap = round1(times[i] - times[i - 1]);
    if (gap > t.maxSeconds + EPS) return `Frames ${i} and ${i + 1} are ${secondsLabel(gap)} apart — ${t.name} makes up to ${secondsLabel(t.maxSeconds)} between two frames. Move them closer or add a frame between them`;
    if (gap < min - EPS) return `Frames ${i} and ${i + 1} are only ${secondsLabel(gap)} apart — keep at least ${secondsLabel(min)} between frames on ${t.name}`;
  }
  const tail = round1(duration - (times[times.length - 1] ?? 0));
  if (times.length > 1 && tail > t.maxSeconds + EPS) return `The clip runs ${secondsLabel(tail)} past the last frame — ${t.name} makes up to ${secondsLabel(t.maxSeconds)} from one frame. Move the last frame later or make the clip shorter`;
  return null;
}

export interface KeyframeClip {
  /** The frame the clip starts on. */
  from: number;
  /** The frame it ends on, or null for the stretch after the last frame (from that frame alone). */
  to: number | null;
  /** Frames in the clip (n·step + 1, the workflow's own count) and the seconds to ask for ((frames − 1) / fps). */
  frames: number;
  seconds: number;
}

/**
 * One start/end-frame clip per pair of neighbouring frames, then the stretch after the last frame
 * when it isn't at the end (shorter than the minimum: the film ends on the last frame). Each clip's
 * last frame is the next one's first, so frame k lands on the film's frame Σ(earlier clips) − 1;
 * the counts are chosen against the film's running total and the frame's exact time (t·fps, not
 * rounded first), so the frames stay on their times within half a frame step (Wan 2.2: ±2 frames
 * at 16 fps) however many clips there are. The film starts on the first frame, so its time is 0.
 */
export function planKeyframeClips(times: number[], duration: number, t: ChainTiming & { fps: number; step: number; maxFrames?: number }): KeyframeClip[] {
  if (times.length < 2) throw new Error("A keyframe film needs at least two frames");
  if (Math.abs(times[0]) > EPS) throw new Error(FIRST_AT_ZERO);
  const problem = chainGapProblem(times, duration, t);
  if (problem) throw new Error(problem);
  const min = t.minSeconds ?? OPEN_MIN_GAP;
  const cap = Math.min(t.maxFrames ?? Infinity, Math.round(t.maxSeconds * t.fps) + 1);
  const fit = (want: number) => {
    let n = Math.max(t.step + 1, Math.round((want - 1) / t.step) * t.step + 1);
    while (n > cap) n -= t.step;
    return n;
  };
  const stops = [...times];
  if (duration - times[times.length - 1] >= min - EPS) stops.push(duration);
  const clips: KeyframeClip[] = [];
  let total = 0;
  for (let i = 1; i < stops.length; i++) {
    // The film's frame count once this clip is in: its last frame (the next frame) sits at stops[i].
    const target = stops[i] * t.fps + 1;
    const frames = fit(target - total);
    total += frames;
    clips.push({ from: i - 1, to: i < times.length ? i : null, frames, seconds: Math.round(((frames - 1) / t.fps) * 1e4) / 1e4 });
  }
  return clips;
}
