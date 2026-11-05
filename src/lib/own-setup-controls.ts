import type { Engine } from "./catalog/types";
import { ownSetupOnly, type OwnSetup } from "./own-setup";

/**
 * Model settings whose value runs on a visitor's own setup only, by the own-setup.ts id each value is asked by (the
 * server asks the same ids of a run: src/server/pool-own-setup.ts requestSetupIds). A picker shows that id's label
 * beside the value.
 */
export function controlSetup(modelId: string | undefined, param: string, value: string | number): string | undefined {
  // Kandinsky 6.0 (open) at Pro quality.
  if (modelId === "oss-kandinsky6" && param === "quality" && value === "pro") return "oss-kandinsky6:pro";
  return undefined;
}

/**
 * A model a visitor runs on its own key only (an untested cloud route, Mureka Extend on Audio → Extend & remix): the
 * composer's price then names that key, never "Free · your GPU". Null for anything else.
 */
export function keyOnlySetup(m: { id: string; engine: string } | undefined, engine: Engine): Extract<OwnSetup, { need: "key" }> | null {
  const o = m ? ownSetupOnly(m.id, m.engine === "cloud" ? "cloud" : engine) : null;
  return o?.need === "key" ? o : null;
}
