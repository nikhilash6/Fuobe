import "server-only";
import crypto from "node:crypto";
import { hoursAt, parseHours } from "@/lib/worker-hours";
import { db } from "./db";
import { hostedRunsOn } from "./hosted-switch";
import { checkOutput, checkRun, moderationConfigured } from "./moderation";
import { hit } from "./rate";
import { tenant } from "./tenant";
import type { WorkerRow } from "./computer/workers";

/**
 * The free text helper: short text jobs (lyrics, a prompt rewrite, a chain's text step) run on a small open model in the
 * workers' text slots (`fuobe worker`, worker.json `textSlot`). A job waits in its own line (helper_jobs), never behind a
 * GPU job; the caller waits for the answer, and the row is deleted once read.
 */

export type HelperTask = "lyrics" | "enhance" | "soul" | "write" | "translate";

/** The most tokens a task may write. */
export const HELPER_TASKS: Record<HelperTask, { maxTokens: number }> = {
  lyrics: { maxTokens: 1200 },
  enhance: { maxTokens: 400 },
  soul: { maxTokens: 400 },
  write: { maxTokens: 4000 },
  translate: { maxTokens: 4000 },
};

export const isHelperTask = (v: unknown): v is HelperTask => typeof v === "string" && Object.hasOwn(HELPER_TASKS, v);

export const HELPER_TIMES = {
  /** A text slot that asked for a job this recently is live. */
  liveMs: 45_000,
  /** A text slot seen this recently means the install has the helper (visitors see its buttons). */
  knownMs: 24 * 60 * 60_000,
  /** How long one claim waits for a job. */
  claimWaitMs: 20_000,
  /** A claimed job with no answer after this fails. */
  runMs: 90_000,
  /** Rows older than this are deleted. */
  keepMs: 10 * 60_000,
  pollMs: 200,
  freshBeatMs: 30_000,
};

export const HELPER_LIMITS = {
  userChars: 6000,
  systemChars: 8000,
  textBytes: 64 * 1024,
  waitingAll: 60,
  waitingEach: 2,
  guest: { perMinute: 4, perHour: 20 },
  account: { perMinute: 8, perHour: 60 },
};

/** Whose job: "owner", "acct:<id>", or "guest:<address key>". */
export type HelperWho = string;

/** Whose a call is, from the request's tenant (a guest's address key comes from its route). */
export function helperWho(guestKey?: string): HelperWho {
  const t = tenant();
  if (!t) return "owner";
  return t.kind === "account" ? `acct:${t.id}` : `guest:${guestKey ?? "shared"}`;
}

interface JobRow {
  id: string;
  who: string;
  task: string;
  system: string;
  user: string;
  max_tokens: number;
  json: number;
  state: "waiting" | "running" | "done" | "failed";
  worker_id: string | null;
  lease: string | null;
  created_at: number;
  claimed_at: number | null;
  done_at: number | null;
  text: string | null;
  error: string | null;
}

/** A job as a text slot gets it. */
export interface HelperJob {
  id: string;
  lease: string;
  task: HelperTask;
  system: string;
  user: string;
  maxTokens: number;
  json: boolean;
}

