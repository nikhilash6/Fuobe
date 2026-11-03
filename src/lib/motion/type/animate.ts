/**
 * Moving type (pure): a type set (glyphs.ts) and a motion (an entrance preset, an optional exit and loop) give the
 * timeline events and, at any time, the display nodes that draw it.
 *
 * - At rest every unit is at its layout place and the field is one text node whose pieces spell the typed words.
 * - While moving, each unit is its own group (its transform, its clip, its mask), and decorative copies (a stomp's
 *   ring, a neon glow, an echo, a colour split) are text nodes marked `decor`.
 * - Units follow one another with eased gaps (wide, then tightening), within the timing rules for their unit.
 * - Everything is a function of the time asked for: no state, no clock, no Math.random.
 */

import { group, IDENTITY, mixHex, multiply, withAlpha, type Box, type DisplayNode, type GroupNode, type Matrix, type Paint, type TextRun } from "../display";
import type { CurveName } from "../ease";
import { rng } from "../random";
import { clamp } from "../time";
import { DURATION_LIMITS, STAGGER_LIMITS, type EventKind, type MotionEvent, type StaggerUnit } from "../tween";
import { fontOf, weightFor } from "./faces";
import type { TypeSet } from "./glyphs";
import { F, LOOP_REST, loopAt, PRESETS, REST, scrambleLock, type LoopId, type LoopPose, type Pivot, type Pose, type Preset, type PresetId, type PresetOptions, type UnitInfo, type UnitKind } from "./presets";

export interface TextMotion {
  /** The entrance. */
  in: PresetId;
  /** When it starts (seconds). */
  at: number;
  /** The exit (the entrance's own by default) and when it starts; none when absent. */
  out?: PresetId;
  exitAt?: number;
  /** A loop after the entrance: from `loopAt` (default 0.15 s after it settles). */
  loop?: LoopId;
  loopAt?: number;
  loopEvery?: number;
  loopPeriod?: number;
  /** No sweep may still be crossing after this (seconds; the clip's last frame by default in a poster). */
  loopUntil?: number;
  /** 0.7–1.4: faster or slower than designed. */
  speed?: number;
  /** 0–1: how far things travel. */
  intensity?: number;
  seed?: number;
  /** Type over a quarter of the frame's height (a weightier entrance). */
  hero?: boolean;
  /** Copies trailing a moving unit (3–5). */
  echo?: number;
  /** Type-on: letters a second (default 20). Beat-cut: seconds a beat (default 0.5). */
  rate?: number;
  beat?: number;
  /** A stomp's white flash on impact (accent words only). */
  flash?: boolean;
  /** A dark ground (colour splits and glows read only there). */
  dark?: boolean;
}

export interface TypeStyle {
  fill: Paint;
  /** An outline (hollow type: fill "transparent"). */
  stroke?: { paint: Paint; width: number };
  /** Bar-swipe's bar. */
  bar?: string;
  /** Neon's glow colour. */
  glow?: string;
  /** Split-flap tiles. */
  tile?: string;
  /** Paper chips under words (cut-paper). */
  chip?: string;
  /** Type-on's caret. */
  caret?: string;
  /** A light sweep's colour and strength. */
  sweep?: string;
  sweepAlpha?: number;
}

interface Piece {
  text: string;
  gap: string;
  x: number;
  y: number;
  w: number;
  line: number;
  /** Its letter's place in its line, spaces counted (tracking moves letters apart by it); -1 for a whole line or word. */
  ord: number;
  /** Its letter in the set's glyphs (-1 for a whole line or word). */
  glyph: number;
}

export interface PlannedUnit {
  info: UnitInfo;
  start: number;
  exitStart: number | null;
  pieces: Piece[];
}

export interface TypePlan {
  id: string;
  set: TypeSet;
  motion: TextMotion;
  preset: Preset;
  exit: Preset;
  options: PresetOptions;
  units: PlannedUnit[];
  events: MotionEvent[];
  /** Every unit has landed (the entrance's end). */
  settled: number;
  /** The exit's end (null: no exit). */
  gone: number | null;
  loopStart: number;
  frame: { w: number; h: number };
  speed: number;
}

const unitStagger: Record<UnitKind, StaggerUnit> = { glyph: "letters", word: "words", line: "lines", block: "elements" };

const limit = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** Start offsets for `n` units `each` apart, gaps eased from wide to tight, in the given order, kept inside the unit's limits. */
export function staggerStarts(n: number, each: number, order: Preset["order"], seed: number, unit: StaggerUnit): number[] {
  if (n <= 1 || each <= 0) return Array(n).fill(0);
  const [lo, hi] = STAGGER_LIMITS[unit];
  const rank: number[] = Array.from({ length: n }, (_, i) => i);
  if (order === "reverse") rank.reverse();
  else if (order === "centre") rank.sort((a, b) => Math.abs(a - (n - 1) / 2) - Math.abs(b - (n - 1) / 2) || a - b);
  else if (order === "seeded") rank.sort((a, b) => rng(seed, "order", a) - rng(seed, "order", b));
  const out = Array(n).fill(0);
  let at = 0;
  rank.forEach((unitIndex, r) => {
    if (r > 0) at += limit(each * (1.25 - (0.45 * (r - 1)) / Math.max(1, n - 2)), [lo + 2e-6, hi - 2e-6]);
    out[unitIndex] = round6(at);
  });
  return out;
}

/** The units a preset moves, with their pieces at rest. */
interface RawUnit {
  kind: UnitKind;
  line: number;
  text: string;
  pieces: Piece[];
}

