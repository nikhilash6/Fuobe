"use client";

import { loadImage } from "@/components/ads/render";
import { OUTLINE_GRID, traceOutline } from "@/lib/motion/outline";
import type { LogoInfo, Outline } from "@/lib/motion/scene";
import { logoInfoFor, type Sources } from "./draw";

/**
 * The pictures a recipe needs, loaded before its scene runs: the logo (with an SVG logo's outlines), the product, their
 * sizes, and a cut-out product's outline traced from its transparency. A scene gets sizes and outlines, never the
 * pictures themselves; the drawer gets the pictures.
 */

export interface LoadedInputs {
  sources: Sources;
  logo: LogoInfo | null;
  images: Record<string, { w: number; h: number }>;
  outlines: Record<string, Outline | null>;
}

const traced = new Map<string, Outline | null>();

/** A picture's outline from its alpha, on a grid at most OUTLINE_GRID on its long side (null: no transparency). */
export function outlineOf(url: string, img: HTMLImageElement): Outline | null {
  if (traced.has(url)) return traced.get(url)!;
  let out: Outline | null = null;
  try {
    const k = Math.min(1, OUTLINE_GRID / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(img, 0, 0, w, h);
      const rgba = ctx.getImageData(0, 0, w, h).data;
      const alpha = new Uint8ClampedArray(w * h);
      for (let i = 0; i < w * h; i++) alpha[i] = rgba[i * 4 + 3];
      out = traceOutline(alpha, w, h);
    }
  } catch {
    out = null;
  }
  traced.set(url, out);
  return out;
}

/** The logo and the product a recipe names (recipe.brand.logo, recipe.media.product), loaded. */
export async function loadMotionInputs(urls: { logo?: string | null; product?: string | null }): Promise<LoadedInputs> {
  const logoUrl = urls.logo || null;
  const productUrl = urls.product || null;
  const [logoImg, productImg] = await Promise.all([logoUrl ? loadImage(logoUrl).catch(() => null) : null, productUrl ? loadImage(productUrl).catch(() => null) : null]);
  const logo = logoImg && logoUrl ? await logoInfoFor(logoUrl, logoImg).catch(() => null) : null;
  const images = new Map<string, CanvasImageSource>();
  const sizes: LoadedInputs["images"] = {};
  const outlines: LoadedInputs["outlines"] = {};
  if (logoImg) images.set("logo", logoImg);
  if (productImg && productUrl) {
    images.set("product", productImg);
    sizes.product = { w: productImg.naturalWidth, h: productImg.naturalHeight };
    outlines.product = outlineOf(productUrl, productImg);
  }
  return { sources: { images }, logo, images: sizes, outlines };
}
