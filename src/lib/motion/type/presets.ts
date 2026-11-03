/**
 * Text animations (pure): entrances, exits and loops for type, each a plain function of time. A preset says how one
 * unit (the block, a line, a word or a letter) is posed `t` seconds after it starts, how units follow one another,
 * which unit it moves, and how wide the words get at its widest moment (so the layout can fit that moment).
 *
 * Every entrance ends exactly at rest (no offset, no scale, full opacity, nothing swapped), so the frame the cover is
 * taken from is the plain layout. Exits are the entrance played away (mirrored or reversed) in about two thirds of its
 * time, on the "exit" curve, never overshooting. Units never change what is typed: a scramble cycles the letter drawn
 * in a slot for a moment, but the slot's typed letter stays its text, and at rest every slot shows its own letter.
 *
 * Times are seconds; distances are in design units, `em` (the size), `lh` (the line pitch) or shares of the frame.
 */

import { back, CURVES, cubic, elastic, quart, type Ease } from "../ease";
import type { EventKind, StaggerUnit } from "../tween";
import { rng } from "../random";
import { clamp } from "../time";
import type { Box } from "../display";

/** One frame at 30 fps: the presets' timings are written in these. */
export const F = 1 / 30;
const DEG = Math.PI / 180;

export type UnitKind = "block" | "line" | "word" | "glyph";

/** What a preset knows about the unit it poses (its place at rest, and its neighbours). */
export interface UnitInfo {
  kind: UnitKind;
  /** Its place among the units it is staggered with, and how many there are. */
  index: number;
  count: number;
  line: number;
  lines: number;
  /** Its text (a letter, a word, a line, the block). */
  text: string;
  /** Its box at rest: left, top of the em box, advance and line pitch. */
  x: number;
  y: number;
  w: number;
  h: number;
  ink: Box;
  baseline: number;
  /** The size (em), the line pitch, and the cap height. */
  em: number;
  lh: number;
  cap: number;
  /** The block's own box (for moves that gather units into it). */
  block: Box;
  /** The frame (moves that start off screen). */
  frame: { w: number; h: number };
  /** How far down (and up) it must move to be wholly outside its line's clip. */
  clear: { down: number; up: number };
  /** A figure with no figure before it on its line (a number's leading column). */
  lead?: boolean;
}

export interface PresetOptions {
  seed: number;
  /** 0–1: how far things travel and how much they overshoot (1 = as designed). */
  intensity: number;
  /** A hero over a quarter of the frame's height: slower, weightier entrances. */
  hero: boolean;
  /** Type-on: letters a second. */
  rate: number;
  /** Beat-cut: seconds a beat. */
  beat: number;
}

/** A unit's pose: offsets, scale, rotation and the extras some presets draw (all at rest when absent). */
export interface Pose {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  /** Radians. */
  rot: number;
  /** Shear along x (tan of the angle). */
  skewX: number;
  opacity: number;
  /** Blur in design units. */
  blur: number;
  /** Toward black (0–1). */
  shade: number;
  /** Letter spacing (em) for the whole block, when it moves. */
  tracking?: number;
  /** Font weight, when it moves (variable faces). */
  weight?: number;
  /** A letter drawn in place of the typed one for this frame (scramble). */
  shown?: string;
  /** Draw inside the line's clip (a hard edge the unit rises from). */
  clip?: boolean;
  /** A soft wipe: the unit shows from its left edge up to `to` (share of its width), with a feathered edge. */
  reveal?: { from: number; to: number; feather: number };
  /** A solid bar across the line (bar-swipe), its left and right edges as shares of the line's width. */
  bar?: { from: number; to: number };
  /** A copy growing away from an impact. */
  ghost?: { s: number; a: number };
  /** Neon tube lit (0–1). */
  glow?: number;
  /** The top half hinged away (radians, fold). */
  fold?: number;
  /** A split-flap tile mid-flip: the letter leaving, the letter arriving, how far through (0–1). */
  flap?: { from: string; to: string; phase: number };
  /** A rolling figure: its position on the 0–9 strip (fractions between two figures). */
  roll?: number;
  /** The lowest figure the strip shows (places below it are blank, so nothing shows before the figure rolls in). */
  rollFrom?: number;
  /** Red/cyan split along x (design units) while a scramble runs. */
  split?: number;
}

export const REST: Readonly<Pose> = Object.freeze({ dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, skewX: 0, opacity: 1, blur: 0, shade: 0 });
const HIDDEN: Readonly<Pose> = Object.freeze({ ...REST, opacity: 0 });
const pose = (p: Partial<Pose>): Pose => ({ ...REST, ...p });

export type Pivot = "centre" | "baseline-left" | "baseline-centre" | "bottom-left" | "midline";

/** How the units' starts are spaced: gaps wide then tightening (`ease`), from the middle out, in a seeded order, or from the right. */
export type Order = "ease" | "centre" | "seeded" | "reverse";

export type PresetId =
  | "cut-rise"
  | "cut-rise-glyph"
  | "word-lift"
  | "fade-rise"
  | "word-drop"
  | "curtain"
  | "bar-swipe"
  | "focus-in"
  | "track-in"
  | "snap-tight"
  | "slow-drift"
  | "stomp"
  | "beat-cut"
  | "punch"
  | "pop-in"
  | "burst"
  | "inflate"
  | "merge"
  | "plates"
  | "slide-in"
  | "flip-up"
  | "fold"
  | "tumble"
  | "type-on"
  | "scramble"
  | "neon-strike"
  | "split-flap"
  | "odometer"
  | "cut-paper"
  | "weight-wave"
  | "ink-draw";

