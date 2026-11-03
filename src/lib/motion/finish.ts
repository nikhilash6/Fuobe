/**
 * The finish over a finished frame (pure): contrast, saturation and seeded film grain. The scene wrappers work out the
 * values at each time (tracks included) and put them on the display list; the drawer applies them once per output
 * frame, after motion blur. Contrast and saturation follow the CSS filter formulas exactly, so the canvas filter and the
 * pixel pass (for a browser without canvas filters) give the same picture. The same seed and frame always get the same
 * grain; neighbouring frames differ.
 */

import { rng } from "./random";
import type { Recipe } from "./recipe";
import { trackAt } from "./edit";

export interface Finish {
  /** -0.5 to 0.5 (0: as drawn). */
  contrast: number;
  /** -1 to 1 (0: as drawn; -1: grey). */
  saturation: number;
  /** 0 to 0.1. */
  grain: number;
  /** 1 to 3: a grain dot's size in pixels at 1080 on the short side. */
  grainSize: number;
  seed: number;
  /** The output frame's index (the grain's offset). */
  frame: number;
}

export const GRAIN_SIZE = 1.2;
/** The grain's strength in the overlay for a grain amount (a 2.5 % grain lays the noise at 7.5 %). */
export const GRAIN_GAIN = 3;
/** The noise tile's side. */
export const GRAIN_TILE = 256;

export const neutralFinish = (f: Pick<Finish, "contrast" | "saturation" | "grain">) => f.contrast === 0 && f.saturation === 0 && f.grain <= 0;

/** The finish at `t` (its tracks replace the slider values), or null when it changes nothing. */
export function finishAt(r: Recipe, t: number): Finish | null {
  if (!r.finish && !r.tracks) return null;
  const contrast = trackAt(r, "finish.contrast", t) ?? r.finish?.contrast ?? 0;
  const saturation = trackAt(r, "finish.saturation", t) ?? r.finish?.saturation ?? 0;
  const grain = trackAt(r, "finish.grain", t) ?? r.finish?.grain ?? 0;
  if (neutralFinish({ contrast, saturation, grain })) return null;
  return { contrast, saturation, grain, grainSize: r.finish?.grainSize ?? GRAIN_SIZE, seed: r.seed, frame: Math.floor(t * r.fps + 1e-6) };
}

/** The CSS filter for the grade ("none" when neutral). */
export function cssFilter(f: Pick<Finish, "contrast" | "saturation">): string {
  const parts: string[] = [];
  if (f.contrast !== 0) parts.push(`contrast(${(1 + f.contrast).toFixed(4)})`);
  if (f.saturation !== 0) parts.push(`saturate(${(1 + f.saturation).toFixed(4)})`);
  return parts.length ? parts.join(" ") : "none";
}

const c01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The grade as a pixel pass over RGBA bytes, in place: contrast(c) then saturate(s) with the Filter Effects formulas
 * (each step clamped, as a browser's filter primitives are).
 */
export function gradePixels(data: Uint8ClampedArray, f: Pick<Finish, "contrast" | "saturation">): void {
  const c = Number((1 + f.contrast).toFixed(4));
  const s = Number((1 + f.saturation).toFixed(4));
  const doC = f.contrast !== 0;
  const doS = f.saturation !== 0;
  if (!doC && !doS) return;
  const m = [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s];
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] / 255;
    let g = data[i + 1] / 255;
    let b = data[i + 2] / 255;
    if (doC) {
      r = c01((r - 0.5) * c + 0.5);
      g = c01((g - 0.5) * c + 0.5);
      b = c01((b - 0.5) * c + 0.5);
    }
    if (doS) {
      const R = c01(m[0] * r + m[1] * g + m[2] * b);
      const G = c01(m[3] * r + m[4] * g + m[5] * b);
      const B = c01(m[6] * r + m[7] * g + m[8] * b);
      r = R;
      g = G;
      b = B;
    }
    data[i] = Math.round(r * 255);
    data[i + 1] = Math.round(g * 255);
    data[i + 2] = Math.round(b * 255);
  }
}

const tiles = new Map<number, Uint8ClampedArray>();

/** The grain's noise tile for a seed: GRAIN_TILE² grey levels, made once. */
export function grainTile(seed: number): Uint8ClampedArray {
  let t = tiles.get(seed);
  if (!t) {
    t = new Uint8ClampedArray(GRAIN_TILE * GRAIN_TILE);
    for (let i = 0; i < t.length; i++) t[i] = Math.floor(rng(seed, "grain", i) * 256);
    if (tiles.size > 8) tiles.clear();
    tiles.set(seed, t);
  }
  return t;
}

/** Where frame `frame`'s grain starts in the tile (whole tile pixels). */
export function grainOffset(seed: number, frame: number): [number, number] {
  return [Math.floor(rng(seed, "grain-offset", frame, 0) * GRAIN_TILE), Math.floor(rng(seed, "grain-offset", frame, 1) * GRAIN_TILE)];
}

/** A grain dot's size in pixels on a canvas whose short side is `short` pixels. */
export const grainScale = (f: Pick<Finish, "grainSize">, short: number) => Math.max(0.25, f.grainSize * (short / 1080));

/** The export bitrate's quality factor (High: × 1.6). */
export const qualityFactor = (q: Recipe["export"]["quality"]) => (q === "high" ? 1.6 : 1);
