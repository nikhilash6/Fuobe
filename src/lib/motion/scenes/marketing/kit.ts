/**
 * What Marketing's code-drawn templates share (pure): the look (a light, dark or brand-colour ground, with the words,
 * cards and highlights in kit colours that read on it), the frame's safe area, the pace, text blocks set exactly as
 * typed, a rolling counter, and the scene wrapper. A template is a timeline of events laid out in the time the clip
 * allows (everything set at least a second before the end), a frame function, and a camera that comes to rest on the
 * last frame, so the poster, the last frame and the still are one picture.
 */

import { contrast, luminance, readableOn, themeFrom, type AdTheme } from "@/components/ads/layout";
import { about, group, mixHex, multiply, translate, withAlpha, type DisplayList, type DisplayNode, type TextRun } from "../../display";
import { curve, type CurveName } from "../../ease";
import { layoutText, type Measure, type TextLayout } from "../../layout";
import type { Recipe } from "../../recipe";
import type { Outline, Scene, SceneInput, ScenePlan } from "../../scene";
import { designSize, type SizeSpec } from "../../sizes";
import { frameCount, local } from "../../time";
import { DURATION_LIMITS, timeline, type EventKind, type MotionEvent, type StaggerUnit, type Timeline } from "../../tween";
import { cardColours, lineLeft, lineRun, lineRuns, secondColour, type TextBlock } from "../end-card/shared";

export type LookId = "light" | "dark" | "brand";

export interface Palette {
  look: LookId;
  ground: string;
  /** Words on the ground. */
  ink: string;
  /** Quieter words on the ground (still at least 4.5:1). */
  muted: string;
  accent: string;
  second: string;
  /** A card or panel on the ground, and the words on it. */
  surface: string;
  surfaceInk: string;
  /** Shapes and lines that stand apart from the ground. */
  mark: string;
  mark2: string;
  /** A marked word's swatch and the words on it. */
  highlight: { fill: string; ink: string };
}

const HEX = /^#[0-9a-f]{6}$/i;

/** The first colour that reads on `bg` (4.5:1), else white or near-black. */
export function readable(bg: string, ...prefs: (string | undefined)[]): string {
  for (const c of prefs) if (c && HEX.test(c) && contrast(c, bg) >= 4.5) return c;
  return readableOn(bg);
}

/** A colour that stands apart from `bg` as a shape (`min`:1), else the nearest shade of it that does. */
function standOut(c: string, bg: string, min = 1.6): string {
  if (contrast(c, bg) >= min) return c;
  const towards = luminance(bg) > 0.4 ? "#000000" : "#ffffff";
  for (let k = 0.1; k <= 0.8; k += 0.1) {
    const m = mixHex(c, towards, k);
    if (contrast(m, bg) >= min) return m;
  }
  return mixHex(c, towards, 0.8);
}

/** Of two colours for a shape on `bg`, the one that stands apart more (the first when they tie). */
function bolder(a: string, b: string, bg: string): string {
  return contrast(b, bg) > contrast(a, bg) + 0.05 ? b : a;
}

