import "server-only";
import crypto from "node:crypto";
import { ACTIVE_RUNS_CODE } from "@/lib/guest-access";
import { ACCOUNT_LIMITS, ACCOUNT_MESSAGES } from "./account-files";
import { LoginGuard } from "./auth";
import { heldCap, holdsOn, type Policy } from "./billing";
import { db } from "./db";
import { hostedRunsOn } from "./hosted-switch";
import { heldRuns, NOT_HELD } from "./pool-holds";

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
 *
 * When the policy says runs wait instead (`limits.held` present: billing.ts holdsOn), a press past the runs at once, the
 * runs in line or an hourly limit is taken all the same and waits to enter the line (pool-holds.ts): poolLimitPlan says
 * "hold". Only a press past the cap on runs waiting (`limits.held`) is turned down. Runs waiting there don't count as
 * going. While hosted runs are on, the studio's own limit of runs at once counts runs on the account's own GPU or key
 * and its light work only (ownActiveRuns): its other runs on this install's GPUs meet the policy's limits instead.
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
  /** The one press that is turned down while runs wait: past the cap on runs waiting (`n`: the account's runs on the way). */
  heldCap: (n: number) => `You have ${n} ${n === 1 ? "run" : "runs"} on the way. Add more when one is done.`,
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
 * An account's runs going now that the studio's own limit of runs at once counts (ACCOUNT_LIMITS.activeRuns): with
 * hosted runs off, every run (accountActiveRuns, as always); with them on, its runs on its own GPU or its own key, and
 * its light work (joins, trims: free, on this install's CPU, and counted by none of the policy's limits), as its other
 * runs on this install's GPUs meet the policy's limits instead. `o`: as a studio's Run counts them (StudioCount).
 */
export function ownActiveRuns(accountId: string, o: StudioCount = {}): number {
  if (!hostedRunsOn()) return accountActiveRuns(accountId, o);
  const waiting = o.waitingApart ? ` AND NOT ${WAITING_FOR_GPU}` : "";
  const r = db()
    .prepare(
      `SELECT COUNT(DISTINCT COALESCE(batch_id, id)) AS n FROM generations WHERE status IN ('queued', 'running') AND json_extract(request_json, '$.account') = ?
         AND (json_extract(request_json, '$.place') IS NOT 'pool' OR json_extract(request_json, '$.light') IS 1)${waiting} AND ${NOT_REPLACED}`,
    )
    .get(accountId, JSON.stringify(o.except ?? [])) as { n: number };
  return r.n + openCount(accountId, false) - openCount(accountId, true);
}

/**
 * An account's runs going now on this install's GPUs, and how many of them haven't started yet (no row of theirs has).
 * Runs of light work only (joins, trims) don't count, nor do runs waiting to enter the line (pool-holds.ts). A run let in
 * whose rows are still being made counts as one in line.
 */
