import "server-only";
import { queueRequestRelease } from "./billing-outbox";
import { db } from "./db";
import { endLease, leaseToken, MINE_NOW, takeLease } from "./run-leases";

/**
 * Runs on this install's GPUs that are made but wait to enter the line (hosted runs). One press of Run makes one run,
 * always: a press past a limit the run can wait out is taken, its tile shows at once ("In line"), and the run's GPU task
 * is made later, when the reason clears (pool-release.ts). Nothing here is read or written while hosted runs are off.
 *
 * Why a run waits (`reason`):
 * - `mine`: the account already has its runs at once in line (the policy's `activeRuns`); it enters when one of them ends.
 * - `today`: the day's GPU time is used up (the billing service's `startAt`); it enters at the renewal.
 * - `service`: the billing or moderation service didn't answer at the press (or said runs are paused); it reserves (and
 *   is checked) once the service answers.
 * - `hour`: an hourly limit; it enters at `start_at`.
 * - `list`: the waiting list (only when the service has one switched on).
 * - `credits`: no free generations left until they renew at `start_at` (credits on).
 *
 * Where it enters (`rank_rule`): a run held for the account's own reasons (mine, hour, list, credits) at the back of the
 * line when it is released, so ten fast presses never pass anyone; one held for the system's reasons (today, service)
 * at its press time.
 *
 * A hold row is kept for every row of the run (its jobs and the later steps of its chains), all sharing `run_id`, so the
 * runs' counts skip them and a deploy or a second app process sees them. `job` is the index of a row sent at release
 * (its seed's offset); a later step (null) waits for its earlier steps as it always does. `holder` and `lease_until`:
 * the app process releasing the run right now (pool-release.ts, run-leases.ts), so two processes never release one run
 * twice.
 */

export type HoldReason = "mine" | "today" | "service" | "hour" | "list" | "credits";
export type RankRule = "press" | "release";

export const HOLD_REASONS: readonly HoldReason[] = ["mine", "today", "service", "hour", "list", "credits"];

/** Where a released run enters the line, by why it waited. */
export const RANK_OF: Record<HoldReason, RankRule> = { mine: "release", hour: "release", list: "release", credits: "release", today: "press", service: "press" };

export interface HoldRow {
  generation_id: string;
  run_id: string;
  account_id: string;
  reason: HoldReason;
  pressed_at: number;
  start_at: number | null;
  rank_rule: RankRule;
  reserved: number;
  checked: number;
  paused: number;
  counted: number;
  request_id: string | null;
  facts_json: string | null;
  job: number | null;
  tries: number;
  tried_at: number | null;
  next_at: number | null;
  holder: string | null;
  lease_until: number | null;
}

/** A run to hold, as the press made it. */
export interface NewHold {
  accountId: string;
  /** Every row of the run, with the job index of each row sent at release (null: a later step). */
  rows: { id: string; job: number | null }[];
  /** The run its rows belong to (absent: its first row). */
  runId?: string;
  reason: HoldReason;
  pressedAt: number;
  /** Not before (epoch ms): `today`, `hour`, `credits`. */
  startAt?: number;
  /** Absent: the reason's own (RANK_OF). */
  rankRule?: RankRule;
  /** The billing service's hold is made (or none is needed). False: it reserves at release. */
  reserved: boolean;
  /** The moderation service's check passed (or none is set). False: it is checked at release. */
  checked?: boolean;
  /** The service said runs there are paused (maintenance): the tile says it starts when a GPU is free. */
  paused?: boolean;
  /**
   * The run counted against the account's limits already (one cut off between its rows and its GPU task): it enters when
   * its reason clears, never waiting for room among the account's runs.
   */
  counted?: boolean;
  /** The reserve's request id at release (the press's own, so the service makes one hold for it). */
  requestId?: string;
  /** What the reserve at release sends of the run (its facts, the price shown, its timing). */
  facts?: unknown;
}

/** Hold a run (call it inside the transaction that made its rows). Returns its run id (its first row's id). */
export function holdRun(h: NewHold, now = Date.now()): string {
  const runId = h.runId ?? h.rows[0]?.id;
  if (!runId) throw new Error("A run to hold has no rows");
  const insert = db().prepare(
    `INSERT INTO pool_holds (generation_id, run_id, account_id, reason, pressed_at, start_at, rank_rule, reserved, checked, paused, counted, request_id, facts_json, job, tries, tried_at, next_at)
     VALUES (@id, @run, @account, @reason, @pressed, @start, @rank, @reserved, @checked, @paused, @counted, @request, @facts, @job, 0, NULL, @next)
     ON CONFLICT(generation_id) DO NOTHING`,
  );
  const facts = h.facts === undefined ? null : JSON.stringify(h.facts);
  for (const r of h.rows) {
    insert.run({
      id: r.id,
      run: runId,
      account: h.accountId,
      reason: h.reason,
      pressed: h.pressedAt,
      start: h.startAt ?? null,
      rank: h.rankRule ?? RANK_OF[h.reason],
      reserved: h.reserved ? 1 : 0,
      checked: h.checked === false ? 0 : 1,
      paused: h.paused ? 1 : 0,
      counted: h.counted ? 1 : 0,
      request: h.requestId ?? null,
      facts,
      job: r.job,
      next: now,
    });
  }
  return runId;
}

