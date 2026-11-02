/**
 * Relight with placed lights (the Relight app's own tool, src/components/relight): the lights, their colours and
 * bands, the ready-made looks, and the words the model gets. Pure: the page, the server and the tests share it.
 *
 * A light sits where it was tapped (x 0 left … 1 right, y 0 bottom … 1 top). Its height band follows y; distance,
 * softness and strength are preset chips (a desktop slider can set strength finely). The prompt names only what is
 * wanted: the lights, the darkness they light, and what stays the same.
 */

export type Height = "low" | "face" | "high";
export type Distance = "close" | "mid" | "far";
export type Softness = "hard" | "soft" | "diffuse";
export type Strength = "low" | "medium" | "high";
export type Side = "left" | "front" | "right";

export interface Light {
  id: string;
  /** sRGB hex, #rrggbb. */
  color: string;
  /** 0 left … 1 right. */
  x: number;
  /** 0 bottom … 1 top (where the marker sits on the photo). */
  y: number;
  height: Height;
  distance: Distance;
  softness: Softness;
  strength: Strength;
  /** 0..1, set only by the desktop slider; otherwise the strength chip decides. */
  strengthValue?: number;
  /** Behind the subject: it rims the outline. */
  behind?: boolean;
}

export const MAX_LIGHTS = 3;

export const HEIGHTS: readonly Height[] = ["low", "face", "high"];
export const DISTANCES: readonly Distance[] = ["close", "mid", "far"];
export const SOFTNESSES: readonly Softness[] = ["hard", "soft", "diffuse"];
export const STRENGTHS: readonly Strength[] = ["low", "medium", "high"];

export const HEIGHT_LABELS: Record<Height, string> = { low: "Low", face: "Face", high: "High" };
export const DISTANCE_LABELS: Record<Distance, string> = { close: "Close", mid: "Mid", far: "Far" };
export const SOFTNESS_LABELS: Record<Softness, string> = { hard: "Hard", soft: "Soft", diffuse: "Diffuse" };
export const STRENGTH_LABELS: Record<Strength, string> = { low: "Low", medium: "Medium", high: "High" };

/** Where a band's marker sits when its chip moves it (0 bottom … 1 top). */
export const BAND_CENTER: Record<Height, number> = { low: 0.18, face: 0.55, high: 0.84 };

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5);

/** The height band of a spot: the top third is High, the bottom third Low, the rest Face. */
export function heightFromY(y: number): Height {
  return y > 0.66 ? "high" : y < 0.33 ? "low" : "face";
}

/** The marker's y for a band chip: kept when it is inside the band already, else the band's centre. */
export function yForHeight(y: number, h: Height): number {
  return heightFromY(y) === h ? y : BAND_CENTER[h];
}

/** The side a light comes from, in words' thirds. */
export function sideOf(x: number): Side {
  return x < 0.35 ? "left" : x > 0.65 ? "right" : "front";
}

/** The strength as a number (0..1): the slider's value, else the chip's. */
export function strengthValueOf(l: Pick<Light, "strength" | "strengthValue">): number {
  if (typeof l.strengthValue === "number" && Number.isFinite(l.strengthValue)) return clamp01(l.strengthValue);
  return l.strength === "low" ? 0.3 : l.strength === "high" ? 0.95 : 0.62;
}

/** The chip a slider value falls in. */
export function strengthFromValue(v: number): Strength {
  return v < 0.4 ? "low" : v > 0.78 ? "high" : "medium";
}

// ---------------------------------------------------------------------------
// Colours

export type ColorChipId = "warm" | "cool" | "teal" | "magenta" | "sunset" | "neon-blue" | "white";

export interface ColorChip {
  id: ColorChipId;
  label: string;
  hex: string;
  /** What the prompt calls it. */
  words: string;
}

export const COLOR_CHIPS: readonly ColorChip[] = [
  { id: "warm", label: "Warm", hex: "#ffb450", words: "warm amber" },
  { id: "cool", label: "Cool", hex: "#cfe0ff", words: "cool moonlight blue" },
  { id: "teal", label: "Teal", hex: "#1ec8be", words: "teal" },
  { id: "magenta", label: "Magenta", hex: "#f028dc", words: "vivid neon magenta" },
  { id: "sunset", label: "Sunset", hex: "#ff8a2a", words: "sunset orange" },
  { id: "neon-blue", label: "Neon blue", hex: "#2860ff", words: "electric neon blue" },
  { id: "white", label: "White", hex: "#ffffff", words: "clean white" },
];

