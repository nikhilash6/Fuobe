/**
 * Keys, tracks and timelines (pure). A track is a list of keys { t, v, ease } sampled at an absolute time; a timeline
 * is a scene's list of timed events (what moves, when, for how long, on which curve), built once per recipe and then
 * read at any t. The same events drive the timing checks in the tests and, later, the sound made from motion.
 */

import { curve, type CurveName } from "./ease";
import { local, mix } from "./time";

export interface Key {
  t: number;
  v: number;
  /** The curve into this key from the one before it (default "move"). */
  ease?: CurveName;
}

/** A track's value at `t`: the first key's before it, the last key's after it, eased in between. */
export function sample(keys: readonly Key[], t: number): number {
  if (!keys.length) return 0;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (t <= b.t) {
      const a = keys[i - 1];
      return mix(a.v, b.v, curve(b.ease ?? "move")(local(t, a.t, b.t)));
    }
  }
  return last.v;
}

/** When item `i` of `n` starts: `each` seconds apart, squeezed so the last starts at most `total` after the first. */
export function stagger(i: number, n: number, each: number, total = Infinity): number {
  if (n <= 1) return 0;
  return i * Math.min(each, total / (n - 1));
}

/** What a timing rule calls a moving thing (tests/motion-timing.test.ts checks each kind's limits). */
export type EventKind = "enter" | "pop" | "fade" | "draw" | "move" | "camera" | "exit";

/** How a group of events is spaced: words (40–80 ms), elements (80–140 ms) or letters (20–50 ms). */
export type StaggerUnit = "letters" | "words" | "elements";

export interface MotionEvent {
  /** Stable name ("headline.line.1", "cta.pill"). */
  id: string;
  kind: EventKind;
  start: number;
  dur: number;
  curve: CurveName;
  /** Events in one staggered group share it, with how they are spaced. */
  group?: string;
  unit?: StaggerUnit;
}

export interface Timeline {
  events: MotionEvent[];
  byId: Map<string, MotionEvent>;
  /** Every element is set by then. */
  rest: number;
}

export function timeline(events: MotionEvent[]): Timeline {
  const byId = new Map(events.map((e) => [e.id, e]));
  return { events, byId, rest: events.reduce((m, e) => Math.max(m, e.start + e.dur), 0) };
}

/** An event's eased progress at `t` (0 before it, 1 after it; an unknown id is done). */
export function progress(tl: Timeline, id: string, t: number): number {
  const e = tl.byId.get(id);
  if (!e) return 1;
  return curve(e.curve)(local(t, e.start, e.start + e.dur));
}

/** An event's plain (linear) progress at `t`. */
export function linearProgress(tl: Timeline, id: string, t: number): number {
  const e = tl.byId.get(id);
  if (!e) return 1;
  return local(t, e.start, e.start + e.dur);
}

/** Limits per kind, in seconds: an entrance 350–700 ms, nothing that moves under 200 ms. */
export const DURATION_LIMITS: Record<EventKind, [number, number]> = {
  enter: [0.35, 0.7],
  pop: [0.35, 0.7],
  fade: [0.2, 1.5],
  draw: [0.2, 1.5],
  move: [0.2, 3],
  camera: [0.2, 30],
  exit: [0.2, 0.7],
};

export const STAGGER_LIMITS: Record<StaggerUnit, [number, number]> = {
  letters: [0.02, 0.05],
  words: [0.04, 0.08],
  elements: [0.08, 0.14],
};

const clampTo = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, v));

/**
 * A timeline written for a 2.5 s card (everything set by 1.3 s), scaled by `k` for a shorter or longer one: starts and
 * spacing scale, durations scale within their kind's limits, staggers within their unit's.
 */
export interface Cue {
  id: string;
  kind: EventKind;
  /** Seconds at k = 1. */
  at: number;
  dur: number;
  curve: CurveName;
  /** A staggered group: this is item `index` of `count`, `each` seconds apart (at k = 1). */
  stagger?: { group: string; unit: StaggerUnit; index: number; each: number };
}

export function scaleCues(cues: Cue[], k: number): MotionEvent[] {
  return cues.map((c) => {
    const each = c.stagger ? clampTo(c.stagger.each * k, STAGGER_LIMITS[c.stagger.unit]) : 0;
    const base = c.stagger ? c.at - c.stagger.index * c.stagger.each : c.at;
    const start = base * k + (c.stagger ? c.stagger.index * each : 0);
    return {
      id: c.id,
      kind: c.kind,
      start: Math.round(start * 1e6) / 1e6,
      dur: Math.round(clampTo(c.dur * k, DURATION_LIMITS[c.kind]) * 1e6) / 1e6,
      curve: c.curve,
      ...(c.stagger && { group: c.stagger.group, unit: c.stagger.unit }),
    };
  });
}
