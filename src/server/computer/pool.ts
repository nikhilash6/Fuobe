import "server-only";
import crypto from "node:crypto";
import { allLanes, laneLabel, lanesFor, MEDIA_KINDS, needsOf, type Inventory, type Needs } from "@/lib/lanes";
import { RELAY_TIMES, SENT_STATES, type BeatAnswer, type ClaimedTask, type ComputerFacts, type WorkerAnswer, type WorkerBeat } from "@/lib/relay";
import { clock, hoursAt, parseHours, type Hours } from "@/lib/worker-hours";
import { db } from "../db";
import { loadIndex } from "../gpu/index-file";
import { cleanFacts, dropProgress, endTask, json, logWorkerJob, noteProgress, setPoolClocks, setPoolGiveBack, setPoolLost, setTask, takeTask, taskById, type TaskRow } from "./tasks";
import { queueSettings, runCeilingMs } from "../queue-settings";
import { createWorker, offerNextToken, revokeWorker, rotateWorker, type WorkerRow } from "./workers";

/**
 * Workers (docs/gpu-workers.md): the owner's GPUs on other machines, each running `fuobe worker`, which pulls jobs from
 * this studio over HTTPS and runs them on its own ComfyUI. A task for workers belongs to the owner (or, later, an
 * account) and names the pools that may take it. This file is the queue's side: the beat, the claim (in one SQLite
 * transaction, so two workers never take the same task), putting a silent worker's task back in line, inventory and
 * lanes, and the owner's controls. Nothing here runs unless the owner adds a worker.
 */

/**
 * The oldest worker program that may take tasks: 2 says which inputs it takes, makes every clip and sound again, checks
 * every input against its rules, and keeps its ComfyUI behind the guard. An older one is told to update.
 */
export const MIN_PROTOCOL = 2;
/** A worker's own pause while a model folder of its isn't there yet: it keeps its last list of files. */
export const MODELS_NOT_READY = "models-not-ready";
/** A task avoids workers that lost or failed it, unless no other worker that can run it beat this recently. */
export const RETRY_WINDOW_MS = 10 * 60_000;
/** Attempts in all before a task fails. */
export const MAX_ATTEMPTS = 3;
/** A worker that beat this recently may claim. */
const FRESH_BEAT_MS = 30_000;
/** A job that makes no progress for this long goes back in line (a worker's own worker.json may set another). */
export const STALL_MS = 10 * 60_000;
/**
 * A lane's stall limit, which the claim gives the worker: STALL_MS, and never past the lane's run ceiling
 * (queue-settings.ts).
 */
export const stallLimitMs = (lane?: string | null) => Math.min(STALL_MS, runCeilingMs(lane));
/**
 * The run limit of one attempt: 3 × the lane's p90 on that worker plus its model load, at least 10 minutes, and never
 * past the lane's run ceiling (queue-settings.ts; 45 minutes unless the owner sets another). With no p90 yet (a new
 * worker, a new lane), the ceiling: a first long job finishes.
 */
export const runLimitMs = (p90?: number | null, lane?: string | null, loadMs?: number | null) => {
  const ceiling = runCeilingMs(lane);
  if (!p90 || p90 <= 0) return ceiling;
  return Math.min(ceiling, Math.max(10 * 60_000, 3 * p90 + Math.max(0, loadMs ?? 0)));
};
/**
 * A task's class as a number, in the order workers serve them: people's paid runs (0), then their free runs (1), then
 * the owner's own jobs (2). A task from before classes had none: the owner's (no account) is the owner's class.
 */
const CLASS_RANK = "(CASE WHEN class = 'paid' THEN 0 WHEN class = 'owner' OR (class IS NULL AND account IS NULL) THEN 2 ELSE 1 END)";
export const classRank = (t: Pick<TaskRow, "class" | "account">): number => (t.class === "paid" ? 0 : t.class === "owner" || (!t.class && !t.account) ? 2 : 1);
/**
 * The order workers serve waiting tasks in: by class, then by rank (a requeued task keeps its own, so it keeps its
 * place), then by when it was made. The claim and the place in line read the same order. With fair share on
 * (queue-settings.ts), each class goes round its accounts in turn (lineOrder).
 */
const LINE_ORDER = `${CLASS_RANK}, rank_at, created_at, id`;
/** The columns the line's counts read (never a task's graph or files). */
const LINE_COLS = "id, principal, pools, only_worker, stop, lane, needs_json, created_at, rank_at, est_ms, tried_json, worker_id, claimed_at, account, class";
/**
 * A task a worker took that is still sending its files to its ComfyUI this long after the claim (or after its ComfyUI lost
 * it and it began sending them again on the same claim) goes back in line.
 */
export const SENDING_MS = 15 * 60_000;
/** The time a worker has to send a finished job's results up. */
export const SAVING_MS = 15 * 60_000;
/**
 * The longest one attempt of a worker's task may last, from its claim: SENDING_MS to send its files, its lane's run
 * ceiling twice (a worker sends a job once more after its ComfyUI ran out of memory, with its run limit counted again)
 * and SAVING_MS to send its results. The worker's own run limit and stall rule, and the sending clock, end an attempt
 * well before; this is only the run's backstop (generations.ts).
 */
export const attemptLimitMs = (lane?: string | null) => SENDING_MS + 2 * runCeilingMs(lane) + SAVING_MS;
/** When the attempt a worker holds now must have ended (none while the task waits in line). */
export function attemptDeadline(t: Pick<TaskRow, "state" | "claimed_at" | "lane">): { at: number; ms: number } | undefined {
  if (t.state === "waiting" || !t.claimed_at) return undefined;
  const ms = attemptLimitMs(t.lane);
  return { at: t.claimed_at + ms, ms };
}

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

const MAX_RUNNING = 32;

// ---------------------------------------------------------------------------
// What a worker is now

interface Allow {
  delayMs: number;
}

const allowOf = (w: WorkerRow) => json<Record<string, Allow>>(w.allow_json, {});
const capableOf = (w: WorkerRow) => json<{ lanes: string[]; workflows: string[] }>(w.lanes_json, { lanes: [], workflows: [] });
const factsOf = (w: WorkerRow) => json<ComputerFacts>(w.facts_json, {});
const hoursOf = (w: WorkerRow): Hours | null => parseHours(json<unknown>(w.hours_json, null));
const benchOf = (w: WorkerRow) => json<Record<string, { medianMs?: number; p90Ms?: number; loadMs?: number; peakVramBytes?: number }>>(w.bench_json, {});

export type WorkerState = "new" | "idle" | "busy" | "draining" | "paused" | "outside-hours" | "gpu-busy" | "comfy-down" | "models-not-ready" | "waiting-for-yield" | "offline";

