/**
 * Fuobe Genjutsu (build plan O5): keep a clip's motion, camera and framing, change what is in it. Five modes: Motion
 * transfer (your character does what the clip's person does), Character swap (the person in a 5–15 s part becomes your
 * character, sound and performance kept: Openjutsu / Akatz Labs' H3 Character Swap), Object swap (a thing, a person or
 * an outfit becomes your reference), Restyle (every frame takes a look) and Insert (your reference is added where you
 * say). Each mode's default is a Fuobe Original — open weights on your GPU (ComfyUI) and the same open weights hosted on
 * fal in the cloud: Wan Animate for motion, MiniMax H3 + the Character Swap LoRA for characters, SAM 3.1 + Wan VACE for
 * swaps, a restyled first frame + Wan Fun VACE for looks. Lite is the cheaper, faster tier of the same Original. Other
 * hosted open models (SCAIL-2, Wan Motion, Wan 2.2 Animate Replace, hosted Wan 2.2 VACE) and partner models (Kling,
 * P-Video, H3 Max Recast, Gemini Omni, Happy Horse) stay as labelled alternatives. No Higgsfield model or look.
 *
 * Every model takes a part of the clip (Kling 3–15 s, VACE 81 or 241 frames, H3 5–15 s…), so longer selections are cut
 * into pieces or windows, made one by one, joined, and the clip's own sound put back (the remove-object plumbing). Pure
 * module (models per mode and engine, limits, prompts, prices, the pipeline's steps and the shareable setup code),
 * shared by the page, the server (src/server/genjutsu.ts) and the tests.
 * Research: docs/research/fuobe-originals-recipes-5.md §8 genjutsu and O5, openjutsu-6.md, paid-model-apis-4.md §4,
 * comfyui-oss-4.md §c.
 */
import { keepOffered } from "@/lib/model-access";
import { silenceRef } from "./canvas";
import {
  anchorAspect,
  anchorModel,
  anchorPrompt,
  ANCHOR_FALLBACK,
  CHARACTER_QUALITIES,
  CHARACTER_SWAP,
  CLOUD_NO_LORA,
  characterFinish,
  characterQuality,
  h3Canvas,
  partFrames,
  cutsInPart,
  partProblem,
  seedProblem,
  swapLoraRef,
  swapPrompt,
  whoWords,
  windowProblem,
  type CharacterOptions,
  type SwapLora,
  type SwapSpeech,
  type SwapWho,
} from "./character-swap";
import {
  joinWithSound,
  MASK_TRACKER,
  planCloudPieces,
  planFrameCuts,
  planWindows,
  REMOVE_TOOLS,
  targetPhrase,
  VACE_WINDOW,
  wholeClip,
  type FrameWindow,
  type Piece,
  type RemoveMode,
  type RemoveRange,
  type RemoveSource,
} from "./remove-object";
import { firstFramePrompt, getShortsPreset, lookFromPreset, planShorts, segmentPrompt, SHORTS_TOOLS, type PlanStep, type ShortsLook } from "./shorts";
import { getModel } from "./index";
import { REPLACED_BY } from "./replaced";
import { LOOK_IDS, lightWords, type LookId, type PaintKeyframe } from "../openjutsu-graphs";
import { soulLook } from "./soul";
import { filmSize, SHARPEN_COPY, sharpenPrompt, sharpenSteps, sharpenTierFor, type SharpenTier } from "./sharpen";
import type { ChainSlot, Engine, GenerationRequest, PixelPoint } from "./types";

export type GenjutsuMode = "motion" | "character" | "swap" | "restyle" | "insert" | "picture" | "finish";
/** How you say what changes (Object swap and Insert) or who (Character swap): words, clicks on the first frame, or paint on it. */
export type GenjutsuTarget = RemoveMode;
/** Genjutsu's qualities; 2K and 4K are the Character swap's finishing sizes (sharpen.ts). */
export type GenjutsuQuality = "480p" | "720p" | "768p" | "1080p" | "2K" | "4K";
/** Lite ("standard", the cheaper, faster tier of the same Original) or the full Original ("high"). */
export type GenjutsuTier = "standard" | "high";

export const GENJUTSU = {
  feature: "genjutsu",
  /** Cuts, tracks, pieces, joins and the sound: kept apart from the finished videos. */
  stepFeature: "genjutsu-step",
  /** The source window: "Choose a source video between 4 and 30 seconds" (Higgsfield's limit, kept). */
  minSeconds: 4,
  maxSeconds: 30,
  maxBytes: 200 * 1024 * 1024,
  /** "Transfer motion or swap objects with up to 10 reference images". */
  maxReferences: 10,
  /** A custom Restyle look: up to 8 images. */
  maxLookImages: 8,
  maxPoints: 12,
  maxPromptChars: 2000,
  qualities: ["480p", "720p", "1080p"] as GenjutsuQuality[],
  defaultQuality: "720p" as GenjutsuQuality,
  accept: "video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm",
} as const;

export const GENJUTSU_MODES: { id: GenjutsuMode; label: string; hint: string; refs: string }[] = [
  { id: "motion", label: "Motion transfer", hint: "The movement and camera stay exactly as filmed. Swap in your character.", refs: "Your character" },
  {
    id: "character",
    label: "Character swap",
    hint: "Your character takes over the person in the clip — same moves, same scene, same sound. Pick 5–15 seconds of one continuous shot with the person in the first frame.",
    refs: "Your character",
  },
  { id: "swap", label: "Object swap", hint: "Swap a thing, a person or an outfit in the clip for your reference — everything else stays.", refs: "What goes in" },
  { id: "restyle", label: "Restyle", hint: "Pick a look or bring your own images. Every frame takes the look — motion, camera, and framing stay as filmed.", refs: "Characters (optional)" },
  { id: "insert", label: "Insert", hint: "Add your reference to the shot — say where, or paint the spot on the first frame.", refs: "What to add" },
  {
    id: "picture",
    label: "From picture",
    hint: "Your character, in your picture's own setting, moves exactly like the person in the clip. You check the first frame before the video is made.",
    refs: "Your character",
  },
  { id: "finish", label: "Finish", hint: "Give a finished video sharper faces or a soft film finish.", refs: "Character photo" },
];

export const getMode = (id: GenjutsuMode) => GENJUTSU_MODES.find((m) => m.id === id)!;

/** The ways of saying what changes, per mode (Motion transfer and Restyle change the whole shot; Character swap says who). */
export const MODE_TARGETS: Record<GenjutsuMode, GenjutsuTarget[]> = { motion: [], restyle: [], character: ["type", "click"], swap: ["type", "click", "paint"], insert: ["type", "paint"], picture: [], finish: [] };

export const TARGET_LABELS: Record<GenjutsuMode, Partial<Record<GenjutsuTarget, { label: string; hint: string }>>> = {
  motion: {},
  restyle: {},
  picture: {},
  finish: {},
  character: {
    type: { label: "Pick who", hint: "The largest, leftmost or rightmost person, or a number" },
    click: { label: "Click them", hint: "Click the person on the part's first frame" },
  },
  swap: {
    type: { label: "Type it", hint: "Name what to swap" },
    click: { label: "Click it", hint: "Click it on the first frame" },
    paint: { label: "Paint it", hint: "Brush over it on the first frame" },
  },
  insert: {
    type: { label: "Say where", hint: "Describe where it goes" },
    paint: { label: "Paint the spot", hint: "Brush where it goes on the first frame" },
  },
};

// ---------------------------------------------------------------------------
// The Openjutsu modes: what opens to everyone on its own (each after its GPU test), and their settings

/**
 * One thing that opens to everyone on its own, once every workflow it needs has been accepted by ComfyUI and its GPU test
 * passed (src/server/genjutsu-live.ts). Until then only the owner sees and runs it.
 */
export type GenjutsuFeature =
  | "group-swap"
  | "group-swap-one-by-one"
  | "object-change"
  | "object-remove"
  | "object-background"
  | "picture"
  | "picture-light"
  | "picture-own-person"
  | "picture-h3-renderer"
  | "finish-faces"
  | "finish-colours";

export const GENJUTSU_FEATURES: Record<GenjutsuFeature, { mode: GenjutsuMode; workflows: string[]; maker: string }> = {
  "group-swap": { mode: "character", workflows: ["video-group-swap-h3"], maker: "oss-h3-group-swap" },
  "group-swap-one-by-one": { mode: "character", workflows: ["video-group-swap-h3-one-by-one"], maker: "oss-h3-group-swap" },
  "object-change": { mode: "swap", workflows: ["video-scene-edit-h3"], maker: "oss-h3-scene-edit" },
  "object-remove": { mode: "swap", workflows: ["video-scene-edit-h3"], maker: "oss-h3-scene-edit" },
  "object-background": { mode: "swap", workflows: ["video-scene-edit-h3"], maker: "oss-h3-scene-edit" },
  picture: { mode: "picture", workflows: ["image-from-picture-prepare", "video-scene-describe", "video-from-picture-solar"], maker: "oss-from-picture" },
  "picture-light": { mode: "picture", workflows: ["image-from-picture-prepare"], maker: "oss-from-picture" },
  "picture-own-person": { mode: "picture", workflows: ["image-from-picture-prepare"], maker: "oss-from-picture" },
  "picture-h3-renderer": { mode: "picture", workflows: ["video-from-picture-h3"], maker: "oss-from-picture" },
  "finish-faces": { mode: "finish", workflows: ["video-fix-faces-h3"], maker: "oss-h3-fix-faces" },
  "finish-colours": { mode: "finish", workflows: ["video-fix-colours"], maker: "oss-fix-colours" },
};

export const GENJUTSU_FEATURE_KEYS = Object.keys(GENJUTSU_FEATURES) as GenjutsuFeature[];

/** Which features are open to this viewer: everything for the owner (and in tests), else what has passed. */
export type FeatureCheck = (f: GenjutsuFeature) => boolean;
export const ALL_FEATURES: FeatureCheck = () => true;

/** Whether a mode shows for this viewer (the new modes need one of their features open). */
export function modeOpen(mode: GenjutsuMode, open: FeatureCheck = ALL_FEATURES): boolean {
  if (mode === "picture") return open("picture");
  if (mode === "finish") return open("finish-faces") || open("finish-colours");
  return true;
}

/** Scene edit's three actions. */
export type SceneAction = "change" | "remove" | "background";
export const SCENE_ACTIONS: { id: SceneAction; label: string; hint: string; feature: GenjutsuFeature }[] = [
  { id: "change", label: "Change it", hint: "Name what changes and what it becomes. Add a picture to match it exactly.", feature: "object-change" },
  { id: "remove", label: "Remove it", hint: "Name what goes. The space behind it is filled in, and the sound stays.", feature: "object-remove" },
  { id: "background", label: "New background", hint: "The people stay as filmed. Say or show the new place.", feature: "object-background" },
];

/** Object swap on Scene edit: what changes and how. */
export interface ObjectEdit {
  action: SceneAction;
  /** What SAM follows (several, comma-separated); for New background, what stays ("the people"). */
  target?: string;
  /** What it becomes; for Remove it, what shows there. */
  becomes?: string;
  biggestOnly?: boolean;
  keepShape?: boolean;
  edge?: "tight" | "normal" | "loose";
  motionDetail?: 512 | 768;
}

/** From picture's settings: the first frame (stage "frame") or the video (stage "video", from an approved frame). */
export interface PictureOptions {
  stage: "frame" | "video";
  light?: { look: LookId } | { words: string };
  /** Relight the person already in the clip (no character picture). */
  ownPerson?: boolean;
  /** Own person: keep the frame's crop. */
  keepCrop?: boolean;
  /** Extra words for the pose ("arms crossed, chin up"). */
  adjust?: string;
  /** The approved first frame (stage video): a frame this install made. */
  frame?: string;
  /** What happens in the part, in words (the describer's, edited). */
  scene?: string;
  /** The owner's renderer choice (SolarRenderer by default). */
  renderer?: "solar" | "h3";
  /** Motion detail: 0 = match the video, else the motion reference's long edge. */
  motionDetail?: 0 | 512 | 768;
}

/** Finish's settings: Fix faces or Fix colours. */
export interface FinishOptions {
  tool: "faces" | "colours";
  faceStyle?: "photo" | "mouth";
  chunkSeconds?: 4 | 6.5 | 10;
  finish?: "soft" | "filmic" | "rich" | "off";
  /** 0–1 (Orion's 0–0.5). */
  strength?: number;
  /** 0–1 (detail contrast 0 … −0.6). */
  soften?: number;
}

/** The part a new maker takes (seconds): Group swap, Scene edit and From picture 2–15 s; Finish the whole clip. */
export const OPENJUTSU_LIMITS = { minSeconds: 2, maxSeconds: 15, facesMaxSeconds: 10, coloursMaxSeconds: 60, maxCharacters: 4, roleChars: 80, lightChars: 300, sceneChars: 2000 } as const;

/** The feature a request needs (null: an existing Genjutsu feature, always open). */
export function requestFeatures(o: { mode: GenjutsuMode; maker: Maker; character?: CharacterOptions; object?: ObjectEdit; picture?: PictureOptions; finish?: FinishOptions }): GenjutsuFeature[] {
  const m = o.maker;
  if (m.group) return o.character?.onePerPerson ? ["group-swap", "group-swap-one-by-one"] : ["group-swap"];
  if (m.actions) return [SCENE_ACTIONS.find((a) => a.id === (o.object?.action ?? "change"))!.feature];
  if (m.review) {
    const p = o.picture;
    return [
      "picture",
      ...(p?.light ? (["picture-light"] as const) : []),
      ...(p?.ownPerson ? (["picture-own-person"] as const) : []),
      ...(p?.renderer === "h3" ? (["picture-h3-renderer"] as const) : []),
    ];
  }
  if (m.tool) return [m.tool === "faces" ? "finish-faces" : "finish-colours"];
  return [];
}

