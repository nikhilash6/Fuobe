/**
 * Keyframe animation (in-betweening): keyframes in, the in-betweens generated, one finished animation. Each gap between
 * two neighbouring keyframes is one Wan 2.2 start/end-frame pass with its own timing:
 *
 * - a length in Wan's frame steps (4n + 1 frames, at least 17: fewer and the motion isn't legible);
 * - a speed: keep every Nth frame (×1–×4), so a fast move skips frames the way hand-drawn animation does;
 * - every pose lands on screen: the kept frames are counted back from the gap's last frame (the next keyframe), and the
 *   frame each gap starts on (the keyframe the gap before ended on) is dropped, so no joint shows a frame twice;
 * - the playback rate: 24 fps (the passes are made at 16 fps, so they play faster: part of the animation's timing, as in
 *   the workflow this follows) or 16 fps (true time).
 *
 * Fuobe Animation runs this on both engines: one graph on your GPU (src/lib/av/inbetween-graph.ts), every speed and both
 * rates; in the cloud one hosted clip per gap, joined, at ×1 and 16 fps (the hosted endpoint makes every frame and
 * plays it as made). Pure, no imports beyond types: the composer, the planner, the provider and the tools share it.
 */

/** Wan 2.2's frame step: a pass is 4n + 1 frames. */
export const GAP_STEP = 4;
/** The shortest pass: 17 frames ("17 frames minimum for legible motion"). */
export const MIN_GAP_FRAMES = 17;
/** The longest pass: Wan 2.2's own 81 frames (5 s at 16 fps). */
export const MAX_GAP_FRAMES = 81;
/** The rate Wan 2.2 makes frames at. */
export const MAKE_FPS = 16;
/** Speeds: keep every Nth frame. */
export const SPEEDS = [1, 2, 3, 4] as const;
export type Speed = (typeof SPEEDS)[number];
/** Playback rates: 24 fps (snappier, as the workflow plays it) or 16 fps (true time). */
export const PLAYBACK_RATES = [24, 16] as const;
export type PlaybackFps = (typeof PLAYBACK_RATES)[number];
export const DEFAULT_PLAYBACK: PlaybackFps = 24;
/** Keyframes: 2 to 10 (Frames mode's own limit). */
export const MIN_KEYS = 2;
export const MAX_KEYS = 10;
/** The workflow's words for a character whose mouth should stay still between poses. */
export const STILL_MOUTH_PROMPT = "mouth does not move";

/** One gap's timing: frames made, every Nth kept, and its own words (added to the film's prompt). */
export interface GapTiming {
  frames: number;
  speed: Speed;
  prompt?: string;
}

export interface InbetweenTiming {
  gaps: GapTiming[];
  fps: PlaybackFps;
}

/** What each engine does with the timing. */
export interface EngineTiming {
  speeds: readonly Speed[];
  rates: readonly PlaybackFps[];
}
export const ENGINE_TIMING: Record<"open" | "cloud", EngineTiming> = {
  open: { speeds: SPEEDS, rates: PLAYBACK_RATES },
  cloud: { speeds: [1], rates: [16] },
};

/** The nearest pass length Wan makes: 4n + 1, from 17 to 81. */
export function snapGapFrames(n: number): number {
  if (!Number.isFinite(n)) return MIN_GAP_FRAMES;
  const k = Math.round((n - 1) / GAP_STEP);
  return Math.min(MAX_GAP_FRAMES, Math.max(MIN_GAP_FRAMES, k * GAP_STEP + 1));
}

export const isSpeed = (n: unknown): n is Speed => typeof n === "number" && (SPEEDS as readonly number[]).includes(n);
export const isPlayback = (n: unknown): n is PlaybackFps => typeof n === "number" && (PLAYBACK_RATES as readonly number[]).includes(n);

/**
 * Which of a gap's frames are kept, as VideoHelperSuite's every-Nth selection takes them (images[skip::every]): counted
 * back from its last frame (the next keyframe) and never its first (the keyframe before, already on screen). The first
 * gap's first frame (keyframe 1) is taken separately (`first`).
 */
export function gapSelection(g: Pick<GapTiming, "frames" | "speed">): { skip: number; every: Speed; kept: number } {
  const last = g.frames - 1;
  const skip = ((last - 1) % g.speed) + 1;
  return { skip, every: g.speed, kept: Math.floor((last - 1) / g.speed) + 1 };
}

/** The frames kept from each gap (the first gap also shows keyframe 1). */
export function keptFrames(t: Pick<InbetweenTiming, "gaps">): number[] {
  return t.gaps.map((g, i) => gapSelection(g).kept + (i === 0 ? 1 : 0));
}

/**
 * A gap made longer than its own length, brought down to it inside the film (the cloud: Replicate's fast Wan 2.2 makes at
 * least 81 frames a clip, so a 17-frame gap is made as 81). `interval`: take every Nth made frame (1: every frame); `picks`:
 * which of the frames taken make the gap, in order. Where the made length divides evenly (81 → 17, 21, 41: every 5th, 4th,
 * 2nd) the frames taken are the gap exactly; otherwise every frame is taken and each of the gap's frames is the nearest
 * made frame at its place in time (first and last land on the clip's first and last, the two keyframes). Null when the
 * clip is already the gap's length.
 */
