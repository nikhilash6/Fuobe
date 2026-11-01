import "server-only";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ElementLora, StudioElement } from "@/lib/catalog/elements";
import {
  aiToolkitJob,
  datasetName,
  ENGINE_MODE_PLACE,
  falTrainingInput,
  familyLead,
  familyLicence,
  familyOfModel,
  getTrainingTarget,
  licenceNote,
  needsConsent,
  photosBlocker,
  SOUL_ID_COPY,
  SOUL_ID_PHOTOS,
  TRAINING_FAMILIES,
  trainedLoraUrl,
  trainingCaption,
  trainingKind,
  trainsKind,
  triggerFor,
  type TrainingFamily,
  type TrainingTarget,
} from "@/lib/catalog/training";
import { TRAINING_REPLACED_BY } from "@/lib/catalog/replaced";
import { DEFAULT_AI_TOOLKIT_URL } from "@/lib/connections";
import { DATA_DIR, db } from "./db";
import { getElement, updateElement } from "./elements";
import { keepTrainedLora, lorasPath, ownCopy, recordTrainedMirror } from "./loras";
import { cloudKey } from "./provider-keys";
import { falFetch, falProvider, falQueue } from "./providers/fal";
import { ProviderError } from "./providers/types";
import { engineMode, getSetting, isCandidate, savedSetting } from "./settings";
import { readRef } from "./storage";
import { zip } from "./zip";

/**
 * Fuobe Soul ID (build plan O3): an element's photos trained as a LoRA on fal's hosted trainers or AI-Toolkit on
 * the user's GPU (src/lib/catalog/training.ts has the targets). Jobs are polled by the same background runner as
 * generations. Every LoRA a training makes is kept by Fuobe (src/server/loras.ts) so it runs on both engines.
 * With no key or trainer set (and demo mode not off), a training is a demo: it runs its course in a few seconds
 * and attaches nothing real.
 */
export interface Training {
  id: string;
  elementId: string;
  target: string;
  /** fal, AI-Toolkit or a demo; a training stored by a trainer Fuobe has retired keeps that trainer's id. */
  provider: TrainingTarget["provider"] | "demo" | (string & {});
  family: TrainingFamily | null;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number | null;
  message: string | null;
  trigger: string | null;
  error: string | null;
  /** What it cost (fal's price for the steps), null when free or unknown. */
  costUsd: number | null;
  photos: number | null;
  createdAt: number;
  completedAt: number | null;
}

