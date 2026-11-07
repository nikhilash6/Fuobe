import "server-only";
import { WORKER_LOG_LIMITS, type WorkerLogLine } from "@/lib/relay";
import { db } from "../db";

/**
 * Each worker's timeline (worker_events, GET /api/admin/workers/events): its state changes, the jobs it took, sent back
 * and delivered, the stages of its active job, the answers to its claims, admin actions, its program's version and its
 * own log lines. Rows are only added, each on a change (never once per beat). Ids, times, plain words and small facts:
 * never a prompt, a token or an account's details. Every write is best-effort: a failure never fails a beat, a claim or
 * a report.
 */

export const EVENT_KINDS = ["state", "job", "stage", "looking", "admin", "version", "log"] as const;
export type WorkerEventKind = (typeof EVENT_KINDS)[number];

/** How long rows are kept: log lines a week, everything else 30 days. */
export const EVENTS_KEEP_MS = 30 * 24 * 60 * 60_000;
export const LOG_KEEP_MS = 7 * 24 * 60 * 60_000;

/** The stage of a worker's active job. */
export type JobStage = "sending" | "queued" | "loading" | "running" | "saving";

export interface NewWorkerEvent {
  kind: WorkerEventKind;
  event: string;
  workerId: string | null;
  words?: string | null;
  taskId?: string | null;
  generationId?: string | null;
  lane?: string | null;
  /** The worker's state then (default: its saved state). */
  state?: string | null;
  detail?: Record<string, unknown> | null;
  at?: number;
}

/** A row as the admin API answers it. */
export interface WorkerEvent {
  id: number;
  at: number;
  workerId: string | null;
  workerName: string | null;
  kind: WorkerEventKind;
  event: string;
  words: string | null;
  taskId: string | null;
  generationId: string | null;
  lane: string | null;
  laneLabel: string | null;
  state: string | null;
  detail: Record<string, unknown> | null;
}

/** Names for a lane and for a run's model, set by pool.ts (which knows the catalog). */
let names: { lane: (lane: string) => string | null; run: (generationId: string) => string | null } = { lane: () => null, run: () => null };
export const setEventNames = (n: typeof names) => (names = n);
export const laneName = (lane: string | null | undefined): string | null => {
  if (!lane) return null;
  try {
    return names.lane(lane);
  } catch {
    return null;
  }
};
const runName = (generationId: string | null | undefined): string | null => {
  if (!generationId) return null;
  try {
    return names.run(generationId);
  } catch {
    return null;
  }
};

declare global {
  var __fuobeWorkerEventsPruned: number | undefined;
}

const cap = (s: string | null | undefined, n: number) => (typeof s === "string" && s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : null);

