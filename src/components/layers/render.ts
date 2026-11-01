"use client";

/**
 * Drawing the layer document with a 2D canvas: the stage, the composite, the two zips and the
 * pictures handed to models all go through drawNode, so what you download is what you see.
 */

import {
  bboxFromAlpha,
  cropRect,
  exportScale,
  layerExportScale,
  nativeSize,
  seeThrough,
  slugify,
  sourceBoxOf,
  sourceRect,
  storedZip,
  zipPlan,
  type Box,
  type LayerDoc,
  type LayerNode,
} from "@/lib/layers";
import { responseError } from "@/lib/refusals";

// ---------------------------------------------------------------------------
// Images

const loading = new Map<string, Promise<HTMLImageElement>>();
const loaded = new Map<string, HTMLImageElement>();

export function loadImage(src: string): Promise<HTMLImageElement> {
  let p = loading.get(src);
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        loaded.set(src, img);
        resolve(img);
      };
      img.onerror = () => {
        loading.delete(src);
        reject(new Error("Couldn't load an image of this project"));
      };
      img.src = src;
    });
    loading.set(src, p);
  }
  return p;
}

/** The image if it's loaded; otherwise starts loading it and calls `onLoad` when it is. */
export function readyImage(src: string, onLoad?: () => void): HTMLImageElement | undefined {
  const img = loaded.get(src);
  if (img) return img;
  void loadImage(src).then(
    () => onLoad?.(),
    () => {},
  );
  return undefined;
}

/** Pixel size of an image (SVGs without a size read as 1024 wide). */
export function sizeOf(img: HTMLImageElement): [number, number] {
  const w = img.naturalWidth || img.width || 1024;
  const h = img.naturalHeight || img.height || Math.round(w);
  return [w, h];
}

/** A layer's source rectangle in the loaded image's own pixels (the stored crop may be in other units for SVGs). */
function srcRectFor(node: Pick<LayerNode, "crop" | "natural">, img: HTMLImageElement): Box {
  const [iw, ih] = sizeOf(img);
  const r = sourceRect(node);
  if (!r) return [0, 0, iw, ih];
  const [nw, nh] = node.natural ?? [iw, ih];
  const kx = iw / nw;
  const ky = ih / nh;
  return [r[0] * kx, r[1] * ky, r[2] * kx, r[3] * ky];
}

// ---------------------------------------------------------------------------
// Drawing

export interface Sources {
  /** Mask canvases being painted (by node id): drawn instead of the saved mask. */
  masks?: Map<string, HTMLCanvasElement>;
  /** Changes bumped while painting, so cached layers redraw. */
  maskVersion?: number;
  /** Live previews (colour grading) by node id: drawn instead of the layer's image. */
  previews?: Map<string, HTMLCanvasElement>;
}

/** Layers with a mask or a soft edge are drawn through a small cache of offscreen canvases. */
const softCache = new Map<string, HTMLCanvasElement>();

function featherInto(ctx: CanvasRenderingContext2D, w: number, h: number, f: number) {
  if (f <= 0) return;
  ctx.globalCompositeOperation = "destination-in";
  const fx = Math.min(0.5, f / w);
  const fy = Math.min(0.5, f / h);
  const gx = ctx.createLinearGradient(0, 0, w, 0);
  gx.addColorStop(0, "rgba(0,0,0,0)");
  gx.addColorStop(fx, "rgba(0,0,0,1)");
  gx.addColorStop(1 - fx, "rgba(0,0,0,1)");
  gx.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gx;
  ctx.fillRect(0, 0, w, h);
  const gy = ctx.createLinearGradient(0, 0, 0, h);
  gy.addColorStop(0, "rgba(0,0,0,0)");
  gy.addColorStop(fy, "rgba(0,0,0,1)");
  gy.addColorStop(1 - fy, "rgba(0,0,0,1)");
  gy.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gy;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
}

/**
 * One layer alone, unrotated, at `w × h` pixels: its pixels (crop), its mask and soft edge applied.
 * Returns null while an image it needs is still loading.
 */
