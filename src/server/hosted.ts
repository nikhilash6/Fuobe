import "server-only";
import { getModel } from "@/lib/catalog";
import { lengthRange } from "@/lib/catalog/clip-lengths";
import { computeDimensions, fitCanvas } from "@/lib/comfy";
import { h3Canvas, isH3Graph } from "@/lib/h3-prompt";
import { imageSize } from "@/lib/image-size";
import type { GenerationRequest } from "@/lib/catalog/types";
import type { Place } from "@/lib/place-name";
import { runtimeNeeds } from "@/lib/runtime-files";
import { billingConfigured, type Policy, type QueueFacts, type RunFacts } from "./billing";
import { lineFacts, poolLane, queueOfGeneration, workersAway, workersCanRun, workersMost, type LinePlace } from "./computer/pool";
import { db } from "./db";
import { loadIndex } from "./gpu/index-file";
import { hostedRunsOn } from "./hosted-switch";
import { holdOf, NOT_HELD, type HoldReason } from "./pool-holds";
import { poolRunCounts } from "./pool-limits";
import { queueSettings } from "./queue-settings";
import { getWorkflow, installComfyLocal, onInstallComfy, workerFor, workersTake } from "./providers/comfyui";
import { getSetting, withCandidates } from "./settings";
import { modelFormat, modelTaken } from "./model-input";
import { contentTypeFor, localHead, storedMedia } from "./storage";
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
 * for them: a worker the owner added and allowed a lane that it can run (paused or not: a paused worker means the run
 * waits in line), or its own ComfyUI server on this machine.
 */
