/**
 * Hosted routes whose requests have not yet been sent with a real key: their payloads follow the providers' schemas
 * and are unit-tested, but no live call has passed. They run for the owner; for an account (on its own fal.ai or
 * Replicate key) they open once a live call passes and the entry is taken off these lists. Until then a visitor's run
 * is refused (`own-gpu-tool`, generations.ts) and the models are left out of its pickers (hostedUntestedSummary).
 * Pure data and logic (client and server).
 */
import type { AccessSummary } from "../model-access";
import type { Engine, ModelDef, ModelRoute } from "./types";

/** Endpoints, on any model that uses them. */
export const HOSTED_UNTESTED_ENDPOINTS: ReadonlySet<string> = new Set([
  // MiniMax H3 Max: lip sync, relight, insert, the five looks, Turbo; H3 Lite and HighSpeed (Replicate).
  "minimax/h3-max/lip-sync/image-to-video",
  "minimax/h3-max/relight",
  "minimax/h3-max/insert-video",
  "minimax/h3-max/styles/16bit-pixel",
  "minimax/h3-max/styles/hand-drawn",
  "minimax/h3-max/styles/low-poly",
  "minimax/h3-max/styles/retro-toon-70s",
  "minimax/h3-max/styles/vhs",
  "minimax/h3-max-turbo/text-to-video",
  "minimax/h3-max-turbo/image-to-video",
  "minimax/h3-max-turbo/reference-to-video",
  "minimax/h3-max-turbo/extend-video",
  "minimax/h3-lite",
  "minimax/h3-highspeed",
  // Vidu Q4.
  "fal-ai/vidu/q4/image-to-video",
  "fal-ai/vidu/q4/reference-to-video",
  // Songs: Mureka 9 / 9.5 / 8 and its song tools (extend, remix, stems, the upload they send a song through first),
  // MiniMax Music 3, ElevenLabs Music v2.5, Lyria 3.5.
  "mureka/v9.5/generate/song",
  "mureka/v9/generate/song",
  "mureka/v9.5/generate/instrumental",
  "mureka/v9/generate/instrumental",
  "mureka/v8/song/extend",
  "mureka/v8/song/remix",
  "mureka/api/song/stem",
  "mureka/api/files/upload",
  "minimax/music-3",
  "elevenlabs/music/v2.5",
  "google/lyria-3.5",
  // Voice cleaners.
  "veed/clean-audio",
  "fal-ai/deepfilternet3",
  // 3D: Idol, Meshy retexture, Tripo P2.
  "speridlabs/idol",
  "meshy/v7/retexture",
  "meshy/v6/retexture",
  "tripo3d/p2/image-to-3d",
  // Kandinsky 6.0 (Pro and Lite, from words or a first frame) and Kandinsky VSR.
  "fal-ai/kandinsky6-pro/text-to-video",
  "fal-ai/kandinsky6-lite/text-to-video",
  "fal-ai/kandinsky6-pro/image-to-video",
  "fal-ai/kandinsky6-lite/image-to-video",
  "fal-ai/kandinsky6-vsr",
  // Bria: green-screen despill and the guided cut-out.
  "bria/video/background-removal/green-screen-despill",
  "bria/guided-remove-background",
]);

/** Models whose hosted routes are new even where the endpoint isn't (Fuobe Animation's LoRA run on Wan 2.2 A14B). */
export const HOSTED_UNTESTED_MODELS: ReadonlySet<string> = new Set(["fuobe-animation"]);

const hosted = (r: Pick<ModelRoute, "provider">) => r.provider === "fal" || r.provider === "replicate";

/** Whether this route of this model is a hosted call that hasn't been sent with a real key yet. */
export function hostedUntested(modelId: string, route: Pick<ModelRoute, "provider" | "endpoint">): boolean {
  return hosted(route) && (HOSTED_UNTESTED_ENDPOINTS.has(route.endpoint) || HOSTED_UNTESTED_MODELS.has(modelId));
}

/**
 * A visitor's picker summary with these left out: a model with nothing else to run on is off; a Fuobe Original whose
 * cloud half is all untested keeps its other engine.
 */
export function hostedUntestedSummary(models: ModelDef[], base: AccessSummary | undefined): AccessSummary {
  const off = new Set(base?.off ?? []);
  const engines: Record<string, Engine[]> = { ...(base?.engines ?? {}) };
  for (const m of models) {
    if (off.has(m.id) || !m.routes.some((r) => hostedUntested(m.id, r))) continue;
    const left = m.routes.filter((r) => !hostedUntested(m.id, r));
    if (!left.length) {
      off.add(m.id);
      continue;
    }
    if (m.engines && m.engines.length > 1 && !left.some(hosted)) {
      const on = (engines[m.id] ?? m.engines).filter((e) => e !== "cloud");
      if (on.length) engines[m.id] = on;
      else off.add(m.id);
    }
  }
  return { off: [...off], ...(Object.keys(engines).length && { engines }) };
}

/** Whether this route of this model is a hosted call that hasn't been sent with a real key yet (own-setup.ts). */
export function isHostedUntested(modelId: string, route: Pick<ModelRoute, "provider" | "endpoint">): boolean {
  return hosted(route) && (HOSTED_UNTESTED_ENDPOINTS.has(route.endpoint) || HOSTED_UNTESTED_MODELS.has(modelId));
}
