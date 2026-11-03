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
  /** Its lockup (symbol and wordmark as outlines, in one colour), drawn by Fuobe: /previews/kinetic/marks/…svg. None: its name is set in type. */
  logo?: string;
}

const BRANDS = {
  ardent: { name: "Maison Ardent", colors: ["#4a1424", "#e9b8aa"], fonts: { heading: "Playfair Display", body: "Inter" }, logo: "/previews/kinetic/marks/ardent.svg?v=9d6992d9" },
  lumen: { name: "Lumen Labs", colors: ["#3d5afe", "#9fe7ff"], fonts: { heading: "Space Grotesk", body: "Inter" }, logo: "/previews/kinetic/marks/lumen.svg?v=5383c502" },
  ledgerly: { name: "Ledgerly", colors: ["#1f3fd1", "#ffb547"], fonts: { heading: "Space Grotesk", body: "Inter" }, logo: "/previews/kinetic/marks/ledgerly.svg?v=04360c5d" },
  vesper: { name: "Vesper", colors: ["#c8102e", "#f4b43c"], fonts: { heading: "Fraunces", body: "Manrope" }, logo: "/previews/kinetic/marks/vesper.svg?v=7c2c68c7" },
  sora: { name: "Sora Skin", colors: ["#6b1430", "#f6cdd2"], fonts: { heading: "Fraunces", body: "Manrope" }, logo: "/previews/kinetic/marks/sora.svg?v=0b4eecd2" },
  aurele: { name: "Aurèle", colors: ["#0e3b2f", "#cfae6e"], fonts: { heading: "Cormorant Garamond", body: "Manrope" }, logo: "/previews/kinetic/marks/aurele.svg?v=55ea21a5" },
  kova: { name: "KOVA", colors: ["#ff5a1f", "#16120f"], fonts: { heading: "Archivo Black", body: "Inter" } },
  noor: { name: "Atelier Noor", colors: ["#17120d", "#d8b26e"], fonts: { heading: "Bodoni Moda", body: "Inter" } },
  halden: { name: "Halden", colors: ["#16110f", "#e5432c"], fonts: { heading: "DM Serif Display", body: "Inter" } },
  halcyon: { name: "Halcyon Hotels", colors: ["#123049", "#e2bd78"], fonts: { heading: "Cormorant Garamond", body: "Manrope" } },
  lune: { name: "Bar Lune", colors: ["#1c1236", "#ffb36b"], fonts: { heading: "Fraunces", body: "Outfit" } },
  orbit: { name: "Orbit", colors: ["#1b2a63", "#ff7a59"], fonts: { heading: "Space Grotesk", body: "Inter" } },
} satisfies Record<string, ShowcaseBrand>;

export const SHOWCASE_BRANDS: Record<keyof typeof BRANDS, ShowcaseBrand> = BRANDS;

export type ShowcaseBrandId = keyof typeof BRANDS;

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

/** Fuobe's own sample photographs, for templates that fill a panel or the frame with one (with their versions). */
export const SHOWCASE_PHOTOS = {
  portrait: "/previews/kinetic/photos/portrait-soft.webp?v=d5a8ad5a",
  dunes: "/previews/kinetic/photos/red-dunes.webp?v=55df7331",
  gown: "/previews/kinetic/photos/gold-gown.webp?v=27ae6c3f",
  night: "/previews/kinetic/photos/night-lights.webp?v=4234c952",
} as const;

