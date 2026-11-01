/**
 * Video tools → Remove object: say what goes by typing it ("the coffee cup"), clicking it on the first
 * frame, or painting over it. Higgsfield runs this as Edit Video with a removal prompt on Kling O3 Omni;
 * Fuobe adds Bria's clicked / masked eraser, VOID for shadows and reflections, and the open engine's
 * SAM 3.1 + Wan 2.1 VACE (or VOID) graphs.
 *
 * Every eraser takes a short clip (Bria under 5 s, Kling 3–15 s, VOID 197 frames, the open graphs 81 or
 * 197 frames per window), so longer clips are cut into pieces, erased and joined, and the clip's own sound
 * is put back. Pure module (erasers per engine and mode, pieces and windows, prompts, the pipeline's steps),
 * shared by the page, the server (src/server/remove-object.ts) and the tests.
 * Research: docs/research/higgsfield-delta-4.md §4.1, paid-model-apis-4.md §3 and §10, comfyui-oss-4.md §b.
 */
import { h3Canvas } from "./character-swap";
import { joinGroups, type PlanStep } from "./shorts";
import type { ChainSlot, Engine, GenerationRequest, PixelPoint } from "./types";

export type RemoveMode = "type" | "click" | "paint";

export const REMOVE = {
  feature: "remove-object",
  /** Cuts, mask tracks, joins and the sound: kept apart from the finished videos. */
  stepFeature: "remove-object-step",
  /** The mask preview (what the engine would remove from the first seconds). */
  previewFeature: "remove-object-preview",
  minSeconds: 0.5,
  maxSeconds: 60,
  maxBytes: 200 * 1024 * 1024,
  /** Seconds the mask preview looks at. */
  previewSeconds: 2,
  maxPoints: 12,
  /** What you type: Kling O3 edit takes prompts of up to 2500 characters, and klingPrompt() adds up to 52. */
  maxPromptChars: 2400,
  accept: "video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm",
} as const;

export const REMOVE_MODES: { id: RemoveMode; label: string; hint: string }[] = [
  { id: "type", label: "Type it", hint: "Name what to remove" },
  { id: "click", label: "Click it", hint: "Click it on the first frame" },
  { id: "paint", label: "Paint it", hint: "Brush over it on the first frame" },
];

/** Higgsfield's two example prompts (verbatim) and two short ones. */
export const REMOVE_EXAMPLES: { label: string; prompt: string }[] = [
  { label: "The coffee cup", prompt: "Remove the coffee cup from her hands and fix her fingers so they're just resting naturally, keep everything else the same." },
  {
    label: "The pogo stick",
    prompt:
      "Remove the pogo stick the guy is bouncing on, including the black handle grips in his hands and the platform under his feet, plus its shadow on the ground — make him just jump in the air, and fill in the patio behind it.",
  },
  { label: "People in the background", prompt: "the people walking in the background" },
  { label: "A logo", prompt: "the logo in the corner" },
];

// ---------------------------------------------------------------------------
// Erasers

export interface Eraser {
  /** The catalog model. */
  id: string;
  engine: Engine;
  /** How you can point at the object with it. */
  modes: RemoveMode[];
  label: string;
  /** One line for the picker: what it's good at, its limits, and (open) the GPU and licence. */
  note: string;
  /** Cloud: the longest piece one call takes, in seconds (longer clips are cut, erased and joined). */
  maxSeconds?: number;
  /** The shortest clip it takes, in seconds. */
  minSeconds?: number;
  /**
   * Routes that count frames: one job per window of whole frames, at most `cap`, `step`·n + `base` frames. Open: the
   * graph reads its own window (VACE 4n+1 ≤ 81, VOID 8n+5 ≤ 197); cloud: the clip is cut on those frames and the route
   * is told exactly that many (fal's VOID snaps num_frames to 69, 77 … 197; LTX renders 8n+1).
   */
  window?: FrameWindow;
  /** The highest frame rate it renders at (LTX Clean Plate: 60). */
  maxFps?: number;
  /** The result carries the piece's own sound (otherwise the clip's sound is put back). */
  keepsSound: boolean;
  /** Also removes what the object causes: shadows, reflections, things it moves. */
  effects?: boolean;
  /** Removes every person; nothing to point at. */
  everyone?: boolean;
  /** Each side of the picture must be within this many pixels (Kling O3 edit: 720–3840). */
  sides?: { min: number; max: number };
  /**
   * Removes a person you name, starting from a clean first frame (the person already gone, made by an image edit) on a
   * clip fitted to 24 fps on the 32-pixel grid: H3 Relay's Person Removal (Akatz Labs' Person Remover LoRA).
   */
  cleanFrame?: boolean;
}

/**
 * Windows of `step`·n + `base` frames, at most `cap`. `overlap`: each window after the first starts on the last
 * `overlap` frames of the one before (dropped again before the join).
 */
export interface FrameWindow {
  cap: number;
  step: number;
  base: number;
  /** The fewest frames a window may have (fal's VOID: 69); `base` when unset. */
  min?: number;
  overlap?: number;
}

export const VACE_WINDOW: FrameWindow = { cap: 81, step: 4, base: 1 };
/**
 * The painted eraser hands on the tracked mask of a window's last frame, and a mask must be of the window's first
 * frame: so each window starts on the last frame of the one before (a one-frame overlap, cut off before the join).
 */
const VACE_PAINTED_WINDOW: FrameWindow = { ...VACE_WINDOW, overlap: 1 };
const VOID_WINDOW: FrameWindow = { cap: 197, step: 8, base: 5 };
/** fal's VOID snaps num_frames to the nearest of 69, 77 … 197 (paid-model-apis-4.json): pieces are exactly one of them. */
const VOID_CLOUD_WINDOW: FrameWindow = { cap: 197, step: 8, base: 5, min: 69 };
/**
 * LTX 2.3 renders 8n+1 frames (9–481), and at 720p its IC-LoRA budget ("w × h × frames") is "roughly 6 s" at the
 * route's 24 fps, about 144 frames, above which it answers 422: pieces of up to 137 frames stay under it at any rate.
 */
