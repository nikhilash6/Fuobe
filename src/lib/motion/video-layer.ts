/**
 * Kinetic's video layer (pure): the person's own clip under a scene's words. It is drawn first, outside the camera (so
 * it never zooms), then a dim and a scrim in the ground colour, then the scene. Frame t shows the clip's picture at
 * `from + t` seconds, held on its last frame when the clip is shorter; a clip at another frame rate is mapped by time.
 */

import { withAlpha, type DisplayNode, type VideoNode } from "./display";
import { trackAt } from "./edit";
import { CLIP_SCENES } from "./kinetic-groups";
import type { Recipe, VideoLayer } from "./recipe";
import type { SceneInput } from "./scene";

/** How far before the clip's end its last frame is held (a seek exactly at the end shows nothing). */
const END_HOLD = 1e-3;

export interface ClipInfo {
  w: number;
  h: number;
  duration: number;
}

/** The clip layer a recipe draws in this scene, with its clip's facts (null: none). */
export function clipLayer(input: SceneInput): { layer: VideoLayer; clip: ClipInfo } | null {
  const layer = input.recipe.layers?.video;
  const clip = input.clips?.clip;
  if (!layer || !clip || !(clip.w > 0 && clip.h > 0) || !CLIP_SCENES.includes(input.recipe.scene)) return null;
  return { layer, clip };
}

/** The clip's box in a frame: cover fills it (cropping), contain shows all of it (bars in the background). */
export function clipBox(clip: { w: number; h: number }, design: { w: number; h: number }, fit: VideoLayer["fit"]): { x: number; y: number; w: number; h: number } {
  const s = fit === "cover" ? Math.max(design.w / clip.w, design.h / clip.h) : Math.min(design.w / clip.w, design.h / clip.h);
  const w = clip.w * s;
  const h = clip.h * s;
  return { x: (design.w - w) / 2, y: (design.h - h) / 2, w, h };
}

/** Seconds into the clip at film time `t`. */
export const clipTime = (layer: Pick<VideoLayer, "from">, clip: Pick<ClipInfo, "duration">, t: number): number => Math.max(0, Math.min(layer.from + Math.max(0, t), clip.duration - END_HOLD));

/** The layer's nodes at `t`: the clip, its dim (a track replaces the slider) and its scrim. */
export function clipNodes(r: Recipe, l: { layer: VideoLayer; clip: ClipInfo }, design: { w: number; h: number }, ground: string, t: number): DisplayNode[] {
  const box = clipBox(l.clip, design, l.layer.fit);
  const video: VideoNode = { type: "video", src: "clip", ...box, time: clipTime(l.layer, l.clip, t) };
  const out: DisplayNode[] = [video];
  const dim = trackAt(r, "clip.dim", t) ?? l.layer.dim;
  if (dim > 0) out.push({ type: "rect", x: 0, y: 0, w: design.w, h: design.h, fill: `rgba(0,0,0,${Math.min(0.8, dim)})` });
  const s = l.layer.scrim;
  if (s === "full") out.push({ type: "rect", x: 0, y: 0, w: design.w, h: design.h, fill: withAlpha(ground, 0.55) });
  else if (s === "bottom" || s === "top") {
    const [y0, y1] = s === "bottom" ? [design.h, design.h * 0.4] : [0, design.h * 0.6];
    out.push({ type: "rect", x: 0, y: 0, w: design.w, h: design.h, fill: { kind: "linear", x0: 0, y0, x1: 0, y1, stops: [{ at: 0, color: withAlpha(ground, 0.88) }, { at: 0.55, color: withAlpha(ground, 0.45) }, { at: 1, color: withAlpha(ground, 0) }] } });
  }
  return out;
}

/** The ground under a clip (contain's bars). */
export const CLIP_GROUND = "#000000";