function unitsOf(set: TypeSet, kind: UnitKind, perLetter: boolean): RawUnit[] {
  const glyphPieces = (from: number, to: number, line: number): Piece[] => {
    const l = set.lines[line];
    const first = l.glyphs ? l.glyphs[0] : 0;
    return set.glyphs.slice(from, to).map((g, k) => ({ text: g.text, gap: g.gap, x: g.x, y: g.y, w: g.w, line, ord: from + k - first + countSpacesBefore(set, line, from + k), glyph: from + k }));
  };
  const wordPieces = (wi: number): Piece[] => {
    const w = set.words[wi];
    if (perLetter && w.glyphs) return glyphPieces(w.glyphs[0], w.glyphs[1], w.line);
    return [{ text: w.text, gap: w.gap, x: w.x, y: w.y, w: w.w, line: w.line, ord: -1, glyph: -1 }];
  };
  const linePieces = (li: number): Piece[] => {
    const l = set.lines[li];
    if (perLetter && l.glyphs) return glyphPieces(l.glyphs[0], l.glyphs[1], li);
    if (perLetter) return Array.from({ length: l.words[1] - l.words[0] }, (_, k) => wordPieces(l.words[0] + k)).flat();
    // A tracked line, or one whose word spaces were opened up, is drawn in pieces so it lands exactly on its layout.
    if (set.tracking !== 0 && l.glyphs) return glyphPieces(l.glyphs[0], l.glyphs[1], li);
    if (set.tracking !== 0 || set.spaceExtra > 0) return Array.from({ length: l.words[1] - l.words[0] }, (_, k) => wordPieces(l.words[0] + k)).flat();
    return [{ text: l.text, gap: set.words[l.words[0]]?.gap ?? l.gap, x: l.x, y: l.y, w: l.w, line: li, ord: -1, glyph: -1 }];
  };
  switch (kind) {
    case "glyph":
      return set.lines.flatMap((l, li): RawUnit[] => {
        if (l.glyphs) return set.glyphs.slice(l.glyphs[0], l.glyphs[1]).map((g, k) => ({ kind: "glyph" as const, line: li, text: g.text, pieces: glyphPieces(l.glyphs![0] + k, l.glyphs![0] + k + 1, li) }));
        return Array.from({ length: l.words[1] - l.words[0] }, (_, k) => ({ kind: "word" as const, line: li, text: set.words[l.words[0] + k].text, pieces: wordPieces(l.words[0] + k) }));
      });
    case "word":
      return set.words.map((w, wi) => ({ kind: "word" as const, line: w.line, text: w.text, pieces: wordPieces(wi) }));
    case "line":
      return set.lines.map((l, li) => ({ kind: "line" as const, line: li, text: l.text, pieces: linePieces(li) }));
    case "block":
      return [{ kind: "block" as const, line: 0, text: set.text, pieces: set.lines.flatMap((_, li) => linePieces(li)) }];
  }
}

/** Spaces in a line before a letter (tracking also follows a space). */
function countSpacesBefore(set: TypeSet, line: number, glyph: number): number {
  const l = set.lines[line];
  if (!l.glyphs) return 0;
  let n = 0;
  for (let k = l.glyphs[0] + 1; k <= glyph; k++) n += [...set.glyphs[k].gap].length;
  return n;
}

const boxOfPieces = (pieces: Piece[]): { x: number; w: number } => {
  const x0 = Math.min(...pieces.map((p) => p.x));
  const x1 = Math.max(...pieces.map((p) => p.x + p.w));
  return { x: x0, w: x1 - x0 };
};

/** The clip a line's units rise inside: its ink, with room for accents above, descenders below and overhangs. */
export function lineClip(set: TypeSet, line: number): Box {
  const l = set.lines[line];
  const em = set.size;
  const top = Math.min(l.ink.y, l.y + set.cap.top) - 0.12 * em;
  const bottom = Math.max(l.ink.y + l.ink.h, l.baseline) + 0.04 * em;
  return { x: l.x - 0.3 * em, y: top, w: l.w + 0.6 * em, h: bottom - top };
}

