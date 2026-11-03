/**
 * Finish (pure): film grain, a vignette and a flash. Grain is seeded noise: a few 256 × 256 tiles made once per
 * seed, the tile and its offset changing every second frame (on twos), so it reads as film, the same frame always gets
 * the same grain, and gradients don't band in the video. It is drawn under the readable type.
 */

import type { DisplayNode, GrainNode } from "../display";
import { rng } from "../random";

/** Tiles per seed. */
export const GRAIN_TILES = 6;
export const GRAIN_SIZE = 256;

/**
 * One grain tile: GRAIN_SIZE² grey values around 128 (a sum of three seeded uniforms, so it is soft-edged, not salt
 * and pepper). Pure: the drawer turns it into a bitmap once.
 */
export function grainTile(seed: number, index: number, size = GRAIN_SIZE): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size);
  // A fast seeded stream (xorshift) started from the order-free hash: the tile is the same whatever else was drawn.
  let s = Math.floor(rng(seed, "grain-tile", index) * 0xffffffff) | 1;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  for (let i = 0; i < out.length; i++) out[i] = Math.round(128 + ((next() + next() + next()) / 3 - 0.5) * 2 * 110);
  return out;
}

/** Which tile and offset a frame uses (it changes every second frame). */
export function grainPick(seed: number, frame: number): { tile: number; ox: number; oy: number } {
  const step = Math.floor(Math.max(0, frame) / 2);
  return { tile: step % GRAIN_TILES, ox: Math.floor(rng(seed, "grain-ox", step) * GRAIN_SIZE), oy: Math.floor(rng(seed, "grain-oy", step) * GRAIN_SIZE) };
}

/** Grain over the frame: overlay at 4–6 % on light grounds, screen at 3–5 % on dark ones; grains 1.25 units at 1080. */
export function grain(o: { w: number; h: number; seed: number; frame: number; dark: boolean; amount?: number; size?: number }): GrainNode {
  return { type: "grain", seed: o.seed, frame: o.frame, amount: o.amount ?? (o.dark ? 0.04 : 0.05), size: o.size ?? 1.25, blend: o.dark ? "screen" : "overlay", x: 0, y: 0, w: o.w, h: o.h };
}

/** A vignette: corners 10–20 % darker, toward the ground's own dark. */
export function vignette(o: { w: number; h: number; strength?: number; color?: string }): DisplayNode {
  const c = o.color ?? "#000000";
  const hex = c.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const a = o.strength ?? 0.15;
  return {
    type: "rect",
    x: 0,
    y: 0,
    w: o.w,
    h: o.h,
    fill: { kind: "radial", cx: o.w / 2, cy: o.h / 2, r0: Math.min(o.w, o.h) * 0.42, r1: Math.hypot(o.w, o.h) / 2, stops: [{ at: 0, color: `rgba(${r},${g},${b},0)` }, { at: 1, color: `rgba(${r},${g},${b},${a})` }] },
  };
}

/** A white flash over the frame (a stomp's impact: 6 %, never more than three a second). */
export const flash = (w: number, h: number, a: number): DisplayNode | null => (a > 0 ? { type: "rect", x: 0, y: 0, w, h, fill: `rgba(255,255,255,${Math.min(0.12, a)})` } : null);

/**
 * Motion-blur samples for an export frame from how far its fastest edge moves in a frame (pixels): none at rest,
 * up to 16 at speed.
 */
export const blurSamples = (maxDisplacementPx: number): number => (maxDisplacementPx <= 0.5 ? 1 : Math.min(16, Math.max(1, Math.ceil(maxDisplacementPx / 2))));
