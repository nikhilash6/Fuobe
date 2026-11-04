/**
 * Camera paths (build plan N7-5; research new-models-7.md §3.3): keyframes of a camera that flies round the subject of
 * a photo, the presets (named after WorldCast's and re-implemented from their descriptions), the conversion to and from
 * the 3D scene's pose (scenePose in ./scene3d), fal's H3 Max camera-controls trajectory, and a camera per frame
 * (OpenCV camera-to-world, +Z forward) for the browser's path render now and WorldCast (N7-9) later.
 *
 * Every path starts at the photo's own pose: the generated clip's first frame is the photo. Pure: no DOM, no three.js.
 */

import type { FlyPose, ScenePose, Vec3 } from "./scene3d";

export interface CameraKey {
  /** When the camera is here: 0 = the start of the clip, 1 = its end. */
  t: number;
  /** Degrees round the subject, unwrapped (720 = two turns); + = moved round to the right (scenePose's horizontal). */
  azimuth: number;
  /** Degrees above (+) or below (−) the subject's eye level. */
  elevation: number;
  /** Distance to the subject: 1 = the photo's own, 0.6 = closer, 1.5 = further. */
  distance: number;
  /** A sideways slide in subject distances (+ = to the right) with the camera keeping its heading: a truck. */
  truck?: number;
}

/** The photo's own camera: where every path starts. */
export const PHOTO_KEY: CameraKey = { t: 0, azimuth: 0, elevation: 0, distance: 1 };
/**
 * The most keys a path holds. Your GPU follows the path your browser renders (Uni3C), so it takes every key; fal's H3 Max
 * takes 2–12, and a longer path is simplified to the 12 that matter most there, which the run says (toH3MaxTrajectory).
 * (It was 12 on both engines until 2026-10-30: the GPU keeps what it can do.)
 */
export const MAX_KEYS = 24;
/** The closest and furthest a key may be (subject distances). */
export const DISTANCE = { min: 0.2, max: 4 } as const;

const DEG = Math.PI / 180;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round = (n: number, step: number) => Math.round(n / step) * step;
const tidy = (n: number, digits = 4) => Number(n.toFixed(digits)) + 0; // + 0 turns -0 into 0

// ---------------------------------------------------------------------------
// Presets

export interface PathPreset {
  id: string;
  name: string;
  description: string;
}

/** The moves offered as chips, in this order. orbit_<N>_cw / _ccw take any sweep in (0, 360] (see presetKeys). */
export const PATH_PRESETS: PathPreset[] = [
  { id: "orbit_360", name: "Orbit 360°", description: "A full level ring round the subject, back to the photo's view" },
  { id: "orbit_90_cw", name: "Arc 90° left", description: "A quarter turn round the subject, moving left" },
  { id: "orbit_90_ccw", name: "Arc 90° right", description: "A quarter turn round the subject, moving right" },
  { id: "orbit_180_push", name: "Push-pull arc", description: "Half a turn while the camera moves in and out twice" },
  { id: "orbit_tilt_20", name: "Tilted ring", description: "A full ring tilted 20°: rising on one side, dipping on the other" },
  { id: "lemniscate", name: "Figure-8", description: "A small figure of eight round the photo's view" },
  { id: "zoom_in", name: "Dolly in", description: "Moves in to 0.6× the distance" },
  { id: "zoom_out", name: "Dolly out", description: "Moves back to 1.5× the distance" },
  { id: "truck_left", name: "Truck left", description: "Slides left by half the subject distance, facing the same way" },
  { id: "truck_right", name: "Truck right", description: "Slides right by half the subject distance, facing the same way" },
];

/** A level arc of `sweep` degrees (signed: + = to the right), with a key at most every 90°. */
export function orbitKeys(sweep: number): CameraKey[] {
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / 90 - 1e-9));
  return Array.from({ length: n + 1 }, (_, i) => ({ t: tidy(i / n), azimuth: tidy((sweep * i) / n), elevation: 0, distance: 1 }));
}

/**
 * The keys of a preset, or null for an unknown id. "cw" and "ccw" are as seen from above: the camera starts in front of
 * the subject, so counter-clockwise moves it round to the right (+ azimuth). A plain orbit_<N> turns counter-clockwise.
 */
