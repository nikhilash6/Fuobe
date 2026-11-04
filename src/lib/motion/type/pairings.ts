/**
 * Type pairings (pure): nine voices for Kinetic templates, each a hero face, an accent face, a face for small
 * details (corner facts, labels) and a body face, with the leading and tracking each is set at. A template picks one;
 * the brand kit decides the colours. Every face is hosted by Kinetic itself (faces.ts) under the SIL Open Font License.
 *
 * Tracking is in em (0.06 = 6 % of the size). It is the look of the face at rest, never a way to make words fit: a
 * layout that doesn't fit asks for shorter words instead. Case is never changed by code: `heroCase` says what the
 * showcase copy is written in, and the person's own words are set exactly as typed.
 */

import type { FontStyle } from "./faces";

export interface RoleFace {
  family: string;
  weight: number;
  style?: FontStyle;
  /** Line pitch as a share of the size. */
  leading: number;
  /** Letter spacing in em at rest. */
  tracking: number;
}

export type PairingId = "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7" | "T8" | "T9";

export interface Pairing {
  id: PairingId;
  name: string;
  /** What it suits. */
  moods: readonly string[];
  hero: RoleFace;
  /** One word of contrast (an italic, a script, a wide cut), or none. */
  accent: RoleFace | null;
  /** Tiny tracked details: corners, labels, indices. */
  meta: RoleFace;
  body: RoleFace;
  /** Prices, counts and stats (set in fixed-width cells by the layout). */
  figures: RoleFace;
  /** How the showcase copy for this voice is written (advice for writers; code never re-cases typed words). */
  heroCase: "caps" | "title" | "any";
  /** Tracking for a hero typed in capitals, where it differs (wide luxury caps). */
  heroCapsTracking?: number;
}

const face = (family: string, weight: number, leading: number, tracking = 0, style?: FontStyle): RoleFace => ({ family, weight, leading, tracking, ...(style && { style }) });