/** The look's colours from the kit. */
export function paletteFor(look: LookId, theme: AdTheme, colors: readonly string[]): Palette {
  const accent = theme.accent;
  const second = secondColour(colors, accent);
  if (look === "brand") {
    const { ink, pill, label } = cardColours(theme, colors);
    const surface = mixHex(theme.paper, accent, 0.04);
    return {
      look,
      ground: accent,
      ink,
      muted: ink,
      accent,
      second,
      surface,
      surfaceInk: readable(surface, theme.ink, accent),
      mark: standOut(second, accent),
      mark2: standOut(mixHex(accent, contrast(accent, "#000000") > contrast(accent, "#ffffff") ? "#000000" : "#ffffff", 0.3), accent),
      highlight: { fill: pill, ink: label },
    };
  }
  if (look === "dark") {
    // A brand colour that is itself dark (emerald, navy, oxblood) is the ground: the piece reads as the brand, and it
    // meets its end card (drawn on the brand colour) without a change of ground. Else a near-black tinted by it.
    const deep = luminance(accent) < 0.045 && contrast(accent, "#ffffff") >= 9 ? accent : luminance(theme.ink) < 0.03 && contrast(theme.ink, accent) >= 1.8 ? mixHex(theme.ink, accent, 0.1) : mixHex(accent, "#050507", 0.86);
    const ink = readable(deep, theme.paper, "#ffffff");
    const mutedTry = mixHex(ink, deep, 0.3);
    const surface = mixHex(deep, "#ffffff", 0.07);
    // The brand's second colour wherever it reads better on the deep ground than a lightened accent (gold on emerald).
    const fill = bolder(standOut(accent, deep, 2.2), standOut(second, deep, 2.2), deep);
    const own = standOut(accent, deep, 3);
    const mark = bolder(own, standOut(second, deep, 3), deep);
    return {
      look,
      ground: deep,
      ink,
      muted: contrast(mutedTry, deep) >= 4.5 ? mutedTry : ink,
      accent,
      second,
      surface,
      surfaceInk: readable(surface, ink),
      mark,
      mark2: mark === own ? standOut(second, deep, 2.2) : standOut(accent, deep, 2.2),
      highlight: { fill, ink: readable(fill, deep, theme.paper, theme.ink) },
    };
  }
  const paper = theme.paper && luminance(theme.paper) > 0.85 ? theme.paper : "#faf8f5";
  const ground = mixHex(paper, accent, 0.06);
  const ink = readable(ground, theme.ink, "#121212");
  const mutedTry = mixHex(ink, ground, 0.3);
  const fill = bolder(standOut(accent, ground, 2.2), standOut(second, ground, 2.2), ground);
  const own = standOut(accent, ground, 3);
  const mark = bolder(own, standOut(second, ground, 3), ground);
  return {
    look,
    ground,
    ink,
    muted: contrast(mutedTry, ground) >= 4.5 ? mutedTry : ink,
    accent,
    second,
    surface: "#ffffff",
    surfaceInk: readable("#ffffff", ink),
    mark,
    mark2: mark === own ? standOut(second, ground, 2.2) : standOut(accent, ground, 2.2),
    highlight: { fill, ink: readable(fill, paper, ground, theme.ink) },
  };
}

/**
 * Where words may go: 6 % of the short side in from every edge; a tall 9:16 frame keeps its top 12 % and bottom 18 %
 * clear for the platform's own buttons and captions.
 */
