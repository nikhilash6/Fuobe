/**
 * The logo end card, shared by its five animated styles (pure). The card at rest is one centred stack on the brand
 * colour: the logo (or the brand's name), the product's name, the call-to-action pill and the shop's address under it,
 * in the kit's own colours. That rest layout is also the still card's (components/marketing/end-card.ts), so the
 * poster, the still and the last frame of every style are the same picture. Each style is a timeline of cues written
 * for a 2.5 s card (readable by about 0.9 s) and scaled to the card's length, and a frame function that moves the rest
 * layout's pieces. Through the hold a slow push-in keeps the card alive and comes to rest on the last frame.
 */

import { contrast, luminance, readableOn, themeFrom, type AdTheme } from "@/components/ads/layout";
import { about, group, mixHex, multiply, translate, type DisplayList, type DisplayNode, type Matrix, type TextNode, type TextRun } from "../../display";
import { curve } from "../../ease";
import { layoutText, type Measure, type TextLayout } from "../../layout";
import type { Recipe } from "../../recipe";
import type { LogoInfo, Scene, SceneInput, ScenePlan } from "../../scene";
import { designSize } from "../../sizes";
import { frameCount } from "../../time";
import { timeline, scaleCues, type Cue, type Timeline } from "../../tween";

export const END_CARD_VARIANTS = ["draw-on", "rise", "iris", "split", "glint"] as const;
export type EndCardVariant = (typeof END_CARD_VARIANTS)[number];

export const END_CARD_VARIANT_NAMES: Record<EndCardVariant, string> = { "draw-on": "Draw-on", rise: "Rise", iris: "Iris", split: "Split", glint: "Glint" };

/** The card's lengths (seconds), as Click to Ad's end card allows. */
export const END_CARD_DURATIONS = { min: 2, max: 3, default: 2.5 } as const;

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
export function endCardRest(p: { theme: AdTheme; content: EndCardContent; logo: { w: number; h: number } | null; measure: Measure; size: { w: number; h: number }; letters?: boolean; colors?: readonly string[] }): EndCardRest {
  const { w: W, h: H } = p.size;
  const t = p.theme;
  const S = Math.min(W, H);
  // The vertical unit: the height, up to a 9:16 card's.
  const V = Math.min(H, (S * 16) / 9);
  const m = Math.round(S * 0.1);
  const inner = Math.min(W - 2 * m, Math.round(S * 1.1));
  const { ink, pill, label: labelColour } = cardColours(t, p.colors ?? []);
  const gap = V * 0.04;
  const logoH = V * 0.15;
  const letters = p.letters ?? true;
  const brandText = p.content.brand.trim();
  const name = !p.logo && brandText ? layoutText({ text: brandText, family: t.heading, weight: 800, width: inner, maxLines: 2, max: S * 0.1, min: S * 0.06, lineHeight: 1.05, letters }, p.measure) : null;
  const head = layoutText({ text: p.content.product, family: t.heading, weight: 700, width: inner, maxLines: 2, max: S * 0.068, min: S * 0.045, letters }, p.measure);
  const ctaSize = S * 0.045;
  const ctaText = p.content.cta?.trim();
  const label = ctaText ? layoutText({ text: ctaText, family: t.body, weight: 700, width: inner - ctaSize * 2.4, maxLines: 1, max: ctaSize, min: S * 0.03 }, p.measure) : null;
  const siteText = p.content.website?.trim();
  const site = siteText ? layoutText({ text: siteText, family: t.body, weight: 500, width: inner, maxLines: 1, max: S * 0.032, min: S * 0.024 }, p.measure) : null;
  const ctaH = label ? label.size * 2.3 : 0;
  const top = p.logo ? logoH : name ? name.lines.length * name.size * 1.05 : 0;
  const headH = head.lines.length * head.size * 1.12;
  const siteH = site ? site.size * 1.12 : 0;
  const siteGap = gap * 0.9;
  const above = top + (top ? gap : 0) + headH + (label ? gap * 1.4 + ctaH : 0);
  const total = above + (site ? (above ? siteGap : 0) + siteH : 0);
  let y = (H - total) / 2 - V * 0.03;
  // A tall card keeps its bottom fifth clear.
  if (H / W > 1.5) y = Math.min(y, H * 0.8 - total);
  const fits = y >= m - 0.5 && y + total <= H - m + 0.5;
  y = Math.max(m, y);

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
    cta = { x: bx, y, w: bw, h: ctaH, r: ctaH / 2, color: pill, label: { field: "cta", layout: label, cx: bx + bw / 2, y: y + (ctaH - label.size * 1.12) / 2, color: labelColour } };
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

export const pillRect = (c: NonNullable<EndCardRest["cta"]>): DisplayNode => ({ type: "rect", id: "cta.pill", x: c.x, y: c.y, w: c.w, h: c.h, r: c.r, fill: c.color });

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
      const rest = endCardRest({ theme, content, logo: input.logo ? { w: input.logo.w, h: input.logo.h } : null, measure: input.measure, size: design, colors: input.recipe.brand.colors });
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
      const tl = timeline(cued.map((e) => ({ ...e, start: Math.round((e.start > 0 ? e.start * f : e.start) * 1e6) / 1e6 })));
      const settled = Math.min(last, tl.rest);
      const still: DisplayList = { w: design.w, h: design.h, background: theme.accent, nodes: restNodes(rest) };
      const drift = curve("drift");
      const camera = (t: number, nodes: DisplayNode[]): DisplayNode[] => {
        const z = CAMERA_FROM + (1 - CAMERA_FROM) * drift(last > 0 ? t / last : 1);
        return z >= 1 ? nodes : [group(nodes, { id: "camera", transform: about(design.w / 2, design.h / 2, z) })];
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
          if (t >= settled) return { ...still, nodes: camera(t, still.nodes) };
          const f = style.frame(t, tl);
          return { w: design.w, h: design.h, background: style.background ?? theme.accent, nodes: [...(f.under ?? []), ...camera(t, f.nodes), ...(f.over ?? [])] };
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
