/**
 * Any Angle's front view, measured per photo (pure; the server decodes the pictures with sharp and calls it).
 *
 * TripoSplat drops its own camera estimate, and turns every subject into a pose of its own, so the camera that sees the
 * 3D copy as the photo does is found by looking: the 3D build renders a turntable (48 frames at a fixed height and
 * distance, src/lib/catalog/any-angle.ts SWEEP) and each frame is compared with the photo's cut-out by the overlap of
 * the two silhouettes and the colour correlation inside them, both cropped to the subject and scaled to one height
 * (the measure the GPU test calibrated). The best frame gives the turn (refined between frames),
 * and the silhouettes' heights give the distance at which the subject fills the frame as it fills the photo.
 *
 * The cut-out also tells a person from an object: a head on a narrower neck over wider shoulders. Its middle gives the
 * close-up's aim, and its size how much of the photo the face takes (a portrait keeps its high angle lower).
 */
import { SWEEP, wrapYaw, type FrontView } from "./catalog/any-angle";

/** One channel (a mask: 0–255) or three (RGB), row by row. */
export interface Picture {
  width: number;
  height: number;
  channels: 1 | 3;
  data: Uint8Array | Uint8ClampedArray;
}

export interface SweepFrame {
  rgb: Picture;
  mask: Picture;
}

/** The scale every silhouette is compared at. */
const CROP_H = 160;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The box of the mask's pixels above half (null when there are too few to measure). */
export function maskBox(m: Picture, min = 30): Box | null {
  let x0 = m.width;
  let y0 = m.height;
  let x1 = -1;
  let y1 = -1;
  let n = 0;
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (m.data[(y * m.width + x) * m.channels] > 127) {
        n++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return n >= min ? { x0, y0, x1: x1 + 1, y1: y1 + 1 } : null;
}

/** A box of a picture scaled to w × h by averaging (area): channels as floats 0–1. */
function resample(p: Picture, b: Box, w: number, h: number): Float32Array {
  const c = p.channels;
  const out = new Float32Array(w * h * c);
  const sx = (b.x1 - b.x0) / w;
  const sy = (b.y1 - b.y0) / h;
  for (let y = 0; y < h; y++) {
    const ya = b.y0 + y * sy;
    const yb = Math.max(ya + 1e-6, b.y0 + (y + 1) * sy);
    for (let x = 0; x < w; x++) {
      const xa = b.x0 + x * sx;
      const xb = Math.max(xa + 1e-6, b.x0 + (x + 1) * sx);
      const acc = [0, 0, 0];
      let wsum = 0;
      for (let yy = Math.floor(ya); yy < Math.ceil(yb); yy++) {
        const wy = Math.min(yb, yy + 1) - Math.max(ya, yy);
        if (wy <= 0 || yy < 0 || yy >= p.height) continue;
        for (let xx = Math.floor(xa); xx < Math.ceil(xb); xx++) {
          const wx = Math.min(xb, xx + 1) - Math.max(xa, xx);
          if (wx <= 0 || xx < 0 || xx >= p.width) continue;
          const k = (yy * p.width + xx) * c;
          for (let ch = 0; ch < c; ch++) acc[ch] += p.data[k + ch] * wx * wy;
          wsum += wx * wy;
        }
      }
      for (let ch = 0; ch < c; ch++) out[(y * w + x) * c + ch] = wsum ? acc[ch] / wsum / 255 : 0;
    }
  }
  return out;
}

/** sRGB (0–1) to CIE L*a*b* (D65). */
function lab(r: number, g: number, b: number): [number, number, number] {
  const lin = (u: number) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const Y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const Z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}

/** A subject cropped to its box and scaled to CROP_H high: colour in Lab, the silhouette, and the box it came from. */
interface Crop {
  w: number;
  lab: Float32Array;
  mask: Uint8Array;
  box: Box;
}

function crop(rgb: Picture, mask: Picture, alpha: boolean): Crop | null {
  const box = maskBox(mask);
  if (!box) return null;
  const w = Math.max(1, Math.round(((box.x1 - box.x0) * CROP_H) / (box.y1 - box.y0)));
  const col = resample(rgb, box, w, CROP_H);
  const m = resample(mask, box, w, CROP_H);
  const sil = new Uint8Array(w * CROP_H);
  const out = new Float32Array(w * CROP_H * 3);
  for (let i = 0; i < w * CROP_H; i++) {
    sil[i] = m[i * mask.channels] > 0.5 ? 1 : 0;
    // The photo is compared as its cut-out (black outside the subject), as the render shows it.
    const a = alpha ? m[i * mask.channels] : 1;
    const [L, A, B] = lab(col[i * 3] * a, col[i * 3 + 1] * a, col[i * 3 + 2] * a);
    out[i * 3] = L;
    out[i * 3 + 1] = A;
    out[i * 3 + 2] = B;
  }
  return { w, lab: out, mask: sil, box };
}

/** Silhouette overlap and colour correlation of two crops, centred side by side. */
export function compare(a: Crop, b: Crop): { iou: number; ncc: number } {
  const W = 2 * Math.max(a.w, b.w) + 4;
  const ox = (W - a.w) >> 1;
  const bx = (W - b.w) >> 1;
  let inter = 0;
  let union = 0;
  const both: number[] = [];
  for (let y = 0; y < CROP_H; y++) {
    for (let x = 0; x < W; x++) {
      const ia = x - ox;
      const ib = x - bx;
      const ma = ia >= 0 && ia < a.w ? a.mask[y * a.w + ia] : 0;
      const mb = ib >= 0 && ib < b.w ? b.mask[y * b.w + ib] : 0;
      if (ma || mb) union++;
      if (ma && mb) {
        inter++;
        both.push(y * a.w + ia, y * b.w + ib);
      }
    }
  }
  const iou = union ? inter / union : 0;
  const n = both.length / 2;
  if (n < 50) return { iou, ncc: 0 };
  const ma = [0, 0, 0];
  const mb = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      ma[c] += a.lab[both[2 * i] * 3 + c];
      mb[c] += b.lab[both[2 * i + 1] * 3 + c];
    }
  }
  for (let c = 0; c < 3; c++) {
    ma[c] /= n;
    mb[c] /= n;
  }
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const u = a.lab[both[2 * i] * 3 + c] - ma[c];
      const v = b.lab[both[2 * i + 1] * 3 + c] - mb[c];
      ab += u * v;
      aa += u * u;
      bb += v * v;
    }
  }
  return { iou, ncc: ab / (Math.sqrt(aa * bb) + 1e-6) };
}

