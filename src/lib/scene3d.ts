/**
 * Cinema Studio's 3D scene (gap R4-08): the pure maths behind the viewer and the recomposition request,
 * shared by the browser (components/cinema/scene-*) and the planner (catalog/cinema.ts).
 *
 * Both engines put the scene in the photo's own camera space with glTF axes: the photo was taken from the
 * origin looking down -Z, +Y is up. On the open engine that is MoGe 2's mesh (metres); on the cloud it is a
 * point cloud built here from the photo and a depth map (research: paid-model-apis-4.md §8, comfyui-oss-4.md §i).
 *
 * The camera follows the parity studio's viewer (parity-delta-4.md §4.4): W A S D Q E to fly, Shift faster, a lens
 * in mm on a full-frame body, an aperture that sets the depth of field, and a frame in the project's ratio.
 */

export type Vec3 = [number, number, number];

/** Lens range in mm (the parity studio's 3D Angles: 24–300; 18 for a wider establishing view). */
export const LENS = { min: 18, max: 300, default: 24 } as const;
/** Quick picks on the lens slider. */
export const LENS_STOPS = [18, 24, 35, 50, 85, 135, 200, 300];
/** Whole and half stops from f/1.4 to f/16. */
export const F_STOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16];
export const APERTURE = { min: 1.4, max: 16, default: 5.6 } as const;
/** A full-frame sensor, in mm: the frame lines of every ratio sit inside it. */
export const SENSOR = { width: 36, height: 24 } as const;

const DEG = Math.PI / 180;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
// Divided by the whole number of steps per unit, so 78 steps of 0.1 come out as 7.8, not 7.800000000000001.
const round = (n: number, step = 0.1) => Math.round(n / step) / Math.round(1 / step);

/** "16:9" → 1.777…; anything unreadable is square. */
export function ratioOf(aspect: string): number {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect.trim());
  const r = m ? Number(m[1]) / Number(m[2]) : 1;
  return Number.isFinite(r) && r > 0 ? r : 1;
}

/** The frame of this ratio inside the full-frame sensor (mm): as wide as the sensor, or as tall for narrower frames. */
export function frameSensor(aspect: number): { width: number; height: number } {
  const full = SENSOR.width / SENSOR.height;
  return aspect >= full ? { width: SENSOR.width, height: SENSOR.width / aspect } : { width: SENSOR.height * aspect, height: SENSOR.height };
}

/** Horizontal and vertical field of view (degrees) of a lens on a frame of this ratio. */
export function lensFov(focalMm: number, aspect: number): { h: number; v: number } {
  const f = Math.max(1, focalMm);
  const s = frameSensor(aspect);
  return { h: (2 * Math.atan(s.width / (2 * f))) / DEG, v: (2 * Math.atan(s.height / (2 * f))) / DEG };
}