/** Plan a field's motion: units, their starts, the events, and when it settles and leaves. */
export function planType(id: string, set: TypeSet, motion: TextMotion, frame: { w: number; h: number }): TypePlan {
  const preset = PRESETS[motion.in];
  const exit = PRESETS[motion.out ?? motion.in];
  const speed = Math.min(1.4, Math.max(0.7, motion.speed ?? 1));
  const options: PresetOptions = { seed: motion.seed ?? 7, intensity: clamp(motion.intensity ?? 1), hero: !!motion.hero, rate: motion.rate ?? 20, beat: motion.beat ?? 0.5 };
  // Tracking that moves needs letters to move apart, so the unit is drawn letter by letter.
  // (A whole line drawn at once has no letter spacing, so tracked type is drawn letter by letter too.)
  const perLetter = preset.unit === "glyph" || !!preset.widest?.tracking || set.tracking !== 0;
  const raw = unitsOf(set, preset.unit, perLetter);
  const em = set.size;
  const lh = set.lineHeight;
  const capH = set.cap.bottom - set.cap.top;
  const infos: UnitInfo[] = raw.map((u, index) => {
    const b = boxOfPieces(u.pieces);
    const line = set.lines[u.line];
    const lines = u.kind === "block" ? set.lines : [line];
    const y = u.kind === "block" ? set.box.y : line.y;
    const h = u.kind === "block" ? set.box.h : lh;
    const inkTop = Math.min(...lines.map((l) => l.ink.y));
    const inkBottom = Math.max(...lines.map((l) => l.ink.y + l.ink.h));
    const clip = lineClip(set, u.line);
    return {
      kind: u.kind,
      index,
      count: raw.length,
      line: u.line,
      lines: set.lines.length,
      text: u.text,
      x: b.x,
      y,
      w: b.w,
      h,
      ink: { x: b.x, y: inkTop, w: b.w, h: inkBottom - inkTop },
      baseline: u.kind === "block" ? set.lines[set.lines.length - 1].baseline : line.baseline,
      em,
      lh,
      cap: capH,
      block: set.box,
      frame,
      clear: { down: clip.y + clip.h - inkTop + 0.02 * em, up: inkBottom - clip.y + 0.02 * em },
      ...(/\p{Nd}/u.test(u.text) && { lead: !raw.slice(0, index).some((r) => r.line === u.line && /\p{Nd}/u.test(r.text)) }),
    };
  });

  // Starts: by line for presets that let each line follow the one before, else across all units.
  const each = preset.each / speed;
  const dur = (options.hero && preset.heroDur ? preset.heroDur : preset.dur) / speed;
  const unitName = preset.stagger ?? unitStagger[preset.unit];
  const starts: number[] = Array(infos.length).fill(0);
  if (!preset.together) {
    if (preset.lineOverlap !== undefined && set.lines.length > 1) {
      let lineStart = 0;
      for (let li = 0; li < set.lines.length; li++) {
        const members = infos.filter((u) => u.line === li);
        const local = staggerStarts(members.length, each, preset.order, options.seed, unitName);
        members.forEach((u, k) => (starts[u.index] = round6(lineStart + local[k])));
        const span = Math.max(0, ...local) + dur;
        lineStart += span * preset.lineOverlap;
      }
    } else staggerStarts(infos.length, each, preset.order, options.seed, unitName).forEach((s, i) => (starts[i] = s));
  }
  const enterSpan = (i: number): number => {
    if (preset.id === "beat-cut") return infos[i].count * options.beat / speed + (6 * F) / speed;
    if (preset.id === "type-on") return infos.length / options.rate / speed;
    if (preset.id === "scramble") return scrambleLock(infos[infos.length - 1]) / speed;
    if (preset.id === "stomp") return (12 * F) / speed;
    if (preset.id === "split-flap") return (0.05 * 8) / speed;
    return dur;
  };
  const settled = round6(motion.at + Math.max(0, ...infos.map((_, i) => starts[i] + enterSpan(i))));

  // Exit: first unit first, in about two thirds of the entrance's time.
  const exitDur = exit.exitDur / speed;
  let exitStarts: number[] | null = null;
  if (motion.exitAt !== undefined) {
    const n = infos.length;
    const exitEach = exit.together ? 0 : (exit.each * 0.68) / speed;
    exitStarts = exit.together || exitEach <= 0 ? Array(n).fill(0) : staggerStarts(n, exitEach, "ease", options.seed, unitName);
  }
  const gone = exitStarts && motion.exitAt !== undefined ? round6(motion.exitAt + Math.max(...exitStarts) + exitDur) : null;

  const units: PlannedUnit[] = infos.map((info, i) => ({ info, start: round6(motion.at + starts[i]), exitStart: exitStarts && motion.exitAt !== undefined ? round6(motion.exitAt + exitStarts[i]) : null, pieces: raw[i].pieces }));

  // Events, for the timeline (and the timing rules).
  const events: MotionEvent[] = [];
  const kindOf = (k: EventKind, d: number): EventKind => (k === "enter" && d > DURATION_LIMITS.enter[1] + 1e-9 ? "hero" : k);
  const curveOf = preset.curve as CurveName;
  if (preset.together || infos.length === 1) {
    const span = Math.max(...infos.map((_, i) => enterSpan(i)));
    const kind = kindOf(preset.kind, span);
    events.push({ id, kind, start: round6(motion.at), dur: round6(limit(span, DURATION_LIMITS[kind])), curve: curveOf });
  } else {
    const order = units.map((u, i) => ({ u, i })).sort((a, b) => a.u.start - b.u.start || a.i - b.i);
    for (const { u, i } of order) {
      const kind = kindOf(preset.kind, dur);
      const grp = preset.lineOverlap !== undefined && set.lines.length > 1 ? `${id}.l${u.info.line}` : id;
      events.push({ id: `${id}.${i}`, kind, start: u.start, dur: round6(limit(dur, DURATION_LIMITS[kind])), curve: curveOf, group: grp, unit: unitName });
    }
  }
  if (preset.id === "stomp") for (const [i, u] of units.entries()) events.push({ id: `${id}.${i}.ring`, kind: "fade", start: round6(u.start + (5 * F) / speed), dur: round6((7 * F) / speed), curve: "linear" });
  if (exitStarts && motion.exitAt !== undefined) {
    if (exit.together || infos.length === 1) events.push({ id: `${id}.exit`, kind: "exit", start: round6(motion.exitAt), dur: round6(limit(exitDur, DURATION_LIMITS.exit)), curve: "exit" });
    else {
      const order = units.map((u, i) => ({ u, i })).sort((a, b) => a.u.exitStart! - b.u.exitStart! || a.i - b.i);
      for (const { u, i } of order) events.push({ id: `${id}.exit.${i}`, kind: "exit", start: u.exitStart!, dur: round6(limit(exitDur, DURATION_LIMITS.exit)), curve: "exit", group: `${id}.exit`, unit: unitName });
    }
  }
  return { id, set, motion, preset, exit, options, units, events, settled, gone, loopStart: motion.loopAt ?? round6(settled + 0.15), frame, speed };
}

const isRest = (p: Pose): boolean =>
  p.dx === 0 && p.dy === 0 && p.sx === 1 && p.sy === 1 && p.rot === 0 && p.skewX === 0 && p.opacity === 1 && p.blur === 0 && p.shade === 0 && p.tracking === undefined && p.weight === undefined && !p.shown && !p.reveal && !p.bar && !p.ghost && p.glow === undefined && p.fold === undefined && !p.flap && p.roll === undefined && !p.split;

