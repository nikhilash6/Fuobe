import "server-only";
import fs from "node:fs";
import type { OutputFile } from "@/lib/catalog/types";
import { normalizeKeys } from "@/lib/camera-path";
import { FINISH_FILES, FINISH_VERSION, finishProblem, PATH_LIMITS, type FinishKind, type FinishPathKey, type FinishStats, type FinishTicket } from "@/lib/finish-ticket";
import type { HistoryEntryLike, WantedFile } from "@/lib/relay";
import { accountTotalBytes, accountUsage, diskFloorBytes, diskFreeBytes, diskHasRoom } from "../account-files";
import { db } from "../db";
import { pictureWithoutMetadata } from "../media-clean";
import { glbSelfContained } from "../model-input";
import { ACCOUNT_TURNTABLE, accountFinishProblem, FINISHED_3D_OPS, MODEL_FINISH_VERSION, modelToFinish, OWN_ORBIT, withTurntable } from "../model3d-finish";
import { getSetting } from "../settings";
import { absolutePath, deleteAsset, getAsset, readRef, saveFile, type Asset } from "../storage";
import { tenantAccount } from "../tenant";
import { cpuSlotOf, poolWaitMs, RETRY_WINDOW_MS, runPlaceOf, ticketReady } from "./pool";
import { createTask, endTask, json, receivedFile, resultOf, stageInput, stagedInput, type FinishedPlan, type TaskRow } from "./tasks";
import type { WorkerRow } from "./workers";

/**
 * Finishing jobs on the workers (docs/gpu-workers.md, "The CPU slot"): the CPU work that follows an account's run on this
 * install's GPUs runs on a worker's CPU slot, never on this server. Two kinds (src/lib/finish-ticket.ts):
 *
 * - "model3d": an image-to-3D model's finish. The worker checks the GLB is self-contained (a buffer or a picture that
 *   names another file is refused there), writes the web GLB, and renders the turntable and its poster. This server
 *   only stores what comes back, on the model output as its own finish does (src/server/model3d-finish.ts).
 * - "path": a camera path drawn through a still and its depth picture (the guide of a camera move), as an MP4.
 *
 * A finishing job is a task for the workers like any other: in the run's class, at the run's place in line, staged and
 * collected through the same routes, with its own run limit. Only a worker whose CPU slot says it runs that kind takes
 * it. The owner's own runs, and runs on an account's own GPU or key, keep this server's finish, as before.
 */

/**
 * Does a worker's CPU slot run this kind of finishing job: a pool worker not revoked, heard from in the last few minutes
 * (paused or not: a run then waits in line), whose program takes this studio's job tickets (ticketReady), and whose last
 * beat said its CPU slot runs that kind. A worker gone quiet for longer, or built from another catalog, counts for none:
 * a run is then never queued for a finish nothing would take.
 */
export function workersFinish(kind: FinishKind, now = Date.now()): boolean {
  if (getSetting("comfyWhere") !== "workers") return false;
  const rows = db()
    .prepare("SELECT cpu_slot_json, protocol, catalog_version FROM relay_workers WHERE kind = 'pool' AND revoked_at IS NULL AND pool = 'pool' AND cpu_slot_json IS NOT NULL AND seen_at > ?")
    .all(now - RETRY_WINDOW_MS) as Pick<WorkerRow, "cpu_slot_json" | "protocol" | "catalog_version">[];
  return rows.some((w) => ticketReady(w) && !!cpuSlotOf(w)?.finishes.includes(kind));
}

/**
 * May a 3D model's run go on this install's GPUs: one whose GLB gets its finish (an image-to-3D job or Hi3D's refine of
 * one from ComfyUI: model3d-finish.ts FINISHED_3D_OPS), while a worker's CPU slot runs that finish (workersFinish). Every
 * other 3D model (a scene, a splat, a rig, a still made into 3D in one chain) stays on a visitor's own GPU or key.
 */
export function poolFinishes3d(step: { provider: string; op: string }): boolean {
  return step.provider === "comfyui" && FINISHED_3D_OPS.includes(step.op) && workersFinish("model3d");
}

/** A finishing job's ticket as its task keeps it, or null. */
const ticketOf = (t: Pick<TaskRow, "finish_json">): FinishTicket | null => (t.finish_json ? json<FinishTicket | null>(t.finish_json, null) : null);

