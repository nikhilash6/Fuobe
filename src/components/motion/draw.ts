"use client";

import { IDENTITY, multiply, type ClipShape, type DisplayList, type DisplayNode, type Gradient, type Matrix, type Paint, type Stroke } from "@/lib/motion/display";
import { cssFilter, GRAIN_GAIN, GRAIN_TILE, grainOffset, grainScale, grainTile, gradePixels, type Finish } from "@/lib/motion/finish";
import type { LogoInfo, LogoPath } from "@/lib/motion/scene";

/**
 * The only code that turns a Kinetic Motion display list into canvas calls: the live preview, the export and the covers
 * all draw through drawDisplayList, so they are the same picture at different pixel counts. Also reads an SVG logo's
 * outlines (with the browser's own SVG engine) for the scenes that trace them.
 */

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface Sources {
  /** Pictures by key ("logo", "product"). */
  images: Map<string, CanvasImageSource>;
  /** The person's clips by key ("clip"): a muted video element each, at the frame the caller put it on. */
  clips?: Map<string, CanvasImageSource>;
}

const paths = new Map<string, Path2D>();
const lengths = new Map<string, number>();

function path2d(d: string): Path2D {
  let p = paths.get(d);
  if (!p) {
    p = new Path2D(d);
    if (paths.size > 2000) paths.clear();
    paths.set(d, p);
  }
  return p;
}

/** A path's length in its own units, measured once by an SVG path element. */
function pathLength(d: string): number {
  let n = lengths.get(d);
  if (n === undefined) {
    n = 0;
    if (typeof document !== "undefined") {
      try {
        const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
        el.setAttribute("d", d);
        n = el.getTotalLength();
      } catch {}
    }
    lengths.set(d, n);
  }
  return n;
}

/**
 * Whether a canvas of this kind really draws through a CSS filter, tested on pixels once per kind: where canvas filters
 * are missing (Safari before 18), assigning `ctx.filter` only makes a plain property that reads back the same text, so a
 * read-back test would say yes. A red pixel drawn with saturate(0) must come out grey.
 */
const filterWorks = new Map<string, boolean>();
function canvasFilters(ctx: Ctx): boolean {
  const html = typeof HTMLCanvasElement !== "undefined" && ctx.canvas instanceof HTMLCanvasElement;
  const kind = html ? "html" : "offscreen";
  let ok = filterWorks.get(kind);
  if (ok === undefined) {
    ok = false;
    try {
      const make = (): AnyCanvas => (html ? Object.assign(document.createElement("canvas"), { width: 1, height: 1 }) : new OffscreenCanvas(1, 1));
      const src = make();
      const s = src.getContext("2d") as Ctx;
      s.fillStyle = "rgb(200,40,40)";
      s.fillRect(0, 0, 1, 1);
      const dst = make();
      const d = dst.getContext("2d", { willReadFrequently: true }) as Ctx;
      if ("filter" in Object.getPrototypeOf(d)) {
        d.filter = "saturate(0)";
        d.drawImage(src, 0, 0);
        const [r, g, b] = d.getImageData(0, 0, 1, 1).data;
        ok = Math.abs(r - g) < 12 && Math.abs(g - b) < 12;
      }
    } catch {
      ok = false;
    }
    filterWorks.set(kind, ok);
  }
  return ok;
}

/** Whether this browser's canvas takes a CSS filter (blur); where it can't, scenes keep their scale moves only. */
const canFilter = (ctx: Ctx): boolean => canvasFilters(ctx);

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  return Object.assign(document.createElement("canvas"), { width: w, height: h });
}

/** Scratch layers per target canvas (one per nesting depth), reused frame to frame. */
const layers = new WeakMap<object, AnyCanvas[]>();
function layerFor(target: AnyCanvas, depth: number): { canvas: AnyCanvas; ctx: Ctx } {
  let list = layers.get(target);
  if (!list) layers.set(target, (list = []));
  let c = list[depth];
  if (!c || c.width !== target.width || c.height !== target.height) c = list[depth] = makeCanvas(target.width, target.height);
  return { canvas: c, ctx: c.getContext("2d") as Ctx };
}

