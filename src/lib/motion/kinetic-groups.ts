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

/** By scene id ("end-card/…" scenes share one list). */
const GROUPS: Record<string, MotionGroupDef[]> = {
  "end-card": END_CARD_GROUPS,
  "marketing/kinetic-headline": [
    { id: "words", label: "Words", match: ["word", "mark", "words"] },
    { id: "wipe", label: "Wipe", match: ["panel"] },
    // The same ids as the end card's own groups: the card inside the headline is retimed by them too.
    { id: "logo", label: "Logo", match: ["card.logo", "card.brand", "card.mark"], inner: true },
    { id: "cta", label: "Call to action", match: ["card.cta"], inner: true },
    { id: "site", label: "Web address", match: ["card.site"], inner: true },
  ],
  "marketing/line-reveal": [
    { id: "outline", label: "Line drawing", match: ["trace", "arch"] },
    { id: "picture", label: "Picture", match: ["ground", "fill", "shadow"] },
    { id: "headline", label: "Headline", match: ["head"] },
    { id: "cta", label: "Call to action", match: ["cta"] },
    { id: "brand", label: "Logo", match: ["brand"] },
  ],
  "marketing/starburst": [
    { id: "burst", label: "Starburst", match: ["rays", "halo"] },
    { id: "picture", label: "Picture", match: ["drop", "spin", "shadow"] },
    { id: "badge", label: "Badge", match: ["badge"] },
    { id: "headline", label: "Headline", match: ["band", "head"] },
  ],
  "marketing/offer-badge": [
    { id: "badge", label: "Badge", match: ["badge"] },
    { id: "picture", label: "Picture", match: ["slide", "shadow"] },
    { id: "headline", label: "Headline", match: ["head"] },
    { id: "cta", label: "Call to action", match: ["cta"] },
  ],
  "marketing/feature-cards": [
    { id: "headline", label: "Headline", match: ["head"] },
    { id: "cards", label: "Cards", match: ["card", "check"] },
    { id: "brand", label: "Logo", match: ["brand"] },
  ],
  "marketing/stat-dashboard": [
    { id: "panel", label: "Dashboard", match: ["panel", "grid"] },
    { id: "chart", label: "Chart", match: ["bar", "bars", "line", "area", "dot"] },
    { id: "number", label: "Number", match: ["count"] },
    { id: "label", label: "Label", match: ["label"] },
    { id: "brand", label: "Logo", match: ["brand"] },
  ],
  "marketing/logo-sting": [
    { id: "lines", label: "Lines", match: ["lines"] },
    { id: "shapes", label: "Shapes", match: ["shard"] },
    { id: "logo", label: "Logo", match: ["flash", "ring", "settle", "glint"] },
    { id: "tagline", label: "Tagline", match: ["tagline"] },
  ],
  "marketing/big-number": [
    { id: "number", label: "Number", match: ["count", "stat"] },
    { id: "caption", label: "Caption", match: ["cap", "caption"] },
    { id: "mark", label: "Logo", match: ["mark"] },
  ],
  "marketing/quote": [
    { id: "stars", label: "Stars", match: ["outline", "star", "stars"] },
    { id: "quote", label: "Quote", match: ["line", "quote"] },
    { id: "name", label: "Name", match: ["rule", "name"] },
    { id: "brand", label: "Logo", match: ["brand"] },
  ],
};

/** The scenes that take the person's own clip under their words. */
export const CLIP_SCENES: readonly string[] = ["marketing/kinetic-headline", "marketing/big-number", "marketing/quote", "marketing/logo-sting", "marketing/feature-cards"];

/** How many shots (windows between cuts) a scene has. */
const WINDOWS: Record<string, number> = { "marketing/kinetic-headline": 2 };

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
