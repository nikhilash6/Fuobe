/**
 * Mixed Media (Higgsfield's /mixed-media): turn a 1–10 s clip into mixed-media art (sketch, comic,
 * paper, neon…) with per-preset settings. Higgsfield samples frames at 4–24 fps and stylises each
 * one, priced per output frame. Fuobe Mixed Media (build plan O9) does the same on both engines:
 * every frame drawn again in the look by Z-Image Turbo under the frame's own outlines (its Fun
 * ControlNet), with the look's LoRA and one fixed seed — one per-frame job on your GPU, or on fal
 * cut → every Nth frame → one controlled frame each → frames back to video (clips of up to 200 frames,
 * joined) → the cut's own sound. Its "Smooth" option draws only the first frame in the look and lets
 * Wan 2.2 Fun VACE carry it through the clip by depth (Fuobe Shorts' pass). Partner choices stay: on
 * the cloud, Per frame with Nano Banana 2 or Seedream 5.0 Flash (each frame looking at the frame styled
 * before it), and "Fast", one video-to-video restyle model on the trimmed clip, anchored on the preview
 * frame when the model takes one (LTX 2.3 reference restyle).
 *
 * Pure module, shared by the page, src/server/mixed-media.ts and the tests.
 * Research: docs/research/higgsfield-studios.md §3, docs/research/fuobe-originals-recipes-5.md §8 mixed-media.
 */
import { scenePoster, type PresetPreview, type PreviewFx, type PreviewScene } from "../preset-cards";
import { templateCover, templatePreview } from "../template-covers";
import { planShorts, SHORTS_ORIGINAL, type PlanStep, type ShortsLook } from "./shorts";
import type { Engine, GenerationRequest, LoraRef } from "./types";
import { originalSoundProblem, separates, SOUND_STEP_LABEL, soundBack, soundOf, withSoundExtra, type SoundChoice } from "../av/original-sound";

export const MIXED = {
  minSeconds: 1,
  maxSeconds: 10,
  maxBytes: 50 * 1024 * 1024,
  minSourceFps: 4,
  fps: [4, 8, 10, 12, 24] as const,
  defaultFps: 8,
  manualFps: { min: 4, max: 24 },
  resolutions: ["1K", "2K", "4K"] as const,
  /** Higgsfield: 2 credits per output frame (×2 at 4K). */
  accept: "video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm",
} as const;

export type MixedResolution = (typeof MIXED.resolutions)[number];

export const MIXED_FEATURE = "mixed-media";
/** Helper steps (the cut, the render before the soundtrack) and preview frames stay out of History. */
export const MIXED_STEP_FEATURE = "mixed-media-step";
export const MIXED_PREVIEW_FEATURE = "mixed-media-preview";
/** Cloud Per frame: one edit per frame. A helper step too ("-step"), kept apart so History and the render view don't load hundreds of them. */
export const MIXED_FRAME_FEATURE = "mixed-media-frame-step";

/** Mixed Media's Original (O9): every frame drawn again in the look on Z-Image Turbo + ControlNet, on both engines. */
export const MIXED_ORIGINAL = "fuobe-mixed-media";
/** Smooth's pass after the first frame: Fuobe Shorts' Wan 2.2 Fun VACE by depth (both engines). */
export const MIXED_SMOOTH_MODEL = SHORTS_ORIGINAL;
/** The per-frame model Mixed Media ran on the open engine before the Original (API callers that name it keep it). */
export const MIXED_OPEN_LEGACY = "oss-mixed-media";

/** Fast's video-to-video restyle models (cloud; the first is Fast's default) and the open per-frame model. */
export const MIXED_MODELS: Record<Engine, string[]> = {
  cloud: ["ltx-2-3-restyle", "lucy-edit-pro", "gemini-omni-flash", "kling-o3-4k-edit", "happy-horse-video-edit", "wan-2-7", "runway-aleph-2"],
  open: [MIXED_ORIGINAL],
};
export const MIXED_TOOLS = {
  cloud: { cut: "trim-video", mux: "merge-audio-video", preview: "nano-banana-2-1", frames: "extract-frames", assemble: "images-to-video", join: "join-clips" },
  /** cut / mux: Original sound other than Everything (the per-frame graph keeps the clip's sound itself). */
  open: { preview: MIXED_ORIGINAL, cut: "oss-trim", mux: "oss-mux" },
} as const;

/**
 * How a render restyles: frame by frame like Higgsfield (the default, both engines), Smooth (the Original's first frame,
 * then Wan 2.2 Fun VACE by depth: no flicker), or Fast (cloud: one partner video-to-video pass).
 */
export type MixedMode = "frames" | "smooth" | "fast";
/** The modes each engine offers. */
export const MIXED_MODES: Record<Engine, MixedMode[]> = { cloud: ["frames", "smooth", "fast"], open: ["frames", "smooth"] };
/**
 * Cloud models that draw each frame (the first is the default): Fuobe Mixed Media (Z-Image Turbo + ControlNet with the
 * look's LoRA, one seed, every frame on its own), then the partner image editors, Nano Banana 2.1 (it takes a seed) and
 * Seedream 5.0 Flash, which redraw each frame looking at the one styled before it.
 */
export const MIXED_FRAME_MODELS = [MIXED_ORIGINAL, "nano-banana-2-1", "seedream-5-flash"] as const;
/** Frame models Per frame no longer lists, and the one a render that names them (a saved setup, an API caller) runs on now. */
export const MIXED_FRAME_MOVES: Readonly<Record<string, string>> = { "nano-banana-2": "nano-banana-2-1" };

/**
 * Cloud per-frame limits: fal's extract-nth-frame returns up to 500 frames a call and images-to-video
 * takes up to 200 images. Frames are styled in lanes of `lane`: each frame looks at the one styled before
 * it, and each lane's first frame at the approved preview (else the first styled frame), so lanes run side
 * by side and a 240-frame clip takes the time of about 13 edits, not 240. The price of that: a lane's first
 * frame matches the preview, not the frame before it, so a look that drifts within a lane can step back
 * every `lane` frames (the page's How it works says so). merge-videos sizes its output 512–2048 px
 * (`joinMaxPx`): clips of more than 200 frames are joined at that size.
 */
export const FRAME_LIMITS = { perExtract: 500, perClip: 200, lane: 12, maxInterval: 300, joinMaxPx: 2048, joinMinPx: 512 } as const;
/** The seed every frame is redrawn with when the request names none (the same seed keeps frames alike). */
export const FRAME_SEED = 424242;

// ---------------------------------------------------------------------------
// Settings (Higgsfield's per-preset param_configs: colour pickers, dropdowns with a custom option, text)

export type MixedSetting =
  | { key: string; label: string; type: "color"; default: string }
  | { key: string; label: string; type: "select"; options: { value: string; label: string; prompt: string }[]; default: string; custom?: boolean }
  | { key: string; label: string; type: "text"; default: string; placeholder: string; max: number };

