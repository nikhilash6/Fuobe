/**
 * The graph composer: turns a canonical request into the exact ComfyUI prompt. It picks the workflow variant, maps Fuobe's
 * inputs onto the workflow's bindings (sizes, frames, trim times, languages, palettes, layers…), and rewrites graphs that
 * depend on the request (caption cues, left-out references, joins, keyframes…).
 *
 * Pure: no database, no settings, no account and no network. Everything comes in the request and the context: the
 * catalog, the uploads' header facts and the GPU's facts. The server uses it for every ComfyUI run (providers/comfyui.ts
 * prepareWorkflow), and the worker program, built from the same file (scripts/build-worker.mjs), composes a job ticket's
 * graph with it from its own copy of the catalog (src/lib/job-ticket.ts).
 */
import { tracksFor, type MotionPaths } from "@/lib/motion-paths";
import {
  applyBindings,
  asrLanguage,
  bypassNode,
  bypassReference,
  computeDimensions,
  fitCanvas,
  computeFrames,
  dropBranch,
  dropLoadedSound,
  dropVhsAudio,
  silenceVhsAudio,
  expandCaptionWorkflow,
  canTakeLoras,
  injectLoras,
  languageName,
  paletteSentence,
  parseCueLines,
  PROMPT_HELPER_GRAPHS,
  PROMPT_HELPER_OPT_IN,
  PROMPT_HELPER_PARAM,
  skipPromptHelper,
  randomSeed,
  splitCueWords,
  swatchPixels,
  tagMetaBatch,
  whisperLanguage,
  withLoad3dImages,
  type BindingKey,
  type CaptionCue,
  type ComfyWorkflow,
  type ManifestWorkflow,
} from "@/lib/comfy";
import { HI3D_PARAM, strictHi3dResolution } from "@/lib/av/hi3d";
import { fpsPlan } from "@/lib/av/fps";
import { resolveWorkflowId } from "@/lib/comfy-variants";
import { IDOL_WORKFLOWS, idolGraphValues } from "@/lib/av/model3d";
import { IDOL_VIEWS_NEEDS_PACK, IDOL_VIEWS_PARAM, IDOL_VIEWS_WORKFLOW } from "@/lib/av/idol-views";
import { MOTION_GRAPHS, motionTransferPrompt, neutralPrompt, WORDS_NEEDED } from "@/lib/comfy-prompts";
import { DECODER_PARAM, editCanvas, GPU_PARAM, LIGHTNING_GRAPHS, lightningSigmas, SPEED_PARAM, ZEN_ADAPTER, ZEN_ENCODER } from "@/lib/qwen21-speed";
import {
  checkWatermarkBoxes,
  COPY as WATERMARK_COPY,
  MAX_SIDE as MAX_WATERMARK_SIDE,
  maxSideFor,
  SCAN_EXPAND as WATERMARK_SCAN_EXPAND,
  KEPT_EXPAND as WATERMARK_KEPT_EXPAND,
} from "@/lib/watermark";
import { h3Canvas, h3Frames, isH3Graph } from "@/lib/h3-prompt";
import { expandH3References, h3ReferenceProblem } from "@/lib/h3-references";
import {
  draftSizeFor,
  H3_LATENT_DRAFT_WORKFLOW,
  latentFileFor,
  latentPrefixFor,
  REGEN_LATENT_WORKFLOW,
  REGEN_WINDOW_SECONDS,
  REGEN_WORKFLOW,
  regenFrames,
  regenOnePassRefusal,
  regenResolution,
} from "@/lib/catalog/regenerate";
import { carriesBoxes, LAYOUT_PARAM } from "@/lib/layout-prompt";
import { crossfadeProblem, fadeCurveWav } from "@/lib/av/crossfade";
import { dbsChannelsFor, dbsModelFor, dbsSurroundBed, surroundSource, type DbsModel } from "@/lib/av/split";
import { NO_REUSE_PACK, rateFor, reuseFileFor, STRENGTH_DB, type ReuseModel } from "@/lib/av/clean-voice";
import { expandAudioJoinWorkflow, expandVideoJoinWorkflow } from "@/lib/av/joins";
import { aukTtsWorkflow, expandSpeechEditWorkflow, readSpeechWindows, setAukDevice, speechFadeWav } from "@/lib/av/speech-edit-graph";
import { SpeechEditError, ttsInstruction, ttsLength, type SpeechWindow } from "@/lib/speech-edit";
import { expandInbetweenWorkflow, type InbetweenPass } from "@/lib/av/inbetween-graph";
import { gapPrompt, requestTiming, type InbetweenTiming } from "@/lib/inbetween";
import { expandTimelineWorkflow, readTimeline } from "@/lib/av/timeline";
import { expandWorldWorkflow, readWorld, WorldGraphError, worldProblem, type WorldScript } from "@/lib/world";
import { exportValues, framesPerPass, hdrColorSpace, RTX_UPSCALE_WORKFLOW, rtxScale, upscaleShortSide, wholeClipProblem, wholeClipTool } from "@/lib/av/video-finish";
import { keyFormatValues } from "@/lib/av/keying";
import { factorTier } from "@/lib/av/upscale";
import { CHARACTER_SWAP, packResolution, samCoords, swapPrompt, SWAP_LORAS, windowPlan } from "@/lib/catalog/character-swap";
import { maskMemoryProblem } from "@/lib/catalog/swap-studio";
import { STUDIO_WORKFLOWS } from "@/lib/catalog/swap-studio-plan";
import { maskGraph, segmentGraph, type MaskGraphOptions, type SegmentGraphOptions } from "@/lib/swap-studio-graphs";
import { OPENJUTSU_IDS, openjutsuGraph, openjutsuLeftOut, type OpenjutsuSettings } from "@/lib/openjutsu-graphs";
import { RESTORE_EXTRA_KEYS, restoreGraph, restoreJob, type RestoreJob } from "@/lib/restore-graph";
import { getMaker, makerPrompt, OPEN_TARGET_PROBLEM, ORIGINALS, swapTarget } from "@/lib/catalog/genjutsu";
import { CLICK_OPEN_PROBLEM, HAND_OFF, REMOVE_SCENE, REVIEW_EXTRA, reuseOf, targetPhrase, type RemovalReview } from "@/lib/catalog/remove-object";
import { H3_REMOVAL_WORKFLOW } from "@/lib/catalog/character-swap";
import { RECOLOR_TAP_FIRST, recolorItem, recolorTouches, tapFrame } from "@/lib/catalog/recolor";
import type { GenInput, Operation } from "@/lib/catalog/types";
import type { MediaInfo } from "@/lib/media-probe";
import { encodePng } from "@/lib/png-encode";

/** The workflows a composer reads: whether the catalog has one, and one's manifest entry and a fresh copy of its graph. */
export interface ComposeCatalog {
  has(id: string): boolean;
  get(id: string): { manifest: ManifestWorkflow; workflow: ComfyWorkflow };
}

/**
 * A refusal's words where they are read: an account's run on this install's GPUs (`site`, ctx.accountOnInstall) gets
 * plain words that name no engine, no ComfyUI and no "your GPU" (it isn't theirs); anywhere else, the words it always had.
 */
const onPlace = (site: boolean | undefined, own: string, onSite: string): string => (site ? onSite : own);

/** Where open models run, inside a refusal: "on the open engine", or (an account's run on this install's GPUs) "with open models". */
const openEngine = (site: boolean | undefined): string => onPlace(site, "on the open engine", "with open models");

/** The one sentence for a run that can't be made (POOL_WORDS.failed in src/lib/relay.ts, kept equal by its test). */
export const SITE_FAILED_WORDS = "Sorry, this one couldn't be made.";

/** A request the composer refuses, in words (status: the HTTP status the server answers with). */
export class ComposeError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ComposeError";
  }
}

export interface ComposeContext {
  generationId: string;
  op: Operation;
  catalog: ComposeCatalog;
  /**
   * A small file the composer makes itself (a fade curve, a speech fade, a palette swatch): put it where the graph reads
   * it, and return the name LoadImage / LoadAudio take.
   */
  made: (data: Buffer, contentType: string, name: string) => Promise<string>;
  /** Header facts (duration, size, fps, audio track) of an uploaded clip or track, by its ComfyUI name. */
  media?: (name: string) => MediaInfo | undefined;
  /** The ComfyUI server's RAM in bytes, for graphs that hold a whole clip in memory. */
  serverRam?: () => Promise<number | undefined>;
  /** The server's first torch device type ("cuda", "cpu", "mps"…; GET /system_stats devices[0].type): DBS picks its model by it. */
  device?: () => Promise<string | undefined>;
  /** Where a model file is on the server's disk (comfyModelPath), undefined when it can't say: Zen Image Edit's loader reads paths. */
  modelPath?: (folder: string, name: string) => Promise<string | undefined>;
  /** The first device's memory in bytes (GET /system_stats devices[0].vram_total): the Watermark Remover's repair size. */
  vram?: () => Promise<number | undefined>;
  /** The DBS models on the server's disk (GET /models/dbs), undefined when it can't say: a run never gets one that isn't there. */
  dbsModels?: () => Promise<DbsModel[] | undefined>;
  /** The RE-USE files on the server's disk (GET /models/reuse): null without ComfyUI-RE-USE, undefined when it can't say. */
  reuseModels?: () => Promise<ReuseModel[] | null | undefined>;
  /** Whether the server has the ComfyUI-Idol pack (GET /object_info/IdolPruneSplat): Idol 3D then runs its clean graph. */
  idolPack?: () => Promise<boolean | undefined>;
  /**
   * The route puts the run's one LoRA in the graph's own LoRA slot (ModelRoute.loraSlot: Fuobe Speak's FusioniX on kijai's
   * InfiniteTalk graph, with the settings it goes with). Without it a graph with no model loader refuses a LoRA.
   */
  loraSlot?: boolean;
  /** The params.extra keys whose files this run sent (any other file named there is dropped for an account's run). */
  sent?: Iterable<string>;
  /** An account's run on this install's GPUs: params.extra never names a file there that this run didn't send. */
  accountOnInstall?: boolean;
  /** The studio's own ComfyUI (not an account's, a link's or a computer's): only it keeps H3 Person Removal's review. */
  ownStudio?: boolean;
}

/** The request a composer used: its workflow (or template), its operation, its input and the files it made, in order. */
export interface ComposeRequest {
  endpoint: string;
  op: string;
  input: GenInput;
  made: string[];
  loraSlot?: boolean;
}

/** How big a job is (src/lib/job-ticket.ts TicketSize): its largest picture, its longest clip and the results asked for. */
export interface ComposedSize {
  megapixels: number;
  seconds: number;
  outputs: number;
}

export interface ComposedPrompt {
  manifest: ManifestWorkflow;
  workflow: ComfyWorkflow;
  meta: Record<string, unknown>;
  size: ComposedSize;
  /** The params.extra keys it dropped: an account's file input this run didn't send (a job ticket leaves them out too). */
  dropped: string[];
}

/**
 * A job's size: the largest picture it makes or reads (width × height in megapixels), the longest clip (its length, its
 * frames at its rate, or an input's length) and the results asked for.
 */
function jobSize(values: Partial<Record<BindingKey, unknown>>, input: GenInput, media: ComposeContext["media"]): ComposedSize {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  let pixels = n(values.width) * n(values.height);
  let seconds = Math.max(n(values.duration), n(values.frames) && n(values.fps) ? n(values.frames) / n(values.fps) : 0);
  const files = [...(input.images ?? []), input.endImage, input.mask, input.video, ...(input.videos ?? []), input.audio, ...(input.audios ?? []), input.voiceAudio, input.voiceAudio2];
  for (const f of files) {
    const m = typeof f === "string" && f ? media?.(f) : undefined;
    if (!m) continue;
    pixels = Math.max(pixels, n(m.width) * n(m.height));
    seconds = Math.max(seconds, n(m.videoDuration ?? m.duration));
  }
  return { megapixels: Math.round(pixels / 1e3) / 1e3, seconds: Math.round(seconds * 1000) / 1000, outputs: Math.max(1, Math.round(n(input.numOutputs)) || 1) };
}

// ---------------------------------------------------------------------------
// Building the prompt

