/**
 * Every Kinetic Motion scene by id, loaded only when a page plays or renders it, and the type faces each one draws
 * with (known before the scene loads, so its fonts are fetched alongside it).
 */

import type { Scene } from "./scene";
import { pairingFaces, type PairingId } from "./type/pairings";

const LOADERS: Record<string, () => Promise<{ default: Scene }>> = {
  "end-card/draw-on": () => import("./scenes/end-card/draw-on"),
  "end-card/rise": () => import("./scenes/end-card/rise"),
  "end-card/iris": () => import("./scenes/end-card/iris"),
  "end-card/split": () => import("./scenes/end-card/split"),
  "end-card/glint": () => import("./scenes/end-card/glint"),
  "marketing/kinetic-headline": () => import("./scenes/marketing/kinetic-headline"),
  "marketing/line-reveal": () => import("./scenes/marketing/line-reveal"),
  "marketing/logo-sting": () => import("./scenes/marketing/logo-sting"),
  "marketing/feature-cards": () => import("./scenes/marketing/feature-cards"),
  "marketing/stat-dashboard": () => import("./scenes/marketing/stat-dashboard"),
  "marketing/starburst": () => import("./scenes/marketing/starburst"),
  "marketing/offer-badge": () => import("./scenes/marketing/offer-badge"),
  "marketing/big-number": () => import("./scenes/marketing/big-number"),
  "marketing/quote": () => import("./scenes/marketing/quote"),
  "marketing/drop-countdown": () => import("./scenes/marketing/drop-countdown"),
  "marketing/fragrance-reveal": () => import("./scenes/marketing/fragrance-reveal"),
  "marketing/editorial-sale": () => import("./scenes/marketing/editorial-sale"),
  "marketing/glass-spotlight": () => import("./scenes/marketing/glass-spotlight"),
  "marketing/announcement": () => import("./scenes/marketing/announcement"),
  "marketing/lookbook": () => import("./scenes/marketing/lookbook"),
  "marketing/stat-stack": () => import("./scenes/marketing/stat-stack"),
  "marketing/testimonials": () => import("./scenes/marketing/testimonials"),
};

/**
 * The type pairing each scene sets its words in (its hero, accent, details and body faces). Scenes built on the
 * poster kit declare the same pairing themselves (tests hold the two together).
 */
export const SCENE_PAIRINGS: Record<string, PairingId> = {
  "end-card/draw-on": "T9",
  "end-card/rise": "T9",
  "end-card/iris": "T9",
  "end-card/split": "T9",
  "end-card/glint": "T9",
  "marketing/kinetic-headline": "T1",
  "marketing/line-reveal": "T4",
  "marketing/logo-sting": "T3",
  "marketing/feature-cards": "T7",
  "marketing/stat-dashboard": "T7",
  "marketing/starburst": "T8",
  "marketing/offer-badge": "T2",
  "marketing/big-number": "T7",
  "marketing/quote": "T5",
  "marketing/drop-countdown": "T3",
  "marketing/fragrance-reveal": "T4",
  "marketing/editorial-sale": "T2",
  "marketing/glass-spotlight": "T4",
  "marketing/announcement": "T6",
  "marketing/lookbook": "T1",
  "marketing/stat-stack": "T2",
  "marketing/testimonials": "T9",
};

export const SCENE_IDS = Object.keys(LOADERS);

export const hasScene = (id: string): boolean => Object.hasOwn(LOADERS, id);

/** The Kinetic families a scene draws with (none for an unknown scene). */
export function sceneFamilies(id: string | null | undefined): string[] {
  const p = id ? SCENE_PAIRINGS[id] : undefined;
  return p ? [...new Set(pairingFaces(p).map((f) => f.family))] : [];
}

const loaded = new Map<string, Promise<Scene>>();

/** The scene with this id (rejects for an unknown one). */
export function loadScene(id: string): Promise<Scene> {
  if (!hasScene(id)) return Promise.reject(new Error(`No scene "${id}"`));
  let p = loaded.get(id);
  if (!p) {
    p = LOADERS[id]().then((m) => m.default);
    loaded.set(id, p);
  }
  return p;
}
