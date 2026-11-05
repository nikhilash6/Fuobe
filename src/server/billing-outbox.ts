import "server-only";
import crypto from "node:crypto";
import { db } from "./db";
import { billingConfigured, forgetBalance, sendReport, type RefundReport, type SettleReport } from "./billing";

/**
 * The billing outbox: every report the billing service must get (settle, refund, release) is written here first, then
 * sent, and sent again with backoff until the service takes it (for 7 days). A report is known by its key (the run
 * row's id, or "release:<hold>"), so a row is reported once however often the sweep runs, and a restart in between
 * loses nothing: the sweep finds every finished row with a hold and no report from what is stored. An app process
 * takes a report before it sends it, so two processes on one database (a deploy's overlap) never send the same one.
 *
 * A hold's rows are reported once none of them is still queued or running, each with `rows` (how many rows share the
 * hold), so the service closes the hold when the last report arrives.
 */

const BACKOFF_START_MS = 10_000;
const BACKOFF_MAX_MS = 10 * 60_000;
const GIVE_UP_MS = 7 * 24 * 3_600_000;
/** A report that keeps failing this long is logged as an alert. */
const ALERT_AFTER_MS = 10 * 60_000;

interface DoneRow {
  id: string;
  status: "succeeded" | "failed" | "canceled";
  error: string | null;
  outputs_json: string;
  external_id: string | null;
  cost_usd: number | null;
  hold: string;
  started_at: number | null;
  completed_at: number | null;
  check_state: string | null;
  /**
   * A run on the workers: their measured time on its jobs (each job's last finished attempt, the one whose result was
   * kept), and the GPU of the last one (the workers' log).
   */
  exec_ms: number | null;
  exec_device: string | null;
  /** 1 when the run's jobs went to the workers, whether or not one of them finished there. */
  on_workers: number;
}

/** Where a row stands in the output check, for its report: hidden, never checked in time, or nothing to say. */
function checkStatus(state: string | null): "hidden" | "unchecked" | null {
  return state === "hidden" ? "hidden" : state === "unchecked" ? "unchecked" : null;
}

/** Megapixels of a result's largest picture or clip frame, when its size is known. */
function megapixels(outputs: { width?: number; height?: number }[]): number | null {
  let best = 0;
  for (const o of outputs) if (o.width && o.height) best = Math.max(best, (o.width * o.height) / 1e6);
  return best ? Math.round(best * 100) / 100 : null;
}