export function poolReady(): boolean {
  if (!hostedRunsOn()) return false;
  if (!billingConfigured() && !hostedFree()) return false;
  const where = getSetting("comfyWhere");
  if (where === "computer") return false;
  return where === "workers" ? workersCanRun(null) : installComfyLocal();
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
 * May this install's GPUs run this workflow (planned.route.endpoint)? On the workers: one is allowed its lane and has
 * what it needs, as its last list of files said (a workflow that picks its graph at run time, `…-{n}`: every graph it
 * may pick). On its own server: the isolated ComfyUI's workflows too only when that one is on this machine.
 */
export function poolTakes(endpoint: string | undefined): boolean {
  if (!endpoint) return false;
  const isolated = workerFor(endpoint) === "isolated";
  if (!poolOnWorkers()) return installComfyLocal(isolated ? "isolated" : "main");
  if (isolated) return false;
  if (!endpoint.includes("{")) return workersCanRun(endpoint);
  const picks = workflowPicks(endpoint);
  return picks.length > 0 && picks.every((id) => workersCanRun(id));
}

/**
 * Has a worker that may run this workflow verified every run-time file a run of it loads (`names`: the LoRA files it adds
 * beyond its workflow's own, src/lib/runtime-files.ts)? A file with no pin (a person's own LoRA) no worker can verify. A
 * workflow that picks its graph at run time: every graph it may pick. No such files, or not on the workers (this install's
 * own ComfyUI downloads into its own LoRA folder, or says what it lacks): yes.
 */
export function poolHasFiles(endpoint: string | undefined, names: readonly string[]): boolean {
  if (!endpoint || !names.length || !poolOnWorkers()) return true;
  const index = loadIndex();
  const picks = endpoint.includes("{") ? workflowPicks(endpoint) : [endpoint];
  return (
    picks.length > 0 &&
    picks.every((id) => {
      const r = runtimeNeeds(names, index, id);
      return !r.unknown.length && (!r.files.length || workersCanRun(id, { files: r.files }));
    })
  );
}

/** The size of one job, as a PC's ceiling reads it: its pictures' or frames' megapixels, a clip's seconds, its results. */
export interface JobSize {
  megapixels: number;
  seconds: number;
  outputs: number;
}

/**
 * Does a job of this size fit a GPU here that runs its workflow (on the workers: one whose PC's ceiling holds it)? Yes
 * for a workflow none of them runs (another check speaks for it), one that picks its graph at run time, and off the
 * workers (this install's own ComfyUI has no ceiling).
 */
export function poolFitsSize(endpoint: string | undefined, size: JobSize): boolean {
  if (!endpoint || endpoint.includes("{") || !poolOnWorkers() || !workersCanRun(endpoint)) return true;
  return workersCanRun(endpoint, { size });
}

const tenth = (n: number) => Math.round(n * 10) / 10;

/** The largest size the GPUs here make of the limit a job passes, in words ("8 megapixels", "10 s clips"), or null. */
export function poolMostWords(endpoint: string | undefined, size: JobSize): string | null {
  if (!endpoint || endpoint.includes("{")) return null;
  const most = workersMost(endpoint);
  if (most.maxMegapixels !== undefined && size.megapixels > most.maxMegapixels) return `${tenth(most.maxMegapixels)} megapixels`;
  if (most.maxSeconds !== undefined && size.seconds > most.maxSeconds) return `${tenth(most.maxSeconds)} s clips`;
  if (most.maxOutputs !== undefined && size.outputs > most.maxOutputs) return `${most.maxOutputs} results at a time`;
  return null;
}

/**
 * Are this install's GPUs all away for this endpoint now (on the workers: every worker that could run it paused, silent or
 * outside its hours)? A run made then waits in line until one is back: the price check says it starts when a GPU is
 * free (hosted-run.ts runWaits), and Run stays on. On this install's own ComfyUI: never.
 */
export function poolAway(endpoint: string | undefined): boolean {
  if (!endpoint || !poolOnWorkers()) return false;
  if (!endpoint.includes("{")) return workersAway(endpoint);
  const picks = workflowPicks(endpoint);
  return picks.length > 0 && picks.every((id) => workersAway(id));
}

/**
 * Can this install's GPUs take this workflow's job tickets now (an account's run there goes as one): on the workers, one
 * built for this studio's catalog that may run it (a workflow that picks its graph at run time: every graph it may
 * pick). After an update of the studio, a worker built from the catalog before takes them once it is updated too:
 * meanwhile poolTakes still says the run could go there, and this says not yet. Not on the workers: yes.
 */
export function poolTicketsReady(endpoint: string | undefined): boolean {
  if (!endpoint || !poolOnWorkers()) return true;
  const picks = endpoint.includes("{") ? workflowPicks(endpoint) : [endpoint];
  return picks.length > 0 && picks.every((id) => workersCanRun(id, { tickets: true }));
}

/**
 * The steps a run on this install's GPUs can carry out there: ComfyUI's, and a chain's text steps (a script, lyrics, a
 * translation), which the install's AI helper writes for free. The price check, the run's admission and its submit read
 * this one table, so a run is refused before Run when a step of it couldn't run there (a step made in the browser, a
 * cloud model), never part way through.
 */
const POOL_PROVIDERS: ReadonlySet<string> = new Set(["comfyui", "llm"]);
export const poolRunsProvider = (provider: string): boolean => POOL_PROVIDERS.has(provider);

/** May a run on this install's GPUs send them this kind of file (the workers take only the kinds the install allows)? */
export const poolTakesFiles = (kind: "image" | "video" | "audio"): boolean => !poolOnWorkers() || workersTake(kind);

/**
 * The kinds of input file a run on this install's GPUs may use, read in one place by the upload route, the price check
 * and the run: a kind the policy's `uploads` allows and the install's GPUs take (poolTakesFiles). With no billing
 * service the policy is the open one (pictures only), and clips and sound follow what the workers take
 * (FUOBE_POOL_MEDIA_INPUTS): each worker makes every clip and sound again before its ComfyUI reads it.
 */
export function poolUploads(p: Pick<Policy, "uploads">): { image: boolean; video: boolean; audio: boolean } {
  const open = !billingConfigured() && poolOnWorkers();
  const takes = (kind: "image" | "video" | "audio") => (!!p.uploads?.[kind] || (open && kind !== "image")) && poolTakesFiles(kind);
  return { image: takes("image"), video: takes("video"), audio: takes("audio") };
}

/**
 * Run `fn` as an account's run on this install's GPUs: as the account (its own files and runs only), on this install's
 * ComfyUI server, the open engine, no demo outputs.
 */
export function runOnPool<T>(accountId: string | null, fn: () => T): T {
  const inside = () => onInstallComfy(() => withCandidates({ engineMode: "open", demoMode: "off" }, fn));
  return accountId ? runAsTenant({ kind: "account", id: accountId }, inside) : runAsTenant({ kind: "guest" }, inside);
}

/**
 * Words for runs on this install's GPUs, with the name visitors read for them (`place`, src/server/place-name.ts). Every
 * sentence fits any name: no verb agrees with it.
 *
 * What these GPUs don't run is a label, never a refusal: the price slot says where it runs ("Self-hosted"), its
 * tooltip says what to do (hostedDetails), and Run opens the way there (Connect your GPU, or a guest's sign-up). The
 * same labels for a guest and an account.
 */
export function hostedWords(place: Place) {
  return {
    notOffered: "Self-hosted",
    loras: "LoRAs run self-hosted",
    files: "This style runs self-hosted",
    inputs: "This file runs self-hosted",
    rtxCard: "Self-hosted · RTX GPU",
    size: "This size runs self-hosted",
    length: "This length runs self-hosted",
    notHosted: `Your account can't run on ${place.text} right now. Your own GPU or key still works.`,
  };
}

/** The reasons a run on this install's GPUs is refused, by name (the same for every place name). */
export type HostedReason = keyof ReturnType<typeof hostedWords>;

/** A label's one sentence (the price slot's tooltip, the line under the toolbar on a phone). `most`: the largest size here. */
export function hostedDetails(place: Place, most?: string | null) {
  return {
    notOffered: "Connect your GPU to run this one, or pick another model.",
    loras: "Connect your GPU to use them, or run without them.",
    files: "Connect your GPU to use this style, or pick another one.",
    inputs: "Connect your GPU to use it, or use a picture.",
    rtxCard: "This one needs an NVIDIA RTX card.",
    size: `${most ? `Up to ${most} on ${place.text}. ` : ""}Pick a smaller size, or run it on your own GPU.`,
    length: `${most ? `Up to ${most} on ${place.text}. ` : ""}Pick a shorter length, or run it on your own GPU.`,
  };
}

/** The labels for a guest: the same as an account's (Run opens the sign-up for that label). */
export function hostedGuestWords() {
  const { notOffered, rtxCard, loras, files, inputs, size, length } = hostedWords({ label: "", text: "" });
  return { notOffered, rtxCard, loras, files, inputs, size, length };
}

/** The longest video clip a person's run on this install's GPUs may make, in seconds (queue-settings.ts; null: no limit). */
export const poolClipLimitS = (): number | null => queueSettings().longestClipS;

/**
 * The seconds of the longest clip one job of a request makes, for the clip limit: a video model with a length to pick
 * (its durations, or a range of whole seconds), the length asked for, else its default; shots rendered as clips of their
 * own and joined, the longest shot. 0 for anything else (a clip made from a clip as long as its source, sound, pictures).
 */
export function requestClipSeconds(req: Pick<GenerationRequest, "params">, modelId: string, kind: string): number {
  const model = getModel(modelId);
  if (kind !== "video" || !model || !(model.options.durations?.length || lengthRange(model))) return 0;
  const shots = (req.params?.shots ?? []).filter((s) => s.prompt?.trim());
  if (shots.length && model.options.multiShot?.mode === "concat") return Math.max(...shots.map((s) => Number(s.duration) || 0));
  const asked = Number(req.params?.duration ?? model.defaults?.duration ?? model.options.durations?.[0]);
  return Number.isFinite(asked) && asked > 0 ? asked : 0;
}

/** The clip limit a request passes (poolClipLimitS), or null when it fits, or there is none. */
export function clipPastLimit(req: Pick<GenerationRequest, "params">, modelId: string, kind: string, limit: number | null = poolClipLimitS()): number | null {
  if (!limit) return null;
  return requestClipSeconds(req, modelId, kind) > limit + 0.05 ? limit : null;
}

/**
 * A tool's run that asks for more pictures or clips at once than a run on this install's GPUs makes (the policy's cap per
 * run): pick fewer. An account may also connect its own GPU, which has no such cap.
 */
export function outputsWords(cap: number, guest: boolean, place: Place): string {
  const most = cap === 1 ? "one at a time" : `up to ${cap} at a time`;
  const pick = cap === 1 ? "Pick one" : `Pick ${cap} or fewer`;
  return guest ? `Makes ${most}. ${pick}.` : `Makes ${most} on ${place.text}. ${pick}, or run it on your own GPU.`;
}

/** Are these words outputsWords (a run past the outputs a run here makes: the person picks fewer), not a label? */
export const isOutputsWords = (words: string): boolean => /^Makes (one|up to \d+) at a time\b/.test(words);

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

/**
 * May this whole run go on this install's GPUs: its model and every other step it makes (a 2K take's Open-H3 Regenerate
 * finish), so a policy that keeps a model off the pool keeps it off as a step too.
 */
export function poolAllowsRun(p: Pick<Policy, "pool">, planned: { model: { id: string }; steps?: { model: string }[] }, presetId?: string | null): boolean {
  return [planned.model.id, ...(planned.steps ?? []).map((s) => s.model)].every((id) => poolAllows(p, id, presetId));
}

/** The file kinds a request uses (for the policy's uploads rule and the billing facts). */
export function inputCounts(req: GenerationRequest): { image: number; video: number; audio: number } {
  const i = req.inputs ?? {};
  const image = (i.images?.length ?? 0) + (i.endImage ? 1 : 0) + (i.mask ? 1 : 0) + (i.sketch ? 1 : 0);
  const video = (i.video ? 1 : 0) + (i.videos?.length ?? 0);
  const audio = [i.audio, i.audio2, i.voiceAudio, i.voiceAudio2].filter(Boolean).length + (i.audios?.length ?? 0);
  return { image, video, audio };
}

/** A kind of file a run sends to this install's GPUs. */
export type FileKind = "image" | "video" | "audio" | "model3d" | "file";

/** The kind of a stored file, data: URI or example a run names: a 3D file an account may send them, or another file. */
export function refKind(ref: string): FileKind {
  const type = ref.startsWith("data:") ? (/^data:([^;,]*)/.exec(ref)?.[1] ?? "") : contentTypeFor(ref.split(/[?#]/)[0], "");
  const t = type.toLowerCase();
  const model = modelFormat(t, ref.split(/[?#]/)[0]);
  if (model) return modelTaken(model, true) ? "model3d" : "file";
  if (t === "image/x-exr" || t === "image/aces") return "file";
  return t.startsWith("image/") ? "image" : t.startsWith("video/") ? "video" : t.startsWith("audio/") ? "audio" : "file";
}

/** Every kind of file a request reads: its inputs and the files its params.extra names. */
export function requestFileKinds(req: Pick<GenerationRequest, "inputs" | "params">): FileKind[] {
  const out = new Set<FileKind>();
  const c = inputCounts(req as GenerationRequest);
  for (const k of ["image", "video", "audio"] as const) if (c[k]) out.add(k);
  if (typeof req.inputs?.model3d === "string" && req.inputs.model3d) out.add(refKind(req.inputs.model3d));
  for (const v of Object.values(req.params?.extra ?? {})) {
    for (const x of typeof v === "string" ? [v] : Array.isArray(v) ? v : []) if (typeof x === "string" && /^(data:|\/api\/files\/)/.test(x)) out.add(refKind(x));
  }
  return [...out];
}

/**
 * Do this install's GPUs take a kind of file: a picture, clip or sound as the policy's uploads and the workers allow (a
 * file an earlier step made: as the workers allow, `p` left out), a 3D file always (checked by its bytes), and no other
 * kind on the workers.
 */
export function poolTakesKind(kind: FileKind, p?: Pick<Policy, "uploads"> | null): boolean {
  if (kind === "model3d") return true;
  if (kind === "file") return !poolOnWorkers();
  return p ? poolUploads(p)[kind] : poolTakesFiles(kind);
}

/** The pool's one lane while this install's GPUs are its own ComfyUI server. */
export const POOL_LANE = "comfyui";

/** The pool's rows that wait or run (the route's place-in-line facts). */
const POOL_ROWS = "json_extract(g.request_json, '$.place') = 'pool' AND g.status IN ('queued', 'running')";

/**
 * How long a run on this install's GPUs may wait in line: the limit stamped on it (the policy's or the billing service's;
 * 0: as long as it takes), else FUOBE_POOL_WAIT_MIN, else as long as it takes (it stays in line and starts by itself).
 */
export function poolWaitMs(stamped?: number): number {
  if (stamped === 0) return Infinity;
  if (stamped && stamped > 0) return stamped;
  const m = Number(process.env.FUOBE_POOL_WAIT_MIN);
  return Number.isFinite(m) && m > 0 ? m * 60_000 : Infinity;
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
  const ahead = (d.prepare(`SELECT COUNT(*) AS n FROM generations g WHERE ${POOL_ROWS} AND ${WAITING} AND ${NOT_HELD("g")}`).get() as { n: number }).n;
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

/**
 * A held row's line (pool-holds.ts): why it waits to enter it and, as its tile says it, where it stands. Waiting for the
 * service: its place and wait as if in line from its press (`paused`: the service said runs here are paused, so it
 * starts when a GPU is free). Behind the account's runs going: about when it would be ready, when known (when the first
 * of them is due done, plus a new run's wait now). Until a time: that time. Null when the row isn't held.
 */
export function heldLine(generationId: string, now = Date.now()): (LinePlace & { held: HoldReason; startAt?: number; paused?: true }) | null {
  const h = holdOf(generationId);
  if (!h) return null;
  const startAt = h.start_at !== null && h.start_at > now ? h.start_at : undefined;
  const base = { held: h.reason, ...(startAt !== undefined && { startAt }) };
  if (startAt !== undefined) return { place: 1, etaSeconds: null, ...base };
  const workflow = rowWorkflow(generationId);
  if (h.reason === "service") {
    if (h.paused) return { place: 1, etaSeconds: null, unknown: true, paused: true, ...base };
    if (!poolOnWorkers()) return { ...ownServerPlace(h.pressed_at), ...base };
    const f = lineFacts(h.account_id, workflow, now, h.pressed_at);
    return { place: f.ahead + 1, etaSeconds: f.etaS, ...(f.etaS === null && f.workersOnline === 0 && { unknown: true as const }), ...(f.nextOpenAt && { returnAt: f.nextOpenAt }), ...base };
  }
  if (h.reason === "mine") return { place: 1, etaSeconds: mineEta(h.account_id, workflow), ...base };
  return { place: 1, etaSeconds: null, ...base };
}

/** The workflow a row's job runs (its route on ComfyUI), or null. */
function rowWorkflow(generationId: string): string | null {
  const r = db().prepare("SELECT model_id, op FROM generations WHERE id = ?").get(generationId) as { model_id: string; op: string } | undefined;
  const routes = r ? (getModel(r.model_id)?.routes ?? []).filter((x) => x.provider === "comfyui") : [];
  const endpoint = (routes.find((x) => x.op === r?.op) ?? routes[0])?.endpoint;
  return endpoint && !endpoint.includes("{") ? endpoint : null;
}

/** On this install's own server: a run's place from its press among the rows waiting there. */
function ownServerPlace(pressedAt: number): LinePlace {
  const before = (db().prepare(`SELECT COUNT(*) AS n FROM generations g WHERE ${POOL_ROWS} AND ${WAITING} AND ${NOT_HELD("g")} AND g.created_at < ?`).get(pressedAt) as { n: number }).n;
  const typical = typicalRunMs();
  return { place: before + 1, etaSeconds: typical === null ? null : Math.round(((before + 1) * typical) / 1000) };
}

/**
 * About when a run held behind the account's runs going would be ready: when the first of them is due done (one in line:
 * its wait; one working: its time left, from its GPU task's estimate, else a typical run's), plus a new run's wait now.
 * Null when that isn't known (none of them has an estimate).
 */
function mineEta(accountId: string, workflow: string | null, now = Date.now()): number | null {
  const going = db()
    .prepare(
      `SELECT g.id, r.started_at FROM generations g LEFT JOIN generation_runs r ON r.id = g.id
       WHERE ${POOL_ROWS} AND json_extract(g.request_json, '$.account') = ? AND ${NOT_HELD("g")}`,
    )
    .all(accountId) as { id: string; started_at: number | null }[];
  let first: number | null = null;
  let typical: number | null | undefined;
  for (const g of going) {
    let eta: number | null = null;
    if (g.started_at !== null) {
      const task = db().prepare("SELECT est_ms, started_at FROM relay_tasks WHERE generation_id = ? AND state = 'running' ORDER BY created_at DESC LIMIT 1").get(g.id) as
        | { est_ms: number | null; started_at: number | null }
        | undefined;
      const est = task?.est_ms ?? (typical === undefined ? (typical = typicalRunMs()) : typical);
      const since = task?.started_at ?? g.started_at;
      if (est !== null && est > 0) eta = Math.max(5, Math.round((est - (now - since)) / 1000));
    } else eta = placeInLine(g.id)?.etaSeconds ?? null;
    if (eta !== null) first = first === null ? eta : Math.min(first, eta);
  }
  if (first === null) return null;
  const own = queueFacts(accountId, workflow).etaS;
  return own === null ? null : first + own;
}

/** A waiting row's place in line on this install's GPUs (1: next), and the wait, about. Null when it isn't waiting there. */
export function placeInLine(generationId: string): LinePlace | null {
  // On the workers: its task's place in their line (back in line after an attempt, the same place).
  const task = queueOfGeneration(generationId);
  if (task || poolOnWorkers()) return task;
  const d = db();
  const row = d.prepare(`SELECT g.created_at FROM generations g WHERE g.id = ? AND ${POOL_ROWS} AND ${WAITING} AND ${NOT_HELD("g")}`).get(generationId) as { created_at: number } | undefined;
  if (!row) return null;
  const before = (
    d.prepare(`SELECT COUNT(*) AS n FROM generations g WHERE ${POOL_ROWS} AND ${WAITING} AND ${NOT_HELD("g")} AND (g.created_at < ? OR (g.created_at = ? AND g.id < ?))`).get(row.created_at, row.created_at, generationId) as {
      n: number;
    }
  ).n;
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

/**
 * A run's own step, then the other steps it makes beside it (a 2K take's finish), each model and operation once with its
 * count: the shape of RunFacts.steps.
 */
function stepsBeside(own: NonNullable<RunFacts["steps"]>[number], others: { model: string; op: string }[]): NonNullable<RunFacts["steps"]> {
  const out = new Map<string, NonNullable<RunFacts["steps"]>[number]>([[`${own.model} ${own.op ?? ""}`, own]]);
  for (const o of others) {
    const key = `${o.model} ${o.op || ""}`;
    const had = out.get(key);
    if (had) had.jobs++;
    else out.set(key, { model: o.model, op: o.op || null, kind: own.kind, jobs: 1, lane: own.lane });
  }
  return [...out.values()];
}

/** The facts the billing service prices a run by (from a planned request: previewGeneration's answer). */
export function runFacts(
  req: GenerationRequest,
  p: { model: { id: string; kind: string; engine: "open" | "cloud" }; op: string; jobs: number; outputs: number; providerId: string; costUsd: number | null; loras: { applied: unknown[] }; route?: { endpoint?: string }; steps?: { model: string; op: string }[] },
  kind: RunFacts["kind"],
): RunFacts {
  const model = getModel(p.model.id);
  const endpoint = p.route?.endpoint;
  const lane = poolOnWorkers() && endpoint && !endpoint.includes("{") ? poolLane(endpoint) : POOL_LANE;
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
    lane,
    providerUsd: p.costUsd,
    // The run's other steps (a 2K take's finish), priced beside its own step as one run. A plan of every row the run
    // makes (hosted-run.ts pricedSteps) takes the place of this where there is one.
    ...(p.steps?.length && { steps: stepsBeside({ model: p.model.id, op: p.op || null, kind, jobs: p.jobs, lane }, p.steps) }),
  };
}
