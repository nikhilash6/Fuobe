/**
 * Every starter's id by studio, client-safe and tiny, for the proxy: a starter page whose id isn't here gets a real 404
 * (src/lib/record-pages.ts unknownStarterPage), and so does one with no real cover yet for anyone but the owner
 * (hiddenStarterPage). tests/starters-catalog.test.ts checks both match the catalog.
 */
import { templateCover } from "@/lib/template-covers";
import type { StarterSurface } from "./types";

export const STARTER_IDS: Record<StarterSurface, readonly string[]> = {
  faceless: ["faceless.boat-hotels", "faceless.couture-icons", "faceless.lost-empires"],
  "content-factory": ["cf.underwater-fashion-week", "cf.perfume-atelier", "cf.narcissus"],
  explainer: ["ex.couture-400-hours", "ex.riviera-light", "ex.perfume-notes"],
  ads: ["ads.maison-verre", "ads.studio-marlow"],
  "click-to-ad": ["c2a.eau-de-verre", "c2a.marlow-bag"],
  marketing: ["mk.perfume-moss", "mk.bag-packshot"],
};

/** The starters shown with another cover until their own is made (Starter.coverFrom in the catalog). */
const BORROWED_COVER: ReadonlySet<string> = new Set(["mk.perfume-moss", "mk.bag-packshot"]);

/** Whether a starter has a real cover, so visitors see it: its own (starters/<id>), or one it borrows. */
export const starterCovered = (id: string): boolean => BORROWED_COVER.has(id) || !!templateCover("starters", id);
