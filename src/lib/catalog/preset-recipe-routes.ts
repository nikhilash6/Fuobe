/**
 * A preset's recipe: the model, settings and words its preview was made with, per engine. A preset opens on it, and its
 * own route (preset.open / preset.cloud) stays as the second choice: Fuobe DoP's LoRAs, Mix, start-frame steps and grades
 * read those routes, and a viewer whose catalog lacks the recipe's model runs them as before.
 *
 * The recipes themselves are in ./preset-recipe-book.json (preset.recipe): what each preview ran, written for any
 * picture. Pure and light: no catalog or covers import, so the composer and the planner read it in the browser. Which
 * presets' previews really came from their recipe (the "Used for this preview" label) is in ./preset-recipes.ts, which
 * reads the covers manifest.
 *
 * The rules:
 * 1. A clip recipe runs on MiniMax H3 from the person's picture, at the Quality and length its preview was made at, in
 *    its words, sound and music. When the preview ran to an end frame it edited first, the run makes that end frame from
 *    the person's picture first (PresetRoute.end), with the same edit. A transition's end frame is the person's own.
 *    The orbit presets run H3's Orbit LoRA in its training caption's words.
 * 2. An edit recipe runs on Qwen-Image 2.1: its Turbo edit, its 25-step edit or its expand, as its preview's edit did,
 *    in the same words, at the same input size.
 * 3. The apps in OWN_ROUTE_APPS keep their own route: their previews show the idea, but the run needs what only their
 *    own model does.
 * 4. A colour-grade effect whose preview is its own grade on a still has no recipe: its own route's clip (Fuobe DoP)
 *    gets that same grade.
 * Only H3 recipes have a cloud side (hosted H3, at least 5 s, without the end-frame step): there is no hosted Qwen-Image 2.1.
 */
import type { Engine, Preset, PresetEndStep, PresetRecipeEdit, PresetRoute } from "./types";

/** What the rules read of a preset. */
export type RecipePreset = Pick<Preset, "id" | "type" | "open" | "cloud" | "prestep" | "promptTemplate" | "grade" | "recipe" | "userPrompt" | "inputs">;

/** Whether the viewer's catalog has a model (the server's full catalog, or a studio's slice in the browser). */
export type HasModel = (id: string) => boolean;

export const H3_OPEN = "oss-minimax-h3";
export const H3_CLOUD = "minimax-h3";
export const QWEN_21 = "oss-qwen-image-21";
export const QWEN_21_TURBO = "oss-qwen-image-21-turbo";

/** The kind of recipe a preset has, for the label's rules and the tests. */
export type RecipeKind = "h3" | "orbit" | "qwen";

/**
 * Apps that keep their own route, whatever their preview ran.
 * - Fuobe Angles: its camera fields drive the Multiple-angles LoRA.
 * - AI Influencer: it draws in the Soul Cast look, with its LoRAs.
 * - ASMR Host, ASMR Promo, Talking Photo: they speak with the person's own voice track.
 * - Recast, Video Face Swap: they carry a performance over from the person's clip.
 * - Zooms: it makes the zoom level picked (a 3x3 grid of nine by default), where its preview grew one picture outward.
 * - Remove Background, Upscale, Vectorize, Video Background Remover, Image to 3D: tools whose result (a cut-out, more
 *   pixels, an SVG, a matte, a mesh) only their own model makes; their previews show the idea.
 * - Clean up voice: a tool of its own (RE-USE), with nothing to recast.
 */
export const OWN_ROUTE_APPS: ReadonlySet<string> = new Set([
  "app-fuobe-angles",
  "app-ai-influencer",
  "app-asmr-host",
  "app-asmr-promo",
  "app-talking-photo",
  "app-recast",
  "app-video-face-swap",
  "app-zooms",
  "app-remove-background",
  "app-upscale",
  "app-vectorize",
  "app-video-background-remover",
  "app-image-to-3d",
  "app-clean-up-voice",
]);

/**
 * The orbit's words: the Orbit LoRA's training caption as the preview graph sends it, word for word, keeping the
 * sentences that describe the shot; then the person's own words.
 */
export const ORBIT_WORDS =
  "One frozen instant. Only the camera moves. In a continuous 360 orbit. Preserve every person and object in exactly the same world position, orientation, shape and pose throughout the shot. Airborne objects remain suspended at the captured height and angle. Keep faces, hands, clothing, liquids and the background motionless while retaining their natural appearance. Camera parallax is the only source of apparent movement. {prompt}";

/** The Qwen-Image 2.1 edit graphs' own input size (ImageScaleToMaxDimension), which a recipe's maxDimension replaces. */
export const QWEN_21_MAX_DIMENSION = 2048;

/** A recipe's words with the person's own after them, unless they already have their place ("{prompt}"). */
export function withVisitorWords(words: string, userPrompt: Preset["userPrompt"]): string {
  return words.includes("{prompt}") || userPrompt === "none" ? words : `${words} {prompt}`;
}

