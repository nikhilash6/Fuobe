/**
 * FPS Boost and slow motion, as plain math shared by the composer and the ComfyUI provider.
 *
 * The parity studio's FPS Boost reaches 24, 30, 60, 90 or 120 fps (60 by default). Topaz takes the target
 * itself; the open engine interpolates by a whole multiplier m (core FrameInterpolate, 2–16) and keeps
 * every n-th frame (VHS Select Every Nth), so that source fps × m / n = target × slowdown
 * (docs/research/comfyui-oss-4.md §i: 24 → 30 is m 5, n 4; 24 → 90 is m 15, n 4).
 */

/** The frame rates FPS Boost offers (the parity studio's chips); 60 is the default. */
export const FPS_TARGETS = [24, 30, 60, 90, 120] as const;
export const DEFAULT_FPS_TARGET = 60;
/** Slow-motion factors offered: 1 = the clip's own speed, 2 = twice as long. Topaz takes 1–8. */
export const SLOW_MOTION = [1, 2, 4, 8] as const;

export interface FpsPlan {
  /** Frames made for each source frame (1 = no interpolation, only dropping frames). */
  multiplier: number;
  /** Keep every n-th of those frames. */
  every: number;
  /** The frame rate the result plays at: the target when `exact`, else the nearest the clip allows. */
  fps: number;
  exact: boolean;
}

/** FrameInterpolate's largest multiplier. */
export const MAX_MULTIPLIER = 16;
const MAX_EVERY = 64;
/** Relative error below which a ratio counts as exact (header frame rates like 29.97002997…). */
const EXACT = 1e-4;

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The multiplier m and selection n that turn `sourceFps` into `targetFps`, `slowdown` times slower:
 * source × m / n = target × slowdown. The cheapest exact pair wins (the fewest frames interpolated);
 * when none is exact (29.97 fps → 60), the closest pair, and the result plays at
 * source × m / (n × slowdown) so its length is still exactly slowdown × the clip's.
 */
export function fpsPlan(sourceFps: number, targetFps: number, slowdown = 1, maxMultiplier = MAX_MULTIPLIER): FpsPlan {
  if (!(sourceFps > 0) || !(targetFps > 0)) throw new Error("Frame rates must be positive");
  const s = Math.max(1, slowdown);
  const want = (targetFps * s) / sourceFps;
  let best: { m: number; n: number; err: number } | null = null;
  for (let m = 1; m <= maxMultiplier; m++) {
    // The n closest to m / want, and its neighbour (the ratio sits between them).
    const guess = m / want;
    for (const n of [Math.floor(guess), Math.ceil(guess)]) {
      if (n < 1 || n > MAX_EVERY) continue;
      const err = Math.abs((m / n) / want - 1);
      const exact = err < EXACT;
      if (!best) best = { m, n, err };
      else {
        const bestExact = best.err < EXACT;
        // An exact pair beats an approximate one; among exact pairs the first (smallest m) stays;
        // among approximate ones the closest wins.
        if ((exact && !bestExact) || (!exact && !bestExact && err < best.err - 1e-12)) best = { m, n, err };
      }
    }
  }
  if (!best) return { multiplier: 1, every: 1, fps: round3(sourceFps / s), exact: false };
  const fps = (sourceFps * best.m) / (best.n * s);
  return { multiplier: best.m, every: best.n, fps: round3(fps), exact: best.err < EXACT };
}

/** How many frames the open graph writes for `frames` source frames (the last frame is held once more, so ≈ frames × m / n). */
export function fpsFrames(frames: number, plan: Pick<FpsPlan, "multiplier" | "every">): number {
  return Math.ceil((frames * plan.multiplier + 1) / plan.every);
}

/** "24 → 60 fps", "24 → 60 fps · 2× slow motion": the one-line summary under the clip. */
export function fpsSummary(sourceFps: number | undefined, targetFps: number, slowdown = 1): string {
  const from = sourceFps ? `${round3(sourceFps)} → ` : "";
  return `${from}${targetFps} fps${slowdown > 1 ? ` · ${slowdown}× slow motion` : ""}`;
}