/** Loader classes whose input is an uploaded file, and which input holds it (AusBoss's Crop + Rotate + Pad loads the upload itself). */
const MEDIA_LOADERS: Record<string, string> = {
  LoadImage: "image",
  LoadImageMask: "image",
  LoadVideo: "file",
  VHS_LoadVideo: "video",
  LoadAudio: "audio",
  VHS_LoadAudioUpload: "audio",
  AUSBOSS_NODES_ImageCropRotatePad: "image",
  // Any Angle's saved 3D view (a .spz sent like any input).
  Load3D: "model_file",
};

/** Inputs a workflow handles its own way (the manifest doesn't say). */
const SLOT_RULES: Record<string, { reuse?: boolean; required?: string[]; hints?: Record<string, string>; views?: ViewSlots }> = {
  // Edit graphs whose extra images feed TextEncodeQwenImageEditPlus: a repeated reference is harmless.
  "qwen-image-edit-2511-multi": { reuse: true },
  "storyboard-qwen-edit-2509-next-scene": { reuse: true },
  "tryon-flux2-klein-4b": { required: ["image2"], hints: { image: "Add a photo of the person", image2: "Add the garment to try on" } },
  // Its describer reads the outfit photo; the words graph (outfit-swap-qwen-image-21-text) runs when there is none.
  "outfit-swap-qwen-image-21": { required: ["image2"], hints: { image: "Add your photo", image2: "Add the outfit photo, or describe the outfit" } },
  "palette-transfer-image": { hints: { image2: "Pick a palette or add a reference image" } },
  "palette-transfer-video": { hints: { image: "Pick a palette or add a reference image" } },
  "relight-qwen-edit-2509-reference": { hints: { image2: "Add the photo whose light to copy" } },
  "face-swap-reactor": { hints: { image2: "Add the face to put in" } },
  // Qwen-Image 2.1's encoder takes its references as optional inputs: without the head it would run as a plain edit.
  "head-swap-qwen-image-21": { required: ["image2"], hints: { image: "Add the photo to keep", image2: "Add a photo of the head to put in" } },
  "video-swap-wan-vace": { hints: { image: "Add a picture of what goes in" } },
  "video-insert-wan-vace": { hints: { image: "Add a picture of what to add", mask: "Paint where it goes on the first frame" } },
  // Pixal3D multi-view: the front, then any of the other sides.
  "image-to-3d-trellis2-multiview": { hints: { image: "Add a photo of the front" }, views: { sides: ["front", "left", "back", "right"], into: "Pixal3DMultiViewConditioning" } },
};

/**
 * Encoders that take their extra references as optional inputs (Qwen-Image 2.1's and FIBO 2's image list, Krea 2 Edit's
 * person): a reference left out goes with the nodes only it feeds, and the encoder runs on the ones it was given.
 * Slots drop from the last, so an encoder's numbered inputs never have a gap.
 */
const OPTIONAL_REFERENCE_INPUTS: ReadonlySet<string> = new Set([
  "TextEncodeQwenImage21",
  "TextEncodeFibo2",
  "Krea2EditModelPatch",
  "Krea2EditGroundedEncode",
  // FLUX 3 Image Klein's edit: its references on one ReferenceMultiLatent, and the batch its prompt helper looks at.
  "ReferenceMultiLatent",
  "BatchImagesNode",
  // Qwen-Image 2.1 on a small GPU: Zen Image Edit's encoder takes image_2-4 the same way.
  "ZenImage21TextEncode",
]);

/** Uploads that are sides of one object (image = the first side, image2 the second…), and the node they all go into. */
interface ViewSlots {
  sides: string[];
  into: string;
}

const IMAGE_SLOTS = ["image", "image2", "image3", "image4"] as const;
/** Every reference slot a graph can bind, in order (FLUX 3 Image Klein's edit takes 10). */
const REFERENCE_SLOTS = ["image", "image2", "image3", "image4", "image5", "image6", "image7", "image8", "image9", "image10"] as const;

/**
 * Which slot each photo of a multi-view 3D model goes to: params.extra.views names the side of each photo
 * ("front", "left"…), in the order of the images; without names they are the sides in order.
 */
export function viewSlots(views: ViewSlots, images: string[], named: unknown): Partial<Record<(typeof IMAGE_SLOTS)[number], string>> {
  const sides = Array.isArray(named) ? named.map((v) => String(v).toLowerCase()) : views.sides.slice(0, images.length);
  if (sides.length !== images.length) throw new ComposeError(`${images.length} photo${images.length === 1 ? "" : "s"} but ${sides.length} side${sides.length === 1 ? "" : "s"} named`);
  const out: Partial<Record<(typeof IMAGE_SLOTS)[number], string>> = {};
  sides.forEach((side, i) => {
    const at = views.sides.indexOf(side);
    if (at < 0 || at >= IMAGE_SLOTS.length) throw new ComposeError(`A photo's side must be ${views.sides.join(", ")} (got “${side}”)`);
    if (out[IMAGE_SLOTS[at]]) throw new ComposeError(`Two photos of the ${side}: keep one`);
    out[IMAGE_SLOTS[at]] = images[i];
  });
  return out;
}

const MEDIA_HINT: Record<string, string> = {
  image: "Add an image",
  image2: "Add a second image",
  image3: "Add a third image",
  image4: "Add a fourth image",
  image5: "Add a fifth image",
  image6: "Add a sixth image",
  image7: "Add a seventh image",
  image8: "Add an eighth image",
  image9: "Add a ninth image",
  image10: "Add a tenth image",
  endImage: "Add an end frame",
  splatFile: "Build the 3D view first",
  mask: "Paint the area to change",
  video: "Add a video",
  video2: "Add a second clip",
  video3: "Add a third clip",
  video4: "Add a fourth clip",
  audio: "Add an audio track",
  audio2: "Add the second audio track",
  paletteImage: "Pick a palette first",
};

/** Binding keys that point at an upload (LoadImage / LoadVideo / LoadAudio…). */
export function mediaKeys(manifest: ManifestWorkflow, workflow: ComfyWorkflow): string[] {
  return Object.entries(manifest.bindings)
    .filter(([, targets]) => targets?.some((t) => MEDIA_LOADERS[workflow[t.node]?.class_type ?? ""] === t.input))
    .map(([k]) => k);
}

/**
 * The canvas a Qwen-Image 2.1 Lightning run samples (its sigmas follow the size): text to image's width × height; an edit's
 * image 1 scaled to 2048 on its long side (the graph's scaling, up or down); inpaint's 1.5 MP crop and expand's 1 MP canvas.
 */
function lightningCanvas(capability: string, values: Partial<Record<BindingKey, unknown>>, image: MediaInfo | undefined): { width: number; height: number } | undefined {
  if (capability === "t2i") {
    const [w, h] = [Number(values.width), Number(values.height)];
    return w > 0 && h > 0 ? { width: w, height: h } : undefined;
  }
  // Only the area counts (tokens of 16 × 16 px): 1.5 MP and 1 MP squares.
  if (capability === "inpaint") return { width: 1254, height: 1254 };
  if (capability === "outpaint") return { width: 1024, height: 1024 };
  // An edit: image 1 scaled to 2048 on its long side, larger or smaller (the graph's ImageScaleToMaxDimension). Without its
  // size the graph keeps its own schedule, made for a 2048 square.
  return image?.width && image.height ? editCanvas(image.width, image.height) : undefined;
}

/** Caption cues for the burn-in: params.extra.cues, or the prompt's "start-end: text" / SRT lines. */
function captionCues(input: GenInput, extra: Record<string, unknown>): CaptionCue[] {
  const given = Array.isArray(extra.cues)
    ? (extra.cues as Partial<CaptionCue>[]).map((c) => ({ start: Number(c.start), end: Number(c.end), text: String(c.text ?? "") })).filter((c) => Number.isFinite(c.start) && c.end > c.start && c.text.trim())
    : parseCueLines(input.prompt);
  return splitCueWords(given, Number(extra.wordsPerCaption ?? 0));
}

const seconds = (n: number) => (n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10));

/**
 * Per-frame restyle graphs that follow the clip when a run sets nothing else (Edit video sends a clip and words): the clip's
 * shape, its frame rate up to FOLLOW_CLIP_MAX_FPS, and its whole length. The Mixed Media studio sends its own size, rate and
 * frame count (src/lib/catalog/mixed-media.ts), and those win.
 */
const FOLLOW_CLIP: ReadonlySet<string> = new Set(["mixed-media-zimage-frames"]);
const FOLLOW_CLIP_MAX_FPS = 24;
const GB = 2 ** 30;

const clipFacts = (clip: MediaInfo | undefined) => ({ width: clip?.width, height: clip?.height, fps: clip?.fps, frames: clip?.frames, duration: clip?.videoDuration ?? clip?.duration });

/**
 * Values and graph edits for the Upscale hub's open tools, from the request and the clip's header:
 * VHS format / profile (export), CreateVideo's colour space (HDR10 PQ or HLG), FPS Boost's multiplier m,
 * selection n and slow motion (src/lib/av/fps.ts), the chunked upscalers' short side and pass size.
 * `holds` = frame-sized copies of the whole clip the graph keeps in memory (for the RAM check).
 */
function videoFinishValues(manifest: ManifestWorkflow, input: GenInput, clip: MediaInfo | undefined, extra: Record<string, unknown>, site?: boolean) {
  const b = manifest.bindings;
  const d = manifest.defaults;
  const facts = clipFacts(clip);
  const values: Partial<Record<BindingKey, unknown>> = {};
  const out = { values, wholeClip: null as ReturnType<typeof wholeClipTool>, bypassInterpolation: false, dropSound: false };
  try {
    // Export: VideoHelperSuite's format and ProRes profile.
    if (manifest.capability === "export-video" && b.format) {
      const v = exportValues(input.format);
      values.format = v.format;
      if (v.profile) values.profile = v.profile;
    }
    // SDR to HDR: HLG or PQ (HDR10's curve).
    if (manifest.capability === "sdr-to-hdr" && b.colorSpace) values.colorSpace = hdrColorSpace(input.format);
  } catch (e) {
    throw new ComposeError((e as Error).message);
  }
  // Graphs that decode the whole clip (src/lib/av/video-finish.ts wholeClipTool says how many copies they hold).
  if (manifest.capability === "sdr-to-hdr") out.wholeClip = wholeClipTool("sdr-to-hdr", input.format);
  if (manifest.id === "video-export-exr") out.wholeClip = wholeClipTool("export-video", "exr");
  if (manifest.capability === "video-fix-faces") out.wholeClip = wholeClipTool("face-fix-video", undefined);
  // FPS Boost: interpolate by m, keep every n-th frame (the graph computes the output frame rate itself).
  if (b.every && b.multiplier) {
    const target = input.targetFps;
    const slowdown = Math.max(1, Math.round(input.slowdown ?? 1));
    let m = Number(extra.multiplier ?? d.multiplier ?? 2);
    let n = 1;
    // m, n and the slow-motion factor go together: a stray params.extra value can't break the ratio.
    for (const k of ["multiplier", "every", "slowdown"]) delete extra[k];
    if (target) {
      // m and n come from the clip's own rate (the upload's header, else what the server read from it).
      const sourceFps = clip?.fps && clip.fps > 0 ? clip.fps : input.sourceFps && input.sourceFps > 0 ? input.sourceFps : undefined;
      if (!sourceFps) {
        throw new ComposeError(
          `FPS Boost ${openEngine(site)} works out its frames from the clip's frame rate, and this file doesn't say what it is, so ${target} fps can't be hit. Re-save it as MP4 (H.264) or WebM and try again`,
        );
      }
      const plan = fpsPlan(sourceFps, target, slowdown, Number(manifest.limits?.maxMultiplier ?? 16));
      m = plan.multiplier;
      n = plan.every;
    } else m = Math.max(2, Math.min(Number(manifest.limits?.maxMultiplier ?? 16), Math.round(m * slowdown)));
    // m 1 (a target the clip's rate is a whole multiple of: 60 → 30 keeps every 2nd frame): FrameInterpolate is
    // linked out below, and the graph's frame-rate expression still reads m, so it gets the real 1. Other lower
    // targets still interpolate (30 → 24 is m 4, n 5).
    values.multiplier = m;
    values.every = n;
    values.slowdown = slowdown;
    out.bypassInterpolation = m < 2;
    out.dropSound = slowdown > 1;
    out.wholeClip = wholeClipTool("interpolate", undefined, m);
  }
  // Chunked upscaling: the shorter edge asked for, and passes that hold about 1.5 GB of frames.
  if (b.shortSide) {
    const shortSide = upscaleShortSide(input.resolution, Number(d.shortSide ?? 1080));
    values.shortSide = shortSide;
    if (b.framesPerBatch && extra.framesPerBatch === undefined) {
      const seedvr = /seedvr/i.test(manifest.id);
      // RTX Video Super Resolution writes the scaled frame itself (1-4x, the graph's own factor), not a fixed 4x one.
      const rtx = manifest.id === RTX_UPSCALE_WORKFLOW;
      const modelScale = seedvr ? 0 : rtx ? rtxScale(facts, shortSide) : 4;
      // ESRGAN on a big source (1440p → 2160p: about 0.85 GB a frame): down to one frame a pass, to stay near the budget.
      values.framesPerBatch = framesPerPass(facts, { shortSide, modelScale, fourNPlusOne: seedvr, min: seedvr ? 5 : 1, max: seedvr ? 33 : 64, fallback: Number(d.framesPerBatch ?? 16) });
    }
  } else if (b.framesPerBatch && manifest.capability === "export-video" && extra.framesPerBatch === undefined) {
    values.framesPerBatch = framesPerPass(facts, { min: 8, max: 256, fallback: Number(d.framesPerBatch ?? 64) });
  } else if (b.framesPerBatch && manifest.capability === "video-tone" && extra.framesPerBatch === undefined) {
    // Fix colours: a pass holds three frame-sized copies (the decoded frames, the softened ones, the toned ones).
    values.framesPerBatch = framesPerPass(facts, { modelScale: 1, min: 8, max: 128, fallback: Number(d.framesPerBatch ?? 48) });
  }
  return out;
}

