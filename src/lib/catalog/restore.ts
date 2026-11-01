/**
 * Fuobe Restore (package archive-restore): Restore & colourise archive footage with Lightricks' Restore IC-LoRA.
 * The recipe is the model card's (Hugging Face Lightricks/LTX-2.5-22b-IC-LoRA-Restore,
 * read as data; research studios[archive-restore] in docs/research/fuobe-originals-recipes-5.json):
 *
 * - On your GPU: the clip lanczos-resized to the working canvas (1440 wide for 4:3, 1920x1088 for 16:9, multiples of 32,
 *   the shape kept), the frame-aligned reference of the IC-LoRA at 1.0 on LTX-2.5 22B distilled, per-step tiled latent
 *   fusion with 960x544 tiles at 50% overlap (at every size), 8 distilled steps (euler, guidance 1.0). Clips past 97
 *   frames run as 97-frame windows, each starting from the previous window's last 17 restored frames (the card's prefix
 *   hand-off: colour stays consistent). An optional reference picture at frame_idx -1 (true colours, faces, signs);
 *   deinterlacing first for interlaced sources. Stage 2 (optional, "Restore to 4K"): lanczos x2 and the Detail Refine
 *   IC-LoRA with 1024x576 tiles, restore first, refine second.
 * - In the cloud (only because fal hosts the base model with IC-LoRAs): LTX-2.3 22B reference video to video with the
 *   Restore LoRA by Fuobe's mirror URL, one untiled pass a piece at the tier's size for the clip's shape, pieces of up
 *   to 97 frames, each after the first starting from the previous piece's last restored frame (fal's first-frame input).
 *   No stage 2 there: the Detail Refine LoRA is an LTX-2.5 LoRA and nobody hosts LTX-2.5 with LoRAs.
 * - Then the pieces are joined and the clip's own sound put back.
 *
 * Pure module, shared by the page, the server (src/server/restore.ts), the ComfyUI provider and the tests.
 */
import { frameWindows, planFrameCuts, REMOVE_TOOLS, wholeClip, type FrameWindow } from "./remove-object";
import { joinGroups, type PlanStep } from "./shorts";
import type { ChainSlot, Engine, GenerationRequest } from "./types";

export const RESTORE = {
  model: "fuobe-restore",
  feature: "restore",
  /** Windows, cut pieces, hand-off frames and joins: kept apart from the finished videos. */
  stepFeature: "restore-step",
  /** The open graph (stage 1 and, with the Detail Refine LoRA, stage 2). */
  workflow: "video-restore-ltx25-tiled",
  /** The two IC-LoRAs (research adapterLoras), both gated on Hugging Face. */
  loras: {
    restore: { key: "ltx-2-5-22b-ic-lora-restore-1-0", file: "ltx-2.5-22b-ic-lora-restore-1.0.safetensors", page: "https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Restore", sizeGb: 1.71 },
    refine: { key: "ltx-2-5-22b-ic-lora-refine-details-1-0", file: "ltx-2.5-22b-ic-lora-refine-details-1.0.safetensors", page: "https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Refine-Details", sizeGb: 1.31 },
  },
  /** LTX works in 8n+1 frames: the trained window, the prefix hand-off (17 = 8·2 + 1) and the shortest pass. */
  window: 97,
  prefix: 17,
  minFrames: 9,
  /** The trained tiles (stage 1) and the Detail Refine tiles (stage 2), at 50% overlap. */
  tile: { width: 960, height: 544 },
  refineTile: { width: 1024, height: 576 },
  overlap: 0.5,
  /** The card's 8 distilled steps. */
  sigmas: [1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0],
  /** One run takes up to two minutes of footage (the windows add up fast on a GPU, the pieces in the cloud). */
  maxSeconds: 120,
  /** A single generation (Canvas, the API) makes one pass: up to fal's 481 frames, or 20 s of the GPU's streaming windows. */
  singleFrames: 481,
  maxBytes: 1024 * 1024 * 1024,
  accept: "video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo,.mp4,.mov,.m4v,.webm,.mkv,.avi",
  /** Cloud tiers (Fuobe Cinema's size table) and the default. */
  cloudResolutions: ["720p", "1080p"],
  cloudResolution: "720p",
} as const;

