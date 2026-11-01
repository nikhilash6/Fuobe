/**
 * A preset's recipe: the model and settings its preview was made with, per engine. A preset opens on it, and its own
 * route (preset.open / preset.cloud) stays as the second choice: Fuobe DoP's LoRAs, Mix, start-frame steps and grades
 * read those routes, and a viewer whose catalog lacks the recipe's model runs them as before.
 *
 * Pure and light: no catalog or covers import, so the composer and the planner read it in the browser. Which presets'
 * previews really came from their recipe (the "Used for this preview" label) is in ./preset-recipes.ts, which reads the
 * covers manifest.
 *
 * The rules, in order:
 * 1. No recipe: effects with a start-frame step (their step feeds Fuobe DoP), colour-grade effects (Fuobe DoP's clip is
 *    graded afterwards), and the apps in OWN_ROUTE_APPS.
 * 2. MiniMax H3: every other camera motion and effect, and every app whose route is image-to-video or start-and-end
 *    frame: the preset's own operation from the person's picture, 5 s, at the Quality its cover was made at (Best is
 *    set; Fast is H3's default). The orbit presets run H3's Orbit LoRA. Many covers ran H3 from their start frame to an
 *    end frame edited beforehand; a recipe starts from the picture alone.
 * 3. Qwen-Image 2.1 Turbo: the edit apps on Qwen-Image 2.1, with the same words (images named by position become
 *    <image1>, <image2>, as the encoder reads them), the specialist apps, in the words their covers were made with, and
 *    Angles, in the app's own words (its Multiple-Angles LoRA route stays second).
 * 4. Expand Image, Zoom Out and Zooms: their own Qwen-Image 2.1 route is their recipe.
 * Only H3 recipes have a cloud side: there is no hosted Qwen-Image 2.1.
 */
import type { Engine, Operation, Preset, PresetRoute } from "./types";

/** What the rules read of a preset. */
export type RecipePreset = Pick<Preset, "id" | "type" | "open" | "cloud" | "prestep" | "promptTemplate" | "grade">;

/** Whether the viewer's catalog has a model (the server's full catalog, or a studio's slice in the browser). */
export type HasModel = (id: string) => boolean;

export const H3_OPEN = "oss-minimax-h3";
export const H3_CLOUD = "minimax-h3";
export const QWEN_21 = "oss-qwen-image-21";
export const QWEN_21_TURBO = "oss-qwen-image-21-turbo";

/** The kind of recipe a preset has, for the label's rules and the tests. */
export type RecipeKind = "h3" | "orbit" | "turbo" | "specialist" | "words" | "own";

/**
 * Apps that keep their own route.
 * - Fuobe Angles: its camera fields drive the Multiple-angles LoRA.
 * - AI Influencer: it draws in the Soul Cast look, with its LoRAs.
 * - Shots, What's Next: camera turns, which the 25-step Qwen-Image 2.1 holds better than its Turbo.
 * - ASMR Host, ASMR Promo, Talking Photo: they speak with the person's own voice track.
 * - Recast, Video Face Swap: they carry a performance over from a clip.
 * - 3D Rotation: its Rotate LoRA turns the subject into a solid object that spins in place.
 * - Remove Background, Upscale, Vectorize, Video Background Remover, Image to 3D: tools, whose covers show the idea.
 * - Clean up voice: a tool of its own (RE-USE), with nothing to recast.
 */
export const OWN_ROUTE_APPS: ReadonlySet<string> = new Set([
  "app-fuobe-angles",
  "app-ai-influencer",
  "app-shots",
  "app-what-s-next",
  "app-asmr-host",
  "app-asmr-promo",
  "app-talking-photo",
  "app-recast",
  "app-video-face-swap",
  "app-3d-rotation",
  "app-remove-background",
  "app-upscale",
  "app-vectorize",
  "app-video-background-remover",
  "app-image-to-3d",
  "app-clean-up-voice",
]);

