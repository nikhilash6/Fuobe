import "server-only";
import crypto from "node:crypto";
import { ACTIVE_RUNS_CODE } from "@/lib/guest-access";
import { ACCOUNT_LIMITS, ACCOUNT_MESSAGES } from "./account-files";
import { LoginGuard } from "./auth";
import type { Policy } from "./billing";
import { db } from "./db";

/**
 * The limits on an account's runs, counted in SQLite so that requests that arrive together, in one process or in two
 * (a deploy runs the old and the new server side by side for a moment), can never pass them together.
 *
 * - Every account run, wherever it goes: the studio's own limit of runs at once (ACCOUNT_LIMITS.activeRuns), as before.
 * - A run on this install's GPUs (hosted runs): also the policy's limits, counted on runs there only, never on runs on
 *   the account's own GPU or its own key: runs at once (`activeRuns`), runs waiting in line (`waiting`), runs started in
 *   the last hour (`runsPerHour`), and runs started from one client address in the last hour (`addressRunsPerHour`).
 *   0 or absent: no such limit.
 *
 * A run is one press of Run: its jobs and the steps its chains queue share a batch and count once.
 *
 * admitRun counts and makes the run's rows in one `BEGIN IMMEDIATE` transaction: SQLite lets one writer in at a time,
 * across processes, so the count it reads is the count it adds to.
 */

const HOUR = 60 * 60_000;
/** Started runs are kept this long for the hourly counts. */
const KEEP_MS = 2 * HOUR;

/** What a person reads when a limit on runs on this install's GPUs stops a run (plain words, no numbers of the studio's). */
export const POOL_LIMIT_WORDS = {
  active: (n: number) => `You have ${n} ${n === 1 ? "run" : "runs"} going. Start this one when one finishes.`,
  waiting: (n: number) => `You have ${n} ${n === 1 ? "run" : "runs"} in line. Start this one when one of them starts.`,
  hourly: "That's a lot of runs this hour. Try again later.",
  address: "That's a lot of runs from your network this hour. Try again later.",
};

export interface LimitRefusal {
  status: 429;
  error: string;
  code: string;
  retryAfterS: number;
}

/** An account's runs going now (queued or running), wherever they run: a run's jobs and chain steps share a batch. */
export function accountActiveRuns(accountId: string): number {
  const r = db()
    .prepare("SELECT COUNT(DISTINCT COALESCE(batch_id, id)) AS n FROM generations WHERE status IN ('queued', 'running') AND json_extract(request_json, '$.account') = ?")
    .get(accountId) as { n: number };
  return r.n;
}

/** An account's runs going now on this install's GPUs, and how many of them haven't started yet (no row of theirs has). */
export function poolRunCounts(accountId: string): { active: number; waiting: number } {
  const r = db()
    .prepare(
      `SELECT COUNT(*) AS active, COALESCE(SUM(CASE WHEN started = 0 THEN 1 ELSE 0 END), 0) AS waiting FROM (
         SELECT COALESCE(g.batch_id, g.id) AS k, MAX(CASE WHEN r.started_at IS NOT NULL THEN 1 ELSE 0 END) AS started
         FROM generations g LEFT JOIN generation_runs r ON r.id = g.id
         WHERE g.status IN ('queued', 'running') AND json_extract(g.request_json, '$.account') = ? AND json_extract(g.request_json, '$.place') = 'pool'
         GROUP BY k)`,
    )
    .get(accountId) as { active: number; waiting: number };
  return { active: r.active, waiting: r.waiting };
}

declare global {
  var __fuobeAddressSalt: { db: unknown; salt: string } | undefined;
}

/**
 * The salt the client addresses are kept under: made once per install, never sent anywhere. Read (and made, the first
 * time) once per process and database, so counting an address never takes the database's write lock again.
 */
function salt(): string {
  const d = db();
  const kept = globalThis.__fuobeAddressSalt;
  if (kept?.db === d) return kept.salt;
  const read = () => (d.prepare("SELECT value FROM settings WHERE key = 'pool.addressSalt'").get() as { value: string } | undefined)?.value;
  let value = read();
  if (!value) {
    d.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('pool.addressSalt', ?)").run(crypto.randomBytes(32).toString("hex"));
    value = read()!;
  }
  globalThis.__fuobeAddressSalt = { db: d, salt: value };
  return value;
}

/**
 * The client's address as the hourly count keeps it (a salted hash, never the address), or null when clients can't be
 * told apart (no trusted proxy: every request would count as one client).
 */
