import "server-only";
import crypto from "node:crypto";
import { getModel, modelsFor } from "@/lib/catalog";
import { dualEngine } from "@/lib/catalog/engines";
import { currentModelId, replacedBy } from "@/lib/catalog/replaced";
import { OPERATION_LABELS, type ChainSlot, type Engine, type GenerationRequest, type MediaKind, type Operation } from "@/lib/catalog/types";
import { isHelperFeature } from "@/lib/library";
import { RECIPE_LIMITS, recipeShapeNodes, shapeOf, type Recipe, type ShapeNode } from "@/lib/recipe";
import type { FixCandidates, SkillHistory, SkillRunRow, SkillSuggestion } from "@/lib/skill-insights";
import { db } from "./db";
import { offeredModels, isOffered } from "./model-access";
import { getRecipe, needsRecheck, recipeEngines, saveRecipe, stepPlans, verifyRecipe } from "./recipes";
import { listSkills, skillRecipe, SkillError } from "./skills";

/**
 * Skills that notice repeated work and stay healthy (package W6, docs/research/work2skill-7.md):
 * - suggestions: the same chain of steps made 3 or more times in 14 days, with other words and files, offered as a
 *   skill (an online induction: the Library's runs are the demonstrations). Read from the owner's own runs only.
 * - history: each skill's runs, from the stamp every run of a skill carries (`request.skill`), with no table of its own.
 * - fixes: a step that keeps failing, was replaced, or was switched off gets models that do the same job, priced; the
 *   person picks one, and the skill is checked again before it is saved. Nothing is swapped by itself.
 * - usage: how often and how lately each skill ran, so Assist ranks the skills people use.
 */

// ---------------------------------------------------------------------------
// The owner's runs (an account's never count: they stay out of the owner's lists)

/** Rows the owner made, not in the Trash. */
const OWNER = "json_valid(request_json) AND json_extract(request_json, '$.account') IS NULL AND NOT EXISTS (SELECT 1 FROM generation_trash t WHERE t.generation_id = generations.id)";

interface RunRow {
  id: string;
  batch_id: string | null;
  depends_on: string | null;
  request_json: string;
  feature: string;
  provider: string;
  model_id: string;
  op: string;
  status: string;
  cost_usd: number | null;
  favorite: number;
  created_at: number;
  outputs_json: string;
}

const depIds = (v: string | null): string[] => (!v ? [] : v.startsWith("[") ? (JSON.parse(v) as string[]) : [v]);

// ---------------------------------------------------------------------------
// Usage and history


/** A run's status from its rows: going while any is, failed when any failed, else done. */
function runStatus(rows: Pick<RunRow, "status">[]): SkillRunRow["status"] {
  if (rows.some((r) => r.status === "queued" || r.status === "running")) return "running";
  if (rows.some((r) => r.status === "failed")) return "failed";
  if (rows.every((r) => r.status === "canceled")) return "canceled";
  return "succeeded";
}

/** A skill's runs: how many, how many worked, what they cost, when it last ran, its favourites and the last `limit`. */
export function skillHistory(name: string, limit = 10): SkillHistory {
  const rows = db()
    .prepare(`SELECT * FROM generations WHERE ${OWNER} AND json_extract(request_json, '$.skill.name') = ? AND feature != 'skill-check' AND COALESCE(json_extract(request_json, '$.skill.run'), '') NOT LIKE 'check-%' ORDER BY created_at DESC LIMIT 5000`)
    .all(name) as RunRow[];
  const runs = new Map<string, RunRow[]>();
  for (const r of rows) {
    const req = JSON.parse(r.request_json) as GenerationRequest & { skill?: { run?: string } };
    const key = req.skill?.run ?? r.batch_id ?? r.id;
    runs.set(key, [...(runs.get(key) ?? []), r]);
  }
  const list: SkillRunRow[] = [...runs.entries()].map(([run, rs]) => {
    const outputs = rs.flatMap((r) => (JSON.parse(r.outputs_json) as { url: string; kind: MediaKind; poster?: string }[]).map((o) => ({ url: o.url, kind: o.kind, ...(o.poster && { poster: o.poster }) })));
    const costs = rs.map((r) => r.cost_usd);
    return {
      run,
      batchId: rs.find((r) => r.batch_id)?.batch_id ?? null,
      status: runStatus(rs),
      costUsd: costs.every((c) => c === null) ? null : Math.round(costs.reduce<number>((s, c) => s + (c ?? 0), 0) * 1000) / 1000,
      at: Math.min(...rs.map((r) => r.created_at)),
      steps: rs.length,
      failed: [...rs].sort((x, y) => x.created_at - y.created_at).filter((r) => r.status === "failed").map((r) => ({ model: r.model_id, error: (JSON.parse(r.request_json) as { step?: { label?: string } }).step?.label ?? null })),
      demo: rs.every((r) => r.provider === "mock"),
      outputs: outputs.slice(-4),
      favorites: rs.filter((r) => r.favorite).length,
    };
  });
  list.sort((a, b) => b.at - a.at);
  const finished = list.filter((r) => r.status !== "running");
  const ok = finished.filter((r) => r.status === "succeeded").length;
  const spent = list.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  return {
    runs: list.length,
    successRate: finished.length ? ok / finished.length : null,
    spendUsd: Math.round(spent * 100) / 100,
    lastRunAt: list[0]?.at ?? null,
    favorites: list.reduce((s, r) => s + r.favorites, 0),
    recent: list.slice(0, limit),
  };
}

