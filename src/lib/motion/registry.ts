/**
 * Every Kinetic Motion scene by id, loaded only when a page plays or renders it.
 */

import type { Scene } from "./scene";

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
};

export const SCENE_IDS = Object.keys(LOADERS);

export const hasScene = (id: string): boolean => Object.hasOwn(LOADERS, id);

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
