/**
 * Fields and atmosphere (pure): what sits behind the type. A field is never flat: a mesh of soft colour moving on
 * slow seeded paths, light bars, an orb of glow, rings, a ribbon of light, bokeh. Every move is seeded and its period
 * fits a whole number of times into the clip, so a looping clip closes without a jump.
 */

import { group, type DisplayNode, type GroupNode } from "../display";
import { mixOk } from "../color";
import { rng } from "../random";
import { clamp } from "../time";
import { CURVES } from "../ease";

/** A period near `target` seconds that fits a whole number of times into `duration`. */
export function loopPeriod(target: number, duration: number): number {
  if (!(duration > 0)) return target;
  return duration / Math.max(1, Math.round(duration / target));
}

/** A colour at an alpha (hex in). */
export function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6).padEnd(6, "0");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${clamp(a)})`;
}

/** A soft radial pool of a colour (four stops, so it fades without a ring). */
export function pool(cx: number, cy: number, r: number, color: string, alpha: number): { kind: "radial"; cx: number; cy: number; r0: number; r1: number; stops: { at: number; color: string }[] } {
  return {
    kind: "radial",
    cx,
    cy,
    r0: 0,
    r1: Math.max(1, r),
    stops: [
      { at: 0, color: rgba(color, alpha) },
      { at: 0.35, color: rgba(color, alpha * 0.7) },
      { at: 0.7, color: rgba(color, alpha * 0.22) },
      { at: 1, color: rgba(color, 0) },
    ],
  };
}

export interface MeshOptions {
  w: number;
  h: number;
  /** 3–5 colours: the palette's tonal steps and its accent. */
  colors: readonly string[];
  seed: number;
  t: number;
  /** The clip's length (paths close on it). */
  duration: number;
  /** On a dark ground the pools add light (screen); on a light one they lay colour (normal). */
  dark: boolean;
  /** How far the pools wander, as a share of the frame (0.05–0.12). */
  amplitude?: number;
}

/** A moving mesh gradient: 3–5 large pools of colour on seeded Lissajous paths. */
export function meshGradient(o: MeshOptions): GroupNode {
  const W = Math.max(o.w, o.h);
  const nodes: DisplayNode[] = o.colors.slice(0, 5).map((c, i) => {
    const r = (0.4 + 0.4 * rng(o.seed, "mesh-r", i)) * W;
    const bx = 0.1 + 0.8 * rng(o.seed, "mesh-x", i);
    const by = 0.1 + 0.8 * rng(o.seed, "mesh-y", i);
    const amp = (o.amplitude ?? 0.05 + 0.07 * rng(o.seed, "mesh-a", i)) * W;
    const px = loopPeriod(8 + 6 * rng(o.seed, "mesh-px", i), o.duration);
    const py = loopPeriod(8 + 6 * rng(o.seed, "mesh-py", i), o.duration);
    const fx = rng(o.seed, "mesh-fx", i) * Math.PI * 2;
    const fy = rng(o.seed, "mesh-fy", i) * Math.PI * 2;
    const cx = bx * o.w + amp * Math.sin((2 * Math.PI * o.t) / px + fx);
    const cy = by * o.h + amp * Math.sin((2 * Math.PI * o.t) / py + fy);
    const a = 0.3 + 0.4 * rng(o.seed, "mesh-alpha", i);
    return { type: "rect", x: 0, y: 0, w: o.w, h: o.h, fill: pool(cx, cy, r, c, a) };
  });
  return group(nodes, { id: "mesh", ...(o.dark && { blend: "screen" }) });
}

export interface BarsOptions {
  /** The box the bars fill (often the frame). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 5–12 bars. */
  count: number;
  ground: string;
  accent: string;
  t: number;
  duration: number;
  seed: number;
}

/** Striped light: vertical bars from the ground into the accent, sliding 1–2 % sideways over the clip. */
export function lightBars(o: BarsOptions): GroupNode {
  const n = Math.max(3, Math.min(12, Math.round(o.count)));
  const bw = o.w / n;
  const slide = Math.sin((2 * Math.PI * o.t) / loopPeriod(10, o.duration)) * 0.015 * o.w;
  const nodes: DisplayNode[] = Array.from({ length: n }, (_, i) => {
    const lift = 0.35 + 0.5 * rng(o.seed, "bar-lift", i);
    const top = mixOk(o.ground, o.accent, lift);
    return {
      type: "rect",
      x: o.x + i * bw + slide,
      y: o.y,
      w: bw * (0.62 + 0.18 * rng(o.seed, "bar-w", i)),
      h: o.h,
      fill: { kind: "linear", x0: 0, y0: o.y, x1: 0, y1: o.y + o.h, stops: [{ at: 0, color: rgba(top, 0.95) }, { at: 0.55, color: rgba(mixOk(o.ground, o.accent, lift * 0.4), 0.6) }, { at: 1, color: rgba(o.ground, 0) }] },
    };
  });
  return group(nodes, { id: "light-bars", clip: { type: "rect", x: o.x, y: o.y, w: o.w, h: o.h } });
}

/** One or two blurred discs of glow behind the hero (accent hue at 35–60 %). */
export function orbGlow(o: { cx: number; cy: number; r: number; color: string; alpha?: number }): DisplayNode {
  const R = o.r;
  return { type: "rect", x: o.cx - R, y: o.cy - R, w: 2 * R, h: 2 * R, fill: pool(o.cx, o.cy, R, o.color, o.alpha ?? 0.45) };
}

/** Concentric rings in tonal steps from a point (often a corner). */
export function rings(o: { cx: number; cy: number; count: number; gap: number; width?: number; colors: readonly string[]; alpha?: number; t?: number; drift?: number }): GroupNode {
  const n = Math.max(1, Math.min(8, Math.round(o.count)));
  const grow = (o.drift ?? 0) * (o.t ?? 0);
  return group(
    Array.from({ length: n }, (_, i) => {
      const r = o.gap * (i + 1) + grow;
      return { type: "ellipse" as const, cx: o.cx, cy: o.cy, rx: r, ry: r, stroke: { paint: rgba(o.colors[i % o.colors.length], o.alpha ?? 0.22), width: o.width ?? 1.5 } };
    }),
    { id: "rings" },
  );
}

/**
 * A ribbon of light: a thick curve with a gradient along it (clear → hue → white → hue → clear) over a blurred copy of
 * itself, sweeping behind the hero. `p` (0–1) draws it on along its length.
 */
export function ribbon(o: { d: string; from: [number, number]; to: [number, number]; width: number; hue: string; p?: number; length?: number; key: string; bounds: { x: number; y: number; w: number; h: number } }): GroupNode {
  const paint = { kind: "linear" as const, x0: o.from[0], y0: o.from[1], x1: o.to[0], y1: o.to[1], stops: [{ at: 0, color: rgba(o.hue, 0) }, { at: 0.3, color: rgba(o.hue, 0.9) }, { at: 0.5, color: "rgba(255,255,255,0.95)" }, { at: 0.7, color: rgba(o.hue, 0.9) }, { at: 1, color: rgba(o.hue, 0) }] };
  const trim = o.p === undefined ? undefined : clamp(o.p);
  const stroke = (w: number) => ({ paint, width: w, cap: "round" as const, ...(trim !== undefined && { trim, length: o.length }) });
  const soft = trim === undefined || trim >= 1;
  return group(
    [
      group([{ type: "path", d: o.d, stroke: stroke(o.width * 2.2) }], { soften: o.width * 1.2, opacity: 0.55, blend: "screen", ...(soft && { cache: { key: `ribbon|${o.key}|${o.width}`, bounds: o.bounds } }) }),
      { type: "path", d: o.d, stroke: stroke(o.width) },
    ],
    { id: "ribbon" },
  );
}

/** A dark ground: the brand's hue near black with a soft glow in its top third (never pure black). */
export function nightGround(o: { w: number; h: number; night: string; glow: string; alpha?: number }): DisplayNode[] {
  return [
    { type: "rect", x: 0, y: 0, w: o.w, h: o.h, fill: o.night },
    { type: "rect", x: 0, y: 0, w: o.w, h: o.h, fill: pool(o.w * 0.5, o.h * 0.22, Math.max(o.w, o.h) * 0.75, o.glow, o.alpha ?? 0.35) },
  ];
}

/** Bokeh: at most three faint out-of-focus discs (alpha ≤ 0.1, a slightly brighter rim, a soft edge), drifting by their depth. */
export function bokeh(o: { w: number; h: number; count: number; colors: readonly string[]; seed: number; t: number; duration: number }): GroupNode {
  const n = Math.max(1, Math.min(3, Math.round(o.count)));
  const S = Math.min(o.w, o.h);
  const nodes: DisplayNode[] = Array.from({ length: n }, (_, i) => {
    const depth = 0.3 + 0.7 * rng(o.seed, "bokeh-z", i);
    const r = (0.05 + 0.07 * rng(o.seed, "bokeh-r", i)) * S;
    const period = loopPeriod(12 + 8 * rng(o.seed, "bokeh-p", i), o.duration);
    const cx = rng(o.seed, "bokeh-x", i) * o.w + Math.sin((2 * Math.PI * o.t) / period + i) * 0.03 * o.w * depth;
    const cy = rng(o.seed, "bokeh-y", i) * o.h + Math.cos((2 * Math.PI * o.t) / period + i) * 0.02 * o.h * depth;
    const c = o.colors[i % o.colors.length];
    const a = 0.05 + 0.05 * rng(o.seed, "bokeh-a", i);
    return { type: "ellipse", cx, cy, rx: r, ry: r, fill: { kind: "radial", cx, cy, r0: 0, r1: r, stops: [{ at: 0, color: rgba(c, a * 0.45) }, { at: 0.72, color: rgba(c, a * 0.75) }, { at: 0.9, color: rgba(c, a) }, { at: 1, color: rgba(c, 0) }] } };
  });
  return group(nodes, { id: "bokeh", blend: "screen" });
}

/** Light leaks round a cut: 2–3 warm pools sliding in from an edge (p 0–1 over 400–800 ms). */
export function lightLeak(o: { w: number; h: number; from: "left" | "right" | "top"; p: number; seed: number; warm?: readonly string[] }): GroupNode | null {
  if (o.p <= 0 || o.p >= 1) return null;
  const warm = o.warm ?? ["#ffb46b", "#ff8a5c", "#ff5fa2"];
  const env = Math.sin(Math.PI * o.p);
  const k = CURVES.move(o.p);
  const W = Math.max(o.w, o.h);
  const nodes: DisplayNode[] = warm.slice(0, 3).map((c, i) => {
    const along = 0.2 + 0.6 * rng(o.seed, "leak", i);
    const reach = (-0.2 + 0.7 * k) * (o.from === "top" ? o.h : o.w);
    const cx = o.from === "left" ? reach : o.from === "right" ? o.w - reach : along * o.w;
    const cy = o.from === "top" ? reach : along * o.h;
    return { type: "rect", x: 0, y: 0, w: o.w, h: o.h, fill: pool(cx, cy, W * (0.35 + 0.2 * i), c, (0.15 + 0.2 * rng(o.seed, "leak-a", i)) * env) };
  });
  return group(nodes, { id: "leak", blend: "screen" });
}
