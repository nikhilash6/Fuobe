/**
 * Kinetic's undo and redo for one visit (pure): a stack of documents, at most HISTORY_MAX steps. A drag or a typed
 * number is one gesture: its first change opens a step and the rest replace it, until the gesture settles (on release,
 * or 400 ms after the last keystroke). A change that leaves the recipe as it was adds no step.
 */

import { stableJson } from "@/lib/motion/recipe";

export const HISTORY_MAX = 100;
/** A typing gesture settles this long after the last keystroke. */
export const SETTLE_MS = 400;

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** A gesture is open: its next change replaces the present instead of adding a step. */
  open: boolean;
}

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [], open: false });

const same = (a: unknown, b: unknown) => a === b || stableJson(a) === stableJson(b);

/** A change: a new step, or (inside an open gesture) the same step updated. */
export function change<T>(h: History<T>, next: T, o: { gesture?: boolean } = {}): History<T> {
  if (same(next, h.present)) return o.gesture ? h : { ...h, open: false };
  if (h.open && o.gesture) return { ...h, present: next, future: [] };
  return { past: [...h.past, h.present].slice(-HISTORY_MAX), present: next, future: [], open: !!o.gesture };
}

/** The open gesture is done: the next change is a step of its own. */
export const settle = <T>(h: History<T>): History<T> => (h.open ? { ...h, open: false } : h);

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return { ...h, open: false };
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], open: false };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return { ...h, open: false };
  return { past: [...h.past, h.present].slice(-HISTORY_MAX), present: h.future[0], future: h.future.slice(1), open: false };
}

/** A restored version: the current state goes on the stack, so Undo brings it back. */
export const restore = <T>(h: History<T>, version: T): History<T> => change(settle(h), version);

export const canUndo = (h: History<unknown>) => h.past.length > 0;
export const canRedo = (h: History<unknown>) => h.future.length > 0;
