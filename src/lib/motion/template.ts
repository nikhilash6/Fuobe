/**
 * A code-drawn Marketing template as a recipe (pure): what the person typed and picked on the template's page (its
 * words, quick choices, size, length, brand and picture), made into the Kinetic Motion recipe that plays in the preview
 * and is saved with the result. The page starts from the template's showcase, so it opens on a finished piece.
 */

import { FORMATS, KINETIC_SIZES, type MarketingTemplate } from "@/lib/catalog/marketing";
import { unmarked } from "./marks";
import { DEFAULT_EXPORT, type Recipe } from "./recipe";
import { SHOWCASE_BRANDS, SHOWCASE_PHOTOS, SHOWCASE_PRODUCTS, SHOWCASES } from "./showcase";
import type { SizePreset } from "./sizes";

export interface TemplateBrand {
  name: string;
  /** The main colour first, then the second. */
  colors: string[];
  fonts: { heading: string; body: string };
  /** A stored logo (/api/files/…). */
  logo?: string | null;
}

export interface TemplateState {
  fields: Record<string, string>;
  controls: Record<string, string>;
  size: SizePreset;
  duration: number;
  brand: TemplateBrand;
  /** The picture the template shows (a stored file, or one of Fuobe's sample products). */
  product?: string | null;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** The sizes this template comes in: the four Kinetic sizes, its own first. */
export function templateSizes(t: MarketingTemplate): SizePreset[] {
  const own = KINETIC_SIZES.find((s) => s === t.aspect);
  return own ? [own, ...KINETIC_SIZES.filter((s) => s !== own)] : [...KINETIC_SIZES];
}

/** The lengths it can be (seconds). */
export function templateLengths(t: MarketingTemplate): { min: number; max: number; default: number } {
  return t.lengths ?? FORMATS[t.format].durations ?? { min: 5, max: 15, default: t.duration ?? 5 };
}

/** The scene a state plays: a choice that picks the scene (the end card's style) wins. */
export function templateScene(t: MarketingTemplate, controls: Record<string, string>): string {
  for (const g of t.easy ?? []) {
    if (!g.scene) continue;
    const pick = g.choices.find((c) => c.id === controls[g.id]) ?? g.choices[0];
    return `${g.scene}/${pick.id}`;
  }
  return t.scene ?? "";
}

/** The showcase brand a template opens with. */
export function showcaseBrand(t: MarketingTemplate): TemplateBrand {
  const s = SHOWCASES[t.id];
  const b = SHOWCASE_BRANDS[s?.brand ?? "lumen"];
  return { name: b.name, colors: [...(s?.colors ?? b.colors)], fonts: { ...b.fonts }, logo: b.logo };
}

/** The state a template opens in: its showcase words and choices, and the person's own brand when they set one. */
export function initialState(t: MarketingTemplate, brand?: TemplateBrand | null): TemplateState {
  const s = SHOWCASES[t.id];
  const sizes = templateSizes(t);
  const lengths = templateLengths(t);
  const controls: Record<string, string> = {};
  for (const g of t.easy ?? []) controls[g.id] = s?.controls[g.id] ?? g.choices[0].id;
  const fields: Record<string, string> = {};
  for (const f of t.fields ?? []) fields[f.key] = s?.fields[f.key] ?? "";
  return {
    fields,
    controls,
    size: s?.size && sizes.includes(s.size) ? s.size : sizes[0],
    duration: lengths.default,
    brand: brand ?? showcaseBrand(t),
    product: t.picture === "product" ? (s?.product ? SHOWCASE_PRODUCTS[s.product] : SHOWCASE_PRODUCTS.perfume) : t.picture === "photo" ? SHOWCASE_PHOTOS[s?.photo ?? "portrait"] : null,
  };
}

/** Whether the scene is the end card (its brand name is a field of its own, and its mark a choice). */
const isEndCard = (scene: string) => scene.startsWith("end-card/");

/** The state as the recipe the preview plays and the result keeps. */
export function templateRecipe(t: MarketingTemplate, s: TemplateState): Recipe {
  const scene = templateScene(t, s.controls);
  const lengths = templateLengths(t);
  const colors = s.brand.colors.filter((c) => HEX.test(c)).slice(0, 8);
  const fields: Record<string, string> = {};
  for (const f of t.fields ?? []) {
    const v = s.fields[f.key] ?? "";
    if (v.trim()) fields[f.key] = v.slice(0, f.max);
  }
  const endCard = isEndCard(scene);
  if (endCard) fields.brand = s.brand.name;
  // The end card's "Name" choice sets the brand name in type even when there is a logo.
  const logo = s.brand.logo && !(endCard && s.controls.mark === "name") ? s.brand.logo : undefined;
  const controls: Record<string, string> = { template: t.id };
  for (const g of t.easy ?? []) if (!g.scene && s.controls[g.id]) controls[g.id] = s.controls[g.id];
  const product = t.picture && s.product ? s.product : undefined;
  return {
    v: 1,
    scene,
    seed: 7,
    size: s.size,
    fps: 30,
    duration: Math.min(lengths.max, Math.max(lengths.min, s.duration)),
    fields,
    brand: { name: s.brand.name.slice(0, 120), colors, fonts: { heading: s.brand.fonts.heading, body: s.brand.fonts.body }, ...(logo && { logo }) },
    ...(product && { media: { product } }),
    controls,
    export: DEFAULT_EXPORT,
  };
}

/** Whether a template's field takes *stars* round the words it highlights. */
export const marks = (t: MarketingTemplate, key: string): boolean => t.scene === "marketing/kinetic-headline" && key === "headline";

/** What a saved result is listed and searched by: "Kinetic Headline · Invoices that chase", and the typed words. */
export function templateWords(t: MarketingTemplate, s: TemplateState): { title: string; prompt: string } {
  // Only the Kinetic Headline's headline takes *marks*; every other field reads exactly as typed.
  const typed = (t.fields ?? []).map((f) => (marks(t, f.key) ? unmarked(s.fields[f.key] ?? "") : (s.fields[f.key] ?? "")).trim()).filter(Boolean);
  const first = (typed[0] ?? s.brand.name).split(/\s+/).slice(0, 5).join(" ");
  return { title: `${t.name} · ${first}`.slice(0, 200), prompt: [s.brand.name, ...typed].filter(Boolean).join(" · ").slice(0, 2000) };
}

/** The person's own stored files a recipe was made from (their logo, their picture). */
export function ownFiles(r: Recipe): string[] {
  return [r.brand.logo, r.media?.product].filter((u): u is string => !!u?.startsWith("/api/files/"));
}
