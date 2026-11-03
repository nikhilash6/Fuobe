/**
 * A recipe: everything a Kinetic Motion clip is made from, as JSON (pure). The scene, the seed, the size and rate, the
 * typed words, the brand, the person's own files, the scene's control values and the export settings. It is saved
 * with the result (params.extra.motion), so the same clip can be made again.
 */

import { z } from "zod";
import { rng } from "./random";

/** A recipe is at most this big as JSON. */
export const RECIPE_MAX_BYTES = 64 * 1024;

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** A picture the clip is made from: the person's own stored file, or one of Fuobe's own sample pictures. */
const File = z
  .string()
  .max(500)
  .refine((u) => (u.startsWith("/api/files/") || u.startsWith("/previews/")) && !u.includes(".."), "A stored file or a sample picture");

export const RecipeSchema = z.object({
  v: z.literal(1),
  scene: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/).max(80),
  seed: z.number().int().min(0).max(2 ** 31 - 1),
  size: z.union([z.enum(["9:16", "1:1", "16:9", "4:5"]), z.object({ w: z.number().int().min(64).max(4096), h: z.number().int().min(64).max(4096) })]),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30)]),
  duration: z.number().min(0.5).max(60),
  /** The typed words, by field (headline, sub, cta, website, badge…), exactly as typed. */
  fields: z.record(z.string().max(40), z.string().max(600)),
  brand: z.object({
    name: z.string().max(120),
    colors: z.array(Hex).max(8),
    fonts: z.object({ heading: z.string().max(80).optional(), body: z.string().max(80).optional() }),
    /** The logo's address (a stored file, or the kit's own link). */
    logo: z.string().max(500).optional(),
  }),
  media: z.object({ product: File.optional(), images: z.array(File).max(4).optional() }).optional(),
  controls: z.record(z.string().max(40), z.union([z.string().max(80), z.number(), z.boolean()])).optional(),
  export: z.object({
    format: z.enum(["mp4", "webm"]),
    bitrate: z.number().int().min(500_000).max(40_000_000).optional(),
    blurSamples: z.number().int().min(1).max(32),
    shutter: z.number().min(0).max(360),
    /** How it was encoded: frame-exact WebCodecs, or the real-time recorder (may drop a frame). */
    encoder: z.enum(["webcodecs", "recorder"]).optional(),
  }),
});

export type Recipe = z.infer<typeof RecipeSchema>;

export const DEFAULT_EXPORT: Recipe["export"] = { format: "mp4", blurSamples: 8, shutter: 180 };

/** A recipe checked and held to its scene's length limits; throws on a bad one. */
export function normalizeRecipe(input: unknown, limits?: { min: number; max: number }): Recipe {
  const r = RecipeSchema.parse(input);
  if (JSON.stringify(r).length > RECIPE_MAX_BYTES) throw new Error("This recipe is too big");
  const duration = limits ? Math.min(limits.max, Math.max(limits.min, r.duration)) : r.duration;
  return { ...r, duration };
}

/** JSON with keys in a fixed order, so equal recipes write the same text. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** A short key for one look (equal recipes, equal keys): the page saves a look once per visit by it. */
export function recipeKey(r: Recipe | Record<string, unknown>): string {
  const text = stableJson(r);
  const a = rng(0x51f15e, text);
  const b = rng(0x2c1b3c6d, text);
  return `${Math.floor(a * 2 ** 32).toString(16).padStart(8, "0")}${Math.floor(b * 2 ** 32).toString(16).padStart(8, "0")}`;
}
