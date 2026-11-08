/**
 * Body Double Live: InstantHMR in the browser, for one person, tracked by its own keypoints (no person detector).
 *
 * It mirrors the reference inference: the tight person box → a 1.2× square crop at 288 px with ImageNet normalisation,
 * and the CLIFF vector [atan((cx−W/2)/f), atan((cy−H/2)/f), box/f] with f = 1.05 × the frame's diagonal. The network
 * returns the MHR pose and shape, the camera translation and 70 keypoints in the crop; the body model (skinning only, no
 * weights) turns the pose and shape into 18,439 vertices. The face list travels in the body model's metadata.
 *
 * onnxruntime-web is loaded from its pinned CDN build when Live starts, so its WebAssembly never enters the app's bundle.
 * The model files are kept in the browser's Cache Storage after the first visit.
 */

const ORT_VERSION = "1.30.0";
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

/** The InstantHMR files at a pinned revision; NEXT_PUBLIC_BODY_DOUBLE_MODELS can point at a host of the same files. */
const HF = "https://huggingface.co/momolesang/InstantHMR/resolve/282df6966ee10b5d7e75d305edfb016697fd7974";
const BASE = process.env.NEXT_PUBLIC_BODY_DOUBLE_MODELS?.replace(/\/$/, "");
export const LIVE_FILES = {
  network: BASE ? `${BASE}/instanthmr-nano-w16.onnx` : `${HF}/instanthmr-nano.onnx`,
  body: BASE ? `${BASE}/mhr-body.onnx` : `${HF}/mhr-body.onnx`,
};
const CACHE = "fuobe-body-double-v1";

export const N_VERTS = 18439;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const SIZE = 288;
const EXPAND = 1.2;
/** Body joints that frame the next crop (no finger tips: they swing far and fast). */
const BOX_JOINTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 20, 41, 62, 69];
const FIT_JOINTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 41, 62, 69];

// The slice of onnxruntime-web this file uses.
type OrtTensor = { data: Float32Array; location?: string; dispose(): void };
type OrtSession = { run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>> };
type Ort = {
  env: { wasm: { wasmPaths: string }; logLevel: string };
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => OrtTensor;
  InferenceSession: { create(model: Uint8Array, options: Record<string, unknown>): Promise<OrtSession> };
};

let ortLoading: Promise<Ort> | null = null;
function loadOrt(webgpu: boolean): Promise<Ort> {
  ortLoading ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${ORT_BASE}${webgpu ? "ort.webgpu.min.mjs" : "ort.min.mjs"}`).then((m: Ort & { default?: Ort }) => {
    const ort = m.default ?? m;
    ort.env.wasm.wasmPaths = ORT_BASE;
    ort.env.logLevel = "error";
    return ort;
  });
  return ortLoading;
}

/** A model file, from Cache Storage when it was fetched before; `onBytes` follows a first download. */
async function fetchModel(url: string, onBytes?: (got: number, total: number) => void): Promise<Uint8Array> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch {
    cache = null;
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`The body model didn't download (${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onBytes?.(got, total);
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  try {
    await cache?.put(url, new Response(bytes, { headers: { "content-type": "application/octet-stream" } }));
  } catch {
    // A full or blocked cache: the next visit downloads again.
  }
  return bytes;
}

/** 1 Euro filter over a flat array (Casiez et al. 2012), the filter the reference smoothing uses. */
class OneEuro {
  private x: Float32Array;
  private dx: Float32Array;
  private t = -1;
  private mincutoff: number;
  private beta: number;
  private dcutoff: number;
  constructor(n: number, mincutoff: number, beta: number, dcutoff = 1) {
    this.x = new Float32Array(n);
    this.dx = new Float32Array(n);
    this.mincutoff = mincutoff;
    this.beta = beta;
    this.dcutoff = dcutoff;
  }
  reset() {
    this.t = -1;
  }
  apply(v: ArrayLike<number>, t: number): Float32Array {
    if (this.t < 0) {
      this.x.set(v);
      this.dx.fill(0);
      this.t = t;
      return this.x;
    }
    const dt = t > this.t ? t - this.t : 1 / 30;
    this.t = t;
    const ad = 1 / (1 + 1 / (2 * Math.PI * this.dcutoff * dt));
    const { x, dx, mincutoff, beta } = this;
    for (let i = 0; i < v.length; i++) {
      const d = (ad * (v[i] - x[i])) / dt + (1 - ad) * dx[i];
      dx[i] = d;
      const a = 1 / (1 + 1 / (2 * Math.PI * (mincutoff + beta * Math.abs(d)) * dt));
      x[i] = a * v[i] + (1 - a) * x[i];
    }
    return x;
  }
}

