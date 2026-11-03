/**
 * The larger copies of a preset cover (preset-hd.generated.ts, made by scripts/gen-preset-hd.mjs): a cover's still or
 * clip URL as the cards hold it (/previews/presets/<id>.jpg, /previews/presets/peak/<id>.jpg, /previews/presets/<id>.mp4)
 * and the copies a box can choose from by its size and the screen's pixel ratio. A cover without copies has none, and
 * its card keeps its 320 and 512 px files.
 */
import type { Sized } from "@/lib/media-pick";
import { PRESET_HD } from "@/lib/preset-hd.generated";

/** The published copies' width (scripts/eval/lib/covers.mjs CLIP_PX), and the small stills' (thumbOf). */
export const PUBLISHED_PX = 512;
export const SMALL_PX = 320;

const STILL = /^\/previews\/presets\/(peak\/)?([a-z0-9-]+)\.jpg(?:\?|$)/;
const CLIP = /^\/previews\/presets\/([a-z0-9-]+)\.mp4(?:\?|$)/;

/** A still's choices for a `<picture>`: its AVIF copies, and its JPEG ones (the 320 and 512 px files first). */
export interface StillSources {
  avif: string;
  jpeg: string;
}

/** The srcsets of a cover's still with larger copies, or undefined. `thumb` is its 320 px JPEG (thumbOf). */
export function presetStillSources(still: string, thumb: string): StillSources | undefined {
  const m = STILL.exec(still);
  const hd = m && PRESET_HD[m[2]];
  if (!m || !hd) return undefined;
  const at = (w: number, ext: string) => `/previews/presets/hd/${w}/${m[1] ?? ""}${m[2]}.${ext}?v=${hd.v}`;
  return {
    avif: [SMALL_PX, ...hd.w].map((w) => `${at(w, "avif")} ${w}w`).join(", "),
    jpeg: [`${thumb} ${SMALL_PX}w`, `${still} ${PUBLISHED_PX}w`, ...hd.w.map((w) => `${at(w, "jpg")} ${w}w`)].join(", "),
  };
}

/** A cover clip's copies by width (its own 512 px file first), or just itself when it has none. */
export function presetClipCopies(video: string): Sized[] {
  const m = CLIP.exec(video);
  const hd = m && PRESET_HD[m[1]];
  if (!m || !hd) return [{ src: video, w: PUBLISHED_PX }];
  return [{ src: video, w: PUBLISHED_PX }, ...hd.w.map((w) => ({ src: `/previews/presets/hd/${w}/${m[1]}.mp4?v=${hd.v}`, w }))];
}

/** Every copy a cover has (bare URLs): its clip and stills at each width, its peak's when it has one, and its 320 px AVIFs. */
export function presetHdFiles(id: string, hasPeak: boolean): string[] {
  const hd = PRESET_HD[id];
  if (!hd) return [];
  const at = (w: number, ext: string, peak = false) => `/previews/presets/hd/${w}/${peak ? "peak/" : ""}${id}.${ext}`;
  return [
    ...hd.w.flatMap((w) => [at(w, "mp4"), at(w, "avif"), at(w, "jpg"), ...(hasPeak ? [at(w, "avif", true), at(w, "jpg", true)] : [])]),
    at(SMALL_PX, "avif"),
    ...(hasPeak ? [at(SMALL_PX, "avif", true)] : []),
  ];
}
