/**
 * Type materials (pure): paints and outlines for type at rest (any animation plays over them). Solid is the default;
 * the others are for one hero word or number, never body copy.
 */

import type { Box, Gradient, Paint } from "../display";
import { okStops, analogous } from "../color";
import { rgba } from "./background";

/** Hollow type: an outline 1.5–3 % of the size, no fill (ghost copies use 1–2.5 units at 25–40 %). */
export function hollow(size: number, color: string, share = 0.022): { fill: Paint; stroke: { paint: Paint; width: number } } {
  return { fill: "transparent", stroke: { paint: color, width: Math.max(1, size * share) } };
}

/**
 * A gradient across a line box (2–3 analogous colours, 100–135°), sampled in OKLab. It drifts along its axis by ±8 %
 * over `period` seconds, so it moves slowly without ever changing its colours. Falls back to two stops when the
 * colours are far apart in hue (no rainbow on type).
 */
export function gradientInk(box: Box, colors: readonly string[], o: { angle?: number; t?: number; period?: number } = {}): Gradient {
  const a = ((o.angle ?? 115) * Math.PI) / 180;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const half = (Math.abs(Math.cos(a)) * box.w + Math.abs(Math.sin(a)) * box.h) / 2;
  const drift = o.period ? Math.sin((2 * Math.PI * (o.t ?? 0)) / o.period) * 0.08 * half * 2 : 0;
  const dx = Math.cos(a) * half;
  const dy = Math.sin(a) * half;
  const cols = colors.length >= 3 && analogous(colors[0], colors[2], 60) ? colors.slice(0, 3) : colors.slice(0, 2);
  const stops = cols.length === 3 ? [...okStops(cols[0], cols[1], 3, 0, 0.5), ...okStops(cols[1], cols[2], 3, 0.5, 1).slice(1)] : okStops(cols[0], cols[1] ?? cols[0], 5);
  return { kind: "linear", x0: cx - dx + Math.cos(a) * drift, y0: cy - dy + Math.sin(a) * drift, x1: cx + dx + Math.cos(a) * drift, y1: cy + dy + Math.sin(a) * drift, stops };
}

/** Chrome's stops across the cap height: bright sky, a hard dark horizon, a bright ground. */
export const CHROME_STOPS: readonly { at: number; color: string }[] = [
  { at: 0, color: "#f5f7fa" },
  { at: 0.46, color: "#a3acb6" },
  { at: 0.5, color: "#3a4149" },
  { at: 0.54, color: "#dfe4e9" },
  { at: 1, color: "#79828c" },
];

/**
 * Chrome type: the horizon gradient across the cap band (top to bottom of the capitals), shifted by `flow` (a share
 * of the cap height, from the chrome-flow loop), with a lighter outline. Dark or saturated grounds only.
 */
export function chromeInk(capTop: number, capBottom: number, size: number, flow = 0): { fill: Gradient; stroke: { paint: Paint; width: number } } {
  const h = capBottom - capTop;
  const shift = flow * h;
  return {
    fill: { kind: "linear", x0: 0, y0: capTop + shift, x1: 0, y1: capBottom + shift, stops: CHROME_STOPS.map((s) => ({ ...s })) },
    stroke: { paint: "rgba(255,255,255,0.4)", width: Math.max(1, size * 0.012) },
  };
}

/** Glass type: a faint white fill with a top-bright outline. */
export function glassInk(capTop: number, capBottom: number, size: number): { fill: Paint; stroke: { paint: Paint; width: number } } {
  return {
    fill: "rgba(255,255,255,0.2)",
    stroke: { paint: { kind: "linear", x0: 0, y0: capTop, x1: 0, y1: capBottom, stops: [{ at: 0, color: "rgba(255,255,255,0.95)" }, { at: 1, color: "rgba(255,255,255,0.25)" }] }, width: Math.max(1, size * 0.01) },
  };
}

/** Neon: a near-white core and its glow colour (the neon-strike preset draws the halos). */
export const neonInk = (glow: string): { fill: string; glow: string } => ({ fill: "#fffaf0", glow });

/** A pill round a text box: padding 0.35 em × 0.6 em, fully rounded. */
export function pillBox(text: Box, size: number): Box & { r: number } {
  const px = 0.6 * size;
  const py = 0.35 * size;
  const b = { x: text.x - px, y: text.y - py, w: text.w + 2 * px, h: text.h + 2 * py };
  return { ...b, r: b.h / 2 };
}

/** A colour faded (hex in). */
export const fade = (hex: string, a: number): string => rgba(hex, a);
