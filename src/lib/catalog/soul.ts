/**
 * Fuobe Soul (build plan O2): Soul's looks rebuilt on open weights, the same recipe on both engines.
 * Pure logic, no I/O. A run is Z-Image Turbo (Qwen-Image 2512 for lettering) plus up to three LoRAs, the
 * look's words around the user's prompt, Soul's sizes and sampler, and a grade (and for three looks an
 * overlay) applied after generation:
 *
 *   "{triggers}, {prompt}. {look}. {tail}"   (research §4.2: each LoRA's trigger in front)
 *
 * - The looks, tails, sizes and Soul Cinema's recipe are generated from the research
 *   (soul-originals.generated.ts by scripts/gen-soul-originals.py); their LoRAs are LORA_LIBRARY keys.
 * - Slot rule within a cloud API's 3 LoRAs (research §4.1, plan O2): the user's own LoRA (a trained
 *   character) first, then the look's own LoRAs, then the core LoRA if a slot is left. fitLoras keeps the
 *   first ones, so the core gives way, never the character.
 * - Preset strength 0–1 multiplies the look's LoRA scales; character strength 0–1 maps to a character
 *   LoRA scale of 0.6–1.0.
 * - A look made for another base (Graffiti: Qwen-Image 2512) keeps its words, not its LoRAs.
 * - Legacy style ids are read only to find the look an old request or moodboard pick meant
 *   (`legacyStyleId`); they are never sent anywhere.
 */
import { loraEntry, loraRef } from "./loras";
import type { SoulPost } from "./open-tools";
import { DEFAULT_LOOK, OWN_LOOK, SOUL_MODEL_IDS } from "./soul-cards";
import { SOUL_CINEMA, SOUL_CORE_LORAS, SOUL_ORIGINALS, SOUL_SIZES, SOUL_TAILS } from "./soul-originals.generated";
import type { LoraRef, ModelDef } from "./types";

export type SoulTail = "photo" | "phone" | "flash" | "cine" | "art";
export type SoulTier = "720p" | "1080p";
export type SoulOverlay = "date-stamp" | "cctv" | "photo-booth";
export type SoulBase = "z-image" | "qwen-2512";

/** A Soul look (generated from the research). */
export interface SoulLook {
  /** Fuobe's id: family + the name as a slug ("v1-general", "v2-y2k-studio"). */
  id: string;
  name: string;
  /** Soul v1 (106 looks) or Soul 2.0 (33). */
  family: "v1" | "v2";
  /** The picker's tabs it shows under (generic words). */
  categories: string[];
  /** The look in words (Fuobe's own wording), between the prompt and the tail. */
  look: string;
  tail: SoulTail;
  /** LORA_LIBRARY keys at this look's strengths, in the research's order (≤ 3). */
  loras: { key: string; strength: number }[];
  /** The base the look is made for: Z-Image Turbo, or Qwen-Image 2512 for lettering (Graffiti). */
  base: SoulBase;
  /** lora = a look LoRA; prompt+core = the core LoRA and words; prompt-only = words alone. */
  coverage: string;
  /** A src/lib/grade.ts preset applied after generation. */
  grade?: string;
  /** Drawn on the result in the browser (diffusion draws text and frames badly). */
  overlay?: SoulOverlay;
  /**
   * A step after the picture (O11): "face-mosaic" pixelates the faces (PixeletedFace): SAM 3.1 and a mosaic on the GPU, fal's
   * SAM 3.1 masks pixelated by the server in the cloud (src/lib/catalog/open-tools.ts).
   */
  post?: SoulPost;
  /** A Fuobe-trained LoRA should replace the public one or the words (research §6). */
  train?: true;
  note?: string;
  /** Legacy style id: only to read old saved settings, never sent. */
  legacyStyleId: string;
}

export interface SoulCinemaRecipe {
  loras: { key: string; strength: number }[];
  tail: SoulTail;
  /** Grade presets that suit it; the first is applied. */
  grades: string[];
  defaultAspect: string;
}

/** The Soul Originals' model ids. */
export const SOUL_MODELS = SOUL_MODEL_IDS;
export type SoulModelId = (typeof SOUL_MODELS)[keyof typeof SOUL_MODELS];
export { DEFAULT_LOOK, OWN_LOOK };

/** Which Soul a model is (none for other models). */
export function soulKind(model: Pick<ModelDef, "id"> | string | undefined): "soul" | "hd" | "cinema" | undefined {
  const id = typeof model === "string" ? model : model?.id;
  return id === SOUL_MODELS.soul ? "soul" : id === SOUL_MODELS.hd ? "hd" : id === SOUL_MODELS.cinema ? "cinema" : undefined;
}

const BY_ID = new Map(SOUL_ORIGINALS.map((l) => [l.id, l]));
const BY_LEGACY = new Map(SOUL_ORIGINALS.map((l) => [l.legacyStyleId, l]));
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * A look by its Fuobe id ("v1-general"), its legacy style id (saved settings from before), or its
 * name ("Indie sleaze"; Soul v1 first when both families have one, as the evaluation harness reads names).
 */