/** More names a custom colour can land on (the 14 of linoyts' Qwen-Image 2.1 Relight Space). */
const MORE_NAMES: readonly { hex: string; words: string }[] = [
  { hex: "#ff2828", words: "red" },
  { hex: "#ff8c1e", words: "orange" },
  { hex: "#ffe632", words: "yellow" },
  { hex: "#5ae628", words: "green" },
  { hex: "#28dcff", words: "cyan" },
  { hex: "#285aff", words: "blue" },
  { hex: "#963cff", words: "purple" },
  { hex: "#ff6eb4", words: "pink" },
  { hex: "#d7e6ff", words: "cool white" },
  { hex: "#ffebcd", words: "warm white" },
];

const ALL_NAMES = [...COLOR_CHIPS.map((c) => ({ hex: c.hex, words: c.words })), ...MORE_NAMES];

export function normalizeHex(hex: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return `#${h.toLowerCase()}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex) ?? "#ffffff";
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/** sRGB 0..255 → linear 0..1. */
export function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** CIE Lab (D65) of an sRGB hex. */
export function hexToLab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** The chip a colour is exactly, if any. */
export function chipOf(hex: string): ColorChip | undefined {
  const h = normalizeHex(hex);
  return COLOR_CHIPS.find((c) => c.hex === h);
}

/** A colour's words: its chip's, else the nearest name (distance in Lab, not RGB). */
export function colorWords(hex: string): string {
  const chip = chipOf(hex);
  if (chip) return chip.words;
  const [l, a, b] = hexToLab(hex);
  let best = ALL_NAMES[0];
  let bestD = Infinity;
  for (const n of ALL_NAMES) {
    const [l2, a2, b2] = hexToLab(n.hex);
    const d = (l - l2) ** 2 + (a - a2) ** 2 + (b - b2) ** 2;
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best.words;
}

// ---------------------------------------------------------------------------
// Looks: one tap places a full rig

export type LookId = "golden-hour" | "neon-night" | "studio-rim" | "candlelight" | "studio-softbox" | "dramatic" | "overcast" | "silhouette" | "window";

type LightSpec = Omit<Light, "id" | "y"> & { y?: number };

export interface Look {
  id: LookId;
  label: string;
  lights: LightSpec[];
  /** The old app's option label it replaces (Reuse of an old run picks this look). */
  legacy?: string;
}

const L = (color: string, x: number, height: Height, distance: Distance, softness: Softness, strength: Strength, behind?: boolean): LightSpec => ({
  color,
  x,
  height,
  distance,
  softness,
  strength,
  ...(behind && { behind: true }),
});

/** The four named looks come first on every screen; the other five keep the old app's choices. */
export const LOOKS: readonly Look[] = [
  { id: "golden-hour", label: "Golden hour", legacy: "Golden hour", lights: [L("#ff8a2a", 0.12, "face", "far", "soft", "high"), L("#ffd9a0", 0.85, "face", "far", "diffuse", "low")] },
  { id: "neon-night", label: "Neon night", legacy: "Neon night", lights: [L("#f028dc", 0.08, "face", "close", "hard", "high"), L("#2860ff", 0.92, "face", "close", "hard", "high")] },
  {
    id: "studio-rim",
    label: "Studio rim",
    lights: [L("#ffffff", 0.3, "high", "mid", "soft", "medium"), L("#cfe0ff", 0.85, "high", "close", "hard", "high", true), L("#cfe0ff", 0.15, "high", "close", "hard", "medium", true)],
  },
  { id: "candlelight", label: "Candlelight", legacy: "Candlelight", lights: [L("#ffa040", 0.42, "low", "close", "soft", "high")] },
  { id: "studio-softbox", label: "Studio softbox", legacy: "Studio softbox", lights: [L("#ffffff", 0.5, "high", "mid", "diffuse", "high")] },
  { id: "dramatic", label: "Dramatic", legacy: "Dramatic", lights: [L("#ffffff", 0.12, "high", "close", "hard", "high")] },
  { id: "overcast", label: "Overcast", legacy: "Overcast", lights: [L("#dfe8ff", 0.5, "high", "far", "diffuse", "medium")] },
  { id: "silhouette", label: "Silhouette", legacy: "Silhouette", lights: [L("#ffe2b8", 0.5, "face", "far", "hard", "high", true)] },
  { id: "window", label: "Window", legacy: "Window", lights: [L("#e6efff", 0.08, "face", "mid", "soft", "high")] },
];

export const FEATURED_LOOKS: readonly LookId[] = ["golden-hour", "neon-night", "studio-rim", "candlelight"];

export function getLook(id: string | undefined | null): Look | undefined {
  return LOOKS.find((l) => l.id === id);
}

/** The look an old run's "Lighting" option picked (Reuse of a run from before the tool). */
export function lookFromLegacy(label: string | undefined | null): Look | undefined {
  if (!label) return undefined;
  const t = label.trim().toLowerCase();
  return LOOKS.find((l) => l.legacy?.toLowerCase() === t || l.label.toLowerCase() === t);
}

/** A look's lights, ready to place (ids l1…, y at the band's centre). */
export function lightsOfLook(look: Look): Light[] {
  return look.lights.slice(0, MAX_LIGHTS).map((s, i) => ({ ...s, id: `l${i + 1}`, y: s.y ?? BAND_CENTER[s.height] }));
}

/** Whether `lights` are still exactly what `look` placed. */
export function isLook(lights: readonly Light[], look: Look): boolean {
  const want = lightsOfLook(look);
  if (want.length !== lights.length) return false;
  return want.every((w, i) => {
    const l = lights[i];
    return (
      l.color === w.color &&
      Math.abs(l.x - w.x) < 1e-6 &&
      Math.abs(l.y - w.y) < 1e-6 &&
      l.height === w.height &&
      l.distance === w.distance &&
      l.softness === w.softness &&
      l.strength === w.strength &&
      l.strengthValue === undefined &&
      !!l.behind === !!w.behind
    );
  });
}

// ---------------------------------------------------------------------------
// Placing lights

/** Where "Add light" puts light 1, 2 and 3 when nobody taps the photo. */
const DEFAULT_SPOTS: readonly { x: number; height: Height; color: string }[] = [
  { x: 0.2, height: "face", color: "#ff8a2a" },
  { x: 0.8, height: "face", color: "#2860ff" },
  { x: 0.5, height: "high", color: "#f028dc" },
];

function nextId(lights: readonly Light[]): string {
  for (let i = 1; ; i++) if (!lights.some((l) => l.id === `l${i}`)) return `l${i}`;
}

/** A new light where the photo was tapped (null at MAX_LIGHTS). Its band follows the tap; its colour the next default. */
export function lightAt(lights: readonly Light[], x: number, y: number): Light | null {
  if (lights.length >= MAX_LIGHTS) return null;
  const spot = DEFAULT_SPOTS.find((s) => !lights.some((l) => l.color === s.color)) ?? DEFAULT_SPOTS[lights.length % DEFAULT_SPOTS.length];
  const cx = clamp01(x);
  const cy = clamp01(y);
  return { id: nextId(lights), color: spot.color, x: cx, y: cy, height: heightFromY(cy), distance: "mid", softness: "soft", strength: "high" };
}

/** "Add light" without a tap: the next default spot. */
export function defaultLight(lights: readonly Light[]): Light | null {
  if (lights.length >= MAX_LIGHTS) return null;
  const spot = DEFAULT_SPOTS.find((s) => !lights.some((l) => Math.abs(l.x - s.x) < 0.05 && l.height === s.height)) ?? DEFAULT_SPOTS[lights.length];
  const l = lightAt(lights, spot.x, BAND_CENTER[spot.height]);
  return l && { ...l, color: lights.some((o) => o.color === spot.color) ? l.color : spot.color };
}

/** Move a light (tap or drag): its band follows y. */
export function moveLight(l: Light, x: number, y: number): Light {
  const cy = clamp01(y);
  return { ...l, x: clamp01(x), y: cy, height: heightFromY(cy) };
}

/** A light from anything stored (a run's params, a link): only known values, clamped; null when it isn't one. */
export function sanitizeLight(v: unknown, fallbackId: string): Light | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const color = typeof o.color === "string" ? normalizeHex(o.color) : null;
  if (!color || typeof o.x !== "number" || typeof o.y !== "number") return null;
  const pick = <T extends string>(val: unknown, all: readonly T[], d: T): T => (all.includes(val as T) ? (val as T) : d);
  const y = clamp01(o.y);
  return {
    id: typeof o.id === "string" && /^[\w-]{1,16}$/.test(o.id) ? o.id : fallbackId,
    color,
    x: clamp01(o.x),
    y,
    height: pick(o.height, HEIGHTS, heightFromY(y)),
    distance: pick(o.distance, DISTANCES, "mid"),
    softness: pick(o.softness, SOFTNESSES, "soft"),
    strength: pick(o.strength, STRENGTHS, "high"),
    ...(typeof o.strengthValue === "number" && Number.isFinite(o.strengthValue) && { strengthValue: clamp01(o.strengthValue) }),
    ...(o.behind === true && { behind: true }),
  };
}

export function sanitizeLights(v: unknown): Light[] {
  if (!Array.isArray(v)) return [];
  const out: Light[] = [];
  for (const [i, x] of v.entries()) {
    const l = sanitizeLight(x, `l${i + 1}`);
    if (l && !out.some((o) => o.id === l.id)) out.push(l);
    if (out.length >= MAX_LIGHTS) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Words

const STRENGTH_WORD: Record<Strength, string> = { low: "gentle", medium: "", high: "strong" };
const SOFT_WORD: Record<Softness, string> = { hard: "hard, crisp", soft: "soft", diffuse: "broad, diffused" };
const HEIGHT_WORDS: Record<Height, string> = { low: "below", face: "at face height", high: "high above" };
const DISTANCE_WORDS: Record<Distance, string> = { close: "close to the subject", mid: "at a medium distance", far: "far away" };
const SIDE_WORDS: Record<Side, string> = { left: "the left", right: "the right", front: "the front" };
const SOFTNESS_CLAUSE: Record<Softness, string> = {
  hard: "hard, crisp light and sharp, defined shadows",
  soft: "soft light and smooth shadow edges",
  diffuse: "soft, diffused light and gentle shadow falloff",
};
const RANK: Record<Softness, number> = { hard: 0, soft: 1, diffuse: 2 };

export const KEEP_WORDS =
  "Keep the person's identity, face, expression, pose, hair, clothing and the background exactly the same; only the lighting and the colour of the light falling on the scene change.";

/**
 * How softness is said: "auto" names each light's own softness when they differ and one shared clause when they
 * agree; "shared" says the softest light's clause once for all.
 */
export type SoftnessWording = "auto" | "shared";

/** One light in words: "a strong soft sunset orange light coming from the left, at face height, far away". */
export function lightWords(l: Light, withSoftness: boolean): string {
  const strength = STRENGTH_WORD[strengthFromValue(strengthValueOf(l))];
  const soft = withSoftness ? SOFT_WORD[l.softness] : "";
  const head = ["a", strength, soft, colorWords(l.color), "light"].filter(Boolean).join(" ");
  const where = l.behind
    ? `behind the subject, rimming the ${sideOf(l.x) === "front" ? "top" : sideOf(l.x)} edge of the silhouette`
    : `coming from ${SIDE_WORDS[sideOf(l.x)]}`;
  return `${head} ${where}, ${HEIGHT_WORDS[l.height]}, ${DISTANCE_WORDS[l.distance]}`;
}

function joinLights(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join("; ")}; and ${parts[parts.length - 1]}`;
}