/** Write a report for every finished row of every hold whose rows are all finished. Returns how many were written. */
export function queueReports(now = Date.now(), limit = 200): number {
  const d = db();
  const rows = d
    .prepare(
      `SELECT g.id, g.status, g.error, g.outputs_json, g.external_id, g.cost_usd, g.completed_at,
              json_extract(g.request_json, '$.hold') AS hold, r.started_at AS started_at,
              (SELECT state FROM output_checks c WHERE c.generation_id = g.id AND c.state IN ('hidden', 'unchecked') LIMIT 1) AS check_state,
              (SELECT SUM(j.exec_ms) FROM worker_jobs j WHERE j.generation_id = g.id AND j.event = 'finished' AND j.exec_ms IS NOT NULL
                 AND j.id = (SELECT MAX(k.id) FROM worker_jobs k WHERE k.task_id = j.task_id AND k.event = 'finished' AND k.exec_ms IS NOT NULL)) AS exec_ms,
              (SELECT j.device FROM worker_jobs j WHERE j.generation_id = g.id AND j.event = 'finished' AND j.device IS NOT NULL ORDER BY j.id DESC LIMIT 1) AS exec_device,
              EXISTS (SELECT 1 FROM relay_tasks t WHERE t.generation_id = g.id AND t.pools IS NOT NULL) AS on_workers
       FROM generations g LEFT JOIN generation_runs r ON r.id = g.id
       WHERE json_extract(g.request_json, '$.hold') IS NOT NULL
         AND g.status IN ('succeeded', 'failed', 'canceled')
         AND NOT EXISTS (SELECT 1 FROM billing_outbox o WHERE o.key = g.id)
         AND NOT EXISTS (SELECT 1 FROM generations h WHERE json_extract(h.request_json, '$.hold') = json_extract(g.request_json, '$.hold') AND h.status IN ('queued', 'running'))
       ORDER BY g.completed_at LIMIT ?`,
    )
    .all(limit) as DoneRow[];
  if (!rows.length) return 0;
  const count = d.prepare("SELECT COUNT(*) AS n FROM generations WHERE json_extract(request_json, '$.hold') = ?");
  const insert = d.prepare("INSERT OR IGNORE INTO billing_outbox (key, kind, hold_id, payload_json, tries, next_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)");
  let written = 0;
  d.transaction(() => {
    for (const r of rows) {
      const n = (count.get(r.hold) as { n: number }).n;
      // A run on the workers: the time their ComfyUI spent on its jobs, as they measured it (no waits, no files, no
      // upload), never its time in line; null when none of its jobs finished there. Anything else: from its start to its
      // end, as before.
      const gpuMs = r.on_workers || r.exec_ms !== null ? r.exec_ms : r.started_at && r.completed_at && r.completed_at > r.started_at ? r.completed_at - r.started_at : null;
      const device = r.exec_device ?? null;
      const outputs = (() => {
        try {
          return JSON.parse(r.outputs_json) as { width?: number; height?: number }[];
        } catch {
          return [];
        }
      })();
      const checked = checkStatus(r.check_state);
      if (r.status === "succeeded" && !checked) {
        const report: SettleReport = {
          holdId: r.hold,
          generationId: r.id,
          rows: n,
          status: "succeeded",
          final: { outputs: outputs.length, megapixels: megapixels(outputs), seconds: null },
          providerUsd: r.cost_usd,
          gpuMs,
          device,
          reachedProvider: !!r.external_id,
        };
        written += insert.run(r.id, "settle", r.hold, JSON.stringify(report), now, now).changes;
      } else {
        const report: RefundReport = {
          holdId: r.hold,
          generationId: r.id,
          rows: n,
          status: checked ?? (r.status === "canceled" ? "canceled" : "failed"),
          reason: (r.error ?? "").slice(0, 500),
          reachedProvider: !!r.external_id,
          gpuMs,
          device,
        };
        written += insert.run(r.id, "refund", r.hold, JSON.stringify(report), now, now).changes;
      }
    }
  })();
  return written;
}

/** A hold whose rows were never made (createGenerations threw): the whole amount goes back. */
export function queueRelease(holdId: string, now = Date.now()): void {
  db()
    .prepare("INSERT OR IGNORE INTO billing_outbox (key, kind, hold_id, payload_json, tries, next_at, created_at) VALUES (?, 'release', ?, ?, 0, ?, ?)")
    .run(`release:${holdId}`, holdId, JSON.stringify({ holdId, reason: "not-created" }), now, now);
  // Sent now, not at the next tick (the runner may not be running yet).
  void sweepBilling();
}

/**
 * How long a release by request id waits before it is sent: a reserve the app stopped waiting for may still be on its
 * way to the service, and the release must come after it.
 */
export const REQUEST_RELEASE_AFTER_MS = 60_000;

/**
 * A hold the app may not know of: a reserve whose tries got no clear answer (billing.ts reserve `unsure`), so nothing
 * was made. The service releases whatever it holds for that request id (none: nothing to do). Sent after
 * REQUEST_RELEASE_AFTER_MS.
 */
export function queueRequestRelease(requestId: string, now = Date.now()): void {
  db()
    .prepare("INSERT OR IGNORE INTO billing_outbox (key, kind, hold_id, payload_json, tries, next_at, created_at) VALUES (?, 'release', '', ?, 0, ?, ?)")
    .run(`release:request:${requestId}`, JSON.stringify({ requestId, reason: "not-created" }), now + REQUEST_RELEASE_AFTER_MS, now);
}

interface OutboxRow {
  key: string;
  kind: "settle" | "refund" | "release";
  hold_id: string;
  payload_json: string;
  tries: number;
  created_at: number;
}

/** How long an app process holds a report it is sending (a send takes 5 s at most: billing.ts BILLING_TIMEOUTS.report). */
const SEND_TURN_MS = 60_000;

declare global {
  /** This app process, as the reports it is sending name it. */
  var __fuobeOutboxToken: string | undefined;
}

const outboxToken = () => (globalThis.__fuobeOutboxToken ??= `${process.pid}:${crypto.randomUUID()}`);

/**
 * Take a report to send it: only one not sent yet, that no other app process is sending now (two processes on one
 * database during a deploy's overlap never send the same report, so the service gets each one once).
 */