/** The state in one word, and in words for the owner ("Paused here until 16:30", "Your GPU is busy (blender.exe)"). */
export function workerState(w: WorkerRow, now = Date.now()): { state: WorkerState; words: string } {
  const tz = hoursOf(w) && "tz" in hoursOf(w)! ? (hoursOf(w) as { tz: string }).tz : undefined;
  if (!w.seen_at) return { state: "new", words: "Not connected yet" };
  if (now - w.seen_at > RELAY_TIMES.poolSilentMs) return { state: "offline", words: "Offline" };
  if ((w.protocol ?? 0) < MIN_PROTOCOL) return { state: "paused", words: "Takes no jobs until its worker program is updated" };
  const why = w.local_why ?? "";
  if (w.paused_local) {
    if (why.startsWith("gpu-busy")) return { state: "gpu-busy", words: `Your GPU is busy${why.includes(":") ? ` (${why.split(":").slice(1).join(":")})` : ""}` };
    if (why === "comfy-crashes") return { state: "comfy-down", words: "ComfyUI keeps stopping" };
    if (why === "port-busy") return { state: "comfy-down", words: "Its ComfyUI port is taken by another program" };
    // A model folder isn't there yet (a drive still locked after a restart): it waits for it, with its lanes as they were.
    if (why === MODELS_NOT_READY) return { state: "models-not-ready", words: "Waiting for its model folders" };
    return { state: "paused", words: w.local_until ? `Paused here until ${clock(w.local_until, tz)}` : "Paused here" };
  }
  if (w.paused_server) return { state: "paused", words: "Paused on the website" };
  const h = hoursAt(hoursOf(w), now);
  if (!h.inside) return { state: "outside-hours", words: h.nextChangeAt ? `Outside its hours (back at ${clock(h.nextChangeAt, tz)})` : "No hours set" };
  const busy = (db().prepare(`SELECT COUNT(*) AS n FROM relay_tasks WHERE worker_id = ? AND state IN ('sending','queued','running','collecting')`).get(w.id) as { n: number }).n > 0;
  if (w.drain) return busy ? { state: "draining", words: "Finishing its job, then pausing" } : { state: "paused", words: "Paused after its last job" };
  if (busy) return { state: "busy", words: "Running a job" };
  // Studio jobs first: local ComfyUI work on its machine holds the GPU, and the worker waits for it to make room. Not a
  // pause: its jobs keep their place. `local_until` is the estimate of the start, when there is one.
  if (why.startsWith("waiting-for-yield")) {
    if (why.endsWith(":no-answer")) return { state: "waiting-for-yield", words: "Waiting for local ComfyUI work to make room (no answer after 3 minutes)" };
    return { state: "waiting-for-yield", words: `Waiting for local ComfyUI work to make room${w.local_until ? ` (starts about ${clock(w.local_until, tz)})` : ""}` };
  }
  return { state: "idle", words: "Ready" };
}

/** May this worker take a new task now (4.3: paused in neither place, not draining, inside its hours, new enough, heard from)? */
export function eligible(w: WorkerRow, now = Date.now()): boolean {
  return (
    w.kind === "pool" &&
    !w.revoked_at &&
    !(w.expires_at && w.expires_at <= now) &&
    !w.paused_server &&
    !w.paused_local &&
    !w.drain &&
    (w.protocol ?? 0) >= MIN_PROTOCOL &&
    !!w.seen_at &&
    now - w.seen_at <= FRESH_BEAT_MS &&
    hoursAt(hoursOf(w), now).inside
  );
}

// ---------------------------------------------------------------------------
// The beat

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown, max: number) => (typeof v === "string" && v ? v.slice(0, max) : null);

/** A worker's beat as it may be kept: known fields, capped. */
export function cleanBeat(b: unknown): WorkerBeat {
  const o = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
  const local = (o.local && typeof o.local === "object" ? o.local : {}) as Record<string, unknown>;
  const gpu = (o.gpu && typeof o.gpu === "object" ? o.gpu : {}) as Record<string, unknown>;
  const apps = Array.isArray(gpu.otherApps) ? gpu.otherApps.slice(0, 16) : [];
  return {
    device: String(o.device ?? ""),
    protocol: num(o.protocol) ?? 0,
    version: text(o.version, 40) ?? "",
    ...(o.canRotateToken === true && { canRotateToken: true }),
    ready: o.ready !== false,
    why: text(o.why, 64),
    local: { paused: local.paused !== false, why: text(local.why, 96), until: num(local.until) },
    gpu: {
      otherApps: apps.map((a) => ({ pid: num((a as Record<string, unknown>)?.pid) ?? 0, name: text((a as Record<string, unknown>)?.name, 64) ?? "?", vramBytes: num((a as Record<string, unknown>)?.vramBytes) ?? 0 })),
      tempC: num(gpu.tempC),
    },
    ...(o.facts !== undefined && { facts: cleanFacts(o.facts) }),
    inventoryHash: text(o.inventoryHash, 80),
    warmLane: text(o.warmLane, 16),
    running: Array.isArray(o.running) ? (o.running.slice(0, MAX_RUNNING) as WorkerBeat["running"]) : [],
    stopped: Array.isArray(o.stopped) ? o.stopped.filter((x): x is string => typeof x === "string").slice(0, 64) : [],
    held: Array.isArray(o.held) ? o.held.filter((x): x is string => typeof x === "string").slice(0, 16) : [],
    ...((num(o.slept) ?? 0) > 0 && { slept: Math.min(num(o.slept)!, MAX_SLEPT_MS) }),
  };
}

/**
 * A worker says it is here: its own pause and why, its GPU, its facts, what it runs. The answer: whether it is paused on
 * the website, a stop-now, drain, its hours, the lanes it is allowed, and the prompts to take off its ComfyUI.
 */
export function workerBeat(w: WorkerRow, b: WorkerBeat, now = Date.now()): BeatAnswer & { worker: WorkerAnswer } {
  const d = db();
  const device = `wkr-${w.id}`;
  // With the write lock from the start (IMMEDIATE): what it reads of the line is still so when it writes, even while
  // another app process on the same database (a deploy's overlap) writes too.
  return d.transaction(() => {
    // A worker back after going silent finds its task back in line first (its lease no longer works).
    sweepPool(now);
    const facts = b.facts ? { ...b.facts, loras: undefined } : undefined;
    d.prepare(
      `UPDATE relay_workers SET seen_at = ?, device = ?, protocol = ?, version = ?, paused_local = ?, local_why = ?, local_until = ?,
         warm_lane = ?, facts_json = COALESCE(?, facts_json) WHERE id = ?`,
    ).run(now, device, b.protocol, b.version, b.local.paused ? 1 : 0, b.local.why, b.local.until, b.warmLane, facts ? JSON.stringify(facts) : null, w.id);
    // Its PC slept: a job taken back from it for going quiet meanwhile counts against no one.
    if (b.slept) forgiveSleep(w, b.slept, now);
    for (const r of b.running) {
      const t = typeof r?.task === "string" ? (d.prepare("SELECT * FROM relay_tasks WHERE id = ? AND worker_id = ?").get(r.task, w.id) as TaskRow | undefined) : undefined;
      if (!t || !(SENT_STATES as readonly string[]).includes(t.state)) continue;
      setTask(t.id, { device_seen_at: now });
      noteProgress(t.id, r as unknown as Record<string, unknown>, now);
    }
    for (const id of b.stopped) d.prepare("UPDATE relay_tasks SET stop = 0 WHERE id = ? AND device = ?").run(id, device);
    const stops = (d.prepare("SELECT id, prompt_id, prefix FROM relay_tasks WHERE device = ? AND stop = 1").all(device) as { id: string; prompt_id: string; prefix: string | null }[]).map((s) => ({
      task: s.id,
      promptId: s.prompt_id,
      ...(s.prefix && { prefix: s.prefix }),
    }));
    const fresh = d.prepare("SELECT * FROM relay_workers WHERE id = ?").get(w.id) as WorkerRow;
    // Stop now (the website, or the worker paused itself with --now / a busy GPU): its jobs go back in line at no cost,
    // and the worker takes their prompts off its ComfyUI.
    const stopNow = !!fresh.stop_now || (b.local.paused && !!b.local.why && (b.local.why === "here-now" || b.local.why.startsWith("gpu-busy")));
    if (stopNow) {
      const held = new Set(b.held ?? []);
      for (const t of d.prepare("SELECT * FROM relay_tasks WHERE worker_id = ? AND state IN ('sending','queued','running','collecting')").all(w.id) as TaskRow[]) {
        // Its result is being saved, or the worker keeps the finished results on its disk (the studio may not have heard
        // that it finished): let it send them, which needs no GPU, instead of running the job again.
        if (t.state === "collecting" || held.has(t.id)) continue;
        backInLine(t, { blame: false });
        stops.push({ task: t.id, promptId: t.prompt_id, ...(t.prefix && { prefix: t.prefix }) });
      }
      d.prepare("UPDATE relay_workers SET stop_now = 0 WHERE id = ?").run(w.id);
    }
    const state = workerState(fresh, now);
    d.prepare("UPDATE relay_workers SET state = ? WHERE id = ?").run(state.state, w.id);
    // A worker that says it saves a new token (`canRotateToken` in its beat) gets its next one when half its token's life
    // is gone. (Not by its protocol number: a worker may speak a newer protocol without saving tokens.)
    const nextToken = b.canRotateToken ? offerNextToken(fresh, now) : null;
    const h = hoursAt(hoursOf(fresh), now);
    // Pool names are validated at creation (/^[a-z0-9-]{1,32}$/), so they never contain commas. INSTR on the
    // CSV avoids the LIKE-wildcard class of risk (%, _) entirely.
    const waiting = (d.prepare("SELECT COUNT(*) AS n FROM relay_tasks WHERE pools IS NOT NULL AND state = 'waiting' AND INSTR(',' || pools || ',', ?) > 0").get(`,${fresh.pool},`) as { n: number }).n;
    return {
      runner: eligible(fresh, now),
      heldElsewhere: false,
      waiting,
      claimableNow: claimableNow(fresh, now),
      stops,
      worker: {
        paused: !!fresh.paused_server,
        pauseNow: stopNow,
        drain: !!fresh.drain,
        autoResume: fresh.auto_resume === null || fresh.auto_resume === undefined ? null : !!fresh.auto_resume,
        insideHours: h.inside,
        nextChangeAt: h.nextChangeAt,
        lanes: Object.keys(allowOf(fresh)),
        minProtocol: MIN_PROTOCOL,
        // While a model folder isn't there, the studio keeps the list it has (its lanes don't go missing meanwhile).
        sendInventory: b.local.why !== MODELS_NOT_READY && (!fresh.inventory_hash || fresh.inventory_hash !== b.inventoryHash),
        ...(nextToken && { token: nextToken }),
        ...(fresh.expires_at && { tokenExpiresAt: fresh.expires_at }),
      },
    };
  }).immediate();
}

