/**
 * Moodboards, pure logic shared by the page, the composer chip and the server (src/server/moodboards.ts):
 * The researched limits and exact copy, the status a board shows while its cover job runs, which
 * images best represent a board, and the 2×2 collages open-source style models take.
 */
import { coverTone, hueOf, spreadHue, type CoverTone } from "@/lib/catalog/packs";
import { lookCard, lookSet, type SoulLookCard } from "@/lib/catalog/soul-cards";
import { kmeans, suggestName, type MoodboardPick, type MoodboardStatus, type RGB } from "@/lib/catalog/palettes";
import type { Engine, Generation } from "@/lib/catalog/types";
import { templateCover, type CoverFrame } from "@/lib/template-covers";

export interface Moodboard {
  id: string;
  name: string;
  /** All images, most representative first. */
  images: string[];
  /** The 10 most representative (Recraft styles, cloud style references). */
  refs: string[];
  /** 1–2 collages of 4 images each (open style-reference models take 1–2 images). */
  collages: string[];
  engine: Engine;
  status: MoodboardStatus;
  cover: string | null;
  /** Recraft V4 style id, once a real (not demo) cover job made one. */
  styleId: string | null;
  error: string | null;
  generationId: string | null;
  /** The style element trained from this board (a Z-Image Turbo LoRA, its Fuobe look); "demo" = a demo training's stand-in. */
  lora: { elementId: string; handle: string; status: "none" | "training" | "ready" | "failed" | "demo" } | null;
  createdAt: number;
}

export interface CuratedMoodboard {
  id: string;
  name: string;
  category: string;
  description: string;
  /** The drawn cover: a hue spread by the look's place in its set, and a treatment from its words. */
  hue: number;
  tone?: CoverTone;
  /** Soul's styles: every category the preset is in (Soul 2.0's looks have one). */
  categories?: string[];
  /** Whose look: Soul 2.0's looks (the default) or Soul's. */
  source?: CuratedSource;
  /** The look's real cover (template-covers.ts, "soul/<look id>") and its 320 px copy; without one the cover is drawn. */
  preview?: CoverFrame;
}

/** The curated sets: Fuobe Soul's Soul 2.0 looks and its Soul (v1) looks. */
export type CuratedSource = "soul-v1" | "soul-v2";

const toCurated = (c: SoulLookCard, i: number): CuratedMoodboard => {
  const cover = templateCover("soul", c.id)?.frames[0];
  return {
    id: c.id,
    name: c.name,
    category: c.categories[0] ?? "All presets",
    categories: c.categories,
    description: c.description,
    hue: spreadHue(i),
    tone: coverTone(c.name, c.description),
    ...(c.family === "v1" && { source: "soul-v1" as const }),
    ...(cover && { preview: cover }),
  };
};

/**
 * The curated sets of the Moodboard panel: Fuobe Soul's looks (src/lib/catalog/soul-cards.ts), Soul 2.0's 33 and
 * Soul's 106. On Fuobe Soul a pick is the look itself (its words and LoRAs); on every other model its words.
 */
export const CURATED_SETS: Record<CuratedSource, CuratedMoodboard[]> = {
  "soul-v2": lookSet("v2").items.map(toCurated),
  "soul-v1": lookSet("v1").items.map(toCurated),
};
export const SOUL_STYLES = CURATED_SETS["soul-v1"];

const LOOKS = new Map([...CURATED_SETS["soul-v2"], ...CURATED_SETS["soul-v1"]].map((c) => [c.id, c]));
/** A curated look's cover by id (the composer chip's dot, the look pickers): its real cover, else drawn; unknown ids get a hue of their own. */
export const curatedLook = (id: string): { hue: number; tone: CoverTone; preview?: CoverFrame } => {
  const c = LOOKS.get(lookCard(id)?.id ?? id);
  return c ? { hue: c.hue, tone: c.tone ?? "plain", ...(c.preview && { preview: c.preview }) } : { hue: hueOf(id), tone: "plain" };
};

/** The category pills of each curated set ("All presets" first). */
export const CURATED_TABS: Record<CuratedSource, string[]> = {
  "soul-v2": ["All presets", ...lookSet("v2").categories],
  "soul-v1": ["All presets", ...lookSet("v1").categories],
};

export const inCuratedTab = (c: Pick<CuratedMoodboard, "category" | "categories">, tab: string) => tab === "All presets" || (c.categories ?? [c.category]).includes(tab);

/** A Fuobe Soul look as a curated pick, by its id (or legacy style id: a run or a link saved before the Originals). */
export function soulPick(id: string): MoodboardPick | undefined {
  const c = lookCard(id);
  return c && { id: c.id, kind: "curated", name: c.name, description: c.description, status: "complete", ...(c.family === "v1" && { source: "soul-v1" as const }) };
}

export const MOODBOARD_LIMITS = { min: 5, max: 80, minPx: 256, nameMax: 100, refs: 10, collages: 2 } as const;

/** The researched copy, word for word. */
export const COPY = {
  title: "CREATE YOUR MOODBOARD",
  subtitle: "Turn your references into a focused moodboard that defines style, tone, consistent details, and creative direction.",
  recommended: "20+ photos, one cohesive style, no faces.",
  avoid: "Faces, mixed styles, blurry or low-quality images.",
  tooFew: "Upload at least 5 photos to continue.",
  tooMany: "Maximum images per moodboard is 80",
  duplicate: "This image is already added",
  noName: "Please enter a moodboard name",
  longName: "Name is too long, maximum 100 characters allowed",
  tooSmall: "Image dimensions too small: minimum size is 256x256px.",
  notReady: "This moodboard is still training. Try again once it is ready.",
  nameLabel: "Moodboard name",
  namePlaceholder: "Enter moodboard name",
  deleteTitle: (name: string) => `Delete moodboard ${name}?`,
  deleteBody: "This cannot be undone.",
  deleteYes: "Yes, delete forever",
  deleteNo: "No, keep them",
} as const;

