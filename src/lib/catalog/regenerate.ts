/**
 * Open-H3 Regenerate 2K (docs/research/new-models-7.md §2): NVIDIA's open refiner for MiniMax H3, a finishing step that
 * redraws a soft clip at 1080p, 2K or 4K. Pure: the ModelDef's settings, the graph's strings, the 15 s windows a longer
 * clip runs in, the draft preset by source, the copy, the licences as information, and the cloud's re-render of a fal H3
 * result at 2K (the same hosted model asked for a size it offers, never a stand-in for the open model).
 *
 * Nobody hosts the open model, so Regenerate · creative is GPU-only: the cloud engine says it runs on your GPU, and
 * Engine mode "Paid APIs only" hides it.
 */
import type { Generation, GenerationRequest, LoraRef } from "./types";

export const REGEN_MODEL = "oss-h3-regenerate";
export const REGEN_WORKFLOW = "video-regenerate-h3";
/** The join a clip redrawn in 15 s parts ends with (packet by packet: every part has the same size and rate). */
export const REGEN_JOIN = "oss-join-encoded";
/** Upscale → Video's restore model, shown beside Regenerate. */
export const RESTORE_MODEL = "oss-seedvr2";

/** The output tiers (the result's shorter edge, as Upscale → Video names them) and the default, 2K. */
export const REGEN_TIERS = ["1080p", "1440p", "2160p"] as const;
export const REGEN_DEFAULT_TIER = "1440p";

/** A tier as OpenH3RegenUpscale's combo names it (copied from the pack's INPUT_TYPES at 9b686c5). */
export const REGEN_RESOLUTION: Record<(typeof REGEN_TIERS)[number], string> = {
  "1080p": "1080p (1920x1080)",
  "1440p": "2k (2560x1440)",
  "2160p": "4k (3840x2160)",
};

/** The pack's resolution string for a tier ("2k (2560x1440)" for anything it doesn't know). */
export function regenResolution(tier: string | undefined): string {
  return REGEN_RESOLUTION[(tier ?? REGEN_DEFAULT_TIER) as keyof typeof REGEN_RESOLUTION] ?? REGEN_RESOLUTION[REGEN_DEFAULT_TIER];
}

/** OpenH3RegenPrepareDraft's sizes (the pack's SIZES). */
export const REGEN_DRAFT = { h3: "768p (1344x768)", other: "576p (1024x576)", keep: "keep (snap to 32)" } as const;

/** Models whose clips are H3 drafts (the refiner was trained on them): MiniMax H3 in any form, and the Character swaps. */
export function isH3Source(modelId: string | undefined): boolean {
  return !!modelId && /(^|-)(h3|hailuo)(-|$)|minimax-h3|character-swap/.test(modelId);
}

/**
 * The draft preset (NVIDIA's reference: 768p for H3 drafts, 576p for other models), for every shape. Prepare Draft
 * cover-scales and centre-crops the clip to it (turned for a tall clip: 768 x 1344), and the pack's upscale always
 * targets 16:9 or 9:16, so a square, 4:3 or 21:9 clip is cropped to that shape rather than stretched (REGEN_COPY.shape).
 */
export function draftSizeFor(o: { fromH3: boolean }): string {
  return o.fromH3 ? REGEN_DRAFT.h3 : REGEN_DRAFT.other;
}

/** The shape a result comes out in: 9:16 for a tall clip, else 16:9 (the pack's own rule: height > width). */
export function regenShape(width?: number, height?: number): "16:9" | "9:16" {
  return width && height && height > width ? "9:16" : "16:9";
}

/** Whether a clip of this size is cropped to fit (more than a few pixels off 16:9 or 9:16). */
export function regenCrops(width?: number, height?: number): boolean {
  if (!width || !height) return false;
  return Math.abs(Math.max(width, height) / Math.min(width, height) - 16 / 9) > 0.06;
}

/** The refine runs at 24 fps, up to 360 frames (15 s) a pass. */
export const REGEN_FPS = 24;
export const REGEN_MAX_FRAMES = 360;
export const REGEN_WINDOW_SECONDS = 15;

/**
 * The frames one pass reads: the clip's seconds at 24 fps, at most 360. Unknown length: 360 (Prepare Draft reads at most
 * the frames the clip has, so a shorter clip is read whole).
 */
export function regenFrames(seconds: number | undefined): number {
  if (!seconds || !(seconds > 0)) return REGEN_MAX_FRAMES;
  return Math.max(5, Math.min(REGEN_MAX_FRAMES, Math.round(seconds * REGEN_FPS)));
}