/** Add rows to worker_events (best-effort). Each row's worker name and state are read once per worker. Returns the last id. */
export function logWorkerEvents(rows: NewWorkerEvent[], now = Date.now()): number | null {
  if (!rows.length) return null;
  try {
    const d = db();
    const ins = d.prepare("INSERT INTO worker_events (at, worker_id, worker_name, kind, event, words, task_id, generation_id, lane, state, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const seen = new Map<string, { name: string | null; state: string | null }>();
    const who = (id: string) => {
      let w = seen.get(id);
      if (!w) {
        const r = d.prepare("SELECT name, state FROM relay_workers WHERE id = ?").get(id) as { name: string; state: string } | undefined;
        w = { name: r?.name ?? null, state: r?.state ?? null };
        seen.set(id, w);
      }
      return w;
    };
    let last: number | null = null;
    for (const e of rows) {
      const w = e.workerId ? who(e.workerId) : { name: null, state: null };
      const detail = e.detail && Object.keys(e.detail).length ? JSON.stringify(e.detail) : null;
      last = Number(
        ins.run(
          e.at ?? now,
          e.workerId,
          w.name,
          e.kind,
          e.event.slice(0, 32),
          cap(e.words, e.kind === "log" ? WORKER_LOG_LIMITS.lineChars : 500),
          e.taskId ?? null,
          e.generationId ?? null,
          e.lane ?? null,
          e.state === undefined ? w.state : e.state,
          detail && detail.length <= 2000 ? detail : null,
        ).lastInsertRowid,
      );
    }
    if (now - (globalThis.__fuobeWorkerEventsPruned ?? 0) > 24 * 60 * 60_000) {
      globalThis.__fuobeWorkerEventsPruned = now;
      pruneWorkerEvents(now);
    }
    return last;
  } catch (e) {
    console.warn(`[fuobe] Couldn't write a worker's timeline: ${(e as Error).message}`);
    return null;
  }
}

export const logWorkerEvent = (e: NewWorkerEvent, now = Date.now()) => logWorkerEvents([e], now);

/** Remove log lines older than a week and every other row older than 30 days. */
export function pruneWorkerEvents(now = Date.now()): void {
  try {
    const d = db();
    d.prepare("DELETE FROM worker_events WHERE at < ?").run(now - EVENTS_KEEP_MS);
    d.prepare("DELETE FROM worker_events WHERE kind = 'log' AND at < ?").run(now - LOG_KEEP_MS);
  } catch (e) {
    console.warn(`[fuobe] Couldn't prune the workers' timeline: ${(e as Error).message}`);
  }
}

/** The last row of one kind for a worker (an indexed read), or null. */
export function lastOfKind(workerId: string, kind: WorkerEventKind): { event: string; words: string | null; at: number } | null {
  try {
    return (db().prepare("SELECT event, words, at FROM worker_events WHERE worker_id = ? AND kind = ? ORDER BY id DESC LIMIT 1").get(workerId, kind) as { event: string; words: string | null; at: number } | undefined) ?? null;
  } catch {
    return null;
  }
}

/** The last stage row of a task, or null. */
export function lastStage(taskId: string): { event: string; workerId: string | null; at: number } | null {
  try {
    const r = db().prepare("SELECT event, worker_id, at FROM worker_events WHERE task_id = ? AND kind = 'stage' ORDER BY id DESC LIMIT 1").get(taskId) as { event: string; worker_id: string | null; at: number } | undefined;
    return r ? { event: r.event, workerId: r.worker_id, at: r.at } : null;
  } catch {
    return null;
  }
}

/** A worker's latest row other than a log line (the newest of each kind's last row), or null. */
export function lastEventOf(workerId: string): { at: number; kind: WorkerEventKind; event: string; words: string | null } | null {
  try {
    const q = db().prepare("SELECT id, at, kind, event, words FROM worker_events WHERE worker_id = ? AND kind = ? ORDER BY id DESC LIMIT 1");
    let best: { id: number; at: number; kind: WorkerEventKind; event: string; words: string | null } | undefined;
    for (const k of EVENT_KINDS) {
      if (k === "log") continue;
      const r = q.get(workerId, k) as typeof best;
      if (r && (!best || r.id > best.id)) best = r;
    }
    return best ? { at: best.at, kind: best.kind, event: best.event, words: best.words } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Job rows: the words beside each worker_jobs row

const secs = (ms: number) => (ms < 90_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);

/** A job row's words: "Took a Flux 2 run", "Sent back in line: went silent", "Delivered after 42 s". */
export function jobWords(
  event: string,
  t: { generation_id?: string | null; lane?: string | null; claimed_at?: number | null; finish_json?: string | null },
  o: { execMs?: number; why?: string; now: number },
): string {
  const what = t.finish_json ? "finishing job" : `${runName(t.generation_id) ?? laneName(t.lane) ?? "job"} run`.replace(/^job run$/, "job");
  switch (event) {
    case "claimed":
      return `Took a ${what}`;
    case "requeued":
      return `Sent back in line${o.why ? `: ${o.why}` : ""}`;
    case "finished":
      return o.execMs ? `Finished on its ComfyUI in ${secs(o.execMs)}` : "Finished on its ComfyUI";
    case "done":
      return t.claimed_at ? `Delivered after ${secs(Math.max(0, o.now - t.claimed_at))}` : "Delivered";
    case "failed":
      return `Failed${o.why ? `: ${o.why}` : ""}`;
    case "canceled":
      return "Stopped";
    default:
      return event;
  }
}

// ---------------------------------------------------------------------------
// Log lines: masked again here, whatever the worker did

const MODEL_FILE = /\.(safetensors|sft|ckpt|pt|pth|bin|gguf|onnx|pkl)$/i;
const MODEL_NAME = /[\w.-]+\.(safetensors|sft|ckpt|pt|pth|bin|gguf|onnx|pkl)\b/gi;
const fileWord = (p: string) => {
  const base = p.split(/[\\/]/).filter(Boolean).pop() ?? "";
  return MODEL_FILE.test(base) ? base : "[file]";
};
const LONG_TOKEN = /[A-Za-z0-9_-]{32,}/g;
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()[\]\u0000]+/gi;
const KEY_RE = /\b(token|api[_-]?key|key|secret|password|passwd|pwd|authorization|auth|cookie|session)(\s*[:=]\s*)(?!Bearer\b)("[^"]*"|'[^']*'|[^\s"',;]+)/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const WIN_PATH = /(?:\b[A-Za-z]:|\\\\[^\\\s\u0000]+)[\\/](?:[^\\/:*?"<>|\u0000\r\n]*[^\\/:*?"<>|\u0000\s][\\/])*[^\\/:*?"<>|()\s\u0000]*/g;
const POSIX_PATH = /(^|[\s("'=,[])(~?\/(?:[^/\s"'<>()\u0000]+\/)*[^/\s"'<>()\u0000]+)/g;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;

function cleanUrl(u: string): string {
  try {
    const x = new URL(u);
    return `${x.protocol}//${x.host}${x.pathname.replace(LONG_TOKEN, "[hidden]")}${x.search || x.hash ? "?[hidden]" : ""}`;
  } catch {
    return "[url]";
  }
}

/**
 * A log line as it may be kept: no tokens, keys or bearer strings, no emails, no full file paths (a model file keeps
 * its base name, anything else is "[file]"), URLs without their query, long quoted text hidden, one line of at most
 * `max` characters. The worker program does the same (bin/lib/worker/log-ring.mjs maskLine).
 */
export function maskLogLine(raw: unknown, max: number = WORKER_LOG_LIMITS.lineChars): string {
  if (typeof raw !== "string") return "";
  let s = raw.slice(0, 2000).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/[\x00-\x1f\x7f]/g, " ");
  // What is already safe (a cleaned URL, a file's word, a model file's name) waits aside, so later rules leave it.
  const kept: string[] = [];
  const keep = (v: string) => `\u0000${kept.push(v) - 1}\u0000`;
  s = s.replace(URL_RE, (u) => keep(cleanUrl(u)));
  s = s.replace(/\bBearer\s+[^\s"',;]+/gi, "Bearer [hidden]");
  s = s.replace(KEY_RE, "$1$2[hidden]");
  s = s.replace(EMAIL_RE, "[email]");
  s = s.replace(WIN_PATH, (p) => keep(fileWord(p)));
  s = s.replace(POSIX_PATH, (_m, pre: string, p: string) => pre + keep(fileWord(p)));
  s = s.replace(MODEL_NAME, (m) => keep(m));
  s = s.replace(JWT, "[hidden]");
  s = s.replace(LONG_TOKEN, "[hidden]");
  s = s.replace(/"[^"]{60,}"/g, '"[text]"');
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => kept[Number(i)] ?? "[hidden]");
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const LEVELS = new Set(["info", "warn", "error"]);

/** A beat's `log` as it may be kept: at most perBeat lines, each masked, its time never later than `now`. */
export function cleanLogLines(v: unknown, now = Infinity): WorkerLogLine[] {
  if (!Array.isArray(v)) return [];
  const out: WorkerLogLine[] = [];
  for (const x of v.slice(0, WORKER_LOG_LIMITS.perBeat)) {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const line = maskLogLine(o.line);
    if (!line) continue;
    const at = typeof o.at === "number" && Number.isFinite(o.at) && o.at > 0 ? Math.min(o.at, now) : Math.min(Date.now(), now);
    out.push({ at, level: (LEVELS.has(o.level as string) ? o.level : "info") as WorkerLogLine["level"], line });
  }
  return out;
}

// ---------------------------------------------------------------------------
// GET /api/admin/workers/events

export interface WorkerEventQuery {
  limit: number;
  before?: number;
  after?: number;
  worker?: string;
  generation?: string;
  kinds?: WorkerEventKind[];
}

/**
 * The timeline query from a URL: `worker`, `kinds` (a comma list of EVENT_KINDS; all when not given), `before` and
 * `after` (row ids), `generation` (a run id), `limit` (1 to 500, 100 when not given).
 */
export function workerEventsQueryFrom(sp: URLSearchParams): WorkerEventQuery | { error: string } {
  const id = (k: string) => {
    const v = sp.get(k);
    return v === null ? undefined : /^\d{1,15}$/.test(v) ? Number(v) : null;
  };
  const before = id("before");
  if (before === null) return { error: "before is a row id" };
  const after = id("after");
  if (after === null) return { error: "after is a row id" };
  const raw = sp.get("limit");
  const limit = raw === null ? 100 : Math.trunc(Number(raw));
  if (!Number.isFinite(limit) || limit < 1 || limit > 500) return { error: "limit is 1 to 500" };
  const worker = sp.get("worker");
  if (worker !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(worker)) return { error: "worker is a worker id" };
  const generation = sp.get("generation");
  if (generation !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(generation)) return { error: "generation is a run id" };
  const k = sp.get("kinds");
  let kinds: WorkerEventKind[] | undefined;
  if (k !== null && k.trim() !== "") {
    const list = [...new Set(k.split(",").map((x) => x.trim()).filter(Boolean))];
    const bad = list.find((x) => !(EVENT_KINDS as readonly string[]).includes(x));
    if (bad) return { error: `kinds are ${EVENT_KINDS.join(", ")}` };
    kinds = list as WorkerEventKind[];
  }
  return {
    limit,
    ...(before !== undefined && { before }),
    ...(after !== undefined && { after }),
    ...(worker !== null && { worker }),
    ...(generation !== null && { generation }),
    ...(kinds && { kinds }),
  };
}

type EventRowDb = { id: number; at: number; worker_id: string | null; worker_name: string | null; kind: WorkerEventKind; event: string; words: string | null; task_id: string | null; generation_id: string | null; lane: string | null; state: string | null; detail_json: string | null };

const parseDetail = (s: string | null): Record<string, unknown> | null => {
  if (!s) return null;
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * The timeline, newest first. `next`: the last row's id when the page is full (pass it as `before`; with `after` too, it
 * fills the gap), else null. `latest`: the newest row id of the whole timeline (pass it as `after` to poll), 0 when empty.
 */
export function listWorkerEvents(q: WorkerEventQuery): { items: WorkerEvent[]; next: string | null; latest: number } {
  const filters: [string, unknown[]][] = [];
  if (q.before !== undefined) filters.push(["id < ?", [q.before]]);
  if (q.after !== undefined) filters.push(["id > ?", [q.after]]);
  if (q.worker !== undefined) filters.push(["worker_id = ?", [q.worker]]);
  if (q.generation !== undefined) filters.push(["generation_id = ?", [q.generation]]);
  if (q.kinds?.length && q.kinds.length < EVENT_KINDS.length) filters.push([`kind IN (${q.kinds.map(() => "?").join(",")})`, q.kinds]);
  const where = filters.length ? `WHERE ${filters.map((f) => f[0]).join(" AND ")}` : "";
  const d = db();
  const rows = d.prepare(`SELECT * FROM worker_events ${where} ORDER BY id DESC LIMIT ?`).all(...filters.flatMap((f) => f[1]), q.limit) as EventRowDb[];
  const latest = (d.prepare("SELECT MAX(id) AS id FROM worker_events").get() as { id: number | null }).id ?? 0;
  const labels = new Map<string, string | null>();
  const label = (lane: string | null) => {
    if (!lane) return null;
    if (!labels.has(lane)) labels.set(lane, laneName(lane));
    return labels.get(lane)!;
  };
  return {
    items: rows.map((r) => ({
      id: r.id,
      at: r.at,
      workerId: r.worker_id,
      workerName: r.worker_name,
      kind: r.kind,
      event: r.event,
      words: r.words,
      taskId: r.task_id,
      generationId: r.generation_id,
      lane: r.lane,
      laneLabel: label(r.lane),
      state: r.state,
      detail: parseDetail(r.detail_json),
    })),
    next: rows.length === q.limit ? String(rows[rows.length - 1].id) : null,
    latest,
  };
}