export type HmrFrame = { verts: Float32Array; cam: Float32Array; f: number; ms: { prep: number; network: number; body: number } };

/** A body ready to draw: positions and normals in three.js space (y up, looking down −z), its centre and lowest point. */
export type DrawBody = { positions: Float32Array; normals: Float32Array; centre: [number, number, number]; floor: number };

/**
 * The body in three.js space, with smooth vertex normals (area-weighted face normals summed at each vertex): the
 * camera frame (x right, y down, z forward) flips y and z.
 */
export function toDrawBody(verts: Float32Array, cam: Float32Array, faces: Uint32Array): DrawBody {
  const positions = new Float32Array(N_VERTS * 3);
  let sx = 0, sy = 0, sz = 0, minY = Infinity;
  for (let i = 0; i < N_VERTS; i++) {
    const x = verts[3 * i] + cam[0], y = -(verts[3 * i + 1] + cam[1]), z = -(verts[3 * i + 2] + cam[2]);
    positions[3 * i] = x;
    positions[3 * i + 1] = y;
    positions[3 * i + 2] = z;
    sx += x;
    sy += y;
    sz += z;
    if (y < minY) minY = y;
  }
  const normals = new Float32Array(N_VERTS * 3);
  for (let f = 0; f < faces.length; f += 3) {
    const a = 3 * faces[f], b = 3 * faces[f + 1], c = 3 * faces[f + 2];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      normals[k] += nx;
      normals[k + 1] += ny;
      normals[k + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= l;
    normals[i + 1] /= l;
    normals[i + 2] /= l;
  }
  return { positions, normals, centre: [sx / N_VERTS, sy / N_VERTS, sz / N_VERTS], floor: minY };
}
export type Hmr = {
  /** One frame's body; `person` (a tight box x1, y1, x2, y2 in its pixels) replaces the box tracked from the last frame. */
  step(source: CanvasImageSource, W: number, H: number, t: number, person?: number[] | null): Promise<HmrFrame>;
  resetTrack(): void;
  faces: Uint32Array;
  engine: "WebGPU" | "WebAssembly";
};

export const hasWebGpu = () => typeof navigator !== "undefined" && "gpu" in navigator;

export async function createHmr(onProgress?: (share: number) => void): Promise<Hmr> {
  const webgpu = hasWebGpu();
  const sizes = { network: 0, body: 0 };
  const got = { network: 0, body: 0 };
  const report = () => onProgress?.(sizes.network + sizes.body > 0 ? (got.network + got.body) / (sizes.network + sizes.body) : 0);
  const track = (k: "network" | "body") => (g: number, t: number) => {
    got[k] = g;
    sizes[k] = t;
    report();
  };
  const [ort, netBytes, bodyBytes] = await Promise.all([loadOrt(webgpu), fetchModel(LIVE_FILES.network, track("network")), fetchModel(LIVE_FILES.body, track("body"))]);
  const make = async (gpu: boolean) => {
    // logSeverityLevel 3: errors only (the WebGPU provider warns about the few nodes it leaves to the CPU).
    const opts = { executionProviders: gpu ? ["webgpu", "wasm"] : ["wasm"], graphOptimizationLevel: "all", logSeverityLevel: 3 };
    // On WebGPU the pose stays on the GPU and goes straight into the body model.
    const netOpts = gpu ? { ...opts, preferredOutputLocation: { mhr_params: "gpu-buffer", shape_params: "gpu-buffer" } } : opts;
    // One at a time: onnxruntime-web refuses a second WebGPU session while one is being created.
    const n = await ort.InferenceSession.create(netBytes, netOpts);
    return [n, await ort.InferenceSession.create(bodyBytes, opts)] as const;
  };
  let engine: Hmr["engine"] = webgpu ? "WebGPU" : "WebAssembly";
  let net: OrtSession, body: OrtSession;
  try {
    [net, body] = await make(webgpu);
  } catch (e) {
    if (!webgpu) throw e;
    // A browser that lists WebGPU but can't open an adapter: WebAssembly.
    engine = "WebAssembly";
    [net, body] = await make(false);
  }
  const faces = readFaces(bodyBytes);

  const crop = new OffscreenCanvas(SIZE, SIZE);
  const cctx = crop.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  const input = new Float32Array(3 * SIZE * SIZE);
  let box: number[] | null = null;
  // Light smoothing: enough to steady a still pose, quick enough to keep up with a dancer at 20 fps.
  const smoothVerts = new OneEuro(N_VERTS * 3, 3.0, 30.0);
  const smoothCam = new OneEuro(3, 2.0, 10.0);

  const resetTrack = () => {
    box = null;
    smoothVerts.reset();
    smoothCam.reset();
  };

  async function step(source: CanvasImageSource, W: number, H: number, t: number, person?: number[] | null): Promise<HmrFrame> {
    const f = 1.05 * Math.hypot(W, H);
    if (person) box = person;
    if (!box) {
      const s = Math.min(W, H) / EXPAND;
      box = [W / 2 - s / 2, H / 2 - s / 2, W / 2 + s / 2, H / 2 + s / 2];
    }
    const t0 = performance.now();
    const [x1, y1, x2, y2] = box;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const s = Math.max(x2 - x1, y2 - y1);
    const cliff = new Float32Array([Math.atan((cx - W / 2) / f), Math.atan((cy - H / 2) / f), s / f]);
    const side = s * EXPAND;
    const sx = cx - side / 2;
    const sy = cy - side / 2;
    // The pixel-aligned patch around the square, resized to 288 (the reference's floor/ceil crop); outside is black.
    const ix = Math.floor(sx);
    const iy = Math.floor(sy);
    cctx.fillStyle = "#000";
    cctx.fillRect(0, 0, SIZE, SIZE);
    cctx.drawImage(source, ix, iy, Math.ceil(sx + side) - ix, Math.ceil(sy + side) - iy, 0, 0, SIZE, SIZE);
    const px = cctx.getImageData(0, 0, SIZE, SIZE).data;
    const plane = SIZE * SIZE;
    for (let i = 0, p = 0; i < plane; i++, p += 4) {
      input[i] = (px[p] / 255 - MEAN[0]) / STD[0];
      input[i + plane] = (px[p + 1] / 255 - MEAN[1]) / STD[1];
      input[i + 2 * plane] = (px[p + 2] / 255 - MEAN[2]) / STD[2];
    }
    const t1 = performance.now();
    const out = await net.run({ image: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]), cliff_cond: new ort.Tensor("float32", cliff, [1, 3]) });
    const t2 = performance.now();
    const b = await body.run({ mhr_params: out.mhr_params, shape_params: out.shape_params });
    if (out.mhr_params.location === "gpu-buffer") {
      out.mhr_params.dispose();
      out.shape_params.dispose();
    }
    const t3 = performance.now();
    const jn = out.joints_2d.data;
    const kp = new Float32Array(140);
    for (let j = 0; j < 70; j++) {
      kp[2 * j] = (jn[2 * j] + 1) * 0.5 * side + sx;
      kp[2 * j + 1] = (jn[2 * j + 1] + 1) * 0.5 * side + sy;
    }
    box = nextBox(kp, W, H);
    // The network's translation sits a few percent off its own keypoints: fit it so the body's joints land on them.
    const cam = smoothCam.apply(fitTranslation(b.joints_3d.data, out.cam_trans.data, kp, f, W / 2, H / 2), t);
    const verts = smoothVerts.apply(b.vertices.data, t);
    return { verts, cam, f, ms: { prep: t1 - t0, network: t2 - t1, body: t3 - t2 } };
  }

  return { step, resetTrack, faces, engine };
}