/** The focal length (mm) whose horizontal field of view on this frame is `hFovDeg` (the inverse of lensFov). */
export function focalForFov(hFovDeg: number, aspect: number): number {
  const half = clamp(hFovDeg, 1, 179) * DEG * 0.5;
  return frameSensor(aspect).width / (2 * Math.tan(half));
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the frame of this ratio sits in a viewport: the largest such rectangle inside `margin` px, centred. */
export function frameRect(viewW: number, viewH: number, aspect: number, margin = 0): Rect {
  const w = Math.max(1, viewW - 2 * margin);
  const h = Math.max(1, viewH - 2 * margin);
  const width = Math.min(w, h * aspect);
  const height = width / aspect;
  return { x: (viewW - width) / 2, y: (viewH - height) / 2, width, height };
}

/**
 * The vertical field of view to give the camera of the whole canvas so that the frame rectangle (its height
 * in px) shows exactly the lens's vertical field of view.
 */
export function canvasFov(frameVFovDeg: number, frameHeightPx: number, canvasHeightPx: number): number {
  const t = Math.tan(frameVFovDeg * DEG * 0.5) * (canvasHeightPx / Math.max(1, frameHeightPx));
  return (2 * Math.atan(t)) / DEG;
}

/** The captured PNG's size: the frame's ratio, its longer edge `long` px, both sides multiples of 16. */
export function captureSize(aspect: number, long = 1536): { width: number; height: number } {
  const m16 = (n: number) => Math.max(16, Math.round(n / 16) * 16);
  return aspect >= 1 ? { width: m16(long), height: m16(long / aspect) } : { width: m16(long * aspect), height: m16(long) };
}

// ---------------------------------------------------------------------------
// Flying

/** A fly camera: where it is and where it looks. yaw 0 looks down -Z and grows turning left; pitch grows looking up. */
export interface FlyPose {
  position: Vec3;
  yaw: number;
  pitch: number;
}

/** Each axis -1…1: forward (W/S), right (D/A), up (E/Q). */
export interface FlyInput {
  forward: number;
  right: number;
  up: number;
}

export const PITCH_LIMIT = Math.PI / 2 - 0.01;

export function forwardOf(yaw: number, pitch: number): Vec3 {
  return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}

export function rightOf(yaw: number): Vec3 {
  return [Math.cos(yaw), 0, -Math.sin(yaw)];
}

/** Keys held → the axes (KeyboardEvent.code, so the keys keep their place on any layout). */
export function keysToInput(codes: Iterable<string>): FlyInput {
  const held = new Set(codes);
  const axis = (plus: string, minus: string) => (held.has(plus) ? 1 : 0) - (held.has(minus) ? 1 : 0);
  return { forward: axis("KeyW", "KeyS"), right: axis("KeyD", "KeyA"), up: axis("KeyE", "KeyQ") };
}

export const FLY_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"]);
/** Shift flies this much faster. */
export const BOOST = 3;

/**
 * Move for `dt` seconds at `speed` units per second (×BOOST with Shift): forward along the view (so looking
 * down and pressing W flies down), sideways level with the ground, Q/E straight down/up. Diagonals are not faster.
 */
export function flyStep(pose: FlyPose, input: FlyInput, dt: number, speed: number, boost = false): FlyPose {
  const f = forwardOf(pose.yaw, pose.pitch);
  const r = rightOf(pose.yaw);
  const v: Vec3 = [0, 1, 2].map((i) => f[i] * input.forward + r[i] * input.right + (i === 1 ? input.up : 0)) as Vec3;
  const len = Math.hypot(...v);
  if (!len || dt <= 0) return pose;
  const step = (speed * (boost ? BOOST : 1) * Math.min(dt, 0.1)) / Math.max(1, len);
  return { ...pose, position: [pose.position[0] + v[0] * step, pose.position[1] + v[1] * step, pose.position[2] + v[2] * step] };
}

/** Mouse or finger look: dragging right turns right, dragging up looks up (`perPx` radians per pixel). */
export function lookStep(pose: FlyPose, dxPx: number, dyPx: number, perPx = 0.004): FlyPose {
  return { ...pose, yaw: pose.yaw - dxPx * perPx, pitch: clamp(pose.pitch - dyPx * perPx, -PITCH_LIMIT, PITCH_LIMIT) };
}

/** Move along the view by `dist` units (the mouse wheel, a pinch). */
export function dolly(pose: FlyPose, dist: number): FlyPose {
  const f = forwardOf(pose.yaw, pose.pitch);
  return { ...pose, position: [pose.position[0] + f[0] * dist, pose.position[1] + f[1] * dist, pose.position[2] + f[2] * dist] };
}

/** Move sideways and up by (right, up) units in the view's plane (a two-finger drag). */
export function strafe(pose: FlyPose, right: number, up: number): FlyPose {
  const r = rightOf(pose.yaw);
  return { ...pose, position: [pose.position[0] + r[0] * right, pose.position[1] + up, pose.position[2] + r[2] * right] };
}

export interface Touch2 {
  x: number;
  y: number;
}

/** Two fingers from `a` to `b`: how far their midpoint moved (px) and how much they spread apart (>1 = pinch out). */
export function twoFinger(a: [Touch2, Touch2], b: [Touch2, Touch2]): { dx: number; dy: number; scale: number } {
  const mid = (p: [Touch2, Touch2]) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
  const span = (p: [Touch2, Touch2]) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  const m0 = mid(a);
  const m1 = mid(b);
  const s0 = span(a);
  return { dx: m1.x - m0.x, dy: m1.y - m0.y, scale: s0 > 0 ? span(b) / s0 : 1 };
}

/** Flying speed for a scene whose typical depth is `depth` units: about a third of it per second. */
export function flySpeed(depth: number): number {
  return Math.max(0.05, depth * 0.35);
}

// ---------------------------------------------------------------------------
// Scenes: where the camera starts

/**
 * The photo's field of view, read from a scene in its camera space (vertices in front of the origin): the
 * frustum through the outermost points (the 99.5th percentile of |x|/-z and |y|/-z, so a few stray points don't
 * widen it). Null when the model isn't such a scene (an object around the origin, like the demo mesh).
 */
export function sceneFov(positions: ArrayLike<number>, maxSamples = 60_000): { h: number; v: number } | null {
  const n = Math.floor(positions.length / 3);
  if (!n) return null;
  const step = Math.max(1, Math.floor(n / maxSamples));
  const xs: number[] = [];
  const ys: number[] = [];
  let behind = 0;
  let seen = 0;
  for (let i = 0; i < n; i += step) {
    const z = positions[i * 3 + 2];
    seen++;
    if (!(z < 0)) {
      behind++;
      continue;
    }
    xs.push(Math.abs(positions[i * 3] / z));
    ys.push(Math.abs(positions[i * 3 + 1] / z));
  }
  if (behind > seen * 0.02 || xs.length < 3) return null;
  const p = (a: number[]) => a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * 0.995))];
  return { h: (2 * Math.atan(p(xs))) / DEG, v: (2 * Math.atan(p(ys))) / DEG };
}

