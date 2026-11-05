import "server-only";
import type { GenerationRequest } from "@/lib/catalog/types";
import { accountById } from "./auth";
import { accountFacts, billingConfigured, forgetBalance, policy as billingPolicy, policyGiveUpMs, reserve, serviceAnsweredAt } from "./billing";
import { db } from "./db";
import { failWaiting, previewGeneration, restampRows, sendHeld } from "./generations";
import { queueFacts, runOnPool } from "./hosted";
import { heldStamp, moderateRun, renewalAt, type ReserveFacts } from "./hosted-run";
import { dropGone, dropRun, endRunLease, heldRunHeads, leaseRun, runHolds, setRunHold, startReason, takeRun, type HoldRow } from "./pool-holds";
import { lineRoom, poolRunCounts } from "./pool-limits";
import { stampOf, withoutStamp, withRunStamp } from "./run-stamp";

/**
 * The release loop of runs made but waiting to enter the line on this install's GPUs (pool-holds.ts). It runs in the
 * generations runner's turn (every app process, every 1.5 s), only while hosted runs are on and something waits:
 *
 * 1. A run waits until its `start_at` (the day's GPU time renews, an hourly limit, free generations renew).
 * 2. A run the billing or moderation service didn't answer for is checked and reserved, under its press's own request id
 *    (so a hold an unanswered try made at the press is the one it gets): tried again with a growing wait (1 s, doubling,
 *    at most 30 s), and at once after the service answers any call. An answer with a later start waits for it; a refusal
 *    ends the run in the service's words (its tile says it plainly).
 * 3. It enters when the account has room among its runs going (the policy's runs at once and in line), its presses in the
 *    order they were made; a run that counted already (one cut off by a deploy or a crash) needs no room.
 * 4. It enters the line at its press time (the system's reasons) or at the back (the account's own), and its rows are
 *    sent from what is stored, as a run is sent again after its GPU lost it.
 *
 * Each run is leased to one app process while it is released (pool-holds.ts leaseRun), so two processes during a deploy
 * never release one run twice, and a process that stops mid-way leaves it to the other once its lease ends.
 */

/** Service calls one turn of the loop makes at most: a service that hangs holds up nothing else for long. */
const SERVICE_TRIES_PER_TURN = 3;

/** How long a run waiting for a service waits before it asks again (ms): 1 s, doubling, at most 30 s. */
export const holdBackoffMs = (tries: number): number => Math.min(30_000, 1000 * 2 ** Math.min(Math.max(0, tries), 5));

/** After how long runs waiting for the billing service are said in the owner's log (the service can't say so itself). */
export const SERVICE_WAIT_SAID_MS = 5 * 60_000;

declare global {
  var __fuobeHoldServiceSaid: number | undefined;
}

/** The owner's log, at most every SERVICE_WAIT_SAID_MS: how many runs wait for the billing service (counts only). */
function sayServiceWait(heads: HoldRow[], now: number): void {
  const long = heads.filter((h) => (!h.reserved || !h.checked) && now - h.pressed_at > SERVICE_WAIT_SAID_MS);
  if (!long.length || now - (globalThis.__fuobeHoldServiceSaid ?? 0) < SERVICE_WAIT_SAID_MS) return;
  globalThis.__fuobeHoldServiceSaid = now;
  const oldest = Math.round((now - Math.min(...long.map((h) => h.pressed_at))) / 60_000);
  console.warn(`[fuobe] runs waiting for the billing service: ${long.length} (oldest ${oldest} min)`);
}

/**
 * How many more of an account's runs may enter the line now (pool-limits.ts lineRoom: held runs don't count). Null when
 * its policy isn't known (the service is quiet and nothing is kept): its runs wait.
 */
async function roomFor(accountId: string, kept: Map<string, number | null>): Promise<number | null> {
  if (kept.has(accountId)) return kept.get(accountId)!;
  const p = await billingPolicy(accountId);
  const left = p ? lineRoom(p, poolRunCounts(accountId)) : null;
  kept.set(accountId, left);
  return left;
}

/** Ask again later: one more try, and the next one after a growing wait (`paused`: the service said runs are paused). */
function later(h: HoldRow, now: number, paused?: boolean): void {
  setRunHold(h.run_id, { tries: h.tries + 1, tried_at: now, next_at: now + holdBackoffMs(h.tries), ...(paused !== undefined && { paused: paused ? 1 : 0 }) });
}

/** A service refused the run once it answered: its rows end in its words (the tile says it plainly), its holds go. */
function end(h: HoldRow, ids: string[], error: string): "ended" {
  failWaiting(ids, error || "This run couldn't be made.");
  dropRun(h.run_id);
  return "ended";
}

/**
 * The checks a run that waited for the services still needs: the moderation service's, then the billing service's hold.
 * "ready" once both are done; "wait" for a later start or another try; "down" when the service gave no answer at all
 * (no more calls this turn); "ended" when one refused it.
 */
