/**
 * Slim preset card data for the galleries, and the procedural previews shown on each card.
 *
 * Gallery pages are server components: they map the full catalog `Preset` (prompt templates,
 * routes, LoRA URLs, parity notes) to `PresetCardData` here, so only what a card shows reaches
 * the browser. A preset with a real cover (a measured render, see preset-previews.generated.ts) shows
 * it; the others get a procedural preview: a camera move over a bundled layered still for motions, a
 * per-category animated treatment for effects and apps. Pure module, safe on both sides.
 *
 * The covers manifest is read in preset-card-data.ts (previewFor, toPresetCard), not here: client
 * components import this module, and would carry the whole manifest into every chunk they are in.
 */
import type { Preset } from "./catalog/types";
import { PRESET_PEAKS } from "./preset-peaks.generated";

/** Bundled sample stills (public/samples/previews, see scripts/gen-preview-scenes.mjs). */
export type PreviewScene = "landscape" | "portrait" | "city" | "product";

export const PREVIEW_LAYERS = ["bg", "mid", "subject", "fg"] as const;
export type PreviewLayer = (typeof PREVIEW_LAYERS)[number];

export const scenePoster = (scene: PreviewScene) => `/samples/previews/${scene}.svg`;
export const sceneLayer = (scene: PreviewScene, layer: PreviewLayer) => `/samples/previews/${scene}-${layer}.svg`;

/** Timing curve of the camera move, see the `pv-*` keyframes in globals.css. */
export type MoveProfile = "ease" | "ease-rev" | "crash" | "crash-rev" | "yoyo" | "slow" | "whip" | "loop";
/**
 * Extra motion on top of the move (keyframes in globals.css): camera-wide ones shake or bank the
 * whole frame, subject ones (bounce, slide, turn) move only the subject layer.
 */
export type MoveStage = "handheld" | "walk" | "bank" | "rack" | "impact" | "float" | "flicker" | "bounce" | "slide" | "turn";

/** How far each layer sits from the camera (parallax weight), and from the subject (orbit weight). */
export const LAYER_DEPTH: Record<PreviewLayer, number> = { bg: 0.15, mid: 0.45, subject: 0.7, fg: 1 };
export const LAYER_OFFSET: Record<PreviewLayer, number> = { bg: -1, mid: -0.5, subject: 0, fg: 1 };
/** Each layer overflows the card by this much on every side, so moves never show its edge. */
export const LAYER_BLEED = 0.12;

/**
 * A camera move, as amounts reached at the end of the move (t = 1). For a layer with depth `d`
 * and subject offset `o`: translate = (pan + tx·d + orbit·o)% of the layer, scale = 1 + zoom + dolly·d,
 * rotate = roll degrees (plus a constant `base` zoom). `layerTransform()` is the same formula the `.pv-layer` rule computes in CSS.
 */
export interface MoveSpec {
  profile: MoveProfile;
  /** Seconds for one pass. */
  duration?: number;
  panX?: number;
  panY?: number;
  tx?: number;
  ty?: number;
  orbit?: number;
  zoom?: number;
  dolly?: number;
  roll?: number;
  /** Zoom held for the whole move (rolls need it from the first frame to hide the corners). */
  base?: number;
  stage?: MoveStage;
  /** Foreground rushes past and fades (through-object moves). */
  through?: boolean;
}