export function presetKeys(id: string): CameraKey[] | null {
  const orbit = /^orbit_(\d+(?:\.\d+)?)(?:_(cw|ccw))?$/.exec(id);
  if (orbit) {
    const n = Number(orbit[1]);
    if (!(n > 0 && n <= 360)) return null;
    return orbitKeys(orbit[2] === "cw" ? -n : n);
  }
  const eight = (f: (i: number) => Omit<CameraKey, "t">) => Array.from({ length: 9 }, (_, i) => ({ t: tidy(i / 8), ...f(i) }));
  switch (id) {
    case "orbit_tilt_20":
      // A great circle tilted 20° about the photo's line of sight: level in front and behind, highest at 90°.
      return eight((i) => ({ azimuth: i * 45, elevation: tidy(Math.asin(Math.sin(20 * DEG) * Math.sin(i * 45 * DEG)) / DEG, 3), distance: 1 }));
    case "orbit_180_push":
      // Half a turn with the radius rippling 25% in, twice: 1, 0.75, 1, 0.75, 1 at the quarters.
      return eight((i) => ({ azimuth: i * 22.5, elevation: 0, distance: tidy(1 - 0.25 * Math.sin(2 * Math.PI * (i / 8)) ** 2) }));
    case "lemniscate": {
      // Gerono's figure of eight round the photo's view, read as a 60° angle between its two branches where they cross:
      // ±30° round, ±8.66° up and down (30 · tan 30° / 2).
      const across = 30;
      const up = (across * Math.tan(30 * DEG)) / 2;
      return eight((i) => {
        const th = Math.PI / 2 + (i * Math.PI) / 4;
        return { azimuth: tidy(-across * Math.cos(th), 3), elevation: tidy(up * Math.sin(2 * th), 3), distance: 1 };
      });
    }
    case "zoom_in":
      return [PHOTO_KEY, { t: 1, azimuth: 0, elevation: 0, distance: 0.6 }];
    case "zoom_out":
      return [PHOTO_KEY, { t: 1, azimuth: 0, elevation: 0, distance: 1.5 }];
    case "truck_left":
    case "truck_right":
      return [
        { ...PHOTO_KEY, truck: 0 },
        { t: 1, azimuth: 0, elevation: 0, distance: 1, truck: id === "truck_left" ? -0.5 : 0.5 },
      ];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Editing a path

/** Whether a key is the photo's own camera (where every path starts). */
export function isPhotoPose(k: CameraKey): boolean {
  const near = (a: number, b: number, eps: number) => Math.abs(a - b) < eps;
  return near(k.azimuth, 0, 0.05) && near(k.elevation, 0, 0.05) && near(k.distance, 1, 1e-3) && near(k.truck ?? 0, 0, 1e-3);
}

/**
 * Keys in time order inside 0–1, starting at the photo's pose: the clip's first frame is the photo, so a key at time 0
 * anywhere else (an API or MCP caller's; the editor never makes one) is replaced by the photo's pose, and the photo's
 * pose is put first when the path starts later.
 */
export function normalizeKeys(keys: readonly CameraKey[]): CameraKey[] {
  const list = keys
    .filter((k) => [k.t, k.azimuth, k.elevation, k.distance].every(Number.isFinite))
    .map((k) => ({ ...k, t: clamp(k.t, 0, 1), elevation: clamp(k.elevation, -90, 90), distance: clamp(k.distance, DISTANCE.min, DISTANCE.max) }))
    .sort((a, b) => a.t - b.t);
  const start = list.find((k) => k.t === 0 && isPhotoPose(k));
  return [start ?? { ...PHOTO_KEY }, ...list.filter((k) => k.t > 0)];
}

/** The same keys, evenly spaced in time (what adding or removing a key leaves). */
export function spaceEvenly(keys: readonly CameraKey[]): CameraKey[] {
  const n = keys.length;
  return keys.map((k, i) => ({ ...k, t: n > 1 ? tidy(i / (n - 1)) : 0 }));
}

/** A key added at the end of the path (the start stays the photo's pose), the keys spaced evenly; at most MAX_KEYS. */
export function addKey(keys: readonly CameraKey[], key: Omit<CameraKey, "t">): CameraKey[] {
  const list = keys.length ? [...keys] : [{ ...PHOTO_KEY }];
  if (list.length >= MAX_KEYS) return [...keys];
  return spaceEvenly([...list, { ...key, t: 1 }]);
}

/** A key taken out (never the start), the rest spaced evenly. */
export function removeKey(keys: readonly CameraKey[], index: number): CameraKey[] {
  if (index <= 0 || index >= keys.length) return [...keys];
  return spaceEvenly(keys.filter((_, i) => i !== index));
}

/** The camera at time t: the first key before it, the last after it; azimuth and height in a line, distance by ratio. */
export function keyAt(keys: readonly CameraKey[], t: number): CameraKey {
  const list = keys.length ? keys : [PHOTO_KEY];
  if (t <= list[0].t) return { ...list[0], t };
  const last = list[list.length - 1];
  if (t >= last.t) return { ...last, t };
  let i = 0;
  while (i < list.length - 2 && list[i + 1].t < t) i++;
  const a = list[i];
  const b = list[i + 1];
  const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  const lerp = (x: number, y: number) => x + (y - x) * f;
  const truck = a.truck || b.truck ? lerp(a.truck ?? 0, b.truck ?? 0) : undefined;
  return {
    t,
    azimuth: lerp(a.azimuth, b.azimuth),
    elevation: lerp(a.elevation, b.elevation),
    distance: Math.exp(lerp(Math.log(a.distance), Math.log(b.distance))),
    ...(truck !== undefined ? { truck } : {}),
  };
}

/** A chip's words: "1.2 s · 90° · +10° · 1.2x" (time in seconds of a clip `duration` long, round, height, distance). */
export function keyLabel(k: CameraKey, duration: number): string {
  const deg = Math.round(k.azimuth);
  const up = Math.round(k.elevation);
  const parts = [`${(k.t * duration).toFixed(1)} s`, `${deg}°`, `${up > 0 ? "+" : ""}${up}°`, `${k.distance.toFixed(1)}x`];
  if (k.truck) parts.push(`slide ${k.truck > 0 ? "right" : "left"} ${Math.abs(k.truck).toFixed(1)}`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// The 3D scene's pose (scene3d.ts scenePose)

/**
 * A scene pose as a key at time t: azimuth = horizontal, unwrapped to the turn nearest `near` (the previous key's
 * azimuth, so 350° after 10° is −10°, not a turn the long way round); elevation = vertical; distance = 2^(−(zoom − 5) / 5),
 * the inverse of scenePose's zoom (5 = the photo's framing, each 5 steps closer halves the distance).
 */
export function fromScenePose(p: ScenePose, t = 1, near = 0): CameraKey {
  const azimuth = p.horizontal + 360 * Math.round((near - p.horizontal) / 360);
  return { t, azimuth: tidy(azimuth, 1), elevation: tidy(p.vertical, 1), distance: tidy(clamp(2 ** (-(p.zoom - 5) / 5), DISTANCE.min, DISTANCE.max), 3) };
}

/** A key as the scene's pose: the angle folded into 0–360, the height into scenePose's −30…90, the zoom 0–10. */
export function toScenePose(k: CameraKey): ScenePose {
  const horizontal = tidy(((round(k.azimuth, 0.1) % 360) + 360) % 360, 1);
  return { horizontal: horizontal === 360 ? 0 : horizontal, vertical: tidy(clamp(k.elevation, -30, 90), 1), zoom: tidy(clamp(5 - 5 * Math.log2(k.distance), 0, 10), 1) };
}

// ---------------------------------------------------------------------------
// fal's H3 Max camera-controls

/**
 * H3 Max's azimuth sign is not documented: Fuobe's + is "the camera moves round to the right". Flip this one constant
 * if the first paid test turns the other way.
 */
export const H3_AZIMUTH_SIGN: 1 | -1 = 1;

/** What the endpoint takes (paid-model-apis-2.json, camera_trajectory): 2–12 keys, elevation ±90, ≤ 32 turns of travel. */
export interface TrajectoryLimits {
  min: number;
  max: number;
  elevation: [number, number];
  maxTurns: number;
}
export const H3_LIMITS: TrajectoryLimits = { min: 2, max: 12, elevation: [-90, 90], maxTurns: 32 };

export interface H3Keyframe {
  time: number;
  azimuth: number;
  elevation: number;
  distance: number;
}

export type H3Camera = { trajectory: H3Keyframe[]; notes: string[] } | { freeCamera: "truck_left" | "truck_right"; notes: string[] };

/** How far the interpolated path moves if key i is dropped (degrees; distance counted as 90° per doubling). */
function dropCost(keys: readonly CameraKey[], i: number): number {
  const at = keyAt([keys[i - 1], keys[i + 1]], keys[i].t);
  const k = keys[i];
  return Math.hypot(at.azimuth - k.azimuth, at.elevation - k.elevation, 90 * Math.log2(at.distance / k.distance), 90 * ((at.truck ?? 0) - (k.truck ?? 0)));
}

/** At most `max` keys: the start and end stay, and the key whose loss changes the path least goes first. */
export function simplifyKeys(keys: readonly CameraKey[], max: number): CameraKey[] {
  const list = [...keys];
  while (list.length > Math.max(2, max)) {
    let best = 1;
    let cost = Infinity;
    for (let i = 1; i < list.length - 1; i++) {
      const c = dropCost(list, i);
      if (c < cost) {
        cost = c;
        best = i;
      }
    }
    list.splice(best, 1);
  }
  return list;
}

/**
 * The path as H3 Max camera-controls takes it: 2–12 keyframes {time 0–1, azimuth (signed, unwrapped, at most 32 turns of
 * travel), elevation within ±90, distance > 0}. A pure slide (Truck left / right) becomes the endpoint's own truck move
 * (free_camera_preset), which replaces the trajectory; a slide mixed into an orbit is left out, with a note.
 */
export function toH3MaxTrajectory(keys: readonly CameraKey[], limits: TrajectoryLimits = H3_LIMITS): H3Camera {
  const notes: string[] = [];
  let list = normalizeKeys(keys);
  const trucked = list.some((k) => Math.abs(k.truck ?? 0) > 1e-3);
  if (trucked) {
    const first = list[0];
    const still = list.every((k) => Math.abs(k.azimuth - first.azimuth) < 0.05 && Math.abs(k.elevation - first.elevation) < 0.05 && Math.abs(k.distance - first.distance) < 1e-3);
    const slide = list[list.length - 1].truck ?? 0;
    if (still && Math.abs(slide) > 1e-3) return { freeCamera: slide < 0 ? "truck_left" : "truck_right", notes: ["H3 Max slides the camera with its own truck move (one step, about the subject's distance)"] };
    notes.push("H3 Max takes a path round the subject or a slide, not both: the sideways slide is left out");
  }
  if (list.length > limits.max) {
    notes.push(`H3 Max takes up to ${limits.max} keyframes: the path is simplified to the ${limits.max} that matter most`);
    list = simplifyKeys(list, limits.max);
  }
  // Two keys at the same time: the later one wins (H3 holds the first pose before its time anyway).
  list = list.filter((k, i) => i === list.length - 1 || list[i + 1].t > k.t);
  while (list.length < limits.min) list.push({ ...list[list.length - 1], t: 1 });
  let travel = 0;
  for (let i = 1; i < list.length; i++) travel += Math.abs(list[i].azimuth - list[i - 1].azimuth);
  const most = limits.maxTurns * 360;
  const k = travel > most ? most / travel : 1;
  if (k < 1) notes.push(`H3 Max turns at most ${limits.maxTurns} times in one clip: the turns are scaled down to fit`);
  const [lo, hi] = limits.elevation;
  if (list.some((x) => x.elevation < lo || x.elevation > hi)) notes.push(`H3 Max's height is ${lo}° to ${hi}°: steeper keys are clamped`);
  const trajectory = list.map((x) => ({
    time: tidy(x.t, 4),
    azimuth: tidy(round(H3_AZIMUTH_SIGN * x.azimuth * k, 0.1), 1),
    elevation: tidy(round(clamp(x.elevation, lo, hi), 0.1), 1),
    distance: tidy(Math.max(0.05, x.distance), 3),
  }));
  return { trajectory, notes };
}

// ---------------------------------------------------------------------------
// A camera per frame (the browser's path render; WorldCast's cam_info.json later)

/** A 4×4 matrix, row by row. */
export type Mat4 = number[][];
export type Mat3 = number[][];

export interface FramePoses {
  /** Camera-to-world per frame, OpenCV axes (x right, y down, z forward); the world is the photo camera's own frame. */
  poses: Mat4[];
  /** The pixel intrinsic of a width × height frame (square pixels, centred). */
  intrinsic: Mat3;
  width: number;
  height: number;
}

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V): V => {
  const n = Math.hypot(...a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

/**
 * The camera of a key, looking at the subject's pivot (0, 0, pivotDepth) in OpenCV axes, the world being the photo
 * camera's own frame: azimuth turns round the vertical (+ = to the right), elevation lifts it (kept inside ±89° so "up"
 * stays defined), distance scales the pivot depth; a truck moves both camera and aim sideways, so the heading holds.
 */
export function keyPose(k: CameraKey, pivotDepth: number): Mat4 {
  const d = Math.max(1e-6, pivotDepth);
  const a = k.azimuth * DEG;
  const e = clamp(k.elevation, -89, 89) * DEG;
  const r = k.distance * d;
  const pivot: V = [0, 0, d];
  const slide = (k.truck ?? 0) * d;
  const shift: V = [Math.cos(a) * slide, 0, Math.sin(a) * slide];
  const at: V = [pivot[0] + shift[0], pivot[1], pivot[2] + shift[2]];
  const eye: V = [at[0] + r * Math.sin(a) * Math.cos(e), at[1] - r * Math.sin(e), at[2] - r * Math.cos(a) * Math.cos(e)];
  const forward = unit(sub(at, eye));
  const right = unit(cross([0, 1, 0], forward));
  const down = cross(forward, right);
  const m = [
    [right[0], down[0], forward[0], eye[0]],
    [right[1], down[1], forward[1], eye[1]],
    [right[2], down[2], forward[2], eye[2]],
    [0, 0, 0, 1],
  ];
  return m.map((row) => row.map((v) => tidy(v, 6)));
}

/** A pinhole intrinsic for a width × height frame whose horizontal field of view is `fovDeg`. */
export function intrinsicFor(width: number, height: number, fovDeg: number): Mat3 {
  const f = width / 2 / Math.tan(clamp(fovDeg, 1, 179) * DEG * 0.5);
  return [
    [tidy(f, 3), 0, width / 2],
    [0, tidy(f, 3), height / 2],
    [0, 0, 1],
  ];
}

/**
 * `frames` cameras along the path (frame 0 = the photo's own camera when the path starts there), each looking at the
 * pivot at `pivotDepth` (scene3d's medianDepth), and the intrinsic of a `size` frame with a horizontal field of view of
 * `fovDeg`.
 */
export function framePoses(keys: readonly CameraKey[], frames: number, pivotDepth: number, fovDeg: number, size = { width: 832, height: 480 }): FramePoses {
  const list = normalizeKeys(keys);
  const n = Math.max(1, Math.round(frames));
  const poses = Array.from({ length: n }, (_, i) => keyPose(keyAt(list, n > 1 ? i / (n - 1) : 0), pivotDepth));
  return { poses, intrinsic: intrinsicFor(size.width, size.height, fovDeg), width: size.width, height: size.height };
}

/**
 * An OpenCV camera-to-world pose as the scene viewer's fly camera (glTF axes: x right, y up, the photo looking down −Z):
 * the same point and heading, with no roll (paths look at the pivot with the world's up).
 */
export function flyPoseOf(m: Mat4): FlyPose {
  const position: Vec3 = [m[0][3] + 0, -m[1][3] + 0, -m[2][3] + 0];
  const f: Vec3 = [m[0][2], -m[1][2], -m[2][2]];
  return { position, yaw: Math.atan2(-f[0], -f[2]) + 0, pitch: Math.asin(clamp(f[1], -1, 1)) + 0 };
}

/**
 * The horizontal field of view of the `outAspect` crop the video keeps of a photo whose own horizontal field of view is
 * `photoHFov` (the model centre-crops its start frame to the output's shape).
 */
export function cropFov(photoHFov: number, photoAspect: number, outAspect: number): number {
  if (outAspect >= photoAspect) return photoHFov;
  const half = Math.tan(clamp(photoHFov, 1, 179) * DEG * 0.5) * (outAspect / photoAspect);
  return (2 * Math.atan(half)) / DEG;
}

/** A video frame of this shape, its longer side `long` px, both sides multiples of 16 (Wan's latent grid). */
export function renderSize(aspect: number, long = 832): { width: number; height: number } {
  const m16 = (n: number) => Math.max(16, Math.round(n / 16) * 16);
  return aspect >= 1 ? { width: m16(long), height: m16(long / aspect) } : { width: m16(long * aspect), height: m16(long) };
}

/** The open engine's clip: 81 frames at 16 fps (Wan 2.1, about 5 s). */
export const PATH_FRAMES = 81;
export const PATH_FPS = 16;
/** The prompt H3 Max gets when the user writes none: its own default freezes the scene. */
export const DEFAULT_MOTION = "The character keeps moving naturally while the camera follows the path";
