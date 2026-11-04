/**
 * Depth (pure): shadows that sit things on the ground, glows, solid extrusions and offset copies. Every blur comes
 * from the drawer's own cached blur (`soften` on a cached group), so a shadow costs one bitmap draw a frame, and the
 * same shadow looks the same in every browser. Shadows are tinted toward the ground's hue, never pure black.
 */

import { group, type Box, type DisplayNode, type GroupNode, type Matrix, type TextNode } from "../display";
import { mixOk, withLightness, toLab } from "../color";
import { rgba } from "./background";

/** A shadow colour for a ground: its hue, very dark. */
export const shadowTint = (ground: string): string => withLightness(mixOk(ground, "#000000", 0.6), Math.min(0.18, toLab(ground).L * 0.25));

/** A copy of a silhouette in one colour (text runs recoloured; shapes refilled), for shadows and glows. */
export function silhouette(nodes: readonly DisplayNode[], color: string): DisplayNode[] {
  return nodes.map((n): DisplayNode => {
    switch (n.type) {
      case "text":
        return { ...n, decor: true, runs: n.runs.map((r) => ({ ...r, fill: color, ...(r.stroke && { stroke: { ...r.stroke, paint: color } }) })) };
      case "rect":
      case "ellipse":
      case "path":
        return { ...n, fill: color, ...(n.stroke && { stroke: { ...n.stroke, paint: color } }) };
      case "image":
        return { ...n, decor: true };
      case "group":
        return { ...n, children: silhouette(n.children, color) };
      default:
        return n;
    }
  });
}

export interface ShadowOptions {
  /** What casts it (drawn as a silhouette). */
  nodes: readonly DisplayNode[];
  /** The caster's size (its height, or its cap height for type): blur and offset scale with it. */
  size: number;
  ground: string;
  /** Everything the caster draws, in its own units. */
  bounds: Box;
  /** Stable for as long as the caster looks the same. */
  key: string;
  /** 0–1 (fades with the caster). */
  opacity?: number;
}

/**
 * The two-shadow rule: a tight contact shadow (blur ~0.75 % of the size, 1 % down, 30 %) under a wide ambient one
 * (blur ~8 %, 3.5 % down, 14 %), both tinted toward the ground.
 */
export function twoShadow(o: ShadowOptions): GroupNode[] {
  const tint = shadowTint(o.ground);
  const shape = silhouette(o.nodes, tint);
  const k = o.opacity ?? 1;
  const pad = (blur: number, dy: number): Box => ({ x: o.bounds.x - blur * 2.5, y: o.bounds.y - blur * 2.5, w: o.bounds.w + blur * 5, h: o.bounds.h + blur * 5 + dy });
  const ambientBlur = o.size * 0.08;
  const contactBlur = Math.max(0.6, o.size * 0.0075);
  return [
    group([group(shape, { soften: ambientBlur, cache: { key: `ambient|${o.key}|${ambientBlur.toFixed(1)}`, bounds: pad(ambientBlur, 0) } })], { transform: [1, 0, 0, 1, 0, o.size * 0.035], opacity: 0.14 * k }),
    group([group(shape, { soften: contactBlur, cache: { key: `contact|${o.key}|${contactBlur.toFixed(1)}`, bounds: pad(contactBlur, 0) } })], { transform: [1, 0, 0, 1, 0, o.size * 0.01], opacity: 0.3 * k }),
  ];
}

/** A lift: the ambient shadow only, straight under, at 25 %. */
export function lift(o: ShadowOptions): GroupNode {
  const blur = o.size * 0.08;
  return group([group(silhouette(o.nodes, shadowTint(o.ground)), { soften: blur, cache: { key: `lift|${o.key}|${blur.toFixed(1)}`, bounds: { x: o.bounds.x - blur * 2.5, y: o.bounds.y - blur * 2.5, w: o.bounds.w + blur * 5, h: o.bounds.h + blur * 5 } } })], { opacity: 0.25 * (o.opacity ?? 1) });
}