export const CAMERA_MOVES = {
  "zoom-in": { profile: "ease", zoom: 0.32 },
  "zoom-out": { profile: "ease-rev", zoom: 0.32 },
  "optical-zoom": { profile: "slow", zoom: 0.22 },
  "dolly-in": { profile: "ease", dolly: 0.42 },
  "dolly-out": { profile: "ease-rev", dolly: 0.42 },
  "super-dolly-in": { profile: "ease", dolly: 1.1, duration: 2.4 },
  "super-dolly-out": { profile: "ease-rev", dolly: 1.1, duration: 2.4 },
  "crash-in": { profile: "crash", zoom: 0.85 },
  "crash-out": { profile: "crash-rev", zoom: 0.85 },
  "rapid-in": { profile: "crash", zoom: 0.5, duration: 1.8 },
  "rapid-out": { profile: "crash-rev", zoom: 0.5, duration: 1.8 },
  // Dolly zoom: zoom = -dolly × subject depth, so the subject keeps its size while the background
  // shrinks away (dolly in + zoom out) or looms (dolly out + zoom in).
  "dolly-zoom-in": { profile: "ease-rev", dolly: -0.6, zoom: 0.42 },
  "dolly-zoom-out": { profile: "ease", dolly: -0.6, zoom: 0.42 },
  yoyo: { profile: "yoyo", zoom: 0.38 },
  "through-in": { profile: "ease", dolly: 0.9, through: true },
  "through-out": { profile: "ease-rev", dolly: 0.9, through: true },
  "earth-out": { profile: "ease-rev", zoom: 1.6, duration: 3.6 },
  "orbit-left": { profile: "ease", orbit: 9, zoom: 0.04 },
  "orbit-right": { profile: "ease", orbit: -9, zoom: 0.04 },
  "orbit-360": { profile: "ease", orbit: 14, zoom: 0.16, duration: 2.2 },
  "lazy-orbit": { profile: "slow", orbit: 7, zoom: 0.03 },
  "bullet-time": { profile: "slow", orbit: 11, zoom: 0.08, stage: "flicker" },
  turntable: { profile: "slow", orbit: 6, zoom: 0.02, stage: "turn" },
  "crane-up": { profile: "ease", ty: 10, zoom: 0.04 },
  "crane-down": { profile: "ease", ty: -10, zoom: 0.04 },
  "crane-over": { profile: "ease", ty: 13, zoom: 0.16 },
  overhead: { profile: "slow", zoom: 0.2, roll: 8 },
  "tilt-up": { profile: "ease", panY: 7, zoom: 0.03 },
  "tilt-down": { profile: "ease", panY: -7, zoom: 0.03 },
  "pan-left": { profile: "ease", panX: 8, zoom: 0.03 },
  "pan-right": { profile: "ease", panX: -8, zoom: 0.03 },
  "whip-pan": { profile: "whip", panX: -16, zoom: 0.25, stage: "rack" },
  "truck-left": { profile: "ease", tx: 9 },
  "truck-right": { profile: "ease", tx: -9 },
  tracking: { profile: "ease", tx: -9, zoom: 0.03, stage: "walk" },
  "double-dolly": { profile: "ease", dolly: 0.3, orbit: 6, zoom: 0.02 },
  dutch: { profile: "ease", roll: -9, zoom: 0.14 },
  roll: { profile: "loop", roll: 360, base: 0.42, duration: 2 },
  incline: { profile: "ease", roll: -5, ty: 6, zoom: 0.12 },
  handheld: { profile: "slow", zoom: 0.06, stage: "handheld" },
  snorricam: { profile: "slow", orbit: 5, zoom: 0.06, stage: "handheld" },
  pov: { profile: "slow", dolly: 0.22, zoom: 0.04, stage: "walk" },
  fpv: { profile: "ease", dolly: 0.9, zoom: 0.06, stage: "bank", duration: 2.2 },
  "drone-rise": { profile: "ease-rev", zoom: 0.36, ty: -8 },
  "road-rush": { profile: "crash", dolly: 0.7, zoom: 0.05, stage: "handheld", duration: 1.6 },
  "robo-arm": { profile: "whip", orbit: 12, dolly: 0.3, zoom: 0.1 },
  static: { profile: "slow", zoom: 0.015 },
  hyperlapse: { profile: "ease", dolly: 0.6, stage: "flicker", duration: 1.8 },
  timelapse: { profile: "slow", zoom: 0.05, stage: "flicker" },
  "slow-mo": { profile: "slow", dolly: 0.14, duration: 6 },
  "rack-focus": { profile: "ease", zoom: 0.04, stage: "rack" },
  "low-shutter": { profile: "whip", panX: -6, zoom: 0.06, stage: "rack" },
  spin: { profile: "loop", roll: 360, base: 0.42, duration: 3 },
  jump: { profile: "slow", zoom: 0.05, stage: "bounce" },
  "slide-left": { profile: "ease", tx: 6, stage: "slide" },
  "slide-right": { profile: "ease", tx: -6, stage: "slide" },
  impact: { profile: "crash", zoom: 0.1, stage: "impact", duration: 1.4 },
  float: { profile: "slow", ty: -6, zoom: 0.04, stage: "float" },
} satisfies Record<string, MoveSpec>;

