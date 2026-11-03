/**
 * Text set exactly as typed (pure). The words a person types are drawn as they typed them: no case change, no "…", no
 * hyphen, no word split across lines. Only leading and trailing whitespace is trimmed; a line break they typed is a
 * forced break and runs of spaces are kept. Text shrinks to its smallest size; if it still doesn't fit, the layout says
 * so (`overflow`) and the page asks for shorter words instead of cutting them.
 *
 * Lines are balanced: at the largest size that fits, among the breaks with the fewest lines, the one whose lines are
 * closest in width (no lone short word on the last line). The layout also gives each line's words and letters (grapheme
 * clusters: an emoji family or an accented letter stays whole) with their boxes, so a scene can move them one by one
 * and still land exactly on this layout at rest.
 *
 * Every drawn piece carries `gap`, the whitespace before it in the typed text (not drawn): joining gap + text over every
 * piece in order gives back the typed text, which tests/motion-spelling.test.ts checks for every scene.
 */

import { fontString, type Measure } from "@/components/ads/layout";

export type { Measure };

export interface Piece {
  text: string;
  /** The typed whitespace before this piece (a line's first piece: the break's whitespace). */
  gap: string;
  /** From the line's left edge. */
  x: number;
  w: number;
}

export interface LineLayout {
  text: string;
  /** The whitespace consumed by the break before this line ("" for the first). */
  gap: string;
  width: number;
  words: Piece[];
  /** Letters, or null for a script whose letters join (Arabic, Devanagari, Thai…): those move by word. */
  graphemes: Piece[] | null;
}

export interface TextLayout {
  /** The typed text, trimmed. */
  text: string;
  overflow: boolean;
  size: number;
  /** Line pitch (size × the spec's factor). */
  lineHeight: number;
  font: string;
  family: string;
  weight: number;
  dir: "ltr" | "rtl";
  lines: LineLayout[];
  /** The widest line. */
  width: number;
  /** lines × lineHeight. */
  height: number;
}

export interface TextSpec {
  text: string;
  family: string;
  weight: number;
  /** The box's width. */
  width: number;
  maxLines: number;
  /** Largest and smallest size; the size steps down by `step` (6 %) between them. */
  max: number;
  min: number;
  lineHeight?: number;
  step?: number;
  /** Letter boxes too (each costs a measurement per letter). */
  letters?: boolean;
  /**
   * Even lines: when the shortest line is under this share of the longest (a lone word left on a line), sizes down to
   * 85 % of the first one that fits are tried for a more even break. Off by default.
   */
  even?: number;
}

/** Scripts written without spaces between words: they may break between the words Intl.Segmenter finds. */
const NO_SPACES = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{Script=Thai}\p{Script=Lao}\p{Script=Myanmar}\p{Script=Khmer}]/u;
/** Scripts whose letters join or reorder: never drawn letter by letter. */
const COMPLEX = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Thai}\p{Script=Lao}\p{Script=Tibetan}\p{Script=Myanmar}\p{Script=Khmer}\p{Script=Mongolian}]/u;
const RTL_CHAR = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const LTR_CHAR = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Armenian}\p{Script=Georgian}]/u;
/** Letter pairs a font may join into one glyph (fi, fl, ff…): a line holding one moves by word, never letter by letter. */
const LIGATURE = /f[fijlbhkt]/;
/** A typed line break (a new line, or a line or paragraph separator). */
const BREAK = /[\r\n\p{Zl}\p{Zp}]/u;

/** Left-to-right or right-to-left, by the first letter that says. */
export function directionOf(text: string): "ltr" | "rtl" {
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) return "rtl";
    if (LTR_CHAR.test(ch)) return "ltr";
  }
  return "ltr";
}

const segmenters = new Map<string, Intl.Segmenter | null>();
function segmenter(granularity: "word" | "grapheme"): Intl.Segmenter | null {
  if (!segmenters.has(granularity)) segmenters.set(granularity, typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity }) : null);
  return segmenters.get(granularity)!;
}

/** Grapheme clusters (a ZWJ emoji, a letter and its accents, a flag stay one), with their offsets. */
export function graphemes(text: string): { text: string; index: number }[] {
  const seg = segmenter("grapheme");
  if (seg) return [...seg.segment(text)].map((s) => ({ text: s.segment, index: s.index }));
  const out: { text: string; index: number }[] = [];
  let i = 0;
  for (const ch of text) {
    out.push({ text: ch, index: i });
    i += ch.length;
  }
  return out;
}