/**
 * People's tasks (an account's, never the owner's own) this worker may claim right now: in its pool, in a lane it is
 * allowed and able to run, with the files and VRAM they need, past their delays, and ending before its hours do. Its
 * own pause doesn't count here (its machine reads this to know whether a person's run waits for it); a pause on the
 * website, a drain, an older worker program or being outside its hours does.
 */
export function claimableNow(w: WorkerRow, now = Date.now()): number {
  if (w.kind !== "pool" || w.revoked_at || w.paused_server || w.drain || (w.protocol ?? 0) < MIN_PROTOCOL || !hoursAt(hoursOf(w), now).inside) return 0;
  const rows = db()
    .prepare(`SELECT ${LINE_COLS} FROM relay_tasks WHERE pools IS NOT NULL AND state = 'waiting' AND stop = 0 AND account IS NOT NULL AND INSTR(',' || pools || ',', ?) > 0 ORDER BY ${LINE_ORDER} LIMIT ?`)
    .all(`,${w.pool},`, LOOK_AT) as TaskRow[];
  return rows.filter((t) => fits(t, w, now) && retryOk(t, w, now) && beforeWindowEnds(t, w, now)).length;
}

// ---------------------------------------------------------------------------
// Inventory

/**
 * A model file's name as a worker reports it: the requirements index's own name for it inside its folder, which may hold
 * subfolders ("bigvgan_vocoder/config.json"), with forward slashes. Never a path that climbs out ("..") or starts at a
 * root or a drive, never a backslash, an empty part or a control character.
 */
const fileNameOk = (name: string) => name.length <= 256 && !/[\\\0-\x1f]|^\/|^[a-z]:|(^|\/)\.{1,2}(\/|$)|\/\/|\/$/i.test(name);

/** The index's files, as "folder/name" (loadIndex keeps one index until its file changes). */
const indexFileKeys = new WeakMap<ReturnType<typeof loadIndex>, Set<string>>();
function knownFiles(): Set<string> {
  const index = loadIndex();
  let keys = indexFileKeys.get(index);
  if (!keys) {
    keys = new Set(Object.values(index.files).map((f) => `${f.folder}/${f.file}`));
    indexFileKeys.set(index, keys);
  }
  return keys;
}

/**
 * The worker's verified files and node packs: what it can run now, and what each other lane lacks. Only the files the
 * requirements index names are kept (by folder and name, subfolders and all), but the hash is of the list as the worker
 * sent it, so it equals the hash the worker computes and the studio asks for the list again only when it changed.
 */
export function saveInventory(w: WorkerRow, raw: unknown): { lanes: string[]; workflows: string[]; missing: { lane: string; label: string; files: string[]; bytes: number }[] } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sent = (Array.isArray(o.files) ? o.files : []).slice(0, 20_000).flatMap((f) => {
    const x = f as Record<string, unknown>;
    const folder = text(x?.folder, 64);
    const name = typeof x?.name === "string" && x.name ? x.name : null;
    const size = num(x?.size);
    const sha256 = typeof x?.sha256 === "string" && /^[0-9a-f]{64}$/.test(x.sha256) ? x.sha256 : null;
    return folder && name && size !== null ? [{ folder, name, size, sha256 }] : [];
  });
  const known = knownFiles();
  const files = sent.filter((f) => !/[\\/]|\.\./.test(f.folder) && fileNameOk(f.name) && known.has(`${f.folder}/${f.name}`));
  const nodePacks = (Array.isArray(o.nodePacks) ? o.nodePacks : []).slice(0, 500).flatMap((p) => {
    const x = p as Record<string, unknown>;
    const name = text(x?.name, 128);
    return name ? [{ name, commit: text(x?.commit, 64) }] : [];
  });
  // The kinds of input it takes. None said: an older worker, which doesn't make clips and sound again, so lanesFor gives
  // it pictures only (the list is kept as sent, so its hash stays the one the worker computes).
  const media = Array.isArray(o.media) ? MEDIA_KINDS.filter((k) => (o.media as unknown[]).includes(k)) : undefined;
  const inv: Inventory = { files, nodePacks, ...(media && { media }) };
  const r = lanesFor(loadIndex(), inv, sha);
  const invHash = inventoryHash({ ...inv, files: sent });
  db()
    .prepare("UPDATE relay_workers SET inventory_json = ?, inventory_hash = ?, lanes_json = ? WHERE id = ?")
    .run(JSON.stringify(inv), invHash, JSON.stringify({ lanes: r.lanes, workflows: r.workflows }), w.id);
  return r;
}

/** The hash a worker sends with each beat, so the studio asks for the whole list only when it changed. */
export function inventoryHash(inv: Inventory): string {
  const files = [...inv.files].map((f) => `${f.folder}/${f.name}:${f.size}:${f.sha256 ?? ""}`).sort();
  const packs = [...inv.nodePacks].map((p) => `${p.name}@${p.commit ?? ""}`).sort();
  return sha(JSON.stringify({ files, packs, ...(inv.media && { media: [...inv.media].sort() }) }));
}

// ---------------------------------------------------------------------------
// The claim (4.3)

/** Tasks for workers that wait, best first, at most this many looked at per claim. */
const LOOK_AT = 200;

/**
 * A worker asks for work, inside one transaction: first a task it had and lost track of; then, if it holds none and may
 * take work, the best waiting task it can run (its pool, its allowed lanes and their delays, the files and VRAM it
 * needs, the retry rule, and the end of its hours). One task at a time: a worker that holds a task gets nothing new
 * until that one ends or goes back in line, so one worker's token never holds more than one person's job. Sticky
 * lanes: its warm lane goes first until another lane's best task has waited longer than switch_after_ms (and is older).
 */
