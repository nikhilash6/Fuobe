import "server-only";
import crypto from "node:crypto";
import { getModel } from "@/lib/catalog";
import { replacedBy } from "@/lib/catalog/replaced";
import { laneLabel } from "@/lib/lanes";
import { HOLDING_OTHER, HOLDING_WHY, SENT_STATES, type WorkerHolding } from "@/lib/relay";
import { db } from "../db";
import { loadIndex } from "../gpu/index-file";
import { claimableNow, ownerWaitingNow, workerState } from "./pool";
import { json, taskCold, taskProgress, type TaskRow } from "./tasks";
import type { WorkerRow } from "./workers";

/**
 * What the workers do right now, for the owner's queue view (GET /api/admin/queue): the jobs they run, the jobs and the
 * line they hold back and why, the later steps of chains that wait for their earlier steps, and the text helper's line.
 * Facts only: ids, models, workers' names, times and plain reasons; never a prompt, a file or an account's email.
 */

/** Whose run: an account's ("user"), a guest's, or the owner's own. */
export type PrincipalKind = "user" | "guest" | "owner";

/** A job a worker runs now. */
export interface RunningJob {
  task: string;
  generationId: string;
  model: string | null;
  op: string | null;
  kind: string | null;
  lane: string | null;
  laneLabel: string | null;
  worker: string | null;
  /** The worker's slot: its GPU's, or its CPU slot's. */
  slot: "gpu" | "cpu";
  /** Where it is, in words ("Making your picture · step 36 of 48", "Loading the model", "Saving the results"). */
  step: string | null;
  progress: { value: number; max: number } | null;
  startedAt: number | null;
  claimedAt: number | null;
  /** When its run was made (pressed). */
  createdAt: number | null;
  principal: PrincipalKind;
}

/** A job waiting in line for a worker (the oldest first). */
export interface QueuedJob {
  task: string;
  generationId: string;
  model: string | null;
  op: string | null;
  lane: string | null;
  laneLabel: string | null;
  principal: PrincipalKind;
  /** When its run was made, and its place in line (a run back in line keeps its place). */
  createdAt: number | null;
  inLineAt: number;
}

/**
 * Held on a worker: a job a worker took that doesn't run yet (`task` set), or a worker that may take the line's work
 * and holds it back (`task` null; `waiting`: how many jobs in line it could take now). `why` in plain words, `code`
 * short, `since` when known.
 */
export interface HeldJob {
  worker: string;
  task: string | null;
  generationId: string | null;
  model: string | null;
  op: string | null;
  principal: PrincipalKind | null;
  why: string;
  code: string;
  since: number | null;
  /** When its run was made (a job it took). */
  createdAt?: number | null;
  waiting?: number;
}

/** A later step of a chain that waits for its earlier steps. */
export interface NextStep {
  generationId: string;
  model: string | null;
  op: string;
  principal: PrincipalKind;
  since: number;
  waitsFor: { generationId: string; model: string | null; op: string | null; status: string; step: string | null; endedAt: number | null }[];
}

/** The text helper's line (helper jobs: prompt writing, chat). */
export interface TextLine {
  waiting: number;
  running: number;
  oldestAt: number | null;
}

/** At most this many next steps are listed (oldest first); `nextTotal` counts them all. */
export const NEXT_LIMIT = 50;
/** At most this many jobs waiting in line are listed (the oldest first); `lanes` counts them all. */
export const QUEUED_LIMIT = 50;
/** A worker silent this long while it holds a job: the job counts as held, with how long it has been quiet. */
export const QUIET_MS = 60_000;
/** A worker's `holding` older than this (its beats stopped saying so) is no longer shown. */
const HOLDING_FRESH_MS = 60_000;

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** A task with no account is the owner's own; a guest's carries "guest" (or a "guest…" id). */
export const principalKind = (t: Pick<TaskRow, "account">): PrincipalKind => (!t.account ? "owner" : t.account.startsWith("guest") ? "guest" : "user");