/** The median distance of the points along -Z (the photo's subject distance): where the orbit pivot sits. */
export function medianDepth(positions: ArrayLike<number>, maxSamples = 60_000): number {
  const n = Math.floor(positions.length / 3);
  const step = Math.max(1, Math.floor(n / maxSamples));
  const zs: number[] = [];
  for (let i = 0; i < n; i += step) {
    const z = -positions[i * 3 + 2];
    if (Number.isFinite(z)) zs.push(Math.abs(z));
  }
  if (!zs.length) return 1;
  zs.sort((a, b) => a - b);
  return zs[Math.floor(zs.length / 2)] || 1;
}

/** An object around a centre (not a camera-space scene): start in front of it, far enough to see all of it. */
export function objectStart(center: Vec3, radius: number, vFovDeg: number): FlyPose {
  const d = (Math.max(radius, 1e-3) / Math.sin(Math.max(5, vFovDeg) * DEG * 0.5)) * 1.1;
  return { position: [center[0], center[1], center[2] + d], yaw: 0, pitch: 0 };
}

// ---------------------------------------------------------------------------
// The point cloud (cloud engine): the photo + a depth map → points in the photo's camera space

/** RGBA pixels, as ImageData has them. */
export interface Pixels {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface PointCloudOptions {
  /** The photo's horizontal field of view (degrees). */
  hFov: number;
  /** At most this many points (the sampling stride follows). */
  maxPoints?: number;
  /** Grey depth maps differ: bright = near (disparity) or dark = near (depth). Undefined = read it from the map. */
  nearIsBright?: boolean;
  /** Distance of the nearest and the farthest points (scene units ≈ metres). */
  near?: number;
  far?: number;
  /** Samples between their neighbours whose depth jumps more than this fraction snap to a side of the edge (0 = off). */
  edge?: number;
}

export interface PointCloud {
  /** xyz per point. */
  positions: Float32Array;
  /** rgb 0–1 per point (sRGB, as in the photo). */
  colors: Float32Array;
  /** Each point's diameter in scene units: it covers its share of the photo, seen from where it was taken. */
  sizes: Float32Array;
  count: number;
  stride: number;
  /** Median distance (the orbit pivot). */
  depth: number;
  /** How the depth map was painted. */
  encoding: "grey" | "spectral";
}

/**
 * Matplotlib's "Spectral" colour map, ColorBrewer's 11 stops evenly spaced from 0 to 1. Marigold paints its depth
 * maps with it (fal-ai/marigold-v2 returns this "colorized depth map", not grey): dark red is near, then orange,
 * yellow, green and blue, to violet far away.
 */
export const SPECTRAL: readonly (readonly [number, number, number])[] = [
  [158, 1, 66],
  [213, 62, 79],
  [244, 109, 67],
  [253, 174, 97],
  [254, 224, 139],
  [255, 255, 191],
  [230, 245, 152],
  [171, 221, 164],
  [102, 194, 165],
  [50, 136, 189],
  [94, 79, 162],
];

/** The Spectral colour at t (0–1), as 0–255 RGB. */
export function spectralColor(t: number): [number, number, number] {
  const x = clamp(t, 0, 1) * (SPECTRAL.length - 1);
  const i = Math.min(SPECTRAL.length - 2, Math.floor(x));
  const f = x - i;
  const [a, b] = [SPECTRAL[i], SPECTRAL[i + 1]];
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)) as [number, number, number];
}

