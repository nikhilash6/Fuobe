/**
 * Frame sizes and rates (pure). A scene lays out in design units, 1080 on the frame's short side, so its text wraps the
 * same way in the preview, the export and a cover; the drawer scales design units to pixels. The preview's canvas keeps
 * a smaller backing store (`preview`), which never changes the export.
 */

export type SizePreset = "9:16" | "1:1" | "16:9" | "4:5";
export type SizeSpec = SizePreset | { w: number; h: number };

export const SIZE_PRESETS: Record<SizePreset, { w: number; h: number; preview: { w: number; h: number } }> = {
  "9:16": { w: 1080, h: 1920, preview: { w: 540, h: 960 } },
  "1:1": { w: 1080, h: 1080, preview: { w: 720, h: 720 } },
  "16:9": { w: 1920, h: 1080, preview: { w: 960, h: 540 } },
  "4:5": { w: 1080, h: 1350, preview: { w: 576, h: 720 } },
};

/** The shape of Marketing's gallery tiles (3:4): a template's cover is made at it, so the tile shows all of it. */
export const TILE_COVER = { w: 1080, h: 1440 } as const;

/**
 * A gallery tile's chips (its format top left, play top right, "Instant" bottom left) cover these shares of its height
 * at the smallest tile (a 360 px phone), with a little room: a cover made for the tile (`tileCover`) keeps its words and
 * its product between them.
 */
export const TILE_CHIPS = { top: 0.165, bottom: 0.15 } as const;

/** Whether a recipe makes a gallery tile's cover (showcaseRecipe with `cover`). */
export const tileCover = (r: { controls?: Record<string, unknown> }): boolean => r.controls?.cover === "tile";

/** The fps a clip may be made at (Kinetic's editor also offers 60). */
export const FPS_CHOICES = [24, 25, 30] as const;
export const KINETIC_FPS = [24, 25, 30, 60] as const;

/** Kinetic's custom sizes: even sides of 256 to 2160, at most 2,400,000 pixels. */
export const CUSTOM_SIZE = { min: 256, max: 2160, pixels: 2_400_000 } as const;

/** Why a custom size can't be used (null: it can). */
export function customSizeProblem(w: number, h: number): string | null {
  if (!Number.isInteger(w) || !Number.isInteger(h)) return "Use whole numbers";
  if (w % 2 || h % 2) return "Use even numbers";
  if (w < CUSTOM_SIZE.min || h < CUSTOM_SIZE.min || w > CUSTOM_SIZE.max || h > CUSTOM_SIZE.max) return `Each side from ${CUSTOM_SIZE.min} to ${CUSTOM_SIZE.max}`;
  if (w * h > CUSTOM_SIZE.pixels) return "At most 2.4 million pixels";
  return null;
}
export const DEFAULT_FPS = 30;

/** The pixels an export has. */
export function exportSize(size: SizeSpec): { w: number; h: number } {
  if (typeof size === "string") return { w: SIZE_PRESETS[size].w, h: SIZE_PRESETS[size].h };
  return { w: Math.round(size.w), h: Math.round(size.h) };
}

/** The design units a scene lays out in: the export's shape with 1080 on its short side. */
export function designSize(size: SizeSpec): { w: number; h: number } {
  const { w, h } = exportSize(size);
  const k = 1080 / Math.min(w, h);
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/** The most backing pixels a preview canvas gets (before the device pixel ratio cap). */
export function previewSize(size: SizeSpec): { w: number; h: number } {
  if (typeof size === "string") return SIZE_PRESETS[size].preview;
  const { w, h } = exportSize(size);
  const k = Math.min(1, 720 / Math.max(w, h));
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/** "9:16" for a preset, "720x1280" for a custom size. */
export const sizeLabel = (size: SizeSpec): string => (typeof size === "string" ? size : `${Math.round(size.w)}x${Math.round(size.h)}`);

/**
 * Bits a second for an export: 10 Mbps at 1080p and up, 6 Mbps below (× 1.5 above 30 fps, × 1.6 for High quality),
 * capped so the clip stays well under 95 MB.
 */
export function exportBitrate(size: SizeSpec, duration: number, o: { fps?: number; quality?: "standard" | "high" } = {}): number {
  const { w, h } = exportSize(size);
  const base = (Math.min(w, h) >= 1080 ? 10_000_000 : 6_000_000) * ((o.fps ?? 30) > 30 ? 1.5 : 1) * (o.quality === "high" ? 1.6 : 1);
  const cap = Math.floor((0.6 * 95 * 1024 * 1024 * 8) / Math.max(1, duration));
  return Math.round(Math.min(base, cap));
}

/** A size preset's name for menus and chips ("Feed 4:5"). */
export const SIZE_LABELS: Record<SizePreset, string> = { "9:16": "Story 9:16", "4:5": "Feed 4:5", "1:1": "Square 1:1", "16:9": "Wide 16:9" };
