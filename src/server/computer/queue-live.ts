import "server-only";
import crypto from "node:crypto";
import { getModel } from "@/lib/catalog";
import { replacedBy } from "@/lib/catalog/replaced";
import { laneLabel } from "@/lib/lanes";
import { HOLDING_OTHER, HOLDING_WHY, SENT_STATES, type WorkerHolding } from "@/lib/relay";
import { db } from "../db";
import { loadIndex } from "../gpu/index-file";
import { claimableNow, controlledLine, firstClaimableNow, localWorkOf, ownerHandsOn, ownerWaitingNow, workerState } from "./pool";
import { controlWords, effectiveMode, liveOverrides, MODE_WORDS, overrideView, personKey, poolMode, poolModes, recentOverrides, sweepControls, workerModeOf, type EffectiveMode, type OverrideView, type QueueMode } from "./queue-controls";
import type { LocalWork } from "@/lib/relay";
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
  /** The owner's hands-on run (pool.ts ownerHandsOn): it waits and runs as a person's run does. */
  handsOn?: true;
}

/** A job waiting in line for a worker, in the order the workers serve them (the ones no worker takes now last). */
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
  /** Its place in the line its pool's workers serve (1: next); null while no worker takes it (held, People only). */
  rank: number | null;
  /** Why it stands there, in words ("People first", "Run next", "Held by the owner"). */
  why: string;
  /** What decides it: the class's order ("class"), a run sent next ("next"), a boosted person ("boost"), or why no worker takes it now. */
  code: "class" | "next" | "boost" | "held" | "pinned" | "paused";
  /** The owner's override that decides it (null: none), with until when. */
  override: { id: string; until: number | null; by: string; at: number; workerId: string | null } | null;
  /** The person whose run it is, as a key (never an account id; null: the owner's own), and whether a guest's. */
  person: string | null;
  guest: boolean;
  /** The owner's hands-on run (pool.ts ownerHandsOn): it waits and runs as a person's run does. */
  handsOn?: true;
}

/** A worker's mode and the local work on its PC, for the owner's Queue page. */
export interface WorkerControl {
  id: string;
  name: string;
  pool: string;
  mode: EffectiveMode;
  /** Its own mode as set (null: it follows its pool). */
  own: { mode: QueueMode; until: number | null; by: string; at: number } | null;
  localWork: LocalWork | null;
}

/** The owner's controls in effect: each pool's mode, each worker's, the overrides, and the ones that ended lately. */
export interface QueueControls {
  pools: Record<string, EffectiveMode>;
  workers: WorkerControl[];
  overrides: OverrideView[];
  ended: OverrideView[];
  modes: { id: QueueMode; label: string }[];
}

/**
 * Held on a worker: a job a worker took that doesn't run yet (`task` set), or a worker that may take the line's work
 * and holds it back (`task` null; `waiting`: how many jobs in line it could take now; `generationId`, `model`, `op`
 * and `principal`: the job it would take first). `why` in plain words, `code` short, `since` when known.
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
  /** The owner's hands-on run (pool.ts ownerHandsOn): it waits and runs as a person's run does. */
  handsOn?: true;
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

export function liveQueue(now = Date.now()): { running: RunningJob[]; holding: HeldJob[]; queued: QueuedJob[]; next: NextStep[]; nextTotal: number; text: TextLine; controls: QueueControls } {
  const d = db();
  // The owner's controls that ran their course end before the view is read.
  sweepControls(now);
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
      holding.push({ worker: w?.name ?? "?", ...base, principal: who, ...held, createdAt: g?.created_at ?? null, ...(ownerHandsOn(t) && { handsOn: true as const }) });
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
      ...(ownerHandsOn(t) && { handsOn: true as const }),
    });
  }

  // The jobs waiting in line, in the order each pool's workers serve them under the owner's controls; then the ones no
  // worker takes now (held, the owner's own in People only).
  const pools = [...new Set(["pool", ...workers.map((w) => w.pool)])];
  const lines = pools.map((pool) => controlledLine(pool, now));
  const seen = new Set<string>();
  const items = lines.flatMap((l) => l.items.map((x) => ({ ...x, mode: l.mode }))).filter((x) => !seen.has(x.task.id) && !!seen.add(x.task.id));
  const ordered = [...items.filter((x) => x.rank !== null), ...items.filter((x) => x.rank === null)];
  const nameOf = (id: string) => byId.get(id)?.name ?? null;
  const queued: QueuedJob[] = ordered.slice(0, QUEUED_LIMIT).map(({ task: t, rank, base, control, mode }) => {
    const g = genOf(t.generation_id);
    const o = control.by;
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
      rank,
      why: controlWords(control, base, mode, nameOf, ownerHandsOn(t)),
      code: control.out ?? (control.tier === 0 ? "next" : control.tier === 1 ? "boost" : "class"),
      override: o ? { id: o.id, until: o.until, by: o.by, at: o.at, workerId: o.workerId } : null,
      person: t.account ? personKey(t.account) : null,
      guest: !!t.account?.startsWith("guest"),
      ...(ownerHandsOn(t) && { handsOn: true as const }),
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
    // The job it would take first: whose run the worker holds back.
    const first = firstClaimableNow(w, now);
    const g = first ? genOf(first.generation_id) : undefined;
    const next = first ? { generationId: first.generation_id, model: modelLabel(g?.model_id), op: g?.op ?? null, principal: principalKind(first), ...(ownerHandsOn(first) && { handsOn: true as const }) } : { generationId: null, model: null, op: null, principal: null };
    if (h && now - w.seen_at <= HOLDING_FRESH_MS) holding.push({ worker: w.name, task: null, ...next, why: holdingWords(h.why), code: h.why, since: h.since, waiting });
    else if (!busy.has(w.id) && s.state !== "idle" && s.state !== "busy") holding.push({ worker: w.name, task: null, ...next, why: s.words, code: s.state, since: null, waiting });
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
  const controls: QueueControls = {
    pools: Object.fromEntries([...new Set(["pool", ...workers.map((w) => w.pool), ...Object.keys(poolModes(now))])].map((pool) => [pool, poolMode(pool, now)])),
    workers: workers.map((w) => ({ id: w.id, name: w.name, pool: w.pool, mode: effectiveMode(w, now), own: workerModeOf(w), localWork: localWorkOf(w, now) })),
    overrides: liveOverrides(now).map(overrideView),
    ended: recentOverrides(10).map(overrideView),
    modes: (Object.keys(MODE_WORDS) as QueueMode[]).map((id) => ({ id, label: MODE_WORDS[id] })),
  };
  return { running, holding, queued, next, nextTotal, text: { waiting: tx.waiting ?? 0, running: tx.running ?? 0, oldestAt: tx.oldest ?? null }, controls };
}