export function workerClaim(w: WorkerRow, running: string[], now = Date.now()): ClaimedTask | null {
  const d = db();
  const device = `wkr-${w.id}`;
  return d.transaction((): ClaimedTask | null => {
    sweepPool(now);
    const fresh = d.prepare("SELECT * FROM relay_workers WHERE id = ?").get(w.id) as WorkerRow;
    const held = d.prepare(`SELECT * FROM relay_tasks WHERE worker_id = ? AND device = ? AND state IN ('sending','queued','running','collecting') AND stop = 0 ORDER BY ${LINE_ORDER}`).all(fresh.id, device) as TaskRow[];
    const mine = held.find((t) => !running.includes(t.id));
    if (mine) return claimed(mine, fresh, device, now);
    if (held.length || !eligible(fresh, now)) return null;
    const t = pick(fresh, now);
    return t ? claimed(t, fresh, device, now) : null;
  }).immediate();
}

function claimed(t: TaskRow, w: WorkerRow, device: string, now: number): ClaimedTask {
  const needs = json<Needs | null>(t.needs_json, null);
  const bench = t.lane ? benchOf(w)[t.lane] : undefined;
  if (t.state === "waiting") logWorkerJob("claimed", t, w.id, now);
  // A worker that lost track of its own task gets it again with its first claim's time, so the sending clock (SENDING_MS)
  // is never wound back by asking again.
  const c = takeTask(t, device, now, { worker_id: w.id, ...(t.state !== "waiting" && t.device === device && t.claimed_at && { claimed_at: t.claimed_at }) });
  return {
    ...c,
    lane: t.lane ?? undefined,
    estMs: estOn(t, w),
    // A job given back once for running past its limit gets the whole run ceiling on its next try (a lane's times may
    // come from shorter jobs than this one); past that, it fails.
    runLimitMs: runLimitedOf(t) ? runCeilingMs(t.lane) : runLimitMs(bench?.p90Ms, t.lane, bench?.loadMs),
    stallMs: stallLimitMs(t.lane),
    notAfter: t.not_after,
    attempt: t.requeues + 1,
    models: needs?.files ?? [],
  };
}

/** How long a task should take on this worker: the lane's bench median there, or the task's own estimate. */
function estOn(t: TaskRow, w: WorkerRow): number | null {
  return (t.lane && benchOf(w)[t.lane]?.medianMs) || t.est_ms || null;
}

/** May this worker run this task: its pool, its lane allowed and capable, its files, its VRAM, and the delays. */
function fits(t: TaskRow, w: WorkerRow, now: number): boolean {
  if (!(t.pools ?? "").split(",").includes(w.pool)) return false;
  if (t.only_worker && t.only_worker !== w.id) return false;
  if (t.stop) return false;
  const allow = allowOf(w);
  const lane = t.lane ?? "";
  if (!(lane in allow)) return false;
  const cap = capableOf(w);
  const needs = json<Needs | null>(t.needs_json, null);
  if (needs?.workflowId ? !cap.workflows.includes(needs.workflowId) : !cap.lanes.includes(lane)) return false;
  const vram = factsOf(w).vramBytes ?? 0;
  if ((needs?.minVramBytes ?? 0) > vram) return false;
  if (now - t.created_at < w.claim_after_ms + (allow[lane]?.delayMs ?? 0)) return false;
  return true;
}

/** The retry rule: a worker that lost or failed this task takes it again only when no other capable worker is about. */
function retryOk(t: TaskRow, w: WorkerRow, now: number): boolean {
  const tried = json<string[]>(t.tried_json, []);
  if (!tried.includes(w.id)) return true;
  const others = db().prepare("SELECT * FROM relay_workers WHERE kind = 'pool' AND revoked_at IS NULL AND id != ? AND seen_at > ?").all(w.id, now - RETRY_WINDOW_MS) as WorkerRow[];
  return !others.some((o) => !tried.includes(o.id) && fits(t, o, now + RETRY_WINDOW_MS));
}

/** Near the end of its hours, only a task that ends before they do. */
function beforeWindowEnds(t: TaskRow, w: WorkerRow, now: number): boolean {
  const h = hoursAt(hoursOf(w), now);
  if (h.endsAt === null) return true;
  return now + (estOn(t, w) ?? 0) <= h.endsAt;
}

/**
 * The best task this worker may run, in the line's order (lineOrder). A task in the lane it has loaded may go ahead of
 * the best one, in the same class, while the best one has waited less than the pick allowance (the install's setting,
 * capped by this worker's switch_after_ms; 0: strict order).
 */
function pick(w: WorkerRow, now: number): TaskRow | null {
  const settings = queueSettings(now);
  const rows = db()
    .prepare(`SELECT * FROM relay_tasks WHERE pools IS NOT NULL AND state = 'waiting' AND stop = 0 AND INSTR(',' || pools || ',', ?) > 0 ORDER BY ${LINE_ORDER} LIMIT ?`)
    .all(`,${w.pool},`, LOOK_AT) as TaskRow[];
  const ok = lineOrder(rows, settings.fairShare).filter((t) => fits(t, w, now) && retryOk(t, w, now) && beforeWindowEnds(t, w, now));
  if (!ok.length) return null;
  const best = ok[0];
  const allowance = Math.min(w.switch_after_ms, settings.pickAllowanceMs);
  if (allowance <= 0 || !w.warm_lane || best.lane === w.warm_lane) return best;
  const warm = ok.find((t) => t.lane === w.warm_lane && classRank(t) === classRank(best));
  return warm && (best.rank_at ?? best.created_at) >= now - allowance ? warm : best;
}

/**
 * Turns already taken in each class, by whose turn: runs a worker holds now, and runs a worker took and finished since
 * the oldest of `waiting` in that class came.
 */
function servedTurns(waiting: TaskRow[]): Map<string, number> {
  const since = new Map<number, number>();
  for (const r of waiting) since.set(classRank(r), Math.min(since.get(classRank(r)) ?? Infinity, r.created_at));
  const out = new Map<string, number>();
  for (const [cls, at] of since) {
    const rows = db()
      .prepare(
        `SELECT COALESCE(account, principal) AS k, COUNT(*) AS n FROM relay_tasks WHERE pools IS NOT NULL AND ${CLASS_RANK} = ?
           AND (state IN ('sending','queued','running','collecting') OR (state IN ('done','failed') AND claimed_at IS NOT NULL AND finished_at >= ?))
         GROUP BY k`,
      )
      .all(cls, at) as { k: string; n: number }[];
    for (const r of rows) out.set(`${cls}:${r.k}`, r.n);
  }
  return out;
}

/** Whose turn a task takes with fair share: its account's, or the owner's. */
const turnKey = (t: Pick<TaskRow, "account" | "principal" | "class">) => `${classRank(t as Pick<TaskRow, "class" | "account">)}:${t.account ?? t.principal}`;

/** The strict order (LINE_ORDER) of two tasks, in code. */
const strictOrder = (a: TaskRow, b: TaskRow) =>
  classRank(a) - classRank(b) || (a.rank_at ?? a.created_at) - (b.rank_at ?? b.created_at) || a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Waiting tasks (given in strict order) in the order workers serve them. Fair share off: as given. On: within a class,
 * each account's (or the owner's) next run goes after every other account's run that is an earlier turn of its own. An
 * account's turns count the runs a worker holds for it now and those a worker finished for it since the oldest run
 * still waiting in its class came, so one account with many runs never holds the line.
 */
export function lineOrder(rows: TaskRow[], fairShare: boolean): TaskRow[] {
  if (!fairShare || rows.length < 2) return rows;
  const held = servedTurns(rows);
  const seen = new Map<string, number>();
  const turns = new Map<string, number>();
  for (const r of [...rows].sort(strictOrder)) {
    const k = turnKey(r);
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    turns.set(r.id, (held.get(k) ?? 0) + n);
  }
  return [...rows].sort((a, b) => classRank(a) - classRank(b) || turns.get(a.id)! - turns.get(b.id)! || strictOrder(a, b));
}

// ---------------------------------------------------------------------------
// Back in line, and the clocks

