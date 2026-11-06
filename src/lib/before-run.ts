/**
 * The check before Run (public sign-up): an account whose own GPU at a web address didn't answer its last status check
 * (the status strip's, every 30 s; nothing here asks the GPU) sees what is wrong and its fixes above Generate, instead
 * of starting a run that can only wait. When one of its keys runs the tool's cloud version, "Run with your fal.ai key"
 * is offered too: an explicit click, for that run only (the engine switch stays where it was), because it spends the
 * person's own credit. Pure, for the composer and its tests.
 */
import { dualEngine } from "./catalog/engines";
import type { Engine, GenerationRequest } from "./catalog/types";
import { beforeRunWords, runOnSiteAction, withKeyAction, type Diagnosis, type TroubleAction } from "./diagnose";
import type { Place } from "./place-name";
import { CLOUD_KEY, cloudVersion, isCloudProvider, type CloudProvider } from "./your-keys";

type Routed = { id: string; engine: string; engines?: Engine[]; routes: { provider: string }[] };

export interface BeforeRunViewer {
  kind: "guest" | "account";
  gpu: { connected: boolean; mode?: "computer" | "link"; online?: boolean; trouble?: Pick<Diagnosis, "cause" | "words" | "actions" | "retryable" | "details"> };
  keys?: CloudProvider[];
  /** The keys a run would be taken on now (not refused, balance not known to be empty): the ones offered. */
  usableKeys?: CloudProvider[];
  paidAllowed?: boolean;
}

/** What the composer shows before Run: the plain sentence, a details line, and the buttons (Retry never: no run yet). */
export interface BeforeRun {
  words: string;
  details?: string;
  actions: TroubleAction[];
  /** Waiting can fix it: a run started now waits for the GPU (else runs can't reach it until this is fixed). */
  waits: boolean;
}

/** The words when the status check gave no reason (an older answer). */
export const GPU_OFF_WORDS = "Your GPU isn't answering right now.";

/** What follows the sentence before Run: a run started now waits, or can't reach the GPU until it is fixed. */
export const beforeRunTail = (waits: boolean) => (waits ? "A run you start now waits for it." : "Runs can't reach your GPU until this is fixed.");

/**
 * The check before Run, or null when there is nothing to say: not an account, the tool doesn't run on its own GPU (a
 * cloud model, the Cloud engine, this studio's GPUs), its GPU isn't a web address (this computer and a paired ComfyUI
 * have their own notes), or the GPU answered.
 */
export function gpuBeforeRun(o: {
  viewer: BeforeRunViewer | undefined;
  model: Routed | undefined;
  engine: Engine;
  /** The run goes to this studio's GPUs (hosted runs), not the account's own. */
  onPool?: boolean;
  preset?: Parameters<typeof cloudVersion>[0];
  has: (id: string) => boolean;
  getModel: (id: string) => Routed | undefined;
  /** Hosted runs are on: a key's offer then says its price, and with none known isn't made (never a key billed unpriced). */
  hosted?: boolean;
  /** Hosted runs, for an item this install's GPUs take: their name. "Run on Our GPUs" then comes first (this run, once). */
  site?: Place | null;
  /** The key's price for this run's cloud version ("≈ $0.04"), when known. */
  keyPrice?: string | null;
}): BeforeRun | null {
  const { viewer, model } = o;
  if (viewer?.kind !== "account" || !model || o.onPool) return null;
  // A Fuobe Original runs where the engine switch says; any other model on its own engine.
  const toOwnGpu = dualEngine(model) ? o.engine === "open" : model.engine === "open";
  const gpu = viewer.gpu;
  if (!toOwnGpu || !gpu.connected || gpu.mode !== "link" || gpu.online !== false) return null;
  // The cloud version itself (its model and operation there), so one click runs it, once. With hosted runs on, only
  // with its price known (never a key billed unpriced).
  const found = viewer.paidAllowed !== false ? cloudVersion(o.preset, model, viewer.usableKeys ?? viewer.keys ?? [], o.has, o.getModel) : null;
  const twin = found && (!o.hosted || o.keyPrice) ? found : null;
  const base: TroubleAction[] = gpu.trouble?.actions ?? [
    { kind: "check-gpu", label: "Check my GPU" },
    { kind: "gpu-settings", label: "Open Settings → Your GPU", target: "/settings#your-gpu" },
  ];
  const fixes = base.filter((a) => a.kind !== "retry" && a.kind !== "run-with-key" && a.kind !== "run-on-site");
  // The key's run right after the first fix (Start your pod), so a narrow composer keeps it.
  const offer = twin ? [withKeyAction(twin.provider, twin.modelId, twin.op, o.hosted ? o.keyPrice : undefined)] : [];
  return {
    words: gpu.trouble ? beforeRunWords(gpu.trouble.words) : GPU_OFF_WORDS,
    ...(gpu.trouble?.details && { details: gpu.trouble.details }),
    actions: [...(o.site ? [runOnSiteAction(o.site.label)] : []), ...fixes.slice(0, 1), ...offer, ...fixes.slice(1)],
    waits: gpu.trouble ? gpu.trouble.retryable : true,
  };
}

/**
 * A request again, on the cloud version a trouble names ("Run with your fal.ai key"): the same words and inputs on the
 * cloud engine, on that provider's key (`prefer`: a model on fal.ai and Replicate goes where the button said). A preset's
 * open-graph settings (`extra`) stay behind when the model changes. For this one run: nothing else changes.
 */
export function onCloudKey(request: GenerationRequest, a: Pick<TroubleAction, "modelId" | "op" | "target">): GenerationRequest {
  const prefer = isCloudProvider(a.target) ? { prefer: a.target } : {};
  const modelId = a.modelId ?? request.modelId;
  if (modelId === request.modelId) return { ...request, engine: "cloud", ...prefer };
  const { extra: _extra, ...params } = request.params ?? {};
  void _extra;
  return { ...request, engine: "cloud", modelId, params, ...(a.op && { op: a.op as GenerationRequest["op"] }), ...prefer };
}

/**
 * "Run with your fal.ai key" from the composer: this run, once, on the tool's cloud version and that key (`start` sends
 * it). Nothing else changes: the engine switch stays where it was, so the next run goes to the GPU again. Resolves with
 * the words to say once it has started.
 */
export async function runOnceOnKey(request: GenerationRequest, a: Pick<TroubleAction, "modelId" | "op" | "target">, start: (r: GenerationRequest) => Promise<unknown>): Promise<string> {
  await start(onCloudKey(request, a));
  const label = isCloudProvider(a.target) ? CLOUD_KEY[a.target].label : "your key";
  return `Running once on ${label} with your key. Your next runs go to your GPU again.`;
}