export type Tone = "luxury" | "editorial" | "sales" | "tech" | "beauty" | "playful" | "sport";

export interface Preset {
  id: PresetId;
  name: string;
  unit: UnitKind;
  /** What the timing rules call its moves. */
  kind: EventKind;
  /** The curve its main event is on (for the timeline). */
  curve: import("../ease").CurveName;
  /** Seconds one unit takes (a hero's when it differs). */
  dur: number;
  heroDur?: number;
  /** Seconds between units' starts. */
  each: number;
  order: Order;
  /** How the stagger is named for the timing rules (by the unit by default). */
  stagger?: StaggerUnit;
  pivot: Pivot;
  /** The widest moment (for fitting): letter spacing in em, a scale, a weight. */
  widest?: { tracking?: number; scale?: number; weight?: number };
  /** Units start together; the preset spaces them itself (one event for the block). */
  together?: boolean;
  /** For glyph presets laid out by line: a line starts when the one before is this far through (0–1). */
  lineOverlap?: number;
  /** The tones it suits, and the ones it never goes with. */
  tones: readonly Tone[];
  never?: readonly Tone[];
  /** Once per template, on the hero word only. */
  signature?: boolean;
  /** The unit's pose `t` seconds after its start (t < 0: before it). */
  enter(t: number, u: UnitInfo, o: PresetOptions): Pose;
  /** The exit's length, and the pose `e` (0–1, linear) through it. */
  exitDur: number;
  exit(e: number, u: UnitInfo, o: PresetOptions): Pose;
}

const enter = CURVES.enter;
const exitC = CURVES.exit;
const snap = CURVES.snap;
const move = CURVES.move;
const decel = CURVES.decel;
const draw = CURVES.draw;
const roll = CURVES.roll;
const expoIn = CURVES.slam;
const back14 = back(1.4).out;
const back12 = back(1.2).out;
const back11 = back(1.1).out;
const elastic14 = elastic(1, 0.4).out;

/** Progress 0–1 through [0, d] (clamped). */
const at = (t: number, d: number): number => clamp(d > 0 ? t / d : 1);
/** A seeded ±1. */
const sign = (o: PresetOptions, ...k: (string | number)[]) => (rng(o.seed, ...k) < 0.5 ? -1 : 1);

// ---------------------------------------------------------------------------
// Exits

/** A plain exit: a short lift as it fades. */
const fadeExit = (e: number, u: UnitInfo): Pose => {
  const k = exitC(e);
  return pose({ dy: -0.1 * u.em * k, opacity: 1 - k });
};

/** Units the exit removes are gone. */
export const GONE: Readonly<Pose> = HIDDEN;

// ---------------------------------------------------------------------------
// Scramble and flap letters

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
const SIGNS = "#%&*+=<>/?$@";

/** The letters a slot cycles through: the same kind as its own letter (capitals for a capital, figures for a figure). */
export function cycleSet(letter: string): string {
  if (/^\p{Lu}$/u.test(letter)) return UPPER;
  if (/^\p{Ll}$/u.test(letter)) return LOWER;
  if (/^\p{Nd}$/u.test(letter)) return DIGITS;
  return SIGNS;
}

/** A seeded letter of the slot's kind, different from its own. */
function otherLetter(letter: string, o: PresetOptions, ...k: (string | number)[]): string {
  const set = cycleSet(letter);
  let c = set[Math.floor(rng(o.seed, ...k) * set.length)];
  if (c === letter) c = set[(set.indexOf(c) + 1) % set.length];
  return c;
}

// ---------------------------------------------------------------------------
// The presets