const json = <T,>(s: string | null, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

/** May this worker take a text job now: a pool worker the website hasn't paused, not draining, inside its hours, heard from. */
export function textEligible(w: WorkerRow, now = Date.now()): boolean {
  return (
    w.kind === "pool" &&
    !w.revoked_at &&
    !(w.expires_at && w.expires_at <= now) &&
    !w.paused_server &&
    !w.drain &&
    !!w.seen_at &&
    now - w.seen_at <= HELPER_TIMES.freshBeatMs &&
    hoursAt(parseHours(json<unknown>(w.hours_json, null)), now).inside
  );
}

/** A text slot asked for a job in the last moments, from a worker that may take one. */
export function helperLive(now = Date.now()): boolean {
  const rows = db()
    .prepare("SELECT w.* FROM helper_slots s JOIN relay_workers w ON w.id = s.worker_id WHERE s.seen_at >= ?")
    .all(now - HELPER_TIMES.liveMs) as WorkerRow[];
  return rows.some((w) => textEligible(w, now));
}

/** May this call use the free helper now: it is live, and a visitor's call only while hosted runs are on. */
export const freeHelperOn = (now = Date.now()): boolean => (!tenant() || hostedRunsOn()) && helperLive(now);

/** The install has a text slot (one asked for a job today). */
export function helperKnown(now = Date.now()): boolean {
  return !!db().prepare("SELECT 1 FROM helper_slots WHERE seen_at >= ? LIMIT 1").get(now - HELPER_TIMES.knownMs);
}

/** Delete what no one waits for any more. */
export function sweepHelper(now = Date.now()): void {
  db().prepare("DELETE FROM helper_jobs WHERE created_at < ?").run(now - HELPER_TIMES.keepMs);
}

/**
 * The next job for this worker's text slot, or null: people's jobs first, then the owner's, oldest first. Notes the
 * slot as live either way.
 */
export function claimHelperJob(w: WorkerRow, slot: { model?: unknown; device?: unknown } = {}, now = Date.now(), note = true): HelperJob | null {
  const d = db();
  return d.transaction(() => {
    const model = typeof slot.model === "string" ? slot.model.slice(0, 120) : null;
    const device = slot.device === "gpu" || slot.device === "cpu" ? slot.device : null;
    if (note) d.prepare("INSERT INTO helper_slots (worker_id, seen_at, model, device) VALUES (?, ?, ?, ?) ON CONFLICT(worker_id) DO UPDATE SET seen_at = excluded.seen_at, model = excluded.model, device = excluded.device").run(w.id, now, model, device);
    const fresh = d.prepare("SELECT * FROM relay_workers WHERE id = ?").get(w.id) as WorkerRow | undefined;
    if (!fresh || !textEligible(fresh, now)) return null;
    const row = d.prepare("SELECT * FROM helper_jobs WHERE state = 'waiting' ORDER BY CASE WHEN who = 'owner' THEN 1 ELSE 0 END, created_at LIMIT 1").get() as JobRow | undefined;
    if (!row || !isHelperTask(row.task)) return null;
    const lease = crypto.randomBytes(16).toString("base64url");
    d.prepare("UPDATE helper_jobs SET state = 'running', worker_id = ?, lease = ?, claimed_at = ? WHERE id = ? AND state = 'waiting'").run(w.id, lease, now, row.id);
    return { id: row.id, lease, task: row.task, system: row.system, user: row.user, maxTokens: row.max_tokens, json: !!row.json };
  }).immediate();
}

/** Is any text job waiting (a quick read before a claim)? */
export const helperWaiting = (): boolean => !!db().prepare("SELECT 1 FROM helper_jobs WHERE state = 'waiting' LIMIT 1").get();

/** What a model may leave around its answer: a reasoning block, a code fence around JSON. */
export const tidyHelperText = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

/** A text slot's answer for its job (only with the lease its claim gave). False: not its job any more. */
export function finishHelperJob(w: WorkerRow, id: string, body: { lease?: unknown; text?: unknown; error?: unknown }, now = Date.now()): boolean {
  if (typeof body.lease !== "string") return false;
  let text: string | null = null;
  let error: string | null = null;
  if (typeof body.text === "string" && Buffer.byteLength(body.text) <= HELPER_LIMITS.textBytes) text = tidyHelperText(body.text);
  if (!text) error = typeof body.error === "string" && body.error ? body.error.slice(0, 200) : "no-text";
  const r = db()
    .prepare("UPDATE helper_jobs SET state = ?, text = ?, error = ?, done_at = ? WHERE id = ? AND worker_id = ? AND lease = ? AND state = 'running'")
    .run(text ? "done" : "failed", text, error, now, id, w.id, body.lease);
  return r.changes === 1;
}

export type HelperAnswer = { text: string } | { error: "busy" | "limit" | "blocked" | "failed"; message?: string; retryAfterS?: number };

const rateOf = (who: HelperWho) => (who.startsWith("acct:") ? HELPER_LIMITS.account : who === "guest:shared" ? { perMinute: HELPER_LIMITS.guest.perMinute * 10, perHour: HELPER_LIMITS.guest.perHour * 10 } : HELPER_LIMITS.guest);

export interface AskHelper {
  task: HelperTask;
  system: string;
  user: string;
  json?: boolean;
  who?: HelperWho;
  /** False: a step of a run, which the run's own limits already count. */
  counted?: boolean;
  /** How long the job may wait for a text slot (the answer's own time comes after). */
  waitMs?: number;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Ask the free helper and wait for its answer. Never throws for the helper's own trouble: the answer says what went wrong. */
export async function askHelper(o: AskHelper): Promise<HelperAnswer> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const who = o.who ?? helperWho();
  const d = db();
  sweepHelper(now());
  if (!helperLive(now())) return { error: "busy" };
  if (who !== "owner" && o.counted !== false) {
    const r = rateOf(who);
    for (const [key, limit, ms] of [[`helper:${who}:m`, r.perMinute, 60_000], [`helper:${who}:h`, r.perHour, 3_600_000]] as const) {
      const h = hit(key, limit, ms);
      if (!h.ok) return { error: "limit", retryAfterS: h.retryAfterS };
    }
  }
  const waiting = d.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN who = ? THEN 1 ELSE 0 END) AS mine FROM helper_jobs WHERE state IN ('waiting','running')").get(who) as { n: number; mine: number | null };
  if (waiting.n >= HELPER_LIMITS.waitingAll || (who !== "owner" && (waiting.mine ?? 0) >= HELPER_LIMITS.waitingEach)) return { error: "busy" };
  const user = o.user.slice(0, HELPER_LIMITS.userChars);
  const id = `hlp_${crypto.randomBytes(9).toString("base64url")}`;
  const account = who.startsWith("acct:") ? who.slice(5) : null;
  let checkOutputs = false;
  if (who !== "owner" && moderationConfigured()) {
    const a = await checkRun({
      requestId: id,
      account: account ? { id: account } : null,
      run: { place: "pool", model: "text-helper", op: o.task, app: null, preset: null, studio: o.task, kind: "text", engine: "open", provider: "llm", jobs: 1, outputsPerJob: 1, megapixels: null, seconds: null, fps: null, loras: 0, inputs: { image: 0, video: 0, audio: 0 }, lane: null, providerUsd: null },
      prompt: user,
      negative: null,
      inputs: [],
      consent: null,
    });
    if (!a.allowed) return a.code === "paused" ? { error: "busy" } : { error: "blocked", message: a.text };
    checkOutputs = a.checkOutputs !== false;
  }
  const created = now();
  d.prepare("INSERT INTO helper_jobs (id, who, task, system, user, max_tokens, json, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?)").run(
    id,
    who,
    o.task,
    o.system.slice(0, HELPER_LIMITS.systemChars),
    user,
    HELPER_TASKS[o.task].maxTokens,
    o.json ? 1 : 0,
    created,
  );
  const waitMs = o.waitMs ?? 45_000;
  const drop = () => d.prepare("DELETE FROM helper_jobs WHERE id = ?").run(id);
  try {
    for (;;) {
      if (o.signal?.aborted) return { error: "failed" };
      const row = d.prepare("SELECT * FROM helper_jobs WHERE id = ?").get(id) as JobRow | undefined;
      const t = now();
      if (!row || row.state === "failed") return { error: row?.error === "busy" ? "busy" : "failed" };
      if (row.state === "done" && row.text) {
        if (checkOutputs) {
          const bytes = Buffer.from(row.text);
          const c = await checkOutput({ bytes, contentType: "text/plain; charset=utf-8", generationId: id, account, assetId: id, kind: "text", sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
          if (c.decision !== "show") return c.decision === "hide" && c.text ? { error: "blocked", message: c.text } : { error: "failed" };
        }
        return { text: row.text };
      }
      if (row.state === "waiting" && t - created >= waitMs) {
        // Nobody took it in time: it ends here, so a slot that comes late doesn't run it.
        if (d.prepare("UPDATE helper_jobs SET state = 'failed', error = 'busy' WHERE id = ? AND state = 'waiting'").run(id).changes === 1) return { error: "busy" };
        continue;
      }
      if (row.state === "running" && t - (row.claimed_at ?? t) >= HELPER_TIMES.runMs) return { error: "failed" };
      await sleep(HELPER_TIMES.pollMs);
    }
  } finally {
    drop();
  }
}