/** A unit's pose at `t` (absolute): before, during and after its entrance, then its exit. */
export function poseAt(plan: TypePlan, i: number, t: number): Pose {
  const u = plan.units[i];
  if (u.exitStart !== null && t >= u.exitStart) {
    const d = plan.exit.exitDur / plan.speed;
    const e = d > 0 ? (t - u.exitStart) / d : 1;
    if (e >= 1) return { ...REST, opacity: 0 };
    return plan.exit.exit(clamp(e), u.info, plan.options);
  }
  return plan.preset.enter((t - u.start) * plan.speed, u.info, plan.options);
}

/** The point a unit turns and scales about. */
function pivotOf(p: Pivot, u: UnitInfo, set: TypeSet): [number, number] {
  switch (p) {
    case "centre":
      return [u.x + u.w / 2, u.ink.y + u.ink.h / 2];
    case "baseline-left":
      return [u.x, u.baseline];
    case "baseline-centre":
      return [u.x + u.w / 2, u.baseline];
    case "bottom-left":
      return [u.x, u.ink.y + u.ink.h];
    case "midline":
      return [u.x + u.w / 2, u.y + (set.cap.top + set.cap.bottom) / 2];
  }
}

/** translate(dx, dy) · about the pivot: rotate, shear, scale. */
export function poseMatrix(p: Pick<Pose, "dx" | "dy" | "sx" | "sy" | "rot" | "skewX">, px: number, py: number): Matrix | undefined {
  if (p.dx === 0 && p.dy === 0 && p.sx === 1 && p.sy === 1 && p.rot === 0 && p.skewX === 0) return undefined;
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const R: Matrix = [c, s, -s, c, 0, 0];
  const K: Matrix = [1, 0, p.skewX, 1, 0, 0];
  const S: Matrix = [p.sx, 0, 0, p.sy, 0, 0];
  const M = multiply(multiply(R, K), S);
  return multiply([1, 0, 0, 1, p.dx + px, p.dy + py], multiply(M, [1, 0, 0, 1, -px, -py]));
}

