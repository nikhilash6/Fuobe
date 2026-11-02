/**
 * How long a clip each cloud clip-edit model takes (docs/research/paid-model-apis-3.md, "Input windows"): a clip
 * outside it is paid for and then refused by the provider, or (Happy Horse reads 3–60 s but returns at most the first
 * 15 s) billed for seconds that never come back. Shorts, Mixed Media and Edit video keep to it. No catalog import
 * here, so the composer can use it.
 */
const SOURCE_SECONDS: Record<string, { min?: number; max?: number }> = {
  "kling-o3-4k-edit": { min: 3, max: 15 },
  // fal: "3-30 s" (up to 30.05 s), 300 MB, 700-4553 px a side (research part 4, re-read 2026-11-01).
  "kling-4": { min: 3, max: 30 },
  // It reads 3–60 s but returns at most the first 15 s.
  "happy-horse-video-edit": { min: 3, max: 15 },
  "runway-aleph-2": { min: 2, max: 30 },
  "wan-2-7": { min: 2, max: 10 },
  // Higgsfield feeds Gemini Omni Flash ≤10 s segments.
  "gemini-omni-flash": { max: 10 },
  // fal's H3 Max relight: "up to 15 seconds", resampled to 24 fps and trimmed to 17n+5 frames, "at least 56 frames (about 2.33 seconds)".
  "minimax-h3-max-relight": { min: 2.4, max: 15 },
  // fal's H3 Max insert takes start and resume times up to 60 s into the clip, the resume at least 2.625 s in; the clip itself has
  // no upper limit (the points keep to its first minute: insertRangeProblem).
  "minimax-h3-max-insert": { min: 2.625 },
  // fal's H3 Max Turbo extend: "Must be 1.625 s to 60 s long".
  "minimax-h3-max-turbo-extend": { min: 1.625, max: 60 },
};

/** How long a voice a talking-avatar model takes (fal's H3 Max lip sync: "at least 5 seconds long. Supports up to 15 minutes"). */
const VOICE_SECONDS: Record<string, { min: number; max: number }> = { "minimax-h3-max-lipsync": { min: 5, max: 900 } };

/** Why a voice `seconds` long is outside what the model takes, in Generate's words, or null. */
export function voiceWindowProblem(model: { id: string; name: string }, seconds: number): string | null {
  const w = VOICE_SECONDS[model.id];
  if (!w || !(seconds > 0)) return null;
  if (seconds < w.min - 0.05) return `${model.name} needs at least ${w.min} s of audio, and this is ${secs(seconds)}: use a longer recording`;
  if (seconds > w.max + 0.05) return `${model.name} takes up to ${w.max / 60} minutes of audio, and this is ${minutes(seconds)}: trim it first`;
  return null;
}

/** The picture a talking-avatar model animates: width ÷ height (fal's H3 Max lip sync: "between 0.4 and 2.5"). */
const PORTRAIT_RATIO: Record<string, [number, number]> = { "minimax-h3-max-lipsync": [0.4, 2.5] };

/** Why a picture `width`×`height` is too tall or wide for the model, or null. */
export function portraitShapeProblem(model: { id: string; name: string }, width: number, height: number): string | null {
  const r = PORTRAIT_RATIO[model.id];
  if (!r || !(width > 0) || !(height > 0)) return null;
  const shape = width / height;
  if (shape >= r[0] - 0.005 && shape <= r[1] + 0.005) return null;
  return `${model.name} takes pictures from ${r[0].toFixed(1)}:1 (tall) to ${r[1].toFixed(1)}:1 (wide), and this one is ${width}×${height}: crop it first`;
}

/**
 * Where a new moment may go inside a clip (fal's H3 Max insert: start_time 1.625–60 s, resume_time 2.625–60 s and after the
 * start), in Generate's words, or null. `clip` is the clip's length when known: both points must be inside it.
 */
export const INSERT_RANGE = { minStart: 1.625, minResume: 2.625, max: 60 } as const;
export function insertRangeProblem(start: number | undefined, resume: number | undefined, clip?: number): string | null {
  if (start === undefined || resume === undefined || !Number.isFinite(start) || !Number.isFinite(resume)) return "Mark where the new moment starts and where the clip picks up again";
  if (start < INSERT_RANGE.minStart - 1e-6) return `The new moment can start ${INSERT_RANGE.minStart} s into the clip at the earliest: move the first handle right`;
  if (resume <= start + 1e-6) return "The clip has to pick up again after the new moment starts: move the second handle right";
  if (resume < INSERT_RANGE.minResume - 1e-6) return `The clip can pick up again ${INSERT_RANGE.minResume} s in at the earliest: move the second handle right`;
  if (resume > INSERT_RANGE.max + 1e-6) return `Both points have to be within the first ${INSERT_RANGE.max} s of the clip: trim it first`;
  if (clip !== undefined && clip > 0 && resume > clip + 0.05) return `The clip is ${secs(clip)} long, so it can't pick up again at ${secs(resume)}: move the second handle left`;
  return null;
}