export function layerCanvas(node: LayerNode, w: number, h: number, src: Sources = {}, onLoad?: () => void, cache = true): HTMLCanvasElement | null {
  const preview = src.previews?.get(node.id);
  const img = preview ?? readyImage(node.src, onLoad);
  if (!img) return null;
  const maskOverride = src.masks?.get(node.id);
  const mask = maskOverride ?? (node.maskSrc ? readyImage(node.maskSrc, onLoad) : undefined);
  if (node.maskSrc && !maskOverride && !mask) return null;
  // Large copies (exports) aren't kept: the cache holds stage-sized ones.
  const key = cache && !preview && w * h <= 2048 * 2048 ? `${node.src}|${node.crop?.join(",")}|${node.maskSrc}|${maskOverride ? src.maskVersion : ""}|${node.feather ?? 0}|${w}x${h}` : "";
  const hit = key ? softCache.get(key) : undefined;
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext("2d")!;
  if (preview) ctx.drawImage(preview, 0, 0, c.width, c.height);
  else {
    const [sx, sy, sw, sh] = srcRectFor(node, img as HTMLImageElement);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  }
  if (mask) {
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(mask, 0, 0, c.width, c.height);
    ctx.globalCompositeOperation = "source-over";
  }
  featherInto(ctx, c.width, c.height, ((node.feather ?? 0) * c.width) / node.w);
  if (key) {
    softCache.set(key, c);
    if (softCache.size > 60) softCache.delete(softCache.keys().next().value!);
  }
  return c;
}

/**
 * Draw a layer in document coordinates (the context's transform maps document px to the target).
 * `pxPerDoc` is how many target pixels one document pixel covers (sizes the offscreen copy of a
 * masked or feathered layer, at most `softMax` px). Returns false while an image is still loading.
 */
export function drawNode(ctx: CanvasRenderingContext2D, node: LayerNode, pxPerDoc: number, src: Sources = {}, onLoad?: () => void, softMax = 2048): boolean {
  const soft = !!(node.maskSrc || node.feather || src.masks?.has(node.id) || src.previews?.has(node.id));
  ctx.save();
  ctx.globalAlpha = node.opacity ?? 1;
  ctx.translate(node.x + node.w / 2, node.y + node.h / 2);
  if (node.rotation) ctx.rotate((node.rotation * Math.PI) / 180);
  let ok = true;
  if (soft) {
    // Offscreen at the size it's shown, capped (a 4K layer on a small stage doesn't need 4K pixels).
    const k = Math.min(1, softMax / Math.max(node.w * pxPerDoc, node.h * pxPerDoc));
    const c = layerCanvas(node, Math.ceil(node.w * pxPerDoc * k), Math.ceil(node.h * pxPerDoc * k), src, onLoad);
    if (c) ctx.drawImage(c, -node.w / 2, -node.h / 2, node.w, node.h);
    else ok = false;
  } else {
    const img = readyImage(node.src, onLoad);
    if (img) {
      const [sx, sy, sw, sh] = srcRectFor(node, img);
      ctx.drawImage(img, sx, sy, sw, sh, -node.w / 2, -node.h / 2, node.w, node.h);
    } else ok = false;
  }
  ctx.restore();
  return ok;
}

/** Wait until every image the layers need is loaded (for exports and renders handed to models). */
export async function preload(nodes: LayerNode[]): Promise<void> {
  await Promise.all(nodes.flatMap((n) => [loadImage(n.src), ...(n.maskSrc ? [loadImage(n.maskSrc)] : [])]));
}

/**
 * Render part of the document (`rect`, doc px; default the whole canvas) at `scale`, with every
 * visible layer, or only the layer `only` (hidden or not). `fill` paints a background first.
 */
export async function renderDoc(doc: LayerDoc, opts: { rect?: Box; scale?: number; only?: string; fill?: string; src?: Sources } = {}): Promise<HTMLCanvasElement> {
  const rect = opts.rect ?? [0, 0, doc.width, doc.height];
  const scale = opts.scale ?? 1;
  const nodes = [...doc.nodes].sort((a, b) => a.z - b.z).filter((n) => (opts.only ? n.id === opts.only : !n.hidden));
  await preload(nodes);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(rect[2] * scale));
  c.height = Math.max(1, Math.round(rect[3] * scale));
  const ctx = c.getContext("2d")!;
  if (opts.fill) {
    ctx.fillStyle = opts.fill;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.scale(scale, scale);
  ctx.translate(-rect[0], -rect[1]);
  ctx.imageSmoothingQuality = "high";
  // Masked layers keep their detail in large exports (the stage caps them at 2048 px).
  for (const n of nodes) drawNode(ctx, n, scale, opts.src, undefined, 8192);
  return c;
}