export const modelLabel = (modelId: string | null | undefined): string | null => (modelId ? (getModel(modelId)?.name ?? replacedBy(modelId)?.was ?? modelId) : null);

const holdingOf = (w: Pick<WorkerRow, "holding_json">): WorkerHolding | null => json<WorkerHolding | null>(w.holding_json ?? null, null);
export const holdingWords = (why: string): string => HOLDING_WHY[why] ?? HOLDING_OTHER;

const mins = (ms: number) => Math.max(1, Math.round(ms / 60_000));

type GenFacts = { id: string; model_id: string; op: string; kind: string; status: string; message: string | null; created_at: number; completed_at: number | null };

export function liveQueue(now = Date.now()): { running: RunningJob[]; holding: HeldJob[]; queued: QueuedJob[]; next: NextStep[]; nextTotal: number; text: TextLine } {
  const d = db();
  const index = loadIndex();
  const workers = d.prepare("SELECT * FROM relay_workers WHERE kind = 'pool' AND revoked_at IS NULL").all() as WorkerRow[];
  const byId = new Map(workers.map((w) => [w.id, w]));
  const gen = d.prepare("SELECT id, model_id, op, kind, status, message, created_at, completed_at FROM generations WHERE id = ?");
  const genOf = (id: string) => gen.get(id) as GenFacts | undefined;

  const running: RunningJob[] = [];
  const holding: HeldJob[] = [];
  const states = SENT_STATES.map((s) => `'${s}'`).join(",");
  const taken = d.prepare(`SELECT * FROM relay_tasks WHERE pools IS NOT NULL AND state IN (${states}) ORDER BY COALESCE(claimed_at, created_at), id`).all() as TaskRow[];
  for (const t of taken) {
    const w = t.worker_id ? byId.get(t.worker_id) : undefined;
    const g = genOf(t.generation_id);
    const who = principalKind(t);
    const p = taskProgress(t);
    const h = w ? holdingOf(w) : null;
    const quiet = w?.seen_at ? now - w.seen_at : null;
    const base = { task: t.id, generationId: t.generation_id, model: modelLabel(g?.model_id), op: g?.op ?? null };
    // Held: the worker says it holds this job, it went quiet, or the job is still on its way to its ComfyUI.
    let held: { why: string; code: string; since: number | null } | null = null;
    if (h?.task === t.id && w?.seen_at && now - w.seen_at <= HOLDING_FRESH_MS) held = { why: holdingWords(h.why), code: h.why, since: h.since };
    else if (quiet !== null && quiet > QUIET_MS) held = { why: `No word from its worker for ${mins(quiet)} min`, code: "quiet", since: w!.seen_at };
    else if (t.state === "sending") held = { why: "Sending its files to the worker", code: "sending", since: t.sending_since ?? t.claimed_at };
    else if (t.state === "queued") held = { why: p?.position ? `In its worker's ComfyUI queue (place ${p.position})` : "In its worker's ComfyUI queue", code: "queued", since: t.sent_at ?? t.claimed_at };
    if (held) {
      holding.push({ worker: w?.name ?? "?", ...base, principal: who, ...held, createdAt: g?.created_at ?? null });
      continue;
    }
    const cold = taskCold(t);
    const step = t.state === "collecting" ? "Saving the results" : cold ? "Loading the model" : (g?.message ?? (p?.max ? `Step ${p.value ?? 0} of ${p.max}` : "Running"));
    running.push({
      ...base,
      kind: g?.kind ?? null,
      lane: t.lane,
      laneLabel: t.lane ? laneLabel(index, t.lane, sha) : null,
      worker: w?.name ?? null,
      slot: t.slot === "cpu" || t.finish_json ? "cpu" : "gpu",
      step,
      progress: !cold && p?.max ? { value: Math.min(p.value ?? 0, p.max), max: p.max } : null,
      startedAt: t.started_at ?? t.sent_at ?? t.claimed_at,
      claimedAt: t.claimed_at,
      createdAt: g?.created_at ?? null,
      principal: who,
    });
  }

  // The jobs waiting in line, the oldest place first.
  const queued: QueuedJob[] = (
    d.prepare("SELECT * FROM relay_tasks WHERE pools IS NOT NULL AND state = 'waiting' ORDER BY COALESCE(rank_at, created_at), id LIMIT ?").all(QUEUED_LIMIT) as TaskRow[]
  ).map((t) => {
    const g = genOf(t.generation_id);
    return {
      task: t.id,
      generationId: t.generation_id,
      model: modelLabel(g?.model_id),
      op: g?.op ?? null,
      lane: t.lane,
      laneLabel: t.lane ? laneLabel(index, t.lane, sha) : null,
      principal: principalKind(t),
      createdAt: g?.created_at ?? null,
      inLineAt: t.rank_at ?? t.created_at,
    };
  });

  // Workers that may take jobs waiting in line and hold them back: what they say (or their own pause) and since when.
  const busy = new Set(taken.map((t) => t.worker_id));
  for (const w of workers) {
    if (!w.seen_at || now - w.seen_at > QUIET_MS) continue;
    const h = holdingOf(w);
    if (h?.task && busy.has(w.id)) continue;
    const waiting = claimableNow(w, now) + ownerWaitingNow(w, now);
    if (!waiting) continue;
    const s = workerState(w, now);
    if (h && now - w.seen_at <= HOLDING_FRESH_MS) holding.push({ worker: w.name, task: null, generationId: null, model: null, op: null, principal: null, why: holdingWords(h.why), code: h.why, since: h.since, waiting });
    else if (!busy.has(w.id) && s.state !== "idle" && s.state !== "busy") holding.push({ worker: w.name, task: null, generationId: null, model: null, op: null, principal: null, why: s.words, code: s.state, since: null, waiting });
  }

  // Later steps of chains: queued, not handed to a provider, waiting for their earlier steps.
  const nextWhere = "status = 'queued' AND external_id IS NULL AND depends_on IS NOT NULL";
  const nextTotal = (d.prepare(`SELECT COUNT(*) AS n FROM generations WHERE ${nextWhere}`).get() as { n: number }).n;
  const next = (d.prepare(`SELECT id, model_id, op, request_json, depends_on, created_at FROM generations WHERE ${nextWhere} ORDER BY created_at, id LIMIT ?`).all(NEXT_LIMIT) as {
    id: string;
    model_id: string;
    op: string;
    request_json: string;
    depends_on: string;
    created_at: number;
  }[]).map((r) => {
    const deps = r.depends_on.startsWith("[") ? json<unknown[]>(r.depends_on, []).filter((x): x is string => typeof x === "string") : [r.depends_on];
    return {
      generationId: r.id,
      model: modelLabel(r.model_id),
      op: r.op,
      principal: json<{ account?: string }>(r.request_json, {}).account ? ("user" as const) : ("owner" as const),
      since: r.created_at,
      waitsFor: deps.slice(0, 16).map((id) => {
        const g = genOf(id);
        return { generationId: id, model: modelLabel(g?.model_id), op: g?.op ?? null, status: g?.status ?? "gone", step: g?.status === "queued" || g?.status === "running" ? g.message : null, endedAt: g?.completed_at ?? null };
      }),
    };
  });

  const tx = d.prepare("SELECT SUM(CASE WHEN state = 'waiting' THEN 1 ELSE 0 END) AS waiting, SUM(CASE WHEN state = 'running' THEN 1 ELSE 0 END) AS running, MIN(CASE WHEN state = 'waiting' THEN created_at END) AS oldest FROM helper_jobs WHERE state IN ('waiting','running')").get() as {
    waiting: number | null;
    running: number | null;
    oldest: number | null;
  };
  return { running, holding, queued, next, nextTotal, text: { waiting: tx.waiting ?? 0, running: tx.running ?? 0, oldestAt: tx.oldest ?? null } };
}
