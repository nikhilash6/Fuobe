import type { GenerationRequest, ModelDef } from "./catalog/types";

/** A size as a number to compare ("720p" 720, "2K" 2048, "1024x768" 1024). */
function sizeOf(r: string): number {
  const p = /^(\d+)p$/i.exec(r);
  if (p) return Number(p[1]);
  const k = /^(\d+(?:\.\d+)?)k$/i.exec(r);
  if (k) return Number(k[1]) * 1024;
  const wh = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(r);
  if (wh) return Math.max(Number(wh[1]), Number(wh[2]));
  return NaN;
}

/**
 * "Try one size smaller" (a run that ran out of graphics memory, or took too long): the same run one size down among the
 * model's sizes, or else one length down among its lengths. Null when neither has a smaller step (Pick another model then).
 */
export function smallerRun(req: GenerationRequest, model: Pick<ModelDef, "options" | "defaults"> | undefined): { request: GenerationRequest; what: string } | null {
  if (!model) return null;
  const params = req.params ?? {};
  const now = params.resolution ?? model.defaults?.resolution;
  const sizes = (model.options.resolutions ?? []).filter((r) => Number.isFinite(sizeOf(r)));
  if (now && Number.isFinite(sizeOf(now))) {
    const lower = sizes.filter((r) => sizeOf(r) < sizeOf(now)).sort((a, b) => sizeOf(b) - sizeOf(a))[0];
    if (lower) return { request: { ...req, params: { ...params, resolution: lower } }, what: lower };
  }
  const length = params.duration ?? model.defaults?.duration;
  const lengths = model.options.durations ?? [];
  if (typeof length === "number") {
    const shorter = lengths.filter((d) => d < length).sort((a, b) => b - a)[0];
    if (shorter) return { request: { ...req, params: { ...params, duration: shorter } }, what: `${shorter} s` };
  }
  return null;
}
