import { END_CARD } from "@/lib/catalog/marketing";
import { endCardRest, restNodes, type EndCardContent, type TextBlock } from "@/lib/motion/scenes/end-card/shared";
import { designSize } from "@/lib/motion/sizes";
import type { AdPlan, AdTheme, Measure, TextBox } from "../ads/layout";
import { ensureFont, loadImage, measureText } from "../ads/render";
import { drawDisplayList } from "../motion/draw";

/**
 * Click to Ad's logo end card: the brand colour, the logo (or the brand's name), the product name, a call-to-action
 * pill and the address, centred on a 9:16 card in the kit's colours. Laid out by the animated end card's own rest
 * layout and drawn by the same drawer, so the still card and every style's last frame are the same picture.
 */

export type { EndCardContent } from "@/lib/motion/scenes/end-card/shared";

export interface EndCardLayoutInput {
  theme: AdTheme;
  content: EndCardContent;
  /** The logo's pixel size (null: none, or it didn't load). */
  logo?: { w: number; h: number } | null;
  measure: Measure;
  size?: { w: number; h: number };
  /** The kit's colours (the words and the pill take one that reads on the brand colour). */
  colors?: readonly string[];
}

/** "yourshop.com" from "https://www.yourshop.com/products/x". */
export function siteLabel(url: string | undefined): string | undefined {
  if (!url?.trim()) return undefined;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/**
 * Where everything goes on the card: one centred block (logo or name, product, CTA), the address at the foot. The
 * animated end cards end on this same layout (lib/motion/scenes/end-card/shared.ts endCardRest), so the still card,
 * the poster and every style's last frame match. Words are set exactly as typed (no capitals added, nothing cut);
 * `overflow` names a field too long to fit even at its smallest size.
 */
export function planEndCard(p: EndCardLayoutInput): AdPlan & { overflow: (keyof EndCardContent)[] } {
  const size = p.size ?? END_CARD.size;
  const r = endCardRest({ theme: p.theme, content: p.content, logo: p.logo ?? null, measure: p.measure, size, letters: false, colors: p.colors });
  const box = (b: TextBlock, width = r.inner): TextBox => ({ lines: b.layout.lines.map((l) => l.text), x: b.cx, y: b.y, size: b.layout.size, lineHeight: b.layout.lineHeight, font: b.layout.font, color: b.color, align: "center", width });
  return {
    w: size.w,
    h: size.h,
    bg: p.theme.accent,
    image: null,
    logo: r.logo,
    brand: r.brand && box(r.brand),
    headline: box(r.headline),
    body: r.site && box(r.site),
    cta: r.cta && { x: r.cta.x, y: r.cta.y, w: r.cta.w, h: r.cta.h, radius: r.cta.r, color: r.cta.color, text: box(r.cta.label, r.cta.w) },
    overflow: r.overflow,
  };
}

export interface EndCardInput {
  theme: AdTheme;
  content: EndCardContent;
  logo?: string | null;
  colors?: readonly string[];
}

/**
 * Draw the card on `canvas` at `scale` (1 = the full 720 × 1280 card). Fonts and the logo load first;
 * `current` says whether this drawing is still wanted then (a newer one for the same canvas wins).
 */
export async function renderEndCard(canvas: HTMLCanvasElement, input: EndCardInput, scale = 1, current: () => boolean = () => true): Promise<void> {
  const [logo] = await Promise.all([input.logo ? loadImage(input.logo).catch(() => null) : null, ensureFont(input.theme.heading), ensureFont(input.theme.body)]);
  if (!current()) return;
  const { w, h } = END_CARD.size;
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;
  // Laid out in the animated card's design units (1080 on the short side) and scaled by the drawer, as its frames are.
  const size = designSize(END_CARD.size);
  const rest = endCardRest({ theme: input.theme, content: input.content, logo: logo ? { w: logo.naturalWidth || 400, h: logo.naturalHeight || 120 } : null, measure: measureText, size, colors: input.colors });
  const images = new Map<string, CanvasImageSource>();
  if (logo) images.set("logo", logo);
  drawDisplayList(ctx, { w: size.w, h: size.h, background: input.theme.accent, nodes: restNodes(rest) }, { images });
}

/** The full-size card as a PNG, ready to upload. */
export async function endCardPng(input: EndCardInput): Promise<Blob> {
  const canvas = document.createElement("canvas");
  await renderEndCard(canvas, input, 1);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't draw the end card"))), "image/png"));
}