// ---------------------------------------------------------------------------
// Suggestions

const KEY = "skills.suggestions";
const WINDOW_MS = 14 * 86_400_000;
const SWEEP_MS = 86_400_000;
const LATER_MS = 7 * 86_400_000;
/** The fewest times a chain must have been made to be suggested. */
export const SUGGEST_AFTER = 3;

interface Stored {
  sweptAt?: number;
  /** The last sweep's suggestions, each with its shape's key. */
  list?: (SkillSuggestion & { key?: string })[];
  /** Shapes never to suggest again. */
  dismissed?: string[];
  /** Shapes not to suggest before a time ("Not now"). */
  later?: Record<string, number>;
}

function readStored(): Stored {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  try {
    return row ? (JSON.parse(row.value) as Stored) : {};
  } catch {
    return {};
  }
}

function writeStored(s: Stored): void {
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(KEY, JSON.stringify(s));
}

/** A shape's id: short and stable. */
const shapeId = (key: string) => crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);

/** "Remove background → Edit → Image to video": a chain in words, by what each step does. */
function chainWords(steps: { modelId: string; op?: string }[]): string {
  return steps.map((s) => (s.op && OPERATION_LABELS[s.op as Operation]) || getModel(s.modelId)?.name || s.modelId).join(" → ");
}

/** The shape of a run's rows (one batch): its generate steps and their links. Null when it isn't a chain. */
function rowsShape(rows: RunRow[]): ReturnType<typeof shapeOf> {
  const ids = new Set(rows.map((r) => r.id));
  const nodes: ShapeNode[] = rows.map((r) => {
    const req = JSON.parse(r.request_json) as GenerationRequest;
    const after = depIds(r.depends_on).filter((d) => ids.has(d));
    const chain = req.chain as ChainSlot[] | undefined;
    return { id: r.id, modelId: currentModelId(req.modelId ?? r.model_id), ...(req.op && { op: req.op }), after, slots: after.map((_, i) => chain?.[i]?.slot ?? "images") };
  });
  // Only a chain: at least one step waits for another, and not more steps than a skill takes.
  if (!nodes.some((n) => n.after.length) || nodes.length > RECIPE_LIMITS.steps) return null;
  return shapeOf(nodes);
}

/** The shapes of the saved skills' recipes: a chain a skill already makes isn't suggested. */
function savedShapes(): Set<string> {
  const out = new Set<string>();
  for (const s of listSkills()) {
    if (!s.recipe) continue;
    const recipe = skillRecipe(s.name);
    const nodes = recipe && recipeShapeNodes(recipe, currentModelId);
    const shape = nodes && shapeOf(nodes);
    if (shape) out.add(shape.key);
  }
  return out;
}

/**
 * Group the owner's runs of the last 14 days by shape and keep each chain made SUGGEST_AFTER times or more that no saved
 * skill makes. Helper rows, a skill's own runs and the evaluation harness's runs don't count.
 */
