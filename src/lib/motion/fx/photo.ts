/**
 * Photography and products (pure). A photo is never still: it pushes in slowly (1.00 → 1.04–1.08) or pans 2–4 % over
 * the clip. It can be graded into the palette (a duotone: the dark tone multiplied into the shadows, the light tone
 * screened into the highlights), shown inside the letters of one short heavy word, or set as a tilted card. A product
 * cut-out stands on a soft floor light with its contact shadow, and a light band crosses it once after it settles.
 */

import { group, type Box, type DisplayNode, type GroupNode, type ImageNode, type Matrix, type TextNode } from "../display";
import { CURVES, sine } from "../ease";
import { clamp } from "../time";
import { floorShadow, twoShadow } from "./depth";
import { pool, rgba } from "./background";
import { rotation } from "./overlays";

/** The part of a picture (shares 0–1) that fills a box without distortion, centred on `focus`, zoomed by `zoom`. */
export function coverCrop(img: { w: number; h: number }, box: { w: number; h: number }, focus: { x: number; y: number } = { x: 0.5, y: 0.45 }, zoom = 1): Box {
  const scale = Math.max(box.w / img.w, box.h / img.h) * Math.max(1, zoom);
  const sw = Math.min(1, box.w / scale / img.w);
  const sh = Math.min(1, box.h / scale / img.h);
  const x = clamp(focus.x - sw / 2, 0, 1 - sw);
  const y = clamp(focus.y - sh / 2, 0, 1 - sh);
  return { x, y, w: sw, h: sh };
}

/** A push-in's zoom and pan at `t` of `duration` (sine in-out, at rest on the last frame). */
export function pushIn(t: number, duration: number, o: { from?: number; to?: number; pan?: { x: number; y: number } } = {}): { zoom: number; pan: { x: number; y: number } } {
  const k = sine.inOut(clamp(duration > 0 ? t / duration : 1));
  const from = o.from ?? 1;
  const to = o.to ?? 1.06;
  return { zoom: from + (to - from) * k, pan: { x: (o.pan?.x ?? 0) * k, y: (o.pan?.y ?? 0) * k } };
}

export interface PhotoOptions {
  /** The source's key ("photo", "product"). */
  src: string;
  img: { w: number; h: number };
  box: Box;
  t: number;
  duration: number;
  /** Push-in range (default 1 → 1.06) and a pan in shares of the picture. */
  push?: { from?: number; to?: number; pan?: { x: number; y: number } };
  focus?: { x: number; y: number };
  /** Rounded corners. */
  radius?: number;
  /** Laid to the frame's edge (see ImageNode.bleed). */
  bleed?: boolean;
  /** A duotone grade into the palette: shadows toward `dark`, highlights toward `light`. */
  grade?: { dark: string; light: string; darkAlpha?: number; lightAlpha?: number };
}

/** A photo filling a box: cropped to cover, pushing in, optionally graded, clipped to the box. */
export function photo(o: PhotoOptions): GroupNode {
  const { zoom, pan } = pushIn(o.t, o.duration, o.push);
  const focus = o.focus ?? { x: 0.5, y: 0.45 };
  const crop = coverCrop(o.img, o.box, { x: focus.x + pan.x, y: focus.y + pan.y }, zoom);
  const image: ImageNode = { type: "image", src: o.src, x: o.box.x, y: o.box.y, w: o.box.w, h: o.box.h, crop, ...(o.bleed && { bleed: true }) };
  const children: DisplayNode[] = [image, ...(o.grade ? duotone(o.box, o.grade) : [])];
  return group(children, { id: `photo-${o.src}`, clip: { type: "rect", ...o.box, ...(o.radius && { r: o.radius }) }, ...(o.grade && { isolate: o.box }) });
}

/** A duotone grade over a box: the dark tone multiplied in, the light tone screened in. */
export function duotone(box: Box, g: { dark: string; light: string; darkAlpha?: number; lightAlpha?: number }): DisplayNode[] {
  return [
    group([{ type: "rect", ...box, fill: rgba(g.dark, g.darkAlpha ?? 0.55) }], { blend: "multiply" }),
    group([{ type: "rect", ...box, fill: rgba(g.light, g.lightAlpha ?? 0.3) }], { blend: "screen" }),
  ];
}

