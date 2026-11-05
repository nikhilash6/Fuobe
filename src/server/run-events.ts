import "server-only";
import { db } from "./db";
import { withoutAddress, withoutSecrets } from "@/lib/diagnose";

/**
 * What happened to a run on an account's own GPU or own key, for the owner: one structured log line per wait, heal and
 * failure, and on a failed run a short note kept beside it (generations.external_meta_json `ownRun`) that only
 * owner-side code reads (ownRunNote). Never a prompt, a key, a token, a GPU's address or a file's name: an address is
 * its kind ("runpod", "tunnel", "web", "connect", "computer"), and the provider's own text is kept without the address
 * or any credential it echoed, 2 KB at most. Accounts and visitors never get any of it (toGeneration leaves the column
 * out). Other kinds of runs can log through the same line later (recordRunEvent).
 */

export type RunPlace = "own-gpu" | "own-key";
export type RunOutcome = "failed" | "waiting" | "healed";
export type HostKind = "runpod" | "tunnel" | "web" | "connect" | "computer";

export interface OwnRunEvent {
  run: string;
  account: string;
  provider: string;
  model: string;
  op?: string;
  stage?: string;
  /** An answer's status ("404"), or what kind of network failure it was ("refused", "dns", "tls", "timeout", "reset", "network"). */
  code?: string;
  hostKind?: HostKind;
  cause?: string;
  attempt?: number;
  waitedMs?: number;
  outcome: RunOutcome;
}

/** What is kept with a failed run for the owner (never sent to the account or a visitor). */
export interface OwnRunNote {
  at: number;
  cause?: string;
  stage?: string;
  code?: string;
  hostKind?: HostKind;
  /** The provider's or GPU's own words, without an address or a credential. */
  said?: string;
}

/** The most kept of a GPU's or provider's own words: 2 KB (in bytes, as stored). */
const MAX_SAID = 2048;

/** Text cut to at most `max` bytes in UTF-8, never in the middle of a character. */
export function capBytes(t: string, max = MAX_SAID): string {
  if (Buffer.byteLength(t) <= max) return t;
  // A character cut in two decodes as U+FFFD at the end: left out.
  return Buffer.from(t).subarray(0, max).toString("utf8").replace(/�+$/u, "");
}

/** A network failure's message as a short code. */
export function networkCode(text: string): string {
  if (/ECONNREFUSED|connection refused/i.test(text)) return "refused";
  if (/ENOTFOUND|EAI_AGAIN|EAI_NONAME|getaddrinfo|Couldn't resolve/i.test(text)) return "dns";
  if (/certificate|CERT_|self[- ]signed|SSL|TLS|wrong version number/i.test(text)) return "tls";
  if (/ECONNRESET|socket hang up|stopped answering|EPIPE/i.test(text)) return "reset";
  if (/timed? ?out|ETIMEDOUT|took over \d+ s|aborted|TimeoutError/i.test(text)) return "timeout";
  if (/won't fetch/i.test(text)) return "private";
  return "network";
}

/** Text from a GPU or a provider, as it may be kept: no address, no credential, no key, 2 KB at most. */
export function keptText(text: string | undefined, o: { url?: string; secret?: string } = {}): string | undefined {
  if (!text) return undefined;
  let t = withoutSecrets(withoutAddress(String(text), o.url));
  if (o.secret && o.secret.length >= 4) t = t.split(o.secret).join("••••");
  t = t.replace(/\s+/g, " ").trim();
  return t ? capBytes(t) : undefined;
}

/** One line for the server's log (JSON). Any kind of run event goes through here. */
export function recordRunEvent(evt: string, fields: Record<string, unknown>, level: "warn" | "info" = "info"): void {
  const line = JSON.stringify({ evt, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== "")) });
  if (level === "warn") console.warn(line);
  else console.info(line);
}

/**
 * A wait, a heal or a failure of an account's run on its own GPU or key: logged (a failure as a warning), and a failure's
 * note kept beside the run for the owner.
 */
export function recordOwnRun(e: OwnRunEvent, said?: string): void {
  const place: RunPlace = e.provider === "comfyui" ? "own-gpu" : "own-key";
  recordRunEvent("own-run", { run: e.run, account: e.account, place, provider: e.provider, model: e.model, op: e.op, stage: e.stage, code: e.code, hostKind: e.hostKind, cause: e.cause, attempt: e.attempt, waitedMs: e.waitedMs, outcome: e.outcome }, e.outcome === "failed" ? "warn" : "info");
  if (e.outcome !== "failed") return;
  const note: OwnRunNote = { at: Date.now(), cause: e.cause, stage: e.stage, code: e.code, hostKind: e.hostKind, ...(said && { said: capBytes(said) }) };
  try {
    db()
      .prepare("UPDATE generations SET external_meta_json = json_set(CASE WHEN json_valid(external_meta_json) THEN external_meta_json ELSE '{}' END, '$.ownRun', json(?)) WHERE id = ?")
      .run(JSON.stringify(note), e.run);
  } catch {
    // The note is for the owner's convenience: a run is never held up for it.
  }
}

/** The owner's note on an account's failed run (owner-side code only: never an account's or a visitor's answer). */
export function ownRunNote(runId: string): OwnRunNote | null {
  const row = db().prepare("SELECT external_meta_json FROM generations WHERE id = ?").get(runId) as { external_meta_json: string | null } | undefined;
  if (!row?.external_meta_json) return null;
  try {
    const note = (JSON.parse(row.external_meta_json) as { ownRun?: OwnRunNote }).ownRun;
    return note && typeof note.at === "number" ? note : null;
  } catch {
    return null;
  }
}