const P: Preset[] = [
  {
    id: "cut-rise",
    name: "Cut rise",
    unit: "line",
    kind: "enter",
    curve: "enter",
    dur: 0.7,
    heroDur: 0.85,
    each: 0.12,
    order: "ease",
    pivot: "baseline-left",
    tones: ["luxury", "editorial", "beauty", "tech", "sales"],
    enter(t, u, o) {
      const d = o.hero ? 0.85 : 0.7;
      const from = Math.max(1.1 * u.lh, u.clear.down);
      if (t < 0) return pose({ dy: from, rot: 4 * DEG * o.intensity, clip: true });
      if (t >= d) return REST;
      const k = enter(t / d);
      return pose({ dy: (1 - k) * from, rot: (1 - k) * 4 * DEG * o.intensity, clip: true });
    },
    exitDur: 0.48,
    exit: (e, u) => pose({ dy: -Math.max(1.1 * u.lh, u.clear.up) * exitC(e), clip: true }),
  },
  {
    id: "cut-rise-glyph",
    name: "Cut rise by letter",
    unit: "glyph",
    kind: "enter",
    curve: "enter",
    dur: 0.65,
    each: 0.028,
    order: "ease",
    lineOverlap: 0.6,
    pivot: "baseline-left",
    tones: ["editorial", "tech"],
    enter(t, u, o) {
      const from = Math.max(1.05 * u.lh, u.clear.down);
      if (t < 0) return pose({ dy: from, rot: 5 * DEG * o.intensity, clip: true });
      if (t >= 0.65) return REST;
      const k = enter(t / 0.65);
      return pose({ dy: (1 - k) * from, rot: (1 - k) * 5 * DEG * o.intensity, clip: true });
    },
    exitDur: 0.44,
    exit: (e, u) => pose({ dy: -Math.max(1.05 * u.lh, u.clear.up) * exitC(e), clip: true }),
  },
  {
    id: "word-lift",
    name: "Word lift",
    unit: "word",
    kind: "enter",
    curve: "decel",
    dur: 0.45,
    each: 0.075,
    order: "ease",
    pivot: "baseline-left",
    tones: ["luxury", "editorial", "sales", "tech", "beauty", "playful", "sport"],
    enter(t, u, o) {
      if (t < 0) return pose({ dy: 0.6 * u.em * o.intensity, opacity: 0 });
      if (t >= 0.45) return REST;
      return pose({ dy: (1 - decel(t / 0.45)) * 0.6 * u.em * o.intensity, opacity: at(t, 0.45 * 0.6) });
    },
    exitDur: 0.3,
    exit: (e, u) => pose({ dy: -0.4 * u.em * exitC(e), opacity: 1 - exitC(e) }),
  },
  {
    // Small facts (an address, a note, a date): the whole line fades in while rising a few pixels, in about a fifth
    // of a second. Never typed letter by letter (that reads as fussy on metadata).
    id: "fade-rise",
    name: "Fade rise",
    unit: "block",
    kind: "fade",
    curve: "decel",
    dur: 0.22,
    each: 0,
    order: "ease",
    pivot: "baseline-left",
    tones: ["luxury", "editorial", "sales", "tech", "beauty", "playful", "sport"],
    enter(t, u, o) {
      if (t < 0) return pose({ dy: 0.3 * u.em * o.intensity, opacity: 0 });
      if (t >= 0.22) return REST;
      const k = decel(t / 0.22);
      return pose({ dy: (1 - k) * 0.3 * u.em * o.intensity, opacity: k });
    },
    exitDur: 0.2,
    exit: fadeExit,
  },
  {
    id: "word-drop",
    name: "Word drop",
    unit: "word",
    kind: "enter",
    curve: "decel",
    dur: 0.45,
    each: 0.075,
    order: "ease",
    pivot: "baseline-left",
    tones: ["editorial", "sales", "tech", "beauty", "playful"],
    enter(t, u, o) {
      if (t < 0) return pose({ dy: -0.6 * u.em * o.intensity, opacity: 0 });
      if (t >= 0.45) return REST;
      return pose({ dy: -(1 - decel(t / 0.45)) * 0.6 * u.em * o.intensity, opacity: at(t, 0.45 * 0.6) });
    },
    exitDur: 0.3,
    exit: (e, u) => pose({ dy: 0.4 * u.em * exitC(e), opacity: 1 - exitC(e) }),
  },
  {
    id: "curtain",
    name: "Curtain",
    unit: "line",
    kind: "enter",
    curve: "move",
    dur: 0.6,
    each: 0.1,
    order: "ease",
    pivot: "baseline-left",
    tones: ["luxury", "beauty", "editorial"],
    enter(t, u, o) {
      if (t < 0) return pose({ dx: -0.1 * u.em * o.intensity, reveal: { from: 0, to: 0, feather: 0.1 } });
      if (t >= 0.6) return REST;
      // The soft edge runs past the end, so the last letter is fully in when the wipe ends.
      return pose({ dx: -(1 - enter(t / 0.6)) * 0.1 * u.em * o.intensity, reveal: { from: 0, to: move(t / 0.6) * 1.1, feather: 0.1 } });
    },
    exitDur: 0.42,
    exit: (e) => pose({ reveal: { from: exitC(e) * 1.1 - 0.1, to: 1.2, feather: 0.1 } }),
  },
  {
    id: "bar-swipe",
    name: "Bar swipe",
    unit: "line",
    kind: "enter",
    curve: "snap",
    dur: 7 * F + 2 * F + 0.24,
    each: 0.1,
    order: "ease",
    pivot: "baseline-left",
    tones: ["sales", "tech", "sport"],
    never: ["luxury"],
    enter(t) {
      const grow = 7 * F;
      const hold = 2 * F;
      if (t < 0) return pose({ opacity: 0 });
      if (t < grow) return pose({ opacity: 0, bar: { from: 0, to: snap(t / grow) } });
      if (t < grow + hold) return pose({ bar: { from: 0, to: 1 } });
      if (t < grow + hold + 0.24) return pose({ bar: { from: snap((t - grow - hold) / 0.24), to: 1 } });
      return REST;
    },
    exitDur: 0.36,
    exit(e) {
      // The bar covers the line from the left, the words go, the bar leaves to the right.
      const s = e * 0.36;
      if (s < 5 * F) return pose({ bar: { from: 0, to: snap(s / (5 * F)) } });
      if (s < 7 * F) return pose({ opacity: 0, bar: { from: 0, to: 1 } });
      return pose({ opacity: 0, bar: { from: snap((s - 7 * F) / (0.36 - 7 * F)), to: 1 } });
    },
  },
  {
    id: "focus-in",
    name: "Focus in",
    unit: "word",
    kind: "enter",
    curve: "enter",
    dur: 0.7,
    each: 0.07,
    order: "ease",
    pivot: "centre",
    tones: ["beauty", "luxury"],
    never: ["sales"],
    enter(t, u, o) {
      if (t < 0) return pose({ blur: 16 * o.intensity, opacity: 0, sx: 1.06, sy: 1.06 });
      if (t >= 0.7) return REST;
      const k = cubic.out(t / 0.7);
      const s = 1.06 - 0.06 * k;
      return pose({ blur: 16 * (1 - k) * o.intensity, opacity: k, sx: s, sy: s });
    },
    exitDur: 0.48,
    exit(e, u, o) {
      const k = exitC(e);
      const s = 1 + 0.06 * k;
      return pose({ blur: 16 * k * o.intensity, opacity: 1 - k, sx: s, sy: s });
    },
  },
  {
    id: "track-in",
    name: "Track in",
    unit: "block",
    kind: "move",
    curve: "decel",
    dur: 3,
    each: 0,
    order: "ease",
    pivot: "centre",
    widest: { tracking: 0.4 },
    tones: ["luxury", "beauty", "editorial"],
    enter(t, u, o) {
      const d = 3;
      if (t < 0) return pose({ opacity: 0, blur: 6, tracking: 0.4 });
      if (t >= d) return REST;
      return pose({ opacity: at(t, 0.2 * d), blur: 6 * (1 - at(t, 0.4 * d)) * o.intensity, tracking: 0.4 - 0.4 * decel(t / d) });
    },
    exitDur: 0.6,
    exit: (e) => pose({ opacity: 1 - exitC(e), tracking: 0.15 * exitC(e) }),
  },
  {
    id: "snap-tight",
    name: "Snap tight",
    unit: "block",
    kind: "enter",
    curve: "enter",
    dur: 0.5,
    each: 0,
    order: "ease",
    pivot: "centre",
    widest: { tracking: 0.17 },
    tones: ["sport", "tech", "sales"],
    enter(t) {
      if (t < 0) return pose({ opacity: 0, tracking: 0.17 });
      if (t >= 0.5) return REST;
      return pose({ opacity: at(t, 0.12), tracking: 0.17 * (1 - enter(t / 0.5)) });
    },
    exitDur: 0.34,
    exit: (e) => pose({ opacity: 1 - exitC(e), tracking: 0.12 * exitC(e) }),
  },
  {
    id: "slow-drift",
    name: "Slow drift",
    unit: "block",
    kind: "move",
    curve: "decel",
    dur: 1.1,
    each: 0,
    order: "ease",
    pivot: "centre",
    tones: ["luxury", "beauty", "editorial"],
    never: ["sport"],
    enter(t, u, o) {
      if (t < 0) return pose({ dx: -0.25 * u.em * o.intensity, opacity: 0 });
      if (t >= 1.1) return REST;
      const k = decel(t / 1.1);
      return pose({ dx: -(1 - k) * 0.25 * u.em * o.intensity, opacity: k });
    },
    exitDur: 0.7,
    exit: (e, u) => pose({ dx: 0.25 * u.em * exitC(e), opacity: 1 - exitC(e) }),
  },
  {
    id: "stomp",
    name: "Stomp",
    unit: "word",
    kind: "slam",
    curve: "slam",
    dur: 5 * F,
    each: 0.12,
    order: "ease",
    stagger: "elements",
    pivot: "centre",
    widest: { scale: 1 },
    signature: true,
    tones: ["sales", "sport", "playful"],
    never: ["luxury", "beauty"],
    enter(t, u, o) {
      // Timed in frames (with a hair of tolerance, so frame 12 is frame 12 whatever the float error).
      const f = t / F + 1e-6;
      const A = 5;
      if (f < 1e-6) return HIDDEN;
      if (f < A) {
        const s = 1.8 - 0.8 * expoIn(t / (A * F));
        return pose({ sx: 1 + (s - 1) * o.intensity, sy: 1 + (s - 1) * o.intensity, opacity: at(t, 2 * F) });
      }
      const g = Math.min(1, (t - A * F) / (7 * F));
      const ghost = f < 12 ? { s: 1 + 0.15 * g, a: 0.35 * (1 - g) } : undefined;
      if (f < A + 1) return pose({ sx: 1 + 0.03 * o.intensity, sy: 1 - 0.04 * o.intensity, ghost });
      if (f < A + 2) {
        const k = snap(Math.max(0, (t - (A + 1) * F) / F));
        return pose({ sx: 1 + 0.03 * o.intensity * (1 - k), sy: 1 - 0.04 * o.intensity * (1 - k), ghost });
      }
      return ghost ? pose({ ghost }) : REST;
    },
    exitDur: 0.2,
    exit(e) {
      const k = exitC(e);
      return pose({ sx: 1 - 0.08 * k, sy: 1 - 0.08 * k, opacity: 1 - k });
    },
  },
  {
    id: "beat-cut",
    name: "Beat cut",
    unit: "word",
    kind: "move",
    curve: "snap",
    dur: 0.5,
    each: 0.5,
    order: "ease",
    stagger: "elements",
    pivot: "centre",
    together: true,
    tones: ["sport", "sales"],
    never: ["luxury"],
    enter(t, u, o) {
      // Each word owns a beat, alone and as big as the block; then the whole line lands together.
      const beat = o.beat;
      const mine = u.index * beat;
      const all = u.count * beat;
      if (t < mine) return HIDDEN;
      if (t < mine + beat && t < all) {
        const s0 = Math.min(2.5, Math.max(1, (u.block.w * 0.92) / Math.max(1, u.w)));
        const k = snap(at(t - mine, 4 * F));
        const s = s0 * (1.15 - 0.15 * k);
        return pose({ dx: u.block.x + u.block.w / 2 - (u.x + u.w / 2), dy: u.block.y + u.block.h / 2 - (u.y + u.h / 2), sx: s, sy: s });
      }
      if (t < all) return HIDDEN;
      if (t < all + 6 * F) {
        const s = 1.06 - 0.06 * snap((t - all) / (6 * F));
        return pose({ sx: s, sy: s });
      }
      return REST;
    },
    exitDur: 0.2,
    exit: (e) => pose({ opacity: e < 0.5 ? 1 : 0 }),
  },
  {
    id: "punch",
    name: "Punch",
    unit: "word",
    kind: "enter",
    curve: "snap",
    dur: 0.36,
    each: 0.08,
    order: "ease",
    pivot: "baseline-centre",
    tones: ["sport", "sales", "playful"],
    never: ["luxury"],
    enter(t, u, o) {
      if (t < 0) return HIDDEN;
      if (t >= 0.36) return REST;
      const i = o.intensity;
      if (t < 0.2) {
        const k = snap(t / 0.2);
        return pose({ sx: 1 + (0.6 - 0.65 * k) * i, sy: 1 + (-0.3 + 0.38 * k) * i });
      }
      const k = move((t - 0.2) / 0.16);
      return pose({ sx: 1 - 0.05 * (1 - k) * i, sy: 1 + 0.08 * (1 - k) * i });
    },
    exitDur: 0.24,
    exit: fadeExit,
  },
  {
    id: "pop-in",
    name: "Pop in",
    unit: "glyph",
    kind: "enter",
    curve: "pop",
    dur: 0.38,
    each: 0.03,
    order: "ease",
    pivot: "baseline-centre",
    widest: { scale: 1.12 },
    tones: ["playful", "sales"],
    never: ["luxury"],
    enter(t, u, o) {
      if (t < 0) return HIDDEN;
      if (t >= 0.38) return REST;
      const p = t / 0.38;
      const s = p < 0.6 ? 1.12 * enter(p / 0.6) : p < 0.8 ? 1.12 - 0.15 * move((p - 0.6) / 0.2) : 0.97 + 0.03 * move((p - 0.8) / 0.2);
      const r = sign(o, "pop", u.index) * 4 * DEG * (1 - enter(p)) * o.intensity;
      return pose({ sx: 1 + (s - 1) * (s > 1 ? o.intensity : 1), sy: 1 + (s - 1) * (s > 1 ? o.intensity : 1), rot: r, opacity: at(p, 0.15) });
    },
    exitDur: 0.26,
    exit(e) {
      const s = 1 - exitC(e);
      return pose({ sx: s, sy: s, opacity: s > 0.05 ? 1 : 0 });
    },
  },
  {
    id: "burst",
    name: "Burst",
    unit: "glyph",
    kind: "enter",
    curve: "pop",
    dur: 0.45,
    each: 0.022,
    order: "centre",
    pivot: "centre",
    widest: { scale: 1.1 },
    tones: ["playful", "sales"],
    never: ["luxury"],
    enter(t, u, o) {
      if (t < 0) return HIDDEN;
      if (t >= 0.45) return REST;
      const p = t / 0.45;
      const k = back14(p);
      const cx = u.block.x + u.block.w / 2;
      const cy = u.block.y + u.block.h / 2;
      const ux = u.x + u.w / 2;
      const uy = u.y + u.h / 2;
      const travel = clamp(enter(p));
      return pose({ dx: (cx - ux) * (1 - travel), dy: (cy - uy) * (1 - travel) - Math.sin(Math.PI * travel) * 0.3 * u.em * o.intensity, sx: Math.max(0, k), sy: Math.max(0, k), opacity: at(p, 0.1) });
    },
    exitDur: 0.3,
    exit(e) {
      const s = 1 - exitC(e);
      return pose({ sx: s, sy: s, opacity: s > 0.05 ? 1 : 0 });
    },
  },
  {
    id: "inflate",
    name: "Inflate",
    unit: "glyph",
    kind: "enter",
    curve: "pop",
    dur: 0.5,
    each: 0.04,
    order: "ease",
    pivot: "baseline-centre",
    widest: { scale: 1.15 },
    tones: ["playful"],
    never: ["luxury", "editorial", "tech"],
    enter(t, u, o) {
      if (t < 0) return HIDDEN;
      if (t >= 0.5) return REST;
      const p = t / 0.5;
      const s = 0.6 + 0.4 * elastic14(p);
      return pose({ sx: s, sy: s, rot: sign(o, "inflate", u.index) * 3 * DEG * (1 - p) * o.intensity, opacity: at(p, 0.12) });
    },
    exitDur: 0.3,
    exit(e) {
      const s = 1 - 0.4 * exitC(e);
      return pose({ sx: s, sy: s, opacity: 1 - exitC(e) });
    },
  },
  {
    id: "merge",
    name: "Merge",
    unit: "line",
    kind: "enter",
    curve: "enter",
    dur: 0.6,
    each: 0.08,
    order: "ease",
    pivot: "centre",
    tones: ["sport", "editorial", "tech"],
    enter(t, u, o) {
      const side = u.line % 2 === 0 ? -1 : 1;
      if (t < 0) return pose({ dx: side * 0.4 * u.frame.w * o.intensity });
      if (t >= 0.6) return REST;
      return pose({ dx: side * 0.4 * u.frame.w * (1 - enter(t / 0.6)) * o.intensity });
    },
    exitDur: 0.42,
    exit: (e, u) => pose({ dx: (u.line % 2 === 0 ? -1 : 1) * 0.4 * u.frame.w * exitC(e) }),
  },
  {
    id: "plates",
    name: "Plates",
    unit: "line",
    kind: "enter",
    curve: "enter",
    dur: 0.6,
    each: 0.08,
    order: "ease",
    pivot: "centre",
    tones: ["editorial", "tech", "sales"],
    enter(t, u, o) {
      const side = u.line % 2 === 0 ? -1 : 1;
      if (t < 0) return pose({ dx: side * 0.4 * u.frame.w * o.intensity });
      if (t >= 0.6) return REST;
      return pose({ dx: side * 0.4 * u.frame.w * (1 - back11(t / 0.6)) * o.intensity });
    },
    exitDur: 0.42,
    exit: (e, u) => pose({ dx: (u.line % 2 === 0 ? -1 : 1) * 0.4 * u.frame.w * exitC(e) }),
  },
  {
    id: "slide-in",
    name: "Slide in",
    unit: "block",
    kind: "enter",
    curve: "enter",
    dur: 0.5,
    each: 0,
    order: "ease",
    pivot: "centre",
    tones: ["luxury", "editorial", "sales", "tech", "beauty", "playful", "sport"],
    enter(t, u, o) {
      if (t < 0) return pose({ dx: 0.3 * u.frame.w * o.intensity, opacity: 0 });
      if (t >= 0.5) return REST;
      const k = quart.out(t / 0.5);
      return pose({ dx: 0.3 * u.frame.w * (1 - k) * o.intensity, opacity: k });
    },
    exitDur: 0.34,
    exit: (e, u) => pose({ dx: -0.3 * u.frame.w * exitC(e), opacity: 1 - exitC(e) }),
  },
  {
    id: "flip-up",
    name: "Flip up",
    unit: "glyph",
    kind: "enter",
    curve: "enter",
    dur: 0.65,
    each: 0.045,
    order: "ease",
    pivot: "baseline-centre",
    tones: ["tech", "sales"],
    enter(t, u) {
      if (t < 0) return flipPose(-95 * DEG, u);
      if (t >= 0.65) return REST;
      return flipPose(-95 * DEG * (1 - enter(t / 0.65)), u);
    },
    exitDur: 0.44,
    exit: (e, u) => flipPose(95 * DEG * exitC(e), u),
  },
  {
    id: "fold",
    name: "Fold",
    unit: "line",
    kind: "enter",
    curve: "enter",
    dur: 0.5,
    each: 0.12,
    order: "ease",
    pivot: "midline",
    tones: ["editorial"],
    enter(t) {
      if (t < 0) return pose({ fold: Math.PI / 2, shade: 0.3 });
      if (t >= 0.5) return REST;
      const k = cubic.out(t / 0.5);
      return pose({ fold: (Math.PI / 2) * (1 - k), shade: 0.3 * (1 - k) });
    },
    exitDur: 0.34,
    exit: (e) => pose({ fold: (Math.PI / 2) * exitC(e), shade: 0.3 * exitC(e), opacity: e < 1 ? 1 : 0 }),
  },
  {
    id: "tumble",
    name: "Tumble",
    unit: "word",
    kind: "enter",
    curve: "enter",
    dur: 0.6,
    each: 0.08,
    order: "ease",
    pivot: "bottom-left",
    tones: ["playful"],
    never: ["luxury", "editorial", "tech"],
    enter(t, u, o) {
      if (t < 0) return HIDDEN;
      if (t >= 0.6) return REST;
      const k = back12(t / 0.6);
      return pose({ rot: 160 * DEG * (1 - k) * o.intensity, dy: 0.4 * u.em * (1 - k) * o.intensity, opacity: at(t, 0.18) });
    },
    exitDur: 0.4,
    exit: fadeExit,
  },
  {
    id: "type-on",
    name: "Type on",
    unit: "glyph",
    kind: "move",
    curve: "linear",
    dur: 0.05,
    each: 0.05,
    order: "ease",
    pivot: "baseline-left",
    together: true,
    tones: ["tech", "editorial"],
    enter(t, u, o) {
      return t >= u.index / o.rate ? REST : HIDDEN;
    },
    exitDur: 0.3,
    exit: (e, u) => (e * u.count >= u.count - u.index ? HIDDEN : REST),
  },
  {
    id: "scramble",
    name: "Scramble",
    unit: "glyph",
    kind: "move",
    curve: "linear",
    dur: 0.6,
    each: 0,
    order: "ease",
    pivot: "baseline-left",
    together: true,
    signature: true,
    tones: ["tech", "sport"],
    never: ["luxury", "beauty", "playful"],
    enter(t, u, o) {
      if (t < 0) return HIDDEN;
      const lock = scrambleLock(u);
      if (t >= lock) return REST;
      // A new letter every two frames, seeded by slot and moment.
      const step = Math.floor(t / (2 * F) + 1e-6);
      const shown = otherLetter(u.text, o, "scramble", u.index, step);
      const split = (2 + 8 * rng(o.seed, "split", step)) * (1 - t / 0.6) * o.intensity;
      return pose({ shown, split });
    },
    exitDur: 0.3,
    exit: fadeExit,
  },
  {
    id: "neon-strike",
    name: "Neon strike",
    unit: "block",
    kind: "fade",
    curve: "linear",
    dur: 14 * F,
    each: 0,
    order: "ease",
    pivot: "centre",
    signature: true,
    tones: ["sport"],
    never: ["luxury", "beauty"],
    enter(t) {
      if (t < 0) return pose({ glow: 0, shade: 0.6 });
      const g = neonAt(t);
      return g >= 1 && t >= 13 * F ? REST : pose({ glow: g, shade: 0.6 * (1 - g) });
    },
    exitDur: 0.3,
    exit: (e) => pose({ glow: 1 - exitC(e), shade: 0.6 * exitC(e), opacity: 1 - exitC(e) * 0.6 }),
  },
  {
    id: "split-flap",
    name: "Split flap",
    unit: "glyph",
    kind: "move",
    curve: "linear",
    dur: 0.4,
    each: 0.03,
    order: "ease",
    pivot: "midline",
    tones: ["tech", "sales"],
    enter(t, u, o) {
      const flips = flapCount(u, o);
      if (t < 0) return pose({ flap: { from: flapLetter(u, o, 0, flips), to: flapLetter(u, o, 0, flips), phase: 0 } });
      const step = Math.floor(t / 0.05 + 1e-6);
      if (step >= flips) return REST;
      return pose({ flap: { from: flapLetter(u, o, step, flips), to: flapLetter(u, o, step + 1, flips), phase: (t - step * 0.05) / 0.05 } });
    },
    exitDur: 0.3,
    exit: fadeExit,
  },
  {
    id: "odometer",
    name: "Odometer",
    unit: "glyph",
    kind: "move",
    curve: "roll",
    dur: 1.4,
    each: 0.05,
    order: "reverse",
    pivot: "midline",
    tones: ["tech", "sales"],
    enter(t, u) {
      // A separator ($ , . % ×) is never drawn before the figures round it: it fades in over the second half of its
      // column's roll, with the digits.
      if (!/^\p{Nd}$/u.test(u.text)) {
        if (t < 0.55) return pose({ opacity: 0 });
        if (t >= 0.85) return REST;
        return pose({ opacity: (t - 0.55) / 0.3 });
      }
      const target = Number(u.text);
      // Each figure rolls up once from a blank place below 0 to its own value (never more than ten places, so at 30 fps
      // a column moves under half a figure a frame and never smears). A number's leading column only rises into place
      // (never a leading zero); before its start a column is blank (never a placeholder 0).
      const from = u.lead ? target : 0;
      if (t < 0) return pose({ roll: from - 1, rollFrom: from });
      if (t >= 1.4) return REST;
      return pose({ roll: from - 1 + (target - from + 1) * roll(t / 1.4), rollFrom: from });
    },
    exitDur: 0.3,
    exit: fadeExit,
  },
  {
    id: "cut-paper",
    name: "Cut paper",
    unit: "word",
    kind: "move",
    curve: "snap",
    dur: 0.3,
    each: 0.12,
    order: "ease",
    stagger: "elements",
    pivot: "centre",
    widest: { scale: 1.15 },
    tones: ["playful"],
    never: ["luxury", "tech"],
    enter(t, u, o) {
      if (t < 0) return HIDDEN;
      // Animated on twos, like paper moved by hand; it lands on its last step.
      if (t >= 0.3) return REST;
      const s = Math.floor(t * 12 + 1e-6) / 12;
      const p = s / 0.3;
      const rot = p < 0.6 ? (-8 + 11 * snap(p / 0.6)) * DEG : 3 * DEG * (1 - snap((p - 0.6) / 0.4));
      const sc = p < 0.6 ? 1.15 - 0.15 * snap(p / 0.6) : 1;
      return pose({ rot: rot * o.intensity, sx: 1 + (sc - 1) * o.intensity, sy: 1 + (sc - 1) * o.intensity });
    },
    exitDur: 0.2,
    exit: (e) => (e < 0.5 ? pose({ rot: -4 * DEG }) : HIDDEN),
  },
  {
    id: "weight-wave",
    name: "Weight wave",
    unit: "glyph",
    kind: "move",
    curve: "snap",
    dur: 1,
    each: 0.04,
    order: "ease",
    pivot: "baseline-left",
    widest: { weight: 900 },
    tones: ["tech", "sport"],
    enter(t) {
      if (t < 0) return HIDDEN;
      if (t >= 1) return REST;
      // 200 → 900 → the face's own weight; the drawer clamps to what the face has.
      if (t < 0.5) return pose({ weight: 200 + 700 * snap(t / 0.5) });
      return pose({ weight: 900 - 200 * snap((t - 0.5) / 0.5) });
    },
    exitDur: 0.3,
    exit: fadeExit,
  },
  {
    id: "ink-draw",
    name: "Ink draw",
    unit: "block",
    kind: "draw",
    curve: "draw",
    dur: 0.75,
    each: 0,
    order: "ease",
    pivot: "baseline-left",
    tones: ["editorial", "beauty", "playful", "luxury"],
    enter(t) {
      if (t < 0) return pose({ reveal: { from: 0, to: 0, feather: 0.12 } });
      if (t >= 0.75) return REST;
      return pose({ reveal: { from: 0, to: draw(t / 0.75) * 1.12, feather: 0.12 } });
    },
    exitDur: 0.5,
    exit: (e) => pose({ opacity: 1 - exitC(e) }),
  },
];

