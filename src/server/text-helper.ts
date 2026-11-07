import "server-only";
import crypto from "node:crypto";
import sharp from "sharp";
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
 * GPU job; the caller waits for the answer, and the row is deleted once read. A chat sends its turns, and a slot that
 * takes chats sends the words so far as they come.
 */

export type HelperTask = "lyrics" | "enhance" | "soul" | "write" | "translate" | "describe" | "restore" | "recipe" | "chat";

/** The most tokens a task may write. */
export const HELPER_TASKS: Record<HelperTask, { maxTokens: number }> = {
  lyrics: { maxTokens: 1200 },
  enhance: { maxTokens: 400 },
  soul: { maxTokens: 400 },
  write: { maxTokens: 4000 },
  translate: { maxTokens: 4000 },
  describe: { maxTokens: 200 },
  restore: { maxTokens: 500 },
  recipe: { maxTokens: 1500 },
  chat: { maxTokens: 900 },
};

export const isHelperTask = (v: unknown): v is HelperTask => typeof v === "string" && Object.hasOwn(HELPER_TASKS, v);

export const HELPER_TIMES = {
  /** A text slot that asked for a job this recently is live. */
  liveMs: 45_000,
  /** A text slot seen this recently means the install has the helper (visitors see its buttons). */
  knownMs: 24 * 60 * 60_000,
  /** How long one claim waits for a job. */
  claimWaitMs: 20_000,
  /** A claimed job with no answer (for a job that streams: no new words) after this fails. */
  runMs: 90_000,
  /** A job that streams ends after this, however its words come. */
  streamMaxMs: 300_000,
  /** Rows older than this are deleted. */
  keepMs: 10 * 60_000,
  pollMs: 200,
  freshBeatMs: 30_000,
  /** A slot seen this recently that asks for no jobs now (its worker restarts) is coming back: a chat waits for it. */
  startingMs: 180_000,
  /** How long a chat may wait in line or for a slot that is coming back (another task waits 45 s). */
  chatWaitMs: 120_000,
};

export const HELPER_LIMITS = {
  userChars: 6000,
  systemChars: 8000,
  textBytes: 64 * 1024,
  waitingAll: 60,
  waitingEach: 2,
  guest: { perMinute: 4, perHour: 20 },
  account: { perMinute: 8, perHour: 60 },
  /** Chat counts on its own key, apart from the studio's tasks. */
  chat: { perMinute: 12, perHour: 300 },
  /** A chat's turns: how many, and their words together (the caller trims older turns itself). */
  chatTurns: 200,
  chatChars: 24_000,
  /** Tools a chat may offer: how many, and their definitions as JSON together. */
  tools: 64,
  toolsChars: 32_000,
  /** Tool calls in one answer or one assistant turn, and the arguments of one. */
  toolCalls: 16,
  toolArgsChars: 8000,
  /** Pictures a job may carry: how many, how big each may come in, and as the small JPEG it is sent as. */
  pictures: { count: 4, inputBytes: 20 * 2 ** 20, longEdge: 1024, outputBytes: 512 * 1024 },
};

/** A tool call as a chat's assistant turn carries it (OpenAI's shape; `arguments` is JSON text). */
export interface HelperToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/**
 * One turn of a chat: the person's, the model's (its words, the tools it called, or both), or a tool's result for one
 * of those calls.
 */
export type HelperMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content?: string; tool_calls?: HelperToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** A tool a chat offers the model (an OpenAI function definition). */
export interface HelperTool {
  type: "function";
  function: { name: string; description?: string; parameters: object };
}

export type HelperToolChoice = "auto" | "none" | { type: "function"; function: { name: string } };

/** A tool the model called in its answer. */
export interface HelperCall {
  id: string;
  name: string;
  /** JSON text, as the model wrote it (the caller parses and checks it). */
  arguments: string;
}

/** A tool's name: what OpenAI's function names allow. */
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const CALL_ID = /^[A-Za-z0-9_.:-]{1,100}$/;

/** The sampling a job may ask for, each inside these bounds. */
export const HELPER_SAMPLING = { temperature: [0, 2], top_p: [0.05, 1] } as const;

export type HelperSampling = { temperature?: number; top_p?: number };

