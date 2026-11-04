/*
 * Layouts from the places that already know where things go (docs/research/new-models-7.md §4.10): Ads Studio's
 * planned rectangles (planAd), Marketing Studio's formats (the same planner, in the layout the browser sets the words
 * in), and a Canvas Layout node fed by a Table. Pure: the browser, the server and the tests share it.
 *
 * Two kinds of layout come out of an ad plan:
 * - "words": the headline, body and button as text items with their exact words, the logo area, a colour panel and
 *   the product as object items, so a model that reads boxes (MOSS-Image, FLUX.3, Ideogram 4.5) draws the whole ad;
 * - "clear": the product alone, in the part of the picture the words leave free, so a picture that gets its words set
 *   on top in the browser keeps the product out of their way.
 */
import { planAd, sizeFor, themeFrom, type AdContent, type AdLayout, type AdPlan, type Measure, type Rect, type TextBox } from "@/components/ads/layout";
import type { LayoutBox, LayoutDraft, LayoutItem } from "./layout-prompt";

/**
 * A text width without a canvas (the server and tests): about half the font size per character, a little more in
 * bold. The boxes guide the model; they don't set the type, so an estimate is enough.
 */
export const roughMeasure: Measure = (text, font) => {
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  const bold = /^\s*[6-9]00\b/.test(font);
  return [...text].length * px * (bold ? 0.58 : 0.52);
};

export type AdDraftMode = "words" | "clear";

export interface AdDraftOptions {
  mode: AdDraftMode;
  /** What the product (or the scene) looks like: the picture's own description. */
  product: string;
  /** The whole picture in words (the summary caption). */
  caption: string;
  /** Style tags (summary.meta). */
  meta?: string[];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const round = (v: number) => Math.round(v * 1e4) / 1e4;

function boxOf(r: Rect, W: number, H: number): LayoutBox {
  return [round(clamp01(r.x / W)), round(clamp01(r.y / H)), round(clamp01((r.x + r.w) / W)), round(clamp01((r.y + r.h) / H))];
}

/** A text block's rectangle on the canvas (as planRects reads it). */
function textRect(b: TextBox): Rect {
  return {
    x: b.align === "center" ? b.x - b.width / 2 : b.x,
    y: b.y,
    w: b.width,
    h: b.lines.length * b.lineHeight,
  };
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Every rectangle the words (and the logo) take, as the browser draws them. */
export function copyRects(plan: AdPlan): Rect[] {
  return [plan.logo, plan.brand && textRect(plan.brand), textRect(plan.headline), plan.body && textRect(plan.body), plan.cta].filter((r): r is Rect => !!r && r.w > 0 && r.h > 0);
}

/**
 * Where the product goes: the picture's rectangle, less the words' space. When the words sit on the picture (Overlay,
 * Band), the largest free part of it above, below, left or right of them; a part smaller than a fifth of the picture
 * is no room for a product, so the whole picture is used.
 */
export function productRect(plan: AdPlan): Rect {
  const img: Rect = plan.image ? { x: plan.image.x, y: plan.image.y, w: plan.image.w, h: plan.image.h } : { x: 0, y: 0, w: plan.w, h: plan.h };
  const over = copyRects(plan)
    .filter((r) => r !== plan.logo)
    .map((r) => intersect(r, img))
    .filter((r): r is Rect => !!r);
  if (!over.length) return img;
  const x0 = Math.min(...over.map((r) => r.x));
  const y0 = Math.min(...over.map((r) => r.y));
  const x1 = Math.max(...over.map((r) => r.x + r.w));
  const y1 = Math.max(...over.map((r) => r.y + r.h));
  const gap = plan.w * 0.02;
  const parts: Rect[] = [
    { x: img.x, y: img.y, w: img.w, h: y0 - gap - img.y },
    { x: img.x, y: y1 + gap, w: img.w, h: img.y + img.h - y1 - gap },
    { x: img.x, y: img.y, w: x0 - gap - img.x, h: img.h },
    { x: x1 + gap, y: img.y, w: img.x + img.w - x1 - gap, h: img.h },
  ].filter((r) => r.w > 0 && r.h > 0);
  const best = parts.sort((a, b) => b.w * b.h - a.w * a.h)[0];
  return best && best.w * best.h >= (img.w * img.h) / 5 ? best : img;
}

/** The family a CSS font string names first ("800 64px \"Inter\", system-ui" → Inter). */
const familyOf = (font: string) => /"([^"]+)"/.exec(font)?.[1] ?? "clean sans-serif";
/** A text colour as words a model reads: its hex, or white / near-black for the planner's rgba shades. */
const colourWords = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? `colour ${c}` : /255,\s*255,\s*255/.test(c) ? "white" : `colour ${c}`);

const sentence = (s: string) => s.trim().replace(/[.\s]+$/, "");

/** The logo box's caption: the logo itself goes to the model as its last reference image (adDraft's `logo`). */
export const LOGO_CAPTION = "The brand's logo, exactly as in the last reference image, small and crisp";

