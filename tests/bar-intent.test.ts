import { describe, expect, it } from "vitest";
import {
  aiming,
  barMenus,
  CLOSED_MENUS,
  inTriangle,
  restDue,
  restMove,
  restStart,
  switchDirection,
  switchesAtOnce,
  travelling,
  type BarMenuState,
  type Move,
} from "@/lib/bar-intent";
import { NAV_INTENT } from "@/lib/ui-motion";

/*
 * The top bar's menus as plain logic (src/lib/bar-intent.ts): one menu at a time, opened in place, closes that name
 * their menu (so a late timer never closes the menu you moved to), the rest that keeps a glide along the bar from
 * opening menus, and the safe triangle into an open menu.
 */

const open = (s: BarMenuState, id: Parameters<typeof barMenus>[1] extends infer A ? (A extends { type: "open"; id: infer I } ? I : never) : never, mode: "hover" | "pinned" = "hover", now = 0) =>
  barMenus(s, { type: "open", id, mode, via: "pointer", now });

describe("the menu state", () => {
  it("opens one menu, and opening another replaces it in place (never two, never none between)", () => {
    const a = open(CLOSED_MENUS, "studios");
    expect(a).toMatchObject({ id: "studios", mode: "hover", prev: null });
    const b = open(a, "apps");
    expect(b).toMatchObject({ id: "apps", mode: "hover", prev: "studios" });
    expect(b.seq).toBe(a.seq + 1);
  });

  it("closeIf: a close for a menu that is no longer open does nothing (the stale-timer bug)", () => {
    const s = open(open(CLOSED_MENUS, "studios"), "apps");
    expect(barMenus(s, { type: "close", id: "studios", now: 10 })).toBe(s);
    const closed = barMenus(s, { type: "close", id: "apps", now: 10 });
    expect(closed).toMatchObject({ id: null, closedAt: 10, prev: null });
    expect(barMenus(closed, { type: "close", now: 20 })).toBe(closed);
  });

  it("a mouse click never pins: on a menu the pointer opened it only marks it clicked; the next click closes it", () => {
    const hover = open(CLOSED_MENUS, "create");
    const clicked = barMenus(hover, { type: "click", id: "create", via: "pointer", now: 30 });
    expect(clicked).toMatchObject({ id: "create", mode: "hover", clicked: true });
    const closed = barMenus(clicked, { type: "click", id: "create", via: "pointer", now: 60 });
    expect(closed.id).toBeNull();
    // From nothing, a mouse click opens it as a hover does (it closes once the mouse leaves).
    expect(barMenus(CLOSED_MENUS, { type: "click", id: "apps", via: "pointer", now: 0 })).toMatchObject({ id: "apps", mode: "hover", clicked: true });
    // A tap on a menu the pointer opened pins it.
    expect(barMenus(hover, { type: "click", id: "create", via: "touch", now: 30 })).toMatchObject({ id: "create", mode: "pinned", clicked: true });
    const fresh = barMenus(CLOSED_MENUS, { type: "click", id: "more", via: "touch", now: 0 });
    expect(fresh).toMatchObject({ id: "more", mode: "pinned", via: "touch" });
    // A click on another item while one is open switches to it, pinned.
    expect(barMenus(fresh, { type: "click", id: "create", via: "touch", now: 5 })).toMatchObject({ id: "create", mode: "pinned", prev: "more" });
  });

  it("a click on a menu reached by moving from a pinned one pins it; only a menu its own click opened closes", () => {
    const pinned = barMenus(CLOSED_MENUS, { type: "click", id: "studios", via: "touch", now: 0 });
    expect(pinned.clicked).toBe(true);
    // Onto Apps with the pointer: it takes over, pinned (a menubar), but not by its own click.
    const moved = open(pinned, "apps", "pinned");
    expect(moved).toMatchObject({ id: "apps", mode: "pinned", clicked: false });
    const click1 = barMenus(moved, { type: "click", id: "apps", via: "touch", now: 10 });
    expect(click1).toMatchObject({ id: "apps", mode: "pinned", clicked: true });
    expect(barMenus(click1, { type: "click", id: "apps", via: "touch", now: 20 }).id).toBeNull();
    // A key open counts as the item's own (Enter next closes it).
    const key = barMenus(CLOSED_MENUS, { type: "open", id: "canvas", mode: "pinned", via: "key", clicked: true, now: 0 });
    expect(barMenus(key, { type: "click", id: "canvas", via: "key", now: 5 }).id).toBeNull();
  });

  it("a hover open never unpins a pinned menu; a key re-open counts again (focus moves in)", () => {
    const pinned = open(CLOSED_MENUS, "canvas", "pinned");
    expect(open(pinned, "canvas", "hover")).toBe(pinned);
    const key = barMenus(pinned, { type: "open", id: "canvas", mode: "pinned", via: "key", now: 0 });
    expect(key.seq).toBe(pinned.seq + 1);
    expect(key.mode).toBe("pinned");
  });

  it("switches at once while a menu is open and for a moment after the last one closed", () => {
    const s = open(CLOSED_MENUS, "studios");
    expect(switchesAtOnce(s, 5000)).toBe(true);
    const closed = barMenus(s, { type: "close", now: 1000 });
    expect(switchesAtOnce(closed, 1000 + NAV_INTENT.switchWindow - 1)).toBe(true);
    expect(switchesAtOnce(closed, 1000 + NAV_INTENT.switchWindow + 1)).toBe(false);
    expect(switchesAtOnce(CLOSED_MENUS, 0)).toBe(false);
  });

  it("slides the way the pointer went, in bar order", () => {
    expect(switchDirection("studios", "apps")).toBe(1);
    expect(switchDirection("canvas", "studios")).toBe(-1);
    expect(switchDirection("more", "create")).toBe(-1);
    expect(switchDirection(null, "apps")).toBe(0);
  });
});

