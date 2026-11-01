/**
 * Live edit's ComfyUI graph (pure, shared by the server and the tab). Qwen-Image 2.1 (int8) with the 2-step DMD2 LoRA
 * at strength 1: BasicGuider (CFG 1, positive only), euler, ManualSigmas "1.0, 0.5, 0.0" (the LoRA's own schedule, no
 * shift), on Fuobe's live nodes (fuobe_live.py, src/lib/comfy-live-nodes.ts):
 *
 *   10 LoadImageFuobeLive (base) ─ 15 CropFuobeLive ─ 20 Qwen21ReferenceFuobeLive ─ 30 Qwen21EncodeFuobeLive ─┐
 *   11–13 (refs) ────────────────────────────────┘           14 (mask) ─ 15, 40                            │
 *   1 UNETLoader ─ 4 LoraLoaderModelOnly ─ 71 BasicGuider ─ 32 SamplerCustomAdvanced ─ 33 VAEDecode ─ 34 Split ┘
 *   ─ 40 PasteBackFuobeLive (unchanged pixels back from the base, colour matched) ─ 90 SaveImageFuobeLive
 *
 * Text to image leaves out 10–15, 20 and 40. `liveGraphProblem` is the tab's check before a graph goes to the person's
 * own ComfyUI: the graph must be exactly what buildLiveGraph makes from its own bound values.
 */
import { MAX_LIVE_TEXT } from "./text";
import { GRAPH_RESOLUTIONS, isAspect, sizeFor, type Aspect, ASPECT_NAMES } from "./sizes";
import { LIVE_INPUT } from "./names";

export const LIVE_WORKFLOW_ID = "qwen-image-21-live-edit";
export const LIVE_MODEL_ID = "oss-qwen-image-21-live";

export const LIVE_FILES = {
  unet: "qwen_image_2.1_int8_convrot.safetensors",
  clip: "qwen3vl_8b_int8_convrot.safetensors",
  vae: "qwen_image_2.1_vae_bf16.safetensors",
  lora: "Qwen-Image-2.1-DMD2-2steps.safetensors",
} as const;

/** The LoRA's trained schedule plus the terminal 0 (explicit sigmas bypass the model's shift). */
export const LIVE_SIGMAS = "1.0, 0.5, 0.0";

/** The node that sends the picture. */
export const LIVE_OUTPUT = "90";

/** The longest prompt a graph may carry (compose joins the kept texts). */
export const MAX_GRAPH_PROMPT = 2000;

export const PACK_LIVE_CLASSES = ["LoadImageFuobeLive", "CropFuobeLive", "Qwen21ReferenceFuobeLive", "Qwen21EncodeFuobeLive", "PasteBackFuobeLive", "SaveImageFuobeLive"] as const;
export const CORE_LIVE_CLASSES = ["UNETLoader", "CLIPLoader", "VAELoader", "LoraLoaderModelOnly", "RandomNoise", "BasicGuider", "KSamplerSelect", "ManualSigmas", "SamplerCustomAdvanced", "VAEDecode", "SplitImageWithAlpha"] as const;
export const LIVE_CLASSES: ReadonlySet<string> = new Set<string>([...CORE_LIVE_CLASSES, ...PACK_LIVE_CLASSES]);

export type PasteMode = "auto" | "mask" | "off";
export type LiveFormat = "webp" | "png";
export type LiveTo = "socket" | "temp";

export interface LiveGraphParams {
  prompt: string;
  seed: number;
  /** The model's resolution: an edit's area (res²), or text to image's size at `aspect`. */
  res: number;
  /** Text to image only. */
  aspect?: Aspect;
  /** The base picture's input name (a master or the original); none for text to image. */
  base?: string;
  /** Pictures 2–4. */
  refs?: string[];
  /** A painted region (white = change). */
  mask?: string;
  paste: PasteMode;
  /** The composite's long side: 0 = the base's full size. */
  outMaxSide: number;
  format: LiveFormat;
  quality?: number;
  to: LiveTo;
}

export type GraphNode = { class_type: string; inputs: Record<string, unknown>; _meta?: { title: string } };
export type LiveGraph = Record<string, GraphNode>;

const link = (id: string, out = 0) => [id, out];