/** Per-job length limits a graph enforces (manifest limits.maxDurationSec), in words. */
const OVER_LIMIT: Record<string, (s: number, site?: boolean) => string> = {
  "still-motion": (s, site) => `Ken Burns ${openEngine(site)} makes up to ${s} s per clip — split a longer move into pieces`,
  "audio-loop": (s, site) => `Loops ${openEngine(site)} run up to ${s / 60} minutes (${s} s)`,
  music: (s, site) => {
    const most = s % 60 ? `${s} s` : `${s / 60} minutes`;
    return onPlace(site, `This model writes songs up to ${most} on your GPU: pick a shorter length`, `This model writes songs up to ${most}. Pick a shorter length.`);
  },
};

/** Songs longer than this decode in tiles on your GPU (MiniMax Music 3's switch). */
export const TILED_SONG_SECONDS = 120;

/**
 * Turn a canonical request into the exact ComfyUI prompt: picks the workflow variant, maps Fuobe's inputs
 * onto the workflow's bindings (sizes, frames, trim times, languages, palettes, layers…), makes the small files the
 * graph reads (palette swatches, fade curves: `ctx.made`) and rewrites graphs that depend on the request (caption
 * cues, left-out references). What the uploads' headers say (`ctx.media`) sizes clips to their source, checks
 * times against the clip's length and times lip re-sync by the voice. Reads the catalog through `ctx.catalog`.
 */
