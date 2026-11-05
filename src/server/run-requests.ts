import "server-only";
import crypto from "node:crypto";
import { db } from "./db";

/**
 * One press of Run, by the id the page sends with it (the same on every resend of that press). With hosted runs on, an
 * account's press makes its run once: a resend (an answer lost on the way, a proxy that cut a slow request short) gets
 * the run the first one made, and the external billing service sees one reserve request id for it, so it makes one hold.
 * Without hosted runs, nothing is noted and a run is made as before.
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

/**
 * The reserve's request id for a press: made from the account and the page's id, so the same press always gives the
 * same one and no other account's press can ever name it.
 */
export const reserveRequestId = (accountId: string, pressId: string): string =>
  `r_${crypto.createHash("sha256").update(`${accountId}\n${pressId}`).digest("hex").slice(0, 32)}`;

/** A refusal a press got after its price was set aside, as the route answered it: a resend of the press gets it again. */
export interface PressRefusal {
  status: number;
  body: { error: string; code?: string; provider?: string };
  headers: Record<string, string>;
}

/**
 * What a press made already: its run's rows (the first ones, as the route answered them) and the hold they carry;
 * "gave-up" when its reserve was given up (the billing service didn't answer in time and the press was refused);
 * `refused` when it was refused after its hold was made (a limit, a step this install's GPUs don't take, rows that
 * couldn't be made), so its hold went back; null when it is new.
 */
export type PressSeen = { ids: string[]; hold: string | null } | "gave-up" | { refused: PressRefusal } | null;

export function pressSeen(accountId: string, pressId: string, now = Date.now()): PressSeen {
  const r = db()
    .prepare("SELECT ids_json, hold_id, gave_up, refusal_json FROM run_requests WHERE account = ? AND request_id = ? AND at > ?")
    .get(accountId, pressId, now - PRESS_KEEP_MS) as { ids_json: string | null; hold_id: string | null; gave_up: number; refusal_json: string | null } | undefined;
  if (!r) return null;
  if (r.gave_up) return "gave-up";
  if (r.refusal_json) {
    try {
      return { refused: JSON.parse(r.refusal_json) as PressRefusal };
    } catch {
      return "gave-up";
    }
  }
  let ids: string[] = [];
  try {
    ids = JSON.parse(r.ids_json ?? "[]") as string[];
  } catch {}
  return { ids, hold: r.hold_id };
}

/** Note the run a press made (inside the transaction that makes it), and forget presses older than a day. */
export function notePress(accountId: string, pressId: string, ids: string[], hold: string | null, now = Date.now()): void {
  const d = db();
  d.prepare("DELETE FROM run_requests WHERE at < ?").run(now - PRESS_KEEP_MS);
  d.prepare("INSERT OR REPLACE INTO run_requests (account, request_id, ids_json, hold_id, gave_up, refusal_json, at) VALUES (?, ?, ?, ?, 0, NULL, ?)").run(accountId, pressId, JSON.stringify(ids), hold, now);
}

/**
 * Note a press refused after its hold was made, with the answer it got (inside the transaction that refused it): its
 * hold goes back, and a resend of the press gets the same answer instead of a run against that hold.
 */
export function notePressRefused(accountId: string, pressId: string, hold: string | null, refusal: PressRefusal, now = Date.now()): void {
  db()
    .prepare("INSERT OR REPLACE INTO run_requests (account, request_id, ids_json, hold_id, gave_up, refusal_json, at) VALUES (?, ?, NULL, ?, 0, ?, ?)")
    .run(accountId, pressId, hold, JSON.stringify(refusal), now);
}

/**
 * Note a press whose reserve was given up: a resend of it is refused at once (its hold, if the service made one, is
 * being released by its request id), and a new press of Run starts afresh. False when a resend of the press got there
 * first (it made its run, was refused or gave up too): then the press's hold, if any, is that resend's to keep or give
 * back, and nothing may be released by its request id.
 */
export function notePressGaveUp(accountId: string, pressId: string, now = Date.now()): boolean {
  const d = db();
  d.prepare("DELETE FROM run_requests WHERE account = ? AND request_id = ? AND at <= ?").run(accountId, pressId, now - PRESS_KEEP_MS);
  return d.prepare("INSERT OR IGNORE INTO run_requests (account, request_id, ids_json, hold_id, gave_up, at) VALUES (?, ?, NULL, NULL, 1, ?)").run(accountId, pressId, now).changes > 0;
}