/** Where a layer is at time t (0..1) of a move: translate in % of the layer, scale, rotate in degrees. */
export function layerTransform(spec: MoveSpec, layer: PreviewLayer, t: number) {
  const d = LAYER_DEPTH[layer];
  const o = LAYER_OFFSET[layer];
  return {
    x: ((spec.panX ?? 0) + (spec.tx ?? 0) * d + (spec.orbit ?? 0) * o) * t,
    y: ((spec.panY ?? 0) + (spec.ty ?? 0) * d) * t,
    scale: 1 + (spec.base ?? 0) + ((spec.zoom ?? 0) + (spec.dolly ?? 0) * d) * t,
    rotate: (spec.roll ?? 0) * t,
  };
}

/** CSS custom properties that drive a move (read by the `.pv-*` rules in globals.css). */
export function moveVars(spec: MoveSpec): Record<string, string | number> {
  const v: Record<string, string | number> = { "--pv-dur": `${spec.duration ?? (spec.profile === "slow" ? 4.8 : 3)}s` };
  for (const k of ["panX", "panY", "tx", "ty", "orbit", "zoom", "dolly", "roll", "base"] as const) if (spec[k]) v[`--pv-${k}`] = spec[k]!;
  return v;
}

export type CameraMove = keyof typeof CAMERA_MOVES;

/** Per-category treatments for effects and apps (classes `pv-fx-*` in globals.css). */
export const FX = [
  "fire",
  "water",
  "ice",
  "wind",
  "lightning",
  "explode",
  "glow",
  "sparkle",
  "morph",
  "grade",
  "relight",
  "glitch",
  "flare",
  "wipe",
  "halftone",
  "petals",
  "dark",
  "tiny",
  "scan",
  "shine",
  "swap",
  "sharpen",
  "frame",
  "pop",
  "play",
  "crack",
] as const;
export type PreviewFx = (typeof FX)[number];

export interface PresetPreview {
  /** Still shown before (and under) the preview. */
  poster: string;
  /** A real cover's clip (preset-previews.generated.ts), played instead of the procedural preview. */
  video?: string;
  /**
   * Shown at rest instead of the poster: the clip's peak frame (preset-peaks.generated.ts, onPeak), where the clip
   * starts (`at`, in seconds) when it plays by itself, so nothing jumps. Its loop comes back to `from`, just before
   * the change starts, and a hover starts there. Home's cards and the preset header; the galleries keep their posters.
   */
  rest?: { src: string; at: number; from: number };
  scene: PreviewScene;
  move?: CameraMove;
  fx?: PreviewFx;
}

export interface PresetCardData {
  id: string;
  name: string;
  description: string;
  category: string;
  /** Lucide icon name (resolved by PRESET_ICONS). */
  icon: string;
  /** Hue of the preset's look, tints the preview. */
  hue: number;
  top?: true;
  cloud: boolean;
  open: boolean;
  preview: PresetPreview;
}