/** A job's own sampling, inside safe bounds; null when it asks for none (the model family's then). */
export function helperSampling(s: HelperSampling | undefined | null): HelperSampling | null {
  if (!s || typeof s !== "object") return null;
  const out: HelperSampling = {};
  for (const k of ["temperature", "top_p"] as const) {
    const v = s[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.min(HELPER_SAMPLING[k][1], Math.max(HELPER_SAMPLING[k][0], v));
  }
  return Object.keys(out).length ? out : null;
}

/** Why these tool calls can't be kept, or null. */
function toolCallsProblem(calls: unknown): string | null {
  if (!Array.isArray(calls) || !calls.length || calls.length > HELPER_LIMITS.toolCalls) return "a turn's tool calls aren't a short list";
  for (const c of calls as Partial<HelperToolCall>[]) {
    if (!c || typeof c !== "object" || c.type !== "function" || typeof c.id !== "string" || !CALL_ID.test(c.id)) return "a tool call has no id";
    const f = c.function;
    if (!f || typeof f.name !== "string" || !TOOL_NAME.test(f.name) || typeof f.arguments !== "string" || f.arguments.length > HELPER_LIMITS.toolArgsChars) return "a tool call isn't a name with its arguments";
  }
  return null;
}

/**
 * Why these chat turns can't be sent, or null: the person's turns, the model's (words, tool calls or both) and tools'
 * results for calls made before them; the newest the person's or a tool's; within the limits.
 */
export function helperMessagesProblem(messages: unknown): string | null {
  if (!Array.isArray(messages) || !messages.length) return "no turns";
  if (messages.length > HELPER_LIMITS.chatTurns) return "too many turns";
  let chars = 0;
  const called = new Set<string>();
  for (const m of messages as Record<string, unknown>[]) {
    if (!m || typeof m !== "object") return "a turn isn't a user, assistant or tool turn";
    if (m.role === "user") {
      if (typeof m.content !== "string") return "a person's turn has no words";
      chars += m.content.length;
    } else if (m.role === "assistant") {
      if (m.content !== undefined && typeof m.content !== "string") return "an assistant turn's words aren't text";
      if (m.tool_calls !== undefined) {
        const p = toolCallsProblem(m.tool_calls);
        if (p) return p;
        for (const c of m.tool_calls as HelperToolCall[]) {
          called.add(c.id);
          chars += c.function.name.length + c.function.arguments.length;
        }
      } else if (typeof m.content !== "string") return "an assistant turn has neither words nor tool calls";
      chars += typeof m.content === "string" ? m.content.length : 0;
    } else if (m.role === "tool") {
      if (typeof m.tool_call_id !== "string" || !called.has(m.tool_call_id)) return "a tool's result answers no call before it";
      if (typeof m.content !== "string") return "a tool's result isn't text";
      chars += m.content.length;
    } else return "a turn isn't a user, assistant or tool turn";
  }
  if (chars > HELPER_LIMITS.chatChars) return "too long";
  const last = messages[messages.length - 1] as HelperMessage;
  if (last.role === "tool") return null;
  if (last.role !== "user" || !last.content.trim()) return "the newest turn isn't the person's or a tool's";
  return null;
}

/** Why these tools (and the choice among them) can't be offered, or null. */
export function helperToolsProblem(tools: unknown, choice?: unknown): string | null {
  if (!Array.isArray(tools) || !tools.length) return "no tools";
  if (tools.length > HELPER_LIMITS.tools) return "too many tools";
  const names = new Set<string>();
  for (const t of tools as Partial<HelperTool>[]) {
    const f = t?.function;
    if (!t || t.type !== "function" || !f || typeof f.name !== "string" || !TOOL_NAME.test(f.name)) return "a tool has no name";
    if (names.has(f.name)) return "two tools have the same name";
    names.add(f.name);
    if (f.description !== undefined && typeof f.description !== "string") return "a tool's description isn't text";
    if (!f.parameters || typeof f.parameters !== "object" || Array.isArray(f.parameters)) return "a tool's parameters aren't a schema";
  }
  if (JSON.stringify(tools).length > HELPER_LIMITS.toolsChars) return "the tools are too long";
  if (choice === undefined || choice === "auto" || choice === "none") return null;
  const c = choice as { type?: unknown; function?: { name?: unknown } };
  if (c && typeof c === "object" && c.type === "function" && typeof c.function?.name === "string" && names.has(c.function.name)) return null;
  return "the tool choice names no tool";
}

/** The tool calls a slot sent, kept only in their shape and only for tools the job offered. */
function callsOf(raw: unknown, offered: Set<string>): HelperCall[] {
  if (!Array.isArray(raw)) return [];
  const out: HelperCall[] = [];
  for (const c of raw.slice(0, HELPER_LIMITS.toolCalls) as Partial<HelperCall>[]) {
    if (!c || typeof c.name !== "string" || !offered.has(c.name) || typeof c.arguments !== "string" || c.arguments.length > HELPER_LIMITS.toolArgsChars) continue;
    out.push({ id: typeof c.id === "string" && CALL_ID.test(c.id) ? c.id : `call_${out.length + 1}`, name: c.name, arguments: c.arguments });
  }
  return out;
}

const FINISH = new Set(["stop", "tool_calls", "length"]);

/** A checked turn with only its own fields. */
const turnOf = (m: HelperMessage): HelperMessage =>
  m.role === "user"
    ? { role: "user", content: m.content }
    : m.role === "tool"
      ? { role: "tool", tool_call_id: m.tool_call_id, content: m.content }
      : {
          role: "assistant",
          ...(m.content !== undefined && { content: m.content }),
          ...(m.tool_calls && { tool_calls: m.tool_calls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.function.name, arguments: c.function.arguments } })) }),
        };