/**
 * The features a run of one of the new makers' models needs when it is sent straight to POST /api/generations (a script,
 * the CLI, MCP), read from its params.extra.openjutsu: a viewer who isn't the owner runs it only when every one is open.
 * Null for any other model.
 */
export function directRunFeatures(modelId: string, settings: Record<string, unknown> = {}): GenjutsuFeature[] | null {
  const s = settings;
  const light = typeof s.light === "string" && s.light.trim() !== "";
  const own = s.ownPerson === true;
  switch (modelId) {
    case "oss-h3-group-swap":
      return s.onePerPerson === true ? ["group-swap", "group-swap-one-by-one"] : ["group-swap"];
    case "oss-h3-scene-edit":
      return [(SCENE_ACTIONS.find((a) => a.id === s.action) ?? SCENE_ACTIONS[0]).feature];
    case "oss-from-picture-frame":
      return ["picture", ...(light ? (["picture-light"] as const) : []), ...(own ? (["picture-own-person"] as const) : [])];
    case "oss-scene-describe":
      return ["picture", ...(own ? (["picture-own-person"] as const) : [])];
    case "oss-from-picture":
      return ["picture", ...(s.renderer === "h3" ? (["picture-h3-renderer"] as const) : [])];
    case "oss-h3-fix-faces":
      return ["finish-faces"];
    case "oss-fix-colours":
      return ["finish-colours"];
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Models ("makers")

/** Where a model comes from: a Fuobe Original, other open weights hosted on fal, or a partner's closed model. */
export type MakerSource = "original" | "open" | "partner";

export const SOURCE_LABELS: Record<MakerSource, string> = { original: "Fuobe Original", open: "Open weights", partner: "Partner" };

export interface Maker {
  /** The catalog model (a Fuobe Original has one entry per engine, under the same id). */
  id: string;
  engine: Engine;
  modes: GenjutsuMode[];
  /** Object swap, Insert and Character swap: how it is told what changes (or who). */
  targets?: GenjutsuTarget[];
  label: string;
  /** One line for the picker: what it's good at and its limits (open: GPU). */
  note: string;
  source: MakerSource;
  /** Lite (the cheaper, faster tier) or the full Original, and the other one. */
  tier?: GenjutsuTier;
  pair?: string;
  /** Reference images it takes (extra ones are left out, said in a note). */
  refs: { min: number; max: number };
  /** Cloud: the longest piece one call takes, in seconds. */
  maxSeconds?: number;
  minSeconds?: number;
  /** Routes that count frames: one call per window of whole frames (see remove-object's FrameWindow). */
  window?: FrameWindow;
  maxFps?: number;
  /** The result carries the piece's own sound (otherwise the clip's sound is put back). */
  keepsSound: boolean;
  /** The resolutions it renders; the quality asked for goes to the nearest (none: see `renders`). */
  qualities?: string[];
  /** Without a resolution setting: what it renders, in words ("keeps your clip's size", "renders 4K"). */
  renders?: string;
  /** Words aren't needed (P-Video and Recast find who to swap from the references). */
  promptOptional?: boolean;
  /** Swaps the person on camera only. */
  people?: boolean;
  /** Each side of the picture must be within this many pixels (Kling O3 edit: 720–3840). */
  sides?: { min: number; max: number };
  /** Restyle: it takes Fuobe's looks (presets, Soul looks, your own images). */
  looks?: "fuobe";
  /** Restyle: how many of a look's reference images it reads. */
  readsLookImages?: number;
  /** fal bills frames ÷ this as "video seconds" (Wan Animate and VACE count 16 a second, Wan Motion 24). */
  billFps?: number;
  /** params.extra its open route gets (Lite: Wan Animate 2 in 4 steps). */
  extra?: Record<string, unknown>;
  /**
   * Character swap on MiniMax H3: who to swap, the anchor first frame and the H3 settings apply. `maskSwitch`: its graph
   * can regenerate the whole frame instead of only the person (Openjutsu's use_mask; H3 Relay's graph has no switch).
   */
  h3?: { anchor: boolean; maskSwitch?: boolean };
  /** The features that open it (the owner always sees it; others once one of these has passed its GPU test). */
  features?: GenjutsuFeature[];
  /** Group swap: 2–4 characters by role (Who becomes who). */
  group?: boolean;
  /** Scene edit: its actions. */
  actions?: SceneAction[];
  /** From picture: the first frame is made and approved before the video. */
  review?: boolean;
  /** Finish: the tool it is. */
  tool?: "faces" | "colours";
  /** The part it takes, when it isn't the mode's own (seconds). */
  part?: { min: number; max: number };
}

/** fal's hosted Wan VACE (2.1 14B and 2.2 Fun): 17–241 frames (4n+1, the clip's own count and rate), at most 30 fps. */
const VACE_CLOUD_WINDOW: FrameWindow = { cap: 241, step: 4, base: 1, min: 17 };
const VACE_FUN_CLOUD = "wan-22-vace-inpaint";
const FAL_RES = ["480p", "580p", "720p"];

export const ORIGINALS = {
  motion: "fuobe-genjutsu-motion",
  motionLite: "fuobe-genjutsu-motion-lite",
  swap: "fuobe-genjutsu-swap",
  swapLite: "fuobe-genjutsu-swap-lite",
  restyle: "fuobe-genjutsu-restyle",
  character: "fuobe-character-swap",
} as const;

const ORIGINAL_IDS = new Set<string>([...Object.values(ORIGINALS), "fuobe-soul"]);
/** A model that runs on both engines: its steps say which one (GenerationRequest.engine). */
export const isOriginal = (id: string) => ORIGINAL_IDS.has(id);

export const MAKERS: Maker[] = [
  // Motion transfer.
  {
    id: ORIGINALS.motionLite,
    engine: "cloud",
    modes: ["motion"],
    label: "Fuobe Genjutsu",
    note: "Quick 480p takes · one character image · the clip's sound put back",
    source: "original",
    tier: "standard",
    pair: ORIGINALS.motion,
    refs: { min: 1, max: 1 },
    maxSeconds: 30,
    keepsSound: false,
    qualities: ["480p"],
    billFps: 16,
    promptOptional: true,
  },
  {
    id: ORIGINALS.motion,
    engine: "cloud",
    modes: ["motion"],
    label: "Fuobe Genjutsu",
    note: "Up to 720p · one character image · the clip's sound put back",
    source: "original",
    tier: "high",
    pair: ORIGINALS.motionLite,
    refs: { min: 1, max: 1 },
    maxSeconds: 30,
    keepsSound: false,
    qualities: FAL_RES,
    billFps: 16,
    promptOptional: true,
  },
  {
    id: "scail-2",
    engine: "cloud",
    modes: ["motion", "character"],
    targets: ["type"],
    label: "SCAIL-2",
    note: "Humans, groups or animals · up to 10 s a part · $0.20/s",
    source: "open",
    refs: { min: 1, max: 1 },
    maxSeconds: 10,
    minSeconds: 1,
    keepsSound: false,
    qualities: ["512p", "704p"],
    promptOptional: true,
  },
  {
    id: "wan-motion",
    engine: "cloud",
    modes: ["motion"],
    label: "Wan Motion",
    note: "The moves fitted to your character's proportions · 720p",
    source: "open",
    refs: { min: 1, max: 1 },
    maxSeconds: 30,
    keepsSound: false,
    renders: "renders 720p",
    billFps: 24,
    promptOptional: true,
  },
  {
    id: "kling-motion-control",
    engine: "cloud",
    modes: ["motion"],
    label: "Kling 3.0 Motion Control",
    note: "Follows the moves closely · one character image · parts of up to 10 s",
    source: "partner",
    refs: { min: 1, max: 1 },
    maxSeconds: 10,
    minSeconds: 3,
    keepsSound: false,
    renders: "picks its own size",
  },
  {
    id: ORIGINALS.motionLite,
    engine: "open",
    modes: ["motion"],
    label: "Fuobe Genjutsu",
    note: "Quick 480p takes · free on your GPU (24 GB)",
    source: "original",
    tier: "standard",
    pair: ORIGINALS.motion,
    refs: { min: 1, max: 1 },
    keepsSound: true,
    qualities: ["480p"],
    extra: { steps: 4 },
    promptOptional: true,
  },
  {
    id: ORIGINALS.motion,
    engine: "open",
    modes: ["motion"],
    label: "Fuobe Genjutsu",
    note: "Copies the whole performance · free on your GPU (24 GB)",
    source: "original",
    tier: "high",
    pair: ORIGINALS.motionLite,
    refs: { min: 1, max: 1 },
    keepsSound: true,
    qualities: ["480p", "720p"],
    promptOptional: true,
  },

  // Character swap (Openjutsu, Akatz Labs' H3 Character Swap).
  {
    id: ORIGINALS.character,
    engine: "cloud",
    modes: ["character"],
    targets: ["type"],
    label: "Fuobe Character swap",
    note: "Swaps the person you name and keeps the clip's sound · 5–15 s a part",
    source: "original",
    refs: { min: 1, max: 1 },
    maxSeconds: CHARACTER_SWAP.maxSeconds,
    minSeconds: CHARACTER_SWAP.minSeconds,
    keepsSound: false,
    qualities: CHARACTER_QUALITIES.cloud,
    h3: { anchor: true },
    promptOptional: true,
  },
  {
    id: "h3-max-recast",
    engine: "cloud",
    modes: ["character"],
    targets: ["type"],
    label: "MiniMax H3 Max Recast",
    note: "MiniMax's own swap: 1–4 people from photos, across shots, sound kept · 5–30 s · $0.30/s",
    source: "partner",
    refs: { min: 1, max: 4 },
    maxSeconds: 30,
    minSeconds: 5,
    keepsSound: true,
    qualities: ["768p", "1080p"],
    promptOptional: true,
    people: true,
  },
  {
    id: "wan-22-animate-replace",
    engine: "cloud",
    modes: ["character"],
    targets: ["type"],
    label: "Wan 2.2 Animate Replace",
    note: "Replaces the person, lighting matched · one image · up to 720p",
    source: "open",
    refs: { min: 1, max: 1 },
    maxSeconds: 30,
    keepsSound: false,
    qualities: FAL_RES,
    billFps: 16,
    promptOptional: true,
    people: true,
  },
  {
    id: ORIGINALS.character,
    engine: "open",
    modes: ["character"],
    targets: ["type", "click"],
    label: "Fuobe Character swap",
    note: "Only the person you pick is redrawn · free on your GPU · 48 GB+ advised",
    source: "original",
    refs: { min: 1, max: 1 },
    keepsSound: true,
    qualities: CHARACTER_QUALITIES.open,
    h3: { anchor: true, maskSwitch: true },
    promptOptional: true,
  },
  {
    id: "oss-h3-character-swap-relay",
    engine: "open",
    modes: ["character"],
    targets: ["type", "click"],
    label: "H3 Character Swap · Relay 2.0",
    note: "The same swap, with smoother long takes · free on your GPU",
    source: "open",
    refs: { min: 1, max: 1 },
    keepsSound: true,
    qualities: CHARACTER_QUALITIES.open,
    h3: { anchor: false },
    promptOptional: true,
  },

  // Object swap.
  {
    id: ORIGINALS.swapLite,
    engine: "cloud",
    modes: ["swap"],
    targets: ["type", "click", "paint"],
    label: "Fuobe Genjutsu",
    note: "Paints your reference in place of what you name · 480p, fast · up to 4 references",
    source: "original",
    tier: "standard",
    pair: ORIGINALS.swap,
    refs: { min: 1, max: 4 },
    window: VACE_CLOUD_WINDOW,
    maxFps: 30,
    keepsSound: false,
    qualities: ["480p"],
  },
  {
    id: ORIGINALS.swap,
    engine: "cloud",
    modes: ["swap"],
    targets: ["type", "click", "paint"],
    label: "Fuobe Genjutsu",
    note: "Paints your reference in place of what you name · up to 720p · up to 4 references",
    source: "original",
    tier: "high",
    pair: ORIGINALS.swapLite,
    refs: { min: 1, max: 4 },
    window: VACE_CLOUD_WINDOW,
    maxFps: 30,
    keepsSound: false,
    qualities: FAL_RES,
  },
  {
    id: "kling-o3",
    engine: "cloud",
    modes: ["swap", "insert", "character"],
    targets: ["type"],
    label: "Kling O3 Omni edit",
    note: "Up to 4 references as @Image · 3–15 s a part · keeps the clip's size",
    source: "partner",
    refs: { min: 1, max: 4 },
    maxSeconds: 15,
    minSeconds: 3,
    keepsSound: true,
    sides: { min: 720, max: 3840 },
    renders: "keeps your clip's size",
  },
  {
    // Kling 4.0's edit (fal, nm10-kling-4): @Video1 is the piece, @Image1.. what goes in. Billed on the seconds in plus out,
    // at least twice the output: an edit keeps the piece's length, so twice the piece (the catalog's clipInput price).
    id: "kling-4",
    engine: "cloud",
    modes: ["swap", "insert"],
    targets: ["type"],
    label: "Kling 4.0 edit",
    note: "Kuaishou's closed model · up to 10 references as @Image · 3–30 s a piece · billed on the seconds in and out",
    source: "partner",
    refs: { min: 1, max: 10 },
    maxSeconds: 30,
    minSeconds: 3,
    keepsSound: false,
    sides: { min: 700, max: 4553 },
    qualities: ["720p", "1080p"],
  },
  {
    id: "p-video-replace",
    engine: "cloud",
    modes: ["swap", "character"],
    targets: ["type"],
    label: "P-Video Replace",
    note: "The person on camera becomes the one in 1–3 photos · motion, timing and scene kept",
    source: "partner",
    refs: { min: 1, max: 3 },
    keepsSound: true,
    qualities: ["720p", "1080p"],
    promptOptional: true,
    people: true,
  },
  {
    id: VACE_FUN_CLOUD,
    engine: "cloud",
    modes: ["swap", "insert"],
    targets: ["click", "paint"],
    label: "Wan 2.2 VACE (hosted)",
    note: "Changes only the area you mark on the first frame · up to 4 references · 241 frames a part",
    source: "open",
    refs: { min: 1, max: 4 },
    window: VACE_CLOUD_WINDOW,
    maxFps: 30,
    keepsSound: false,
    qualities: FAL_RES,
  },
  {
    id: ORIGINALS.swapLite,
    engine: "open",
    modes: ["swap"],
    targets: ["type"],
    label: "Fuobe Genjutsu",
    note: "Paints your first reference in place of what you name · 480p · free on your GPU (24 GB)",
    source: "original",
    tier: "standard",
    pair: ORIGINALS.swap,
    refs: { min: 1, max: 1 },
    window: VACE_WINDOW,
    keepsSound: true,
    qualities: ["480p"],
  },
  {
    id: ORIGINALS.swap,
    engine: "open",
    modes: ["swap"],
    targets: ["type"],
    label: "Fuobe Genjutsu",
    note: "Paints your first reference in place of what you name · free on your GPU (24 GB)",
    source: "original",
    tier: "high",
    pair: ORIGINALS.swapLite,
    refs: { min: 1, max: 1 },
    window: VACE_WINDOW,
    keepsSound: true,
    qualities: ["480p", "720p"],
  },

  // Restyle.
  {
    id: ORIGINALS.restyle,
    engine: "cloud",
    modes: ["restyle"],
    label: "Fuobe Genjutsu",
    note: "The first frame takes the look, then every frame follows it · 241 frames a part",
    source: "original",
    refs: { min: 0, max: 0 },
    window: VACE_CLOUD_WINDOW,
    maxFps: 30,
    keepsSound: false,
    qualities: FAL_RES,
    looks: "fuobe",
    readsLookImages: 2,
  },
  {
    id: "gemini-omni-flash",
    engine: "cloud",
    modes: ["restyle"],
    label: "Gemini Omni Flash 1.1",
    note: "Restyles from the look's words · parts of up to 10 s",
    source: "partner",
    refs: { min: 0, max: 0 },
    keepsSound: false,
    qualities: ["720p", "1080p"],
    looks: "fuobe",
  },
  {
    id: "kling-o3-4k-edit",
    engine: "cloud",
    modes: ["restyle"],
    label: "Kling O3 4K Edit",
    note: "Reads up to 4 of the look's images · 4K · parts of up to 10 s",
    source: "partner",
    refs: { min: 0, max: 0 },
    keepsSound: false,
    renders: "renders 4K",
    looks: "fuobe",
    readsLookImages: 4,
  },
  {
    id: "happy-horse-video-edit",
    engine: "cloud",
    modes: ["restyle"],
    label: "Happy Horse Video Edit",
    note: "Reads up to 4 of the look's images · parts of up to 10 s",
    source: "partner",
    refs: { min: 0, max: 0 },
    keepsSound: false,
    qualities: ["720p", "1080p"],
    looks: "fuobe",
    readsLookImages: 4,
  },
  {
    id: ORIGINALS.restyle,
    engine: "open",
    modes: ["restyle"],
    label: "Fuobe Genjutsu",
    note: "The first frame takes the look, then every frame follows it · 5 s segments at 16 fps, 480p",
    source: "original",
    refs: { min: 0, max: 0 },
    keepsSound: false,
    renders: "renders 480p at 16 fps",
    looks: "fuobe",
    readsLookImages: 2,
  },

  // The Openjutsu modes (your GPU only): Group swap, Scene edit, From picture, Fix faces, Fix colours.
  {
    id: "oss-h3-group-swap",
    engine: "open",
    modes: ["character"],
    targets: ["type", "click"],
    label: "Group swap",
    note: "Keeps the clip's sound · 2–15 s · up to 4 characters",
    source: "open",
    refs: { min: 1, max: OPENJUTSU_LIMITS.maxCharacters },
    keepsSound: true,
    qualities: ["480p", "720p", "1080p"],
    promptOptional: true,
    people: true,
    group: true,
    features: ["group-swap"],
    part: { min: OPENJUTSU_LIMITS.minSeconds, max: OPENJUTSU_LIMITS.maxSeconds },
  },
  {
    id: "oss-h3-scene-edit",
    engine: "open",
    modes: ["swap"],
    targets: ["type", "paint"],
    label: "Scene edit",
    note: "Change a thing, remove it or put the people somewhere new · keeps the clip's sound · 2–15 s",
    source: "open",
    refs: { min: 0, max: 1 },
    keepsSound: true,
    qualities: ["480p", "720p", "1080p"],
    promptOptional: true,
    actions: ["change", "remove", "background"],
    features: ["object-change", "object-remove", "object-background"],
    part: { min: OPENJUTSU_LIMITS.minSeconds, max: OPENJUTSU_LIMITS.maxSeconds },
  },
  {
    id: "oss-from-picture",
    engine: "open",
    modes: ["picture"],
    label: "From picture",
    note: "You check the first frame first · keeps the clip's sound · 2–15 s",
    source: "open",
    refs: { min: 1, max: 1 },
    keepsSound: true,
    qualities: ["480p", "720p"],
    promptOptional: true,
    review: true,
    features: ["picture"],
    part: { min: OPENJUTSU_LIMITS.minSeconds, max: OPENJUTSU_LIMITS.maxSeconds },
  },
  {
    id: "oss-h3-fix-faces",
    engine: "open",
    modes: ["finish"],
    label: "Face fix",
    note: "Redraws small or soft faces to match your character's photo · up to 10 s",
    source: "open",
    refs: { min: 1, max: 1 },
    keepsSound: true,
    renders: "keeps your clip's size",
    promptOptional: true,
    tool: "faces",
    features: ["finish-faces"],
    part: { min: 1, max: OPENJUTSU_LIMITS.facesMaxSeconds },
  },
  {
    id: "oss-fix-colours",
    engine: "open",
    modes: ["finish"],
    label: "Colour finish",
    note: "A soft film finish in seconds · up to 60 s",
    source: "open",
    refs: { min: 0, max: 0 },
    keepsSound: true,
    renders: "keeps your clip's size",
    promptOptional: true,
    tool: "colours",
    features: ["finish-colours"],
    part: { min: 1, max: OPENJUTSU_LIMITS.coloursMaxSeconds },
  },

  // Insert (no Original yet: VACE inserts in a painted spot on both engines).
  {
    id: "oss-vace-insert",
    engine: "open",
    modes: ["insert"],
    targets: ["paint"],
    label: "Wan 2.1 VACE",
    note: "Your first reference in the painted spot, held for the whole shot (a still or slow camera) · free on your GPU (24 GB)",
    source: "open",
    refs: { min: 1, max: 1 },
    window: VACE_WINDOW,
    keepsSound: true,
    qualities: ["480p", "720p"],
  },
];

/** The maker for a model id (on an engine: an Original has one per engine; the first otherwise). */
export const getMaker = (id: string | undefined, engine?: Engine) => MAKERS.find((m) => m.id === id && (!engine || m.engine === engine));

/**
 * Setups and links made before the Originals name a retired Genjutsu model (src/lib/catalog/replaced.ts) or the
 * round-4 open models: the Original that replaced each (the look and tier are kept where they still mean something).
 */
export const LEGACY_MAKERS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(REPLACED_BY).flatMap(([id, r]) => (Object.values(ORIGINALS).includes(r.id as never) ? [[id, r.id]] : []))),
  "oss-wan22-animate": ORIGINALS.motion,
  "oss-vace-swap": ORIGINALS.swap,
  "oss-wan22-vace-restyle": ORIGINALS.restyle,
};