/** The graph for one render, and the input names it reads. */
export function buildLiveGraph(p: LiveGraphParams): { graph: LiveGraph; outputNode: string; staged: string[] } {
  const g: LiveGraph = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: LIVE_FILES.unet, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: LIVE_FILES.clip, type: "qwen_image", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: LIVE_FILES.vae } },
    "4": { class_type: "LoraLoaderModelOnly", inputs: { model: link("1"), lora_name: LIVE_FILES.lora, strength_model: 1 } },
  };
  const staged: string[] = [];
  const refs = (p.refs ?? []).slice(0, 3);
  if (p.base) {
    g["10"] = { class_type: "LoadImageFuobeLive", inputs: { image: p.base } };
    staged.push(p.base);
    refs.forEach((r, i) => {
      g[String(11 + i)] = { class_type: "LoadImageFuobeLive", inputs: { image: r } };
      staged.push(r);
    });
    if (p.mask) {
      g["14"] = { class_type: "LoadImageFuobeLive", inputs: { image: p.mask } };
      staged.push(p.mask);
    }
    g["15"] = { class_type: "CropFuobeLive", inputs: { image: link("10"), context: 1.6, multiple: 32, ...(p.mask && { mask_image: link("14") }) } };
    g["20"] = {
      class_type: "Qwen21ReferenceFuobeLive",
      inputs: { vae: link("3"), resolution: p.res, image_1: link("15"), ...Object.fromEntries(refs.map((_, i) => [`image_${i + 2}`, link(String(11 + i))])) },
    };
  }
  const [w, h] = p.base ? [p.res, p.res] : sizeFor(p.aspect ?? "1:1", p.res);
  g["30"] = { class_type: "Qwen21EncodeFuobeLive", inputs: { clip: link("2"), prompt: p.prompt, width: w, height: h, ...(p.base && { reference: link("20") }) } };
  g["70"] = { class_type: "RandomNoise", inputs: { noise_seed: p.seed } };
  g["71"] = { class_type: "BasicGuider", inputs: { model: link("4"), conditioning: link("30") } };
  g["72"] = { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } };
  g["73"] = { class_type: "ManualSigmas", inputs: { sigmas: LIVE_SIGMAS } };
  g["32"] = { class_type: "SamplerCustomAdvanced", inputs: { noise: link("70"), guider: link("71"), sampler: link("72"), sigmas: link("73"), latent_image: link("30", 1) } };
  g["33"] = { class_type: "VAEDecode", inputs: { samples: link("32"), vae: link("3") } };
  g["34"] = { class_type: "SplitImageWithAlpha", inputs: { image: link("33") } };
  if (p.base) {
    g["40"] = {
      class_type: "PasteBackFuobeLive",
      inputs: {
        base: link("10"),
        edited: link("34"),
        box: link("15", 1),
        ...(p.mask && { mask_image: link("14") }),
        mode: p.paste,
        threshold: 0.06,
        feather: 24,
        match_color: true,
        out_max_side: p.outMaxSide,
      },
    };
  }
  g[LIVE_OUTPUT] = { class_type: "SaveImageFuobeLive", inputs: { images: link(p.base ? "40" : "34"), format: p.format, quality: p.quality ?? 85, to: p.to } };
  return { graph: g, outputNode: LIVE_OUTPUT, staged };
}

/** What each kind of render asks for (spec §5.2). */
export type RenderSlot = "live" | "settle" | "keep" | "warm";

export function slotBindings(
  slot: RenderSlot,
  o: { liveSize: number; keepRes: number; hasMask: boolean; to: LiveTo; liveLongSide?: number },
): Pick<LiveGraphParams, "res" | "paste" | "outMaxSide" | "format" | "to"> {
  if (slot === "warm") return { res: 384, paste: "off", outMaxSide: 384, format: "webp", to: o.to };
  const paste: PasteMode = o.hasMask ? "mask" : "auto";
  if (slot === "live") return { res: o.liveSize, paste, outMaxSide: roundOut(o.liveLongSide ?? o.liveSize), format: "webp", to: o.to };
  return { res: o.keepRes, paste, outMaxSide: 0, format: "png", to: o.to };
}

const roundOut = (n: number) => Math.min(1536, Math.max(256, Math.round(n / 32) * 32));

const isLink = (v: unknown, id?: string): v is [string, number] => Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number" && (id === undefined || v[0] === id);