export function sweepSuggestions(now = Date.now()): SkillSuggestion[] {
  const rows = db()
    .prepare(`SELECT * FROM generations WHERE ${OWNER} AND created_at >= ? AND status = 'succeeded' AND batch_id IS NOT NULL AND json_extract(request_json, '$.skill') IS NULL ORDER BY created_at DESC LIMIT 20000`)
    .all(now - WINDOW_MS) as RunRow[];
  const batches = new Map<string, RunRow[]>();
  for (const r of rows) {
    if (isHelperFeature(r.feature) || r.feature === "upload") continue;
    batches.set(r.batch_id!, [...(batches.get(r.batch_id!) ?? []), r]);
  }
  const groups = new Map<string, { shape: NonNullable<ReturnType<typeof shapeOf>>; batches: { rows: RunRow[]; at: number }[] }>();
  for (const rs of batches.values()) {
    const shape = rowsShape(rs);
    if (!shape) continue;
    const g = groups.get(shape.key) ?? { shape, batches: [] };
    g.batches.push({ rows: rs, at: Math.max(...rs.map((r) => r.created_at)) });
    groups.set(shape.key, g);
  }
  const saved = savedShapes();
  const out: (SkillSuggestion & { key: string })[] = [];
  for (const [key, g] of groups) {
    if (g.batches.length < SUGGEST_AFTER || saved.has(key)) continue;
    g.batches.sort((a, b) => b.at - a.at);
    const newest = g.batches[0].rows;
    // The newest run's last steps: the review screen walks back from them to the whole chain.
    const fed = new Set(newest.flatMap((r) => depIds(r.depends_on)));
    out.push({
      key,
      id: shapeId(key),
      words: chainWords(g.shape.steps),
      count: g.batches.length,
      ids: newest.filter((r) => !fed.has(r.id)).map((r) => r.id),
      lastAt: g.batches[0].at,
      demo: g.batches.every((b) => b.rows.every((r) => r.provider === "mock")),
    });
  }
  return out.sort((a, b) => b.count - a.count || b.lastAt - a.lastAt).slice(0, 5);
}

/**
 * The suggestions to show now: swept at most once a day (when the Library opens), less the ones put off or dismissed.
 * `force` sweeps again (after a skill is saved, or a test).
 */
export function skillSuggestions(o: { now?: number; force?: boolean } = {}): SkillSuggestion[] {
  const now = o.now ?? Date.now();
  let stored = readStored();
  if (o.force || !stored.sweptAt || now - stored.sweptAt >= SWEEP_MS || now < stored.sweptAt) {
    stored = { ...stored, sweptAt: now, list: sweepSuggestions(now) };
    writeStored(stored);
  }
  const dismissed = new Set(stored.dismissed ?? []);
  const later = stored.later ?? {};
  // A chain a skill now makes is left out at once, without waiting for the next sweep.
  const saved = (stored.list ?? []).length ? savedShapes() : new Set<string>();
  return (stored.list ?? []).filter((s) => !dismissed.has(s.id) && !((later[s.id] ?? 0) > now) && !(s.key && saved.has(s.key))).map((s) => ({ id: s.id, words: s.words, count: s.count, ids: s.ids, lastAt: s.lastAt, demo: s.demo }));
}

/** "Not now" (hidden for a week) or "Don't suggest this" (never again). */
export function dismissSuggestion(id: string, how: "later" | "never", now = Date.now()): void {
  const s = readStored();
  if (how === "never") s.dismissed = [...new Set([...(s.dismissed ?? []), id])].slice(-500);
  else s.later = { ...Object.fromEntries(Object.entries(s.later ?? {}).filter(([, until]) => until > now)), [id]: now + LATER_MS };
  writeStored(s);
}


// ---------------------------------------------------------------------------
// Fixes

/** How many of the last runs a step may fail in before it is offered a fix. */
const FAILS = { of: 5, at: 2 } as const;

/**
 * The steps that need a fix, each with models that do the same job (the same operation and kind, switched on here),
 * priced on the skill's engine: a step that failed in 2 of the last 5 runs, a model Fuobe replaced, or one switched off in
 * Settings → Models & licences. Nothing changes until the person picks one (applyFix).
 */