const SOURCE_RANK: Record<MakerSource, number> = { original: 0, open: 1, partner: 2 };

/**
 * Whether Settings → Models & licences offers a picker entry: Lite and the full Original are one entry, offered while
 * either tier is on.
 */
export const makerOffered = (m: Maker, on: (id: string) => boolean) => on(m.id) || (!!m.pair && on(m.pair));

/** The models you can pick for this engine, mode and way of pointing: Fuobe's Original first, then open weights, then partners. */
export function makersFor(engine: Engine, mode: GenjutsuMode, target?: GenjutsuTarget, open: FeatureCheck = ALL_FEATURES): Maker[] {
  return MAKERS.filter((m) => {
    if (m.engine !== engine || !m.modes.includes(mode)) return false;
    // A maker that hasn't opened yet: the owner's alone.
    if (m.features && !m.features.some(open)) return false;
    if (MODE_TARGETS[mode].length && !(m.targets ?? []).includes(target ?? MODE_TARGETS[mode][0])) return false;
    // Lite and the full Original are one choice in the picker (Quality: Standard / High).
    if (m.tier === "high") return false;
    return true;
  }).sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);
}

export const OPEN_TARGET_PROBLEM: Partial<Record<GenjutsuMode, string>> = {
  swap: "On your ComfyUI, name what to swap — clicking and painting are on the cloud engine",
  insert: "On your ComfyUI, paint where it goes — saying it in words is on the cloud engine",
};

/** Clicking who to swap needs SAM 3.1's mask, which only the open graph has. */
export const CLOUD_CLICK_PROBLEM = "Clicking the person works on your GPU (SAM 3.1 marks them) — on the cloud, pick who in words";

/**
 * The model a request runs on, or why there is none. Without a modelId: the mode's Fuobe Original (Lite unless the
 * tier is High), then other open weights, then partners.
 */
export function chooseMaker(o: {
  engine: Engine;
  mode: GenjutsuMode;
  target?: GenjutsuTarget;
  tier?: GenjutsuTier;
  look?: GenjutsuLook;
  modelId?: string;
  /**
   * Whether Settings → Models & licences offers a model: one switched off isn't picked while another is on (with
   * all of them off the pick stays, and its run names the switch).
   */
  offered?: (id: string) => boolean;
  /** The features open to this viewer (default: all, as for the owner). */
  open?: FeatureCheck;
  /** Character swap: characters added (2 or more: a model that takes them). */
  refs?: number;
  /** Object swap: Scene edit's action (Remove it and New background need Scene edit). */
  action?: SceneAction;
  /** Finish: the tool. */
  tool?: "faces" | "colours";
}): { maker: Maker } | { problem: string } {
  const target = MODE_TARGETS[o.mode].length ? (o.target ?? MODE_TARGETS[o.mode][0]) : undefined;
  if (target && !MODE_TARGETS[o.mode].includes(target)) return { problem: `${getMode(o.mode).label} doesn't take ${target === "click" ? "clicks" : target === "paint" ? "paint" : "that"} — pick another way` };
  const on = o.offered;
  let all = makersFor(o.engine, o.mode, target, o.open);
  // Two characters or more: only a model that takes them all (Group swap on your GPU, Recast in the cloud).
  if (o.mode === "character" && (o.refs ?? 0) > 1) {
    const many = all.filter((m) => m.refs.max >= (o.refs ?? 0));
    if (many.length) all = many;
  }
  // Remove it and New background: Scene edit's actions.
  if (o.mode === "swap" && o.action && o.action !== "change") {
    all = all.filter((m) => m.actions?.includes(o.action!));
    if (!all.length) return { problem: o.engine === "cloud" ? "Remove it and New background run on your GPU" : "Nothing on this engine does that yet" };
  }
  if (o.mode === "finish" && o.tool) all = all.filter((m) => m.tool === o.tool);
  const options = on ? keepOffered(all, (m) => makerOffered(m, on)) : all;
  if (!options.length) {
    if (o.engine === "cloud" && o.mode === "character" && target === "click") return { problem: CLOUD_CLICK_PROBLEM };
    return { problem: (o.engine === "open" && OPEN_TARGET_PROBLEM[o.mode]) || "Nothing on this engine does that yet" };
  }
  // A tier switched off while the other one is on: the one that is on.
  const usable = (m: Maker) => {
    if (!on || on(m.id)) return m;
    const other = m.pair ? getMaker(m.pair, m.engine) : undefined;
    return other && on(other.id) ? other : m;
  };
  const withTier = (m: Maker) => usable(m.pair && o.tier && m.tier !== o.tier ? (getMaker(m.pair, m.engine) ?? m) : m);
  const id = o.modelId && (LEGACY_MAKERS[o.modelId] ?? o.modelId);
  const picked = getMaker(id, o.engine);
  if (picked) {
    // The picker lists Lite; a High pick (or a setup naming the full Original) is the same choice.
    const lite = picked.tier === "high" && picked.pair ? getMaker(picked.pair, picked.engine)! : picked;
    if (options.includes(lite)) return { maker: o.tier ? withTier(lite) : usable(picked) };
  }
  const first = [...options].sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source])[0];
  // Restyle with your own look's images on a partner list: a model that reads them.
  if (o.mode === "restyle" && o.look?.kind === "custom" && first.source === "partner") return { maker: options.find((m) => m.readsLookImages) ?? first };
  return { maker: withTier(first) };
}

