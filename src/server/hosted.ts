import "server-only";
import { getModel } from "@/lib/catalog";
import { computeDimensions, fitCanvas } from "@/lib/comfy";
import { h3Canvas, isH3Graph } from "@/lib/h3-prompt";
import { imageSize } from "@/lib/image-size";
import type { GenerationRequest } from "@/lib/catalog/types";
import { billingConfigured, type Policy, type QueueFacts, type RunFacts } from "./billing";
import { lineFacts, poolLane, queueOfGeneration, workersAllowed } from "./computer/pool";
import { db } from "./db";
import { loadIndex } from "./gpu/index-file";
import { hostedRunsOn } from "./hosted-switch";
import { poolRunCounts } from "./pool-limits";
import { getWorkflow, installComfyLocal, onInstallComfy, workerFor, workersTake } from "./providers/comfyui";
import { getSetting, withCandidates } from "./settings";
import { localHead, storedMedia } from "./storage";
import { runAsTenant } from "./tenant";

/**
 * Hosted runs (FUOBE_HOSTED_RUNS=1; docs/public-signup.md "Hosted runs"): an account with no GPU of its own may run on
 * this install's GPUs (the "pool" place). With the switch off, nothing here is used and accounts run as before: on
 * their own GPU or their own key only.
 *
 * Where an account's run goes (the generations route):
 * 1. the account asked for its own GPU, or its own GPU is online and it didn't ask for this install's → its own GPU;
 * 2. a paid model and its own key → its own key;
 * 3. hosted runs are on, the model runs on ComfyUI, and the policy allows it → this install's GPUs, with a billing hold
 *    when a billing service is set (billing.ts), free otherwise;
 * 4. otherwise today's answer ("Connect your GPU", "Add your key").
 *
 * This install's GPUs are its workers (Settings: ComfyUI runs on "workers", docs/gpu-workers.md): each job of the run is
 * a task for them, in one line with every other, and nothing reaches a ComfyUI address from here. Otherwise its own
 * ComfyUI server (Settings → ComfyUI address), only when that is on this machine. An install whose ComfyUI is on the
 * owner's computer (a browser tab) doesn't offer hosted runs: that computer is the owner's alone.
 *
 * Runs here need someone to answer for them: a billing service (billing.ts), whose policy then says who may run what;
 * or FUOBE_HOSTED_FREE=1, which says this install's runs are free for every account (within its own limits). With
 * neither, hosted runs stay closed even when switched on.
 */

export const hostedRuns = hostedRunsOn;

/** FUOBE_HOSTED_FREE=1: with no billing service, runs on this install's GPUs are free for accounts (within its limits). */
export const hostedFree = (): boolean => process.env.FUOBE_HOSTED_FREE === "1";

/** This install's GPUs are its workers (Settings: ComfyUI runs on "workers"). */
export const poolOnWorkers = (): boolean => getSetting("comfyWhere") === "workers";

/**
 * Hosted runs are on, something answers for them (a billing service, or FUOBE_HOSTED_FREE=1), and this install has GPUs
 * for them: a worker the owner added and allowed a lane (paused or not: a paused worker means the run waits in line),
 * or its own ComfyUI server on this machine.
 */
export function poolReady(): boolean {
  if (!hostedRunsOn()) return false;
  if (!billingConfigured() && !hostedFree()) return false;
  const where = getSetting("comfyWhere");
  if (where === "computer") return false;
  return where === "workers" ? workersAllowed(null) : installComfyLocal();
}

/**
 * The workflows a route's endpoint may run: itself, or for one that picks its graph at run time (`video-concat-{n}`)
 * every graph it may pick (one per count).
 */
export function workflowPicks(endpoint: string): string[] {
  const ids = Object.keys(loadIndex().workflows);
  if (!endpoint.includes("{")) return ids.includes(endpoint) ? [endpoint] : [];
  const re = new RegExp(`^${endpoint.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "\\d+")}$`);
  return ids.filter((id) => re.test(id));
}

