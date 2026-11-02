import "server-only";
import crypto from "node:crypto";
import { resolveWorkflowId } from "@/lib/comfy-variants";
import { fixPlan } from "@/lib/gpu/plan";
import { CLEAN_VAE, DECODER_PARAM, GPU_PARAM } from "@/lib/qwen21-speed";
import { cardLabel, needTargets, toolReadiness } from "@/lib/gpu/readiness";
import { GPU_NEED_TEXT } from "@/lib/gpu/rtx";
import type { FixPlan, ToolReadiness, ToolRef } from "@/lib/gpu/types";
import type { GenerationRequest } from "@/lib/catalog/types";
import { authEnabled, crossSite, hostAllowed, validToken } from "../auth";
import { loadIndex, preflightOn } from "./index-file";
import { contextFor } from "./readiness-service";
import { probe, readSnapshot } from "./snapshots";
import { presetTool, modelTool } from "./tools";
import { urlHash, type GpuTarget } from "./target";

/**
 * The check before a run (SPEC §13.1, review 9c): a ComfyUI run that is sure to fail for something missing is
 * stopped before it is queued, with the plan that fixes it (409 "gpu-setup"). It never blocks when the check is
 * unknown or failed (R11), when only graphics memory is short (R7), or when the request says gpuCheck "skip".
 * It blocks only on what a live read just confirmed, and in P1 only for accounts: the owner gets a warning.
 */

export const GPU_SETUP_HEADER = "x-fuobe-gpu-setup";

export interface GateInput {
  request: GenerationRequest;
  route: { provider: string; endpoint: string };
  op: string;
  modelId: string;
  /** Qwen-Image 2.1's Options → GPU as the run's plan decided it (previewGeneration's gpu): the graph checked is the one it runs. */
  gpu?: string;
  skip?: boolean;
  actor: string;
}

export type GateResult = { ok: true; warning?: string } | { ok: false; ref: ToolRef; plan: FixPlan; message: string };

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** Needs that stop a run (a licence comes with its download; VRAM is never a need). */
const blocks = (r: ToolReadiness) => r.state === "unsupported" || r.needs.some((n) => n.kind !== "hf-licence");

export async function gateGeneration(t: GpuTarget, g: GateInput): Promise<GateResult> {
  if (!preflightOn() || g.skip || g.route.provider !== "comfyui" || t.kind === "none") return { ok: true };
  let idx = loadIndex();
  const req = g.request;
  const has = (id: string) => !!idx.workflows[id];
  const extra: Record<string, unknown> = { ...req.params?.extra, ...(g.gpu && { [GPU_PARAM]: g.gpu }) };
  const id = resolveWorkflowId(g.route.endpoint, {
    op: g.op,
    clips: req.inputs?.videos?.length ?? 0,
    images: req.inputs?.images?.length ?? 0,
    format: req.params?.format,
    audio2: !!req.inputs?.audio2 || !!req.params?.extra?.audio2,
    extra,
    has,
  });
  if (!has(id)) return { ok: true };
  // Qwen-Image 2.1's Options → Decoder "Clean" loads the Texture-Fix VAE, an optional file of the graph: this run needs it.
  const vae = `vae/${CLEAN_VAE}`;
  if ((extra[DECODER_PARAM] === "clean" || extra.vae === CLEAN_VAE) && idx.files[vae] && !idx.workflows[id].files.includes(vae)) {
    idx = { ...idx, workflows: { ...idx.workflows, [id]: { ...idx.workflows[id], files: [...idx.workflows[id].files, vae] } } };
  }
  // The preset's route on the run's model (the one its preview was made with, or its own): its LoRAs are checked too.
  const preset = req.presetId ? presetTool(req.presetId, { modelId: g.modelId }) : null;
  const model = modelTool(g.modelId, g.op);
  const ref: ToolRef = preset?.ref ?? model?.ref ?? `workflow:${id}`;
  const name = preset?.name ?? model?.name ?? id;
  const loras = preset?.loras ?? model?.loras ?? [];
  const ctx = { ...contextFor(t), kind: model?.kind };
  let snap = readSnapshot(t);
  if (!snap?.inventory.reachable) return { ok: true };
  let r = toolReadiness(ref, name, [id], loras, snap.inventory, idx, ctx, model?.cloud);
  if (!blocks(r)) return { ok: true };
  // A ComfyUI on the person's computer is read by their tab, which checks the tool right before the run: only a check
  // from the last 10 s counts as confirmed (an older one never blocks; ComfyUI's own answer has the last word).
  if (t.via === "browser") {
    if (Date.now() - snap.checkedAt > 10_000) return { ok: true };
  } else if (Date.now() - snap.checkedAt > 10_000 && r.state !== "unsupported") {
    // Confirm with a live read of just these classes and folders, unless the snapshot is from the last 10 s.
    const fresh = await probe(t, { actor: g.actor, ...needTargets(r.needs, idx), loraNames: loras.map((l) => l.file) }).catch(() => null);
    if (!fresh?.reachable) return { ok: true };
    snap = readSnapshot(t);
    if (!snap?.inventory.reachable) return { ok: true };
    r = toolReadiness(ref, name, [id], loras, snap.inventory, idx, ctx, model?.cloud);
    if (!blocks(r)) return { ok: true };
  }
  const dev = snap.inventory.devices[0];
  const plan = fixPlan(r, snap.inventory, idx, { hash: sha256, urlHash: urlHash(t), account: ctx.account, loras, gpu: cardLabel(dev) });
  const what =
    r.state === "unsupported"
      ? r.gpuNeed
        ? GPU_NEED_TEXT[r.gpuNeed].replace(/^Needs/, "needs")
        : "needs a second ComfyUI"
      : `needs ${r.needs.filter((n) => n.kind !== "hf-licence").length} more thing${r.needs.length > 1 ? "s" : ""} on your ComfyUI`;
  // A card that can't run it: no setup step helps, so the run stops even on the install's own ComfyUI.
  if (r.gpuNeed) return { ok: false, ref, plan, message: `${name} ${what}. Pick another choice for this tool.` };
  if (t.key === "install") return { ok: true, warning: `${name} ${what}. Open Connect your GPU to see them.` };
  return { ok: false, ref, plan, message: `${name} ${what} before it can run.` };
}

/**
 * The checks every pre-flight route that sends traffic makes (review 7): a person, in a browser, on this site.
 * Not an API token; not another website; the browser says the request comes from this site's own page.
 */
export function interactiveRefusal(request: Request): string | null {
  if (validToken(request.headers.get("authorization"))) return "API tokens can't start a GPU check. Open Fuobe in your browser.";
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (crossSite(request, host)) return "Blocked a request from another website.";
  const site = request.headers.get("sec-fetch-site");
  if (site ? site !== "same-origin" : !request.headers.get("origin")) return "Start the check from Fuobe's own page.";
  if (!authEnabled() && !hostAllowed(host)) return "Blocked a request for an address this studio isn't reached at.";
  return null;
}