export const PAIRINGS: Record<PairingId, Pairing> = {
  T1: {
    id: "T1",
    name: "Editorial Bold",
    moods: ["fashion", "launch", "portfolio", "pitch"],
    hero: face("Kinetic Anton", 400, 0.9, 0.005),
    accent: face("Kinetic Instrument Serif", 400, 1, 0, "italic"),
    meta: face("Kinetic Geist Mono", 500, 1.2, 0.06),
    body: face("Kinetic Geist", 400, 1.3),
    figures: face("Kinetic Anton", 400, 0.92),
    heroCase: "caps",
  },
  T2: {
    id: "T2",
    name: "Poster Condensed",
    moods: ["sale", "sport", "event", "offer"],
    hero: face("Kinetic Big Shoulders Display", 900, 0.86),
    accent: face("Kinetic Archivo Condensed", 900, 0.9),
    meta: face("Kinetic Instrument Sans", 600, 1.2, 0.12),
    body: face("Kinetic Instrument Sans", 400, 1.3),
    figures: face("Kinetic Archivo Condensed", 900, 0.9),
    heroCase: "caps",
  },
  T3: {
    id: "T3",
    name: "Extended Statement",
    moods: ["tech", "agency", "saas", "launch"],
    hero: face("Kinetic Archivo Expanded", 800, 0.9, -0.01),
    accent: face("Kinetic Instrument Serif", 400, 1, 0, "italic"),
    meta: face("Kinetic Geist Mono", 500, 1.2, 0.06),
    body: face("Kinetic Inter Tight", 400, 1.3),
    figures: face("Kinetic Archivo Expanded", 800, 0.9, -0.01),
    heroCase: "any",
  },
  T4: {
    id: "T4",
    name: "Luxury Serif",
    moods: ["luxury", "fragrance", "jewellery", "hospitality"],
    hero: face("Kinetic Bodoni Moda Display", 600, 1, -0.005),
    accent: face("Kinetic Bodoni Moda Display", 600, 1, 0, "italic"),
    meta: face("Kinetic Inter Tight", 400, 1.2, 0.14),
    body: face("Kinetic Inter Tight", 300, 1.35),
    figures: face("Kinetic Bodoni Moda Display", 600, 1),
    heroCase: "title",
    heroCapsTracking: 0.25,
  },
  T5: {
    id: "T5",
    name: "Soft Beauty",
    moods: ["beauty", "skincare", "wellness"],
    hero: face("Kinetic Fraunces Soft", 400, 1, -0.01),
    accent: face("Kinetic Fraunces Soft", 400, 1, 0, "italic"),
    meta: face("Kinetic Manrope", 600, 1.2, 0.1),
    body: face("Kinetic Manrope", 400, 1.35),
    figures: face("Kinetic Fraunces Soft", 500, 1),
    heroCase: "title",
  },
  T6: {
    id: "T6",
    name: "Warm Table",
    moods: ["food", "drink", "cafe", "retail"],
    hero: face("Kinetic Fraunces Display", 900, 0.95, -0.01),
    accent: face("Kinetic Bricolage Display", 800, 0.95),
    meta: face("Kinetic Outfit", 500, 1.2, 0.1),
    body: face("Kinetic Outfit", 400, 1.35),
    figures: face("Kinetic Fraunces Display", 900, 0.95),
    heroCase: "title",
  },
  T7: {
    id: "T7",
    name: "Product Grotesk",
    moods: ["software", "finance", "dashboard", "data"],
    hero: face("Kinetic Bricolage Display", 800, 0.92, -0.01),
    accent: face("Kinetic Geist Mono", 500, 1.1),
    meta: face("Kinetic Geist Mono", 500, 1.2, 0.06),
    body: face("Kinetic Geist", 400, 1.35),
    figures: face("Kinetic Geist Mono", 500, 1),
    heroCase: "any",
  },
  T8: {
    id: "T8",
    name: "Collage Play",
    moods: ["playful", "kids", "cafe", "creator"],
    hero: face("Kinetic Dela Gothic One", 400, 0.9),
    accent: face("Kinetic Caveat", 600, 1),
    meta: face("Kinetic Space Mono", 400, 1.2, 0.06),
    body: face("Kinetic Space Mono", 400, 1.35),
    figures: face("Kinetic Dela Gothic One", 400, 0.95),
    heroCase: "any",
  },
  T9: {
    id: "T9",
    name: "Quiet Minimal",
    moods: ["minimal", "end card", "invitation", "report"],
    hero: face("Kinetic Gloock", 400, 1, 0),
    accent: face("Kinetic Instrument Serif", 400, 1, 0, "italic"),
    meta: face("Kinetic Instrument Sans", 500, 1.2, 0.14),
    body: face("Kinetic Instrument Sans", 400, 1.35),
    figures: face("Kinetic Gloock", 400, 1),
    heroCase: "title",
  },
};

export const PAIRING_IDS = Object.keys(PAIRINGS) as PairingId[];

/** Every face (family and style) a pairing draws with, for loading only those. */
export function pairingFaces(id: PairingId): { family: string; style: FontStyle }[] {
  const p = PAIRINGS[id];
  const seen = new Map<string, { family: string; style: FontStyle }>();
  for (const r of [p.hero, p.accent, p.meta, p.body, p.figures]) if (r) seen.set(`${r.family}|${r.style ?? "normal"}`, { family: r.family, style: r.style ?? "normal" });
  return [...seen.values()];
}

/** The pairing for a mood word ("beauty", "sale"…), or T1. */
export function pairingFor(mood: string): Pairing {
  const m = mood.trim().toLowerCase();
  return Object.values(PAIRINGS).find((p) => p.moods.includes(m)) ?? PAIRINGS.T1;
}

/** Whether typed words are all capitals (so a pairing's caps tracking applies). Nothing is re-cased. */
export const isAllCaps = (text: string): boolean => /\p{Lu}/u.test(text) && !/\p{Ll}/u.test(text);

/** The tracking a hero is set at for these typed words. */
export const heroTracking = (p: Pairing, text: string): number => (p.heroCapsTracking !== undefined && isAllCaps(text) ? p.heroCapsTracking : p.hero.tracking);