/**
 * The windows a clip is regenerated in: one pass up to 15 s; a longer clip in equal parts of at most 15 s each (20 s
 * → 2 × 10 s, 40 s → 3 × 13.3 s), so no part is a sliver. Each is its own run, then they are joined packet by packet.
 */
export function regenWindows(seconds: number | undefined): { start: number; duration: number }[] {
  if (!seconds || !(seconds > REGEN_WINDOW_SECONDS + 0.05)) return [{ start: 0, duration: seconds && seconds > 0 ? seconds : 0 }];
  const n = Math.ceil(seconds / REGEN_WINDOW_SECONDS);
  const len = seconds / n;
  return Array.from({ length: n }, (_, i) => ({ start: Math.round(i * len * 1000) / 1000, duration: Math.round(len * 1000) / 1000 }));
}

export const REGEN_SEAM_NOTE =
  "Open-H3 Regenerate redraws up to 15 s at a time, so this clip is redrawn in parts and joined: the parts don't share history, so a seam or a small jump in detail can show where they meet";

/** The longest clip one Regenerate run takes: 40 parts of 15 s. */
export const REGEN_MAX_PARTS = 40;
export const REGEN_MAX_SECONDS = REGEN_MAX_PARTS * REGEN_WINDOW_SECONDS;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** The refusal for a clip (or span) longer than one run takes. */
export function regenTooLong(seconds: number): string {
  return `Regenerate takes up to ${REGEN_MAX_SECONDS / 60} minutes of video in one run, and this clip runs ${mmss(seconds)}. Trim it, or regenerate it in shorter pieces`;
}

/** A run whose length isn't known when it is created (it waits for an earlier step, or reads a link). */
export const REGEN_ONE_PASS_NOTE = "This run redraws up to 15 s in one pass. If the clip turns out longer, it stops and says how to redraw it in parts";

/** The refusal when a single pass would get a clip longer than 15 s (it would come back cut short). */
export function regenOnePassRefusal(seconds: number): string {
  return `Regenerate redraws up to 15 s in one pass, and this clip runs ${Math.round(seconds * 10) / 10} s. Open the finished clip and pick Regenerate in 2K: it is redrawn in 15 s parts and joined`;
}

/** The note for a clip that isn't 16:9 or 9:16. */
export function regenCropNote(width: number, height: number): string {
  return `Regenerate makes ${regenShape(width, height)} video, so this ${width}×${height} clip is cropped to ${regenShape(width, height)} at the centre`;
}

// ---------------------------------------------------------------------------
// Copy

export const REGEN_COPY = {
  creative: "Regenerate · creative: redraws your clip at 2K. Details may change; motion and layout stay.",
  faithful: "Restore · faithful: keeps every detail and sharpens it.",
  /** The owner's GPU line (the install detail is theirs to act on). */
  gpu: "About 3 minutes per 5 s at 2K on a 72 GB GPU. Needs about 40 GB of new files (OPEN_H3_REGEN=1 in install-comfyui.sh).",
  /** The same line for guests and accounts. */
  gpuVisitor: "Runs on your own GPU · about 3 minutes per 5 s at 2K",
  /** Results are 16:9 or 9:16 whatever the clip's shape. */
  shape: "Comes out 16:9, or 9:16 for a tall clip: other shapes are cropped to fit.",
  /** The owner's refusal when the server's ComfyUI lacks the nodes. */
  missing: "Your ComfyUI is missing the Open-H3 Regenerate nodes: run scripts/comfy/install-comfyui.sh with OPEN_H3_REGEN=1.",
  /** The same refusal on an account's own ComfyUI. */
  missingVisitor: "Your ComfyUI doesn't have Open-H3 Regenerate yet. Add it with Fuobe's ComfyUI setup, then run this again.",
  /** The refusal when Settings → Models & licences has the refiner switched off. */
  off: "Regenerate isn't available right now. Pick Restore · faithful to sharpen the clip instead.",
  gpuOnly: "Runs on your GPU (open source)",
  prompt: "Describe the clip: what is in it, how it moves, the light. Regenerate redraws it from these words",
} as const;

/** The two finishing choices Upscale → Video shows side by side on the open engine. */
export const FINISH_CHOICES = [
  { modelId: RESTORE_MODEL, label: "Restore · faithful", hint: "Keeps every detail and sharpens it." },
  { modelId: REGEN_MODEL, label: "Regenerate · creative", hint: "Redraws your clip at 2K. Details may change; motion and layout stay." },
] as const;

// ---------------------------------------------------------------------------
// Files and licences (information for Settings → Models & licences, never a gate)