export function clientAddress(request: Request): string | null {
  const key = LoginGuard.clientKey(request.headers);
  if (key === LoginGuard.DIRECT) return null;
  return crypto.createHmac("sha256", salt()).update(key).digest("hex").slice(0, 32);
}

const since = (column: "account" | "addr", value: string, from: number) =>
  db().prepare(`SELECT COUNT(*) AS n, MIN(at) AS oldest FROM pool_admissions WHERE ${column} = ? AND at > ?`).get(value, from) as { n: number; oldest: number | null };

/** Seconds until the oldest of an hour's runs leaves the hour. */
const retryAfter = (oldest: number | null, now: number) => Math.max(60, Math.ceil(((oldest ?? now) + HOUR - now) / 1000));

/**
 * The first of the policy's limits this run would pass, or null. `addr` may be a function: it is asked only when the
 * policy counts runs per address.
 */
export function poolLimitRefusal(accountId: string, policy: Pick<Policy, "limits">, addr: string | null | (() => string | null), now = Date.now()): LimitRefusal | null {
  const lim = policy.limits ?? ({} as Policy["limits"]);
  const positive = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const activeMax = positive(lim.activeRuns);
  const waitingMax = positive(lim.waiting);
  const hourMax = positive(lim.runsPerHour);
  const addrMax = positive(lim.addressRunsPerHour);
  if (activeMax || waitingMax) {
    const c = poolRunCounts(accountId);
    if (activeMax && c.active >= activeMax) return { status: 429, error: POOL_LIMIT_WORDS.active(c.active), code: ACTIVE_RUNS_CODE, retryAfterS: 30 };
    if (waitingMax && c.waiting >= waitingMax) return { status: 429, error: POOL_LIMIT_WORDS.waiting(c.waiting), code: ACTIVE_RUNS_CODE, retryAfterS: 30 };
  }
  if (hourMax) {
    const h = since("account", accountId, now - HOUR);
    if (h.n >= hourMax) return { status: 429, error: POOL_LIMIT_WORDS.hourly, code: "limit", retryAfterS: retryAfter(h.oldest, now) };
  }
  const address = addrMax ? (typeof addr === "function" ? addr() : addr) : null;
  if (address) {
    const h = since("addr", address, now - HOUR);
    if (h.n >= addrMax) return { status: 429, error: POOL_LIMIT_WORDS.address, code: "limit", retryAfterS: retryAfter(h.oldest, now) };
  }
  return null;
}

/** The studio's own limit of runs at once (every account run, wherever it goes), as a refusal. */
function accountLimitRefusal(accountId: string): LimitRefusal | null {
  return accountActiveRuns(accountId) >= ACCOUNT_LIMITS.activeRuns ? { status: 429, error: ACCOUNT_MESSAGES.activeRuns, code: ACTIVE_RUNS_CODE, retryAfterS: 30 } : null;
}

/** A refusal thrown inside admitRun's transaction, so nothing `make` wrote is kept. */
export class AdmitRefused extends Error {
  constructor(readonly refusal: LimitRefusal | { status: number; error: string; code: string; retryAfterS?: number }) {
    super(refusal.error);
  }
}

/**
 * Count, and make the run (`make`) only if it fits: the studio's own limit for every account run, and with `pool` the
 * policy's limits on runs on this install's GPUs. All in one BEGIN IMMEDIATE transaction; a run on this install's GPUs is
 * noted for the hourly counts in the same transaction. `make` may throw AdmitRefused (or anything else) to keep nothing.
 */
export function admitRun<T>(o: { accountId: string; pool: { policy: Pick<Policy, "limits">; addr: string | null } | null; now?: number }, make: () => T): { ok: true; value: T } | { ok: false; refusal: AdmitRefused["refusal"] } {
  const now = o.now ?? Date.now();
  const d = db();
  try {
    return d
      .transaction((): { ok: true; value: T } | { ok: false; refusal: AdmitRefused["refusal"] } => {
        const refusal = accountLimitRefusal(o.accountId) ?? (o.pool ? poolLimitRefusal(o.accountId, o.pool.policy, o.pool.addr, now) : null);
        if (refusal) return { ok: false, refusal };
        const value = make();
        if (o.pool) {
          d.prepare("INSERT INTO pool_admissions (account, addr, at) VALUES (?, ?, ?)").run(o.accountId, o.pool.addr, now);
          d.prepare("DELETE FROM pool_admissions WHERE at < ?").run(now - KEEP_MS);
        }
        return { ok: true, value };
      })
      .immediate();
  } catch (e) {
    if (e instanceof AdmitRefused) return { ok: false, refusal: e.refusal };
    throw e;
  }
}