/**
 * May this install's GPUs run this workflow (planned.route.endpoint)? On the workers: one is allowed its lane (a
 * workflow that picks its graph at run time, `…-{n}`: the lane of every graph it may pick). On its own server: the
 * isolated ComfyUI's workflows too only when that one is on this machine.
 */
export function poolTakes(endpoint: string | undefined): boolean {
  if (!endpoint) return false;
  const isolated = workerFor(endpoint) === "isolated";
  if (!poolOnWorkers()) return installComfyLocal(isolated ? "isolated" : "main");
  if (isolated) return false;
  if (!endpoint.includes("{")) return workersAllowed(poolLane(endpoint));
  const picks = workflowPicks(endpoint);
  return picks.length > 0 && picks.every((id) => workersAllowed(poolLane(id)));
}

/**
 * The steps a run on this install's GPUs can carry out there: ComfyUI's. The price check, the run's admission and its
 * submit read this one table, so a run is refused before Run when a step of it couldn't run there (a text step, a step
 * made in the browser, a cloud model), never part way through.
 */
const POOL_PROVIDERS: ReadonlySet<string> = new Set(["comfyui"]);
export const poolRunsProvider = (provider: string): boolean => POOL_PROVIDERS.has(provider);

/** May a run on this install's GPUs send them this kind of file (the workers take only the kinds the install allows)? */
export const poolTakesFiles = (kind: "image" | "video" | "audio"): boolean => !poolOnWorkers() || workersTake(kind);

/**
 * Run `fn` as an account's run on this install's GPUs: as the account (its own files and runs only), on this install's
 * ComfyUI server, the open engine, no demo outputs.
 */
export function runOnPool<T>(accountId: string | null, fn: () => T): T {
  const inside = () => onInstallComfy(() => withCandidates({ engineMode: "open", demoMode: "off" }, fn));
  return accountId ? runAsTenant({ kind: "account", id: accountId }, inside) : runAsTenant({ kind: "guest" }, inside);
}

/** Words for runs on this install's GPUs (generic: they fit any install). */
export const HOSTED_WORDS = {
  notOffered: "This one runs on your own GPU. Connect one in Settings, or pick another model.",
  loras: "Extra LoRAs run on your own GPU. Connect one in Settings, or run without them.",
  inputs: "This kind of file runs on your own GPU. Connect one in Settings, or use a picture.",
  notHosted: "Runs on this studio's GPUs aren't open to this account. Connect your own GPU in Settings.",
  waitedTooLong: "This studio's GPUs were busy, so it didn't run. Not charged.",
};

/** May this model (and app) run on this install's GPUs under this policy? */
export function poolAllows(p: Pick<Policy, "pool">, modelId: string, presetId?: string | null): boolean {
  const m = p.pool ?? {};
  if (m.deny?.includes(modelId)) return false;
  if (m.allow && !m.allow.includes(modelId)) return false;
  if (presetId) {
    if (m.apps?.deny?.includes(presetId)) return false;
    if (m.apps?.allow && !m.apps.allow.includes(presetId)) return false;
  }
  return true;
}

/** The file kinds a request uses (for the policy's uploads rule and the billing facts). */
export function inputCounts(req: GenerationRequest): { image: number; video: number; audio: number } {
  const i = req.inputs ?? {};
  const image = (i.images?.length ?? 0) + (i.endImage ? 1 : 0) + (i.mask ? 1 : 0) + (i.sketch ? 1 : 0);
  const video = (i.video ? 1 : 0) + (i.videos?.length ?? 0);
  const audio = [i.audio, i.audio2, i.voiceAudio, i.voiceAudio2].filter(Boolean).length + (i.audios?.length ?? 0);
  return { image, video, audio };
}

/** The pool's one lane while this install's GPUs are its own ComfyUI server. */
export const POOL_LANE = "comfyui";

/** The pool's rows that wait or run (the route's place-in-line facts). */
const POOL_ROWS = "json_extract(g.request_json, '$.place') = 'pool' AND g.status IN ('queued', 'running')";

