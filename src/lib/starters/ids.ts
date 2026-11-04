/**
 * Every starter's id by studio, client-safe and tiny, for the proxy: a starter page whose id isn't here gets a real 404
 * (src/lib/record-pages.ts unknownStarterPage), and so does one with no real cover yet for anyone but the owner
 * (hiddenStarterPage). tests/starters-catalog.test.ts checks both match the catalog.
 */
import { templateCover, type TemplateGroup } from "@/lib/template-covers";
import type { StarterSurface } from "./types";

export const STARTER_IDS: Record<StarterSurface, readonly string[]> = {
  assist: ["assist.jewel-campaign", "assist.monaco-short", "assist.linen-lookbook", "assist.serum-ugc", "assist.boat-hotels"],
  library: ["library.pearl-earring", "library.namib-gown", "library.superstar", "library.perfume-storyboard"],
  cinema: ["cinema.riviera-night", "cinema.noir-perfume", "cinema.desert-couture"],
  storyboard: ["storyboard.perfume-ad", "storyboard.heist", "storyboard.capri-swim"],
  elements: ["elements.amara", "elements.highland-castle", "elements.solitaire-ring", "elements.gilded-salon", "elements.studio-voice"],
  faceless: ["faceless.boat-hotels", "faceless.couture-icons", "faceless.lost-empires"],
  "content-factory": ["cf.underwater-fashion-week", "cf.perfume-atelier", "cf.narcissus"],
  explainer: ["ex.couture-400-hours", "ex.riviera-light", "ex.perfume-notes"],
  ads: ["ads.maison-verre", "ads.studio-marlow"],
  "click-to-ad": ["c2a.eau-de-verre", "c2a.marlow-bag"],
  marketing: ["mk.perfume-moss", "mk.bag-packshot"],
};

/**
 * The starters shown with another cover that is always there until their own is made: a preset's (Starter.coverFrom),
 * an example's result or the starter's own published pictures (Starter.coverOf `example` / `files`).
 */
const BORROWED_COVER: ReadonlySet<string> = new Set([
  "mk.perfume-moss",
  "mk.bag-packshot",
  "library.namib-gown",
  "elements.amara",
  "elements.highland-castle",
  "elements.solitaire-ring",
  "elements.gilded-salon",
]);

/** The starters that borrow another tile's cover (Starter.coverOf `template`), shown once that one is published. */
const BORROWED_TILE: Readonly<Record<string, readonly [TemplateGroup, string]>> = {
  "assist.monaco-short": ["starters", "cinema.riviera-night"],
  "assist.boat-hotels": ["starters", "faceless.boat-hotels"],
  "storyboard.heist": ["examples", "storyboard-heist"],
  "library.pearl-earring": ["canvas", "effect-chain-pearl-earring"],
  "library.superstar": ["canvas", "effect-chain-superstar"],
  "library.perfume-storyboard": ["starters", "storyboard.perfume-ad"],
};

/** Whether a starter has a real cover, so visitors see it: its own (starters/<id>), or one it borrows. */
export function starterCovered(id: string): boolean {
  if (BORROWED_COVER.has(id) || templateCover("starters", id)) return true;
  const tile = Object.hasOwn(BORROWED_TILE, id) ? BORROWED_TILE[id] : undefined;
  return !!tile && !!templateCover(tile[0], tile[1]);
}
