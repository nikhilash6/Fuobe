"use client";

import type { AdRatio } from "@/lib/catalog/marketing";
import { planAd, sizeFor, type AdContent, type AdLayout, type AdPlan, type AdTheme, type TextBox } from "./layout";

/**
 * Draw an ad plan (layout.ts) on a canvas: the visual cropped to its box, scrims and panels, the
 * logo, the words in the brand's Google Fonts and the CTA pill. Used for grid previews (small),
 * the editor and PNG exports (full size), so they all match.
 */

const images = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(src: string): Promise<HTMLImageElement> {
  let p = images.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => {
        images.delete(src);
        reject(new Error("The picture didn't load"));
      };
      img.src = src;
    });
    images.set(src, p);
  }
  return p;
}

const fonts = new Map<string, Promise<void>>();
const SYSTEM = /^(inter|system-ui|arial|helvetica|georgia|times new roman|sans-serif|serif)$/i;

/** Load a Google Fonts family (400–800) once; resolves after at most `timeout` ms so offline installs fall back. */
export function ensureFont(family: string | undefined, timeout = 2500): Promise<void> {
  if (!family || typeof document === "undefined") return Promise.resolve();
  const key = family.trim();
  let p = fonts.get(key);
  if (!p) {
    p = new Promise<void>((resolve) => {
      const done = () => resolve();
      const timer = setTimeout(done, timeout);
      const finish = () =>
        Promise.all([400, 700, 800].map((w) => document.fonts.load(`${w} 32px "${key}"`)))
          .catch(() => undefined)
          .finally(() => {
            clearTimeout(timer);
            done();
          });
      if (SYSTEM.test(key) && key.toLowerCase() !== "inter") return finish();
      const id = `gf-${key.replace(/\W+/g, "-").toLowerCase()}`;
      if (!document.getElementById(id)) {
        const link = document.createElement("link");
        link.id = id;
        link.rel = "stylesheet";
        link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(key).replace(/%20/g, "+")}:wght@400;500;600;700;800&display=swap`;
        link.onload = () => void finish();
        link.onerror = done;
        document.head.appendChild(link);
      } else void finish();
    });
    fonts.set(key, p);
  }
  return p;
}

let measureCtx: CanvasRenderingContext2D | null = null;
const oldstyleFaces = new Map<string, boolean>();

/**
 * Whether a face draws old-style figures by default: its "0" sits at x-height and its "8" rises above it (Cormorant,
 * EB Garamond). Lining figures stand about as tall as each other.
 */
function oldstyle(family: string, weight: number): boolean {
  const key = `${weight} ${family}`;
  const known = oldstyleFaces.get(key);
  if (known !== undefined) return known;
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return false;
  measureCtx.font = `${weight} 100px "${family}"`;
  const tall = (s: string) => {
    const m = measureCtx!.measureText(s);
    return m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  };
  const zero = tall("0");
  const eight = tall("8");
  const out = eight > 0 && zero < eight * 0.86;
  // Cache only once the face itself is in (a fallback face measured before it loads says nothing about it).
  if (document.fonts?.check?.(`${weight} 100px "${family}"`)) oldstyleFaces.set(key, out);
  return out;
}

/** A text's width in a CSS font; `measureText.oldstyle` tells whether a face's default figures are old-style. */
export const measureText = Object.assign(
  (text: string, font: string) => {
    measureCtx ??= document.createElement("canvas").getContext("2d");
    if (!measureCtx) return text.length * 10;
    measureCtx.font = font;
    return measureCtx.measureText(text).width;
  },
  { oldstyle },
);

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawText(ctx: CanvasRenderingContext2D, t: TextBox) {
  ctx.font = t.font;
  ctx.fillStyle = t.color;
  ctx.textBaseline = "top";
  ctx.textAlign = t.align === "center" ? "center" : "left";
  t.lines.forEach((line, i) => ctx.fillText(line, t.x, t.y + i * t.lineHeight + (t.lineHeight - t.size) / 2));
}

export function drawPlan(ctx: CanvasRenderingContext2D, plan: AdPlan, image: CanvasImageSource | null, logo: CanvasImageSource | null) {
  ctx.save();
  ctx.fillStyle = plan.bg;
  ctx.fillRect(0, 0, plan.w, plan.h);
  if (plan.image && image) {
    ctx.save();
    if (plan.image.radius) {
      rounded(ctx, plan.image.x, plan.image.y, plan.image.w, plan.image.h, plan.image.radius);
      ctx.clip();
    }
    ctx.drawImage(image, plan.image.sx, plan.image.sy, plan.image.sw, plan.image.sh, plan.image.x, plan.image.y, plan.image.w, plan.image.h);
    ctx.restore();
  } else if (plan.image) {
    // No visual yet: a soft placeholder in the picture's box.
    ctx.fillStyle = "rgba(127,127,127,0.18)";
    rounded(ctx, plan.image.x, plan.image.y, plan.image.w, plan.image.h, plan.image.radius);
    ctx.fill();
  }
  if (plan.panel) {
    ctx.fillStyle = plan.panel.color;
    ctx.fillRect(plan.panel.x, plan.panel.y, plan.panel.w, plan.panel.h);
  }
  if (plan.scrim) {
    const g = ctx.createLinearGradient(0, plan.scrim.y, 0, plan.scrim.y + plan.scrim.h);
    g.addColorStop(0, plan.scrim.from);
    g.addColorStop(1, plan.scrim.to);
    ctx.fillStyle = g;
    ctx.fillRect(plan.scrim.x, plan.scrim.y, plan.scrim.w, plan.scrim.h);
  }
  if (plan.logo && logo) ctx.drawImage(logo, plan.logo.x, plan.logo.y, plan.logo.w, plan.logo.h);
  if (plan.brand) drawText(ctx, plan.brand);
  drawText(ctx, plan.headline);
  if (plan.body) drawText(ctx, plan.body);
  if (plan.cta) {
    ctx.fillStyle = plan.cta.color;
    rounded(ctx, plan.cta.x, plan.cta.y, plan.cta.w, plan.cta.h, plan.cta.radius);
    ctx.fill();
    drawText(ctx, plan.cta.text);
  }
  ctx.restore();
}

/** Fit a w×h picture inside a W×H frame without cropping, centred (a ±1 px difference fills the frame). */
export function containRect(w: number, h: number, W: number, H: number): { x: number; y: number; w: number; h: number } {
  const k = Math.min(W / w, H / h);
  let dw = w * k;
  let dh = h * k;
  if (Math.abs(dw - W) <= 1) dw = W;
  if (Math.abs(dh - H) <= 1) dh = H;
  return { x: (W - dw) / 2, y: (H - dh) / 2, w: dw, h: dh };
}

export interface RenderInput {
  ratio: AdRatio | string;
  layout: AdLayout;
  content: AdContent;
  theme: AdTheme;
  image?: string | null;
  logo?: string | null;
  /** The visual already holds the words (a baked ad, drawn whole before build plan O7): draw it alone. */
  baked?: boolean;
}

/** Render a creative onto `canvas` at `scale` (1 = full 1080-wide size). */
export async function renderAd(canvas: HTMLCanvasElement, input: RenderInput, scale = 1): Promise<void> {
  const [img, logo] = await Promise.all([input.image ? loadImage(input.image).catch(() => null) : null, input.logo ? loadImage(input.logo).catch(() => null) : null, ensureFont(input.theme.heading), ensureFont(input.theme.body)]);
  const { w, h } = sizeFor(input.ratio);
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  if (input.baked) {
    // The words are in the picture: show all of it (letterboxed in another format), never crop it.
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, w, h);
    if (img?.naturalWidth && img.naturalHeight) {
      const r = containRect(img.naturalWidth, img.naturalHeight, w, h);
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
    }
    return;
  }
  const plan = planAd({
    ratio: input.ratio,
    layout: input.layout,
    content: input.content,
    theme: input.theme,
    image: img ? { w: img.naturalWidth, h: img.naturalHeight } : { w: 4, h: 5 },
    logo: logo ? { w: logo.naturalWidth || 400, h: logo.naturalHeight || 120 } : null,
    measure: measureText,
  });
  drawPlan(ctx, plan, img, logo);
}

/** A full-size PNG of a creative. */
export async function exportPng(input: RenderInput): Promise<Blob> {
  const canvas = document.createElement("canvas");
  await renderAd(canvas, input, 1);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't export the image"))), "image/png"));
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