/**
 * A setting's value: "#rrggbb" for a colour, an option value for a dropdown, the words for text.
 * "Write settings as prompt" (colours) and the custom dropdown option keep the user's words after "text:".
 */
export type MixedValues = Record<string, string>;

const color = (key: string, label: string, def: string): MixedSetting => ({ key, label, type: "color", default: def });
const select = (key: string, label: string, options: [label: string, prompt: string][], def = 0): MixedSetting => {
  const opts = options.map(([l, prompt]) => ({ value: l.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), label: l, prompt }));
  return { key, label, type: "select", options: opts, default: opts[def].value, custom: true };
};
const text = (key: string, label: string, def: string, placeholder: string): MixedSetting => ({ key, label, type: "text", default: def, placeholder, max: 40 });

/** Every preset ends with how strongly the look takes over (the open engine's denoise, the Original's control scale in the cloud). */
export const INTENSITY = {
  key: "intensity",
  label: "Intensity",
  type: "select",
  options: [
    { value: "subtle", label: "Subtle", prompt: "applied lightly so the original footage still shows through" },
    { value: "balanced", label: "Balanced", prompt: "" },
    { value: "bold", label: "Bold", prompt: "pushed all the way, fully stylised" },
  ],
  default: "balanced",
} as const satisfies MixedSetting;
const DENOISE: Record<string, number> = { subtle: 0.55, balanced: 0.7, bold: 0.82 };
/** The Original in the cloud draws each frame anew under its outlines: a subtle look holds them tighter. */
const CONTROL: Record<string, number> = { subtle: 0.85, balanced: 0.75, bold: 0.6 };

export interface MixedPreset {
  id: string;
  name: string;
  /** One line for the card. */
  description: string;
  /** The look, with {key} placeholders for the settings. */
  look: string;
  settings: MixedSetting[];
  hue: number;
  fx: PreviewFx;
  scene: PreviewScene;
}

type Row = [name: string, description: string, look: string, settings: MixedSetting[], hue: number, fx: PreviewFx, scene: PreviewScene];