/**
 * A task goes back in line: its worker let it go (`blame: false`: a pause, at no cost to anyone) or lost it (silent,
 * its ComfyUI down: the worker is noted in tried_json and it counts as an attempt). The third lost attempt fails it.
 * The old worker's lease stops working, so its late calls get 409.
 *
 * Only the task as `t` read it: one that has moved on since (another app process put it back in line, or a worker took
 * it again with a new lease) stays as it is now, and no attempt is counted. Returns whether it changed.
 */
export function backInLine(t: TaskRow, o: { blame: boolean; why?: string; last?: boolean; lostAt?: number }): boolean {
  const d = db();
  return d.transaction((): boolean => {
    const now = taskById(t.id);
    if (!now || now.state !== t.state || now.worker_id !== t.worker_id || now.lease_hash !== t.lease_hash || now.requeues !== t.requeues) return false;
    const tried = json<string[]>(t.tried_json, []);
    const requeues = t.requeues + (o.blame ? 1 : 0);
    if (o.blame && (requeues >= MAX_ATTEMPTS || o.last)) {
      endTask(t.id, "failed", { error: o.why ?? "The GPUs couldn't finish this run. Press Retry.", requeues, tried_json: JSON.stringify([...new Set([...tried, t.worker_id ?? ""])].filter(Boolean)) }, true);
      return true;
    }
    if (t.worker_id) logWorkerJob("requeued", t, t.worker_id);
    // A live worker that let it go hears the stop in its beat answer; one that went silent finds its lease gone when it
    // comes back (409), and takes the prompt off its own ComfyUI. It keeps its rank, so it keeps its place in line, and
    // its wait limit no longer applies (a worker took it once).
    setTask(t.id, {
      state: "waiting",
      lease_hash: null,
      worker_id: null,
      requeues,
      sent_at: null,
      sending_since: null,
      started_at: null,
      down_at: null,
      down_why: null,
      note: "resent",
      ...(o.blame && t.worker_id && { tried_json: JSON.stringify([...new Set([...tried, t.worker_id])]) }),
      // Lost because its worker went quiet: noted, so a sleep the worker reports later takes the blame back (forgiveSleep).
      ...(o.lostAt && t.worker_id && { extra_json: JSON.stringify({ ...json<Record<string, unknown>>(t.extra_json, {}), lost: { worker: t.worker_id, at: o.lostAt } }) }),
    });
    d.prepare("UPDATE relay_inputs SET reads = 0 WHERE task_id = ?").run(t.id);
    // In line again: nothing of the attempt before shows (no step, no preview).
    dropProgress(t.id);
    return true;
  }).immediate();
}

/**
 * The workers' clocks: a task whose worker went silent for 2 minutes (or was revoked), whose ComfyUI was down for 2
 * minutes, or that is still sending its files 15 minutes after the claim (or after it began sending them again) goes
 * back in line; a task no worker has taken yet that is still waiting past its wait limit fails, not charged. (Once a
 * worker took it, the wait limit is over: a task back in line waits in its place until a worker runs it, or its attempts
 * run out.)
 */
export function sweepPool(now = Date.now()): void {
  const d = db();
  // One step with the write lock (IMMEDIATE), on every path (the runner's look at a run too): what it reads is still so
  // when it writes, even while another app process on the same database claims or requeues.
  d.transaction(() => sweepLine(d, now)).immediate();
}

function sweepLine(d: ReturnType<typeof db>, now: number): void {
  const held = d
    .prepare(
      `SELECT t.*, w.seen_at AS w_seen, w.revoked_at AS w_revoked FROM relay_tasks t LEFT JOIN relay_workers w ON w.id = t.worker_id
       WHERE t.pools IS NOT NULL AND t.state IN ('sending','queued','running','collecting')`,
    )
    .all() as (TaskRow & { w_seen: number | null; w_revoked: number | null })[];
  for (const t of held) {
    const silent = !t.w_seen || now - t.w_seen > RELAY_TIMES.poolSilentMs || !!t.w_revoked;
    const down = !!t.down_at && now - t.down_at > RELAY_TIMES.poolComfyDownMs;
    // Sending since its claim, or since its ComfyUI lost it and it began sending again on the same claim.
    const sendingSince = t.sending_since ?? t.claimed_at;
    const stuck = t.state === "sending" && !!sendingSince && now - sendingSince > SENDING_MS;
    if (silent || down || stuck) {
      backInLine(t, { blame: true, why: silent ? "The GPU running this stopped answering, three times. Press Retry." : down ? "ComfyUI kept stopping on the GPUs. Press Retry." : "The GPUs couldn't start this run. Press Retry.", ...(silent && !t.w_revoked && { lostAt: now }) });
    }
  }
  const late = d.prepare("SELECT id FROM relay_tasks WHERE pools IS NOT NULL AND state = 'waiting' AND claimed_at IS NULL AND not_after IS NOT NULL AND not_after < ?").all(now) as { id: string }[];
  for (const t of late) endTask(t.id, "failed", { error: "The GPUs were busy. Not charged." });
}

/** The longest sleep a worker's beat may report (a week). */
const MAX_SLEPT_MS = 7 * 24 * 60 * 60_000;
/** A job lost this long before the reported sleep began still counts as lost to it (beats come every few seconds). */
const SLEEP_SLACK_MS = 2 * 60_000;

/**
 * A worker's PC slept for `sleptMs` until about now: each job the studio took back from it for going quiet during that
 * sleep goes on with no blame. The attempt it counted is taken back, and the worker is off the job's tried list, so it
 * may take the job again at once. Once a job at most: a worker can't keep a job going forever by saying it slept.
 */
export function forgiveSleep(w: Pick<WorkerRow, "id">, sleptMs: number, now = Date.now()): string[] {
  const since = now - Math.min(sleptMs, MAX_SLEPT_MS) - SLEEP_SLACK_MS;
  const rows = db().prepare("SELECT * FROM relay_tasks WHERE pools IS NOT NULL AND state IN ('waiting','sending','queued','running','collecting') AND INSTR(extra_json, '\"lost\"') > 0").all() as TaskRow[];
  const forgiven: string[] = [];
  for (const t of rows) {
    const { lost, ...extra } = json<{ lost?: { worker?: string; at?: number }; sleptOnce?: boolean } & Record<string, unknown>>(t.extra_json, {});
    if (lost?.worker !== w.id || typeof lost.at !== "number" || lost.at < since || lost.at > now) continue;
    if (extra.sleptOnce || t.requeues <= 0) {
      setTask(t.id, { extra_json: JSON.stringify(extra) });
      continue;
    }
    const tried = json<string[]>(t.tried_json, []).filter((x) => x !== w.id);
    setTask(t.id, { requeues: t.requeues - 1, tried_json: tried.length ? JSON.stringify(tried) : null, extra_json: JSON.stringify({ ...extra, sleptOnce: true }) });
    forgiven.push(t.id);
  }
  return forgiven;
}

setPoolClocks((t, now) => {
  sweepPool(now);
  return taskById(t.id) ?? t;
});

/** The words of a run that a worker gave back for the last time. */
export const GAVE_BACK_WORDS = "This run couldn't finish.";

/** A task a worker gave back for running past its run limit (its next try gets the whole run ceiling). */
const runLimitedOf = (t: TaskRow) => json<{ runLimited?: boolean }>(t.extra_json, {}).runLimited === true;

/**
 * A worker gives its task back (it stalled, ran past its run limit, or takes clips or sound the worker can't make
 * again): it goes back in line with its place kept, and counts as an attempt, so another worker that can run it is
 * preferred and the third time fails it. Past its run limit a second time (that try had the whole run ceiling), it
 * fails at once: one more try would only hold a GPU as long again.
 */
setPoolGiveBack((t, why) => {
  if (why === "run-limit") {
    if (runLimitedOf(t)) return backInLine(t, { blame: true, why: GAVE_BACK_WORDS, last: true });
    setTask(t.id, { extra_json: JSON.stringify({ ...json<Record<string, unknown>>(t.extra_json, {}), runLimited: true }) });
  }
  backInLine(t, { blame: true, why: GAVE_BACK_WORDS });
});