/** Where a colour sits along the Spectral map: t (0–1) of the nearest point on it, and how far off it is (0–255 units). */
export function spectralValue(r: number, g: number, b: number): { t: number; off: number } {
  let best = Infinity;
  let t = 0;
  for (let i = 0; i < SPECTRAL.length - 1; i++) {
    const a = SPECTRAL[i];
    const d = [SPECTRAL[i + 1][0] - a[0], SPECTRAL[i + 1][1] - a[1], SPECTRAL[i + 1][2] - a[2]];
    const q = [r - a[0], g - a[1], b - a[2]];
    const u = clamp((q[0] * d[0] + q[1] * d[1] + q[2] * d[2]) / (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]), 0, 1);
    const e = (q[0] - u * d[0]) ** 2 + (q[1] - u * d[1]) ** 2 + (q[2] - u * d[2]) ** 2;
    if (e < best) {
      best = e;
      t = (i + u) / (SPECTRAL.length - 1);
    }
  }
  return { t, off: Math.sqrt(best) };
}

/** A grey value 0–1 (luma, so a grey map reads the same on every channel). */
const lumaAt = (data: ArrayLike<number>, o: number) => (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) / 255;

/**
 * How a depth map is painted: "grey" (one value per pixel, either way round), or "spectral" (Marigold's colour map).
 * A map whose pixels carry colour and sit on the Spectral curve is Spectral; any other colour falls back to its grey.
 */
export function depthEncoding(depth: Pixels): "grey" | "spectral" {
  const n = depth.width * depth.height;
  const step = Math.max(1, Math.floor(n / 4096));
  let spread = 0;
  let off = 0;
  let seen = 0;
  for (let i = 0; i < n; i += step) {
    const o = i * 4;
    const [r, g, b] = [depth.data[o], depth.data[o + 1], depth.data[o + 2]];
    spread += Math.max(r, g, b) - Math.min(r, g, b);
    off += spectralValue(r, g, b).off;
    seen++;
  }
  return seen && spread / seen > 16 && off / seen < 12 ? "spectral" : "grey";
}

/** A depth map read into nearness: 0 (far) … 1 (near) per pixel. */
export interface DepthField {
  width: number;
  height: number;
  nearness: Float32Array;
  /** Bright-near grey maps are disparity (1/z, as Depth Anything's); dark-near grey and Marigold's maps are depth (z). */
  disparity: boolean;
  encoding: "grey" | "spectral";
}

/**
 * Decode a depth map. Spectral maps (Marigold) are inverted along the colour map: red is near, so no guess is
 * needed. Grey maps run the way `nearIsBright` says, or the way the map itself shows (see nearIsBright).
 */
export function readDepth(depth: Pixels, brightNear?: boolean): DepthField {
  const { width, height, data } = depth;
  const nearness = new Float32Array(width * height);
  const encoding = depthEncoding(depth);
  if (encoding === "spectral") {
    // Each colour is looked up once: a depth map has far fewer colours than pixels.
    const seen = new Map<number, number>();
    for (let i = 0; i < nearness.length; i++) {
      const o = i * 4;
      const key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
      let v = seen.get(key);
      if (v === undefined) {
        v = 1 - spectralValue(data[o], data[o + 1], data[o + 2]).t;
        seen.set(key, v);
      }
      nearness[i] = v;
    }
    return { width, height, nearness, disparity: false, encoding };
  }
  const bright = brightNear ?? nearIsBright(depth);
  for (let i = 0; i < nearness.length; i++) {
    const g = lumaAt(data, i * 4);
    nearness[i] = bright ? g : 1 - g;
  }
  return { width, height, nearness, disparity: bright, encoding };
}