/** Fake 3D: a letter turned θ about its baseline (0 = facing us), squeezed, sheared, shaded and faded as it turns. */
function flipPose(theta: number, u: UnitInfo): Pose {
  const a = Math.abs(theta);
  return pose({ sy: Math.max(0.001, Math.cos(theta)), skewX: Math.sin(theta) * 0.12, dy: -Math.sin(theta) * 0.6 * u.cap, shade: 0.35 * Math.min(1, a / (Math.PI / 2)), opacity: clamp((Math.PI / 2 - a) / (Math.PI / 4)) });
}

/** When a scramble's slot locks onto its own letter: 0.25 s in, then left to right, every slot by 0.6 s. */
export function scrambleLock(u: Pick<UnitInfo, "index" | "count">): number {
  const each = u.count > 1 ? Math.min(0.03, 0.35 / (u.count - 1)) : 0;
  return 0.25 + u.index * each;
}

/** The neon tube's light by frame: two false starts, then on. */
const NEON = [0, 0, 0.6, 0, 0, 0, 0.4, 0, 0, 1, 1, 1, 0.8, 1];
export function neonAt(t: number): number {
  const f = Math.floor(t / F + 1e-6);
  return f < 0 ? 0 : f >= NEON.length ? 1 : NEON[f];
}

