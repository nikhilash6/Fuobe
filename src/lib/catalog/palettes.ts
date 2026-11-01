/**
 * Colour signatures (Higgsfield's Soul HEX) and the Image studio's style signature: a saved palette
 * and/or a moodboard picked in the composer, and how each model gets them.
 *
 * Pure and catalog-free (the composer runs it in the browser; the server tests it): models are
 * passed in, and what only the server knows (which models take a palette field, their background
 * field) arrives as `SignatureCaps` from GET /api/palettes.
 *
 * Routing (docs/research/higgsfield-image-studios.md §4, §5):
 * - Palette → models with a palette field (Recraft V4.1 / Pro / Styles: ≤10 colours, Ideogram 3.0):
 *   `params.palette` (+ the background colour in its own field); every other model: the hex list written into
 *   the prompt (Fuobe Cinema too: a built-in palette's slug is no longer sent anywhere). Open
 *   engine: Z-Image Turbo becomes Z-Image Turbo · Palette (hex in the prompt + a ColorTransfer lock to
 *   a swatch); other open models can add a palette-transfer post-step (oss-palette-image, chained).
 * - Moodboard → curated: a Fuobe Soul look (Soul 2.0's 33, Soul's 106; src/lib/catalog/soul-cards.ts). On a model
 *   that takes looks (Fuobe Soul, Soul HD: options.looks) it is the look itself (presetId: its words and its LoRAs);
 *   on every other model its words. Picks saved with Higgsfield's old style ids still find their look.
 *   Personal: cloud = the board's Recraft style id (Recraft models) or its most representative images
 *   as style references (Nano Banana Pro and other multi-reference models); open = the board's collages
 *   on Qwen-Image-Edit Style Reference (or the style-reference model picked), or its trained style LoRA
 *   on Z-Image Turbo.
 * Sentences (the palette's hex list, a look described in words, a reference legend) never go into
 * `request.prompt`: they ride in `request.signature.words`, which the server adds when it plans the
 * run, so feeds, Library titles and Reuse keep the user's own words.
 */
import { DEFAULT_LOOK, lookCard, OWN_LOOK, SOUL_MODEL_IDS } from "./soul-cards";
import { familyOfModel } from "./training";
import type { GenerationRequest, GenParams, ModelDef, Operation } from "./types";

export type RGB = [number, number, number];

// ---------------------------------------------------------------------------
// Palettes

export type PaletteSource = "builtin" | "manual" | "images";

export interface Palette {
  id: string;
  name: string;
  /** 1–12 colours, "#RRGGBB" upper-case. Built-ins: Cinema Studio's 12, dark → light, the accent last. */
  colors: string[];
  /** The background colour ("Use as background"); built-ins use their 12th colour. */
  background: string | null;
  /** Cinema Studio 4.0 `color_palette` value (built-ins only). */
  slug: string | null;
  source: PaletteSource;
  /** A picture the palette came from (image-made palettes): the card's thumbnail. */
  thumb: string | null;
  createdAt: number;
}

export const MAX_COLORS = 12;
/** Recraft V4.1 takes at most 10 colours. */
export const MAX_COLORS_RECRAFT = 10;
/** "Upload & Create" takes up to 20 photos. */
export const MAX_SOURCE_IMAGES = 20;
export const NAME_MAX = 60;
export const HEX_RE = /^#[0-9a-f]{6}$/i;

/** The manual editor's starting palette (Higgsfield's defaults). */
export const MANUAL_DEFAULT = { colors: ["#FFFFFF", "#D1FE17", "#1C1E20"], background: "#53C546" } as const;