const has = (s: string, ...words: string[]) => words.some((w) => s.includes(w));
/** Whole-word match, for short words that hide inside others ("ice" in "price", "wind" in "windows"). */
const word = (s: string, ...words: string[]) => words.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(s));

/** Which camera move a motion preset previews, from its id, name and category. */
export function motionMove(p: Pick<Preset, "id" | "name" | "category">): CameraMove {
  const n = `${p.id.replace(/^motion-/, "")} ${p.name}`.toLowerCase();
  const left = has(n, "left");
  const right = has(n, "right");
  // Specific moves first: names overlap ("crash zoom in" contains "zoom in").
  if (has(n, "dolly zoom")) return has(n, "out") ? "dolly-zoom-out" : "dolly-zoom-in";
  if (has(n, "crash zoom")) return has(n, "out") ? "crash-out" : "crash-in";
  if (has(n, "rapid zoom")) return has(n, "out") ? "rapid-out" : "rapid-in";
  if (has(n, "super dolly")) return has(n, "out") ? "super-dolly-out" : "super-dolly-in";
  if (has(n, "yoyo")) return "yoyo";
  if (has(n, "through object")) return has(n, "out") ? "through-out" : "through-in";
  if (has(n, "earth zoom")) return "earth-out";
  if (has(n, "double dolly")) return "double-dolly";
  if (has(n, "dolly")) return left ? "truck-left" : right ? "truck-right" : has(n, "out") ? "dolly-out" : "dolly-in";
  if (has(n, "eyes in", "mouth in", "eating zoom")) return "crash-in";
  if (has(n, "zoom out")) return "zoom-out";
  if (has(n, "zoom in")) return "zoom-in";
  if (n.trim() === "zoom zoom") return "optical-zoom";
  if (has(n, "360", "orbit")) return has(n, "lazy") ? "lazy-orbit" : "orbit-360";
  if (has(n, "arc")) return left ? "orbit-left" : "orbit-right";
  if (has(n, "bullet")) return "bullet-time";
  if (has(n, "lazy susan", "3d rotation")) return "turntable";
  if (has(n, "glam")) return has(n, "timelapse") ? "timelapse" : "orbit-right";
  if (has(n, "over the head")) return "crane-over";
  if (has(n, "crane", "jib", "pedestal")) return has(n, "down") ? "crane-down" : "crane-up";
  if (has(n, "tilt")) return has(n, "down") ? "tilt-down" : "tilt-up";
  if (has(n, "overhead")) return "overhead";
  if (has(n, "buckle")) return "road-rush";
  if (has(n, "whip")) return "whip-pan";
  if (has(n, "pan")) return left ? "pan-left" : right ? "pan-right" : "pan-right";
  if (has(n, "truck")) return left ? "truck-left" : "truck-right";
  if (has(n, "dutch")) return "dutch";
  if (has(n, "incline")) return "incline";
  if (has(n, "roll")) return "roll";
  if (has(n, "snorricam")) return "snorricam";
  if (has(n, "fpv", "flying cam", "flying")) return "fpv";
  if (has(n, "drone", "aerial", "helicopter")) return "drone-rise";
  if (has(n, "road rush", "car chasing", "car grip")) return "road-rush";
  if (has(n, "robo")) return "robo-arm";
  if (has(n, "hyperlapse")) return "hyperlapse";
  if (has(n, "timelapse")) return "timelapse";
  if (has(n, "slow motion")) return "slow-mo";
  if (has(n, "low shutter")) return "low-shutter";
  if (has(n, "focus")) return "rack-focus";
  if (has(n, "static")) return "static";
  if (has(n, "dunk", "ollie", "kick")) return "jump";
  if (has(n, "moonwalk")) return left ? "slide-left" : "slide-right";
  if (has(n, "skate", "snowboard") || word(n, "ski")) return left ? "slide-left" : "slide-right";
  if (has(n, "boxing", "punch")) return "impact";
  if (has(n, "dreamy", "kiss")) return "float";
  if (has(n, "epic")) return "drone-rise";
  if (has(n, "impossible")) return "through-in";
  if (has(n, "intimate", "silent machine")) return "slow-mo";
  if (has(n, "one take", "tracking", "catwalk", "head tracking")) return "tracking";
  if (has(n, "documentary", "raw chaos", "handheld", "bts", "wiggle", "hero cam", "rap flex")) return "handheld";
  if (has(n, "pov", "action run", "downhill")) return "pov";
  if (has(n, "fisheye")) return "crash-in";
  if (has(n, "general")) return "dolly-in";
  // Category fallbacks.
  const c = p.category.toLowerCase();
  if (has(c, "orbit")) return "orbit-right";
  if (has(c, "vertical")) return "crane-up";
  if (has(c, "lateral")) return "truck-right";
  if (has(c, "handheld")) return "handheld";
  if (has(c, "drone")) return "fpv";
  return "dolly-in";
}

