/**
 * What the ComfyUI stand-in (fake-local-comfy.ts) makes of a live edit graph (src/lib/live/graph.ts): real pixels, so
 * the bookkeeping can be measured. An "edit" paints a rectangle chosen by the prompt and seed (8–20 % of the picture)
 * in a colour chosen by them, at the model's size (the resolution's area, the base's shape), then scales it back up.
 * With `lossy`, the whole edited frame also gets ±2 noise and a slight blur, a stand-in for a VAE round trip. The paste
 * back finds what changed the way Fuobe's node does (changeMask: both pictures blurred at the model's size, their Lab
 * difference over the node's threshold, specks removed, grown and feathered), so it doesn't know where it painted;
 * mode "off" keeps the whole edit, "mask" uses the painted region. Only erasable TypeScript (runs under plain Node).
 */
import { createHash } from "node:crypto";
import sharpLib from "sharp";

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export interface LiveRender {
  data: Buffer;
  type: "image/webp" | "image/png";
  width: number;
  height: number;
  /** The model's size (sets the render's time). */
  modelW: number;
  modelH: number;
  /** In the output's pixels: the box around every pixel the paste-back took from the edit, or null (none, or the whole frame). */
  touched: [number, number, number, number] | null;
  /** The share of the picture the change mask covered (0 for text to image). */
  changed?: number;
  base?: string;
}

export const isLiveGraph = (g: Graph) => Object.values(g).some((n) => n?.class_type === "SaveImageFuobeLive");

/** The model's size of a live graph, without decoding anything (for the stand-in's timing). */
export function liveModelSize(g: Graph, inputSize: (name: string) => { w: number; h: number } | null): { w: number; h: number } {
  const enc = g["30"]?.inputs ?? {};
  if (!g["10"]) return { w: Number(enc.width) || 512, h: Number(enc.height) || 512 };
  const res = Number(g["20"]?.inputs?.resolution) || 512;
  const s = inputSize(String(g["10"].inputs.image)) ?? { w: res, h: res };
  const r = s.w / s.h;
  return { w: Math.max(32, Math.round(Math.sqrt(res * res * r) / 32) * 32), h: Math.max(32, Math.round(Math.sqrt((res * res) / r) / 32) * 32) };
}

const hashInts = (s: string, n: number) => {
  const d = createHash("sha256").update(s).digest();
  return Array.from({ length: n }, (_, i) => d.readUInt16BE((i * 2) % 30));
};

/** A seeded noise generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sharp = async () => sharpLib;

async function decode(bytes: Buffer): Promise<{ data: Buffer; w: number; h: number }> {
  const s = await sharp();
  const { data, info } = await s(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

async function resize(data: Buffer, w: number, h: number, tw: number, th: number): Promise<Buffer> {
  if (w === tw && h === th) return Buffer.from(data);
  const s = await sharp();
  return s(data, { raw: { width: w, height: h, channels: 3 } }).resize(tw, th, { kernel: "lanczos3", fit: "fill" }).raw().toBuffer();
}

async function encode(data: Buffer, w: number, h: number, format: string, quality: number): Promise<Buffer> {
  const s = await sharp();
  const img = s(data, { raw: { width: w, height: h, channels: 3 } });
  return format === "png" ? img.png({ compressionLevel: 1 }).toBuffer() : img.webp({ quality }).toBuffer();
}

/** sRGB bytes to CIE Lab (D65), as fuobe_live.py's to_lab. */
function toLab(px: Buffer): Float32Array {
  const out = new Float32Array(px.length);
  const lin = (v: number) => {
    const c = v / 255;
    return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
  };
  const e = 216 / 24389;
  const f = (t: number) => (t > e ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  for (let i = 0; i < px.length; i += 3) {
    const r = lin(px[i]);
    const g = lin(px[i + 1]);
    const b = lin(px[i + 2]);
    const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    out[i] = 116 * fy - 16;
    out[i + 1] = 500 * (fx - fy);
    out[i + 2] = 200 * (fy - fz);
  }
  return out;
}

/** A max (or, with min, a min) filter over a (2r+1) square, separably. */
function boxMax(m: Uint8Array, w: number, h: number, r: number, min = false): Uint8Array {
  const pick = min ? Math.min : Math.max;
  const tmp = new Uint8Array(m.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = m[y * w + x];
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) v = pick(v, m[y * w + k]);
      tmp[y * w + x] = v;
    }
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x];
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) v = pick(v, tmp[k * w + x]);
      out[y * w + x] = v;
    }
  return out;
}

/** The node's threshold (PasteBackFuobeLive threshold 0.06: a Lab difference of 6), blur 3, grow 8, feather 24. */
export const MASK = { threshold: 6, blur: 3, grow: 8, feather: 24 } as const;