const LTX_WINDOW: FrameWindow = { cap: 137, step: 8, base: 1, min: 9 };
/** Bria's erasers take clips "shorter than 5 s": pieces stay a little under. */
const BRIA_PIECE = 4.8;

export const ERASERS: Eraser[] = [
  // Cloud (docs/research/paid-model-apis-4.md §3).
  {
    id: "kling-o3",
    engine: "cloud",
    modes: ["type"],
    label: "Kling O3 Omni edit",
    note: "3–15 s per piece · sound kept",
    maxSeconds: 15,
    minSeconds: 3,
    keepsSound: true,
    sides: { min: 720, max: 3840 },
  },
  {
    id: "kling-o3-4k-edit",
    engine: "cloud",
    modes: ["type"],
    label: "Kling O3 4K edit",
    note: "The same edit rendered in 4K · 3–15 s per piece · sound kept",
    maxSeconds: 15,
    minSeconds: 3,
    keepsSound: true,
    sides: { min: 720, max: 3840 },
  },
  { id: "bria-video-erase", engine: "cloud", modes: ["type"], label: "Bria Video Eraser", note: "Finds what you name · pieces under 5 s · sound kept", maxSeconds: BRIA_PIECE, keepsSound: true },
  {
    id: "void-video-inpainting",
    engine: "cloud",
    modes: ["type"],
    label: "VOID",
    note: "Also removes its shadows and reflections · 69–197 frames per piece",
    window: VOID_CLOUD_WINDOW,
    keepsSound: false,
    effects: true,
  },
  {
    id: "ltx-2-3-clean-plate",
    engine: "cloud",
    modes: ["type"],
    label: "LTX 2.3 Clean Plate",
    note: "Removes every person — no words needed · up to 137 frames per piece at 720p",
    window: LTX_WINDOW,
    maxFps: 60,
    keepsSound: false,
    everyone: true,
  },
  { id: "bria-video-erase-points", engine: "cloud", modes: ["click"], label: "Bria Video Eraser", note: "Erases what you click · SAM 3.1 follows it through clips over 5 s", maxSeconds: BRIA_PIECE, keepsSound: true },
  { id: "bria-video-erase-mask", engine: "cloud", modes: ["paint"], label: "Bria Video Eraser", note: "SAM 3.1 follows what you painted, Bria erases it · sound kept", maxSeconds: BRIA_PIECE, keepsSound: true },
  // Open (docs/research/comfyui-oss-4.md §b; workflows/comfyui/manifest.json).
  {
    id: "oss-vace-remove",
    engine: "open",
    modes: ["type"],
    label: "Wan 2.1 VACE + SAM 3.1",
    note: "Only the object's area changes · 24 GB GPU · Apache-2.0",
    window: VACE_WINDOW,
    keepsSound: true,
  },
  {
    id: "oss-vace-remove-painted",
    engine: "open",
    modes: ["paint"],
    label: "Wan 2.1 VACE + SAM 3.1",
    note: "SAM 3.1 follows what you painted · 24 GB GPU · Apache-2.0",
    window: VACE_PAINTED_WINDOW,
    keepsSound: true,
  },
  {
    id: "oss-h3-person-remove",
    engine: "open",
    modes: ["type"],
    label: "H3 Person Removal",
    note: "People only: a clean first frame first, then MiniMax H3 with Akatz Labs' Person Remover LoRA rebuilds what was behind them · 24 GB GPU with offloading · MiniMax H3 Community License",
    keepsSound: false,
    cleanFrame: true,
  },
  {
    id: "oss-void-remove",
    engine: "open",
    modes: ["type"],
    label: "VOID",
    note: "Also removes shadows and reflections · 24–40 GB GPU · CogVideoX License: commercial use needs registration",
    window: VOID_WINDOW,
    keepsSound: true,
    effects: true,
  },
];

export const getEraser = (id: string | undefined) => ERASERS.find((e) => e.id === id);

/** The default eraser for a way of pointing (and "shadows and reflections too"), per engine. */
const DEFAULT_ERASER: Record<Engine, Partial<Record<RemoveMode | "effects", string>>> = {
  cloud: { type: "kling-o3", effects: "void-video-inpainting", click: "bria-video-erase-points", paint: "bria-video-erase-mask" },
  open: { type: "oss-vace-remove", effects: "oss-void-remove", paint: "oss-vace-remove-painted" },
};

/** The SAM 3.1 tracker that turns clicks or paint into a mask video (cloud). */
export const MASK_TRACKER = "sam-3-1-video-mask";

/** What the helpers of the pipeline run on, per engine. */
export const REMOVE_TOOLS = {
  cloud: { cut: "trim-video", join: "join-clips", mux: "merge-audio-video", joinMax: 24, preview: MASK_TRACKER },
  open: { cut: "oss-trim", join: "oss-join-clips", mux: "oss-mux", joinMax: 4, preview: "oss-video-matte-sam3" },
} as const;

/** What fills the gap when nobody describes it (the open graphs' scene prompt; fal's VOID route sends the same default). */
export const REMOVE_SCENE = "The same shot with nothing there: the background continues naturally, matching the light, texture and motion around it";

export const CLICK_OPEN_PROBLEM = "Clicking works on the cloud engine. On your ComfyUI, type what to remove or paint over it";

/**
 * params.extra key: this painted window hands its last tracked mask on to the next one, so the comfyui provider keeps
 * the graph's mask output (role "mask"); without it that output isn't saved.
 */
export const HAND_OFF = "handOffMask";

/** The erasers you can pick for this engine and way of pointing (the effects one only when typing). */
export function erasersFor(engine: Engine, mode: RemoveMode): Eraser[] {
  return ERASERS.filter((e) => e.engine === engine && e.modes.includes(mode));
}

/**
 * The eraser a request runs on, or why there is none. `offered` (Settings → Models & licences) passes over an
 * eraser switched off for the next one that does the job and is on; with none on, the default stays and its run
 * names the switch.
 */
