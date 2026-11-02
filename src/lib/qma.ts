/**
 * QMA camera angles (package qma-angles): gribbliest's Qwen-Image 2.1 edit LoRA "qwen-image-2.1-qma-camera-angles" @ 13007eec
 * (Apache-2.0 on its card, rank 64, 319 MB), which re-shoots a picture from one of 96 cameras. Its prompt is always
 * "<qma> {azimuth} {elevation} {distance}", optionally followed by more edit words; directions are the ORIGINAL CAMERA's, not
 * the subject's ("right side view" = the camera swings 90° to its own right round the subject). Card settings: LoRA 1.0,
 * 30 steps, CFG 3, euler / simple, about 1 MP (768 px for previews).
 *
 * Fuobe's camera pose is the one the Angles app, Cinema's 3D scene and its location views already speak (src/lib/scene3d.ts
 * ScenePose, the same numbers as Qwen Multiple Angles' horizontal_angle / vertical_angle / zoom): horizontal 0–360° (0 = where
 * the photo was taken, 90 = moved round to the camera's right), vertical −30…90° (below eye level up to straight down),
 * zoom 0 (wide) … 5 (as framed) … 10 (close-up). Here it snaps to the nearest of the 96 views and back.
 *
 * Pure: the planner writes the words (planGeneration, promptFormat "qma"), and the Angles app's orbit pad, Cinema,
 * the turnaround and the Canvas read the same tables in the browser.
 */
import type { ScenePose } from "@/lib/scene3d";

/** The model that runs it (src/lib/catalog/models.ts): Qwen-Image 2.1 with the QMA LoRA, on your GPU. */
export const QMA_MODEL = "oss-qwen-image-21-qma";
/** Its ComfyUI graph. */
export const QMA_WORKFLOW = "qwen-image-21-qma";

/** The LoRA's trigger: every prompt starts with it. */
export const QMA_TRIGGER = "<qma>";

/** The 8 azimuths, 45° apart, from the front going round to the camera's right. */
export const QMA_AZIMUTHS = [
  "front view",
  "front-right quarter view",
  "right side view",
  "back-right quarter view",
  "back view",
  "back-left quarter view",
  "left side view",
  "front-left quarter view",
] as const;
/** The 4 heights, low to high. */
export const QMA_ELEVATIONS = ["low-angle shot", "eye-level shot", "elevated shot", "high-angle shot"] as const;
/** The 3 distances, near to far. */
export const QMA_DISTANCES = ["close-up", "medium shot", "wide shot"] as const;

export type QmaAzimuth = (typeof QMA_AZIMUTHS)[number];
export type QmaElevation = (typeof QMA_ELEVATIONS)[number];
export type QmaDistance = (typeof QMA_DISTANCES)[number];

export interface QmaView {
  azimuth: QmaAzimuth;
  elevation: QmaElevation;
  distance: QmaDistance;
}

/** Short names for the picker and for a run's label. */
export const QMA_AZIMUTH_LABELS: Record<QmaAzimuth, string> = {
  "front view": "Front",
  "front-right quarter view": "Front right",
  "right side view": "Right side",
  "back-right quarter view": "Back right",
  "back view": "Back",
  "back-left quarter view": "Back left",
  "left side view": "Left side",
  "front-left quarter view": "Front left",
};
export const QMA_ELEVATION_LABELS: Record<QmaElevation, string> = {
  "low-angle shot": "Low angle",
  "eye-level shot": "Eye level",
  "elevated shot": "Elevated",
  "high-angle shot": "High angle",
};
export const QMA_DISTANCE_LABELS: Record<QmaDistance, string> = { "close-up": "Close-up", "medium shot": "Medium", "wide shot": "Wide" };

/** The pose each height and distance stands for (the Angles app's own numbers: vertical_angle, zoom). */
export const QMA_ELEVATION_DEGREES: Record<QmaElevation, number> = { "low-angle shot": -30, "eye-level shot": 0, "elevated shot": 30, "high-angle shot": 60 };
export const QMA_DISTANCE_ZOOM: Record<QmaDistance, number> = { "close-up": 10, "medium shot": 5, "wide shot": 0 };

/** A setting of the model's (params.extra): the same keys the Angles app's choices set, so one pose reads everywhere. */
export const QMA_PARAMS = { horizontal: "horizontal_angle", vertical: "vertical_angle", zoom: "zoom" } as const;

/** The view a run takes when nothing else says: a quarter turn, the card's most reliable kind. */
export const QMA_DEFAULT_VIEW: QmaView = { azimuth: "front-right quarter view", elevation: "eye-level shot", distance: "medium shot" };

/** Every one of the 96 views, azimuth first, then height, then distance. */
export const QMA_VIEWS: readonly QmaView[] = QMA_AZIMUTHS.flatMap((azimuth) => QMA_ELEVATIONS.flatMap((elevation) => QMA_DISTANCES.map((distance) => ({ azimuth, elevation, distance }))));

const wrap360 = (n: number) => ((n % 360) + 360) % 360;

/** The azimuth nearest a horizontal angle, in 45° steps; exactly halfway (22.5°, 67.5°…) goes on round to the right. */
export function qmaAzimuth(horizontal: number): QmaAzimuth {
  const h = Number.isFinite(horizontal) ? wrap360(horizontal) : 0;
  return QMA_AZIMUTHS[Math.floor(h / 45 + 0.5) % 8];
}