/** What the cut-out says about a head: where its middle is, and how tall it is (rows of the mask). */
export interface Head {
  /** The head's middle, as a share of the subject's height from its top. */
  middle: number;
  /** The head's height (crown to neck) as a share of the photo's height. */
  share: number;
}

/**
 * A head on shoulders in a cut-out: under the top, a row much narrower than the solid blob above it (the neck), with a
 * part much wider below (the shoulders). A bag's handle (thin straps above the body) isn't solid, and a bottle's cap
 * isn't wider than its neck, so neither counts. Null when there is none.
 */
export function findHead(mask: Picture): Head | null {
  const box = maskBox(mask);
  if (!box) return null;
  const H = box.y1 - box.y0;
  if (H < 40) return null;
  const count = new Float32Array(H);
  const extent = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    let n = 0;
    let lo = -1;
    let hi = -1;
    const row = (box.y0 + y) * mask.width;
    for (let x = box.x0; x < box.x1; x++) {
      if (mask.data[(row + x) * mask.channels] > 127) {
        n++;
        if (lo < 0) lo = x;
        hi = x;
      }
    }
    count[y] = n;
    extent[y] = lo < 0 ? 0 : hi - lo + 1;
  }
  // Smooth the widths over about 2% of the height (hair and edges are ragged).
  const r = Math.max(1, Math.round(H * 0.01));
  const smooth = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    let s = 0;
    let k = 0;
    for (let d = -r; d <= r; d++) {
      if (y + d >= 0 && y + d < H) {
        s += count[y + d];
        k++;
      }
    }
    smooth[y] = s / k;
  }
  // The neck: the row least wide against the widest above it, under a solid blob (every row at least 60% filled between
  // its edges) and over rows a fifth wider; a row nearer the top wins a close call (a waist is lower down).
  let best: { y: number; cost: number } | null = null;
  let head = 0;
  let solidMin = 1;
  for (let y = 0; y < Math.round(H * 0.6); y++) {
    if (y >= Math.round(H * 0.05) && head > 0) {
      const neck = smooth[y];
      let below = 0;
      for (let t = y + 1; t < Math.min(H, y + Math.round(H * 0.25)); t++) below = Math.max(below, smooth[t]);
      const ratio = neck / head;
      const cost = ratio + 0.3 * (y / H);
      if (neck > 0 && ratio <= 0.9 && below >= 1.2 * neck && solidMin >= 0.6 && (!best || cost < best.cost)) best = { y, cost };
    }
    head = Math.max(head, smooth[y]);
    // The crown's first rows are a few strands of hair: they don't count against the blob.
    if (y >= Math.round(H * 0.02) && extent[y] > 0) solidMin = Math.min(solidMin, count[y] / extent[y]);
  }
  if (!best) return null;
  // The face: halfway from the crown to the neck.
  return { middle: (best.y * 0.5) / H, share: best.y / mask.height };
}