/** The latest finishing job of this kind for a run (and step, for a path), or null. */
export function finishTask(generationId: string, kind: FinishKind, step = 0): TaskRow | null {
  const rows = db().prepare("SELECT * FROM relay_tasks WHERE generation_id = ? AND finish_json IS NOT NULL ORDER BY created_at DESC").all(generationId) as TaskRow[];
  return rows.find((t) => ticketOf(t)?.kind === kind && (json<{ step?: number }>(t.extra_json, {}).step ?? 0) === step) ?? null;
}

/**
 * The wait the run was stamped with (the billing service's limit; 0: as long as it takes, so none), else this
 * install's (FUOBE_POOL_WAIT_MIN, when set). Undefined: no limit.
 */
function runWaitMs(generationId: string): number | undefined {
  const r = db().prepare("SELECT json_extract(request_json, '$.waitMs') AS w FROM generations WHERE id = ?").get(generationId) as { w: unknown } | undefined;
  const w = r?.w === null || r?.w === undefined ? NaN : Number(r.w);
  if (w === 0) return undefined;
  if (Number.isFinite(w) && w > 0) return w;
  // This install's own limit, when it sets one (none by default: as long as it takes).
  return poolWaitMs() || undefined;
}

/**
 * Queue a finishing job for an account's run: its files staged as the account's (a picture with what it carries besides
 * its pixels blanked, as for a run's job), its ticket checked as the worker will check it, in the run's class and at the
 * run's place in line. It waits for a worker's CPU slot as long as the run was allowed to wait in line (its stamped wait,
 * else this install's; stamped 0: as long as it takes): a job no CPU slot took by then fails, and the run ends without what it would have made (a 3D
 * model keeps its raw GLB; a camera path's step says one plain sentence). Once a CPU slot took it, it waits in its place
 * after any recovery, as every job does. Once a run (and step): while a job of this kind for it is in line, running or
 * done, its id comes back and nothing new is queued, in one locked step even while another app process (a deploy's
 * overlap) asks too. Returns the task's id.
 */
export function queueFinish(o: {
  kind: FinishKind;
  generationId: string;
  account: string;
  inputs: { slot: string; data: Buffer; contentType: string; name: string }[];
  settings: Record<string, unknown>;
  step?: number;
}): string {
  const principal = `acct:${o.account}` as const;
  const queued = () => {
    const had = finishTask(o.generationId, o.kind, o.step ?? 0);
    return had && had.state !== "canceled" ? had.id : null;
  };
  const was = queued();
  if (was) return was;
  const inputs = o.inputs.map((i) => {
    const data = i.contentType.startsWith("image/") ? pictureWithoutMetadata(i.data) : i.data;
    if (!data) throw new Error("This run couldn't finish.");
    const name = stageInput(principal, data, i.contentType, i.name);
    return { slot: i.slot, name, sha256: stagedInput(principal, name)!.sha256 };
  });
  const ticket: FinishTicket = { v: FINISH_VERSION, kind: o.kind, settings: o.settings, inputs };
  const problem = finishProblem(ticket, { inputs });
  // Why, for the server's log only: the run says one plain sentence.
  if (problem) {
    console.warn(`[fuobe] A finishing job for ${o.generationId} wasn't queued: ${problem}.`);
    throw new Error("This run couldn't finish.");
  }
  // Looked at again with the write lock: another process that queued it meanwhile wins (the inputs staged here go with
  // the next sweep of staged files that no task took).
  return db()
    .transaction((): string => {
      const again = queued();
      if (again) return again;
      // The run's class and place in line (pool.ts runPlaceOf): a chain's camera path is queued for a step that has no
      // job of its own yet, and keeps the place of the steps of its run before it.
      const run = runPlaceOf(o.generationId);
      const now = Date.now();
      const wait = runWaitMs(o.generationId);
      const t = createTask({
        principal,
        generationId: o.generationId,
        graph: {},
        finish: ticket,
        workflowId: `finish-${o.kind}`,
        made: o.kind === "model3d" ? "model3d" : "video",
        ...(o.step !== undefined && { extra: { step: o.step } }),
        pool: {
          pools: ["pool"],
          account: o.account,
          class: run?.class ?? "free",
          rankAt: run?.rankAt ?? now,
          lane: "small",
          needs: { workflowId: `finish-${o.kind}`, files: [], packs: [], minVramBytes: 0 },
          ...(wait !== undefined && { notAfter: now + wait }),
          slot: "cpu",
        },
      });
      return t.id;
    })
    .immediate();
}

