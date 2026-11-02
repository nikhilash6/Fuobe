/**
 * Tap to Recolor: tap a piece of clothing (or a bag, shoes, a hat) in a photo and pick a colour; only that piece
 * changes, its fabric, folds and sheen kept. On the open engine SAM 3.1 finds the piece under the taps by its name
 * (AusBoss Mask by Touch) and Qwen-Image 2.1 repaints it inside that mask
 * (workflows/comfyui/qwen-image-21-recolor.json), so the rest of the photo stays as it was.
 *
 * Pure module (the swatches, the words, the taps as the mask node's touches, the request a run sends), shared by the app's
 * page (src/components/recolor), the catalog, the ComfyUI provider and the tests.
 */
import type { GenerationRequest, PixelPoint } from "./types";

export const RECOLOR = {
  appId: "app-tap-to-recolor",
  modelId: "oss-recolor",
  feature: "app:app-tap-to-recolor",
  /** Taps of each kind on one photo. */
  maxPoints: 8,
  /** Colours one Recolor makes, each its own run. */
  maxColours: 4,
} as const;

export const RECOLOR_TAP_FIRST = "Tap what to recolour";

/** The words the model reads: only what the picture should show. */
export const RECOLOR_TEMPLATE =
  "Change the colour of {option:item} to {option:colour}{prompt}. Keep its fabric, weave, folds, seams, stitching, sheen, print and shadows exactly as they are, so only the colour is new.";

export interface Swatch {
  value: string;
  label: string;
  hex: string;
  /** What the model reads for it. */
  words: string;
}

export const SWATCHES: Swatch[] = [
  { value: "ivory", label: "Ivory", hex: "#F2EBDD", words: "soft ivory" },
  { value: "black", label: "Black", hex: "#141414", words: "deep jet black" },
  { value: "crimson", label: "Crimson", hex: "#A3142C", words: "rich crimson red" },
  { value: "blush", label: "Blush", hex: "#E7B7BF", words: "pale blush pink" },
  { value: "camel", label: "Camel", hex: "#B98B5E", words: "warm camel" },
  { value: "emerald", label: "Emerald", hex: "#0E6B4F", words: "deep emerald green" },
  { value: "sage", label: "Sage", hex: "#9CAF94", words: "muted sage green" },
  { value: "cobalt", label: "Cobalt", hex: "#1F48A8", words: "deep cobalt blue" },
  { value: "navy", label: "Navy", hex: "#1B2541", words: "dark navy" },
  { value: "lilac", label: "Lilac", hex: "#B7A3D9", words: "soft lilac" },
];

/** The option value a custom colour runs under: its words come in as the run's prompt. */
export const CUSTOM_COLOUR = "custom";

/**
 * The pieces a tap can be. `words`: what the repaint model reads. `find`: the names SAM 3.1 looks for under each tap
 * (of the things with that name, the smallest under the tap; a tap's names are joined). SAM's point prompt on its own
 * takes the whole person, so every tap goes through names. A named garment also takes "clothing", so a coat tapped as
 * Jacket is still found.
 */
export const ITEMS: { value: string; label: string; words: string; find: string[] }[] = [
  // The repaint only reaches the masked piece, so words for the whole outfit point the model at it.
  { value: "auto", label: "Auto", words: "the outfit", find: ["clothing", "bag", "shoe", "hat", "scarf"] },
  { value: "dress", label: "Dress", words: "the dress", find: ["dress", "clothing"] },
  { value: "top", label: "Top", words: "the top", find: ["top", "clothing"] },
  { value: "jacket", label: "Jacket", words: "the jacket", find: ["jacket", "clothing"] },
  { value: "trousers", label: "Trousers", words: "the trousers", find: ["trousers", "clothing"] },
  { value: "skirt", label: "Skirt", words: "the skirt", find: ["skirt", "clothing"] },
  { value: "bag", label: "Bag", words: "the bag", find: ["bag", "handbag"] },
  { value: "shoes", label: "Shoes", words: "the shoes", find: ["shoe"] },
];

