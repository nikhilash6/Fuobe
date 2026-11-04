import type { ModelOptions } from "@/lib/catalog/types";

/**
 * Qwen-Image 2.1 on your GPU in 2–8 steps and on 16 GB cards (research #10 §6.7). Pure: the
 * provider (src/server/providers/comfyui.ts) and the GPU pre-flight's gate both resolve a run's graph through
 * resolveWorkflowId (src/lib/comfy-variants.ts), which reads these tables.
 *
 * - Options → Speed: Draft (2 steps, linoyts' DMD2 LoRA v1.5), Fast (4 steps, LightX2V's Lightning LoRA), "Fast · writes
 *   the details" (6 steps, Pruna's P-Q-Image v0.2 upsampled LoRA), Turbo (the official 8-step Turbo checkpoint, edits
 *   only) and Full (the hand-built 25-step graphs, the default). Each tier is its own graph: the base graph with one LoRA and
 *   a ManualSigmas schedule (scripts/comfy/library.spec.mjs, qwen21Tier).
 * - Options → GPU: Zen Image Edit's 0.8B encoder in place of the 17.5 GB Qwen3-VL 8B for text to image and edits at Full
 *   speed: when asked (Small), or on Auto when the GPU check reads a graphics card under 20 GB and the small route is ready
 *   there (src/server/qwen21-gpu.ts decides once per run, so the pre-flight and the run take the same graph).
 * - Options → Decoder: the Texture-Fix VAE ("Clean") in place of the stock decoder; off until tested.
 *
 * fal's hosted Qwen-Image 2.1 takes no LoRAs or speed graphs, so these options are the open engine's.
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

/**
 * Below this much graphics memory (GB, rounded as the GPU check reads it: src/lib/gpu/requirements.ts vramGb), Auto runs the
 * small encoder: the full graph needs about 20 GB (Qwen3-VL 8B int8 9.4 GB + the int8 model 7.3 GB + activations). A 24 GB card
 * (an RTX 4090 reads 23.65 GiB, which rounds to 24) keeps the full encoder.
 */
export const SMALL_GPU_BELOW_GB = 20;

export const SPEED_PARAM = "speed";
export const GPU_PARAM = "gpu";
export const DECODER_PARAM = "decoder";

/** The most pictures "Fast · writes the details" edits with (Pruna's card: at most 3 references). */
export const DETAILS_MAX_IMAGES = 3;

/** Zen Image Edit's fusion adapter (release v2 of recoilme/zen-image-edit-comfyui), a tracked download in models/text_encoders. */
export const ZEN_ADAPTER = { folder: "text_encoders", file: "adapter_v12.safetensors" } as const;

/**
 * Zen Image Edit's text encoder, Qwen3.5-0.8B (Apache-2.0), at the revision its setup command pins, in its own folder under
 * models/text_encoders (the folder the pack's README downloads it to). Without that folder the loader fetches it by id.
 */
export const ZEN_ENCODER = { id: "Qwen/Qwen3.5-0.8B", revision: "2fc06364715b967f1860aea9cf38778875588b17", dir: "qwen3.5_0.8b", weights: "model.safetensors-00001-of-00001.safetensors" } as const;

/** The Texture-Fix VAE (madebyollin), an optional file every Qwen-Image 2.1 graph lists. */
export const CLEAN_VAE = "texture_fix_vae_for_qwen_image_2.1_bf16.safetensors";

/** The operations each speed is offered on (Turbo is the 8-step edit graph; "writes the details" text to image and edits). */
export const SPEED_OPS: Record<Qwen21Speed, string[]> = {
  full: ["t2i", "edit", "inpaint", "outpaint"],
  turbo: ["edit"],
  fast: ["t2i", "edit", "inpaint", "outpaint"],
  details: ["t2i", "edit"],
  draft: ["t2i", "edit", "inpaint", "outpaint"],
};

type Control = NonNullable<ModelOptions["controls"]>[number];

/** Options → Speed (the default stays Full: the hand-built graphs). */
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

/** Options → GPU: Auto picks Small on a card under 20 GB when the small route is ready (text to image and edits, Full speed). */
export const QWEN21_GPU: Control = {
  param: GPU_PARAM,
  label: "GPU",
  values: ["large", "small"],
  labels: { large: "20 GB or more", small: "16 GB · English prompts only" },
  ops: { large: ["t2i", "edit", "inpaint", "outpaint"], small: ["t2i", "edit"] },
};

