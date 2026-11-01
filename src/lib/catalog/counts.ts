/**
 * How many models Fuobe has, as every page quotes it (Home, /models, Project status, About & licences).
 *
 * The rule:
 * - A model counts when a visitor can pick it: it is listed in a studio's picker, on /models and in the ⌘K palette.
 *   A hidden model is a step a preset or a tool runs for you (trim a clip, join two clips, a self-test, a relight
 *   LoRA an app uses): it is part of what it serves, never picked on its own, so it isn't counted.
 * - `open`: the models that run on the open engine (ComfyUI on your own GPU). A Fuobe Original runs on both engines
 *   and counts here, once.
 * - `cloud`: the models that run only in the cloud, through your own fal.ai or Replicate key (the partner models).
 * - `all`: open + cloud, so every pickable model counts exactly once.
 *
 * The licence list on About & licences is a different count (one row per set of open weights, helper steps and
 * library workflows included); the page says so next to it.
 */
import { runsOn } from "./engines";
import type { ModelDef } from "./types";

export interface ModelCounts {
  open: number;
  cloud: number;
  all: number;
}

/** A model a visitor can pick (not a hidden step a preset or a tool runs). */
export const isListed = (m: Pick<ModelDef, "hidden">): boolean => !m.hidden;

export function countModels(models: readonly Pick<ModelDef, "hidden" | "engine" | "engines">[]): ModelCounts {
  const listed = models.filter(isListed);
  const open = listed.filter((m) => runsOn(m, "open")).length;
  return { open, cloud: listed.length - open, all: listed.length };
}