/** Treatments named by the preset itself (fire, water, glitch…), shared by effects and apps. */
function keywordFx(n: string): PreviewFx | null {
  if (has(n, "firework", "confetti", "glitter", "fairies", "northern lights", "spark") || word(n, "rain", "money")) return "sparkle";
  if (has(n, "fire", "flame", "lava", "burn", "inferno", "volcano")) return "fire";
  if (has(n, "water", "flood", "splash", "ocean", "aquarium", "bubble", "jelly", "dolphin") || word(n, "pool", "fish")) return "water";
  if (has(n, "freez", "frozen", "snow") || word(n, "ice")) return "ice";
  if (has(n, "air bending", "storm", "tornado", "smoke") || word(n, "wind", "air", "sand", "gas")) return "wind";
  if (has(n, "thunder", "lightning", "plasma", "atomic")) return "lightning";
  if (has(n, "crack", "shatter")) return "crack";
  if (has(n, "disintegrat", "dissolv")) return "wind";
  if (has(n, "head off")) return "glow";
  if (has(n, "explo", "boom", "crush", "smash", "boiling", "earth")) return "explode";
  if (has(n, "glitch", "datamosh", "pixel", "censor", "x-ray", "visor", "lidar", "point cloud", "wireframe", "polygon")) return "glitch";
  if (has(n, "flare", "paparazzi", "flash")) return "flare";
  if (has(n, "bloom", "flower", "petal", "sakura", "garden", "floral") || word(n, "rose")) return "petals";
  if (has(n, "tiny planet", "giant", "colossus")) return "tiny";
  if (has(n, "noir", "vintage", "two color", "ultraviolet", "bleach", "color grad", "colorize")) return "grade";
  if (has(n, "horror", "black tears", "tentacle", "spider", "monster", "demon", "werewolf", "zombie", "ghoul", "giallo")) return "dark";
  if (has(n, "statue", "metal", "melt", "cyborg", "diamond", "clone", "duplicate", "morph", "inflate", "deflate", "squish", "cake", "figur", "plush")) return "morph";
  if (has(n, "comic", "sketch", "paint", "collage", "magazine", "origami", "paper", "style transfer")) return "halftone";
  return null;
}

/** Which treatment an effect previews. */
export function effectFx(p: Pick<Preset, "id" | "name" | "category">): PreviewFx {
  const n = p.name.toLowerCase();
  const c = p.category.toLowerCase();
  if (c === "color grade") return "grade";
  if (c === "transitions" || has(n, "transition", "morphing", "switch")) return "wipe";
  const k = keywordFx(n);
  if (k) return k;
  if (c === "relight" || has(n, "light", "glow", "neon")) return "relight";
  if (c === "mixed media") return "halftone";
  if (c === "horror") return "dark";
  if (c === "transform") return "morph";
  if (c === "magic" || has(n, "angel", "wings", "levitat", "portal", "invisible", "saiyan", "soul") || word(n, "fly")) return "glow";
  if (c === "nature") return "petals";
  if (c === "scale") return "tiny";
  if (c === "commercial") return "shine";
  if (c === "destruction") return "explode";
  if (c === "elements") return "wind";
  if (c === "stylize") return "glitch";
  return "pop";
}