/** A place a line may break: the atom from `start` to `end`, after the whitespace from `gapStart`. */
interface Atom {
  gapStart: number;
  start: number;
  end: number;
  /** The whitespace before it holds a typed line break. */
  forced: boolean;
}

function atomsOf(text: string): Atom[] {
  const atoms: Atom[] = [];
  const re = /(\s*)(\S+)/gy;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const gapStart = m.index;
    const start = gapStart + m[1].length;
    const word = m[2];
    const forced = BREAK.test(m[1]);
    const seg = NO_SPACES.test(word) ? segmenter("word") : null;
    if (!seg) {
      atoms.push({ gapStart, start, end: start + word.length, forced });
      continue;
    }
    // A run with no spaces may break between its words (Japanese, Chinese, Thai); punctuation stays with the word before.
    let first = true;
    for (const s of seg.segment(word)) {
      const a = start + s.index;
      const prev = atoms[atoms.length - 1];
      if (!first && prev && !(s as Intl.SegmentData & { isWordLike?: boolean }).isWordLike) {
        prev.end = a + s.segment.length;
        continue;
      }
      atoms.push({ gapStart: first ? gapStart : a, start: a, end: a + s.segment.length, forced: first && forced });
      first = false;
    }
  }
  return atoms;
}

type Width = (i: number, j: number) => number;

/** Fewest lines that hold the atoms a..b (inclusive) at this width, or Infinity when one atom is wider than the box. */
function greedyCount(a: number, b: number, width: number, w: Width): number {
  let lines = 1;
  let from = a;
  for (let j = a; j <= b; j++) {
    if (w(j, j) > width) return Infinity;
    if (w(from, j) > width) {
      lines++;
      from = j;
    }
  }
  return lines;
}

/**
 * The break of atoms a..b into exactly `n` lines whose widths are closest to each other (least squares), a line of one
 * lone word costing more when there are words enough to keep each line at two or more.
 */
function balancedBreaks(a: number, b: number, n: number, width: number, w: Width): number[] {
  if (n <= 1) return [a];
  const avg = w(a, b) / n;
  const count = b - a + 1;
  const lone = count >= 2 * n ? (avg * 0.4) ** 2 : 0;
  // cost[l][j]: the best l + 1 lines ending at atom a + j; from[l][j]: where the last of them starts.
  const cost = Array.from({ length: n }, () => new Float64Array(count).fill(Infinity));
  const from = Array.from({ length: n }, () => new Int32Array(count).fill(-1));
  for (let j = 0; j < count; j++) {
    const lw = w(a, a + j);
    if (lw <= width) cost[0][j] = (lw - avg) ** 2 + (j === 0 ? lone : 0);
  }
  for (let l = 1; l < n; l++) {
    for (let j = l; j < count; j++) {
      for (let i = l; i <= j; i++) {
        const prev = cost[l - 1][i - 1];
        if (prev === Infinity) continue;
        const lw = w(a + i, a + j);
        if (lw > width) continue;
        const c = prev + (lw - avg) ** 2 + (i === j ? lone : 0);
        if (c < cost[l][j]) {
          cost[l][j] = c;
          from[l][j] = i;
        }
      }
    }
  }
  const starts: number[] = [];
  let j = count - 1;
  for (let l = n - 1; l > 0; l--) {
    const i = from[l][j];
    if (i < 0) return greedyStarts(a, b, width, w);
    starts.unshift(a + i);
    j = i - 1;
  }
  starts.unshift(a);
  return starts;
}

function greedyStarts(a: number, b: number, width: number, w: Width): number[] {
  const starts = [a];
  let from = a;
  for (let j = a + 1; j <= b; j++) {
    if (w(from, j) > width) {
      starts.push(j);
      from = j;
    }
  }
  return starts;
}

/** Paragraphs (typed line breaks) as atom ranges. */
function paragraphs(atoms: Atom[]): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  for (let i = 1; i < atoms.length; i++) {
    if (atoms[i].forced) {
      out.push([start, i - 1]);
      start = i;
    }
  }
  if (atoms.length) out.push([start, atoms.length - 1]);
  return out;
}