/**
 * A finishing job's finished entry (its results by role): the files to collect, each within its kind's limit and the
 * room the account's files and the server's disk have. Call it as the task's account (onComputer).
 */
export function planFinish(t: Pick<TaskRow, "id" | "finish_json">, entries: HistoryEntryLike[]): FinishedPlan {
  const ticket = ticketOf(t);
  const e = entries[0];
  if (!ticket || !e) return { error: "This run couldn't finish." };
  if (e.status?.status_str === "error") return { error: "This run couldn't finish." };
  const out = (e.outputs?.finish ?? {}) as { results?: unknown; stats?: unknown; turntable?: unknown };
  const roles = FINISH_FILES[ticket.kind];
  const seen = new Set<string>();
  const results = (Array.isArray(out.results) ? out.results : []).flatMap((r) => {
    const x = (r ?? {}) as Record<string, unknown>;
    const role = typeof x.role === "string" ? x.role : "";
    if (!(role in roles) || seen.has(role) || typeof x.filename !== "string" || !/^[\w.-]{1,128}$/.test(x.filename) || x.type !== "output" || (x.subfolder ?? "") !== "") return [];
    seen.add(role);
    return [{ role, filename: x.filename }];
  });
  if (!results.length) return { error: "This run couldn't finish." };
  const account = tenantAccount();
  let budget = Math.max(0, diskFreeBytes() - diskFloorBytes());
  if (account) {
    if (!diskHasRoom()) return { error: "There's no room to keep this result right now." };
    budget = Math.min(budget, accountTotalBytes(account) - accountUsage(account).total);
  }
  if (budget <= 0) return { error: "There's no room to keep this result right now." };
  const wanted: WantedFile[] = results.map((r, n) => ({ n, filename: r.filename, subfolder: "", type: "output", kind: roles[r.role].kind, maxBytes: Math.max(1, Math.min(roles[r.role].maxBytes, budget)) }));
  const stats = Array.isArray(out.stats) && out.stats[0] && typeof out.stats[0] === "object" ? (out.stats[0] as Record<string, unknown>) : {};
  // Why no turntable came back, as the worker said it (it may name things of its PC): for the server's log only.
  const turntable = Array.isArray(out.turntable) && typeof out.turntable[0] === "string" ? out.turntable[0].slice(0, 200) : undefined;
  const kept: FinishStats = {
    ...(typeof stats.material === "string" && /^[a-z]{1,16}$/.test(stats.material) && { material: stats.material }),
    ...(Number.isFinite(stats.triangles) && { triangles: Math.max(0, Math.round(Number(stats.triangles))) }),
    ...(Number.isFinite(stats.bytesIn) && { bytesIn: Math.max(0, Math.round(Number(stats.bytesIn))) }),
    ...(Number.isFinite(stats.bytesOut) && { bytesOut: Math.max(0, Math.round(Number(stats.bytesOut))) }),
  };
  return { wanted, outputs: [{ files: results.map((r, n) => ({ role: r.role, n })), stats: kept, ...(turntable && { turntable }) }], budget };
}

/** What a finishing job came to: still going, its files by role (with what it measured), or why it ended without them. */
export type FinishOutcome =
  | { state: "waiting" }
  | { state: "done"; files: Record<string, { path: string; contentType?: string }>; stats: FinishStats; turntable?: string }
  | { state: "failed"; why: string };

export function finishOutcome(t: TaskRow): FinishOutcome {
  if (t.state === "failed" || t.state === "canceled") return { state: "failed", why: t.error ?? t.state };
  if (t.state !== "done") return { state: "waiting" };
  const r = resultOf<{ files?: { role: string; n: number }[]; stats?: FinishStats; turntable?: string }>(t)[0] ?? {};
  const files: Record<string, { path: string; contentType?: string }> = {};
  for (const f of r.files ?? []) {
    const got = receivedFile(t.principal, t.id, f.n);
    if (got) files[f.role] = got;
  }
  return { state: "done", files, stats: r.stats ?? {}, ...(r.turntable && { turntable: r.turntable }) };
}

// ---------------------------------------------------------------------------
// The 3D finish of an account's run on this install's GPUs

/** How often a finish waiting on a worker is looked at. */
const LOOK_MS = 2000;

declare global {
  var __fuobeWorkerFinish: Map<string, NodeJS.Timeout> | undefined;
}
const watching = () => (globalThis.__fuobeWorkerFinish ??= new Map());

