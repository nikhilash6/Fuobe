import "server-only";
import crypto from "node:crypto";
import { allLanes, laneLabel, lanesFor, MEDIA_KINDS, needsOf, type Inventory, type Needs } from "@/lib/lanes";
import { RELAY_TIMES, SENT_STATES, type BeatAnswer, type ClaimedTask, type ComputerFacts, type WorkerAnswer, type WorkerBeat } from "@/lib/relay";
import { clock, hoursAt, parseHours, type Hours } from "@/lib/worker-hours";
import { db } from "../db";
import { loadIndex } from "../gpu/index-file";
import { cleanFacts, endTask, getTask, json, noteProgress, setPoolCeiling, setPoolClocks, setPoolGiveBack, setTask, takeTask, type TaskRow } from "./tasks";
import { createWorker, revokeWorker, rotateWorker, type WorkerRow } from "./workers";

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
/** A task avoids workers that lost or failed it, unless no other worker that can run it beat this recently. */
export const RETRY_WINDOW_MS = 10 * 60_000;
/** Attempts in all before a task fails. */
export const MAX_ATTEMPTS = 3;
/** A worker that beat this recently may claim. */
const FRESH_BEAT_MS = 30_000;
/** The longest one attempt at a job may run on a worker (the generation's own clock is the same 45 minutes). */
export const RUN_CEILING_MS = 45 * 60_000;
/** Run ceilings of their own for some lanes (none yet: every lane has RUN_CEILING_MS). */
const LANE_CEILINGS: Readonly<Record<string, number>> = {};
/** A lane's run ceiling. */
export const runCeilingMs = (lane?: string | null) => (lane && LANE_CEILINGS[lane]) || RUN_CEILING_MS;
/** A job that makes no progress for this long goes back in line (a worker's own worker.json may set another). */
export const STALL_MS = 10 * 60_000;
/** Stall limits of their own for some lanes (none yet: every lane has STALL_MS). */
const LANE_STALLS: Readonly<Record<string, number>> = {};
/** A lane's stall limit, which the claim gives the worker. */
export const stallLimitMs = (lane?: string | null) => (lane && LANE_STALLS[lane]) || STALL_MS;
/**
 * The run limit of one attempt: 3 × the lane's p90 on that worker plus its model load, at least 10 minutes, and never
 * past the lane's run ceiling. With no p90 yet (a new worker, a new lane), the ceiling: a first long job finishes.
 */
export const runLimitMs = (p90?: number | null, lane?: string | null, loadMs?: number | null) => {
  const ceiling = runCeilingMs(lane);
  if (!p90 || p90 <= 0) return ceiling;
  return Math.min(ceiling, Math.max(10 * 60_000, 3 * p90 + Math.max(0, loadMs ?? 0)));
};
/** The owner's own tasks go ahead of everyone else's by this much (rank_at = created_at - boost). */
export const OWNER_BOOST_MS = 24 * 60 * 60_000;

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

export type WorkerState = "new" | "idle" | "busy" | "draining" | "paused" | "outside-hours" | "gpu-busy" | "comfy-down" | "offline";

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
    return { state: "paused", words: w.local_until ? `Paused here until ${clock(w.local_until, tz)}` : "Paused here" };
  }
  if (w.paused_server) return { state: "paused", words: "Paused on the website" };
  const h = hoursAt(hoursOf(w), now);
  if (!h.inside) return { state: "outside-hours", words: h.nextChangeAt ? `Outside its hours (back at ${clock(h.nextChangeAt, tz)})` : "No hours set" };
  const busy = (db().prepare(`SELECT COUNT(*) AS n FROM relay_tasks WHERE worker_id = ? AND state IN ('sending','queued','running','collecting')`).get(w.id) as { n: number }).n > 0;
  if (w.drain) return busy ? { state: "draining", words: "Finishing its job, then pausing" } : { state: "paused", words: "Paused after its last job" };
  return busy ? { state: "busy", words: "Running a job" } : { state: "idle", words: "Ready" };
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
  };
}