/** A checked tool with only its own fields. */
const toolOf = (t: HelperTool): HelperTool => ({ type: "function", function: { name: t.function.name, ...(t.function.description !== undefined && { description: t.function.description }), parameters: t.function.parameters } });

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
  state: "waiting" | "running" | "done" | "failed" | "canceled";
  worker_id: string | null;
  lease: string | null;
  created_at: number;
  claimed_at: number | null;
  done_at: number | null;
  text: string | null;
  error: string | null;
  images_json: string | null;
  messages_json: string | null;
  sampling_json: string | null;
  stream: number | null;
  partial: string | null;
  partial_at: number | null;
  tools_json: string | null;
  tool_choice_json: string | null;
  tool_calls_json: string | null;
  finish: string | null;
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
  /** Small JPEGs, as base64, for a slot whose model sees pictures (a chat's go with its newest turn). */
  images?: string[];
  /** A chat's turns, sent as they are after the system words (only to a slot that takes chats). */
  messages?: HelperMessage[];
  /** The job's own sampling, over the model family's. */
  sampling?: HelperSampling;
  /** The slot sends the words so far as they come (POST /api/gpu/computer/text/:id/partial). */
  stream?: true;
  /** Tools the model may call (only to a slot that takes tools), and how it may choose among them. */
  tools?: HelperTool[];
  toolChoice?: HelperToolChoice;
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

/**
 * A text slot asked for a job in the last moments, from a worker that may take one (`vision`: one whose model sees
 * pictures; `chat`: one that takes chats).
 */
export function helperLive(now = Date.now(), o: { vision?: boolean; chat?: boolean; tools?: boolean } = {}): boolean {
  const rows = db()
    .prepare(`SELECT w.* FROM helper_slots s JOIN relay_workers w ON w.id = s.worker_id WHERE s.seen_at >= ? AND s.away IS NULL${o.vision ? " AND s.vision = 1" : ""}${o.chat ? " AND s.chat = 1" : ""}${o.tools ? " AND s.tools = 1" : ""}`)
    .all(now - HELPER_TIMES.liveMs) as WorkerRow[];
  return rows.some((w) => textEligible(w, now));
}

/**
 * How the helper's slots stand for a job like this one. "ready": one asks for jobs and has none in hand. "busy": every
 * one that asks has a job in hand (the line moves). "starting": none asks now, but one was here moments ago and is
 * coming back (its worker restarts on new code, or it just went quiet). "absent": none is coming.
 */
export type HelperState = "ready" | "busy" | "starting" | "absent";

export function helperState(now = Date.now(), o: { vision?: boolean; chat?: boolean; tools?: boolean } = {}): HelperState {
  const d = db();
  const rows = d
    .prepare(`SELECT w.*, s.seen_at AS slot_seen_at, s.away AS slot_away FROM helper_slots s JOIN relay_workers w ON w.id = s.worker_id WHERE s.seen_at >= ?${o.vision ? " AND s.vision = 1" : ""}${o.chat ? " AND s.chat = 1" : ""}${o.tools ? " AND s.tools = 1" : ""}`)
    .all(now - HELPER_TIMES.startingMs) as (WorkerRow & { slot_seen_at: number; slot_away: string | null })[];
  const live = rows.filter((r) => r.slot_away === null && now - r.slot_seen_at <= HELPER_TIMES.liveMs && textEligible(r, now));
  if (live.length) {
    const working = d.prepare("SELECT 1 FROM helper_jobs WHERE state = 'running' AND worker_id = ? LIMIT 1");
    return live.every((r) => working.get(r.id)) ? "busy" : "ready";
  }
  // Coming back: a worker the website lets work, restarting on new code or quiet for a moment (not paused, not gone).
  const coming = rows.some(
    (r) =>
      (r.slot_away === null || r.slot_away === "updating") &&
      r.kind === "pool" &&
      !r.revoked_at &&
      !(r.expires_at && r.expires_at <= now) &&
      !r.paused_server &&
      !r.drain &&
      hoursAt(parseHours(json<unknown>(r.hours_json, null)), now).inside,
  );
  return coming ? "starting" : "absent";
}