/**
 * The 3D finish of an account's run on this install's GPUs, on a worker's CPU slot (in place of startModelFinish): the
 * raw GLB goes to the worker, and the web GLB, the turntable and its poster come back. The run stays running meanwhile;
 * `done` gets the outputs to store (the raw GLB is kept whatever happens). Once a run: a restart finds the same job.
 */
export function startWorkerModelFinish(generationId: string, outputs: OutputFile[], o: { op: string; provider: string; account: string; onMessage?: (m: string) => void; done: (outputs: OutputFile[]) => void }): void {
  if (watching().has(generationId)) return;
  const i = modelToFinish(o, outputs);
  if (i < 0) return o.done(outputs);
  const mesh = outputs[i];
  const asset = getAsset(mesh.assetId!);
  if (!asset) return o.done(outputs);
  const keep = (finish: Record<string, unknown>) => outputs.map((x, j) => (j === i ? { ...mesh, meta: { ...mesh.meta, finish: { version: MODEL_FINISH_VERSION, ...finish } } } : x));
  let task = finishTask(generationId, "model3d");
  if (!task || task.state === "canceled") {
    const problem = accountFinishProblem(o.account, asset.size);
    if (problem) return o.done(keep({ error: `web GLB: ${problem}` }));
    try {
      const id = queueFinish({
        kind: "model3d",
        generationId,
        account: o.account,
        inputs: [{ slot: "model", data: fs.readFileSync(absolutePath(asset.relPath)), contentType: "model/gltf-binary", name: "model.glb" }],
        // A job that came with an orbit clip of its splat keeps it as the turntable.
        settings: { material: "auto", turntable: !outputs.some((x) => x.kind === "video" && x.meta?.role === "orbit") },
      });
      task = db().prepare("SELECT * FROM relay_tasks WHERE id = ?").get(id) as TaskRow;
    } catch (e) {
      return o.done(keep({ error: `web GLB: ${(e as Error).message}` }));
    }
  }
  o.onMessage?.("Finishing the 3D model");
  const id = task.id;
  const look = () => {
    const t = db().prepare("SELECT * FROM relay_tasks WHERE id = ?").get(id) as TaskRow | undefined;
    const r: FinishOutcome = t ? finishOutcome(t) : { state: "failed", why: "gone" };
    if (r.state === "waiting") return;
    clearInterval(watching().get(generationId));
    watching().delete(generationId);
    if (r.state === "failed") return o.done(keep({ error: `web GLB: ${r.why === "tab:unsafe-model" ? "the model isn't a self-contained GLB, so it is kept as it is" : "the finish didn't come back, so the model is kept as it is"}` }));
    o.done(storeModelFinishOnce(id, () => storeModelFinish(generationId, outputs, i, r)));
  };
  const timer = setInterval(look, LOOK_MS);
  timer.unref?.();
  watching().set(generationId, timer);
  look();
}

/**
 * A run was canceled or deleted: its finishing jobs on the workers stop with it (the 3D finish and every camera path
 * step). One still in line ends at once, with its staged files; one a worker's CPU slot runs is taken off it (the slot
 * hears it in its next report or the worker's next beat). This server stops looking at it too.
 */
export function stopWorkerFinish(generationId: string): void {
  clearInterval(watching().get(generationId));
  watching().delete(generationId);
  const live = db()
    .prepare("SELECT id FROM relay_tasks WHERE generation_id = ? AND finish_json IS NOT NULL AND state IN ('waiting','sending','queued','running','collecting')")
    .all(generationId) as { id: string }[];
  for (const t of live) endTask(t.id, "canceled", { error: "Stopped" });
}

export { glbSelfContained };