export function chooseEraser(o: { engine: Engine; mode: RemoveMode; effects?: boolean; modelId?: string; offered?: (id: string) => boolean }): { eraser: Eraser } | { problem: string } {
  if (o.engine === "open" && o.mode === "click") return { problem: CLICK_OPEN_PROBLEM };
  if (o.effects && o.mode !== "type") return { problem: "Shadows and reflections go too when you type what to remove — switch to Type it" };
  const on = o.offered ?? (() => true);
  const fits = (e: Eraser | undefined): e is Eraser => !!e && e.engine === o.engine && e.modes.includes(o.mode) && (!o.effects || !!e.effects);
  const picked = getEraser(o.modelId);
  if (fits(picked) && on(picked.id)) return { eraser: picked };
  const id = DEFAULT_ERASER[o.engine][o.effects ? "effects" : o.mode];
  const eraser = getEraser(id);
  if (!eraser) return { problem: "Nothing on this engine removes objects that way yet" };
  return { eraser: [eraser, ...erasersFor(o.engine, o.mode)].find((e) => fits(e) && on(e.id)) ?? eraser };
}

// ---------------------------------------------------------------------------
// Words

const VERB = /^\s*(?:please\s+)?(?:remove|erase|delete|get rid of|take out|cut out|clean up|wipe out|wipe)\s+/i;

