/**
 * The 2.5D camera (pure): pan, zoom and roll over flat layers, with parallax by depth. A layer at depth z (0: the focus
 * plane; more: farther away) moves and scales by focal / (focal + z), so near layers slide past far ones. Moves come
 * from keys or a preset; a shake is seeded noise, for impacts only. Every layer keeps covering the frame (4 % overscan).
 */

import { about, multiply, translate, type Matrix } from "./display";
import { noise1 } from "./random";
import { sample, type Key } from "./tween";
import { local } from "./time";
import { curve, type CurveName } from "./ease";

export interface Camera {
  /** Pan, in design units. */
  x: number;
  y: number;
  zoom: number;
  /** Radians. */
  roll: number;
  focal: number;
}

export const REST_CAMERA: Camera = { x: 0, y: 0, zoom: 1, roll: 0, focal: 1000 };

export type CameraPreset = "still" | "push-in" | "drift" | "rise" | "orbit-2d";

export interface CameraMove {
  preset?: CameraPreset;
  /** Or keys per channel. */
  keys?: Partial<Record<"x" | "y" | "zoom" | "roll", Key[]>>;
  /** The window the preset plays in (seconds). */
  from?: number;
  to?: number;
  curve?: CurveName;
  /** Zoom at the start of the window, for push-in (default 1 → 1.06). */
  zoomFrom?: number;
  zoomTo?: number;
  shake?: { amplitude: number; frequency: number; from: number; to: number; seed: number };
}

/** The camera at `t` for a frame `w` units wide. */
export function cameraAt(move: CameraMove, t: number, w: number): Camera {
  const cam = { ...REST_CAMERA };
  const p = move.from !== undefined && move.to !== undefined ? curve(move.curve ?? "move")(local(t, move.from, move.to)) : 0;
  switch (move.preset) {
    case "push-in":
      cam.zoom = (move.zoomFrom ?? 1) + ((move.zoomTo ?? 1.06) - (move.zoomFrom ?? 1)) * p;
      break;
    case "drift":
      cam.x = (p - 0.5) * 0.02 * w;
      break;
    case "rise":
      cam.y = (0.5 - p) * 0.02 * w;
      break;
    case "orbit-2d":
      cam.roll = (p - 0.5) * 0.02;
      cam.x = (p - 0.5) * 0.015 * w;
      break;
  }
  if (move.keys) {
    for (const k of ["x", "y", "zoom", "roll"] as const) {
      const keys = move.keys[k];
      if (keys?.length) cam[k] = sample(keys, t);
    }
  }
  const s = move.shake;
  if (s && t >= s.from && t < s.to) {
    const fade = 1 - local(t, s.from, s.to);
    cam.x += noise1(s.seed, "shake-x", t * s.frequency) * s.amplitude * fade;
    cam.y += noise1(s.seed, "shake-y", t * s.frequency) * s.amplitude * fade;
  }
  return cam;
}

/**
 * The transform a layer at depth `z` gets under `cam`, in a frame w × h. Zooms about the centre, then pans; the scale
 * never drops below the overscan that keeps a full-frame layer covering the frame while it moves.
 */
export function layerMatrix(cam: Camera, z: number, w: number, h: number, coverFrame = false): Matrix {
  const depth = cam.focal / (cam.focal + z);
  let scale = 1 + (cam.zoom - 1) * depth;
  if (coverFrame) {
    const need = 1 + (2 * Math.max(Math.abs(cam.x * depth) / w, Math.abs(cam.y * depth) / h)) + Math.abs(cam.roll) * 0.6;
    scale = Math.max(scale, Math.min(1.04, need));
  }
  return multiply(translate(-cam.x * depth, -cam.y * depth), about(w / 2, h / 2, scale, cam.roll * depth));
}