/** How long a run on this install's GPUs may wait in line: the billing service's limit, else FUOBE_POOL_WAIT_MIN (30). */
export function poolWaitMs(stamped?: number): number {
  if (stamped && stamped > 0) return stamped;
  const m = Number(process.env.FUOBE_POOL_WAIT_MIN);
  return (Number.isFinite(m) && m > 0 ? m : 30) * 60_000;
}

/** A typical run's time on this install's GPUs (the median of the last 20 that finished), or null before any. */
function typicalRunMs(): number | null {
  const rows = db()
    .prepare(
      `SELECT g.completed_at - r.started_at AS ms FROM generations g JOIN generation_runs r ON r.id = g.id
       WHERE json_extract(g.request_json, '$.place') = 'pool' AND g.status = 'succeeded' AND r.started_at IS NOT NULL AND g.completed_at > r.started_at
       ORDER BY g.completed_at DESC LIMIT 20`,
    )
    .all() as { ms: number }[];
  if (!rows.length) return null;
  const sorted = rows.map((r) => r.ms).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Rows not started yet (no provider start): they wait in line. */
const WAITING = "NOT EXISTS (SELECT 1 FROM generation_runs r WHERE r.id = g.id AND r.started_at IS NOT NULL)";

/**
 * The account's runs on this install's GPUs (QueueFacts.mine), counted as the policy's limits count them: a run is one
 * press of Run, however many jobs or chain steps it has.
 */
function myRuns(accountId: string | null): QueueFacts["mine"] {
  if (!accountId) return { waiting: 0, running: 0 };
  const c = poolRunCounts(accountId);
  return { waiting: c.waiting, running: c.active - c.waiting };
}

/**
 * The line on this install's GPUs right now, for a quote or a reserve (QueueFacts). On the workers: their own line, as a
 * new run of this workflow would stand in it (every task ahead of it, whatever its lane). On its own server: its rows.
 */
export function queueFacts(accountId: string | null, workflowId?: string | null): QueueFacts {
  if (poolOnWorkers()) return { ...lineFacts(accountId, workflowId ?? null), mine: myRuns(accountId) };
  const d = db();
  const ahead = (d.prepare(`SELECT COUNT(*) AS n FROM generations g WHERE ${POOL_ROWS} AND ${WAITING}`).get() as { n: number }).n;
  const typical = typicalRunMs();
  return {
    lane: POOL_LANE,
    ahead,
    etaS: typical === null ? null : Math.round(((ahead + 1) * typical) / 1000),
    workersOnline: poolReady() ? 1 : 0,
    nextOpenAt: null,
    mine: myRuns(accountId),
  };
}

/** A waiting row's place in line on this install's GPUs (1: next), and the wait, about. Null when it isn't waiting there. */
export function placeInLine(generationId: string): { place: number; etaSeconds: number | null } | null {
  // On the workers: its task's place in their line (back in line after an attempt, the same place).
  const task = queueOfGeneration(generationId);
  if (task || poolOnWorkers()) return task;
  const d = db();
  const row = d.prepare(`SELECT g.created_at FROM generations g WHERE g.id = ? AND ${POOL_ROWS} AND ${WAITING}`).get(generationId) as { created_at: number } | undefined;
  if (!row) return null;
  const before = (d.prepare(`SELECT COUNT(*) AS n FROM generations g WHERE ${POOL_ROWS} AND ${WAITING} AND (g.created_at < ? OR (g.created_at = ? AND g.id < ?))`).get(row.created_at, row.created_at, generationId) as { n: number }).n;
  const typical = typicalRunMs();
  return { place: before + 1, etaSeconds: typical === null ? null : Math.round(((before + 1) * typical) / 1000) };
}

type Size = { width: number; height: number };
const megapixelsOf = (s: Size) => Math.round((s.width * s.height) / 10_000) / 100;
const positive = (v: unknown): number | null => ((typeof v === "number" || typeof v === "string") && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

/** The size of a request's first input picture (else clip), from its file's header; null when it can't be read. */
function inputSize(req: GenerationRequest): Size | null {
  const i = req.inputs ?? {};
  const picture = i.images?.[0] ?? i.endImage;
  const head = picture ? localHead(picture) : null;
  const still = head ? imageSize(head) : null;
  if (still) return still;
  const clip = i.video ?? i.videos?.[0];
  const info = clip ? storedMedia(clip)?.info : null;
  return info?.width && info.height ? { width: info.width, height: info.height } : null;
}

/** An upscale model's own factor, from its file's name (RealESRGAN_x4plus, 4x-UltraSharp: 4). */
function modelFactor(name: unknown): number {
  const m = typeof name === "string" ? /(?:^|[^a-z0-9])x(\d)(?:[^0-9]|$)|(?:^|[^a-z0-9])(\d)x(?:[^a-z0-9]|$)/i.exec(name) : null;
  return m ? Number(m[1] ?? m[2]) : 1;
}

/**
 * The size of each picture or frame a ComfyUI workflow makes, about, as the provider binds its graph (comfyui.ts
 * prepare): the canvas the graph binds (the request's own canvas only where the workflow binds one, else its aspect ratio
 * and resolution within the workflow's limits); or, for a workflow that takes its size from its input (an edit, an
 * upscale, a face swap), the input's size, an upscale's times its factor, within the workflow's limits. Undefined when
 * there's no such workflow, null when its input can't be read.
 */
function workflowSize(req: GenerationRequest, endpoint: string, modelId: string): Size | null | undefined {
  let found: ReturnType<typeof getWorkflow>;
  try {
    found = getWorkflow(endpoint);
  } catch {
    return undefined;
  }
  const { manifest, workflow } = found;
  const b = manifest.bindings as Record<string, { node: string; input: string }[] | undefined>;
  const d = (manifest.defaults ?? {}) as Record<string, unknown>;
  const extra = (req.params?.extra ?? {}) as Record<string, unknown>;
  // A bound value: the request's, else the workflow's default, else what its graph holds.
  const valueOf = (key: string): unknown => {
    if (extra[key] !== undefined) return extra[key];
    if (d[key] !== undefined) return d[key];
    const at = b[key]?.[0];
    return at ? (workflow[at.node]?.inputs as Record<string, unknown> | undefined)?.[at.input] : undefined;
  };
  const maxW = Number(manifest.limits?.maxWidth ?? Infinity);
  const maxH = Number(manifest.limits?.maxHeight ?? Infinity);
  const src = inputSize(req);
  if (b.width && b.height) {
    const [w, h] = [positive(extra.width), positive(extra.height)];
    if (w && h) return fitCanvas(w, h, manifest.limits);
    const model = getModel(modelId);
    const asked = req.params?.aspectRatio ?? model?.defaults?.aspectRatio;
    const h3 = isH3Graph(manifest.id);
    // "auto" (or H3 from a still) keeps the input's shape when its header says it.
    const follows = !asked || asked === "auto" || (h3 && !!b.image);
    const shape = follows && src ? `${src.width}:${src.height}` : asked === "auto" ? undefined : asked;
    if (h3) return h3Canvas(shape);
    const multiple = Number(manifest.limits?.dimensionMultiple ?? 16);
    const dims = computeDimensions(shape, req.params?.resolution ?? model?.defaults?.resolution, { width: Number(d.width ?? 1024), height: Number(d.height ?? 1024) }, multiple);
    const k = Math.min(1, maxW / dims.width, maxH / dims.height);
    return { width: Math.max(multiple, Math.floor((dims.width * k) / multiple) * multiple), height: Math.max(multiple, Math.floor((dims.height * k) / multiple) * multiple) };
  }
  if (!src) return null;
  let size: Size = { ...src };
  // What it scales its input to: so many megapixels, an upscale model's factor and a scale, a shorter side.
  const mp = b.megapixels ? positive(valueOf("megapixels")) : null;
  if (mp) {
    const k = Math.sqrt((mp * 1e6) / (size.width * size.height));
    size = { width: size.width * k, height: size.height * k };
  }
  let factor = b.upscaleModel ? modelFactor(valueOf("upscaleModel")) : 1;
  if (b.scale) {
    const scale = positive(valueOf("scale")) ?? 1;
    // SeedVR2 lowers its scale to fit its limits, to a 0.01 step (comfyui.ts); the others scale as asked.
    factor *= manifest.id === "upscale-image-seedvr2" ? Math.min(scale, Math.floor(Math.min(maxW / size.width, maxH / size.height) * 100) / 100) : scale;
  }
  size = { width: size.width * factor, height: size.height * factor };
  const short = b.shortSide ? positive(valueOf("shortSide")) : null;
  if (short) {
    const k = short / Math.min(size.width, size.height);
    size = { width: size.width * k, height: size.height * k };
  }
  // Padding out (an outpaint) adds to the canvas.
  const pad = (key: string) => (b[key] ? (positive(valueOf(key)) ?? 0) : 0);
  size = { width: size.width + pad("padLeft") + pad("padRight"), height: size.height + pad("padTop") + pad("padBottom") };
  const k = Math.min(1, maxW / size.width, maxH / size.height);
  return { width: Math.round(size.width * k), height: Math.round(size.height * k) };
}

/**
 * The megapixels of each picture or frame a run makes, about. A ComfyUI run (every run on this install's GPUs): the size
 * its workflow makes (workflowSize), never a size the request names that its workflow doesn't bind. A cloud run: the
 * canvas the request names (params.extra.width and height), else its aspect ratio and resolution (the model's defaults
 * where it names none). Null for sound, text and 3D, and for a run sized by an input that can't be read.
 */
export function requestMegapixels(req: GenerationRequest, kind: RunFacts["kind"], modelId: string, comfyEndpoint?: string): number | null {
  if (kind !== "image" && kind !== "video") return null;
  const model = getModel(modelId);
  const byAsk = () => computeDimensions(req.params?.aspectRatio ?? model?.defaults?.aspectRatio, req.params?.resolution ?? model?.defaults?.resolution, {});
  if (comfyEndpoint) {
    const size = workflowSize(req, comfyEndpoint, modelId);
    if (size !== undefined) return size ? megapixelsOf(size) : null;
    // A workflow it picks at run time (a join of n clips): as asked.
    return megapixelsOf(byAsk());
  }
  const extra = (req.params?.extra ?? {}) as Record<string, unknown>;
  const [w, h] = [positive(extra.width), positive(extra.height)];
  return megapixelsOf(w && h ? { width: w, height: h } : byAsk());
}

/** The facts the billing service prices a run by (from a planned request: previewGeneration's answer). */
export function runFacts(
  req: GenerationRequest,
  p: { model: { id: string; kind: string; engine: "open" | "cloud" }; op: string; jobs: number; outputs: number; providerId: string; costUsd: number | null; loras: { applied: unknown[] }; route?: { endpoint?: string } },
  kind: RunFacts["kind"],
): RunFacts {
  const model = getModel(p.model.id);
  const endpoint = p.route?.endpoint;
  return {
    place: "pool",
    model: p.model.id,
    op: p.op ?? null,
    app: req.presetId ?? null,
    preset: req.presetId ?? null,
    studio: req.feature,
    kind,
    engine: p.model.engine,
    provider: p.providerId,
    jobs: p.jobs,
    outputsPerJob: p.jobs > 0 ? Math.max(1, Math.round(p.outputs / p.jobs)) : 1,
    megapixels: requestMegapixels(req, kind, p.model.id, p.providerId === "comfyui" ? endpoint : undefined),
    seconds: req.params?.duration ?? (kind === "video" ? (model?.defaults?.duration ?? null) : null),
    fps: req.params?.fps ?? null,
    loras: p.loras.applied.length,
    inputs: inputCounts(req),
    lane: poolOnWorkers() && endpoint && !endpoint.includes("{") ? poolLane(endpoint) : POOL_LANE,
    providerUsd: p.costUsd,
  };
}