/** JSON with sorted keys (comparison). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => k !== "_meta" && o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Two graphs are the same (titles aside). */
export const sameGraph = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/**
 * The tab's check of a live graph before it goes to ComfyUI: only live classes, exactly buildLiveGraph's shape for its
 * own bound values, and only these free values: a prompt of at most 2,000 characters, an integer seed, a resolution
 * and size from the table, input names Fuobe made (and staged), and the output's format, quality and place. A changed
 * model, LoRA, schedule, link or extra node is refused. Returns the problem, or null.
 */
export function liveGraphProblem(graph: unknown, staged: string[]): string | null {
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) return "No graph";
  const g = graph as Record<string, GraphNode>;
  for (const [id, n] of Object.entries(g)) {
    if (!n || typeof n !== "object" || typeof n.class_type !== "string" || !LIVE_CLASSES.has(n.class_type)) return `Node ${id} isn't a live edit node`;
  }
  const s = (id: string, k: string) => g[id]?.inputs?.[k];
  const prompt = s("30", "prompt");
  const seed = s("70", "noise_seed");
  if (typeof prompt !== "string" || prompt.length > MAX_GRAPH_PROMPT) return "The prompt is missing or too long";
  if (typeof seed !== "number" || !Number.isSafeInteger(seed) || seed < 0) return "Bad seed";
  const base = s("10", "image");
  const name = (v: unknown) => typeof v === "string" && LIVE_INPUT.test(v) && staged.includes(v);
  let p: LiveGraphParams;
  const save = g[LIVE_OUTPUT]?.inputs ?? {};
  const format = save.format;
  const quality = save.quality;
  const to = save.to;
  if (format !== "webp" && format !== "png") return "Bad format";
  if (typeof quality !== "number" || !Number.isInteger(quality) || quality < 50 || quality > 100) return "Bad quality";
  if (to !== "socket" && to !== "temp") return "Bad output";
  if (base !== undefined) {
    if (!name(base)) return "The base isn't a picture this tab sent";
    const res = s("20", "resolution");
    if (typeof res !== "number" || !GRAPH_RESOLUTIONS.includes(res)) return "Bad resolution";
    const refs: string[] = [];
    for (const id of ["11", "12", "13"]) {
      if (!g[id]) break;
      const r = s(id, "image");
      if (!name(r)) return "A reference isn't a picture this tab sent";
      refs.push(r as string);
    }
    const mask = s("14", "image");
    if (mask !== undefined && !name(mask)) return "The mask isn't a picture this tab sent";
    const paste = s("40", "mode");
    const outMaxSide = s("40", "out_max_side");
    if (paste !== "auto" && paste !== "mask" && paste !== "off") return "Bad paste mode";
    if (typeof outMaxSide !== "number" || !Number.isInteger(outMaxSide) || outMaxSide < 0 || outMaxSide > 4096 || outMaxSide % 32) return "Bad output size";
    p = { prompt, seed, res, base: base as string, refs, ...(mask !== undefined && { mask: mask as string }), paste, outMaxSide, format, quality, to };
  } else {
    const w = s("30", "width");
    const h = s("30", "height");
    const match = GRAPH_RESOLUTIONS.flatMap((res) => ASPECT_NAMES.map((aspect) => ({ res, aspect, size: sizeFor(aspect, res) }))).find((x) => x.size[0] === w && x.size[1] === h);
    if (!match || !isAspect(match.aspect)) return "Bad size";
    p = { prompt, seed, res: match.res, aspect: match.aspect, paste: "off", outMaxSide: 0, format, quality, to };
  }
  const want = buildLiveGraph(p);
  if (!sameGraph(want.graph, g)) return "The graph isn't Fuobe's live edit graph";
  for (const n of want.staged) if (!staged.includes(n)) return "A loader reads a picture this tab didn't send";
  for (const k of Object.keys(g)) if (isLink(g[k]?.inputs?.image) && !g[isLinkTarget(g[k].inputs.image)]) return "A broken link";
  return null;
}

const isLinkTarget = (v: unknown) => (isLink(v) ? v[0] : "");

/** The live text that a graph may carry (for callers that build one). */
export const fitsPrompt = (s: string) => s.length <= MAX_LIVE_TEXT;