/** A photo seen through the letters of a word (one or two short, heavy words only); the photo pushes 1.08 → 1 inside them. */
export function photoInType(word: TextNode, o: Omit<PhotoOptions, "push"> & { bounds: Box }): GroupNode {
  const pic = photo({ ...o, push: { from: 1.08, to: 1 } });
  return group([pic, group([word], { blend: "destination-in" })], { id: "photo-in-type", isolate: o.bounds });
}

/** A tilted photo card: ±3–6°, a 6–10 unit white border, the two shadows under it. */
export function tiltedCard(o: PhotoOptions & { deg: number; border?: number; ground: string; key: string; paper?: string }): GroupNode {
  const b = o.border ?? 8;
  const frame = { x: o.box.x - b, y: o.box.y - b, w: o.box.w + 2 * b, h: o.box.h + 2 * b };
  const card: DisplayNode = { type: "rect", ...frame, r: 2, fill: o.paper ?? "#fbfaf7" };
  const rot: Matrix = rotation(o.deg, frame.x + frame.w / 2, frame.y + frame.h / 2);
  return group([...twoShadow({ nodes: [card], size: frame.h, ground: o.ground, bounds: frame, key: `card|${o.key}` }), card, photo(o)], { id: "card", transform: rot });
}

export interface ProductOptions {
  src: string;
  /** Where the cut-out is drawn (its fitted box). */
  box: Box;
  ground: string;
  t: number;
  /** When the sweep crosses (seconds; none when absent) and how long it takes (0.7–0.9 s). */
  sweepAt?: number;
  sweepDur?: number;
  /** A soft pool of floor light under it. */
  floorLight?: string;
  key: string;
  opacity?: number;
}

/** A product cut-out on its floor: light pool, contact shadow, the picture, and one light band across it after it lands. */
export function product(o: ProductOptions): GroupNode {
  const b = o.box;
  const foot = b.y + b.h;
  const nodes: DisplayNode[] = [];
  if (o.floorLight) nodes.push({ type: "ellipse", cx: b.x + b.w / 2, cy: foot, rx: b.w * 0.9, ry: b.w * 0.22, fill: pool(b.x + b.w / 2, foot, b.w * 0.9, o.floorLight, 0.35) });
  nodes.push(floorShadow({ cx: b.x + b.w / 2, y: foot - b.h * 0.005, width: b.w, ground: o.ground, key: o.key }));
  const image: ImageNode = { type: "image", src: o.src, x: b.x, y: b.y, w: b.w, h: b.h };
  const d = o.sweepDur ?? 0.8;
  const p = o.sweepAt === undefined ? -1 : (o.t - o.sweepAt) / d;
  if (p > 0 && p < 1) {
    const k = CURVES.move(p);
    const band = b.w * 0.35;
    const x = b.x - band + k * (b.w + 2 * band);
    const sweep: DisplayNode = { type: "rect", x: x - band / 2, y: b.y, w: band, h: b.h, fill: { kind: "linear", x0: x - band / 2, y0: 0, x1: x + band / 2, y1: 0, stops: [{ at: 0, color: "rgba(255,255,255,0)" }, { at: 0.5, color: "rgba(255,255,255,0.45)" }, { at: 1, color: "rgba(255,255,255,0)" }] } };
    const tilt: Matrix = [1, 0, Math.tan((20 * Math.PI) / 180), 1, -Math.tan((20 * Math.PI) / 180) * (b.y + b.h / 2), 0];
    nodes.push(group([image, group([sweep], { blend: "source-atop", transform: tilt })], { isolate: b }));
  } else nodes.push(image);
  return group(nodes, { id: `product-${o.key}`, ...(o.opacity !== undefined && o.opacity < 1 && { opacity: o.opacity }) });
}
