/**
 * Any Angle: one photo becomes a rough 3D view of the subject once (TripoSplat, graph any-angle-3d), and each angle is
 * that view rendered from a chosen camera and painted back into a finished photo by Qwen-Image 2.1 with the AnyAngle
 * LoRA (graph any-angle-shot). This file holds the camera side: the presets, the camera each one makes from a photo's
 * measured front view, and the limits the tests on the GPU set. Pure (no I/O): the page, the server and the tests
 * share it. The front view itself is measured by src/lib/any-angle-front.ts.
 *
 * Camera conventions (core CreateCameraInfo, orbit mode): yaw 0 puts the camera on +Z looking at the target, a larger
 * yaw moves it to its own right (90 = +X), positive pitch is above. The 3D view lives in about [-0.5, 0.5]³.
 * TripoSplat puts every subject in a pose of its own, so the yaw, height and distance that match the photo are measured
 * per photo (the GPU test found yaw 125, 75 and 90 on three photos); "Left 30°" is that front yaw minus 30.
 */

export const ANY_ANGLE = {
  appId: "app-any-angle",
  /** The angles (Library) and the 3D build (a helper step, kept out of Library). */
  feature: "any-angle",
  stepFeature: "any-angle-step",
  shotModel: "oss-any-angle",
  buildModel: "oss-any-angle-3d",
  shotGraph: "any-angle-shot",
  buildGraph: "any-angle-3d",
  /** Bumped when the 3D build or the front measurement changes: a saved view of an older version is built again. */
  version: 1,
  /** The 3D build's seeds (sampler and decoder), fixed so the same photo gives the same 3D view. */
  buildSeed: 46,
  /** The angle's seed unless "Make another" asks for a new one. */
  seed: 46,
  fov: 33,
  /** The LoRA's own prompt; the original is image 1, the render image 2 (the other order gives back the original angle). */
  prompt: "Change the camera angle from <image2> to <image1>.",
  loraFile: "QI2.1_AnyAngle.safetensors",
  loraKey: "qwen-image-21-any-angle",
  /** The render's longest side (RenderSplat takes up to 2048, in steps of 8). */
  maxRender: 2048,
} as const;

/** Words for a build whose front view couldn't be measured (no subject the turntable and the photo share): the page offers another photo. */
export const NO_SUBJECT_MESSAGE = "We couldn't find one clear subject in this photo. Try a photo of one person or one product.";

/**
 * The 3D build's turntable: 48 frames at 12 fps (a 4 s clip shown while picking), rendered from yaw 0 at a fixed height
 * and distance. The same frames, scaled to 192 px, are the sweep the front view is measured on.
 */
export const SWEEP = { frames: 48, yaw: 0, pitch: 10, distance: 2, size: 192, fps: 12, fov: ANY_ANGLE.fov } as const;

/** A photo's front view: the camera that sees the 3D copy as the photo shows the subject. */
export interface FrontView {
  yaw: number;
  /** The turntable's height (10°): the measure finds the turn and the distance, not the height. */
  pitch: number;
  distance: number;
  fov: number;
  /** Where a close-up aims: the face's height in the 3D view (0 = the middle). */
  faceY: number;
  /** A head on shoulders was found in the cut-out: the view from behind is offered. */
  person: boolean;
  /** The head's share of the photo's height (0 when none was found): a big head keeps the high angle lower. */
  headShare: number;
  /** How well the best turntable frame matched the photo (0–1). */
  score: number;
  /** The subject's lowest and highest points in the 3D view (a close-up's aim when no head was found). */
  span: [number, number];
}

export interface Camera {
  yaw: number;
  pitch: number;
  distance: number;
  fov: number;
  target: [number, number, number];
}

export type AngleId = "left-30" | "left-60" | "right-30" | "right-60" | "above" | "below" | "close-up" | "behind";

export interface AnglePreset {
  id: AngleId;
  label: string;
  /** Turn from the front view (negative: the camera moves to the left). */
  yaw: number;
  /** Height above the front view, in degrees. */
  pitch: number;
  /** Times the front view's distance (the close-up's comes from the head's size). */
  distance: number;
  aim: "middle" | "face";
  /** Offered only when the photo shows a person (the unseen back of an object comes out wrong). */
  people?: true;
}

