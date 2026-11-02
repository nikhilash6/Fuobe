import type { ModelOptions } from "@/lib/catalog/types";

/**
 * MiniMax H3 on 8-31 GB graphics cards (research #10 §6.4, package nm10-h3-any-gpu). Pure: which H3 build a GPU runs, from
 * what the GPU check read (its memory, its name, the PyTorch build), and the graphs and files each build takes.
 *
 * - Standard (32 GB or more, and any reading that can't tell: a CPU, no check yet, a card it doesn't know): today's graphs,
 *   the fl2va pruned int8 model with the Turbo v4 LoRA (or Best's 20 steps).
 * - FastH3 V2 (16-31 GB, Ada or newer): FastVideo's 8-step DMD2 distill of H3 (FastVideo/FastVideo-FastH3-Comfy), the
 *   pruned int8 build (22.1 GB, partly offloaded on cards under 24 GB), or NVFP4 (13.6 GB) on Blackwell. Text, start frame
 *   and start + end frames to video, as Comfy-Org's FastH3 templates run it (FastVideo's own card says FL2VA wasn't
 *   distilled, so a start frame is followed less closely than on Standard).
 * - FastH3 Trim (12-15 GB on Ada or newer, 8-15 GB on Blackwell): 42 of H3's 50 blocks, 8 steps, experimental and below V2
 *   in quality, text to video only (FastVideo's cards name eight-step text-to-video and nothing else). NVFP4 (11.9 GB) on
 *   Blackwell, else int8 ConvRot (18.9 GB, the template's format) on a CUDA 13 PyTorch, fp8 (19.7 GB) on an older one
 *   (Comfy-Org: fp8 only where int8 ConvRot can't run). Both larger files are partly offloaded to system memory.
 * - Needs a bigger GPU: under 8 GB, under 12 GB without Blackwell, or a card older than Ada (RTX 30 and before) under
 *   32 GB, whose kernels FastVideo didn't test. Options → GPU tier can still pick a build on any card.
 *
 * Every build reads the same text encoder, Qwen3-VL 32B NVFP4-AWQ (15.7 GB, offloaded after encoding), the file every
 * FastVideo and Comfy-Org H3 template pairs with every diffusion file (it runs on any recent NVIDIA card; native on
 * Blackwell), and the same int8 video VAE and audio VAE.
 *
 * Speeds and the 8 GB figure are FastVideo's own measurements (a 5 s 480p clip with sound: 13.4 s on an RTX 5090, 43.9 s
 * on an RTX 4090, 82 s on a 4090 capped at 8 GB with the NVFP4 Trim), never measured here.
 */

export type H3Tier = "standard" | "fast" | "trim";

/** The diffusion file's format a tier loads. */
export type H3Weights = "int8" | "fp8" | "nvfp4";

/** Graphics card generations, as the chooser tells them apart (compute capability in brackets). */
export type GpuArch = "blackwell" | "hopper" | "ada" | "ampere" | "turing" | "older" | "other" | "unknown";

/** What the GPU check read about the card a run goes to. */
export interface H3Device {
  /** Graphics memory in GB, rounded as the check reads it (src/lib/gpu/requirements.ts vramGb); undefined on a CPU or with no reading. */
  vramGb?: number;
  /** The device's name as /system_stats gives it ("cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync"). */
  name?: string;
  /** The device type ("cuda", "mps", "xpu", "cpu"). */
  type?: string;
  /** ComfyUI's PyTorch build ("2.12.0+cu130"), when the check read it. */
  torch?: string;
}

export interface H3TierChoice {
  tier: H3Tier;
  /** The diffusion file's format (fast and trim). */
  weights?: H3Weights;
  /** The diffusion file this tier loads in place of the graph's default (undefined: the graph's own). */
  unet?: string;
  /** Some of the model waits in system memory while it runs (the file is bigger than the card). */
  offload: boolean;
  /** "FastH3 Trim (fp8)", "FastH3 V2 (int8)", "Standard". */
  label: string;
  /** No build fits this card: the run goes to Standard, which the GPU pre-flight then says needs a bigger GPU. */
  tooSmall?: boolean;
  /** Why a smaller build isn't picked (too little memory, an older card), in plain words. */
  reason?: string;
}

/** Options → GPU tier's param (params.extra). Unset is Auto. */
export const H3_TIER_PARAM = "gpuTier";

/** The diffusion file the run loads (a binding of the FastH3 graphs). */
export const H3_UNET_PARAM = "unet";

/** Memory each tier starts at (GB, rounded as the GPU check reads it). */
export const H3_STANDARD_GB = 32;
export const H3_FAST_GB = 16;
export const H3_TRIM_GB = 12;
export const H3_TRIM_BLACKWELL_GB = 8;

/** FastH3 V2's files (FastVideo/FastVideo-FastH3-Comfy @ ec1e3aa3, FastVideo/FastVideo-FastH3-8-Step-V2-NVFP4-Comfy @ 994a40be). */
export const FAST_FILES: Record<"int8" | "nvfp4", { file: string; gb: number }> = {
  int8: { file: "fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors", gb: 22.13 },
  nvfp4: { file: "fastvideo_fasth3_8step_v2_pruned_nvfp4.safetensors", gb: 13.61 },
};