/**
 * A worker's ComfyUI lost its task twice on one claim (each loss sends it again once): it goes back in line with its
 * place kept, and counts as an attempt, so another worker is preferred and the third attempt fails it.
 */
setPoolLost((t) => backInLine(t, { blame: true }));

// ---------------------------------------------------------------------------
// Place in line and the wait (4.4)

/** Tasks looked at for a place in line, at most (a longer line counts as this long). */
const LOOK_AHEAD = 2000;

const poolWorkers = () => db().prepare("SELECT * FROM relay_workers WHERE kind = 'pool' AND revoked_at IS NULL").all() as WorkerRow[];

/** Do two tasks share a pool (the same workers may serve both)? */
const sharePool = (a: Pick<TaskRow, "pools">, b: Pick<TaskRow, "pools">) => (a.pools ?? "").split(",").some((p) => !!p && (b.pools ?? "").split(",").includes(p));

/**
 * A lane's typical run on the workers: the median measured time of its last 20 finished jobs (the worker's own
 * execution time), else of any lane's, else null before any.
 */
export function typicalPoolMs(lane: string | null): number | null {
  const d = db();
  const of = (rows: { ms: number }[]) => (rows.length ? rows.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)] : null);
  const q = (where: string, ...args: unknown[]) =>
    d.prepare(`SELECT exec_ms AS ms FROM worker_jobs WHERE event = 'finished' AND exec_ms > 0 ${where} ORDER BY id DESC LIMIT 20`).all(...args) as { ms: number }[];
  return (lane ? of(q("AND lane = ?", lane)) : null) ?? of(q(""));
}

/** How long a task should take: its lane's bench on the quickest of these workers, its own estimate, or the lane's typical run. */
function estFor(t: Pick<TaskRow, "lane" | "est_ms">, workers: WorkerRow[], typical: (lane: string | null) => number | null): number {
  const bench = workers.map((w) => (t.lane && benchOf(w)[t.lane]?.medianMs) || 0).filter((ms) => ms > 0);
  return (bench.length ? Math.min(...bench) : 0) || t.est_ms || typical(t.lane) || 60_000;
}

/**
 * Where a waiting task is in line, and about how long until it is done. Every task ahead of it counts, whatever its lane,
 * in the order the workers serve them (LINE_ORDER), when a worker that may run this one may run that one too: one GPU
 * serves every lane it has in that order. The wait adds what is left of the jobs those workers are running now, the
 * load of its lane when none has it warm, and its own run. No worker able to run it right now (paused, outside its
 * hours): its place, with no estimate.
 */
export function placeInLine(t: TaskRow, now = Date.now()): { place: number; etaSeconds: number | null } {
  const d = db();
  const all = poolWorkers().filter((w) => sharePool({ pools: w.pool }, t));
  const workers = all.filter((w) => eligible(w, now) && fits({ ...t, created_at: 0 }, w, now));
  const before = lineBefore(t, now);
  // Ahead of it: a task the same workers would serve first (with none able to run it now, any that could run it at all).
  const able = workers.length ? workers : all.filter((w) => fits({ ...t, created_at: 0 }, w, now));
  const ahead = before.filter((x) => sharePool(x, t) && (!able.length || able.some((w) => fits({ ...x, created_at: 0 }, w, now))));
  if (!workers.length) return { place: ahead.length + 1, etaSeconds: null };
  const typical = memo(typicalPoolMs);
  const own = estFor(t, workers, typical);
  const warm = workers.some((w) => w.warm_lane === t.lane);
  const load = warm ? 0 : Math.max(0, ...workers.map((w) => (t.lane && benchOf(w)[t.lane]?.loadMs) || 0));
  const sum = ahead.reduce((s, x) => s + estFor(x, workers, typical), 0);
  // The jobs these workers hold now: what is left of each.
  const ids = new Set(workers.map((w) => w.id));
  const running = (d.prepare(`SELECT ${LINE_COLS} FROM relay_tasks WHERE pools IS NOT NULL AND state IN ('sending','queued','running','collecting') AND worker_id IS NOT NULL`).all() as TaskRow[]).filter((x) => ids.has(x.worker_id!));
  const left = running.reduce((s, x) => s + Math.max(0, estFor(x, workers, typical) - (now - (x.claimed_at ?? now))), 0);
  return { place: ahead.length + 1, etaSeconds: Math.round(((sum + left) / workers.length + load + own) / 1000) };
}

/** The waiting tasks served before this one (at most LOOK_AHEAD), in the line's order. */
function lineBefore(t: TaskRow, now: number): TaskRow[] {
  const d = db();
  const rank = t.rank_at ?? t.created_at;
  const cls = classRank(t);
  if (!queueSettings(now).fairShare) {
    return d
      .prepare(
        `SELECT ${LINE_COLS} FROM relay_tasks WHERE pools IS NOT NULL AND state = 'waiting' AND stop = 0 AND id != ?
           AND (${CLASS_RANK} < ? OR (${CLASS_RANK} = ? AND (rank_at < ? OR (rank_at = ? AND (created_at < ? OR (created_at = ? AND id < ?))))))
         ORDER BY ${LINE_ORDER} LIMIT ?`,
      )
      .all(t.id, cls, cls, rank, rank, t.created_at, t.created_at, t.id, LOOK_AHEAD) as TaskRow[];
  }
  const rows = d.prepare(`SELECT ${LINE_COLS} FROM relay_tasks WHERE pools IS NOT NULL AND state = 'waiting' AND stop = 0 AND id != ? ORDER BY ${LINE_ORDER} LIMIT ?`).all(t.id, LOOK_AHEAD) as TaskRow[];
  const line = lineOrder([...rows, t], true);
  return line.slice(0, line.findIndex((x) => x.id === t.id));
}

/** A one-argument function whose answers are kept for this call's life. */
function memo<A, R>(fn: (a: A) => R): (a: A) => R {
  const seen = new Map<A, R>();
  return (a) => {
    if (!seen.has(a)) seen.set(a, fn(a));
    return seen.get(a)!;
  };
}

// ---------------------------------------------------------------------------
// Making tasks for workers

/** The catalog's lanes, worked out once for each requirements index (loadIndex keeps one until its file changes). */
const lanesByIndex = new WeakMap<ReturnType<typeof loadIndex>, { lanes: ReturnType<typeof allLanes>; byWorkflow: Map<string, string> }>();
function catalogLanes(): { lanes: ReturnType<typeof allLanes>; byWorkflow: Map<string, string> } {
  const index = loadIndex();
  let kept = lanesByIndex.get(index);
  if (!kept) {
    const lanes = allLanes(index, sha);
    kept = { lanes, byWorkflow: new Map(lanes.flatMap((l) => l.workflows.map((id) => [id, l.lane] as const))) };
    lanesByIndex.set(index, kept);
  }
  return kept;
}

/** The lane a workflow's tasks go in (a workflow the catalog doesn't know: the small lane). */
export function poolLane(workflowId: string): string {
  return catalogLanes().byWorkflow.get(workflowId) ?? "small";
}

/**
 * Is there a worker for this workflow (any workflow: `workflowId` null): one the owner added and didn't revoke, allowed
 * the workflow's lane, and able to run it as its last list of files said (its verified files and node packs, the kinds
 * of input it takes) with the VRAM it needs, whether it is paused, outside its hours or offline right now (a run then
 * waits in line for it). A run that no worker could ever take is refused before Run, never left to wait for nothing.
 */
export function workersCanRun(workflowId: string | null): boolean {
  return ableWorkers(workflowId).length > 0;
}