/** What the small encoder can't do, as the composer and a run's notes say it. */
export const SMALL_GPU_NOTE = "Small GPU: English prompts only, and numbers on signs can come out wrong";

/** Small with a speed that has its own graph: the speed wins. */
export const SMALL_GPU_AT_FULL = "Small GPU applies at Full speed only: this speed needs a 20 GB GPU";

/** Options → Decoder: Clean is the Texture-Fix VAE (cleaner fine texture, no checkerboard), off by default. */
export const QWEN21_DECODER: Control = {
  param: DECODER_PARAM,
  label: "Decoder",
  values: ["standard", "clean"],
  default: "standard",
  labels: { standard: "Standard", clean: "Clean · finer texture" },
  sets: { standard: {}, clean: { vae: CLEAN_VAE } },
};

/** Whether a graphics card of this size (GB, rounded as the GPU check reads it; undefined for a CPU or no reading) is small. */
export function smallGpu(vramGb: number | undefined): boolean {
  return typeof vramGb === "number" && vramGb > 0 && vramGb < SMALL_GPU_BELOW_GB;
}

/** The speed asked for (Full when none). */
const speedOf = (extra: Record<string, unknown>): Qwen21Speed => (typeof extra[SPEED_PARAM] === "string" ? (extra[SPEED_PARAM] as Qwen21Speed) : "full");

/** The speed tier's graph this run takes, when the speed has one for this operation's graph. */
function tierGraph(endpoint: string, extra: Record<string, unknown>, has: (id: string) => boolean): string | undefined {
  const speed = speedOf(extra);
  const tier = speed !== "full" ? QWEN21_SPEED_GRAPH[endpoint]?.[speed] : undefined;
  return tier && has(tier) ? tier : undefined;
}

/**
 * The small encoder's graph a run on `endpoint` would take with Options → GPU on Small: text to image and edits with no
 * speed tier (Full, or a speed this operation doesn't have). A speed's graph wins over Small (it loads the full encoder).
 */
export function smallGraphFor(endpoint: string, extra: Record<string, unknown>, has: (id: string) => boolean): string | undefined {
  if (tierGraph(endpoint, extra, has)) return undefined;
  const small = QWEN21_SMALL_GPU_GRAPH[endpoint];
  return small && has(small) ? small : undefined;
}

/**
 * The graph a Qwen-Image 2.1 run takes: the speed's graph when it has one for this operation; else the small encoder's when
 * Options → GPU says Small (a run on Auto has had it decided already: src/server/qwen21-gpu.ts). Anything else keeps `endpoint`.
 */
export function qwen21Graph(endpoint: string, extra: Record<string, unknown>, has: (id: string) => boolean): string {
  const tier = tierGraph(endpoint, extra, has);
  if (tier) return tier;
  const small = extra[GPU_PARAM] === "small" ? smallGraphFor(endpoint, extra, has) : undefined;
  return small ?? endpoint;
}

/**
 * The composer's note under Qwen-Image 2.1's options: what Small can't do when it is picked for an operation that has it, and
 * that Small runs at Full speed only when a speed with its own graph is picked with it.
 */
export function qwen21Note(controls: readonly { param: string }[] | undefined, extra: Record<string, unknown> | undefined, op: string | undefined): string | undefined {
  if (!controls?.some((c) => c.param === GPU_PARAM) || extra?.[GPU_PARAM] !== "small" || !op || !QWEN21_GPU.ops?.small.includes(op)) return undefined;
  const speed = speedOf(extra);
  return speed !== "full" && SPEED_OPS[speed]?.includes(op) ? SMALL_GPU_AT_FULL : SMALL_GPU_NOTE;
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

/** The long side every Qwen-Image 2.1 edit samples at: ImageScaleToMaxDimension (largest_size 2048) scales image 1 up or down to it. */
export const EDIT_LONG_SIDE = 2048;

/**
 * The canvas an edit samples: image 1 scaled so its long side is 2048 (larger or smaller), on the 32 px grid
 * TextEncodeQwenImage21 rounds the latent to.
 */
export function editCanvas(width: number, height: number): { width: number; height: number } {
  const k = EDIT_LONG_SIDE / Math.max(width, height);
  const on32 = (x: number) => Math.max(32, Math.round((x * k) / 32) * 32);
  return { width: on32(width), height: on32(height) };
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