export async function composeWorkflow(endpointTemplate: string, input: GenInput, ctx: ComposeContext): Promise<ComposedPrompt> {
  // "video-concat-{n}": one workflow per clip count.
  const clips = input.videos ?? [];
  if (endpointTemplate.includes("{n}") && clips.length > 4) throw new ComposeError(onPlace(ctx.accountOnInstall, "ComfyUI joins up to 4 clips at a time", "Up to 4 clips can be joined at a time."));
  const extra: Record<string, unknown> = { ...(input.extra ?? {}) };
  // The second audio track (mux background): the canonical input when the runtime sends it, else params.extra.audio2.
  const given2 = (input as GenInput & { audio2?: unknown }).audio2;
  const audio2 = typeof given2 === "string" && given2 ? given2 : undefined;
  if (audio2) delete extra.audio2;

  // params.extra's settings that name a file this run sent (the caller sent them before composing).
  const sentHere = new Set<string>(ctx.sent ?? []);
  // The variant this request runs (one graph per clip count, the single-track soundtrack, EXR frames, a Fun Camera pose,
  // the product shot): src/lib/comfy-variants.ts, which the GPU pre-flight's gate reads too. A LoRA mixed into a pose is
  // injected on its experts as on the plain image-to-video graph.
  let endpoint = resolveWorkflowId(endpointTemplate, {
    op: ctx.op,
    clips: clips.length,
    images: input.images?.length ?? 0,
    format: input.format,
    audio2: !!audio2 || !!extra.audio2,
    audio: !!input.audio,
    mask: !!input.mask,
    extra,
    has: (id) => ctx.catalog.has(id),
  });
  // Idol 3D: the clean graph (ComfyUI-Idol's crop, the pruned splat, the input-view still) where the server has the pack,
  // else the core graph, whose saved file isn't pruned (its splat says so: meta.pruned false).
  if (endpoint === IDOL_WORKFLOWS.core && ctx.catalog.has(IDOL_WORKFLOWS.clean) && (await ctx.idolPack?.().catch(() => undefined)) === true) {
    endpoint = IDOL_WORKFLOWS.clean;
  }
  // Idol 3D's four views need the pack's camera (IdolCamera): with no pack (or the pack switched off in Settings), say so
  // instead of a missing-node error. Unknown (someone's computer, a server that didn't answer): their ComfyUI has the last word.
  if (endpoint === IDOL_VIEWS_WORKFLOW && (await ctx.idolPack?.().catch(() => undefined)) === false) throw new ComposeError(IDOL_VIEWS_NEEDS_PACK, 400);
  delete extra[IDOL_VIEWS_PARAM];
  delete extra.productShot;
  delete extra[SPEED_PARAM];
  delete extra[GPU_PARAM];
  delete extra[DECODER_PARAM];

  const { manifest, workflow } = ctx.catalog.get(endpoint);
  const d = manifest.defaults;
  const b = manifest.bindings;
  const rules = SLOT_RULES[manifest.id] ?? {};
  const images = input.images ?? [];
  const values: Partial<Record<BindingKey, unknown>> = {
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    image: images[0],
    image2: images[1],
    image3: images[2],
    image4: images[3],
    // FLUX 3 Image Klein's edit binds up to ten references.
    ...Object.fromEntries(REFERENCE_SLOTS.slice(4).map((k, i) => [k, images[i + 4]])),
    endImage: input.endImage,
    mask: input.mask,
    video: input.video ?? clips[0],
    video2: clips[1],
    video3: clips[2],
    video4: clips[3],
    audio: input.audio,
    // A 3D model to work on (Hi3D's refine reads the coarse GLB from ComfyUI's input folder, where it was uploaded).
    model3d: input.model3d,
    seed: input.seed !== undefined && input.seed >= 0 ? input.seed : randomSeed(),
  };
  // A multi-view 3D model: each photo goes to its side.
  if (rules.views) Object.assign(values, { image: undefined, image2: undefined, image3: undefined, image4: undefined }, viewSlots(rules.views, images, extra.views));
  delete extra.views;
  // Voice workflows: "audio" is the voice to speak with (TTS), speaker A (dialogue) or the speech to convert
  // (voice change, whose target voice is "audio2").
  if (ctx.op === "tts") values.audio = input.voiceAudio ?? input.audio;
  if (ctx.op === "dialogue") {
    values.audio = input.voiceAudio;
    values.audio2 = input.voiceAudio2;
    values.prompt = (input.dialogue ?? []).filter((l) => l.text.trim()).map((l) => `SPEAKER ${l.voice === "B" ? "B" : "A"}: ${l.text.trim()}`).join("\n");
  }
  if (ctx.op === "voice-change") values.audio2 = input.voiceAudio;
  // Design a voice (Qwen3-TTS, VoxCPM2): the voice in words; a clone reads what its sample says (VoxCPM2's "ultimate" clone).
  if (ctx.op === "voice-design") values.voiceDescription = input.voiceDescription?.trim();
  if (ctx.op === "tts" && b.voiceTranscript && input.voiceTranscript?.trim()) values.voiceTranscript = input.voiceTranscript.trim();
  // VoxCPM2's device combo lists what the GPU has (cuda, mps, cpu): the server's first torch device, else the graph's cuda.
  if (b.device && extra.device === undefined) {
    const dev = await ctx.device?.();
    if (dev === "cuda" || dev === "mps" || dev === "cpu") values.device = dev;
  }
  // A join of audio clips takes them in order: the graph binds the first two, expandAudioJoinWorkflow the rest.
  const audios = input.audios ?? [];
  if (manifest.expand === "audios" && audios.length) {
    values.audio = audios[0];
    values.audio2 = audios[1];
  }
  // A voice track on the video's timeline: the clips are the spoken lines (the template binds the first).
  if (ctx.op === "timeline") values.audio = input.audios?.[0] ?? input.audio;
  // Speech workflows read the soundtrack with LoadAudio, which also takes a video upload.
  if ((ctx.op === "transcribe" || ctx.op === "separate-audio" || ctx.op === "enhance-voice" || ctx.op === "translate" || ctx.op === "speech-edit") && b.audio && !b.video) values.audio = input.audio ?? input.video ?? clips[0];
  if (b.language && input.targetLanguage) values.language = input.targetLanguage;
  if (b.sourceLanguage && input.sourceLanguage) {
    const whisper = b.sourceLanguage.some((t) => workflow[t.node]?.class_type === "Apply Whisper");
    values.sourceLanguage = whisper ? whisperLanguage(input.sourceLanguage) : asrLanguage(input.sourceLanguage);
  }
  if (b.instruction) {
    const template = String(extra.instruction ?? d.instruction ?? "");
    delete extra.instruction;
    if (template.includes("{language}") && !input.targetLanguage) throw new ComposeError("Pick a language to translate into");
    values.instruction = template.replaceAll("{language}", languageName(input.targetLanguage));
  }

  // What the upload headers say about the clip (and the voice).
  const clip = ctx.media?.(String(values.video ?? ""));
  const clipLength = clip?.videoDuration ?? clip?.duration;

  // Frame rate (params.fps, or a model's fps control), trim window and frame counts.
  const fpsIn = input.fps ?? (typeof extra.fps === "number" && extra.fps > 0 ? extra.fps : undefined);
  if (b.fps && fpsIn) values.fps = fpsIn;
  const followClip = FOLLOW_CLIP.has(manifest.id) && ctx.op === "v2v" && !!clip;
  if (followClip && b.fps && !fpsIn && clip?.fps && clip.fps > 0) values.fps = Math.max(1, Math.min(FOLLOW_CLIP_MAX_FPS, Math.round(clip.fps)));
  const fps = Number(values.fps ?? d.fps ?? 16);
  const start = Math.max(0, input.startTime ?? 0);
  if (b.startTime || b.startFrame) {
    if (input.endTime !== undefined && input.endTime <= start) throw new ComposeError("The end time must be after the start time");
    if (clipLength && start >= clipLength) throw new ComposeError(`The start time is past the end of the clip (it is ${seconds(clipLength)} s long)`);
  }
  // Sound for a video with no length asked for: as long as the clip (up to 30 s, and what the frame cap holds).
  const soundLength =
    ctx.op === "v2a" && b.duration && input.endTime === undefined && !input.duration && clipLength
      ? Math.min(30, Number(manifest.limits?.maxFrames ?? Infinity) / fps, Math.ceil(clipLength * 10) / 10)
      : undefined;
  const span = input.endTime !== undefined ? Math.max(0, input.endTime - start) : (input.duration ?? soundLength);
  if (b.startTime && input.startTime !== undefined) values.startTime = start;
  if (b.startFrame && input.startTime !== undefined) values.startFrame = Math.round(start * fps);
  if (b.duration) {
    if (input.endTime !== undefined) values.duration = span;
    else if (input.duration) values.duration = input.duration;
    else if (soundLength) values.duration = soundLength;
    else if (ctx.op === "trim") values.duration = 0; // from the start time to the end
  }
  // MiniMax H3 stretches the start frame to the canvas with no crop: a clip from a still (or the orbit of one) always takes the
  // still's shape, so an aspect ratio left over from a text draft can't distort it.
  const h3 = isH3Graph(manifest.id);
  // The clip's own size: its upload's header, else what the server read from the file before sending it (sourceSize).
  const clipSize = clip?.width && clip.height ? clip : input.sourceSize?.width && input.sourceSize.height ? input.sourceSize : undefined;
  // Motion transfer crops the driving clip to the canvas, so the canvas always takes the clip's shape: a run that names
  // none (the Motion control studio) fell back to the graph's portrait 482 × 854 and cut a landscape clip's sides off.
  const followDriver = ctx.op === "motion-transfer" && !!b.video && !!clipSize;
  // References (Pika H3 Flex Ref2VA) are not frames: the aspect ratio asked for holds ("auto" takes Image 1's shape).
  const asFrames = h3 && (ctx.op === "i2v" || ctx.op === "flf2v" || (!!b.image && manifest.expand !== "references"));
  const aspectRatio = asFrames || (h3 && ctx.op === "avatar") ? "auto" : (followClip && !input.aspectRatio) || followDriver ? "auto" : input.aspectRatio;
  if (b.width || b.height) {
    const multiple = Number(manifest.limits?.dimensionMultiple ?? 16);
    // With motion paths the frame keeps the start image's shape, so the paths need no cropping;
    // "auto" keeps the source clip's shape when its header told us.
    const srcAspect = (extra.motionPaths as MotionPaths | undefined)?.aspect;
    // "auto" keeps the source clip's shape when its header told us, else the start frame's (image-to-video).
    const still = aspectRatio === "auto" && !clipSize ? ctx.media?.(String(values.image ?? "")) : undefined;
    const src = clipSize ?? (still?.width && still.height ? still : undefined);
    const shape = srcAspect ? `${srcAspect[0]}:${srcAspect[1]}` : aspectRatio === "auto" ? (src ? `${src.width}:${src.height}` : undefined) : aspectRatio;
    if (h3) {
      // H3's own canvas (ComfyUI's adapt_canvas): 768 px on the short side, at most 768 × 1344, multiples of 32.
      Object.assign(values, h3Canvas(shape));
    } else {
      const dims = computeDimensions(shape, input.resolution, { width: Number(d.width ?? 1024), height: Number(d.height ?? 1024) }, multiple);
      // Respect the workflow's size limits while keeping the aspect ratio.
      const maxW = Number(manifest.limits?.maxWidth ?? Infinity);
      const maxH = Number(manifest.limits?.maxHeight ?? Infinity);
      const k = Math.min(1, maxW / dims.width, maxH / dims.height);
      values.width = Math.max(multiple, Math.floor((dims.width * k) / multiple) * multiple);
      values.height = Math.max(multiple, Math.floor((dims.height * k) / multiple) * multiple);
    }
  }
  // An end card appended to an ad (video-append-endcard): the card is encoded at the ad's own size and frame rate,
  // so the ad's packets are copied as they are. Only the ad's header knows them.
  if (manifest.id === "video-append-endcard") {
    if (!clip?.width || !clip.height || !clip.fps) throw new ComposeError("Couldn't read the ad's size and frame rate, so the end card can't be added");
    Object.assign(values, { width: clip.width, height: clip.height, fps: Math.round(clip.fps * 1000) / 1000 });
  }
  if (b.frames && span) {
    if (h3) {
      // H3's 17n + 5 grid at 24 fps (3 s → 73, 5 s → 124, 10 s → 243, 15 s → 362): the clip h3Prompt's end-frame mark names.
      const cap = Number(manifest.limits?.maxFrames ?? Infinity);
      let frames = h3Frames(span);
      while (frames > cap) frames -= 17;
      values.frames = frames;
    } else values.frames = computeFrames(span, fps, Number(d.frameStep ?? 4), manifest.limits?.maxFrames);
  } else if (followClip && b.frames && !span && extra.frames === undefined && clipLength) {
    // The whole clip from its start (or the start time asked), refused past the graph's frame cap rather than cut short.
    const frames = Math.max(1, Math.floor((clipLength - start) * fps));
    const cap = Number(manifest.limits?.maxFrames ?? Infinity);
    if (frames > cap) {
      throw new ComposeError(`This model redraws up to ${cap} frames per job ${openEngine(ctx.accountOnInstall)} (${seconds(cap / fps)} s at ${fps} fps; this clip is ${seconds(clipLength - start)} s) — trim the clip, or pick a range and a frame rate in the Mixed Media studio`);
    }
    values.frames = frames;
  }
  // Lip re-sync and a talking avatar run as long as the voice (its header, or the length the run was given); a voice past
  // the frame cap is refused, not cut.
  const voiceLength =
    (ctx.op === "lipsync" || ctx.op === "avatar") && b.frames && !span
      ? (ctx.op === "avatar" && input.sourceDuration && input.sourceDuration > 0 ? input.sourceDuration : ctx.media?.(String(values.audio ?? ""))?.duration)
      : undefined;
  if (voiceLength && h3) {
    // H3 makes the clip with its own sound, on its 17n + 5 grid: as long as the voice, 5-15 s (the reference limits say why not).
    values.frames = h3Frames(Math.min(15, Math.max(5, voiceLength)));
  } else if (voiceLength) {
    const step = Number(d.frameStep ?? 4);
    const frames = Math.ceil((voiceLength * fps) / step) * step + 1;
    const cap = Number(manifest.limits?.maxFrames ?? 0);
    if (cap && frames > cap) {
      const what = ctx.op === "avatar" ? "A talking avatar" : "Lip re-sync";
      throw new ComposeError(`${what} ${openEngine(ctx.accountOnInstall)} takes up to ${seconds(cap / fps)} s of speech per job (this voice is ${seconds(voiceLength)} s) — split it into shorter parts`);
    }
    values.frames = frames;
  }
  // Kandinsky VSR: the factor asked (params.resolution "2x" / "2.25x" / "4x") as the pack's combo, and the latent upscaler bank
  // entry it needs (2x serves 2x and 2.25x).
  if (b.upscalerScale) {
    const k = factorTier(input.resolution) ?? factorTier(String(d.scale ?? "")) ?? 2.25;
    if (![2, 2.25, 4].includes(k)) throw new ComposeError("Kandinsky VSR upscales 2x, 2.25x or 4x", 400);
    values.scale = `${k}x`;
    values.upscalerScale = k === 4 ? "4x" : "2x";
  }
  // Video finishing (Upscale hub): export formats, HDR curves, FPS Boost's m / n, chunked upscaling.
  const finish = videoFinishValues(manifest, input, clip, extra, ctx.accountOnInstall);
  Object.assign(values, finish.values);
  // Open-H3 Regenerate (video-regenerate-h3): the output size and the draft preset as the pack's strings, and the frames
  // this pass reads (its seconds at 24 fps, at most 15 s); the words are what it redraws from (regenerate.ts).
  if (manifest.id === REGEN_WORKFLOW) {
    if (!(typeof values.prompt === "string" && values.prompt.trim())) throw new ComposeError("Regenerate redraws the clip from words: describe what is in it", 400);
    const length = span ?? (clipLength !== undefined ? Math.max(0, clipLength - start) : input.sourceDuration);
    // One pass reads at most 15 s: a longer one (a clip from an earlier step) is refused, never cut short.
    if (length !== undefined && length > REGEN_WINDOW_SECONDS + 0.05) throw new ComposeError(regenOnePassRefusal(length), 400);
    values.resolution = regenResolution(input.resolution);
    values.draftSize = draftSizeFor({ fromH3: extra.draftFrom === "h3" });
    values.frames = regenFrames(length);
    delete extra.draftFrom;
  }
  // MiniMax H3 at 2K (n7-10): the 768p draft saves its latent under a name made from its run's id, and the finish loads
  // that file (the same ComfyUI keeps it in output/open_h3_latents/), redrawing it at the size asked from the same words.
  if (manifest.id === H3_LATENT_DRAFT_WORKFLOW) {
    values.latentPrefix = latentPrefixFor(ctx.generationId);
    delete extra.latentDraft;
  }
  if (manifest.id === REGEN_LATENT_WORKFLOW) {
    if (!(typeof values.prompt === "string" && values.prompt.trim())) throw new ComposeError("Regenerate redraws the clip from words: describe what is in it", 400);
    if (typeof extra.latentFrom !== "string" || !extra.latentFrom) throw new ComposeError("This take has no saved draft to finish from", 400);
    values.latent = latentFileFor(extra.latentFrom);
    values.resolution = regenResolution(input.resolution);
    delete extra.latentFrom;
    delete extra.draftFrom;
  }

  // Drawn motion paths (normalised to the start frame) → one pixel point per output frame (Wan-Move).
  const paths = extra.motionPaths as MotionPaths | undefined;
  delete extra.motionPaths;
  if (b.tracks && paths?.paths.length) {
    const frames = Number(values.frames ?? d.frames ?? 81);
    values.tracks = JSON.stringify(tracksFor(paths, Number(values.width ?? d.width ?? 832), Number(values.height ?? d.height ?? 480), frames));
  }
  if (b.tags && !b.prompt) values.tags = input.prompt;
  // MiniMax Music 3: a song over 2 minutes decodes in tiles (much less VRAM), as the template's Tiled decode switch offers.
  if (b.tiledDecode && extra.tiledDecode === undefined) values.tiledDecode = Number(values.duration ?? d.duration ?? 0) > TILED_SONG_SECONDS;
  if (b.description && !extra.description) values.description = input.prompt;
  if (b.numLayers && input.numLayers) values.numLayers = Math.max(1, Math.min(Number(manifest.limits?.maxLayers ?? 10), Math.round(input.numLayers)));

  // Ken Burns (kenburns-still): the move's zoom, crop centre and easing.
  if (b.zoomStart && input.zoomFrom !== undefined) values.zoomStart = input.zoomFrom;
  if (b.zoomEnd && input.zoomTo !== undefined) values.zoomEnd = input.zoomTo;
  if (b.panStartX && input.panFrom) Object.assign(values, { panStartX: input.panFrom.x, panStartY: input.panFrom.y });
  if (b.panEndX && input.panTo) Object.assign(values, { panEndX: input.panTo.x, panEndY: input.panTo.y });
  if (b.easeInOut && input.easing) values.easeInOut = input.easing === "linear" ? 0 : 1;
  const maxSeconds = Number(manifest.limits?.maxDurationSec ?? 0);
  if (maxSeconds && b.duration && Number(values.duration ?? d.duration ?? 0) > maxSeconds + 0.001) {
    throw new ComposeError(OVER_LIMIT[manifest.capability]?.(maxSeconds, ctx.accountOnInstall) ?? `This workflow makes up to ${maxSeconds} s per job`);
  }
  // Edit speech (speech-edit-auk): the edit windows the planner made, crossfaded back on a linear fade-in with a flat tail
  // (src/lib/av/speech-edit-graph.ts says why; both sides of a seam are the same voice, so equal power would bump the level).
  let speechWindows: SpeechWindow[] | null = null;
  const aukQuality = extra.quality === "best" ? "best" : "fast";
  if (manifest.expand === "speech") {
    speechWindows = readSpeechWindows(extra.speechWindows);
    if (!speechWindows) throw new ComposeError("Nothing to change: edit the words, or pick a range and an effect", 400);
    if (b.fadeCurve && extra.fadeCurve === undefined) extra.fadeCurve = await ctx.made(Buffer.from(speechFadeWav(Math.max(0.02, Number(input.crossfade ?? d.crossfade ?? 0.12)))), "audio/wav", "speech_fade.wav");
  }
  if (Object.values(workflow).some((n) => n.class_type === "AuKModelLoader")) {
    delete extra.speechWindows;
    delete extra.quality;
  }
  // Loops and joins with a crossfade: core ComfyUI has no gain ramp, so the curve is a tiny WAV written here
  // (left = fade-in, right = fade-out, exactly the crossfade long). Clips too short for it are refused up front.
  if (b.fadeCurve) {
    const fade = Math.max(0.02, Number(input.crossfade ?? d.crossfade ?? 1));
    if (b.crossfade) values.crossfade = fade;
    const loop = manifest.capability === "audio-loop";
    const lengths = (loop ? [values.audio] : audios.length ? audios : [values.audio, values.audio2 ?? extra.audio2]).map((name) => ctx.media?.(String(name ?? ""))?.duration);
    const problem = lengths.every((l): l is number => typeof l === "number") ? crossfadeProblem(lengths, fade, loop ? "loop" : "join") : null;
    if (problem) throw new ComposeError(problem);
    if (extra.fadeCurve === undefined) values.fadeCurve = await ctx.made(Buffer.from(fadeCurveWav(fade, extra.curve === "linear" ? "linear" : "equal-power")), "audio/wav", "fade_curve.wav");
  }
  delete extra.curve;

  // Soul HEX: the hex list as words, plus a swatch the ColorTransfer lock matches.
  const palette = (input.palette ?? []).filter((p) => typeof p === "string" && p.trim());
  if (palette.length) {
    const sentence = paletteSentence(palette);
    if (!sentence) throw new ComposeError("The palette has no valid hex colours (use #RRGGBB)");
    if (b.paletteText) values.paletteText = sentence;
    const swatchSlot = b.paletteImage ? "paletteImage" : ctx.op === "color-match" ? (b.image2 && !values.image2 ? "image2" : b.video && b.image && !values.image ? "image" : undefined) : undefined;
    if (swatchSlot) {
      const weights = Array.isArray(extra.paletteWeights) ? (extra.paletteWeights as number[]) : undefined;
      const px = Buffer.from(swatchPixels(palette, 512, 512, weights));
      values[swatchSlot] = await ctx.made(encodePng({ width: 512, height: 512, data: px }), "image/png", "palette_swatch.png");
    }
  } else if (b.paletteImage && images[0]) values.paletteImage = images[0]; // a swatch the user made
  delete extra.paletteWeights;

  // Trigger words a LoRA needs at the start of the prompt (try-on: "TRYON").
  const prefix = typeof d.promptPrefix === "string" ? d.promptPrefix.trim() : "";
  if (prefix && typeof values.prompt === "string" && values.prompt.trim() && !values.prompt.trim().startsWith(prefix)) values.prompt = `${prefix} ${values.prompt.trim()}`;
  // Framing text defaults with placeholders ("A {columns}x{rows} grid contact sheet of {count} film stills…").
  const columns = Number(extra.columns ?? d.columns ?? 0);
  const rows = Number(extra.rows ?? d.rows ?? 0);
  for (const key of Object.keys(b)) {
    const def = d[key];
    if (typeof def !== "string" || !def.includes("{") || values[key] !== undefined || extra[key] !== undefined) continue;
    values[key] = def.replaceAll("{columns}", String(columns)).replaceAll("{rows}", String(rows)).replaceAll("{count}", String(columns * rows)).replaceAll("{language}", languageName(input.targetLanguage));
  }

  // Remove object: the words name what SAM 3.1 follows (maskPrompt: the objects alone, comma-separated, each its own
  // SAM 3 prompt, so "Remove the red car from the shot" run straight from a Canvas works too) and the gap is filled
  // with the scene without it (params.extra.prompt, else a neutral default). No graph takes clicked points.
  // The painted eraser's last tracked mask (role "mask") is saved only for a window another one waits on.
  const handOff = ctx.op === "remove-object" && extra[HAND_OFF] === true;
  delete extra[HAND_OFF];
  if (ctx.op === "remove-object") {
    const words = input.prompt?.trim();
    if (b.maskPrompt) {
      if (!words && typeof extra.maskPrompt !== "string") throw new ComposeError(input.points?.length ? CLICK_OPEN_PROBLEM : "Say what to remove, e.g. “the coffee cup in her hand”");
      if (words) values.maskPrompt = targetPhrase(words);
    }
    if (b.prompt) values.prompt = REMOVE_SCENE;
  }
  // Genjutsu's Openjutsu modes (src/lib/openjutsu-graphs.ts): the settings travel as params.extra.openjutsu and are written
  // into the graph by node title after the media are bound; the pictures a request leaves out go with their branches.
  const openjutsu = OPENJUTSU_IDS.has(manifest.id) ? ((extra.openjutsu && typeof extra.openjutsu === "object" ? extra.openjutsu : {}) as OpenjutsuSettings) : null;
  delete extra.openjutsu;
  // Genjutsu's Character swap (MiniMax H3 on the h3_character_swap / H3 Relay packs): the part, the quality as the
  // unpatched pack's string, who to swap (SAM words, largest / leftmost / rightmost / index, or clicks moved into H3's
  // canvas), the swap LoRA's release, the window plan; the anchor first frame is images[1] (absent: its nodes go).
  const characterSwap = manifest.capability === "video-character-swap";
  let dropAnchor = false;
  let dropSwapLora = false;
  if (characterSwap) {
    values.quality = packResolution(input.resolution);
    // The pack's planning.validate_settings: windows 17n + 5, history 0, 1 or 17n + 1 and shorter than the window.
    if (extra.windowFrames !== undefined || extra.historyFrames !== undefined) {
      const plan = windowPlan(Number(extra.windowFrames ?? d.windowFrames ?? CHARACTER_SWAP.window), Number(extra.historyFrames ?? d.historyFrames ?? CHARACTER_SWAP.history));
      extra.windowFrames = String(plan.window);
      extra.historyFrames = String(plan.history);
    }
    const lora = typeof extra.lora === "string" ? extra.lora : undefined;
    delete extra.lora;
    if (lora === "none") dropSwapLora = true;
    else if (lora === "v1" || lora === "v1.5") values.lora = SWAP_LORAS[lora].file;
    if (input.points?.length) {
      if (!clip?.width || !clip.height) throw new ComposeError("Couldn't read the clip's size to place your clicks — pick who to swap instead");
      const [pos, neg] = samCoords(input.points, { width: clip.width, height: clip.height }, input.resolution);
      values.positiveCoords = pos;
      values.negativeCoords = neg;
      // SAM3_Detect puts the clicked mask first and the "person" detections after it: SelectSubject takes that first one
      // ("largest" would take whoever is biggest).
      extra.selection = "index";
      extra.subjectIndex = 0;
    }
    if (b.image2 && !values.image2) dropAnchor = true;
    // No words: Openjutsu's instruction, with the anchor sentence only when the anchor goes in (the graph's own text names it).
    if (!(typeof values.prompt === "string" && values.prompt.trim())) values.prompt = swapPrompt({ engine: "open", anchor: !!b.image2 && !dropAnchor });
  }
  // Character Swap Studio's segment (one H3 Relay pass): the previous take's master as history, the approved mask in
  // place of SAM's, the anchor after the boundary, masked generation off. Branches it doesn't use go after binding.
  // Media inputs a studio job leaves out on purpose (their branches go after binding).
  const studioLeft: string[] = [];
  // AuK's text to speech (speech-tts-auk, nm10-speech-edit): its instruction and length, written here since AuK's Prompt
  // Enhancer is off. Without a voice sample the loader goes (a voice from its description).
  let aukTts: { seconds: number; hasVoice: boolean } | null = null;
  if (manifest.id === "speech-tts-auk") {
    const hasVoice = !!values.audio;
    if (!hasVoice) studioLeft.push("audio");
    const sample = hasVoice ? (ctx.media?.(String(values.audio))?.duration ?? 0) : 0;
    try {
      aukTts = { seconds: ttsLength(String(input.prompt ?? ""), sample), hasVoice };
    } catch (e) {
      throw new ComposeError((e as Error).message, 400);
    }
    values.prompt = ttsInstruction(String(input.prompt ?? ""), { hasVoice, voiceDescription: input.voiceDescription });
  }
  let studioSegment: Omit<SegmentGraphOptions, "outputs"> | null = null;
  if (manifest.id === STUDIO_WORKFLOWS.segment) {
    const history = typeof extra.historyVideo === "string" && !!extra.historyVideo;
    if (!history) {
      studioLeft.push("historyVideo");
      for (const k of ["historyVideo", "historyStart", "historyLength"]) delete extra[k];
    } else {
      const start = Number(extra.historyStart);
      const length = Number(extra.historyLength);
      if (!Number.isInteger(start) || start < 0 || !Number.isInteger(length) || length < 1) throw new ComposeError("The continuation history needs the previous take's frame count");
    }
    const maskFile = typeof extra.maskVideo === "string" && extra.maskVideo ? extra.maskVideo : null;
    const span = input.endTime !== undefined ? Math.max(0, input.endTime - start) : Number(values.duration ?? 0);
    // The master keeps the segment's last frames (the next segment's history), not the whole 16-bit segment.
    const frames = Math.round(Number(extra.segmentFrames ?? 0));
    const keep = Math.round(Number(extra.masterKeep ?? frames));
    studioSegment = {
      anchor: !dropAnchor,
      history,
      anchorAfterHistory: extra.anchorAfterHistory === true,
      mask: maskFile ? { file: maskFile, start: Math.max(0, Number(extra.maskStart ?? 0)), duration: span } : null,
      useMask: extra.useMask !== false,
      masterTail: frames > 0 && keep > 0 && keep < frames ? { from: frames - keep, frames: keep } : null,
    };
    for (const k of ["maskVideo", "maskStart", "anchorAfterHistory", "useMask", "masterKeep", "segmentFrames"]) delete extra[k];
  }
  // Character Swap Studio's mask: who to swap on one frame of a shot (words, a selection or clicks moved into H3's
  // canvas), followed for spanFrames, spliced into the version it corrects (prevMask).
  let studioMask: Omit<MaskGraphOptions, "outputs"> | null = null;
  if (manifest.id === STUDIO_WORKFLOWS.mask) {
    values.quality = packResolution(input.resolution);
    const words = (typeof extra.maskPrompt === "string" && extra.maskPrompt.trim()) || input.prompt?.trim() || "person";
    values.maskPrompt = words.slice(0, 120);
    delete extra.maskPrompt;
    if (input.points?.length) {
      if (!clip?.width || !clip.height) throw new ComposeError("Couldn't read the clip's size to place your clicks — pick who to swap instead");
      const [pos, neg] = samCoords(input.points, { width: clip.width, height: clip.height }, input.resolution);
      values.positiveCoords = pos;
      values.negativeCoords = neg;
      extra.selection = "index";
      extra.subjectIndex = 0;
    }
    const keyFrame = Math.max(0, Math.round(Number(extra.keyFrame ?? 0)));
    const shotFrames = Math.round(Number(extra.shotFrames ?? 0));
    const spanFrames = Math.max(1, Math.round(Number(extra.spanFrames ?? shotFrames - keyFrame)));
    if (!(shotFrames > 0) || keyFrame + spanFrames > shotFrames) throw new ComposeError("The mask's frames don't fit in the shot — reload and try again");
    const prev = typeof extra.prevMask === "string" && !!extra.prevMask;
    if (!prev) {
      studioLeft.push("prevMask");
      delete extra.prevMask;
    }
    Object.assign(extra, { keyFrame, spanFrames, tailStart: keyFrame + spanFrames, tailFrames: Math.max(1, shotFrames - keyFrame - spanFrames) });
    delete extra.shotFrames;
    studioMask = { head: keyFrame, tail: shotFrames - keyFrame - spanFrames, prev };
    // The graph holds the whole shot as float frames: refuse what the server can't hold (before it runs out of memory).
    const tooBig = maskMemoryProblem({ width: clip?.width, height: clip?.height, quality: input.resolution, shotFrames, correcting: prev }, await ctx.serverRam?.());
    if (tooBig) throw new ComposeError(tooBig);
  }
  // Restore & colourise (video-restore-ltx25-tiled): the window, canvas, LoRA and tiles of this pass; the prefix (the window
  // before's restored frames, videos[0]), the reference picture (images[0]) and deinterlacing are branches it may leave out.
  let restore: RestoreJob | null = null;
  if (manifest.capability === "restore-video") {
    const prefixVideo = typeof clips[0] === "string" && clips[0] && clips[0] !== values.video ? clips[0] : undefined;
    try {
      restore = restoreJob({ extra, clip: clip ? clipFacts(clip) : undefined, fps: input.fps, prefixVideo, reference: images[0] });
    } catch (e) {
      throw new ComposeError((e as Error).message);
    }
    for (const k of RESTORE_EXTRA_KEYS) delete extra[k];
    Object.assign(values, restore.values, { video2: restore.prefix ? prefixVideo : undefined, image: restore.reference ? images[0] : undefined });
    if (!restore.prefix) studioLeft.push("video2");
    if (!restore.reference) studioLeft.push("image");
  }
  // Tap to Recolor: the taps (params.points, in the pixels of the picture they were placed on, params.extra.frameWidth /
  // frameHeight) and the piece they are on (params.extra.recolorItem) become the mask node's touches in the photo's own
  // pixels: SAM 3.1 takes the thing of that name under each tap. Only the taps say what changes.
  if (manifest.capability === "recolor") {
    const photo = ctx.media?.(String(values.image ?? ""));
    const touches = recolorTouches(input.points, recolorItem(extra), photo?.width && photo.height ? { width: photo.width, height: photo.height } : undefined, tapFrame(extra));
    if (!touches) throw new ComposeError(RECOLOR_TAP_FIRST);
    values.touches = touches;
    for (const k of ["frameWidth", "frameHeight", "recolorItem", "touches"]) delete extra[k];
  }
  // Genjutsu's Object swap: SAM 3.1 follows what goes (params.extra.maskPrompt, or the "replace … with" part of the prompt,
  // as Genjutsu sends it), the reference comes in, the prompt describes the result. Insert: the painted spot and the
  // reference, the prompt says what appears there. Neither graph takes clicked points.
  if ((ctx.op === "video-swap" || ctx.op === "video-insert") && !characterSwap) {
    if (input.points?.length && !input.mask && typeof extra.maskPrompt !== "string") throw new ComposeError(OPEN_TARGET_PROBLEM[ctx.op === "video-insert" ? "insert" : "swap"]!);
    const words = input.prompt?.trim() ?? "";
    const vace = getMaker(ctx.op === "video-swap" ? ORIGINALS.swap : "oss-vace-insert", "open")!;
    if (ctx.op === "video-swap" && b.maskPrompt) {
      const named = typeof extra.maskPrompt === "string" ? extra.maskPrompt.trim() : "";
      if (!named && !words) throw new ComposeError("Say what to swap, e.g. “the red car”");
      // Named apart: the prompt is the result's own words. Only a sentence: it says both what goes and what comes in.
      values.maskPrompt = swapTarget(named || words);
      delete extra.maskPrompt;
      if (!named) values.prompt = makerPrompt({ mode: "swap", maker: vace, subject: words, refs: 1 });
    }
    if (!words && b.prompt) values.prompt = makerPrompt({ mode: ctx.op === "video-swap" ? "swap" : "insert", maker: vace, subject: String(values.maskPrompt ?? ""), refs: 1 });
  }
  // A graph's own prompt text is its template's sample (Wan Animate 2's "Cartoon character lost" in an empty white room),
  // so it never stays in a run: motion transfer always describes the character from the photo with the user's words,
  // other graphs that run without words take Fuobe's neutral line, and one that can't do without words refuses.
  if (b.prompt) {
    const asked = typeof values.prompt === "string" && values.prompt.trim() ? values.prompt : undefined;
    if (MOTION_GRAPHS.has(manifest.id)) values.prompt = motionTransferPrompt(manifest.id, asked);
    else if (!asked && WORDS_NEEDED[manifest.id]) throw new ComposeError(WORDS_NEEDED[manifest.id], 400);
    else if (!asked) values.prompt = neutralPrompt(manifest.id) ?? values.prompt;
  }
  // Depth maps: Video Depth Anything draws gray or inferno (the other graphs grayscale only), and can put the
  // original clip next to the map.
  if (ctx.op === "depth-video" && input.colormap) {
    const want = input.colormap.toLowerCase() === "grayscale" ? "gray" : input.colormap.toLowerCase();
    if (b.colormap && (want === "gray" || want === "inferno")) values.colormap = want;
    else if (want !== "gray") throw new ComposeError(b.colormap ? onPlace(ctx.accountOnInstall, "The open engine's depth maps come in grayscale or inferno — turbo, magma and viridis are on the cloud", "Open models make depth maps in grayscale or inferno — turbo, magma and viridis are on the cloud") : "This depth model makes grayscale maps only — pick Video Depth Anything for inferno");
  }
  if (b.sideBySide && input.sideBySide !== undefined) values.sideBySide = input.sideBySide;
  // A wrapper graph that loads its LoRA itself (kijai's InfiniteTalk: WanVideoLoraSelect, no core model loader to attach
  // one after) takes the run's LoRA there on a route made for it: Fuobe Speak's FusioniX in place of the graph's lightx2v,
  // with the steps and guidance it needs. One at most. Other routes on the graph (InfiniteTalk Long, tuned for lightx2v)
  // refuse a LoRA below.
  let loras = input.loras ?? [];
  if (loras.length && b.lora && ctx.loraSlot && !canTakeLoras(workflow)) {
    if (loras.length > 1) throw new ComposeError(`${manifest.title} takes one LoRA (it loads it itself): ${loras.map((l) => l.file).join(", ")}`);
    values.lora = loras[0].file;
    values.loraStrength = loras[0].strength ?? 1;
    loras = [];
  }
  // Matte graphs save a cut-out and a black-and-white matte: params.matteOutput keeps one.
  // The green-screen key's clean foreground leaves through the cut-out's encoder (below), so the cut-out's node is kept.
  const keyForeground = ctx.op === "bg-remove-video" && input.matteOutput === "foreground";
  const keepRole: string | undefined = ctx.op === "bg-remove-video" ? (keyForeground ? "cutout" : input.matteOutput) : undefined;
  // The green-screen key (video-key-corridorkey) writes its cut-out as a transparent WebM, ProRes 4444 with alpha, or EXR
  // frames beside the WebM (params.format; src/lib/av/keying.ts).
  const keyExr = ctx.op === "bg-remove-video" && !!b.format && input.format === "exr";
  if (ctx.op === "bg-remove-video" && b.format) {
    try {
      Object.assign(values, keyFormatValues(input.format, input.matteOutput));
    } catch (e) {
      throw new ComposeError((e as Error).message, 400);
    }
  }

  if (b.filenamePrefix) values.filenamePrefix = `fuobe/${ctx.generationId}`;
  // Keyframe animation: every gap's timing and words (src/lib/inbetween.ts); the graph is rewritten for the keyframes below.
  let inbetween: InbetweenPass[] | null = null;
  if (manifest.expand === "keyframes") {
    let timing: InbetweenTiming;
    try {
      timing = requestTiming(extra, images.length, input.keyframeTimes, "open");
    } catch (e) {
      throw new ComposeError((e as Error).message);
    }
    const stillMouth = extra.stillMouth === true;
    const seed = Number(values.seed);
    inbetween = timing.gaps.map((g, i) => ({ frames: g.frames, speed: g.speed, prompt: gapPrompt(input.prompt, g, stillMouth), seed: seed + i }));
    Object.assign(values, { fps: timing.fps, frames: timing.gaps[0].frames, prompt: inbetween[0].prompt, image: images[0], endImage: images[1] });
    delete extra.inbetween;
    delete extra.stillMouth;
  }
  // World mode (world-hy-nomas-turn): the script and the turn asked for; the graph is rebuilt for them below. The script's
  // own seed always: the turns before this one must match the ones ComfyUI already made.
  let world: { script: WorldScript; turn: number } | null = null;
  if (manifest.expand === "world") {
    const script = readWorld(extra.world);
    const turn = Math.round(Number(extra.turn ?? 0));
    const problem = script ? worldProblem(script, turn) : "Describe the world first: the opening is where it starts";
    if (problem || !script) throw new ComposeError(problem ?? "Describe the world first", 400);
    world = { script, turn };
    if (b.prompt) values.prompt = script.opening.words;
    if (b.seed) values.seed = script.seed;
  }
  delete extra.world;
  delete extra.turn;
  const cues = manifest.expand === "captions" ? captionCues(input, extra) : [];
  delete extra.cues;
  delete extra.wordsPerCaption;
  const timeline = manifest.expand === "timeline" ? readTimeline(extra.timeline) : null;
  if (manifest.expand === "timeline" && !timeline) throw new ComposeError("The voice track needs the lines' start times (params.extra.timeline)");
  delete extra.timeline;
  // A Video concatenator clip muted in the canvas (video-fit-clip): its sound becomes silence below.
  const muted = manifest.id === "video-fit-clip" && extra.mute === true;
  delete extra.mute;
  // DBS (separate-soundtrack-dbs, and the dub's dub-prepare-dbs-transcribe): the model asked for, else the host's pick
  // (DBS-TIGER on a CUDA GPU, DBS-BSRNN on a CPU, the other one when the pick isn't on disk; a model that isn't there is
  // refused in words); "each channel" for stereo stems. A source with more than 2 channels (the header's count, else the
  // browser's) is split in mono with a mono Music & effects (dbsSurroundBed below): ComfyUI can't save more than 2
  // channels. The dub's graph always splits in mono (no channels binding), so only its bed changes.
  if (b.separationModel) {
    const [device, installed] = await Promise.all([extra.separationModel ? undefined : ctx.device?.().catch(() => undefined), ctx.dbsModels?.().catch(() => undefined)]);
    try {
      values.separationModel = dbsModelFor(extra.separationModel, device, installed);
    } catch (e) {
      throw new ComposeError((e as Error).message, 400);
    }
  }
  // RE-USE (voice-clean-reuse, voice-clean-bed-reuse): the file for voice / laughter (refused in words when the host's
  // list doesn't have it, or has no ComfyUI-RE-USE at all), the rate (Auto: the source's on a CUDA GPU, capped on a CPU),
  // Strength as room tone, and the level in the node's words.
  if (b.reuseModel) {
    const installed = await ctx.reuseModels?.().catch(() => undefined);
    if (installed === null) throw new ComposeError(NO_REUSE_PACK, 400);
    try {
      values.reuseModel = reuseFileFor(extra.reuseModel, installed);
    } catch (e) {
      throw new ComposeError((e as Error).message, 400);
    }
    if (b.rate) {
      const auto = extra.rate === undefined || extra.rate === "auto";
      const device = auto ? await ctx.device?.().catch(() => undefined) : undefined;
      values.rate = rateFor(extra.rate ?? "auto", device, input.sourceDuration ?? ctx.media?.(String(values.audio ?? ""))?.duration);
    }
    const strength = extra.strength as keyof typeof STRENGTH_DB | undefined;
    if (b.roomToneDb && extra.roomToneDb === undefined && strength && strength in STRENGTH_DB) values.roomToneDb = STRENGTH_DB[strength];
    if (b.level && (extra.level === "match" || extra.level === "voice")) values.level = extra.level === "voice" ? "-16 LUFS" : "match input";
    for (const k of ["reuseModel", "rate", "strength", "background", ...(values.level !== undefined ? ["level"] : [])]) delete extra[k];
  }
  delete extra.background;
  const sourceChannels = b.channels || b.separationModel ? (ctx.media?.(String(values.audio ?? ""))?.channels ?? (Number(extra.sourceChannels) || undefined)) : undefined;
  if (b.channels) values.channels = dbsChannelsFor(extra.channels, sourceChannels);
  for (const k of ["separationModel", "channels", "sourceChannels"]) delete extra[k];
  // Watermark Remover: the marks kept (checked and rebuilt again, clamped to this picture), how QWMDetect finds what to repair
  // and how far past each mark, and the size the repair works at (the picture's size and the GPU's memory). Never what the
  // request says for these, nor for the picture, the brush, the seeds or the file names already bound.
  if (manifest.capability === "watermark-remove") {
    const still = ctx.media?.(String(values.image ?? ""));
    if (still?.width && still.height && Math.max(still.width, still.height) > MAX_WATERMARK_SIDE) throw new ComposeError(WATERMARK_COPY.tooBig, 400);
    const brushed = !!b.mask;
    // A brush painted on another size of the picture can't line up with it (QWMDetect refuses it): said in words up front.
    const painted = brushed ? ctx.media?.(String(values.mask ?? "")) : undefined;
    if (painted?.width && painted.height && still?.width && still.height && (painted.width !== still.width || painted.height !== still.height)) {
      throw new ComposeError(WATERMARK_COPY.brushAgain, 400);
    }
    if (!brushed && extra.boxes !== undefined) {
      try {
        values.boxes = checkWatermarkBoxes(extra.boxes, { width: still?.width, height: still?.height }).json;
      } catch (e) {
        throw new ComposeError((e as Error).message, 400);
      }
      values.detectMode = "manual_boxes";
    } else if (b.detectMode) values.detectMode = brushed ? "manual_mask" : "auto_qwen";
    // The kept marks get a repair margin past the scan's box; marks the pack finds itself (an API caller's run) get the scan's.
    if (b.detectExpand) values.detectExpand = values.detectMode === "manual_boxes" ? WATERMARK_KEPT_EXPAND : WATERMARK_SCAN_EXPAND;
    if (b.maxSize) values.maxSize = maxSideFor(still?.width, still?.height, await ctx.vram?.().catch(() => undefined));
    for (const k of ["boxes", "detectMode", "detectExpand", "maxSize", "image", "mask", "seed", "filenamePrefix"]) delete extra[k];
  }
  if (manifest.capability === "watermark-scan") {
    const still = ctx.media?.(String(values.image ?? ""));
    if (still?.width && still.height && Math.max(still.width, still.height) > MAX_WATERMARK_SIDE) throw new ComposeError(WATERMARK_COPY.tooBig, 400);
    for (const k of ["image", "filenamePrefix"]) delete extra[k];
  }
  // Options → Prompt helper (FLUX 3 Image Klein) and a layout's draft (kept for Reuse): read here, never bound.
  const helper = extra[PROMPT_HELPER_PARAM];
  const laidOut = carriesBoxes(extra);
  delete extra[PROMPT_HELPER_PARAM];
  delete extra[LAYOUT_PARAM];
  // The Lightning tier's schedule shifted for this canvas (its card's dynamic shift): text to image's size, else image 1's.
  if (b.sigmas && LIGHTNING_GRAPHS.has(manifest.id) && extra.sigmas === undefined) {
    const canvas = lightningCanvas(manifest.capability, values, ctx.media?.(String(values.image ?? "")));
    if (canvas) values.sigmas = lightningSigmas(canvas.width, canvas.height);
  }
  // Hi3D's refine: the mesh to refine is needed, and the resolution is one the model takes (512, 1024, 1536). Other graphs
  // bind meshResolution to their own grid (Idol 3D quick mesh: SplatToMesh, 64-768).
  if (b.model3d && !values.model3d) throw new ComposeError("Add the 3D model to refine");
  if (b.model3d && b.meshResolution && extra[HI3D_PARAM] !== undefined) {
    const r = strictHi3dResolution(extra[HI3D_PARAM]);
    if (r === null) throw new ComposeError("Hi3D refines at 512, 1024 or 1536");
    extra[HI3D_PARAM] = r;
  }
  // SplatToMesh's grid (Idol 3D quick mesh) takes 64-768 in steps of 16: a value from Canvas or Assist is kept to that.
  if (!b.model3d && b.meshResolution && extra[HI3D_PARAM] !== undefined) {
    const n = Number(extra[HI3D_PARAM]);
    if (Number.isFinite(n)) extra[HI3D_PARAM] = Math.min(768, Math.max(64, Math.round(n / 16) * 16));
    else delete extra[HI3D_PARAM];
  }
  // H3 Person Removal's window review (H3 Relay's Review Windows): "Redo from here" sends the same graph again with
  // window controls that lock the windows before it to their checkpoints. The Relay keeps those only while the graph,
  // its input files and its save prefix are the same, so a reroll names the original run's inputs and prefix (set by
  // the server from that run, on the studio's own ComfyUI only: never an account's, a link's or a computer's).
  let reviewInputs: RemovalReview["reuse"] | undefined;
  if (manifest.id === H3_REMOVAL_WORKFLOW) {
    const reuse = reuseOf(extra[REVIEW_EXTRA.reuse]);
    delete extra[REVIEW_EXTRA.reuse];
    const controls = extra[REVIEW_EXTRA.controls];
    if (controls !== undefined && (typeof controls !== "string" || controls.length > 131_072)) delete extra[REVIEW_EXTRA.controls];
    const own = ctx.ownStudio === true;
    if (reuse && own) Object.assign(values, { video: reuse.video, image: reuse.image, filenamePrefix: reuse.prefix });
    // Only the studio's own ComfyUI keeps a review (its previews are fetched from there; nothing else can be redone).
    if (own && typeof values.video === "string" && typeof values.image === "string" && typeof values.filenamePrefix === "string") {
      reviewInputs = { video: values.video, image: values.image, prefix: values.filenamePrefix };
    }
  }
  // An account's run on this install's GPUs never names a file there itself: a file input in params.extra is one this
  // run sent (a media ref, uploaded above), else it is dropped (it could name another run's file in the same folder).
  const dropped: string[] = [];
  if (ctx.accountOnInstall) {
    for (const k of mediaKeys(manifest, workflow)) {
      if (!(k in extra) || sentHere.has(k)) continue;
      delete extra[k];
      dropped.push(k);
    }
  }
  // Idol 3D: "It's a photo" is the clean graph's "real" crop (the core graph's photo switch), then the pack's pruning.
  if (manifest.id === IDOL_WORKFLOWS.core || manifest.id === IDOL_WORKFLOWS.clean || manifest.id === IDOL_VIEWS_WORKFLOW) {
    Object.assign(values, idolGraphValues(extra, (k) => !!b[k as BindingKey]));
    for (const k of ["cropMode", "photoCrop", "minOpacity", "maxScale"]) delete extra[k];
  }
  for (const [k, v] of Object.entries(extra)) values[k as BindingKey] = v;
  // SeedVR2's `scale` multiplies the picture before one diffusion pass over all of it, and its graph is made for up to
  // limits.maxWidth × maxHeight: the multiplier comes down to fit the picture (a 3000 × 2000 photo at the template's 4x
  // would ask for 12000 × 8000), to the resize node's 0.01 step.
  if (manifest.id === "upscale-image-seedvr2" && b.scale) {
    const src = ctx.media?.(String(values.image ?? ""));
    if (src?.width && src.height) {
      const [maxW, maxH] = [Number(manifest.limits?.maxWidth ?? Infinity), Number(manifest.limits?.maxHeight ?? Infinity)];
      const room = Math.min(maxW / src.width, maxH / src.height);
      const asked = Number(values.scale ?? d.scale ?? 1);
      if (room < 1)
        throw new ComposeError(
          onPlace(
            ctx.accountOnInstall,
            `SeedVR2 makes pictures up to ${maxW} × ${maxH} px on your GPU, and this one is already ${src.width} × ${src.height}: pick 4x ESRGAN for it`,
            `SeedVR2 makes pictures up to ${maxW} × ${maxH} px, and this one is already bigger. Pick 4x ESRGAN for it.`,
          ),
          400,
        );
      if (asked > room) values.scale = Math.floor(room * 100) / 100;
    }
  }
  // A canvas the request names (a layout's, Soul's exact sizes) stays on the graph's grid and inside its limits, as the
  // cloud fits the same canvas (FieldMap.size): both engines render one size, the size a layout is compiled at.
  if (b.width && b.height && (extra.width !== undefined || extra.height !== undefined)) {
    const [w, h] = [Number(values.width), Number(values.height)];
    if (w > 0 && h > 0 && Number.isFinite(w * h)) Object.assign(values, fitCanvas(w, h, manifest.limits));
  }
  if (audio2 && ctx.op !== "dialogue" && ctx.op !== "voice-change") values.audio2 = audio2;
  // Soundtrack mix: a silent bed as long as the video, so neither track cuts the other short.
  if (ctx.op === "mux" && b.duration) {
    const tracks = [values.audio, values.audio2].map((n) => ctx.media?.(String(n ?? ""))?.duration ?? 0);
    values.duration = Math.round((clipLength ?? (Math.max(...tracks) || 600)) * 100) / 100 + 0.5; // the mux trims it to the picture
  }

  // Reference images the user left out: dropped from a FLUX.2 reference chain or from an encoder that takes them as
  // optional inputs, else the previous image again where that's harmless (style boards, multi-reference edits), else a
  // clear "add …" message.
  let graph = workflow;
  const left: string[] = [...studioLeft, ...(openjutsu ? openjutsuLeftOut(manifest.id, openjutsu) : [])];
  // A side nobody photographed is left out (its cut-out and crop with it); the front is needed.
  if (rules.views) {
    for (const k of IMAGE_SLOTS.slice(1)) {
      if (values[k] !== undefined || b[k]?.length !== 1) continue;
      const dropped = dropBranch(graph, b[k]![0].node, rules.views.into, manifest.outputs.map((o) => o.node));
      if (dropped) {
        graph = dropped;
        left.push(k);
      }
    }
  }
  // MiniMax H3 with references (Pika H3 Flex Ref2VA): Pika's limits, checked on the uploads' headers before the run; the
  // graph's Image 1 loader is taken out by expandH3References when there is no image.
  // A talking clip from a voice (Lipsync & avatars, Fuobe Speak) is one image and the voice as its audio reference.
  const refAudios = ctx.op === "avatar" ? [input.audio].filter((a): a is string => !!a) : audios;
  if (manifest.expand === "references") {
    const length = (n: string) => {
      const m = ctx.media?.(n);
      return m?.videoDuration ?? m?.duration;
    };
    const problem = h3ReferenceProblem({ images: images.length, videos: clips.map(length), audios: refAudios.map(length) });
    if (problem) throw new ComposeError(problem);
    if (!images.length) left.push("image");
  }
  // The Character swap without an anchor frame: its loader and fit are taken out after binding.
  if (dropAnchor) left.push("image2");
  for (const [k, prev] of REFERENCE_SLOTS.slice(1).map((slot, i) => [slot, REFERENCE_SLOTS[i]] as const)) {
    if (rules.views || !b[k] || values[k] !== undefined || rules.required?.includes(k) || left.includes(k)) continue;
    if (values[prev] === undefined && !left.includes(prev)) continue;
    const loader = b[k]!.length === 1 ? b[k]![0].node : undefined;
    const bypassed = loader ? (bypassReference(graph, loader) ?? dropBranch(graph, loader, OPTIONAL_REFERENCE_INPUTS, manifest.outputs.map((o) => o.node))) : null;
    if (bypassed) {
      graph = bypassed;
      left.push(k);
    } else if ((rules.reuse || manifest.capability === "style-reference") && values[prev] !== undefined) values[k] = values[prev];
  }
  for (const k of mediaKeys(manifest, workflow)) {
    if (left.includes(k)) continue;
    if (values[k] === undefined || values[k] === "") throw new ComposeError(rules.hints?.[k] ?? MEDIA_HINT[k] ?? `Add the ${k} input`);
  }

  // Whisper captions hold the whole clip in RAM (decoded + subtitled copy): refuse what the server can't hold.
  if (manifest.capability === "captions" && !manifest.expand && clip?.width && clip.height && clipLength) {
    const need = clip.width * clip.height * 12 * (clip.frames ?? clipLength * (clip.fps ?? 30)) * 2.5;
    const budget = ((await ctx.serverRam?.()) ?? 16 * GB) / 2;
    if (need > budget) {
      // On this install's GPUs: how long a clip fits, in plain words.
      const fits = Math.floor((clipLength * budget) / need);
      throw new ComposeError(
        onPlace(
          ctx.accountOnInstall,
          `Whisper captions hold the whole clip in memory: this one needs about ${Math.ceil(need / GB)} GB of RAM and this ComfyUI can spare ${Math.floor(budget / GB)} GB. ` +
            "Use Qwen3-ASR + Caption burn-in for long clips, or trim it first",
          `This clip is too long to caption in one go. Trim it to under ${fits >= 60 ? `${Math.floor(fits / 60)} min` : `${Math.max(1, fits)} s`}.`,
        ),
      );
    }
  }

  // Graphs that hold the whole clip in memory (FPS Boost, HDR, EXR): refuse what the server can't hold.
  if (finish.wholeClip) {
    const problem = wholeClipProblem(finish.wholeClip, clipFacts(clip), await ctx.serverRam?.());
    if (problem) throw new ComposeError(problem);
  }

  const bound = applyBindings(graph, b, Object.fromEntries(Object.entries(values).filter(([k]) => !left.includes(k))));
  // maxDimension targets for removed reference branches are expected: their scale nodes go with the loader.
  const realMissing = bound.missing.filter((m) => !/^maxDimension\b/.test(m));
  if (realMissing.length) throw new ComposeError(onPlace(ctx.accountOnInstall, `Workflow ${manifest.id} bindings point at missing nodes: ${realMissing.join(", ")}`, SITE_FAILED_WORDS));
  // A saved 3D view read without the browser (Any Angle): Load3D's picture entries point at the run's photo.
  let wf = withLoad3dImages(bound.workflow, typeof values.image === "string" ? values.image : undefined);
  // Qwen3-TTS's clone needs the sample's words unless it clones from the voice's timbre alone (x_vector_only):
  // a sample with no transcript clones that way instead of failing.
  for (const t of b.voiceTranscript ?? []) {
    const inputs = wf[t.node]?.inputs;
    if (!inputs || !("x_vector_only" in inputs)) continue;
    const words = inputs[t.input];
    inputs.x_vector_only = !(typeof words === "string" && words.trim());
  }
  const outputIds = manifest.outputs.map((o) => o.node);
  // The prompt helper (FLUX 3 Image Klein's upsampler) off, or a layout with boxes it would rewrite: the words as typed.
  // Kandinsky 6.0's helper runs only when asked (PROMPT_HELPER_OPT_IN).
  const helperOff = helper === "off" || (helper !== "on" && PROMPT_HELPER_OPT_IN.has(manifest.id));
  if (PROMPT_HELPER_GRAPHS.has(manifest.id) && (helperOff || laidOut)) wf = skipPromptHelper(wf, outputIds);
  if (dropAnchor) wf = withoutAnchor(wf, b.image2![0].node);
  if (openjutsu) {
    try {
      const seed = typeof openjutsu.seed === "number" ? openjutsu.seed : typeof values.seed === "number" ? values.seed : randomSeed();
      wf = openjutsuGraph(manifest.id, wf, { ...openjutsu, seed }, { generationId: ctx.generationId, clip: clip ? { width: clip.width, height: clip.height } : undefined });
    } catch (e) {
      throw new ComposeError((e as Error).message, 400);
    }
  }
  // LoRA "none": the swap LoRA's loader is linked out (H3 runs with the Turbo LoRA alone).
  if (dropSwapLora && b.lora?.length === 1) wf = bypassNode(wf, b.lora[0].node, "model", outputIds);
  if (studioSegment) wf = segmentGraph(wf, { ...studioSegment, outputs: outputIds });
  if (studioMask) wf = maskGraph(wf, { ...studioMask, outputs: outputIds });
  if (restore) wf = restoreGraph(wf, restore, outputIds);
  // FPS Boost to a lower rate, or one the clip divides into: no interpolation, only every n-th frame.
  if (finish.bypassInterpolation) {
    const id = Object.keys(wf).find((k) => wf[k].class_type === "FrameInterpolate" || wf[k].class_type === "RTXVideoFrameGeneration");
    if (id) wf = bypassNode(wf, id, "images", outputIds);
  }
  if (surroundSource(sourceChannels)) wf = dbsSurroundBed(wf);
  // Zen Image Edit's loader (Qwen-Image 2.1 on a small GPU) reads paths, not names: the adapter where the server keeps it
  // in models/text_encoders, and Qwen3.5-0.8B's pinned folder there when it has one (else the loader fetches it by id).
  for (const n of Object.values(wf)) {
    if (n.class_type !== "ZenImage21AdapterLoader") continue;
    const adapter = await ctx.modelPath?.(ZEN_ADAPTER.folder, ZEN_ADAPTER.file).catch(() => undefined);
    n.inputs.adapter_file = adapter ?? `models/${ZEN_ADAPTER.folder}/${ZEN_ADAPTER.file}`;
    const weights = await ctx.modelPath?.(ZEN_ADAPTER.folder, `${ZEN_ENCODER.dir}/${ZEN_ENCODER.weights}`).catch(() => undefined);
    n.inputs.text_encoder = weights ? weights.replace(/[\\/][^\\/]+$/, "") : ZEN_ENCODER.id;
  }
  // Slow motion: the sound would no longer match the picture.
  if (finish.dropSound) for (const n of Object.values(wf)) if (n.class_type === "CreateVideo") delete n.inputs.audio;
  // VHS meta-batch: a manager of its own per job (a stale one loses frames), and no sound link for a silent clip.
  wf = tagMetaBatch(wf, ctx.generationId);
  // A concatenator clip that is muted or has no sound: silence exactly as long as its kept frames, so every clip
  // of the film carries a track (a packet-copy join of clips with and without one would drift). Not knowing how
  // long the window is (no end, no header), it has no track instead.
  if (manifest.id === "video-fit-clip" && (muted || (clip && !clip.hasAudio && clip.hasVideo))) {
    const kept = Number(values.duration) > 0 ? Number(values.duration) : undefined;
    const rest = clipLength !== undefined ? Math.max(0, clipLength - start) : undefined;
    const seconds = kept !== undefined && rest !== undefined ? Math.min(kept, rest) : (kept ?? rest);
    wf = seconds ? silenceVhsAudio(wf, Math.max(1, Math.round(seconds * fps)) / fps) : dropVhsAudio(wf);
  }
  if (clip && !clip.hasAudio && clip.hasVideo) {
    wf = dropVhsAudio(wf);
    // Core LoadAudio reading the clip's own sound (the end card's ad): no sound, no sound track.
    wf = dropLoadedSound(wf, (b.video ?? []).filter((t) => t.input === "audio").map((t) => t.node), outputIds);
  }
  if (manifest.expand === "captions") {
    if (!cues.length) throw new ComposeError("No timed captions to burn in. Transcribe the clip first, or write lines like “0.00-2.40: Hello there”");
    try {
      wf = expandCaptionWorkflow(wf, cues, clip ? { duration: clipLength, fps: clip.fps, width: clip.width, height: clip.height, hasAudio: clip.hasAudio } : {});
    } catch (e) {
      throw new ComposeError((e as Error).message);
    }
  }
  if (timeline) {
    try {
      wf = expandTimelineWorkflow(wf, input.audios?.length ? input.audios : [String(values.audio)], timeline);
    } catch (e) {
      throw new ComposeError((e as Error).message);
    }
  }
  if (speechWindows) {
    const duration = ctx.media?.(String(values.audio ?? ""))?.duration ?? input.sourceDuration;
    if (!duration) throw new ComposeError("Couldn't read how long the recording runs: add it again as WAV, MP3, M4A or MP4", 400);
    try {
      wf = expandSpeechEditWorkflow(wf, speechWindows, { duration, quality: aukQuality, seed: Number(values.seed) || 0, crossfade: Math.max(0.02, Number(input.crossfade ?? d.crossfade ?? 0.12)) });
    } catch (e) {
      throw new ComposeError((e as Error).message, e instanceof SpeechEditError ? 400 : 500);
    }
  }
  if (aukTts) wf = aukTtsWorkflow(wf, aukTts);
  if (Object.values(wf).some((n) => n.class_type === "AuKModelLoader")) {
    try {
      wf = setAukDevice(wf, typeof values.device === "string" ? values.device : undefined);
    } catch (e) {
      throw new ComposeError((e as Error).message, 400);
    }
  }
  if (world) {
    try {
      wf = expandWorldWorkflow(wf, world.script, world.turn);
    } catch (e) {
      throw new ComposeError((e as Error).message, e instanceof WorldGraphError ? 400 : 500);
    }
  }
  // Keyframe animation: one pass per gap on the shared loaders, every keyframe loaded once.
  if (inbetween) {
    try {
      wf = expandInbetweenWorkflow(wf, images, inbetween);
    } catch (e) {
      throw new ComposeError((e as Error).message);
    }
  }
  // Joins of more clips than the template binds: one loader per clip, in one prompt.
  try {
    if (manifest.expand === "videos" && clips.length > 2) wf = expandVideoJoinWorkflow(wf, clips);
    if (manifest.expand === "audios" && audios.length > 2) wf = expandAudioJoinWorkflow(wf, audios);
    if (manifest.expand === "references") wf = expandH3References(wf, { images, videos: clips, audios: refAudios, videoSound: clips.map((n) => ctx.media?.(n)?.hasAudio) });
  } catch (e) {
    throw new ComposeError((e as Error).message);
  }
  if (loras.length) {
    // A LoRA a graph can't attach would be dropped without a word: say so instead.
    if (!canTakeLoras(wf)) throw new ComposeError(`${manifest.title} can't take LoRAs (it has no model loader to attach them to)`);
    wf = injectLoras(wf, loras);
  }
  // The output not asked for isn't saved (nor encoded: ComfyUI runs only what an output node needs).
  if (keepRole && manifest.outputs.some((o) => o.role === keepRole)) for (const o of manifest.outputs) if (o.role && o.role !== keepRole && !(keyExr && o.role === "frames")) delete wf[o.node];
  // The clean foreground (CorridorKey 2.0's despilled colours premultiplied over black, output 2): the cut-out's encoder takes
  // it as a plain H.264 with sound.
  if (keyForeground) {
    const keyer = Object.entries(wf).find(([, n]) => n.class_type === "CorridorKey2")?.[0];
    const cut = manifest.outputs.find((o) => o.role === "cutout")?.node;
    if (!keyer || !cut || !wf[cut]) throw new ComposeError(`${manifest.title} doesn't make a clean foreground — CorridorKey in Green screen does`, 400);
    wf[cut] = { ...wf[cut], inputs: { ...wf[cut].inputs, images: [keyer, 2], format: "video/h264-mp4", pix_fmt: "yuv420p", crf: 19 } };
  }
  // A key's EXR frames are written only when asked for (they ride on the cut-out, zipped).
  if (ctx.op === "bg-remove-video" && !keyExr) for (const o of manifest.outputs) if (o.role === "frames") delete wf[o.node];
  if (ctx.op === "remove-object" && !handOff) for (const o of manifest.outputs) if (o.role === "mask") delete wf[o.node];
  const metaBatch = Object.values(wf).some((n) => n.class_type === "VHS_BatchManager");
  return {
    manifest,
    workflow: wf,
    size: jobSize(values, input, ctx.media),
    dropped,
    // The seed the graph drew with (one Fuobe picked when none was asked): its pictures keep it, so Edit layout redraws the same one.
    meta: {
      workflowId: manifest.id,
      nodeCount: Object.keys(wf).length,
      prefix: `fuobe/${ctx.generationId}`,
      ...(metaBatch ? { metaBatch: true } : {}),
      ...(b.seed && typeof values.seed === "number" ? { seed: values.seed } : {}),
      ...(reviewInputs ? { reviewInputs } : {}),
    },
  };
}

