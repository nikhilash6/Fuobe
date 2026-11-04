/**
 * Every scene's motion groups (pure): the named parts a person retimes in Kinetic's editor ("Number", "Caption",
 * "Logo"…), each a list of event id prefixes or event group names it takes. Every event of every scene belongs to
 * exactly one group (tests/kinetic-catalog.test.ts checks it at every size and length, with and without a logo and a
 * picture), so no visitor ever sees an internal id. Events of kind "camera" belong to their shot's Camera group.
 *
 * Kept apart from kinetic-catalog.ts so the scene wrappers read it without loading the Marketing catalogue.
 */

import type { MotionEvent } from "./tween";

export interface MotionGroupDef {
  id: string;
  /** What a visitor reads. */
  label: string;
  /** Event id prefixes ("cta" takes "cta" and "cta.pill") or event group names. */
  match: string[];
  /**
   * Retimed inside a scene drawn within this one (the Kinetic Headline's end card): its events here are copies that
   * already carry the timing, so the outer timeline doesn't retime them again.
   */
  inner?: true;
}

const END_CARD_GROUPS: MotionGroupDef[] = [
  { id: "ground", label: "Background", match: ["panel", "panels", "iris", "bloom"] },
  { id: "logo", label: "Logo", match: ["logo", "mark", "brand", "glint"] },
  { id: "headline", label: "Line", match: ["headline"] },
  { id: "cta", label: "Call to action", match: ["cta"] },
  { id: "site", label: "Web address", match: ["site"] },
];

/** The tiny facts on a poster's corners (web address, note, the arrow), one group in every poster scene. */
const DETAILS: MotionGroupDef = { id: "details", label: "Corner details", match: ["website", "corner", "foot", "note"] };
const LOGO: MotionGroupDef = { id: "logo", label: "Logo", match: ["brand"] };

