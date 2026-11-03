/**
 * The logo end card, shared by its five animated styles (pure). The card at rest is one centred stack on the brand
 * colour: the logo (or the brand's name), the product's name, the call-to-action pill and the shop's address under it,
 * in the kit's own colours. That rest layout is also the still card's (components/marketing/end-card.ts), so the
 * poster, the still and the last frame of every style are the same picture. Each style is a timeline of cues written
 * for a 2.5 s card (readable by about 0.9 s) and scaled to the card's length, and a frame function that moves the rest
 * layout's pieces. Through the hold a slow push-in keeps the card alive and comes to rest on the last frame.
 */

import { contrast, fontString, luminance, readableOn, themeFrom, type AdTheme } from "@/components/ads/layout";
import { about, group, mixHex, multiply, translate, type DisplayList, type DisplayNode, type Matrix, type TextNode, type TextRun } from "../../display";
import { curve } from "../../ease";
import { layoutText, type Measure, type TextLayout } from "../../layout";
import type { Recipe } from "../../recipe";
import type { LogoInfo, Scene, SceneInput, ScenePlan } from "../../scene";
import { designSize, TILE_CHIPS, tileCover } from "../../sizes";
import { frameCount } from "../../time";
import { timeline, scaleCues, type Cue, type Timeline } from "../../tween";
import { extraCamera, kineticTiming } from "../../edit";
import { finishAt } from "../../finish";

export const END_CARD_VARIANTS = ["draw-on", "rise", "iris", "split", "glint"] as const;
export type EndCardVariant = (typeof END_CARD_VARIANTS)[number];

export const END_CARD_VARIANT_NAMES: Record<EndCardVariant, string> = { "draw-on": "Draw-on", rise: "Rise", iris: "Iris", split: "Split", glint: "Glint" };

/** The card's lengths (seconds), as Click to Ad's end card allows. */
export const END_CARD_DURATIONS = { min: 2, max: 5, default: 2.5 } as const;

export interface EndCardContent {
  /** Shown when there is no logo. */
  brand: string;
  product: string;
  cta?: string;
  website?: string;
}

export interface TextBlock {
  field: string;
  layout: TextLayout;
  /** The block's centre line and the top of its first line. */
  cx: number;
  y: number;
  color: string;
  /** Set flush to one side instead of centred: lines start at `left` (a right-to-left line ends at left + width). */
  flush?: { left: number; width: number };
}

export interface EndCardRest {
  w: number;
  h: number;
  /** The side margin and the width text may take. */
  margin: number;
  inner: number;
  theme: AdTheme;
  /** The words' colour on the brand colour (a kit colour that reads on it, else white or near-black). */
  ink: string;
  logo?: { x: number; y: number; w: number; h: number };
  brand?: TextBlock;
  headline: TextBlock;
  cta?: { x: number; y: number; w: number; h: number; r: number; color: string; label: TextBlock };
  site?: TextBlock;
  /** Fields that don't fit at their smallest size (or a stack too tall for the frame). */
  overflow: (keyof EndCardContent)[];
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The card's colours from the kit: the words and the pill in the kit colour that reads best on the brand colour (at
 * least 4.5:1), the pill's label in the brand colour; white or near-black only when no kit colour reads.
 */
export function cardColours(theme: AdTheme, colors: readonly string[]): { ink: string; pill: string; label: string } {
  const accent = theme.accent.toLowerCase();
  const best = colors
    .filter((c) => HEX.test(c) && c.toLowerCase() !== accent)
    .map((c) => ({ c, k: contrast(c, theme.accent) }))
    .sort((a, b) => b.k - a.k)[0];
  const ink = best && best.k >= 4.5 ? best.c : theme.onAccent;
  return { ink, pill: ink, label: contrast(theme.accent, ink) >= 3 ? theme.accent : readableOn(ink) };
}

/**
 * Where everything goes on the card (the still card's own layout): one centred stack (logo or name, product, CTA,
 * address) a little above the middle. Type, the pill and the margins follow the frame's short side, so a wide card
 * sets the same sizes as a tall one; a tall card keeps its foot clear (where phone apps put their buttons and
 * captions). Text is set as typed (layoutText); a stack too tall for the frame is reported, never squeezed.
 */