async function serviceStep(h: HoldRow, now: number): Promise<"ready" | "wait" | "down" | "ended"> {
  const rows = runHolds(h.run_id);
  const ids = rows.map((r) => r.generation_id);
  const account = accountById(h.account_id);
  if (!account) return "wait";
  const first = rows.find((r) => r.job !== null) ?? rows[0];
  const row = db().prepare("SELECT request_json FROM generations WHERE id = ?").get(first.generation_id) as { request_json: string } | undefined;
  if (!row) return "wait";
  const stored = JSON.parse(row.request_json) as GenerationRequest;
  if (!h.checked) {
    const req = withoutStamp(stored) as GenerationRequest;
    let planned: ReturnType<typeof previewGeneration>;
    try {
      planned = runOnPool(account.id, () => withRunStamp(stampOf(stored), () => previewGeneration(req)));
    } catch (e) {
      return end(h, ids, (e as Error).message);
    }
    const mod = await moderateRun(account, req, planned, "pool");
    if (!mod.ok) {
      if (mod.refusal.body.code !== "paused") return end(h, ids, mod.refusal.body.error);
      later(h, now);
      return "down";
    }
    if (mod.checkOutputs) restampRows(ids, { checkOutputs: true });
    setRunHold(h.run_id, { checked: 1 });
  }
  if (!h.reserved) {
    if (!billingConfigured()) {
      setRunHold(h.run_id, { reserved: 1, paused: 0 });
      return "ready";
    }
    const facts = h.facts_json ? (JSON.parse(h.facts_json) as ReserveFacts) : null;
    if (!facts || !h.request_id) return end(h, ids, "");
    const queue = queueFacts(account.id, facts.workflowId);
    const a = await reserve({ requestId: h.request_id, account: accountFacts(account), run: facts.run, queue, shown: facts.shown, timing: facts.timing }, { forMs: 0 });
    if (!a) {
      setRunHold(h.run_id, { reserved: 1, paused: 0 });
      return "ready";
    }
    if (!a.ok) {
      // No answer (or one that may have made a hold: the same request id gets it next time), or runs paused there.
      if (a.code === "paused" || a.down || a.unsure) {
        later(h, now, a.code === "paused" && !a.down);
        return a.down ? "down" : "wait";
      }
      // No free generations left until they renew: it waits for them, and reserves then.
      const renews = await renewalAt(a, account, facts.run, queue, now);
      if (renews !== null) {
        setRunHold(h.run_id, { reason: "credits", start_at: renews, rank_rule: "release", tries: 0, next_at: null, paused: 0 });
        return "wait";
      }
      return end(h, ids, a.text);
    }
    forgetBalance(account.id);
    restampRows(ids, heldStamp(a, policyGiveUpMs(await billingPolicy(account.id))));
    const at = Number(a.startAt);
    if (Number.isFinite(at) && at > Date.now()) {
      // Its hold is made, and it starts later (the day's GPU time, an hourly limit).
      const reason = startReason(at);
      setRunHold(h.run_id, { reserved: 1, paused: 0, reason, start_at: at, ...(reason === "hour" && { rank_rule: "release" as const }) });
      return "wait";
    }
    setRunHold(h.run_id, { reserved: 1, paused: 0 });
  }
  return "ready";
}

/**
 * One turn of the release loop: every held run whose reason cleared enters the line. Returns how many runs entered.
 * Holds whose rows no longer wait (stopped, deleted) go first.
 */
export async function releaseHeldRuns(now = Date.now()): Promise<number> {
  dropGone();
  const heads = heldRunHeads();
  if (!heads.length) return 0;
  sayServiceWait(heads, now);
  const room = new Map<string, number | null>();
  let released = 0;
  let serviceCalls = 0;
  let serviceDown = false;
  for (const h of heads) {
    // Not before its time.
    if (h.start_at !== null && h.start_at > now) continue;
    const needsService = !h.reserved || !h.checked;
    if (needsService) {
      if (serviceDown || serviceCalls >= SERVICE_TRIES_PER_TURN) continue;
      const due = h.next_at === null || h.next_at <= now || (h.tried_at !== null && serviceAnsweredAt() > h.tried_at);
      if (!due) continue;
    }
    if (!leaseRun(h.run_id, now)) continue;
    try {
      if (needsService) {
        serviceCalls++;
        const step = await serviceStep(h, now);
        if (step === "down") serviceDown = true;
        if (step !== "ready") continue;
      }
      if (!h.counted) {
        const left = await roomFor(h.account_id, room);
        if (left === null || left <= 0) {
          // Its own reason cleared, but the account's runs going fill its room: it waits behind them, as its tile says.
          if (h.reason !== "mine") setRunHold(h.run_id, { reason: "mine", start_at: null, paused: 0 });
          continue;
        }
      }
      const taken = takeRun(h.run_id);
      if (!taken) continue;
      for (const s of taken.send) sendHeld(s.id, s.job, taken.rankAt);
      if (!h.counted) room.set(h.account_id, (room.get(h.account_id) ?? 1) - 1);
      released++;
    } finally {
      endRunLease(h.run_id);
    }
  }
  return released;
}