/**
 * The Character swap graph without its anchor frame (Openjutsu's swapWorkflow): the anchor's loader and every node that
 * reads only it go, the swap's input takes no anchor and its use_anchor switch is off.
 */
export function withoutAnchor(wf: ComfyWorkflow, loaderId: string): ComfyWorkflow {
  const out = JSON.parse(JSON.stringify(wf)) as ComfyWorkflow;
  const gone = new Set([loaderId]);
  // The loader's direct readers that exist only to fit it (anchor_fit): an image node fed by nothing else.
  for (const [id, n] of Object.entries(out)) {
    const links = Object.values(n.inputs).filter((v) => Array.isArray(v)) as [string, number][];
    if (links.some((v) => v[0] === loaderId) && n.class_type === "ImageScale") gone.add(id);
  }
  for (const id of gone) delete out[id];
  for (const n of Object.values(out)) {
    for (const [k, v] of Object.entries(n.inputs)) {
      if (Array.isArray(v) && gone.has(String(v[0]))) {
        delete n.inputs[k];
        if ("use_anchor" in n.inputs) n.inputs.use_anchor = false;
      }
    }
  }
  return out;
}

/**
 * Every VideoHelperSuite save node of a graph for the workers saves no metadata: the prompt and the machine's own clock never
 * travel inside a result. Returns the graph changed in place.
 */
export function withoutSaveMetadata(wf: ComfyWorkflow): ComfyWorkflow {
  for (const node of Object.values(wf)) {
    const cls = typeof node?.class_type === "string" ? node.class_type : "";
    if (!node?.inputs || !cls.startsWith("VHS_")) continue;
    if (cls === "VHS_VideoCombine" || "save_metadata" in node.inputs) node.inputs.save_metadata = false;
  }
  return wf;
}