/** Which recipe a preset has (the same on both engines). */
export function recipeKind(p: Pick<RecipePreset, "id" | "recipe">): RecipeKind | undefined {
  if (OWN_ROUTE_APPS.has(p.id) || !p.recipe) return undefined;
  if (p.recipe.clip) return p.recipe.clip.quality === "orbit" ? "orbit" : "h3";
  return p.recipe.edit ? "qwen" : undefined;
}

/** A recipe's Qwen-Image 2.1 step as a model, an operation, words and settings. */
export function qwenStep(e: PresetRecipeEdit): PresetEndStep {
  if (e.graph === "expand") {
    const [padLeft, padTop, padRight, padBottom] = e.pads ?? [384, 288, 384, 288];
    return { modelId: QWEN_21, op: "outpaint", promptTemplate: e.prompt, params: { extra: { padLeft, padTop, padRight, padBottom } } };
  }
  const extra = {
    ...(e.maxDimension && e.maxDimension !== QWEN_21_MAX_DIMENSION && { maxDimension: e.maxDimension }),
    ...(e.crop && { crop: e.crop }),
  };
  return { modelId: e.graph === "turbo" ? QWEN_21_TURBO : QWEN_21, op: "edit", promptTemplate: e.prompt, ...(Object.keys(extra).length > 0 && { params: { extra } }) };
}

/** The recipe's route on an engine, whether or not the viewer's catalog has its model. */
export function recipeRoute(p: RecipePreset, engine: Engine): PresetRoute | undefined {
  const kind = recipeKind(p);
  if (!kind) return undefined;
  const { clip, edit } = p.recipe!;
  if (clip) {
    if (kind === "orbit") {
      return engine === "open"
        ? { modelId: H3_OPEN, op: "i2v", params: { duration: clip.seconds, extra: { orbit: true } }, promptTemplate: ORBIT_WORDS }
        : // Hosted H3 makes 5 s at the least, and has no Orbit LoRA: the orbit's words alone.
          { modelId: H3_CLOUD, op: "i2v", params: { duration: Math.max(5, clip.seconds) }, promptTemplate: ORBIT_WORDS };
    }
    // A transition runs to the person's own end frame; any other clip starts from the picture alone.
    const op = p.inputs.some((s) => s.key === "endImage") ? "flf2v" : "i2v";
    const promptTemplate = withVisitorWords(clip.words ?? "", p.userPrompt);
    // Hosted H3: the same words, at least 5 s, without the end-frame step (there is no hosted Qwen-Image 2.1).
    if (engine === "cloud") return { modelId: H3_CLOUD, op, params: { duration: Math.max(5, clip.seconds) }, promptTemplate };
    return {
      modelId: H3_OPEN,
      op,
      // Fast is H3's default Quality: only Best is set.
      params: { duration: clip.seconds, ...(clip.quality === "best" && { extra: { quality: "best" } }) },
      promptTemplate,
      ...(clip.sound !== undefined && { sound: { soundscape: clip.sound, music: clip.music ?? "N/A" } }),
      ...(clip.end && op === "i2v" && { end: qwenStep(clip.end) }),
    };
  }
  // An edit recipe: there is no hosted Qwen-Image 2.1.
  if (engine === "cloud" || !edit) return undefined;
  const step = qwenStep(edit);
  return { modelId: step.modelId, op: step.op, promptTemplate: withVisitorWords(step.promptTemplate, p.userPrompt), ...(step.params && { params: step.params }) };
}

/** The preset's own route on an engine. */
export const ownRoute = (p: Pick<Preset, "open" | "cloud">, engine: Engine): PresetRoute | null => (engine === "open" ? p.open : p.cloud);

/**
 * The routes a preset runs on, on an engine, in order: its recipe (when the viewer's catalog has its model), then its own
 * route. Empty when it has no version there.
 */
export function presetRoutes(p: RecipePreset, engine: Engine, has: HasModel): PresetRoute[] {
  const recipe = recipeRoute(p, engine);
  const own = ownRoute(p, engine);
  return [...(recipe && has(recipe.modelId) ? [recipe] : []), ...(own ? [own] : [])];
}

/**
 * The key of a preset's GPU badge for a run on a model (src/server/gpu/tools.ts presetTool): "<id>" on its first open
 * route, "<id>@<model id>" on another. Undefined on a model the preset has no open route on, and when the run's Quality
 * isn't the one the route's graph was picked for (`quality`, `defaultQuality`: the draft's and the model's): the model's
 * own badge applies then.
 */
export function presetGpuKey(p: RecipePreset, has: HasModel, modelId: string | undefined, quality?: unknown, defaultQuality?: unknown): string | undefined {
  if (!p.open || !modelId) return undefined;
  const routes = presetRoutes(p, "open", has);
  const route = routes.find((r) => r.modelId === modelId);
  if (!route) return undefined;
  if ((route.params?.extra?.quality ?? defaultQuality) !== (quality ?? defaultQuality)) return undefined;
  return routes[0].modelId === modelId ? p.id : `${p.id}@${modelId}`;
}

/** The models an app runs on, on an engine: its recipe's first, then its own route's (once each). */
export function appModels(p: RecipePreset, engine: Engine, has: HasModel): string[] {
  return [...new Set(presetRoutes(p, engine, has).map((r) => r.modelId))];
}