/** "#abc", "abcdef", " #ABCDEF " → "#ABCDEF"; anything else → null. */
export function normalizeHex(input: string): string | null {
  const s = input.trim().replace(/^#/, "");
  const full = /^[0-9a-f]{3}$/i.test(s) ? s.replace(/./g, (c) => c + c) : s;
  return /^[0-9a-f]{6}$/i.test(full) ? `#${full.toUpperCase()}` : null;
}

/** What's wrong with a palette before it can be saved, or null. */
export function paletteError(p: { name: string; colors: string[]; background?: string | null }): string | null {
  if (!p.name.trim()) return "Give the palette a name";
  if (p.name.trim().length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters`;
  if (!p.colors.length) return "Add at least one color";
  if (p.colors.length > MAX_COLORS) return `A palette holds up to ${MAX_COLORS} colors`;
  const bad = p.colors.find((c) => !HEX_RE.test(c));
  if (bad) return `${bad} isn't a color — use #RRGGBB`;
  if (p.background && !HEX_RE.test(p.background)) return `${p.background} isn't a color — use #RRGGBB`;
  return null;
}

/** The card's colour strip: the background first, then the other colours without repeats. */
export function cardStrip(p: Pick<Palette, "colors" | "background">): string[] {
  const out: string[] = [];
  for (const c of [p.background, ...p.colors]) {
    const h = c?.toUpperCase();
    if (h && !out.includes(h)) out.push(h);
  }
  return out;
}

/**
 * "Use as background" in the manual editor: `color` becomes (or stops being) the background, and the
 * colour that loses the flag stays in the palette as an ordinary colour (within the 12-colour limit)
 * instead of disappearing with it.
 */
export function withBackground<P extends { colors: string[]; background: string | null }>(p: P, color: string, on: boolean): P {
  const has = (c: string) => p.colors.some((x) => x.toUpperCase() === c.toUpperCase());
  const keep = (c: string | null) => (c && !has(c) && p.colors.length < MAX_COLORS ? [...p.colors, c] : p.colors);
  if (on) return { ...p, colors: p.background && p.background.toUpperCase() !== color.toUpperCase() ? keep(p.background) : p.colors, background: color };
  if (p.background?.toUpperCase() !== color.toUpperCase()) return p;
  return { ...p, colors: keep(color), background: null };
}

/** The colours sent to a model: the palette's own, then the background when it isn't one of them. */
export function paletteColors(p: Pick<Palette, "colors" | "background">): string[] {
  return cardStrip({ colors: p.colors, background: null }).concat(p.background && !p.colors.some((c) => c.toUpperCase() === p.background!.toUpperCase()) ? [p.background.toUpperCase()] : []);
}

export const hexToRgb = (hex: string): RGB => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const rgbToHex = ([r, g, b]: RGB): string =>
  `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

const luminance = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function rgbToHsv([r, g, b]: RGB): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const d = max - Math.min(rr, gg, bb);
  let h = 0;
  if (d) h = max === rr ? ((gg - bb) / d) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return [((h * 60 + 360) % 360) || 0, max ? d / max : 0, max];
}

export function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const hh = ((h % 360) + 360) % 360;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

/** Deterministic PRNG (mulberry32), so tests and "the same image" give the same answer. */
export function rng(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Higgsfield's "Random palettes": `n` rows of 2–12 uniformly random colours each (shown trimmed to 6). */
export function randomPalettes(rand: () => number = Math.random, n = 4): string[][] {
  return Array.from({ length: n }, () => {
    const len = 2 + Math.floor(rand() * 11);
    return Array.from({ length: len }, () => rgbToHex([rand() * 255, rand() * 255, rand() * 255]));
  });
}

// ---------------------------------------------------------------------------
// Extraction (k-means; runs in a Web Worker in the browser, see components/palettes/extract.worker.ts)

/** RGBA pixels → at most `max` RGB samples (evenly strided; transparent pixels skipped). */
export function samplePixels(data: ArrayLike<number>, max = 4000): RGB[] {
  const total = Math.floor(data.length / 4);
  const step = Math.max(1, Math.floor(total / max));
  const out: RGB[] = [];
  for (let i = 0; i < total; i += step) {
    const o = i * 4;
    if (data[o + 3] < 128) continue;
    out.push([data[o], data[o + 1], data[o + 2]]);
  }
  return out;
}

const dist2 = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

export interface Cluster {
  color: string;
  rgb: RGB;
  /** Share of all sampled pixels. */
  share: number;
}

/** k-means++ over RGB samples; clusters by share, largest first (empty ones dropped). */
export function kmeans(pixels: RGB[], k: number, opts: { iterations?: number; seed?: number } = {}): Cluster[] {
  if (!pixels.length || k < 1) return [];
  const rand = rng(opts.seed ?? 7);
  const kk = Math.min(k, pixels.length);
  const centres: RGB[] = [pixels[Math.floor(rand() * pixels.length)]];
  const nearest = pixels.map((p) => dist2(p, centres[0]));
  while (centres.length < kk) {
    const sum = nearest.reduce((a, b) => a + b, 0);
    if (!sum) break;
    let r = rand() * sum;
    let idx = 0;
    while (idx < nearest.length - 1 && r > nearest[idx]) r -= nearest[idx++];
    const c: RGB = [...pixels[idx]] as RGB;
    centres.push(c);
    for (let i = 0; i < pixels.length; i++) nearest[i] = Math.min(nearest[i], dist2(pixels[i], c));
  }
  const assign = new Int32Array(pixels.length).fill(-1);
  for (let it = 0; it < (opts.iterations ?? 16); it++) {
    let moved = false;
    for (let i = 0; i < pixels.length; i++) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < centres.length; c++) {
        const d = dist2(pixels[i], centres[c]);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        moved = true;
      }
    }
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pixels.length; i++) {
      const s = sums[assign[i]];
      s[0] += pixels[i][0];
      s[1] += pixels[i][1];
      s[2] += pixels[i][2];
      s[3]++;
    }
    sums.forEach((s, c) => {
      if (s[3]) centres[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    });
    if (!moved) break;
  }
  const counts = centres.map(() => 0);
  for (const a of assign) counts[a]++;
  return centres
    .map((c, i) => ({ rgb: c.map(Math.round) as RGB, color: rgbToHex(c), share: counts[i] / pixels.length }))
    .filter((c) => c.share > 0)
    .sort((a, b) => b.share - a.share);
}

/**
 * A palette from several images: each image gets an equal say (its samples are capped to the same
 * number), clusters closer than a just-noticeable step are merged, and the result is ordered
 * dark → light with the dominant colour as the background.
 */
export function extractPalette(images: RGB[][], opts: { count?: number; seed?: number } = {}): { colors: string[]; background: string | null; weights: number[] } {
  const usable = images.filter((px) => px.length);
  if (!usable.length) return { colors: [], background: null, weights: [] };
  const per = Math.max(200, Math.floor(6000 / usable.length));
  const pooled: RGB[] = [];
  for (const px of usable) {
    const step = Math.max(1, Math.floor(px.length / per));
    for (let i = 0; i < px.length; i += step) pooled.push(px[i]);
  }
  const count = Math.max(2, Math.min(MAX_COLORS, opts.count ?? 8));
  const clusters = kmeans(pooled, count, { seed: opts.seed });
  // Merge near-duplicates (ΔRGB < 18): one flat background shouldn't take three slots.
  const merged: Cluster[] = [];
  for (const c of clusters) {
    const twin = merged.find((m) => dist2(m.rgb, c.rgb) < 18 * 18);
    if (twin) twin.share += c.share;
    else merged.push({ ...c });
  }
  const background = merged[0]?.color ?? null;
  const ordered = [...merged].sort((a, b) => luminance(a.rgb) - luminance(b.rgb));
  return { colors: ordered.map((c) => c.color), background, weights: ordered.map((c) => Math.round(c.share * 1000) / 1000) };
}

const HUES: [number, string][] = [
  [15, "Red"],
  [40, "Amber"],
  [65, "Gold"],
  [90, "Lime"],
  [150, "Green"],
  [190, "Teal"],
  [215, "Sky"],
  [250, "Blue"],
  [285, "Violet"],
  [320, "Magenta"],
  [345, "Rose"],
  [360, "Red"],
];

/** A rough colour word for a hex ("Teal", "Ink", "Ivory"). */
export function colorWord(hex: string): string {
  const [h, s, v] = rgbToHsv(hexToRgb(hex));
  if (v < 0.16) return "Ink";
  if (s < 0.12) return v > 0.9 ? "Ivory" : v > 0.55 ? "Silver" : "Graphite";
  return HUES.find(([limit]) => h < limit)?.[1] ?? "Red";
}

/** A name to start from ("Teal Dusk", "Amber Noon"): the dominant colour's word plus a mood from the palette's light. */
export function suggestName(colors: string[], background?: string | null): string {
  if (!colors.length) return "My palette";
  const lead = colorWord(background ?? colors[0]);
  const lights = colors.map((c) => rgbToHsv(hexToRgb(c))[2]);
  const sats = colors.map((c) => rgbToHsv(hexToRgb(c))[1]);
  const v = lights.reduce((a, b) => a + b, 0) / lights.length;
  const s = sats.reduce((a, b) => a + b, 0) / sats.length;
  const mood = v < 0.3 ? "Midnight" : v < 0.45 ? (s > 0.45 ? "Ember" : "Dusk") : v > 0.75 ? (s > 0.35 ? "Pop" : "Haze") : s > 0.5 ? "Fever" : s < 0.18 ? "Fog" : "Noon";
  const second = colors.map(colorWord).find((w) => w !== lead);
  return lead === mood ? `${second ?? "Soft"} ${mood}` : `${lead} ${mood}`;
}

/** The sentence models that read hex codes follow (FLUX.2, Nano Banana, Seedream, GPT Image). */
export function palettePrompt(p: Pick<Palette, "colors" | "background">): string {
  const colors = cardStrip({ colors: p.colors, background: null });
  return `Color palette: use only these colors, in roughly this balance: ${colors.join(", ")}${p.background ? `; background color ${p.background.toUpperCase()}` : ""}.`;
}

// ---------------------------------------------------------------------------
// The style signature in the Image studio composer

/** What the composer keeps of a picked palette (enough to route it without another fetch). */
export interface PalettePick {
  id: string;
  name: string;
  colors: string[];
  background: string | null;
  slug: string | null;
  thumb?: string | null;
  /** Open engine: recolour the result to the palette afterwards (oss-palette-image, chained). */
  lock?: boolean;
}

export type MoodboardStatus = "queued" | "running" | "cover" | "complete" | "failed";

/** What the composer keeps of a picked moodboard. */
export interface MoodboardPick {
  id: string;
  kind: "curated" | "personal";
  name: string;
  description?: string;
  /** Curated: whose preset it is — Soul 2.0's looks (the default) or Soul's styles ("soul-v1"). */
  source?: "soul-v1" | "soul-v2";
  status: MoodboardStatus;
  cover?: string | null;
  /** Personal: the most representative images, best first (≤10). */
  refs?: string[];
  /** Personal: 1–2 collages of 4 images each, for open style-reference models. */
  collages?: string[];
  /** Personal: a Recraft V4 style made from the board (cloud). */
  styleId?: string | null;
  /** Personal: the @handle of the style element with a trained Z-Image Turbo LoRA (open). */
  loraHandle?: string | null;
}

export interface Signature {
  palette?: PalettePick;
  moodboard?: MoodboardPick;
}

/**
 * What a signed request carries (GenerationRequest.signature): the picks (Reuse puts them back on the
 * chips), the sentences the server adds to the prompt (the look and the palette in words, so the
 * user's own words stay in `prompt` for titles and Reuse), and the request before the signature
 * routed it (its model, operation, settings and how many images were the user's own).
 */
export interface SignatureRecord extends Signature {
  words?: string;
  from?: { modelId: string; op?: Operation; params?: GenParams; images: number };
}

export interface SignatureCaps {
  /** Models whose routes take a palette field: how many colours and the background colour's field. */
  native: Record<string, { max: number; background?: string }>;
}

export interface SignatureContext {
  caps: SignatureCaps;
  getModel: (id: string) => ModelDef | undefined;
  /**
   * A guest or a free account: no palette lock. The lock is a second run on the studio's own ComfyUI
   * (POST /api/palettes/lock), which only the owner starts, so a visitor's colors stay in the prompt.
   */
  visitor?: boolean;
}

export interface SignedRequest {
  request: GenerationRequest;
  /** The model it runs on now (a moodboard or palette can move it). */
  modelId: string;
  /** What changed, said once under the composer. */
  notes: string[];
  /** Why it can't run (a moodboard still training). */
  blocker?: string;
  /** Recolour the result to these colours afterwards (open palette lock, a chained step). */
  lock?: { colors: string[] };
}

/**
 * Fuobe Soul's HEX palette (Soul, Soul HD, Soul Cinema): the colours in the prompt on both engines, and on the open
 * engine the palette lock after it unless it was turned off (research §4.4: the lock is the open engine's HEX; fal has
 * no colour-match step). Other open models lock only when asked.
 */
export const locksByDefault = (modelId: string | undefined): boolean => !!modelId && (Object.values(SOUL_MODEL_IDS) as string[]).includes(modelId);

/** Models a signature can move a request to; studios that offer the chips keep them in their model slice. */
export const SIGNATURE_MODELS = {
  cloudRefs: "nano-banana-pro",
  recraftStyle: "recraft-4-style",
  recraftSaved: "recraft-4-style-saved",
  openStyle: "oss-style-qwen-edit",
  openPalette: "oss-zimage-palette",
  openTurbo: "oss-z-image-turbo",
  /** A personal moodboard trained as a style LoRA runs here, the LoRA as its look (both engines). */
  soul: SOUL_MODEL_IDS.soul,
  paletteLock: "oss-palette-image",
} as const;

const NOT_READY = "This moodboard is still training. Try again once it is ready.";

const hasOp = (m: ModelDef, op: string) => m.routes.some((r) => r.op === op);
/** Room for style references beyond the user's own images (multi-reference edit models; a one-image edit would just edit the reference). */
const refBudget = (m: ModelDef, existing: number) => (hasOp(m, "edit") && (m.options.maxImages ?? 1) >= 2 ? Math.max(0, (m.options.maxImages ?? 1) - existing) : 0);
const tidy = (s: string | undefined) => (s ?? "").trim().replace(/[.\s]+$/, "");
/** The prompt with a sentence added once (a reused run already carries it). */
const join = (prompt: string | undefined, sentence: string) => {
  const p = tidy(prompt);
  if (!p) return sentence;
  return p.includes(tidy(sentence)) ? (prompt ?? "") : `${p}. ${sentence}`;
};

/** "In the style of “Retro BW”: grainy black-and-white film portrait." */
export function styleWords(m: Pick<MoodboardPick, "name" | "description">): string {
  const d = tidy(m.description);
  return `In the style of “${m.name}”${d ? `: ${d.charAt(0).toLowerCase()}${d.slice(1)}` : ""}.`;
}

/** The legend for a board's images sent as references: positions 1-based within inputs.images. */
export function styleLegend(from: number, to: number): string {
  const which = from === to ? `image ${from}` : `images ${from}–${to}`;
  return `Use ${which} only as a style reference: match their colour palette, light, texture, grain and mood, but don't copy their subjects or layout.`;
}

/** Takes a Fuobe Soul look as its presetId (Fuobe Soul, Soul HD); a look id means nothing to any other model. */
const lookOf = (r: GenerationRequest, m: ModelDef) => (m.options.looks && r.presetId ? lookCard(r.presetId) : undefined);

function swap(request: GenerationRequest, to: ModelDef, from: ModelDef): GenerationRequest {
  if (to.id === from.id) return request;
  const p = request.params ?? {};
  // Keep what the new model takes; drop the old model's own settings.
  const aspect = p.aspectRatio && (!to.options.aspectRatios || to.options.aspectRatios.includes(p.aspectRatio)) ? p.aspectRatio : to.defaults?.aspectRatio;
  const resolution = p.resolution && to.options.resolutions?.includes(p.resolution) ? p.resolution : to.defaults?.resolution;
  const out: GenerationRequest = {
    ...request,
    modelId: to.id,
    op: undefined,
    params: { ...to.defaults, aspectRatio: aspect, resolution, numOutputs: p.numOutputs, seed: p.seed, enhancePrompt: p.enhancePrompt, palette: p.palette, extra: undefined },
  };
  // A Soul look is Fuobe Soul's own (its presetId): it doesn't go to a model that takes no looks.
  if (from.options.looks && !to.options.looks) {
    delete out.presetId;
    delete out.presetStrength;
  }
  return out;
}

const setExtra = (r: GenerationRequest, key: string, value: unknown): GenerationRequest => ({ ...r, params: { ...r.params, extra: { ...r.params?.extra, [key]: value } } });

/** The prompt as the model gets it: the user's words, then the signature's sentences (added once). */
export function withSignatureWords(req: GenerationRequest): GenerationRequest {
  const words = req.signature?.words?.trim();
  return words ? { ...req, prompt: join(req.prompt, words) } : req;
}

/**
 * Reuse of a signed run (Image studio): the request as it was before the signature routed it — its
 * own model, settings and images — with the picks back on the chips, so nothing hidden comes along
 * (a moved model, a palette field, a style id, the board's images). Null when it carries no signature.
 */
export function reuseSignature(req: GenerationRequest): { modelId: string; params: GenParams; images: string[]; signature: Signature } | null {
  const s = req.signature;
  if (!s || (!s.palette && !s.moodboard)) return null;
  const images = req.inputs?.images ?? [];
  return {
    modelId: s.from?.modelId ?? req.modelId,
    params: { ...(s.from?.params ?? req.params) },
    images: images.slice(0, s.from?.images ?? images.length),
    signature: { ...(s.palette && { palette: s.palette }), ...(s.moodboard && { moodboard: s.moodboard }) },
  };
}

/**
 * Apply the composer's palette and moodboard to a request. Pure: the same call prices the run while
 * you type and builds what's sent. Native fields (style_id, palette, color_palette) and a model move
 * go on the request; sentences go to `signature.words`, which the server adds to the prompt.
 */
export function applySignature(req: GenerationRequest, sig: Signature | undefined, ctx: SignatureContext): SignedRequest {
  let model = ctx.getModel(req.modelId);
  if (!model || (!sig?.palette && !sig?.moodboard)) return { request: req, modelId: req.modelId, notes: [] };
  let r: GenerationRequest = req;
  const notes: string[] = [];
  const words: string[] = [];
  const move = (id: string, why: string) => {
    const to = ctx.getModel(id);
    if (!to || !model || to.id === model.id) return false;
    const look = !to.options.looks ? lookOf(r, model) : undefined;
    r = swap(r, to, model);
    notes.push(why.replace("{model}", to.name));
    // The moodboard's style wins over the look (it moved the run); say the look isn't used.
    if (look && look.id !== DEFAULT_LOOK) notes.push(`The ${look.name} look is Fuobe Soul's own, so it isn't used on ${to.name}`);
    model = to;
    return true;
  };
  let styled = false;

  const mb = sig.moodboard;
  if (mb) {
    if (mb.kind === "personal" && mb.status !== "complete") return { request: req, modelId: req.modelId, notes: [], blocker: mb.status === "failed" ? "This moodboard failed to build — retry it on the Moodboards page" : NOT_READY };
    if (mb.kind === "curated") {
      // A look picked before the Originals carries Higgsfield's old id: it reads as its Fuobe look.
      const card = lookCard(mb.id);
      const look = card ? { ...mb, id: card.id, name: card.name, description: card.description } : mb;
      if (model.options.looks && card) r = { ...r, presetId: card.id };
      else {
        words.push(styleWords(look));
        notes.push(
          model.id === SOUL_MODEL_IDS.cinema
            ? `${model.name} has one fixed look — ${look.name} is described in words`
            : `${look.name} is a Fuobe Soul look — described in words on ${model.name} (Fuobe Soul applies it with its LoRAs)`,
        );
      }
      styled = true;
    } else {
      const existing = r.inputs?.images?.length ?? 0;
      const refs = mb.refs ?? [];
      const collages = mb.collages?.length ? mb.collages : refs.slice(0, 2);
      // A request that already carries the board's images (Run again of an older run): nothing to add.
      const carried = [...refs, ...collages].some((u) => r.inputs?.images?.includes(u));
      // A board trained as a style LoRA is a Fuobe look (build plan O3): on Fuobe Soul (and plain Z-Image Turbo, whose
      // family the LoRA is) on either engine, and on the open engine instead of collages for any model but a
      // style-reference one. A partner model in the cloud keeps the board's images as style references.
      const zFamily = familyOfModel(model.id) === "z-image-turbo";
      const asLook = !!mb.loraHandle && (zFamily || (model.engine === "open" && model.family !== "style-reference"));
      if (carried) {
        // Leave the request as it is.
      } else if (asLook) {
        // Soul Cinema's film look is fixed: the board's look runs on Fuobe Soul, on the engine the run was on.
        const engine = r.engine ?? model.engine;
        if (!zFamily || model.id === SOUL_MODEL_IDS.cinema) move(SIGNATURE_MODELS.soul, `Runs on {model} with the trained “${mb.name}” style as its look`);
        r = { ...r, engine };
        if (model.options.looks) r = { ...r, presetId: OWN_LOOK };
        words.push(`In the style of @${mb.loraHandle}.`);
      } else if (model.engine === "cloud") {
        if (model.family === "recraft" && mb.styleId) {
          move(SIGNATURE_MODELS.recraftSaved, `Runs on {model} with the saved “${mb.name}” Recraft style`);
          r = { ...r, params: { ...r.params, styleId: mb.styleId } };
        } else if (model.family === "recraft") {
          move(SIGNATURE_MODELS.recraftStyle, `Runs on {model}, styled by the “${mb.name}” images`);
          // Recraft V4 Styles reads every image as a style reference: yours first, then the board's, 10 in all.
          const own = r.inputs?.images ?? [];
          const max = model.options.maxImages ?? 10;
          if (own.length) notes.push(`Your ${own.length === 1 ? "image is" : "images are"} used as style references too on ${model.name}`);
          r = { ...r, op: "edit", inputs: { ...r.inputs, images: [...own, ...refs.filter((u) => !own.includes(u))].slice(0, max) } };
        } else {
          let budget = Math.min(refBudget(model, existing), 6);
          if (!budget && model.id !== SIGNATURE_MODELS.cloudRefs) {
            move(SIGNATURE_MODELS.cloudRefs, `${model.name} can't take style references — runs on {model} with “${mb.name}”`);
            budget = Math.min(refBudget(model, existing), 6);
          }
          const take = refs.slice(0, budget);
          if (!take.length) return { request: req, modelId: req.modelId, notes, blocker: "Remove a reference image to make room for the moodboard" };
          r = { ...r, op: "edit", inputs: { ...r.inputs, images: [...(r.inputs?.images ?? []), ...take] } };
          words.push(styleLegend(existing + 1, existing + take.length));
        }
      } else {
        if (model.family !== "style-reference") move(SIGNATURE_MODELS.openStyle, `Runs on {model} with the “${mb.name}” collages`);
        const max = model.options.maxImages ?? 2;
        const pool = max >= 4 ? refs : collages;
        const take = pool.slice(0, Math.max(0, max - existing));
        if (!take.length) return { request: req, modelId: req.modelId, notes, blocker: "Remove a reference image to make room for the moodboard" };
        r = { ...r, op: undefined, inputs: { ...r.inputs, images: [...(r.inputs?.images ?? []), ...take] } };
      }
      styled = true;
    }
  }

  const pal = sig.palette;
  let lock: SignedRequest["lock"];
  if (pal?.colors.length) {
    const all = paletteColors(pal);
    const native = ctx.caps.native[model.id];
    if (!native && model.engine === "open" && model.id === SIGNATURE_MODELS.openTurbo && !styled && !(r.inputs?.images?.length) && !r.loras?.length) {
      move(SIGNATURE_MODELS.openPalette, `Runs on {model}: your colors go in the prompt, then a color transfer keeps the image to them`);
    }
    const nativeNow = ctx.caps.native[model.id];
    if (nativeNow) {
      const colors = cardStrip({ colors: pal.colors, background: null });
      if (colors.length > nativeNow.max) notes.push(`${model.name} takes ${nativeNow.max} colors — the first ${nativeNow.max} are used`);
      r = { ...r, params: { ...r.params, palette: colors.slice(0, nativeNow.max) } };
      if (pal.background && nativeNow.background) r = setExtra(r, nativeNow.background, pal.background.toUpperCase());
    } else if (model.id === SIGNATURE_MODELS.openPalette) {
      r = { ...r, params: { ...r.params, palette: all } };
    } else {
      words.push(palettePrompt(pal));
      r = { ...r, params: { ...r.params, palette: all.slice(0, 16) } };
      if (model.engine === "open" && !ctx.visitor && (pal.lock ?? locksByDefault(model.id))) {
        lock = { colors: all };
        notes.push(`Then kept to the colors of “${pal.name}” after it's made`);
      }
    }
  }
  // Sentences an older run already kept in its prompt aren't added twice.
  const sentence = words.filter((w) => !tidy(r.prompt).includes(tidy(w))).join(" ");
  const record: SignatureRecord = {
    ...(sig.palette && { palette: sig.palette }),
    ...(sig.moodboard && { moodboard: sig.moodboard }),
    ...(sentence && { words: sentence }),
    from: { modelId: req.modelId, ...(req.op && { op: req.op }), ...(req.params && { params: req.params }), images: req.inputs?.images?.length ?? 0 },
  };
  return { request: { ...r, signature: record }, modelId: model.id, notes, ...(lock && { lock }) };
}