/**
 * The presets, as tested on the GPU: turns up to 60° each way, a high and a low angle, a close-up aimed at the face, and a
 * view from behind at three quarters (people only). Over-the-shoulder, wide and straight-behind views weren't tested, so
 * they aren't offered. Heights add to the front view's height: from above is 30° over it (20° on a portrait), from below
 * 25° under it, as tested.
 */
export const ANGLE_PRESETS: readonly AnglePreset[] = [
  { id: "left-30", label: "Left 30°", yaw: -30, pitch: 0, distance: 1, aim: "middle" },
  { id: "left-60", label: "Left 60°", yaw: -60, pitch: 0, distance: 1, aim: "middle" },
  { id: "right-30", label: "Right 30°", yaw: 30, pitch: 0, distance: 1, aim: "middle" },
  { id: "right-60", label: "Right 60°", yaw: 60, pitch: 0, distance: 1, aim: "middle" },
  { id: "above", label: "From above", yaw: 0, pitch: 30, distance: 1.05, aim: "middle" },
  { id: "below", label: "From below", yaw: 0, pitch: -25, distance: 0.95, aim: "middle" },
  { id: "close-up", label: "Close-up", yaw: 0, pitch: 5, distance: 0.5, aim: "face" },
  { id: "behind", label: "From behind", yaw: 135, pitch: 5, distance: 1, aim: "middle", people: true },
];

/**
 * A portrait's high angle goes at most this far over its front view: at +40 only the top of the head shows, and at +25
 * a head-and-shoulders photo mostly shows hair; +20 keeps the face in view on the photos tested.
 */
export const PORTRAIT_MAX_RISE = 20;
/** A head taller than this share of the photo makes it a portrait. */
export const PORTRAIT_HEAD_SHARE = 0.2;
/** A close-up frames the head at about this share of the picture's height. */
const CLOSE_UP_HEAD_SHARE = 0.45;

