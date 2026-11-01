import { APP_ALIASES, APPS as RAW_APPS } from "./apps";
import { countModels, isListed, type ModelCounts } from "./counts";
import { EFFECTS as RAW_EFFECTS, MOTIONS as RAW_MOTIONS } from "./motions";
import { MODELS } from "./models";
import { LLM_MODELS } from "./llm-models";
import { dopPreset, presetLoras } from "./dop";
import { onEngine, runsOn } from "./engines";
import { estimateCost } from "./plan";
import type { Engine, MediaKind, ModelDef, Operation, Preset } from "./types";

MODELS.push(...LLM_MODELS.filter((m) => !MODELS.some((x) => x.id === m.id))); // text steps (translate, write) on the configured LLM; once per hot reload
export { MODELS };
export { isListed, type ModelCounts };

/** The model counts every page quotes (what counts: src/lib/catalog/counts.ts). */
export const modelCounts = (): ModelCounts => countModels(MODELS);

const modelIndex = new Map(MODELS.map((m) => [m.id, m]));
/**
 * Video apps on the open Wan model: attach a researched Wan LoRA (and its trigger word) when the app's name matches
 * one in the round-1 map. Camera motions and effects are Fuobe DoP's (src/lib/catalog/dop.ts).
 */
function withOssLoras(p: Preset): Preset {
  if (!p.open || p.open.loras?.length || p.open.modelId !== "oss-wan22-14b") return p;
  const loras = presetLoras(p.id).filter((l) => l.family === "wan").map((l) => l.ref);
  if (!loras.length) return p;
  const trigger = loras.find((l) => l.trigger)?.trigger;
  return {
    ...p,
    open: { ...p.open, loras, promptTemplate: trigger ? `${trigger}. ${p.open.promptTemplate ?? p.promptTemplate}` : p.open.promptTemplate },
    // The LoRA files stay in the route; Details says what they do, after the app's own note.
    parity: [p.parity, `On your GPU it adds ${loras.length > 1 ? "LoRAs" : "a LoRA"} trained for this look.`].filter(Boolean).join(" "),
  };
}

/**
 * A relight or Mixed Media effect's step before the clip, priced on its model as it runs in the cloud (a 1-megapixel
 * picture; free on the user's GPU).
 */
function withPrestepPrice(p: Preset): Preset {
  if (!p.prestep) return p;
  const price = (s: NonNullable<Preset["prestep"]>["open"]) => {
    const m = modelIndex.get(s.modelId);
    return m ? (estimateCost(onEngine(m, "cloud"), { aspectRatio: "1:1", resolution: "1K", numOutputs: 1 }, 1, s.op, !!s.loras?.length) ?? undefined) : undefined;
  };
  return { ...p, prestep: { open: { ...p.prestep.open, usd: 0 }, cloud: { ...p.prestep.cloud, usd: price(p.prestep.cloud) } } };
}

/** Open-source routes that need a dedicated workflow rather than an edit prompt. */
const APP_OPEN_OVERRIDES: Record<string, Preset["open"]> = {
  "app-face-swap": { modelId: "oss-reactor", op: "face-swap" },
  // Qwen-Image-Edit with the Relight LoRA beats a plain edit prompt for lighting changes.
  "app-relight": { modelId: "oss-qwen-relight", op: "edit" },
  // FLUX.2 [klein] + the try-on LoRA was trained for exactly this (the provider adds the TRYON trigger word).
  "app-virtual-try-on": {
    modelId: "oss-tryon-klein",
    op: "edit",
    promptTemplate:
      "A full-body photo of a person. Replace the outfit with the garment shown in the reference image, with its fabric, colour, pattern, logo and fit. The final image is a full body shot. {prompt}",
  },
};

/** What the open version does differently, shown on the app page next to an override above. */
const APP_OPEN_PARITY: Record<string, string> = {
  "app-virtual-try-on": "The open version uses FLUX.2 [klein] 4B with a try-on LoRA and masks the old outfit out first (10 GB GPU, Apache-2.0).",
};

export const APPS: Preset[] = RAW_APPS.map((a) =>
  APP_OPEN_OVERRIDES[a.id] ? { ...a, open: APP_OPEN_OVERRIDES[a.id], parity: a.parity ?? APP_OPEN_PARITY[a.id] } : a,
).map(withOssLoras);
export const MOTIONS: Preset[] = RAW_MOTIONS.map(dopPreset);
export const EFFECTS: Preset[] = RAW_EFFECTS.map(dopPreset).map(withPrestepPrice);
export const PRESETS: Preset[] = [...APPS, ...MOTIONS, ...EFFECTS];
const presetIndex = new Map(PRESETS.map((p) => [p.id, p]));

export function getModel(id: string): ModelDef | undefined {
  return modelIndex.get(id);
}

export function getPreset(id: string): Preset | undefined {
  return presetIndex.get(id) ?? (APP_ALIASES[id] ? presetIndex.get(APP_ALIASES[id]) : undefined);
}

export function modelsFor(opts: { kind?: MediaKind; ops?: Operation[]; engine?: Engine | "all" }): ModelDef[] {
  return MODELS.filter(
    (m) =>
      !m.hidden &&
      (!opts.kind || m.kind === opts.kind) &&
      (!opts.engine || opts.engine === "all" || runsOn(m, opts.engine)) &&
      // An Original does on an engine what that engine's routes do (Fuobe DoP films keyframes on the GPU only).
      (!opts.ops || (opts.engine && opts.engine !== "all" ? onEngine(m, opts.engine) : m).routes.some((r) => opts.ops!.includes(r.op))),
  );
}

export function supportsOp(model: ModelDef, op: Operation): boolean {
  return model.routes.some((r) => r.op === op);
}