const H3_TERMS =
  'MiniMax H3 Community License: granted outside the US, the EU, the UK and the Republic of Korea; written authorization above US$20M yearly revenue; show "MiniMax H3" on a commercial product\'s interface. Comfy\'s docs add that commercial use of locally made outputs needs a MiniMax licence';

/** NVIDIA's merged refiner LoRA (refiner + LightX2V Turbo v1.2 + LMS Sharp), which the graph loads itself. */
export const REGEN_LORA: LoraRef = {
  file: "open_h3_regenerate_2k_lora.safetensors",
  url: "https://huggingface.co/Efficient-Large-Model/Open-H3-Regenerate-2K/resolve/5809c33730c18b6b1c827b40974855a4288641b3/lora/open_h3_regenerate_2k_lora.safetensors",
  version: "5809c33730c18b6b1c827b40974855a4288641b3",
  licence: { commercial: true, hostedOk: true, snapshotDate: "2026-10-29", name: "MiniMax H3 Community License" },
};

/** The LoRA files a Regenerate graph loads itself, so a run downloads the ones ComfyUI lacks before it starts. */
export function regenerateGraphLoras(endpoint: string): LoraRef[] {
  return endpoint === REGEN_WORKFLOW ? [REGEN_LORA] : [];
}

/** The new files and their licences, as the research recorded them (§2.4, §2.5). */
export const REGEN_FILES: { file: string; item: string; sizeGb: number; licence: string; note: string }[] = [
  {
    file: REGEN_LORA.file,
    item: "Open-H3-Regenerate-2K LoRA (NVIDIA)",
    sizeGb: 12.45,
    licence: "MiniMax H3 Community License",
    note: `${H3_TERMS}. The merged LightX2V Turbo v1.2 part is Apache-2.0 (at 3ec17a3); the LMS Sharp part has no stated licence`,
  },
  { file: "fast_h3_vae_noncausal_24l.safetensors", item: "Fast H3 VAE decoder (NVIDIA StreamRender-H3)", sizeGb: 6.47, licence: "MiniMax H3 Community License", note: `A distilled Model Derivative. ${H3_TERMS}` },
  { file: "minimax_h3_fl2va_pruned_int8_convrot.safetensors", item: "MiniMax H3 FL2VA (pruned int8, Comfy-Org)", sizeGb: 20.97, licence: "MiniMax H3 Community License", note: H3_TERMS },
  {
    file: "minimax_h3_latent_upscaler_3d_conv_v1_bf16.safetensors",
    item: "H3 latent upscaler (LBH-123-AI)",
    sizeGb: 0.69,
    licence: "Apache-2.0",
    note: "Weights Apache-2.0 (LBH's model card; NVIDIA's copy ships the Apache text); LBH's node code is MIT",
  },
];

// ---------------------------------------------------------------------------
// Result actions

/** Model families whose clips get "Regenerate in 2K" among the next steps under a fresh result. */
export function regenerateFamily(modelId: string): "h3" | "ltx" | "wan" | "sana" | null {
  if (isH3Source(modelId)) return "h3";
  if (/ltx/.test(modelId)) return "ltx";
  if (/(^|-)wan(\d|-|$)/.test(modelId)) return "wan";
  if (/sana/.test(modelId)) return "sana";
  return null;
}

/** The longest prompt a hand-off link carries (the composer shows it to edit; Regenerate needs words). */
const HANDOFF_PROMPT = 1500;

/** Upscale → Video on Regenerate, at 2K, with the clip and its own words (when it has some). */
export function regenerateHref(video: string, prompt?: string | null): string {
  const words = prompt?.trim().slice(0, HANDOFF_PROMPT);
  return `/upscale/video?video=${encodeURIComponent(video)}&model=${REGEN_MODEL}&resolution=${REGEN_DEFAULT_TIER}${words ? `&prompt=${encodeURIComponent(words)}` : ""}`;
}

/**
 * The words for a clip that has none (an upload): Fuobe's reading model on your GPU (oss-reference-brief, Gemma 4 watching
 * the frames and hearing the sound) writes one paragraph, which fills the prompt box to edit before the run.
 */
export const REGEN_DESCRIBE_MODEL = "oss-reference-brief";
export const REGEN_DESCRIBE_FEATURE = "regenerate-describe";
export const REGEN_DESCRIBE_INSTRUCTION =
  "You are given a short video clip (frames at 1 fps plus its soundtrack). Write one paragraph of 60 to 120 words that describes it for a video model that will redraw it in more detail: who or what is in it and what they look like, the setting, how things and the camera move, the light and colours, and the look (live action, animation, 3D render). Describe only what is visible. Plain prose: no lists, headings, labels or quotes.";