/** A worker's text slot says why it takes no jobs for now ("updating": back in moments; "paused" or "stopped"). */
export function noteHelperAway(w: WorkerRow, state: unknown, now = Date.now()): boolean {
  if (state !== "updating" && state !== "paused" && state !== "stopped") return false;
  return db().prepare("UPDATE helper_slots SET away = ?, away_at = ? WHERE worker_id = ?").run(state, now, w.id).changes === 1;
}

/**
 * How the free helper stands for this call: helperState, and "absent" for a call that may not use it (a guest's, or an
 * account's while hosted runs are off). A chat may be asked unless "absent": it waits for a slot that is coming back.
 */
export function freeHelperState(now = Date.now(), o: { vision?: boolean; chat?: boolean; tools?: boolean } = {}): HelperState {
  const t = tenant();
  return !t || (t.kind === "account" && hostedRunsOn()) ? helperState(now, o) : "absent";
}

/** May this call use the free helper now: it is live, and an account's call only while hosted runs are on (a guest's never: sign up first). */
export function freeHelperOn(now = Date.now(), o: { vision?: boolean; chat?: boolean; tools?: boolean } = {}): boolean {
  const t = tenant();
  return (!t || (t.kind === "account" && hostedRunsOn())) && helperLive(now, o);
}

/**
 * Pictures as the helper takes them: at most four, each from a file the caller already read for the person, made again
 * as a JPEG of at most 1024 px on its long side, with no metadata. Null when one can't be read or stays too big.
 */
export async function helperPictures(images: { data: Buffer; contentType: string }[]): Promise<string[] | null> {
  const p = HELPER_LIMITS.pictures;
  if (images.length > p.count || images.some((i) => !/^image\/(png|jpeg|webp|gif)$/.test(i.contentType) || i.data.length > p.inputBytes)) return null;
  const out: string[] = [];
  for (const i of images) {
    let jpeg: Buffer | null = null;
    for (const quality of [82, 65, 50]) {
      const b = await sharp(i.data, { animated: false, limitInputPixels: 64 * 2 ** 20 })
        .rotate()
        .resize({ width: p.longEdge, height: p.longEdge, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality })
        .toBuffer()
        .catch(() => null);
      if (!b) return null;
      if (b.length <= p.outputBytes) {
        jpeg = b;
        break;
      }
    }
    if (!jpeg) return null;
    out.push(jpeg.toString("base64"));
  }
  return out;
}

/** The install has a text slot (one asked for a job today). */
export function helperKnown(now = Date.now()): boolean {
  return !!db().prepare("SELECT 1 FROM helper_slots WHERE seen_at >= ? LIMIT 1").get(now - HELPER_TIMES.knownMs);
}

/** Delete what no one waits for any more. */
export function sweepHelper(now = Date.now()): void {
  db().prepare("DELETE FROM helper_jobs WHERE created_at < ?").run(now - HELPER_TIMES.keepMs);
}

/** The jobs a slot may take: one with pictures only where its model sees them, a chat only where the slot takes chats. */
const takes = (vision: boolean, chat: boolean, tools = false) => `${vision ? "" : " AND images_json IS NULL"}${chat ? "" : " AND messages_json IS NULL"}${tools ? "" : " AND tools_json IS NULL"}`;

/** The line's order: people's jobs first, then the owner's, oldest first. */
const OWNER_LAST = "CASE WHEN who = 'owner' THEN 1 ELSE 0 END";

/**
 * The next job for this worker's text slot, or null: people's jobs first, then the owner's, oldest first. Notes the
 * slot as live either way. `chat`: the slot takes chats (turns, and words sent as they come); an older worker never
 * says so, and gets the same jobs as before.
 */
