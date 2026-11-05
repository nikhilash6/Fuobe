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
 *   the account's own GPU or its own key, nor on runs of light work only (joins, trims: free, never counted): runs at
 *   once (`activeRuns`), runs waiting in line (`waiting`, no row started yet), runs made (Run pressed and admitted) in
 *   the last hour (`runsPerHour`), and runs made from one client address in the last hour (`addressRunsPerHour`).
 *   0 or absent: no such limit.
 *
 * A run is one press of Run: its jobs and the steps its chains queue share a batch and count once.
 *
 * admitRun counts and makes the run's rows in one `BEGIN IMMEDIATE` transaction: SQLite lets one writer in at a time,
 * across processes, so the count it reads is the count it adds to.
 */

const HOUR = 60 * 60_000;
/** Runs made (let in) are kept this long for the hourly counts. */
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

/**
 * A run let in whose rows are still being made: a tool's start that awaits something (a channel, a plan) before it
 * makes its rows. It counts as one run going (and, on this install's GPUs, one in line) from the moment it is let in
 * until its rows exist (closeAdmission), so requests that arrive meanwhile meet the limits with it counted. One whose
 * process stopped before it closed counts for OPEN_ADMISSION_MS at most.
 */
export const OPEN_ADMISSION_MS = 10 * 60_000;

/**
 * Note a run let in whose rows aren't made yet (call it inside admitRun's `make`, so it is noted in the same locked step
 * as the count). `pool`: it counts against the policy's limits on runs on this install's GPUs too. Returns its key.
 */
export function openAdmission(accountId: string, pool: boolean, now = Date.now()): string {
  const key = crypto.randomBytes(12).toString("hex");
  db().prepare("INSERT INTO open_admissions (key, account, pool, at) VALUES (?, ?, ?, ?)").run(key, accountId, pool ? 1 : 0, now);
  return key;
}

/** The run's rows exist now (they count from here), or it was never made: it no longer counts as open. */
export function closeAdmission(key: string): void {
  db().prepare("DELETE FROM open_admissions WHERE key = ?").run(key);
}

/** An account's open admissions (all of them, or only those on this install's GPUs). */
function openCount(accountId: string, poolOnly: boolean, now = Date.now()): number {
  const r = db()
    .prepare(`SELECT COUNT(*) AS n FROM open_admissions WHERE account = ? AND at > ?${poolOnly ? " AND pool = 1" : ""}`)
    .get(accountId, now - OPEN_ADMISSION_MS) as { n: number };
  return r.n;
}

/**
 * A run waiting for the account's own GPU to come back: no job yet, its wait kept with it (generations.ts `heal`). A run
 * waiting on a key (its provider busy or down) isn't one: it counts among the runs going now, so a provider that is down
 * can't gather more of them than that.
 */
const WAITING_FOR_GPU = "(provider = 'comfyui' AND external_id IS NULL AND json_valid(external_meta_json) AND json_extract(external_meta_json, '$.heal') IS NOT NULL)";

/** Leave out the runs a new one takes the place of (a JSON list of ids). */
const NOT_REPLACED = "id NOT IN (SELECT value FROM json_each(?))";

/** How a run made by a studio's Run (POST /api/generations) is counted against the studio's own limits. */
export interface StudioCount {
  /** The runs it takes the place of ("Run with your key" on a waiting run): they stop once it is made. */
  except?: readonly string[];
  /** Runs waiting for the account's own GPU are counted apart (accountWaitingRuns): they use nothing while they wait. */
  waitingApart?: boolean;
}

/**
 * An account's runs going now (queued or running), wherever they run: a run's jobs and chain steps share a batch. A run
 * let in whose rows are still being made counts too (openAdmission). `o`: as a studio's Run counts them (StudioCount).
 */
