/**
 * How far a ComfyUI job is, from what its socket reports (each node that starts, and the steps of a node that has
 * them), as one share from 0 to 0.99 that every place showing the run reads: its card, the studio feeds, the Library,
 * the API and the admin.
 *
 * Most of a job's time is its sampler's steps, while the sampler is one node of many, so the share of nodes run says
 * little: a graph whose loaders and encoders run first reads three quarters done before its first step. Here the bar has
 * stages instead:
 *
 * - getting ready (its models loading, its prompt encoding): a small share that grows slowly with time, at most
 *   PROGRESS_BANDS.ready;
 * - sampling: most of the bar, by the steps of each sampler pass the graph has (in the order they run), and between two
 *   steps by the time a step takes;
 * - finishing (decoding, sound, saving the files on the GPU): the next few percent, by the nodes after the sampler;
 * - collecting (the results coming to the studio): the last percent.
 *
 * The share never passes 0.99 before the run is done; the server keeps the highest share shown in one try (`shown`), so
 * it never moves backwards there. A new try starts again from its own first stage.
 *
 * Pure: the server and the tests share it.
 */

import { madeNoun, makingWords, POOL_WORDS, type MadeKind } from "./relay";

/** Where each stage ends on the bar. */
export const PROGRESS_BANDS = {
  /** Getting ready: up to here, slowly. */
  ready: 0.1,
  /** The sampler passes the graph has: up to here. */
  sampled: 0.9,
  /** Passes beyond the graph's own (a loop that runs its sampler again): each takes half of what is left, up to here. */
  extra: 0.94,
  /** The nodes after the sampler: up to here. */
  finished: 0.97,
  /** Never more before the run is done. */
  most: 0.99,
} as const;

/** The time over which getting ready grows to about two thirds of its band (a cold model load takes minutes). */
const READY_MS = 90_000;
/** Between two steps, the time a step takes fills at most this much of the next one. */
const IN_STEP = 0.9;
/** The step passes kept per try (the newest). */
const KEEP_PASSES = 16;

/** One pass of a node with steps, as its reports said. */
export interface StepPass {
  /** The node's id, when a report named it. */
  node?: string;
  /** How many nodes had started when it ran (the running node included): which node of the job it is. */
  at: number;
  value: number;
  max: number;
  /** The first value seen, and when; when the value now was first seen. */
  v0: number;
  t0: number;
  tv: number;
}

/** A job's live progress as the server keeps it (relay_tasks.progress_json, or the socket's own record). */
export interface LiveProgress {
  value?: number;
  max?: number;
  node?: string;
  nodesDone?: number;
  cold?: boolean;
  /** When this try first reported. */
  since?: number;
  /** The passes with steps of this try, oldest first. */
  passes?: StepPass[];
  /** The highest share shown in this try. */
  shown?: number;
}

/** What a graph says about its stages: its node count, the nodes that sample, and how many nodes come after them. */
export interface ProgressPlan {
  nodes: number;
  samplers: string[];
  after: number;
}

type GraphNode = { class_type?: unknown; inputs?: Record<string, unknown> };

/** A node that runs steps: KSampler, KSamplerAdvanced, SamplerCustom(Advanced), and a pack's own *Sampler nodes. */
const SAMPLER_CLASS = /^(?:SamplerCustom(?:Advanced)?|\w*[A-Za-z0-9]Sampler(?:Advanced)?)$/;

const isLink = (v: unknown): v is [string, number] => Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number";

/**
 * A graph's plan (ComfyUI's API format: node id → { class_type, inputs }). A sampler is a node of a sampler class that
 * takes links (a sampler's settings node, such as KSamplerSelect or a pack's sampler choice, takes none, or feeds
 * another node's `sampler` input). `after`: the nodes that read a sampler's result, directly or not (the decode, the
 * sound, the file).
 */