/**
 * The image the project was opened on, where it sits in the document now (Expand & Crop moves it),
 * on a transparent canvas the document's size: Compare's “before”, lined up with the “after”.
 */
export async function renderSource(doc: LayerDoc, scale = 1): Promise<HTMLCanvasElement> {
  const img = await loadImage(doc.source);
  const [x, y, w, h] = sourceBoxOf(doc);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(doc.width * scale));
  c.height = Math.max(1, Math.round(doc.height * scale));
  const ctx = c.getContext("2d")!;
  // Canvas the original didn't have (an expanded margin) reads as empty: a checkerboard.
  const cell = 12;
  ctx.fillStyle = "#e7e7e7";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#f7f7f7";
  for (let cy = 0; cy < c.height; cy += cell) for (let cx = (cy / cell) % 2 ? cell : 0; cx < c.width; cx += cell * 2) ctx.fillRect(cx, cy, cell, cell);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, x * scale, y * scale, w * scale, h * scale);
  return c;
}

/** One layer alone at its own resolution, unrotated (what tools hand to a model). */
export async function renderNative(node: LayerNode, max = 2048): Promise<HTMLCanvasElement> {
  await preload([node]);
  const [w, h] = nativeSize(node, max);
  return layerCanvas(node, w, h, {}, undefined, false)!;
}

export function toBlob(c: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't render the image"))), type, quality));
}

/**
 * Store a render as a PNG and return its /api/files URL. Saved as a derived file: it stays out of
 * the Library's Uploads (the project that uses it keeps it).
 */
export async function uploadRender(c: HTMLCanvasElement, name: string): Promise<string> {
  return uploadDerived(await toBlob(c), name);
}