export function soulLook(key: string | undefined | null): SoulLook | undefined {
  if (!key) return undefined;
  const k = String(key).trim();
  const hit = BY_ID.get(k) ?? BY_LEGACY.get(k.toLowerCase());
  if (hit) return hit;
  const n = norm(k);
  return BY_ID.get(`v1-${n}`) ?? BY_ID.get(`v2-${n}`);
}

/** The looks of one family, in Soul's order. */
export const soulLooks = (family?: "v1" | "v2"): SoulLook[] => (family ? SOUL_ORIGINALS.filter((l) => l.family === family) : SOUL_ORIGINALS);

/** Does any of this look's LoRAs need the user's civitai key to download? */
export const needsCivitai = (look: Pick<SoulLook, "loras">): boolean => look.loras.some((l) => loraEntry(l.key)?.download === "civitai-token");

// ---------------------------------------------------------------------------
// Sizes

/** Soul's tiers: about 1 MP and about 2 MP. */
export const SOUL_TIERS: SoulTier[] = ["720p", "1080p"];
/** The seven aspect ratios of Soul's size table. */
export const SOUL_ASPECTS: string[] = Object.keys(SOUL_SIZES["720p"]);
/** Soul Cinema's crop option (research §4.5): made at 16:9, cropped to 21:9 after generation. */
export const CINEMA_CROP = "21:9" as const;

/** Width and height for an aspect ratio and tier (the 720p tier and 3:4 when either is unknown). */
export function soulSize(aspectRatio: string | undefined, tier: string | undefined): { width: number; height: number } {
  const t = SOUL_SIZES[(tier as SoulTier) in SOUL_SIZES ? (tier as SoulTier) : "720p"];
  const [width, height] = t[aspectRatio ?? ""] ?? t["3:4"] ?? Object.values(t)[0];
  return { width, height };
}

/**
 * fal's megapixel is 1024 × 1024 pixels: its price pages bill a 1024x1024 image as one megapixel and a 1920x1080
 * one as two. Soul's 720p tier is one (896x1152 is 0.98), its 1080p tier about two.
 */
export const FAL_MEGAPIXEL = 1024 * 1024;

/** Megapixels of one image at this size, as a per-megapixel price bills them (fal's 1024 × 1024 megapixel). */
export const soulMegapixels = (aspectRatio: string | undefined, tier: string | undefined): number => {
  const { width, height } = soulSize(aspectRatio, tier);
  return (width * height) / FAL_MEGAPIXEL;
};

// ---------------------------------------------------------------------------
// The run

const clamp01 = (v: number | undefined, d = 1) => (v === undefined || !Number.isFinite(v) ? d : Math.max(0, Math.min(1, v)));
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Character strength 0–1 → the character LoRA's scale 0.6–1.0 (Soul ID's custom_reference_strength). */
export const characterScale = (strength: number | undefined): number => round3(0.6 + 0.4 * clamp01(strength, 1));

/** The base a Soul model runs (Soul HD: Qwen-Image 2512; Soul and Soul Cinema: Z-Image Turbo). */
export const soulBase = (kind: "soul" | "hd" | "cinema"): SoulBase => (kind === "hd" ? "qwen-2512" : "z-image");

/** Each LoRA's trigger once, in order ("hardflashy, emoessence"). */
export const triggersOf = (loras: Pick<LoraRef, "trigger">[]): string => [...new Set(loras.map((l) => l.trigger?.trim()).filter(Boolean))].join(", ");

/** "{triggers}, {prompt}. {look}. {tail}": the user's words in the look (a sentence already in the prompt isn't added twice). */
export function composeSoulPrompt(words: string, look: string, tail: SoulTail, triggers = ""): string {
  const p = words.trim().replace(/[.\s]+$/, "");
  const parts = [p, look.trim().replace(/[.\s]+$/, ""), SOUL_TAILS[tail].trim().replace(/[.\s]+$/, "")].filter((s) => s && !(s !== p && p.includes(s)));
  const body = parts.length ? `${parts.join(". ")}.` : "";
  const t = triggers.trim();
  return t ? `${t}, ${body}` : body;
}

export interface SoulRecipe {
  /** The look applied (Soul Cinema has none: its film look is fixed). */
  look?: SoulLook;
  /** The prompt the model gets. */
  prompt: string;
  /** In slot order: the user's own (a character), the look's, then the core. */
  loras: LoraRef[];
  /** The user's words before the look went round them (the enhancer expands these, then the look is put back). */
  words: string;
  tail: SoulTail;
  /** Applied in the browser when the result arrives (meta.grade for API clients). */
  grade?: string;
  overlay?: SoulOverlay;
  notes: string[];
}

/**
 * A Fuobe Soul run: the look (or Soul Cinema's fixed one) around the user's words, its LoRAs scaled by the
 * preset strength and put in slot order after the user's own, the grade and the overlay.
 */