/** Where the objects end and the instructions start: a sentence break, a dash, or a clause such as "… so she…". */
const LIST_END = /[.;:!?—–(]|\s-\s|\s+(?:so|then|while|but|keep|keeping|leaving|to make|make)\s+/i;
/** Between two objects: commas, "and", "plus", "including"… */
const LIST_SPLIT = /\s*,\s*(?:and\s+|plus\s+|also\s+)?|\s+(?:and|plus|&|as well as|along with|together with|including)\s+/i;
/** A part that starts with one of these is an instruction ("…and fix her fingers"), not another object. */
const INSTRUCTION = /^(?:keep|make|fix|fill|leave|replace|put|add|let|change|turn|show|restore|blur|paint|extend|move|have|ensure|don't|do|use|give|repair|smooth|cover|continue|preserve|retain|maintain|adjust|clean|reconstruct|inpaint)\b/i;
/** A part that starts like this describes the object before it ("the man in red, on the left"). */
const CONTINUES = /^(?:on|at|in|near|behind|under|above|below|beside|next to|by|with|without|inside|outside|over|across|along|around|who|which|that|wearing|holding|carrying|sitting|standing|walking|running)\b/i;
/** Two colours joined by "and" are one object's look ("the black and white dog"), not two objects. */
const COLOUR = "black|white|red|green|blue|yellow|orange|purple|pink|brown|grey|gray|silver|gold|golden|beige|dark|light|navy|teal";
const COLOUR_PAIR = new RegExp(`\\b(${COLOUR})\\s+and\\s+(${COLOUR})\\b`, "gi");
const JOINED = "\u0001";
const TARGET_MAX = 160;

/**
 * What to remove, for a segmenter or an eraser that finds things by name (SAM 3.1, Bria, VOID's mask prompt):
 * the objects alone, comma-separated, which SAM 3.1 (fal) and ComfyUI's SAM 3 text encoder each track as their own
 * prompt. "Remove the coffee cup from her hands and fix her fingers…" → "the coffee cup"; "the logo and the
 * watermark" → "the logo, the watermark". Applying it again changes nothing.
 */
export function targetPhrase(text: string): string {
  const t = text.trim().replace(VERB, "").replace(COLOUR_PAIR, `$1${JOINED}$2`);
  const end = t.search(LIST_END);
  const phrases: string[] = [];
  const list = (end > 0 ? t.slice(0, end) : t).replace(/(?:\s*,|\s+(?:and|plus|also|&))+\s*$/i, "");
  for (const raw of list.split(LIST_SPLIT)) {
    let part = raw.replaceAll(JOINED, " and ").trim().replace(/^(?:and|plus|also|including)\s+/i, "").replace(VERB, "");
    if (!part) continue;
    if (INSTRUCTION.test(part)) break;
    // The object, not where it is in the clip ("the cup from her hands", "the logo from the video").
    const from = part.search(/(?:^|\s+)(?:from|out of)\s+|(?:^|\s+)in\s+@video\d*/i);
    if (from >= 0) part = part.slice(0, from);
    part = part.replace(/\s+(?:from|in|out of)\s+(?:the\s+)?(?:video|clip|shot|footage|frame)$/i, "").trim();
    if (!part) continue;
    if (CONTINUES.test(part) && phrases.length) phrases[phrases.length - 1] += ` ${part}`;
    else if (!phrases.some((p) => p.toLowerCase() === part.toLowerCase())) phrases.push(part);
  }
  let out = "";
  for (const p of phrases) {
    const next = out ? `${out}, ${p}` : p;
    if (next.length > TARGET_MAX) break;
    out = next;
  }
  return (out || phrases[0] || text.trim()).slice(0, TARGET_MAX);
}

/**
 * Kling O3's edit prompt: Higgsfield's "Remove {X} from @Video1, keep everything else the same" for a
 * named object; an instruction the user wrote ("Remove the cup and fix her fingers…") is kept, pointed at
 * @Video1 and told to leave the rest alone.
 */
export function klingPrompt(text: string): string {
  const t = text.trim().replace(/[.\s]+$/, "");
  if (!VERB.test(t)) return `Remove ${t} from @Video1, keep everything else the same.`;
  const keep = /keep everything else|everything else (?:stays|unchanged)/i.test(t) ? "" : ", keep everything else the same";
  return `${/@video1/i.test(t) ? "" : "In @Video1: "}${t}${keep}.`;
}

/** A short name for the result ("Remove · the coffee cup"). */
export function removalTitle(o: { mode: RemoveMode; prompt?: string; everyone?: boolean }): string {
  if (o.everyone) return "Remove · every person";
  if (o.mode === "type" && o.prompt?.trim()) {
    const p = targetPhrase(o.prompt);
    return `Remove · ${p.length > 60 ? `${p.slice(0, 57)}…` : p}`;
  }
  return o.mode === "click" ? "Remove · the clicked object" : "Remove · the painted object";
}

// ---------------------------------------------------------------------------
// Pieces and windows

export interface RemoveRange {
  start: number;
  end: number;
}

export interface Piece {
  index: number;
  /** Seconds in the source clip. */
  start: number;
  end: number;
  /** Open: the window's exact frame count, and the window as the graph reads it (startTime, endTime). */
  frames?: number;
  startTime?: number;
  endTime?: number;
  /** Open: frames at the window's start that the window before already made (cut off before the join). */
  skip?: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Split `total` frames into windows of `step`·n + `base` frames, each at most `cap`, as even as possible
 * (the fewest windows that fit). The windows cover all but fewer than `step` frames at the end; with an
 * overlap, each window after the first also reads the last `overlap` frames of the one before.
 */
export function frameWindows(total: number, w: FrameWindow): number[] {
  if (total < (w.min ?? w.base)) return [];
  const o = w.overlap ?? 0;
  const k = Math.max(1, Math.ceil((total - o) / (w.cap - o)));
  const units = Math.floor((total + (k - 1) * o - k * w.base) / w.step);
  if (units < 0) return [];
  const each = Math.floor(units / k);
  const extra = units % k;
  return Array.from({ length: k }, (_, i) => w.step * (each + (i < extra ? 1 : 0)) + w.base);
}

/**
 * Open engine: windows on whole frames at the clip's own rate, back to back (or overlapping by `overlap`
 * frames, which are cut off again), so the joined clip has exactly the range's frames (less fewer than
 * `step` at the end) and stays on the original sound. Each window is read from `(f − ¼)/fps` for `n/fps`
 * seconds: the graph's Video Slice then decodes exactly frames f … f + n − 1, and a trim from
 * `(skip − ¼)/fps` drops exactly `skip` frames (both run on the live ComfyUI with 24, 29.97 and 30 fps clips).
 */
export function planWindows(range: RemoveRange, fps: number, w: FrameWindow): Piece[] {
  const first = Math.round(range.start * fps);
  const total = Math.floor((range.end - range.start) * fps + 1e-6);
  let at = first;
  return frameWindows(total, w).map((frames, index) => {
    const skip = index > 0 ? (w.overlap ?? 0) : 0;
    const from = at - skip;
    const startTime = Math.max(0, (from - 0.25) / fps);
    const piece: Piece = { index, start: r3(at / fps), end: r3((from + frames) / fps), frames, startTime: r6(startTime), endTime: r6(startTime + frames / fps) };
    if (skip) piece.skip = skip;
    at = from + frames;
    return piece;
  });
}

/**
 * Cloud routes that count frames (VOID, LTX Clean Plate): cuts on whole frames, back to back, each exactly one
 * window long, so the route is told the piece's own frame count (nothing for it to snap, pad or drop) and the
 * joined clip has exactly the range's frames (less fewer than `step` at the end).
 */
export function planFrameCuts(range: RemoveRange, fps: number, w: FrameWindow): Piece[] {
  const total = Math.floor((range.end - range.start) * fps + 1e-6);
  let at = Math.round(range.start * fps);
  return frameWindows(total, w).map((frames, index) => {
    const piece: Piece = { index, start: r6(at / fps), end: r6((at + frames) / fps), frames };
    at += frames;
    return piece;
  });
}

/**
 * Cloud: equal pieces of at most `max` seconds (on whole frames when the rate is known), so no piece is
 * a sliver (14 s for Bria → three 4.67 s pieces, not two of 4.8 s and one of 4.4 s… or a 0.4 s one).
 */
export function planCloudPieces(range: RemoveRange, max: number, fps?: number): Piece[] {
  const len = range.end - range.start;
  const n = Math.max(1, Math.ceil(len / max - 1e-9));
  const edge = (i: number) => {
    if (i === n) return range.end;
    const t = range.start + (len * i) / n;
    return fps ? Math.round(t * fps) / fps : t;
  };
  return Array.from({ length: n }, (_, i) => ({ index: i, start: r3(edge(i)), end: r3(edge(i + 1)) }));
}

/** The longest piece a cloud eraser takes for this clip. */
export function pieceSeconds(e: Eraser, fps?: number): number {
  const byFrames = e.window ? e.window.cap / (fps && fps > 0 ? fps : 24) : Infinity;
  return Math.min(e.maxSeconds ?? Infinity, byFrames);
}

export interface RemoveSource {
  url: string;
  duration?: number;
  fps?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
}

/** What's wrong with a selection whatever the eraser, or null. */
export function rangeProblem(source: Pick<RemoveSource, "duration">, range: RemoveRange): string | null {
  const len = range.end - range.start;
  if (!(len > 0) || range.start < 0) return "Pick a part of the clip";
  if (source.duration !== undefined && range.end > source.duration + 0.05) return "The selection runs past the end of the clip";
  if (len < REMOVE.minSeconds - 0.01) return `Select at least ${REMOVE.minSeconds} s`;
  if (len > REMOVE.maxSeconds + 0.05) return `Select up to ${REMOVE.maxSeconds} s — longer clips cost a lot and take long; trim them in Video tools → Trim`;
  return null;
}

/** Why this eraser can't take this clip (or range), or null. */
export function removalProblem(e: Eraser, source: RemoveSource, range: RemoveRange): string | null {
  const general = rangeProblem(source, range);
  if (general) return general;
  const len = range.end - range.start;
  const name = e.label;
  if (e.minSeconds && len < e.minSeconds - 0.01) return `${name} needs at least ${e.minSeconds} s — ${e.engine === "cloud" ? "Bria Video Eraser takes shorter clips" : "select more"}`;
  if (e.sides && source.width && source.height) {
    const lo = Math.min(source.width, source.height);
    const hi = Math.max(source.width, source.height);
    if (lo < e.sides.min) return `${name} needs a clip at least ${e.sides.min} px on each side (this one is ${source.width}×${source.height}) — Bria Video Eraser takes smaller ones`;
    if (hi > e.sides.max) return `${name} takes clips up to ${e.sides.max} px on a side (this one is ${source.width}×${source.height})`;
  }
  if (e.window) {
    if (!source.fps) return "Couldn't read this clip's frame rate — save it as an MP4 (H.264) and try again";
    const min = e.window.min ?? e.window.base;
    if (Math.floor(len * source.fps + 1e-6) < min) {
      if (min === e.window.base) return "Select a little more of the clip";
      return `${name} needs at least ${min} frames (${(Math.ceil((min / source.fps) * 10) / 10).toFixed(1)} s of this clip) — select more${e.effects ? ", or turn off Shadows and reflections" : ""}`;
    }
  }
  if (e.maxFps && source.fps && source.fps > e.maxFps + 0.01) return `${name} renders up to ${e.maxFps} fps (this clip is ${Math.round(source.fps)} fps) — pick another eraser`;
  return null;
}

/** The pieces a clip is erased in: windows on the open engine, equal cuts on the cloud. */
export function planPieces(e: Eraser, source: RemoveSource, range: RemoveRange): Piece[] {
  if (e.window) return !source.fps ? [] : e.engine === "open" ? planWindows(range, source.fps, e.window) : planFrameCuts(range, source.fps, e.window);
  return planCloudPieces(range, pieceSeconds(e, source.fps), source.fps);
}

/** Whether the range is the whole clip (then the upload itself is the piece, and carries the sound). */
export function wholeClip(range: RemoveRange, duration?: number): boolean {
  return range.start <= 0.05 && duration !== undefined && range.end >= duration - 0.05;
}

// ---------------------------------------------------------------------------
// Painted masks → points for SAM 3.1 (cloud)

/**
 * Up to `max` points well inside a painted mask (`on[i]` true = painted, `width` × `height`), in its own
 * pixels: the deepest point of the paint, then the deepest one away from it, and so on. SAM 3.1 tracks
 * the object under them (fal's tracker takes points or boxes, not a painted mask).
 */
export function paintedPoints(on: ArrayLike<number | boolean>, width: number, height: number, max = 3): PixelPoint[] {
  const cell = Math.max(1, Math.ceil(Math.max(width, height) / 96));
  const gw = Math.ceil(width / cell);
  const gh = Math.ceil(height / cell);
  // A grid cell is paint when at least half its pixels are.
  const grid = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let n = 0;
      let k = 0;
      for (let y = gy * cell; y < Math.min(height, (gy + 1) * cell); y++) {
        for (let x = gx * cell; x < Math.min(width, (gx + 1) * cell); x++) {
          n++;
          if (on[y * width + x]) k++;
        }
      }
      grid[gy * gw + gx] = n && k * 2 >= n ? 1 : 0;
    }
  }
  // Chamfer distance to the nearest unpainted cell (or the edge).
  const INF = 1e9;
  const d = new Float64Array(gw * gh);
  for (let i = 0; i < d.length; i++) d[i] = grid[i] ? INF : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= gw || y >= gh ? 0 : d[y * gw + x]);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      if (d[i]) d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.4, at(x + 1, y - 1) + 1.4);
    }
  for (let y = gh - 1; y >= 0; y--)
    for (let x = gw - 1; x >= 0; x--) {
      const i = y * gw + x;
      if (d[i]) d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.4, at(x - 1, y + 1) + 1.4);
    }
  const points: PixelPoint[] = [];
  const left = Float64Array.from(d);
  for (let p = 0; p < max; p++) {
    let best = -1;
    for (let i = 0; i < left.length; i++) if (left[i] > 0 && (best < 0 || left[i] > left[best])) best = i;
    if (best < 0 || (points.length && left[best] < 1)) break;
    const bx = best % gw;
    const by = Math.floor(best / gw);
    points.push({ x: Math.min(width - 1, Math.round((bx + 0.5) * cell)), y: Math.min(height - 1, Math.round((by + 0.5) * cell)), label: "positive" });
    // The next point is found away from this one (beyond the paint's thickness here).
    const r = Math.max(2, d[best] * 2);
    for (let y = Math.max(0, Math.floor(by - r)); y <= Math.min(gh - 1, Math.ceil(by + r)); y++)
      for (let x = Math.max(0, Math.floor(bx - r)); x <= Math.min(gw - 1, Math.ceil(bx + r)); x++) if ((x - bx) ** 2 + (y - by) ** 2 <= r * r) left[y * gw + x] = 0;
  }
  return points;
}