function paintOf(ctx: Ctx, p: Paint): string | CanvasGradient {
  if (typeof p === "string") return p;
  const g: Gradient = p;
  const grad = g.kind === "linear" ? ctx.createLinearGradient(g.x0, g.y0, g.x1, g.y1) : ctx.createRadialGradient(g.cx, g.cy, g.r0, g.cx, g.cy, Math.max(0.001, g.r1));
  for (const s of g.stops) grad.addColorStop(Math.min(1, Math.max(0, s.at)), s.color);
  return grad;
}

function roundRect(ctx: Ctx | Path2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2);
  ctx.lineTo(x + rr, y + h);
  ctx.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + rr);
  ctx.arc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

function clipTo(ctx: Ctx, c: ClipShape) {
  if (c.type === "path") return void ctx.clip(new Path2D(c.d));
  ctx.beginPath();
  if (c.type === "rect") {
    if (c.r) roundRect(ctx, c.x, c.y, c.w, c.h, c.r);
    else ctx.rect(c.x, c.y, c.w, c.h);
  } else ctx.ellipse(c.cx, c.cy, Math.max(0, c.rx), Math.max(0, c.ry), 0, 0, Math.PI * 2);
  ctx.clip();
}

const setMatrix = (ctx: Ctx, m: Matrix) => ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);

function stroke(ctx: Ctx, s: Stroke, length: number, draw: () => void) {
  const trim = s.trim ?? 1;
  if (trim <= 0) return;
  ctx.strokeStyle = paintOf(ctx, s.paint);
  ctx.lineWidth = s.width;
  ctx.lineCap = s.cap ?? "butt";
  ctx.lineJoin = s.join ?? "miter";
  if (trim < 1 && length > 0) {
    ctx.setLineDash([length * trim, length + s.width * 4]);
    ctx.lineDashOffset = 0;
  } else ctx.setLineDash([]);
  draw();
  ctx.setLineDash([]);
}

/** The device-pixel box of a design-unit box under a matrix (clamped to the canvas). */
function deviceBox(m: Matrix, b: { x: number; y: number; w: number; h: number }, W: number, H: number) {
  const pts = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h],
  ].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0]))));
  const y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1]))));
  const x1 = Math.min(W, Math.ceil(Math.max(...pts.map((p) => p[0]))));
  const y1 = Math.min(H, Math.ceil(Math.max(...pts.map((p) => p[1]))));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