export function resampleGap(made: number, frames: number): { interval: number; picks: number[] } | null {
  if (!(made > frames) || frames < 2) return null;
  const span = made - 1;
  const steps = frames - 1;
  if (span % steps === 0) return { interval: span / steps, picks: Array.from({ length: frames }, (_, i) => i) };
  return { interval: 1, picks: Array.from({ length: frames }, (_, i) => Math.round((i * span) / steps)) };
}

/** The film's frame count: keyframe 1, then every gap's kept frames. */
export function totalFrames(t: Pick<InbetweenTiming, "gaps">): number {
  return t.gaps.length ? keptFrames(t).reduce((a, b) => a + b, 0) : 0;
}

/** Seconds from one keyframe to the next, at the playback rate. */
export function gapSeconds(g: Pick<GapTiming, "frames" | "speed">, fps: number): number {
  return gapSelection(g).kept / fps;
}

/** The film's length (s). */
export function totalSeconds(t: InbetweenTiming): number {
  return totalFrames(t) / t.fps;
}

/** Each keyframe's time in the film (s): keyframe 1 at 0. */
export function keyTimes(t: InbetweenTiming): number[] {
  const out = [0];
  for (const g of t.gaps) out.push(out[out.length - 1] + gapSeconds(g, t.fps));
  return out.map((s) => Math.round(s * 1000) / 1000);
}

/** Frames Wan makes in all (what the run costs, in time on your GPU or in seconds of hosted video). */
export const madeFrames = (t: Pick<InbetweenTiming, "gaps">) => t.gaps.reduce((a, g) => a + g.frames, 0);

/** The gap that fits `seconds` between two keyframes at this speed and rate (the nearest length Wan makes). */
export function gapFor(seconds: number, speed: Speed, fps: number): GapTiming {
  const kept = Math.max(1, Math.round(seconds * fps));
  return { frames: snapGapFrames(kept * speed + 1), speed };
}

/** The workflow's own timing for its five keyframes (37, 17, 17, 45 frames; every 1st, 3rd, 4th, 1st). */
export const WORKFLOW_TIMING: InbetweenTiming = {
  gaps: [
    { frames: 37, speed: 1 },
    { frames: 17, speed: 3 },
    { frames: 17, speed: 4 },
    { frames: 45, speed: 1 },
  ],
  fps: 24,
};

/** A new gap: 33 frames (about 1.3 s at 24 fps). */
export const DEFAULT_GAP: GapTiming = { frames: 33, speed: 1 };

/** Timing for `keys` keyframes: the given gaps kept (fitted to an engine), new ones added, extra ones dropped. */
export function timingFor(keys: number, given: Partial<InbetweenTiming> | undefined, engine: "open" | "cloud" = "open"): InbetweenTiming {
  const can = ENGINE_TIMING[engine];
  const fps = given?.fps && can.rates.includes(given.fps) ? given.fps : can.rates[0];
  const gaps = Array.from({ length: Math.max(0, keys - 1) }, (_, i) => {
    const g = given?.gaps?.[i] ?? DEFAULT_GAP;
    const speed = can.speeds.includes(g.speed) ? g.speed : 1;
    // The words as typed (a trailing space is the next word coming); requests trim them (requestTiming, gapPrompt).
    return { frames: snapGapFrames(g.frames), speed, ...(g.prompt?.trim() && { prompt: g.prompt }) };
  });
  return { gaps, fps };
}

/**
 * Frames mode's times (s, the first at 0) as in-between timing: each gap as long as the time between its keyframes at
 * the playback rate (the nearest length Wan makes). Anything after the last keyframe is left out: the film ends on it.
 */
export function timingFromTimes(times: number[], opts: { fps?: PlaybackFps; speed?: Speed; engine?: "open" | "cloud" } = {}): InbetweenTiming {
  const engine = opts.engine ?? "open";
  const fps = opts.fps && ENGINE_TIMING[engine].rates.includes(opts.fps) ? opts.fps : ENGINE_TIMING[engine].rates[0];
  const speed = opts.speed && ENGINE_TIMING[engine].speeds.includes(opts.speed) ? opts.speed : 1;
  const gaps: GapTiming[] = [];
  for (let i = 1; i < times.length; i++) gaps.push(gapFor(times[i] - times[i - 1], speed, fps));
  return { gaps, fps };
}

/** Keyframe i dragged to `seconds`: the gaps on either side take the new times (the later keyframes keep theirs). */
export function moveKey(t: InbetweenTiming, i: number, seconds: number): InbetweenTiming {
  if (i <= 0 || i > t.gaps.length) return t;
  const times = keyTimes(t);
  const gaps = t.gaps.map((g) => ({ ...g }));
  const before = gaps[i - 1];
  gaps[i - 1] = { ...before, ...gapFor(seconds - times[i - 1], before.speed, t.fps) };
  if (i < gaps.length) {
    const moved = times[i - 1] + gapSeconds(gaps[i - 1], t.fps);
    const after = gaps[i];
    gaps[i] = { ...after, ...gapFor(times[i + 1] - moved, after.speed, t.fps) };
  }
  return { ...t, gaps };
}