/** Which treatment an app previews. */
export function appFx(p: Pick<Preset, "id" | "name" | "category">): PreviewFx {
  const n = p.name.toLowerCase();
  const c = p.category.toLowerCase();
  if (has(n, "swap", "try-on", "try on", "outfit", "stylist", "style snap", "steal the look", "recast", "hairstyle", "makeup")) return "swap";
  if (has(n, "remove background", "background remover", "object remover", "change background")) return "wipe";
  if (has(n, "upscale", "enhance", "restore", "sharpen", "denoise", "text edit")) return "sharpen";
  if (has(n, "relight", "lighting")) return "relight";
  if (has(n, "color")) return "grade";
  if (has(n, "transition", "match cut")) return "wipe";
  if (has(n, "predict", "score", "breakdown", "headshot", "commercial faces", "influencer")) return "scan";
  if (has(n, "age", "expression")) return "morph";
  if (word(n, "angles?", "shots?", "zooms?", "zoom out", "frame") || has(n, "expand", "what's next", "what’s next", "behind the scenes")) return "frame";
  const k = keywordFx(n);
  if (k) return k;
  if (c === "identity") return "scan";
  if (c === "fashion") return "swap";
  if (c === "product") return "shine";
  if (c === "style") return "halftone";
  if (c === "utility") return "sharpen";
  if (c === "camera") return "frame";
  if (c === "video") return "play";
  return "pop";
}

/** A small stable hash (FNV-1a), for per-preset variety that is the same on the server and the client. */
export function stableHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** One of `pool`, picked by the preset id: presets without telling words still differ from their neighbours. */
function pick<T>(id: string | undefined, pool: readonly T[]): T {
  return pool[id ? stableHash(id) % pool.length : 0];
}

/** Which bundled still a preset's preview runs on. */
export function previewScene(p: Pick<Preset, "type" | "name" | "category"> & { id?: string }): PreviewScene {
  const n = p.name.toLowerCase();
  const c = p.category.toLowerCase();
  if (p.type === "motion") {
    if (has(n, "eyes", "mouth", "eating", "kiss", "snorricam", "head tracking", "rap flex", "selfie", "fisheye", "glam", "lazy susan", "intimate")) return "portrait";
    if (c.includes("drone") || has(n, "road", "car", "buckle", "robo", "hyperlapse")) return "city";
    if (has(n, "crane", "jib", "pedestal", "tilt", "aerial", "earth", "epic", "downhill")) return "landscape";
    return pick(p.id, ["landscape", "city", "portrait", "product"] as const);
  }
  if (p.type === "app") {
    if (c === "product" || has(n, "product", "packshot", "ad ", "billboard", "unboxing")) return "product";
    if (has(n, "urban", "clipcut", "truck", "roller")) return "city";
    if (["identity", "fashion", "fun", "video"].includes(c) || has(n, "face", "portrait", "headshot", "hair", "makeup", "selfie")) return "portrait";
    return pick(p.id, ["landscape", "city", "portrait"] as const);
  }
  if (c === "commercial") return "product";
  if (has(n, "car", "building", "street", "city", "train", "helicopter", "road", "giant", "colossus", "concert", "tiny planet")) return "city";
  if (has(n, "fish", "ocean", "flood", "water", "sand", "earth", "nature", "garden", "northern", "timelapse", "planet")) return "landscape";
  if (has(n, "head", "face", "eyes", "body", "hair", "skin", "tears", "mask")) return "portrait";
  if (["destruction", "scale"].includes(c)) return pick(p.id, ["city", "landscape", "portrait"] as const);
  if (["elements", "nature", "color grade", "transitions"].includes(c)) return pick(p.id, ["landscape", "city", "portrait"] as const);
  return pick(p.id, ["portrait", "landscape", "city", "portrait"] as const);
}