/** The prompt written from the lights. Empty with no light. */
export function relightPrompt(lights: readonly Light[], wording: SoftnessWording = "auto"): string {
  const ls = lights.slice(0, MAX_LIGHTS);
  if (!ls.length) return "";
  const same = ls.every((l) => l.softness === ls[0].softness);
  const shared = wording === "shared" || same;
  const clauseSoftness = ls.reduce((a, l) => (RANK[l.softness] > RANK[a] ? l.softness : a), ls[0].softness);
  const parts = ls.map((l) => lightWords(l, !shared));
  const clause = shared ? `, with ${SOFTNESS_CLAUSE[clauseSoftness]}` : "";
  return `Relight the photo with ${joinLights(parts)}. The scene is in darkness, lit only by these lights${clause}. ${KEEP_WORDS}`;
}

/** The words that go to the model: the typed prompt, word for word, when there is one. */
export function promptFor(lights: readonly Light[], override?: string | null, wording: SoftnessWording = "auto"): string {
  const typed = override?.trim();
  return typed ? typed : relightPrompt(lights, wording);
}

// ---------------------------------------------------------------------------
// Seeds and keys

/** A stable 31-bit seed from the photo, so moving one light changes only that light. */
export function seedFor(photoKey: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < photoKey.length; i++) {
    h ^= photoKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 2147483647;
}

/** What a result is cached by: the words, the engine variant, the seed and the guide. */
export function resultKey(o: { prompt: string; variant: string; seed: number; guide?: boolean }): string {
  return `${o.variant}|${o.seed}|${o.guide ? 1 : 0}|${o.prompt}`;
}

/** What a run stores in params.extra.relight (Reuse and Retry put the rig back). */
export interface RelightExtra {
  lights: Light[];
  look?: LookId;
  seed: number;
  variant: string;
  guide: boolean;
  /** The words were typed, not written from the lights. */
  typed?: boolean;
}

export function relightExtraOf(extra: unknown): RelightExtra | null {
  const r = (extra as { relight?: unknown } | undefined)?.relight;
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const lights = sanitizeLights(o.lights);
  if (!lights.length) return null;
  return {
    lights,
    ...(getLook(o.look as string) && { look: o.look as LookId }),
    seed: typeof o.seed === "number" && Number.isFinite(o.seed) ? Math.abs(Math.trunc(o.seed)) % 2147483647 : 0,
    variant: typeof o.variant === "string" ? o.variant.slice(0, 32) : "",
    guide: o.guide === true,
    ...(o.typed === true && { typed: true }),
  };
}
