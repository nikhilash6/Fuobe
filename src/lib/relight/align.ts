/**
 * Lines the relit picture up with the photo. The model's output comes back a few pixels off (and about 1 % scaled), and
 * blending two pictures out of register reads as a double exposure. A port of the registration in linoyts' Qwen-Image 2.1 Relight Space: edge
 * maps of both pictures (robust to the light changing), phase correlation on a grid of half-overlapping tiles with a
 * sub-pixel peak, tiles with a weak peak or a big shift dropped, then a robust per-axis scale-and-shift fit. Pure; the
 * page runs it in a worker (src/components/relight/align.worker.ts) and the shader applies the fit.
 *
 * Both pictures are measured as WORK × WORK grey maps (each axis resampled on its own: the fit is per axis, so the
 * squash does not matter) and the fit comes back in uv units (0..1 of the picture).
 */
import type { AlignFit } from "./shader";

export const WORK = 512;
const TILE = 128;
const MAX_SHIFT = 40;
const MIN_PEAK = 0.03;

/** Edge strength, normalised by its mean (central differences). */
export function edgeMap(g: Float32Array, w: number, h: number): Float32Array {
  const m = new Float32Array(w * h);
  let sum = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = g[i + 1] - g[i - 1];
      const gy = g[i + w] - g[i - w];
      const v = Math.sqrt(gx * gx + gy * gy);
      m[i] = v;
      sum += v;
    }
  }
  const mean = sum / (w * h) + 1e-6;
  for (let i = 0; i < m.length; i++) m[i] /= mean;
  return m;
}

/** In-place radix-2 FFT of one row (re, im), length a power of two. */
function fft1(re: Float64Array, im: Float64Array, inverse: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
}

/** 2D FFT of an n × n grid (rows then columns), in place. */
function fft2(re: Float64Array, im: Float64Array, n: number, inverse: boolean) {
  const r = new Float64Array(n);
  const c = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    r.set(re.subarray(y * n, y * n + n));
    c.set(im.subarray(y * n, y * n + n));
    fft1(r, c, inverse);
    re.set(r, y * n);
    im.set(c, y * n);
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      r[y] = re[y * n + x];
      c[y] = im[y * n + x];
    }
    fft1(r, c, inverse);
    for (let y = 0; y < n; y++) {
      re[y * n + x] = r[y];
      im[y * n + x] = c[y];
    }
  }
}

const hann = (() => {
  const w = new Float64Array(TILE);
  for (let i = 0; i < TILE; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (TILE - 1));
  return w;
})();

/** The sub-pixel shift of tile b relative to tile a (content at a's x sits at b's x − dx), and the peak's strength. */
export function phaseShift(a: Float64Array, b: Float64Array, n = TILE): { dx: number; dy: number; peak: number } {
  const mean = (t: Float64Array) => t.reduce((s, v) => s + v, 0) / t.length;
  const ma = mean(a);
  const mb = mean(b);
  const ar = new Float64Array(n * n);
  const ai = new Float64Array(n * n);
  const br = new Float64Array(n * n);
  const bi = new Float64Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const w = (n === TILE ? hann[y] * hann[x] : 1);
      ar[y * n + x] = (a[y * n + x] - ma) * w;
      br[y * n + x] = (b[y * n + x] - mb) * w;
    }
  fft2(ar, ai, n, false);
  fft2(br, bi, n, false);
  // R = A · conj(B), normalised.
  for (let i = 0; i < n * n; i++) {
    const re = ar[i] * br[i] + ai[i] * bi[i];
    const im = ai[i] * br[i] - ar[i] * bi[i];
    const mag = Math.hypot(re, im) + 1e-6;
    ar[i] = re / mag;
    ai[i] = im / mag;
  }
  fft2(ar, ai, n, true);
  let best = 0;
  for (let i = 1; i < n * n; i++) if (ar[i] > ar[best]) best = i;
  const py = Math.floor(best / n);
  const px = best % n;
  const at = (y: number, x: number) => ar[((y + n) % n) * n + ((x + n) % n)];
  const sub = (c0: number, cm: number, cp: number) => {
    const d = cm - 2 * c0 + cp;
    return Math.abs(d) < 1e-9 ? 0 : (0.5 * (cm - cp)) / d;
  };
  let dy = py + sub(at(py, px), at(py - 1, px), at(py + 1, px));
  let dx = px + sub(at(py, px), at(py, px - 1), at(py, px + 1));
  if (dy > n / 2) dy -= n;
  if (dx > n / 2) dx -= n;
  return { dx, dy, peak: ar[best] };
}