/** FastH3 Trim's files (FastVideo/FastVideo-FastH3-Trim-Comfy @ f66c13dc). */
export const TRIM_FILES: Record<H3Weights, { file: string; gb: number }> = {
  int8: { file: "fastvideo_fasth3_trim_8step_int8_convrot.safetensors", gb: 18.92 },
  fp8: { file: "fastvideo_fasth3_trim_8step_fp8.safetensors", gb: 19.68 },
  nvfp4: { file: "fastvideo_fasth3_trim_8step_nvfp4.safetensors", gb: 11.89 },
};

/** The text encoder every tier reads (the FastH3 templates' pairing). */
export const H3_ENCODER = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors";

/** The graphs each tier runs in place of a Standard graph. Trim has text to video only. */
export const H3_TIER_GRAPH: Record<string, Partial<Record<Exclude<H3Tier, "standard">, string>>> = {
  "minimax-h3-t2v": { fast: "minimax-h3-fast-t2v", trim: "minimax-h3-trim-t2v" },
  "minimax-h3-i2v": { fast: "minimax-h3-fast-i2v" },
  "minimax-h3-flf2v": { fast: "minimax-h3-fast-flf2v" },
};

/** Every FastH3 graph (the ones whose diffusion file follows the card: the `unet` binding). */
export const H3_TIER_GRAPHS: ReadonlySet<string> = new Set(Object.values(H3_TIER_GRAPH).flatMap((t) => Object.values(t)));

/** Which tier a FastH3 graph belongs to. */
export function tierOfGraph(id: string): Exclude<H3Tier, "standard"> | undefined {
  for (const t of Object.values(H3_TIER_GRAPH)) for (const [tier, g] of Object.entries(t)) if (g === id) return tier as Exclude<H3Tier, "standard">;
  return undefined;
}

// ---------------------------------------------------------------------------
// The card's generation, from its name

/** Names, newest first: the first match wins. */
const ARCH_NAMES: [GpuArch, RegExp][] = [
  // RTX 50, RTX PRO 6000 / 5000 … Blackwell, B100 / B200 / B300, GB200 / GB300, GB10 (DGX Spark), Jetson Thor.
  ["blackwell", /\bRTX\s*50\d0\b|\bBlackwell\b|\bG?B[123]00\b|\bGB10\b|\bDGX Spark\b|\bThor\b/i],
  ["hopper", /\bG?H(100|200|800|20)\b/i],
  // RTX 40, RTX 6000 / 5000 / 4000 / 2000 Ada, L4, L40, L40S, L20.
  ["ada", /\bRTX\s*40\d0\b|\bAda\b|\bL(4|40S?|20)\b/i],
  ["ampere", /\bRTX\s*30\d0\b|\bRTX\s*A\d{3,4}\b|\bA(100|800|40|30|16|10G?|10M?|2)\b|\bOrin\b/i],
  ["turing", /\bRTX\s*20\d0\b|\bGTX\s*16\d0\b|\bT4\b|\bTITAN RTX\b|\bQuadro RTX\b/i],
  ["older", /\bGTX\s*(10\d0|9\d0|TITAN)\b|\bV100\b|\bTITAN (V|Xp?)\b|\bP(100|40|4)\b|\bQuadro\b|\bTesla\b/i],
  ["other", /\bRadeon\b|\bInstinct\b|\bAMD\b|\bIntel\b|\bArc\b|\bApple\b/i],
];

/** A card's generation from the name the GPU check read (and its type: Apple and Intel devices aren't CUDA). */
export function gpuArch(name: string | undefined, type?: string): GpuArch {
  if (type && type !== "cuda") return type === "cpu" ? "unknown" : "other";
  const n = name ?? "";
  for (const [arch, re] of ARCH_NAMES) if (re.test(n)) return arch;
  return "unknown";
}

/** Ada (compute capability 8.9) or newer: the cards FastVideo measured FastH3 on, and fp8's floor. */
export const adaOrNewer = (a: GpuArch) => a === "ada" || a === "hopper" || a === "blackwell";

/** A PyTorch built for CUDA 13 ("+cu130"), which int8 ConvRot's fast kernels need (Comfy-Org's note on its repacks). */
export const cuda13 = (torch: string | undefined) => /\+cu1[3-9]\d/.test(torch ?? "");

// ---------------------------------------------------------------------------
// The chooser

const label = (tier: H3Tier, weights?: H3Weights) =>
  tier === "standard" ? "Standard" : `${tier === "fast" ? "FastH3 V2" : "FastH3 Trim"} (${weights})`;

/** The file a tier loads on this card. Unknown cards take the templates' default format (int8 ConvRot). */
export function tierWeights(tier: Exclude<H3Tier, "standard">, arch: GpuArch, torch?: string): H3Weights {
  if (arch === "blackwell") return "nvfp4";
  if (tier === "fast") return "int8";
  return adaOrNewer(arch) && torch && !cuda13(torch) ? "fp8" : "int8";
}