export function safeArea(d: { w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const S = Math.min(d.w, d.h);
  const side = Math.round(S * 0.06);
  if (d.h / d.w > 1.7) return { x: side, y: Math.round(d.h * 0.12), w: d.w - 2 * side, h: Math.round(d.h * 0.7) };
  return { x: side, y: side, w: d.w - 2 * side, h: d.h - 2 * side };
}

/** The smallest sizes words may take (of the short side): body 3.2 %, headlines 6 %. */
export const MIN_BODY = 0.032;
export const MIN_HEAD = 0.06;

/**
 * How far apart a scene's beats are, for the time the clip allows (`room`): 1 is the scene's own timing for `base`
 * seconds; a longer clip spaces its beats out (up to `hi`), the pace makes it calmer or quicker. Each move keeps its
 * own length (within its kind's limits); only the beats spread, so a longer clip has more to watch, not slower moves.
 */
export const spread = (c: { room: number; pace: number }, base: number, hi = 2.2): number => Math.max(0.9, Math.min(hi, (c.room / base) * c.pace, c.room / base));

/** How much slower (> 1) or quicker the pace is. */
export const paceOf = (controls: Recipe["controls"]): number => (controls?.pace === "calm" ? 1.2 : controls?.pace === "punchy" ? 0.82 : 1);

/** An event, its length held to its kind's limits. */
export function ev(id: string, kind: EventKind, start: number, dur: number, c: CurveName, g?: { group: string; unit: StaggerUnit }): MotionEvent {
  const [lo, hi] = DURATION_LIMITS[kind];
  return { id, kind, start: Math.round(start * 1e6) / 1e6, dur: Math.round(Math.min(hi, Math.max(lo, dur)) * 1e6) / 1e6, curve: c, ...(g && { group: g.group, unit: g.unit }) };
}

/** A text block set as typed (layoutText) and placed: centred on `cx`, or flush from `left` across `width`. */
export function textBlock(field: string, layout: TextLayout, place: { y: number; color: string; cx?: number; left?: number; width?: number }): TextBlock {
  const width = place.width ?? layout.width;
  return {
    field,
    layout,
    y: place.y,
    color: place.color,
    cx: place.cx ?? (place.left ?? 0) + width / 2,
    ...(place.left !== undefined && { flush: { left: place.left, width } }),
  };
}

/** The words of a typed field with *stars* round the marked ones (paired stars only; every other star is kept). */
export { marked } from "../../marks";

// ---------------------------------------------------------------------------
// The rolling counter (tabular figures)

/** A measure that can also tell whether a face draws old-style figures by default (components/ads/render). */
export type FigureMeasure = Measure & { oldstyle?: (family: string, weight: number) => boolean };

/**
 * The face a number is set in: the heading face, unless its default figures are old-style (Cormorant's "1" sits at
 * x-height and its "8" rises, so "1,284" reads uneven and a rolling count jumps up and down); then the body face, when
 * its figures line up.
 */
export function figureFamily(c: Pick<MarketingContext, "measure" | "theme">, weight: number): string {
  const old = (c.measure as FigureMeasure).oldstyle;
  if (!old?.(c.theme.heading, weight)) return c.theme.heading;
  return old(c.theme.body, weight) ? c.theme.heading : c.theme.body;
}

export interface CounterCell {
  /** The typed character (a digit, or anything else: kept as typed). */
  ch: string;
  digit: number | null;
  /** The typed whitespace before it. */
  gap: string;
  x: number;
  w: number;
}

export interface CounterLayout {
  field: string;
  font: string;
  size: number;
  cells: CounterCell[];
  width: number;
  /** The digits' cell width (the widest figure). */
  figure: number;
  overflow: boolean;
}

/**
 * A stat ("$1,284,000", "38%", "4.9/5") laid out for a rolling count: every figure gets a cell as wide as the widest
 * figure (tabular), everything else its own width, so the count never shifts sideways. Sized to fit `width`, from
 * `max` down to `min`.
 */
export function counterLayout(field: string, typed: string, family: string, weight: number, width: number, max: number, min: number, measure: Measure): CounterLayout {
  const text = typed.trim();
  const chars = [...text];
  let size = max;
  for (;;) {
    const font = `${weight} ${Math.round(size * 100) / 100}px "${family}"`;
    const figure = Math.max(...[..."0123456789"].map((d) => measure(d, font)));
    const cells: CounterCell[] = [];
    let x = 0;
    let gap = "";
    for (const ch of chars) {
      if (/\s/.test(ch)) {
        gap += ch;
        x += measure(" ", font);
        continue;
      }
      const digit = /[0-9]/.test(ch) ? Number(ch) : null;
      const w = digit === null ? measure(ch, font) : figure;
      cells.push({ ch, digit, gap, x, w });
      gap = "";
      x += w;
    }
    const fits = x <= width;
    if (fits || size <= min) return { field, font, size, cells, width: x, figure, overflow: !fits };
    size = Math.max(min, size * 0.95);
  }
}

/**
 * The counter at progress `p` (0: every figure at 0; 1: the typed stat): each figure rolls up through its digits in
 * its own cell (the right-hand figures roll further, as an odometer's), clipped to the cell; everything else stands.
 */
export function counterNode(c: CounterLayout, left: number, top: number, fill: string, p: number): DisplayNode {
  const runs: TextRun[] = [];
  const clips: DisplayNode[] = [];
  const figures = c.cells.filter((x) => x.digit !== null).length;
  let k = 0;
  const lineH = c.size * 1.18;
  for (const cell of c.cells) {
    const x = left + cell.x;
    if (cell.digit === null) {
      runs.push({ text: cell.ch, gap: cell.gap, font: c.font, x, y: top, fill });
      continue;
    }
    const i = k++;
    const laps = Math.min(1, i);
    const span = cell.digit + 10 * laps;
    // The left-hand figures land first; the last one lands at p = 1.
    const q = curve("glide")(local(p, 0, figures > 1 ? 0.7 + (0.3 * i) / (figures - 1) : 1));
    const v = span * q;
    const base = Math.floor(v + 1e-9);
    const f = v - base;
    if (f < 1e-6) {
      runs.push({ text: String(base % 10), gap: cell.gap, font: c.font, x, y: top, fill });
      continue;
    }
    const cellRuns: TextRun[] = [
      { text: String(base % 10), gap: cell.gap, font: c.font, x, y: top - f * lineH, fill },
      { text: String((base + 1) % 10), gap: "", font: c.font, x, y: top + (1 - f) * lineH, fill },
    ];
    clips.push(group([{ type: "text", field: c.field, runs: cellRuns }], { clip: { type: "rect", x: x - c.size * 0.05, y: top - c.size * 0.08, w: cell.w + c.size * 0.1, h: c.size * 1.16 } }));
  }
  // Every figure in its place: one text node, the typed stat exactly.
  if (!clips.length) return { type: "text", field: c.field, runs };
  return group([{ type: "text", field: c.field, runs }, ...clips]);
}

/** Each figure centred in its cell: the counter's runs, shifted per figure. */
export function centreFigures(c: CounterLayout, measure: Measure): CounterLayout {
  return {
    ...c,
    cells: c.cells.map((cell) => (cell.digit === null ? cell : { ...cell, x: cell.x + (c.figure - measure(cell.ch, c.font)) / 2 })),
  };
}

// ---------------------------------------------------------------------------
// The scene wrapper

export interface MarketingContext {
  recipe: Recipe;
  input: SceneInput;
  measure: Measure;
  design: { w: number; h: number };
  /** The short side (1080). */
  S: number;
  safe: { x: number; y: number; w: number; h: number };
  theme: AdTheme;
  palette: Palette;
  /** > 1: calmer. */
  pace: number;
  /** Everything is set by then (the last second holds). */
  room: number;
  /** The last frame's time. */
  last: number;
  wide: boolean;
  tall: boolean;
  /** A typed field (trimmed), or the fallback. */
  field(key: string, fallback?: string): string;
}

export interface Built {
  events: MotionEvent[];
  background?: string;
  overflow: string[];
  /** What is drawn at `t` (P: an event's eased progress, L: its plain progress). Under and over stay out of the camera. */
  frame(t: number, P: (id: string) => number, L: (id: string) => number): { under?: DisplayNode[]; nodes: DisplayNode[]; over?: DisplayNode[] };
  /** The scene's own camera at `t`: zoom about the middle, then a pan (design units). Home (1, 0, 0) on the last frame. */
  camera?: (t: number) => { zoom: number; x: number; y: number; roll?: number };
  cuts?: number[];
  signature?: number;
  /** The whole clip's slow breath in (default on); a scene with its own resolve turns it off. */
  breath?: boolean;
  /** The ground's slow light (default on). */
  light?: boolean;
}

/**
 * The ground's light: a soft pool of light that drifts slowly across the frame the whole clip long and comes to rest
 * on the last frame (high and a little off centre), over a gentle falloff to the corners, so a flat ground has depth
 * and the frame never stands quite still. On a dark ground the light is the brand's own colour.
 */
function groundLight(c: MarketingContext): (t: number) => DisplayNode[] {
  const { design, palette: pal, last } = c;
  const R = Math.max(design.w, design.h) * 0.85;
  const dark = pal.look === "dark";
  const tone = dark ? pal.mark : "#ffffff";
  const a = dark ? 0.22 : pal.look === "brand" ? 0.2 : 0.55;
  const corner = shadowOf(pal.ground, dark ? 0.35 : pal.look === "brand" ? 0.22 : 0.07);
  const vignette: DisplayNode = { type: "rect", x: 0, y: 0, w: design.w, h: design.h, fill: { kind: "radial", cx: design.w / 2, cy: design.h * 0.42, r0: Math.min(design.w, design.h) * 0.35, r1: Math.hypot(design.w, design.h) * 0.62, stops: [{ at: 0, color: shadowOf(pal.ground, 0) }, { at: 1, color: corner }] } };
  const drift = curve("drift");
  return (t) => {
    const u = drift(last > 0 ? Math.min(1, Math.max(0, t / last)) : 1);
    const lx = design.w * (0.3 + 0.24 * u);
    const ly = design.h * (0.22 + 0.12 * u);
    return [
      { type: "rect", x: 0, y: 0, w: design.w, h: design.h, fill: { kind: "radial", cx: lx, cy: ly, r0: 0, r1: R, stops: [{ at: 0, color: withAlpha(tone, a) }, { at: 0.5, color: withAlpha(tone, a * 0.3) }, { at: 1, color: withAlpha(tone, 0) }] } },
      vignette,
    ];
  };
}

export interface MarketingSceneDef {
  id: string;
  name: string;
  durations?: { min: number; max: number; default: number };
  /** The look when the recipe doesn't choose. */
  look?: LookId;
  build(c: MarketingContext): Built;
}

/** 5 to 8 seconds: the beats spread over the length, so a longer clip never just holds still for longer. */
export const MARKETING_DURATIONS = { min: 5, max: 8, default: 5 } as const;
export const MARKETING_SIZES: SizeSpec[] = ["9:16", "1:1", "16:9", "4:5"];

/** The whole clip breathes in by this much and comes to rest on the last frame. */
const BREATH = 0.025;

export function marketingScene(def: MarketingSceneDef): Scene {
  return {
    id: def.id,
    name: def.name,
    durations: def.durations ?? MARKETING_DURATIONS,
    sizes: MARKETING_SIZES,
    plan(input: SceneInput): ScenePlan {
      const recipe = input.recipe;
      const design = designSize(recipe.size);
      const S = Math.min(design.w, design.h);
      const theme = themeFrom({ colors: recipe.brand.colors, fonts: recipe.brand.fonts });
      const lookId = (["light", "dark", "brand"] as const).find((l) => l === recipe.controls?.look) ?? def.look ?? "light";
      const last = (frameCount(recipe.duration, recipe.fps) - 1) / recipe.fps;
      const ctx: MarketingContext = {
        recipe,
        input,
        measure: input.measure,
        design,
        S,
        safe: safeArea(design),
        theme,
        palette: paletteFor(lookId, theme, recipe.brand.colors),
        pace: paceOf(recipe.controls),
        room: Math.max(1.5, recipe.duration - 1.3),
        last,
        wide: design.w / design.h > 1.2,
        tall: design.h / design.w > 1.5,
        field: (key, fallback = "") => (recipe.fields[key] ?? fallback).trim(),
      };
      const built = def.build(ctx);
      const tl: Timeline = timeline(built.events);
      const settled = Math.min(last, built.events.filter((e) => e.kind !== "camera").reduce((m, e) => Math.max(m, e.start + e.dur), 0));
      const drift = curve("drift");
      const P = (t: number) => (id: string) => {
        const e = tl.byId.get(id);
        return e ? curve(e.curve)(local(t, e.start, e.start + e.dur)) : 1;
      };
      const L = (t: number) => (id: string) => {
        const e = tl.byId.get(id);
        return e ? local(t, e.start, e.start + e.dur) : 1;
      };
      const cx = design.w / 2;
      const cy = design.h / 2;
      const glow = built.background || built.light === false ? () => [] : groundLight(ctx);
      const draw = (t: number, home: boolean): DisplayList => {
        const f = built.frame(t, P(t), L(t));
        let nodes = f.nodes;
        if (!home) {
          const cam = built.camera?.(t) ?? { zoom: 1, x: 0, y: 0 };
          const z = (built.breath === false ? 1 : 1 - BREATH + BREATH * drift(last > 0 ? Math.min(1, t / last) : 1)) * cam.zoom;
          const m = multiply(translate(cam.x, cam.y), about(cx, cy, z, cam.roll ?? 0));
          nodes = [group(nodes, { id: "camera", transform: m })];
        }
        return { w: design.w, h: design.h, background: built.background ?? ctx.palette.ground, nodes: [...glow(t), ...(f.under ?? []), ...nodes, ...(f.over ?? [])] };
      };
      const still = draw(last, true);
      return {
        design,
        timeline: tl,
        rest: last,
        settled,
        ...(built.signature !== undefined && { signature: Math.min(last, built.signature) }),
        cuts: built.cuts ?? [],
        overflow: built.overflow,
        evaluate: (t) => (t >= last ? still : draw(Math.max(0, t), false)),
        still: (t) => t >= last,
      };
    },
  };
}

/** Lay out a field (layoutText with the kit's font), or null when it's empty. */
export function setText(c: MarketingContext, text: string, o: { family?: "heading" | "body" | "figures"; weight: number; width: number; maxLines: number; max: number; min: number; lineHeight?: number; letters?: boolean; even?: number }): TextLayout | null {
  if (!text.trim()) return null;
  // "figures": the heading face, unless its figures are old-style and the words hold a figure (then the body face).
  const family = o.family === "body" ? c.theme.body : o.family === "figures" && /\p{Nd}/u.test(text) ? figureFamily(c, o.weight) : c.theme.heading;
  // Lines kept even by default (no lone word left on a line).
  return layoutText({ text, family, weight: o.weight, width: o.width, maxLines: o.maxLines, max: o.max, min: o.min, lineHeight: o.lineHeight, letters: o.letters, even: o.even ?? 0.5 }, c.measure);
}

/** A picture fitted inside a box (contain), centred, its foot on the box's bottom when `ground`. */
export function fitBox(img: { w: number; h: number }, box: { x: number; y: number; w: number; h: number }, ground = false): { x: number; y: number; w: number; h: number } {
  const s = Math.min(box.w / img.w, box.h / img.h);
  const w = img.w * s;
  const h = img.h * s;
  return { x: box.x + (box.w - w) / 2, y: ground ? box.y + box.h - h : box.y + (box.h - h) / 2, w, h };
}

/** A soft contact shadow under a picture standing at `foot`: a round falloff squashed flat. */
export function contactShadow(cx: number, foot: number, width: number, ground: string, strength = 0.34, opacity = 1): DisplayNode {
  const r = width * 0.46;
  const stops = [
    { at: 0, color: shadowOf(ground, strength) },
    { at: 0.45, color: shadowOf(ground, strength * 0.45) },
    { at: 1, color: shadowOf(ground, 0) },
  ];
  const disc: DisplayNode = { type: "ellipse", cx, cy: foot, rx: r, ry: r, fill: { kind: "radial", cx, cy: foot, r0: 0, r1: r, stops } };
  return group([disc], { transform: about(cx, foot, 1, 0, 0.14), ...(opacity < 1 && { opacity }) });
}

/** An n-pointed star (or a burst: many points, a high inner ratio) round (cx, cy) as path data. */
export function starPath(cx: number, cy: number, outer: number, inner: number, points: number, rot = -Math.PI / 2): string {
  const parts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = rot + (i * Math.PI) / points;
    parts.push(`${i ? "L" : "M"}${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`);
  }
  return `${parts.join("")}Z`;
}