/** Lay out `spec.text` (see the file's comment). */
export function layoutText(spec: TextSpec, measure: Measure): TextLayout {
  const text = spec.text.trim();
  const lh = spec.lineHeight ?? 1.12;
  const dir = directionOf(text);
  const complex = COMPLEX.test(text);
  const atoms = atomsOf(text);
  const paras = paragraphs(atoms);
  const empty = (size: number): TextLayout => ({ text, overflow: false, size, lineHeight: size * lh, font: fontString(spec.family, size, spec.weight), family: spec.family, weight: spec.weight, dir, lines: [], width: 0, height: 0 });
  if (!atoms.length) return empty(spec.max);

  const attempt = (size: number, last: boolean): TextLayout | null => {
    const font = fontString(spec.family, size, spec.weight);
    const memo = new Map<number, number>();
    const w: Width = (i, j) => {
      const key = i * 4096 + j;
      let v = memo.get(key);
      if (v === undefined) {
        v = measure(text.slice(atoms[i].start, atoms[j].end), font);
        memo.set(key, v);
      }
      return v;
    };
    const counts = paras.map(([a, b]) => greedyCount(a, b, spec.width, w));
    const total = counts.reduce((s, c) => s + c, 0);
    const fits = total <= spec.maxLines && Number.isFinite(total);
    if (!fits && !last) return null;
    // Too long even at the smallest size: every line still laid out (nothing cut), and flagged.
    const starts = paras.flatMap(([a, b], k) => (fits ? balancedBreaks(a, b, counts[k], spec.width, w) : greedyStarts(a, b, spec.width, w)));
    const lines: LineLayout[] = starts.map((s, k) => {
      const e = (k + 1 < starts.length ? starts[k + 1] : atoms.length) - 1;
      const lineStart = atoms[s].start;
      const lineText = text.slice(lineStart, atoms[e].end);
      const width = w(s, e);
      const at = (offset: number) => (offset <= 0 ? 0 : measure(lineText.slice(0, offset), font));
      // A piece starts where the line up to its end ends, less the piece's own advance: the kerning before it is kept, so
      // a piece drawn on its own lands exactly where the whole line draws it.
      const left = (from: number, to: number, w: number) => (dir === "rtl" ? width - at(to) : Math.max(0, at(to) - w));
      const words: Piece[] = [];
      for (let i = s; i <= e; i++) {
        const from = atoms[i].start - lineStart;
        const to = atoms[i].end - lineStart;
        const word = text.slice(atoms[i].start, atoms[i].end);
        const w = from === 0 && to === lineText.length ? width : measure(word, font);
        words.push({ text: word, gap: text.slice(atoms[i].gapStart, atoms[i].start), x: left(from, to, w), w });
      }
      let letters: Piece[] | null = null;
      if (spec.letters && !complex && !LIGATURE.test(lineText)) {
        letters = [];
        let gap = atoms[s].gapStart < lineStart ? text.slice(atoms[s].gapStart, lineStart) : "";
        for (const g of graphemes(lineText)) {
          if (/^\s+$/.test(g.text)) {
            gap += g.text;
            continue;
          }
          const w = measure(g.text, font);
          letters.push({ text: g.text, gap, x: left(g.index, g.index + g.text.length, w), w });
          gap = "";
        }
      }
      return { text: lineText, gap: text.slice(atoms[s].gapStart, lineStart), width, words, graphemes: letters };
    });
    return { text, overflow: !fits, size, lineHeight: size * lh, font, family: spec.family, weight: spec.weight, dir, lines, width: Math.max(...lines.map((l) => l.width)), height: lines.length * size * lh };
  };

  let size = spec.max;
  const step = spec.step ?? 0.94;
  for (;;) {
    const last = size <= spec.min;
    const got = attempt(size, last);
    if (got) return spec.even && !got.overflow ? evener(got, spec.even, (s) => attempt(s, false), Math.max(spec.min, size * 0.85), step) : got;
    size = Math.max(spec.min, size * step);
  }
}

/** How even a layout's lines are: the shortest line's share of the longest (1: a single line). */
const evenness = (l: TextLayout): number => (l.lines.length < 2 ? 1 : Math.min(...l.lines.map((x) => x.width)) / Math.max(1, l.width));

/** The first size from `got` down to `floor` whose lines are even enough, else the most even one tried (else `got`). */
function evener(got: TextLayout, even: number, attempt: (size: number) => TextLayout | null, floor: number, step: number): TextLayout {
  let best = got;
  for (let size = got.size * step; size >= floor - 1e-9 && evenness(best) < even; size *= step) {
    const l = attempt(size);
    if (l && l.lines.length <= got.lines.length && evenness(l) > evenness(best) + 0.05) best = l;
  }
  return best;
}

/** The typed text back from a layout's lines (gap + text), for checks. */
export const spelled = (pieces: readonly { gap?: string; text: string }[]): string => pieces.map((p) => (p.gap ?? "") + p.text).join("");