/** The procedural preview (a preset without a real cover): a camera move for motions, a treatment for effects and apps. */
export function proceduralPreview(p: Pick<Preset, "id" | "type" | "name" | "category">): PresetPreview {
  const scene = previewScene(p);
  return {
    poster: scenePoster(scene),
    scene,
    ...(p.type === "motion" ? { move: motionMove(p) } : { fx: p.type === "effect" ? effectFx(p) : appFx(p) }),
  };
}

/**
 * Whether a preview is a real cover (preset-previews.generated.ts) rather than a procedural one: every
 * procedural preview carries a camera move (motions) or a treatment (effects, apps), a cover neither.
 */
export const isCover = (p: Pick<PresetPreview, "move" | "fx">) => !p.move && !p.fx;

/**
 * A poster's 320 px copy: thumbs/ next to it (pnpm eval:covers makes the covers' own, gen-preset-peaks the peaks'),
 * with the poster's version (?v=), which the generators hash from both files.
 */
export const thumbOf = (poster: string) => poster.replace(/\/([^/]+)$/, "/thumbs/$1");

/** The card resting on its clip's peak frame (preset-peaks.generated.ts) when it has one, else as it is. */
export function onPeak(card: PresetCardData): PresetCardData {
  const peak = PRESET_PEAKS[card.id];
  if (!peak) return card;
  return { ...card, preview: { ...card.preview, rest: { src: `/previews/presets/peak/${card.id}.jpg?v=${peak.v}`, at: peak.at, from: peak.from } } };
}

/**
 * Whether a card shows its still mirrored, so neighbouring treatments on the same still differ.
 * Never for camera moves (a pan left must still go left), nor for a real cover (shown as rendered).
 * Derived from the id on the client, so it costs nothing in the gallery payload.
 */
export function previewFlip(c: { id: string; preview: Pick<PresetPreview, "move" | "fx"> }): boolean {
  return !!c.preview.fx && ((stableHash(c.id) >>> 3) & 1) === 1;
}

/** The hue a preset's look was built from (`oklch(L C <hue>)`), for tinting its preview. */
export function lookHue(look: Preset["look"]): number {
  const m = /oklch\([^)]*?\s([\d.]+)\s*\)/.exec(look.from);
  return m ? Math.round(Number(m[1])) % 360 : 282;
}

/**
 * What a gallery card needs, and nothing else, with the preview it shows (toPresetCard in preset-card-data.ts picks it).
 * The whole description: the card clamps it to two lines, and a phone opens the rest in place (readMoreTap).
 */
export function presetCard(p: Preset, preview: PresetPreview): PresetCardData {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    icon: p.look.icon,
    hue: lookHue(p.look),
    ...(p.badges?.includes("top") ? { top: true as const } : {}),
    cloud: !!p.cloud,
    open: !!p.open,
    preview,
  };
}

/**
 * A showcase row: one preset per category (its "top" one when it has one), in catalog order, so
 * the row shows `n` different kinds of effect instead of the first category's six.
 */
export function homeEffects<T extends Pick<Preset, "category" | "badges">>(presets: T[], n: number): T[] {
  const best = new Map<string, T>();
  for (const p of presets) {
    const cur = best.get(p.category);
    if (!cur || (!cur.badges?.includes("top") && p.badges?.includes("top"))) best.set(p.category, p);
  }
  return [...best.values()].slice(0, n);
}

/**
 * The "All" view of a gallery: categories taken in turn (first of each, then second of each…), so
 * the first screen shows the range of the catalog instead of one category's near-identical cards.
 * Stable: within a category the catalog order is kept.
 */