/** Bilinear nearness of a decoded depth map at normalised (u, v). */
function nearnessAt(f: DepthField, u: number, v: number): number {
  const x = clamp(u * f.width - 0.5, 0, f.width - 1);
  const y = clamp(v * f.height - 0.5, 0, f.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(f.width - 1, x0 + 1);
  const y1 = Math.min(f.height - 1, y0 + 1);
  const g = (xx: number, yy: number) => f.nearness[yy * f.width + xx];
  const fx = x - x0;
  const fy = y - y0;
  return (g(x0, y0) * (1 - fx) + g(x1, y0) * fx) * (1 - fy) + (g(x0, y1) * (1 - fx) + g(x1, y1) * fx) * fy;
}

/**
 * Which way a grey depth map runs: in a photo the bottom of the frame (the floor, the street) is nearly always nearer
 * than the top, so the map is "bright = near" when its bottom quarter is brighter than its top quarter.
 */
export function nearIsBright(depth: Pixels): boolean {
  const band = Math.max(1, Math.floor(depth.height / 4));
  const mean = (y0: number) => {
    let s = 0;
    let n = 0;
    for (let y = y0; y < y0 + band; y++)
      for (let x = 0; x < depth.width; x += Math.max(1, Math.floor(depth.width / 64))) {
        s += lumaAt(depth.data, (y * depth.width + x) * 4);
        n++;
      }
    return s / Math.max(1, n);
  };
  return mean(depth.height - band) >= mean(0);
}

/**
 * The photo as points: every `stride`-th pixel, pushed back to its distance along its own ray from the origin.
 * Bright-near grey maps are read as disparity (1/z); dark-near grey maps and Marigold's Spectral maps as depth (z).
 * Each is spread between the map's 1st and 99th percentile so every map fills the near–far range.
 */
export function buildPointCloud(photo: Pixels, depthMap: Pixels, opts: PointCloudOptions): PointCloud {
  const W = photo.width;
  const H = photo.height;
  const near = opts.near ?? 1;
  const far = Math.max(near * 1.05, opts.far ?? 6);
  const field = readDepth(depthMap, opts.nearIsBright);
  const stride = Math.max(1, Math.ceil(Math.sqrt((W * H) / Math.max(1, opts.maxPoints ?? 300_000))));
  const cols = Math.ceil(W / stride);
  const rows = Math.ceil(H / stride);

  // Nearness 0 (far) … 1 (near) per sample, spread between the percentiles.
  const nearness = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      nearness[r * cols + c] = nearnessAt(field, (Math.min(W - 1, c * stride) + 0.5) / W, (Math.min(H - 1, r * stride) + 0.5) / H);
    }
  const sorted = Float32Array.from(nearness).sort();
  const lo = sorted[Math.floor(sorted.length * 0.01)];
  const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
  const span = hi - lo > 1e-6 ? hi - lo : 1;
  const z = new Float32Array(cols * rows);
  for (let i = 0; i < z.length; i++) {
    const s = clamp((nearness[i] - lo) / span, 0, 1);
    z[i] = field.disparity ? 1 / (1 / far + s * (1 / near - 1 / far)) : far - s * (far - near);
  }

  const fx = W / 2 / Math.tan(clamp(opts.hFov, 1, 179) * DEG * 0.5);
  const edge = opts.edge ?? 0.06;
  // Soft depth edges leave samples floating between a subject and what is behind it (a "curtain" once the camera
  // moves). Each one snaps to the nearer side of the edge, compared in 1/z: no point is dropped, so the still's own
  // view stays whole, and nothing hangs in the air between the two.
  if (edge > 0) {
    const snapped = z.slice();
    const k = 4;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        let jump = 0;
        if (c + 1 < cols) jump = Math.max(jump, Math.abs(z[i + 1] - z[i]));
        if (c > 0) jump = Math.max(jump, Math.abs(z[i - 1] - z[i]));
        if (r + 1 < rows) jump = Math.max(jump, Math.abs(z[i + cols] - z[i]));
        if (r > 0) jump = Math.max(jump, Math.abs(z[i - cols] - z[i]));
        if (jump / z[i] <= edge || isExtreme(z, i, cols, rows)) continue;
        let lo = Infinity;
        let hi = 0;
        for (let y = Math.max(0, r - k); y <= Math.min(rows - 1, r + k); y++)
          for (let x = Math.max(0, c - k); x <= Math.min(cols - 1, c + k); x++) {
            lo = Math.min(lo, z[y * cols + x]);
            hi = Math.max(hi, z[y * cols + x]);
          }
        snapped[i] = Math.abs(1 / z[i] - 1 / lo) <= Math.abs(1 / z[i] - 1 / hi) ? lo : hi;
      }
    z.set(snapped);
  }

  const count = cols * rows;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const c = i % cols;
    const r = (i - c) / cols;
    const px = Math.min(W - 1, c * stride);
    const py = Math.min(H - 1, r * stride);
    const d = z[i];
    positions[i * 3] = ((px + 0.5 - W / 2) / fx) * d;
    positions[i * 3 + 1] = (-(py + 0.5 - H / 2) / fx) * d;
    positions[i * 3 + 2] = -d;
    const o = (py * W + px) * 4;
    colors[i * 3] = photo.data[o] / 255;
    colors[i * 3 + 1] = photo.data[o + 1] / 255;
    colors[i * 3 + 2] = photo.data[o + 2] / 255;
    sizes[i] = ((stride * d) / fx) * 1.5;
  }
  return { positions, colors, sizes, count, stride, depth: medianDepth(positions), encoding: field.encoding };
}