export interface Showcase {
  brand: ShowcaseBrandId;
  /** The brand's colours for this piece, when it shows the brand in another of its palettes (its own by default). */
  colors?: string[];
  fields: Record<string, string>;
  controls: Record<string, string>;
  product?: keyof typeof SHOWCASE_PRODUCTS;
  photo?: keyof typeof SHOWCASE_PHOTOS;
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
  "ms-kinetic-headline": { brand: "lumen", size: "9:16", fields: { headline: "SHIP IT *TONIGHT.*", cta: "Start free", website: "lumenlabs.io", note: "Release 4.0" }, controls: { pace: "punchy", look: "dark", align: "left" } },
  "m2-line-reveal": { brand: "ardent", size: "9:16", product: "perfume", fields: { headline: "Quietly exceptional.", cta: "Discover the scent", website: "maison-ardent.com", note: "Est. 1987" }, controls: { pace: "calm", look: "light", line: "fine" } },
  "ms-logo-sting": { brand: "lumen", size: "4:5", fields: { tagline: "Software that ships itself", website: "lumenlabs.io", note: "Est. 2019" }, controls: { pace: "punchy", look: "dark" } },
  "ms-feature-cards": { brand: "ledgerly", colors: ["#4a1020", "#f2c4c0"], size: "4:5", fields: { headline: "Month-end, minus the panic", point1: "Invoices that chase themselves", point2: "Payroll in two taps", point3: "Books that close on Friday", website: "ledgerly.app", note: "Built for finance teams" }, controls: { pace: "calm", look: "brand" } },
  "ms-dashboard-zoom": { brand: "ledgerly", size: "4:5", fields: { stat: "$1,284,000", label: "Revenue this quarter, up 38%", website: "ledgerly.app", note: "Q3 2026" }, controls: { pace: "calm", look: "dark" } },
  "m2-retro-starburst": { brand: "vesper", size: "9:16", product: "heel", fields: { headline: "Made to be noticed.", badge: "New!", website: "vesper-shoes.com", note: "SS26" }, controls: { pace: "punchy", look: "light" } },
  "m2-offer-badge": { brand: "sora", size: "9:16", product: "serum", fields: { offer: "20% off", headline: "THE GIFTING EDIT", cta: "Shop the edit", website: "soraskin.co", note: "Until 24 Dec" }, controls: { pace: "punchy", look: "brand" } },
  "ms-big-number": { brand: "ledgerly", size: "4:5", fields: { stat: "3×", caption: "*faster* month-end close, every month", website: "ledgerly.app", note: "2026 report" }, controls: { pace: "punchy", look: "light" } },
  "ms-five-star-quote": { brand: "sora", size: "4:5", photo: "portrait", fields: { quote: "“The only serum I’ve ever bought three times.”", name: "Amara K., verified buyer", website: "soraskin.co", note: "Verified reviews" }, controls: { pace: "calm", look: "light" } },
  "ms-end-card": { brand: "aurele", size: "9:16", scene: "end-card/draw-on", fields: { product: "Le Sérum Nuit", cta: "Discover the ritual", website: "aurele-paris.com" }, controls: { style: "draw-on", mark: "logo" } },
  "m2-midnight-drop": { brand: "kova", size: "9:16", fields: { headline: "DROP 07", count: "03:12:45", when: "Friday · 9 PM", cta: "Set a reminder", website: "kova.store", note: "Season 07" }, controls: { pace: "punchy", look: "dark" } },
  "m2-nocturne": { brand: "ardent", size: "9:16", product: "perfume", fields: { headline: "Nocturne", line: "Eau de parfum, for the hours after dark", cta: "Discover", website: "maison-ardent.com", note: "Est. 1987" }, controls: { pace: "calm", look: "dark" } },
  "m2-season-finale": { brand: "halden", size: "4:5", photo: "dunes", fields: { headline: "FINAL SALE", offer: "Up to 50% off", cta: "Shop the sale", website: "halden-studio.com", note: "SS26 Collection" }, controls: { pace: "punchy", look: "light" } },
  "m2-prism-stage": { brand: "aurele", colors: ["#2a1d4a", "#cfd3e0"], size: "4:5", product: "nightSerum", fields: { headline: "Eau de Nuit", line: "Amber, iris and a trace of smoke", cta: "Discover", website: "aurele-paris.com", note: "Est. 1924" }, controls: { pace: "calm", look: "dark" } },
  "mm-marquee": { brand: "lune", size: "9:16", photo: "night", fields: { headline: "Opening Night", when: "Friday 14 March · 8 PM", place: "12 Rue des Martyrs, Paris", cta: "Reserve a table", website: "barlune.fr", note: "Doors at 7:30" }, controls: { pace: "calm", look: "dark" } },
  "mm-runway-titles": { brand: "noor", size: "4:5", photo: "gown", fields: { headline: "THE GOLD HOUR", accent: "Spring", line: "Collection 07 · Marrakech", website: "ateliernoor.com", note: "SS26" }, controls: { pace: "calm", look: "dark" } },
  "ms-stat-stack": { brand: "orbit", size: "4:5", fields: { stat1: "98%", label1: "of tickets answered in *an hour*", stat2: "4.9", label2: "average rating from 12,000 teams", stat3: "3×", label3: "faster than last year", website: "orbit.help", note: "2026 report" }, controls: { pace: "punchy", look: "dark" } },
  "ms-kind-words": { brand: "halcyon", size: "4:5", fields: { quote1: "“The calmest three days I’ve had all year.”", name1: "Léa M., Lisbon", quote2: "“Breakfast on the terrace was worth the trip alone.”", name2: "James O., London", quote3: "“We’ve booked again for September.”", name3: "Priya S., Mumbai", website: "halcyonhotels.com", note: "Guest reviews" }, controls: { pace: "calm", look: "dark" } },
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
    brand: { name: b.name, colors: [...(s.colors ?? b.colors)], fonts: { ...b.fonts }, ...(logo && { logo }) },
    ...((s.product || s.photo) && { media: { product: s.product ? SHOWCASE_PRODUCTS[s.product] : SHOWCASE_PHOTOS[s.photo!] } }),
    controls: { template: id, ...s.controls, ...(o.cover && { cover: "tile" }) },
    export: DEFAULT_EXPORT,
  };
}