/** A tier on this card: its file, and whether part of it waits in system memory. */
export function tierChoice(tier: H3Tier, d: H3Device): H3TierChoice {
  if (tier === "standard") return { tier, offload: false, label: label(tier) };
  const weights = tierWeights(tier, gpuArch(d.name, d.type), d.torch);
  const f = tier === "fast" ? FAST_FILES[weights as "int8" | "nvfp4"] : TRIM_FILES[weights];
  // About 2 GB of a card goes to the picture being made: a file bigger than the rest is partly offloaded.
  const offload = typeof d.vramGb === "number" && f.gb > d.vramGb - 2;
  return { tier, weights, unet: f.file, offload, label: label(tier, weights) };
}

/**
 * The build MiniMax H3 runs on a card (Auto). A CPU, no reading and a card it can't place keep Standard, the default graph,
 * so the GPU pre-flight judges it as it does today.
 */
export function chooseH3Tier(d: H3Device): H3TierChoice {
  const gb = d.vramGb;
  if (typeof gb !== "number" || gb <= 0 || gb >= H3_STANDARD_GB) return tierChoice("standard", d);
  const arch = gpuArch(d.name, d.type);
  if (arch === "unknown") return tierChoice("standard", d);
  const small = (reason: string): H3TierChoice => ({ tier: "standard", offload: false, label: "Needs a bigger GPU", tooSmall: true, reason });
  if (!adaOrNewer(arch)) return small("MiniMax H3 needs 32 GB on this card. The smaller builds need an RTX 40 or newer");
  if (gb >= H3_FAST_GB) return tierChoice("fast", d);
  if (gb >= H3_TRIM_GB || (arch === "blackwell" && gb >= H3_TRIM_BLACKWELL_GB)) return tierChoice("trim", d);
  return small(arch === "blackwell" ? "MiniMax H3 needs at least 8 GB" : "MiniMax H3 needs at least 12 GB on this card (8 GB on an RTX 50)");
}

/** The tier a run takes: the one asked for in Options → GPU tier, else Auto's. */
export function h3TierFor(asked: unknown, d: H3Device): H3TierChoice {
  if (asked === "standard" || asked === "fast" || asked === "trim") return tierChoice(asked, d);
  return chooseH3Tier(d);
}

/** The graph a tier runs for a Standard graph (undefined: that tier has no graph for it, so the run keeps Standard). */
export function tierGraphFor(endpoint: string, tier: H3Tier | undefined, has: (id: string) => boolean): string | undefined {
  if (!tier || tier === "standard") return undefined;
  const g = H3_TIER_GRAPH[endpoint]?.[tier];
  return g && has(g) ? g : undefined;
}

/**
 * The graph a MiniMax H3 run takes for its tier (params.extra.gpuTier as the plan decided it: src/server/h3-gpu.ts). An orbit
 * keeps the Orbit LoRA graph (Standard only); a smaller tier wins over Quality's Best (Best's 20 steps load the full model).
 */
export function h3TierGraph(endpoint: string, extra: Record<string, unknown>, has: (id: string) => boolean): string {
  if (extra.orbit === true) return endpoint;
  const tier = extra[H3_TIER_PARAM];
  return tierGraphFor(endpoint, tier === "fast" || tier === "trim" ? tier : undefined, has) ?? endpoint;
}

/** What a smaller tier changes, as the run's notes and the composer say it. */
export const TIER_NOTES: Record<Exclude<H3Tier, "standard">, string> = {
  fast: "FastH3 V2: an 8-step build of MiniMax H3 for 16-31 GB GPUs. A start frame is followed less closely than on the full model",
  trim: "FastH3 Trim: an experimental 8-step build for 8-15 GB GPUs, below FastH3 V2 in quality. Text to video only",
};

/** A smaller tier picked with Best: Best needs the full model. */
export const TIER_BEST_NOTE = "Best needs a 32 GB GPU: this run uses 8 steps";

/** Options → GPU tier (no value is Auto: the card's own tier, src/server/h3-gpu.ts). */
export const H3_GPU_TIER: NonNullable<ModelOptions["controls"]>[number] = {
  param: H3_TIER_PARAM,
  label: "GPU tier",
  values: ["standard", "fast", "trim"],
  labels: {
    standard: "32 GB or more · full model",
    fast: "16 GB · FastH3 V2, 8 steps",
    trim: "8-12 GB · FastH3 Trim, experimental, text to video only",
  },
  ops: { standard: ["t2v", "i2v", "flf2v"], fast: ["t2v", "i2v", "flf2v"], trim: ["t2v"] },
};

/** The composer's note under MiniMax H3's options when a smaller tier is picked for an operation that has it. */
export function h3TierNote(extra: Record<string, unknown> | undefined, op: string | undefined): string | undefined {
  const tier = extra?.[H3_TIER_PARAM];
  if ((tier !== "fast" && tier !== "trim") || !op || !H3_GPU_TIER.ops?.[tier]?.includes(op)) return undefined;
  return extra?.quality === "best" ? `${TIER_NOTES[tier]}. ${TIER_BEST_NOTE}` : TIER_NOTES[tier];
}