/** A shade of `c` for a shadow on `ground` (deeper and see-through). */
export const shadowOf = (ground: string, a = 0.28) => {
  const deep = mixHex(ground, "#000000", luminance(ground) > 0.3 ? 0.55 : 0.75);
  const h = deep.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

/** The picture a scene shows: the product when there is one, else the logo (null: neither). */
export function heroOf(c: MarketingContext): { src: "product" | "logo"; w: number; h: number } | null {
  const product = c.recipe.media?.product ? c.input.images?.product : undefined;
  if (product && product.w > 0 && product.h > 0) return { src: "product", ...product };
  if (c.input.logo) return { src: "logo", w: c.input.logo.w, h: c.input.logo.h };
  return null;
}

/**
 * The brand's sign-off: its logo (a wide lockup at most `maxW` wide, at most `h` tall), else its name set in the
 * heading face. `draw` places it centred on `cx` with its top at `top`, settling up into place as `p` runs to 1.
 */
export interface BrandMark {
  w: number;
  h: number;
  overflow: boolean;
  draw(cx: number, top: number, p: number, lin: number, color?: string): DisplayNode[];
}

/**
 * Fuobe's own sample marks (the showcase brands' lockups, /previews/…) are drawn in one colour, so a scene sets them in
 * the look's ink; a person's own logo is always drawn as it is.
 */
export const sampleMark = (c: Pick<MarketingContext, "recipe">): boolean => !!c.recipe.brand.logo?.startsWith("/previews/");

/** The logo in a box: as it is, or (a sample mark) in `color`. */
export function logoNode(c: Pick<MarketingContext, "recipe">, box: { x: number; y: number; w: number; h: number }, color: string): DisplayNode {
  const img: DisplayNode = { type: "image", src: "logo", ...box };
  if (!sampleMark(c)) return img;
  const pad = 2;
  return group([img, group([{ type: "rect", x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad, fill: color }], { blend: "source-atop" })], { isolate: { x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad } });
}

export function brandMark(c: MarketingContext, o: { maxW: number; h: number; color: string; minName?: number }): BrandMark | null {
  const logo = c.input.logo;
  const rise = (p: number, lin: number, children: DisplayNode[]): DisplayNode[] => (lin <= 0 ? [] : p >= 1 && lin >= 1 ? children : [group(children, { transform: translate(0, (1 - p) * c.S * 0.025), ...(lin < 0.45 && { opacity: lin / 0.45 }) })]);
  if (logo && logo.w > 0 && logo.h > 0) {
    const s = Math.min(o.maxW / logo.w, o.h / logo.h);
    const w = logo.w * s;
    const h = logo.h * s;
    return { w, h, overflow: false, draw: (cx, top, p, lin, color) => rise(p, lin, [logoNode(c, { x: cx - w / 2, y: top, w, h }, color ?? o.color)]) };
  }
  const name = setText(c, c.recipe.brand.name, { weight: 700, width: o.maxW, maxLines: 1, max: o.h * 0.82, min: c.S * (o.minName ?? MIN_BODY) });
  if (!name) return null;
  return {
    w: name.width,
    h: name.height,
    overflow: name.overflow,
    draw: (cx, top, p, lin, color) => rise(p, lin, [lineRuns(textBlock("brand", name, { y: top, color: color ?? o.color, cx }))]),
  };
}

/**
 * A slow float that keeps a held piece alive and is exactly still at `from` and at `to` (the last frame): one gentle
 * rise and fall over the hold (`n` of them), in design units, and a turn in radians.
 */
export function holdFloat(t: number, from: number, to: number, amp: number, turn = 0, n = 1): { dy: number; roll: number } {
  if (to - from < 0.5 || t <= from || t >= to) return { dy: 0, roll: 0 };
  const u = (t - from) / (to - from);
  const s = Math.sin(Math.PI * n * u);
  // Eased in and out at both ends, so it starts and stops without a kick.
  const env = Math.sin(Math.PI * u);
  return { dy: -amp * s * env, roll: turn * Math.sin(Math.PI * 2 * u) * env };
}

/** A block's lines, each rising out of its own line box (`p(i)`: line i's progress); whole lines once in place. */
export function risingLines(b: TextBlock, p: (i: number) => number, shift?: (i: number) => number): DisplayNode[] {
  const L = b.layout;
  const out: DisplayNode[] = [];
  L.lines.forEach((line, i) => {
    const q = p(i);
    if (q <= 0) return;
    const dx = shift?.(i) ?? 0;
    if (q >= 1) return void out.push(lineRun(b, i, dx ? { dx } : undefined));
    const top = b.y + i * L.lineHeight;
    out.push(group([lineRun(b, i, { dx, dy: (1 - q) * L.lineHeight })], { clip: { type: "rect", x: lineLeft(b, i) + dx - L.size * 0.25, y: top - L.size * 0.1, w: line.width + L.size * 0.5, h: L.lineHeight + L.size * 0.2 } }));
  });
  return out;
}

/** A picture revealed from the bottom up with a soft edge (`p` 0: hidden, 1: whole). */
export function riseReveal(children: DisplayNode[], box: { x: number; y: number; w: number; h: number }, p: number, feather: number): DisplayNode {
  if (p >= 1) return group(children);
  const edge = box.y + box.h + feather - (box.h + 2 * feather) * p;
  return group(children, {
    mask: { kind: "linear", x0: 0, y0: edge + feather, x1: 0, y1: edge, stops: [{ at: 0, color: "rgba(0,0,0,1)" }, { at: 1, color: "rgba(0,0,0,0)" }], bounds: { x: box.x - feather, y: box.y - feather, w: box.w + 2 * feather, h: box.h + 2 * feather } },
  });
}

/** Points along a traced outline (its curve ends and handles), placed in design units over the picture's box. */
export function outlinePoints(outline: Outline, box: { x: number; y: number; w: number; h: number }): [number, number][] {
  const n = (outline.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const k = box.w / outline.w;
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push([box.x + n[i] * k, box.y + n[i + 1] * k]);
  return out;
}

/** Whether (x, y) is inside a closed polygon (even-odd). */
export function insidePolygon(pts: readonly [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** How much of a disc (cx, cy, r) lies over the shape (0 to 1), sampled on a small grid. */
export function discCover(pts: readonly [number, number][], cx: number, cy: number, r: number): number {
  let hit = 0;
  let all = 0;
  for (let gy = -4; gy <= 4; gy++)
    for (let gx = -4; gx <= 4; gx++) {
      const x = cx + (gx / 4) * r;
      const y = cy + (gy / 4) * r;
      if (Math.hypot(x - cx, y - cy) > r) continue;
      all++;
      if (insidePolygon(pts, x, y)) hit++;
    }
  return all ? hit / all : 0;
}

export interface BadgeSpot {
  cx: number;
  cy: number;
  r: number;
  /** How much of the badge lies over the product (0: clear of it). */
  cover: number;
}

/**
 * Where a round badge sits by a product so it covers the least of it: of the spots round the picture's upper corners
 * and sides (and just past them, inside `bounds`), the one with the least of the badge over the product's outline
 * (point in polygon, so a spot inside the shape never counts as clear), nearer the top when two tie. The badge is sized
 * to the product (its radius at most `maxShare` of the product's width, never more than `r`), and shrinks (down to 70 %) while every spot
 * still covers the product. A photo without an outline: its upper right corner, overlapping by a third.
 */
export function badgeSpot(img: { x: number; y: number; w: number; h: number }, outline: Outline | null, r: number, bounds: { x: number; y: number; w: number; h: number }, maxShare = 0.45): BadgeSpot {
  const R0 = Math.min(r, Math.max(r * 0.7, img.w * maxShare));
  const clampIn = (x: number, y: number, rr: number): [number, number] => [Math.min(bounds.x + bounds.w - rr, Math.max(bounds.x + rr, x)), Math.min(bounds.y + bounds.h - rr, Math.max(bounds.y + rr, y))];
  if (!outline) {
    const [cx, cy] = clampIn(img.x + img.w - R0 * 0.35, img.y + R0 * 0.35, R0);
    return { cx, cy, r: R0, cover: 0.5 };
  }
  const pts = outlinePoints(outline, img);
  let best = null as BadgeSpot | null;
  // Spots round the picture's top and sides: from a badge's width beyond its left edge to as far beyond its right,
  // from just over its top to its middle, kept inside the bounds.
  const score = (s: BadgeSpot) => {
    // Less cover first; then nearer the product (it reads as its badge), nearer the top, and the larger badge.
    const gx = Math.max(0, img.x - s.cx, s.cx - (img.x + img.w)) / Math.max(1, s.r);
    return s.cover * 10 + gx * 0.35 + ((s.cy - img.y) / Math.max(1, img.h)) * 0.6 - s.r / r;
  };
  for (let rr = R0; rr >= r * 0.7 - 1e-6; rr -= r * 0.1) {
    for (let i = 0; i <= 8; i++) {
      for (const fy of [-0.04, 0.08, 0.2, 0.34, 0.48]) {
        const [cx, cy] = clampIn(img.x - rr * 1.1 + ((img.w + rr * 2.2) * i) / 8, img.y + img.h * fy + (fy < 0 ? -rr * 0.3 : 0), rr);
        const spot = { cx, cy, r: rr, cover: discCover(pts, cx, cy, rr) };
        if (!best || score(spot) < score(best)) best = spot;
      }
    }
    if (best && best.cover <= 0.04) break;
  }
  return best!;
}