/**
 * A worker says it is here: its own pause and why, its GPU, its facts, what it runs. The answer: whether it is paused on
 * the website, a stop-now, drain, its hours, the lanes it is allowed, and the prompts to take off its ComfyUI.
 */
export function workerBeat(w: WorkerRow, b: WorkerBeat, now = Date.now()): BeatAnswer & { worker: WorkerAnswer } {
  const d = db();
  const device = `wkr-${w.id}`;
  return d.transaction(() => {
    // A worker back after going silent finds its task back in line first (its lease no longer works).
    sweepPool(now);
    const facts = b.facts ? { ...b.facts, loras: undefined } : undefined;
    d.prepare(
      `UPDATE relay_workers SET seen_at = ?, device = ?, protocol = ?, version = ?, paused_local = ?, local_why = ?, local_until = ?,
         warm_lane = ?, facts_json = COALESCE(?, facts_json) WHERE id = ?`,
    ).run(now, device, b.protocol, b.version, b.local.paused ? 1 : 0, b.local.why, b.local.until, b.warmLane, facts ? JSON.stringify(facts) : null, w.id);
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
        sendInventory: !fresh.inventory_hash || fresh.inventory_hash !== b.inventoryHash,
      },
    };
  })();
}

/**
 * People's tasks (an account's, never the owner's own) this worker may claim right now: in its pool, in a lane it is
 * allowed and able to run, with the files and VRAM they need, past their delays, and ending before its hours do. Its
 * own pause doesn't count here (its PC reads this to know whether a person's run waits for it); a pause on the website,
 * a drain, an older worker program or being outside its hours does.
 */
export function claimableNow(w: WorkerRow, now = Date.now()): number {
  if (w.kind !== "pool" || w.revoked_at || w.paused_server || w.drain || (w.protocol ?? 0) < MIN_PROTOCOL || !hoursAt(hoursOf(w), now).inside) return 0;
  const rows = db()
    .prepare("SELECT * FROM relay_tasks WHERE pools IS NOT NULL AND state = 'waiting' AND stop = 0 AND account IS NOT NULL AND INSTR(',' || pools || ',', ?) > 0 ORDER BY rank_at LIMIT ?")
    .all(`,${w.pool},`, LOOK_AT) as TaskRow[];
  return rows.filter((t) => fits(t, w, now) && retryOk(t, w, now) && beforeWindowEnds(t, w, now)).length;
}

// ---------------------------------------------------------------------------
// Inventory

/** The worker's verified files and node packs: what it can run now, and what each other lane lacks. */
export function saveInventory(w: WorkerRow, raw: unknown): { lanes: string[]; workflows: string[]; missing: { lane: string; label: string; files: string[]; bytes: number }[] } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const files = (Array.isArray(o.files) ? o.files : []).slice(0, 20_000).flatMap((f) => {
    const x = f as Record<string, unknown>;
    const folder = text(x?.folder, 64);
    const name = text(x?.name, 256);
    const size = num(x?.size);
    const sha256 = typeof x?.sha256 === "string" && /^[0-9a-f]{64}$/.test(x.sha256) ? x.sha256 : null;
    return folder && name && size !== null && !/[\\/]|\.\./.test(name) ? [{ folder, name, size, sha256 }] : [];
  });
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
  const invHash = inventoryHash(inv);
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
 * A worker asks for work, inside one transaction: first a task it had and lost track of; then, if it may take work, the
 * best waiting task it can run (its pool, its allowed lanes and their delays, the files and VRAM it needs, the retry
 * rule, and the end of its hours). Sticky lanes: its warm lane goes first until another lane's best task has waited
 * longer than switch_after_ms (and is older).
 */
