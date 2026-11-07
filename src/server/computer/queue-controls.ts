import "server-only";
import crypto from "node:crypto";
import { db } from "../db";
import type { TaskRow } from "./tasks";
import type { WorkerRow } from "./workers";

/**
 * The owner's controls over who the GPUs serve first (docs/gpu-workers.md, "Who goes first"; the admin API's
 * /api/admin/queue/mode, /overrides and /cancel). Owner-only, every change in the admin log, and each one has an end:
 * a time, or the run it is for ending, or the owner's "Back to normal". Nothing here hides or refuses a person's run:
 * a held run keeps its place in line and starts once the hold ends.
 *
 * - A mode for the pool, and one for a single worker that wins over its pool's while it lasts:
 *   - "people-first" (the default): people's runs before the owner's own jobs; local work on a worker's PC makes room
 *     for people's runs.
 *   - "people-only": workers take only people's runs; the owner's own jobs wait, and local work on the PC pauses.
 *   - "ours-first": the owner's own jobs before people's runs, and local work on the PC keeps the GPU (people's runs
 *     wait in line, in their order, and start when a GPU is free).
 *   - "balanced": people's free runs and the owner's own jobs in one line by when they came (paid runs first); local
 *     work makes room for people's runs as in people-first.
 * - A run: "next" (to the front of every worker's line, or of one worker's: `worker`), or "hold" (it keeps its place
 *   and no worker takes it until the hold ends).
 * - A person (an account, or the guests' key): "boost" (their runs go first, for a while), or "hold".
 */

export const QUEUE_MODES = ["people-first", "people-only", "ours-first", "balanced"] as const;
export type QueueMode = (typeof QUEUE_MODES)[number];
export const DEFAULT_MODE: QueueMode = "people-first";

/** What local work on a worker's PC does in each mode: makes room for people's runs, pauses, or keeps the GPU. */
export type LocalWorkRule = "yield" | "pause" | "run";
export const LOCAL_WORK: Record<QueueMode, LocalWorkRule> = { "people-first": "yield", balanced: "yield", "people-only": "pause", "ours-first": "run" };

/** The owner's words for each mode. */
export const MODE_WORDS: Record<QueueMode, string> = {
  "people-first": "People first",
  "people-only": "People only",
  "ours-first": "Our work first",
  balanced: "Balanced",
};

/** A mode the owner set: until when (null: until it is switched back), who set it and when. */
export interface ModeSetting {
  mode: QueueMode;
  until: number | null;
  by: string;
  at: number;
}

/** The mode a worker follows now, and where it comes from. */
export interface EffectiveMode {
  mode: QueueMode;
  from: "worker" | "pool" | "default";
  until: number | null;
  by: string | null;
  at: number | null;
}

/** The longest a mode, a hold or a boost may be set for, in minutes (a week). */
export const MAX_FOR_MIN = 7 * 24 * 60;
/** The longest a run stays "next" without being taken (a day). */
export const NEXT_MAX_MS = 24 * 60 * 60_000;

const MODES_KEY = "queue.modes";
const POOL = /^[a-z0-9-]{1,32}$/;
const GEN = /^[\w-]{1,80}$/;
const ACCOUNT = /^[\w:.@-]{1,80}$/;
const WORKER = /^[\w-]{1,64}$/;

declare global {
  var __fuobeQueueModes: { at: number; raw: string | null; value: Record<string, ModeSetting> } | undefined;
}

const isMode = (v: unknown): v is QueueMode => typeof v === "string" && (QUEUE_MODES as readonly string[]).includes(v);

/** A stored mode read leniently: anything not valid is none. */
export function cleanMode(v: unknown): ModeSetting | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!isMode(o.mode)) return null;
  const until = typeof o.until === "number" && Number.isFinite(o.until) ? o.until : null;
  return { mode: o.mode, until, by: typeof o.by === "string" ? o.by.slice(0, 80) : "owner", at: typeof o.at === "number" ? o.at : 0 };
}

const live = (s: ModeSetting | null, now: number): s is ModeSetting => !!s && (s.until === null || s.until > now);

