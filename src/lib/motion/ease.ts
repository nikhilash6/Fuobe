/**
 * Kinetic Motion's easing library (pure). Every curve maps progress 0..1 to 0..1 with f(0) = 0 and f(1) = 1, so a
 * scene can put any of them on any window. Springs are closed-form (no integration, no state): a spring's curve is its
 * motion over its own settle time, so a spring placed on a shorter window simply plays faster.
 *
 * Scenes name only the curves in CURVES, so every template shares one motion language.
 */

export type Ease = (p: number) => number;

const clamp01 = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : p);
/** Pins the ends: f(0) = 0 and f(1) = 1 exactly, whatever float error the formula has. */
const pinned =
  (f: Ease): Ease =>
  (p) => {
    if (!(p > 0)) return 0;
    if (p >= 1) return 1;
    return f(p);
  };

export const linear: Ease = (p) => clamp01(p);

const outOf = (f: Ease): Ease => (p) => 1 - f(1 - p);
const inOutOf = (f: Ease): Ease => (p) => (p < 0.5 ? f(2 * p) / 2 : 1 - f(2 - 2 * p) / 2);
const family = (f: Ease) => ({ in: pinned(f), out: pinned(outOf(f)), inOut: pinned(inOutOf(f)) });

export const quad = family((p) => p * p);
export const cubic = family((p) => p * p * p);
export const quart = family((p) => p ** 4);
export const quint = family((p) => p ** 5);
export const sine = family((p) => 1 - Math.cos((p * Math.PI) / 2));
export const expo = family((p) => (p === 0 ? 0 : 2 ** (10 * p - 10)));
export const circ = family((p) => 1 - Math.sqrt(Math.max(0, 1 - p * p)));

/** Pulls back before it goes (in), overshoots and returns (out); `overshoot` 1.70158 is the classic 10 %. */
export const back = (overshoot = 1.70158) => family((p) => p * p * ((overshoot + 1) * p - overshoot));

/** A plucked string: `amplitude` ≥ 1, `period` in progress units. */
export const elastic = (amplitude = 1, period = 0.3) => {
  const a = Math.max(1, amplitude);
  const s = (period / (2 * Math.PI)) * Math.asin(1 / a);
  return family((p) => (p === 0 || p === 1 ? p : -(a * 2 ** (10 * (p - 1)) * Math.sin(((p - 1 - s) * 2 * Math.PI) / period))));
};

const bounceOut: Ease = (p) => {
  const n = 7.5625;
  const d = 2.75;
  if (p < 1 / d) return n * p * p;
  if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
  if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
  return n * (p -= 2.625 / d) * p + 0.984375;
};
export const bounce = family((p) => 1 - bounceOut(1 - p));

/**
 * A CSS cubic-bezier(x1, y1, x2, y2): x is solved for by Newton steps, with bisection where the slope is too flat, to
 * 1e-7, so the curve matches a browser's within 1e-6.
 */
export function bezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  const solve = (x: number): number => {
    let u = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(u) - x;
      if (Math.abs(err) < 1e-7) return u;
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    let lo = 0;
    let hi = 1;
    u = x;
    for (let i = 0; i < 60; i++) {
      const v = sx(u);
      if (Math.abs(v - x) < 1e-7) return u;
      if (v < x) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return u;
  };
  return pinned((p) => sy(solve(p)));
}

export interface SpringOptions {
  stiffness: number;
  damping: number;
  mass?: number;
  /** Starting speed, in progress units a second (0: from rest). */
  velocity?: number;
}

/** The spring's position (0 at rest at the start, 1 at its target) `t` seconds in: the closed-form damped oscillator. */
export function springAt(o: SpringOptions, t: number): number {
  const m = o.mass ?? 1;
  const w0 = Math.sqrt(o.stiffness / m);
  const zeta = o.damping / (2 * Math.sqrt(o.stiffness * m));
  const x0 = -1;
  const v0 = o.velocity ?? 0;
  let x: number;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    x = Math.exp(-zeta * w0 * t) * (x0 * Math.cos(wd * t) + ((v0 + zeta * w0 * x0) / wd) * Math.sin(wd * t));
  } else if (zeta === 1) {
    x = Math.exp(-w0 * t) * (x0 + (v0 + w0 * x0) * t);
  } else {
    const r = Math.sqrt(zeta * zeta - 1);
    const r1 = -w0 * (zeta - r);
    const r2 = -w0 * (zeta + r);
    const c2 = (v0 - r1 * x0) / (r2 - r1);
    const c1 = x0 - c2;
    x = c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t);
  }
  return 1 + x;
}

const settleCache = new Map<string, number>();

/** When the spring stays within 0.1 % of its target for good (seconds; searched on a 1 ms grid up to 10 s). */
export function springDuration(o: SpringOptions): number {
  const key = `${o.stiffness}|${o.damping}|${o.mass ?? 1}|${o.velocity ?? 0}`;
  const hit = settleCache.get(key);
  if (hit !== undefined) return hit;
  let last = 0;
  for (let ms = 0; ms <= 10_000; ms++) if (Math.abs(springAt(o, ms / 1000) - 1) > 0.001) last = ms;
  const d = (last + 1) / 1000;
  settleCache.set(key, d);
  return d;
}

/** A spring as a curve over its own settle time (it reaches 1 exactly at p = 1). */
export function spring(o: SpringOptions): Ease {
  const d = springDuration(o);
  return pinned((p) => springAt(o, p * d));
}

/** `n` equal jumps (the last one at p = 1). */
export const steps =
  (n: number): Ease =>
  (p) =>
    p >= 1 ? 1 : p <= 0 ? 0 : Math.floor(p * n) / n;

/** Stays at the start until the end. */
export const hold: Ease = (p) => (p >= 1 ? 1 : 0);

export const SPRINGS = {
  pop: { stiffness: 420, damping: 26 },
  settle: { stiffness: 180, damping: 20 },
} as const satisfies Record<string, SpringOptions>;

/**
 * Fuobe's named curves: the only ones scenes use by name. enter: a soft expo-out for arrivals; glide: a gentler
 * cubic-out for headlines and wide moves (the motion stays visible through its window); exit: leaving; move: an in-place
 * move; pop: a button or badge, about 7 % past its size and back; settle: logos and large type; snap: small, UI-like
 * moves; draw: strokes; drift: a slow camera that comes to rest on the last frame.
 */
export const CURVES = {
  enter: bezier(0.16, 1, 0.3, 1),
  glide: bezier(0.33, 1, 0.68, 1),
  drift: sine.out,
  exit: bezier(0.7, 0, 0.84, 0),
  move: bezier(0.65, 0, 0.35, 1),
  pop: spring(SPRINGS.pop),
  settle: spring(SPRINGS.settle),
  snap: bezier(0.2, 0, 0, 1),
  draw: bezier(0.45, 0, 0.2, 1),
  linear,
} satisfies Record<string, Ease>;

export type CurveName = keyof typeof CURVES;

export const curve = (name: CurveName): Ease => CURVES[name];
