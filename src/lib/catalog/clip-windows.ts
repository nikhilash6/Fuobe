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
};

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

const secs = (n: number) => `${Math.round(n * 10) / 10} s`;

/**
 * Why a clip `seconds` long is outside the model's window, in Generate's words ("Happy Horse Video Edit takes 3–15 s
 * clips, and this one is 40 s: trim it first"), or null. A header's length can run a frame or so past the cut that
 * made it, so a few hundredths over are let through.
 */
export function clipWindowProblem(model: { id: string; name: string }, seconds: number): string | null {
  const { min, max } = sourceSeconds(model.id);
  const long = max !== undefined && seconds > max + 0.05;
  const short = min !== undefined && seconds < min - 0.05;
  if (!long && !short) return null;
  const takes = min !== undefined && max !== undefined ? `${min}–${max} s` : max !== undefined ? `up to ${max} s` : `${min} s or longer`;
  return `${model.name} takes ${takes} clips, and this one is ${secs(seconds)}: ${long ? "trim it first" : "use a longer one"}`;
}
