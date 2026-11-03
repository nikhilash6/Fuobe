import { describe, expect, it } from "vitest";
import { canRedo, canUndo, change, HISTORY_MAX, redo, restore, settle, startHistory, undo } from "@/components/kinetic/history";

// Kinetic's undo and redo for one visit: steps, gestures joined into one step, the 100-step cap, and a restored
// version putting what was open on the stack.

describe("Kinetic history", () => {
  it("undoes and redoes plain changes", () => {
    let h = startHistory({ a: 1 });
    h = change(h, { a: 2 });
    h = change(h, { a: 3 });
    expect(canUndo(h)).toBe(true);
    h = undo(h);
    expect(h.present).toEqual({ a: 2 });
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toEqual({ a: 3 });
    // A new change clears what could be redone.
    h = change(undo(h), { a: 9 });
    expect(canRedo(h)).toBe(false);
  });

  it("joins a drag or typing into one step until it settles, and ignores a change that changes nothing", () => {
    let h = startHistory({ v: 0 });
    for (let i = 1; i <= 10; i++) h = change(h, { v: i }, { gesture: true });
    expect(h.past).toHaveLength(1);
    h = settle(h);
    h = change(h, { v: 11 }, { gesture: true });
    expect(h.past).toHaveLength(2);
    expect(change(h, { v: 11 })).toEqual({ ...h, open: false });
    expect(undo(undo(h)).present).toEqual({ v: 0 });
  });

  it("keeps at most 100 steps", () => {
    let h = startHistory(0);
    for (let i = 1; i <= HISTORY_MAX + 30; i++) h = change(h, i);
    expect(h.past).toHaveLength(HISTORY_MAX);
    expect(h.past[0]).toBe(30);
  });

  it("a restore puts what was open on the stack, so Undo brings it back", () => {
    let h = startHistory({ s: "open" });
    h = change(h, { s: "edited" }, { gesture: true });
    h = restore(h, { s: "version" });
    expect(h.present).toEqual({ s: "version" });
    expect(undo(h).present).toEqual({ s: "edited" });
  });
});