export function endCardRest(p: { theme: AdTheme; content: EndCardContent; logo: { w: number; h: number } | null; measure: Measure; size: { w: number; h: number }; letters?: boolean; colors?: readonly string[]; clear?: { top: number; bottom: number } }): EndCardRest {
  const { w: W, h: H } = p.size;
  const t = p.theme;
  const S = Math.min(W, H);
  // The vertical unit: the height, up to a 9:16 card's.
  const V = Math.min(H, (S * 16) / 9);
  const m = Math.round(S * 0.1);
  const inner = Math.min(W - 2 * m, Math.round(S * 1.1));
  const { ink, pill, label: labelColour } = cardColours(t, p.colors ?? []);
  const gap = V * 0.04;
  // The mark is the hero: the logo as wide as the margins allow (up to a fifth of the height), or the name huge.
  const logoH = V * 0.2;
  const letters = p.letters ?? true;
  const brandText = p.content.brand.trim();
  // One line where it fits (a name is never broken for size), two only when it must.
  const name1 = !p.logo && brandText ? layoutText({ text: brandText, family: t.heading, weight: 800, width: inner, maxLines: 1, max: S * 0.16, min: S * 0.07, lineHeight: 1.05, letters }, p.measure) : null;
  const name = name1 && name1.overflow ? layoutText({ text: brandText, family: t.heading, weight: 800, width: inner, maxLines: 2, max: S * 0.16, min: S * 0.06, lineHeight: 1.05, letters }, p.measure) : name1;
  // The product's line about half the mark's size, the call to action a hairline-outlined tag about half of that.
  const head = layoutText({ text: p.content.product, family: t.heading, weight: 600, width: inner, maxLines: 2, max: S * 0.066, min: S * 0.04, letters }, p.measure);
  const ctaSize = S * 0.036;
  const ctaText = p.content.cta?.trim();
  const label = ctaText ? layoutText({ text: ctaText, family: t.body, weight: 600, width: inner - ctaSize * 2.4, maxLines: 1, max: ctaSize, min: S * 0.026 }, p.measure) : null;
  const siteText = p.content.website?.trim();
  const site = siteText ? layoutText({ text: siteText, family: t.body, weight: 500, width: inner, maxLines: 1, max: S * 0.028, min: S * 0.022 }, p.measure) : null;
  const ctaH = label ? label.size * 2.2 : 0;
  const top = p.logo ? logoH : name ? name.lines.length * name.size * 1.05 : 0;
  const headH = head.lines.length * head.size * 1.12;
  const siteH = site ? site.size * 1.12 : 0;
  const siteGap = gap * 0.9;
  const above = top + (top ? gap : 0) + headH + (label ? gap * 1.4 + ctaH : 0);
  const total = above + (site ? (above ? siteGap : 0) + siteH : 0);
  let y = (H - total) / 2 - V * 0.03;
  // A tall card keeps its bottom fifth clear.
  if (H / W > 1.5) y = Math.min(y, H * 0.8 - total);
  // Where the stack may go: inside the margins, and clear of what lies over the card (a gallery tile's chips).
  const lo = Math.max(m, p.clear?.top ?? 0);
  const hi = H - Math.max(m, p.clear?.bottom ?? 0);
  if (p.clear) y = Math.max(lo, Math.min(y, hi - total));
  const fits = y >= lo - 0.5 && y + total <= hi + 0.5;
  y = Math.max(lo, y);

  let logo: EndCardRest["logo"];
  let brand: TextBlock | undefined;
  if (p.logo) {
    // Contained in the logo's band, centred.
    const s = Math.min(inner / p.logo.w, logoH / p.logo.h);
    const fw = p.logo.w * s;
    const fh = p.logo.h * s;
    logo = { x: (W - fw) / 2, y: y + (logoH - fh) / 2, w: fw, h: fh };
    y += logoH + gap;
  } else if (name) {
    brand = { field: "brand", layout: name, cx: W / 2, y, color: ink };
    y += top + gap;
  }
  const headline: TextBlock = { field: "product", layout: head, cx: W / 2, y, color: ink };
  y += headH;
  let cta: EndCardRest["cta"];
  if (label) {
    y += gap * 1.4;
    const bw = Math.min(inner, label.width + label.size * 2.4);
    const bx = (W - bw) / 2;
    // A hairline-outlined tag in the words' colour, its label in the same colour on the brand colour.
    void labelColour;
    cta = { x: bx, y, w: bw, h: ctaH, r: ctaH / 2, color: pill, label: { field: "cta", layout: label, cx: bx + bw / 2, y: y + (ctaH - label.size * 1.12) / 2, color: ink } };
    y += ctaH;
  }
  const siteBlock: TextBlock | undefined = site ? { field: "website", layout: site, cx: W / 2, y: y + (above ? siteGap : 0), color: ink } : undefined;
  const overflow: (keyof EndCardContent)[] = [];
  if (name?.overflow) overflow.push("brand");
  if (head.overflow) overflow.push("product");
  if (label?.overflow) overflow.push("cta");
  if (site?.overflow) overflow.push("website");
  // Every field fits but the stack doesn't: the field that takes two lines is the one to shorten.
  if (!fits && !overflow.length) overflow.push(name && name.lines.length > 1 && head.lines.length < 2 ? "brand" : "product");
  return { w: W, h: H, margin: m, inner, theme: t, ink, logo, brand, headline, cta, site: siteBlock, overflow };
}

