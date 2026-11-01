/**
 * What the ComfyUI stand-in (fake-local-comfy.ts) makes of a live edit graph (src/lib/live/graph.ts): real pixels, so
 * the bookkeeping can be measured. An "edit" paints a rectangle chosen by the prompt and seed (8–20 % of the picture)
 * in a colour chosen by them, at the model's size (the resolution's area, the base's shape), then scales it back up.
 * With `lossy`, the whole edited frame also gets ±2 noise and a slight blur, a stand-in for a VAE round trip. The paste
 * back copies the base outside the changed rectangle (grown 8 px, feathered), as Fuobe's node does; mode "off" keeps
 * the whole edit, "mask" uses the painted region. Only erasable TypeScript (runs under plain Node).
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
  /** In the output's pixels: the area the edit may have touched (grown and feathered), or null for a whole-frame edit. */
  touched: [number, number, number, number] | null;
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

  // Paste back: the base where nothing changed.
  const out = Buffer.from(base.data);
  let touched: [number, number, number, number] | null = null;
  if (mode === "off") {
    edited.copy(out);
  } else {
    const grow = 8;
    const feather = 24;
    const [rx0, ry0, rx1, ry1] = [rect[0] - grow, rect[1] - grow, rect[2] + grow, rect[3] + grow];
    touched = [Math.max(0, rx0 - feather), Math.max(0, ry0 - feather), Math.min(W, rx1 + feather), Math.min(H, ry1 + feather)];
    for (let y = touched[1]; y < touched[3]; y++)
      for (let x = touched[0]; x < touched[2]; x++) {
        let m: number;
        if (maskFull) m = maskFull[(y * W + x) * 3] / 255;
        else {
          const dx = Math.max(rx0 - x, 0, x - (rx1 - 1));
          const dy = Math.max(ry0 - y, 0, y - (ry1 - 1));
          m = Math.max(0, 1 - Math.hypot(dx, dy) / feather);
        }
        if (m <= 0) continue;
        const i = (y * W + x) * 3;
        for (let c = 0; c < 3; c++) out[i + c] = Math.round(base.data[i + c] * (1 - m) + edited[i + c] * m);
      }
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
  return { data: await encode(data, ow, oh, format, quality), type: format === "png" ? "image/png" : "image/webp", width: ow, height: oh, modelW: mw, modelH: mh, touched, base: String(g["10"].inputs.image) };
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