/** SQL: row `alias` of generations waits to enter the line (it has a hold). */
export const HELD = (alias: string) => `EXISTS (SELECT 1 FROM pool_holds ph WHERE ph.generation_id = ${alias}.id)`;

/** SQL: row `alias` of generations is not held. */
export const NOT_HELD = (alias: string) => `NOT ${HELD(alias)}`;

/** The hold of one row, or undefined. */
export function holdOf(generationId: string): HoldRow | undefined {
  return db().prepare("SELECT * FROM pool_holds WHERE generation_id = ?").get(generationId) as HoldRow | undefined;
}

/** The rows of one held run. */
export function runHolds(runId: string): HoldRow[] {
  return db().prepare("SELECT * FROM pool_holds WHERE run_id = ? ORDER BY generation_id").all(runId) as HoldRow[];
}

/** An account's runs waiting to enter the line (one per press), all of them or for one reason. */
export function heldRuns(accountId: string, reason?: HoldReason): number {
  const r = db()
    .prepare(`SELECT COUNT(DISTINCT run_id) AS n FROM pool_holds WHERE account_id = ?${reason ? " AND reason = ?" : ""}`)
    .get(...(reason ? [accountId, reason] : [accountId])) as { n: number };
  return r.n;
}

/** Is anything held at all (the release loop looks only then)? */
export const anyHeld = (): boolean => !!db().prepare("SELECT 1 FROM pool_holds LIMIT 1").get();

/**
 * Every held run, one row each (its first), in the order runs are released: by account, then press. The release loop
 * reads this once a turn (holds are few: at most `limits.held` per account).
 */
export function heldRunHeads(): HoldRow[] {
  return db()
    .prepare(
      `SELECT h.* FROM pool_holds h JOIN (SELECT run_id, MIN(generation_id) AS first FROM pool_holds GROUP BY run_id) f ON f.first = h.generation_id
       ORDER BY h.account_id, h.pressed_at, h.run_id`,
    )
    .all() as HoldRow[];
}

/** Change every row of a held run. */
export function setRunHold(runId: string, fields: Partial<Pick<HoldRow, "reason" | "start_at" | "rank_rule" | "reserved" | "checked" | "paused" | "tries" | "tried_at" | "next_at">>): void {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db()
    .prepare(`UPDATE pool_holds SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE run_id = @__run`)
    .run({ ...fields, __run: runId });
}

/** How long a lease on a held run lasts: one turn of the release loop, its service calls included. */
export const HOLD_LEASE_MS = 60_000;

/** Take the release of a held run for this app process (false: another one is releasing it now: run-leases.ts). */
export const leaseRun = (runId: string, now = Date.now()): boolean => takeLease("pool_holds", runId, HOLD_LEASE_MS, now);

/** Give the lease back (the run still waits). */
export const endRunLease = (runId: string): void => endLease("pool_holds", runId);

/**
 * The run enters the line now: its holds go, in one step that only this app process's lease may take, and only for the
 * rows that still wait (one cancelled meanwhile is left out). Returns its rows to send (job index set) and the rank they
 * enter at, or null when it isn't this process's to release any more. `room`: asked in the same locked step, so two app
 * processes releasing an account's runs at once never pass its room among its runs going (false: it waits).
 */
export function takeRun(runId: string, now = Date.now(), room?: () => boolean): { send: { id: string; job: number }[]; rankAt: number | undefined } | null {
  const d = db();
  return d
    .transaction(() => {
      const rows = d.prepare(`SELECT * FROM pool_holds WHERE run_id = ? AND ${MINE_NOW}`).all(runId, leaseToken(), now) as HoldRow[];
      if (!rows.length) return null;
      if (room && !room()) return null;
      d.prepare("DELETE FROM pool_holds WHERE run_id = ?").run(runId);
      const live = d.prepare("SELECT 1 FROM generations WHERE id = ? AND status = 'queued' AND external_id IS NULL");
      const send = rows.filter((r) => r.job !== null && live.get(r.generation_id)).map((r) => ({ id: r.generation_id, job: r.job! }));
      const head = rows[0];
      return { send, rankAt: head.rank_rule === "press" ? head.pressed_at : undefined };
    })
    .immediate();
}

/** A held run ended before it entered the line (a service refused it): its holds go. */
export function dropRun(runId: string): void {
  db().prepare("DELETE FROM pool_holds WHERE run_id = ?").run(runId);
}

type Dropped = Pick<HoldRow, "run_id" | "reserved" | "request_id">;

/** Delete the holds `where` names (SQL on pool_holds), in one step; then give back what their runs never heard of. */
function dropWhere(where: string, ...params: unknown[]): number {
  const d = db();
  const gone = d
    .transaction(() => {
      const rows = d.prepare(`SELECT run_id, reserved, request_id FROM pool_holds WHERE ${where}`).all(...params) as Dropped[];
      if (rows.length) d.prepare(`DELETE FROM pool_holds WHERE ${where}`).run(...params);
      return rows;
    })
    .immediate();
  releaseUnheard(gone);
  return gone.length;
}

