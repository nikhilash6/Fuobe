import "server-only";
import type { GenerationRequest, ModelDef } from "@/lib/catalog/types";
import { MODELS } from "@/lib/catalog/models";
import { directRunFeatures } from "@/lib/catalog/genjutsu";
import { ENHANCE_FEATURES, REGEN_MODEL, wantsH3TwoK } from "@/lib/catalog/regenerate";
import { wantsVoiceFirst } from "@/lib/av/voice-first";
import { ownSetupOnly, type OwnSetup } from "@/lib/own-setup";
import { controlSetup } from "@/lib/own-setup-controls";
import { RTX_CLASSES, rtxCardOf } from "@/lib/catalog/rtx-video";
import { gpuFits } from "@/lib/gpu/readiness";
import { loadIndex } from "./gpu/index-file";
import { readSnapshot } from "./gpu/snapshots";
import { poolOnWorkers, poolTakes } from "./hosted";

/**
 * What a run on this install's GPUs needs instead, in the "own setup" shape (src/lib/own-setup.ts): the visitor's own GPU
 * or key. Two sources, one shape:
 * - the static items (ownSetupOnly): a model, or a mode or option of it with an id of its own (MiniMax H3 at 2K,
 *   Kandinsky 6.0 Pro, Regenerate, Genjutsu's makers, "Clean the voice first");
 * - what this install's GPUs can't run right now (a model none of them holds, a lane none serves, a card too small or
 *   of the wrong kind): `needsGpu`, with the memory its workflow needs when the index says.
 * The pool gate (hosted-run.ts poolGate) refuses with it, the price check says its label, and GET /api/status sends the
 * dynamic ones to the pickers (pool-rules.ts `own`), which show them labelled instead of leaving them out.
 */

/** The ids a request's own setup is asked by: its model, then the modes and options of it that have their own. */
export function requestSetupIds(req: Pick<GenerationRequest, "modelId" | "op" | "feature" | "params">): string[] {
  const ids = [req.modelId];
  const extra = req.params?.extra ?? {};
  if (wantsH3TwoK(req.modelId, req.params?.resolution)) ids.push("regenerate:h3-2k");
  if (req.modelId === REGEN_MODEL && req.feature && ENHANCE_FEATURES.has(req.feature)) ids.push("regenerate:enhance");
  // A model setting whose value has an id of its own (Kandinsky 6.0 at Pro): the one table the pickers read too.
  for (const [param, v] of Object.entries(extra)) {
    const id = typeof v === "string" || typeof v === "number" ? controlSetup(req.modelId, param, v) : undefined;
    if (id) ids.push(id);
  }
  if (wantsVoiceFirst(req)) ids.push("sound:clean-voice-first");
  const genjutsu = extra.openjutsu;
  const features = directRunFeatures(req.modelId, genjutsu && typeof genjutsu === "object" ? (genjutsu as Record<string, unknown>) : {});
  for (const f of features ?? []) ids.push(`genjutsu:${f}`);
  return ids;
}

/** The first static item a request asks for that runs on a visitor's own setup only, or null. */
export function requestOwnSetup(req: Pick<GenerationRequest, "modelId" | "op" | "feature" | "params" | "engine">): OwnSetup | null {
  for (const id of requestSetupIds(req)) {
    const o = ownSetupOnly(id, req.engine);
    if (o) return o;
  }
  return null;
}

/** The memory (GB, whole) a workflow's index entry says it needs, or none. */
function workflowGb(endpoint: string | undefined): number | undefined {
  const gb = endpoint ? loadIndex().workflows[endpoint]?.vramGb : undefined;
  return typeof gb === "number" && gb > 0 ? Math.ceil(gb) : undefined;
}

/** A GPU of the visitor's own, with the memory the workflow needs when the index says. */
export function needsGpu(endpoint?: string): OwnSetup {
  const vramGb = workflowGb(endpoint);
  return { need: "gpu", ...(vramGb && { vramGb }) };
}

/** A model's workflows on this install's GPUs (its ComfyUI routes). */
const comfyEndpoints = (m: ModelDef): string[] => [...new Set(m.routes.filter((r) => r.provider === "comfyui").map((r) => r.endpoint))];

/**
 * The open models this install's GPUs can't run right now, with what a visitor needs to run each on its own setup: every
 * ComfyUI workflow of the model refused by `takes` (no worker allowed its lane, holding its files, with the memory it
 * needs), or by `cardRefuses` (a card that can't run it). The smallest memory among its workflows is the one named.
 */
export function poolOwnSetups(takes: (endpoint: string) => boolean, cardRefuses: (modelId: string) => boolean): Record<string, OwnSetup> {
  const out: Record<string, OwnSetup> = {};
  const known = new Map<string, boolean>();
  const taken = (e: string) => {
    let v = known.get(e);
    if (v === undefined) known.set(e, (v = takes(e)));
    return v;
  };
  for (const m of MODELS) {
    const endpoints = comfyEndpoints(m);
    if (!endpoints.length) continue;
    if (cardRefuses(m.id)) {
      out[m.id] = { need: "gpu" };
      continue;
    }
    if (endpoints.some(taken)) continue;
    const gbs = endpoints.map(workflowGb).filter((n): n is number => n !== undefined);
    out[m.id] = { need: "gpu", ...(gbs.length && { vramGb: Math.min(...gbs) }) };
  }
  return out;
}

/**
 * A model that needs an NVIDIA RTX card (src/lib/catalog/rtx-video.ts) on this install's GPUs: refused when the install's
 * last GPU check says its card can't run it (a CPU, an Apple, AMD or Intel device, an older NVIDIA card) or its ComfyUI
 * lacks the RTX Video nodes. A card the name doesn't tell, or no check yet, never refuses (the run says what it finds).
 * On the workers that check is of another machine, so it isn't made: a worker takes a job only when it has the job's
 * node packs and files.
 */
export function poolCardRefuses(modelId: string): boolean {
  if (poolOnWorkers()) return false;
  const need = rtxCardOf(modelId);
  if (!need) return false;
  const inv = readSnapshot({ kind: "install", key: "install", via: "server" })?.inventory;
  if (!inv?.reachable) return false;
  return gpuFits(need, inv) === false || RTX_CLASSES.some((c) => inv.nodes.missing.includes(c));
}

/** The open models this install's GPUs can't run right now (poolOwnSetups), for GET /api/status's pool rules. */
export const poolOwnModels = (): Record<string, OwnSetup> => poolOwnSetups(poolTakes, poolCardRefuses);
