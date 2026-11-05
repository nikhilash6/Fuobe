import "server-only";
import crypto from "node:crypto";
import { db } from "./db";

/**
 * One press of Run on this install's GPUs, by the id its page sends with it (the same on every resend of that press).
 * With hosted runs on, an account's press whose run goes there makes that run once: a resend (an answer lost on the way,
 * a proxy that cut a slow request short, a second server process during a deploy) gets the run the first send made, and
 * the external billing service sees one reserve request id for each try of the press, so it makes one hold for it.
 *
 * A try ends when its hold goes back before a run was made: refused after the hold was made (a limit, a step these GPUs
 * don't take, rows that couldn't be made), or its reserve got no answer in time (the hold the service may have made is
 * released by its request id). The press's next send is then a new try, under a request id of its own, so no run is
 * ever made against a hold that went back. A press refused before anything was set aside keeps its try: sent again, it
 * is checked again under the same request id.
 *
 * Only runs on this install's GPUs are noted. A run on an account's own GPU or with its own key notes nothing and is
 * made as before (a tool's press once per server process: shorts-schemas.ts once), and so is every run with hosted runs
 * off.
 */

/** A press id as a page sends it. */
const PRESS_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** The press id beside a run request (the body's `requestId`), or null. */
export function readPressId(body: unknown): string | null {
  const v = (body as { requestId?: unknown } | null)?.requestId;
  return typeof v === "string" && PRESS_ID.test(v) ? v : null;
}

/** How long a press is remembered (a resend comes within a minute; a day is plenty). */
export const PRESS_KEEP_MS = 24 * 3_600_000;

/** A tool's press still starting after this long belongs to a process that stopped: a resend starts it itself. */
export const PRESS_STARTING_MS = 5 * 60_000;

/** A tool's press key: its scope (the tool, and the project or item it runs on) and the page's id for the press. */
export const toolPressKey = (scope: string, clientId: string): string => `${scope}\n${clientId}`;

/**
 * The reserve's request id for a try of a press: made from the account, the press's key (the page's id; a tool's scope
 * and the page's id) and the try, so every send of one try gives the same one, each try its own, and no other account's
 * press can ever name it.
 */
export const reserveRequestId = (accountId: string, key: string, tries = 0): string =>
  `r_${crypto.createHash("sha256").update(`${accountId}\n${key}${tries ? `\n${tries}` : ""}`).digest("hex").slice(0, 32)}`;

/** A try of a press, as reservePool reserves for it (hosted-run.ts). */
export interface Press {
  /** The press's key: the page's id for it (a tool's: toolPressKey). */
  key: string;
  /** Its try: how many earlier tries of the press ended with their hold given back. */
  tries: number;
  /**
   * Its reserve got no answer in time: the try ends (true), and the hold the service may have made goes back by its
   * request id. False when a send of the same try made its run or ended the try first: then that hold is not this
   * send's to give back.
   */
  gaveUp: () => boolean;
}

/** The press's row: by a key made from the account and the press's key, never the page's id as it was sent. */
const rowKey = (accountId: string, key: string) => reserveRequestId(accountId, key);

interface PressRow {
  tries: number;
  starting: number;
  ids_json: string | null;
  hold_id: string | null;
  answer_json: string | null;
  at: number;
}

function pressRow(accountId: string, key: string, now: number): PressRow | undefined {
  return db()
    .prepare("SELECT tries, starting, ids_json, hold_id, answer_json, at FROM run_requests WHERE account = ? AND request_id = ? AND at > ?")
    .get(accountId, rowKey(accountId, key), now - PRESS_KEEP_MS) as PressRow | undefined;
}

/** Forget presses older than a day (a row past it is a new press). */
const prune = (now: number) => db().prepare("DELETE FROM run_requests WHERE at <= ?").run(now - PRESS_KEEP_MS);

/** The try a send of this press is now (0 for a new press). */
export const pressTries = (accountId: string, key: string, now = Date.now()): number => pressRow(accountId, key, now)?.tries ?? 0;

/** A try of a press for reservePool. */
export const pressTry = (accountId: string, key: string, tries: number): Press => ({ key, tries, gaveUp: () => endTry(accountId, key, tries) });

/** What a studio press made: its run's rows (the first ones, as the route answered them) and the hold they carry. */
export type PressRun = { ids: string[]; hold: string | null };

/** The run a press made already (any try), or null. */
export function pressRun(accountId: string, key: string, now = Date.now()): PressRun | null {
  const r = pressRow(accountId, key, now);
  if (!r?.ids_json) return null;
  let ids: string[] = [];
  try {
    ids = JSON.parse(r.ids_json) as string[];
  } catch {}
  return { ids, hold: r.hold_id };
}

/**
 * What a send of a try finds just before it makes its run (inside the transaction that would make it): the run a send
 * of the press made already, "ended" when another send ended this try meanwhile (its hold is going back), or null.
 */
export function pressPrior(accountId: string, key: string, tries: number, now = Date.now()): PressRun | "ended" | null {
  const made = pressRun(accountId, key, now);
  if (made) return made;
  const r = pressRow(accountId, key, now);
  return r && r.tries !== tries ? "ended" : null;
}

/** Note the run a try of a press made (inside the transaction that makes it). */
export function notePressRun(accountId: string, key: string, tries: number, ids: string[], hold: string | null, now = Date.now()): void {
  prune(now);
  db()
    .prepare(
      "INSERT INTO run_requests (account, request_id, tries, starting, ids_json, hold_id, answer_json, at) VALUES (?, ?, ?, 0, ?, ?, NULL, ?) ON CONFLICT (account, request_id) DO UPDATE SET tries = excluded.tries, starting = 0, ids_json = excluded.ids_json, hold_id = excluded.hold_id, at = excluded.at",
    )
    .run(accountId, rowKey(accountId, key), tries, JSON.stringify(ids), hold, now);
}

/**
 * End a try of a press whose hold went back before a run was made (refused after the hold was made, or its reserve given
 * up): its next send is a new try. False when the try made its run (or answered), or had ended already.
 */
export function endTry(accountId: string, key: string, tries: number, now = Date.now()): boolean {
  const d = db();
  return d
    .transaction((): boolean => {
      prune(now);
      const r = pressRow(accountId, key, now);
      if (r && (r.ids_json || r.answer_json || r.tries !== tries)) return false;
      // (A tool's press keeps its claim: the call that holds it answers or releases it.)
      d.prepare(
        "INSERT INTO run_requests (account, request_id, tries, starting, at) VALUES (?, ?, ?, 0, ?) ON CONFLICT (account, request_id) DO UPDATE SET tries = excluded.tries, at = excluded.at",
      ).run(accountId, rowKey(accountId, key), tries + 1, now);
      return true;
    })
    .immediate();
}

/** What a tool's route answered: kept as its parts, so every resend gets its own copy. */
export interface PressAnswer {
  status: number;
  headers: [string, string][];
  text: string;
}

/**
 * Where a tool's press stands: claimed by this call (`tries`: its try), being started by another call (`starting`), or
 * answered already (`done`).
 */
export type PressClaim = { kind: "claimed"; tries: number } | { kind: "starting" } | { kind: "done"; answer: PressAnswer };

const answerOf = (r: PressRow | undefined): PressAnswer | null => {
  if (!r?.answer_json) return null;
  try {
    return JSON.parse(r.answer_json) as PressAnswer;
  } catch {
    // An answer that can't be read: started again, under the same try.
    return null;
  }
};

/** A tool's press as a resend finds it before it is checked: answered, being started elsewhere, or neither (null). */
export function toolPressSeen(accountId: string, key: string, now = Date.now()): Exclude<PressClaim, { kind: "claimed" }> | null {
  const r = pressRow(accountId, key, now);
  const answer = answerOf(r);
  if (answer) return { kind: "done", answer };
  return r?.starting && now - r.at < PRESS_STARTING_MS ? { kind: "starting" } : null;
}

/**
 * Claim a tool's press for this call, in one locked step, once its run is known to go to this install's GPUs: no two
 * calls (in any process) start the same press.
 */
export function claimPress(accountId: string, key: string, now = Date.now()): PressClaim {
  const d = db();
  const id = rowKey(accountId, key);
  return d
    .transaction((): PressClaim => {
      prune(now);
      const r = pressRow(accountId, key, now);
      if (!r) {
        d.prepare("INSERT INTO run_requests (account, request_id, tries, starting, at) VALUES (?, ?, 0, 1, ?)").run(accountId, id, now);
        return { kind: "claimed", tries: 0 };
      }
      const answer = answerOf(r);
      if (answer) return { kind: "done", answer };
      if (r.starting && now - r.at < PRESS_STARTING_MS) return { kind: "starting" };
      d.prepare("UPDATE run_requests SET answer_json = NULL, starting = 1, at = ? WHERE account = ? AND request_id = ?").run(now, accountId, id);
      return { kind: "claimed", tries: r.tries };
    })
    .immediate();
}

/** A tool's press answered: every resend of it gets this answer from now on. */
export function answerPress(accountId: string, key: string, answer: PressAnswer, now = Date.now()): void {
  db().prepare("UPDATE run_requests SET answer_json = ?, starting = 0, at = ? WHERE account = ? AND request_id = ?").run(JSON.stringify(answer), now, accountId, rowKey(accountId, key));
}

/**
 * A tool's press was refused: a resend checks it again. `held`: its hold had been made (and goes back), so the try ends
 * and the next send is a new try under its own request id.
 */
export function releasePress(accountId: string, key: string, tries: number, held: boolean, now = Date.now()): void {
  db()
    .prepare("UPDATE run_requests SET answer_json = NULL, starting = 0, tries = CASE WHEN ? AND tries = ? THEN tries + 1 ELSE tries END, at = ? WHERE account = ? AND request_id = ?")
    .run(held ? 1 : 0, tries, now, accountId, rowKey(accountId, key));
}

/** A deleted account's presses go with it. */
export function forgetAccountPresses(accountId: string): void {
  db().prepare("DELETE FROM run_requests WHERE account = ?").run(accountId);
}