/** The card's canvas widths: 1440 for 4:3-ish scans, 1920 for 16:9 and wider (the threshold is halfway, in log terms). */
const WIDE = Math.sqrt((4 / 3) * (16 / 9));
const r32 = (n: number) => Math.max(32, Math.round(n / 32) * 32);

export interface Size {
  width: number;
  height: number;
}

/**
 * The working canvas: the longer side 1440 (up to about 3:2) or 1920 (wider), the shorter one from the clip's own shape,
 * both multiples of 32, never shorter than a tile. 640x480 and 720x544 scans → 1440x1088; 16:9 → 1920x1088; portrait
 * clips the other way round. Unknown size: the 4:3 canvas (most archive scans).
 */
export function restoreCanvas(width?: number, height?: number): Size {
  if (!width || !height || !(width > 0) || !(height > 0)) return { width: 1440, height: 1088 };
  const portrait = height > width;
  const ratio = portrait ? height / width : width / height;
  let long = ratio >= WIDE ? 1920 : 1440;
  let short = r32(long / ratio);
  // Very wide shapes (4:1): a tile must still fit across the short side.
  if (short < RESTORE.tile.height) {
    short = RESTORE.tile.height;
    long = r32(short * ratio);
  }
  return portrait ? { width: short, height: long } : { width: long, height: short };
}

/** Stage 2's canvas: twice the restored one (2880x2176 from 1440x1088). */
export const refineCanvas = (c: Size): Size => ({ width: c.width * 2, height: c.height * 2 });

/** How a canvas splits into overlapping tiles: columns × rows (1440x1088 at 960x544 and 50% is 2 × 3). */
export function tileGrid(canvas: Size, tile: Size = RESTORE.tile, overlap: number = RESTORE.overlap): { columns: number; rows: number; tiles: number } {
  const count = (side: number, t: number) => (side <= t ? 1 : Math.ceil((side - t) / (t * (1 - overlap)) - 1e-9) + 1);
  const columns = count(canvas.width, tile.width);
  const rows = count(canvas.height, tile.height);
  return { columns, rows, tiles: columns * rows };
}

// ---------------------------------------------------------------------------
// Windows (GPU) and pieces (cloud)

export interface RestoreWindow {
  index: number;
  /** The first source frame the window reads (the prefix's, for a window after the first). */
  start: number;
  /** Frames it reads and renders: 8n+1, at most 97. */
  frames: number;
  /** Frames at its start the window before already restored (given as the prefix, then dropped): 0 or 17. */
  prefix: number;
  /** The frames it adds to the result: frames − prefix. */
  keep: number;
  /** Where the prefix starts in the window before's saved output (its kept frames less 17). */
  prefixFrom?: number;
}

/**
 * The card's chained windows over `total` frames: the first one up to 97 frames, each next one 17 frames of the one
 * before (as its prefix, LTXVAddGuide at frame 0) plus up to 80 new ones, in steps of 8 so every window stays 8n+1.
 * The windows cover all but fewer than 8 frames at the end (the sound is cut to the picture).
 */
export function restoreWindows(total: number): RestoreWindow[] {
  const { window: W, prefix: P, minFrames } = RESTORE;
  if (!(total >= minFrames)) return [];
  const first = Math.min(W, 8 * Math.floor((total - 1) / 8) + 1);
  const out: RestoreWindow[] = [{ index: 0, start: 0, frames: first, prefix: 0, keep: first }];
  let end = first;
  for (;;) {
    const fresh = Math.min(W - P, 8 * Math.floor((total - end) / 8));
    if (fresh < 8) break;
    const prev = out[out.length - 1];
    out.push({ index: out.length, start: end - P, frames: P + fresh, prefix: P, keep: fresh, prefixFrom: prev.keep - P });
    end += fresh;
  }
  return out;
}

/** Frames the windows (or pieces) leave out at the end: fewer than 8. */
export const framesCovered = (w: { keep?: number; frames: number }[]): number => w.reduce((n, x) => n + (x.keep ?? x.frames), 0);