// ---------------------------------------------------------------------------
// Text runs

/** Where line `i` of a block is drawn: its left edge and the top of its glyphs (as the still card's drawText). */
export const lineLeft = (b: TextBlock, i: number) => {
  const w = b.layout.lines[i].width;
  if (!b.flush) return b.cx - w / 2;
  return b.layout.dir === "rtl" ? b.flush.left + b.flush.width - w : b.flush.left;
};
export const glyphTop = (b: TextBlock, i: number) => b.y + i * b.layout.lineHeight + (b.layout.lineHeight - b.layout.size) / 2;

export interface RunStyle {
  dx?: number;
  dy?: number;
  opacity?: number;
  scale?: number;
}

function styled(run: TextRun, s: RunStyle | undefined, w: number, size: number): TextRun {
  if (!s) return run;
  const out = { ...run, x: run.x + (s.dx ?? 0), y: run.y + (s.dy ?? 0) };
  if (s.opacity !== undefined && s.opacity < 1) out.opacity = Math.max(0, s.opacity);
  if (s.scale !== undefined && s.scale !== 1) out.transform = about(out.x + w / 2, out.y + size / 2, s.scale);
  return out;
}

/** The block line by line. */
export function lineRuns(b: TextBlock, each?: (line: number) => RunStyle): TextNode {
  const L = b.layout;
  return {
    type: "text",
    field: b.field,
    runs: L.lines.map((l, i) => styled({ text: l.text, gap: l.gap, font: L.font, x: lineLeft(b, i), y: glyphTop(b, i), fill: b.color, ...(L.dir === "rtl" && { dir: "rtl" as const }) }, each?.(i), l.width, L.size)),
  };
}

/** One line of a block on its own. */
export function lineRun(b: TextBlock, i: number, style?: RunStyle): TextNode {
  const L = b.layout;
  const l = L.lines[i];
  return { type: "text", field: b.field, runs: [styled({ text: l.text, gap: l.gap, font: L.font, x: lineLeft(b, i), y: glyphTop(b, i), fill: b.color, ...(L.dir === "rtl" && { dir: "rtl" as const }) }, style, l.width, L.size)] };
}

/** The block word by word; `each` gets the word's line, its index in the block and the block's word count. */
export function wordRuns(b: TextBlock, each: (line: number, word: number, count: number) => RunStyle): TextNode {
  const L = b.layout;
  const count = L.lines.reduce((n, l) => n + l.words.length, 0);
  let k = 0;
  const runs: TextRun[] = [];
  L.lines.forEach((l, i) => {
    const left = lineLeft(b, i);
    const top = glyphTop(b, i);
    for (const w of l.words) runs.push(styled({ text: w.text, gap: w.gap, font: L.font, x: left + w.x, y: top, fill: b.color, ...(L.dir === "rtl" && { dir: "rtl" as const }) }, each(i, k++, count), w.w, L.size));
  });
  return { type: "text", field: b.field, runs };
}

/**
 * The block letter by letter (grapheme clusters), with `spacing` extra units between letters (kept centred). A line
 * whose letters join (a joining script, or a pair a font ligates) goes word by word instead, with the spacing between
 * words. At spacing 0 every piece sits exactly where the whole line draws it (layout.ts keeps the kerning).
 */
export function letterRuns(b: TextBlock, each: (letter: number, count: number) => RunStyle, spacing = 0): TextNode {
  const L = b.layout;
  const pieces = L.lines.map((l) => l.graphemes ?? l.words);
  const count = pieces.reduce((n, p) => n + p.length, 0);
  let k = 0;
  const runs: TextRun[] = [];
  L.lines.forEach((l, i) => {
    const ps = pieces[i];
    const left = lineLeft(b, i) - ((ps.length - 1) * spacing) / 2;
    const top = glyphTop(b, i);
    ps.forEach((p, j) => {
      runs.push(styled({ text: p.text, gap: p.gap, font: L.font, x: left + p.x + j * spacing, y: top, fill: b.color, ...(L.dir === "rtl" && { dir: "rtl" as const }) }, each(k++, count), p.w, L.size));
    });
  });
  return { type: "text", field: b.field, runs };
}

// ---------------------------------------------------------------------------
// The rest frame

/** The logo as drawn at rest. */
export const logoImage = (r: NonNullable<EndCardRest["logo"]>, opacity = 1): DisplayNode => ({ type: "image", id: "logo", src: "logo", x: r.x, y: r.y, w: r.w, h: r.h, ...(opacity < 1 && { opacity }) });

