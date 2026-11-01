import { getModel } from "@/lib/catalog";
import { FORMATS, formatModels, MULTIPLIER_MODELS, UGC_MODELS, type FormatId } from "@/lib/catalog/marketing";
import type { Engine, ModelDef } from "@/lib/catalog/types";

/**
 * Slim model facts for the marketing pages, computed on the server (pages pass them as props), so
 * the browser never loads the model catalog: names, engines, voices and what each takes.
 */

export interface ModelInfo {
  id: string;
  name: string;
  engine: Engine;
  tagline: string;
  voices?: { id: string; name: string; hint?: string }[];
  voiceClone?: boolean;
  maxImages?: number;
}

const slim = (m: ModelDef): ModelInfo => ({
  id: m.id,
  name: m.name,
  engine: m.engine,
  tagline: m.tagline,
  ...(m.options.voices?.length && { voices: m.options.voices.map((v) => ({ id: v.id, name: v.name, hint: v.hint })) }),
  ...(m.options.voiceClone && { voiceClone: true }),
  ...(m.options.maxImages != null && { maxImages: m.options.maxImages }),
});

/** Every model a marketing flow can name, by id. */
export function marketingModelInfo(): Record<string, ModelInfo> {
  const ids = new Set<string>(["text-llm", "oss-text-llm", "oss-qwen-image-21", "oss-infinitetalk-long", "nano-banana-pro", "oss-qwen-image-21-turbo"]);
  for (const f of Object.keys(FORMATS) as FormatId[])
    for (const engine of ["cloud", "open"] as const)
      for (const has of [{ product: true, avatar: true }, { product: false, avatar: false }]) for (const c of formatModels(FORMATS[f], engine, has)) ids.add(c.id);
  for (const engine of ["cloud", "open"] as const) {
    Object.values(UGC_MODELS[engine]).forEach((id) => ids.add(id));
    MULTIPLIER_MODELS[engine].forEach((c) => ids.add(c.id));
  }
  const out: Record<string, ModelInfo> = {};
  for (const id of ids) {
    const m = getModel(id);
    if (m) out[id] = slim(m);
  }
  return out;
}