/** Cloud pieces: back to back, each 8n+1 frames and at most 97, as even as possible (the fewest that fit). */
export const CLOUD_PIECE: FrameWindow = { cap: RESTORE.window, step: 8, base: 1, min: RESTORE.minFrames };

/** Stage 2's windows over the restored clip: back to back, 8n+1, at most 97 (no prefix: the Detail Refine LoRA keeps the colour). */
export const REFINE_WINDOW: FrameWindow = { cap: RESTORE.window, step: 8, base: 1, min: RESTORE.minFrames };

export const cloudPieceFrames = (total: number): number[] => frameWindows(total, CLOUD_PIECE);

// ---------------------------------------------------------------------------
// Words: the prompt and the negative

/** What the model must not invent, by default (the card's train example plus the obvious modern things). */
export const MODERN_OBJECTS = [
  "modern cars",
  "modern buildings",
  "shipping containers",
  "mobile phones",
  "logos",
  "signage",
  "lettering",
  "graffiti",
  "satellite dishes",
  "plastic furniture",
];

/** The damage the card's runs named in their negative (the model must not reproduce it). */
export const ARTEFACTS = ["blocky compression", "banding", "mosquito noise", "ringing", "blurry", "smeared", "ghosting", "low resolution"];

export interface SceneWords {
  /** "1950s", "1896", "the 1930s". */
  period?: string;
  /** "a railway station in rural France". */
  place?: string;
  /** "overcast daylight", "soft window light". */
  light?: string;
  /** "wooden station buildings, steam". */
  materials?: string;
  /** "period coats and hats". */
  clothing?: string;
  /** What happens or who is there ("a steam locomotive arriving"). */
  subject?: string;
}

const tidy = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().replace(/[.,;\s]+$/, "");
const decade = (p: string) => (/^(1[89]|20)\d0s$/.test(p) || /^(1[89]|20)\d\d$/.test(p) ? `in ${p}` : p);

/**
 * The card's prompt from the scene's words: what happens, the period and place, the light, the materials and what people
 * wear, ending in "natural colour". Kept generic across the frame (every tile reads the whole prompt).
 */
export function restorePrompt(w: SceneWords): string {
  const subject = tidy(w.subject) || "the scene as it was filmed";
  const period = tidy(w.period);
  const place = tidy(w.place);
  const lead = [subject, place && (/^(in|at|on|by|near|inside|outside)\b/i.test(place) ? place : `in ${place}`), period && decade(period)].filter(Boolean).join(" ");
  const parts = [lead, tidy(w.light), tidy(w.materials), tidy(w.clothing)].filter(Boolean);
  return `${parts.join(", ")}, natural colour`;
}

/** The negative: what must not be invented (modern objects by default), then the artefacts. */
export function restoreNegative(prohibitions: string[] = MODERN_OBJECTS): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...prohibitions, ...ARTEFACTS]) {
    const t = tidy(p).toLowerCase();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.join(", ");
}

/** Fuobe's offline writer: the template filled with what the user typed (no LLM, demo mode, or the text model off). */
export function offlineRestorePrompt(hint?: string): { prompt: string; negative: string } {
  const h = tidy(hint);
  const year = /\b(1[89]\d0s|20[0-2]0s|1[89]\d\d|20[0-2]\d)\b/.exec(h)?.[1];
  const subject = h ? h.replace(/\b(in|from)\s+(the\s+)?(1[89]\d0s|20[0-2]0s|1[89]\d\d|20[0-2]\d)\b/i, "").replace(/\s+/g, " ").trim().replace(/[,\s]+$/, "") : "";
  const prompt = restorePrompt({
    subject: subject || undefined,
    period: year,
    light: "natural daylight",
    materials: "period materials and surfaces",
    clothing: "people in clothing of the period",
  });
  return { prompt: `${prompt}, sharp photographic detail, natural grain`, negative: restoreNegative() };
}