/** The workers that may and can run this workflow (any workflow: null), whatever their state now (workersCanRun). */
function ableWorkers(workflowId: string | null): WorkerRow[] {
  const needs = workflowId ? needsOf(loadIndex(), workflowId) : null;
  const lane = workflowId ? poolLane(workflowId) : null;
  // (Runs made here go to the "pool" pool: poolFields.)
  return poolWorkers().filter((w) => {
    if (w.pool !== "pool") return false;
    const allow = allowOf(w);
    const cap = capableOf(w);
    if (workflowId === null) return cap.workflows.some((id) => poolLane(id) in allow);
    if (!needs || !(lane! in allow) || !cap.workflows.includes(workflowId)) return false;
    return needs.minVramBytes <= (factsOf(w).vramBytes ?? 0);
  });
}

/**
 * Is a worker on to take work soon: connected and heard from within the silence limit, paused neither on the website
 * nor on its PC (a game or another program on its GPU counts as paused), not draining, new enough, and inside its
 * hours? A worker that makes room for local ComfyUI work first is on: people's runs keep their place and it takes them
 * next.
 */
function onSoon(w: WorkerRow, now: number): boolean {
  return (
    !w.revoked_at &&
    !(w.expires_at && w.expires_at <= now) &&
    !w.paused_server &&
    !w.paused_local &&
    !w.drain &&
    (w.protocol ?? 0) >= MIN_PROTOCOL &&
    !!w.seen_at &&
    now - w.seen_at <= RELAY_TIMES.poolSilentMs &&
    hoursAt(hoursOf(w), now).inside
  );
}

/**
 * Is every worker that could run this workflow (any workflow: null) away now: paused, draining, outside its hours,
 * silent, or never connected? A run made then would wait for nothing until its wait limit ended it, so the price check
 * and Run say "Starting soon" instead and nothing is made. False when no worker could run it at all (workersCanRun
 * refuses that) or one is on.
 */
export function workersAway(workflowId: string | null, now = Date.now()): boolean {
  const able = ableWorkers(workflowId);
  return able.length > 0 && !able.some((w) => onSoon(w, now));
}

/**
 * What the workers allowed a lane have (any lane: `lane` null), for shaping a graph that each of them can run: the least
 * VRAM and RAM among those that said, and their device when they all name the same kind. Nothing known: empty.
 */
export function poolFacts(lane: string | null): ComputerFacts {
  const facts = poolWorkers()
    .filter((w) => lane === null || lane in allowOf(w))
    .map((w) => json<ComputerFacts>(w.facts_json, {}));
  const least = (k: "vramBytes" | "ramBytes") => {
    const v = facts.map((f) => f[k]).filter((n): n is number => typeof n === "number" && n > 0);
    return v.length ? Math.min(...v) : undefined;
  };
  const kinds = new Set(facts.map((f) => /^[a-z]+/i.exec(f.device ?? "")?.[0].toLowerCase()).filter(Boolean));
  const vramBytes = least("vramBytes");
  const ramBytes = least("ramBytes");
  const device = kinds.size === 1 ? facts.find((f) => f.device)?.device : undefined;
  return { ...(vramBytes && { vramBytes }), ...(ramBytes && { ramBytes }), ...(device && { device }) };
}

/**
 * The line for a new run of this workflow, for a quote or a reserve (the billing service's QueueFacts): how many tasks the
 * workers that may run it would serve before it, about how long until it would be done, and how many such workers can
 * take work now. (The account's own runs, QueueFacts.mine, are counted by run in hosted.ts.)
 */
export function lineFacts(accountId: string | null, asked: string | null, now = Date.now()) {
  // A workflow that picks its graph at run time (`…-{n}`) has no lane yet: the whole line counts.
  const workflowId = asked && !asked.includes("{") ? asked : null;
  const lane = workflowId ? poolLane(workflowId) : null;
  const needs = workflowId ? needsOf(loadIndex(), workflowId) : null;
  // A new run of a person's, in the free class (a paid run's head start is the billing service's to price, not to quote).
  const probe = { id: "", principal: accountId ? `acct:${accountId}` : "guest", account: accountId ?? "guest", class: "free", pools: "pool", lane, needs_json: needs ? JSON.stringify(needs) : null, rank_at: now, created_at: now, stop: 0, only_worker: null, est_ms: null } as unknown as TaskRow;
  const p = lane ? placeInLine(probe, now) : { place: (db().prepare("SELECT COUNT(*) AS n FROM relay_tasks WHERE pools IS NOT NULL AND state = 'waiting'").get() as { n: number }).n + 1, etaSeconds: null };
  const online = poolWorkers().filter((w) => eligible(w, now) && (!lane || fits({ ...probe, created_at: 0 }, w, now))).length;
  return { lane: lane ?? "small", ahead: p.place - 1, etaS: p.etaSeconds, workersOnline: online, nextOpenAt: null };
}

/**
 * What a task for workers stores: its lane, its needs, its class and its place in line. A person's run is "free" unless
 * the billing service said "paid"; the owner's own jobs are the "owner" class, served after every person's.
 */
export function poolFields(workflowId: string, o: { account?: string; class?: "paid" | "free" | "owner"; boostMs?: number; waitMs?: number; onlyWorker?: string } = {}, now = Date.now()) {
  const index = loadIndex();
  const needs = needsOf(index, workflowId);
  const lane = poolLane(workflowId);
  return {
    pools: ["pool"],
    account: o.account,
    class: o.class ?? (o.account ? ("free" as const) : ("owner" as const)),
    // A head start is only inside a class, and never more than a day.
    rankAt: now - Math.max(0, Math.min(o.boostMs ?? 0, 24 * 60 * 60_000)),
    lane,
    needs: needs ?? { workflowId, files: [], packs: [], minVramBytes: 0 },
    notAfter: o.waitMs ? now + o.waitMs : undefined,
    onlyWorker: o.onlyWorker,
  };
}

/** The queue block for GET /api/generations/<id>: the task's place in its lane and the estimated wait. Null when no pool task waits. */
export function queueOfGeneration(generationId: string, now = Date.now()): { place: number; etaSeconds: number | null } | null {
  const t = db().prepare("SELECT * FROM relay_tasks WHERE generation_id = ? AND pools IS NOT NULL AND state = 'waiting' LIMIT 1").get(generationId) as TaskRow | undefined;
  return t ? placeInLine(t, now) : null;
}

/** FUOBE_POOL_WAIT_MIN: how long a task for workers waits before it fails (30 minutes). */
export const poolWaitMs = () => {
  const m = Number(process.env.FUOBE_POOL_WAIT_MIN);
  return (Number.isFinite(m) && m > 0 ? m : 30) * 60_000;
};

/** The waiting words of a task for workers ("Waiting for a GPU · 2 ahead", "No GPU is on now"). */
export function poolWaitWords(t: TaskRow, now = Date.now()): string {
  const p = placeInLine(t, now);
  if (p.etaSeconds === null) return "Waiting for a GPU to come on";
  return p.place > 1 ? `Waiting for a GPU · ${p.place - 1} ahead` : "Next for a GPU";
}

// ---------------------------------------------------------------------------
// The owner's controls (Settings → Workers, /api/admin/workers)

export interface WorkerView {
  id: string;
  name: string;
  pool: string;
  state: WorkerState;
  words: string;
  pausedServer: boolean;
  pausedLocal: boolean;
  localWhy: string | null;
  drain: boolean;
  autoResume: boolean | null;
  hours: Hours | null;
  allow: Record<string, Allow>;
  claimAfterMs: number;
  switchAfterMs: number;
  warmLane: string | null;
  lanes: string[];
  facts: ComputerFacts;
  bench: ReturnType<typeof benchOf>;
  seenAt: number | null;
  version: string | null;
  lastCountry: string | null;
  createdAt: number;
  current: { taskId: string; generationId: string; lane: string | null; startedAt: number | null } | null;
}