interface Row {
  id: string;
  element_id: string;
  target: string;
  provider: Training["provider"];
  status: Training["status"];
  progress: number | null;
  message: string | null;
  external_id: string | null;
  meta_json: string | null;
  trigger_word: string | null;
  error: string | null;
  cost_usd: number | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

/** What a training row keeps in meta_json. */
interface Meta {
  statusUrl?: string;
  responseUrl?: string;
  name?: string;
  family?: TrainingFamily;
  photos?: number;
  /** When the person's consent was confirmed (characters only). */
  consentAt?: number;
  /** The LoRA's file name (fuobe/<handle>-<id>.safetensors), once trained. */
  file?: string;
  /** Fuobe's own copy of a hosted trainer's LoRA: downloading in the background, kept, or not kept (the trainer's URL serves). */
  keep?: "pending" | "kept" | "failed";
}

const metaOf = (r: Pick<Row, "meta_json">): Meta => JSON.parse(r.meta_json ?? "{}") as Meta;

const toTraining = (r: Row): Training => {
  const meta = metaOf(r);
  return {
    id: r.id,
    elementId: r.element_id,
    target: r.target,
    provider: r.provider,
    family: meta.family ?? getTrainingTarget(r.target)?.family ?? null,
    status: r.status,
    progress: r.progress,
    message: r.message,
    trigger: r.trigger_word,
    error: r.error,
    costUsd: r.cost_usd,
    photos: meta.photos ?? null,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  };
};

function update(id: string, fields: Partial<Row>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db()
    .prepare(`UPDATE trainings SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = @__now WHERE id = @__id`)
    .run({ ...fields, __now: Date.now(), __id: id });
}

export function listTrainings(elementId?: string): Training[] {
  const rows = elementId
    ? db().prepare("SELECT * FROM trainings WHERE element_id = ? ORDER BY created_at DESC").all(elementId)
    : db().prepare("SELECT * FROM trainings ORDER BY created_at DESC LIMIT 100").all();
  return (rows as Row[]).map(toTraining);
}


/** Why this target can't train for real here right now (a key, a trainer, the engine mode), or null. */
export function trainingBlocker(t: TrainingTarget): string | null {
  const mode = engineMode();
  if (mode !== "both" && mode !== t.engine) {
    return mode === "open"
      ? `This install is set to open source only (${ENGINE_MODE_PLACE}): train on your GPU`
      : `This install is set to paid cloud APIs only (${ENGINE_MODE_PLACE}): train in the cloud`;
  }
  // A LoRA nothing here could run: its family's models are all on the engine this install turned off.
  const fam = TRAINING_FAMILIES[t.family];
  if (mode !== "both" && !fam.lead[mode]) {
    return `${fam.name} runs only ${mode === "open" ? "in the cloud" : "on your GPU"}, which this install turned off (${ENGINE_MODE_PLACE})`;
  }
  if (t.provider === "fal" && !cloudKey("fal")) return "Add a fal.ai key in Settings";
  if (t.provider === "ai-toolkit" && !getSetting("aiToolkitUrl")) return "Set your AI-Toolkit URL in Settings → Training (or download the training kit)";
  return null;
}

/**
 * Whether a training runs as a demo: demo mode is on, or its key or trainer is missing and demo mode isn't off
 * (Settings → Demo mode). The engine mode still rules: a demo never stands in for an engine this install turned off.
 */
export function demoTraining(t: TrainingTarget): boolean {
  const why = trainingBlocker(t);
  if (why?.includes(ENGINE_MODE_PLACE)) return false;
  const demo = getSetting("demoMode");
  return demo === "on" || (!!why && demo !== "off");
}

/** The targets as the API lists them: each with what stops it and whether it would run as a demo (its licence is information). */
export const describeTargets = (targets: TrainingTarget[]) =>
  targets.map((t) => {
    const demo = demoTraining(t);
    return { ...t, blocker: demo ? null : trainingBlocker(t), demo };
  });

const isAudio = (r: string) => /\.(wav|mp3|ogg|flac|m4a|webm)$/i.test(r);
/** The photos a training uses: the element's images, up to Soul ID's 80. */
const photosOf = (el: StudioElement) => el.references.filter((r) => !isAudio(r)).slice(0, SOUL_ID_PHOTOS.max);

/** When the consent line was confirmed for an element's Soul ID training (its latest that recorded one), if ever. */
export function consentOnFile(elementId: string): number | undefined {
  const rows = db().prepare(`SELECT meta_json FROM trainings WHERE element_id = ? AND meta_json LIKE '%"consentAt"%' ORDER BY created_at DESC`).all(elementId) as Pick<Row, "meta_json">[];
  for (const r of rows) {
    const at = metaOf(r).consentAt;
    if (typeof at === "number") return at;
  }
  return undefined;
}

export function startTraining(elementId: string, targetId: string, opts: { consent?: boolean } = {}): Training {
  const el = getElement(elementId);
  const target = getTrainingTarget(targetId);
  if (!el) throw new Error("Element not found");
  if (!target) throw new Error("Unknown training target");
  if (el.kind === "voice") throw new Error("Voices don't need training — they're cloned from the sample");
  if (!target.kinds.includes(trainingKind(el.kind))) {
    throw new Error(trainingKind(el.kind) === "style" ? `${el.name} is a style: pick a style training` : `That training is for styles: pick a character training for ${el.name}`);
  }
  if (!trainsKind(target, el.kind)) throw new Error(`That training is for ${target.onlyFor?.join(" and ")}s only: pick another one for ${el.name}`);
  if (needsConsent(el.kind) && !opts.consent) throw new Error(SOUL_ID_COPY.needsConsent);
  const images = photosOf(el);
  const few = photosBlocker(images.length, el.name);
  if (few) throw new Error(few);
  const demo = demoTraining(target);
  const blocker = trainingBlocker(target);
  if (blocker && !demo) throw new Error(blocker);
  if (db().prepare("SELECT 1 FROM trainings WHERE element_id = ? AND target = ? AND status IN ('queued','running')").get(elementId, targetId)) {
    throw new Error(`${el.name} is already training here`);
  }
  const now = Date.now();
  const meta: Meta = { family: target.family, photos: images.length, ...(needsConsent(el.kind) && { consentAt: now }) };
  const row: Row = {
    id: nanoid(12),
    element_id: elementId,
    target: targetId,
    provider: demo ? "demo" : target.provider,
    status: demo ? "running" : "queued",
    progress: demo ? 0 : null,
    message: demo ? "Demo training" : "Preparing photos",
    external_id: demo ? "demo" : null,
    meta_json: JSON.stringify(meta),
    trigger_word: triggerFor(el.handle),
    error: null,
    cost_usd: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
  };
  db()
    .prepare(`INSERT INTO trainings (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map((k) => `@${k}`).join(", ")})`)
    .run(row);
  updateElement(elementId, { status: "training" });
  if (!demo) {
    submittingTrainings().add(row.id);
    void submit(row.id, el, target, row.trigger_word ?? "", images)
      .catch((e) => fail(row.id, el.id, (e as Error).message))
      .finally(() => submittingTrainings().delete(row.id));
  }
  return toTraining(row);
}

/** Trainings this process is still uploading (shared across hot reloads). */
declare global {
  var __fuobeTrainingSubmits: Set<string> | undefined;
}
const submittingTrainings = (): Set<string> => (globalThis.__fuobeTrainingSubmits ??= new Set<string>());

/** The longest a training may run before it's given up on. */
const MAX_TRAINING_MS = 8 * 3_600_000;
/** A queued training this old that nothing is uploading was cut off by a restart. */
const STALE_TRAINING_MS = 2 * 60 * 1000;
/** How long a demo training takes. */
export const DEMO_TRAINING_MS = 8_000;

function fail(id: string, elementId: string, error: string) {
  update(id, { status: "failed", error, message: null, completed_at: Date.now() });
  settleElement(elementId);
}

/** The element is "training" while any job runs, else "ready". */
function settleElement(elementId: string) {
  const busy = db().prepare("SELECT 1 FROM trainings WHERE element_id = ? AND status IN ('queued','running')").get(elementId);
  updateElement(elementId, { status: busy ? "training" : "ready" });
}

/**
 * Put a trained LoRA on the element. A retrain replaces the earlier LoRA of the same family (and the per-model LoRAs
 * from before O3 that family covers); another family's LoRA stays (Fuobe Soul and Fuobe Soul HD side by side).
 * A demo's stand-in never replaces a real LoRA: it goes on only where the family has none. Returns whether it went on.
 */
function addIdentity(elementId: string, lora: ElementLora): boolean {
  const el = getElement(elementId);
  if (!el) return false;
  const fam = lora.family;
  const covered = (l: ElementLora) => !l.referenceId && (fam ? (l.family ?? familyOfModel(l.modelId)) === fam : l.modelId === lora.modelId);
  if (lora.demo && el.loras.some((l) => covered(l) && !l.demo)) return false;
  updateElement(elementId, { loras: [...el.loras.filter((l) => !covered(l)), lora] });
  return true;
}

/** A trained LoRA's file in ComfyUI's loras folder (and Fuobe's copy): one name per training, so a retrain never reuses a cached one. */
export function trainedFileName(handle: string, trainingId: string): string {
  const base = handle.toLowerCase().replace(/[^a-z0-9_-]/g, "") || "element";
  return `fuobe/${base}-${trainingId.slice(0, 6).toLowerCase().replace(/[^a-z0-9]/g, "x")}.safetensors`;
}

/** Photos + one caption per photo ("photo of <trigger>, <description>"), named 001.jpg + 001.txt. */
async function dataset(el: StudioElement, trigger: string, images: string[]) {
  const caption = trainingCaption(el.kind === "style" ? "style" : "character", trigger, el.description);
  const files: { name: string; data: Buffer }[] = [];
  for (const [i, ref] of images.entries()) {
    const f = await readRef(ref);
    const ext = f.contentType === "image/png" ? "png" : f.contentType === "image/webp" ? "webp" : "jpg";
    files.push({ name: datasetName(i, ext), data: f.data }, { name: datasetName(i, "txt"), data: Buffer.from(caption) });
  }
  return { files, caption };
}

const aitkBase = () => getSetting("aiToolkitUrl").replace(/\/+$/, "");

/**
 * Save & test of an AI-Toolkit address that isn't the saved one: the saved auth token stays with the trainer it was
 * saved for (as ComfyUI's does). Only a token typed for the test goes to the new address.
 */
const aitkTokenWithheld = () => isCandidate("aiToolkitUrl") && !isCandidate("aiToolkitToken") && aitkBase() !== savedSetting("aiToolkitUrl").replace(/\/+$/, "");

function aitkAuth(): Record<string, string> {
  const token = aitkTokenWithheld() ? "" : getSetting("aiToolkitToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function aitk(pathname: string, init: RequestInit = {}) {
  const res = await fetch(`${aitkBase()}${pathname}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...aitkAuth(), ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ProviderError(`AI-Toolkit ${res.status}: ${JSON.stringify(body).slice(0, 300)}`, res.status);
  return body as Record<string, unknown>;
}

/** Where Fuobe writes the training photos for AI-Toolkit: Settings' folder, else its own data folder (same machine). */
const datasetRoot = () => getSetting("aiToolkitDatasetDir") || path.join(DATA_DIR, "datasets");

/**
 * Settings → Training → Save & test. The address: AI-Toolkit's UI answers its job list (GET /api/jobs, with the auth
 * token when the trainer sets AI_TOOLKIT_AUTH). The photos folder: Fuobe can write there (checked without making it).
 */
export async function testAiToolkit(opts?: { focus?: string }): Promise<{ ok: boolean; detail: string }> {
  if (opts?.focus === "aiToolkitDatasetDir") return testDatasetDir();
  const base = aitkBase();
  if (!base) return { ok: false, detail: `No AI-Toolkit URL set — its UI listens on ${DEFAULT_AI_TOOLKIT_URL}` };
  let res: Response;
  try {
    res = await fetch(`${base}/api/jobs?only_active=true`, { headers: aitkAuth(), signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    const why = (e as Error).name === "TimeoutError" ? "no answer in 10 s" : (e as Error).message;
    return { ok: false, detail: `Can't reach AI-Toolkit at ${base} (${why}). Is its UI running? (in ai-toolkit/ui: npm run build_and_start)` };
  }
  // Settings tests one field at a time: a new address is tested without a token, and a token with the saved address.
  // So the way to a trainer that wants one is its address saved anyway, then the token tested under Auth token.
  if (res.status === 401) {
    if (aitkTokenWithheld() && getSetting("aiToolkitToken")) {
      return {
        ok: false,
        detail: `AI-Toolkit wants its auth token, and the saved one isn't sent to a new address (it stays with ${savedSetting("aiToolkitUrl").replace(/\/+$/, "")}): Save anyway, then test the token under Auth token (type this trainer's there if it differs)`,
      };
    }
    if (getSetting("aiToolkitToken")) return { ok: false, detail: "AI-Toolkit rejected the auth token (401)" };
    return {
      ok: false,
      detail: isCandidate("aiToolkitUrl")
        ? "AI-Toolkit wants its auth token (AI_TOOLKIT_AUTH on the trainer): Save anyway, then add the token under Auth token and test it there"
        : "AI-Toolkit wants its auth token (AI_TOOLKIT_AUTH on the trainer): add it under Auth token",
    };
  }
  if (!res.ok) return { ok: false, detail: `AI-Toolkit answered HTTP ${res.status}` };
  const jobs = ((await res.json().catch(() => null)) as { jobs?: unknown } | null)?.jobs;
  if (!Array.isArray(jobs)) return { ok: false, detail: `Something answers at ${base}, but it isn't AI-Toolkit's UI (port 8675 by default)` };
  // An older UI that ignores only_active lists every job: count the ones still going.
  const active = jobs.filter((j) => ["running", "queued", "stopping"].includes(String((j as { status?: unknown } | null)?.status))).length;
  return { ok: true, detail: active ? `AI-Toolkit · ${active} training${active > 1 ? "s" : ""} running` : "AI-Toolkit · ready, no training running" };
}

/** Whether Fuobe can write the training photos to the folder (its nearest existing folder, when it isn't made yet). */
function testDatasetDir(): { ok: boolean; detail: string } {
  const set = getSetting("aiToolkitDatasetDir");
  const root = datasetRoot();
  if (!path.isAbsolute(root)) return { ok: false, detail: "Use a full path, like /mnt/shared/datasets" };
  let at = root;
  // A folder the person typed, not part of the app: keep Turbopack from tracing the whole project for it.
  while (!fs.existsSync(/*turbopackIgnore: true*/ at) && path.dirname(at) !== at) at = path.dirname(at);
  try {
    if (!fs.statSync(/*turbopackIgnore: true*/ at).isDirectory()) throw new Error(`${at} is a file`);
    fs.accessSync(/*turbopackIgnore: true*/ at, fs.constants.W_OK);
  } catch (e) {
    return { ok: false, detail: `Fuobe can't write to ${root} (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})` };
  }
  return {
    ok: true,
    detail: set ? `Fuobe writes the training photos to ${root}: AI-Toolkit has to read the same folder` : `Fuobe writes the training photos to ${root} (its data folder), for an AI-Toolkit on this machine`,
  };
}

/** The fal queue URL of a trainer endpoint. */
export const falQueueUrl = (endpoint: string) => `${falQueue()}/${endpoint}`;

async function submit(id: string, el: StudioElement, t: TrainingTarget, trigger: string, images: string[]) {
  const meta = metaOf((db().prepare("SELECT meta_json FROM trainings WHERE id = ?").get(id) as Pick<Row, "meta_json"> | undefined) ?? { meta_json: null });
  if (t.provider === "fal") {
    const { files, caption } = await dataset(el, trigger, images);
    update(id, { message: `Uploading ${images.length} photos` });
    const zipUrl = await falProvider.prepareFile(zip(files), "application/zip", "dataset.zip");
    const res = (await falFetch(falQueueUrl(t.trainer!), { method: "POST", body: JSON.stringify(falTrainingInput(t, zipUrl, caption, trigger)) })) as {
      request_id: string;
      status_url: string;
      response_url: string;
    };
    update(id, {
      external_id: res.request_id,
      meta_json: JSON.stringify({ ...meta, statusUrl: res.status_url, responseUrl: res.response_url }),
      status: "running",
      message: "Queued on fal",
      cost_usd: t.costUsd,
    });
    return;
  }

  // AI-Toolkit: write the dataset where the trainer can read it, then create and start a job.
  const root = datasetRoot();
  const folder = path.join(root, `fuobe-${el.id}-${id}`);
  const { files } = await dataset(el, trigger, images);
  fs.mkdirSync(folder, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(folder, f.name), f.data);
  const name = `fuobe_${el.handle.toLowerCase()}_${id.slice(0, 6)}`.replace(/[^a-z0-9_]/g, "_");
  const job = aiToolkitJob({
    name,
    trigger,
    datasetFolder: folder,
    outputFolder: path.join(root, "output"),
    kind: el.kind === "style" ? "style" : "character",
    steps: t.steps,
    photos: images.length,
    family: t.family,
  });
  const created = await aitk("/api/jobs", { method: "POST", body: JSON.stringify({ name, gpu_ids: "0", job_config: job }) });
  const jobId = String(created.id);
  await aitk(`/api/jobs/${jobId}/start`);
  update(id, { external_id: jobId, meta_json: JSON.stringify({ ...meta, name }), status: "running", message: "Queued on AI-Toolkit" });
}

// ---------------------------------------------------------------------------
// Polling (called from the generation runner's tick)

/** A provider answer that won't change by asking again: the job failed or is gone (not auth, timeouts or rate limits). */
const permanent = (e: unknown) => e instanceof ProviderError && e.status !== undefined && e.status >= 400 && e.status < 500 && ![401, 403, 408, 429].includes(e.status);

/** Why a training stored with a retired target (an older Soul ID, src/lib/catalog/replaced.ts) can't finish, and what to do. */
export const retiredTraining = (target: string): string | undefined => {
  const r = TRAINING_REPLACED_BY[target];
  return r && `${r.was} was retired: ${r.note.charAt(0).toLowerCase()}${r.note.slice(1)}`;
};

export async function pollTrainings(): Promise<void> {
  // Trainings a restart cut off mid-upload never reach the trainer: fail them so the element can retrain.
  const stale = db()
    .prepare("SELECT * FROM trainings WHERE status = 'queued' AND external_id IS NULL AND created_at < ?")
    .all(Date.now() - STALE_TRAINING_MS) as Row[];
  for (const r of stale) if (!submittingTrainings().has(r.id)) fail(r.id, r.element_id, "Interrupted before it reached the trainer — start it again");
  // A training on a target Fuobe retired (an older Soul ID) can't finish: fail it with what replaced it.
  const retired = Object.keys(TRAINING_REPLACED_BY);
  const sql = `SELECT * FROM trainings WHERE status IN ('queued','running') AND target IN (${retired.map(() => "?").join(", ")})`;
  for (const r of db().prepare(sql).all(...retired) as Row[]) fail(r.id, r.element_id, retiredTraining(r.target)!);
  // Copies of hosted LoRAs a restart cut off: start them again.
  for (const r of db().prepare(`SELECT * FROM trainings WHERE status = 'succeeded' AND meta_json LIKE '%"keep":"pending"%'`).all() as Row[]) keepInBackground(r);
  const rows = db().prepare("SELECT * FROM trainings WHERE status = 'running' AND external_id IS NOT NULL").all() as Row[];
  await Promise.all(
    rows.map((r) =>
      pollOne(r).catch((e) => {
        if (permanent(e)) return fail(r.id, r.element_id, (e as Error).message);
        update(r.id, { message: `Checking status failed: ${(e as Error).message}` });
      }),
    ),
  );
}

/** Downloads of hosted trainers' LoRAs into Fuobe's folder, by training id (shared across hot reloads). */
declare global {
  var __fuobeLoraKeeps: Map<string, Promise<void>> | undefined;
}
const keeping = (): Map<string, Promise<void>> => (globalThis.__fuobeLoraKeeps ??= new Map());

/** Wait for the LoRA copies still downloading (tests, and a clean shutdown). */
export async function trainedCopiesSettled(): Promise<void> {
  while (keeping().size) await Promise.all([...keeping().values()]);
}

function setKeep(id: string, keep: Meta["keep"], message?: string | null) {
  const r = db().prepare("SELECT meta_json FROM trainings WHERE id = ?").get(id) as Pick<Row, "meta_json"> | undefined;
  if (!r) return;
  update(id, { meta_json: JSON.stringify({ ...metaOf(r), keep }), ...(message !== undefined && { message }) });
}

/**
 * Fuobe's own copy of a LoRA a hosted trainer made (fal's storage isn't forever), downloaded in the background so the
 * runner's polling never waits on it (a FLUX LoRA is hundreds of MB). Until it lands, fal's URL serves cloud runs and
 * the GPU downloads it from there; once it lands the element's LoRA is marked as Fuobe's own.
 */
function keepInBackground(r: Pick<Row, "id" | "element_id" | "meta_json">) {
  if (keeping().has(r.id)) return;
  const meta = metaOf(r);
  const el = getElement(r.element_id);
  const lora = el?.loras.find((l) => l.file === meta.file && l.url);
  if (!el || !lora?.url || !meta.file) return setKeep(r.id, "failed");
  const { file, url } = { file: meta.file, url: lora.url };
  const job = keepTrainedLora(file, { url })
    .then(() => {
      recordTrainedMirror(file, "fal", url);
      const now = getElement(r.element_id);
      if (now) updateElement(r.element_id, { loras: now.loras.map((l) => (l.file === file && l.url === url ? { ...l, own: true as const } : l)) });
      setKeep(r.id, "kept");
    })
    .catch((e) => setKeep(r.id, "failed", `The LoRA is on fal, but Fuobe couldn't keep a copy (${(e as Error).message}): your GPU downloads it from fal when a run needs it`))
    .finally(() => keeping().delete(r.id));
  keeping().set(r.id, job);
}

/** The LoRA a finished training puts on the element. */
function trainedLora(r: Row, t: TrainingTarget, file: string, fields: Partial<ElementLora>): ElementLora {
  return {
    engine: t.engine,
    modelId: familyLead(t.family, t.engine),
    family: t.family,
    target: t.id,
    file,
    trigger: r.trigger_word ?? "",
    strength: 1,
    trainedAt: Date.now(),
    ...fields,
  };
}

async function pollOne(r: Row) {
  const t = getTrainingTarget(r.target);
  if (!t) return fail(r.id, r.element_id, retiredTraining(r.target) ?? `Unknown training target ${r.target}`);
  if (Date.now() - r.created_at > MAX_TRAINING_MS) return fail(r.id, r.element_id, `Training didn't finish within ${MAX_TRAINING_MS / 3_600_000} hours`);
  const meta = metaOf(r);
  const el = getElement(r.element_id);
  const file = trainedFileName(el?.handle ?? r.element_id, r.id);

  if (r.provider === "demo") {
    const p = Math.min(1, (Date.now() - r.created_at) / DEMO_TRAINING_MS);
    if (p < 1) return update(r.id, { progress: p, message: `Demo training · step ${Math.round(p * t.steps)}/${t.steps}` });
    // Nothing real was trained: the element keeps working from its photos, or from the real LoRA it already has.
    const added = addIdentity(r.element_id, trainedLora(r, t, file, { demo: true }));
    const fam = TRAINING_FAMILIES[t.family].name;
    return done(
      r,
      added
        ? "Demo: no LoRA was trained. Add a fal.ai key, or your AI-Toolkit in Settings → Training, then train again"
        : `Demo: no LoRA was trained, so the ${fam} Soul ID you trained before stays. Add a fal.ai key, or your AI-Toolkit in Settings → Training, to retrain`,
    );
  }

  if (r.provider === "fal") {
    const s = (await falFetch(`${meta.statusUrl}?logs=1`)) as { status: string; logs?: { message: string }[]; error?: string };
    if (s.error) return fail(r.id, r.element_id, `fal couldn't train this: ${s.error}`);
    if (s.status === "FAILED" || s.status === "ERROR" || s.status === "CANCELLED") return fail(r.id, r.element_id, `fal training ${s.status.toLowerCase()}`);
    if (s.status !== "COMPLETED") {
      const last = s.logs?.at(-1)?.message;
      const step = last && /(\d+)\s*\/\s*(\d+)/.exec(last);
      update(r.id, { progress: step ? Number(step[1]) / Number(step[2]) : r.progress, message: s.status === "IN_QUEUE" ? "In fal's queue" : (last ?? "Training") });
      return;
    }
    const out = (await falFetch(meta.responseUrl!)) as Record<string, unknown>;
    const url = trainedLoraUrl(t, out);
    if (!url) return fail(r.id, r.element_id, `No LoRA in fal's response: ${JSON.stringify(out).slice(0, 200)}`);
    // The LoRA runs at once from fal's URL (cloud runs use it, the GPU downloads it); Fuobe's own copy follows in the
    // background (keepInBackground), for when fal's copy is gone.
    recordTrainedMirror(file, "fal", url);
    addIdentity(r.element_id, trainedLora(r, t, file, { url }));
    const finished = { ...r, meta_json: JSON.stringify({ ...meta, file, keep: "pending" }) };
    update(r.id, { meta_json: finished.meta_json });
    done(r);
    keepInBackground(finished);
    return;
  }

  // AI-Toolkit
  const res = await aitk(`/api/jobs?id=${encodeURIComponent(r.external_id!)}`);
  const job = ((res.job ?? res) as Record<string, unknown>) ?? {};
  const status = String(job.status ?? "");
  if (status === "error" || status === "stopped") return fail(r.id, r.element_id, String(job.info ?? `AI-Toolkit job ${status}`));
  if (status !== "completed") {
    const step = Number(job.step ?? 0);
    const total = Number(job.total_steps ?? 0);
    update(r.id, { progress: total ? step / total : null, message: status === "running" ? `Training · step ${step}/${total || "?"}` : "Waiting for the GPU" });
    return;
  }
  const filesRes = await aitk(`/api/jobs/${r.external_id}/files`);
  const files = ((filesRes.files ?? []) as { path: string }[]).map((f) => f.path).filter((p) => p.endsWith(".safetensors")).sort();
  const latest = files.at(-1);
  if (!latest) return fail(r.id, r.element_id, "AI-Toolkit finished but saved no .safetensors file");
  const lorasDir = getSetting("comfyLorasDir");
  const fam = TRAINING_FAMILIES[t.family];
  if (!fs.existsSync(latest)) {
    // AI-Toolkit runs on another machine: the file has to be copied by hand. A family with no model on the GPU runs
    // only in the cloud, which needs Fuobe to have the file: nothing goes on the element until it's attached here.
    if (!fam.lead.open) {
      return done(r, `AI-Toolkit saved the LoRA on its own machine (${latest}). ${fam.name} runs only in the cloud, so Fuobe needs the file: copy it into the LoRA folder on this machine (Settings → LoRAs) as ${file}, then attach it under Train anywhere`);
    }
    addIdentity(r.element_id, trainedLora(r, t, file, {}));
    return done(r, `Copy ${latest} to ComfyUI/models/loras/${file}`);
  }
  // Fuobe's copy (for cloud runs and safe keeping), then ComfyUI's.
  await keepTrainedLora(file, { path: latest });
  if (lorasDir) {
    const dest = lorasPath(lorasDir, file);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.copyFile(latest, dest);
  }
  addIdentity(r.element_id, trainedLora(r, t, file, { own: true }));
  return done(r);
}

function done(r: Row, message: string | null = null) {
  update(r.id, { status: "succeeded", progress: 1, message, completed_at: Date.now() });
  settleElement(r.element_id);
}

// ---------------------------------------------------------------------------
// Download kit for training anywhere (AI-Toolkit CLI)

export async function trainingKit(elementId: string, family: TrainingFamily = "z-image-turbo"): Promise<{ name: string; data: Buffer }> {
  const el = getElement(elementId);
  if (!el) throw new Error("Element not found");
  const images = photosOf(el);
  if (!images.length) throw new Error("Add photos first");
  const trigger = triggerFor(el.handle);
  const { files } = await dataset(el, trigger, images);
  const name = `fuobe_${el.handle.toLowerCase()}`.replace(/[^a-z0-9_]/g, "_");
  const job = aiToolkitJob({ name, trigger, datasetFolder: "./dataset", outputFolder: "./output", kind: el.kind === "style" ? "style" : "character", photos: images.length, family });
  const fam = TRAINING_FAMILIES[family];
  const file = `fuobe/${el.handle.toLowerCase().replace(/[^a-z0-9_-]/g, "") || "element"}.safetensors`;
  const readme = `# Train ${el.name} with AI-Toolkit (${fam.base})

1. Install AI-Toolkit: https://github.com/ostris/ai-toolkit (see its README for the GPU ${fam.base} needs)
2. Unzip this kit next to it and run:

       python run.py ${name}.yaml

3. Copy the newest file from ./output/${name}/*.safetensors to ComfyUI/models/loras/${file}
4. In Fuobe, open ${el.name} → Train → "Train anywhere", pick ${fam.base} and attach that file name.

Trigger word: ${trigger} — Fuobe adds it to the prompt whenever you @${el.handle} on ${fam.name}.
Licence of the base weights: ${licenceNote(familyLicence(family))}.
Train only on photos you have the right to use${el.kind === "character" ? ", of a person who agreed to it" : ""}.
`;
  return {
    name: `${name}-${family}-training-kit.zip`,
    // JSON is valid YAML, so AI-Toolkit reads the config as-is.
    data: zip([
      ...files.map((f) => ({ name: `dataset/${f.name}`, data: f.data })),
      { name: `${name}.yaml`, data: Buffer.from(JSON.stringify(job, null, 2)) },
      { name: "README.md", data: Buffer.from(readme) },
    ]),
  };
}

/**
 * Register a LoRA trained elsewhere (already in ComfyUI/models/loras) for its family (Z-Image Turbo unless it says
 * which). When the LoRA folder is on this machine, Fuobe keeps a copy too, so cloud runs can use it.
 */
export async function attachLora(elementId: string, input: { file: string; trigger: string; family?: TrainingFamily }) {
  const file = input.file.trim().replace(/^\/+/, "");
  if (!/\.safetensors$/.test(file) || file.includes("..")) throw new Error("Enter the LoRA's file name inside ComfyUI/models/loras, ending in .safetensors");
  const family = input.family ?? "z-image-turbo";
  const fam = TRAINING_FAMILIES[family];
  const dir = getSetting("comfyLorasDir");
  let own = !!ownCopy(file);
  if (!own && dir) {
    let src = "";
    try {
      src = lorasPath(dir, file);
    } catch {
      src = "";
    }
    if (src && fs.existsSync(/*turbopackIgnore: true*/ src)) {
      await keepTrainedLora(file, { path: src });
      own = true;
    }
  }
  // A family with no model on the GPU runs only in the cloud, from Fuobe's copy of the file.
  if (!own && !fam.lead.open) {
    throw new Error(`${fam.name} runs only in the cloud, so Fuobe needs the file itself: put ${file} in the LoRA folder on this machine (Settings → LoRAs), then attach it again`);
  }
  addIdentity(elementId, {
    engine: "open",
    modelId: familyLead(family, "open"),
    family,
    file,
    trigger: input.trigger.trim(),
    strength: 1,
    trainedAt: Date.now(),
    ...(own && { own: true as const }),
  });
}
