/**
 * The layer stack (pure): a frame is built bottom to top from named layers, each at its own depth, so a camera pan
 * moves far layers less than near ones (2.5D parallax) and each layer settles in from its own scale, coming home on
 * the last frame (so the rest frame is the layout as set).
 *
 *   ground · atmosphere · ghost type · texture · subject · grain · hero type · overlays · details · light · finish
 *
 * A product may sit in front of the hero type (the magazine-cover sandwich): ground, ghost, hero, then the cut-out
 * with its shadow falling on the type. Grain sits under the readable type. Details (corner facts) never move with the
 * camera.
 */

import { group, multiply, type DisplayNode, type Matrix } from "../display";
import { sine } from "../ease";
import { clamp } from "../time";

export type LayerRole = "ground" | "atmosphere" | "ghost" | "texture" | "subject" | "grain" | "hero" | "overlay" | "meta" | "light" | "finish";

export const LAYER_ORDER: readonly LayerRole[] = ["ground", "atmosphere", "ghost", "texture", "subject", "grain", "hero", "overlay", "meta", "light", "finish"];

/** Depth per role: a layer moves camera / z (z 1: the hero's plane; none: fixed to the frame). */
export const LAYER_DEPTH: Record<LayerRole, number | null> = { ground: 4, atmosphere: 3, ghost: 2.5, texture: 2, subject: 1.2, grain: null, hero: 1, overlay: 1, meta: null, light: null, finish: null };

/**
 * How far each role settles in over the clip (1 + push → 1): the field and the ghost pull back while the hero plane
 * (the type and its overlays) pushes in from 97.5 % to 100 %, so the holds keep moving and the last frame is the layout.
 */
export const LAYER_PUSH: Record<LayerRole, number> = { ground: 0.04, atmosphere: 0.05, ghost: 0.06, texture: 0, subject: 0.1, grain: 0, hero: -0.025, overlay: -0.025, meta: 0, light: 0, finish: 0 };

export interface Layer {
  role: LayerRole;
  nodes: DisplayNode[];
  /** Override the role's depth. */
  z?: number;
  /** Override the role's push-in. */
  push?: number;
}

export interface StackOptions {
  w: number;
  h: number;
  t: number;
  duration: number;
  /** The camera's pan at the hero's plane (design units). */
  camera?: { x: number; y: number };
  /** The subject goes over the hero type (the sandwich). */
  sandwich?: boolean;
  /** Push-in on (default) or off. */
  push?: boolean;
}

/** A layer's transform: the pan divided by its depth, and its push-in about the frame's centre. */
export function layerTransform(role: LayerRole, o: StackOptions, z?: number, push?: number): Matrix | undefined {
  const depth = z ?? LAYER_DEPTH[role];
  const amount = o.push === false ? 0 : (push ?? LAYER_PUSH[role]);
  const k = sine.inOut(clamp(o.duration > 0 ? o.t / o.duration : 1));
  const s = 1 + amount * (1 - k);
  const dx = depth ? (o.camera?.x ?? 0) / depth : 0;
  const dy = depth ? (o.camera?.y ?? 0) / depth : 0;
  if (s === 1 && dx === 0 && dy === 0) return undefined;
  const cx = o.w / 2;
  const cy = o.h / 2;
  return multiply([1, 0, 0, 1, dx, dy], [s, 0, 0, s, cx - s * cx, cy - s * cy]);
}

/** The frame's nodes from its layers, in order, each in its own group with its depth's transform. */
export function stack(layers: readonly Layer[], o: StackOptions): DisplayNode[] {
  const order = o.sandwich ? LAYER_ORDER.filter((r) => r !== "subject").flatMap((r) => (r === "hero" ? (["hero", "subject"] as LayerRole[]) : [r])) : LAYER_ORDER;
  const out: DisplayNode[] = [];
  for (const role of order) {
    for (const l of layers) {
      if (l.role !== role || !l.nodes.length) continue;
      const m = layerTransform(role, o, l.z, l.push);
      out.push(group(l.nodes, { id: `layer-${role}`, ...(m && { transform: m }) }));
    }
  }
  return out;
}