/**
 * Measure the front view: the photo (RGB) and its cut-out, against the turntable's frames (RGB and coverage masks,
 * frame k at SWEEP.yaw + 360·k/n). Null when nothing could be compared.
 */
export function measureFront(photo: { rgb: Picture; mask: Picture }, frames: SweepFrame[], sweep: { yaw: number; pitch: number; distance: number; fov: number } = SWEEP): FrontView | null {
  const ref = crop(photo.rgb, photo.mask, true);
  if (!ref || !frames.length) return null;
  const scores: number[] = [];
  const crops: (Crop | null)[] = [];
  for (const f of frames) {
    const c = crop(f.rgb, f.mask, false);
    crops.push(c);
    if (!c) {
      scores.push(-Infinity);
      continue;
    }
    const { iou, ncc } = compare(ref, c);
    scores.push(0.5 * iou + 0.5 * ncc);
  }
  let k = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[k]) k = i;
  const best = crops[k];
  if (!best || !Number.isFinite(scores[k])) return null;
  const n = frames.length;
  const step = 360 / n;
  // Between frames: the top of a parabola through the best frame and its neighbours.
  const a = scores[(k - 1 + n) % n];
  const c = scores[(k + 1) % n];
  const curve = a - 2 * scores[k] + c;
  const shift = Number.isFinite(a) && Number.isFinite(c) && curve < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / curve)) : 0;
  const yaw = wrapYaw(sweep.yaw + (k + shift) * step);
  // The distance at which the subject fills the frame's short side as it fills the photo's.
  const frame = frames[k].mask;
  const shortP = Math.min(photo.mask.width, photo.mask.height);
  const shortR = Math.min(frame.width, frame.height);
  const fillP = (ref.box.y1 - ref.box.y0) / shortP;
  const fillR = (best.box.y1 - best.box.y0) / shortR;
  const distance = (sweep.distance * fillR) / fillP;
  // The face: its place on the photo's silhouette, at the same place on the frame's, back into the 3D view's height.
  const f = shortR / 2 / Math.tan((sweep.fov * Math.PI) / 360);
  const p = (sweep.pitch * Math.PI) / 180;
  // A row of the frame back to a height in the 3D view (a point on the upright axis through the target).
  const heightAt = (row: number) => {
    const off = frame.height / 2 - row;
    return (off * sweep.distance) / (f * Math.cos(p) + off * Math.sin(p));
  };
  const head = findHead(photo.mask);
  const faceY = head ? heightAt(best.box.y0 + head.middle * (best.box.y1 - best.box.y0)) : 0;
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return {
    yaw: Math.round(yaw * 10) / 10,
    pitch: sweep.pitch,
    distance: Math.round(distance * 100) / 100,
    fov: sweep.fov,
    faceY: r3(faceY),
    person: !!head,
    headShare: head ? r3(head.share) : 0,
    score: r3(scores[k]),
    span: [r3(heightAt(best.box.y1)), r3(heightAt(best.box.y0))],
  };
}