export function accountActiveRuns(accountId: string, o: StudioCount = {}): number {
  const waiting = o.waitingApart ? ` AND NOT ${WAITING_FOR_GPU}` : "";
  const r = db()
    .prepare(
      `SELECT COUNT(DISTINCT COALESCE(batch_id, id)) AS n FROM generations WHERE status IN ('queued', 'running') AND json_extract(request_json, '$.account') = ?${waiting} AND ${NOT_REPLACED}`,
    )
    .get(accountId, JSON.stringify(o.except ?? [])) as { n: number };
  return r.n + openCount(accountId, false);
}

/** An account's runs waiting for its own GPU to come back (WAITING_FOR_GPU), but those a new run takes the place of. */
export function accountWaitingRuns(accountId: string, except: readonly string[] = []): number {
  const r = db()
    .prepare(`SELECT COUNT(DISTINCT COALESCE(batch_id, id)) AS n FROM generations WHERE status = 'queued' AND json_extract(request_json, '$.account') = ? AND ${WAITING_FOR_GPU} AND ${NOT_REPLACED}`)
    .get(accountId, JSON.stringify(except)) as { n: number };
  return r.n;
}

/**
 * An account's runs going now on this install's GPUs, and how many of them haven't started yet (no row of theirs has).
 * Runs of light work only (joins, trims) don't count. A run let in whose rows are still being made counts as one in line.
 */
export function poolRunCounts(accountId: string): { active: number; waiting: number } {
  const r = db()
    .prepare(
      `SELECT COUNT(*) AS active, COALESCE(SUM(CASE WHEN started = 0 THEN 1 ELSE 0 END), 0) AS waiting FROM (
         SELECT COALESCE(g.batch_id, g.id) AS k, MAX(CASE WHEN r.started_at IS NOT NULL THEN 1 ELSE 0 END) AS started
         FROM generations g LEFT JOIN generation_runs r ON r.id = g.id
         WHERE g.status IN ('queued', 'running') AND json_extract(g.request_json, '$.account') = ? AND json_extract(g.request_json, '$.place') = 'pool'
           AND json_extract(g.request_json, '$.light') IS NOT 1
         GROUP BY k)`,
    )
    .get(accountId) as { active: number; waiting: number };
  const open = openCount(accountId, true);
  return { active: r.active + open, waiting: r.waiting + open };
}

/**
 * Forget one hourly admission (admitRun noted it at `at`) of a run that made nothing: no rows, nothing sent, so it isn't
 * one of the hour's runs.
 */
export function forgetAdmission(accountId: string, at: number): void {
  db().prepare("DELETE FROM pool_admissions WHERE id = (SELECT id FROM pool_admissions WHERE account = ? AND at = ? ORDER BY id DESC LIMIT 1)").run(accountId, at);
}

declare global {
  var __fuobeAddressSalt: { db: unknown; salt: string } | undefined;
  /** When this process last forgot old admissions (prunePoolAdmissions). */
  var __fuobePoolAdmissionsPruned: number | undefined;
}

/**
 * Forget the runs (and the client addresses, kept as salted hashes) older than KEEP_MS: the hourly counts read only the
 * last hour. The runner calls this on every turn, so nothing stays longer, whether or not another run comes; it looks at
 * most once a minute in each process (`force`: now).
 */