/**
 * Runs that stopped waiting before their reserve was ever answered (cancelled, deleted, the account gone): a try at the
 * press may have made a hold the app never heard of, so it goes back by the press's request id once none of the run's
 * rows waits any more (billing-outbox.ts queueRequestRelease; a service that holds nothing for it does nothing).
 */
function releaseUnheard(rows: Dropped[]): void {
  const left = db().prepare("SELECT 1 FROM pool_holds WHERE run_id = ? LIMIT 1");
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.reserved || !r.request_id || seen.has(r.run_id)) continue;
    seen.add(r.run_id);
    if (!left.get(r.run_id)) queueRequestRelease(r.request_id);
  }
}

/** Holds whose row no longer waits to be sent (stopped, failed, deleted, or sent by another way) go. */
export const dropGone = (): number =>
  dropWhere("NOT EXISTS (SELECT 1 FROM generations g WHERE g.id = pool_holds.generation_id AND g.status = 'queued' AND g.external_id IS NULL)");

/** A row stopped (cancelled, failed, deleted): its hold goes. */
export const dropHold = (generationId: string): void => void dropWhere("generation_id = ?", generationId);

/** A deleted account leaves no holds. */
export const clearHolds = (accountId: string): void => void dropWhere("account_id = ?", accountId);

/** For the owner's view of the line: held runs by reason (counts only), and when the oldest was pressed. */
export function heldView(): Record<HoldReason, number> & { oldestAt: number | null } {
  const rows = db().prepare("SELECT reason, COUNT(DISTINCT run_id) AS n, MIN(pressed_at) AS oldest FROM pool_holds GROUP BY reason").all() as { reason: HoldReason; n: number; oldest: number }[];
  const out = Object.fromEntries(HOLD_REASONS.map((r) => [r, 0])) as Record<HoldReason, number>;
  let oldestAt: number | null = null;
  for (const r of rows) {
    out[r.reason] = r.n;
    oldestAt = oldestAt === null ? r.oldest : Math.min(oldestAt, r.oldest);
  }
  return { ...out, oldestAt };
}

/** Why a run just made waits, if it does: the policy's limits, the billing service's answer, the moderation service. */
export interface HoldCauses {
  /** The policy's limits (pool-limits.ts AdmitPlan): behind the account's runs going, or an hourly limit until `startAt`. */
  limit?: { reason: "mine" | "hour"; startAt?: number };
  /** The billing service's answer (hosted-run.ts ReserveWait). */
  wait?: { reason: "service" | "today" | "hour" | "credits"; startAt?: number; requestId?: string; paused?: true };
  /** The moderation service didn't answer: the run is checked before it enters the line. */
  unchecked?: boolean;
}

/**
 * The hold for a run with these causes, or null when it goes into line now. Its reason is the one its tile tells: a later
 * start first (the day's GPU time, an hourly limit, free generations that renew), then the service, then the account's
 * runs going. It enters at its press time only when every cause is the system's (the day's GPU time, the service), at
 * the back of the line when the account's own limits held it too. It reserves at release when the service didn't
 * answer, or for free generations that renew.
 */
export function holdShape(c: HoldCauses): Pick<NewHold, "reason" | "startAt" | "rankRule" | "reserved" | "checked" | "paused" | "requestId"> | null {
  if (!c.limit && !c.wait && !c.unchecked) return null;
  const starts = [c.limit?.startAt, c.wait?.startAt].filter((n): n is number => typeof n === "number");
  const startAt = starts.length ? Math.max(...starts) : undefined;
  const reason: HoldReason =
    startAt !== undefined ? (c.wait?.startAt === startAt ? c.wait.reason : (c.limit?.reason ?? "hour")) : c.wait?.reason === "service" || c.unchecked ? "service" : (c.limit?.reason ?? "service");
  const own = !!c.limit || c.wait?.reason === "hour" || c.wait?.reason === "credits";
  return {
    reason,
    ...(startAt !== undefined && { startAt }),
    rankRule: own ? "release" : "press",
    reserved: c.wait?.reason !== "service" && c.wait?.reason !== "credits",
    checked: !c.unchecked,
    ...(c.wait?.paused && { paused: true }),
    ...(c.wait?.requestId && { requestId: c.wait.requestId }),
  };
}

/**
 * About how long a run waits before it enters the line, for the billing service's hold (ReserveRequest.timing.heldMs):
 * until its later start, else an hour behind the account's runs going (the service keeps the hold of a run still
 * waiting open longer).
 */
export function heldGuessMs(limit: HoldCauses["limit"] | undefined, now = Date.now()): number {
  if (!limit) return 0;
  return limit.startAt !== undefined ? Math.max(0, limit.startAt - now) : 60 * 60_000;
}

/**
 * The reason a billing service's `startAt` gives a run (it says none): at a UTC midnight, the day's GPU time renews
 * ("today", entering at its press time); any other time is an hourly limit ("hour", entering when released).
 */
export const startReason = (startAt: number): "today" | "hour" => (startAt % 86_400_000 === 0 ? "today" : "hour");
