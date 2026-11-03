/**
 * Overlays and graphic texture (pure): the pieces that lock into the type on purpose (a tilted pill, a highlighter
 * under a word, a sticker's keyline) and the texture around it (halftone, organic blobs, rules and arrows, Bauhaus
 * shapes, doodles). Every jitter is seeded; draw-ons take a progress 0–1.
 */

import { group, multiply, type Box, type DisplayNode, type GroupNode, type Matrix, type Paint } from "../display";
import { rng } from "../random";
import { clamp } from "../time";
import { CURVES } from "../ease";

const DEG = Math.PI / 180;

/** A rotation by `deg` about (cx, cy). */
export function rotation(deg: number, cx: number, cy: number): Matrix {
  const a = deg * DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}

/** A tilted pill (tag) behind its own content: rotated −4° to −8° about its centre; `p` pops it in (0–1, curve pop). */
export function pillTag(box: Box & { r?: number }, fill: Paint, content: readonly DisplayNode[], o: { deg?: number; p?: number; stroke?: { paint: Paint; width: number } } = {}): GroupNode {
  const p = o.p ?? 1;
  const s = p >= 1 ? 1 : CURVES.pop(clamp(p));
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rot = rotation(o.deg ?? -6, cx, cy);
  const scale: Matrix = [s, 0, 0, s, cx - s * cx, cy - s * cy];
  return group([{ type: "rect", x: box.x, y: box.y, w: box.w, h: box.h, r: box.r ?? box.h / 2, fill, ...(o.stroke && { stroke: o.stroke }) }, ...content], {
    id: "pill",
    transform: multiply(rot, scale),
    ...(p < 0.15 && { opacity: p / 0.15 }),
  });
}

/**
 * A highlighter bar under a word: covering the lower 45–60 % of its cap band, skewed −2° to −4°, its edges jittered
 * by 0.3–0.6 % of its height (seeded); `p` grows it from the left (0–1).
 */
export function highlighter(o: { capTop: number; baseline: number; x: number; w: number; color: Paint; seed: number; p?: number; cover?: number; skew?: number; key?: string }): DisplayNode | null {
  const p = clamp(o.p ?? 1);
  if (p <= 0) return null;
  const cap = o.baseline - o.capTop;
  const h = cap * (o.cover ?? 0.52);
  const y = o.baseline - h + cap * 0.06;
  const pad = cap * 0.12;
  const x0 = o.x - pad;
  const x1 = x0 + (o.w + 2 * pad) * CURVES.snap(p);
  const j = (k: string, i: number) => (rng(o.seed, "hl", o.key ?? "", k, i) * 2 - 1) * h * 0.005 * 0.9 + (rng(o.seed, "hl2", k, i) - 0.5) * h * 0.004;
  const sk = Math.tan((o.skew ?? -3) * DEG);
  const steps = 6;
  const top: string[] = [];
  const bottom: string[] = [];
  // The skew leans the bar about its middle, so it overhangs the word by the same amount on both sides.
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    top.push(`${(x + (sk * h) / 2).toFixed(1)} ${(y + j("t", i)).toFixed(1)}`);
    bottom.unshift(`${(x - (sk * h) / 2).toFixed(1)} ${(y + h + j("b", i)).toFixed(1)}`);
  }
  return { type: "path", d: `M${top.join("L")}L${bottom.join("L")}Z`, fill: o.color };
}

/**
 * A halftone field (drawn once, cached): dots on a staggered grid rotated 15° or 45°, each radius rmax × √coverage,
 * the coverage fading from `origin` out to `reach`.
 */
export function halftone(o: { box: Box; spacing: number; angle?: number; origin: [number, number]; reach: number; color: Paint; alpha?: number; key: string }): GroupNode {
  const a = (o.angle ?? 45) * DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const rmax = o.spacing * 0.5;
  const parts: string[] = [];
  const diag = Math.hypot(o.box.w, o.box.h);
  const cx = o.box.x + o.box.w / 2;
  const cy = o.box.y + o.box.h / 2;
  const n = Math.ceil(diag / o.spacing / 2) + 1;
  for (let i = -n; i <= n; i++) {
    for (let k = -n; k <= n; k++) {
      const gx = (k + (i % 2 ? 0.5 : 0)) * o.spacing;
      const gy = i * o.spacing * 0.866;
      const x = cx + gx * c - gy * s;
      const y = cy + gx * s + gy * c;
      if (x < o.box.x - rmax || x > o.box.x + o.box.w + rmax || y < o.box.y - rmax || y > o.box.y + o.box.h + rmax) continue;
      // Coverage fades from the origin out to its reach, and to nothing before the box's edges (never a clipped edge).
      const edge = clamp(Math.min(x - o.box.x, o.box.x + o.box.w - x, y - o.box.y, o.box.y + o.box.h - y) / (0.3 * Math.min(o.box.w, o.box.h)));
      const cover = clamp(1 - Math.hypot(x - o.origin[0], y - o.origin[1]) / o.reach) * edge;
      const r = rmax * Math.sqrt(cover);
      if (r < 0.35) continue;
      parts.push(`M${(x + r).toFixed(1)} ${y.toFixed(1)}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0`);
    }
  }
  return group([{ type: "path", d: parts.join(""), fill: o.color }], { id: "halftone", opacity: o.alpha ?? 0.22, clip: { type: "rect", ...o.box }, cache: { key: `halftone|${o.key}`, bounds: o.box } });
}