export function workerView(w: WorkerRow, now = Date.now()): WorkerView {
  const s = workerState(w, now);
  const cur = db().prepare("SELECT id, generation_id, lane, started_at FROM relay_tasks WHERE worker_id = ? AND state IN ('sending','queued','running','collecting') LIMIT 1").get(w.id) as
    | { id: string; generation_id: string; lane: string | null; started_at: number | null }
    | undefined;
  return {
    id: w.id,
    name: w.name,
    pool: w.pool,
    state: s.state,
    words: s.words,
    pausedServer: !!w.paused_server,
    pausedLocal: !!w.paused_local,
    localWhy: w.local_why,
    drain: !!w.drain,
    autoResume: w.auto_resume === null || w.auto_resume === undefined ? null : !!w.auto_resume,
    hours: hoursOf(w),
    allow: allowOf(w),
    claimAfterMs: w.claim_after_ms,
    switchAfterMs: w.switch_after_ms,
    warmLane: w.warm_lane,
    lanes: capableOf(w).lanes,
    facts: factsOf(w),
    bench: benchOf(w),
    seenAt: w.seen_at,
    version: w.version,
    lastCountry: w.last_country,
    createdAt: w.created_at,
    current: cur ? { taskId: cur.id, generationId: cur.generation_id, lane: cur.lane, startedAt: cur.started_at } : null,
  };
}

export function listWorkers(now = Date.now()): WorkerView[] {
  return (db().prepare("SELECT * FROM relay_workers WHERE kind = 'pool' AND revoked_at IS NULL ORDER BY created_at").all() as WorkerRow[]).map((w) => workerView(w, now));
}

/** Add a worker: paused on the website, with no hours and no lanes. Its token is shown once. */
export function addWorker(name: string, pool = "pool"): { id: string; token: string } {
  if (!/^[a-z0-9-]{1,32}$/.test(pool)) throw new Error("A pool's name is lower-case letters, digits and hyphens");
  const clean = name.trim();
  if (!clean) throw new Error("Name the worker");
  if (db().prepare("SELECT 1 FROM relay_workers WHERE kind = 'pool' AND revoked_at IS NULL AND name = ?").get(clean)) throw new Error("A worker with that name exists");
  return createWorker({ name: clean, kind: "pool", pool });
}

export interface WorkerPatch {
  paused?: boolean;
  pauseNow?: boolean;
  drain?: boolean;
  /** true or false sets the automatic resume for this worker; null leaves it to the worker's worker.json. */
  autoResume?: boolean | null;
  hours?: unknown;
  allow?: unknown;
  claimAfterMs?: number;
  switchAfterMs?: number;
  rotate?: boolean;
  revoke?: boolean;
}

/** A worker's token stops at once, and its tasks go back in line at once (not the worker's fault). */
function revokePoolWorker(id: string, now: number): void {
  revokeWorker(id, now);
  for (const t of db().prepare("SELECT * FROM relay_tasks WHERE worker_id = ? AND state IN ('sending','queued','running','collecting')").all(id) as TaskRow[]) backInLine(t, { blame: false });
}

/**
 * Every worker's token stops at once (Settings → Security → Sign everyone out, with every API token), and their tasks go
 * back in line with their places kept. People's own paired ComfyUIs keep theirs. Returns how many workers it revoked.
 */
export function revokeAllWorkers(now = Date.now()): number {
  const d = db();
  return d.transaction(() => {
    const ids = (d.prepare("SELECT id FROM relay_workers WHERE kind = 'pool' AND revoked_at IS NULL").all() as { id: string }[]).map((r) => r.id);
    for (const id of ids) revokePoolWorker(id, now);
    return ids.length;
  })();
}

/** The owner changes a worker. Each change reaches it at its next beat. */
export function patchWorker(id: string, p: WorkerPatch, now = Date.now()): { view: WorkerView | null; token?: string } {
  const d = db();
  const w = d.prepare("SELECT * FROM relay_workers WHERE id = ? AND kind = 'pool' AND revoked_at IS NULL").get(id) as WorkerRow | undefined;
  if (!w) return { view: null };
  if (p.revoke) {
    revokePoolWorker(id, now);
    return { view: null };
  }
  const set: Record<string, unknown> = {};
  if (p.paused !== undefined) {
    set.paused_server = p.paused ? 1 : 0;
    if (!p.paused) set.drain = 0;
  }
  if (p.pauseNow) Object.assign(set, { paused_server: 1, stop_now: 1 });
  if (p.drain !== undefined) set.drain = p.drain ? 1 : 0;
  if (p.autoResume !== undefined) {
    if (p.autoResume !== null && typeof p.autoResume !== "boolean") throw new Error("The automatic resume is on, off or the PC's own setting");
    set.auto_resume = p.autoResume === null ? null : p.autoResume ? 1 : 0;
  }
  if (p.hours !== undefined) {
    if (p.hours !== null && !parseHours(p.hours)) throw new Error("Hours need a time zone and windows like 01:00–09:00");
    set.hours_json = p.hours === null ? null : JSON.stringify(parseHours(p.hours));
  }
  if (p.allow !== undefined) {
    if (!p.allow || typeof p.allow !== "object") throw new Error("Allowed lanes are a list of lanes, each with a delay");
    const allow: Record<string, Allow> = {};
    for (const [lane, v] of Object.entries(p.allow as Record<string, unknown>)) {
      if (!/^[0-9a-f]{12}$|^small$/.test(lane)) throw new Error(`No such lane: ${lane}`);
      const delay = Number((v as { delayMs?: unknown })?.delayMs ?? 0);
      allow[lane] = { delayMs: Number.isFinite(delay) && delay >= 0 ? Math.min(delay, 24 * 3_600_000) : 0 };
    }
    set.allow_json = JSON.stringify(allow);
  }
  if (p.claimAfterMs !== undefined) set.claim_after_ms = Math.max(0, Math.min(24 * 3_600_000, Math.round(Number(p.claimAfterMs) || 0)));
  if (p.switchAfterMs !== undefined) set.switch_after_ms = Math.max(0, Math.min(24 * 3_600_000, Math.round(Number(p.switchAfterMs) || 0)));
  const keys = Object.keys(set);
  if (keys.length) d.prepare(`UPDATE relay_workers SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`).run({ ...set, id });
  const token = p.rotate ? rotateWorker(id) ?? undefined : undefined;
  const fresh = d.prepare("SELECT * FROM relay_workers WHERE id = ?").get(id) as WorkerRow;
  return { view: workerView(fresh, now), ...(token && { token }) };
}

/** The line for workers by lane: waiting, oldest, the estimate, and which workers have it warm. */
export function queueView(now = Date.now()) {
  const index = loadIndex();
  const rows = db().prepare("SELECT lane, COUNT(*) AS n, MIN(created_at) AS oldest FROM relay_tasks WHERE pools IS NOT NULL AND state = 'waiting' GROUP BY lane").all() as { lane: string | null; n: number; oldest: number }[];
  const workers = db().prepare("SELECT * FROM relay_workers WHERE kind = 'pool' AND revoked_at IS NULL").all() as WorkerRow[];
  return {
    lanes: rows.map((r) => {
      const last = db().prepare("SELECT * FROM relay_tasks WHERE pools IS NOT NULL AND state = 'waiting' AND lane IS ? ORDER BY rank_at DESC LIMIT 1").get(r.lane) as TaskRow | undefined;
      return {
        lane: r.lane ?? "",
        label: r.lane ? laneLabel(index, r.lane, sha) : "",
        waiting: r.n,
        oldestAt: r.oldest,
        etaS: last ? placeInLine(last, now).etaSeconds : null,
        warmOn: workers.filter((w) => w.warm_lane === r.lane && eligible(w, now)).map((w) => w.name),
      };
    }),
  };
}

/** Every lane in this studio's catalog, for the owner to allow per worker. */
export const lanesCatalog = () => catalogLanes().lanes.map((l) => ({ lane: l.lane, label: l.label, workflows: l.workflows.length }));
