import type { ModelOptions } from "@/lib/catalog/types";

/**
 * Qwen-Image 2.1 on your GPU in 2–8 steps and on 16 GB cards (research #10 §6.7, package nm10-qwen21-fast). Pure: the
 * provider (src/server/providers/comfyui.ts) and the GPU pre-flight's gate both resolve a run's graph through
 * resolveWorkflowId (src/lib/comfy-variants.ts), which reads these tables.
 *
 * - Options → Speed: Draft (2 steps, linoyts' DMD2 LoRA v1.5), Fast (4 steps, LightX2V's Lightning LoRA), "Fast · writes
 *   the details" (6 steps, Pruna's P-Q-Image v0.2 upsampled LoRA), Turbo (the official 8-step Turbo checkpoint, edits
 *   only) and Full (the owner's 25-step graphs, the default). Each tier is its own graph: the base graph with one LoRA and
 *   a ManualSigmas schedule (scripts/comfy/library.spec.mjs, qwen21Tier).
 * - Options → GPU: Zen Image Edit's 0.8B encoder in place of the 17.5 GB Qwen3-VL 8B for text to image and edits on a
 *   card under 24 GB (Auto), or always (Small).
 * - Options → Decoder: the Texture-Fix VAE ("Clean") in place of the stock decoder; off until tested.
 *
 * Qwen-Image 2.1 isn't hosted on fal or Replicate, so all of this is the open engine's.
 */

export type Qwen21Speed = "full" | "turbo" | "fast" | "details" | "draft";

/** Each base graph's speed tiers (the base graph is Full). */
export const QWEN21_SPEED_GRAPH: Record<string, Partial<Record<Qwen21Speed, string>>> = {
  "qwen-image-21-t2i": { draft: "qwen-image-21-t2i-draft", fast: "qwen-image-21-t2i-fast", details: "qwen-image-21-t2i-details" },
  "qwen-image-21-edit": { draft: "qwen-image-21-edit-draft", fast: "qwen-image-21-edit-fast", details: "qwen-image-21-edit-details", turbo: "qwen-image-21-turbo-edit" },
  "qwen-image-21-inpaint": { draft: "qwen-image-21-inpaint-draft", fast: "qwen-image-21-inpaint-fast" },
  "qwen-image-21-outpaint": { draft: "qwen-image-21-outpaint-draft", fast: "qwen-image-21-outpaint-fast" },
};

/** The graphs Small GPU runs in place of the full encoder's (text to image and edits at Full speed). */
export const QWEN21_SMALL_GPU_GRAPH: Record<string, string> = {
  "qwen-image-21-t2i": "qwen-image-21-t2i-small",
  "qwen-image-21-edit": "qwen-image-21-edit-small",
};

/** Below this much graphics memory, Auto runs the small encoder (Qwen3-VL 8B int8 9.4 GB + the int8 model 7.3 GB need ~20 GB). */
export const SMALL_GPU_BELOW_GB = 24;

export const SPEED_PARAM = "speed";
export const GPU_PARAM = "gpu";
export const DECODER_PARAM = "decoder";

/** The Texture-Fix VAE (madebyollin), an optional file every Qwen-Image 2.1 graph lists. */
export const CLEAN_VAE = "texture_fix_vae_for_qwen_image_2.1_bf16.safetensors";

/** The operations each speed is offered on (Turbo is the owner's 8-step edit; "writes the details" text to image and edits). */
export const SPEED_OPS: Record<Qwen21Speed, string[]> = {
  full: ["t2i", "edit", "inpaint", "outpaint"],
  turbo: ["edit"],
  fast: ["t2i", "edit", "inpaint", "outpaint"],
  details: ["t2i", "edit"],
  draft: ["t2i", "edit", "inpaint", "outpaint"],
};

type Control = NonNullable<ModelOptions["controls"]>[number];

/** Options → Speed (the default stays Full: the owner's graphs). */
export const QWEN21_SPEED: Control = {
  param: SPEED_PARAM,
  label: "Speed",
  values: ["draft", "fast", "details", "turbo", "full"],
  default: "full",
  labels: {
    draft: "Draft · 2 steps",
    fast: "Fast · 4 steps",
    details: "Fast · writes the details (6 steps)",
    turbo: "Turbo · 8 steps (edits)",
    full: "Full · 25 steps",
  },
  ops: SPEED_OPS,
};

/** Options → GPU: Auto picks Small under 24 GB of graphics memory (text to image and edits). */
export const QWEN21_GPU: Control = {
  param: GPU_PARAM,
  label: "GPU",
  values: ["large", "small"],
  labels: { large: "24 GB or more", small: "Small GPU (16 GB) · English prompts only" },
  ops: { large: ["t2i", "edit", "inpaint", "outpaint"], small: ["t2i", "edit"] },
};