/** Points from one picture's pixels to another size (the first frame the browser showed → the clip's own size). */
export function scalePoints(points: PixelPoint[], from: { width: number; height: number }, to: { width: number; height: number }): PixelPoint[] {
  const kx = to.width / from.width;
  const ky = to.height / from.height;
  return points.map((p) => ({ ...p, x: Math.round(Math.min(to.width - 1, Math.max(0, p.x * kx))), y: Math.round(Math.min(to.height - 1, Math.max(0, p.y * ky))) }));
}

// ---------------------------------------------------------------------------
// The pipeline: steps for createPipeline (src/server/chains.ts)

export interface RemovalPlanInput {
  engine: Engine;
  mode: RemoveMode;
  eraser: Eraser;
  title: string;
  source: RemoveSource;
  range: RemoveRange;
  /** Type it: the user's words. */
  prompt?: string;
  /** Click it: points on the range's first frame, in the clip's pixels (paint on the cloud: points found in the paint). */
  points?: PixelPoint[];
  /** Paint it: the mask of the range's first frame (white = remove). */
  mask?: string;
  seed?: number;
}

export interface RemovalPlan {
  steps: PlanStep[];
  /** The finished video's step. */
  final: string;
  pieces: Piece[];
  /** Whether the clip's own sound is put back on the joined result. */
  sound: boolean;
  /** Cloud clicks and paint: a SAM 3.1 track of the whole range first. */
  tracked: boolean;
}

const pieceLabel = (p: Piece, n: number, what: string) => ({ label: n > 1 ? `Piece ${p.index + 1} of ${n} · ${what}` : what[0].toUpperCase() + what.slice(1), index: p.index, of: n });
const seconds = (p: Piece) => r3(p.end - p.start);

