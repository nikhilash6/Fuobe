/**
 * Kinetic Motion's own type faces (pure): display and text faces under the SIL Open Font License, cut to the
 * instances the type pairings use (an optical size, a width, a softness) and subset to Latin, served from
 * /fonts/kinetic/ next to their licences. Built by scripts/kinetic/build-fonts.py from scripts/kinetic/fonts.json.
 *
 * A page loads only the faces its template uses (src/components/motion/kinetic-fonts.ts). Canvas text names a face
 * by its family, weight and style. Every family is named "Kinetic …" ("Kinetic Fraunces Soft"), so a brand kit that
 * picks the same font from the web-font service keeps that service's weights and scripts.
 */

import { fallbackFor } from "@/components/ads/layout";
import { KINETIC_FACES, KINETIC_UNICODE_RANGE } from "./faces.generated";

export { KINETIC_FACES, KINETIC_UNICODE_RANGE };

export interface KineticFace {
  id: string;
  family: string;
  style: "normal" | "italic";
  /** The weights the file covers (a variable face: a range). */
  weight: [number, number];
  /** Path under the site's root. */
  file: string;
  /** Content hash, for caching. */
  v: string;
  bytes: number;
  /** The licence text that ships with it. */
  licence: string;
}

export type FontStyle = "normal" | "italic";

/** Every family Kinetic hosts itself. */
export const KINETIC_FAMILIES: ReadonlySet<string> = new Set(KINETIC_FACES.map((f) => f.family));

/** Whether Kinetic hosts this family (so no web-font service is asked for it). */
export const isKineticFamily = (family: string | undefined): boolean => !!family && KINETIC_FAMILIES.has(family.trim());

/** A face's address with its version. */
export const faceUrl = (f: KineticFace): string => `${f.file}?v=${f.v}`;

/** The files that draw these families (every weight and style each has), and nothing else. */
export function facesOf(families: Iterable<string | { family: string; style?: FontStyle } | null | undefined>): KineticFace[] {
  const want = new Map<string, Set<FontStyle> | null>();
  for (const f of families) {
    if (!f) continue;
    const family = (typeof f === "string" ? f : f.family).trim();
    if (!KINETIC_FAMILIES.has(family)) continue;
    const style = typeof f === "string" ? undefined : f.style;
    if (!style) want.set(family, null);
    else if (want.get(family) !== null) want.set(family, new Set([...(want.get(family) ?? []), style]));
  }
  return KINETIC_FACES.filter((f) => want.has(f.family) && (want.get(f.family) === null || want.get(f.family)!.has(f.style)));
}

/** The nearest weight a family has (a static face draws at its one weight; asking for another would fake it). */
export function weightFor(family: string, weight: number, style: FontStyle = "normal"): number {
  const faces = KINETIC_FACES.filter((f) => f.family === family && f.style === style);
  if (!faces.length) return weight;
  let best = weight;
  let gap = Infinity;
  for (const f of faces) {
    const w = Math.min(f.weight[1], Math.max(f.weight[0], weight));
    if (Math.abs(w - weight) < gap) {
      gap = Math.abs(w - weight);
      best = w;
    }
  }
  return best;
}

/** A CSS font for canvas text: style, weight, size (whole pixels, as the layout measures) and the family's fallback. */
export function fontOf(family: string, size: number, weight = 400, style: FontStyle = "normal"): string {
  return `${style === "italic" ? "italic " : ""}${weight} ${Math.round(size)}px "${family.replace(/"/g, "")}", ${fallbackFor(family)}`;
}