/** An ad plan as a layout draft (see the file comment for the two modes). */
export function adPlanDraft(plan: AdPlan, o: AdDraftOptions): LayoutDraft {
  const W = plan.w;
  const H = plan.h;
  const items: LayoutItem[] = [];
  const product = sentence(o.product) || "The product";
  if (o.mode === "words") {
    if (plan.panel)
      items.push({
        label: "object",
        caption: `A flat, solid ${plan.panel.color} colour panel with nothing printed on it`,
        box: boxOf(plan.panel, W, H),
      });
    items.push({
      label: "object",
      caption: product,
      box: boxOf(productRect(plan), W, H),
    });
    if (plan.logo)
      items.push({
        label: "object",
        caption: LOGO_CAPTION,
        box: boxOf(plan.logo, W, H),
      });
    const text = (b: TextBox | undefined, what: string) => {
      const words = b?.lines.join("\n").trim();
      if (!b || !words) return;
      items.push({
        label: "text",
        caption: `${what}, ${b.align === "center" ? "centred" : "left-aligned"}, ${colourWords(b.color)}, in a ${familyOf(b.font)}-style typeface`,
        text: words,
        box: boxOf(textRect(b), W, H),
      });
    };
    text(plan.brand, "The brand name in small capitals");
    text(plan.headline, "A large, bold headline");
    text(plan.body, "Smaller supporting copy, easy to read");
    const label = plan.cta?.text.lines.join(" ").trim();
    if (plan.cta && label) {
      items.push({
        label: "text",
        caption: `A rounded pill button in ${plan.cta.color} with its label in bold ${colourWords(plan.cta.text.color)} letters`,
        text: label,
        box: boxOf(plan.cta, W, H),
      });
    }
  } else {
    items.push({
      label: "object",
      caption: product,
      box: boxOf(productRect(plan), W, H),
    });
  }
  const shade = o.mode === "words" && plan.scrim ? "A soft dark shade fades in behind the words so they read clearly" : "";
  const clear = o.mode === "clear" ? "No text, letters or logos anywhere; the rest of the picture stays calm and uncluttered" : "";
  const caption = [sentence(o.caption), shade, clear].filter(Boolean).join(". ");
  const aspect = aspectFrom(W, H);
  return {
    summary: {
      caption: caption ? `${caption}.` : "",
      meta: o.meta ?? [],
      canvas: "single",
    },
    items,
    ...(aspect && { aspect }),
  };
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}
const aspectFrom = (w: number, h: number) => {
  const g = gcd(Math.round(w), Math.round(h));
  return g ? `${Math.round(w) / g}:${Math.round(h) / g}` : undefined;
};

export interface AdDraftInput {
  /** "4:5", "3:4"… (the picture's shape). */
  ratio: string;
  layout: AdLayout;
  content: AdContent;
  brand?: {
    colors?: string[];
    fonts?: { heading?: string; body?: string };
    logo?: string;
  } | null;
  mode: AdDraftMode;
  product: string;
  caption: string;
  meta?: string[];
  /**
   * The brand's logo goes to the model as its last reference image: plan its place. Without it there is no logo box,
   * so a model that draws from words alone doesn't make up a mark in the brand's name.
   */
  logo?: boolean;
}

/**
 * The layout for an ad or a Marketing Studio picture: planned as the browser would set it (planAd, with the brand's
 * colours and fonts, and the logo's place when the logo goes to the model), then turned into a draft. The draft keeps the shape
 * asked for, so the server compiles it at the size the model renders (src/lib/catalog/plan.ts planLayout).
 */
export function adDraft(i: AdDraftInput): LayoutDraft {
  const { w, h } = sizeFor(i.ratio);
  const plan = planAd({
    ratio: i.ratio,
    layout: i.layout,
    content: i.content,
    theme: themeFrom(i.brand),
    image: { w, h },
    logo: i.logo && i.brand?.logo ? { w: 3, h: 1 } : null,
    measure: roughMeasure,
  });
  const draft = adPlanDraft(plan, {
    mode: i.mode,
    product: i.product,
    caption: i.caption,
    meta: i.meta,
  });
  return /^\d+:\d+$/.test(i.ratio) ? { ...draft, aspect: i.ratio } : draft;
}

// ---------------------------------------------------------------------------
// Tables (Canvas): one layout, a batch of posters

const PLACEHOLDER = /\{([^{}\n]{1,40})\}/g;

/** The "{Column}" names a layout's words use (text items, captions and the whole picture's caption). */
export function layoutPlaceholders(draft: LayoutDraft): string[] {
  const found = new Set<string>();
  const scan = (s?: string) => {
    for (const m of (s ?? "").matchAll(PLACEHOLDER)) found.add(m[1].trim());
  };
  scan(draft.summary.caption);
  for (const it of draft.items) {
    scan(it.text);
    scan(it.caption);
  }
  return [...found];
}

/** A layout with a table row's cells in its "{Column}" placeholders (names as the columns spell them, trimmed). */
export function fillLayout(draft: LayoutDraft, columns: string[], cells: string[]): LayoutDraft {
  const at = new Map<string, string>();
  columns.forEach((c, j) => {
    if (c.trim()) at.set(c.trim(), cells[j] ?? "");
  });
  const fill = (s: string) => s.replace(PLACEHOLDER, (all, name: string) => (at.has(name.trim()) ? at.get(name.trim())! : all));
  return {
    ...draft,
    summary: { ...draft.summary, caption: fill(draft.summary.caption) },
    items: draft.items.map((it) => ({
      ...it,
      caption: fill(it.caption),
      ...(it.text !== undefined && { text: fill(it.text) }),
    })),
  };
}