/** What the eraser step reads: the words, the clicks or the paint, in its own terms. */
function eraseRequest(input: RemovalPlanInput, p: Piece): Partial<GenerationRequest> {
  const e = input.eraser;
  const seed = input.seed !== undefined ? { seed: input.seed } : {};
  const fps = input.source.fps ? { fps: input.source.fps } : {};
  if (e.engine === "open") {
    // The graph reads its own window; the words name what SAM 3.1 tracks (the provider makes them maskPrompt).
    return {
      prompt: e.modes.includes("type") ? targetPhrase(input.prompt ?? "") : undefined,
      params: { startTime: p.startTime, endTime: p.endTime, ...seed },
    };
  }
  // Seconds price per-second models; frame-count routes (VOID, LTX) read the piece's length and the clip's rate,
  // which give exactly its own frame count.
  const secs = p.frames && input.source.fps ? r6(p.frames / input.source.fps) : seconds(p);
  const len = { duration: secs, sourceDuration: secs, ...fps };
  if (e.id === "kling-o3" || e.id === "kling-o3-4k-edit") return { prompt: klingPrompt(input.prompt ?? ""), params: { ...len, ...seed } };
  // LTX's frame budget (LTX_WINDOW) is the 720p one.
  if (e.everyone) return { params: { ...len, resolution: "720p", generateAudio: false, ...seed } };
  if (e.modes.includes("type")) return { prompt: targetPhrase(input.prompt ?? ""), params: { ...len, ...seed } };
  // Bria's clicked eraser reads the points itself; the masked one gets SAM 3.1's track.
  return { params: { ...len, ...(e.id === "bria-video-erase-points" ? { points: input.points } : {}), ...seed } };
}

/**
 * The whole job, as steps for createPipeline:
 * - open: one window per job straight from the upload (the graph cuts its own window), the painted eraser
 *   handing the tracked object on from window to window (its last frame's mask);
 * - cloud: the range cut into pieces (trim), each erased; clicks and paint are first tracked by SAM 3.1 over
 *   the whole range, and the track is cut like the clip, so Bria gets a mask video for every piece;
 * - then the pieces are joined (folded when the join takes fewer clips) and the clip's own sound put back.
 */
export function planRemoval(input: RemovalPlanInput): RemovalPlan {
  if (input.eraser.cleanFrame) return planPersonRemoval(input);
  const e = input.eraser;
  const t = REMOVE_TOOLS[input.engine];
  const pieces = planPieces(e, input.source, input.range);
  if (!pieces.length) throw new Error(removalProblem(e, input.source, input.range) ?? "Select a little more of the clip");
  const n = pieces.length;
  const whole = wholeClip(input.range, input.source.duration);
  const base = { feature: REMOVE.feature, batchTitle: input.title };
  const helper = { feature: REMOVE.stepFeature, batchTitle: input.title };
  const steps: PlanStep[] = [];
  const op = "remove-object" as const;
  const tracked = e.engine === "cloud" && (e.id === "bria-video-erase-mask" || (e.id === "bria-video-erase-points" && n > 1));
  const sound = !!input.source.hasAudio && (n > 1 || !e.keepsSound);
  const eraseFeature = (one: boolean) => (one && !sound ? { ...base, title: input.title } : helper);

  // What each piece's join input is: its erased window, or (an overlapping window) the window less its first frames.
  const joined = pieces.map((_, i) => `erase${i}`);
  if (e.engine === "open") {
    pieces.forEach((p, i) => {
      const own = eraseRequest(input, p);
      const painted = e.modes.includes("paint");
      // Only a window another one waits on saves its last tracked mask (else it would show up as a second result).
      const handOff = painted && i < n - 1;
      steps.push({
        key: `erase${i}`,
        request: {
          ...eraseFeature(n === 1),
          modelId: e.id,
          op,
          ...own,
          ...(handOff ? { params: { ...own.params, extra: { [HAND_OFF]: true } } } : {}),
          inputs: { video: input.source.url, ...(painted && i === 0 && input.mask ? { mask: input.mask } : {}) },
          step: pieceLabel(p, n, "erase"),
        },
        // The painted eraser starts each window from where the last one left the object.
        ...(painted && i > 0 ? { after: [`erase${i - 1}`], chain: [{ slot: "mask" as const }] } : {}),
      });
      if (p.skip && input.source.fps) {
        // The frames the window before already made are cut off (a trim from (skip − ¼)/fps keeps the rest).
        steps.push({
          key: `keep${i}`,
          request: { ...helper, modelId: t.cut, op: "trim", params: { startTime: r6((p.skip - 0.25) / input.source.fps) }, step: pieceLabel(p, n, "drop the overlap") },
          after: [`erase${i}`],
          chain: [{ slot: "video" }],
        });
        joined[i] = `keep${i}`;
      }
    });
  } else {
    // The range itself, when SAM 3.1 has to see it from its first frame (the clicks and paint are on it).
    const cutRange = tracked && !whole;
    if (cutRange) {
      steps.push({ key: "range", request: { ...helper, modelId: t.cut, op: "trim", inputs: { video: input.source.url }, params: { startTime: input.range.start, endTime: input.range.end }, step: { label: "Cut the selection", index: 0, of: 1 } } });
    }
    if (tracked) {
      const len = r3(input.range.end - input.range.start);
      steps.push({
        key: "track",
        request: {
          ...helper,
          modelId: MASK_TRACKER,
          op: "bg-remove-video",
          ...(cutRange ? {} : { inputs: { video: input.source.url } }),
          params: { points: input.points, duration: len },
          step: { label: "Follow the object (SAM 3.1)", index: 0, of: 1 },
        },
        ...(cutRange ? { after: ["range"], chain: [{ slot: "video" as const }] } : {}),
      });
    }
    pieces.forEach((p, i) => {
      // One piece that is the whole upload: read as it is (a frame-count route's piece only when it is every frame,
      // else it is cut to its frames, so the route gets exactly what it is told whether it reads num_frames as the
      // length or as its window).
      const one = n === 1 && whole && (!p.frames || p.end >= (input.source.duration ?? 0) - 0.05);
      const own = eraseRequest(input, p);
      const after: string[] = [];
      const chain: ChainSlot[] = [];
      if (n === 1 && cutRange) {
        // One piece: the selection already cut for SAM 3.1 is the piece.
        after.push("range");
        chain.push({ slot: "video" });
      } else if (!one) {
        steps.push({ key: `cut${i}`, request: { ...helper, modelId: t.cut, op: "trim", inputs: { video: input.source.url }, params: { startTime: p.start, endTime: p.end }, step: pieceLabel(p, n, "cut") } });
        after.push(`cut${i}`);
        chain.push({ slot: "video" });
      }
      if (tracked) {
        // The track starts at the range's start: its piece is cut at the same place, relative to it.
        if (n > 1) {
          const at = { startTime: r3(p.start - input.range.start), endTime: r3(p.end - input.range.start) };
          steps.push({ key: `mcut${i}`, request: { ...helper, modelId: t.cut, op: "trim", params: at, step: pieceLabel(p, n, "cut the mask") }, after: ["track"], chain: [{ slot: "video" }] });
          after.push(`mcut${i}`);
        } else after.push("track");
        chain.push({ slot: "mask" });
      }
      // Clicks on one short clip: Bria's own clicked eraser; clicks on a long one: the masked eraser on the track.
      const modelId = e.id === "bria-video-erase-points" && tracked ? "bria-video-erase-mask" : e.id;
      const params = { ...own.params };
      if (modelId !== e.id) delete params.points;
      steps.push({
        key: `erase${i}`,
        request: { ...eraseFeature(n === 1), modelId, op, ...own, params, ...(one ? { inputs: { video: input.source.url } } : {}), step: pieceLabel(p, n, "erase") },
        ...(after.length ? { after, chain } : {}),
      });
    });
  }

  // Erasers that work in whole frames leave out the last few (fewer than a step): the sound is cut to the picture's end,
  // except on the open engine, whose mux trims the sound to the picture itself.
  const end = e.window && e.engine === "cloud" ? pieces[n - 1].end : input.range.end;
  const final = joinWithSound(steps, { engine: input.engine, title: input.title, base, helper, source: input.source, range: input.range, pieces: joined, sound, end });
  return { steps, final, pieces, sound, tracked };
}