/** The call to action's tag: a hairline outline in the words' colour (never a heavy web button). */
export const pillRect = (c: NonNullable<EndCardRest["cta"]>): DisplayNode => ({ type: "rect", id: "cta.pill", x: c.x, y: c.y, w: c.w, h: c.h, r: c.r, fill: "rgba(0,0,0,0)", stroke: { paint: c.color, width: Math.max(1.5, c.h * 0.035) } });

/** The card at rest: what the still card draws, in the same order. */
export function restNodes(r: EndCardRest): DisplayNode[] {
  const nodes: DisplayNode[] = [];
  if (r.logo) nodes.push(logoImage(r.logo));
  if (r.brand) nodes.push(lineRuns(r.brand));
  if (r.headline.layout.lines.length) nodes.push(lineRuns(r.headline));
  if (r.cta) nodes.push(pillRect(r.cta), lineRuns(r.cta.label));
  if (r.site) nodes.push(lineRuns(r.site));
  return nodes;
}

/**
 * The light the card sits in (the still card draws it too): a soft pool of light high in the middle, the corners
 * falling away into a deeper shade of the brand colour, a faint glow behind the mark, fine rings opening from one
 * corner and a fine grain, so the ground is never a flat fill. Behind it the brand's name runs in rows of giant
 * tonal type cropped by the edges, and a hairline frame sits inside the margin. Every piece is a gradient, a hairline or
 * a faint tone: the words' colours read on the brand colour as before.
 */
