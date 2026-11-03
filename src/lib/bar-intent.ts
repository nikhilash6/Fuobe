import { NAV_INTENT } from "./ui-motion";

/*
 * The top bar's menus as plain logic (no React, no DOM): which menu is open and how, when resting the pointer on an
 * item opens it, and whether the pointer is heading into the open menu (the "safe triangle"). The controller
 * (components/nav/bar-menus.tsx) feeds it events and owns the one timer; tests/bar-intent.test.ts covers it.
 *
 * One menu at most is open. Opening one replaces the open one in place (never close-then-open, so a switch never has a
 * frame with nothing open), and a close names its menu: a late timer for a menu that is no longer open does nothing.
 */

/** The bar's six menu items, left to right (the order a switch slides in). */
export const BAR_MENUS = ["create", "studios", "apps", "motions", "canvas", "more"] as const;
export type BarMenuId = (typeof BAR_MENUS)[number];

/** Opened by resting the pointer (closes when the pointer leaves) or pinned by a click, a tap or a key. */
export type MenuMode = "hover" | "pinned";
/** What opened it: the mouse, the keyboard, a finger or pen, or a button elsewhere on the page (openArea). */
export type MenuVia = "pointer" | "key" | "touch" | "area";

export interface BarMenuState {
  id: BarMenuId | null;
  mode: MenuMode;
  via: MenuVia;
  /** The column asked for (openArea(id, group)): it takes focus first. */
  group?: string;
  /**
   * Opened by a click, a tap or a key on this item (or a button elsewhere): the next click on it closes it. A menu the
   * pointer opened, or switched to while another was pinned, is only pinned by a click, never closed.
   */
  clicked: boolean;
  /** The menu this one replaced (a switch), or null when it opened from nothing. */
  prev: BarMenuId | null;
  /** When the last menu closed (performance.now ms), for the switch window. */
  closedAt: number;
  /** Counts every open, switch and re-open by a key or a button (focus moves in once per count). */
  seq: number;
}

export const CLOSED_MENUS: BarMenuState = { id: null, mode: "hover", via: "pointer", clicked: false, prev: null, closedAt: Number.NEGATIVE_INFINITY, seq: 0 };

export type BarMenuAction =
  /**
   * Open `id` (replacing the open menu in place). A hover open never unpins a pinned menu. `clicked`: by this item's
   * own click or key (the next click closes it).
   */
  | { type: "open"; id: BarMenuId; mode: MenuMode; via: MenuVia; group?: string; clicked?: boolean; now: number }
  /** A click or tap on an item: open it pinned; pin it when the pointer opened it; close it when pinned. */
  | { type: "click"; id: BarMenuId; via: MenuVia; now: number }
  /** Close the open menu, or (with `id`) only if `id` is the open one. */
  | { type: "close"; id?: BarMenuId; now: number };

export function barMenus(s: BarMenuState, a: BarMenuAction): BarMenuState {
  switch (a.type) {
    case "open": {
      if (s.id === a.id) {
        const mode: MenuMode = s.mode === "pinned" || a.mode === "pinned" ? "pinned" : "hover";
        const refocus = a.via === "key" || a.via === "area";
        const clicked = s.clicked || !!a.clicked;
        if (mode === s.mode && !refocus && a.group === s.group && clicked === s.clicked) return s;
        return { ...s, mode, clicked, via: a.mode === "pinned" ? a.via : s.via, group: a.group, seq: refocus ? s.seq + 1 : s.seq };
      }
      return { id: a.id, mode: a.mode, via: a.via, clicked: !!a.clicked, group: a.group, prev: s.id, closedAt: s.closedAt, seq: s.seq + 1 };
    }
    case "click": {
      if (s.id === a.id) {
        if (!s.clicked) return { ...s, mode: "pinned", via: a.via, clicked: true };
        return barMenus(s, { type: "close", id: a.id, now: a.now });
      }
      return barMenus(s, { type: "open", id: a.id, mode: "pinned", via: a.via, clicked: true, now: a.now });
    }
    case "close": {
      if (s.id === null || (a.id !== undefined && a.id !== s.id)) return s;
      return { ...s, id: null, prev: null, group: undefined, mode: "hover", clicked: false, closedAt: a.now };
    }
  }
}

/** While a menu is open, or just after one closed, entering another item opens it at once (no rest). */
export function switchesAtOnce(s: BarMenuState, now: number, window: number = NAV_INTENT.switchWindow): boolean {
  return s.id !== null || now - s.closedAt < window;
}

/** The direction a switch travels: 1 to the right, -1 to the left, 0 when it opened from nothing. */
export function switchDirection(prev: BarMenuId | null, id: BarMenuId | null): -1 | 0 | 1 {
  if (!prev || !id || prev === id) return 0;
  return BAR_MENUS.indexOf(id) > BAR_MENUS.indexOf(prev) ? 1 : -1;
}

/* ----- Rest: the pointer has stopped on an item. ----- */

export interface Rest {
  /** When the pointer came onto the item. */
  enterAt: number;
  /** Where and when it last stopped (moves within `restSlop` of here count as resting). */
  anchor: { x: number; y: number; t: number };
}

export function restStart(x: number, y: number, t: number): Rest {
  return { enterAt: t, anchor: { x, y, t } };
}

/** A move over the item: one more than `slop` px from the anchor starts the rest again from here. */
export function restMove(r: Rest, x: number, y: number, t: number, slop: number = NAV_INTENT.restSlop): Rest {
  if (Math.hypot(x - r.anchor.x, y - r.anchor.y) <= slop) return r;
  return { ...r, anchor: { x, y, t } };
}

/** When the menu opens if the pointer stays: `rest` after it stopped, and never later than `cap` after it came. */
export function restDue(r: Rest, rest: number = NAV_INTENT.rest, cap: number = NAV_INTENT.restCap): number {
  return Math.min(r.anchor.t + rest, r.enterAt + cap);
}

/* ----- The safe triangle: the pointer heading from an item into its open menu. ----- */

export interface Pt {
  x: number;
  y: number;
}
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface Move extends Pt {
  t: number;
}

const side = (p: Pt, a: Pt, b: Pt) => (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);

/** Whether `p` is inside the triangle a, b, c (its edges count). */
export function inTriangle(p: Pt, a: Pt, b: Pt, c: Pt): boolean {
  const d1 = side(p, a, b);
  const d2 = side(p, b, c);
  const d3 = side(p, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

const inBox = (p: Pt, b: Box) => p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom;

/**
 * The pointer is on its way into the open menu: inside the triangle from where it left the item (`exit`) to the menu's
 * two top corners (widened by `pad`), still moving (the last move under `stop` ms ago, faster than 0.05 px/ms) and
 * downwards. `moves`: the last few pointer moves, oldest first.
 */
export function aiming(exit: Pt | null, menu: Box | null, moves: readonly Move[], now: number, pad = 8, stop: number = NAV_INTENT.aimStop): boolean {
  if (!exit || !menu || moves.length < 2) return false;
  const last = moves[moves.length - 1];
  const first = moves[0];
  if (now - last.t > stop) return false;
  const dt = Math.max(1, last.t - first.t);
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  if (dy <= 0 || Math.hypot(dx, dy) / dt < 0.05) return false;
  if (inBox(last, menu)) return true;
  return inTriangle(last, exit, { x: menu.left - pad, y: menu.top }, { x: menu.right + pad, y: menu.top });
}