/**
 * The height band of a vertical angle: below −15° low, up to 15° eye level, up to 45° elevated, from 45° high (the
 * midpoints between the Angles app's −30, 0, 30 and 60; a midpoint goes up).
 */
export function qmaElevation(vertical: number): QmaElevation {
  const v = Number.isFinite(vertical) ? vertical : 0;
  return v < -15 ? "low-angle shot" : v < 15 ? "eye-level shot" : v < 45 ? "elevated shot" : "high-angle shot";
}

/** The distance band of a zoom: 7.5 and up close-up, 2.5 and down wide, medium between (as Cinema's poseWords reads it). */
export function qmaDistance(zoom: number): QmaDistance {
  const z = Number.isFinite(zoom) ? zoom : 5;
  return z >= 7.5 ? "close-up" : z <= 2.5 ? "wide shot" : "medium shot";
}

/** The nearest of the 96 views to a camera pose. */
export function qmaView(pose: Partial<ScenePose>): QmaView {
  return { azimuth: qmaAzimuth(pose.horizontal ?? 0), elevation: qmaElevation(pose.vertical ?? 0), distance: qmaDistance(pose.zoom ?? 5) };
}

/** The pose a view stands for (for the orbit pad, and to show a QMA run as an angle). */
export function qmaPose(view: QmaView): ScenePose {
  return { horizontal: QMA_AZIMUTHS.indexOf(view.azimuth) * 45, vertical: QMA_ELEVATION_DEGREES[view.elevation], zoom: QMA_DISTANCE_ZOOM[view.distance] };
}

/** The camera words: "front-right quarter view eye-level shot medium shot". */
export function qmaWords(view: QmaView): string {
  return `${view.azimuth} ${view.elevation} ${view.distance}`;
}

/** The whole prompt: the trigger, the camera words, then any other edit words (the card: camera words first). */
export function qmaPrompt(view: QmaView, words?: string): string {
  const extra = words?.trim();
  return `${QMA_TRIGGER} ${qmaWords(view)}${extra ? ` ${extra}` : ""}`;
}

/** A view in a person's words: "Front right · Eye level · Medium". */
export function qmaLabel(view: QmaView): string {
  return `${QMA_AZIMUTH_LABELS[view.azimuth]} · ${QMA_ELEVATION_LABELS[view.elevation]} · ${QMA_DISTANCE_LABELS[view.distance]}`;
}

const phrase = (list: readonly string[], s: string) => list.filter((p) => s.startsWith(p)).sort((a, b) => b.length - a.length)[0];

/** The view and the other words of a QMA prompt; undefined when it doesn't start with the trigger and three camera words. */
export function parseQmaPrompt(prompt: string): { view: QmaView; words: string } | undefined {
  const s = prompt.trim();
  if (!s.startsWith(QMA_TRIGGER)) return undefined;
  let rest = s.slice(QMA_TRIGGER.length).trimStart();
  const azimuth = phrase(QMA_AZIMUTHS, rest) as QmaAzimuth | undefined;
  if (!azimuth) return undefined;
  rest = rest.slice(azimuth.length).trimStart();
  const elevation = phrase(QMA_ELEVATIONS, rest) as QmaElevation | undefined;
  if (!elevation) return undefined;
  rest = rest.slice(elevation.length).trimStart();
  const distance = phrase(QMA_DISTANCES, rest) as QmaDistance | undefined;
  if (!distance) return undefined;
  return { view: { azimuth, elevation, distance }, words: rest.slice(distance.length).replace(/^[\s.,;:]+/, "").trim() };
}

/** The pose a run's settings name (params.extra: horizontal_angle, vertical_angle, zoom), each missing one from the default view. */
export function qmaPoseOf(extra: Record<string, unknown> | undefined): ScenePose {
  const d = qmaPose(QMA_DEFAULT_VIEW);
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : fallback);
  return { horizontal: num(extra?.[QMA_PARAMS.horizontal], d.horizontal), vertical: num(extra?.[QMA_PARAMS.vertical], d.vertical), zoom: num(extra?.[QMA_PARAMS.zoom], d.zoom) };
}

/**
 * The prompt a QMA run sends: words that already start with the trigger and three camera words go as they are (the Angles
 * app's, a Reuse); otherwise the camera words of the run's pose (params.extra) lead and the words follow.
 */
export function qmaRunPrompt(words: string, extra: Record<string, unknown> | undefined): string {
  if (parseQmaPrompt(words)) return words.trim();
  return qmaPrompt(qmaView(qmaPoseOf(extra)), words.replace(QMA_TRIGGER, "").trim());
}

/**
 * The orbit pad's drag: the pose moved by a drag of (dx, dy) pixels on a pad `size` pixels across. A full width turns the
 * camera once round (dragging right swings it to the right); a full height goes from straight below eye level (−30°) to
 * the top (90°), dragging up raising it.
 */
export function orbitDrag(start: ScenePose, dx: number, dy: number, size: number): ScenePose {
  const s = Math.max(1, size);
  return { horizontal: wrap360(start.horizontal + (dx / s) * 360), vertical: Math.max(-30, Math.min(90, start.vertical - (dy / s) * 120)), zoom: start.zoom };
}

/** The 8 eye-level views a turnaround still set makes, the front first, going round to the camera's right. */
export const QMA_TURN_SET: readonly QmaView[] = QMA_AZIMUTHS.map((azimuth) => ({ azimuth, elevation: "eye-level shot" as const, distance: "medium shot" as const }));