export function soulRecipe(
  kind: "soul" | "hd" | "cinema",
  words: string,
  opts: { look?: string; strength?: number; userLoras?: LoraRef[]; characterStrength?: number } = {},
): SoulRecipe {
  const notes: string[] = [];
  const k = clamp01(opts.strength, 1);
  const base = soulBase(kind);
  // The user's own LoRAs (an @character's trained identity) at the character strength's scale.
  const own = (opts.userLoras ?? []).map((l) => (opts.characterStrength === undefined ? l : { ...l, strength: characterScale(opts.characterStrength) }));
  let look: SoulLook | undefined;
  let picked: { key: string; strength: number }[];
  let tail: SoulTail;
  let sentence = "";
  let grade: string | undefined;
  let overlay: SoulOverlay | undefined;
  if (kind !== "cinema" && opts.look === OWN_LOOK) {
    // The trained moodboard's LoRA (among the user's own) carries the look.
    picked = [];
    tail = "art";
  } else if (kind === "cinema") {
    if (opts.look) notes.push("Soul Cinema has one film look, so the look you picked isn't used");
    picked = SOUL_CINEMA.loras;
    tail = SOUL_CINEMA.tail;
    grade = SOUL_CINEMA.grades[0];
  } else {
    look = soulLook(opts.look ?? DEFAULT_LOOK);
    if (!look) throw new Error(`Unknown Soul look ${opts.look}`);
    sentence = look.look;
    tail = look.tail;
    grade = look.grade;
    overlay = look.overlay;
    picked = look.loras;
    if (look.base !== base) {
      // Its LoRAs are for another base; the words still carry the look.
      if (picked.length) notes.push(`${look.name}'s LoRAs are made for ${look.base === "qwen-2512" ? "Fuobe Soul HD" : "Fuobe Soul"}, so this run uses its words only`);
      else if (look.base === "qwen-2512") notes.push(`${look.name} is made for Fuobe Soul HD (cleaner lettering)`);
      picked = [];
    }
  }
  const refs = picked
    .map((p) => {
      const e = loraEntry(p.key);
      return e ? loraRef(e, round3(p.strength * k)) : undefined;
    })
    .filter((l): l is LoraRef => !!l && (l.strength ?? 1) > 0);
  // Slot order: the look's own LoRAs, then the core one (it gives way first when a cloud API runs out of slots).
  const isCore = (l: LoraRef) => SOUL_CORE_LORAS.some((c) => loraEntry(c)?.file === l.file);
  const loras = [...own, ...refs.filter((l) => !isCore(l)), ...refs.filter(isCore)];
  const prompt = composeSoulPrompt(words, sentence, tail, triggersOf(refs));
  return { ...(look && { look }), prompt, loras, words, tail, ...(grade && { grade }), ...(overlay && { overlay }), notes };
}

/**
 * The prompt after some LoRAs were left out (a cloud API's slots, a civitai file without a key): the left-out
 * LoRAs' triggers come off the front, since they mean nothing to the model without the LoRA. `triggers` is the
 * front as the recipe wrote it (Plan.soul.triggers), in order.
 */
export function promptWithLoras(prompt: string, triggers: string[], kept: Pick<LoraRef, "trigger">[]): string {
  const before = triggers.join(", ");
  if (!before || !prompt.startsWith(`${before}, `)) return prompt;
  const keep = new Set(kept.map((l) => l.trigger?.trim()).filter(Boolean));
  const after = triggers.filter((t) => keep.has(t)).join(", ");
  if (after === before) return prompt;
  const rest = prompt.slice(before.length + 2);
  return after ? `${after}, ${rest}` : rest;
}

/** The step a Soul run's look asks for after its picture (the face mosaic), or none. Soul Cinema has none. */
export function soulPostStep(modelId: string, presetId: string | null | undefined): SoulPost | undefined {
  const kind = soulKind(modelId);
  if (!kind || kind === "cinema") return undefined;
  return soulLook(presetId ?? DEFAULT_LOOK)?.post;
}

/**
 * What happens to a Soul result after generation, read from its request (the grade preset, the overlay and Soul
 * Cinema's 21:9 crop the browser applies; meta.grade / meta.overlay / meta.crop tell API clients). Undefined for
 * other models.
 */
export function soulPostSteps(
  modelId: string,
  presetId: string | null | undefined,
  aspectRatio?: string | null,
): { look?: string; grade?: string; overlay?: SoulOverlay; crop?: typeof CINEMA_CROP } | undefined {
  const kind = soulKind(modelId);
  if (!kind) return undefined;
  if (kind === "cinema") return { grade: SOUL_CINEMA.grades[0], ...(aspectRatio === CINEMA_CROP && { crop: CINEMA_CROP }) };
  const look = soulLook(presetId ?? DEFAULT_LOOK);
  if (!look) return undefined;
  return { look: look.id, ...(look.grade && { grade: look.grade }), ...(look.overlay && { overlay: look.overlay }) };
}