export function poolRunCounts(accountId: string): { active: number; waiting: number } {
  const r = db()
    .prepare(
      `SELECT COUNT(*) AS active, COALESCE(SUM(CASE WHEN started = 0 THEN 1 ELSE 0 END), 0) AS waiting FROM (
         SELECT COALESCE(g.batch_id, g.id) AS k, MAX(CASE WHEN r.started_at IS NOT NULL THEN 1 ELSE 0 END) AS started
         FROM generations g LEFT JOIN generation_runs r ON r.id = g.id
         WHERE g.status IN ('queued', 'running') AND json_extract(g.request_json, '$.account') = ? AND json_extract(g.request_json, '$.place') = 'pool'
           AND json_extract(g.request_json, '$.light') IS NOT 1 AND ${NOT_HELD("g")}
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
 * When the next run past an hourly limit may start (epoch ms), counting each run from its start (a run told to wait
 * counts from then), so runs past the limit start in batches of `max`, an hour apart; null when it fits now.
 */
function hourStart(column: "account" | "addr", value: string, max: number, now: number): number | null {
  const ats = db().prepare(`SELECT at FROM pool_admissions WHERE ${column} = ? AND at > ? ORDER BY at`).pluck().all(value, now - HOUR) as number[];
  return ats.length < max ? null : ats[ats.length - max] + HOUR;
}

/**
 * What the policy's limits say of a new run on this install's GPUs: it goes into line now (`go`), it is taken and waits
 * to enter the line (`hold`: "mine" behind the account's runs going, or "hour" until `startAt`), or it is turned down
 * (`refuse`). Without holds (billing.ts holdsOn: the policy has no `limits.held`), every limit refuses, as before. With
 * them, only a press past the cap on runs waiting is refused; and a run of an account whose runs already wait behind its
 * own waits behind them too, so its presses enter in the order they were made. `addr` may be a function: it is asked
 * only when the policy counts runs per address.
 */
export type LimitPlan = { go: true } | { hold: "mine" | "hour"; startAt?: number } | { refuse: LimitRefusal };

export function poolLimitPlan(accountId: string, policy: Pick<Policy, "limits">, addr: string | null | (() => string | null), now = Date.now()): LimitPlan {
  const lim = policy.limits ?? ({} as Policy["limits"]);
  const activeMax = positive(lim.activeRuns);
  const waitingMax = positive(lim.waiting);
  const hourMax = positive(lim.runsPerHour);
  const addrMax = positive(lim.addressRunsPerHour);
  const holds = holdsOn(policy);
  const c = activeMax || waitingMax || holds ? poolRunCounts(accountId) : { active: 0, waiting: 0 };
  const overActive = !!activeMax && c.active >= activeMax;
  const overWaiting = !!waitingMax && c.waiting >= waitingMax;
  if (!holds) {
    if (overActive) return { refuse: { status: 429, error: POOL_LIMIT_WORDS.active(c.active), code: ACTIVE_RUNS_CODE, retryAfterS: 30 } };
    if (overWaiting) return { refuse: { status: 429, error: POOL_LIMIT_WORDS.waiting(c.waiting), code: ACTIVE_RUNS_CODE, retryAfterS: 30 } };
  }
  let startAt: number | null = null;
  if (hourMax) {
    if (holds) startAt = hourStart("account", accountId, hourMax, now);
    else {
      const h = since("account", accountId, now - HOUR);
      if (h.n >= hourMax) return { refuse: { status: 429, error: POOL_LIMIT_WORDS.hourly, code: "limit", retryAfterS: retryAfter(h.oldest, now) } };
    }
  }
  const address = addrMax ? (typeof addr === "function" ? addr() : addr) : null;
  if (address) {
    if (holds) {
      const at = hourStart("addr", address, addrMax, now);
      if (at !== null) startAt = Math.max(startAt ?? 0, at);
    } else {
      const h = since("addr", address, now - HOUR);
      if (h.n >= addrMax) return { refuse: { status: 429, error: POOL_LIMIT_WORDS.address, code: "limit", retryAfterS: retryAfter(h.oldest, now) } };
    }
  }
  if (!holds) return { go: true };
  // The one press turned down while runs wait: past the cap on the account's runs on the way, whatever this one would
  // wait for (behind its own runs, the day's GPU time, a quiet service).
  const refusal = heldCapRefusal(accountId, policy, c);
  if (refusal) return { refuse: refusal };
  const behindOwn = heldRuns(accountId, "mine") > 0;
  if (!overActive && !overWaiting && !behindOwn && startAt === null) return { go: true };
  return startAt !== null ? { hold: "hour", startAt } : { hold: "mine" };
}

const positive = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/**
 * How many more of an account's runs may go into line now: the policy's runs at once and runs in line, less its runs
 * going there (`c`: poolRunCounts; held runs don't count). Infinity when the policy limits neither.
 */
export function lineRoom(policy: Pick<Policy, "limits">, c: { active: number; waiting: number }): number {
  const activeMax = positive(policy.limits?.activeRuns);
  const waitingMax = positive(policy.limits?.waiting);
  return Math.max(0, Math.min(activeMax ? activeMax - c.active : Infinity, waitingMax ? waitingMax - c.waiting : Infinity));
}

/**
 * A press past the cap on an account's runs on the way (billing.ts heldCap: the policy's `limits.held` waiting behind
 * its runs at once, 8 behind 2 at launch: 10 in all; 0: no cap), as a refusal; null while there is room. Runs held for
 * any reason count, so a quiet service or the day's GPU time used up never lets more wait than that. `c`: its runs going
 * now (poolRunCounts), counted with the waiting ones in the words.
 */
export function heldCapRefusal(accountId: string, policy: Pick<Policy, "limits">, c = poolRunCounts(accountId)): LimitRefusal | null {
  const cap = heldCap(policy);
  if (!cap) return null;
  const held = heldRuns(accountId);
  const room = lineRoom(policy, c);
  if (held < cap + (Number.isFinite(room) ? room : 0)) return null;
  return { status: 429, error: POOL_LIMIT_WORDS.heldCap(c.active + held), code: ACTIVE_RUNS_CODE, retryAfterS: 30 };
}

/** The first of the policy's limits this run would be refused for, or null (poolLimitPlan; a run that waits is no refusal). */
export function poolLimitRefusal(accountId: string, policy: Pick<Policy, "limits">, addr: string | null | (() => string | null), now = Date.now()): LimitRefusal | null {
  const plan = poolLimitPlan(accountId, policy, addr, now);
  return "refuse" in plan ? plan.refuse : null;
}

/**
 * The studio's own limit of runs at once (ownActiveRuns), as a refusal. `studio`: a studio's Run, counted as StudioCount
 * says; with `mayWait` (a run for the account's own GPU, which may wait for it) the runs waiting for that GPU meet a
 * limit of their own too.
 */
function accountLimitRefusal(accountId: string, studio?: StudioCount & { mayWait?: boolean }): LimitRefusal | null {
  if (studio?.mayWait && accountWaitingRuns(accountId, studio.except) >= ACCOUNT_LIMITS.waitingRuns) {
    return { status: 429, error: ACCOUNT_MESSAGES.waitingRuns, code: ACTIVE_RUNS_CODE, retryAfterS: 30 };
  }
  const n = ownActiveRuns(accountId, studio ? { except: studio.except, waitingApart: true } : {});
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

/** What admitRun decided for a run it lets in on this install's GPUs: none (it goes into line now), or that it waits. */
export interface AdmitPlan {
  hold?: { reason: "mine" | "hour"; startAt?: number };
}

/**
 * Count, and make the run (`make`) only if it fits: with `pool`, the policy's limits on runs on this install's GPUs;
 * without, the studio's own limit of runs at once (ownActiveRuns: a run on the account's own GPU or key, light work, and
 * every run while hosted runs are off). A run the policy's limits hold is made all the same: `make` is
 * told so (AdmitPlan), and holds it instead of sending it (pool-holds.ts). All in one BEGIN IMMEDIATE transaction; a run on
 * this install's GPUs is noted for the hourly counts in the same transaction (one told to wait for an hourly limit, at
 * the time it may start). `make` may throw AdmitRefused (or anything else) to keep nothing.
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
  make: (plan: AdmitPlan) => T,
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
        const plan: LimitPlan = o.pool ? poolLimitPlan(o.accountId, o.pool.policy, o.pool.addr, now) : { go: true };
        const refusal = (o.pool ? null : accountLimitRefusal(o.accountId, o.studio)) ?? ("refuse" in plan ? plan.refuse : null);
        if (refusal) {
          refused?.(refusal);
          return { ok: false, refusal };
        }
        const admit: AdmitPlan = "hold" in plan ? { hold: { reason: plan.hold, ...(plan.startAt !== undefined && { startAt: plan.startAt }) } } : {};
        let value: T;
        if (!refused) value = make(admit);
        else {
          try {
            // In a savepoint: a make that refuses or fails keeps nothing it wrote, and the refusal is still noted.
            value = d.transaction(() => make(admit))();
          } catch (e) {
            refused(e instanceof AdmitRefused ? e.refusal : e instanceof Error ? e : new Error(String(e)));
            if (e instanceof AdmitRefused) return { ok: false, refusal: e.refusal };
            failed = { e };
            return null;
          }
        }
        if (o.pool) {
          d.prepare("INSERT INTO pool_admissions (account, addr, at) VALUES (?, ?, ?)").run(o.accountId, o.pool.addr, admit.hold?.startAt ?? now);
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
