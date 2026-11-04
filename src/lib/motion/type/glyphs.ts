/**
 * Type set for motion (pure): a field's typed words laid out at a display size, with every line, word and letter
 * placed, so an animation can move them one by one and land exactly on the layout at rest.
 *
 * - Exact text: the words are the typed words (layout.ts): never re-cased, cut, split or squeezed. Joining each
 *   piece's `gap` and `text` in order gives back the typed text.
 * - Fit at the widest moment: an animation that widens the words (tracking that closes in, a scale, a heavier weight)
 *   says so in `widest`, and the size is chosen so even that moment fits the box. If nothing fits, `overflow` is set
 *   and the page asks for shorter words.
 * - Letters are placed from the measured line up to them (`measure(line.slice(0, end)) - own width`), so the font's
 *   kerning survives when they move apart; tracking adds the same space after each letter.
 * - Scripts whose letters join or reorder (Arabic, Hebrew, Devanagari, Thai…) and lines a font may join with a
 *   ligature move by word or line only, never letter by letter, and get no tracking.
 * - Measured from the ink: the cap height and the ink box come from the browser's glyph bounds where it gives them
 *   (`measure.box`), so clips, bars and alignment hug the letters rather than the font size.
 */

import { graphemes, layoutText, type Measure } from "../layout";
import type { Box } from "../display";
import { fontOf, type FontStyle } from "./faces";

/** Where a text's ink lies, from the point it is drawn at (textBaseline "top"): top and bottom down from y, left and right across from x. */
export interface InkBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** A measure that can also report ink bounds (the browser's actualBoundingBox*, with textBaseline "top"). */
export type BoxMeasure = Measure & { box?: (text: string, font: string) => InkBox };

const pxOf = (font: string): number => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);

/** A text's ink box: the browser's own where it can tell, else an estimate from the size (caps 0.1–0.82 em, descenders to 1 em). */
export function inkOf(measure: BoxMeasure, text: string, font: string): InkBox {
  if (measure.box) return measure.box(text, font);
  const size = pxOf(font);
  return { top: size * 0.1, bottom: size * (/[gjpqyQ,;]/.test(text) ? 1 : 0.82), left: 0, right: measure(text, font) };
}

