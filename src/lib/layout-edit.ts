/*
 * Box maths for the Layout editor (src/components/studio/layout-editor.tsx): drawing, picking, moving, resizing and
 * nudging boxes on a canvas of the size the model renders. Pure. Boxes are LayoutBox fractions ([x0, y0, x1, y1] of the
 * canvas); the editing happens in the canvas's own pixels, so a box snaps to whole pixels of the picture made (the
 * Layers editor's rectFrom and resizeBox, src/lib/layers.ts).
 */
import { rectFrom, resizeBox, type Handle } from "./layers";
import type { LayoutBox } from "./layout-prompt";

export type { Handle };

/** The smallest box the editor draws, in canvas pixels (a click that barely moves is a click, not a box). */
export const MIN_BOX_PX = 16;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const snap = (v: number) => Math.round(v * 1e6) / 1e6;
const toBox = (x: number, y: number, w: number, h: number, width: number, height: number): LayoutBox => [snap(x / width), snap(y / height), snap((x + w) / width), snap((y + h) / height)];

/**
 * A box drawn from one corner to the other (canvas pixels), kept inside the canvas; null when a side is under `min`
 * (MIN_BOX_PX, or more when the canvas is drawn small on screen: a tap's drift isn't a box).
 */
export function drawnBox(x0: number, y0: number, x1: number, y1: number, width: number, height: number, min = MIN_BOX_PX): LayoutBox | null {
  const r = rectFrom(x0, y0, x1, y1, { width, height }, Math.max(MIN_BOX_PX, min));
  return r ? toBox(r[0], r[1], r[2], r[3], width, height) : null;
}

/** The boxes under a point (fractions), the one drawn last (on top) first. */
export function boxesAt(boxes: LayoutBox[], fx: number, fy: number): number[] {
  const out: number[] = [];
  for (let i = boxes.length - 1; i >= 0; i--) {
    const [x0, y0, x1, y1] = boxes[i];
    if (fx >= x0 && fx <= x1 && fy >= y0 && fy <= y1) out.push(i);
  }
  return out;
}

/**
 * Which box a press picks among the stack under it: pressing the same spot again (`again`, after a press that didn't
 * drag) steps to the next box down the stack, round to the top (LinXce's editor does this); otherwise the selected box
 * stays picked when it is in the stack (so it can be dragged out from under another), else the top one.
 */
export function pickBox(stack: number[], selected: number | null, again: boolean): number | null {
  if (!stack.length) return null;
  const at = selected === null ? -1 : stack.indexOf(selected);
  if (again && at >= 0) return stack[(at + 1) % stack.length];
  return at >= 0 ? selected : stack[0];
}

/** A box moved by dx, dy canvas pixels, kept whole inside the canvas. */
export function movedBox(box: LayoutBox, dx: number, dy: number, width: number, height: number): LayoutBox {
  const [x0, y0, x1, y1] = box;
  const w = (x1 - x0) * width;
  const h = (y1 - y0) * height;
  const x = clamp(x0 * width + dx, 0, Math.max(0, width - w));
  const y = clamp(y0 * height + dy, 0, Math.max(0, height - h));
  return toBox(Math.round(x), Math.round(y), Math.round(w), Math.round(h), width, height);
}

/**
 * A box resized by dragging one of its handles dx, dy canvas pixels: the opposite edge or corner stays put, corners
 * resize freely (resizeBox, unrotated), no side below MIN_BOX_PX, and the box stays inside the canvas.
 */
export function resizedBox(box: LayoutBox, handle: Handle, dx: number, dy: number, width: number, height: number): LayoutBox {
  const [x0, y0, x1, y1] = box;
  const node = { x: x0 * width, y: y0 * height, w: (x1 - x0) * width, h: (y1 - y0) * height, rotation: 0 };
  const r = resizeBox(node, handle, dx, dy, true);
  // Held at the canvas edges and the minimum size, the opposite side where it was.
  let left = r.x;
  let top = r.y;
  let right = r.x + r.w;
  let bottom = r.y + r.h;
  if (handle.includes("w")) left = clamp(left, 0, right - MIN_BOX_PX);
  if (handle.includes("e")) right = clamp(right, left + MIN_BOX_PX, width);
  if (handle.includes("n")) top = clamp(top, 0, bottom - MIN_BOX_PX);
  if (handle.includes("s")) bottom = clamp(bottom, top + MIN_BOX_PX, height);
  const [l, t, rr, b] = [left, top, right, bottom].map(Math.round);
  return toBox(l, t, rr - l, b - t, width, height);
}

/** Arrow keys: one canvas pixel a press, ten with Shift. */
export function nudgedBox(box: LayoutBox, key: string, shift: boolean, width: number, height: number): LayoutBox | null {
  const step = shift ? 10 : 1;
  const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[key];
  return d ? movedBox(box, d[0], d[1], width, height) : null;
}

/**
 * Alt+arrow keys: resize from the right and bottom edges (Left / Right make it narrower / wider, Up / Down shorter /
 * taller), one canvas pixel a press, ten with Shift; the same limits as a handle drag. Null for any other key.
 */
export function keyResizedBox(box: LayoutBox, key: string, shift: boolean, width: number, height: number): LayoutBox | null {
  const step = shift ? 10 : 1;
  const d = ({ ArrowLeft: ["e", -step, 0], ArrowRight: ["e", step, 0], ArrowUp: ["s", 0, -step], ArrowDown: ["s", 0, step] } as Record<string, [Handle, number, number]>)[key];
  return d ? resizedBox(box, d[0], d[1], d[2], width, height) : null;
}

/** A new box in the middle of the canvas, for the keyboard (Add box): a third of each side, nudged down for each one already there. */
export function newBox(count: number): LayoutBox {
  const off = Math.min(0.3, (count % 6) * 0.05);
  return [snap(1 / 3 + off / 2), snap(1 / 3 + off), snap(2 / 3 + off / 2), snap(2 / 3 + off)].map((v) => Math.min(1, v)) as LayoutBox;
}

/**
 * Each kind's box colour (the editor and the composer's strip). Object's blue is deep enough for white numbers at AA
 * (4.7:1); Character's green and Text's orange take dark ones (inkOn).
 */
export const KIND_COLOR = { object: "#0071e3", character: "#34c759", text: "#ff9f0a" } as const;

const DARK_INK = "#1d1d1f";
const LIGHT_INK = "#ffffff";

/** sRGB relative luminance of a #rgb / #rrggbb colour (WCAG 2), null when it isn't one. */
function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio of two colours (WCAG 2): 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [luminance(a) ?? 0, luminance(b) ?? 0];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The ink for a box's number on its colour: near-black on light colours (orange, green, a picked yellow), white on dark ones. */
export function inkOn(color: string): string {
  if (luminance(color) === null) return LIGHT_INK;
  return contrastRatio(color, DARK_INK) >= contrastRatio(color, LIGHT_INK) ? DARK_INK : LIGHT_INK;
}