/** Presets whose clip was made on H3's 20-step graph (Quality: Best); the others on its 8-step Turbo graph (Fast). */
export const BEST_QUALITY_PRESETS: ReadonlySet<string> = new Set([
  "app-macro-scene",
  "app-macroshot-product",
  "motion-crash-zoom-in",
  "motion-whip-pan",
  "motion-snorricam",
  "motion-catwalk",
  "motion-downhill-pov",
  "motion-fisheye",
  "motion-fpv-drone",
  "motion-drone-reveal",
  "motion-aerial-pullback",
  "motion-road-rush",
  "motion-robo-arm",
  "motion-robot-arm",
  "motion-timelapse",
  "motion-roll-transition",
  "motion-flying-cam-transition",
  "motion-skate-cruise",
  "effect-bloom-mouth",
  "effect-black-tears",
  "effect-exploded-view",
  "effect-lacewalker",
  "effect-lidar-transition",
  "effect-pigeons",
  "effect-particles",
]);

/**
 * Presets made with H3's Orbit LoRA: one frozen instant, the camera circling it (73 frames, about 3 s). The orbit keeps
 * the picture as it is, so an app whose words add to the scene (Bullet Time Splash's water, Bullet Time White's
 * cyclorama) runs H3's image-to-video in its own words instead.
 */
export const ORBIT_PRESETS: ReadonlySet<string> = new Set([
  "app-product-360",
  "app-bullet-time-scene",
  "motion-360-orbit",
  "motion-3d-rotation",
  "motion-bullet-time",
  "effect-frozen-in-motion",
]);

/**
 * The orbit's words: the Orbit LoRA's training caption as the cover graph sends it, word for word, keeping the sentences
 * that describe the shot; then the person's own words.
 */
export const ORBIT_WORDS =
  "One frozen instant. Only the camera moves. In a continuous 360 orbit. Preserve every person and object in exactly the same world position, orientation, shape and pose throughout the shot. Airborne objects remain suspended at the captured height and angle. Keep faces, hands, clothing, liquids and the background motionless while retaining their natural appearance. Camera parallax is the only source of apparent movement. {prompt}";

/**
 * Apps on Qwen-Image 2.1 Turbo in the app's own words (its options become words): Angles, whose cover's new view came
 * from the Turbo. Its Multiple-Angles LoRA route on Qwen-Image-Edit 2511 stays second.
 */
export const WORDS_APPS: ReadonlySet<string> = new Set(["app-angles"]);

/** Apps whose recipe is their own Qwen-Image 2.1 route (their covers came from it). */
export const OWN_QWEN_APPS: ReadonlySet<string> = new Set(["app-expand-image", "app-zoom-out", "app-zooms"]);

/**
 * The specialist apps on Qwen-Image 2.1 Turbo, in the words their covers were made with: the picture is <image1>, the
 * reference <image2>. Each keeps its options ({option:…}).
 */
export const SPECIALIST_TEMPLATES: Readonly<Record<string, string>> = {
  "app-face-swap":
    "Replace the face of the person in <image1> with the face of the person in <image2>: their eyes, brows, nose, mouth, skin tone and features, lit by the same light as <image1> and turned to the same head angle. Show one person only. Keep the hair, clothing, pose, setting and framing exactly as in <image1>.",
  "app-relight":
    "Relight <image1> with {option:light} {option:dir}: the light, shadows, reflections and colour temperature follow the new light. Keep the subject, their pose, face and hair, the setting, every detail and the framing exactly as in <image1>.",
  "app-match-lighting":
    "Relight <image1> to match the lighting in <image2>: the same light direction, softness, colour temperature, contrast and mood, with the shadows and reflections that light casts. Keep the subject, their pose, face and hair, the setting, every detail and the framing exactly as in <image1>.",
  "app-match-colors":
    "Recolour <image1> with the colour palette and grade of <image2>: the same hues, saturation, contrast and tones in the shadows and highlights throughout. Keep every person and object, every shape and detail, the light direction and the framing exactly as in <image1>.",
  "app-product-shot":
    "Replace the background of <image1>: the product {option:scene}. {prompt}. Keep the product, its shape, colours, label, position and size, and the framing exactly as in <image1>. Reproduce only what is visible in <image1>; where a surface is plain it stays plain.",
  "app-virtual-try-on":
    "Dress the person from <image1> in the garment from <image2>, keeping the person exactly as in <image1> and the garment exactly as in <image2>: its fabric, colour, pattern, logo and fit, with natural folds and shadows. Keep the pose, face, camera angle, background and framing exactly as in <image1>. Show one person only.",
};