/**
 * The tools the H3 person removal prepares its inputs with (all on your GPU). The clean frame is Qwen-Image 2.1 at 25
 * steps: its edit follows image 1's shape (the frame scaled to 2048 px on the long side, each side rounded to 32 px),
 * and the relay graph scales it back to the part's exact size with a centre crop. The framing stays the clip's: a 16:9
 * part (1344×736) comes back at 2048×1120, within a pixel of its shape; the rounding moves an edge by 1.5% at most.
 */
export const PERSON_REMOVAL_TOOLS = { fit: "oss-fit-clip", frame: "oss-extract-frame", clean: "oss-qwen-image-21" } as const;

/** H3 Relay's Person Removal works at 24 fps (its windows are counted in frames of the clip as it comes in). */
export const PERSON_REMOVAL_FPS = 24;

/** The clean first frame's edit: the person gone, the scene behind them continued, everything else as it was. */
export function cleanFramePrompt(words: string | undefined): string {
  const who = targetPhrase(words ?? "") || "the person";
  return (
    `Remove ${who} from the picture completely, with their shadow and anything they hold, and fill the space with what was behind them: ` +
    "the background continues naturally, matching the light, texture and perspective. Keep everything else exactly as it is: the other people, the framing, the lighting and the size of the picture."
  );
}

/**
 * Remove a person on H3 (docs/research/openjutsu-6.md §4.4): the part fitted to 24 fps on the 32-pixel grid (the size
 * H3's pixel budget gives the clip at "768"), its first frame, a clean copy of that frame with the person gone
 * (Qwen-Image 2.1), then H3 Relay's Person Removal from the clean frame; its output is silent, so the clip's sound is
 * put back.
 */
function planPersonRemoval(input: RemovalPlanInput): RemovalPlan {
  const e = input.eraser;
  const base = { feature: REMOVE.feature, batchTitle: input.title };
  const helper = { feature: REMOVE.stepFeature, batchTitle: input.title };
  const seed = input.seed !== undefined ? { seed: input.seed } : {};
  const size = h3Canvas(input.source.width ?? 1280, input.source.height ?? 720, "768p");
  const sound = !!input.source.hasAudio;
  const label = (what: string, index: number) => ({ label: what, index, of: 4 });
  const steps: PlanStep[] = [
    {
      key: "fit",
      request: {
        ...helper,
        modelId: PERSON_REMOVAL_TOOLS.fit,
        op: "trim",
        inputs: { video: input.source.url },
        params: { startTime: r3(input.range.start), endTime: r3(input.range.end), fps: PERSON_REMOVAL_FPS, extra: { width: size.width, height: size.height } },
        step: label(`Fit the part (24 fps, ${size.width}×${size.height})`, 0),
      },
    },
    {
      key: "frame",
      request: { ...helper, modelId: PERSON_REMOVAL_TOOLS.frame, op: "frame", params: { startTime: 0, endTime: 0.5, extra: { frameIndex: 0 } }, step: label("Its first frame", 1) },
      after: ["fit"],
      chain: [{ slot: "video" }],
    },
    {
      key: "clean",
      request: { ...helper, modelId: PERSON_REMOVAL_TOOLS.clean, op: "edit", prompt: cleanFramePrompt(input.prompt), ...(input.seed !== undefined ? { params: { ...seed } } : {}), step: label("A clean first frame (Qwen-Image 2.1)", 2) },
      after: ["frame"],
      chain: [{ slot: "images", position: "first" }],
    },
    {
      key: "erase0",
      request: {
        ...(sound ? helper : { ...base, title: input.title }),
        modelId: e.id,
        op: "remove-object",
        prompt: targetPhrase(input.prompt ?? "") || "person",
        ...(input.seed !== undefined ? { params: { ...seed } } : {}),
        step: label("Remove the person (MiniMax H3)", 3),
      },
      after: ["fit", "clean"],
      chain: [{ slot: "video" }, { slot: "images", position: "first" }],
    },
  ];
  const piece: Piece = { index: 0, start: input.range.start, end: input.range.end };
  const final = joinWithSound(steps, { engine: "open", title: input.title, base, helper, source: input.source, range: input.range, pieces: ["erase0"], sound });
  return { steps, final, pieces: [piece], sound, tracked: false };
}

