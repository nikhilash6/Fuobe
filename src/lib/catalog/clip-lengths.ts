import type { ModelDef } from "./types";

/**
 * Clip lengths a studio plans with, per model, where the catalog also lists a shorter clip than the model is trained
 * for. MiniMax H3 on your GPU is trained on 5–15 s clips (124–362 frames at 24 fps); its 3 s clip serves the presets
 * made at that length. A studio that picks one of a few lengths itself (Storyboard films, Click to Ad, Cinema) asks it
 * for 5, 10 or 15 s.
 */
export const PLANNED_DURATIONS: Readonly<Record<string, readonly number[]>> = { "oss-minimax-h3": [5, 10, 15] };

/**
 * Models that render any whole number of seconds in a range, where a studio fits the clip to a length of its own
 * (a Faceless scene cut to its lines, a Marketing motion ad of the length asked for). MiniMax H3 on your GPU renders
 * any length on its 17n + 5 frame grid: 3 s up to the 15 s it is trained for.
 */
export const LENGTH_RANGES: Readonly<Record<string, readonly [number, number]>> = { "oss-minimax-h3": [3, 15] };

/** The clip lengths a studio plans with on a model: PLANNED_DURATIONS, else the catalog's own. */
export function plannedDurations(model: Pick<ModelDef, "id" | "options"> | undefined): number[] | undefined {
  if (!model) return undefined;
  const planned = PLANNED_DURATIONS[model.id];
  return planned ? [...planned] : model.options.durations;
}

/** The range of whole seconds a model renders, when it takes any length in one (LENGTH_RANGES). */
export function lengthRange(model: Pick<ModelDef, "id"> | undefined): [number, number] | undefined {
  const r = model ? LENGTH_RANGES[model.id] : undefined;
  return r ? [r[0], r[1]] : undefined;
}

/**
 * Video models whose clips share one canvas and frame rate when their start frames share one shape: MiniMax H3 on your
 * GPU makes each clip in its still's shape at 24 fps. A studio joins them with the copy join (oss-join-encoded), which
 * never decodes them, so a long film takes no more memory than a short one. The copy keeps each clip's own sound.
 */
export const COPY_JOIN_VIDEOS: ReadonlySet<string> = new Set(["oss-minimax-h3"]);
