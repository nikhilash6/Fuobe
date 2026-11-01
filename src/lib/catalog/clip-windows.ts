/**
 * How long a clip each cloud clip-edit model takes (docs/research/paid-model-apis-3.md, "Input windows"): a clip
 * outside it is paid for and then refused by the provider, or (Happy Horse reads 3–60 s but returns at most the first
 * 15 s) billed for seconds that never come back. Shorts, Mixed Media and Edit video keep to it. No catalog import
 * here, so the composer can use it.
 */
const SOURCE_SECONDS: Record<string, { min?: number; max?: number }> = {
  "kling-o3-4k-edit": { min: 3, max: 15 },
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
