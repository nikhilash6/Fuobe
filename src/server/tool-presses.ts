import "server-only";
import crypto from "node:crypto";
import { db } from "./db";

/**
 * One press of a tool's Run by an account, by the id its page sends with it (the same on every resend of that press),
 * kept in the database so a resend that reaches another server process (during a deploy), or comes after a restart,
 * gets the first press's answer instead of a second run. Kept with hosted runs on only; without them a tool's run is
 * made once per press in each process, as before (shorts-schemas.ts once).
 *
 * The press also names its hold for the external billing service: the reserve's request id is made from the account,
 * the tool's scope and the page's id (reserveRequestId), so the same press always asks for the same hold. A press that
 * was refused after its hold was made (the hold then goes back) is tried afresh by its next resend, under a new request
 * id (`tries`), so a later press of the same settings never reuses a hold that was given back.
 */

/** How long a press is remembered (a resend comes within a minute; a day is plenty). */
export const PRESS_KEEP_MS = 24 * 3_600_000;

/** A press still starting after this long belongs to a process that stopped: a resend starts it itself. */
export const PRESS_STARTING_MS = 5 * 60_000;

/**
 * The reserve's request id for a press: made from the account and the press's id, so the same press always gives the
 * same one and no other account's press can ever name it. A tool's press id is its scope and the page's id.
 */
export const reserveRequestId = (accountId: string, pressId: string): string =>
  `r_${crypto.createHash("sha256").update(`${accountId}\n${pressId}`).digest("hex").slice(0, 32)}`;

/** A tool's press id: its scope (the tool, and the project or item it runs on) and the page's id for the press. */
export const toolPressId = (scope: string, clientId: string, tries = 0): string => `${scope}\n${clientId}${tries ? `\n${tries}` : ""}`;

/** What a route answered: kept as its parts, so every resend gets its own copy. */
export interface PressAnswer {
  status: number;
  headers: [string, string][];
  text: string;
}

/**
 * Where a press stands: claimed by this call (`tries`: how many of its earlier tries were refused after their hold was
 * made), being started by another call (`starting`), or answered already (`done`).
 */
export type PressClaim = { kind: "claimed"; tries: number } | { kind: "starting" } | { kind: "done"; answer: PressAnswer };

const key = (accountId: string, scope: string, clientId: string): string => reserveRequestId(accountId, toolPressId(scope, clientId));

/** Claim a press for this call, in one locked step: no two calls (in any process) start the same press. */
export function claimPress(accountId: string, scope: string, clientId: string, now = Date.now()): PressClaim {
  const d = db();
  const id = key(accountId, scope, clientId);
  return d
    .transaction((): PressClaim => {
      d.prepare("DELETE FROM tool_presses WHERE at < ?").run(now - PRESS_KEEP_MS);
      const r = d.prepare("SELECT answer_json, tries, starting, at FROM tool_presses WHERE account = ? AND request_id = ?").get(accountId, id) as
        | { answer_json: string | null; tries: number; starting: number; at: number }
        | undefined;
      if (!r) {
        d.prepare("INSERT INTO tool_presses (account, request_id, answer_json, tries, starting, at) VALUES (?, ?, NULL, 0, 1, ?)").run(accountId, id, now);
        return { kind: "claimed", tries: 0 };
      }
      if (r.answer_json) {
        try {
          return { kind: "done", answer: JSON.parse(r.answer_json) as PressAnswer };
        } catch {
          // An answer that can't be read: started again below, under the same hold.
        }
      }
      if (r.starting && now - r.at < PRESS_STARTING_MS) return { kind: "starting" };
      d.prepare("UPDATE tool_presses SET answer_json = NULL, starting = 1, at = ? WHERE account = ? AND request_id = ?").run(now, accountId, id);
      return { kind: "claimed", tries: r.tries };
    })
    .immediate();
}

/** The press's answer, for every resend of it from now on. */
export function answerPress(accountId: string, scope: string, clientId: string, answer: PressAnswer, now = Date.now()): void {
  db()
    .prepare("UPDATE tool_presses SET answer_json = ?, starting = 0, at = ? WHERE account = ? AND request_id = ?")
    .run(JSON.stringify(answer), now, accountId, key(accountId, scope, clientId));
}

/**
 * The press was refused: a resend checks it again. `held`: its hold had been made (and goes back), so its next try asks
 * for a new one under its own request id.
 */
export function releasePress(accountId: string, scope: string, clientId: string, held: boolean, now = Date.now()): void {
  db()
    .prepare(`UPDATE tool_presses SET answer_json = NULL, starting = 0, tries = tries + ?, at = ? WHERE account = ? AND request_id = ?`)
    .run(held ? 1 : 0, now, accountId, key(accountId, scope, clientId));
}

/** A deleted account's presses go with it. */
export function forgetAccountPresses(accountId: string): void {
  db().prepare("DELETE FROM tool_presses WHERE account = ?").run(accountId);
}