/** Every pool's mode as stored (read again at most every 2 s; a change clears it at once in this process). */
export function poolModes(now = Date.now()): Record<string, ModeSetting> {
  const c = globalThis.__fuobeQueueModes;
  if (c && now - c.at < 2000) return { ...c.value };
  const raw = (db().prepare("SELECT value FROM settings WHERE key = ?").get(MODES_KEY) as { value: string } | undefined)?.value ?? null;
  let value: Record<string, ModeSetting> = {};
  if (c && c.raw === raw) value = c.value;
  else if (raw) {
    try {
      const pools = (JSON.parse(raw) as { pools?: Record<string, unknown> }).pools ?? {};
      for (const [pool, s] of Object.entries(pools)) {
        const m = POOL.test(pool) ? cleanMode(s) : null;
        if (m) value[pool] = m;
      }
    } catch {
      value = {};
    }
  }
  globalThis.__fuobeQueueModes = { at: now, raw, value };
  return { ...value };
}

function savePoolModes(pools: Record<string, ModeSetting>): void {
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(MODES_KEY, JSON.stringify({ pools }));
  globalThis.__fuobeQueueModes = undefined;
}

/** A worker's own mode as stored (null: none; it follows its pool). */
export const workerModeOf = (w: Pick<WorkerRow, "mode_json">): ModeSetting | null => {
  if (!w.mode_json) return null;
  try {
    return cleanMode(JSON.parse(w.mode_json));
  } catch {
    return null;
  }
};

/** The mode a worker follows now: its own while it lasts, else its pool's while it lasts, else people first. */
export function effectiveMode(w: Pick<WorkerRow, "pool" | "mode_json"> | { pool: string; mode_json?: string | null }, now = Date.now()): EffectiveMode {
  const own = workerModeOf({ mode_json: w.mode_json ?? null });
  if (live(own, now)) return { mode: own.mode, from: "worker", until: own.until, by: own.by, at: own.at };
  const pool = poolModes(now)[w.pool] ?? null;
  if (live(pool, now)) return { mode: pool.mode, from: "pool", until: pool.until, by: pool.by, at: pool.at };
  return { mode: DEFAULT_MODE, from: "default", until: null, by: null, at: null };
}

/** The pool's own mode now (people first when none is set or it ended). */
export const poolMode = (pool: string, now = Date.now()): EffectiveMode => effectiveMode({ pool, mode_json: null }, now);

/**
 * A task's class in the order a mode serves them (lower first): its base class (pool.ts classRank: paid 0, free 1, the
 * owner's own 2) mapped by the mode. "people-only" puts the owner's own jobs last (they aren't taken: modeServes).
 */
export function modeClass(base: number, mode: QueueMode): number {
  if (mode === "ours-first") return base === 2 ? 0 : base + 1;
  if (mode === "balanced") return Math.min(base, 1);
  if (mode === "people-only") return base === 2 ? 3 : base;
  return base;
}

/** modeClass as SQL over the base class's SQL. */
export function modeClassSql(baseSql: string, mode: QueueMode): string {
  if (mode === "ours-first") return `(CASE ${baseSql} WHEN 2 THEN 0 WHEN 0 THEN 1 ELSE 2 END)`;
  if (mode === "balanced") return `(CASE ${baseSql} WHEN 0 THEN 0 ELSE 1 END)`;
  if (mode === "people-only") return `(CASE ${baseSql} WHEN 2 THEN 3 ELSE ${baseSql} END)`;
  return baseSql;
}

// ---------------------------------------------------------------------------
// Runs and people

export type OverrideAction = "next" | "hold" | "boost";

export interface QueueOverride {
  id: string;
  kind: "run" | "person";
  /** A run's generation id, or a person's account key (as their runs carry it: an account id, or the guests' key). */
  target: string;
  action: OverrideAction;
  /** "next" for one worker only (pinned): that worker takes it first, and no other worker takes it. */
  workerId: string | null;
  /** A run's rows: every step the same press of Run made (its later steps keep the override). */
  generations: string[];
  until: number | null;
  by: string;
  at: number;
  endedAt: number | null;
  endedBy: string | null;
  endWhy: string | null;
}