// ---------------------------------------------------------------------------
// Looks (Restyle)

export type GenjutsuLook =
  /** One of the 44 Shorts looks (Fuobe's words). */
  | { kind: "preset"; id: string }
  /** One of Fuobe Soul's 139 looks: its LoRAs and words on the first frame. */
  | { kind: "soul"; id: string }
  /** Your own look from up to 8 images, and words if you like. */
  | { kind: "custom"; images: string[]; words?: string };

/** The Shorts look a Fuobe look restyles with (null: an unknown preset). */
export function shortsLook(look: GenjutsuLook): ShortsLook | null {
  if (look.kind === "preset") {
    const p = getShortsPreset(look.id);
    return p ? lookFromPreset(p) : null;
  }
  if (look.kind === "soul") {
    const s = soulLook(look.id);
    return s ? { presetId: s.id, name: s.name, look: s.look } : null;
  }
  const words = look.words?.trim().replace(/[.\s]+$/, "");
  return {
    presetId: "genjutsu-custom",
    name: "Your look",
    look: words ? `the look of the reference images: ${words}` : "the look of the reference images: their colours, textures, lighting and graphic style",
    references: look.images.slice(0, GENJUTSU.maxLookImages),
    custom: true,
    described: !!words,
  };
}

export function lookName(look: GenjutsuLook | undefined): string {
  if (!look) return "a look";
  if (look.kind === "preset") return getShortsPreset(look.id)?.name ?? "a look";
  if (look.kind === "soul") return soulLook(look.id)?.name ?? "a Soul look";
  return "your look";
}

// ---------------------------------------------------------------------------
// Prices

/**
 * Per-second list prices the catalog doesn't carry per resolution: Kling O3's video edit ($0.168/s,
 * paid-model-apis-4.md §4; the catalog's Kling O3 price is its text-to-video one).
 */
export const MAKER_USD: Record<string, Record<string, number>> = {
  "kling-o3": { any: 0.168 },
};

/** A step's own price when MAKER_USD has it (null: the catalog's price applies). */
export function makerStepUsd(modelId: string, params: { duration?: number; resolution?: string } | undefined): number | null {
  const table = MAKER_USD[modelId];
  if (!table) return null;
  const usd = table[params?.resolution ?? ""] ?? table.any ?? table["720p"];
  return usd * (params?.duration ?? 0);
}

const px = (q: string) => parseInt(q, 10) || 0;

/** The resolution a model is asked for: the quality picked, or the nearest it renders (the largest not above, else its smallest). */
export function qualityFor(m: Maker, quality: string): string | undefined {
  if (!m.qualities?.length) return undefined;
  // H3: its own 480p / 768p, or a finishing size of the 768p swap the engine makes (else the swap's own size).
  if (m.h3) return m.qualities.includes(quality) ? quality : characterQuality(quality);
  if (m.qualities.includes(quality)) return quality;
  const below = m.qualities.filter((q) => px(q) <= px(quality)).sort((a, b) => px(b) - px(a));
  return below[0] ?? [...m.qualities].sort((a, b) => px(a) - px(b))[0];
}

/**
 * What comes out when it isn't the quality picked, in words (undefined: it is): "renders 720p (its lowest)" when the
 * model starts above it, "renders up to 720p" when it stops below it, or the model's own words without a setting.
 */
export function resolutionWords(m: Maker, quality: string): string | undefined {
  const res = qualityFor(m, quality);
  if (!res) return m.renders ?? "keeps your clip's size";
  if (res === quality) return undefined;
  return px(res) > px(quality) ? `renders ${res} (its lowest)` : `renders up to ${res}`;
}

// ---------------------------------------------------------------------------
// Words

const tidy = (s: string | undefined) => (s ?? "").trim().replace(/[.\s]+$/, "");
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const imageTags = (n: number) => Array.from({ length: n }, (_, i) => `@Image${i + 1}`).join(", ");

const SWAP = /^\s*(?:please\s+)?(?:replace|swap(?:\s+out)?|change|turn|exchange|substitute)\s+(.+?)\s+(?:with|for|into|by|to)\s+(.+)$/i;

/** "Replace the red car with a horse" → what goes ("the red car") and what comes in ("a horse"); a bare name is what goes. */
export function swapParts(text: string): { what: string; into?: string } {
  const m = SWAP.exec(text.trim());
  return m ? { what: tidy(m[1]), into: tidy(m[2]) } : { what: tidy(text) };
}

/**
 * What a sentence says to swap, for SAM 3.1 to track: "Replace the red car with a horse" → "the red car"; a bare name
 * stays as it is (as remove-object's targetPhrase: the objects alone, comma-separated).
 */
export function swapTarget(text: string): string {
  return targetPhrase(swapParts(text).what);
}

const isVace = (id: string) => id === VACE_FUN_CLOUD || id === ORIGINALS.swap || id === ORIGINALS.swapLite || id === "oss-vace-insert";

export interface PromptInput {
  mode: GenjutsuMode;
  maker: Maker;
  /** Object swap: what goes. */
  subject?: string;
  /** Guidance: the result (swap), where it goes (insert), the character (motion), extra words (restyle), direction (character). */
  prompt?: string;
  refs: number;
  /** Character swap's settings, and whether the anchor first frame goes along. */
  character?: CharacterOptions;
  anchor?: boolean;
}

/** Each model's words for the request (undefined: none needed). */
export function makerPrompt(p: PromptInput): string | undefined {
  const m = p.maker;
  const words = tidy(p.prompt);
  const { what, into } = swapParts(p.subject ?? "");
  const also = into ? ` (${into})` : "";
  if (p.mode === "character") {
    const c = p.character ?? {};
    if (m.h3) return swapPrompt({ ...c, engine: m.engine, anchor: !!p.anchor, direction: p.prompt });
    const who = whoWords(c);
    const described = tidy(c.description);
    const look = described ? `, ${described}` : "";
    if (m.id === "kling-o3") return `Replace ${who} in @Video1 with ${imageTags(1)}${look}${words ? `. ${cap(words)}` : ""}. Keep everything else the same: the performance, camera, framing, light and timing.`;
    if (m.id === "h3-max-recast") return `${cap(who)} becomes the person in the photo${look}.${words ? ` ${cap(words)}.` : ""}`;
    const out = [described ? `The character: ${described}.` : "", words ? `${cap(words)}.` : ""].filter(Boolean).join(" ");
    return out || undefined;
  }
  // Kling O3 and Kling 4.0 edit: the clip is @Video1, the references @Image1...
  if (m.id === "kling-o3" || m.id === "kling-4") {
    const refs = imageTags(Math.max(1, p.refs));
    if (p.mode === "insert") return `Add ${refs} to @Video1${words ? `: ${words}` : ""}. Keep everything else the same: the motion, camera, framing and light.`;
    return `Replace ${what || "the main subject"} in @Video1 with ${refs}${also}${words ? `. ${cap(words)}` : ""}. Keep everything else the same: the motion, camera, framing and light.`;
  }
  if (isVace(m.id)) {
    // VACE's prompt describes the result; the mask (or SAM's track) says where.
    if (words) return `${cap(words)}, matching the light, perspective and motion of the shot.`;
    if (p.mode === "insert") return "The object from the reference image in the marked area, matching the light, perspective and motion of the shot.";
    if (into) return `${cap(into)} in place of ${what}, matching the light, perspective and motion of the shot.`;
    return `${what ? `${cap(what)} replaced by` : "The marked area becomes"} the object from the reference image, matching the light, perspective and motion of the shot.`;
  }
  if (p.mode === "swap") {
    const lead = what ? `Replace ${what} with the reference${p.refs > 1 ? "s" : ""}${also}.` : "";
    const out = [lead, words ? `${cap(words)}.` : ""].filter(Boolean).join(" ");
    return out || undefined;
  }
  return words ? `${cap(words)}.` : undefined;
}