/** Whether sample i is the nearest or the farthest of itself and its four neighbours (a side of an edge). */
function isExtreme(z: Float32Array, i: number, cols: number, rows: number): boolean {
  const c = i % cols;
  const r = (i - c) / cols;
  const n = [c + 1 < cols && z[i + 1], c > 0 && z[i - 1], r + 1 < rows && z[i + cols], r > 0 && z[i - cols]].filter((v): v is number => typeof v === "number");
  return n.every((v) => z[i] <= v) || n.every((v) => z[i] >= v);
}

// ---------------------------------------------------------------------------
// Depth of field (a hint: the thin-lens blur of a full-frame camera)

/**
 * The blur scale A of a thin lens focused at `focus` (scene units ≈ m): a point at distance d is blurred into a
 * disc of A·|d − focus|/d of the frame's width. 50 mm at f/1.4 focused at 2 m blurs a wall 6 m away by ~1.7%.
 */
export function blurScale(lensMm: number, fNumber: number, focus: number, aspect = 16 / 9): number {
  const f = lensMm / 1000;
  const s = Math.max(focus, f * 1.01);
  return (f * f) / (Math.max(0.5, fNumber) * (s - f) * (frameSensor(aspect).width / 1000));
}

/**
 * What the frame's centre is looking at: the nearest surfaces in a narrow cone around the view (the 10th
 * percentile of the sampled points' distances inside it). Null when nothing is there.
 */
export function focusDistance(positions: ArrayLike<number>, pose: FlyPose, coneDeg = 2.5, maxSamples = 80_000): number | null {
  const n = Math.floor(positions.length / 3);
  const step = Math.max(1, Math.floor(n / maxSamples));
  const f = forwardOf(pose.yaw, pose.pitch);
  const cos = Math.cos(coneDeg * DEG);
  const [ox, oy, oz] = pose.position;
  const hits: number[] = [];
  for (let i = 0; i < n; i += step) {
    const dx = positions[i * 3] - ox;
    const dy = positions[i * 3 + 1] - oy;
    const dz = positions[i * 3 + 2] - oz;
    const along = dx * f[0] + dy * f[1] + dz * f[2];
    if (along <= 0) continue;
    if (along / Math.hypot(dx, dy, dz) >= cos) hits.push(along);
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a - b);
  return hits[Math.floor(hits.length * 0.1)];
}

// ---------------------------------------------------------------------------
// The captured view → a recomposition request

/** The camera of a capture: what the Multiple-Angles LoRA and its fal / ComfyUI routes take. */
export interface ScenePose {
  /** 0–360°: 0 = from the front (where the photo was taken), 90 = moved round to the right. */
  horizontal: number;
  /** −30…90°: below eye level up to a bird's-eye view. */
  vertical: number;
  /** 0 (wide) … 5 (as framed in the photo) … 10 (close-up). */
  zoom: number;
}

/**
 * The flown camera as angles around the scene's pivot (the photo's centre at its median depth `pivotDepth`),
 * averaging where the camera went with where it looks (each says half of a re-shot angle; the round angle is a
 * circular mean), and the zoom from how much tighter the frame is than the photo's (lens and distance), as Qwen
 * Multiple Angles reads them.
 */
