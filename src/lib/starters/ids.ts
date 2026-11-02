/**
 * Every starter's id by studio, client-safe and tiny, for the proxy: a starter page whose id isn't here gets a real 404
 * (src/lib/record-pages.ts unknownStarterPage). tests/starters-catalog.test.ts checks it matches the catalog.
 */
import type { StarterSurface } from "./types";

export const STARTER_IDS: Record<StarterSurface, readonly string[]> = {
  faceless: ["faceless.boat-hotels", "faceless.couture-icons", "faceless.lost-empires"],
  "content-factory": ["cf.underwater-fashion-week", "cf.perfume-atelier", "cf.narcissus"],
  explainer: ["ex.couture-400-hours", "ex.riviera-light", "ex.perfume-notes"],
  ads: ["ads.maison-verre", "ads.studio-marlow"],
  "click-to-ad": ["c2a.eau-de-verre", "c2a.marlow-bag"],
  marketing: ["mk.perfume-moss", "mk.bag-packshot"],
};