/** A short name for the result ("Genjutsu · Motion transfer"). */
export function genjutsuTitle(o: { mode: GenjutsuMode; subject?: string; look?: GenjutsuLook }): string {
  if (o.mode === "restyle") return `Genjutsu · ${lookName(o.look)}`;
  const s = tidy(o.subject);
  if (o.mode === "swap" && s) return `Genjutsu · swap ${s.length > 48 ? `${s.slice(0, 45)}…` : s}`;
  return `Genjutsu · ${getMode(o.mode).label.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Checks

export interface GenjutsuCheck {
  mode: GenjutsuMode;
  maker: Maker;
  source: RemoveSource;
  range: RemoveRange;
  references: number;
  target?: GenjutsuTarget;
  subject?: string;
  prompt?: string;
  points?: number;
  mask?: boolean;
  look?: GenjutsuLook;
  seed?: number;
  /** Character swap's settings (the LoRA and the window plan are checked). */
  character?: CharacterOptions;
  object?: ObjectEdit;
  picture?: PictureOptions;
  finish?: FinishOptions;
}

/** The first thing that stops a request on one of the Openjutsu makers, in words, or null. */
function openjutsuProblem(c: GenjutsuCheck): string | null {
  const m = c.maker;
  if (m.group) {
    if (c.references < 1) return REFS_MISSING.character;
    if (c.references > OPENJUTSU_LIMITS.maxCharacters) return "Up to four characters";
    if (c.character?.onePerPerson && c.references < 2) return "Add a second character";
    if (c.character?.onePerPerson && c.references > 2) return "One by one takes two characters";
    return null;
  }
  if (m.actions) {
    const action = c.object?.action ?? "change";
    if (action === "change" && c.target === "paint") return c.mask ? null : "Paint over what changes";
    if (action !== "background" && !c.object?.target?.trim() && !c.subject?.trim()) return action === "remove" ? "Name what goes" : "Name what changes";
    return null;
  }
  if (m.review) {
    const p = c.picture ?? { stage: "frame" };
    if (p.ownPerson && !p.light) return "Pick a light, or turn off Keep the clip's own person";
    if (p.light && "words" in p.light && !p.light.words.trim()) return "Say how the light looks";
    if (!p.ownPerson && c.references < 1) return REFS_MISSING.picture;
    if (p.stage === "video" && !p.frame) return "Make and pick the first frame first";
    return null;
  }
  if (m.tool === "faces" && c.references < 1) return REFS_MISSING.finish;
  return null;
}

/** What's wrong with the selection whatever the model, or null. */
export function rangeProblem(source: Pick<RemoveSource, "duration">, range: RemoveRange, mode?: GenjutsuMode, maker?: Maker): string | null {
  if (maker?.part) {
    const len = range.end - range.start;
    if (!(len > 0) || range.start < 0) return "Pick a part of the clip";
    if (source.duration !== undefined && range.end > source.duration + 0.05) return "The selection runs past the end of the clip";
    if (len < maker.part.min - 0.05 || len > maker.part.max + 0.05) return maker.tool ? `Pick up to ${maker.part.max} seconds of the video` : `Pick a part between ${maker.part.min} and ${maker.part.max} seconds`;
    return null;
  }
  if (mode === "character") return partProblem(range, source.duration);
  const len = range.end - range.start;
  if (!(len > 0) || range.start < 0) return "Pick a part of the clip";
  if (source.duration !== undefined && range.end > source.duration + 0.05) return "The selection runs past the end of the clip";
  if (len < GENJUTSU.minSeconds - 0.05) return `Choose a part between ${GENJUTSU.minSeconds} and ${GENJUTSU.maxSeconds} seconds (this is ${len.toFixed(1)} s)`;
  if (len > GENJUTSU.maxSeconds + 0.05) return `Choose up to ${GENJUTSU.maxSeconds} seconds — trim the clip with the handles`;
  return null;
}

const REFS_MISSING: Record<GenjutsuMode, string> = {
  motion: "Add a picture of your character",
  character: "Add a picture of your character",
  swap: "Add a picture of what goes in",
  insert: "Add a picture of what to add",
  restyle: "",
  picture: "Add a picture of your character",
  finish: "Add the character photo",
};

/** The first thing that stops this request, in words, or null. */
export function genjutsuProblem(c: GenjutsuCheck): string | null {
  const general = rangeProblem(c.source, c.range, c.mode, c.maker);
  if (general) return general;
  const m = c.maker;
  if (m.group || m.actions || m.review || m.tool) return openjutsuProblem(c);
  const len = c.range.end - c.range.start;
  const { width: w, height: h } = c.source;
  const target = MODE_TARGETS[c.mode].length ? (c.target ?? MODE_TARGETS[c.mode][0]) : undefined;
  if (m.minSeconds && len < m.minSeconds - 0.01) return `${m.label} needs at least ${m.minSeconds} s`;
  if (m.sides && w && h) {
    if (Math.min(w, h) < m.sides.min) return `${m.label} needs a clip at least ${m.sides.min} px on each side (this one is ${w}×${h}) — pick another model`;
    if (Math.max(w, h) > m.sides.max) return `${m.label} takes clips up to ${m.sides.max} px on a side (this one is ${w}×${h})`;
  }
  if (m.window && !c.source.fps) return "Couldn't read this clip's frame rate — save it as an MP4 (H.264) and try again";
  if (m.maxFps && c.source.fps && c.source.fps > m.maxFps + 0.01) {
    const others = makersFor(m.engine, c.mode, target).filter((x) => x.id !== m.id);
    const words = TARGET_LABELS[c.mode].type?.label;
    const way = others.length ? "pick another model" : words && target !== "type" ? `switch to “${words}”, or save the clip at ${m.maxFps} fps and add it again` : `save the clip at ${m.maxFps} fps and add it again`;
    return `${m.label} takes up to ${m.maxFps} fps (this clip is ${Math.round(c.source.fps)} fps) — ${way}`;
  }
  if (c.mode !== "restyle" && c.references < Math.max(1, m.refs.min)) return REFS_MISSING[c.mode];
  if (c.mode === "restyle") {
    if (!c.look) return "Pick a look";
    if (c.look.kind === "custom" && !c.look.images.length) return "Add up to 8 images for your look";
    if (c.look.kind === "custom" && !m.readsLookImages && !c.look.words?.trim()) return `${m.label} restyles from words only — describe your look, or pick Kling O3 4K Edit`;
  }
  if (c.mode === "character") {
    const seed = seedProblem(c.seed);
    if (seed) return seed;
    if (m.h3 && m.engine === "cloud" && c.character?.lora === "none") return CLOUD_NO_LORA;
    const windows = m.h3 && m.engine === "open" ? windowProblem(c.character ?? {}) : null;
    if (windows) return windows;
    if (target === "click" && !c.points) return "Click the person to swap on the first frame";
    return null;
  }
  if (target === "type") {
    if (c.mode === "swap" && !m.promptOptional && !c.subject?.trim()) return "Say what to swap, e.g. “the red car”";
    if (c.mode === "insert" && !c.prompt?.trim()) return "Say where it goes, e.g. “on the table, next to the cup”";
  }
  if (target === "click" && !c.points) return "Click what to swap on the first frame";
  if (target === "paint" && !c.mask) return c.mode === "insert" ? "Paint where it goes on the first frame" : "Paint over what to swap";
  return null;
}

// ---------------------------------------------------------------------------
// Pieces

/** The pieces a selection is made in: windows on the open engine, frame cuts or equal cuts on the cloud, or one. */
export function planMakerPieces(m: Maker, source: RemoveSource, range: RemoveRange): Piece[] {
  if (m.window) {
    if (!source.fps) return [];
    return m.engine === "open" ? planWindows(range, source.fps, m.window) : planFrameCuts(range, source.fps, m.window);
  }
  if (m.maxSeconds) return planCloudPieces(range, m.maxSeconds, source.fps);
  return [{ index: 0, start: range.start, end: range.end }];
}

/** The seconds a step is billed for: fal's "video seconds" are frames ÷ 16 (or 24), the clip keeping its own rate. */
export function billedSeconds(m: Maker, piece: Piece, fps: number | undefined): number {
  if (piece.frames && m.window) return r6(piece.frames / (m.billFps ?? 16));
  const secs = piece.end - piece.start;
  if (m.billFps && fps) return r6((secs * fps) / m.billFps);
  return r3(secs);
}

// ---------------------------------------------------------------------------
// The pipeline

export interface GenjutsuPlanInput {
  engine: Engine;
  mode: GenjutsuMode;
  maker: Maker;
  title: string;
  source: RemoveSource;
  range: RemoveRange;
  quality: string;
  /** Reference images (the model takes its first refs.max). */
  references: string[];
  target?: GenjutsuTarget;
  subject?: string;
  prompt?: string;
  /** Click it: points on the range's first frame, in the clip's pixels (paint on the cloud: points found in the paint). */
  points?: PixelPoint[];
  /** Paint it: the mask of the range's first frame (white = what changes, or where it goes). */
  mask?: string;
  look?: GenjutsuLook;
  seed?: number;
  /** Character swap's settings. */
  character?: CharacterOptions;
  object?: ObjectEdit;
  picture?: PictureOptions;
  finish?: FinishOptions;
  /** Scene edit's painted area, as the pack's keyframe (the server reads it from the paint). */
  paint?: PaintKeyframe[];
}

export interface GenjutsuPlan {
  steps: PlanStep[];
  /** The finished video's step. */
  final: string;
  /** Pieces (cloud), windows (open) or segments (Restyle). */
  pieces: number;
  /** The clip's own sound is put back on the joined result. */
  sound: boolean;
  /** Cloud swaps: SAM 3.1 follows the object (or the person) through the selection first. */
  tracked: boolean;
  /** Character swap: the anchor first frame is made (and the swap goes on without it if it can't be). */
  anchors?: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const pieceLabel = (p: Piece, n: number, what: string) => ({ label: n > 1 ? `Piece ${p.index + 1} of ${n} · ${what}` : what[0].toUpperCase() + what.slice(1), index: p.index, of: n });

const OP: Record<GenjutsuMode, GenerationRequest["op"]> = { motion: "motion-transfer", character: "video-swap", swap: "video-swap", insert: "video-insert", restyle: "v2v", picture: "picture-video", finish: "tone-video" };

/** Steps on a model that runs on both engines say which one (Originals, the Soul look's first frame). */
function pinEngines(steps: PlanStep[], engine: Engine): PlanStep[] {
  return steps.map((s) => (isOriginal(s.request.modelId) ? { ...s, request: { ...s.request, engine } } : s));
}

/**
 * The whole job, as steps for createPipeline (src/server/chains.ts):
 * - Character swap on MiniMax H3: the anchor first frame (the part's first frame with the character in it), then the
 *   swap with the anchor as Picture 2 — or without it when it couldn't be made; the cloud cuts 15 s pieces;
 * - Restyle: a restyled first frame and Wan Fun VACE per segment (the Original), or the Shorts chain (partners);
 * - open VACE swap / insert: one window per job straight from the upload (the graph reads its own window); Wan
 *   Animate 2: the selection in one job (it loops its own fragments);
 * - cloud: the selection cut into pieces, each made with the references; Fuobe Genjutsu's swap follows the object
 *   with SAM 3.1 (words, clicks or the paint's points) and paints into its mask video; the hosted Wan 2.2 VACE reads a
 *   still mask of each piece's first frame;
 * - then the pieces joined and the clip's own sound put back.
 */
export function planGenjutsu(input: GenjutsuPlanInput): GenjutsuPlan {
  const plan = planSteps(input);
  return { ...plan, steps: pinEngines(plan.steps, input.maker.engine) };
}

function planSteps(input: GenjutsuPlanInput): GenjutsuPlan {
  const om = input.maker;
  if (om.group || om.actions || om.review || om.tool) return planOpenjutsu(input);
  if (input.mode === "character" && input.maker.h3) return planCharacterSwap(input);
  if (input.mode === "restyle" && input.maker.id === ORIGINALS.restyle && input.maker.engine === "cloud") return planCloudRestyle(input);
  if (input.mode === "restyle" && input.maker.looks === "fuobe") return planFuobeRestyle(input);
  const m = input.maker;
  const t = REMOVE_TOOLS[m.engine];
  const pieces = planMakerPieces(m, input.source, input.range);
  if (!pieces.length) throw new Error(genjutsuProblem({ ...input, references: input.references.length, points: input.points?.length, mask: !!input.mask }) ?? "Select a little more of the clip");
  const n = pieces.length;
  const whole = wholeClip(input.range, input.source.duration);
  const base = { feature: GENJUTSU.feature, batchTitle: input.title };
  const helper = { feature: GENJUTSU.stepFeature, batchTitle: input.title };
  const steps: PlanStep[] = [];
  const op = OP[input.mode];
  const sound = !!input.source.hasAudio && (n > 1 || !m.keepsSound);
  const own = (one: boolean) => (one && !sound ? { ...base, title: input.title } : helper);
  const refs = input.references.slice(0, m.refs.max);
  const images = refs.length ? { images: refs } : {};
  const seed = input.seed !== undefined ? { seed: input.seed } : {};
  const resolution = qualityFor(m, input.quality);
  const prompt = makerPrompt({ mode: input.mode, maker: m, subject: input.subject, prompt: input.prompt, refs: refs.length, character: input.character });
  const words = prompt ? { prompt } : {};
  const target = MODE_TARGETS[input.mode].length ? (input.target ?? MODE_TARGETS[input.mode][0]) : undefined;
  const keys = pieces.map((_, i) => `make${i}`);
  const extra = m.extra ? { extra: { ...m.extra } } : {};

  if (m.engine === "open" && m.window) {
    // VACE windows: the graph reads [startTime, endTime) of the upload itself.
    pieces.forEach((p, i) => {
      steps.push({
        key: keys[i],
        request: {
          ...own(n === 1),
          modelId: m.id,
          op,
          ...words,
          inputs: { video: input.source.url, ...images, ...(input.mask ? { mask: input.mask } : {}) },
          params: {
            startTime: p.startTime,
            endTime: p.endTime,
            aspectRatio: "auto",
            ...(resolution ? { resolution } : {}),
            ...seed,
            ...(input.mode === "swap" && input.subject?.trim() ? { extra: { ...m.extra, maskPrompt: swapTarget(input.subject) } } : extra),
          },
          step: pieceLabel(p, n, input.mode === "insert" ? "add it" : "swap it"),
        },
      });
    });
  } else if (m.engine === "open") {
    // Wan Animate 2 runs the whole selection (its graph loops 81-frame fragments) and keeps the clip's fps and sound.
    const cut = !whole;
    if (cut) steps.push({ key: "cut0", request: { ...helper, modelId: t.cut, op: "trim", inputs: { video: input.source.url }, params: { startTime: input.range.start, endTime: input.range.end }, step: { label: "Cut the selection", index: 0, of: 1 } } });
    steps.push({
      key: keys[0],
      request: {
        ...own(true),
        modelId: m.id,
        op,
        ...words,
        inputs: { ...(cut ? {} : { video: input.source.url }), ...images },
        params: { aspectRatio: "auto", ...(resolution ? { resolution } : {}), ...seed, ...extra },
        step: { label: "Transfer the motion", index: 0, of: 1 },
      },
      ...(cut ? { after: ["cut0"], chain: [{ slot: "video" as const }] } : {}),
    });
  } else {
    // Cloud. Fuobe Genjutsu's swap reads a mask video: SAM 3.1's track of what you named, clicked or painted, cut like
    // the clip. The hosted Wan 2.2 VACE reads a still mask of its piece's first frame: the paint for one piece, else the
    // first frame of the track.
    const original = m.id === ORIGINALS.swap || m.id === ORIGINALS.swapLite;
    const tracked = input.mode === "swap" && (original || (m.id === VACE_FUN_CLOUD && (target === "click" || n > 1)));
    const cutRange = tracked && !whole;
    if (cutRange) {
      steps.push({ key: "range", request: { ...helper, modelId: t.cut, op: "trim", inputs: { video: input.source.url }, params: { startTime: input.range.start, endTime: input.range.end }, step: { label: "Cut the selection", index: 0, of: 1 } } });
    }
    if (tracked) {
      const named = target === "type" && input.subject?.trim() ? swapTarget(input.subject) : undefined;
      steps.push({
        key: "track",
        request: {
          ...helper,
          modelId: MASK_TRACKER,
          op: "bg-remove-video",
          ...(named ? { prompt: named } : {}),
          ...(cutRange ? {} : { inputs: { video: input.source.url } }),
          params: { ...(named ? {} : { points: input.points }), duration: r3(input.range.end - input.range.start) },
          step: { label: named ? `Follow ${named} (SAM 3.1)` : "Follow what you marked (SAM 3.1)", index: 0, of: 1 },
        },
        ...(cutRange ? { after: ["range"], chain: [{ slot: "video" as const }] } : {}),
      });
    }
    pieces.forEach((p, i) => {
      // One piece that is the whole upload is read as it is (a frame-count piece only when it is every frame).
      const one = n === 1 && whole && (!p.frames || p.end >= (input.source.duration ?? 0) - 0.05);
      const after: string[] = [];
      const chain: ChainSlot[] = [];
      if (n === 1 && cutRange) {
        after.push("range");
        chain.push({ slot: "video" });
      } else if (!one) {
        steps.push({ key: `cut${i}`, request: { ...helper, modelId: t.cut, op: "trim", inputs: { video: input.source.url }, params: { startTime: p.start, endTime: p.end }, step: pieceLabel(p, n, "cut") } });
        after.push(`cut${i}`);
        chain.push({ slot: "video" });
      }
      let mask: string | undefined;
      if (tracked) {
        // The track covers the selection: each piece takes its own part of it.
        let from = "track";
        if (n > 1) {
          const at = { startTime: r3(p.start - input.range.start), endTime: r3(p.end - input.range.start) };
          steps.push({ key: `mcut${i}`, request: { ...helper, modelId: t.cut, op: "trim", params: at, step: pieceLabel(p, n, "cut the mask") }, after: ["track"], chain: [{ slot: "video" }] });
          from = `mcut${i}`;
        }
        if (original) {
          after.push(from);
          chain.push({ slot: "mask" });
        } else if (i === 0 && target === "paint" && input.mask) mask = input.mask;
        else {
          steps.push({ key: `mframe${i}`, request: { ...helper, modelId: "extract-frame", op: "frame", params: { extra: { frame_type: "first" } }, step: pieceLabel(p, n, "mask's first frame") }, after: [from], chain: [{ slot: "video" }] });
          after.push(`mframe${i}`);
          chain.push({ slot: "mask" });
        }
      } else if (m.id === VACE_FUN_CLOUD && input.mask) mask = input.mask;
      // What per-second prices count: the piece's seconds, or fal's video seconds (frames ÷ 16).
      const secs = billedSeconds(m, p, input.source.fps);
      steps.push({
        key: keys[i],
        request: {
          ...own(n === 1),
          modelId: m.id,
          op,
          ...words,
          inputs: { ...(one ? { video: input.source.url } : {}), ...images, ...(mask ? { mask } : {}) },
          params: { duration: secs, sourceDuration: r3(p.end - p.start), ...(resolution ? { resolution } : {}), ...(m.window ? { aspectRatio: "auto" } : {}), ...(input.source.fps ? { fps: input.source.fps } : {}), ...seed },
          step: pieceLabel(p, n, input.mode === "motion" ? "transfer the motion" : input.mode === "insert" ? "add it" : "swap it"),
        },
        ...(after.length ? { after, chain } : {}),
      });
    });
    const end = m.window ? pieces[n - 1].end : input.range.end;
    const final = n === 1 && !sound ? keys[0] : joinWithSound(steps, { engine: m.engine, title: input.title, base, helper, source: input.source, range: input.range, pieces: keys, sound, end });
    return { steps, final, pieces: n, sound, tracked };
  }
  const final = n === 1 && !sound ? keys[0] : joinWithSound(steps, { engine: m.engine, title: input.title, base, helper, source: input.source, range: input.range, pieces: keys, sound });
  return { steps, final, pieces: n, sound, tracked: false };
}

// ---------------------------------------------------------------------------
// Character swap

/** The open graph's H3 settings (params.extra): who to swap, the mask, the LoRA, the windows. */
export function h3Extra(c: CharacterOptions | undefined): Record<string, unknown> {
  const o = c ?? {};
  const who: SwapWho = o.who ?? "largest";
  const subject = (o.subject ?? "").trim();
  return {
    selection: who,
    subjectIndex: who === "index" ? Math.max(0, Math.min(CHARACTER_SWAP.maxPeople - 1, Math.round(o.index ?? 0))) : 0,
    ...(subject ? { maskPrompt: subject.slice(0, 120) } : {}),
    ...(o.maskGrow !== undefined ? { maskGrow: Math.max(0, Math.min(256, Math.round(o.maskGrow))) } : {}),
    ...(o.audioGuide === false ? { audioGuide: false } : {}),
    ...(o.useMask === false ? { useMask: false } : {}),
    ...(o.windowFrames !== undefined ? { windowFrames: o.windowFrames } : {}),
    ...(o.historyFrames !== undefined ? { historyFrames: o.historyFrames } : {}),
    ...(o.lora && o.lora !== "v1.5" ? { lora: o.lora } : {}),
  };
}

/**
 * Your GPU's 1080p / 2K / 4K (sharpen.ts): after the 768p swap, the person's mask over the part (SAM 3.1, as the swap
 * found them), the part at 24 fps and the film's size, then the swap regenerated (start sigma 0.8, never above the
 * footage's size) and only the character composited over the footage, and the part's own sound put back.
 */
function openFinish(input: GenjutsuPlanInput, asked: SharpenTier, quality: string) {
  const film = filmSize(input.source.width, input.source.height);
  if (!film) throw new Error(SHARPEN_COPY.noSize);
  // H3's canvas the swap is made at: your character is redrawn inside the part of it the regenerate keeps.
  const canvas = h3Canvas(input.source.width!, input.source.height!, quality);
  const tier = sharpenTierFor("open", asked, film, canvas);
  if (!tier) throw new Error(SHARPEN_COPY.small);
  const c = input.character ?? {};
  const helper = { feature: GENJUTSU.stepFeature, batchTitle: input.title };
  const base = { feature: GENJUTSU.feature, batchTitle: input.title, title: input.title };
  const start = r3(input.range.start);
  const end = r3(input.range.end);
  const frames = partFrames(end - start);
  const h3 = h3Extra(c);
  return (steps: PlanStep[], prompt: string): { final: string; sound: boolean } => {
    steps.push({
      key: "mask",
      request: {
        ...helper,
        modelId: SHARPEN_TOOLS.mask,
        op: "bg-remove-video",
        prompt: (typeof h3.maskPrompt === "string" && h3.maskPrompt) || "person",
        inputs: { video: input.source.url },
        params: {
          startTime: start,
          endTime: end,
          resolution: quality,
          matteOutput: "matte",
          ...(input.points?.length ? { points: input.points } : {}),
          extra: {
            selection: input.points?.length ? "index" : h3.selection,
            subjectIndex: input.points?.length ? 0 : h3.subjectIndex,
            maskPrompt: (typeof h3.maskPrompt === "string" && h3.maskPrompt) || "person",
            keyFrame: 0,
            spanFrames: frames,
            shotFrames: frames,
          },
        },
        step: { label: "Find your character's outline (SAM 3.1)", index: 0, of: 1 },
      },
    });
    steps.push({
      key: "fit",
      request: { ...helper, modelId: SHARPEN_TOOLS.fit, op: "trim", inputs: { video: input.source.url }, params: { startTime: start, endTime: end, fps: 24, extra: { ...film } }, step: { label: "The part at 24 fps", index: 0, of: 1 } },
    });
    const sound = !!input.source.hasAudio;
    const made = sharpenSteps({
      key: "sharpen-",
      label: "Your character",
      helper,
      result: sound ? helper : base,
      tier,
      prompt: sharpenPrompt(prompt, c.description),
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
      ...(c.sharpenSigma !== undefined ? { sigma: c.sharpenSigma } : {}),
      frames,
      take: { after: "swap" },
      source: { after: "fit", start: 0 },
      mask: { after: "mask", start: 0 },
      film,
      canvas,
    });
    steps.push(...made.steps);
    if (!sound) return { final: made.final, sound: false };
    // The part's own sound over the whole of it (the composites' slices of it would meet at every window).
    steps.push({
      key: "sound",
      request: { ...base, modelId: SHARPEN_TOOLS.mux, op: "mux", step: { label: "Put the clip's sound back", index: 1200, of: 1000 } },
      after: [made.final, "fit"],
      chain: [{ slot: "video" }, { slot: "audio" }],
    });
    return { final: "sound", sound: true };
  };
}

/** Your GPU's finishing helpers: SAM 3.1's mask of a shot (H3 Relay), the 24 fps fit, the soundtrack. */
export const SHARPEN_TOOLS = { mask: "oss-h3-person-mask", fit: "oss-fit-clip", mux: "oss-mux" } as const;

/**
 * Character swap on MiniMax H3. Open: one job on the upload (the graph trims the part, finds the person with SAM 3.1,
 * continues window after window up to 30 s and keeps the clip's sound). Cloud: 15 s pieces (5–15 s each), each with
 * its anchor, joined, and the clip's sound put back. The anchor (the part's first frame with the character in it) is
 * an optional input of the swap: if it fails, the swap runs without it and says so.
 */
function planCharacterSwap(input: GenjutsuPlanInput): GenjutsuPlan {
  const m = input.maker;
  const c = input.character ?? {};
  const base = { feature: GENJUTSU.feature, batchTitle: input.title };
  const helper = { feature: GENJUTSU.stepFeature, batchTitle: input.title };
  const character = input.references.slice(0, 1);
  if (!character.length) throw new Error(REFS_MISSING.character);
  const quality = characterQuality(input.quality);
  // 1080p / 2K / 4K: the swap is made at 768p, then finished (your GPU: regenerated and composited; fal: made at that size).
  const finish = characterFinish(qualityFor(m, input.quality));
  const seed = input.seed !== undefined ? { seed: input.seed } : {};
  const anchorOn = !!m.h3?.anchor && c.anchor !== false;
  const am = anchorModel(m.engine, c.anchorModel);
  // The first frame keeps the part's shape ("auto", or the clip's nearest ratio): the model's default is square.
  const aspect = anchorAspect(getModel(am.id)?.options.aspectRatios, input.source);
  const steps: PlanStep[] = [];
  const promptWith = (anchor: boolean) => makerPrompt({ mode: "character", maker: m, prompt: input.prompt, refs: 1, character: c, anchor })!;
  const anchorStep = (key: string, frameKey: string, label: { label: string; index: number; of: number }): PlanStep => ({
    key,
    request: {
      ...helper,
      modelId: am.id,
      op: "edit",
      prompt: anchorPrompt(c),
      inputs: { images: character },
      params: { ...(aspect ? { aspectRatio: aspect } : {}), ...(am.extra ? { extra: { ...am.extra } } : {}), ...seed },
      step: label,
    },
    after: [frameKey],
    chain: [{ slot: "images", position: "first" }],
  });
  /** The anchor goes in last among the swap's images (Picture 2); when it fails the swap goes on with this prompt. */
  const anchorSlot = (): ChainSlot => ({ slot: "images", position: "last", optional: { prompt: promptWith(false), notice: ANCHOR_FALLBACK } });

  if (m.engine === "open") {
    const start = input.range.start;
    if (anchorOn) {
      steps.push({
        key: "frame",
        request: { ...helper, modelId: "oss-extract-frame", op: "frame", inputs: { video: input.source.url }, params: { startTime: start, endTime: start + 0.5, extra: { frameIndex: 0 } }, step: { label: "The part's first frame", index: 0, of: 1 } },
      });
      steps.push(anchorStep("anchor", "frame", { label: `Put your character in it (${am.label})`, index: 0, of: 1 }));
    }
    const sharpen = finish ? openFinish(input, finish, quality) : null;
    steps.push({
      key: "swap",
      request: {
        ...(sharpen ? helper : { ...base, title: input.title }),
        modelId: m.id,
        op: "video-swap",
        prompt: promptWith(anchorOn),
        inputs: { video: input.source.url, images: character },
        params: {
          startTime: r3(input.range.start),
          endTime: r3(input.range.end),
          resolution: quality,
          ...(input.points?.length ? { points: input.points } : {}),
          ...seed,
          // Clicked: SAM 3.1's point mask comes first among its detections (the text ones follow), so take that one.
          extra: { ...h3Extra(c), ...(input.points?.length ? { selection: "index", subjectIndex: 0 } : {}) },
        },
        step: { label: "Swap the character (MiniMax H3)", index: 0, of: 1 },
      },
      ...(anchorOn ? { after: ["anchor"], chain: [anchorSlot()] } : {}),
    });
    if (!sharpen) return { steps, final: "swap", pieces: 1, sound: false, tracked: false, anchors: anchorOn ? 1 : 0 };
    const done = sharpen(steps, promptWith(anchorOn));
    return { steps, final: done.final, pieces: 1, sound: done.sound, tracked: false, anchors: anchorOn ? 1 : 0 };
  }

  // Cloud: fal's H3 takes 5–15 s of reference video and whole seconds of output, and needs a swap LoRA.
  if (c.lora === "none") throw new Error(CLOUD_NO_LORA);
  const pieces = planCloudPieces(input.range, CHARACTER_SWAP.maxSeconds, input.source.fps);
  const n = pieces.length;
  const sound = !!input.source.hasAudio;
  const keys: string[] = [];
  const lora = swapLoraRef(c.lora);
  pieces.forEach((p, i) => {
    const label = (what: string) => pieceLabel(p, n, what);
    const secs = r3(p.end - p.start);
    const callSecs = Math.min(CHARACTER_SWAP.maxSeconds, Math.max(CHARACTER_SWAP.minSeconds, Math.ceil(secs - 1e-6)));
    steps.push({ key: `cut${i}`, request: { ...helper, modelId: REMOVE_TOOLS.cloud.cut, op: "trim", inputs: { video: input.source.url }, params: { startTime: p.start, endTime: p.end }, step: label("cut") } });
    const after = [`cut${i}`];
    const chain: ChainSlot[] = [{ slot: "video" }];
    if (anchorOn) {
      steps.push({ key: `frame${i}`, request: { ...helper, modelId: "extract-frame", op: "frame", params: { extra: { frame_type: "first" } }, step: label("first frame") }, after: [`cut${i}`], chain: [{ slot: "video" }] });
      steps.push(anchorStep(`anchor${i}`, `frame${i}`, label(`put your character in it (${am.label})`)));
      after.push(`anchor${i}`);
      chain.push(anchorSlot());
    }
    const fit = callSecs - secs > 0.05;
    // The pieces are steps: the finished video is the join with the clip's sound, or its silence (below).
    steps.push({
      key: `swap${i}`,
      request: {
        ...helper,
        modelId: m.id,
        op: "video-swap",
        prompt: promptWith(anchorOn),
        inputs: { images: character },
        loras: [lora],
        // fal makes 2K and 4K from a 768P base itself: the same call at that size.
        params: { duration: callSecs, sourceDuration: secs, resolution: finish ?? quality, ...seed },
        step: label(finish ? `swap the character at ${finish}` : "swap the character"),
      },
      after,
      chain,
    });
    if (fit) {
      // H3 makes whole seconds: the extra is cut off, so the pieces stay on the clip's sound.
      steps.push({ key: `fit${i}`, request: { ...helper, modelId: REMOVE_TOOLS.cloud.cut, op: "trim", params: { startTime: 0, endTime: secs }, step: label("trim to the part") }, after: [`swap${i}`], chain: [{ slot: "video" }] });
      keys.push(`fit${i}`);
    } else keys.push(`swap${i}`);
  });
  if (sound) {
    const final = joinWithSound(steps, { engine: "cloud", title: input.title, base, helper, source: input.source, range: input.range, pieces: keys, sound });
    return { steps, final, pieces: n, sound, tracked: false, anchors: anchorOn ? n : 0 };
  }
  // A silent clip: fal's H3 (reference to video and audio) makes a soundtrack of its own, so the result gets the clip's
  // silence instead (a silent track the server writes as the run starts, as Canvas mutes a clip).
  const picture = n === 1 ? keys[0] : joinWithSound(steps, { engine: "cloud", title: input.title, base: helper, helper, source: input.source, range: input.range, pieces: keys, sound: false });
  steps.push({
    key: "mute",
    request: { ...base, title: input.title, modelId: REMOVE_TOOLS.cloud.mux, op: "mux", inputs: { audio: silenceRef(r3(input.range.end - input.range.start)) }, step: { label: "Keep it silent, like the clip", index: 1200, of: 1000 } },
    after: [picture],
    chain: [{ slot: "video" }],
  });
  return { steps, final: "mute", pieces: n, sound, tracked: false, anchors: anchorOn ? n : 0 };
}

// ---------------------------------------------------------------------------
// The Openjutsu modes

/** The part's size at a short edge (never larger than the clip), on even numbers. */
export function fitSize(width: number, height: number, shortEdge: number): { width: number; height: number } {
  const k = Math.min(1, shortEdge / Math.min(width, height));
  return { width: Math.max(2, Math.round((width * k) / 2) * 2), height: Math.max(2, Math.round((height * k) / 2) * 2) };
}

/** The short edge each quality fits the part to (the pack's own 736p for 720p). */
const SHORT_EDGE: Record<string, number> = { "480p": 480, "720p": 736, "1080p": 1080 };

/** The scene edit's words for its plan (what goes, what it becomes). */
export function sceneWords(o: ObjectEdit | undefined, subject?: string): { target: string; becomes: string } {
  const action = o?.action ?? "change";
  const target = (o?.target ?? subject ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  return { target: target || (action === "background" ? "the people" : ""), becomes: (o?.becomes ?? "").replace(/\s+/g, " ").trim().slice(0, 300) };
}

/**
 * Group swap, Scene edit, From picture and Finish on your GPU: the part fitted first (24 fps, the quality's short edge,
 * the clip's sound: video-fit-clip, so ComfyUI never decodes more of the clip than it needs), then one job on the
 * Openjutsu graph with its settings (params.extra.openjutsu). From picture's first frame reads the clip itself (one frame).
 */
function planOpenjutsu(input: GenjutsuPlanInput): GenjutsuPlan {
  const m = input.maker;
  const base = { feature: GENJUTSU.feature, batchTitle: input.title, title: input.title };
  const helper = { feature: GENJUTSU.stepFeature, batchTitle: input.title };
  const seed = input.seed !== undefined ? { seed: input.seed } : {};
  const start = r3(input.range.start);
  const end = r3(input.range.end);
  const steps: PlanStep[] = [];
  const w = input.source.width;
  const h = input.source.height;
  const quality = qualityFor(m, input.quality) ?? "720p";
  const fit = (size: { width: number; height: number } | null) => {
    steps.push({
      key: "part",
      request: { ...helper, modelId: SHARPEN_TOOLS.fit, op: "trim", inputs: { video: input.source.url }, params: { startTime: start, endTime: end, fps: 24, ...(size ? { extra: { ...size } } : {}) }, step: { label: "The part at 24 fps", index: 0, of: 1 } },
    });
  };
  const sized = (short: number) => (w && h ? fitSize(w, h, short) : null);
  const job = (key: string, op: GenerationRequest["op"], label: string, images: string[], settings: Record<string, unknown>, own = base): PlanStep => ({
    key,
    request: { ...own, modelId: m.id, op, ...(images.length ? { inputs: { images } } : {}), params: { ...seed, ...(m.qualities ? { resolution: quality } : {}), extra: { openjutsu: { ...settings, ...seed } } }, step: { label, index: 0, of: 1 } },
    after: ["part"],
    chain: [{ slot: "video" }],
  });
  const c = input.character ?? {};
  if (m.group) {
    const refs = input.references.slice(0, OPENJUTSU_LIMITS.maxCharacters);
    fit(sized(SHORT_EDGE[quality] ?? 736));
    steps.push(
      job("swap", "group-swap", refs.length > 1 ? "Swap the characters" : "Swap the character", refs, {
        pictures: refs.length,
        roles: refs.map((_, i) => c.people?.[i]?.role ?? ""),
        quality,
        motion: c.motionDetail ?? 512,
        hats: !!c.hats,
        mouthsFollowSound: c.mouthsFollowSound !== false,
        edge: c.edge ?? "normal",
        ...(c.onePerPerson && refs.length === 2 ? { onePerPerson: true } : {}),
      }),
    );
    return { steps, final: "swap", pieces: 1, sound: false, tracked: false };
  }
  if (m.actions) {
    const o = input.object ?? { action: "change" as const };
    const words = sceneWords(o, input.subject);
    const picture = o.action !== "remove" && input.references.length > 0;
    fit(sized(SHORT_EDGE[quality] ?? 736));
    steps.push(
      job("edit", "scene-edit", o.action === "remove" ? "Remove it" : o.action === "background" ? "Put them somewhere new" : "Change it", picture ? input.references.slice(0, 1) : [], {
        action: o.action,
        target: words.target,
        becomes: words.becomes,
        picture,
        biggestOnly: !!o.biggestOnly,
        keepShape: o.action === "change" && !!o.keepShape,
        edge: o.edge ?? "normal",
        motion: o.motionDetail ?? 512,
        quality,
        ...(o.action === "change" && input.paint?.length ? { paint: input.paint } : {}),
      }),
    );
    return { steps, final: "edit", pieces: 1, sound: false, tracked: false };
  }
  if (m.review) {
    const p = input.picture ?? { stage: "frame" as const };
    if (p.stage === "frame") {
      steps.push({
        key: "frame",
        request: {
          ...base,
          feature: GENJUTSU.stepFeature,
          modelId: "oss-from-picture-frame",
          op: "picture-frame",
          inputs: { video: input.source.url, ...(p.ownPerson ? {} : { images: input.references.slice(0, 1) }) },
          params: { startTime: start, ...seed, extra: { openjutsu: { light: lightWords(p.light), ownPerson: !!p.ownPerson, keepCrop: !!p.keepCrop, adjust: p.adjust ?? "", ...seed } } },
          step: { label: "The first frame", index: 0, of: 1 },
        },
      });
      return { steps, final: "frame", pieces: 1, sound: false, tracked: false };
    }
    if (!p.frame) throw new Error("Make and pick the first frame first");
    const preset = quality === "720p" ? 736 : 480;
    fit(w && h ? fitSize(w, h, preset) : null);
    steps.push(
      job("video", "picture-video", "Make the video", [p.frame], {
        seconds: r3(end - start),
        quality,
        motion: p.motionDetail ?? 0,
        scene: (p.scene ?? "").slice(0, OPENJUTSU_LIMITS.sceneChars),
        ...(p.renderer === "h3" ? { renderer: "h3" } : {}),
      }),
    );
    return { steps, final: "video", pieces: 1, sound: false, tracked: false };
  }
  // Finish: the part, fitted only when it isn't the whole clip or is over 1080p.
  const f = input.finish ?? { tool: m.tool ?? "colours" };
  const whole = wholeClip(input.range, input.source.duration);
  const big = !!w && !!h && Math.min(w, h) > 1080;
  if (!whole || big || m.tool === "faces") fit(sized(1080));
  const settings =
    m.tool === "faces"
      ? { faceStyle: f.faceStyle ?? "mouth", chunkSeconds: f.chunkSeconds ?? 6.5 }
      : { finish: f.finish ?? "soft", strength: f.strength ?? 0.4, soften: f.soften ?? 0.33 };
  const step = job("fix", m.tool === "faces" ? "face-fix-video" : "tone-video", m.tool === "faces" ? "Fix the faces" : "Fix the colours", m.tool === "faces" ? input.references.slice(0, 1) : [], settings);
  if (!steps.length) {
    delete step.after;
    delete step.chain;
    step.request = { ...step.request, inputs: { ...step.request.inputs, video: input.source.url } };
  }
  steps.push(step);
  return { steps, final: "fix", pieces: 1, sound: false, tracked: false };
}

/** How many sections Fix faces renders (for the estimate's note). */
export { faceChunkCount } from "../openjutsu-graphs";

// ---------------------------------------------------------------------------
// Restyle

/**
 * The first frame's restyle: a Soul look's LoRAs on Z-Image (Fuobe Soul's edit, an Original: it runs on the engine the
 * restyle does, never on whichever one is connected first), else an edit model with the look's images: the Shorts
 * chain's own (Qwen-Image 2.1 Turbo on your GPU, hosted Qwen-Image-Edit 2511 in the cloud).
 */
function lookFrameRequest(engine: Engine, look: GenjutsuLook, sl: ShortsLook, refs: string[], seed: object): Pick<GenerationRequest, "modelId" | "op" | "prompt" | "presetId" | "inputs" | "params" | "engine"> {
  if (look.kind === "soul") {
    return { modelId: "fuobe-soul", engine, op: "edit", presetId: look.id, prompt: "The same frame: every person, face, pose and object in place", params: { ...seed } };
  }
  return {
    modelId: SHORTS_TOOLS[engine].frame,
    op: "edit",
    prompt: firstFramePrompt(sl, "auto", refs.length),
    ...(refs.length ? { inputs: { images: refs } } : {}),
    params: { ...seed },
  };
}

/** Restyle on a Fuobe look through the Shorts chain in the clip's own shape (the open Original, and partners). */
function planFuobeRestyle(input: GenjutsuPlanInput): GenjutsuPlan {
  const look = input.look && shortsLook(input.look);
  if (!look) throw new Error("Pick a look");
  const m = input.maker;
  const plan = planShorts({
    engine: m.engine,
    title: input.title,
    source: { url: input.source.url, duration: input.source.duration, hasAudio: input.source.hasAudio, width: input.source.width, height: input.source.height },
    range: input.range,
    look,
    aspectRatio: (input.source.width ?? 16) >= (input.source.height ?? 9) ? "16:9" : "9:16",
    keepShape: true,
    language: "auto",
    modelId: m.id,
    maxRefs: m.readsLookImages ?? 0,
    ...(qualityFor(m, input.quality) ? { resolution: qualityFor(m, input.quality) } : {}),
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
  });
  // Only the finished video is a result; the segments are steps (Shorts keeps each take as a result of its own).
  const final = plan.final ?? plan.takes[0].look;
  const seed = input.seed !== undefined ? { seed: input.seed } : {};
  const steps = plan.steps.map((s) => {
    let request: GenerationRequest = s.key === final ? { ...s.request, feature: GENJUTSU.feature, title: input.title } : { ...s.request, feature: GENJUTSU.stepFeature };
    // The Original runs on the engine it was picked for (a model on both engines would otherwise take the first one connected).
    if (request.modelId === m.id && m.source === "original") request = { ...request, engine: m.engine };
    // A Soul look restyles the first frame with its own LoRAs (Fuobe Soul's edit) instead of the Qwen edit.
    if (input.look?.kind === "soul" && /^frame\d/.test(s.key)) request = { ...request, ...lookFrameRequest(m.engine, input.look, look, [], seed), inputs: undefined };
    return { ...s, request };
  });
  return { steps, final, pieces: plan.segments.length, sound: !!input.source.hasAudio, tracked: false };
}

/**
 * The cloud Original's restyle: per piece of up to 241 frames, cut it, restyle its first frame (a Soul look's LoRAs on
 * Z-Image, or hosted Qwen-Image-Edit 2511 with the look's words and images), then Wan 2.2 Fun VACE carries the look through every
 * frame by depth (fal's first_frame_url); the pieces are joined and the clip's sound put back.
 */
function planCloudRestyle(input: GenjutsuPlanInput): GenjutsuPlan {
  const look = input.look && shortsLook(input.look);
  if (!look) throw new Error("Pick a look");
  const m = input.maker;
  const pieces = planMakerPieces(m, input.source, input.range);
  if (!pieces.length) throw new Error("Couldn't read this clip's frame rate — save it as an MP4 (H.264) and try again");
  const n = pieces.length;
  const base = { feature: GENJUTSU.feature, batchTitle: input.title };
  const helper = { feature: GENJUTSU.stepFeature, batchTitle: input.title };
  const sound = !!input.source.hasAudio;
  const seed = input.seed !== undefined ? { seed: input.seed } : {};
  const refs = (look.references ?? []).slice(0, m.readsLookImages ?? 2);
  const resolution = qualityFor(m, input.quality);
  const steps: PlanStep[] = [];
  const keys: string[] = [];
  pieces.forEach((p, i) => {
    const label = (what: string) => pieceLabel(p, n, what);
    steps.push({ key: `cut${i}`, request: { ...helper, modelId: REMOVE_TOOLS.cloud.cut, op: "trim", inputs: { video: input.source.url }, params: { startTime: p.start, endTime: p.end }, step: label("cut") } });
    steps.push({ key: `frame${i}`, request: { ...helper, modelId: "extract-frame", op: "frame", params: { extra: { frame_type: "first" } }, step: label("first frame") }, after: [`cut${i}`], chain: [{ slot: "video" }] });
    steps.push({ key: `look${i}`, request: { ...helper, ...lookFrameRequest("cloud", input.look!, look, refs, seed), step: label(`first frame as ${look.name}`) }, after: [`frame${i}`], chain: [{ slot: "images", position: "first" }] });
    const own = n === 1 && !sound;
    steps.push({
      key: `restyle${i}`,
      request: {
        ...(own ? { ...base, title: input.title } : helper),
        engine: "cloud",
        modelId: m.id,
        op: "v2v",
        prompt: segmentPrompt(look),
        params: { duration: billedSeconds(m, p, input.source.fps), sourceDuration: r3(p.end - p.start), aspectRatio: "auto", ...(resolution ? { resolution } : {}), ...(input.source.fps ? { fps: input.source.fps } : {}), ...seed },
        step: label("restyle"),
      },
      after: [`cut${i}`, `look${i}`],
      chain: [{ slot: "video" }, { slot: "images", position: "first" }],
    });
    keys.push(`restyle${i}`);
  });
  const final = n === 1 && !sound ? keys[0] : joinWithSound(steps, { engine: "cloud", title: input.title, base, helper, source: input.source, range: input.range, pieces: keys, sound, end: pieces[n - 1].end });
  return { steps, final, pieces: n, sound, tracked: false };
}

// ---------------------------------------------------------------------------
// Setup codes ("share by code", done locally: the settings as base64url JSON)

export interface GenjutsuSetup {
  mode: GenjutsuMode;
  engine?: Engine;
  model?: string;
  tier?: GenjutsuTier;
  quality?: GenjutsuQuality;
  target?: GenjutsuTarget;
  subject?: string;
  prompt?: string;
  look?: GenjutsuLook;
  /** Reference images (files in this install's library). */
  references?: string[];
  /** Character swap's settings (not the part's words: they belong to the clip). */
  character?: Omit<CharacterOptions, "dialogue">;
  object?: ObjectEdit;
  /** From picture's settings (not the frame or the words: they belong to a run). */
  picture?: Omit<PictureOptions, "frame" | "scene" | "stage">;
  finish?: FinishOptions;
}

const MODES = new Set<string>(GENJUTSU_MODES.map((m) => m.id));
const QUALITIES = new Set<string>(["480p", "720p", "768p", "1080p", "2K", "4K"]);
const FILE = /^\/api\/files\/[\w./-]{1,200}$/;
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.slice(0, max) : undefined);
const files = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && FILE.test(x)).slice(0, max) : []);
const num = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : undefined);
const oneOf = <T extends string>(v: unknown, xs: readonly T[]): T | undefined => (typeof v === "string" && (xs as readonly string[]).includes(v) ? (v as T) : undefined);

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(code: string): string {
  const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Character swap's settings as they travel in a code: known values only, defaults left out. */
export function cleanCharacter(v: unknown): Omit<CharacterOptions, "dialogue"> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const out: Omit<CharacterOptions, "dialogue"> = {};
  const who = oneOf(o.who, ["largest", "leftmost", "rightmost", "index"] as const);
  if (who) out.who = who;
  const index = num(o.index, 0, CHARACTER_SWAP.maxPeople - 1);
  if (index !== undefined && who === "index") out.index = index;
  const subject = str(o.subject, 120);
  if (subject) out.subject = subject;
  const grow = num(o.maskGrow, 0, 256);
  if (grow !== undefined) out.maskGrow = grow;
  if (o.anchor === false) out.anchor = false;
  const am = str(o.anchorModel, 60);
  if (am && [...ANCHOR_IDS].includes(am)) out.anchorModel = am;
  const description = str(o.description, CHARACTER_SWAP.maxDescriptionChars);
  if (description) out.description = description;
  const speech = oneOf<SwapSpeech>(o.speech, ["character", "other", "offscreen", "none"] as const);
  if (speech) out.speech = speech;
  const lora = oneOf<SwapLora>(o.lora, ["v1.5", "v1", "none"] as const);
  if (lora) out.lora = lora;
  if (o.audioGuide === false) out.audioGuide = false;
  if (o.useMask === false) out.useMask = false;
  const wf = num(o.windowFrames, 22, 362);
  if (wf !== undefined) out.windowFrames = wf;
  const hf = num(o.historyFrames, 0, 341);
  if (hf !== undefined) out.historyFrames = hf;
  if (Array.isArray(o.people)) {
    const people = o.people.slice(0, OPENJUTSU_LIMITS.maxCharacters).map((p) => {
      const x = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
      const pin = x.pin && typeof x.pin === "object" ? (x.pin as Record<string, unknown>) : undefined;
      const at = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, Math.round(v * 1000) / 1000)) : undefined);
      const px = at(pin?.x);
      const py = at(pin?.y);
      return { role: typeof x.role === "string" ? x.role.slice(0, OPENJUTSU_LIMITS.roleChars) : "", ...(px !== undefined && py !== undefined ? { pin: { x: px, y: py } } : {}) };
    });
    if (people.some((p) => p.role || p.pin)) out.people = people;
  }
  if (o.onePerPerson === true) out.onePerPerson = true;
  if (o.hats === true) out.hats = true;
  if (o.mouthsFollowSound === false) out.mouthsFollowSound = false;
  const edge = oneOf(o.edge, ["tight", "normal", "loose"] as const);
  if (edge) out.edge = edge;
  if (o.motionDetail === 512 || o.motionDetail === 768) out.motionDetail = o.motionDetail;
  return Object.keys(out).length ? out : undefined;
}

/** Scene edit's settings as they travel in a code. */
export function cleanObject(v: unknown): ObjectEdit | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const action = oneOf(o.action, ["change", "remove", "background"] as const);
  if (!action) return undefined;
  const out: ObjectEdit = { action };
  const target = str(o.target, 120);
  if (target) out.target = target;
  const becomes = str(o.becomes, 300);
  if (becomes) out.becomes = becomes;
  if (o.biggestOnly === true) out.biggestOnly = true;
  if (o.keepShape === true) out.keepShape = true;
  const edge = oneOf(o.edge, ["tight", "normal", "loose"] as const);
  if (edge) out.edge = edge;
  if (o.motionDetail === 512 || o.motionDetail === 768) out.motionDetail = o.motionDetail;
  return out;
}

/** From picture's settings as they travel in a code (the frame and the words stay with the run). */
export function cleanPicture(v: unknown): Omit<PictureOptions, "frame" | "scene" | "stage"> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const out: Omit<PictureOptions, "frame" | "scene" | "stage"> = {};
  const l = o.light as Record<string, unknown> | undefined;
  if (l && typeof l === "object") {
    if (typeof l.look === "string" && (LOOK_IDS as string[]).includes(l.look)) out.light = { look: l.look as LookId };
    else if (str(l.words, OPENJUTSU_LIMITS.lightChars)) out.light = { words: str(l.words, OPENJUTSU_LIMITS.lightChars)! };
  }
  if (o.ownPerson === true) out.ownPerson = true;
  if (o.keepCrop === true) out.keepCrop = true;
  const adjust = str(o.adjust, 300);
  if (adjust) out.adjust = adjust;
  if (o.renderer === "h3") out.renderer = "h3";
  if (o.motionDetail === 512 || o.motionDetail === 768) out.motionDetail = o.motionDetail;
  return Object.keys(out).length ? out : undefined;
}

/** Finish's settings as they travel in a code. */
export function cleanFinish(v: unknown): FinishOptions | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const tool = oneOf(o.tool, ["faces", "colours"] as const);
  if (!tool) return undefined;
  const out: FinishOptions = { tool };
  const style = oneOf(o.faceStyle, ["photo", "mouth"] as const);
  if (style) out.faceStyle = style;
  if (o.chunkSeconds === 4 || o.chunkSeconds === 6.5 || o.chunkSeconds === 10) out.chunkSeconds = o.chunkSeconds;
  const finish = oneOf(o.finish, ["soft", "filmic", "rich", "off"] as const);
  if (finish) out.finish = finish;
  const unit = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.min(1, Math.round(x * 100) / 100)) : undefined);
  if (unit(o.strength) !== undefined) out.strength = unit(o.strength);
  if (unit(o.soften) !== undefined) out.soften = unit(o.soften);
  return out;
}

const ANCHOR_IDS = new Set(["gpt-image-2-5-sunburst", "nano-banana-pro", "oss-qwen-image-21", "oss-krea2-identity-edit", "oss-qwen-edit"]);

/** A setup as a short code ("gj1." + base64url JSON with short keys; empty fields left out). */
export function encodeSetup(s: GenjutsuSetup): string {
  const look = s.look && (s.look.kind === "custom" ? { k: "c", i: s.look.images, w: s.look.words || undefined } : { k: s.look.kind === "preset" ? "p" : "s", id: s.look.id });
  const o = {
    m: s.mode,
    e: s.engine,
    x: s.model,
    t: s.tier,
    q: s.quality,
    g: s.target,
    s: s.subject?.trim() || undefined,
    p: s.prompt?.trim() || undefined,
    l: look,
    r: s.references?.length ? s.references : undefined,
    c: s.character && cleanCharacter(s.character),
    o: s.object && cleanObject(s.object),
    i: s.picture && cleanPicture(s.picture),
    f: s.finish && cleanFinish(s.finish),
  };
  return `gj1.${toBase64Url(JSON.stringify(o))}`;
}

/**
 * A setup read back from a code (or a link with ?setup=…), checked field by field; null when it isn't one. A code naming
 * a mode or a setting not open to this viewer opens without it (a mode that isn't open: Motion transfer).
 */
export function decodeSetup(input: string, open: FeatureCheck = ALL_FEATURES): GenjutsuSetup | null {
  let o: Record<string, unknown>;
  try {
    let code = input.trim();
    // A link: its ?setup= (a malformed %-escape is not a code either).
    const fromLink = /[?&]setup=([^&#\s]+)/.exec(code);
    if (fromLink) code = decodeURIComponent(fromLink[1]);
    if (!code.startsWith("gj1.")) return null;
    o = JSON.parse(fromBase64Url(code.slice(4).replace(/\s+/g, ""))) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || typeof o.m !== "string" || !MODES.has(o.m)) return null;
  const mode = modeOpen(o.m as GenjutsuMode, open) ? (o.m as GenjutsuMode) : "motion";
  const out: GenjutsuSetup = { mode };
  if (o.e === "cloud" || o.e === "open") out.engine = o.e;
  const model = str(o.x, 80);
  // Codes from before the Originals name a retired Genjutsu model or the round-4 open models: the Original that replaced it.
  const current = model && (LEGACY_MAKERS[model] ?? model);
  const known = current ? getMaker(current) : undefined;
  if (current && known && (!known.features || known.features.some(open))) out.model = current;
  if (o.t === "standard" || o.t === "high") out.tier = o.t;
  if (typeof o.q === "string" && QUALITIES.has(o.q)) out.quality = o.q as GenjutsuQuality;
  if (typeof o.g === "string" && MODE_TARGETS[mode].includes(o.g as GenjutsuTarget)) out.target = o.g as GenjutsuTarget;
  const subject = str(o.s, 300);
  if (subject) out.subject = subject;
  const prompt = str(o.p, GENJUTSU.maxPromptChars);
  if (prompt) out.prompt = prompt;
  const l = o.l as Record<string, unknown> | undefined;
  if (mode === "restyle" && l && typeof l === "object") {
    if (l.k === "p" && typeof l.id === "string" && getShortsPreset(l.id)) out.look = { kind: "preset", id: l.id };
    else if (l.k === "s" && typeof l.id === "string" && soulLook(l.id)) out.look = { kind: "soul", id: soulLook(l.id)!.id };
    else if (l.k === "c") {
      const images = files(l.i, GENJUTSU.maxLookImages);
      if (images.length) out.look = { kind: "custom", images, ...(str(l.w, 300) ? { words: str(l.w, 300) } : {}) };
    }
    // The retired provider's looks ("h") are gone: the code opens without a look.
  }
  const refs = files(o.r, GENJUTSU.maxReferences);
  if (refs.length) out.references = refs;
  const character = mode === "character" ? cleanCharacter(o.c) : undefined;
  if (character) {
    if (character.onePerPerson && !open("group-swap-one-by-one")) delete character.onePerPerson;
    out.character = character;
  }
  const object = mode === "swap" ? cleanObject(o.o) : undefined;
  if (object && open(SCENE_ACTIONS.find((a) => a.id === object.action)!.feature)) out.object = object;
  const picture = mode === "picture" ? cleanPicture(o.i) : undefined;
  if (picture) {
    if (picture.light && !open("picture-light")) delete picture.light;
    if (picture.ownPerson && !open("picture-own-person")) delete picture.ownPerson;
    if (picture.renderer && !open("picture-h3-renderer")) delete picture.renderer;
    if (Object.keys(picture).length) out.picture = picture;
  }
  const finish = mode === "finish" ? cleanFinish(o.f) : undefined;
  if (finish && open(finish.tool === "faces" ? "finish-faces" : "finish-colours")) out.finish = finish;
  return out;
}

/** Hard cuts in the part, as the server and the page both say them (re-exported for the server's notes). */
export { cutsInPart, swapLoraRef };