export function workerClaim(w: WorkerRow, running: string[], now = Date.now()): ClaimedTask | null {
  const d = db();
  const device = `wkr-${w.id}`;
  return d.transaction((): ClaimedTask | null => {
    sweepPool(now);
    const fresh = d.prepare("SELECT * FROM relay_workers WHERE id = ?").get(w.id) as WorkerRow;
    const mine = (d.prepare(`SELECT * FROM relay_tasks WHERE worker_id = ? AND device = ? AND state IN ('sending','queued','running','collecting') AND stop = 0 ORDER BY rank_at`).all(fresh.id, device) as TaskRow[]).find(
      (t) => !running.includes(t.id),
    );
    if (mine) return claimed(mine, fresh, device, now);
    if (!eligible(fresh, now)) return null;
    const t = pick(fresh, now);
    return t ? claimed(t, fresh, device, now) : null;
  })();
}

function claimed(t: TaskRow, w: WorkerRow, device: string, now: number): ClaimedTask {
  const needs = json<Needs | null>(t.needs_json, null);
  const bench = t.lane ? benchOf(w)[t.lane] : undefined;
  const c = takeTask(t, device, now, { worker_id: w.id });
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

function pick(w: WorkerRow, now: number): TaskRow | null {
  const rows = db()
    .prepare("SELECT * FROM relay_tasks WHERE pools IS NOT NULL AND state = 'waiting' AND stop = 0 AND INSTR(',' || pools || ',', ?) > 0 ORDER BY rank_at LIMIT ?")
    .all(`,${w.pool},`, LOOK_AT) as TaskRow[];
  const ok = rows.filter((t) => fits(t, w, now) && retryOk(t, w, now) && beforeWindowEnds(t, w, now));
  if (!ok.length) return null;
  const warm = w.warm_lane ? ok.find((t) => t.lane === w.warm_lane) : undefined;
  const other = ok.find((t) => t.lane !== w.warm_lane);
  if (!warm) return other ?? null;
  if (other && (other.rank_at ?? 0) < now - w.switch_after_ms && (other.rank_at ?? 0) < (warm.rank_at ?? 0)) return other;
  return warm;
}

// ---------------------------------------------------------------------------
// Back in line, and the clocks

/**
 * A task goes back in line: its worker let it go (`blame: false`: a pause, at no cost to anyone) or lost it (silent,
 * its ComfyUI down: the worker is noted in tried_json and it counts as an attempt). The third lost attempt fails it.
 * The old worker's lease stops working, so its late calls get 409.
 */
export function backInLine(t: TaskRow, o: { blame: boolean; why?: string; last?: boolean }): void {
  const tried = json<string[]>(t.tried_json, []);
  const requeues = t.requeues + (o.blame ? 1 : 0);
  if (o.blame && (requeues >= MAX_ATTEMPTS || o.last)) {
    endTask(t.id, "failed", { error: o.why ?? "The GPUs couldn't finish this run. Press Retry.", requeues, tried_json: JSON.stringify([...new Set([...tried, t.worker_id ?? ""])].filter(Boolean)) }, true);
    return;
  }
  // A live worker that let it go hears the stop in its beat answer; one that went silent finds its lease gone when it
  // comes back (409), and takes the prompt off its own ComfyUI.
  setTask(t.id, {
    state: "waiting",
    lease_hash: null,
    worker_id: null,
    requeues,
    sent_at: null,
    started_at: null,
    down_at: null,
    down_why: null,
    note: "resent",
    ...(o.blame && t.worker_id && { tried_json: JSON.stringify([...new Set([...tried, t.worker_id])]) }),
  });
  db().prepare("UPDATE relay_inputs SET reads = 0 WHERE task_id = ?").run(t.id);
}

/**
 * The workers' clocks: a task whose worker went silent for 2 minutes (or was revoked), or whose ComfyUI was down for 2
 * minutes, goes back in line; a task still waiting past its wait limit fails, not charged.
 */
export function sweepPool(now = Date.now()): void {
  const d = db();
  const held = d
    .prepare(
      `SELECT t.*, w.seen_at AS w_seen, w.revoked_at AS w_revoked FROM relay_tasks t LEFT JOIN relay_workers w ON w.id = t.worker_id
       WHERE t.pools IS NOT NULL AND t.state IN ('sending','queued','running','collecting')`,
    )
    .all() as (TaskRow & { w_seen: number | null; w_revoked: number | null })[];
  for (const t of held) {
    const silent = !t.w_seen || now - t.w_seen > RELAY_TIMES.poolSilentMs || !!t.w_revoked;
    const down = !!t.down_at && now - t.down_at > RELAY_TIMES.poolComfyDownMs;
    if (silent || down) backInLine(t, { blame: true, why: silent ? "The GPU running this stopped answering, three times. Press Retry." : "ComfyUI kept stopping on the GPUs. Press Retry." });
  }
  const late = d.prepare("SELECT id FROM relay_tasks WHERE pools IS NOT NULL AND state = 'waiting' AND not_after IS NOT NULL AND not_after < ?").all(now) as { id: string }[];
  for (const t of late) endTask(t.id, "failed", { error: "The GPUs were busy. Not charged." });
}

setPoolClocks((t, now) => {
  sweepPool(now);
  return getTask(t.principal, t.id) ?? t;
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

/** A worker's reported execution time is never more than its task's run ceiling. */
setPoolCeiling((t) => runCeilingMs(t.lane));

// ---------------------------------------------------------------------------
// Place in line and the wait (4.4)

/** Where a waiting task is in its lane's line, and about how long until it is done. */
export function placeInLine(t: TaskRow, now = Date.now()): { place: number; etaSeconds: number | null } {
  const d = db();
  const ahead = d.prepare("SELECT est_ms FROM relay_tasks WHERE pools IS NOT NULL AND state = 'waiting' AND lane IS ? AND rank_at < ?").all(t.lane, t.rank_at ?? now) as { est_ms: number | null }[];
  const workers = (d.prepare("SELECT * FROM relay_workers WHERE kind = 'pool' AND revoked_at IS NULL").all() as WorkerRow[]).filter((w) => eligible(w, now) && fits({ ...t, created_at: 0 }, w, now));
  if (!workers.length) return { place: ahead.length + 1, etaSeconds: null };
  const own = t.est_ms ?? 60_000;
  const warm = workers.some((w) => w.warm_lane === t.lane);
  const load = warm ? 0 : Math.max(0, ...workers.map((w) => (t.lane && benchOf(w)[t.lane]?.loadMs) || 0));
  const sum = ahead.reduce((s, r) => s + (r.est_ms ?? own), 0);
  return { place: ahead.length + 1, etaSeconds: Math.round((sum / workers.length + load + own) / 1000) };
}

// ---------------------------------------------------------------------------
// Making tasks for workers

/** What a task for workers stores: its lane, its needs, and its place in line. */
export function poolFields(workflowId: string, o: { account?: string; boostMs?: number; waitMs?: number; onlyWorker?: string } = {}, now = Date.now()) {
  const index = loadIndex();
  const needs = needsOf(index, workflowId);
  const lane = allLanes(index, sha).find((l) => l.workflows.includes(workflowId))?.lane ?? "small";
  return {
    pools: ["pool"],
    account: o.account,
    rankAt: now - (o.boostMs ?? 0),
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

/** The owner changes a worker. Each change reaches it at its next beat. */
export function patchWorker(id: string, p: WorkerPatch, now = Date.now()): { view: WorkerView | null; token?: string } {
  const d = db();
  const w = d.prepare("SELECT * FROM relay_workers WHERE id = ? AND kind = 'pool' AND revoked_at IS NULL").get(id) as WorkerRow | undefined;
  if (!w) return { view: null };
  if (p.revoke) {
    revokeWorker(id, now);
    // Its tasks go back in line at once (not the worker's fault).
    for (const t of d.prepare("SELECT * FROM relay_tasks WHERE worker_id = ? AND state IN ('sending','queued','running','collecting')").all(id) as TaskRow[]) backInLine(t, { blame: false });
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
export const lanesCatalog = () => allLanes(loadIndex(), sha).map((l) => ({ lane: l.lane, label: l.label, workflows: l.workflows.length }));