export function progressPlan(graph: unknown): ProgressPlan {
  const g = graph && typeof graph === "object" ? (graph as Record<string, GraphNode | undefined>) : {};
  const ids = Object.keys(g).filter((k) => g[k] && typeof g[k] === "object");
  const settings = new Set<string>();
  const readers = new Map<string, string[]>();
  for (const id of ids) {
    for (const [name, v] of Object.entries(g[id]!.inputs ?? {})) {
      if (!isLink(v)) continue;
      if (name === "sampler") settings.add(v[0]);
      readers.set(v[0], [...(readers.get(v[0]) ?? []), id]);
    }
  }
  const samplers = ids.filter((id) => {
    const n = g[id]!;
    return typeof n.class_type === "string" && SAMPLER_CLASS.test(n.class_type) && !settings.has(id) && Object.values(n.inputs ?? {}).some(isLink);
  });
  const sampler = new Set(samplers);
  const after = new Set<string>();
  const todo = [...samplers];
  while (todo.length) {
    for (const r of readers.get(todo.pop()!) ?? []) {
      if (after.has(r) || sampler.has(r)) continue;
      after.add(r);
      todo.push(r);
    }
  }
  return { nodes: ids.length, samplers: samplers.slice(0, 64), after: after.size };
}

/** A plan kept in a run's meta, read back (null: none, or not one). */
export function planOf(v: unknown): ProgressPlan | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  const nodes = Number(p.nodes);
  const after = Number(p.after);
  if (!Number.isFinite(nodes) || !Number.isFinite(after) || !Array.isArray(p.samplers)) return null;
  return { nodes, after, samplers: p.samplers.filter((s): s is string => typeof s === "string").slice(0, 64) };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);

/**
 * A new report (a progress report or a beat) over what was kept: its fields over the old ones, and its steps noted as a
 * pass. A node that started since (more nodes started, no step yet) clears the step of the node before, so a finished
 * sampler's last step is never read as the step now. Fewer nodes started than before: its ComfyUI runs the job again
 * from the start, so its passes start again (the share shown stays).
 */
export function trackReport(prev: LiveProgress | undefined, r: { value?: unknown; max?: unknown; node?: unknown; nodesDone?: unknown }, now: number): LiveProgress {
  const value = num(r.value);
  const max = num(r.max);
  const done = num(r.nodesDone);
  const node = typeof r.node === "string" && r.node ? r.node.slice(0, 64) : undefined;
  // This try's clock starts with its first word from the running job (a place in a queue isn't one).
  const running = value !== undefined || max !== undefined || done !== undefined || node !== undefined;
  const next: LiveProgress = { ...prev };
  if (next.since === undefined && running) next.since = now;
  let passes = prev?.passes ?? [];
  if (done !== undefined && prev?.nodesDone !== undefined && done < prev.nodesDone) passes = [];
  const moved = done !== undefined && done !== prev?.nodesDone;
  if (done !== undefined) next.nodesDone = done;
  if (node) next.node = node;
  if (value !== undefined && max) {
    next.value = value;
    next.max = max;
    const at = done ?? prev?.nodesDone ?? 0;
    // A beat names no node: the node a report named at the same place is the one with these steps.
    const named = node ?? (at === prev?.nodesDone ? prev?.node : undefined);
    const last = passes.at(-1);
    const same = last && last.at === at && last.max === max && (!named || !last.node || last.node === named);
    // The same node again from its first steps (a loop that runs it once more): a new pass.
    const again = same && last.value >= max / 2 && value <= max / 4 && value < last.value;
    if (same && !again) {
      if (value > last.value || (named && !last.node)) passes = [...passes.slice(0, -1), { ...last, ...(value > last.value && { value, tv: now }), ...(named && !last.node && { node: named }) }];
    } else {
      passes = [...passes, { ...(named && { node: named }), at, value, max, v0: value, t0: now, tv: now }].slice(-KEEP_PASSES);
    }
  } else if (moved || (node && node !== prev?.node)) {
    delete next.value;
    delete next.max;
  }
  if (passes.length) next.passes = passes;
  else delete next.passes;
  return next;
}

/** The stages a running job shows. */
export type ProgressStage = "loading" | "preparing" | "sampling" | "finishing";