function nextBox(kp: Float32Array, W: number, H: number): number[] | null {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const j of BOX_JOINTS) {
    const x = kp[2 * j], y = kp[2 * j + 1];
    if (x < x1) x1 = x;
    if (x > x2) x2 = x;
    if (y < y1) y1 = y;
    if (y > y2) y2 = y;
  }
  const bw = x2 - x1, bh = y2 - y1;
  y1 -= 0.12 * bh; // room above the eyes for the head
  const nb = [x1 - 0.06 * bw, y1 - 0.06 * bh, x2 + 0.06 * bw, y2 + 0.06 * bh];
  const cx = (nb[0] + nb[2]) / 2, cy = (nb[1] + nb[3]) / 2, size = Math.max(nb[2] - nb[0], nb[3] - nb[1]);
  // Lost (tiny, huge or off the frame): start again from the centred square.
  if (!(size > 0.12 * Math.min(W, H)) || size > 2.5 * Math.max(W, H) || cx < 0 || cx > W || cy < 0 || cy > H) return null;
  return nb;
}

/** Gauss-Newton on the 3 translation unknowns so the 3D joints project onto the 2D keypoints. */
function fitTranslation(j3: Float32Array, cam: Float32Array, kp: Float32Array, f: number, cx: number, cy: number): Float32Array {
  let tx = cam[0], ty = cam[1], tz = cam[2];
  for (let it = 0; it < 6; it++) {
    let a00 = 1e-6, a02 = 0, a11 = 1e-6, a12 = 0, a22 = 1e-6, b0 = 0, b1 = 0, b2 = 0;
    for (const j of FIT_JOINTS) {
      const X = j3[3 * j] + tx, Y = j3[3 * j + 1] + ty, Z = Math.max(j3[3 * j + 2] + tz, 0.1);
      const ru = (f * X) / Z + cx - kp[2 * j], rv = (f * Y) / Z + cy - kp[2 * j + 1];
      const fz = f / Z, gx = (-f * X) / (Z * Z), gy = (-f * Y) / (Z * Z);
      a00 += fz * fz;
      a02 += fz * gx;
      a22 += gx * gx + gy * gy;
      a11 += fz * fz;
      a12 += fz * gy;
      b0 += fz * ru;
      b1 += fz * rv;
      b2 += gx * ru + gy * rv;
    }
    // The symmetric 3×3 (a01 is 0), by Cramer's rule.
    const det = a00 * (a11 * a22 - a12 * a12) + a02 * (-a11 * a02);
    if (!(Math.abs(det) > 1e-12)) break;
    const d0 = (b0 * (a11 * a22 - a12 * a12) + a02 * (b1 * a12 - a11 * b2)) / det;
    const d1 = (a00 * (b1 * a22 - a12 * b2) - b0 * (-a12 * a02) + a02 * (-b1 * a02)) / det;
    const d2 = (a00 * (a11 * b2 - b1 * a12) + b0 * (-a11 * a02)) / det;
    tx -= d0;
    ty -= d1;
    tz -= d2;
  }
  // The network's answer when the fit runs away (keypoints off the person).
  if (!(tz > 0.3 && tz < 50) || Math.abs(tz - cam[2]) > 0.5 * cam[2]) return cam;
  return new Float32Array([tx, ty, tz]);
}

