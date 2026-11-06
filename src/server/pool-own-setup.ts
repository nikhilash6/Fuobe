import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { Engine, GenerationRequest, ModelDef } from "@/lib/catalog/types";
import { MODELS } from "@/lib/catalog/models";
import { directRunFeatures } from "@/lib/catalog/genjutsu";
import { ENHANCE_FEATURES, REGEN_MODEL, wantsH3TwoK } from "@/lib/catalog/regenerate";
import { RESTORE } from "@/lib/catalog/restore";
import { wantsVoiceFirst } from "@/lib/av/voice-first";
import { ownSetupGraphs, ownSetupOnly, type OwnSetup } from "@/lib/own-setup";
import { controlSetup } from "@/lib/own-setup-controls";
import { RTX_CLASSES, rtxCardOf } from "@/lib/catalog/rtx-video";
import { gpuFits } from "@/lib/gpu/readiness";
import { loadIndex } from "./gpu/index-file";
import { readSnapshot } from "./gpu/snapshots";
import { poolOnWorkers, poolTakes } from "./hosted";
import { ownSetupOnlyNow } from "./own-setup-live";

/**
 * What a run on this install's GPUs needs instead, in the "own setup" shape (src/lib/own-setup.ts): the visitor's own GPU
 * or key. Two sources, one shape:
 * - the static items (ownSetupOnly): a model, or a mode or option of it with an id of its own (MiniMax H3 at 2K,
 *   Kandinsky 6.0 Pro, Regenerate, Genjutsu's makers, "Clean the voice first", Restore & colourise);
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
  // Restore & colourise's windows: the tool's own setup (its gated IC-LoRA, on the visitor's own GPU).
  if (req.modelId === RESTORE.model) ids.push("video-tools:restore");
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

const MANIFEST = path.join(process.cwd(), "workflows", "comfyui", "manifest.json");

/** ownSetupOnlyNow's answers, by manifest, item and engine, for the manifest as last modified (it is large: read once). */
const nowAnswers = new Map<string, { mtimeMs: number; answer: OwnSetup | null }>();

/**
 * An item's own setup as it stands now, for the pool gate: an item whose graphs the manifest marks validated runs as any
 * other (own-setup-live.ts ownSetupOnlyNow), so its label leaves the runs on this install's GPUs with the pages' own. An
 * item with no graphs of its own is ownSetupOnly's answer, with no file read.
 */
export function ownSetupHere(id: string, engine?: Engine, manifest = MANIFEST): OwnSetup | null {
  if (!ownSetupGraphs(id).length) return ownSetupOnly(id, engine);
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(manifest).mtimeMs;
  } catch {
    // No manifest: ownSetupOnlyNow keeps the item's own setup.
  }
  const key = `${manifest}\n${id}\n${engine ?? ""}`;
  const kept = nowAnswers.get(key);
  if (kept && kept.mtimeMs === mtimeMs) return kept.answer;
  const answer = ownSetupOnlyNow(id, engine, manifest);
  nowAnswers.set(key, { mtimeMs, answer });
  return answer;
}

/**
 * Items a run on this install's GPUs asks for that only a GPU of the visitor's own runs, whatever else the item names:
 * Restore & colourise's windows load a gated LoRA that no visitor's key is sent with, so no key runs them.
 */
const GPU_ONLY = new Set(["video-tools:restore"]);

/** The first static item a request asks for that runs on a visitor's own setup only (as it stands now), or null. */
export function requestOwnSetup(req: Pick<GenerationRequest, "modelId" | "op" | "feature" | "params" | "engine">, manifest = MANIFEST): OwnSetup | null {
  for (const id of requestSetupIds(req)) {
    const o = ownSetupHere(id, req.engine, manifest);
    if (!o) continue;
    if (GPU_ONLY.has(id) && o.need === "gpu" && o.orKey) {
      const gpu = { ...o };
      delete gpu.orKey;
      return gpu;
    }
    return o;
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

/** A preset's press as the cards see it: each step's open model and operation (its end frame's edit first, then its clip). */
export interface PresetPress {
  id: string;
  steps: { modelId: string; op: string }[];
}

/**
 * The presets whose press this install's GPUs can't run in whole right now, with what a visitor needs to run them on its
 * own setup: a step none of whose workflows for its operation `takes` (a start-and-end-frame clip while only the plain
 * clip's workflow is held, or an end frame's edit no worker holds). Their cards say so before the press, as the price
 * check does (hosted-run.ts poolGate): never "Try free" for a run whose later step can't go on there. A step with no
 * workflow for its operation is left to the price check.
 */
export function poolOwnPresets(presets: readonly PresetPress[], takes: (endpoint: string) => boolean): Record<string, OwnSetup> {
  const out: Record<string, OwnSetup> = {};
  const known = new Map<string, boolean>();
  const taken = (e: string) => {
    let v = known.get(e);
    if (v === undefined) known.set(e, (v = takes(e)));
    return v;
  };
  const byId = new Map(MODELS.map((m) => [m.id, m]));
  for (const p of presets) {
    for (const s of p.steps) {
      const m = byId.get(s.modelId);
      const endpoints = m ? [...new Set(m.routes.filter((r) => r.provider === "comfyui" && r.op === s.op).map((r) => r.endpoint))] : [];
      if (!endpoints.length || endpoints.some(taken)) continue;
      out[p.id] = needsGpu(endpoints[0]);
      break;
    }
  }
  return out;
}