/** glbSelfContained for a file, reading only its header and its JSON chunk (at most 64 MB of it). */
export function glbFileSelfContained(file: string): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const head = Buffer.alloc(20);
    if (fs.readSync(fd, head, 0, 20, 0) < 20) return false;
    const len = head.readUInt32LE(12);
    if (len > 64 * 2 ** 20) return false;
    const all = Buffer.alloc(20 + len);
    head.copy(all);
    if (fs.readSync(fd, all, 20, len, 20) < len) return false;
    return glbSelfContained(all);
  } catch {
    return false;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/**
 * The finished outputs of a run's 3D finish, stored once: the first look at the finished job (in this process or another,
 * as in a deploy's overlap) stores its files and notes the outputs on the job, in one locked step; every later look gets
 * those outputs, and nothing is stored twice.
 */
function storeModelFinishOnce(taskId: string, store: () => OutputFile[]): OutputFile[] {
  const storedOf = () => json<{ stored?: OutputFile[] }>((db().prepare("SELECT extra_json FROM relay_tasks WHERE id = ?").get(taskId) as Pick<TaskRow, "extra_json"> | undefined)?.extra_json ?? null, {}).stored;
  return db()
    .transaction((): OutputFile[] => {
      const had = storedOf();
      if (had) return had;
      const outputs = store();
      const row = db().prepare("SELECT extra_json FROM relay_tasks WHERE id = ?").get(taskId) as Pick<TaskRow, "extra_json"> | undefined;
      if (row) db().prepare("UPDATE relay_tasks SET extra_json = ? WHERE id = ?").run(JSON.stringify({ ...json<Record<string, unknown>>(row.extra_json, {}), stored: outputs }), taskId);
      return outputs;
    })
    .immediate();
}

/** The model output with the worker's finish on it: the web GLB, the turntable clip and its poster, stored as the run's. */
function storeModelFinish(generationId: string, outputs: OutputFile[], i: number, r: Extract<FinishOutcome, { state: "done" }>): OutputFile[] {
  const mesh = outputs[i];
  const saved: Asset[] = [];
  const save = (role: string, contentType: string, name: string, source: "derived" | "generation") => {
    const f = r.files[role];
    if (!f) return null;
    const data = fs.readFileSync(f.path);
    if (role === "web" && !glbSelfContained(data)) return null;
    const a = saveFile({ data, contentType, name, source, generationId });
    saved.push(a);
    return a;
  };
  try {
    const web = save("web", "model/gltf-binary", "model-web.glb", "derived");
    if (!web) return outputs.map((x, j) => (j === i ? { ...mesh, meta: { ...mesh.meta, finish: { version: MODEL_FINISH_VERSION, error: "web GLB: the finish didn't come back, so the model is kept as it is" } } } : x));
    const clip = save("turntable", "video/mp4", "turntable.mp4", "generation");
    const poster = clip ? save("poster", r.files.poster?.contentType ?? "image/webp", "poster.webp", "derived") : null;
    const ownOrbit = outputs.some((x) => x.kind === "video" && x.meta?.role === "orbit");
    // No turntable came back: the account's words, as its own finish here gives them (its browser records one). The
    // worker's reason, which may name things of its PC, goes to the server's log only.
    if (!clip && !ownOrbit && r.turntable) console.warn(`[fuobe] 3D finish for ${generationId}: no turntable came back (${r.turntable.replace(/[^\x20-\x7e]/g, "?")}).`);
    const turntable = ownOrbit ? OWN_ORBIT : clip ? "done" : ACCOUNT_TURNTABLE;
    const finish = { version: MODEL_FINISH_VERSION, ...(r.stats.material && { material: r.stats.material }), ...(r.stats.triangles !== undefined && { triangles: r.stats.triangles }), rawBytes: r.stats.bytesIn ?? getAsset(mesh.assetId!)?.size, webBytes: r.stats.bytesOut ?? web.size, webAsset: web.id, turntable };
    const next = outputs.map((x, j) => (j === i ? { ...mesh, meta: { ...mesh.meta, web: web.url, finish } } : x));
    if (!clip) return next;
    return withTurntable(next, mesh.assetId!, { state: "done", video: { url: clip.url, kind: "video", contentType: clip.contentType, assetId: clip.id, meta: { role: "turntable", fps: 24, frames: 96 } }, ...(poster && { poster: poster.url }) });
  } catch (e) {
    for (const a of saved) deleteAsset(a.id);
    console.warn(`[fuobe] 3D finish for ${generationId}: ${(e as Error).message}`);
    return outputs.map((x, j) => (j === i ? { ...mesh, meta: { ...mesh.meta, finish: { version: MODEL_FINISH_VERSION, error: "web GLB: the finish couldn't be kept, so the model is kept as it is" } } } : x));
  }
}

// ---------------------------------------------------------------------------
// The camera path of an account's run on this install's GPUs

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A path's keys for a finish ticket: normalized as the path render does, at most PATH_LIMITS.maxKeys, each in range. */
export function pathKeys(keys: FinishPathKey[]): FinishPathKey[] {
  return normalizeKeys(keys)
    .slice(0, PATH_LIMITS.maxKeys)
    .map((k) => ({ t: k.t, azimuth: clamp(k.azimuth, -3600, 3600), elevation: k.elevation, distance: k.distance, ...(k.truck !== undefined && Number.isFinite(k.truck) && { truck: clamp(k.truck, -20, 20) }) }));
}

/**
 * A camera path through a still and its depth picture, drawn on a worker's CPU slot for a step of an account's run on
 * this install's GPUs (in place of this server's renderPathVideo). Call it as the run (the step's files are read as its
 * account). The first call queues the job; later calls say where it is, and once it is done, the URL of the clip, kept
 * as the run's file. `step`: which of the step's inputs it is.
 */
export async function pathOnWorker(generationId: string, step: number, input: { photo: string; depth: string; keys: FinishPathKey[]; frames: number; fps: number }): Promise<{ state: "waiting" } | { state: "done"; url: string } | { state: "failed"; error: string }> {
  const account = tenantAccount();
  if (!account) return { state: "failed", error: "This run couldn't finish." };
  const t = finishTask(generationId, "path", step);
  if (!t || t.state === "canceled") {
    const read = await Promise.all([readRef(input.photo), readRef(input.depth)]);
    const pictures = await Promise.all(read.map(finishPicture)).catch(() => null);
    if (!pictures) return { state: "failed", error: "This run couldn't finish." };
    const [photo, depth] = pictures;
    const id = queueFinish({
      kind: "path",
      generationId,
      account,
      step,
      inputs: [
        { slot: "photo", data: photo.data, contentType: photo.contentType, name: photo.name || "photo.png" },
        { slot: "depth", data: depth.data, contentType: depth.contentType, name: depth.name || "depth.png" },
      ],
      // The keys as the path render reads them (in time order, from the photo's pose, inside their ranges).
      settings: { keys: pathKeys(input.keys), frames: input.frames, fps: input.fps },
    });
    return id ? { state: "waiting" } : { state: "failed", error: "This run couldn't finish." };
  }
  const r = finishOutcome(t);
  if (r.state === "waiting") return r;
  if (r.state === "failed") return { state: "failed", error: "This run couldn't finish." };
  const f = r.files.path;
  if (!f) return { state: "failed", error: "This run couldn't finish." };
  return { state: "done", url: keepPathClip(generationId, t.id, f.path) };
}

/**
 * A picture for a finishing job: as it is when queueFinish can blank what it carries besides its pixels; any other kind
 * of picture (a GIF, say) made again from its pixels here, upright, as a PNG. Throws when it isn't a picture.
 */
async function finishPicture<T extends { data: Buffer; contentType: string; name: string }>(f: T): Promise<T> {
  if (!f.contentType.startsWith("image/") || pictureWithoutMetadata(f.data)) return f;
  const sharp = (await import("sharp")).default;
  const png = await sharp(f.data, { failOn: "error", limitInputPixels: 64 * 2 ** 20 }).rotate().png().toBuffer();
  return { ...f, data: png, contentType: "image/png", name: "picture.png" };
}

/**
 * The path clip of a finished job, stored as the run's file once: a later sweep (or another app process at the same
 * time) finds the stored file by the task. The look and the write are one locked step, and the clip is noted only on a
 * task that had none; a copy stored by a second caller anyway is deleted.
 */
function keepPathClip(generationId: string, taskId: string, file: string): string {
  const keptOf = () => json<{ kept?: string }>((db().prepare("SELECT extra_json FROM relay_tasks WHERE id = ?").get(taskId) as Pick<TaskRow, "extra_json"> | undefined)?.extra_json ?? null, {}).kept;
  return db()
    .transaction((): string => {
      const kept = keptOf();
      if (kept) return kept;
      const clip = saveFile({ data: fs.readFileSync(file), contentType: "video/mp4", name: "path-render.mp4", source: "derived", generationId });
      const row = db().prepare("SELECT extra_json FROM relay_tasks WHERE id = ?").get(taskId) as Pick<TaskRow, "extra_json">;
      const extra = { ...json<Record<string, unknown>>(row.extra_json, {}), kept: clip.url };
      const r = db().prepare("UPDATE relay_tasks SET extra_json = ? WHERE id = ? AND json_extract(COALESCE(extra_json, '{}'), '$.kept') IS NULL").run(JSON.stringify(extra), taskId);
      const other = r.changes === 1 ? undefined : keptOf();
      if (!other) return clip.url;
      deleteAsset(clip.id);
      return other;
    })
    .immediate();
}