/** Robust line fit v = s·p + t: least squares, then refit without the outliers (up to three times). */
export function fitAxis(p: number[], v: number[]): { s: number; t: number } {
  let keep = p.map(() => true);
  let s = 1;
  let t = 0;
  for (let round = 0; round < 3; round++) {
    const idx = p.map((_, i) => i).filter((i) => keep[i]);
    const n = idx.length;
    const mp = idx.reduce((a, i) => a + p[i], 0) / n;
    const mv = idx.reduce((a, i) => a + v[i], 0) / n;
    let num = 0;
    let den = 0;
    for (const i of idx) {
      num += (p[i] - mp) * (v[i] - mv);
      den += (p[i] - mp) ** 2;
    }
    s = den > 1e-9 ? num / den : 1;
    t = mv - s * mp;
    const res = p.map((pi, i) => Math.abs(v[i] - (s * pi + t)));
    const kept = idx.map((i) => res[i]).sort((a, b) => a - b);
    const thr = Math.max(1, 2.5 * kept[Math.floor(kept.length / 2)]);
    const next = res.map((r) => r <= thr);
    if (next.filter(Boolean).length < 3 || next.every((k, i) => k === keep[i])) break;
    keep = next;
  }
  return { s, t };
}

export interface AlignResult {
  fit: AlignFit;
  /** Tiles that agreed (for the owner's diagnostics). */
  tiles: number;
}

/**
 * The fit that puts the relit picture over the photo, from two WORK × WORK grey maps (0..1). Null when too few tiles
 * have a clear match (a featureless picture): the blend then uses the pictures as they are.
 */
export function alignFit(photoGray: Float32Array, relitGray: Float32Array, size = WORK): AlignResult | null {
  const O = edgeMap(photoGray, size, size);
  const R = edgeMap(relitGray, size, size);
  const step = TILE / 2;
  const pts: [number, number, number, number][] = [];
  const a = new Float64Array(TILE * TILE);
  const b = new Float64Array(TILE * TILE);
  for (let y0 = 0; y0 + TILE <= size; y0 += step) {
    for (let x0 = 0; x0 + TILE <= size; x0 += step) {
      let s = 0;
      let s2 = 0;
      for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) {
          const va = O[(y0 + y) * size + x0 + x];
          a[y * TILE + x] = va;
          b[y * TILE + x] = R[(y0 + y) * size + x0 + x];
          s += va;
          s2 += va * va;
        }
      const n = TILE * TILE;
      const std = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
      if (std < 0.3) continue;
      const { dx, dy, peak } = phaseShift(a, b);
      if (Math.abs(dx) < MAX_SHIFT && Math.abs(dy) < MAX_SHIFT && peak > MIN_PEAK) pts.push([x0 + TILE / 2, y0 + TILE / 2, dx, dy]);
    }
  }
  if (pts.length < 4) return null;
  // Content at photo (x, y) sits at relit (x − dx, y − dy): relit_x = sx·x + tx.
  const fx = fitAxis(
    pts.map((q) => q[0]),
    pts.map((q) => q[0] - q[2]),
  );
  const fy = fitAxis(
    pts.map((q) => q[1]),
    pts.map((q) => q[1] - q[3]),
  );
  // Pixel centres: u = (x + 0.5) / size.
  const toUv = (f: { s: number; t: number }) => ({ s: f.s, t: (f.t + 0.5 - 0.5 * f.s) / size });
  const ux = toUv(fx);
  const uy = toUv(fy);
  return { fit: { sx: ux.s, tx: ux.t, sy: uy.s, ty: uy.t }, tiles: pts.length };
}

/** The relit pixel position (in work pixels) a fit maps photo pixel x to: for tests and diagnostics. */
export function mapPx(fit: AlignFit, axis: "x" | "y", px: number, size = WORK): number {
  const s = axis === "x" ? fit.sx : fit.sy;
  const t = axis === "x" ? fit.tx : fit.ty;
  return (s * ((px + 0.5) / size) + t) * size - 0.5;
}