interface OverrideRow {
  id: string;
  kind: string;
  target: string;
  action: string;
  worker_id: string | null;
  gens_json: string | null;
  until: number | null;
  set_by: string;
  set_at: number;
  ended_at: number | null;
  ended_by: string | null;
  end_why: string | null;
}

const fromRow = (r: OverrideRow): QueueOverride => {
  let generations: string[] = [];
  try {
    const g = JSON.parse(r.gens_json ?? "[]") as unknown;
    if (Array.isArray(g)) generations = g.filter((x): x is string => typeof x === "string");
  } catch {}
  return {
    id: r.id,
    kind: r.kind === "person" ? "person" : "run",
    target: r.target,
    action: r.action === "hold" ? "hold" : r.action === "boost" ? "boost" : "next",
    workerId: r.worker_id,
    generations: generations.length ? generations : r.kind === "run" ? [r.target] : [],
    until: r.until,
    by: r.set_by,
    at: r.set_at,
    endedAt: r.ended_at,
    endedBy: r.ended_by,
    endWhy: r.end_why,
  };
};

/** The overrides in effect now (not ended, not past their time), the oldest first. */
export function liveOverrides(now = Date.now()): QueueOverride[] {
  return (db().prepare("SELECT * FROM queue_overrides WHERE ended_at IS NULL AND (until IS NULL OR until > ?) ORDER BY set_at, id").all(now) as OverrideRow[]).map(fromRow);
}

/** The overrides that ended most recently (for the owner's view: what ended, when, and why). */
export function recentOverrides(limit = 20): QueueOverride[] {
  return (db().prepare("SELECT * FROM queue_overrides WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT ?").all(limit) as OverrideRow[]).map(fromRow);
}

/** An override's end, written once (an override already ended stays as it ended). Returns whether it changed. */
export function endOverride(id: string, by: string, why: "released" | "expired" | "run-ended" | "replaced", now = Date.now()): QueueOverride | null {
  const d = db();
  const changed = d.prepare("UPDATE queue_overrides SET ended_at = ?, ended_by = ?, end_why = ? WHERE id = ? AND ended_at IS NULL").run(now, by, why, id).changes > 0;
  if (!changed) return null;
  const r = d.prepare("SELECT * FROM queue_overrides WHERE id = ?").get(id) as OverrideRow | undefined;
  return r ? fromRow(r) : null;
}

/**
 * Ends what has run its course, and says so in the admin log (actor "system"): an override past its time, a run's
 * override once the run ended (it no longer waits or runs), a mode past its time (pool or worker). Cheap: a look at the
 * few live rows. Best-effort: it never fails a claim or a beat.
 */