export function cardField(r: EndCardRest, seed = 7, name = "", drift = 0): DisplayNode[] {
  const { w, h } = r;
  const S = Math.min(w, h);
  const a = r.theme.accent;
  const dark = luminance(a) < 0.18;
  const light = mixHex(a, "#ffffff", dark ? 0.16 : 0.22);
  const deep = mixHex(a, "#000000", dark ? 0.55 : 0.32);
  const mark = markBox(r);
  const mx = mark ? mark.x + mark.w / 2 : w / 2;
  const my = mark ? mark.y + mark.h / 2 : h * 0.4;
  const rgba = (hex: string, al: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${al})`;
  const rows: DisplayNode[] = [];
  const word = name.trim();
  if (word) {
    // One whole word, filled a step lighter than the brand colour (never a hairline), wider than the card's middle and
    // centred, standing on the bottom edge so the edge crops its foot (every letter shows whole across); it drifts by
    // `drift` (design units) while the card plays and sits centred at rest. Its width is estimated from its length
    // (it is decoration: only roughly centred).
    const unit = Math.max(1, [...word].length * 48);
    const foot = r.site ? r.site.y + r.site.layout.height : r.cta ? r.cta.y + r.cta.h : r.headline.y + r.headline.layout.height;
    // Whole: the word is sized to stand in the room under the stack with only the foot of its letters cropped (accents
    // and all), never a cut-off fragment.
    const size = Math.min(S * 0.6, ((w * 0.86) / unit) * 100, Math.max(S * 0.12, (h - foot - S * 0.06) / 0.92));
    const font = fontString(r.theme.heading, size, 700);
    const y0 = Math.max(foot + S * 0.06, h - size * 0.92);
    const width = (unit * size) / 100;
    const tone = mixHex(a, dark ? "#ffffff" : "#000000", dark ? 0.05 : 0.045);
    const runs: TextRun[] = [{ text: word, gap: "", font, x: (w - width) / 2 + drift, y: y0, fill: tone }];
    rows.push({ type: "text", field: "brand", runs, decor: true });
  }
  // A warm orb of the words' own colour behind the mark: one light source the card is lit by.
  const orb = Math.max(S * 0.5, Math.min(w, h) * 0.7);
  return [
    { type: "rect", id: "card.light", x: 0, y: 0, w, h, fill: { kind: "radial", cx: w / 2, cy: h * 0.28, r0: 0, r1: Math.hypot(w, h) * 0.55, stops: [{ at: 0, color: rgba(light, 0.85) }, { at: 0.55, color: rgba(light, 0.18) }, { at: 1, color: rgba(light, 0) }] } },
    { type: "rect", id: "card.corners", x: 0, y: 0, w, h, fill: { kind: "radial", cx: w / 2, cy: h * 0.45, r0: S * 0.4, r1: Math.hypot(w, h) * 0.62, stops: [{ at: 0, color: rgba(deep, 0) }, { at: 1, color: rgba(deep, 0.8) }] } },
    { type: "rect", id: "card.glow", x: mx - orb, y: my - orb, w: orb * 2, h: orb * 2, fill: { kind: "radial", cx: mx, cy: my, r0: 0, r1: orb, stops: [{ at: 0, color: rgba(mixHex(r.ink, "#ffb46b", 0.25), 0.26) }, { at: 0.4, color: rgba(r.ink, 0.1) }, { at: 1, color: rgba(r.ink, 0) }] } },
    ...rows,
    { type: "grain", seed, frame: 0, amount: dark ? 0.035 : 0.045, size: 1.25, blend: dark ? "screen" : "overlay", x: 0, y: 0, w, h },
  ];
}

/** The mark at the top of the block: the logo, else the brand's name, else nothing. */
export const markNodes = (r: EndCardRest): DisplayNode[] => (r.logo ? [logoImage(r.logo)] : r.brand ? [lineRuns(r.brand)] : []);

/** The mark's box (null: no mark). */
export function markBox(r: EndCardRest): { x: number; y: number; w: number; h: number } | null {
  if (r.logo) return r.logo;
  if (r.brand) return { x: r.brand.cx - r.brand.layout.width / 2, y: r.brand.y, w: r.brand.layout.width, h: r.brand.layout.height };
  return null;
}

/** A second brand colour for panels and grounds: the kit's next colour that differs enough, else a deeper accent. */
export function secondColour(colors: readonly string[], accent: string): string {
  const other = colors.find((c) => HEX.test(c) && c.toLowerCase() !== accent.toLowerCase() && contrast(c, accent) >= 1.25);
  return other ?? mixHex(accent, "#000000", 0.32);
}

/**
 * A deep ground under the brand colour (Glint blooms from it): the kit's ink when it stands apart from the accent, else
 * the accent taken down towards black.
 */
export function deepGround(theme: AdTheme): string {
  return contrast(theme.ink, theme.accent) >= 1.8 ? theme.ink : mixHex(theme.accent, "#000000", 0.62);
}

/** A ground a style opens on: the kit's second colour when it stands apart from the brand colour, else the deep ground. */
export function openingGround(theme: AdTheme, second: string): string {
  return contrast(second, theme.accent) >= 1.8 ? second : deepGround(theme);
}

/** A colour's own deeper (or, for a very dark one, lighter) shade: the second of a two-tone pair. */
export const shadeOf = (c: string) => (luminance(c) < 0.05 ? mixHex(c, "#ffffff", 0.14) : mixHex(c, "#000000", 0.22));

/** The logo's outlines placed in its rest box: each path's matrix from its own units to design units. */
export function logoPaths(logo: LogoInfo, box: NonNullable<EndCardRest["logo"]>): { d: string; m: Matrix; length: number; scale: number }[] {
  const vb = logo.viewBox ?? { x: 0, y: 0, w: logo.w, h: logo.h };
  const s = Math.min(box.w / vb.w, box.h / vb.h);
  const place: Matrix = [s, 0, 0, s, box.x + (box.w - vb.w * s) / 2 - vb.x * s, box.y + (box.h - vb.h * s) / 2 - vb.y * s];
  return (logo.paths ?? []).map((p) => {
    const m = multiply(place, p.m);
    return { d: p.d, m, length: p.length, scale: Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1 };
  });
}

// ---------------------------------------------------------------------------
// The scene

/** The card's content and theme from a recipe (fields brand, product, cta, website; the brand's colours and fonts). */
export function endCardFrom(recipe: Recipe): { theme: AdTheme; content: EndCardContent } {
  const f = recipe.fields;
  return {
    theme: themeFrom({ colors: recipe.brand.colors, fonts: recipe.brand.fonts }),
    content: { brand: f.brand ?? recipe.brand.name ?? "", product: f.product ?? "", cta: f.cta || undefined, website: f.website || undefined },
  };
}

/** How much a 2.5 s card's timing is stretched for this length (2 s: × 0.67, 3 s: × 1.33). */
export const timeScale = (duration: number) => Math.max(2 / 3, Math.min(4 / 3, (duration - 1) / 1.5));

/** A style's picture at one time: grounds under the camera, the card's pieces in it, covers over it. */
export interface StyleFrame {
  under?: DisplayNode[];
  nodes: DisplayNode[];
  over?: DisplayNode[];
}

export interface StyleBuild {
  cues: Cue[];
  /** What this style leaves on the card at rest (its own mark of difference), drawn from when it settles. */
  keep?: DisplayNode[];
  /** Whether a band of light crosses the mark once the card has settled (default on). */
  sweep?: boolean;
  /**
   * How far (seconds, on a 2.5 s card) the card is already into its motion on its first frame: the cut from the ad
   * lands on movement, never on an empty frame.
   */
  lead?: number;
  /** A time (seconds, on a 2.5 s card, before the lead) whose frame shows what sets this style apart. */
  signature?: number;
  /** The ground under everything while it moves (the brand colour by default). */
  background?: string;
  frame(t: number, tl: Timeline): StyleFrame;
}

export interface StyleContext {
  rest: EndCardRest;
  input: SceneInput;
  /** The second brand colour. */
  second: string;
}

/** The push-in: the card's pieces start at this scale and reach 1 on the last frame. */
export const CAMERA_FROM = 0.97;

/** One end-card style as a scene: the rest layout, its cues scaled to the card's length, and its frames. */
export function endCardScene(variant: EndCardVariant, build: (c: StyleContext) => StyleBuild): Scene {
  return {
    id: `end-card/${variant}`,
    name: END_CARD_VARIANT_NAMES[variant],
    durations: END_CARD_DURATIONS,
    sizes: [{ w: 720, h: 1280 }, "9:16", "4:5", "1:1", "16:9"],
    plan(input: SceneInput): ScenePlan {
      const design = designSize(input.recipe.size);
      const { theme, content } = endCardFrom(input.recipe);
      // A gallery tile's cover keeps the card clear of the tile's chips.
      const clear = tileCover(input.recipe) ? { top: design.h * TILE_CHIPS.top, bottom: design.h * TILE_CHIPS.bottom } : undefined;
      const rest = endCardRest({ theme, content, logo: input.logo ? { w: input.logo.w, h: input.logo.h } : null, measure: input.measure, size: design, colors: input.recipe.brand.colors, clear });
      const style = build({ rest, input, second: secondColour(input.recipe.brand.colors, theme.accent) });
      const k = timeScale(input.recipe.duration);
      const lead = (style.lead ?? 0) * k;
      // The last frame: the poster, the still card, and where the camera comes home.
      const last = (frameCount(input.recipe.duration, input.recipe.fps) - 1) / input.recipe.fps;
      const cued = scaleCues(style.cues, k).map((e) => ({ ...e, start: e.start - lead }));
      // On its own (Marketing's Logo End Card, not the tail of an ad) the card's beats spread out until it settles at
      // about 70 % of its length; each move keeps its own speed.
      const own = typeof input.recipe.controls?.template === "string";
      const ends = Math.max(0.3, ...cued.map((e) => e.start + e.dur));
      const f = own ? Math.max(1, Math.min(2.4, (last * 0.72) / ends)) : 1;
      const spread = cued.map((e) => ({ ...e, start: Math.round((e.start > 0 ? e.start * f : e.start) * 1e6) / 1e6 }));
      // Kinetic's editor. Inside another scene (the Kinetic Headline's card) only its group timing and feel apply: the
      // camera, the finish and the tracks belong to the outer scene.
      const recipe = input.recipe;
      const template = recipe.controls?.template;
      const nested = typeof template === "string" && template !== "ms-end-card";
      const timing = kineticTiming(recipe, `end-card/${variant}`, spread, [], last);
      const tl = timeline(timing.events, timing.curves);
      const settled = Math.min(last, tl.rest);
      const locked = !nested && recipe.camera?.move === "locked";
      const breath = nested || locked ? (locked ? 0 : 1) : (recipe.camera?.breath ?? 1);
      const extra = nested ? null : extraCamera(recipe, last);
      const clock = nested ? null : timing.clock;
      const graded = (list: DisplayList, t: number): DisplayList => {
        const finish = nested ? null : finishAt(recipe, t);
        return finish ? { ...list, finish } : list;
      };
      const cx = design.w / 2;
      const cy = design.h / 2;
      const field = cardField(rest, input.recipe.seed, content.brand);
      // The hollow name drifts across while the card moves, home by the time it settles.
      const S0 = Math.min(design.w, design.h);
      const fieldAt = (t: number) => {
        const u = settled > 0 ? Math.min(1, t / settled) : 1;
        const dx = -S0 * 0.12 * (1 - u) ** 2;
        return Math.abs(dx) < 0.05 ? field : cardField(rest, input.recipe.seed, content.brand, dx);
      };
      const keep = style.keep ?? [];
      const homeExtra = extra?.(last, last, design.w);
      const homeMoved = !!homeExtra && (homeExtra.zoom !== 1 || homeExtra.x !== 0 || homeExtra.y !== 0 || homeExtra.roll !== 0);
      const restList: DisplayList = { w: design.w, h: design.h, background: theme.accent, nodes: [...field, ...keep, ...(homeMoved ? [group(restNodes(rest), { id: "camera", transform: multiply(translate(homeExtra.x, homeExtra.y), about(cx, cy, homeExtra.zoom, homeExtra.roll)) })] : restNodes(rest))] };
      const still = graded(restList, last);
      // One band of light across the mark after it settles.
      const markB = markBox(rest);
      const sweepFrom = settled + 0.05;
      const sweepDur = Math.min(0.7, Math.max(0, last - 0.05 - sweepFrom));
      const sweepOn = style.sweep !== false && !!markB && sweepDur > 0.25;
      const swept = (t: number, nodes: DisplayNode[]): DisplayNode[] => {
        if (!sweepOn || !markB || t < sweepFrom || t >= sweepFrom + sweepDur) return nodes;
        const u = curve("move")((t - sweepFrom) / sweepDur);
        const bw = Math.max(markB.h * 0.6, markB.w * 0.18);
        const x = markB.x - bw + (markB.w + 2 * bw) * u;
        const pad = 4;
        const band: DisplayNode = { type: "rect", x: x - bw / 2, y: markB.y - markB.h, w: bw, h: markB.h * 3, fill: { kind: "linear", x0: x - bw / 2, y0: 0, x1: x + bw / 2, y1: 0, stops: [{ at: 0, color: "rgba(255,255,255,0)" }, { at: 0.5, color: "rgba(255,255,255,0.6)" }, { at: 1, color: "rgba(255,255,255,0)" }] } };
        const lit = group([...markNodes(rest).map((n): DisplayNode => (n.type === "text" || n.type === "image" ? { ...n, decor: true } : n)), group([band], { blend: "source-atop", transform: [1, 0, -0.3, 1, (markB.y + markB.h / 2) * 0.3, 0] })], { id: "sweep", isolate: { x: markB.x - pad, y: markB.y - pad, w: markB.w + 2 * pad, h: markB.h + 2 * pad } });
        return [...nodes, lit];
      };
      const drift = curve("drift");
      const camera = (t: number, nodes: DisplayNode[]): DisplayNode[] => {
        const tc = clock ? clock(t) : t;
        const u = drift(last > 0 ? tc / last : 1);
        let z = breath === 1 ? CAMERA_FROM + (1 - CAMERA_FROM) * u : 1 - (1 - CAMERA_FROM) * breath + (1 - CAMERA_FROM) * breath * u;
        if (!extra) return z >= 1 ? nodes : [group(nodes, { id: "camera", transform: about(cx, cy, z) })];
        const o = extra(t, tc, design.w);
        z *= o.zoom;
        if (z === 1 && o.x === 0 && o.y === 0 && o.roll === 0) return nodes;
        return [group(nodes, { id: "camera", transform: multiply(translate(o.x, o.y), about(cx, cy, z, o.roll)) })];
      };
      return {
        design,
        timeline: tl,
        rest: last,
        settled,
        ...(style.signature !== undefined && { signature: Math.min(last, Math.max(0, style.signature * k - lead)) }),
        cuts: [],
        overflow: rest.overflow,
        evaluate: (t) => {
          if (t >= last) return still;
          if (t >= settled) return graded({ ...restList, nodes: [...fieldAt(t), ...keep, ...camera(t, swept(t, restNodes(rest)))] }, t);
          const f = style.frame(t, tl);
          return graded({ w: design.w, h: design.h, background: style.background ?? theme.accent, nodes: [...(f.under ?? []), ...fieldAt(t), ...camera(t, f.nodes), ...(f.over ?? [])] }, t);
        },
        still: (t) => t >= last,
      };
    },
  };
}

/** A group moved by `dy`, scaled about (cx, cy) and faded: the common entrance of a block. */
export function entering(children: DisplayNode[], o: { cx: number; cy: number; dy?: number; scale?: number; opacity?: number; blur?: number }): DisplayNode {
  const m = multiply(translate(0, o.dy ?? 0), about(o.cx, o.cy, o.scale ?? 1));
  return group(children, { transform: m, ...(o.opacity !== undefined && o.opacity < 1 && { opacity: Math.max(0, o.opacity) }), ...(o.blur && o.blur > 0.05 && { blur: o.blur }) });
}

/** A block's middle (for scaling about it). */
export const blockCentre = (b: TextBlock) => ({ cx: b.cx, cy: b.y + b.layout.height / 2 });

/** A soft-edged reveal of `children` left to right: `p` 0 shows nothing, 1 everything (the edge is `feather` wide). */
export function wipe(children: DisplayNode[], box: { x: number; y: number; w: number; h: number }, p: number, feather: number): DisplayNode {
  if (p >= 1) return group(children);
  const edge = box.x - feather + (box.w + 2 * feather) * p;
  return group(children, {
    mask: { kind: "linear", x0: edge - feather, y0: 0, x1: edge, y1: 0, stops: [{ at: 0, color: "rgba(0,0,0,1)" }, { at: 1, color: "rgba(0,0,0,0)" }], bounds: { x: box.x - feather, y: box.y - feather, w: box.w + 2 * feather, h: box.h + 2 * feather } },
  });
}

/** A colour at an alpha (hex in), for the details below. */
const tint = (hex: string, a: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;


/**
 * What each style leaves on the card at rest, so the five end on five different cards: Draw-on its drawn corners,
 * Rise a rule under the name, Iris a soft ring round the mark, Split a seam of light down the middle, Glint a star of
 * light on the mark. Hairlines and light only: the words read as before.
 */
export function keepFor(variant: EndCardVariant, r: EndCardRest): DisplayNode[] {
  const S = Math.min(r.w, r.h);
  const hair = Math.max(1, S * 0.0022);
  const mark = markBox(r);
  const ink = r.ink.startsWith("#") && r.ink.length === 7 ? r.ink : "#ffffff";
  switch (variant) {
    case "draw-on": {
      // Two fine rules flanking the product's name (a jeweller's label), clear of its letters.
      const b = r.headline;
      if (!b.layout.lines.length) return [];
      const y = b.y + b.layout.lineHeight / 2;
      const half = b.layout.width / 2;
      const gap = S * 0.035;
      const L = Math.min(S * 0.09, Math.max(0, r.w / 2 - half - gap - r.margin));
      if (L < S * 0.03) return [];
      const d = `M${b.cx - half - gap - L} ${y}H${b.cx - half - gap}M${b.cx + half + gap} ${y}H${b.cx + half + gap + L}`;
      return [{ type: "path", id: "keep.rules", d, stroke: { paint: tint(ink, 0.75), width: hair, cap: "butt" } }];
    }
    case "rise": {
      const b = r.headline;
      const y = b.y + b.layout.height + S * 0.025;
      const w = Math.max(S * 0.3, b.layout.width * 0.7);
      return [{ type: "rect", id: "keep.rule", x: b.cx - w / 2, y, w, h: hair, fill: tint(ink, 0.8) }];
    }
    case "iris": {
      if (!mark) return [];
      const cx = mark.x + mark.w / 2;
      const cy = mark.y + mark.h / 2;
      // A fine oval round the mark alone: it clears every other line of words by 24 units or more and stays inside the
      // frame (never through the product's name, the tag or the address).
      const below = r.headline.layout.lines.length ? r.headline.y : r.cta ? r.cta.y : r.h - r.margin;
      const room = Math.max(0, below - S * 0.022 - cy);
      const rx = Math.min(r.w / 2 - S * 0.03, mark.w / 2 + S * 0.06);
      const ry = Math.min(room, Math.max(mark.h / 2 + S * 0.03, rx * 0.36));
      if (ry < mark.h / 2 + S * 0.012) return [];
      return [{ type: "ellipse", id: "keep.ring", cx, cy, rx, ry, stroke: { paint: tint(ink, 0.35), width: Math.max(1.5, hair) } }];
    }
    case "split": {
      // A pair of fine vertical rules either side of the stack, where the panels parted.
      const top = mark ? mark.y : r.headline.y;
      const bottom = r.site ? r.site.y + r.site.layout.height : r.cta ? r.cta.y + r.cta.h : r.headline.y + r.headline.layout.height;
      const x0 = Math.max(r.margin * 0.6, r.w / 2 - r.inner / 2 - S * 0.02);
      const x1 = r.w - x0;
      const mid = (top + bottom) / 2;
      const L = Math.min(S * 0.16, (bottom - top) * 0.5);
      return [{ type: "path", id: "keep.seams", d: `M${x0} ${mid - L / 2}V${mid + L / 2}M${x1} ${mid - L / 2}V${mid + L / 2}`, stroke: { paint: tint(ink, 0.55), width: hair } }];
    }
    case "glint": {
      if (!mark) return [];
      // A soft diagonal sheen of warm light behind the mark, where the glint passed (no star).
      const cx = mark.x + mark.w * 0.62;
      const cy = mark.y + mark.h / 2;
      const bw = Math.max(mark.h * 1.4, S * 0.12);
      const sheen: DisplayNode = { type: "rect", id: "keep.sheen", x: cx - bw / 2, y: cy - mark.h * 0.85, w: bw, h: mark.h * 1.7, fill: { kind: "linear", x0: cx - bw / 2, y0: 0, x1: cx + bw / 2, y1: 0, stops: [{ at: 0, color: "rgba(255,236,200,0)" }, { at: 0.5, color: "rgba(255,236,200,0.14)" }, { at: 1, color: "rgba(255,236,200,0)" }] } };
      return [group([sheen], { transform: [1, 0, -0.36, 1, cy * 0.36, 0] })];
    }
  }
}
