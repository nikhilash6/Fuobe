/**
 * The display list (pure data): what a scene draws at one instant, with every number already resolved for that time.
 * Scenes build it; src/components/motion/draw.ts is the only code that turns it into canvas calls, for the preview, the
 * export and the covers alike. Coordinates are design units (1080 on the frame's short side); the drawer scales.
 */

import type { Finish } from "./finish";

/** A 2D affine matrix [a, b, c, d, e, f] (canvas setTransform order). */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

export const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];

/** Scale `s` (and rotate `rot` radians) about the point (cx, cy). */
export function about(cx: number, cy: number, s: number, rot = 0, sy = s): Matrix {
  const c = Math.cos(rot);
  const n = Math.sin(rot);
  const m: Matrix = [s * c, s * n, -sy * n, sy * c, 0, 0];
  m[4] = cx - (m[0] * cx + m[2] * cy);
  m[5] = cy - (m[1] * cx + m[3] * cy);
  return m;
}

export const isIdentity = (m?: Matrix) => !m || (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0);

export interface GradientStop {
  at: number;
  color: string;
}
export type Gradient =
  | { kind: "linear"; x0: number; y0: number; x1: number; y1: number; stops: GradientStop[] }
  | { kind: "radial"; cx: number; cy: number; r0: number; r1: number; stops: GradientStop[] };
export type Paint = string | Gradient;

export interface Stroke {
  paint: Paint;
  width: number;
  /** How much of the outline is drawn, from its start (0–1). */
  trim?: number;
  /** The outline's length, when the scene knows it (else the drawer measures the path). */
  length?: number;
  cap?: CanvasLineCap;
  join?: CanvasLineJoin;
}

export type Blend = "source-over" | "multiply" | "screen" | "overlay" | "lighter" | "source-atop" | "destination-in" | "destination-out" | "soft-light" | "hard-light" | "color-dodge";

/** A box in design units (or, for an image's crop, in shares 0–1 of the picture). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a group is clipped to: a (rounded) rectangle, an ellipse, or a closed path (path data in design units). */
export type ClipShape = { type: "rect"; x: number; y: number; w: number; h: number; r?: number } | { type: "ellipse"; cx: number; cy: number; rx: number; ry: number } | { type: "path"; d: string };

export interface GroupNode {
  type: "group";
  id?: string;
  transform?: Matrix;
  opacity?: number;
  blend?: Blend;
  clip?: ClipShape;
  /** A gaussian blur in design units on everything inside (skipped where the canvas can't filter). */
  blur?: number;
  /**
   * Drawn on a layer of its own (the bounds given), then put down as one: needed when a child blends with its
   * siblings only ("source-atop" glints that must stay on the logo).
   */
  isolate?: { x: number; y: number; w: number; h: number };
  /** A soft wipe: only what lies where the gradient is opaque shows (drawn on its own layer). */
  mask?: Gradient & { bounds: { x: number; y: number; w: number; h: number } };
  /**
   * A blur in design units (a CSS blur's radius) on its own layer: the browser's gaussian where the canvas filters,
   * else Fuobe's step-down blur (halved, then scaled back up), so it works in every browser. Glows, soft shadows,
   * depth of field and blur-ins use it, on cached groups, so it costs once and not every frame.
   */
  soften?: number;
  /**
   * Drawn once into a bitmap and reused while `key` stays the same (ghost type, glows, extrusions, halftone, shadows):
   * `bounds` is everything the children draw, in the group's own units (with room for `soften`). The key must change
   * whenever what the children draw changes; the group's transform and opacity may change freely.
   */
  cache?: { key: string; bounds: Box };
  children: DisplayNode[];
}

export interface RectNode {
  type: "rect";
  id?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  r?: number;
  fill?: Paint;
  stroke?: Stroke;
  opacity?: number;
}

export interface EllipseNode {
  type: "ellipse";
  id?: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill?: Paint;
  stroke?: Stroke;
  opacity?: number;
}

export interface PathNode {
  type: "path";
  id?: string;
  /** SVG path data. */
  d: string;
  transform?: Matrix;
  fill?: Paint;
  stroke?: Stroke;
  opacity?: number;
}