export interface ProgressView {
  /** 0 to 0.99. */
  share: number;
  stage: ProgressStage;
  /** The sampler's step now, while it samples. */
  step?: { value: number; max: number };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * How far a running job is (`plan`: its graph's plan, or null when the run has none: then every node with steps counts
 * as a sampler pass, and each pass seen so far as one of the graph's). `now`: the server's clock. Not floored: the
 * caller keeps the highest share shown (`shown`).
 */
export function progressView(p: LiveProgress | undefined, plan: ProgressPlan | null, now: number): ProgressView {
  const B = PROGRESS_BANDS;
  const since = p?.since ?? now;
  const all = p?.passes ?? (p?.max && p.value !== undefined ? [{ node: p.node, at: p.nodesDone ?? 0, value: p.value, max: p.max, v0: p.value, t0: now, tv: now }] : []);
  const named = plan?.samplers.length ? new Set(plan.samplers) : null;
  // The sampler passes: the graph's samplers' (a pass with no node name counts), or every pass with steps when the
  // graph names none or its names never come up.
  const mine = named ? all.filter((x) => !x.node || named.has(x.node)) : all;
  const passes = mine.length ? mine : all;
  if (!passes.length) {
    const ready = B.ready * (1 - Math.exp(-Math.max(0, now - since) / READY_MS));
    return { share: ready, stage: p?.cold ? "loading" : "preparing" };
  }
  const planned = Math.max(1, named && mine.length ? plan!.samplers.length : passes.length);
  const last = passes[passes.length - 1];
  const done = p?.nodesDone ?? last.at;
  // Still in the last pass's node: its steps, and the time since the last one (at the pace of the steps before it).
  const inLast = done <= last.at;
  const perStep = last.value > last.v0 ? (last.tv - last.t0) / (last.value - last.v0) : 0;
  const inStep = inLast && perStep > 0 && last.value < last.max ? Math.min(IN_STEP, Math.max(0, now - last.tv) / perStep) : 0;
  const frac = inLast ? clamp01((last.value + inStep) / last.max) : 1;
  // Pass k of `planned` (from 0): its share of the sampling band; a pass beyond the graph's own takes half of what is left.
  const k = passes.length - 1;
  const sampled = k < planned ? B.ready + (B.sampled - B.ready) * ((k + frac) / planned) : B.sampled + (B.extra - B.sampled) * (1 - Math.pow(0.5, k - planned + frac));
  if (inLast) return { share: Math.min(B.most, sampled), stage: "sampling", ...(last.value >= 1 && { step: { value: Math.min(last.value, last.max), max: last.max } }) };
  // Between two of the graph's passes.
  if (passes.length < planned) return { share: Math.min(B.most, sampled), stage: "sampling" };
  // After the last pass: the nodes that read its result, each started one counting as half done (or by its own steps).
  const after = Math.max(1, plan?.after || Math.max(1, (plan?.nodes ?? 0) - last.at));
  const own = p?.max && p.value !== undefined ? clamp01(p.value / p.max) : 0.5;
  const ran = clamp01((done - last.at - 1 + own) / after);
  const from = Math.max(sampled, B.sampled);
  return { share: Math.min(B.most, from + (B.finished - from) * ran), stage: "finishing" };
}

/** The share while the results come to the studio (`received`: the share of their bytes that arrived). */
export const collectingShare = (received: number | undefined) => PROGRESS_BANDS.finished + (PROGRESS_BANDS.most - PROGRESS_BANDS.finished) * clamp01(received ?? 0);

/** The share to show: never below the highest shown in this try, never above 0.99. */
export const floored = (share: number, shown: number | undefined) => Math.min(PROGRESS_BANDS.most, Math.max(share, shown ?? 0));

/** "Step 3 of 6". */
export const stepWords = (step: { value: number; max: number }) => `Step ${Math.min(step.value, step.max)} of ${step.max}`;

/** A person's words for a running job on this install's GPUs: "Loading the model", "Working · Step 3 of 6", "Finishing". */
export function poolRunWords(v: Pick<ProgressView, "stage" | "step">): string {
  if (v.stage === "loading") return POOL_WORDS.gettingReady;
  if (v.stage === "finishing") return POOL_WORDS.finishing;
  return v.step ? `${POOL_WORDS.working} · ${stepWords(v.step)}` : POOL_WORDS.working;
}

/** Is this one of poolRunWords' (the words a person's running job may show)? */
export const isPoolRunWords = (m: string | null | undefined): m is string =>
  !!m && (m === POOL_WORDS.working || m === POOL_WORDS.gettingReady || m === POOL_WORDS.finishing || /^Working · Step \d+ of \d+$/.test(m));

/** The owner's words for a running job: its stage, and the sampler's step ("Making your clip · step 3 of 6"). */
export function runWords(kind: MadeKind, v: Pick<ProgressView, "stage" | "step">): string {
  if (v.stage === "loading") return POOL_WORDS.gettingReady;
  if (v.stage === "finishing") return `Finishing your ${madeNoun(kind)}`;
  return makingWords(kind, v.step?.value, v.step?.max);
}