/** A glide straight across an item `width` px wide at `speed` px/s, one move per 16 ms: does its menu open? */
function glideOpens(width: number, speed: number): boolean {
  const step = (speed * 16) / 1000;
  let r = restStart(0, 20, 0);
  let t = 0;
  for (let x = step; x <= width; x += step) {
    t += 16;
    if (restDue(r) <= t) return true;
    r = restMove(r, x, 20, t);
  }
  // The pointer leaves at the far edge.
  return restDue(r) <= t;
}

describe("resting on an item", () => {
  it("opens 120 ms after the pointer stops", () => {
    const r = restStart(10, 10, 1000);
    expect(restDue(r)).toBe(1000 + NAV_INTENT.rest);
  });

  it("small moves (8 px) count as resting; a bigger one starts the rest again", () => {
    let r = restStart(10, 10, 0);
    r = restMove(r, 15, 14, 50);
    expect(r.anchor).toEqual({ x: 10, y: 10, t: 0 });
    r = restMove(r, 30, 10, 80);
    expect(r.anchor).toEqual({ x: 30, y: 10, t: 80 });
    expect(restDue(r)).toBe(80 + NAV_INTENT.rest);
  });

  it("opens anyway 600 ms after the pointer came, however it moves", () => {
    let r = restStart(0, 0, 0);
    for (let t = 16; t < 700; t += 16) r = restMove(r, t, 0, t);
    expect(restDue(r)).toBe(NAV_INTENT.restCap);
  });

  it("a glide along the bar at 600 or 1500 px/s opens nothing; at 300 px/s at most the cap opens one", () => {
    for (const w of [100, 130, 160]) {
      expect(glideOpens(w, 600)).toBe(false);
      expect(glideOpens(w, 1500)).toBe(false);
    }
    // At 300 px/s the anchor still moves on every other step: only the 600 ms cap could open a menu, on an item wider
    // than any in the bar.
    expect(glideOpens(160, 300)).toBe(false);
    expect(glideOpens(200, 300)).toBe(true);
  });
});

describe("the safe triangle", () => {
  it("knows inside from outside", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 10 };
    const c = { x: -10, y: 10 };
    expect(inTriangle({ x: 0, y: 5 }, a, b, c)).toBe(true);
    expect(inTriangle({ x: 8, y: 2 }, a, b, c)).toBe(false);
  });

  // Create's card: 520 px from the item's left edge, 8 px under the bar (top 64).
  const card = { left: 20, top: 64, right: 540, bottom: 700 };
  const exit = { x: 105, y: 34 };
  const path = (pts: [number, number, number][]): Move[] => pts.map(([x, y, t]) => ({ x, y, t }));

  it("holds while the pointer heads down into the open card across the next item", () => {
    expect(aiming(exit, card, path([[110, 36, 0], [120, 38, 16], [130, 40, 32]]), 40)).toBe(true);
  });

  it("lets go when the pointer moves sideways along the bar, goes up, or stops", () => {
    expect(aiming(exit, card, path([[110, 34, 0], [125, 34, 16], [140, 33, 32]]), 40)).toBe(false);
    expect(aiming(exit, card, path([[110, 36, 0], [120, 34, 16], [130, 32, 32]]), 40)).toBe(false);
    expect(aiming(exit, card, path([[110, 36, 0], [120, 38, 16], [130, 40, 32]]), 32 + NAV_INTENT.aimStop + 1)).toBe(false);
  });

  it("holds for a shallow line into a wide panel, not for a drift along the bar", () => {
    // Studios to its far-right column: 1000 px across, 270 down.
    const panel = { left: 0, top: 56, right: 1440, bottom: 700 };
    const from = { x: 330, y: 30 };
    expect(aiming(from, panel, path([[340, 33, 0], [380, 44, 16], [420, 55, 32]]), 40)).toBe(true);
    // Along the bar with a slight sag: switches at once.
    expect(aiming(from, panel, path([[340, 30, 0], [380, 31, 16], [420, 32, 32]]), 40)).toBe(false);
  });

  it("is off without an exit point or a menu", () => {
    expect(aiming(null, card, path([[110, 36, 0], [130, 40, 32]]), 40)).toBe(false);
    expect(aiming(exit, null, path([[110, 36, 0], [130, 40, 32]]), 40)).toBe(false);
  });
});

describe("travelling: a drift along the bar", () => {
  const at = (pts: [number, number][]) => pts.map(([x, t]) => ({ x, y: 30, t }));
  it("is on while the pointer keeps moving sideways (200 px/s), off once it settles", () => {
    expect(travelling(at([[100, 0], [103, 16], [106, 32], [110, 48], [113, 64], [116, 80], [119, 96]]), 100)).toBe(true);
    expect(travelling(at([[100, 0], [102, 40], [103, 80], [104, 120]]), 130)).toBe(false);
    expect(travelling(at([[100, 0], [140, 16]]), 400)).toBe(false);
  });
});
