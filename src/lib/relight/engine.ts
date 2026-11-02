/**
 * How the Relight tool runs: the hidden models, the settings measured runs set, and the requests it sends. Pure.
 *
 * Generate lighting is an ordinary run (feature "relight") on a hidden Qwen-Image 2.1 model with a
 * few-step speed add-on, so the Library, Retry, Reuse, account GPUs and the guest rules work as for any app. The scene
 * read (depth and subject cut-out, once per photo) is a helper step the Library hides. A blend kept from the browser is
 * recorded as a local result.
 */
import type { GenerationRequest } from "../catalog/types";
import { MAX_LIGHTS, promptFor, type Light, type LookId, type RelightExtra, type SoftnessWording } from "./lights";

export const RELIGHT_PRESET = "app-relight";
/** Its own feature, not the app preset: a preset run would put the app's old words in front of the lights' own. */
export const RELIGHT_FEATURE = "relight";
/** Generate lighting: Qwen-Image 2.1 + the 6-step speed LoRA, the photo plus the words. */
export const RELIGHT_MODEL = "oss-qwen-image-21-relight";
/** The scene read: depth (near = bright) and the subject's matte. */
export const RELIGHT_SCENE_MODEL = "oss-relight-scene";
/** Its runs are steps: the Library leaves them out (HELPER_SUFFIX). */
export const RELIGHT_SCENE_FEATURE = "relight-scene-step";
/** A blend rendered in the browser and kept. */
export const RELIGHT_BLEND_MODEL = "local-relight";
export const RELIGHT_BLEND_FEATURE = "relight";

export type BlendMode = "mix" | "transfer";

/**
 * The settings measured runs confirm or change (scripts/eval/cases/relight.json). Visitors never see them; the owner's status line names the
 * engine variant.
 */
export const RELIGHT_SETTINGS = {
  /** The engine variant (the workflow's speed LoRA): Viggle 6-step r256. */
  variant: "viggle-6",
  /** Send the light-guide picture as image 2. Off until measured runs show it helps the light land where placed. */
  guide: false,
  /** How the prompt says softness (per light when the lights differ, else once). */
  softness: "auto" as SoftnessWording,
  /** The default blend: light transfer keeps the original's detail and changes only the light. */
  blend: "transfer" as BlendMode,
  /** The Intensity the result opens at. */
  intensity: 0.6,
  /** Ambient light in the preview's lights-only estimate (linear). */
  ambient: 0.04,
} as const;

export const INTENSITY_CHIPS = [0.35, 0.6, 1] as const;

/** The longest side a photo is sent at (the model renders at ~1 MP and the blend keeps the original's detail). */
export const RELIGHT_MAX_SIDE = 1536;

export interface RelightRun {
  photo: string;
  guide?: string | null;
  lights: Light[];
  look?: LookId;
  promptOverride?: string | null;
  seed: number;
}

/** The run for Generate lighting. */
export function relightRequest(r: RelightRun): GenerationRequest {
  const lights = r.lights.slice(0, MAX_LIGHTS);
  const guide = RELIGHT_SETTINGS.guide && !!r.guide;
  const extra: RelightExtra = { lights, ...(r.look && { look: r.look }), seed: r.seed, variant: RELIGHT_SETTINGS.variant, guide, ...(r.promptOverride?.trim() && { typed: true }) };
  return {
    feature: RELIGHT_FEATURE,
    modelId: RELIGHT_MODEL,
    op: "edit",
    prompt: promptFor(lights, r.promptOverride, RELIGHT_SETTINGS.softness),
    inputs: { images: guide && r.guide ? [r.photo, r.guide] : [r.photo] },
    params: { seed: r.seed, numOutputs: 1, extra: { relight: extra } },
  };
}

/** The scene read of one photo. */
export function sceneRequest(photo: string): GenerationRequest {
  return {
    feature: RELIGHT_SCENE_FEATURE,
    modelId: RELIGHT_SCENE_MODEL,
    op: "bg-remove",
    prompt: "",
    inputs: { images: [photo] },
  };
}