/** An organic blob: a smooth closed curve through 6–8 seeded points whose radii breathe on slow sines. */
export function blob(o: { cx: number; cy: number; r: number; seed: number; t: number; points?: number; wobble?: number; period?: number; fill: Paint }): DisplayNode {
  const n = Math.max(5, Math.min(10, o.points ?? 7));
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + rng(o.seed, "blob-a", i) * 0.4;
    const period = o.period ?? 6;
    const breathe = Math.sin((2 * Math.PI * o.t) / period + rng(o.seed, "blob-p", i) * Math.PI * 2);
    const rr = o.r * (1 + (rng(o.seed, "blob-r", i) * 2 - 1) * 0.18 + breathe * (o.wobble ?? 0.06));
    pts.push([o.cx + Math.cos(ang) * rr, o.cy + Math.sin(ang) * rr]);
  }
  return { type: "path", d: smoothClosed(pts), fill: o.fill };
}

/** A closed Catmull-Rom curve through points, as cubic Béziers. */
export function smoothClosed(pts: readonly [number, number][]): string {
  const n = pts.length;
  const p = (i: number) => pts[((i % n) + n) % n];
  let d = `M${p(0)[0].toFixed(1)} ${p(0)[1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = p(i - 1);
    const [x1, y1] = p(i);
    const [x2, y2] = p(i + 1);
    const [x3, y3] = p(i + 2);
    d += `C${(x1 + (x2 - x0) / 6).toFixed(1)} ${(y1 + (y2 - y0) / 6).toFixed(1)} ${(x2 - (x3 - x1) / 6).toFixed(1)} ${(y2 - (y3 - y1) / 6).toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }
  return `${d}Z`;
}

/** A thin rule that draws on from its left end (`p` 0–1, curve draw). */
export function rule(o: { x: number; y: number; w: number; width?: number; color: Paint; p?: number }): DisplayNode {
  return { type: "path", d: `M${o.x} ${o.y}H${o.x + o.w}`, stroke: { paint: o.color, width: o.width ?? 1.25, trim: CURVES.draw(clamp(o.p ?? 1)), length: o.w } };
}

/** A small ↗ arrow (stroked), drawn on with `p`. */
export function arrow(o: { x: number; y: number; size: number; width?: number; color: Paint; p?: number }): DisplayNode {
  const s = o.size;
  const len = Math.SQRT2 * s + 2 * s * 0.6;
  return { type: "path", d: `M${o.x} ${o.y + s}L${o.x + s} ${o.y}M${o.x + s * 0.4} ${o.y}H${o.x + s}V${o.y + s * 0.6}`, stroke: { paint: o.color, width: o.width ?? Math.max(1.25, s * 0.09), cap: "round", join: "round", trim: CURVES.draw(clamp(o.p ?? 1)), length: len } };
}

/** A sticker's keyline: a wide white outline behind the sticker's own nodes (text runs get a stroke copy). */
export function keyline(nodes: readonly DisplayNode[], width: number, color = "#ffffff"): DisplayNode[] {
  return nodes.map((n): DisplayNode => {
    switch (n.type) {
      case "text":
        return { ...n, decor: true, runs: n.runs.map((r) => ({ ...r, fill: color, stroke: { paint: color, width: width * 2 } })) };
      case "rect":
      case "ellipse":
      case "path":
        return { ...n, fill: color, stroke: { paint: color, width: width * 2, join: "round" } };
      case "group":
        return { ...n, children: keyline(n.children, width, color) };
      default:
        return n;
    }
  });
}

/** Bauhaus accents on the grid: a disc, a quarter disc and a thin rule in one colour. */
export function bauhaus(o: { x: number; y: number; size: number; color: Paint; seed: number }): GroupNode {
  const s = o.size;
  const flip = rng(o.seed, "bauhaus") < 0.5;
  return group(
    [
      { type: "ellipse", cx: o.x + s * 0.5, cy: o.y + s * 0.5, rx: s * 0.5, ry: s * 0.5, fill: o.color },
      { type: "path", d: flip ? `M${o.x + s * 1.2} ${o.y + s}A${s} ${s} 0 0 1 ${o.x + s * 2.2} ${o.y}V${o.y + s}Z` : `M${o.x + s * 1.2} ${o.y}A${s} ${s} 0 0 0 ${o.x + s * 2.2} ${o.y + s}H${o.x + s * 1.2}Z`, fill: o.color },
      { type: "rect", x: o.x, y: o.y + s * 1.3, w: s * 2.2, h: Math.max(1, s * 0.03), fill: o.color },
    ],
    { id: "bauhaus" },
  );
}

/** A hand-drawn squiggle under a word (playful looks), drawn on with `p`. */
export function squiggle(o: { x: number; y: number; w: number; amp: number; seed: number; color: Paint; width?: number; p?: number }): DisplayNode {
  const waves = Math.max(2, Math.round(o.w / (o.amp * 3)));
  const step = o.w / waves;
  let d = `M${o.x.toFixed(1)} ${o.y.toFixed(1)}`;
  for (let i = 0; i < waves; i++) {
    const x = o.x + step * (i + 0.5);
    const up = (i % 2 ? 1 : -1) * o.amp * (0.8 + 0.4 * rng(o.seed, "squiggle", i));
    d += `Q${x.toFixed(1)} ${(o.y + up).toFixed(1)} ${(o.x + step * (i + 1)).toFixed(1)} ${o.y.toFixed(1)}`;
  }
  return { type: "path", d, stroke: { paint: o.color, width: o.width ?? Math.max(2, o.amp * 0.35), cap: "round", join: "round", trim: CURVES.draw(clamp(o.p ?? 1)), length: o.w * 1.25 } };
}