/** Store a PNG the editor made (a render, a mask) as a derived file. */
export async function uploadDerived(blob: Blob, name: string): Promise<string> {
  const form = new FormData();
  form.append("file", new File([blob], `${slugify(name) || "layer"}.png`, { type: "image/png" }));
  const res = await fetch("/api/layers/renders", { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw responseError(res, body.error ?? "Couldn't save the picture for the model. Please try again.");
  return body.url;
}

/**
 * Whether a layer's own pixels (its crop of the image, before its mask and soft edge, which a new
 * version keeps anyway) are see-through: a cut-out or a decomposition's layer, not a full-frame
 * picture. Measured on a copy at most 256 px wide.
 */
export async function hasSeeThrough(node: Pick<LayerNode, "src" | "crop" | "natural">): Promise<boolean> {
  const img = await loadImage(node.src);
  const [sx, sy, sw, sh] = srcRectFor(node, img);
  const k = Math.min(1, 256 / Math.max(sw, sh, 1));
  const w = Math.max(1, Math.round(sw * k));
  const h = Math.max(1, Math.round(sh * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  return seeThrough(ctx.getImageData(0, 0, w, h).data);
}

/** The alpha box of an image in its own pixels (measured on a copy at most 1024 px wide). */
export function alphaBox(img: HTMLImageElement): Box | null {
  const [nw, nh] = sizeOf(img);
  const k = Math.min(1, 1024 / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * k));
  const h = Math.max(1, Math.round(nh * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const b = bboxFromAlpha(ctx.getImageData(0, 0, w, h).data, w, h, 8);
  if (!b) return null;
  const x0 = Math.max(0, Math.floor(b[0] / k));
  const y0 = Math.max(0, Math.floor(b[1] / k));
  const x1 = Math.min(nw, Math.ceil((b[0] + b[2]) / k));
  const y1 = Math.min(nh, Math.ceil((b[1] + b[3]) / k));
  return [x0, y0, x1 - x0, y1 - y0];
}

// ---------------------------------------------------------------------------
// Hit testing by alpha (clicking a subject selects it, not the transparent canvas above it)

const alphaMaps = new Map<string, { data: Uint8ClampedArray; w: number; h: number }>();

/** Whether a layer is opaque at its local point (u, v in 0–1). Unknown (still loading) counts as opaque. */
export function opaqueAt(node: LayerNode, u: number, v: number): boolean {
  const img = loaded.get(node.src);
  if (!img) return true;
  let map = alphaMaps.get(node.src);
  if (!map) {
    const [nw, nh] = sizeOf(img);
    const k = Math.min(1, 256 / Math.max(nw, nh));
    const w = Math.max(1, Math.round(nw * k));
    const h = Math.max(1, Math.round(nh * k));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    try {
      map = { data: ctx.getImageData(0, 0, w, h).data, w, h };
    } catch {
      return true;
    }
    alphaMaps.set(node.src, map);
  }
  const [sx, sy, sw, sh] = srcRectFor(node, img);
  const [iw, ih] = sizeOf(img);
  const x = Math.min(map.w - 1, Math.max(0, Math.floor(((sx + u * sw) / iw) * map.w)));
  const y = Math.min(map.h - 1, Math.max(0, Math.floor(((sy + v * sh) / ih) * map.h)));
  return map.data[(y * map.w + x) * 4 + 3] > 16;
}

// ---------------------------------------------------------------------------
// Downloads (built in the browser, no server round trip)

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const bytes = async (c: HTMLCanvasElement) => new Uint8Array(await (await toBlob(c)).arrayBuffer());

/**
 * Export size: "full" keeps every layer's detail (an upscaled layer makes the export bigger, see
 * exportScale), "document" renders at the document's own pixels.
 */
export type ExportSize = "full" | "document";

const docScale = (doc: LayerDoc, size: ExportSize) => (size === "full" ? exportScale(doc) : 1);

/**
 * cropped-layers.zip (each layer alone, cut to its rotation-aware box, at its own detail) or
 * positioned-layers.zip (each layer alone on a transparent canvas the size of the export), both with
 * composite.png.
 */
export async function downloadZip(doc: LayerDoc, kind: "cropped" | "positioned", size: ExportSize = "full"): Promise<number> {
  if (!doc.nodes.length) throw new Error("No layers to download");
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const files: { name: string; data: Uint8Array }[] = [];
  const scale = docScale(doc, size);
  for (const { nodeId, file } of zipPlan(doc)) {
    const n = byId.get(nodeId)!;
    const rect = kind === "cropped" ? cropRect(n, doc) : ([0, 0, doc.width, doc.height] as Box);
    if (!rect) continue; // entirely off the canvas
    const s = kind === "cropped" && size === "full" ? layerExportScale(n, rect) : scale;
    files.push({ name: file, data: await bytes(await renderDoc(doc, { rect, only: n.id, scale: s })) });
  }
  files.push({ name: "composite.png", data: await bytes(await renderDoc(doc, { scale })) });
  save(new Blob([storedZip(files) as BlobPart], { type: "application/zip" }), kind === "cropped" ? "cropped-layers.zip" : "positioned-layers.zip");
  return files.length - 1;
}

export async function downloadPng(doc: LayerDoc, name: string, size: ExportSize = "full"): Promise<void> {
  save(await toBlob(await renderDoc(doc, { scale: docScale(doc, size) })), `${slugify(name) || "image"}.png`);
}

/** One layer as you see it (cropped to its box), at its own detail. */
export async function downloadLayer(doc: LayerDoc, node: LayerNode): Promise<void> {
  const rect = cropRect(node, doc);
  if (!rect) throw new Error("This layer is outside the canvas");
  save(await toBlob(await renderDoc(doc, { rect, only: node.id, scale: layerExportScale(node, rect) })), zipPlan(doc).find((e) => e.nodeId === node.id)?.file ?? "layer.png");
}

/** "16:9" for 1920×1080; a decimal ratio ("1.37:1") when the numbers don't reduce. */
export function ratioOf(w: number, h: number): string {
  const W = Math.round(w);
  const H = Math.round(h);
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(W, H) || 1;
  const a = W / g;
  const b = H / g;
  return a <= 64 && b <= 64 ? `${a}:${b}` : `${(W / H).toFixed(2)}:1`;
}