/** By scene id ("end-card/…" scenes share one list). */
const GROUPS: Record<string, MotionGroupDef[]> = {
  "end-card": END_CARD_GROUPS,
  "marketing/kinetic-headline": [
    { id: "headline", label: "Headline", match: ["headline"] },
    { id: "highlight", label: "Highlight", match: ["mark"] },
    { id: "cta", label: "Call to action", match: ["cta", "pill"] },
    LOGO,
    DETAILS,
  ],
  "marketing/line-reveal": [
    { id: "outline", label: "Line drawing", match: ["trace", "arch"] },
    { id: "picture", label: "Picture", match: ["ground", "fill", "sweep"] },
    { id: "headline", label: "Headline", match: ["headline"] },
    { id: "cta", label: "Call to action", match: ["cta"] },
    LOGO,
    { ...DETAILS, match: ["website", "note"] },
  ],
  "marketing/starburst": [
    { id: "burst", label: "Pattern", match: ["halftone"] },
    { id: "picture", label: "Picture", match: ["product", "wiggle"] },
    { id: "badge", label: "Badge", match: ["badge", "sticker"] },
    { id: "headline", label: "Headline", match: ["headline", "squiggle"] },
    LOGO,
    DETAILS,
  ],
  "marketing/offer-badge": [
    { id: "badge", label: "Badge", match: ["badge", "offer", "ring"] },
    { id: "picture", label: "Picture", match: ["product", "squash", "sweep"] },
    { id: "headline", label: "Headline", match: ["headline"] },
    { id: "cta", label: "Call to action", match: ["cta", "pill"] },
    LOGO,
    DETAILS,
  ],
  "marketing/feature-cards": [
    { id: "headline", label: "Headline", match: ["headline"] },
    { id: "cards", label: "Cards", match: ["card", "num", "point1", "point2", "point3"] },
    LOGO,
    DETAILS,
  ],
  "marketing/stat-dashboard": [
    { id: "panel", label: "Dashboard", match: ["panel", "grid"] },
    { id: "chart", label: "Chart", match: ["spark", "area", "dot", "change"] },
    { id: "number", label: "Number", match: ["stat", "ghost"] },
    { id: "label", label: "Label", match: ["label"] },
    LOGO,
    DETAILS,
  ],
  "marketing/logo-sting": [
    { id: "name", label: "Name", match: ["brand"] },
    { id: "logo", label: "Logo", match: ["mark"] },
    { id: "tagline", label: "Tagline", match: ["tagline"] },
    DETAILS,
  ],
  "marketing/big-number": [
    { id: "number", label: "Number", match: ["stat"] },
    { id: "caption", label: "Caption", match: ["caption", "rule"] },
    { id: "highlight", label: "Highlight", match: ["mark"] },
    LOGO,
    DETAILS,
  ],
  "marketing/quote": [
    { id: "stars", label: "Stars", match: ["star"] },
    { id: "quote", label: "Quote", match: ["quote"] },
    { id: "name", label: "Name", match: ["name"] },
    { id: "picture", label: "Picture", match: ["panel", "seat", "sweep"] },
    LOGO,
    { ...DETAILS, match: ["corner", "note"] },
  ],
  "marketing/drop-countdown": [
    { id: "countdown", label: "Countdown", match: ["count"] },
    { id: "headline", label: "Headline", match: ["headline"] },
    { id: "light", label: "Light", match: ["bars", "rule"] },
    { id: "cta", label: "Call to action", match: ["cta", "pill"] },
    LOGO,
    { ...DETAILS, match: ["website", "corner", "foot", "when"] },
  ],
  "marketing/fragrance-reveal": [
    { id: "picture", label: "Picture", match: ["bottle", "spot"] },
    { id: "headline", label: "Headline", match: ["headline", "line", "rule"] },
    { id: "cta", label: "Call to action", match: ["cta"] },
    LOGO,
    DETAILS,
  ],
  "marketing/editorial-sale": [
    { id: "picture", label: "Picture", match: ["photo"] },
    { id: "headline", label: "Headline", match: ["headline"] },
    { id: "offer", label: "Offer", match: ["offer", "bar"] },
    { id: "cta", label: "Call to action", match: ["cta", "pill", "arrow"] },
    LOGO,
    { ...DETAILS, match: ["corner", "foot"] },
  ],
  "marketing/glass-spotlight": [
    { id: "picture", label: "Picture", match: ["product", "plinth", "rings"] },
    { id: "headline", label: "Headline", match: ["headline", "line", "rule"] },
    { id: "cta", label: "Call to action", match: ["cta"] },
    LOGO,
    DETAILS,
  ],
  "marketing/announcement": [
    { id: "picture", label: "Picture", match: ["leak", "lit"] },
    { id: "headline", label: "Headline", match: ["headline", "rule"] },
    { id: "facts", label: "Date and place", match: ["when", "place"] },
    { id: "cta", label: "Call to action", match: ["cta", "pill"] },
    LOGO,
    { ...DETAILS, match: ["corner", "foot"] },
  ],
  "marketing/lookbook": [
    { id: "headline", label: "Headline", match: ["headline", "accent", "line"] },
    LOGO,
    { ...DETAILS, match: ["website", "note"] },
  ],
  "marketing/stat-stack": [
    { id: "numbers", label: "Numbers", match: ["stat1", "stat2", "stat3", "idx"] },
    { id: "labels", label: "Labels", match: ["label1", "label2", "label3", "rule", "mark"] },
    LOGO,
    DETAILS,
  ],
  "marketing/testimonials": [
    { id: "quote", label: "Quote", match: ["quote1", "name1"] },
    { id: "cards", label: "Cards", match: ["card", "quote2", "quote3", "name2", "name3"] },
    { id: "stars", label: "Stars", match: ["star"] },
    LOGO,
    DETAILS,
  ],
};

/** The scenes that take the person's own clip under their words. */
export const CLIP_SCENES: readonly string[] = ["marketing/kinetic-headline", "marketing/big-number", "marketing/quote", "marketing/logo-sting", "marketing/feature-cards"];

/** How many shots (windows between cuts) a scene has. */
const WINDOWS: Record<string, number> = {};

/** A scene's motion groups (the end card's five styles share one list). */
export function groupDefsFor(sceneId: string): MotionGroupDef[] {
  return GROUPS[sceneId] ?? (sceneId.startsWith("end-card/") ? GROUPS["end-card"] : []);
}

export const windowCountFor = (sceneId: string): number => WINDOWS[sceneId] ?? 1;

/** The Camera group's id in shot `w` (0-based): "camera", then "camera-2"… */
export const cameraGroupId = (w: number): string => (w === 0 ? "camera" : `camera-${w + 1}`);

/** Every group id a scene can have (its own and one Camera group per shot). */
export function groupIdsFor(sceneId: string): string[] {
  const n = windowCountFor(sceneId);
  return [...groupDefsFor(sceneId).map((g) => g.id), ...Array.from({ length: n }, (_, i) => cameraGroupId(i))];
}

const takes = (m: string, e: MotionEvent) => e.id === m || e.id.startsWith(`${m}.`) || e.group === m;

/** The ids of every group that takes an event (exactly one for a well-formed scene; "camera" for a camera event). */
export function groupMatches(defs: readonly MotionGroupDef[], e: MotionEvent): string[] {
  if (e.kind === "camera") return ["camera"];
  return defs.filter((g) => g.match.some((m) => takes(m, e))).map((g) => g.id);
}
