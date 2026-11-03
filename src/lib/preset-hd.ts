/**
 * The larger copies of a preset cover (preset-hd.generated.ts, made by scripts/gen-preset-hd.mjs): a cover's still or
 * clip URL as the cards hold it (/previews/presets/<id>.jpg, /previews/presets/peak/<id>.jpg, /previews/presets/<id>.mp4,
 * or the frame its examples rest on, /examples/<id>/<n>/out-peak.jpg) and the copies a box can choose from by its size
 * and the screen's pixel ratio. A cover without copies has none, and its card keeps its published files.
 */
import type { Sized } from "@/lib/media-pick";
import { PRESET_HD } from "@/lib/preset-hd.generated";

/** The published clips' width (scripts/eval/lib/covers.mjs CLIP_PX), and the small stills' (thumbOf). */
export const PUBLISHED_PX = 512;
export const SMALL_PX = 320;

const STILL = /^\/previews\/presets\/(peak\/)?([a-z0-9-]+)\.jpg(?:\?|$)/;
const CLIP = /^\/previews\/presets\/([a-z0-9-]+)\.mp4(?:\?|$)/;

/** The preset whose examples rest on a frame (its published URL, bare), for the covers that have a copy of it. */
const REST_OF = new Map(Object.entries(PRESET_HD).flatMap(([id, e]) => (e.rest ? [[e.rest, id] as const] : [])));

/** A still's choices for a `<picture>`: its AVIF copies, and its JPEG ones (the published files first). */
export interface StillSources {
  avif: string;
  jpeg: string;
}

/** Which cover a still URL is, and which of its stills: its poster, its peak frame or its examples' resting frame. */
function stillOf(still: string): { id: string; kind: "poster" | "peak" | "rest" } | undefined {
  const m = STILL.exec(still);
  if (m) return PRESET_HD[m[2]] ? { id: m[2], kind: m[1] ? "peak" : "poster" } : undefined;
  const id = REST_OF.get(still.split("?")[0]);
  return id ? { id, kind: "rest" } : undefined;
}

/** Whether a still has larger copies (presetStillSources gives them). */
export const hasHdStill = (still: string) => !!stillOf(still);

/** The srcsets of a cover's still with larger copies, or undefined. `thumb` is its 320 px JPEG (thumbOf), when it has one. */
export function presetStillSources(still: string, thumb?: string): StillSources | undefined {
  const of = stillOf(still);
  if (!of) return undefined;
  const hd = PRESET_HD[of.id];
  const dir = of.kind === "poster" ? "" : `${of.kind}/`;
  const at = (w: number, ext: string) => `/previews/presets/hd/${w}/${dir}${of.id}.${ext}?v=${hd.v}`;
  // The examples' resting frame has no 320 px JPEG beside it; a still cover is published wider than a clip's.
  const small = of.kind !== "rest" && thumb ? [`${thumb} ${SMALL_PX}w`] : [];
  return {
    avif: [SMALL_PX, ...hd.w].map((w) => `${at(w, "avif")} ${w}w`).join(", "),
    jpeg: [...small, `${still} ${hd.still ?? PUBLISHED_PX}w`, ...hd.w.map((w) => `${at(w, "jpg")} ${w}w`)].join(", "),
  };
}

/** A cover clip's copies by width (its own 512 px file first), or just itself when it has none. */
export function presetClipCopies(video: string): Sized[] {
  const m = CLIP.exec(video);
  const hd = m && PRESET_HD[m[1]];
  if (!m || !hd || hd.still) return [{ src: video, w: PUBLISHED_PX }];
  return [{ src: video, w: PUBLISHED_PX }, ...hd.w.map((w) => ({ src: `/previews/presets/hd/${w}/${m[1]}.mp4?v=${hd.v}`, w }))];
}

/** Every copy a cover has (bare URLs): its clip and stills at each width, its peak's and resting frame's when it has them, and its 320 px AVIFs. */
export function presetHdFiles(id: string, hasPeak: boolean): string[] {
  const hd = PRESET_HD[id];
  if (!hd) return [];
  const kinds = ["", ...(hd.still ? [] : [...(hasPeak ? ["peak/"] : []), ...(hd.rest ? ["rest/"] : [])])];
  const at = (w: number, ext: string, dir = "") => `/previews/presets/hd/${w}/${dir}${id}.${ext}`;
  return [
    ...hd.w.flatMap((w) => [...(hd.still ? [] : [at(w, "mp4")]), ...kinds.flatMap((k) => [at(w, "avif", k), at(w, "jpg", k)])]),
    ...kinds.map((k) => at(SMALL_PX, "avif", k)),
  ];
}
