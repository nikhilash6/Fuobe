import { getModel } from "@/lib/catalog";
import { FORMATS, formatModels, MULTIPLIER_MODELS, UGC_MODELS, type FormatId } from "@/lib/catalog/marketing";
import { opTakes } from "@/lib/catalog/route-takes";
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
  /**
   * The sizes its video edit makes (Ad Multiplier's recreate): false when the edit sends no size (Kling O3 keeps the
   * reference's; Fuobe Genjutsu on your GPU makes its own), a list when it makes only those. Unset: no video edit.
   */
  editSizes?: string[] | false;
}

const slim = (m: ModelDef): ModelInfo => ({
  id: m.id,
  name: m.name,
  engine: m.engine,
  tagline: m.tagline,
  ...(m.options.voices?.length && { voices: m.options.voices.map((v) => ({ id: v.id, name: v.name, hint: v.hint })) }),
  ...(m.options.voiceClone && { voiceClone: true }),
  ...(m.options.maxImages != null && { maxImages: m.options.maxImages }),
  ...editSizes(m),
});

/** What its video edit does with Quality (ModelInfo.editSizes). */
function editSizes(m: ModelDef): Pick<ModelInfo, "editSizes"> {
  const op = m.routes.some((r) => r.op === "v2v") ? "v2v" : m.routes.some((r) => r.op === "motion-transfer") ? "motion-transfer" : undefined;
  if (!op) return {};
  // The open recreate (motion transfer) is sent no size: its graph makes its own.
  if (m.engine === "open" || !opTakes(m, op).resolution) return { editSizes: false };
  return m.options.resolutions?.length ? { editSizes: [...m.options.resolutions] } : {};
}

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