/** A paint taken toward black. */
function shaded(p: Paint, k: number): Paint {
  if (k <= 0) return p;
  if (typeof p === "string") return /^#[0-9a-f]{3,6}$/i.test(p) ? mixHex(p, "#000000", k) : p;
  return { ...p, stops: p.stops.map((s) => ({ ...s, color: /^#[0-9a-f]{3,6}$/i.test(s.color) ? mixHex(s.color, "#000000", k) : s.color })) };
}

/** The pieces' places for this pose's tracking and weight (letters move apart, centred lines stay centred). */
function placed(plan: TypePlan, pieces: Piece[], p: Pose): { piece: Piece; x: number; font: string }[] {
  const set = plan.set;
  const tracking = p.tracking !== undefined ? set.tracking + p.tracking : set.tracking;
  const weight = p.weight !== undefined ? weightFor(set.family, Math.round(p.weight), set.style) : set.weight;
  const font = weight === set.weight ? set.font : fontOf(set.family, set.size, weight, set.style);
  const dT = (tracking - set.tracking) * set.size;
  if (dT === 0 && font === set.font) return pieces.map((piece) => ({ piece, x: piece.x, font }));
  return pieces.map((piece) => {
    if (piece.ord < 0) return { piece, x: piece.x, font };
    const line = set.lines[piece.line];
    const n = line.glyphs ? countSpacesBefore(set, piece.line, line.glyphs[1] - 1) + (line.glyphs[1] - line.glyphs[0]) : 1;
    const grow = dT * Math.max(0, n - 1);
    const shift = set.align === "centre" ? -grow / 2 : set.align === "right" ? -grow : 0;
    let x = piece.x + dT * piece.ord + shift;
    if (font !== set.font) {
      // A heavier or lighter letter is wider or narrower: the letters before it in the line push it along.
      const g0 = line.glyphs ? line.glyphs[0] : piece.glyph;
      let pushed = 0;
      for (let k = g0; k < piece.glyph; k++) pushed += set.measure(set.glyphs[k].text, font) - set.glyphs[k].w;
      x += pushed;
    }
    return { piece, x, font };
  });
}

function runsOf(plan: TypePlan, pieces: Piece[], p: Pose, style: TypeStyle, fill: Paint = style.fill): TextRun[] {
  return placed(plan, pieces, p).map(({ piece, x, font }) => {
    const run: TextRun = { text: piece.text, gap: piece.gap, font, x, y: piece.y, fill: shaded(fill, p.shade) };
    if (style.stroke) run.stroke = { paint: shaded(style.stroke.paint, p.shade), width: style.stroke.width };
    if (plan.set.dir === "rtl") run.dir = "rtl";
    if (p.shown && p.shown !== piece.text) {
      run.shown = p.shown;
      run.x = x + (piece.w - plan.set.measure(p.shown, font)) / 2;
    }
    return run;
  });
}

const textNode = (field: string, runs: TextRun[], decor = false): DisplayNode => ({ type: "text", field, runs, ...(decor && { decor: true }) });

/** A soft horizontal wipe as a group mask. */
function revealMask(r: NonNullable<Pose["reveal"]>, box: Box): GroupNode["mask"] | null {
  const span = box.w;
  if (r.to - r.feather >= 1 && r.from <= 0) return null;
  const stops: { at: number; color: string }[] = [];
  const add = (at: number, a: number) => stops.push({ at: clamp(at), color: `rgba(0,0,0,${a})` });
  add(r.from - r.feather, 0);
  add(r.from, 1);
  add(r.to - r.feather, 1);
  add(r.to, 0);
  stops.sort((a, b) => a.at - b.at);
  return { kind: "linear", x0: box.x, y0: 0, x1: box.x + span, y1: 0, stops, bounds: box };
}

export interface TypeFrame {
  nodes: DisplayNode[];
  /** A nudge for the scene's camera (a stomp's impact), design units. */
  camera: { x: number; y: number };
  /** A white flash over the frame (0–0.06). */
  flash: number;
  /** Nothing in this field moves at this time. */
  still: boolean;
}

/** The field at `t`. */
export function drawType(plan: TypePlan, style: TypeStyle, t: number): TypeFrame {
  const { set, preset } = plan;
  const field = set.field;
  const poses = plan.units.map((_, i) => poseAt(plan, i, t));
  const loop: LoopPose = plan.motion.loop && t >= plan.loopStart && (plan.gone === null || t < (plan.motion.exitAt ?? Infinity)) ? loopAt(plan.motion.loop, t - plan.loopStart, { seed: plan.options.seed, period: plan.motion.loopPeriod, every: plan.motion.loopEvery, frameW: plan.frame.w, ...(plan.motion.loopUntil !== undefined && { until: plan.motion.loopUntil - plan.loopStart }) }) : LOOP_REST;
  const loopStill = loop.s === 1 && loop.rot === 0 && loop.dx === 0 && loop.dy === 0 && loop.sweep === null;
  const allRest = poses.every(isRest);
  let camera = { x: 0, y: 0 };
  let flash = 0;

  let nodes: DisplayNode[];
  if (allRest) {
    nodes = [...staticExtras(plan, style), textNode(field, plan.units.flatMap((u) => runsOf(plan, u.pieces, REST, style)))];
  } else {
    nodes = [];
    for (const [i, u] of plan.units.entries()) {
      const p = poses[i];
      if (preset.id === "stomp" && (u.exitStart === null || t < u.exitStart)) {
        const local = (t - u.start) * plan.speed;
        const A = 5 * F;
        if (local >= A && local < A + 6 * F) {
          const amp = 8 * Math.exp((-5 * (local - A)) / (6 * F)) * plan.options.intensity;
          const ang = rng(plan.options.seed, "nudge", i) * Math.PI * 2;
          camera = { x: camera.x + amp * Math.cos(ang), y: camera.y + amp * Math.sin(ang) };
          if (plan.motion.flash && local < A + 2 * F) flash = 0.06;
        }
      }
      if (p.opacity <= 0.001 && !p.bar) continue;
      nodes.push(...unitNodes(plan, i, p, style, t));
    }
    if (preset.id === "scramble") nodes = sliced(plan, nodes, t);
  }
  if (!loopStill) nodes = looped(plan, nodes, loop, style);
  return { nodes, camera, flash, still: allRest && loopStill };
}

/** Tiles and chips that stay at rest (split-flap's tiles, cut-paper's chips). */
function staticExtras(plan: TypePlan, style: TypeStyle): DisplayNode[] {
  if (plan.preset.id === "split-flap" && style.tile) return plan.units.filter((u) => flips(u.info.text)).map((u) => tileNode(plan, u.info, style.tile!));
  if (plan.preset.id === "cut-paper" && style.chip) return plan.units.map((u) => chipNodes(plan, u.info, style.chip!)).flat();
  return [];
}

function unitNodes(plan: TypePlan, i: number, p: Pose, style: TypeStyle, t: number): DisplayNode[] {
  const { set, preset } = plan;
  const u = plan.units[i];
  const info = u.info;
  const field = set.field;
  const [px, py] = pivotOf(preset.pivot, info, set);
  const m = poseMatrix(p, px, py);
  const out: DisplayNode[] = [];
  const em = set.size;

  // Echo: the unit a few frames back, fading, collapsing into it at rest.
  if (plan.motion.echo && !isRest(p)) {
    const alphas = [0.5, 0.3, 0.15, 0.08, 0.04].slice(0, Math.min(5, Math.max(1, plan.motion.echo)));
    alphas.forEach((a, k) => {
      const q = poseAt(plan, i, t - (k + 1) * 2.5 * F);
      if (q.dx === p.dx && q.dy === p.dy && q.sx === p.sx && q.sy === p.sy && q.rot === p.rot) return;
      out.push(group([textNode(field, runsOf(plan, u.pieces, { ...q, shown: undefined }, style), true)], { transform: poseMatrix(q, px, py), opacity: a * q.opacity }));
    });
  }

  let body: DisplayNode[] = [];
  if (p.flap) body = flapNodes(plan, u, p, style);
  else if (p.roll !== undefined) body = rollNodes(plan, u, p, style);
  else if (p.fold !== undefined) body = foldNodes(plan, u, p, style);
  else body = [textNode(field, runsOf(plan, u.pieces, p, style))];

  // A cut-paper chip moves with its word.
  if (preset.id === "cut-paper" && style.chip) body = [...chipNodes(plan, info, style.chip), ...body];
  if (preset.id === "split-flap" && style.tile && !p.flap && flips(info.text)) body = [tileNode(plan, info, style.tile), ...body];

  // Glow (neon): cached blurred copies behind, in the glow colour.
  if (p.glow !== undefined && p.glow > 0 && style.glow) {
    const levels: [number, number][] = [
      [0.05, 0.9],
      [0.3, 0.6],
      [0.8, 0.4],
    ];
    const glows = levels.map(([b, a]) => {
      const blur = b * em;
      const pad = blur * 2.5;
      const bounds = { x: info.x - pad, y: info.ink.y - pad, w: info.w + 2 * pad, h: info.ink.h + 2 * pad };
      return group([textNode(field, runsOf(plan, u.pieces, REST, style, style.glow!), true)], { soften: blur, blend: "lighter", opacity: a * p.glow!, cache: { key: `glow|${set.font}|${info.text}|${style.glow}|${b}`, bounds } });
    });
    body = [...glows, ...body];
  }

  // Colour split while a scramble runs (dark grounds only).
  if (p.split && plan.motion.dark) {
    const half = p.split / 2;
    body = [
      group([textNode(field, runsOf(plan, u.pieces, p, style, "#ff3355"), true)], { transform: [1, 0, 0, 1, -half, 0], blend: "screen", opacity: 0.7 }),
      group([textNode(field, runsOf(plan, u.pieces, p, style, "#33ddff"), true)], { transform: [1, 0, 0, 1, half, 0], blend: "screen", opacity: 0.7 }),
      ...body,
    ];
  }

  // Blur-in: cross-faded cached blur levels (never a live blur per frame).
  let content: DisplayNode[] = body;
  if (p.blur > 0.01) {
    const levels = [0, 2, 4, 8, 16];
    const b = Math.min(16, p.blur);
    let k = 0;
    while (k < levels.length - 2 && levels[k + 1] < b) k++;
    const lo = levels[k];
    const hi = levels[k + 1];
    const mixHi = (b - lo) / (hi - lo);
    const pad = 2.5 * hi + 0.2 * em;
    const bounds = { x: info.x - pad, y: info.ink.y - pad, w: info.w + 2 * pad, h: info.ink.h + 2 * pad };
    const layer = (level: number, a: number): DisplayNode => group(body, { opacity: a, ...(level > 0 && { soften: level, cache: { key: `blur|${set.font}|${info.text}|${JSON.stringify(style.fill)}|${level}`, bounds } }) });
    content = [layer(lo, 1 - mixHi), layer(hi, mixHi)];
  }

  // Stomp's ring: a copy growing away from the impact.
  if (p.ghost && p.ghost.a > 0) {
    const g = poseMatrix({ dx: 0, dy: 0, sx: p.ghost.s, sy: p.ghost.s, rot: 0, skewX: 0 }, px, py);
    out.push(group([textNode(field, runsOf(plan, u.pieces, REST, style), true)], { transform: g, opacity: p.ghost.a }));
  }

  const g: GroupNode = group(content, { ...(m && { transform: m }), ...(p.opacity < 1 && { opacity: p.opacity }) });
  if (p.reveal) {
    const pad = 0.3 * em;
    const box = { x: info.x - pad, y: info.ink.y - 0.3 * em, w: info.w + 2 * pad, h: info.ink.h + 0.6 * em };
    const mask = revealMask({ ...p.reveal, from: p.reveal.from, to: p.reveal.to }, box);
    if (mask) g.mask = mask;
    else if (p.reveal.to <= p.reveal.from) return out;
  }
  let node: DisplayNode = g;
  if (p.clip) node = group([g], { clip: { type: "rect", ...lineClip(set, info.line) } });
  out.push(node);

  // Bar-swipe's bar, over the line.
  if (p.bar && p.bar.to > p.bar.from && style.bar) {
    const l = set.lines[info.line];
    const capH = set.cap.bottom - set.cap.top;
    const padX = 0.06 * em;
    const x0 = info.x - padX + p.bar.from * (info.w + 2 * padX);
    const x1 = info.x - padX + p.bar.to * (info.w + 2 * padX);
    out.push({ type: "rect", x: x0, y: l.y + set.cap.top - 0.025 * capH, w: x1 - x0, h: 1.05 * capH, fill: style.bar });
  }

  // Type-on's caret: solid while typing, then two blinks, then gone.
  if (plan.preset.id === "type-on" && i === lastShown(plan, t)) {
    const end = plan.units[0].start + plan.units.length / plan.options.rate / plan.speed;
    const after = t - end;
    const on = after < 0 || (after < 1.06 && Math.floor(after / 0.265) % 2 === 1);
    if (on) {
      const capH = set.cap.bottom - set.cap.top;
      out.push({ type: "rect", x: info.x + info.w + 0.04 * em, y: info.y + set.cap.top - 0.05 * capH, w: Math.max(2, 0.06 * em), h: capH * 1.15, fill: style.caret ?? (typeof style.fill === "string" ? style.fill : "#ffffff") });
    }
  }
  return out;
}

/** The last letter typed so far. */
function lastShown(plan: TypePlan, t: number): number {
  let last = -1;
  for (let i = 0; i < plan.units.length; i++) if (poseAt(plan, i, t).opacity > 0) last = i;
  return last;
}

/** A split-flap tile behind a letter. */
/** Whether a split-flap slot flips (letters and figures); separators such as ":" stand free, with no tile. */
const flips = (text: string): boolean => /^[\p{L}\p{Nd}]$/u.test(text);

/** The widest flipping letter of a plan (every tile is that wide, so a narrow "1" gets the same tile as an "8"). */
const tileWidths = new WeakMap<TypePlan, number>();
function widestTile(plan: TypePlan): number {
  let w = tileWidths.get(plan);
  if (w === undefined) {
    w = Math.max(0, ...plan.units.filter((x) => flips(x.info.text)).map((x) => x.info.w));
    tileWidths.set(plan, w);
  }
  return w;
}

/** A flap tile's box round a letter (8 % of the letter's size in padding a side), one width for the whole row. */
function tileBox(plan: TypePlan, u: Pick<UnitInfo, "x" | "y" | "w">): Box {
  const { set } = plan;
  const em = set.size;
  const capH = set.cap.bottom - set.cap.top;
  const w = Math.max(u.w, widestTile(plan));
  return { x: u.x + u.w / 2 - w / 2 - 0.08 * em, y: u.y + set.cap.top - 0.2 * capH, w: w + 0.16 * em, h: capH * 1.4 };
}

/** A flap tile: its top half a step lighter than its bottom, a hinge line across the middle. */
function tileShape(b: Box, r: number, fill: string, em: number): DisplayNode[] {
  const mid = b.y + b.h / 2;
  const hinge = Math.max(1, em * 0.02);
  const light = /^#[0-9a-f]{6}$/i.test(fill) ? mixHex(fill, "#ffffff", 0.06) : fill;
  const dark = /^#[0-9a-f]{6}$/i.test(fill) ? mixHex(fill, "#000000", 0.12) : fill;
  return [
    group([{ type: "rect", ...b, r, fill: light }], { clip: { type: "rect", x: b.x - 1, y: b.y - 1, w: b.w + 2, h: mid - b.y + 1 } }),
    group([{ type: "rect", ...b, r, fill: dark }], { clip: { type: "rect", x: b.x - 1, y: mid, w: b.w + 2, h: b.y + b.h - mid + 1 } }),
    { type: "rect", x: b.x, y: mid - hinge / 2, w: b.w, h: hinge, fill: withAlpha("#000000", 0.45) },
  ];
}

function tileNode(plan: TypePlan, u: UnitInfo, fill: string): DisplayNode {
  return group(tileShape(tileBox(plan, u), 0.04 * plan.set.size, fill, plan.set.size));
}

/** A tile mid-flip: halves of the leaving and arriving letters, the moving flap squeezed about the middle. */
function flapNodes(plan: TypePlan, u: PlannedUnit, p: Pose, style: TypeStyle): DisplayNode[] {
  const { set } = plan;
  const info = u.info;
  const f = p.flap!;
  const em = set.size;
  const capH = set.cap.bottom - set.cap.top;
  const tb = tileBox(plan, info);
  const top = tb.y;
  const mid = tb.y + tb.h / 2;
  const bottom = tb.y + tb.h;
  const x = tb.x;
  const w = tb.w;
  void capH;
  const letter = (c: string) => [textNode(set.field, runsOf(plan, u.pieces, { ...REST, shown: c }, style))];
  const half = (c: string, upper: boolean, sy = 1): DisplayNode => {
    const clip = upper ? { type: "rect" as const, x, y: top, w, h: mid - top } : { type: "rect" as const, x, y: mid, w, h: bottom - mid };
    const inner: DisplayNode[] = [...(style.tile && flips(info.text) ? tileShape(tb, 0.04 * em, style.tile, em) : []), ...letter(c)];
    const m: Matrix | undefined = sy === 1 ? undefined : [1, 0, 0, sy, 0, mid - sy * mid];
    return group([group(inner, { clip })], m ? { transform: m } : {});
  };
  const out: DisplayNode[] = [half(f.to, true), half(f.from, false)];
  if (f.phase < 0.5) out.push(half(f.from, true, Math.max(0.001, Math.cos(f.phase * Math.PI))));
  else out.push(half(f.to, false, Math.max(0.001, -Math.cos(f.phase * Math.PI))));
  return out;
}

/** A rolling figure: the two figures either side of its place on the strip, in a window that fades at its ends. */
function rollNodes(plan: TypePlan, u: PlannedUnit, p: Pose, style: TypeStyle): DisplayNode[] {
  const { set } = plan;
  const info = u.info;
  const v = p.roll!;
  const base = Math.floor(v);
  const frac = v - base;
  const lh = set.lineHeight;
  const capH = set.cap.bottom - set.cap.top;
  // The window: the cap band and 10 % either side, fading over its outer 18 % (a neighbour never shows more than a sliver).
  const win = { x: info.x - 0.1 * set.size, y: info.y + set.cap.top - 0.1 * capH, w: info.w + 0.2 * set.size, h: capH * 1.2 };
  const from = p.rollFrom ?? -Infinity;
  const digit = (d: number, dy: number): DisplayNode[] => (d < from ? [] : [group([textNode(set.field, runsOf(plan, u.pieces, { ...REST, shown: String(((d % 10) + 10) % 10) }, style))], { transform: [1, 0, 0, 1, 0, dy] })]);
  const mask: GroupNode["mask"] = { kind: "linear", x0: 0, y0: win.y, x1: 0, y1: win.y + win.h, stops: [{ at: 0, color: "rgba(0,0,0,0)" }, { at: 0.18, color: "rgba(0,0,0,1)" }, { at: 0.82, color: "rgba(0,0,0,1)" }, { at: 1, color: "rgba(0,0,0,0)" }], bounds: win };
  const shown = [...digit(base, -frac * lh), ...digit(base + 1, (1 - frac) * lh)];
  return shown.length ? [group(shown, { clip: { type: "rect", ...win }, mask })] : [];
}

/** A line whose top half hinges down from flat. */
function foldNodes(plan: TypePlan, u: PlannedUnit, p: Pose, style: TypeStyle): DisplayNode[] {
  const { set } = plan;
  const info = u.info;
  const em = set.size;
  const mid = info.y + (set.cap.top + set.cap.bottom) / 2;
  const x = info.x - 0.3 * em;
  const w = info.w + 0.6 * em;
  const top = info.ink.y - 0.2 * em;
  const bottom = info.ink.y + info.ink.h + 0.2 * em;
  const runs = (shade: number) => [textNode(set.field, runsOf(plan, u.pieces, { ...REST, shade }, style))];
  const sy = Math.max(0.001, Math.cos(p.fold!));
  const out: DisplayNode[] = [
    group(runs(0), { clip: { type: "rect", x, y: mid, w, h: bottom - mid } }),
    group([group(runs(p.shade), { clip: { type: "rect", x, y: top, w, h: mid - top } })], { transform: [1, 0, 0, sy, 0, mid - sy * mid] }),
  ];
  const s = Math.sin(p.fold!);
  if (s > 0.01) out.push({ type: "rect", x, y: mid, w, h: 0.12 * em, fill: { kind: "linear", x0: 0, y0: mid, x1: 0, y1: mid + 0.12 * em, stops: [{ at: 0, color: `rgba(0,0,0,${0.25 * s})` }, { at: 1, color: "rgba(0,0,0,0)" }] } });
  return out;
}

/** A torn paper chip under a word, with its shadow and a strip of tape (seeded, the same every frame). */
function chipNodes(plan: TypePlan, u: UnitInfo, paper: string): DisplayNode[] {
  const { set } = plan;
  const em = set.size;
  const seed = plan.options.seed;
  const x0 = u.x - 0.22 * em;
  const x1 = u.x + u.w + 0.22 * em;
  const y0 = u.ink.y - 0.16 * em;
  const y1 = u.ink.y + u.ink.h + 0.16 * em;
  const j = (k: string) => (rng(seed, "chip", u.index, k) * 2 - 1) * 0.06 * em;
  const pts: [number, number][] = [
    [x0 + j("a"), y0 + j("b")],
    [(x0 + x1) / 2 + j("c"), y0 + j("d")],
    [x1 + j("e"), y0 + j("f")],
    [x1 + j("g"), (y0 + y1) / 2 + j("h")],
    [x1 + j("i"), y1 + j("j")],
    [(x0 + x1) / 2 + j("k"), y1 + j("l")],
    [x0 + j("m"), y1 + j("n")],
    [x0 + j("o"), (y0 + y1) / 2 + j("p")],
  ];
  const d = `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}Z`;
  const pad = 0.2 * em;
  const tapeW = 0.9 * em;
  const tapeH = 0.26 * em;
  const tx = (x0 + x1) / 2;
  const ang = (rng(seed, "tape", u.index) * 2 - 1) * 12 * (Math.PI / 180);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return [
    group([{ type: "path", d, fill: "rgba(0,0,0,0.22)" }], { transform: [1, 0, 0, 1, 0, 0.06 * em], soften: 0.08 * em, cache: { key: `chip-shadow|${d}`, bounds: { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad } } }),
    { type: "path", d, fill: paper, stroke: { paint: "rgba(255,255,255,0.6)", width: 1 } },
    group([{ type: "rect", x: -tapeW / 2, y: -tapeH / 2, w: tapeW, h: tapeH, fill: "rgba(255,255,255,0.7)" }], { transform: [c, s, -s, c, tx, y0] }),
  ];
}

/** A scramble's glitch: in two-frame bursts the block is cut into bands shifted sideways. */
function sliced(plan: TypePlan, nodes: DisplayNode[], t: number): DisplayNode[] {
  const local = (t - plan.motion.at) * plan.speed;
  const end = scrambleLock(plan.units[plan.units.length - 1].info);
  if (local < 0 || local >= end) return nodes;
  const step = Math.floor(local / (2 * F) + 1e-6);
  const seed = plan.options.seed;
  if (rng(seed, "slice-on", step) > 0.4) return nodes;
  const box = plan.set.ink;
  const n = 3 + Math.floor(rng(seed, "slices", step) * 3);
  const pad = plan.set.size * 0.4;
  const out: DisplayNode[] = [];
  for (let k = 0; k < n; k++) {
    const y0 = box.y + (box.h * k) / n;
    const dx = (rng(seed, "slice-dx", step, k) * 2 - 1) * (0.02 + 0.04 * rng(seed, "slice-amp", step, k)) * plan.frame.w * plan.options.intensity;
    out.push(group(nodes, { clip: { type: "rect", x: box.x - pad - Math.abs(dx), y: k === 0 ? box.y - pad : y0, w: box.w + 2 * pad + 2 * Math.abs(dx), h: k === n - 1 || k === 0 ? box.h / n + pad : box.h / n }, transform: [1, 0, 0, 1, dx, 0] }));
  }
  return out;
}

/** A loop applied to the whole field: a breath, a pulse, a wiggle, or a light band crossing the letters. */
function looped(plan: TypePlan, nodes: DisplayNode[], loop: LoopPose, style: TypeStyle): DisplayNode[] {
  const box = plan.set.ink;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const m = poseMatrix({ dx: loop.dx, dy: loop.dy, sx: loop.s, sy: loop.s, rot: loop.rot, skewX: 0 }, cx, cy);
  let out: DisplayNode[] = m ? [group(nodes, { transform: m })] : nodes;
  if (loop.sweep !== null) {
    const pad = plan.set.size * 0.3;
    const bandW = Math.max(0.18 * box.w, plan.set.size * 0.4);
    const x = box.x - bandW + loop.sweep * (box.w + 2 * bandW);
    const colour = style.sweep ?? "#ffffff";
    // A band that reads at 7.5 fps and on a phone: never fainter than 0.4.
    const a = Math.max(0.4, style.sweepAlpha ?? 0.45);
    const band: DisplayNode = {
      type: "rect",
      x: x - bandW / 2,
      y: box.y - pad,
      w: bandW,
      h: box.h + 2 * pad,
      fill: { kind: "linear", x0: x - bandW / 2, y0: 0, x1: x + bandW / 2, y1: 0, stops: [{ at: 0, color: withAlpha(colour, 0) }, { at: 0.5, color: withAlpha(colour, a) }, { at: 1, color: withAlpha(colour, 0) }] },
    };
    const tilt: Matrix = poseMatrix({ dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, skewX: Math.tan((20 * Math.PI) / 180) }, x, cy) ?? IDENTITY;
    out = [group([...out, group([band], { blend: "source-atop", transform: tilt })], { isolate: { x: box.x - pad - bandW, y: box.y - pad, w: box.w + 2 * pad + 2 * bandW, h: box.h + 2 * pad } })];
  }
  return out;
}

/** The fields' widest moment for a preset (for setType's `widest`). */
export const widestFor = (id: PresetId): { tracking?: number; scale?: number; weight?: number } | undefined => PRESETS[id].widest;