export function scenePose(pose: FlyPose, lensMm: number, photoLensMm: number, pivotDepth: number): ScenePose {
  const pivot: Vec3 = [0, 0, -pivotDepth];
  const dx = pose.position[0] - pivot[0];
  const dy = pose.position[1] - pivot[1];
  const dz = pose.position[2] - pivot[2];
  const orbit = Math.atan2(dx, dz);
  const level = Math.hypot(dx, dz);
  const elevation = Math.atan2(dy, Math.max(level, 1e-6)) / DEG;
  const pitch = pose.pitch / DEG;
  // Averaged on the circle: from behind, 179° and −179° make 180°, not 0°. Looking straight away from the
  // subject the two cancel out, and where the camera went decides.
  const sx = Math.sin(orbit) + Math.sin(pose.yaw);
  const cx = Math.cos(orbit) + Math.cos(pose.yaw);
  const mean = (Math.hypot(sx, cx) > 1e-6 ? Math.atan2(sx, cx) : orbit) / DEG;
  const horizontal = ((mean % 360) + 360) % 360;
  const vertical = clamp((elevation - pitch) / 2, -30, 90);
  const distance = Math.max(1e-3, Math.hypot(dx, dy, dz));
  const tighter = (lensMm / Math.max(1, photoLensMm)) * (pivotDepth / distance);
  const zoom = clamp(5 + 5 * Math.log2(tighter), 0, 10);
  return { horizontal: round(horizontal, 1) % 360, vertical: round(vertical, 1), zoom: round(zoom, 0.1) };
}

/** The Multiple-Angles LoRA's own words for a pose (the same lists as the Angles app). */
export const POSE_WORDS = {
  horizontal: [
    [0, "front view"],
    [45, "front-right quarter view"],
    [90, "right side view"],
    [135, "back-right quarter view"],
    [180, "back view"],
    [225, "back-left quarter view"],
    [270, "left side view"],
    [315, "front-left quarter view"],
  ] as [number, string][],
  vertical: [
    [-30, "low-angle shot"],
    [0, "eye-level shot"],
    [30, "elevated shot"],
    [60, "high-angle shot"],
  ] as [number, string][],
};

export function poseWords(p: ScenePose): string {
  const nearest = (list: [number, string][], v: number, circular = false) =>
    list.reduce((best, cur) => {
      const d = (x: number) => (circular ? Math.min(Math.abs(x - v), 360 - Math.abs(x - v)) : Math.abs(x - v));
      return d(cur[0]) < d(best[0]) ? cur : best;
    })[1];
  const distance = p.zoom >= 7.5 ? "close-up" : p.zoom <= 2.5 ? "wide shot" : "medium shot";
  return `${nearest(POSE_WORDS.horizontal, p.horizontal, true)} ${nearest(POSE_WORDS.vertical, p.vertical)} ${distance}`;
}

/** The lens and aperture in a director's words ("a 24 mm wide-angle lens at f/5.6, moderate depth of field"). */
export function cameraWords(lensMm: number, fNumber: number): string {
  const lens = lensMm <= 28 ? "wide-angle" : lensMm <= 60 ? "standard" : lensMm <= 135 ? "portrait telephoto" : "long telephoto";
  const dof = fNumber <= 2 ? "very shallow depth of field, the background melting into soft bokeh" : fNumber <= 4 ? "shallow depth of field, a soft background" : fNumber <= 8 ? "moderate depth of field" : "deep focus, everything sharp";
  return `a ${Math.round(lensMm)} mm ${lens} lens at f/${formatStop(fNumber)}, ${dof}`;
}

export const formatStop = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * The recomposition instruction. Research (parity-delta-4.md §4.4): "Re-render this view photorealistically,
 * keep composition and camera exactly, fix holes and stretched textures." Image 1 is the capture, image 2 the photo.
 */
export function recomposePrompt(lensMm: number, fNumber: number, note?: string): string {
  const extra = note?.trim().replace(/[.\s]+$/, "");
  return [
    "Re-render this exact camera view of the scene photorealistically.",
    "Image 1 is a rough 3D render of the new camera view: keep its composition, camera position, angle and framing exactly.",
    "Image 2 is the original photo: take the people, objects, materials, colours and light from it, so everything looks the same as there.",
    "Fill holes, gaps and stretched textures with what belongs there.",
    `Shot on ${cameraWords(lensMm, fNumber)}.`,
    extra ? `${extra}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** What Qwen Multiple Angles adds to its own camera words on the cloud (it gets the photo and the angles). */
export function anglesNote(lensMm: number, fNumber: number, note?: string): string {
  const extra = note?.trim().replace(/[.\s]+$/, "");
  return `Keep the same subjects, identity, outfits, lighting and environment. Shot on ${cameraWords(lensMm, fNumber)}.${extra ? ` ${extra}.` : ""}`;
}
