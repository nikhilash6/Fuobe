/**
 * A preset's recipe (./preset-recipe-routes.ts) and whether its live preview really came from it: the "Used for this
 * preview" label next to the model, in the model picker, the preset card's details and the app's model chip.
 *
 * It reads the covers manifest (preset-previews.generated.ts, the model each cover was made with), so the browser loads
 * it in its own chunk: the composer's helpers and the planner read the light module instead. A cover that is still a
 * still gets its recipe without the label; the label turns on when its clip is published (pnpm eval:covers).
 */
import type { StudioConfig } from "@/components/studio/studio-context";
import { PRESET_PREVIEWS } from "../preset-previews.generated";
import { appModels, ORBIT_PRESETS, presetRoutes, recipeKind, recipeRoute, type HasModel, type RecipePreset } from "./preset-recipe-routes";
import type { Engine, PresetRoute } from "./types";

export * from "./preset-recipe-routes";

export interface PresetRecipe {
  route: PresetRoute;
  /** Its live preview came from this route's model (the label shows). */
  made: boolean;
}

/** The cover models (PresetPreviewMedia.model): an H3 clip, and an Ideogram 4 still with its Qwen-Image 2.1 edit. */
const H3_COVER = "minimax-h3";
const QWEN_COVER = "ideogram4+qwen-image-2.1-edit";
/** Image apps whose cover is an H3 clip morphing into their Qwen-Image 2.1 picture. */
const QWEN_MORPHS: ReadonlySet<string> = new Set(["app-age-shift", "app-angles", "app-zooms"]);

/** Whether the preset's live preview was made by its recipe on this engine. */
export function recipeMade(p: RecipePreset, engine: Engine): boolean {
  const kind = recipeKind(p);
  const cover = PRESET_PREVIEWS[p.id]?.model;
  if (!kind || !cover) return false;
  // Hosted H3 is the same model; the Orbit LoRA runs on the open engine only.
  if (kind === "h3" || kind === "orbit") return cover === H3_COVER && (engine === "open" || !ORBIT_PRESETS.has(p.id));
  return engine === "open" && (cover === QWEN_COVER || (cover === H3_COVER && QWEN_MORPHS.has(p.id)));
}

/** The route that made the preset's preview, on an engine, when the viewer's catalog has its model; else undefined. */
export function presetRecipe(preset: RecipePreset, engine: Engine, has: HasModel): PresetRecipe | undefined {
  const route = recipeRoute(preset, engine);
  if (!route || !has(route.modelId)) return undefined;
  return { route, made: recipeMade(preset, engine) };
}

/**
 * An app's studio with its recipe first: its default model on each engine is the recipe's (else its own route's), its
 * operations include the recipe's (Face Swap and Match Colors gain the edit), and `appModels` lists both models per
 * engine for the composer's picker. A preset without a recipe keeps the config it has.
 */
export function withRecipe(config: StudioConfig, has: HasModel): StudioConfig {
  const preset = config.preset;
  if (preset?.type !== "app") return config;
  const models = { cloud: appModels(preset, "cloud", has), open: appModels(preset, "open", has) };
  const routes = [...presetRoutes(preset, "cloud", has), ...presetRoutes(preset, "open", has)];
  return {
    ...config,
    ops: [...new Set([...config.ops, ...routes.map((r) => r.op)])],
    defaultModels: { cloud: models.cloud[0] ?? config.defaultModels.cloud, open: models.open[0] ?? config.defaultModels.open },
    appModels: models,
  };
}
