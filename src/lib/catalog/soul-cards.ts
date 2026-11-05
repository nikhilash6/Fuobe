/**
 * Fuobe Soul's looks as the pickers show them (the composer's Look chip, the Moodboard panel's curated sets).
 * Browser-safe: cards only, no LoRAs or recipes (src/lib/catalog/soul.ts builds the run on the server).
 */
import { SOUL_LEGACY_IDS, SOUL_LOOK_CARDS, SOUL_LOOK_CATEGORIES } from "./soul-looks.generated";

export interface SoulLookCard {
  /** Fuobe's id: family + the name as a slug ("v1-general"). */
  id: string;
  name: string;
  family: "v1" | "v2";
  categories: string[];
  /** The look in words (Fuobe's own wording). */
  description: string;
  /** A drawn cover's hue (no preview media is copied from anywhere). */
  hue: number;
  /** The grade preset applied after generation. */
  grade?: string;
  /** Drawn on the result in the browser: a date stamp, a CCTV caption, a photo-booth print. */
  overlay?: "date-stamp" | "cctv" | "photo-booth";
  /** A step after the picture: "face-mosaic" pixelates the faces (SAM 3.1 + a mosaic; priced into the run). */
  post?: "face-mosaic";
  /** Some of its LoRAs download from civitai (needs the user's free civitai key). */
  civitai: boolean;
  /** Made for Fuobe Soul HD (Qwen-Image 2512: lettering). */
  hd: boolean;
}

/** The Soul Originals' model ids (Soul Cinema has one fixed look). */
export const SOUL_MODEL_IDS = { soul: "fuobe-soul", hd: "fuobe-soul-hd", cinema: "fuobe-soul-cinema" } as const;

/** The look a Fuobe Soul run uses when none is picked: Soul's own default. */
export const DEFAULT_LOOK = "v1-general";

/**
 * A personal moodboard trained as a style LoRA (build plan O3) is the look: its LoRA comes in as the user's own (the
 * moodboard's style element, @mentioned), with no look words, LoRAs, tail or grade of Soul's around it.
 */
export const OWN_LOOK = "own-style";

/**
 * The look a casting sheet is drawn in (natural, unretouched skin and fabric): Soul Cast, Character Sheet's Build from
 * scratch, the AI Influencer builder and app.
 */
export const CAST_LOOK = "v1-realistic";

const BY_ID = new Map(SOUL_LOOK_CARDS.map((c) => [c.id, c]));

/** A look's card by its Fuobe id, or by legacy style id (settings saved before the Originals). */
export function lookCard(id: string | null | undefined): SoulLookCard | undefined {
  if (!id) return undefined;
  return BY_ID.get(id) ?? BY_ID.get(SOUL_LEGACY_IDS[id.toLowerCase()] ?? "");
}

/** The looks of a family and its tabs ("All presets" first), in Soul's order. */
export function lookSet(family: "v1" | "v2"): { items: SoulLookCard[]; categories: string[] } {
  return { items: SOUL_LOOK_CARDS.filter((c) => c.family === family), categories: SOUL_LOOK_CATEGORIES[family] };
}

/** A stable hue per look id for its drawn cover. */
export function lookHue(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export { SOUL_LOOK_CARDS };