function claimReport(key: string): boolean {
  const now = Date.now();
  const me = outboxToken();
  return (
    db()
      .prepare("UPDATE billing_outbox SET sending_by = ?, sending_until = ? WHERE key = ? AND done_at IS NULL AND (sending_until IS NULL OR sending_until < ? OR sending_by = ?)")
      .run(me, now + SEND_TURN_MS, key, now, me).changes > 0
  );
}

/**
 * Send the reports that are due. Returns how many the service took. A sweep of this process that is sending now is
 * waited for first: the reports it holds are skipped below, and would otherwise still be on their way when this returns.
 */
export async function drainOutbox(now = Date.now(), limit = 50): Promise<number> {
  const going = globalThis.__fuobeBillingSweep;
  if (going) await going;
  return drainDue(now, limit);
}

async function drainDue(now: number, limit = 50): Promise<number> {
  const d = db();
  const due = d
    .prepare("SELECT key, kind, hold_id, payload_json, tries, created_at FROM billing_outbox WHERE done_at IS NULL AND next_at <= ? AND (sending_until IS NULL OR sending_until < ?) ORDER BY next_at LIMIT ?")
    .all(now, Date.now(), limit) as OutboxRow[];
  let sent = 0;
  for (const r of due) {
    if (!claimReport(r.key)) continue;
    try {
      await sendReport(r.kind, JSON.parse(r.payload_json));
      d.prepare("UPDATE billing_outbox SET done_at = ?, tries = tries + 1, last_error = NULL, sending_until = NULL, sending_by = NULL WHERE key = ?").run(Date.now(), r.key);
      sent++;
      const account = accountOfHold(r.hold_id);
      if (account) forgetBalance(account);
    } catch (e) {
      const tries = r.tries + 1;
      const wait = Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** Math.min(tries - 1, 16));
      const age = now - r.created_at;
      if (age >= GIVE_UP_MS) {
        // Kept, marked as given up: the service's own hold sweep releases what it held.
        d.prepare("UPDATE billing_outbox SET done_at = ?, tries = ?, last_error = ?, gave_up = 1, sending_until = NULL, sending_by = NULL WHERE key = ?").run(now, tries, (e as Error).message.slice(0, 500), r.key);
        console.warn(`[fuobe] billing: gave up sending ${r.kind} ${r.key} after 7 days`);
        continue;
      }
      d.prepare("UPDATE billing_outbox SET tries = ?, next_at = ?, last_error = ?, sending_until = NULL, sending_by = NULL WHERE key = ?").run(tries, now + wait, (e as Error).message.slice(0, 500), r.key);
      if (age >= ALERT_AFTER_MS) console.warn(`[fuobe] billing: ${r.kind} ${r.key} still not sent after ${Math.round(age / 60_000)} min: ${(e as Error).message}`);
    }
  }
  return sent;
}

/** The account a hold's rows belong to (to read its balance again). */
function accountOfHold(holdId: string): string | undefined {
  const r = db().prepare("SELECT json_extract(request_json, '$.account') AS account FROM generations WHERE json_extract(request_json, '$.hold') = ? LIMIT 1").get(holdId) as { account: string | null } | undefined;
  return r?.account ?? undefined;
}

declare global {
  /** This process's outbox sweep while it runs. */
  var __fuobeBillingSweep: Promise<void> | undefined;
}

/** One outbox sweep (the runner's tick): write what is due, send what is due. One at a time: a call meanwhile waits for it. */
export function sweepBilling(now = Date.now()): Promise<void> {
  if (globalThis.__fuobeBillingSweep) return globalThis.__fuobeBillingSweep;
  // Reports wait for a service: with none set, nothing is written (a hold can only exist while one was set).
  if (!billingConfigured()) return Promise.resolve();
  const sweep: Promise<void> = (async () => {
    // (Set as this process's sweep before any of it runs.)
    await null;
    try {
      queueReports(now);
      await drainDue(now);
    } catch (e) {
      console.warn(`[fuobe] billing sweep: ${(e as Error).message}`);
    } finally {
      if (globalThis.__fuobeBillingSweep === sweep) globalThis.__fuobeBillingSweep = undefined;
    }
  })();
  globalThis.__fuobeBillingSweep = sweep;
  return sweep;
}

/** How many reports wait, and since when (for the admin queue view). */
export function outboxDepth(): { pending: number; oldestAt: number | null } {
  const r = db().prepare("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM billing_outbox WHERE done_at IS NULL").get() as { n: number; oldest: number | null };
  return { pending: r.n, oldestAt: r.oldest };
}