export function interleaveByCategory<T extends { category: string }>(items: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const it of items) groups.set(it.category, [...(groups.get(it.category) ?? []), it]);
  const lists = [...groups.values()];
  const out: T[] = [];
  for (let i = 0; out.length < items.length; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

/** Lower-cased text a gallery search matches against. */
export const searchText = (c: Pick<PresetCardData, "name" | "description" | "category">) => `${c.name} ${c.description} ${c.category}`.toLowerCase();

/** A search word without a plain English ending (explosions → explosion, remover and removing → remov), so other forms match. */
const stem = (w: string) => (w.length > 4 ? w.replace(/(?:ing|es|er|s)$/, "") : w);

/**
 * Whether a gallery's search text (searchText) matches what was typed: every word, in any order, in any of its simple
 * forms ("explosions", "removing background"). The query is lower-cased already.
 */
export function matchesSearch(text: string, query: string): boolean {
  return query.split(/\s+/).every((w) => !w || text.includes(stem(w)));
}

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const article = (s: string) => (/^(a|an|the|your|my)\s/i.test(s) ? s : `${/^[aeiou]/i.test(s) ? "an" : "a"} ${s}`);

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Which model each engine runs a preset on, for the preset header's details popover (the studio
 * hero no longer needs to spell out "Cloud: … · Open source: …").
 */
export function presetRouteLines(
  p: Pick<Preset, "cloud" | "open" | "parity">,
  nameOf: (modelId: string) => string | undefined = () => undefined,
): { engine: "cloud" | "open"; label: string; model: string | null }[] {
  return (["cloud", "open"] as const).map((engine) => {
    const route = p[engine];
    const name = route ? (nameOf(route.modelId) ?? route.modelId) : null;
    // A LoRA licensed for the user's GPU only (civitai "RentCivit"): the cloud route keeps the preset's words until Fuobe
    // DoP with the LoRA is evaluated there; the licence is said, not enforced.
    const gpuOnly = engine === "cloud" && !route?.loras?.length && !!p.open?.loras?.length && p.open.loras.every((l) => l.licence?.hostedOk === false);
    return { engine, label: engine === "cloud" ? "Cloud" : "Open source", model: name && gpuOnly ? `${name} · words only (its LoRA is licensed for your GPU only)` : name };
  });
}

/** Where a card's text has no tooltip to show the rest of it: a phone, or a screen with no mouse. */
export const TAP_TO_READ = "(max-width: 639px), (hover: none)";

/**
 * A tap on a card's two-line description where there is no tooltip (TAP_TO_READ): text cut short opens in place, and
 * a second tap closes it, in place of opening the preset. Text that fits its two lines, and every click on a desktop,
 * open the preset as before. The open state the text takes next, or null to let the click through to the card's link.
 */
export function readMoreTap(text: { scrollHeight: number; clientHeight: number }, open: boolean, tapToRead: boolean): boolean | null {
  if (!tapToRead) return null;
  if (open) return false;
  return text.scrollHeight > text.clientHeight + 1 ? true : null;
}

/** One line telling the user what to do with a preset, e.g. "Add a target photo and a face, then Generate." */
export function presetHowTo(p: Pick<Preset, "inputs" | "userPrompt" | "type">): string {
  const needs = p.inputs.filter((i) => i.required).map((i) => article(lowerFirst(i.label)));
  const optional = p.inputs.filter((i) => !i.required).map((i) => article(lowerFirst(i.label)));
  if (!needs.length) {
    const first = p.userPrompt === "required" ? "Describe what you want" : optional.length ? `Add ${joinList(optional)} (optional)` : "Press Generate";
    return first === "Press Generate" ? "Press Generate — no inputs needed." : `${first}, then Generate.`;
  }
  // An optional prompt goes unsaid: the composer shows its placeholder anyway.
  return `Add ${joinList(needs)}${p.userPrompt === "required" ? " and describe what you want" : ""}, then Generate.`;
}