/** The mesh faces from the body model's metadata ("mesh_faces", base64 int32): the ONNX protobuf, read just that far. */
function readFaces(u8: Uint8Array): Uint32Array {
  let p = 0;
  const varint = () => {
    let r = 0, s = 0, b: number;
    do {
      b = u8[p++];
      r += (b & 0x7f) * 2 ** s;
      s += 7;
    } while (b & 0x80);
    return r;
  };
  const dec = new TextDecoder();
  while (p < u8.length) {
    const key = varint(), field = key >>> 3, wire = key & 7;
    if (wire === 0) {
      varint();
      continue;
    }
    if (wire === 1) {
      p += 8;
      continue;
    }
    if (wire === 5) {
      p += 4;
      continue;
    }
    const len = varint(), start = p;
    p += len;
    if (field !== 14) continue;
    let q = start, k = "", v = "";
    while (q < start + len) {
      const kk = u8[q++];
      let l = 0, s = 0, b: number;
      do {
        b = u8[q++];
        l += (b & 0x7f) * 2 ** s;
        s += 7;
      } while (b & 0x80);
      const str = dec.decode(u8.subarray(q, q + l));
      q += l;
      if (kk >>> 3 === 1) k = str;
      else v = str;
    }
    if (k === "mesh_faces") {
      const bin = atob(v);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Uint32Array(new Int32Array(bytes.buffer));
    }
  }
  throw new Error("The body model has no face list");
}