/** The insert range control's step: 1/8 s, so the earliest start (1.625 s) is one of its stops. */
export const INSERT_STEP = 0.125;

/**
 * The two handles of Edit video's "Insert a moment" range on a clip `clip` seconds long (unknown while its header is read): the
 * track runs from the earliest start to the clip's end (at most 60 s), and the handles keep to it, the start before the resume
 * by a step at least and the resume no earlier than 2.625 s, on 1/8 s stops. Without a value they open around the clip's middle.
 */
export function insertHandles(clip: number | undefined, value?: [number | undefined, number | undefined]): { min: number; max: number; start: number; resume: number } {
  const snap = (n: number) => Math.round(n / INSERT_STEP) * INSERT_STEP;
  const min = INSERT_RANGE.minStart;
  const max = Math.max(INSERT_RANGE.minResume, Math.floor(Math.min(INSERT_RANGE.max, clip && clip > 0 ? clip : INSERT_RANGE.max) / INSERT_STEP) * INSERT_STEP);
  const mid = clip && clip > 0 ? clip / 2 : min + 2;
  let start = snap(value?.[0] ?? mid - 0.5);
  start = Math.min(Math.max(min, start), max - INSERT_STEP);
  let resume = snap(value?.[1] ?? start + 1);
  resume = Math.min(Math.max(start + INSERT_STEP, INSERT_RANGE.minResume, resume), max);
  return { min, max, start, resume };
}

export function sourceSeconds(modelId: string): { min?: number; max?: number } {
  return SOURCE_SECONDS[modelId] ?? {};
}

/**
 * The frame a clip edit takes (Kling 4.0's edit, research part 4: 700–4553 px on each side, width ÷ height 0.40–2.50,
 * 23.9–60.05 fps).
 */
const SOURCE_FRAME: Record<string, { min: number; max: number; ratio: [number, number]; fps: [number, number] }> = {
  "kling-4": { min: 700, max: 4553, ratio: [0.4, 2.5], fps: [23.9, 60.05] },
};

/** Why a clip `width`×`height` is outside the sides or shape the model takes, in Generate's words, or null. */
export function clipSizeProblem(model: { id: string; name: string }, width: number, height: number): string | null {
  const s = SOURCE_FRAME[model.id];
  if (!s || !(width > 0) || !(height > 0)) return null;
  if (Math.min(width, height) < s.min) return `${model.name} needs a clip at least ${s.min} px on each side, and this one is ${width}×${height}: upscale it first or pick another model`;
  if (Math.max(width, height) > s.max) return `${model.name} takes clips up to ${s.max} px on a side, and this one is ${width}×${height}: scale it down first`;
  const r = width / height;
  if (r < s.ratio[0] - 0.005 || r > s.ratio[1] + 0.005) {
    return `${model.name} takes clips from ${s.ratio[0].toFixed(1)}:1 (tall) to ${s.ratio[1].toFixed(1)}:1 (wide), and this one is ${width}×${height}: crop it first`;
  }
  return null;
}

/** Why a clip at `fps` frames a second is outside the frame rates the model takes (Kling 4.0: 24–60 fps), or null. */
export function clipFpsProblem(model: { id: string; name: string }, fps: number): string | null {
  const s = SOURCE_FRAME[model.id];
  if (!s || !(fps > 0) || (fps >= s.fps[0] && fps <= s.fps[1])) return null;
  const range = `${Math.round(s.fps[0])}–${Math.round(s.fps[1])} fps`;
  return `${model.name} takes clips at ${range}, and this one is ${Math.round(fps * 100) / 100} fps: save it at ${fps < s.fps[0] ? Math.round(s.fps[0]) : Math.round(s.fps[1])} fps first`;
}

/** How long a clip given as one of the model's elements may be (Kling 4.0's video elements: 3–8 s). */
const ELEMENT_CLIP_SECONDS: Record<string, { min: number; max: number }> = { "kling-4": { min: 3, max: 8 } };

/** Why a clip element `seconds` long is outside what the model takes ("Kling 4.0 takes 3–8 s clips as elements…"), or null. */
export function elementClipProblem(model: { id: string; name: string }, seconds: number, name?: string): string | null {
  const w = ELEMENT_CLIP_SECONDS[model.id];
  if (!w || !(seconds > 0) || (seconds >= w.min - 0.05 && seconds <= w.max + 0.05)) return null;
  return `${model.name} takes ${w.min}–${w.max} s clips as elements, and ${name ? `${name}'s` : "this one"} is ${secs(seconds)}: trim it, or use its photos instead`;
}

/** The most reference clips an edit takes beside the clip it edits (Kling 4.0's edit: 4 video_urls, @Video2..). */
const EDIT_REFERENCE_CLIPS: Record<string, number> = { "kling-4": 4 };