/** Joining or reordering scripts: by word or line only. */
const COMPLEX = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Thai}\p{Script=Lao}\p{Script=Tibetan}\p{Script=Myanmar}\p{Script=Khmer}\p{Script=Mongolian}]/u;
/** Pairs a font may join into one glyph: such a line moves by word. */
const LIGATURE = /f[fijlbhkt]/;
const DIGIT = /^\p{Nd}$/u;
const OPENING = /^[“‘"'«„‚(\[]$/u;

export interface TypeSpec {
  /** The field it sets ("headline"). */
  field: string;
  text: string;
  family: string;
  weight: number;
  style?: FontStyle;
  /** Largest and smallest size; tried from the largest down by `step` (6 %). */
  max: number;
  min: number;
  step?: number;
  /** The box: its left edge, its width; the first line's cap top (or em top) at `y`. */
  x: number;
  y: number;
  width: number;
  maxLines: number;
  /** Line pitch as a share of the size. */
  leading: number;
  /** Letter spacing at rest, in em. */
  tracking?: number;
  /** The widest moment of the animation: letter spacing it adds (em, on top of `tracking`), its scale, its heaviest weight. */
  widest?: { tracking?: number; scale?: number; weight?: number };
  align?: "left" | "centre" | "right";
  /** `y` is the cap top of the first line (default), else the top of its em box. */
  capTop?: boolean;
  /** Left-aligned lines start at their first letter's ink, not its side bearing; an opening quote hangs outside (default on). */
  optical?: boolean;
  /** Figures in fixed-width cells (prices, counts, stats): numbers never jitter while they change. */
  tabular?: boolean;
  /** Even lines (see layoutText): the shortest line's share of the longest worth trying smaller sizes for. */
  even?: number;
  /** The narrowest a word space may look (em, space plus tracking); default by size and style (see wordSpaceFor). */
  wordSpace?: number;
}

/** Below this size (design units) a run is copy, not a hero: never tracked tighter than 0. */
export const COPY_SIZE = 100;

/**
 * The letter spacing a text is really set at: never tighter than −1 %; words with lower-case letters never tracked
 * open (tracking is for capitals) and, below hero size, never tighter than 0.
 */
export function trackingFor(text: string, tracking: number, max: number): number {
  let t = Math.max(-0.01, tracking);
  if (/\p{Ll}/u.test(text)) {
    t = Math.min(0.01, t);
    if (max < COPY_SIZE) t = Math.max(0, t);
  }
  return t;
}

/** The narrowest word space (em) for a size and style: copy and italics need more room than display caps. */
export const wordSpaceFor = (max: number, style: FontStyle): number => (max < COPY_SIZE ? 0.24 : 0.2) + (style === "italic" ? 0.04 : 0);

/** Minimum gap between one line's ink and the next line's ink, as a share of the cap height. */
export const LINE_GAP = 0.05;

export interface SetGlyph {
  text: string;
  gap: string;
  x: number;
  y: number;
  /** Its own advance. */
  w: number;
  line: number;
  word: number;
}

export interface SetWord {
  text: string;
  gap: string;
  x: number;
  y: number;
  w: number;
  line: number;
  /** Its letters in `glyphs` (from, to), or null when its line moves by word. */
  glyphs: [number, number] | null;
}

export interface SetLine {
  text: string;
  gap: string;
  x: number;
  y: number;
  w: number;
  /** The baseline (the bottom of a capital). */
  baseline: number;
  /** Its ink. */
  ink: Box;
  words: [number, number];
  glyphs: [number, number] | null;
}

export interface TypeSet {
  field: string;
  /** The typed text, trimmed. */
  text: string;
  overflow: boolean;
  family: string;
  weight: number;
  style: FontStyle;
  size: number;
  font: string;
  lineHeight: number;
  /** Letter spacing at rest (em); 0 for scripts that join. */
  tracking: number;
  /** Room added to each word space so it never looks closed (px at this size; 0 for most faces). */
  spaceExtra: number;
  align: "left" | "centre" | "right";
  dir: "ltr" | "rtl";
  /** The cap height's top and bottom below a line's y. */
  cap: { top: number; bottom: number };
  lines: SetLine[];
  words: SetWord[];
  glyphs: SetGlyph[];
  /** Whether every line can move letter by letter. */
  splittable: boolean;
  tabular: boolean;
  /** The layout box (x, y of the first line's em top, the widest line, every line's pitch). */
  box: Box;
  /** All the ink. */
  ink: Box;
  /** Kept for the moments an animation re-measures (a weight wave, a cycling letter). */
  measure: BoxMeasure;
}

const union = (boxes: Box[]): Box => {
  if (!boxes.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/** The widest figure's advance in a font (the cell a tabular figure sits in). */
export const figureCell = (measure: Measure, font: string): number => Math.max(...[..."0123456789"].map((d) => measure(d, font)));

/** A text's advance with figures in cells (each other letter at its own advance; kerning between figures dropped). */
function tabularWidth(measure: Measure, text: string, font: string): number {
  if (!/\p{Nd}/u.test(text)) return measure(text, font);
  const cell = figureCell(measure, font);
  let w = 0;
  let run = "";
  for (const g of graphemes(text)) {
    if (DIGIT.test(g.text)) {
      if (run) w += measure(run, font);
      run = "";
      w += cell;
    } else run += g.text;
  }
  return w + (run ? measure(run, font) : 0);
}

/** Lay out a field for motion (see the file's comment). */
export function setType(spec: TypeSpec, measure: BoxMeasure): TypeSet {
  const style: FontStyle = spec.style ?? "normal";
  const styled = (font: string) => (style === "italic" && !font.startsWith("italic") ? `italic ${font}` : font);
  const text = spec.text.trim();
  const complex = COMPLEX.test(text);
  const tracking = complex ? 0 : trackingFor(text, spec.tracking ?? 0, spec.max);
  const minSpace = complex ? 0 : (spec.wordSpace ?? wordSpaceFor(spec.max, style));
  const spaceRoom = (font: string, track: number) => Math.max(0, minSpace * pxOf(font) - (measure(" ", font) + track * pxOf(font)));
  const spacesIn = (t: string) => (t.match(/ /g) ?? []).length;
  const widest = spec.widest ?? {};
  const wideTrack = complex ? 0 : tracking + Math.max(0, widest.tracking ?? 0);
  const scale = Math.max(1, widest.scale ?? 1);
  const tabular = !!spec.tabular;
  const advance = (t: string, font: string) => (tabular ? tabularWidth(measure, t, font) : measure(t, font));
  // The width a line takes at the animation's widest moment.
  const fit: Measure = (t, font) => {
    const real = styled(font);
    let w = advance(t, real);
    if (widest.weight && widest.weight !== spec.weight) w = Math.max(w, advance(t, real.replace(/^(italic )?\d+ /, `$1${widest.weight} `)));
    const n = graphemes(t).length;
    return (w + wideTrack * pxOf(font) * Math.max(0, n - 1) + spaceRoom(real, tracking) * spacesIn(t)) * scale;
  };
  const layout = layoutText({ text, family: spec.family, weight: spec.weight, width: spec.width, maxLines: spec.maxLines, max: spec.max, min: spec.min, step: spec.step, lineHeight: spec.leading, even: spec.even }, fit);
  const size = layout.size;
  const font = fontOf(spec.family, size, spec.weight, style);
  const capProbe = inkOf(measure, "H", font);
  // Lines never touch: the pitch grows until each line's ink clears the next line's by LINE_GAP of the cap height.
  let lh = size * spec.leading;
  for (let i = 0; i + 1 < layout.lines.length; i++) {
    const below = inkOf(measure, layout.lines[i].text, font).bottom;
    const above = Math.min(capProbe.top, inkOf(measure, layout.lines[i + 1].text, font).top);
    lh = Math.max(lh, below - above + LINE_GAP * (capProbe.bottom - capProbe.top));
  }
  const align = spec.align ?? "left";
  const cap = { top: capProbe.top, bottom: capProbe.bottom };
  const top = spec.capTop === false ? spec.y : spec.y - cap.top;
  const T = tracking * size;
  const E = layout.dir === "ltr" ? spaceRoom(font, tracking) : 0;
  const cell = tabular ? figureCell(measure, font) : 0;

  const lines: SetLine[] = [];
  const words: SetWord[] = [];
  const glyphs: SetGlyph[] = [];
  let splittable = !complex;

  layout.lines.forEach((ln, li) => {
    const lineText = ln.text;
    const gs = graphemes(lineText);
    const ordAt = new Map<number, number>();
    gs.forEach((g, k) => ordAt.set(g.index, k));
    ordAt.set(lineText.length, gs.length);
    // Each letter's left edge and advance at rest.
    const lefts: number[] = [];
    const widths: number[] = [];
    if (tabular) {
      let x = 0;
      gs.forEach((g, k) => {
        const own = measure(g.text, font);
        const adv = DIGIT.test(g.text) ? cell : own;
        lefts.push(x + (adv - own) / 2);
        widths.push(own);
        x += adv + (k < gs.length - 1 ? T : 0) + (g.text === " " ? E : 0);
      });
    } else {
      let spaces = 0;
      gs.forEach((g, k) => {
        const own = measure(g.text, font);
        lefts.push(measure(lineText.slice(0, g.index + g.text.length), font) - own + T * k + E * spaces);
        widths.push(own);
        if (g.text === " ") spaces++;
      });
    }
    const natural = tabular ? tabularWidth(measure, lineText, font) : measure(lineText, font);
    const width = natural + T * Math.max(0, gs.length - 1) + E * spacesIn(lineText);
    const lineInk = inkOf(measure, lineText, font);
    // Optical margin: a left-aligned line starts at its first letter's ink; an opening quote hangs outside.
    let shift = 0;
    if (align === "left" && spec.optical !== false && layout.dir === "ltr" && gs.length) {
      const first = gs[0].text;
      shift = OPENING.test(first) ? -(lefts[1] ?? widths[0]) : -Math.max(-size * 0.08, Math.min(size * 0.08, inkOf(measure, first, font).left));
    }
    const x = (align === "left" ? spec.x : align === "right" ? spec.x + spec.width - width : spec.x + (spec.width - width) / 2) + shift;
    const y = top + li * lh;
    const split = !complex && layout.dir === "ltr" && !LIGATURE.test(lineText);
    if (!split) splittable = false;
    const w0 = words.length;
    const g0 = glyphs.length;
    let wordIndex = w0;
    let off = 0;
    for (const word of ln.words) {
      // The word's place in the line: the line starts with the first word; each next one after its gap.
      const from = words.length === w0 ? 0 : off + word.gap.length;
      const to = from + word.text.length;
      off = to;
      const ordFrom = ordAt.get(from) ?? 0;
      const ordTo = ordAt.get(to) ?? gs.length;
      const left = layout.dir === "rtl" ? width - (measure(lineText.slice(0, to), font) + T * ordTo) : lefts[ordFrom] ?? 0;
      const right = layout.dir === "rtl" ? width - (measure(lineText.slice(0, from), font) + T * ordFrom) : (lefts[ordTo - 1] ?? 0) + (widths[ordTo - 1] ?? 0);
      const wordGlyphs: [number, number] | null = split ? [glyphs.length, glyphs.length] : null;
      if (split) {
        let gap = word.gap;
        for (let k = ordFrom; k < ordTo; k++) {
          glyphs.push({ text: gs[k].text, gap, x: x + lefts[k], y, w: widths[k], line: li, word: wordIndex });
          gap = "";
        }
        wordGlyphs![1] = glyphs.length;
      }
      words.push({ text: word.text, gap: word.gap, x: x + left, y, w: right - left, line: li, glyphs: wordGlyphs });
      wordIndex++;
    }
    lines.push({
      text: lineText,
      gap: ln.gap,
      x,
      y,
      w: width,
      baseline: y + cap.bottom,
      ink: { x: x + lineInk.left, y: y + lineInk.top, w: lineInk.right - lineInk.left + T * Math.max(0, gs.length - 1) + E * spacesIn(lineText), h: lineInk.bottom - lineInk.top },
      words: [w0, words.length],
      glyphs: split ? [g0, glyphs.length] : null,
    });
  });

  const box: Box = lines.length ? { x: Math.min(...lines.map((l) => l.x)), y: top, w: Math.max(...lines.map((l) => l.w)), h: lines.length * lh } : { x: spec.x, y: top, w: 0, h: 0 };
  return {
    field: spec.field,
    text,
    overflow: layout.overflow,
    family: spec.family,
    weight: spec.weight,
    style,
    size,
    font,
    lineHeight: lh,
    tracking,
    spaceExtra: E,
    align,
    dir: layout.dir,
    cap,
    lines,
    words,
    glyphs,
    splittable: splittable && lines.length > 0,
    tabular,
    box,
    ink: union(lines.map((l) => l.ink)),
    measure,
  };
}

/** A set's lines, words and letters joined back (gap + text): the typed text. */
export const setSpelling = (set: TypeSet): string => set.words.map((w) => w.gap + w.text).join("");

/** Shift a whole set (a layout made at one place, drawn at another). */
export function moveSet(set: TypeSet, dx: number, dy: number): TypeSet {
  const box = (b: Box): Box => ({ ...b, x: b.x + dx, y: b.y + dy });
  return {
    ...set,
    lines: set.lines.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy, baseline: l.baseline + dy, ink: box(l.ink) })),
    words: set.words.map((w) => ({ ...w, x: w.x + dx, y: w.y + dy })),
    glyphs: set.glyphs.map((g) => ({ ...g, x: g.x + dx, y: g.y + dy })),
    box: box(set.box),
    ink: box(set.ink),
  };
}