function drawNode(ctx: Ctx, n: DisplayNode, m: Matrix, alpha: number, src: Sources, depth: number) {
  if (alpha <= 0.001) return;
  switch (n.type) {
    case "group": {
      const gm = n.transform ? multiply(m, n.transform) : m;
      const a = alpha * (n.opacity ?? 1);
      if (a <= 0.001) return;
      const bounds = n.isolate ?? n.mask?.bounds;
      if (bounds) {
        const target = ctx.canvas as AnyCanvas;
        const box = deviceBox(gm, bounds, target.width, target.height);
        if (!box.w || !box.h) return;
        const layer = layerFor(target, depth);
        const l = layer.ctx;
        l.save();
        l.setTransform(1, 0, 0, 1, 0, 0);
        l.globalAlpha = 1;
        l.globalCompositeOperation = "source-over";
        l.clearRect(box.x, box.y, box.w, box.h);
        l.beginPath();
        l.rect(box.x, box.y, box.w, box.h);
        l.clip();
        if (n.clip) {
          setMatrix(l, gm);
          clipTo(l, n.clip);
        }
        if (n.blur && canFilter(l)) l.filter = `blur(${n.blur * Math.sqrt(Math.abs(gm[0] * gm[3] - gm[1] * gm[2]))}px)`;
        for (const c of n.children) drawNode(l, c, gm, 1, src, depth + 1);
        l.filter = "none";
        if (n.mask) {
          setMatrix(l, gm);
          l.globalCompositeOperation = "destination-in";
          l.fillStyle = paintOf(l, n.mask);
          l.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
        }
        l.restore();
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = a;
        ctx.globalCompositeOperation = n.blend ?? "source-over";
        ctx.drawImage(layer.canvas, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h);
        ctx.restore();
        return;
      }
      ctx.save();
      if (n.clip) {
        setMatrix(ctx, gm);
        clipTo(ctx, n.clip);
      }
      if (n.blend) ctx.globalCompositeOperation = n.blend;
      if (n.blur && canFilter(ctx)) ctx.filter = `blur(${n.blur * Math.sqrt(Math.abs(gm[0] * gm[3] - gm[1] * gm[2]))}px)`;
      for (const c of n.children) drawNode(ctx, c, gm, a, src, depth);
      ctx.restore();
      return;
    }
    case "rect": {
      setMatrix(ctx, m);
      ctx.globalAlpha = alpha * (n.opacity ?? 1);
      if (n.fill) {
        ctx.fillStyle = paintOf(ctx, n.fill);
        if (n.r) {
          ctx.beginPath();
          roundRect(ctx, n.x, n.y, n.w, n.h, n.r);
          ctx.fill();
        } else ctx.fillRect(n.x, n.y, n.w, n.h);
      }
      if (n.stroke) {
        const s = n.stroke;
        const r = Math.min(n.r ?? 0, n.w / 2, n.h / 2);
        stroke(ctx, s, s.length ?? 2 * (n.w + n.h) - 8 * r + 2 * Math.PI * r, () => {
          ctx.beginPath();
          roundRect(ctx, n.x, n.y, n.w, n.h, r);
          ctx.stroke();
        });
      }
      return;
    }
    case "ellipse": {
      setMatrix(ctx, m);
      ctx.globalAlpha = alpha * (n.opacity ?? 1);
      ctx.beginPath();
      ctx.ellipse(n.cx, n.cy, Math.max(0, n.rx), Math.max(0, n.ry), 0, 0, Math.PI * 2);
      if (n.fill) {
        ctx.fillStyle = paintOf(ctx, n.fill);
        ctx.fill();
      }
      if (n.stroke) {
        const h = ((n.rx - n.ry) / (n.rx + n.ry)) ** 2;
        const len = Math.PI * (n.rx + n.ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
        stroke(ctx, n.stroke, n.stroke.length ?? len, () => ctx.stroke());
      }
      return;
    }
    case "path": {
      setMatrix(ctx, n.transform ? multiply(m, n.transform) : m);
      ctx.globalAlpha = alpha * (n.opacity ?? 1);
      const p = path2d(n.d);
      if (n.fill) {
        ctx.fillStyle = paintOf(ctx, n.fill);
        ctx.fill(p);
      }
      if (n.stroke) stroke(ctx, n.stroke, n.stroke.length ?? pathLength(n.d), () => ctx.stroke(p));
      return;
    }
    case "text": {
      const a = alpha * (n.opacity ?? 1);
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      for (const r of n.runs) {
        const ra = a * (r.opacity ?? 1);
        if (ra <= 0.001) continue;
        setMatrix(ctx, r.transform ? multiply(m, r.transform) : m);
        ctx.globalAlpha = ra;
        ctx.font = r.font;
        ctx.direction = r.dir ?? "ltr";
        ctx.fillStyle = paintOf(ctx, r.fill);
        ctx.fillText(r.text, r.x, r.y);
      }
      ctx.direction = "ltr";
      return;
    }
    case "video": {
      const v = src.clips?.get(n.src);
      if (!v) return;
      setMatrix(ctx, m);
      ctx.globalAlpha = alpha * (n.opacity ?? 1);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      try {
        ctx.drawImage(v, n.x, n.y, n.w, n.h);
      } catch {
        // A clip with no picture yet draws nothing (the ground shows).
      }
      return;
    }
    case "image": {
      const img = src.images.get(n.src);
      if (!img) return;
      setMatrix(ctx, m);
      ctx.globalAlpha = alpha * (n.opacity ?? 1);
      ctx.imageSmoothingEnabled = n.smoothing ?? true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, n.x, n.y, n.w, n.h);
      return;
    }
  }
}