/** The LLM's brief (Fuobe's own words): it sees a few frames of the clip and the user's hint. */
export const PROMPT_SYSTEM = `You write the prompts for a video restoration model that turns archive footage (black and white, sepia, tape, low-resolution web rips) into a clean colour clip of the same shot. Colour is inferred from your words, so describe what the frames show as it would have looked in colour.
Reply with exactly two lines and nothing else:
PROMPT: one sentence of 25 to 60 words: what happens and who is there, the period (a decade or year), the place, the light, the materials and what people wear, ending with "natural colour". Keep it generic across the frame: no positions, no text on signs, no names of people.
NEGATIVE: a comma-separated list of 6 to 14 modern things the model must not invent in this scene (vehicles, buildings, objects, logos, signage, lettering…), lower case.`;

/** The LLM's question: the user's words and how many frames are attached. */
export function promptRequest(o: { hint?: string; frames: number; seconds?: number }): string {
  const lines = [o.hint?.trim() ? `What the user knows about the footage: ${tidy(o.hint).slice(0, 600)}` : "The user gave no details: infer the period and place from the frames."];
  if (o.frames) lines.push(`Attached: ${o.frames} frame${o.frames > 1 ? "s" : ""} of the clip, in order.`);
  if (o.seconds) lines.push(`The clip is ${Math.round(o.seconds)} s long.`);
  return lines.join("\n");
}

/** An LLM's answer as a prompt and a negative; null when the prompt line is missing or too short. */
export function parsePromptAnswer(text: string | null | undefined): { prompt: string; negative: string } | null {
  if (!text) return null;
  const line = (label: string) => new RegExp(`^\\s*\\**${label}\\**\\s*:\\s*(.+)$`, "im").exec(text)?.[1]?.trim().replace(/^["“]|["”]$/g, "");
  let prompt = tidy(line("PROMPT"));
  if (prompt.length < 12) return null;
  if (!/natural colou?r$/i.test(prompt)) prompt = `${prompt}, natural colour`;
  const negative = line("NEGATIVE");
  const items = (negative ?? "")
    .split(",")
    .map((s) => tidy(s).toLowerCase())
    .filter((s) => s && s.length < 60);
  return { prompt: prompt.slice(0, 600), negative: restoreNegative(items.length ? items : MODERN_OBJECTS) };
}

// ---------------------------------------------------------------------------
// Checks

export interface RestoreSource {
  url: string;
  duration?: number;
  fps?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  /** Frames in the clip, when its header says (else duration × fps). */
  frames?: number;
}

/** The clip's frame count: its header's, else its length at its rate. */
export function sourceFrames(s: Pick<RestoreSource, "frames" | "duration" | "fps">): number | undefined {
  if (s.frames && s.frames > 0) return Math.floor(s.frames);
  if (s.duration && s.fps) return Math.floor(s.duration * s.fps + 1e-6);
  return undefined;
}

/** Why this run can't start, or null. */
export function restoreProblem(o: { engine: Engine; source: Pick<RestoreSource, "duration" | "fps" | "frames">; refine?: boolean; resolution?: string; upscale?: boolean }): string | null {
  const d = o.source.duration;
  if (d === undefined || !o.source.fps) return "Reading the clip… try again in a moment";
  if (d > RESTORE.maxSeconds + 0.05) return `Restore takes up to ${RESTORE.maxSeconds / 60} minutes at a time: trim the clip first (Video tools → Trim)`;
  if ((sourceFrames(o.source) ?? 0) < RESTORE.minFrames) return "The clip is too short to restore: it needs at least 9 frames";
  if (o.refine && o.engine === "cloud") return "Restore to 4K runs on your GPU: the Detail Refine IC-LoRA is an LTX-2.5 LoRA, and no cloud host runs LTX-2.5 with LoRAs";
  if (o.refine && o.upscale) return "Restore to 4K already doubles the size: pick it or Then upscale, not both";
  if (o.engine === "cloud" && o.resolution && !(RESTORE.cloudResolutions as readonly string[]).includes(o.resolution)) return `Pick ${RESTORE.cloudResolutions.join(" or ")}`;
  return null;
}

// ---------------------------------------------------------------------------
// The pipeline: steps for createPipeline (src/server/chains.ts)