/** Why `count` reference clips are more than the model's edit takes, or null. */
export function editClipsProblem(model: { id: string; name: string }, count: number): string | null {
  const max = EDIT_REFERENCE_CLIPS[model.id];
  if (max === undefined || count <= max) return null;
  return `${model.name}'s edit takes up to ${max} reference clips beside the clip you edit, and this run has ${count}: remove ${count - max}`;
}

/**
 * The most seconds of clips a run takes in all, where the model says (Kling 4.0: "the source, reference and element
 * videos must total at most 30s").
 */
const CLIP_TOTAL_SECONDS: Record<string, number> = { "kling-4": 30 };

/** Why clips `seconds` long in all are too long for the model ("Kling 4.0 takes 30 s of clips in all…"), or null. */
export function clipTotalProblem(model: { id: string; name: string }, seconds: number): string | null {
  const max = CLIP_TOTAL_SECONDS[model.id];
  if (max === undefined || seconds <= max + 0.05) return null;
  return `${model.name} takes ${max} s of clips in all (the clip you edit, reference clips and clip elements together), and these add up to ${secs(seconds)}: trim them first`;
}

/**
 * Cloud clip edits that keep every frame of a clip sent whole (Edit video, an API call): fal's Wan 2.2 Fun VACE depth
 * route (Fuobe Shorts, Evolution and Genjutsu Restyle in the cloud, match_input_num_frames on) takes 17–241 frames and
 * bills them ÷ 16 as "video seconds"; a clip whose rate isn't known counts as 30 fps (the fastest it works unhalved).
 * Their studios cut their own pieces (src/lib/catalog/shorts.ts) and say the seconds they bill. Cloud only: the GPU
 * graphs load the clip at 16 fps and keep to their own frame caps.
 */
const VACE_FRAMES = { minFrames: 17, maxFrames: 241, billFps: 16, assumeFps: 30 } as const;
type FrameWindow = { minFrames: number; maxFrames: number; billFps: number; assumeFps: number; studio: string };
const SOURCE_FRAMES: Record<string, FrameWindow> = {
  "fuobe-shorts": { ...VACE_FRAMES, studio: "Shorts" },
  "fuobe-evolution": { ...VACE_FRAMES, studio: "Video tools → Evolution" },
  "fuobe-genjutsu-restyle": { ...VACE_FRAMES, studio: "Genjutsu" },
};

/** The frame window and billing of a cloud clip edit that is billed by its frames, or undefined. */
export function sourceFrames(modelId: string, engine?: string): FrameWindow | undefined {
  return engine === "open" ? undefined : SOURCE_FRAMES[modelId];
}

/** The seconds a clip `seconds` long is billed for: its frames ÷ 16 on a frame-billed route, else its seconds. */
export function billedClipSeconds(modelId: string, seconds: number, fps?: number, engine?: string): number {
  const f = sourceFrames(modelId, engine);
  if (!f) return seconds;
  return Math.round(((seconds * (fps && fps > 0 ? fps : f.assumeFps)) / f.billFps) * 1e6) / 1e6;
}

const secs = (n: number) => `${Math.round(n * 10) / 10} s`;
const minutes = (n: number) => `${Math.floor(n / 60)} min ${Math.round(n % 60)} s`;

/**
 * Why a clip `seconds` long is outside the model's window, in Generate's words ("Happy Horse Video Edit takes 3–15 s
 * clips, and this one is 40 s: trim it first"), or null. A header's length can run a frame or so past the cut that
 * made it, so a few hundredths over are let through. A frame-billed cloud route counts the clip's frames at its rate
 * (`fps`, 30 when not known).
 */
export function clipWindowProblem(model: { id: string; name: string; engine?: string }, seconds: number, fps?: number): string | null {
  const f = sourceFrames(model.id, model.engine);
  if (f) {
    const rate = fps && fps > 0 ? fps : f.assumeFps;
    const frames = Math.round(seconds * rate);
    const at = `${Math.round(rate * 100) / 100} fps`;
    if (frames > f.maxFrames) return `${model.name} in the cloud takes up to ${f.maxFrames} frames (${secs(f.maxFrames / rate)} at ${at}), and this clip is ${secs(seconds)}: trim it first, or use ${f.studio}, which cuts a long clip into pieces`;
    if (frames < f.minFrames) return `${model.name} in the cloud needs at least ${f.minFrames} frames (${secs(f.minFrames / rate)} at ${at}), and this clip is ${secs(seconds)}: use a longer one`;
  }
  const { min, max } = sourceSeconds(model.id);
  const long = max !== undefined && seconds > max + 0.05;
  const short = min !== undefined && seconds < min - 0.05;
  if (!long && !short) return null;
  const takes = min !== undefined && max !== undefined ? `${min}–${max} s` : max !== undefined ? `up to ${max} s` : `${min} s or longer`;
  return `${model.name} takes ${takes} clips, and this one is ${secs(seconds)}: ${long ? "trim it first" : "use a longer one"}`;
}