export function prunePoolAdmissions(now = Date.now(), force = false): number {
  if (!force && now - (globalThis.__fuobePoolAdmissionsPruned ?? 0) < 60_000) return 0;
  globalThis.__fuobePoolAdmissionsPruned = now;
  db().prepare("DELETE FROM open_admissions WHERE at < ?").run(now - OPEN_ADMISSION_MS);
  return db().prepare("DELETE FROM pool_admissions WHERE at < ?").run(now - KEEP_MS).changes;
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

/**
 * The studio's own limit of runs at once (every account run, wherever it goes), as a refusal. `studio`: a studio's Run,
 * counted as StudioCount says; with `mayWait` (a run for the account's own GPU, which may wait for it) the runs waiting
 * for that GPU meet a limit of their own too.
 */
function accountLimitRefusal(accountId: string, studio?: StudioCount & { mayWait?: boolean }): LimitRefusal | null {
  if (studio?.mayWait && accountWaitingRuns(accountId, studio.except) >= ACCOUNT_LIMITS.waitingRuns) {
    return { status: 429, error: ACCOUNT_MESSAGES.waitingRuns, code: ACTIVE_RUNS_CODE, retryAfterS: 30 };
  }
  const n = accountActiveRuns(accountId, studio ? { except: studio.except, waitingApart: true } : {});
  return n >= ACCOUNT_LIMITS.activeRuns ? { status: 429, error: ACCOUNT_MESSAGES.activeRuns, code: ACTIVE_RUNS_CODE, retryAfterS: 30 } : null;
}

/** A refusal thrown inside admitRun's transaction, so nothing `make` wrote is kept. */
export class AdmitRefused extends Error {
  constructor(readonly refusal: LimitRefusal | { status: number; error: string; code: string; retryAfterS?: number }) {
    super(refusal.error);
  }
}

/** What admitRun answers: the run made, the refusal, or (with `prior`) what this same request made already. */
export type Admitted<T, P = never> = { ok: true; value: T } | { ok: false; refusal: AdmitRefused["refusal"] } | ([P] extends [never] ? never : { ok: false; prior: P });

/**
 * Count, and make the run (`make`) only if it fits: the studio's own limit for every account run, and with `pool` the
 * policy's limits on runs on this install's GPUs. All in one BEGIN IMMEDIATE transaction; a run on this install's GPUs is
 * noted for the hourly counts in the same transaction. `make` may throw AdmitRefused (or anything else) to keep nothing.
 * `prior`, looked at first in the same transaction: what this same request made already (a resend of one press of Run,
 * run-requests.ts); when it says anything, nothing is counted or made, and it is the answer. `refused`, called in the
 * same transaction when the run is not made (a limit, AdmitRefused, or another error from `make`, which is thrown again
 * once the transaction ends): what it writes is kept, while nothing `make` wrote is.
 */
export function admitRun<T, P = never>(
  o: {
    accountId: string;
    pool: { policy: Pick<Policy, "limits">; addr: string | null } | null;
    /** A studio's Run (POST /api/generations): counted as accountLimitRefusal says. */
    studio?: StudioCount & { mayWait?: boolean };
    now?: number;
    prior?: () => P | null;
    refused?: (why: AdmitRefused["refusal"] | Error) => void;
  },
  make: () => T,
): Admitted<T, P> {
  type Answer = { ok: true; value: T } | { ok: false; refusal: AdmitRefused["refusal"] } | { ok: false; prior: P };
  const now = o.now ?? Date.now();
  const d = db();
  const refused = o.refused;
  let failed: { e: unknown } | null = null;
  let answer: Answer | null;
  try {
    answer = d
      .transaction((): Answer | null => {
        const prior = o.prior?.() ?? null;
        if (prior !== null) return { ok: false, prior };
        const refusal = accountLimitRefusal(o.accountId, o.studio) ?? (o.pool ? poolLimitRefusal(o.accountId, o.pool.policy, o.pool.addr, now) : null);
        if (refusal) {
          refused?.(refusal);
          return { ok: false, refusal };
        }
        let value: T;
        if (!refused) value = make();
        else {
          try {
            // In a savepoint: a make that refuses or fails keeps nothing it wrote, and the refusal is still noted.
            value = d.transaction(make)();
          } catch (e) {
            refused(e instanceof AdmitRefused ? e.refusal : e instanceof Error ? e : new Error(String(e)));
            if (e instanceof AdmitRefused) return { ok: false, refusal: e.refusal };
            failed = { e };
            return null;
          }
        }
        if (o.pool) {
          d.prepare("INSERT INTO pool_admissions (account, addr, at) VALUES (?, ?, ?)").run(o.accountId, o.pool.addr, now);
          prunePoolAdmissions(now, true);
        }
        return { ok: true, value };
      })
      .immediate();
  } catch (e) {
    if (e instanceof AdmitRefused) return { ok: false, refusal: e.refusal };
    throw e;
  }
  if (failed) throw (failed as { e: unknown }).e;
  return answer! as Admitted<T, P>;
}