/** Options → Decoder: Clean is the Texture-Fix VAE (cleaner fine texture, no checkerboard), off by default. */
export const QWEN21_DECODER: Control = {
  param: DECODER_PARAM,
  label: "Decoder",
  values: ["standard", "clean"],
  default: "standard",
  labels: { standard: "Standard", clean: "Clean · finer texture" },
  sets: { standard: {}, clean: { vae: CLEAN_VAE } },
};

/** Whether a GPU of this size (GB, as the GPU check reads it) runs the small encoder when the choice is Auto. */
export function smallGpu(vramGb: number | undefined): boolean {
  return typeof vramGb === "number" && vramGb > 0 && vramGb < SMALL_GPU_BELOW_GB;
}

/**
 * The graph a Qwen-Image 2.1 run takes: the speed's graph when it has one for this operation; at Full speed the small
 * encoder's graph when Options → GPU says Small, or says nothing on a GPU under 24 GB. Anything else keeps `endpoint`.
 */
export function qwen21Graph(endpoint: string, extra: Record<string, unknown>, vramGb: number | undefined, has: (id: string) => boolean): string {
  const speed = typeof extra[SPEED_PARAM] === "string" ? (extra[SPEED_PARAM] as Qwen21Speed) : "full";
  const tier = speed !== "full" ? QWEN21_SPEED_GRAPH[endpoint]?.[speed] : undefined;
  if (tier && has(tier)) return tier;
  // Full speed (or a speed this operation doesn't have): the full graph, or the small encoder's.
  const small = QWEN21_SMALL_GPU_GRAPH[endpoint];
  const gpu = extra[GPU_PARAM];
  if (small && has(small) && (gpu === "small" || (gpu !== "large" && smallGpu(vramGb)))) return small;
  return endpoint;
}

// ---------------------------------------------------------------------------
// The Lightning LoRA's schedule for a canvas

/** The schedule LightX2V trained the 4-step Lightning LoRA on, before the shift. */
const LIGHTNING_SIGMAS = [1.0, 0.75, 0.5, 0.25];

/**
 * The Lightning LoRA's ManualSigmas for a canvas: its card's [1.0, 0.75, 0.5, 0.25] with diffusers' exponential dynamic
 * shift (mu between 0.5 at 256 and 0.9 at 8192 tokens; Qwen-Image 2.1 has one token per 16 × 16 px), then 0. At 1 MP:
 * "1.0, 0.857192, 0.666756, 0.400096, 0".
 */
export function lightningSigmas(width: number, height: number): string {
  const tokens = Math.max(1, (width / 16) * (height / 16));
  const slope = (0.9 - 0.5) / (8192 - 256);
  const mu = tokens * slope + (0.5 - slope * 256);
  const e = Math.exp(mu);
  const shifted = LIGHTNING_SIGMAS.map((s) => e / (e + (1 / s - 1)));
  return [...shifted.map((s) => String(Math.round(s * 1e6) / 1e6)), "0"].join(", ");
}

/** The graphs whose sigmas follow the canvas (the Lightning tier). */
export const LIGHTNING_GRAPHS: ReadonlySet<string> = new Set(Object.values(QWEN21_SPEED_GRAPH).flatMap((t) => (t.fast ? [t.fast] : [])));

// ---------------------------------------------------------------------------
// The LoRA each speed loads (its switch in Settings → Models & licences holds the speed)

/** The LoRA file each speed's graphs load (the LoRA library's adapter entries, src/lib/catalog/lora-library.generated.ts). */
export const SPEED_LORA: Partial<Record<Qwen21Speed, string>> = {
  draft: "Qwen-Image-2.1-DMD2-2steps-v1.5.safetensors",
  fast: "Qwen-Image-2.1-Lightning-4steps.safetensors",
  details: "p_q_image_2.1_6_steps_upsampled_v0.2_comfyui_bf16.safetensors",
};

/** The speed a run asks for and the LoRA its graph loads, when the route's graph has that speed. */
export function speedLora(endpoint: string, extra: Record<string, unknown> | undefined): { speed: Qwen21Speed; file: string } | undefined {
  const speed = extra?.[SPEED_PARAM];
  if (typeof speed !== "string" || !QWEN21_SPEED_GRAPH[endpoint]?.[speed as Qwen21Speed]) return undefined;
  const file = SPEED_LORA[speed as Qwen21Speed];
  return file ? { speed: speed as Qwen21Speed, file } : undefined;
}
