/**
 * Kinetic Motion's clock (pure). A scene is sampled at an absolute time t in seconds, never stepped: frame i of a clip
 * at `fps` is t = i / fps, so a preview that drops a frame skips ahead and an export that seeks anywhere gets the same
 * picture. Every helper here is a plain function of its arguments.
 */

/** The frames of a clip `duration` seconds long at `fps`: round(duration × fps), at least 1 (2.5 s at 25 fps is 63). */
export const frameCount = (duration: number, fps: number): number => Math.max(1, Math.round(duration * fps));

/** When frame `i` is shown. */
export const frameTime = (i: number, fps: number): number => i / fps;

/** The frame `t` falls in, as its own time (a time exactly on a frame stays on it, despite float error). */
export const quantize = (t: number, fps: number): number => Math.floor(t * fps + 1e-6) / fps;

export const clamp = (v: number, lo = 0, hi = 1): number => (v < lo ? lo : v > hi ? hi : v);

/** `t` kept inside a clip of `duration` seconds. */
export const clampTime = (t: number, duration: number): number => clamp(t, 0, duration);

/** Whether `t` is inside the window [a, b). */
export const inWindow = (t: number, [a, b]: readonly [number, number]): boolean => t >= a && t < b;

/** How far `t` is through the window [a, b], from 0 (before it) to 1 (after it). */
export const local = (t: number, a: number, b: number): number => (b <= a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));

/** a → b by p (not clamped). */
export const mix = (a: number, b: number, p: number): number => a + (b - a) * p;