export function claimHelperJob(w: WorkerRow, slot: { model?: unknown; device?: unknown; vision?: unknown; chat?: unknown; tools?: unknown } = {}, now = Date.now(), note = true): HelperJob | null {
  const d = db();
  return d.transaction(() => {
    const model = typeof slot.model === "string" ? slot.model.slice(0, 120) : null;
    const device = slot.device === "gpu" || slot.device === "cpu" ? slot.device : null;
    const vision = slot.vision === true ? 1 : 0;
    const chat = slot.chat === true ? 1 : 0;
    const tools = chat && slot.tools === true ? 1 : 0;
    if (note) {
      d.prepare(
        "INSERT INTO helper_slots (worker_id, seen_at, model, device, vision, chat, tools, away, away_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL) ON CONFLICT(worker_id) DO UPDATE SET seen_at = excluded.seen_at, model = excluded.model, device = excluded.device, vision = excluded.vision, chat = excluded.chat, tools = excluded.tools, away = NULL, away_at = NULL",
      ).run(w.id, now, model, device, vision, chat, tools);
    }
    const fresh = d.prepare("SELECT * FROM relay_workers WHERE id = ?").get(w.id) as WorkerRow | undefined;
    if (!fresh || !textEligible(fresh, now)) return null;
    const row = d.prepare(`SELECT * FROM helper_jobs WHERE state = 'waiting'${takes(!!vision, !!chat, !!tools)} ORDER BY ${OWNER_LAST}, created_at, id LIMIT 1`).get() as JobRow | undefined;
    if (!row || !isHelperTask(row.task)) return null;
    const lease = crypto.randomBytes(16).toString("base64url");
    d.prepare("UPDATE helper_jobs SET state = 'running', worker_id = ?, lease = ?, claimed_at = ? WHERE id = ? AND state = 'waiting'").run(w.id, lease, now, row.id);
    const images = json<string[] | null>(row.images_json, null);
    const messages = json<HelperMessage[] | null>(row.messages_json, null);
    const sampling = json<HelperSampling | null>(row.sampling_json, null);
    const offered = json<HelperTool[] | null>(row.tools_json, null);
    const toolChoice = json<HelperToolChoice | null>(row.tool_choice_json, null);
    return {
      id: row.id,
      lease,
      task: row.task,
      system: row.system,
      user: row.user,
      maxTokens: row.max_tokens,
      json: !!row.json,
      ...(images?.length && { images }),
      ...(messages?.length && { messages }),
      ...(sampling && { sampling }),
      ...(row.stream ? { stream: true as const } : {}),
      ...(offered?.length && { tools: offered, ...(toolChoice && { toolChoice }) }),
    };
  }).immediate();
}

/** Is any text job waiting that this slot may take (a quick read before a claim)? */
export const helperWaiting = (vision = false, chat = false, tools = false): boolean => !!db().prepare(`SELECT 1 FROM helper_jobs WHERE state = 'waiting'${takes(vision, chat, tools)} LIMIT 1`).get();

/** Where a waiting job stands in the line: 1 is next. Null once it isn't waiting. */
export function helperPosition(id: string): number | null {
  const d = db();
  const row = d.prepare(`SELECT ${OWNER_LAST} AS rank, created_at, state FROM helper_jobs WHERE id = ?`).get(id) as { rank: number; created_at: number; state: string } | undefined;
  if (!row || row.state !== "waiting") return null;
  const ahead = d
    .prepare(`SELECT COUNT(*) AS n FROM helper_jobs WHERE state = 'waiting' AND (${OWNER_LAST} < ? OR (${OWNER_LAST} = ? AND (created_at < ? OR (created_at = ? AND id < ?))))`)
    .get(row.rank, row.rank, row.created_at, row.created_at, id) as { n: number };
  return ahead.n + 1;
}

/** What a model may leave around its answer: a reasoning block, a code fence around JSON. */
export const tidyHelperText = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

/** Words so far: a reasoning block that hasn't ended yet goes too. */
const tidyPartial = (s: string) => tidyHelperText(s.replace(/<think>(?![\s\S]*<\/think>)[\s\S]*$/, ""));

/**
 * A text slot's words so far for its job, with the lease its claim gave. "ok": kept. "stop": not its job any more (the
 * caller went, or the job ended), so the slot stops writing. "bad": not words it may send.
 */
