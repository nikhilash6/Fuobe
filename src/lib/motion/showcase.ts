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

/**
 * Fuobe's own sample products, cut out (with their versions): objects made for the showcase brands, in their
 * palettes. The earlier files (/previews/kinetic/perfume.webp, heel.webp) stay in place for pieces saved with them.
 */
export const SHOWCASE_PRODUCTS = {
  perfume: "/previews/kinetic/products/ardent-parfum.webp?v=b7d1a73c",
  serum: "/previews/kinetic/products/sora-serum.webp?v=d4a7b1f7",
  heel: "/previews/kinetic/products/vesper-stiletto.webp?v=1f3e75c7",
  nightSerum: "/previews/kinetic/products/aurele-serum-nuit.webp?v=2c31f473",
  lipstick: "/previews/kinetic/products/vesper-lipstick.webp?v=9f42e87f",
  card: "/previews/kinetic/products/ledgerly-card.webp?v=0a08b3fc",
  headphones: "/previews/kinetic/products/lumen-headphones.webp?v=5f4b8973",
} as const;

/** The same products as small tiles (the Picture picker shows these; a piece always gets the full picture). */
export const SHOWCASE_PRODUCT_THUMBS: Record<keyof typeof SHOWCASE_PRODUCTS, string> = {
  perfume: "/previews/kinetic/products/thumbs/ardent-parfum.webp?v=ac88c6f3",
  serum: "/previews/kinetic/products/thumbs/sora-serum.webp?v=5af213c8",
  heel: "/previews/kinetic/products/thumbs/vesper-stiletto.webp?v=43ab64fa",
  nightSerum: "/previews/kinetic/products/thumbs/aurele-serum-nuit.webp?v=9f0092b4",
  lipstick: "/previews/kinetic/products/thumbs/vesper-lipstick.webp?v=e9a8a417",
  card: "/previews/kinetic/products/thumbs/ledgerly-card.webp?v=3eb0d0ff",
  headphones: "/previews/kinetic/products/thumbs/lumen-headphones.webp?v=0d3422a9",
};

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
  "m2-offer-badge": { brand: "sora", size: "9:16", product: "serum", fields: { offer: "20% off", headline: "The gifting edit", cta: "Shop the edit" }, controls: { pace: "punchy", look: "light" } },
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