/** The request that reads a clip for its words (its first 15 s, what one Regenerate pass redraws). */
export function regenDescribeRequest(video: string, seconds?: number): GenerationRequest {
  const span = seconds && seconds > 0 ? Math.min(REGEN_WINDOW_SECONDS, seconds) : REGEN_WINDOW_SECONDS;
  return {
    feature: REGEN_DESCRIBE_FEATURE,
    modelId: REGEN_DESCRIBE_MODEL,
    op: "write",
    inputs: { video },
    params: { duration: Math.round(span * 100) / 100, numOutputs: 1, extra: { instruction: REGEN_DESCRIBE_INSTRUCTION } },
  };
}

/** The paragraph from the reading model's answer: no surrounding quotes, fences or label, one line, at most 1500 characters. */
export function regenDescription(text: string | undefined): string {
  return (text ?? "")
    .replace(/^```[a-z]*\s*|\s*```$/gi, "")
    .replace(/^\s*(description|prompt)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“'](.*)["”']$/s, "$1")
    .trim()
    .slice(0, HANDOFF_PROMPT);
}

/**
 * fal's hosted MiniMax H3 results the cloud can render again at 2K or 4K: the same endpoint, inputs and seed with a size
 * it offers. A new render (fal makes 2K and 4K from a 768P base), not a sharpened copy, and priced per second.
 */
export const RERENDER: Record<string, { label: string; perSecond: Record<"2K" | "4K", number> }> = {
  "minimax-h3": { label: "MiniMax H3", perSecond: { "2K": 0.13, "4K": 0.16 } },
  "fuobe-character-swap": { label: "the Character swap (MiniMax H3 with LoRAs)", perSecond: { "2K": 0.1625, "4K": 0.2 } },
};

/** Sizes a fal H3 result can already be at that a 2K re-render wouldn't improve. */
const AT_2K_OR_MORE = /^(2k|4k|1440p|2160p)$/i;

/**
 * A cloud result that can be re-rendered at 2K: a finished fal H3 run whose inputs are in its request, made below 2K, and
 * not hidden by Engine mode "Open source only" (a paid run the server would refuse).
 */
export function canRerender(g: Pick<Generation, "engine" | "provider" | "modelId" | "status" | "request" | "kind">, engineMode?: "both" | "open" | "cloud"): boolean {
  if (engineMode === "open") return false;
  const made = g.request.params?.resolution;
  if (typeof made === "string" && AT_2K_OR_MORE.test(made)) return false;
  return g.kind === "video" && g.status === "succeeded" && g.engine === "cloud" && g.provider === "fal" && !!RERENDER[g.modelId] && !g.request.chain?.length;
}

/** $0.13, $0.1625, $0.20: cents always, more places only when the price has them. */
const money = (n: number) => `$${n.toFixed(4).replace(/0{1,2}$/, "")}`;

/** "Re-render at 2K · a new render · $0.13/s". */
export function rerenderLabel(modelId: string, size: "2K" | "4K" = "2K"): string {
  const r = RERENDER[modelId];
  return `Re-render at ${size} · a new render${r ? ` · ${money(r.perSecond[size])}/s` : ""}`;
}

/** The seed a result was made with: the one the provider reported, else the request's. */
function seedOf(g: Pick<Generation, "request" | "outputs">): number | undefined {
  const reported = g.outputs.find((o) => typeof o.meta?.seed === "number")?.meta?.seed as number | undefined;
  const asked = g.request.params?.seed;
  return reported ?? (asked !== undefined && asked >= 0 ? asked : undefined);
}

/** The request that renders a fal H3 result again at 2K (or 4K): the same model, operation, inputs, words and seed. */
export function rerenderRequest(g: Pick<Generation, "request" | "outputs" | "modelId" | "op" | "feature">, size: "2K" | "4K" = "2K"): GenerationRequest {
  const r = g.request;
  const seed = seedOf(g);
  return {
    feature: r.feature ?? g.feature,
    modelId: g.modelId,
    op: r.op ?? g.op,
    engine: "cloud",
    ...(r.prompt !== undefined && { prompt: r.prompt }),
    ...(r.negativePrompt && { negativePrompt: r.negativePrompt }),
    ...(r.inputs && { inputs: r.inputs }),
    ...(r.loras?.length && { loras: r.loras }),
    ...(r.presetId && { presetId: r.presetId }),
    params: { ...r.params, resolution: size, numOutputs: 1, ...(seed !== undefined && { seed }) },
  };
}