const ROWS: Row[] = [
  [
    "Layer mixed media",
    "Stacked collage of paper, paint and photo layers",
    "a stacked mixed-media collage: {layers} layered over the footage, accents in {accent}",
    [select("layers", "Layers", [["Paper and paint", "torn paper and loose paint strokes"], ["Photo fragments", "cut-out photo fragments and film strips"], ["Tape and stickers", "masking tape, stickers and scribbled notes"]]), color("accent", "Accent colour", "#ff5a36")],
    20,
    "halftone",
    "portrait",
  ],
  [
    "Sketch",
    "Hand-drawn textured linework",
    "hand-drawn textured linework in {ink} ink on {paper}, cross-hatching and loose construction lines",
    [color("ink", "Ink colour", "#1d1d1f"), select("paper", "Paper", [["White paper", "white sketchbook paper"], ["Toned paper", "warm toned paper"], ["Notebook grid", "a squared notebook page"]])],
    260,
    "halftone",
    "portrait",
  ],
  [
    "Canvas",
    "Hand-drawn, canvas-style artwork",
    "a hand-painted canvas: visible canvas weave and thick {medium} strokes, the palette led by {color}",
    [select("medium", "Medium", [["Oil paint", "oil paint"], ["Acrylic", "acrylic"], ["Gouache", "gouache"]]), color("color", "Main colour", "#2a6f97")],
    210,
    "halftone",
    "landscape",
  ],
  [
    "Flash comic",
    "High-energy comic visuals",
    "a high-energy comic: bold ink outlines, halftone shading, {burst} and flashes of {color}",
    [select("burst", "Accents", [["Action bursts", "starburst action bubbles"], ["Speed lines", "radiating speed lines"], ["Sound effects", "hand-lettered sound-effect words"]]), color("color", "Flash colour", "#ffd400")],
    55,
    "explode",
    "city",
  ],
  [
    "Overexposed",
    "Extreme light, blown-out highlights",
    "an overexposed look: blown-out {tone} highlights, light leaks in {leak}, washed-out shadows and halation glow",
    [select("tone", "Highlights", [["White", "bright white"], ["Warm", "warm cream"], ["Cool", "cool blue-white"]]), color("leak", "Light leak", "#ff8a3d")],
    60,
    "flare",
    "portrait",
  ],
  [
    "Paper",
    "Handcrafted paper textures",
    "a handcrafted paper world: everything made of {paper} with layered edges and soft shadows, colours led by {color}",
    [select("paper", "Paper", [["Cut paper", "cut paper"], ["Torn paper", "torn paper with rough fibres"], ["Cardboard", "corrugated cardboard"]]), color("color", "Paper colour", "#e9c46a")],
    45,
    "halftone",
    "landscape",
  ],
  [
    "Noir",
    "Cinematic noir lighting",
    "cinematic film noir: high-contrast black and white, {light}, deep shadows, smoky haze and a single touch of {accent}",
    [select("light", "Light", [["Venetian blinds", "hard light through venetian blinds"], ["Street lamp", "a pool of hard street-lamp light"], ["Rim light", "a hard rim light"]]), color("accent", "Accent colour", "#c1121f")],
    0,
    "grade",
    "city",
  ],
  [
    "Particles",
    "Luminous particles in motion",
    "luminous particles in motion: the subject formed from {density} glowing {color} particles drifting and swirling on a dark background",
    [color("color", "Particle colour", "#6ee7ff"), select("density", "Density", [["Sparse", "sparse"], ["Dense", "dense"], ["Storm", "a storm of"]])],
    195,
    "sparkle",
    "portrait",
  ],
  [
    "Hand paint",
    "Freeform hand-painted brushwork",
    "freeform hand-painted brushwork: expressive {brush} strokes, drips and palette-knife texture, led by {color}",
    [select("brush", "Brush", [["Loose brush", "loose"], ["Thick impasto", "thick impasto"], ["Dry brush", "scratchy dry-brush"]]), color("color", "Main colour", "#e76f51")],
    15,
    "halftone",
    "portrait",
  ],
  ["Toxic", "Radioactive neon colour blast", "a radioactive neon look: toxic {color} glow, slime-like glowing edges against a dark high-contrast background", [color("color", "Glow colour", "#7cff00")], 120, "glitch", "city"],
  [
    "Tracking",
    "Dynamic object tracking lines",
    "a dynamic tracking overlay: thin {color} tracking lines, boxes, points and labels following the movement, HUD text reading “{label}”",
    [color("color", "Line colour", "#00e5ff"), text("label", "Label", "SUBJECT 01", "e.g. SUBJECT 01")],
    185,
    "scan",
    "city",
  ],
  ["Ultraviolet", "Neon ultraviolet glow", "a neon ultraviolet glow: blacklight {color} and violet light, fluorescent edges and deep purple shadows", [color("color", "Glow colour", "#b026ff")], 290, "glow", "portrait"],
  [
    "Windows",
    "Overlapping digital interface windows",
    "overlapping digital interface windows: the footage repeated inside retro computer windows with title bars reading “{title}”, cursors and pop-ups, accents in {color}",
    [text("title", "Window title", "untitled.mov", "e.g. untitled.mov"), color("color", "Accent colour", "#3a86ff")],
    220,
    "frame",
    "city",
  ],
  [
    "Acid",
    "Psychedelic neon colour distortion",
    "psychedelic neon colour distortion: melting {palette} gradients, chromatic aberration and warped edges",
    [select("palette", "Palette", [["Rainbow", "rainbow"], ["Pink and green", "hot pink and acid green"], ["Orange and blue", "orange and electric blue"]])],
    310,
    "glitch",
    "portrait",
  ],
  [
    "Palette",
    "Hand-painted colour composition",
    "a hand-painted colour composition: flat painted shapes in only {c1}, {c2} and {c3}",
    [color("c1", "Colour 1", "#264653"), color("c2", "Colour 2", "#e9c46a"), color("c3", "Colour 3", "#e76f51")],
    30,
    "grade",
    "landscape",
  ],
  [
    "Comic",
    "Graphic illustrated comic look",
    "a graphic illustrated comic: clean ink lines, flat cel colours, halftone shading, {panel}",
    [select("panel", "Layout", [["Single panel", "framed as a single panel"], ["Comic panels", "split into comic panels"], ["Speech bubbles", "with empty speech bubbles"]])],
    50,
    "halftone",
    "city",
  ],
  ["Akrill", "Layered acrylic colour blocks", "layered acrylic colour blocks: thick acrylic paint in blocky layers led by {color}, palette-knife edges", [color("color", "Main colour", "#ff006e")], 330, "halftone", "portrait"],
  ["Two color", "High-contrast two-tone style", "a high-contrast two-tone print using only {c1} and {c2}", [color("c1", "Ink", "#1d3557"), color("c2", "Paper", "#f1faee")], 225, "grade", "portrait"],
  [
    "Multiverse",
    "Layered reality collision",
    "a layered reality collision: several versions of the scene ({styles}) split and overlapping like portals",
    [select("styles", "Worlds", [["Cartoon, real and sketch", "cartoon, photoreal and pencil sketch"], ["Neon, film and print", "neon, vintage film and print"], ["Pixel, clay and paint", "pixel art, clay and oil paint"]])],
    265,
    "wipe",
    "city",
  ],
  [
    "Fragments",
    "Layered abstract visual fragments",
    "layered abstract fragments: the picture broken into {shape} shards with offset copies and {color} accents",
    [select("shape", "Shards", [["Glass", "glass"], ["Paper", "paper"], ["Geometric", "geometric"]]), color("color", "Accent colour", "#ffbe0b")],
    45,
    "crack",
    "portrait",
  ],
  ["Origami", "Crisp origami-style geometry", "crisp origami geometry: everything folded from {color} paper with sharp creases and faceted planes", [color("color", "Paper colour", "#f4a261")], 30, "morph", "product"],
  ["Random Glow", "Glows bloom on random spots", "random glow accents: soft {color} glows blooming on random parts of the frame with dreamy halation", [color("color", "Glow colour", "#ffd166")], 75, "glow", "portrait"],
  [
    "Vintage",
    "Hand-inked illustrated style",
    "a hand-inked vintage illustration: crosshatched ink, old engraving style on {paper} paper",
    [select("paper", "Paper", [["Aged", "aged sepia"], ["Cream", "cream"], ["Newsprint", "grey newsprint"]])],
    40,
    "grade",
    "landscape",
  ],
  ["Cannabis", "Smoky poster look in a soft haze", "a smoky psychedelic poster: swirling smoke, {color} haze, 70s poster style and soft grain", [color("color", "Haze colour", "#3ddc84")], 140, "wind", "portrait"],
  ["Bubbles", "Dreamy soap-bubble texture", "a dreamy soap-bubble texture: iridescent {color} bubbles floating and refracting the scene, soft focus", [color("color", "Bubble tint", "#a0c4ff")], 215, "water", "portrait"],
  [
    "Magazine",
    "Printed magazine look",
    "a printed magazine: halftone print, paper texture, a bold masthead reading “{headline}” and an editorial layout",
    [text("headline", "Masthead", "ISSUE 01", "e.g. ISSUE 01")],
    0,
    "halftone",
    "portrait",
  ],
  ["Cold vision", "Cold neon shadow lighting", "cold neon shadow lighting: icy {color} light, deep blue shadows and a night-vision mood", [color("color", "Light colour", "#00b4ff")], 205, "relight", "city"],
  ["Modern", "Clean geometric minimalism", "clean geometric minimalism: flat shapes, thin lines and plenty of negative space in {c1} and {c2}", [color("c1", "Colour 1", "#111111"), color("c2", "Colour 2", "#f2f2f2")], 0, "grade", "product"],
  [
    "LSD",
    "Kaleidoscopic colour waves",
    "hallucinogenic colour waves: rippling {palette} bands flowing over the frame with kaleidoscopic edges",
    [select("palette", "Palette", [["Rainbow", "rainbow"], ["Sunset", "magenta, orange and gold"], ["Ocean", "teal, violet and blue"]])],
    300,
    "glitch",
    "landscape",
  ],
  [
    "Broken mirror",
    "Broken-glass reflections",
    "a broken mirror: the frame split into {pieces} with sharp reflections and offset copies",
    [select("pieces", "Shards", [["A few large shards", "a few large cracked shards"], ["Many small shards", "many small cracked shards"]])],
    200,
    "crack",
    "portrait",
  ],
  ["Lava", "Liquid lava colour motion", "liquid lava colour motion: molten {color} flowing through the shapes, glowing cracks and heat shimmer", [color("color", "Lava colour", "#ff4d00")], 20, "fire", "landscape"],
  [
    "Marble",
    "Sculpted marble visual style",
    "a sculpted marble look: everything carved from {stone} marble with veins and soft museum light",
    [select("stone", "Stone", [["White Carrara", "white Carrara"], ["Black", "black veined"], ["Green", "green veined"]])],
    40,
    "morph",
    "portrait",
  ],
  ["Ocean", "Liquid sea colour overlay", "a liquid sea colour overlay: rippling {color} water caustics and waves washing over the scene", [color("color", "Water colour", "#0077b6")], 210, "water", "landscape"],
];

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Looks renamed since their id was made: the id (and every link and cover) keeps the first name. */
const RENAMED: Record<string, string> = { Acid: "Neon Melt", Akrill: "Acrylic", Cannabis: "Smoke Haze", LSD: "Kaleido", Toxic: "Neon Slime" };

