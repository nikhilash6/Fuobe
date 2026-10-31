import type { ModelDef } from "./types";

/**
 * Clip lengths a studio plans with, per model, where the catalog also lists a shorter clip than the model is trained
 * for. MiniMax H3 on your GPU is trained on 5–15 s clips (124–362 frames at 24 fps); its 3 s clip serves the presets
 * made at that length. A studio that picks the length itself (Faceless and the Explainer, Storyboard films, Marketing,
 * Cinema) asks it for 5, 10 or 15 s.
 */
export const PLANNED_DURATIONS: Readonly<Record<string, readonly number[]>> = { "oss-minimax-h3": [5, 10, 15] };

/** The clip lengths a studio plans with on a model: PLANNED_DURATIONS, else the catalog's own. */
export function plannedDurations(model: Pick<ModelDef, "id" | "options"> | undefined): number[] | undefined {
  if (!model) return undefined;
  const planned = PLANNED_DURATIONS[model.id];
  return planned ? [...planned] : model.options.durations;
}