/**
 * Where an edit changed a base, as fuobe_live.py's change_mask: compared at the edit's own size (w x h) after a blur of
 * both, a Lab difference over MASK.threshold, specks removed, grown, feathered, then scaled to the base's size (W x H).
 * 0..255 per pixel; exactly 0 where nothing changed.
 */
export async function changeMask(baseFull: Buffer, W: number, H: number, editAt: Buffer, ew: number, eh: number): Promise<Uint8Array> {
  const s = await sharp();
  // The stand-in compares at 512 px at most (it shares a process with the browser checks: it must stay quick).
  const f = Math.min(1, 512 / Math.max(ew, eh));
  const w = Math.max(8, Math.round(ew * f));
  const h = Math.max(8, Math.round(eh * f));
  const edit = await resize(editAt, ew, eh, w, h);
  const sigma = Math.max(0.3, (MASK.blur / 2) * f);
  const small = await resize(baseFull, W, H, w, h);
  const blur = (px: Buffer) => s(px, { raw: { width: w, height: h, channels: 3 } }).blur(sigma).raw().toBuffer();
  const [a, b] = await Promise.all([blur(small), blur(edit)]);
  const la = toLab(a);
  const lb = toLab(b);
  let m: Uint8Array = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) {
    const j = i * 3;
    m[i] = Math.hypot(la[j] - lb[j], la[j + 1] - lb[j + 1], la[j + 2] - lb[j + 2]) > MASK.threshold ? 255 : 0;
  }
  m = boxMax(m, w, h, 1, true);
  const k = w / W;
  m = boxMax(m, w, h, Math.max(1, Math.round(MASK.grow * k)));
  const feather = Math.max(1, MASK.feather * k) / 3;
  const soft = await s(Buffer.from(m), { raw: { width: w, height: h, channels: 1 } }).blur(Math.max(0.3, feather)).extractChannel(0).raw().toBuffer();
  const up = await s(soft, { raw: { width: w, height: h, channels: 1 } }).resize(W, H, { kernel: "linear", fit: "fill" }).extractChannel(0).raw().toBuffer();
  const out = new Uint8Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = up[i] < 1 ? 0 : up[i];
  return out;
}