export function partialHelperJob(w: WorkerRow, id: string, body: { lease?: unknown; text?: unknown }, now = Date.now()): "ok" | "stop" | "bad" {
  if (typeof body.lease !== "string" || typeof body.text !== "string" || Buffer.byteLength(body.text) > HELPER_LIMITS.textBytes) return "bad";
  const r = db()
    .prepare("UPDATE helper_jobs SET partial = ?, partial_at = ? WHERE id = ? AND worker_id = ? AND lease = ? AND state = 'running'")
    .run(tidyPartial(body.text), now, id, w.id, body.lease);
  return r.changes === 1 ? "ok" : "stop";
}

/** A text slot's answer for its job (only with the lease its claim gave). False: not its job any more. */
export function finishHelperJob(w: WorkerRow, id: string, body: { lease?: unknown; text?: unknown; error?: unknown; toolCalls?: unknown; finish?: unknown }, now = Date.now()): boolean {
  if (typeof body.lease !== "string") return false;
  const d = db();
  let text: string | null = null;
  let error: string | null = null;
  if (typeof body.text === "string" && Buffer.byteLength(body.text) <= HELPER_LIMITS.textBytes) text = tidyHelperText(body.text);
  // Tool calls count only for tools the job offered.
  let calls: HelperCall[] = [];
  if (body.toolCalls !== undefined) {
    const row = d.prepare("SELECT tools_json FROM helper_jobs WHERE id = ? AND worker_id = ? AND lease = ?").get(id, w.id, body.lease) as { tools_json: string | null } | undefined;
    const offered = new Set(json<HelperTool[]>(row?.tools_json ?? null, []).map((t) => t.function.name));
    calls = callsOf(body.toolCalls, offered);
  }
  const answered = !!text || calls.length > 0;
  if (!answered) error = typeof body.error === "string" && body.error ? body.error.slice(0, 200) : "no-text";
  const finish = typeof body.finish === "string" && FINISH.has(body.finish) ? (calls.length ? "tool_calls" : body.finish === "tool_calls" ? "stop" : body.finish) : calls.length ? "tool_calls" : null;
  const r = d
    .prepare("UPDATE helper_jobs SET state = ?, text = ?, error = ?, done_at = ?, tool_calls_json = ?, finish = ? WHERE id = ? AND worker_id = ? AND lease = ? AND state = 'running'")
    .run(answered ? "done" : "failed", answered ? (text ?? "") : null, error, now, calls.length ? JSON.stringify(calls) : null, answered ? finish : null, id, w.id, body.lease);
  return r.changes === 1;
}

/** "sign-in": a guest's call, refused before anything is checked or queued. */
export type HelperAnswer =
  | {
      /** The model's words ("" when it only called tools). */
      text: string;
      /** The tools it called (a chat that offered tools), in order. */
      toolCalls?: HelperCall[];
      /** Why it stopped, from a worker that says: done, to call tools, or at its token limit. Missing: as "stop". */
      finish?: "stop" | "tool_calls" | "length";
    }
  | { error: "busy" | "limit" | "blocked" | "failed" | "sign-in"; message?: string; retryAfterS?: number };

const rateOf = (who: HelperWho) => (who.startsWith("acct:") ? HELPER_LIMITS.account : who === "guest:shared" ? { perMinute: HELPER_LIMITS.guest.perMinute * 10, perHour: HELPER_LIMITS.guest.perHour * 10 } : HELPER_LIMITS.guest);

