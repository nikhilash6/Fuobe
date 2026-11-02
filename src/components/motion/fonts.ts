"use client";

import { ensureFont } from "@/components/ads/render";

/**
 * The brand's fonts, ready to draw with. The preview draws as soon as it can (a fallback face until the brand font
 * arrives). An export waits for every weight it uses, with the very letters it sets (so accents and other scripts get
 * their part of the font too), and stops if the font isn't there: a clip is never made in the wrong typeface.
 */

export const FONT_NOT_LOADED = "Your brand font didn't load. Check your connection and try again.";

const WEIGHTS = [400, 500, 700, 800];
const SYSTEM = /^(system-ui|arial|helvetica|georgia|times new roman|sans-serif|serif|verdana|tahoma|trebuchet ms|courier new)$/i;

/** Loads `families` (Google Fonts, 400–800); with `strict`, throws FONT_NOT_LOADED unless each is really there. */
export async function fontsReady(families: (string | undefined)[], opts: { strict?: boolean; text?: string } = {}): Promise<void> {
  if (typeof document === "undefined") return;
  const list = [...new Set(families.filter((f): f is string => !!f?.trim()).map((f) => f.trim()))];
  await Promise.all(list.map((f) => ensureFont(f, opts.strict ? 8000 : 2500)));
  const sample = opts.text?.trim() || "Aa";
  await Promise.all(list.flatMap((f) => WEIGHTS.map((w) => document.fonts.load(`${w} 32px "${f}"`, sample).catch(() => []))));
  if (!opts.strict) return;
  for (const f of list) {
    if (SYSTEM.test(f)) continue;
    // A family with no face at all (its stylesheet didn't come) would "check" fine: look for a loaded face first.
    const faces = [...document.fonts].filter((face) => face.family.replace(/["']/g, "") === f);
    if (!faces.some((face) => face.status === "loaded")) throw new Error(FONT_NOT_LOADED);
    if (!WEIGHTS.every((w) => document.fonts.check(`${w} 32px "${f}"`, sample))) throw new Error(FONT_NOT_LOADED);
  }
}