export interface JoinInput {
  engine: Engine;
  title: string;
  /** The finished video's feature, and the steps' in between. */
  base: { feature: string; batchTitle: string };
  helper: { feature: string; batchTitle: string };
  source: RemoveSource;
  range: RemoveRange;
  /** The keys of the pieces' videos, in order. */
  pieces: string[];
  /** Put the clip's own sound back under the joined picture. */
  sound: boolean;
  /** Where the sound ends in the source (the last piece's end, when pieces stop a few frames short). */
  end?: number;
  /** What the sound step says (default "Put the sound back"). */
  soundLabel?: string;
}

/**
 * Join pieces in order (folding when the join takes fewer clips than there are), then put the clip's own sound
 * back: the upload's (the whole clip) or the range cut out of it. Pushes the steps; returns the finished video's key
 * (a lone piece with no sound to add is the result itself; its step should carry the finished feature).
 */
export function joinWithSound(steps: PlanStep[], j: JoinInput): string {
  const t = REMOVE_TOOLS[j.engine];
  let level = j.pieces;
  let depth = 0;
  while (level.length > 1) {
    const groups = joinGroups(level.length, t.joinMax);
    const last = groups.length === 1;
    level = groups.map((g, gi) => {
      const after = g.map((i) => level[i]);
      const key = last ? "join" : `join-${depth}-${gi}`;
      steps.push({
        key,
        request: {
          ...(last && !j.sound ? { ...j.base, title: j.title } : j.helper),
          modelId: t.join,
          op: "concat",
          prompt: j.title,
          // The open join scales to one size: the clip's own shape at its own size.
          params: j.engine === "open" ? { aspectRatio: "auto", resolution: tierFor(j.source) } : {},
          step: { label: last ? "Join the pieces" : "Joining", index: 1000 + depth, of: 1000 },
        },
        after,
        chain: after.map(() => ({ slot: "videos" as const })),
      });
      return key;
    });
    depth++;
  }
  const picture = level[0];
  if (!j.sound) return picture;

  const after = [picture];
  const chain: ChainSlot[] = [{ slot: "video" }];
  const inputs: GenerationRequest["inputs"] = {};
  const end = j.end ?? j.range.end;
  if (wholeClip(j.range, j.source.duration) && end >= (j.source.duration ?? 0) - 0.05) inputs.audio = j.source.url;
  else {
    steps.push({ key: "sound", request: { ...j.helper, modelId: t.cut, op: "trim", inputs: { video: j.source.url }, params: { startTime: j.range.start, endTime: end }, step: { label: "Original sound", index: 1100, of: 1000 } } });
    after.push("sound");
    chain.push({ slot: "audio" });
  }
  steps.push({
    key: "final",
    request: { ...j.base, title: j.title, modelId: t.mux, op: "mux", ...(Object.keys(inputs).length ? { inputs } : {}), step: { label: j.soundLabel ?? "Put the sound back", index: 1200, of: 1000 } },
    after,
    chain,
  });
  return "final";
}

/** The open join's size tier: the clip's own (480p, 720p or 1080p by its short side). */
export function tierFor(s: Pick<RemoveSource, "width" | "height">): string {
  const short = s.width && s.height ? Math.min(s.width, s.height) : 720;
  return short <= 540 ? "480p" : short <= 900 ? "720p" : "1080p";
}

// ---------------------------------------------------------------------------
// The mask preview: what the engine would remove, on the first seconds

export interface PreviewPlanInput {
  engine: Engine;
  mode: RemoveMode;
  title: string;
  source: RemoveSource;
  range: RemoveRange;
  prompt?: string;
  points?: PixelPoint[];
}

/**
 * Whether the mask preview shows the mask the eraser itself works from (SAM tracks the object for it: the open
 * graphs, fal's VOID from its mask prompt, a SAM 3.1 track of clicks or paint), or only how SAM 3.1 reads the words
 * or clicks (Kling O3 edit and Bria find the object themselves, so their result can differ).
 */
export function previewIsEraserMask(e: Eraser, tracked: boolean): boolean {
  return e.engine === "open" || !!e.effects || tracked;
}

/**
 * A cheap look at the mask before paying for the removal: the first seconds of the range, segmented by
 * SAM 3.1 (cloud: a mask video of what you named, clicked or painted, about $0.02; open: the SAM 3 matte
 * graph's black-and-white matte of what you named, free). Null when the engine can't make one (open clicks; open
 * paint, whose painted overlay is its own preview).
 */
export function planMaskPreview(input: PreviewPlanInput): PlanStep[] | null {
  if (input.engine === "open" && input.mode !== "type") return null;
  const words = input.mode === "type" ? targetPhrase(input.prompt ?? "") : "";
  if (input.mode === "type" ? !words : !input.points?.length) return null;
  const t = REMOVE_TOOLS[input.engine];
  const end = r3(Math.min(input.range.end, input.range.start + REMOVE.previewSeconds));
  const helper = { feature: REMOVE.stepFeature, batchTitle: input.title };
  return [
    { key: "cut", request: { ...helper, modelId: t.cut, op: "trim", inputs: { video: input.source.url }, params: { startTime: input.range.start, endTime: end }, step: { label: "Cut the first seconds", index: 0, of: 2 } } },
    {
      key: "preview",
      request: {
        feature: REMOVE.previewFeature,
        batchTitle: input.title,
        title: `Mask preview · ${input.mode === "type" ? words : input.mode === "click" ? "clicked" : "painted"}`,
        modelId: t.preview,
        op: "bg-remove-video",
        ...(words ? { prompt: words } : {}),
        // The open graph's black-and-white matte (white = what goes), like the cloud's mask video.
        params: { ...(input.points?.length && !words ? { points: input.points } : {}), duration: r3(end - input.range.start), ...(input.engine === "open" ? { matteOutput: "matte" as const } : {}) },
        step: { label: "Mask preview", index: 1, of: 2 },
      },
      after: ["cut"],
      chain: [{ slot: "video" }],
    },
  ];
}