/** One drawn piece of a typed field: a line, a word or a letter, placed. */
export interface TextRun {
  text: string;
  /** The typed whitespace before it (not drawn; spelling checks join gap + text). */
  gap: string;
  font: string;
  /** Left edge and top of the glyph box (textBaseline "top"). */
  x: number;
  y: number;
  fill: Paint;
  dir?: "ltr" | "rtl";
  opacity?: number;
  transform?: Matrix;
  /** An outline round the letters (hollow and outline type); with fill "transparent" only the outline is drawn. */
  stroke?: { paint: Paint; width: number };
  /**
   * What is drawn in place of `text` for this frame only (a letter cycling before it locks, in a scramble). `text`
   * stays the typed letter; at rest nothing is ever swapped.
   */
  shown?: string;
}

export interface TextNode {
  type: "text";
  /** The field it sets ("headline", "cta"…). */
  field: string;
  runs: TextRun[];
  opacity?: number;
  /**
   * A decorative copy of the field (a ghost, a glow, an echo, an extrusion, a colour split): never the readable words,
   * so it may bleed off the frame; checks of readable text skip it.
   */
  decor?: boolean;
}

export interface ImageNode {
  type: "image";
  id?: string;
  /** The source's key in the drawer's sources (the logo, the product). */
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The part of the picture drawn, in shares (0–1) of its width and height (all of it when absent). */
  crop?: Box;
  opacity?: number;
  /** A photograph laid to the frame's edge as a ground or a panel: it may run under what covers the frame's edges (a tile's chips); words never do. */
  bleed?: boolean;
  /** A decorative copy of a picture (a reflection, a duotone ghost): never the picture itself. */
  decor?: boolean;
  smoothing?: boolean;
}

/** The person's own clip (Kinetic's video layer): the frame on screen at `time` seconds into the clip, in a box. */
export interface VideoNode {
  type: "video";
  /** The clip's key in the drawer's sources ("clip"). */
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Seconds into the clip. */
  time: number;
  opacity?: number;
}

/**
 * Film grain over a box: seeded mono noise tiles (made once per seed), the tile and its offset picked by `frame`, so a
 * frame always gets the same grain and neighbouring frames differ. Blended (overlay on light grounds, screen on dark).
 */
export interface GrainNode {
  type: "grain";
  seed: number;
  /** Which tile and offset (frames on twos: floor(frame / 2)). */
  frame: number;
  /** Alpha of the noise layer (0.03–0.06 reads as film, more as dirt). */
  amount: number;
  /** One grain's size in design units (1–1.5 at 1080). */
  size: number;
  blend: Blend;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity?: number;
}

export type DisplayNode = GroupNode | RectNode | EllipseNode | PathNode | TextNode | ImageNode | VideoNode | GrainNode;

export interface DisplayList {
  /** Design size. */
  w: number;
  h: number;
  background: string;
  nodes: DisplayNode[];
  /** A grade and grain over the finished frame (absent: as drawn). */
  finish?: Finish;
}

/** The clip's node in a list (the video layer is always drawn first), if any. */
export const videoNodeOf = (list: DisplayList): VideoNode | undefined => (list.nodes[0]?.type === "video" ? list.nodes[0] : undefined);

export const group = (children: DisplayNode[], o: Omit<GroupNode, "type" | "children"> = {}): GroupNode => ({ type: "group", ...o, children });

/**
 * Every text node in a list that carries readable words, in drawing order (tests read the fields from it). Decorative
 * copies (ghosts, glows, echoes) are left out unless `decor` is set.
 */
export function textNodes(nodes: readonly DisplayNode[], o: { decor?: boolean } = {}): TextNode[] {
  const out: TextNode[] = [];
  for (const n of nodes) {
    if (n.type === "text") {
      if (o.decor || !n.decor) out.push(n);
    } else if (n.type === "group") out.push(...textNodes(n.children, o));
  }
  return out;
}

/** The pill outline as path data starting at the top centre, clockwise, and its length (for a stroke that draws on). */
export function roundRectPath(x: number, y: number, w: number, h: number, r: number): { d: string; length: number } {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const cx = x + w / 2;
  const d = [
    `M${cx} ${y}`,
    `H${x + w - rr}`,
    `A${rr} ${rr} 0 0 1 ${x + w} ${y + rr}`,
    `V${y + h - rr}`,
    `A${rr} ${rr} 0 0 1 ${x + w - rr} ${y + h}`,
    `H${x + rr}`,
    `A${rr} ${rr} 0 0 1 ${x} ${y + h - rr}`,
    `V${y + rr}`,
    `A${rr} ${rr} 0 0 1 ${x + rr} ${y}`,
    "Z",
  ].join(" ");
  return { d, length: 2 * (w - 2 * rr) + 2 * (h - 2 * rr) + 2 * Math.PI * rr };
}