export function sweepControls(now = Date.now()): void {
  try {
    const d = db();
    const ended: { action: string; target: string; detail: Record<string, unknown> }[] = [];
    const rows = d.prepare("SELECT * FROM queue_overrides WHERE ended_at IS NULL").all() as OverrideRow[];
    if (rows.length) {
      const going = d.prepare("SELECT 1 FROM generations WHERE id = ? AND status IN ('queued','running')");
      for (const r of rows.map(fromRow)) {
        if (r.until !== null && r.until <= now) {
          if (endOverride(r.id, "system", "expired", r.until)) ended.push({ action: "queue.override.end", target: r.target, detail: { id: r.id, kind: r.kind, action: r.action, why: "expired" } });
        } else if (r.kind === "run" && !r.generations.some((g) => going.get(g))) {
          if (endOverride(r.id, "system", "run-ended", now)) ended.push({ action: "queue.override.end", target: r.target, detail: { id: r.id, kind: r.kind, action: r.action, why: "run-ended" } });
        }
      }
    }
    const pools = poolModes(now);
    const over = Object.entries(pools).filter(([, s]) => s.until !== null && s.until <= now);
    if (over.length) {
      const kept = Object.fromEntries(Object.entries(pools).filter(([, s]) => !(s.until !== null && s.until <= now)));
      savePoolModes(kept);
      for (const [pool, s] of over) ended.push({ action: "queue.mode.end", target: `pool:${pool}`, detail: { was: s.mode, why: "expired", until: s.until } });
    }
    const workers = d.prepare("SELECT id, name, mode_json FROM relay_workers WHERE mode_json IS NOT NULL").all() as Pick<WorkerRow, "id" | "name" | "mode_json">[];
    for (const w of workers) {
      const s = workerModeOf(w);
      if (s && (s.until === null || s.until > now)) continue;
      if (d.prepare("UPDATE relay_workers SET mode_json = NULL WHERE id = ? AND mode_json = ?").run(w.id, w.mode_json).changes > 0 && s)
        ended.push({ action: "queue.mode.end", target: `worker:${w.id}`, detail: { worker: w.name, was: s.mode, why: "expired", until: s.until } });
    }
    const log = d.prepare("INSERT INTO admin_audit (at, actor, token_id, token_name, action, target, detail_json, status) VALUES (?, 'system', NULL, NULL, ?, ?, ?, 200)");
    for (const e of ended) log.run(now, e.action, e.target, JSON.stringify(e.detail));
  } catch (e) {
    console.warn(`[fuobe] Couldn't sweep the queue's controls: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Checking the owner's changes

export type ModeChange = { scope: "pool"; pool: string; setting: ModeSetting | null } | { scope: "worker"; worker: string; setting: ModeSetting | null };

/** A length in minutes: 1 to MAX_FOR_MIN, or null for "until I switch back". */
function forMinOf(v: unknown, now: number, required: boolean): { until: number | null } | { error: string } {
  if (v === undefined || v === null) return required ? { error: `forMin is 1 to ${MAX_FOR_MIN} minutes` } : { until: null };
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > MAX_FOR_MIN) return { error: `forMin is 1 to ${MAX_FOR_MIN} minutes${required ? "" : ", or null for until you switch it back"}` };
  return { until: now + v * 60_000 };
}

/**
 * POST /api/admin/queue/mode's body: `{ pool?: "pool", worker?: id, mode: QueueMode | null, forMin?: minutes | null }`.
 * `mode: null` is "Back to normal": the pool goes back to people first, a worker back to its pool's mode.
 */
export function checkModeChange(body: unknown, by: string, now = Date.now()): ModeChange | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Send the mode as an object" };
  const b = body as Record<string, unknown>;
  const unknown = Object.keys(b).filter((k) => !["pool", "worker", "mode", "forMin"].includes(k));
  if (unknown.length) return { error: `Unknown field: ${unknown[0].slice(0, 40)}` };
  if (b.pool !== undefined && b.worker !== undefined) return { error: "Name a pool or a worker, not both" };
  if (b.mode !== null && !isMode(b.mode)) return { error: `mode is one of ${QUEUE_MODES.join(", ")}, or null for back to normal` };
  let setting: ModeSetting | null = null;
  if (b.mode !== null) {
    const f = forMinOf(b.forMin, now, false);
    if ("error" in f) return f;
    setting = { mode: b.mode as QueueMode, until: f.until, by, at: now };
    // People first on a pool, with no end, is the default: stored as none.
    if (b.worker === undefined && setting.mode === DEFAULT_MODE && setting.until === null) setting = null;
  } else if (b.forMin !== undefined && b.forMin !== null) return { error: "Back to normal takes no forMin" };
  if (b.worker !== undefined) {
    if (typeof b.worker !== "string" || !WORKER.test(b.worker)) return { error: "worker is a worker's id" };
    return { scope: "worker", worker: b.worker, setting };
  }
  const pool = b.pool === undefined ? "pool" : b.pool;
  if (typeof pool !== "string" || !POOL.test(pool)) return { error: "pool is a pool's name" };
  return { scope: "pool", pool, setting };
}

/** Save a checked mode change. The worker's must exist (null: no such worker). Returns the mode before and after. */
export function applyModeChange(c: ModeChange, now = Date.now()): { before: EffectiveMode; after: EffectiveMode } | null {
  if (c.scope === "pool") {
    const before = poolMode(c.pool, now);
    const pools = poolModes(now);
    if (c.setting) pools[c.pool] = c.setting;
    else delete pools[c.pool];
    savePoolModes(pools);
    return { before, after: poolMode(c.pool, now) };
  }
  const d = db();
  const w = d.prepare("SELECT * FROM relay_workers WHERE id = ? AND kind = 'pool' AND revoked_at IS NULL").get(c.worker) as WorkerRow | undefined;
  if (!w) return null;
  const before = effectiveMode(w, now);
  d.prepare("UPDATE relay_workers SET mode_json = ? WHERE id = ?").run(c.setting ? JSON.stringify(c.setting) : null, w.id);
  return { before, after: effectiveMode({ ...w, mode_json: c.setting ? JSON.stringify(c.setting) : null }, now) };
}

export type OverrideInput =
  | { kind: "run"; generationId: string; action: "next" | "hold"; worker: string | null; until: number | null }
  | { kind: "person"; account?: string; person?: string; action: "boost" | "hold"; until: number | null };

/**
 * A person's key on the owner's Queue page: the same for all of one account's runs (or the guests'), and never their
 * account id (the queue view names no account).
 */
export const personKey = (account: string): string => `p-${crypto.createHash("sha256").update(`fuobe-person:${account}`).digest("hex").slice(0, 12)}`;
const PERSON = /^p-[0-9a-f]{12}$/;

/** The account a person's key stands for, among the accounts with a run on the GPUs now (null: none). */
export function accountOfPerson(key: string): string | null {
  const rows = db().prepare("SELECT DISTINCT account FROM relay_tasks WHERE account IS NOT NULL AND pools IS NOT NULL AND state IN ('waiting','sending','queued','running','collecting')").all() as { account: string }[];
  return rows.find((r) => personKey(r.account) === key)?.account ?? null;
}

/** An override as the admin API shows it: a person by their key (never an account id), a run by its id. */
export function overrideView(o: QueueOverride) {
  return {
    id: o.id,
    kind: o.kind,
    action: o.action,
    generationId: o.kind === "run" ? o.target : null,
    person: o.kind === "person" ? personKey(o.target) : null,
    guest: o.kind === "person" && o.target.startsWith("guest"),
    workerId: o.workerId,
    until: o.until,
    by: o.by,
    at: o.at,
    endedAt: o.endedAt,
    endedBy: o.endedBy,
    endWhy: o.endWhy,
  };
}
export type OverrideView = ReturnType<typeof overrideView>;

/**
 * POST /api/admin/queue/overrides's body:
 * - `{ kind: "run", generationId, action: "next", worker?, forMin? }`: the run goes first (on that worker only, when
 *   one is named), until a worker takes it (at most a day, or forMin);
 * - `{ kind: "run", generationId, action: "hold", forMin? }`: no worker takes it until the hold ends (forMin, or Release);
 * - `{ kind: "person", account, action: "boost", forMin }`: their runs go first for forMin minutes;
 * - `{ kind: "person", account, action: "hold", forMin? }`: no worker takes their runs until the hold ends.
 */
export function checkOverride(body: unknown, now = Date.now()): OverrideInput | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Send the change as an object" };
  const b = body as Record<string, unknown>;
  const unknown = Object.keys(b).filter((k) => !["kind", "generationId", "account", "person", "action", "worker", "forMin"].includes(k));
  if (unknown.length) return { error: `Unknown field: ${unknown[0].slice(0, 40)}` };
  if (b.kind === "run") {
    if (typeof b.generationId !== "string" || !GEN.test(b.generationId)) return { error: "generationId is a run's id" };
    if (b.action !== "next" && b.action !== "hold") return { error: "A run's action is next or hold" };
    if (b.account !== undefined || b.person !== undefined) return { error: "A run takes no account or person" };
    let worker: string | null = null;
    if (b.worker !== undefined && b.worker !== null) {
      if (b.action !== "next") return { error: "Only Run next is pinned to a worker" };
      if (typeof b.worker !== "string" || !WORKER.test(b.worker)) return { error: "worker is a worker's id" };
      worker = b.worker;
    }
    const f = forMinOf(b.forMin, now, false);
    if ("error" in f) return f;
    const until = b.action === "next" ? Math.min(f.until ?? now + NEXT_MAX_MS, now + NEXT_MAX_MS) : f.until;
    return { kind: "run", generationId: b.generationId, action: b.action, worker, until };
  }
  if (b.kind === "person") {
    const byKey = b.person !== undefined;
    if (byKey === (b.account !== undefined)) return { error: "Name the person by person (their key on the Queue page) or account, one of them" };
    if (byKey ? typeof b.person !== "string" || !PERSON.test(b.person) : typeof b.account !== "string" || !ACCOUNT.test(b.account)) return { error: byKey ? "person is a person's key from the Queue page" : "account is an account's id, or the guests' key" };
    if (b.action !== "boost" && b.action !== "hold") return { error: "A person's action is boost or hold" };
    if (b.generationId !== undefined || (b.worker !== undefined && b.worker !== null)) return { error: "A person takes no generationId or worker" };
    const f = forMinOf(b.forMin, now, b.action === "boost");
    if ("error" in f) return f;
    return { kind: "person", ...(byKey ? { person: b.person as string } : { account: b.account as string }), action: b.action, until: f.until };
  }
  return { error: "kind is run or person" };
}

/** SQL: row `g` was made by the same press of Run as the row asked about (pool.ts SAME_PRESS). */
const SAME_PRESS = "(CASE WHEN @hold IS NOT NULL THEN json_extract(g.request_json, '$.hold') IS @hold ELSE @batch IS NOT NULL AND g.batch_id IS @batch END)";

/** A run's rows: it and every other step the same press made (null: no such run). */
export function runRows(generationId: string): { generations: string[]; account: string | null; status: string } | null {
  const d = db();
  const g = d.prepare("SELECT id, status, batch_id, json_extract(request_json, '$.hold') AS hold, json_extract(request_json, '$.account') AS account FROM generations WHERE id = ?").get(generationId) as
    | { id: string; status: string; batch_id: string | null; hold: unknown; account: unknown }
    | undefined;
  if (!g) return null;
  const press = { hold: typeof g.hold === "string" && g.hold ? g.hold : null, batch: g.batch_id };
  const same = press.hold || press.batch ? (d.prepare(`SELECT g.id FROM generations g WHERE ${SAME_PRESS} AND g.status IN ('queued','running') LIMIT 64`).all(press) as { id: string }[]).map((r) => r.id) : [];
  return { generations: [...new Set([g.id, ...same])], account: typeof g.account === "string" ? g.account : null, status: g.status };
}

/**
 * Save a checked override. A run's must be one that still waits or runs; the worker it is pinned to must exist. A new
 * override of a run or a person ends the one it had (the newest wins). Returns the override and the ones it ended, or
 * the error to answer (404).
 */
export function addOverride(o: OverrideInput, by: string, now = Date.now()): { override: QueueOverride; replaced: QueueOverride[] } | { error: string; status: number } {
  const d = db();
  return d.transaction(() => {
    let generations: string[] = [];
    if (o.kind === "run") {
      const run = runRows(o.generationId);
      if (!run) return { error: "No such run", status: 404 };
      if (run.status !== "queued" && run.status !== "running") return { error: "That run has ended", status: 409 };
      generations = run.generations;
      if (o.worker && !d.prepare("SELECT 1 FROM relay_workers WHERE id = ? AND kind = 'pool' AND revoked_at IS NULL").get(o.worker)) return { error: "No such worker", status: 404 };
    }
    const target = o.kind === "run" ? o.generationId : (o.account ?? accountOfPerson(o.person!));
    if (!target) return { error: "That person has no run on the GPUs now", status: 404 };
    const replaced = (d.prepare("SELECT * FROM queue_overrides WHERE ended_at IS NULL AND kind = ? AND target = ?").all(o.kind, target) as OverrideRow[])
      .map((r) => endOverride(r.id, by, "replaced", now))
      .filter((r): r is QueueOverride => !!r);
    const row: OverrideRow = {
      id: crypto.randomBytes(6).toString("hex"),
      kind: o.kind,
      target,
      action: o.action,
      worker_id: o.kind === "run" ? o.worker : null,
      gens_json: o.kind === "run" ? JSON.stringify(generations) : null,
      until: o.until,
      set_by: by,
      set_at: now,
      ended_at: null,
      ended_by: null,
      end_why: null,
    };
    d.prepare(
      "INSERT INTO queue_overrides (id, kind, target, action, worker_id, gens_json, until, set_by, set_at) VALUES (@id, @kind, @target, @action, @worker_id, @gens_json, @until, @set_by, @set_at)",
    ).run(row);
    return { override: fromRow(row), replaced };
  })();
}

// ---------------------------------------------------------------------------
// The line with the controls

/** What the controls say about one task for one worker (or for the line as a whole: `workerId` null). */
export interface TaskControl {
  /** 0: a run sent next; 1: a boosted person's; 2: any other. Lower goes first, before the mode's classes. */
  tier: number;
  /** Not taken now: held (the run or the person), pinned to another worker, or the owner's own in People only. */
  out: null | "held" | "pinned" | "paused";
  /** The override that decides it, if one does. */
  by: QueueOverride | null;
}

/** The controls in effect for one look at the line: the mode, and the live overrides by run row and by person. */
export interface LineControls {
  mode: QueueMode;
  overrides: QueueOverride[];
  runs: Map<string, QueueOverride>;
  people: Map<string, QueueOverride>;
}

export function lineControls(mode: QueueMode, overrides: QueueOverride[]): LineControls {
  const runs = new Map<string, QueueOverride>();
  const people = new Map<string, QueueOverride>();
  for (const o of overrides) {
    if (o.kind === "run") for (const g of o.generations) runs.set(g, o);
    else people.set(o.target, o);
  }
  return { mode, overrides, runs, people };
}

/** Is this the default line (people first, no override): the claim and the place in line then read the line as before. */
export const plainLine = (c: LineControls) => c.mode === DEFAULT_MODE && c.overrides.length === 0;

/**
 * One task under the controls. A run's own override wins over its person's: a run sent next goes even while its person
 * is held, and a held run stays held while its person is boosted. The owner's own jobs in People only are paused,
 * unless the owner sent that run next.
 */
export function taskControl(t: Pick<TaskRow, "generation_id" | "account">, base: number, c: LineControls, workerId: string | null): TaskControl {
  const run = c.runs.get(t.generation_id) ?? null;
  if (run?.action === "hold") return { tier: 2, out: "held", by: run };
  if (run?.action === "next") {
    if (run.workerId && workerId && run.workerId !== workerId) return { tier: 2, out: "pinned", by: run };
    return { tier: 0, out: null, by: run };
  }
  const person = t.account ? (c.people.get(t.account) ?? null) : null;
  if (person?.action === "hold") return { tier: 2, out: "held", by: person };
  if (c.mode === "people-only" && base === 2) return { tier: 2, out: "paused", by: null };
  if (person?.action === "boost") return { tier: 1, out: null, by: person };
  return { tier: 2, out: null, by: null };
}

/** The generation ids and accounts the live overrides name: fetched beside the line's first rows, so none is missed. */
export function overrideTargets(c: LineControls): { generations: string[]; accounts: string[] } {
  const gens = c.overrides.filter((o) => o.kind === "run" && o.action === "next").flatMap((o) => o.generations);
  const accounts = c.overrides.filter((o) => o.kind === "person" && o.action === "boost").map((o) => o.target);
  return { generations: [...new Set(gens)].slice(0, 500), accounts: [...new Set(accounts)].slice(0, 100) };
}

/** Why a task stands where it does, in the owner's words ("Run next", "Boosted"); the override's `until` says until when. */
export function controlWords(tc: TaskControl, base: number, mode: QueueMode, workerName: (id: string) => string | null): string {
  const o = tc.by;
  if (tc.out === "held") return o?.kind === "person" ? "Held: this person's runs wait" : "Held by the owner";
  if (tc.out === "pinned") return `Pinned to ${workerName(o!.workerId!) ?? "another worker"}`;
  if (tc.out === "paused") return "Waits: People only";
  if (tc.tier === 0) return o?.workerId ? `Run next on ${workerName(o.workerId) ?? "its worker"}` : "Run next";
  if (tc.tier === 1) return "Boosted: this person's runs first";
  if (mode === "ours-first") return base === 2 ? "Our work first" : "After our work (Our work first)";
  if (mode === "balanced") return base === 0 ? "Paid run" : "Balanced: by when it came";
  return base === 0 ? "Paid run" : base === 1 ? "People first" : "Our work: after people's runs";
}