/**
 * Draw a display list onto a canvas `pixelWidth / list.w` times its design size (the canvas is that size). Clears to
 * the list's background first, so every frame stands alone.
 */
export function drawDisplayList(ctx: Ctx, list: DisplayList, sources: Sources, o: { finish?: boolean; grain?: boolean } = {}): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const k = W / list.w;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.fillStyle = list.background;
  ctx.fillRect(0, 0, W, H);
  const base: Matrix = multiply([k, 0, 0, H / list.h, 0, 0], IDENTITY);
  for (const n of list.nodes) drawNode(ctx, n, base, 1, sources, 0);
  ctx.restore();
  if (list.finish && o.finish !== false) applyFinish(ctx, list.finish, { grain: o.grain });
}

// ---------------------------------------------------------------------------
// The finish (Kinetic's grade and grain), once per output frame

/** Whether this canvas draws contrast/saturate through a CSS filter (a pixel test per kind of canvas, done once). */
export function canGradeWithFilter(ctx: Ctx): boolean {
  return canvasFilters(ctx);
}

const grainCanvases = new Map<number, AnyCanvas>();
function grainCanvas(seed: number): AnyCanvas {
  let c = grainCanvases.get(seed);
  if (!c) {
    c = makeCanvas(GRAIN_TILE, GRAIN_TILE);
    const g = c.getContext("2d") as Ctx;
    const img = g.createImageData(GRAIN_TILE, GRAIN_TILE);
    const tile = grainTile(seed);
    for (let i = 0; i < tile.length; i++) {
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = tile[i];
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    if (grainCanvases.size > 4) grainCanvases.clear();
    grainCanvases.set(seed, c);
  }
  return c;
}

/**
 * The finish over what is on the canvas: contrast and saturation (a canvas filter where the browser has one, else the
 * same maths per pixel), then the seeded grain laid with "overlay", sized to the canvas and offset per frame.
 * `pixels` forces the pixel pass (tests compare the two).
 */
export function applyFinish(ctx: Ctx, f: Finish, o: { grain?: boolean; pixels?: boolean } = {}): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  if (f.contrast !== 0 || f.saturation !== 0) {
    if (!o.pixels && canGradeWithFilter(ctx)) {
      const layer = layerFor(ctx.canvas as AnyCanvas, 7);
      layer.ctx.save();
      layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
      layer.ctx.globalCompositeOperation = "copy";
      layer.ctx.filter = "none";
      layer.ctx.drawImage(ctx.canvas, 0, 0);
      layer.ctx.restore();
      ctx.globalCompositeOperation = "copy";
      ctx.filter = cssFilter(f);
      ctx.drawImage(layer.canvas, 0, 0);
      ctx.filter = "none";
    } else {
      const img = ctx.getImageData(0, 0, W, H);
      gradePixels(img.data, f);
      ctx.putImageData(img, 0, 0);
    }
  }
  if (f.grain > 0 && o.grain !== false) {
    const pat = ctx.createPattern(grainCanvas(f.seed), "repeat");
    if (pat) {
      const s = grainScale(f, Math.min(W, H));
      const [ox, oy] = grainOffset(f.seed, f.frame);
      pat.setTransform(new DOMMatrix([s, 0, 0, s, -ox * s, -oy * s]));
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = Math.min(1, f.grain * GRAIN_GAIN);
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Logos

const GEOMETRY = "path, rect, circle, ellipse, line, polyline, polygon";
const SKIP = "defs, clipPath, mask, pattern, symbol, marker, title, desc, metadata";

/** The SVG's own outlines, mapped to its viewBox: null when there is none to trace (an embedded picture only). */
async function svgOutlines(url: string): Promise<{ paths: LogoPath[]; viewBox: { x: number; y: number; w: number; h: number } } | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const text = await res.text();
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) return null;
  const vbAttr = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const w = parseFloat(svg.getAttribute("width") ?? "") || vbAttr?.[2] || 0;
  const h = parseFloat(svg.getAttribute("height") ?? "") || vbAttr?.[3] || 0;
  const viewBox = vbAttr && vbAttr.length === 4 && vbAttr.every(Number.isFinite) ? { x: vbAttr[0], y: vbAttr[1], w: vbAttr[2], h: vbAttr[3] } : { x: 0, y: 0, w, h };
  if (!(viewBox.w > 0 && viewBox.h > 0)) return null;
  // Measured live (hidden), at 1 unit a pixel, so the browser resolves every transform and length itself.
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none";
  const live = document.importNode(svg, true) as unknown as SVGSVGElement;
  live.setAttribute("width", String(viewBox.w));
  live.setAttribute("height", String(viewBox.h));
  live.setAttribute("preserveAspectRatio", "none");
  live.querySelectorAll("script, foreignObject").forEach((e) => e.remove());
  host.appendChild(live);
  document.body.appendChild(host);
  try {
    const root = live.getScreenCTM();
    if (!root) return null;
    const inv = root.inverse();
    const out: LogoPath[] = [];
    for (const el of live.querySelectorAll<SVGGeometryElement>(GEOMETRY)) {
      if (el.closest(SKIP)) continue;
      const d = pathData(el);
      if (!d) continue;
      const screen = el.getScreenCTM();
      if (!screen) continue;
      const rel = inv.multiply(screen);
      let length = 0;
      try {
        length = el.getTotalLength();
      } catch {}
      if (!(length > 0)) continue;
      out.push({ d, m: [rel.a, rel.b, rel.c, rel.d, rel.e + viewBox.x, rel.f + viewBox.y], length });
      if (out.length > 120) return null;
    }
    return out.length ? { paths: out, viewBox } : null;
  } finally {
    host.remove();
  }
}

/** A geometry element as path data. */
function pathData(el: Element): string | null {
  const n = (a: string) => parseFloat(el.getAttribute(a) ?? "0") || 0;
  switch (el.nodeName.toLowerCase()) {
    case "path":
      return el.getAttribute("d");
    case "rect": {
      const [x, y, w, h] = [n("x"), n("y"), n("width"), n("height")];
      const r = Math.min(n("rx") || n("ry"), w / 2, h / 2);
      if (!(w > 0 && h > 0)) return null;
      return r > 0
        ? `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
        : `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
    }
    case "circle":
    case "ellipse": {
      const cx = n("cx");
      const cy = n("cy");
      const rx = el.nodeName.toLowerCase() === "circle" ? n("r") : n("rx");
      const ry = el.nodeName.toLowerCase() === "circle" ? n("r") : n("ry");
      if (!(rx > 0 && ry > 0)) return null;
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    }
    case "line":
      return `M${n("x1")} ${n("y1")}L${n("x2")} ${n("y2")}`;
    case "polyline":
    case "polygon": {
      const pts = (el.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
      if (pts.length < 4) return null;
      let d = `M${pts[0]} ${pts[1]}`;
      for (let i = 2; i + 1 < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
      return el.nodeName.toLowerCase() === "polygon" ? `${d}Z` : d;
    }
  }
  return null;
}

const isSvgUrl = (url: string) => /\.svg($|\?)/i.test(url) || url.startsWith("data:image/svg");

const outlines = new Map<string, Promise<LogoInfo>>();

/** What a scene needs to know of a loaded logo: its size, and for an SVG with outlines, those outlines (read once). */
export function logoInfoFor(url: string, img: HTMLImageElement): Promise<LogoInfo> {
  let p = outlines.get(url);
  if (!p) {
    p = readLogo(url, img);
    outlines.set(url, p);
  }
  return p;
}

async function readLogo(url: string, img: HTMLImageElement): Promise<LogoInfo> {
  if (isSvgUrl(url)) {
    const lines = await svgOutlines(url).catch(() => null);
    const w = img.naturalWidth || lines?.viewBox.w || 400;
    const h = img.naturalHeight || lines?.viewBox.h || 120;
    if (lines) return { w, h, kind: "svg", paths: lines.paths, viewBox: lines.viewBox };
    return { w, h, kind: "raster" };
  }
  return { w: img.naturalWidth || 400, h: img.naturalHeight || 120, kind: "raster" };
}