export function fixCandidates(name: string): FixCandidates {
  const { recipe } = getRecipe(name);
  const engines = recipeEngines(recipe);
  const engine: Engine = engines.find((e) => !!recipe.verified?.[e]?.plan) ?? engines[0] ?? "cloud";
  const plans = stepPlans(recipe, engine) ?? [];
  const recent = skillHistory(name, FAILS.of).recent.filter((r) => r.status !== "running");
  const steps: FixCandidates["steps"] = [];
  for (const s of recipe.steps) {
    if (s.kind !== "generate") continue;
    const asked = s.request.modelId;
    const id = currentModelId(asked);
    const m = getModel(id);
    const reasons: string[] = [];
    const moved = replacedBy(asked);
    if (moved) reasons.push(`${moved.was} was replaced by ${getModel(moved.id)?.name ?? moved.id}`);
    if (m && !isOffered(id, dualEngine(m) ? engine : undefined)) reasons.push(`${m.name} is switched off in Settings → Models & licences`);
    const fails = recent.filter((r) => r.failed.some((f) => f.model === id || f.model === asked)).length;
    if (fails >= FAILS.at) reasons.push(`It failed in ${fails} of the last ${recent.length} runs`);
    if (!reasons.length) continue;
    const plan = plans.find((p) => p.key === s.key)?.job;
    const op = (s.request.op as Operation | undefined) ?? (plan && plan.op !== "storyboard" && plan.op !== "memory" ? plan.op : undefined);
    const kind = m?.kind ?? plan?.kind;
    const pool = op && kind ? offeredModels(modelsFor({ kind, ops: [op], engine: "all" })) : [];
    const candidates = pool
      .filter((c) => c.id !== id && c.id !== asked && (!m || c.engine === m.engine || dualEngine(c)))
      .slice(0, 12)
      .map((c) => {
        const swapped: Recipe = { ...recipe, steps: recipe.steps.map((x) => (x.key === s.key && x.kind === "generate" ? { ...x, request: { ...x.request, modelId: c.id } } : x)) };
        const priced = stepPlans(swapped, engine);
        const job = priced?.find((p) => p.key === s.key)?.job;
        return { modelId: c.id, name: c.name, engine: c.engine, costUsd: job && !job.error ? job.costUsd : null, ...(job?.error && { problem: job.error }) };
      })
      .sort((a, b) => Number(!!a.problem) - Number(!!b.problem) || (a.costUsd ?? Infinity) - (b.costUsd ?? Infinity));
    steps.push({ key: s.key, label: s.label ?? (op ? OPERATION_LABELS[op] : s.key), model: m?.name ?? asked, reasons, candidates });
  }
  return { engine, steps };
}

/**
 * Swap one step's model for the one picked, then check the recipe (the plan, and a free dry run) before it is kept: a
 * swap whose plan fails isn't saved, and the recipe stays as it was.
 */
export async function applyFix(name: string, step: string, modelId: string): Promise<{ ok: boolean; problems: string[] }> {
  const { skill, recipe } = getRecipe(name);
  if (skill.source === "builtin") throw new SkillError("Built-in skills can't be changed — Duplicate it first, then change your copy", 403);
  const target = recipe.steps.find((s) => s.key === step);
  if (!target || target.kind !== "generate") throw new SkillError(`The skill has no step “${step}”`, 404);
  const offered = fixCandidates(name).steps.find((s) => s.key === step)?.candidates.some((c) => c.modelId === modelId);
  if (!offered) throw new SkillError("Pick one of the models offered for that step", 422);
  const next: Recipe = { ...recipe, steps: recipe.steps.map((s) => (s.key === step && s.kind === "generate" ? { ...s, request: { ...s.request, modelId } } : s)) };
  saveRecipe(name, next);
  const check = await verifyRecipe(name, "demo");
  // Any engine's failed check undoes the swap (an engine still marked ready from before doesn't keep it).
  if (!check.ok) {
    saveRecipe(name, recipe, { keepVerified: true });
    return { ok: false, problems: check.engines.flatMap((e) => [...e.plan.errors, ...(e.dryRun?.problems ?? [])]) };
  }
  return { ok: true, problems: [] };
}

/** Whether a skill has a step to fix now (its re-check line offers Suggest a fix). */
export const needsFix = (name: string): boolean => {
  try {
    const { recipe } = getRecipe(name);
    return Object.keys(needsRecheck(recipe)).length > 0 || fixCandidates(name).steps.length > 0;
  } catch {
    return false;
  }
};