const ORDINAL: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4 };

/**
 * An app's words with the images it names by position as Qwen-Image 2.1's encoder names them: "the first image" →
 * <image1>, "image 2" → <image2>. Unchanged when it names none.
 */
export function imageTags(words: string): string {
  return words
    .replace(/\b(?:the )?(first|second|third|fourth) image\b/gi, (_, n: string) => `<image${ORDINAL[n.toLowerCase()]}>`)
    .replace(/\bimage ([1-4])\b/gi, (_, n: string) => `<image${n}>`);
}

const VIDEO_OPS = new Set<Operation>(["i2v", "flf2v"]);

/** Which recipe a preset has (the same on both engines). */
export function recipeKind(p: RecipePreset): RecipeKind | undefined {
  if (p.prestep || p.grade || OWN_ROUTE_APPS.has(p.id)) return undefined;
  const own = p.open ?? p.cloud;
  if (p.type !== "app" || (own && VIDEO_OPS.has(own.op))) {
    if (!own || !VIDEO_OPS.has(own.op)) return undefined;
    return ORBIT_PRESETS.has(p.id) ? "orbit" : "h3";
  }
  if (SPECIALIST_TEMPLATES[p.id]) return "specialist";
  if (WORDS_APPS.has(p.id)) return "words";
  if (OWN_QWEN_APPS.has(p.id)) return p.open?.modelId === QWEN_21 ? "own" : undefined;
  if (p.open?.modelId === QWEN_21 && p.open.op === "edit") return "turbo";
  return undefined;
}

/** The recipe's route on an engine, whether or not the viewer's catalog has its model. */
export function recipeRoute(p: RecipePreset, engine: Engine): PresetRoute | undefined {
  const kind = recipeKind(p);
  if (!kind) return undefined;
  const own = (p.open ?? p.cloud)!;
  if (kind === "orbit") {
    return engine === "open"
      ? { modelId: H3_OPEN, op: "i2v", params: { duration: 3, extra: { orbit: true } }, promptTemplate: ORBIT_WORDS }
      : // Hosted H3 makes 5 s at the least, and has no Orbit LoRA: the orbit's words alone.
        { modelId: H3_CLOUD, op: "i2v", params: { duration: 5 }, promptTemplate: ORBIT_WORDS };
  }
  if (kind === "h3") {
    if (engine === "cloud") return { modelId: H3_CLOUD, op: own.op, params: { duration: 5 } };
    // Fast is H3's default Quality: only Best is set.
    return { modelId: H3_OPEN, op: own.op, params: { duration: 5, ...(BEST_QUALITY_PRESETS.has(p.id) && { extra: { quality: "best" } }) } };
  }
  // The rest are Qwen-Image 2.1 recipes: none is hosted.
  if (engine === "cloud") return undefined;
  if (kind === "own") return p.open!;
  if (kind === "specialist") return { modelId: QWEN_21_TURBO, op: "edit", promptTemplate: SPECIALIST_TEMPLATES[p.id] };
  if (kind === "words") return { modelId: QWEN_21_TURBO, op: "edit", promptTemplate: imageTags(p.promptTemplate) };
  const words = p.open!.promptTemplate ?? p.promptTemplate;
  const tagged = imageTags(words);
  return { ...p.open!, modelId: QWEN_21_TURBO, ...(tagged !== words && { promptTemplate: tagged }) };
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