/** What a "Leave out" tap takes away: whichever of these is under it (a hand, hair, a strap or a belt over the piece). */
export const LEAVE_OUT = ["hand", "arm", "hair", "belt", "bag strap", "necklace"];

/** "#abc" / "abc" / "#AABBCC" → "#AABBCC", or null. */
export function normaliseHex(s: string): string | null {
  const m = s.trim().replace(/^#/, "").match(/^([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return `#${h.toUpperCase()}`;
}

type Lab = [number, number, number];

function hexToLab(hex: string): Lab {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
  // sRGB D65 → XYZ, normalised to the white point.
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** Names a custom colour is told by (the nearest one in Lab), with the swatches' own. */
const NAMED: [string, string][] = [
  ...SWATCHES.map((s): [string, string] => [s.words, s.hex]),
  ["pure white", "#FAFAFA"],
  ["cream", "#F3E5C8"],
  ["silver grey", "#B8B8B8"],
  ["charcoal grey", "#3C3C3C"],
  ["dove grey", "#8E8E8E"],
  ["scarlet red", "#D0201E"],
  ["burgundy", "#6B1626"],
  ["dusty rose pink", "#C98B93"],
  ["hot pink", "#E0338A"],
  ["fuchsia", "#C21E87"],
  ["coral", "#F0735A"],
  ["burnt orange", "#C2571A"],
  ["tangerine orange", "#F28A1E"],
  ["mustard yellow", "#D4A21C"],
  ["lemon yellow", "#F2E15B"],
  ["butter yellow", "#F4E3A1"],
  ["olive green", "#6B6B2A"],
  ["forest green", "#1F4A2C"],
  ["mint green", "#A8DCC0"],
  ["teal", "#13706F"],
  ["turquoise", "#2EB5B0"],
  ["sky blue", "#8EC3E8"],
  ["powder blue", "#B9CFE6"],
  ["royal blue", "#2A3FB0"],
  ["denim blue", "#3C5A82"],
  ["deep purple", "#4A2369"],
  ["violet", "#7A4FBF"],
  ["chocolate brown", "#4E2E1E"],
  ["tan", "#C9A57A"],
  ["taupe", "#8B7B6B"],
];

/** The nearest named colour to `hex` (CIE76 in Lab). */
export function nearestColourName(hex: string): string {
  const h = normaliseHex(hex);
  if (!h) return "";
  const [l, a, b] = hexToLab(h);
  let best = NAMED[0][0];
  let bestD = Infinity;
  for (const [name, at] of NAMED) {
    const [l2, a2, b2] = hexToLab(at);
    const d = (l - l2) ** 2 + (a - a2) ** 2 + (b - b2) ** 2;
    if (d < bestD) [best, bestD] = [name, d];
  }
  return best;
}

/** A swatch's words with its hex ("deep emerald green (#0E6B4F)"), or a custom colour's ("dusty rose pink (#C98B93)"). */
export function colourWords(colour: string): string {
  const swatch = SWATCHES.find((s) => s.value === colour);
  if (swatch) return `${swatch.words} (${swatch.hex})`;
  const hex = normaliseHex(colour);
  return hex ? `${nearestColourName(hex)} (${hex})` : "";
}

/** A colour the page shows: a swatch's name and hex, or a custom hex with its nearest name. */
export function colourChip(colour: string): { label: string; hex: string } | null {
  const swatch = SWATCHES.find((s) => s.value === colour);
  if (swatch) return { label: swatch.label, hex: swatch.hex };
  const hex = normaliseHex(colour);
  if (!hex) return null;
  const name = nearestColourName(hex);
  return { label: name.charAt(0).toUpperCase() + name.slice(1), hex };
}

/**
 * The taps in the photo's pixels: [add, leave out], at most RECOLOR.maxPoints of each. `from` is the size of the
 * picture the taps were placed on, `to` the photo's own size when known: taps on a smaller copy are scaled up. Points
 * land inside the photo.
 */
export function recolorPoints(points: PixelPoint[] | undefined, to?: { width: number; height: number }, from?: { width: number; height: number }): [{ x: number; y: number }[], { x: number; y: number }[]] {
  if (!points?.length) return [[], []];
  const kx = to && from && from.width > 0 ? to.width / from.width : 1;
  const ky = to && from && from.height > 0 ? to.height / from.height : 1;
  const at = (p: PixelPoint) => {
    let x = Math.round(p.x * kx);
    let y = Math.round(p.y * ky);
    if (to) {
      x = Math.min(to.width - 1, Math.max(0, x));
      y = Math.min(to.height - 1, Math.max(0, y));
    }
    return { x: Math.max(0, x), y: Math.max(0, y) };
  };
  const pick = (neg: boolean) => points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && (p.label === "negative") === neg).slice(0, RECOLOR.maxPoints).map(at);
  return [pick(false), pick(true)];
}

/**
 * The taps as the mask node's touches (`{"v":1,"items":[{"t":"name","w":word,"x":int,"y":int,"op":1|0}]}`, the photo's
 * pixels): every "Add to it" tap asks for the piece's names under it, then every "Leave out" tap takes away what
 * LEAVE_OUT names under it. "" when no tap adds anything. Sizes as in recolorPoints.
 */
export function recolorTouches(points: PixelPoint[] | undefined, item?: string, to?: { width: number; height: number }, from?: { width: number; height: number }): string {
  const [pos, neg] = recolorPoints(points, to, from);
  if (!pos.length) return "";
  const find = (ITEMS.find((i) => i.value === item) ?? ITEMS[0]).find;
  const items = [
    ...find.flatMap((w) => pos.map((p) => ({ t: "name", w, x: p.x, y: p.y, op: 1 }))),
    ...neg.flatMap((p) => LEAVE_OUT.map((w) => ({ t: "name", w, x: p.x, y: p.y, op: 0 }))),
  ];
  return JSON.stringify({ v: 1, items });
}

/** The piece a run's taps are on (params.extra.recolorItem, set by the "What is it?" choice); Auto when unknown. */
export function recolorItem(extra: Record<string, unknown> | undefined): string {
  const v = String(extra?.recolorItem ?? "");
  return ITEMS.some((i) => i.value === v) ? v : "auto";
}

/** The size the taps were placed on, as a run carries it (params.extra.frameWidth / frameHeight). */
export function tapFrame(extra: Record<string, unknown> | undefined): { width: number; height: number } | undefined {
  const w = Number(extra?.frameWidth);
  const h = Number(extra?.frameHeight);
  return w > 0 && h > 0 ? { width: w, height: h } : undefined;
}

/** One colour's run: the photo, the taps (in the pixels of `frame`), the piece and the colour (a swatch or a hex). */
export function recolorRequest(o: { image: string; points: PixelPoint[]; frame: { width: number; height: number }; colour: string; item?: string; seed?: number }): GenerationRequest {
  const swatch = SWATCHES.some((s) => s.value === o.colour);
  const hex = swatch ? null : normaliseHex(o.colour);
  if (!swatch && !hex) throw new Error("Pick a colour");
  const item = ITEMS.some((i) => i.value === o.item) ? o.item! : "auto";
  return {
    feature: RECOLOR.feature,
    presetId: RECOLOR.appId,
    modelId: RECOLOR.modelId,
    op: "edit",
    engine: "open",
    ...(hex ? { prompt: colourWords(hex) } : {}),
    inputs: { images: [o.image] },
    presetOptions: { item, colour: swatch ? o.colour : CUSTOM_COLOUR },
    params: {
      points: o.points.slice(0, RECOLOR.maxPoints * 2).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), label: p.label === "negative" ? "negative" : "positive" })),
      extra: { frameWidth: Math.round(o.frame.width), frameHeight: Math.round(o.frame.height), recolorItem: item },
      ...(o.seed !== undefined ? { seed: o.seed } : {}),
    },
  };
}