export const STATUS_LABEL: Record<MoodboardStatus, string> = {
  queued: "In queue",
  running: "In progress",
  cover: "Preparing cover",
  complete: "Complete",
  failed: "Failed",
};

export const COVER_PROMPT = (name: string) =>
  `A moodboard cover for “${name}”: one striking, purely visual image that sums up this style — its palette, light, texture, grain and mood.`;

/** What stops a board from being saved, in the parity research's words, or null. */
export function moodboardError(b: { name: string; images: string[] }): string | null {
  if (b.images.length < MOODBOARD_LIMITS.min) return COPY.tooFew;
  if (b.images.length > MOODBOARD_LIMITS.max) return COPY.tooMany;
  if (!b.name.trim()) return COPY.noName;
  if (b.name.trim().length > MOODBOARD_LIMITS.nameMax) return COPY.longName;
  return null;
}

/** Why one picked image can't join the board, or null. */
export function imageProblem(img: { width: number; height: number; key: string }, existing: string[]): string | null {
  if (existing.includes(img.key)) return COPY.duplicate;
  if (img.width < MOODBOARD_LIMITS.minPx || img.height < MOODBOARD_LIMITS.minPx) return COPY.tooSmall;
  return null;
}

/** The board's status from its cover job: queued → running → preparing the cover (past halfway) → done. */
export function moodboardStatus(g: Pick<Generation, "status" | "progress" | "error"> | null): { status: MoodboardStatus; error?: string } {
  if (!g) return { status: "failed", error: "The cover job is gone — retry to make it again" };
  if (g.status === "queued") return { status: "queued" };
  if (g.status === "running") return { status: (g.progress ?? 0) >= 0.5 ? "cover" : "running" };
  if (g.status === "succeeded") return { status: "complete" };
  return { status: "failed", error: g.error ?? (g.status === "canceled" ? "Canceled" : "The cover job didn't finish") };
}

// ---------------------------------------------------------------------------
// Which images represent the board

/** A small colour signature per image: a normalised 3×3×3 RGB histogram (27 numbers summing to 1). */
export function colorFeature(pixels: RGB[]): number[] {
  const h = new Array<number>(27).fill(0);
  for (const [r, g, b] of pixels) h[Math.min(2, Math.floor(r / 86)) * 9 + Math.min(2, Math.floor(g / 86)) * 3 + Math.min(2, Math.floor(b / 86))]++;
  const n = pixels.length || 1;
  return h.map((v) => v / n);
}

const l1 = (a: number[], b: number[]) => a.reduce((s, v, i) => s + Math.abs(v - (b[i] ?? 0)), 0);

/**
 * Images in order of how well they represent the board (facility location, greedy): first the most
 * typical image, then each next one that brings the rest closest to a chosen one. So the first 10
 * cover the board's range instead of ten near-copies. Returns indexes into `features`.
 */
export function representativeOrder(features: number[][]): number[] {
  const n = features.length;
  if (n <= 1) return features.map((_, i) => i);
  const d = features.map((a) => features.map((b) => l1(a, b)));
  const chosen: number[] = [];
  const best = new Array<number>(n).fill(Infinity);
  while (chosen.length < n) {
    let pick = -1;
    let cost = Infinity;
    for (let c = 0; c < n; c++) {
      if (chosen.includes(c)) continue;
      let total = 0;
      for (let i = 0; i < n; i++) total += Math.min(best[i], d[c][i]);
      // Ties: keep the earlier image (the order the user added them).
      if (total < cost - 1e-12) {
        cost = total;
        pick = c;
      }
    }
    chosen.push(pick);
    for (let i = 0; i < n; i++) best[i] = Math.min(best[i], d[pick][i]);
  }
  return chosen;
}

/** A name to start from, from the board's colours ("Teal Dusk"). */
export function suggestMoodboardName(pixels: RGB[]): string {
  const clusters = kmeans(pixels, 5, { seed: 3 });
  return clusters.length ? suggestName(clusters.map((c) => c.color), clusters[0].color) : "My moodboard";
}

/** Which images go in each 2×2 collage: groups of 4 from the representative order, at most 2 collages. */
export function collageGroups<T>(ordered: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < Math.min(ordered.length, 4 * MOODBOARD_LIMITS.collages); i += 4) {
    const g = ordered.slice(i, i + 4);
    // A collage needs a full grid: a short last group borrows from the start.
    while (g.length < 4 && ordered.length >= 4) g.push(ordered[g.length]);
    if (g.length) out.push(g);
  }
  return out;
}

/** Cover-crop a w×h image into a cell (source rect). */
export function coverCrop(w: number, h: number, cellW: number, cellH: number): { sx: number; sy: number; sw: number; sh: number } {
  const scale = Math.max(cellW / w, cellH / h);
  const sw = cellW / scale;
  const sh = cellH / scale;
  return { sx: (w - sw) / 2, sy: (h - sh) / 2, sw, sh };
}

/** What the composer keeps of a board. */
export function toPick(m: Moodboard): MoodboardPick {
  return {
    id: m.id,
    kind: "personal",
    name: m.name,
    status: m.status,
    cover: m.cover,
    refs: m.refs,
    collages: m.collages,
    styleId: m.styleId,
    loraHandle: m.lora?.status === "ready" ? m.lora.handle : null,
  };
}

export function curatedPick(c: CuratedMoodboard): MoodboardPick {
  return { id: c.id, kind: "curated", name: c.name, description: c.description, status: "complete", ...(c.source === "soul-v1" && { source: c.source }) };
}