export interface RestorePlanInput {
  engine: Engine;
  title: string;
  source: RestoreSource;
  prompt: string;
  negative: string;
  /** GPU only: a second pass to 4K class with the Detail Refine IC-LoRA. */
  refine?: boolean;
  /** GPU only: keep one field of interlaced frames before restoring. */
  deinterlace?: boolean;
  /** A reference picture: true colours, faces, signs (GPU: at frame_idx -1 on every window). */
  reference?: string;
  /** Cloud tier (720p or 1080p). */
  resolution?: string;
  seed?: number;
  /** Upscale the restored clip after (Upscale → "Restore archive footage first"): the engine's video upscaler. */
  upscale?: boolean;
}

/**
 * The upscaler a restoration hands its result to (Upscale video's defaults): Topaz Video in the cloud, SeedVR2 on
 * your GPU, both to 2160p (the factor comes from the restored clip at submit). Restore to 4K already doubles the size
 * on the GPU, so the two don't go together.
 */
export const RESTORE_UPSCALE = {
  cloud: { modelId: "topaz-video", params: { resolution: "2160p" }, label: "Topaz Video, to 2160p" },
  open: { modelId: "oss-seedvr2", params: { resolution: "2160p" }, label: "SeedVR2, to 2160p" },
} as const;

export interface RestorePlan {
  steps: PlanStep[];
  final: string;
  /** Windows (GPU) or pieces (cloud). */
  pieces: number;
  /** The working canvas (GPU), or the size the cloud renders. */
  canvas: Size;
  /** Stage 2's canvas, when it runs. */
  refined?: Size;
  /** Frames left out at the end (fewer than 8: whole 8n+1 windows). */
  dropped: number;
  sound: boolean;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const label = (i: number, n: number, what: string) => ({ label: n > 1 ? `Piece ${i + 1} of ${n} · ${what}` : what[0].toUpperCase() + what.slice(1), index: i, of: n });

/** The tier and shape fal renders a clip of this size at (Fuobe Cinema's table): the shape nearest the clip's own. */
export const CLOUD_SHAPES = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
export function cloudShape(width?: number, height?: number): (typeof CLOUD_SHAPES)[number] {
  if (!width || !height) return "4:3";
  const r = Math.log(width / height);
  return CLOUD_SHAPES.reduce((best, s) => {
    const [a, b] = s.split(":").map(Number);
    const [c, d] = best.split(":").map(Number);
    return Math.abs(Math.log(a / b) - r) < Math.abs(Math.log(c / d) - r) ? s : best;
  }, "4:3" as (typeof CLOUD_SHAPES)[number]);
}

/** fal's size for a tier and shape (Fuobe Cinema's table, as the cloud half's FieldMap.size sends it). */
export const CLOUD_SIZES: Record<string, Record<(typeof CLOUD_SHAPES)[number], [number, number]>> = {
  "720p": { "21:9": [1504, 640], "16:9": [1280, 704], "4:3": [1024, 768], "1:1": [960, 960], "3:4": [768, 1024], "9:16": [704, 1280] },
  "1080p": { "21:9": [2240, 960], "16:9": [1920, 1088], "4:3": [1440, 1088], "1:1": [1088, 1088], "3:4": [1088, 1440], "9:16": [1088, 1920] },
};

/**
 * The whole job. GPU: the windows, chained by their 17-frame prefix (each reads the source itself and the window before's
 * output), then (Restore to 4K) the restored clip again in 97-frame windows with the Detail Refine LoRA. Cloud: 8n+1-frame
 * pieces of up to 97 frames cut from the clip, each after the first given the last restored frame of the one before.
 * Then the pieces are joined and the clip's own sound put back.
 */
export function planRestore(input: RestorePlanInput): RestorePlan {
  const { engine, source } = input;
  const total = sourceFrames(source) ?? 0;
  const fps = source.fps ?? 24;
  const base = { feature: RESTORE.feature, batchTitle: input.title };
  const helper = { feature: RESTORE.stepFeature, batchTitle: input.title };
  const seed = input.seed !== undefined ? { seed: input.seed } : {};
  const sound = !!source.hasAudio;
  const words = { prompt: input.prompt, negativePrompt: input.negative };
  const steps: PlanStep[] = [];
  const own = (last: boolean) => (last && !sound ? { ...base, title: input.title } : helper);

  if (engine === "open") {
    const canvas = restoreCanvas(source.width, source.height);
    const windows = restoreWindows(total);
    if (!windows.length) throw new Error("The clip is too short to restore: it needs at least 9 frames");
    const n = windows.length;
    const refine = !!input.refine;
    const keys: string[] = [];
    for (const w of windows) {
      const key = `restore${w.index}`;
      const lone = n === 1 && !refine;
      steps.push({
        key,
        request: {
          ...own(lone),
          modelId: RESTORE.model,
          engine: "open",
          op: "restore-video",
          ...words,
          inputs: { video: source.url, ...(input.reference ? { images: [input.reference] } : {}) },
          params: {
            fps,
            sourceDuration: r6(w.keep / fps),
            extra: {
              stage: "restore",
              windowStart: w.start,
              windowFrames: w.frames,
              prefixFrames: w.prefix,
              ...(w.prefixFrom !== undefined ? { prefixFrom: w.prefixFrom } : {}),
              canvasWidth: canvas.width,
              canvasHeight: canvas.height,
              ...(input.deinterlace ? { deinterlace: true } : {}),
            },
            ...seed,
          },
          step: label(w.index, n, "restore"),
        },
        ...(w.index > 0 ? { after: [`restore${w.index - 1}`], chain: [{ slot: "videos" as const, position: "first" as const }] } : {}),
      });
      keys.push(key);
    }
    let picture = joinEncoded(steps, keys, "join", refine || sound ? helper : { ...base, title: input.title }, "Join the windows");
    let refined: Size | undefined;
    if (refine) {
      refined = refineCanvas(canvas);
      const restored = framesCovered(windows);
      const cuts = frameWindows(restored, REFINE_WINDOW);
      let at = 0;
      const rkeys: string[] = [];
      cuts.forEach((frames, i) => {
        const key = `refine${i}`;
        steps.push({
          key,
          request: {
            ...own(cuts.length === 1),
            modelId: RESTORE.model,
            engine: "open",
            op: "restore-video",
            ...words,
            params: {
              fps,
              sourceDuration: r6(frames / fps),
              extra: { stage: "refine", windowStart: at, windowFrames: frames, prefixFrames: 0, canvasWidth: refined!.width, canvasHeight: refined!.height },
              ...seed,
            },
            step: label(i, cuts.length, "detail pass (4K)"),
          },
          after: [picture],
          chain: [{ slot: "video" }],
        });
        rkeys.push(key);
        at += frames;
      });
      picture = joinEncoded(steps, rkeys, "join4k", sound ? helper : { ...base, title: input.title }, "Join the 4K windows");
    }
    const final = thenUpscale(steps, sound ? putSoundBack(steps, picture, base, input.title, source, "open") : picture, input);
    const covered = refine ? frameWindows(framesCovered(windows), REFINE_WINDOW).reduce((a, b) => a + b, 0) : framesCovered(windows);
    return { steps, final, pieces: n, canvas, refined, dropped: total - covered, sound };
  }

  // Cloud: frame-exact pieces, each restored in one untiled pass; a piece after the first starts from the last restored
  // frame of the one before (fal's image_url, the first frame of the video), and the first from the reference picture.
  const resolution = input.resolution && (RESTORE.cloudResolutions as readonly string[]).includes(input.resolution) ? input.resolution : RESTORE.cloudResolution;
  const shape = cloudShape(source.width, source.height);
  const [cw, ch] = CLOUD_SIZES[resolution][shape];
  const duration = source.duration ?? total / fps;
  const pieces = planFrameCuts({ start: 0, end: duration }, fps, CLOUD_PIECE);
  if (!pieces.length) throw new Error("The clip is too short to restore: it needs at least 9 frames");
  const n = pieces.length;
  const whole = n === 1 && wholeClip({ start: 0, end: pieces[0].end }, duration);
  const keys: string[] = [];
  pieces.forEach((p, i) => {
    const after: string[] = [];
    const chain: ChainSlot[] = [];
    if (!whole) {
      steps.push({
        key: `cut${i}`,
        request: { ...helper, modelId: REMOVE_TOOLS.cloud.cut, op: "trim", inputs: { video: source.url }, params: { startTime: p.start, endTime: p.end }, step: label(i, n, "cut") },
      });
      after.push(`cut${i}`);
      chain.push({ slot: "video" });
    }
    if (i > 0) {
      steps.push({
        key: `hand${i}`,
        request: { ...helper, modelId: "extract-frame", op: "frame", step: label(i, n, "hand-off frame") },
        after: [`restore${i - 1}`],
        chain: [{ slot: "video" }],
      });
      after.push(`hand${i}`);
      chain.push({ slot: "images" });
    }
    const seconds = r6((p.frames ?? Math.round((p.end - p.start) * fps)) / fps);
    const lone = n === 1;
    // The reference picture is the first piece's first frame (fal's image_url); later pieces start from the hand-off.
    const first = i === 0 && input.reference ? { images: [input.reference] } : undefined;
    const request: GenerationRequest = {
      ...own(lone),
      modelId: RESTORE.model,
      engine: "cloud",
      op: "restore-video",
      ...words,
      ...(whole || first ? { inputs: { ...(whole ? { video: source.url } : {}), ...first } } : {}),
      params: { aspectRatio: shape, resolution, fps, duration: seconds, sourceDuration: seconds, ...seed },
      step: label(i, n, "restore"),
    };
    steps.push({ key: `restore${i}`, request, ...(after.length ? { after, chain } : {}) });
    keys.push(`restore${i}`);
  });
  let picture = keys[0];
  if (n > 1) picture = foldJoin(steps, keys, sound ? helper : { ...base, title: input.title });
  const end = pieces[n - 1].end;
  const final = thenUpscale(steps, sound ? putSoundBack(steps, picture, base, input.title, source, "cloud", end) : picture, input);
  const covered = pieces.reduce((a, p) => a + (p.frames ?? 0), 0);
  return { steps, final, pieces: n, canvas: { width: cw, height: ch }, dropped: Math.max(0, total - covered), sound };
}

/**
 * Upscale → "Restore archive footage first": the restored clip (sound and all) goes to the engine's upscaler, which
 * becomes the run's finished video; the restored one turns into a step.
 */
function thenUpscale(steps: PlanStep[], final: string, input: RestorePlanInput): string {
  if (!input.upscale) return final;
  const last = steps.find((s) => s.key === final)!;
  const { title, ...rest } = last.request;
  const batchTitle = rest.batchTitle;
  last.request = { ...rest, feature: RESTORE.stepFeature };
  const u = RESTORE_UPSCALE[input.engine];
  steps.push({
    key: "upscale",
    request: {
      feature: RESTORE.feature,
      batchTitle,
      title: title ?? input.title,
      modelId: u.modelId,
      engine: input.engine,
      op: "upscale-video",
      params: { ...u.params },
      step: { label: "Upscale", index: 1300, of: 1000 },
    },
    after: [final],
    chain: [{ slot: "video" }],
  });
  return "upscale";
}

/** The open join: the windows share one size and frame rate, so they're joined packet by packet (no decode, no resize). */
export const RESTORE_OPEN_JOIN = "oss-join-encoded";

function joinEncoded(steps: PlanStep[], keys: string[], key: string, who: Pick<GenerationRequest, "feature" | "batchTitle" | "title">, what: string): string {
  if (keys.length === 1) return keys[0];
  steps.push({
    key,
    request: { ...who, modelId: RESTORE_OPEN_JOIN, op: "concat", step: { label: what, index: 1000, of: 1000 } },
    after: keys,
    chain: keys.map(() => ({ slot: "videos" as const })),
  });
  return key;
}

/** The cloud join, folded when there are more pieces than fal's merge takes. */
function foldJoin(steps: PlanStep[], keys: string[], last: Pick<GenerationRequest, "feature" | "batchTitle" | "title">): string {
  const t = REMOVE_TOOLS.cloud;
  let level = keys;
  let depth = 0;
  while (level.length > 1) {
    const groups = joinGroups(level.length, t.joinMax);
    const top = groups.length === 1;
    level = groups.map((g, gi) => {
      const after = g.map((i) => level[i]);
      const key = top ? "join" : `join-${depth}-${gi}`;
      steps.push({
        key,
        request: { ...(top ? last : { feature: RESTORE.stepFeature, batchTitle: last.batchTitle }), modelId: t.join, op: "concat", step: { label: top ? "Join the pieces" : "Joining", index: 1000 + depth, of: 1000 } },
        after,
        chain: after.map(() => ({ slot: "videos" as const })),
      });
      return key;
    });
    depth++;
  }
  return level[0];
}

/**
 * The clip's own sound back under the restored picture. The open mux trims it to the picture; in the cloud the sound is
 * cut to where the last piece ends first (whole 8n+1 pieces leave out fewer than 8 frames).
 */
function putSoundBack(steps: PlanStep[], picture: string, base: { feature: string; batchTitle: string }, title: string, source: RestoreSource, engine: Engine, end?: number): string {
  const t = REMOVE_TOOLS[engine];
  const after = [picture];
  const chain: ChainSlot[] = [{ slot: "video" }];
  let inputs: GenerationRequest["inputs"] = { audio: source.url };
  if (engine === "cloud" && end !== undefined && source.duration !== undefined && end < source.duration - 0.05) {
    steps.push({
      key: "sound",
      request: { feature: RESTORE.stepFeature, batchTitle: base.batchTitle, modelId: t.cut, op: "trim", inputs: { video: source.url }, params: { startTime: 0, endTime: end }, step: { label: "Original sound", index: 1100, of: 1000 } },
    });
    after.push("sound");
    chain.push({ slot: "audio" });
    inputs = undefined;
  }
  steps.push({
    key: "final",
    request: { ...base, title, modelId: t.mux, op: "mux", ...(inputs ? { inputs } : {}), step: { label: "Put the sound back", index: 1200, of: 1000 } },
    after,
    chain,
  });
  return "final";
}

/** A short name for the run: the prompt's first words and the clip's name. */
export function restoreTitle(prompt: string, clipName?: string): string {
  const words = tidy(prompt)
    .replace(/,?\s*natural colou?r.*$/i, "")
    .split(/[,.]/)[0]
    .split(" ")
    .slice(0, 6)
    .join(" ");
  const head = words ? `Restored · ${words[0].toUpperCase()}${words.slice(1)}` : "Restored";
  const name = clipName?.replace(/\.[a-z0-9]{2,4}$/i, "").trim().slice(0, 40);
  return name ? `${head} · ${name}` : head;
}

// ---------------------------------------------------------------------------
// Words for the page

/** The hardware line under the GPU choice (no measurement here: the CPU server only checks the graph). */
export const GPU_NOTE = "LTX-2.5 22B distilled with tiled latent fusion: a 24 GB GPU class, minutes per window. Free on your GPU.";

/** What the cloud does differently (said plainly: what runs where). */
export const CLOUD_NOTE =
  "The cloud runs LTX-2.3 22B on fal with the same Restore IC-LoRA, one untiled pass a piece at the tier's size. The card recommends tiles at every size, so your GPU's tiled run is the reference recipe.";

/** The one-time gated download, as the page says it. */
export const GATED_NOTE = "The Restore IC-LoRA (1.7 GB) is gated on Hugging Face: accept its licence there once, then add your Hugging Face token in Settings → LoRAs.";

// ---------------------------------------------------------------------------
// Old footage elsewhere (Shorts, Explainer): how much colour a frame carries

/** Mean chroma (max − min of R, G, B, 0–255) over a frame's RGBA pixels: about 0 for black-and-white, low for sepia. */
export function meanChroma(rgba: ArrayLike<number>): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    sum += Math.max(r, g, b) - Math.min(r, g, b);
    n++;
  }
  return n ? sum / n : 0;
}

/** Below this mean chroma a clip reads as black-and-white or toned (sepia, cyanotype) footage. */
export const MONOCHROME_CHROMA = 24;

/** The Restore tool, with a clip handed over. */
export const restoreHref = (url?: string) => (url ? `/video-tools/restore?video=${encodeURIComponent(url)}` : "/video-tools/restore");