/** Render a live graph from the stand-in's input folder. Throws like the node would when a picture is missing. */
export async function renderLive(g: Graph, inputs: Map<string, Buffer>, opts: { lossy?: boolean } = {}): Promise<LiveRender> {
  const prompt = String(g["30"]?.inputs?.prompt ?? "");
  const seed = Number(g["70"]?.inputs?.noise_seed ?? 0);
  const save = g["90"]?.inputs ?? {};
  const format = save.format === "png" ? "png" : "webp";
  const quality = Number(save.quality) || 85;
  const [hx, hy, hw, hh, r, gr, b] = hashInts(`${prompt}\u0000${seed}`, 7);
  const colour = [r % 256, gr % 256, b % 256];

  if (!g["10"]) {
    // Text to image: a gradient and a rectangle, at the latent's size.
    const w = Number(g["30"].inputs.width);
    const h = Number(g["30"].inputs.height);
    const px = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        px[i] = (colour[0] + (x * 128) / w) & 255;
        px[i + 1] = (colour[1] + (y * 128) / h) & 255;
        px[i + 2] = (colour[2] + ((x + y) * 64) / (w + h)) & 255;
      }
    return { data: await encode(px, w, h, format, quality), type: format === "png" ? "image/png" : "image/webp", width: w, height: h, modelW: w, modelH: h, touched: null };
  }

  const read = (id: string) => {
    const name = String(g[id]?.inputs?.image ?? "");
    const bytes = inputs.get(name);
    if (!bytes) throw Object.assign(new Error("Live edit reads only pictures Fuobe sent"), { nodeType: "LoadImageFuobeLive", node: id });
    return bytes;
  };
  const base = await decode(read("10"));
  const mask = g["14"] ? await decode(read("14")) : null;
  const { w: W, h: H } = base;
  const res = Number(g["20"]?.inputs?.resolution) || 512;
  const ratio = W / H;
  const mw = Math.max(32, Math.round(Math.sqrt(res * res * ratio) / 32) * 32);
  const mh = Math.max(32, Math.round(Math.sqrt((res * res) / ratio) / 32) * 32);
  const mode = String(g["40"]?.inputs?.mode ?? "auto");
  const outMax = Number(g["40"]?.inputs?.out_max_side ?? 0);

  // The changed rectangle, in the base's pixels.
  let rect: [number, number, number, number];
  let maskFull: Buffer | null = null;
  if (mode === "mask" && mask) {
    const m = await resize(mask.data, mask.w, mask.h, W, H);
    maskFull = m;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (m[(y * W + x) * 3] > 127) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x + 1);
          y1 = Math.max(y1, y + 1);
        }
    rect = x1 > x0 ? [x0, y0, x1, y1] : [0, 0, 0, 0];
  } else {
    const area = 0.08 + ((hw % 1000) / 1000) * 0.12;
    const aspect = 0.6 + ((hh % 1000) / 1000) * 0.8;
    const rw = Math.max(8, Math.round(Math.sqrt(area * W * H * aspect)));
    const rh = Math.max(8, Math.round((area * W * H) / rw));
    const x0 = Math.round(((hx % 1000) / 1000) * Math.max(1, W - rw));
    const y0 = Math.round(((hy % 1000) / 1000) * Math.max(1, H - rh));
    rect = [x0, y0, Math.min(W, x0 + rw), Math.min(H, y0 + rh)];
  }

  // The model's frame: the base at the model's size, the rectangle painted, a lossy round trip, back to full size.
  let model = await resize(base.data, W, H, mw, mh);
  const sx = mw / W;
  const sy = mh / H;
  for (let y = Math.floor(rect[1] * sy); y < Math.ceil(rect[3] * sy); y++)
    for (let x = Math.floor(rect[0] * sx); x < Math.ceil(rect[2] * sx); x++) {
      if (x < 0 || y < 0 || x >= mw || y >= mh) continue;
      if (maskFull && maskFull[(Math.min(H - 1, Math.floor(y / sy)) * W + Math.min(W - 1, Math.floor(x / sx))) * 3] <= 127) continue;
      const i = (y * mw + x) * 3;
      model[i] = colour[0];
      model[i + 1] = colour[1];
      model[i + 2] = colour[2];
    }
  if (opts.lossy) {
    const rand = rng(seed ^ 0x9e3779b9);
    for (let i = 0; i < model.length; i++) model[i] = Math.max(0, Math.min(255, model[i] + Math.round(rand() * 4 - 2)));
    const s = await sharp();
    model = await s(model, { raw: { width: mw, height: mh, channels: 3 } }).blur(0.5).raw().toBuffer();
  }
  const edited = await resize(model, mw, mh, W, H);

  // Paste back: the base where nothing changed, found as the node finds it (not from the painted rectangle).
  const out = Buffer.from(base.data);
  let touched: [number, number, number, number] | null = null;
  let changed = 0;
  if (mode === "off") {
    edited.copy(out);
  } else {
    let mask: Uint8Array;
    if (maskFull) {
      mask = new Uint8Array(W * H);
      for (let i = 0; i < mask.length; i++) mask[i] = maskFull[i * 3];
    } else mask = await changeMask(base.data, W, H, model, mw, mh);
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) changed++;
    if (!maskFull && changed > 0.6 * W * H) {
      // A global change: the whole edit (the node also brings back the base's fine detail; the stand-in doesn't).
      edited.copy(out);
    } else
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const m = mask[y * W + x] / 255;
          if (m <= 0) continue;
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x + 1);
          y1 = Math.max(y1, y + 1);
          const i = (y * W + x) * 3;
          for (let c = 0; c < 3; c++) out[i + c] = Math.round(base.data[i + c] * (1 - m) + edited[i + c] * m);
        }
    if (x1 > x0) touched = [x0, y0, x1, y1];
  }

  // The output size (a live frame is the composite made small).
  let ow = W;
  let oh = H;
  let data: Buffer = out;
  if (outMax && Math.max(W, H) > outMax) {
    const s = outMax / Math.max(W, H);
    ow = Math.max(32, Math.round(W * s));
    oh = Math.max(32, Math.round(H * s));
    data = await resize(out, W, H, ow, oh);
    if (touched) touched = [Math.floor(touched[0] * s), Math.floor(touched[1] * s), Math.ceil(touched[2] * s), Math.ceil(touched[3] * s)];
  }
  return { data: await encode(data, ow, oh, format, quality), type: format === "png" ? "image/png" : "image/webp", width: ow, height: oh, modelW: mw, modelH: mh, touched, changed: changed / (W * H), base: String(g["10"].inputs.image) };
}

/** A picture's size from its header (PNG, JPEG or WebP via sharp's metadata), for timing. */
export async function pictureSize(bytes: Buffer): Promise<{ w: number; h: number } | null> {
  try {
    const s = await sharp();
    const m = await s(bytes).metadata();
    return m.width && m.height ? { w: m.width, h: m.height } : null;
  } catch {
    return null;
  }
}