/** Limits of a camera picked by hand (the desktop's drag view), relative to the front view. */
export const CUSTOM_LIMITS = { pitchMin: -25, pitchMax: 40, distanceMin: 0.33, distanceMax: 1.5, yawPeople: 150, yawObjects: 90 } as const;

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** A yaw in (-180, 180]. */
export function wrapYaw(y: number): number {
  const w = ((((y + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}

export const presetById = (id: string): AnglePreset | undefined => ANGLE_PRESETS.find((p) => p.id === id);

/**
 * The front view as the visitor says what the photo shows (Person or Object): an object has no view from behind and its
 * close-up aims at its middle; a person whose head the cut-out didn't show gets a close-up a little under the top.
 */
export function asSubject(front: FrontView, person: boolean): FrontView {
  if (person === front.person) return front;
  if (!person) return { ...front, person: false, faceY: 0, headShare: 0 };
  const [low, high] = front.span;
  return { ...front, person: true, faceY: Math.round((high - 0.15 * (high - low)) * 1000) / 1000 };
}

/** The presets a photo offers: the view from behind only when it shows a person. */
export const presetsFor = (front: Pick<FrontView, "person">): AnglePreset[] => ANGLE_PRESETS.filter((p) => !p.people || front.person);

/** The close-up's distance factor: the head at about 45% of the picture, never nearer than a third of the front view. */
export function closeUpFactor(front: Pick<FrontView, "person" | "headShare">): number {
  if (!front.person || !(front.headShare > 0)) return 0.5;
  return round(clamp(front.headShare / CLOSE_UP_HEAD_SHARE, 0.33, 0.75));
}

/** The highest a camera goes on this photo (absolute degrees): lower on a portrait. */
export const maxPitchFor = (front: Pick<FrontView, "headShare" | "pitch">): number =>
  front.pitch + (front.headShare > PORTRAIT_HEAD_SHARE ? PORTRAIT_MAX_RISE : CUSTOM_LIMITS.pitchMax);

/** The camera a preset makes on a photo whose front view was measured. */
export function cameraFor(front: FrontView, preset: AnglePreset): Camera {
  const factor = preset.id === "close-up" ? closeUpFactor(front) : preset.distance;
  const pitch = Math.min(front.pitch + preset.pitch, preset.pitch > 0 ? maxPitchFor(front) : 89);
  return {
    yaw: round(wrapYaw(front.yaw + preset.yaw), 1),
    pitch: round(clamp(pitch, -89, 89), 1),
    distance: round(front.distance * factor),
    fov: front.fov,
    target: [0, preset.aim === "face" ? round(front.faceY, 3) : 0, 0],
  };
}

/** A camera picked by hand, relative to the front view (turn, height, distance factor). */
export interface CustomAngle {
  yaw: number;
  pitch: number;
  distance: number;
}

/** A hand-picked camera kept inside what works: the height and distance the tests covered, no back views of objects. */
export function clampCustom(front: Pick<FrontView, "person" | "headShare" | "pitch">, a: CustomAngle): CustomAngle {
  const turn = front.person ? CUSTOM_LIMITS.yawPeople : CUSTOM_LIMITS.yawObjects;
  const top = maxPitchFor(front) - front.pitch;
  return {
    yaw: round(clamp(wrapYaw(a.yaw), -turn, turn), 1),
    pitch: round(clamp(a.pitch, CUSTOM_LIMITS.pitchMin, Math.max(CUSTOM_LIMITS.pitchMin, Math.min(CUSTOM_LIMITS.pitchMax, top))), 1),
    distance: round(clamp(a.distance, CUSTOM_LIMITS.distanceMin, CUSTOM_LIMITS.distanceMax)),
  };
}

export function customCamera(front: FrontView, a: CustomAngle): Camera {
  const c = clampCustom(front, a);
  return {
    yaw: round(wrapYaw(front.yaw + c.yaw), 1),
    pitch: round(clamp(front.pitch + c.pitch, -89, 89), 1),
    distance: round(front.distance * c.distance),
    fov: front.fov,
    target: [0, 0, 0],
  };
}

/** A hand-picked camera in plain words: "Custom · 40° right, slightly above". */
export function customLabel(a: CustomAngle): string {
  const parts: string[] = [];
  const turn = Math.round(wrapYaw(a.yaw));
  if (Math.abs(turn) >= 5) parts.push(`${Math.abs(turn)}° ${turn < 0 ? "left" : "right"}`);
  if (a.pitch >= 15) parts.push("from above");
  else if (a.pitch >= 5) parts.push("slightly above");
  else if (a.pitch <= -15) parts.push("from below");
  else if (a.pitch <= -5) parts.push("slightly below");
  if (a.distance <= 0.8) parts.push("closer");
  else if (a.distance >= 1.2) parts.push("further back");
  return `Custom · ${parts.length ? parts.join(", ") : "front"}`;
}

/**
 * The desktop drag view's camera (model-viewer's orbit: theta from +Z towards +X, phi from straight up, radius) as a
 * turn, height and distance factor relative to the front view. The 3D model shares the render's axes and units.
 */
export function fromOrbit(front: Pick<FrontView, "yaw" | "pitch" | "distance">, orbit: { theta: number; phi: number; radius: number }): CustomAngle {
  return {
    yaw: round(wrapYaw(orbit.theta - front.yaw), 1),
    pitch: round(90 - orbit.phi - front.pitch, 1),
    distance: round(orbit.radius / front.distance),
  };
}

/** The front view as model-viewer's camera-orbit ("125deg 80deg 1.83m"). */
export const orbitOf = (front: Pick<FrontView, "yaw" | "pitch" | "distance">): string => `${round(front.yaw, 1)}deg ${round(90 - front.pitch, 1)}deg ${round(front.distance)}m`;

/** The render's size: the photo's shape, at most 2048 px on the long side, in steps of 8. */
export function renderSize(width: number, height: number): { width: number; height: number } {
  const k = Math.min(1, ANY_ANGLE.maxRender / Math.max(width, height));
  const fit = (n: number) => Math.max(64, Math.floor((n * k) / 8) * 8);
  return { width: fit(width), height: fit(height) };
}

/** The graph's settings for one angle (params.extra of an any-angle-shot run). */
export function shotExtra(camera: Camera, size: { width: number; height: number }, splat: string): Record<string, number | string> {
  return {
    splatFile: splat,
    cameraYaw: camera.yaw,
    cameraPitch: camera.pitch,
    cameraDistance: camera.distance,
    cameraFov: camera.fov,
    targetX: camera.target[0],
    targetY: camera.target[1],
    targetZ: camera.target[2],
    width: size.width,
    height: size.height,
  };
}

/**
 * The later switch of Fuobe Angles and Angles to this engine (only after the head-to-head on their own set): their
 * controls as a turn, height and distance factor. Fuobe Angles: rotate_right_left is positive to the left; height
 * -1 / 0 / 1 is from above / level / from below; move forward 0 / 5 / 10. Angles: horizontal_angle 0–315, vertical
 * -30…60, zoom 0 / 5 / 10 (wide, medium, close-up).
 */
export function fromFuobeAngles(o: { rotate_right_left?: number; vertical_angle?: number; move_forward?: number }): CustomAngle {
  const v = o.vertical_angle ?? 0;
  const f = o.move_forward ?? 0;
  return { yaw: -(o.rotate_right_left ?? 0), pitch: v < 0 ? 40 : v > 0 ? -25 : 0, distance: f >= 10 ? 0.5 : f >= 5 ? 0.75 : 1 };
}

export function fromAnglesApp(o: { horizontal_angle?: number; vertical_angle?: number; zoom?: number }): CustomAngle {
  const h = o.horizontal_angle ?? 0;
  const z = o.zoom ?? 5;
  return { yaw: h > 180 ? h - 360 : h, pitch: o.vertical_angle ?? 0, distance: z >= 10 ? 0.5 : z <= 0 ? 1.6 : 1 };
}

/** The contact sheet of "All angles": the original as a large tile, then the angles in a grid of `columns`. */
export interface SheetLayout {
  width: number;
  height: number;
  tiles: { x: number; y: number; w: number; h: number; label: string; index: number }[];
}

/**
 * Lay out a contact sheet for pictures of one shape (w × h): the original on the left at twice a tile's size, the
 * angles that finished in two rows to its right, each with a caption band. Angles that failed are simply not there.
 */
export function sheetLayout(shape: { width: number; height: number }, labels: string[], o: { tile?: number; gap?: number; caption?: number } = {}): SheetLayout {
  const tileW = o.tile ?? 480;
  const gap = o.gap ?? 16;
  const caption = o.caption ?? 44;
  const tileH = Math.round((tileW * shape.height) / shape.width);
  const n = labels.length;
  const columns = Math.max(1, Math.ceil(n / 2));
  const rows = n > columns ? 2 : 1;
  const cellH = tileH + caption;
  const bigH = rows * cellH + (rows - 1) * gap - caption;
  const bigW = Math.round((bigH * shape.width) / shape.height);
  const tiles: SheetLayout["tiles"] = [{ x: gap, y: gap, w: bigW, h: bigH, label: "Original", index: -1 }];
  labels.forEach((label, i) => {
    const r = Math.floor(i / columns);
    const c = i % columns;
    tiles.push({ x: gap * 2 + bigW + c * (tileW + gap), y: gap + r * (cellH + gap), w: tileW, h: tileH, label, index: i });
  });
  const width = gap * 2 + bigW + (n ? gap + columns * (tileW + gap) - gap : 0);
  const height = gap * 2 + Math.max(bigH + caption, rows * cellH + (rows - 1) * gap);
  return { width, height, tiles };
}

/** The Any Angle page with a picture in it (Library's "New angle", Image to 3D's "Shoot it from any angle"). */
export const anyAngleHref = (image: string): string => `/apps/${ANY_ANGLE.appId}?image=${encodeURIComponent(image)}`;

/** A finished 3D view as the page reads it (the build's outputs): its files, the photo's front view and size. */
export interface AnyAngleView {
  splat: string;
  turntable?: string;
  mesh?: string;
  front: FrontView;
  size: { width: number; height: number };
}

type ViewOutput = { url: string; meta?: Record<string, unknown> };
const roleOf = (outputs: ViewOutput[], role: string) => outputs.find((o) => o.meta?.role === role);

/** The 3D view a build made, once its front view was measured (the splat output's meta.front and meta.size). */
export function viewOf(g: { outputs: ViewOutput[] }): AnyAngleView | null {
  const splat = roleOf(g.outputs, "splat");
  const front = splat?.meta?.front as FrontView | undefined;
  const size = splat?.meta?.size as AnyAngleView["size"] | undefined;
  if (!splat || !front || !size?.width || !size.height) return null;
  return { splat: splat.url, turntable: roleOf(g.outputs, "turntable")?.url, mesh: roleOf(g.outputs, "mesh")?.url, front, size };
}