export const MIXED_PRESETS: MixedPreset[] = ROWS.map(([name, description, look, settings, hue, fx, scene]) => ({
  id: `mixed-${slug(name)}`,
  name: RENAMED[name] ?? name,
  description,
  look,
  settings: [...settings, INTENSITY],
  hue,
  fx,
  scene,
}));

export function getMixedPreset(id: string): MixedPreset | undefined {
  return MIXED_PRESETS.find((p) => p.id === id);
}

/** A look's card preview: its real cover when it has one (templateCover), else drawn. */
export function mixedPreview(p: Pick<MixedPreset, "id" | "scene" | "fx">): PresetPreview {
  const cover = templateCover("mixed-media", p.id);
  return cover ? templatePreview(cover) : { poster: scenePoster(p.scene), scene: p.scene, fx: p.fx };
}

export function defaultValues(p: Pick<MixedPreset, "settings">): MixedValues {
  return Object.fromEntries(p.settings.map((s) => [s.key, s.default]));
}

/** Saved values cleaned against the preset: unknown keys dropped, bad colours and options reset, text clipped. */
export function cleanValues(p: Pick<MixedPreset, "settings">, raw: Record<string, unknown> | undefined): MixedValues {
  const out = defaultValues(p);
  for (const s of p.settings) {
    const v = raw?.[s.key];
    if (typeof v !== "string") continue;
    if (v.startsWith("text:")) {
      const words = v.slice(5).trim().slice(0, 120);
      if (words && (s.type === "color" || (s.type === "select" && s.custom))) out[s.key] = `text:${words}`;
      continue;
    }
    if (s.type === "color" && /^#[0-9a-f]{6}$/i.test(v)) out[s.key] = v.toLowerCase();
    else if (s.type === "select" && s.options.some((o) => o.value === v)) out[s.key] = v;
    else if (s.type === "text") out[s.key] = v.trim().slice(0, s.max);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Colours in words (models read "teal" better than "#2a9d8f")

function hsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

const HUES: [number, string][] = [
  [12, "red"],
  [35, "orange"],
  [50, "amber"],
  [65, "yellow"],
  [100, "lime"],
  [150, "green"],
  [175, "teal"],
  [195, "cyan"],
  [215, "sky blue"],
  [245, "blue"],
  [265, "indigo"],
  [290, "violet"],
  [315, "purple"],
  [335, "magenta"],
  [350, "pink"],
  [360, "red"],
];

/** "#ff5a36" → "orange-red"-ish words: hue name plus dark/light/pale/deep. */
export function colorName(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const [h, s, l] = hsl(hex);
  if (s < 0.12 || l < 0.06 || l > 0.96) return l < 0.15 ? "black" : l > 0.88 ? "white" : l < 0.4 ? "dark grey" : l > 0.65 ? "light grey" : "grey";
  const name = HUES.find(([max]) => h < max)?.[1] ?? "red";
  if (name === "orange" && l < 0.35) return "brown";
  const tone = l < 0.25 ? "dark " : l < 0.42 ? "deep " : l > 0.8 ? "pale " : l > 0.65 ? "light " : s > 0.85 && l > 0.45 ? "bright " : "";
  return `${tone}${name}`;
}

/** A setting's value as words for the prompt. */
export function settingWords(s: MixedSetting, value: string | undefined): string {
  const v = value ?? s.default;
  if (v.startsWith("text:")) return v.slice(5).trim();
  if (s.type === "color") return /^#[0-9a-f]{6}$/i.test(v) ? `${colorName(v)} (${v.toUpperCase()})` : v;
  if (s.type === "select") return s.options.find((o) => o.value === v)?.prompt ?? s.options[0].prompt;
  return v.trim() || s.default;
}

/** The look with the user's settings filled in. */
export function mixedLook(p: Pick<MixedPreset, "look" | "settings">, values: MixedValues): string {
  let look = p.look;
  for (const s of p.settings) look = look.replaceAll(`{${s.key}}`, settingWords(s, values[s.key]));
  const intensity = INTENSITY.options.find((o) => o.value === values.intensity)?.prompt;
  return intensity ? `${look}, ${intensity}` : look;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * Prompts per step: the video restyle (cloud Fast), each frame (open, img2img), the preview still (cloud
 * edit), and a cloud frame redrawn next to a styled one (the frame before it, or the approved preview).
 */
export function mixedPrompts(p: Pick<MixedPreset, "look" | "settings">, values: MixedValues) {
  const look = mixedLook(p, values);
  const still = `Redraw this image as ${look}. Keep the composition, framing, people and poses exactly.`;
  return {
    video: `Restyle this video as ${look}. Keep the people, poses, motion, timing and camera exactly as they are; change only the look.`,
    frame: `${cap(look)}. Same composition and subject as the source frame, highly detailed mixed-media artwork.`,
    still,
    framePair: `Redraw the first image as ${look}. Keep its composition, framing, people and poses exactly. The second image is an earlier frame of the same clip already redrawn: match its style, colours, textures and line work exactly so the frames play as one animation.`,
  };
}

export const denoiseFor = (values: MixedValues) => DENOISE[values.intensity] ?? DENOISE.balanced;
/** How closely the Original's cloud frames follow the source's outlines (fal's control_scale). */
export const controlFor = (values: MixedValues) => CONTROL[values.intensity] ?? CONTROL.balanced;

/** A prompt led by its LoRAs' trigger words ("drkrm style, …"), as the Soul looks are (the first LoRA with a trigger). */
export function withTrigger(prompt: string, loras: Pick<LoraRef, "trigger">[]): string {
  const t = loras
    .map((l) => l.trigger?.trim().replace(/[\s.,;:]+$/, ""))
    .find(Boolean);
  return t ? `${t}, ${prompt}` : prompt;
}

/** "#c1121f" from a typed "#C1121F", "c1121f" or "#c12" (shorthand), else null. */
export function parseHex(raw: string): string | null {
  const v = raw.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(v)) return `#${v}`;
  if (/^[0-9a-f]{3}$/.test(v)) return `#${[...v].map((c) => c + c).join("")}`;
  return null;
}

// ---------------------------------------------------------------------------
// Frames, frame rates and cost

/** Output frames for a selection: floor(seconds × fps), as Higgsfield counts and charges them. */
export function mixedFrames(seconds: number, fps: number): number {
  return Math.max(0, Math.floor(seconds * fps + 1e-6));
}

/** Cost of a per-frame render: frames × the price of one frame (×2 at 4K). */
export function framesCost(frames: number, perFrameUsd: number, resolution: MixedResolution = "1K"): number {
  return Math.round(frames * perFrameUsd * (resolution === "4K" ? 2 : 1) * 10000) / 10000;
}

/** The frame-rate choices for a clip: those above its own frame rate are turned off ("Uploaded video has 6 FPS"). */
export function fpsChoices(sourceFps?: number): { fps: number; disabled: boolean }[] {
  return MIXED.fps.map((fps) => ({ fps, disabled: !!sourceFps && fps > Math.floor(sourceFps + 0.01) }));
}

/** The frame rate actually used: within 4–24, and never above the clip's own (drops to the highest allowed). */
export function clampFps(want: number, sourceFps?: number): number {
  const cap = sourceFps ? Math.max(MIXED.manualFps.min, Math.floor(sourceFps + 0.01)) : MIXED.manualFps.max;
  return Math.max(MIXED.manualFps.min, Math.min(Math.round(want), MIXED.manualFps.max, cap));
}

/** What's wrong with a selection, or null. */
export function mixedRangeProblem(range: { start: number; end: number }, duration?: number, sourceFps?: number): string | null {
  const len = range.end - range.start;
  if (!(len > 0) || range.start < 0) return "Pick a part of the clip";
  if (duration !== undefined && range.end > duration + 0.05) return "The selection runs past the end of the clip";
  if (len < MIXED.minSeconds - 0.02) return "Select at least 1 second";
  if (len > MIXED.maxSeconds + 0.05) return "Select up to 10 seconds";
  if (sourceFps !== undefined && sourceFps < MIXED.minSourceFps) return "Video must be at least 4 FPS";
  return null;
}

/** The cloud model's resolution setting closest to 1K / 2K / 4K. */
export function nearestResolution(choices: string[] | undefined, want: MixedResolution): string | undefined {
  if (!choices?.length) return undefined;
  const order = ["360p", "480p", "540p", "720p", "768p", "1080p", "1440p", "2k", "2K", "4k", "4K"];
  const target = want === "1K" ? "720p" : want === "2K" ? "1080p" : "4k";
  const rank = (r: string) => {
    const i = order.findIndex((o) => o.toLowerCase() === r.toLowerCase());
    return i < 0 ? 3 : i;
  };
  const t = rank(target);
  return [...choices].filter((c) => c !== "auto").sort((a, b) => Math.abs(rank(a) - t) - Math.abs(rank(b) - t) || rank(b) - rank(a))[0];
}

/**
 * Cloud per-frame sampling: the extractor takes every `interval`-th frame of the clip, so the frame rate
 * is the clip's own divided by a whole number — the one closest to the rate asked for (fewer frames on a
 * tie), never below 4 FPS. 8 FPS from a 30 FPS clip is every 4th frame, 7.5 FPS; 24 from 25 is every
 * frame. `frames` counts as Higgsfield does, floor(seconds × fps).
 */
export function frameSampling(seconds: number, fps: number, sourceFps: number): { interval: number; fps: number; frames: number } {
  let interval = 1;
  for (let k = 2; k <= FRAME_LIMITS.maxInterval && sourceFps / k >= MIXED.manualFps.min - 1e-9; k++) {
    if (Math.abs(sourceFps / k - fps) <= Math.abs(sourceFps / interval - fps) + 1e-9) interval = k;
    if (sourceFps / k < fps) break;
  }
  const rate = sourceFps / interval;
  return { interval, fps: Math.round(rate * 1000) / 1000, frames: mixedFrames(seconds, rate) };
}

/** Consecutive runs of at most `size` frames: the extractor's calls (500) or the clips frames go back into (200). */
export function frameChunks(frames: number, size: number): { from: number; count: number }[] {
  return Array.from({ length: Math.ceil(frames / size) }, (_, i) => ({ from: i * size, count: Math.min(size, frames - i * size) }));
}

/**
 * What the cloud frame editor is asked for: Nano Banana 2 keeps the frame's shape at 1K/2K/4K, Seedream 5.0 Flash
 * at auto 1K/2K. Frames come back as JPEG (Seedream's default): every one is downloaded, sent on as the next
 * frame's reference and into images-to-video, and a 4K PNG is ten times the bytes for a frame that is re-encoded anyway.
 */
export function frameEditParams(modelId: string, resolution: MixedResolution, seed: number): { aspectRatio?: string; resolution?: string; seed?: number; extra?: Record<string, unknown> } {
  if (modelId === "seedream-5-flash") return { extra: { image_size: resolution === "1K" ? "auto_1K" : "auto_2K" } };
  return { aspectRatio: "auto", resolution, seed, extra: { output_format: "jpeg" } };
}

/**
 * The size clips of styled frames are joined at (merge-videos takes 512–2048 px a side): the source's shape with
 * its long side at 2048, its short side at least 512. Undefined without the source's size (fal then picks the
 * smallest of the clips).
 */
export function frameJoinSize(source?: { width?: number; height?: number }): { width: number; height: number } | undefined {
  const w = source?.width;
  const h = source?.height;
  if (!w || !h) return undefined;
  const even = (v: number) => Math.max(FRAME_LIMITS.joinMinPx, Math.min(FRAME_LIMITS.joinMaxPx, 2 * Math.round(v / 2)));
  const k = FRAME_LIMITS.joinMaxPx / Math.max(w, h);
  return { width: even(w * k), height: even(h * k) };
}

/** Per frame at 4K with more than one clip: joined at up to 2048 px, so frames are drawn at 2K (same picture, less money). */
export function frameResolution(frames: number, resolution: MixedResolution): MixedResolution {
  return frames > FRAME_LIMITS.perClip && resolution === "4K" ? "2K" : resolution;
}

/** The Original's frame tiers: about 1 (1K) or 4 (2K) megapixels; it draws up to 2K (Z-Image Turbo's range). */
const ORIGINAL_TIER: Record<MixedResolution, number> = { "1K": 1024, "2K": 2048, "4K": 2048 };

/**
 * The size the Original draws a frame at in the cloud (fal's image_size): the clip's shape with the area of the tier's
 * square, on the 16-pixel grid. Undefined without the clip's size (fal then keeps the frame's own size).
 */
export function originalFrameSize(source: { width?: number; height?: number } | undefined, resolution: MixedResolution): { width: number; height: number } | undefined {
  const w = source?.width;
  const h = source?.height;
  if (!w || !h) return undefined;
  const side = ORIGINAL_TIER[resolution];
  const k = Math.sqrt((side * side) / (w * h));
  const grid = (v: number) => Math.max(256, 16 * Math.round(v / 16));
  return { width: grid(w * k), height: grid(h * k) };
}

/** What the Original's cloud frame route is asked for: one picture, the render's seed, the look's control scale and the frame size. */
export function originalFrameParams(values: MixedValues, resolution: MixedResolution, seed: number, source?: { width?: number; height?: number }) {
  const size = originalFrameSize(source, resolution);
  return { seed, numOutputs: 1, extra: { control_scale: controlFor(values), ...(size && { image_size: size }) } };
}

/** One frame in the look by the Original on an engine: the preview, Smooth's first frame and DoP's Mixed Media effects. */
export function originalFrameRequest(
  input: Pick<MixedPlanInput, "engine" | "preset" | "values" | "resolution" | "sourceSize" | "seed" | "loras">,
): Pick<GenerationRequest, "engine" | "modelId" | "op" | "prompt" | "loras" | "params"> {
  const loras = input.loras ?? [];
  const seed = input.seed ?? FRAME_SEED;
  return {
    engine: input.engine,
    modelId: MIXED_ORIGINAL,
    op: "edit",
    prompt: withTrigger(mixedPrompts(input.preset, input.values).frame, loras),
    ...(loras.length && { loras }),
    // On your GPU: Z-Image img2img at about 1 megapixel, as strongly as the intensity asks.
    params:
      input.engine === "cloud"
        ? originalFrameParams(input.values, input.resolution, seed, input.sourceSize)
        : { seed, numOutputs: 1, extra: { strength: denoiseFor(input.values), megapixels: 1 } },
  };
}

// ---------------------------------------------------------------------------
// Pipelines

export interface MixedPlanInput {
  engine: Engine;
  title: string;
  preset: Pick<MixedPreset, "id" | "name" | "look" | "settings">;
  values: MixedValues;
  source: { url: string; duration?: number; hasAudio?: boolean };
  range: { start: number; end: number };
  fps: number;
  resolution: MixedResolution;
  /** The frame model (Per frame: MIXED_FRAME_MODELS in the cloud, the Original on your GPU), Fast's restyle model, or the Original (Smooth). */
  modelId: string;
  /** Frame by frame (default), Smooth, or (cloud) Fast: one video-to-video pass. */
  mode?: MixedMode;
  /** Cloud Per frame: the clip's own frame rate (frames are every Nth one of it). */
  sourceFps?: number;
  /** Cloud Per frame: the clip's own size (the clips of styled frames are joined at its shape). */
  sourceSize?: { width?: number; height?: number };
  /** Cloud: the approved preview still, sent when the model takes an image (LTX: the first frame; Kling, Happy Horse: a style reference). */
  anchor?: string;
  /** Cloud: what to ask the model for (its nearest resolution). */
  modelResolution?: string;
  /** Cloud: the model's extra settings (LTX: follow the outlines). */
  extra?: Record<string, unknown>;
  seed?: number;
  /**
   * The Original: the look's LoRAs this run can reach (src/lib/catalog/mixed-media-looks.ts; the server leaves out a civitai
   * one without the key). None: the look runs on its words.
   */
  loras?: LoraRef[];
  /** Original sound: what of the clip's sound goes back (src/lib/av/original-sound.ts; unset = Everything). */
  sound?: SoundChoice;
}

/**
 * The full render. Open: one per-frame job (or Smooth). Cloud: cut the selection, restyle it (frame by frame, Smooth or
 * Fast), put its own sound back.
 */
export function planMixed(input: MixedPlanInput): { steps: PlanStep[]; final: string } {
  const mode = input.mode ?? "frames";
  if (mode === "smooth") return planMixedSmooth(input);
  if (input.engine === "cloud" && mode === "frames") return planMixedFrames(input);
  const prompts = mixedPrompts(input.preset, input.values);
  const base = { batchTitle: input.title };
  const original = input.modelId === MIXED_ORIGINAL;
  // The Original draws every frame at one seed (the same seed keeps frames alike).
  const seed = input.seed !== undefined ? { seed: input.seed } : original ? { seed: FRAME_SEED } : {};
  if (input.engine === "open") {
    const loras = original ? (input.loras ?? []) : [];
    const split = !!input.source.hasAudio && separates("open", input.sound);
    const plan: { steps: PlanStep[]; final: string } = {
      final: "render",
      steps: [
        {
          key: "render",
          request: {
            ...base,
            feature: MIXED_FEATURE,
            title: input.title,
            ...(original && { engine: "open" as const }),
            modelId: input.modelId,
            op: "v2v",
            prompt: withTrigger(prompts.frame, loras),
            ...(loras.length && { loras }),
            inputs: { video: input.source.url },
            // frames: exactly floor(seconds × fps), as the page counts them (the graph's own count would add one).
            params: {
              startTime: input.range.start,
              endTime: input.range.end,
              fps: input.fps,
              aspectRatio: "auto",
              resolution: input.resolution,
              ...seed,
              extra: { denoise: denoiseFor(input.values), frames: mixedFrames(input.range.end - input.range.start, input.fps) },
            },
          },
        },
      ],
    };
    if (!split) return plan;
    // Original sound other than Everything: the render keeps the clip's sound, so the selection is cut, its sound split,
    // and the chosen stems laid over the render (the picture stream-copied).
    const render = plan.steps[0];
    const { title: _made, ...rest } = render.request;
    void _made;
    render.request = { ...rest, feature: MIXED_STEP_FEATURE };
    const t = MIXED_TOOLS.open;
    const helper = { ...base, feature: MIXED_STEP_FEATURE };
    plan.steps.push({ key: "cut", request: { ...helper, modelId: t.cut, op: "trim", inputs: { video: input.source.url }, params: { startTime: input.range.start, endTime: input.range.end }, step: { label: "Original sound", index: 1100, of: 1000 } } });
    const back = soundBack(plan.steps, { engine: "open", choice: input.sound, from: { key: "cut" }, helper, seconds: input.range.end - input.range.start });
    plan.steps.push({
      key: "final",
      request: withSoundExtra({ ...base, feature: MIXED_FEATURE, title: input.title, modelId: t.mux, op: "mux", step: { label: SOUND_STEP_LABEL[soundOf(input.sound)], index: 1200, of: 1000 } }, back),
      after: ["render", ...back.after],
      chain: [{ slot: "video" }, ...back.chain],
    });
    return { steps: plan.steps, final: "final" };
  }
  const soundProblem = originalSoundProblem(input.engine, input.sound);
  if (soundProblem) throw new Error(soundProblem);
  const t = MIXED_TOOLS.cloud;
  const sound = !!input.source.hasAudio;
  const steps: PlanStep[] = [
    {
      key: "cut",
      request: { ...base, feature: MIXED_STEP_FEATURE, modelId: t.cut, op: "trim", inputs: { video: input.source.url }, params: { startTime: input.range.start, endTime: input.range.end }, step: { label: "Cut", index: 0, of: 3 } },
    },
    {
      key: "render",
      request: {
        ...base,
        feature: sound ? MIXED_STEP_FEATURE : MIXED_FEATURE,
        ...(sound ? {} : { title: input.title }),
        modelId: input.modelId,
        op: "v2v",
        prompt: prompts.video,
        inputs: input.anchor ? { images: [input.anchor] } : undefined,
        params: {
          // The cut's exact length (what per-second prices count); no restyle route is sent a length, each keeps its clip's.
          duration: Math.round((input.range.end - input.range.start) * 1000) / 1000,
          generateAudio: false,
          ...(input.modelResolution ? { resolution: input.modelResolution } : {}),
          ...seed,
          ...(input.extra ? { extra: input.extra } : {}),
        },
        step: { label: "Restyle", index: 1, of: 3 },
      },
      after: ["cut"],
      chain: [{ slot: "video" }],
    },
  ];
  if (!sound) return { steps, final: "render" };
  steps.push({
    key: "final",
    request: { ...base, feature: MIXED_FEATURE, title: input.title, modelId: t.mux, op: "mux", step: { label: "Original sound", index: 2, of: 3 } },
    after: ["render", "cut"],
    // The cut is a clip: the mux takes its soundtrack.
    chain: [{ slot: "video" }, { slot: "audio" }],
  });
  return { steps, final: "final" };
}

/**
 * Cloud, frame by frame (Higgsfield's Mixed Media): cut the selection → take every Nth frame (500 a call;
 * a longer run is cut into windows) → redraw each frame with the frame editor, a fixed seed and the frame
 * styled before it as a second picture (lanes of FRAME_LIMITS.lane; a lane starts from the approved preview,
 * else the first styled frame) → the styled frames back into clips of up to 200 at the sampled frame rate
 * (joined when there are several) → the cut's own sound.
 */
export function planMixedFrames(input: MixedPlanInput): { steps: PlanStep[]; final: string } {
  const soundProblem = originalSoundProblem(input.engine, input.sound);
  if (soundProblem) throw new Error(soundProblem);
  const t = MIXED_TOOLS.cloud;
  const prompts = mixedPrompts(input.preset, input.values);
  const len = Math.round((input.range.end - input.range.start) * 1000) / 1000;
  if (!input.sourceFps) throw new Error("Couldn't read this clip's frame rate — pick Fast to restyle it as video");
  const sampling = frameSampling(len, input.fps, input.sourceFps);
  const n = sampling.frames;
  if (n < 1) throw new Error("Select a longer part of the clip");
  const windows = frameChunks(n, FRAME_LIMITS.perExtract);
  const clips = frameChunks(n, FRAME_LIMITS.perClip);
  const sound = !!input.source.hasAudio;
  const joined = clips.length > 1;
  const total = 1 + (windows.length > 1 ? windows.length : 0) + windows.length + n + clips.length + (joined ? 1 : 0) + (sound ? 1 : 0);
  const steps: PlanStep[] = [];
  const add = (label: string, s: PlanStep) => steps.push({ ...s, request: { ...s.request, step: { label, index: steps.length, of: total } } });
  const base = { batchTitle: input.title };
  const helper = { ...base, feature: MIXED_STEP_FEATURE };
  const seed = input.seed ?? FRAME_SEED;
  const edit = frameEditParams(input.modelId, frameResolution(n, input.resolution), seed);
  // Only worth making for the steps after them: dropped before they're paid for once the render can't finish.
  const feeds = { dropWhenUnused: true };
  // The whole selection: its sound goes back under the result, and with one window its frames come from it.
  add("Cut", { key: "cut", request: { ...helper, modelId: t.cut, op: "trim", inputs: { video: input.source.url }, params: { startTime: input.range.start, endTime: input.range.end } } });
  const secondsPerWindow = (FRAME_LIMITS.perExtract * sampling.interval) / input.sourceFps;
  windows.forEach((w, i) => {
    let source = "cut";
    if (windows.length > 1) {
      source = `cut${i + 1}`;
      const start = Math.round((input.range.start + i * secondsPerWindow) * 1000) / 1000;
      const end = Math.min(input.range.end, Math.round((start + secondsPerWindow) * 1000) / 1000);
      add(`Cut ${i + 1} of ${windows.length}`, { key: source, request: { ...helper, modelId: t.cut, op: "trim", inputs: { video: input.source.url }, params: { startTime: start, endTime: end } } });
    }
    add(windows.length > 1 ? `Frames ${w.from + 1}–${w.from + w.count}` : `${n} frames`, {
      key: `frames${i + 1}`,
      request: {
        ...helper,
        modelId: t.frames,
        op: "extract-frames",
        // JPEG frames: a tenth of the bytes of PNG, and every frame is downloaded and sent on.
        params: { frameInterval: sampling.interval, extra: { max_frames: w.count, output_format: "jpg", quality: 95 } },
      },
      after: [source],
      chain: [{ slot: "video" }],
    });
  });
  const lane = FRAME_LIMITS.lane;
  // The Original draws every frame on its own (the frame's outlines, the look's LoRA, one seed): no lanes, no second picture.
  const original = input.modelId === MIXED_ORIGINAL ? originalFrameRequest({ ...input, resolution: frameResolution(n, input.resolution), seed }) : null;
  for (let i = 0; i < n; i++) {
    const w = Math.floor(i / FRAME_LIMITS.perExtract);
    const frame = { slot: "images" as const, index: i - w * FRAME_LIMITS.perExtract, of: windows[w].count, position: "first" as const };
    if (original) {
      add(`Frame ${i + 1} of ${n}`, {
        key: `f${i}`,
        request: { ...base, ...feeds, feature: MIXED_FRAME_FEATURE, ...original },
        after: [`frames${w + 1}`],
        chain: [frame],
      });
      continue;
    }
    // The styled picture it matches: the frame before it in its lane, else the approved preview, else the first styled frame.
    const ref = i % lane ? `f${i - 1}` : input.anchor ? null : i ? "f0" : null;
    add(`Frame ${i + 1} of ${n}`, {
      key: `f${i}`,
      request: {
        ...base,
        ...feeds,
        feature: MIXED_FRAME_FEATURE,
        modelId: input.modelId,
        op: "edit",
        prompt: ref || input.anchor ? prompts.framePair : prompts.still,
        ...(input.anchor && !ref ? { inputs: { images: [input.anchor] } } : {}),
        params: { ...edit, numOutputs: 1 },
      },
      after: ref ? [`frames${w + 1}`, ref] : [`frames${w + 1}`],
      chain: ref ? [frame, { slot: "images" }] : [frame],
    });
  }
  clips.forEach((c, i) => {
    const keys = Array.from({ length: c.count }, (_, j) => `f${c.from + j}`);
    const last = !joined && !sound;
    add(joined ? `Clip ${i + 1} of ${clips.length}` : "Frames to video", {
      key: `clip${i + 1}`,
      request: {
        ...(last ? { ...base, feature: MIXED_FEATURE, title: input.title } : { ...helper, ...feeds }),
        modelId: t.assemble,
        op: "images-to-video",
        params: { fps: sampling.fps },
      },
      after: keys,
      chain: keys.map(() => ({ slot: "images" as const })),
    });
  });
  let picture = "clip1";
  if (joined) {
    picture = "film";
    const size = frameJoinSize(input.sourceSize);
    add("Joining the clips", {
      key: "film",
      request: {
        ...(sound ? { ...helper, ...feeds } : { ...base, feature: MIXED_FEATURE, title: input.title }),
        modelId: t.join,
        op: "concat",
        prompt: input.title,
        // merge-videos sizes its output 512–2048 px: the frames' shape at that size.
        ...(size && { params: { extra: { resolution: size } } }),
      },
      after: clips.map((_, i) => `clip${i + 1}`),
      chain: clips.map(() => ({ slot: "videos" as const })),
    });
  }
  if (!sound) return { steps, final: picture };
  add("Original sound", {
    key: "final",
    request: { ...base, feature: MIXED_FEATURE, title: input.title, modelId: t.mux, op: "mux" },
    after: [picture, "cut"],
    // The cut is a clip: the mux takes its soundtrack.
    chain: [{ slot: "video" }, { slot: "audio" }],
  });
  return { steps, final: "final" };
}

/** Smooth's first frame: 1K, else 2K (the Original's frame route draws up to 2K; Wan 2.2 Fun VACE renders at 720p after it). */
const smoothFrameResolution = (r: MixedResolution): MixedResolution => (r === "1K" ? "1K" : "2K");

/**
 * Smooth (both engines): the clip in pieces (on your GPU 81 frames at 16 fps, 480p; on fal up to 240 frames at the clip's
 * own rate, 720p), each piece's first frame drawn in the look by the Original (the preview's route and seed), then Fuobe
 * Shorts' Wan 2.2 Fun VACE carries that frame through every frame by depth; the pieces are joined and the cut's own
 * sound put back. The Shorts chain, in the clip's own shape, with the first frame swapped for the Original's.
 */
export function planMixedSmooth(input: MixedPlanInput): { steps: PlanStep[]; final: string } {
  const look: ShortsLook = { presetId: input.preset.id, name: input.preset.name, look: mixedLook(input.preset, input.values) };
  const w = input.sourceSize?.width;
  const h = input.sourceSize?.height;
  const plan = planShorts({
    engine: input.engine,
    title: input.title,
    source: { url: input.source.url, duration: input.source.duration, hasAudio: input.source.hasAudio, width: w, height: h, ...(input.sourceFps && { fps: input.sourceFps }) },
    range: input.range,
    look,
    aspectRatio: (w ?? 16) >= (h ?? 9) ? "16:9" : "9:16",
    keepShape: true,
    language: "auto",
    modelId: MIXED_SMOOTH_MODEL,
    maxRefs: 0,
    ...(input.engine === "cloud" && { resolution: "720p" }),
    seed: input.seed ?? FRAME_SEED,
    ...(input.sound && { sound: input.sound }),
  });
  const final = plan.final ?? plan.takes[0].look;
  const frame = originalFrameRequest({ ...input, resolution: smoothFrameResolution(input.resolution) });
  const frameKeys = new Set(plan.takes.map((t) => t.frame));
  const steps = plan.steps.map((s) => {
    let request: GenerationRequest = s.key === final ? { ...s.request, feature: MIXED_FEATURE, title: input.title } : { ...s.request, feature: MIXED_STEP_FEATURE };
    if (frameKeys.has(s.key)) request = { ...request, ...frame, inputs: undefined };
    return { ...s, request };
  });
  return { steps, final };
}

/** One frame with the current settings. Open: the per-frame model on one frame; cloud: an image edit of the frame the browser grabbed. */
export function planMixedPreview(input: MixedPlanInput & { frameUrl?: string }): PlanStep {
  const prompts = mixedPrompts(input.preset, input.values);
  const title = `${input.preset.name} · preview`;
  const original = input.modelId === MIXED_ORIGINAL && input.mode !== "fast";
  // The Original in the cloud (Per frame and Smooth): its frame route on the grabbed frame, with the render's seed, look and size.
  if (original && input.engine === "cloud") {
    const count = input.sourceFps ? frameSampling(input.range.end - input.range.start, input.fps, input.sourceFps).frames : 0;
    // Smooth's first frame is drawn at 1K or 2K (planMixedSmooth); Per frame at the size its frame count allows.
    const frame = originalFrameRequest({ ...input, resolution: input.mode === "smooth" ? smoothFrameResolution(input.resolution) : frameResolution(count, input.resolution) });
    return { key: "preview", request: { feature: MIXED_PREVIEW_FEATURE, title, ...frame, inputs: { images: input.frameUrl ? [input.frameUrl] : [] } } };
  }
  if (input.engine === "open") {
    // The per-frame graph on the selection's first frame: on your GPU the Original's preview (and Smooth's first frame) is
    // drawn with the render's look, LoRA and seed.
    const loras = input.modelId === MIXED_OPEN_LEGACY ? [] : (input.loras ?? []);
    const seed = input.seed ?? (input.modelId === MIXED_OPEN_LEGACY ? undefined : FRAME_SEED);
    return {
      key: "preview",
      request: {
        feature: MIXED_PREVIEW_FEATURE,
        title,
        ...(input.modelId !== MIXED_OPEN_LEGACY && { engine: "open" as const }),
        modelId: input.modelId === MIXED_OPEN_LEGACY ? MIXED_OPEN_LEGACY : MIXED_TOOLS.open.preview,
        op: "v2v",
        prompt: withTrigger(prompts.frame, loras),
        ...(loras.length && { loras }),
        inputs: { video: input.source.url },
        params: { startTime: input.range.start, fps: input.fps, aspectRatio: "auto", resolution: input.resolution, ...(seed !== undefined ? { seed } : {}), extra: { denoise: denoiseFor(input.values), frames: 1 } },
      },
    };
  }
  // Per frame: the frame editor itself with the render's settings, so the approved preview is what the first frame looks like.
  const frames = (input.mode ?? "frames") === "frames" && (MIXED_FRAME_MODELS as readonly string[]).includes(input.modelId);
  const count = frames && input.sourceFps ? frameSampling(input.range.end - input.range.start, input.fps, input.sourceFps).frames : 0;
  return {
    key: "preview",
    request: {
      feature: MIXED_PREVIEW_FEATURE,
      title,
      modelId: frames ? input.modelId : MIXED_TOOLS.cloud.preview,
      op: "edit",
      prompt: prompts.still,
      inputs: { images: input.frameUrl ? [input.frameUrl] : [] },
      ...(frames
        ? { params: { ...frameEditParams(input.modelId, frameResolution(count, input.resolution), input.seed ?? FRAME_SEED), numOutputs: 1 } }
        : input.seed !== undefined
          ? { params: { seed: input.seed } }
          : {}),
    },
  };
}