/** How many flips a split-flap tile makes (4–8, seeded). */
export const flapCount = (u: Pick<UnitInfo, "index">, o: Pick<PresetOptions, "seed">): number => 4 + Math.floor(rng(o.seed, "flaps", u.index) * 5);

/** The letter a tile shows after `step` flips: seeded letters of its kind, ending on its own. */
function flapLetter(u: UnitInfo, o: PresetOptions, step: number, flips: number): string {
  // Separators (":", "·", "/") never flip: only letters and figures cycle, each through its own kind.
  if (!/^[\p{L}\p{Nd}]$/u.test(u.text)) return u.text;
  if (step >= flips) return u.text;
  // A figure counts up to its own value (never past it), so a clock column only ever shows a time that can be (no
  // "63" minutes on the way to "12").
  if (/^\p{Nd}$/u.test(u.text)) return String(Math.max(0, Number(u.text) - (flips - step)));
  return otherLetter(u.text, o, "flap", u.index, step);
}

export const PRESETS: Readonly<Record<PresetId, Preset>> = Object.freeze(Object.fromEntries(P.map((p) => [p.id, p])) as Record<PresetId, Preset>);
export const PRESET_IDS = P.map((p) => p.id);

/** The presets that suit a tone (and aren't ruled out for it). */
export const presetsFor = (tone: Tone): Preset[] => P.filter((p) => p.tones.includes(tone) && !p.never?.includes(tone));