/** A glow behind: a cached blurred copy (3–6 % of the cap height) added as light (dark grounds only). */
export function glowBehind(o: { nodes: readonly DisplayNode[]; color: string; blur: number; alpha?: number; bounds: Box; key: string }): GroupNode {
  const pad = o.blur * 2.5;
  return group(silhouette(o.nodes, o.color), { soften: o.blur, blend: "lighter", opacity: o.alpha ?? 0.45, cache: { key: `glow|${o.key}|${o.color}|${o.blur.toFixed(1)}`, bounds: { x: o.bounds.x - pad, y: o.bounds.y - pad, w: o.bounds.w + 2 * pad, h: o.bounds.h + 2 * pad } } });
}

export interface ExtrudeOptions {
  /** The face (a text node, drawn on top by the caller). */
  face: TextNode;
  /** The face's colour: the sides step from 70 % to 35 % of its brightness, darkest at the back. */
  color: string;
  /** Copies (10–24) and the step between them (1–1.5 units). */
  depth: number;
  step?: number;
  /** Down-right angle in degrees (30–45). */
  angle?: number;
  /** 0–1: the depth grows as the word lands. */
  p?: number;
  /** Cache key for the finished block (when p reaches 1). */
  key: string;
  bounds: Box;
}

/** A solid 2D extrusion behind type: stepped copies down and to the right, darker toward the back. */
export function extrude(o: ExtrudeOptions): GroupNode {
  const n = Math.max(1, Math.round(o.depth * Math.min(1, Math.max(0, o.p ?? 1))));
  const step = o.step ?? 1.25;
  const a = ((o.angle ?? 38) * Math.PI) / 180;
  const L = toLab(o.color).L;
  const copies: DisplayNode[] = [];
  for (let i = n; i >= 1; i--) {
    const k = i / Math.max(1, o.depth);
    const shade = withLightness(o.color, L * (0.7 - 0.35 * k));
    const m: Matrix = [1, 0, 0, 1, Math.cos(a) * step * i, Math.sin(a) * step * i];
    copies.push(group(silhouette([o.face], shade), { transform: m }));
  }
  const reach = o.depth * step;
  const done = (o.p ?? 1) >= 1;
  return group(copies, { id: "extrude", ...(done && { cache: { key: `extrude|${o.key}|${o.color}|${o.depth}|${step}|${o.angle ?? 38}`, bounds: { x: o.bounds.x, y: o.bounds.y, w: o.bounds.w + reach + 2, h: o.bounds.h + reach + 2 } } }) });
}

/** A hard shadow: one solid offset copy (4–8 % of the size, down-right) in a second colour. */
export function hardShadow(face: TextNode, size: number, color: string, share = 0.06): GroupNode {
  return group(silhouette([face], color), { transform: [1, 0, 0, 1, size * share, size * share] });
}

/** An echo stack: 3–5 copies stepping back in opacity (1, 0.5, 0.25, 0.12…) along an offset. */
export function echoStack(face: TextNode, o: { count: number; dx: number; dy: number; color?: string }): GroupNode[] {
  const n = Math.max(1, Math.min(5, Math.round(o.count)));
  const alphas = [0.5, 0.25, 0.12, 0.06, 0.03];
  return Array.from({ length: n }, (_, i) => {
    const k = n - i;
    const copy: TextNode = { ...face, decor: true, ...(o.color && { runs: face.runs.map((r) => ({ ...r, fill: o.color! })) }) };
    return group([copy], { transform: [1, 0, 0, 1, o.dx * k, o.dy * k], opacity: alphas[k - 1] });
  });
}

/** A soft contact shadow under an object resting on a floor (an ellipse, blurred once and cached). */
export function floorShadow(o: { cx: number; y: number; width: number; ground: string; strength?: number; key: string }): GroupNode {
  const rx = o.width * 0.42;
  const ry = Math.max(2, o.width * 0.045);
  const blur = Math.max(2, o.width * 0.035);
  const pad = blur * 3;
  return group([{ type: "ellipse", cx: o.cx, cy: o.y, rx, ry, fill: rgba(shadowTint(o.ground), 1) }], { soften: blur, opacity: o.strength ?? 0.4, cache: { key: `floor|${o.key}|${rx.toFixed(0)}|${o.ground}`, bounds: { x: o.cx - rx - pad, y: o.y - ry - pad, w: 2 * (rx + pad), h: 2 * (ry + pad) } } });
}