export interface AskHelper {
  task: HelperTask;
  system: string;
  /** The words to answer (a chat sends `messages` instead). */
  user?: string;
  /**
   * A chat's turns, oldest first, the newest the person's: sent as real turns after `system`, only to a slot that takes
   * chats. At most HELPER_LIMITS.chatChars of words in all (the caller trims older turns itself).
   */
  messages?: HelperMessage[];
  /** The job's own sampling, kept inside HELPER_SAMPLING; the model family's when unset. */
  sampling?: HelperSampling;
  /**
   * Tools the model may call (a chat only; only a slot that takes tools gets it): OpenAI function definitions, at most
   * HELPER_LIMITS.toolsChars of JSON in all. The answer's toolCalls are the calls it made.
   */
  tools?: HelperTool[];
  tool_choice?: HelperToolChoice;
  json?: boolean;
  /** Pictures for a model that sees them (only a slot that does takes the job). A chat takes one, with its newest turn. */
  images?: { data: Buffer; contentType: string }[];
  who?: HelperWho;
  /** False: a step of a run, which the run's own limits already count. */
  counted?: boolean;
  /** How long the job may wait for a text slot (the answer's own time comes after). */
  waitMs?: number;
  /** The caller went: the job ends, and a slot writing it stops at its next words. */
  signal?: AbortSignal;
  /** The words so far, each time more come (only from a slot that sends them; the whole answer still comes back). */
  onText?: (soFar: string) => void;
  /** Where the job stands in the line while it waits (1 is next), each time that changes. */
  onQueue?: (position: number) => void;
  /**
   * What the job waits for, each time that changes: "starting" (no slot asks for jobs now, but one is coming back: its
   * worker restarts), "in-line" (a slot asks; onQueue says the place), "running" (a slot is writing the answer).
   */
  onState?: (state: "starting" | "in-line" | "running") => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Ask the free helper and wait for its answer. Never throws for the helper's own trouble: the answer says what went wrong. */
export async function askHelper(o: AskHelper): Promise<HelperAnswer> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const who = o.who ?? helperWho();
  // A guest signs up first: no moderation call, no job.
  if (who.startsWith("guest:")) return { error: "sign-in" };
  // A chat's turns: checked here, before anything is counted or queued.
  const chat = o.messages !== undefined;
  if (chat) {
    const problem = helperMessagesProblem(o.messages);
    if (problem) return { error: "failed", message: `The conversation can't be sent: ${problem}.` };
    if ((o.images?.length ?? 0) > 1) return { error: "failed", message: "A chat turn takes one picture." };
  }
  const tools = o.tools !== undefined;
  if (tools) {
    const problem = chat ? helperToolsProblem(o.tools, o.tool_choice) : "tools need a chat's turns";
    if (problem) return { error: "failed", message: `The tools can't be offered: ${problem}.` };
  }
  const d = db();
  sweepHelper(now());
  const vision = !!o.images?.length;
  // A chat waits for a slot that is coming back (its worker restarts on new code); another task needs one asking now.
  if (chat ? helperState(now(), { vision, chat, tools }) === "absent" : !helperLive(now(), { vision, chat })) return { error: "busy" };
  const pictures = vision ? await helperPictures(o.images!) : null;
  if (vision && !pictures) return { error: "failed" };
  if (who !== "owner" && o.counted !== false) {
    // Chat has its own key, so a long talk never uses up the studio's rewrites (and the other way round).
    const [name, r] = o.task === "chat" ? ["helper-chat", HELPER_LIMITS.chat] : ["helper", rateOf(who)];
    for (const [key, limit, ms] of [[`${name}:${who}:m`, r.perMinute, 60_000], [`${name}:${who}:h`, r.perHour, 3_600_000]] as const) {
      const h = hit(key, limit, ms);
      if (!h.ok) return { error: "limit", retryAfterS: h.retryAfterS };
    }
  }
  const waiting = d.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN who = ? THEN 1 ELSE 0 END) AS mine FROM helper_jobs WHERE state IN ('waiting','running')").get(who) as { n: number; mine: number | null };
  if (waiting.n >= HELPER_LIMITS.waitingAll || (who !== "owner" && (waiting.mine ?? 0) >= HELPER_LIMITS.waitingEach)) return { error: "busy" };
  // A chat's newest turn is its words for moderation (the turns before it were checked when they were sent).
  // A chat's newest turn of the person's is its words for moderation (the turns before it were checked when they were sent).
  const newest = chat ? o.messages!.findLast((m) => m.role === "user") : null;
  const user = (chat ? newest?.content || "Continue." : (o.user ?? "")).slice(0, HELPER_LIMITS.userChars);
  const sampling = helperSampling(o.sampling);
  const stream = chat || !!o.onText;
  const id = `hlp_${crypto.randomBytes(9).toString("base64url")}`;
  const account = who.startsWith("acct:") ? who.slice(5) : null;
  let checkOutputs = false;
  if (who !== "owner" && moderationConfigured()) {
    const a = await checkRun({
      requestId: id,
      account: account ? { id: account } : null,
      run: { place: "pool", model: "text-helper", op: o.task, app: null, preset: null, studio: o.task, kind: "text", engine: "open", provider: "llm", jobs: 1, outputsPerJob: 1, megapixels: null, seconds: null, fps: null, loras: 0, inputs: { image: pictures?.length ?? 0, video: 0, audio: 0 }, lane: null, providerUsd: null },
      prompt: user,
      negative: null,
      inputs: (pictures ?? []).map((b, n) => ({ n, kind: "image" as const, sha256: crypto.createHash("sha256").update(Buffer.from(b, "base64")).digest("hex"), preview: null })),
      consent: null,
    });
    if (!a.allowed) return a.code === "paused" ? { error: "busy" } : { error: "blocked", message: a.text };
    checkOutputs = a.checkOutputs !== false;
  }
  const created = now();
  d.prepare(
    "INSERT INTO helper_jobs (id, who, task, system, user, max_tokens, json, state, created_at, images_json, messages_json, sampling_json, stream, tools_json, tool_choice_json) VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    who,
    o.task,
    o.system.slice(0, HELPER_LIMITS.systemChars),
    user,
    HELPER_TASKS[o.task].maxTokens,
    o.json ? 1 : 0,
    created,
    pictures ? JSON.stringify(pictures) : null,
    chat ? JSON.stringify(o.messages!.map(turnOf)) : null,
    sampling ? JSON.stringify(sampling) : null,
    stream ? 1 : 0,
    tools ? JSON.stringify(o.tools!.map(toolOf)) : null,
    tools && o.tool_choice !== undefined ? JSON.stringify(o.tool_choice) : null,
  );
  const waitMs = o.waitMs ?? (chat ? HELPER_TIMES.chatWaitMs : 45_000);
  // A caller's hook never stops the wait.
  const tell = <T,>(f: ((v: T) => void) | undefined, v: T) => {
    try {
      f?.(v);
    } catch {}
  };
  let shown = "";
  let place = 0;
  let said = "";
  const say = (state: "starting" | "in-line" | "running") => state !== said && tell(o.onState, (said = state));
  try {
    for (;;) {
      if (o.signal?.aborted) return { error: "failed" };
      const row = d.prepare("SELECT * FROM helper_jobs WHERE id = ?").get(id) as JobRow | undefined;
      const t = now();
      if (!row || row.state === "failed" || row.state === "canceled") return { error: row?.error === "busy" ? "busy" : "failed" };
      if (row.state === "done" && (row.text || row.tool_calls_json)) {
        if (checkOutputs && row.text) {
          const bytes = Buffer.from(row.text);
          const c = await checkOutput({ bytes, contentType: "text/plain; charset=utf-8", generationId: id, account, assetId: id, kind: "text", sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
          if (c.decision !== "show") return c.decision === "hide" && c.text ? { error: "blocked", message: c.text } : { error: "failed" };
        }
        const calls = json<HelperCall[] | null>(row.tool_calls_json, null);
        const finish = row.finish && FINISH.has(row.finish) ? (row.finish as "stop" | "tool_calls" | "length") : null;
        return { text: row.text ?? "", ...(calls?.length && { toolCalls: calls }), ...(finish && { finish }) };
      }
      if (row.state === "waiting") {
        if (t - created >= waitMs) {
          // Nobody took it in time: it ends here, so a slot that comes late doesn't run it.
          if (d.prepare("UPDATE helper_jobs SET state = 'failed', error = 'busy' WHERE id = ? AND state = 'waiting'").run(id).changes === 1) return { error: "busy" };
          continue;
        }
        if (chat || o.onState) {
          const state = helperState(t, { vision, chat });
          // No slot is coming any more (none asked for minutes, or its worker was paused): it ends now.
          if (chat && state === "absent") {
            if (d.prepare("UPDATE helper_jobs SET state = 'failed', error = 'busy' WHERE id = ? AND state = 'waiting'").run(id).changes === 1) return { error: "busy" };
            continue;
          }
          say(state === "starting" ? "starting" : "in-line");
        }
        if (o.onQueue) {
          const p = helperPosition(id);
          if (p && p !== place) tell(o.onQueue, (place = p));
        }
      }
      if (row.state === "running") {
        say("running");
        if (row.partial && row.partial !== shown) tell(o.onText, (shown = row.partial));
        // A slot that sends its words has the time again with each; an older one has it from its claim.
        const claimed = row.claimed_at ?? t;
        if (t - Math.max(claimed, row.partial_at ?? 0) >= HELPER_TIMES.runMs || t - claimed >= HELPER_TIMES.streamMaxMs) return { error: "failed" };
      }
      await sleep(HELPER_TIMES.pollMs);
    }
  } finally {
    // A job its slot is still writing is marked canceled, and the slot stops at its next words (the sweep deletes the
    // row later). Any other row goes now.
    if (d.prepare("UPDATE helper_jobs SET state = 'canceled' WHERE id = ? AND state = 'running'").run(id).changes === 0) d.prepare("DELETE FROM helper_jobs WHERE id = ?").run(id);
  }
}