/** A colour with its alpha multiplied (hex #rrggbb or #rgb in, rgba() out). */
export function withAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6).padEnd(6, "0");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}

/** Two hex colours mixed (p = 0: a, 1: b), as hex. */
export function mixHex(a: string, b: string, p: number): string {
  const rgb = (hex: string) => {
    const h = hex.replace("#", "");
    const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6).padEnd(6, "0");
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  };
  const x = rgb(a);
  const y = rgb(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * p).toString(16).padStart(2, "0")).join("")}`;
}

// ---------------------------------------------------------------------------
// Motion between two moments

const d = (a: number | undefined, b: number | undefined) => Math.abs((a ?? 0) - (b ?? 0));

/** How far a matrix change moves the frame's corners (design units). */
function matrixTravel(m: Matrix | undefined, n: Matrix | undefined, w: number, h: number): number {
  if (!m && !n) return 0;
  const a = m ?? IDENTITY;
  const b = n ?? IDENTITY;
  let out = 0;
  for (const [x, y] of [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ]) {
    out = Math.max(out, Math.hypot((a[0] - b[0]) * x + (a[2] - b[2]) * y + (a[4] - b[4]), (a[1] - b[1]) * x + (a[3] - b[3]) * y + (a[5] - b[5])));
  }
  return out;
}

function paintTravel(p: Paint | undefined, q: Paint | undefined): number {
  if (!p || !q || typeof p === "string" || typeof q === "string" || p.kind !== q.kind) return 0;
  if (p.kind === "linear" && q.kind === "linear") return Math.max(d(p.x0, q.x0), d(p.y0, q.y0), d(p.x1, q.x1), d(p.y1, q.y1));
  if (p.kind === "radial" && q.kind === "radial") return Math.max(d(p.cx, q.cx), d(p.cy, q.cy), d(p.r0, q.r0), d(p.r1, q.r1));
  return 0;
}

const boxTravel = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => Math.max(d(a.x, b.x), d(a.y, b.y), d(a.x + a.w, b.x + b.w), d(a.y + a.h, b.y + b.h));

function strokeTravel(a: Stroke | undefined, b: Stroke | undefined): number {
  if (!a || !b) return 0;
  return d(a.trim ?? 1, b.trim ?? 1) * (a.length ?? 0) + d(a.width, b.width);
}

function nodesTravel(a: readonly DisplayNode[], b: readonly DisplayNode[], w: number, h: number): number {
  let out = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (x.type !== y.type) continue;
    let t = 0;
    if (x.type === "group" && y.type === "group") {
      t = matrixTravel(x.transform, y.transform, w, h) + nodesTravel(x.children, y.children, w, h);
      if (x.clip && y.clip && x.clip.type === "rect" && y.clip.type === "rect") t = Math.max(t, boxTravel(x.clip, y.clip));
      if (x.mask && y.mask) t = Math.max(t, paintTravel(x.mask, y.mask));
    } else if (x.type === "rect" && y.type === "rect") t = Math.max(boxTravel(x, y), paintTravel(x.fill, y.fill), strokeTravel(x.stroke, y.stroke));
    else if (x.type === "ellipse" && y.type === "ellipse") t = Math.max(d(x.cx, y.cx) + d(x.rx, y.rx), d(x.cy, y.cy) + d(x.ry, y.ry), paintTravel(x.fill, y.fill));
    else if (x.type === "image" && y.type === "image") t = boxTravel(x, y);
    else if (x.type === "path" && y.type === "path") t = Math.max(x.d === y.d ? matrixTravel(x.transform, y.transform, w, h) : 0, strokeTravel(x.stroke, y.stroke));
    else if (x.type === "text" && y.type === "text") {
      const m = Math.min(x.runs.length, y.runs.length);
      for (let k = 0; k < m; k++) t = Math.max(t, d(x.runs[k].x, y.runs[k].x), d(x.runs[k].y, y.runs[k].y), matrixTravel(x.runs[k].transform, y.runs[k].transform, w, h));
    }
    out = Math.max(out, t);
  }
  return out;
}

/**
 * The farthest anything moves between two moments of one scene (design units): edges, centres, radii, gradient
 * stops, stroke ends. Pieces that appear or vanish in between don't count (they need no blur). The export picks its
 * motion-blur samples from it, so a fast edge gets enough of them to look smooth and a held frame gets one.
 */
export function listTravel(a: DisplayList, b: DisplayList): number {
  return nodesTravel(a.nodes, b.nodes, a.w, a.h);
}