/** One gap's length a step longer (+1) or shorter (−1): 4 frames. */
export const stepGap = (g: GapTiming, by: 1 | -1): GapTiming => ({ ...g, frames: snapGapFrames(g.frames + by * GAP_STEP) });

/** "37 f · ×3", the chip on the ruler. */
export const gapLabel = (g: GapTiming) => `${g.frames} f${g.speed > 1 ? ` · ×${g.speed}` : ""}`;

/** "2.4 s" (one decimal; whole seconds without one). */
export function lengthLabel(s: number): string {
  const r = Math.round(s * 10) / 10;
  return `${r % 1 ? r.toFixed(1) : r.toFixed(0)} s`;
}

/** What's wrong with a timing for this many keyframes, or null. */
export function timingProblem(t: InbetweenTiming, keys: number, engine: "open" | "cloud" = "open"): string | null {
  if (keys < MIN_KEYS) return "Add at least two keyframes: the in-betweens go between them";
  if (keys > MAX_KEYS) return `Up to ${MAX_KEYS} keyframes`;
  if (t.gaps.length !== keys - 1) return `${keys} keyframes have ${keys - 1} gaps between them`;
  const can = ENGINE_TIMING[engine];
  if (!can.rates.includes(t.fps)) return engine === "cloud" ? "In the cloud the animation plays at 16 fps — 24 fps runs on your GPU" : "Play at 24 or 16 fps";
  for (const [i, g] of t.gaps.entries()) {
    const at = `Between keyframes ${i + 1} and ${i + 2}`;
    if (!Number.isInteger(g.frames) || g.frames < MIN_GAP_FRAMES || g.frames > MAX_GAP_FRAMES || (g.frames - 1) % GAP_STEP)
      return `${at}: ${MIN_GAP_FRAMES} to ${MAX_GAP_FRAMES} frames, in steps of ${GAP_STEP}`;
    if (!can.speeds.includes(g.speed)) return engine === "cloud" ? `${at}: in the cloud every frame is kept (×1) — ×${g.speed} runs on your GPU` : `${at}: speed ×1 to ×4`;
  }
  return null;
}

/**
 * The timing a request carries (params.extra.inbetween), checked; when it has none, Frames mode's times make it. Throws
 * with a message for the person when it's wrong.
 */
export function requestTiming(extra: Record<string, unknown> | undefined, keys: number, times: number[] | undefined, engine: "open" | "cloud"): InbetweenTiming {
  const raw = extra?.inbetween as Partial<InbetweenTiming> | undefined;
  let t: InbetweenTiming;
  if (raw && typeof raw === "object" && Array.isArray(raw.gaps)) {
    const gaps = raw.gaps.map((g) => ({
      frames: Number((g as GapTiming)?.frames),
      speed: Number((g as GapTiming)?.speed ?? 1) as Speed,
      ...(typeof (g as GapTiming)?.prompt === "string" && (g as GapTiming).prompt!.trim() && { prompt: (g as GapTiming).prompt!.trim().slice(0, 500) }),
    }));
    t = { gaps, fps: Number(raw.fps ?? ENGINE_TIMING[engine].rates[0]) as PlaybackFps };
  } else {
    // A playback rate alone (no gaps): the gaps come from the times (or the default), played at that rate.
    const fps = raw && typeof raw === "object" && raw.fps !== undefined ? (Number(raw.fps) as PlaybackFps) : undefined;
    t = times && times.length === keys && keys >= MIN_KEYS ? timingFromTimes(times, { engine, fps }) : timingFor(keys, { fps }, engine);
    if (fps !== undefined) t = { ...t, fps };
  }
  const problem = timingProblem(t, keys, engine);
  if (problem) throw new Error(problem);
  return t;
}

/** The words a gap's pass runs on: the film's prompt, the gap's own words, and "mouth does not move" when asked. */
export function gapPrompt(base: string | undefined, gap: Pick<GapTiming, "prompt">, stillMouth: boolean): string {
  return [base?.trim().replace(/[.\s]+$/, ""), gap.prompt?.trim().replace(/[.\s]+$/, ""), stillMouth ? STILL_MOUTH_PROMPT : ""].filter(Boolean).join(". ");
}

/** Fuobe Animation's model id. */
export const ANIMATION_MODEL = "fuobe-animation";

/**
 * The Video studio in Frames mode with these stills as keyframes, in Animation style (Storyboard's "Animate these panels",
 * a Character Sheet's "Animate between poses"): /video?model=fuobe-animation&frames=a,b,c&prompt=….
 */
export function animateHref(stills: string[], prompt?: string): string {
  const q = new URLSearchParams({ model: ANIMATION_MODEL, frames: stills.slice(0, MAX_KEYS).join(",") });
  if (prompt?.trim()) q.set("prompt", prompt.trim());
  return `/video?${q.toString()}`;
}