// ---------------------------------------------------------------------------
// Loops and emphasis (after the entrance)

export type LoopId = "breathe" | "pulse" | "wiggle" | "light-sweep" | "chrome-flow" | "ghost-drift" | "push-in";

export interface LoopPose {
  /** Scale about the block's centre. */
  s: number;
  rot: number;
  dx: number;
  dy: number;
  /** A light band's place across the block (0–1, from before its left edge to past its right), or null when none crosses. */
  sweep: number | null;
  /** A chrome horizon's shift (share of the cap height). */
  flow: number;
}

export const LOOP_REST: Readonly<LoopPose> = Object.freeze({ s: 1, rot: 0, dx: 0, dy: 0, sweep: null, flow: 0 });

export interface LoopOptions {
  seed: number;
  /** Seconds a cycle (each loop has its own default). */
  period?: number;
  /** Seconds between pulses or sweeps (one-shot when absent). */
  every?: number;
  /** For ghost-drift and push-in: the frame's width and the clip's length. */
  frameW?: number;
  duration?: number;
  /** Seconds after the loop starts by which a sweep must have crossed (a sweep that can't finish by then doesn't start). */
  until?: number;
}

/** A loop's pose `t` seconds after it starts. Breathe, pulse and wiggle are at rest at the end of every cycle. */
export function loopAt(id: LoopId, t: number, o: LoopOptions): LoopPose {
  if (t < 0) return LOOP_REST;
  switch (id) {
    case "breathe": {
      const P = o.period ?? 2.8;
      return { ...LOOP_REST, s: 1 + 0.02 * (1 - Math.cos((2 * Math.PI * t) / P)) / 2 };
    }
    case "pulse": {
      // 100 → 102 % (held three frames) → 100 % in 300 ms, a few frames after landing; again every `every` seconds.
      const local = o.every ? t % o.every : t;
      const d = local - 4 * F;
      if (d < 0 || d >= 0.3) return LOOP_REST;
      const up = 0.3 / 2 - 1.5 * F;
      const s = d < up ? Math.sin(((d / up) * Math.PI) / 2) : d < up + 3 * F ? 1 : Math.cos((((d - up - 3 * F) / (0.3 - up - 3 * F)) * Math.PI) / 2);
      return { ...LOOP_REST, s: 1 + 0.02 * s };
    }
    case "wiggle": {
      const P = o.period ?? 0.8;
      const cycle = Math.floor(t / P);
      const p = (t % P) / P;
      const env = Math.sin(Math.PI * p);
      return { ...LOOP_REST, rot: (rng(o.seed, "wiggle-r", cycle) * 2 - 1) * 3 * DEG * env, dx: (rng(o.seed, "wiggle-x", cycle) * 2 - 1) * 3 * env, dy: (rng(o.seed, "wiggle-y", cycle) * 2 - 1) * 3 * env };
    }
    case "light-sweep": {
      // 800 ms across, starting 200 ms in; again every `every` seconds (never sooner than 1.6 s). A sweep that can't
      // cross before `until` doesn't start (the last frame is the poster, with no band on it).
      const every = o.every ? Math.max(1.6, o.every) : 0;
      const local = every ? t % every : t;
      const d = local - 0.2;
      if (d < 0 || d >= 0.8) return LOOP_REST;
      if (o.until !== undefined && t - d + 1.0 > o.until) return LOOP_REST;
      return { ...LOOP_REST, sweep: move(d / 0.8) };
    }
    case "chrome-flow": {
      const P = o.period ?? 2.5;
      return { ...LOOP_REST, flow: 0.05 * Math.sin((2 * Math.PI * t) / P) };
    }
    case "ghost-drift": {
      // 3 % of the frame's width a second, so a loop of the clip's length closes on a whole cycle of the pattern.
      return { ...LOOP_REST, dx: 0.03 * (o.frameW ?? 1080) * t };
    }
    case "push-in": {
      const d = o.duration ?? 5;
      const k = (1 - Math.cos(Math.PI * clamp(t / d))) / 2;
      return { ...LOOP_REST, s: 1 + 0.06 * k, dx: -0.015 * (o.frameW ?? 1080) * k };
    }
  }
}

export type { Ease };
