/**
 * Layout grid and safe areas (pure). Every Kinetic layout sits on one grid: a 7 % margin of the short side, 12 columns
 * and a baseline unit of 1 %, with four corner slots on the margin's inset line for the small facts (brand, date,
 * web address, index). Readable copy (words, prices, logos, brand names, calls to action) stays inside the safe area
 * of where the piece is shown; only fields, shapes, photos and decorative ghost type may bleed.
 */

import type { Box } from "./display";
import { TILE_CHIPS } from "./sizes";

/** Where a piece is shown, which decides its safe area. */
export type Placement = "ad" | "story" | "post" | "cover";

/** What each placement keeps readable copy out of, as shares of the frame (top, right, bottom, left). */
export const SAFE_INSETS: Record<Placement, { top: number; right: number; bottom: number; left: number }> = {
  // Reels and TikTok ads: the app's caption and buttons cover the bottom 15 % (plus a 4 % pad) and a column on the right.
  ad: { top: 0.14, right: 0.11, bottom: 0.19, left: 0.06 },
  story: { top: 0.14, right: 0.06, bottom: 0.2, left: 0.06 },
  // Posts (1:1, 4:5, 16:9): the grid's margin (set from the short side, below).
  post: { top: 0, right: 0, bottom: 0, left: 0 },
  // A gallery tile: its chips at the top and the bottom.
  cover: { top: TILE_CHIPS.top, right: 0.06, bottom: TILE_CHIPS.bottom, left: 0.06 },
};

/** The grid's margin: 7 % of the short side. */
export const MARGIN = 0.07;

/** Sizes in design units by role, as shares of the short side (1080). */
export const LADDER = {
  hero: [0.14, 0.4],
  sub: [0.036, 0.05],
  body: [0.024, 0.03],
  meta: [0.016, 0.022],
} as const;

/** Brand, offer or call to action on a cover: at least this many design units, to read on a 220 px tile. */
export const COVER_CRITICAL = 60;

/** The hero is at least this many times the size of the smallest detail (the aim is 18–30). */
export const SCALE_CONTRAST = 12;

export interface Grid {
  w: number;
  h: number;
  /** The short side. */
  S: number;
  margin: number;
  /** The margin's box: the inset line the corners sit on. */
  inset: Box;
  /** Where readable copy may go (the inset and the placement's own safe area, whichever is tighter). */
  safe: Box;
  columns: number;
  gutter: number;
  /** Width of one column. */
  col: number;
  /** The baseline unit (1 % of the short side). */
  unit: number;
  placement: Placement;
}

/** The safe area for a frame and placement (posts: the margin). */
export function safeBox(design: { w: number; h: number }, placement: Placement): Box {
  const S = Math.min(design.w, design.h);
  const m = S * MARGIN;
  const s = SAFE_INSETS[placement];
  const left = Math.max(m, design.w * s.left);
  const right = Math.max(m, design.w * s.right);
  const top = Math.max(m, design.h * s.top);
  const bottom = Math.max(m, design.h * s.bottom);
  return { x: left, y: top, w: design.w - left - right, h: design.h - top - bottom };
}

/** The grid for a frame shown in a placement. */
export function gridFor(design: { w: number; h: number }, placement: Placement = "post"): Grid {
  const S = Math.min(design.w, design.h);
  const margin = S * MARGIN;
  const inset = { x: margin, y: margin, w: design.w - 2 * margin, h: design.h - 2 * margin };
  const safe = safeBox(design, placement);
  const columns = 12;
  const gutter = design.w * 0.018;
  const col = (safe.w - gutter * (columns - 1)) / columns;
  return { w: design.w, h: design.h, S, margin, inset, safe, columns, gutter, col, unit: S * 0.01, placement };
}

/** Columns `from` (0-based) for `span` columns, inside the safe area. */
export function columns(g: Grid, from: number, span: number): { x: number; w: number } {
  const a = Math.max(0, Math.min(g.columns - 1, from));
  const n = Math.max(1, Math.min(g.columns - a, span));
  return { x: g.safe.x + a * (g.col + g.gutter), w: n * g.col + (n - 1) * g.gutter };
}

export type Corner = "tl" | "tr" | "bl" | "br";

/**
 * A corner slot for a small fact: the anchor point on the inset line (pushed inside the safe area) and how text is
 * aligned there. Facts in the top corners hang from the line; bottom corners sit on it.
 */
export function corner(g: Grid, c: Corner): { x: number; y: number; align: "left" | "right"; from: "top" | "bottom" } {
  const left = c === "tl" || c === "bl";
  const top = c === "tl" || c === "tr";
  return {
    x: left ? g.safe.x : g.safe.x + g.safe.w,
    y: top ? g.safe.y : g.safe.y + g.safe.h,
    align: left ? "left" : "right",
    from: top ? "top" : "bottom",
  };
}

/** The placement a recipe is shown in: a gallery cover, a 9:16 ad (or story when chosen), or a post. */
export function placementOf(r: { size: unknown; controls?: Record<string, unknown> }): Placement {
  if (r.controls?.cover === "tile") return "cover";
  const tall = r.size === "9:16" || (typeof r.size === "object" && r.size !== null && (r.size as { h: number }).h / (r.size as { w: number }).w > 1.6);
  if (tall) return r.controls?.placement === "story" ? "story" : "ad";
  return "post";
}

/** Whether a box lies inside another (with a tolerance in design units). */
export const inside = (b: Box, area: Box, tol = 0.5): boolean => b.x >= area.x - tol && b.y >= area.y - tol && b.x + b.w <= area.x + area.w + tol && b.y + b.h <= area.y + area.h + tol;

/** Whether two boxes overlap (by more than `tol`). */
export const overlaps = (a: Box, b: Box, tol = 0): boolean => a.x < b.x + b.w - tol && b.x < a.x + a.w - tol && a.y < b.y + b.h - tol && b.y < a.y + a.h - tol;

/** The hero's size range for a frame (14–40 % of the short side). */
export const heroRange = (design: { w: number; h: number }): { min: number; max: number } => {
  const S = Math.min(design.w, design.h);
  return { min: S * LADDER.hero[0], max: S * LADDER.hero[1] };
};
