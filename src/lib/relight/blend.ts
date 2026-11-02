/**
 * The Intensity blend on the CPU: the reference for the shader's result mode (tests) and the path for a browser without
 * WebGL. All maths in linear light, RGBA in and out (alpha kept from the original).
 *
 * - Plain mix: out = mix(O, R, t).
 * - Light transfer: ratio = blur(R) / blur(O) per channel (clamped 0..8), out = O · mix(1, ratio, t): the original's
 *   full detail stays and only the light changes.
 */
import { srgbToLinear } from "./lights";

const LUT = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) t[i] = srgbToLinear(i);
  return t;
})();

export function linearToSrgb8(v: number): number {
  const c = Math.max(0, v);
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

/** Linear RGB planes of an RGBA buffer. */
function linear(px: ArrayLike<number>, n: number): Float32Array {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = LUT[px[i * 4]];
    out[i * 3 + 1] = LUT[px[i * 4 + 1]];
    out[i * 3 + 2] = LUT[px[i * 4 + 2]];
  }
  return out;
}

/** A box blur of radius r along one axis of a 3-channel image (running sum, edges clamped). */
function boxAxis(src: Float32Array, w: number, h: number, r: number, horizontal: boolean): Float32Array {
  const out = new Float32Array(src.length);
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const idx = (line: number, k: number) => (horizontal ? line * w + k : k * w + line) * 3;
  const win = 2 * r + 1;
  for (let line = 0; line < lines; line++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[idx(line, Math.min(len - 1, Math.max(0, k))) + c];
      for (let k = 0; k < len; k++) {
        out[idx(line, k) + c] = sum / win;
        sum += src[idx(line, Math.min(len - 1, k + r + 1)) + c] - src[idx(line, Math.max(0, k - r)) + c];
      }
    }
  }
  return out;
}

/** About a Gaussian of σ (three box passes per axis). */
export function blurLinear(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const r = Math.max(0, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2 - 0.5));
  if (!r) return src.slice();
  let a = src;
  for (let i = 0; i < 3; i++) a = boxAxis(boxAxis(a, w, h, r, true), w, h, r, false);
  return a;
}

export type Rgba = Uint8ClampedArray | Uint8Array;

/** Plain mix in linear light. t = 0 returns the original exactly; t = 1 the relit picture. */
export function blendPlain(o: Rgba, r: Rgba, t: number): Uint8ClampedArray<ArrayBuffer> {
  const n = o.length / 4;
  const out = new Uint8ClampedArray(o.length);
  const k = Math.min(1, Math.max(0, t));
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const j = i * 4 + c;
      out[j] = k === 0 ? o[j] : k === 1 ? r[j] : linearToSrgb8(LUT[o[j]] * (1 - k) + LUT[r[j]] * k);
    }
    out[i * 4 + 3] = o[i * 4 + 3];
  }
  return out;
}

/** Light transfer: the original's detail with the relit picture's light. σ in pixels (about 1.2 % of the short side). */
export function blendTransfer(o: Rgba, r: Rgba, w: number, h: number, t: number, sigma = 0.012 * Math.min(w, h)): Uint8ClampedArray<ArrayBuffer> {
  const n = w * h;
  const k = Math.min(1, Math.max(0, t));
  const out = new Uint8ClampedArray(o.length);
  if (k === 0) {
    out.set(o);
    return out;
  }
  const O = linear(o, n);
  const bo = blurLinear(O, w, h, sigma);
  const br = blurLinear(linear(r, n), w, h, sigma);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const j = i * 3 + c;
      const ratio = Math.min(8, Math.max(0, br[j] / Math.max(bo[j], 0.004)));
      out[i * 4 + c] = linearToSrgb8(O[j] * (1 + (ratio - 1) * k));
    }
    out[i * 4 + 3] = o[i * 4 + 3];
  }
  return out;
}
