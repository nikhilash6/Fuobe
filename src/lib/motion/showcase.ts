/**
 * Showcase recipes for Marketing's code-drawn templates (pure): fictional premium brands, each with a deliberate
 * palette and a Google font pairing, and words written to read as real campaigns. They make each template's cover
 * (rendered by the engine itself: scripts/kinetic/render-covers.mjs) and fill a template when it first opens, so the
 * live preview starts from a finished piece that the person then makes their own.
 */

import { DEFAULT_EXPORT, type Recipe } from "./recipe";
import { TILE_COVER, type SizePreset } from "./sizes";

export interface ShowcaseBrand {
  name: string;
  colors: string[];
  fonts: { heading: string; body: string };
  /** Its lockup (symbol and wordmark as outlines, in one colour), drawn by Fuobe: /previews/kinetic/marks/…svg. */
  logo: string;
}

export const SHOWCASE_BRANDS = {
  ardent: { name: "Maison Ardent", colors: ["#2f3b2c", "#c9a46a"], fonts: { heading: "Playfair Display", body: "Inter" }, logo: "/previews/kinetic/marks/ardent.svg?v=9d6992d9" },
  lumen: { name: "Lumen Labs", colors: ["#3d5afe", "#9fe7ff"], fonts: { heading: "Space Grotesk", body: "Inter" }, logo: "/previews/kinetic/marks/lumen.svg?v=5383c502" },
  ledgerly: { name: "Ledgerly", colors: ["#0f5c5a", "#f4b860"], fonts: { heading: "Space Grotesk", body: "Inter" }, logo: "/previews/kinetic/marks/ledgerly.svg?v=04360c5d" },
  vesper: { name: "Vesper", colors: ["#c8102e", "#f4b43c"], fonts: { heading: "Fraunces", body: "Manrope" }, logo: "/previews/kinetic/marks/vesper.svg?v=7c2c68c7" },
  sora: { name: "Sora Skin", colors: ["#b5532f", "#e9b872"], fonts: { heading: "Fraunces", body: "Manrope" }, logo: "/previews/kinetic/marks/sora.svg?v=0b4eecd2" },
  aurele: { name: "Aurèle", colors: ["#0e3b2f", "#cfae6e"], fonts: { heading: "Cormorant Garamond", body: "Manrope" }, logo: "/previews/kinetic/marks/aurele.svg?v=55ea21a5" },
} satisfies Record<string, ShowcaseBrand>;

export type ShowcaseBrandId = keyof typeof SHOWCASE_BRANDS;

/** Fuobe's own sample products, cut out (with their versions). */
export const SHOWCASE_PRODUCTS = {
  perfume: "/previews/kinetic/perfume.webp?v=118749e2",
  heel: "/previews/kinetic/heel.webp?v=2ce2f692",
} as const;

export interface Showcase {
  brand: ShowcaseBrandId;
  fields: Record<string, string>;
  controls: Record<string, string>;
  product?: keyof typeof SHOWCASE_PRODUCTS;
  size: SizePreset;
  /** The scene, when a choice picks it (the end card's style). */
  scene?: string;
  /**
   * Where its cover rests, when the telling moment comes before the end: just before this event starts (the headline
   * fully set, before it gives way to the logo). By default the cover rests on the last frame.
   */
  poster?: string;
}

/** Each code-drawn template's showcase, by template id. */
export const SHOWCASES: Record<string, Showcase> = {
  "ms-kinetic-headline": { brand: "lumen", size: "9:16", fields: { headline: "Invoices that *chase* themselves.", cta: "Start free", website: "lumenlabs.io" }, controls: { pace: "punchy", look: "dark", align: "centre" }, poster: "words.exit" },
  "m2-line-reveal": { brand: "ardent", size: "9:16", product: "perfume", fields: { headline: "Quietly exceptional.", cta: "Discover the scent" }, controls: { pace: "calm", look: "light", line: "fine" } },
  "ms-logo-sting": { brand: "lumen", size: "4:5", fields: { tagline: "Software that ships itself" }, controls: { pace: "punchy", look: "dark" } },
  "ms-feature-cards": { brand: "ledgerly", size: "4:5", fields: { headline: "Month-end, minus the panic", point1: "Invoices that chase themselves", point2: "Payroll in two taps", point3: "Books that close on Friday" }, controls: { pace: "calm", look: "light" } },
  "ms-dashboard-zoom": { brand: "ledgerly", size: "4:5", fields: { stat: "$1,284,000", label: "Revenue this quarter, up 38%" }, controls: { pace: "calm", look: "dark" } },
  "m2-retro-starburst": { brand: "vesper", size: "9:16", product: "heel", fields: { headline: "Made to be noticed.", badge: "New!" }, controls: { pace: "punchy", look: "brand" } },
  "m2-offer-badge": { brand: "sora", size: "9:16", product: "perfume", fields: { offer: "20% off", headline: "The gifting edit", cta: "Shop the edit" }, controls: { pace: "punchy", look: "light" } },
  "ms-big-number": { brand: "ledgerly", size: "4:5", fields: { stat: "3×", caption: "faster month-end close" }, controls: { pace: "punchy", look: "brand" } },
  "ms-five-star-quote": { brand: "sora", size: "4:5", fields: { quote: "“The only serum I’ve ever bought three times.”", name: "Amara K., verified buyer" }, controls: { pace: "calm", look: "light" } },
  "ms-end-card": { brand: "aurele", size: "9:16", scene: "end-card/draw-on", fields: { product: "Le Sérum Nuit", cta: "Discover the ritual", website: "aurele-paris.com" }, controls: { style: "draw-on", mark: "logo" } },
};

/**
 * A template's showcase as a full recipe (its scene, 30 fps, its own length). With `cover`: its gallery tile's cover,
 * made at the tile's own shape (TILE_COVER) so nothing is cropped, with its words and product clear of the tile's chips.
 */
export function showcaseRecipe(id: string, scene: string, duration = 5, o: { cover?: boolean } = {}): Recipe | null {
  const s = SHOWCASES[id];
  if (!s) return null;
  const b = SHOWCASE_BRANDS[s.brand];
  // The end card's "Name" choice sets the name in type even when there is a logo.
  const logo = s.controls.mark === "name" ? undefined : b.logo;
  return {
    v: 1,
    scene: s.scene ?? scene,
    seed: 7,
    size: o.cover ? { ...TILE_COVER } : s.size,
    fps: 30,
    duration,
    fields: s.brand === "aurele" ? { brand: b.name, ...s.fields } : { ...s.fields },
    brand: { name: b.name, colors: [...b.colors], fonts: { ...b.fonts }, ...(logo && { logo }) },
    ...(s.product && { media: { product: SHOWCASE_PRODUCTS[s.product] } }),
    controls: { template: id, ...s.controls, ...(o.cover && { cover: "tile" }) },
    export: DEFAULT_EXPORT,
  };
}
