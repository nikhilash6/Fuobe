import "server-only";
import { nanoid } from "nanoid";
import { getModel } from "@/lib/catalog";
import { currentModelId } from "@/lib/catalog/replaced";
import type { Engine, Generation, MediaKind } from "@/lib/catalog/types";
import { fillRefs, type CompiledPart, type Recipe, type RecipeValues, type SkillRunStep, type SkillRunView } from "@/lib/recipe";
import { studioForTool } from "@/lib/recipe-builder";
import { executeTool } from "./assist/tools";
import { createPipeline } from "./chains";
import { db } from "./db";
import { outsideDemo, runAsDemo } from "./demo-scope";
import { deleteDubSession } from "./dub";
import { deleteEpisode } from "./faceless";
import { getGeneration, stampRequests } from "./generations";
import { deleteKatana } from "./katana";
import { deleteProject } from "./layers";
import { trashGenerations } from "./library";
import { deleteSession } from "./shorts";

/**
 * Runs of skills that span studios (recipe version 2, package W7): a studio step that feeds later steps, and a generate
 * step that feeds a studio step ("dub, then captions, then a 9:16 cut"). createPipeline can't hold such a run as one
 * graph (a studio tool runs through its own module and opens as a StudioRun), so a run is kept in `skill_runs`: its
 * values, and each part's status, generation ids and studio page. A part (a graph of generate steps, one
 * createPipeline; or one tool call, executeTool) starts once the steps it takes from have succeeded, with their first
 * output of the kind each field takes in place of `{{steps.<key>.output}}`. `advanceSkillRun` moves a run on; a sweep
 * started with the generation runner (src/instrumentation.ts) advances every running run, so a run survives a restart.
 * A failure fails the parts that wait for it and says which step failed and why.
 */

type Status = SkillRunStep["status"];

interface PartState {
  part: CompiledPart;
  status: Status;
  /** Every generation the part made (a pipeline's rows; the generations the tool's result names). */
  ids: string[];
  /** A pipeline part's step keys → their generation. */
  byKey?: Record<string, string>;
  href?: string;
  studio?: string;
  error?: string;
  /** The step of a pipeline part that failed (else the part's first). */
  failed?: string;
  /** What the studio made besides generations (a dub, a Layers project…): a dry run deletes them at the end. */
  records?: string[];
}

interface RunState {
  engine: Engine;
  /** The skill's title (the Library stack's name). */
  title: string;
  /** Each step's label, in the recipe's order. */
  labels: { key: string; label: string }[];
  parts: PartState[];
  /** A dry run: every part on the demo provider (tool steps inside runAsDemo), hidden from the skill's runs. */
  check?: boolean;
  error?: string;
}

interface Row {
  id: string;
  skill: string;
  status: SkillRunView["status"];
  values_json: string;
  state_json: string;
  created_at: number;
  updated_at: number;
}

const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

/** A step's name in a run's progress: its label, else its studio ("Translate & dub") or its model's name. */
export function stepLabel(s: Recipe["steps"][number]): string {
  if (s.label) return s.label;
  if (s.kind === "tool") return studioForTool(s.tool) ?? s.tool.replace(/_/g, " ");
  return getModel(currentModelId(s.request.modelId))?.name ?? s.key;
}

const keysOf = (p: CompiledPart): string[] => (p.kind === "tool" ? [p.key] : p.steps.map((s) => s.key));

function load(id: string): { row: Row; state: RunState } | null {
  const row = db().prepare("SELECT * FROM skill_runs WHERE id = ?").get(id) as Row | undefined;
  return row ? { row, state: JSON.parse(row.state_json) as RunState } : null;
}

function save(id: string, state: RunState, status: SkillRunView["status"]): void {
  db().prepare("UPDATE skill_runs SET state_json = ?, status = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(state), status, Date.now(), id);
}

/** The run as its progress shows it: each step in the recipe's order with its part's status, results and studio page. */
function view(row: Row, state: RunState): SkillRunView {
  const steps: SkillRunStep[] = state.labels.map(({ key, label }) => {
    const p = state.parts.find((x) => keysOf(x.part).includes(key));
    if (!p) return { key, label, status: "waiting", ids: [] };
    if (p.part.kind === "tool") return { key, label, status: p.status, ids: p.ids, ...(p.studio && { studio: p.studio }), ...(p.href && { href: p.href }), ...(p.error && { error: p.error }) };
    // A pipeline's steps each go by their own generation once it has started.
    const g = p.byKey?.[key] ? getGeneration(p.byKey[key], { includeDeleted: true }) : null;
    const status: Status = !g ? (p.status === "failed" ? "failed" : "waiting") : g.status === "succeeded" ? "done" : g.status === "failed" || g.status === "canceled" ? "failed" : g.status === "queued" && g.message?.startsWith("Waits") ? "waiting" : "running";
    const error = status === "failed" ? (g?.error ?? p.error) : undefined;
    return { key, label, status, ids: g ? [g.id] : [], ...(error && { error }) };
  });
  return {
    id: row.id,
    skill: row.skill,
    engine: state.engine,
    status: row.status,
    ...(state.error && { error: state.error }),
    ...(state.check && { demo: true }),
    steps,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The label of a step by its key. */
const labelOf = (state: RunState, key: string) => state.labels.find((l) => l.key === key)?.label ?? key;

/** The generations behind a step's output: its own row in a pipeline, every result of a tool. */
function made(state: RunState, key: string): Generation[] {
  const p = state.parts.find((x) => keysOf(x.part).includes(key));
  if (!p) return [];
  const ids = p.part.kind === "tool" ? p.ids : p.byKey?.[key] ? [p.byKey[key]] : [];
  return ids.map((id) => getGeneration(id, { includeDeleted: true })).filter((g): g is Generation => !!g && g.status === "succeeded");
}

/** A step's first output of a kind (any image, video or audio when the field doesn't say). */
function outputOf(state: RunState, key: string, kind: "image" | "video" | "audio" | null): string | undefined {
  const media: MediaKind[] = kind ? [kind] : ["video", "image", "audio"];
  for (const g of made(state, key)) {
    const o = g.outputs.find((x) => media.includes(x.kind) && !!x.url);
    if (o) return o.url;
  }
  return undefined;
}

/** The ids of a studio's records named in its result, for a dry run to delete (dub, Layers, Shorts, Faceless, Katana). */
function recordsOf(content: string, href: string | undefined): string[] {
  const out: string[] = [];
  try {
    const body = JSON.parse(content) as { dub?: unknown; katana?: unknown; job?: unknown };
    if (typeof body.dub === "string") out.push(`dub:${body.dub}`);
  } catch {
    // Plain text: only its page says what it made.
  }
  const path = href?.split("?")[0] ?? "";
  const m = /^\/(layers|shorts)\/([\w-]+)$/.exec(path) ?? /^\/(faceless)\/[\w-]+\/([\w-]+)$/.exec(path);
  if (m) out.push(`${m[1]}:${m[2]}`);
  return out;
}

/** Delete the records a dry run's studios made (the user never asked for them), and Katana jobs naming its results. */
async function deleteRecords(state: RunState): Promise<void> {
  const ids = state.parts.flatMap((p) => p.ids);
  for (const rec of state.parts.flatMap((p) => p.records ?? [])) {
    const [kind, id] = [rec.slice(0, rec.indexOf(":")), rec.slice(rec.indexOf(":") + 1)];
    try {
      if (kind === "dub") deleteDubSession(id);
      else if (kind === "layers") deleteProject(id);
      else if (kind === "shorts") deleteSession(id);
      else if (kind === "faceless") await deleteEpisode(id);
    } catch {
      // Gone already.
    }
  }
  for (const id of ids) {
    const rows = db().prepare("SELECT id FROM katana_jobs WHERE instr(data_json, ?) > 0").all(JSON.stringify(id)) as { id: string }[];
    for (const r of rows) deleteKatana(r.id);
  }
}

/** Every row a run's generations share a batch with (a studio's own steps: a transcript before its captions). */
function withBatchMates(ids: string[]): string[] {
  if (!ids.length) return [];
  const marks = ids.map(() => "?").join(", ");
  const rows = db()
    .prepare(`SELECT id FROM generations WHERE id IN (${marks}) OR batch_id IN (SELECT batch_id FROM generations WHERE id IN (${marks}) AND batch_id IS NOT NULL)`)
    .all(...ids, ...ids) as { id: string }[];
  return [...new Set([...ids, ...rows.map((r) => r.id)])];
}

/** Start one part: its references filled from the steps it takes from, then createPipeline or the tool. */
async function startPart(runId: string, skill: string, state: RunState, p: PartState): Promise<void> {
  const pick = (key: string, kind: "image" | "video" | "audio" | null) => outputOf(state, key, kind);
  try {
    if (p.part.kind === "pipeline") {
      const steps = p.part.steps.map((s) => ({ ...s, request: fillRefs(s.request, pick) }));
      const made = createPipeline(steps, { batchId: runId });
      p.ids = made.items.map((g) => g.id);
      p.byKey = Object.fromEntries(Object.entries(made.byKey).map(([k, g]) => [k, g.id]));
      p.status = "running";
      return;
    }
    const tool = p.part.tool;
    const step = p.part.key;
    const input = fillRefs(p.part.input, pick, tool);
    const out = state.check ? await runAsDemo(() => executeTool(tool, input, { engine: state.engine })) : await executeTool(tool, input, { engine: state.engine });
    const text = typeof out.content === "string" ? out.content : "";
    if (out.isError) throw new Error(text.replace(/^\{"error":"(.*)"\}$/, "$1") || "The studio couldn't start");
    const card = (out.items ?? []).flatMap((i) => (i.role === "tool" && i.href ? [i] : []))[0];
    p.ids = [...new Set((out.items ?? []).flatMap((i) => (i.role === "generations" ? i.ids : [])))];
    p.href = card?.href && card.href !== "/library" ? card.href : undefined;
    p.studio = card?.studio;
    if (state.check) p.records = recordsOf(text, card?.href);
    // The studio's own rows carry the run's stamp, with the step's key (a failure is laid at this step, not at a
    // generate step on the same model), and the skill's title, as a pipeline's do. A check's rows say so: they keep
    // their studio's feature, so the skill's history and use tell them from its runs by the stamp.
    stampRequests(p.ids, () => ({ skill: { name: skill, run: runId, step, ...(state.check && { check: true as const }) }, batchTitle: state.title.slice(0, 200) }));
    p.status = p.ids.length ? "running" : "done";
  } catch (e) {
    p.status = "failed";
    p.error = (e as Error).message;
  }
}

/** A running part's status from its generations: failed when one failed (with its reason), done when all succeeded. */
function settle(state: RunState, p: PartState): void {
  const gens = p.ids.map((id) => getGeneration(id, { includeDeleted: true }));
  const failed = gens.find((g) => !g || g.status === "failed" || g.status === "canceled");
  if (failed !== undefined) {
    p.status = "failed";
    p.failed = p.part.kind === "pipeline" ? Object.entries(p.byKey ?? {}).find(([, id]) => id === failed?.id)?.[0] : undefined;
    p.error = !failed ? "its result was deleted" : failed.status === "canceled" ? "it was stopped" : (failed.error ?? "it failed");
    return;
  }
  if (gens.every((g) => g && TERMINAL.has(g.status))) p.status = "done";
}

const runLocks = new Set<string>();

/**
 * Move a run on: settle its running parts, fail what waits for a failure, start each waiting part whose steps have
 * finished, and save it. Returns the run as its progress shows it (null: no such run).
 */
export async function advanceSkillRun(id: string): Promise<SkillRunView | null> {
  if (runLocks.has(id)) {
    const found = load(id);
    return found ? view(found.row, found.state) : null;
  }
  runLocks.add(id);
  try {
    const found = load(id);
    if (!found) return null;
    const { row, state } = found;
    if (row.status !== "running") return view(row, state);
    for (let moved = true; moved; ) {
      moved = false;
      for (const p of state.parts) if (p.status === "running") settle(state, p);
      // A failure fails every part that waits for it, directly or through another.
      const failedKeys = new Set(state.parts.filter((p) => p.status === "failed").flatMap((p) => keysOf(p.part)));
      for (const p of state.parts) {
        if (p.status !== "waiting") continue;
        const from = p.part.needs.find((k) => failedKeys.has(k));
        if (!from) continue;
        p.status = "failed";
        p.error = `Didn't start: ${labelOf(state, from)} failed`;
        moved = true;
      }
      const doneKeys = new Set(state.parts.filter((p) => p.status === "done").flatMap((p) => keysOf(p.part)));
      for (const p of state.parts) {
        if (p.status !== "waiting" || !p.part.needs.every((k) => doneKeys.has(k))) continue;
        await startPart(id, row.skill, state, p);
        moved = true;
      }
    }
    const first = state.parts.find((p) => p.status === "failed" && !p.error?.startsWith("Didn't start")) ?? state.parts.find((p) => p.status === "failed");
    if (first && !state.error) state.error = first.error?.startsWith("Didn't start") ? first.error : `${labelOf(state, first.failed ?? keysOf(first.part)[0])} failed: ${first.error ?? "it failed"}`;
    const finished = state.parts.every((p) => p.status === "done" || p.status === "failed");
    const status: SkillRunView["status"] = !finished ? "running" : first ? "failed" : "done";
    save(id, state, status);
    return view({ ...row, status, updated_at: Date.now() }, state);
  } finally {
    runLocks.delete(id);
  }
}

/**
 * Start a run of a staged recipe (compile → `staged`): its row, then every part whose inputs exist. `check`: a dry run
 * (every part on the demo provider, hidden from the skill's runs). The run's id is the batch of its pipelines' rows.
 */
export async function startSkillRun(skill: { name: string; title: string }, recipe: Recipe, parts: CompiledPart[], engine: Engine, values: RecipeValues, o: { check?: boolean; id?: string } = {}): Promise<SkillRunView> {
  const id = o.id ?? nanoid(10);
  const now = Date.now();
  const state: RunState = {
    engine,
    title: skill.title,
    labels: recipe.steps.map((s) => ({ key: s.key, label: stepLabel(s) })),
    parts: parts.map((part) => ({ part, status: "waiting", ids: [] })),
    ...(o.check && { check: true }),
  };
  db()
    .prepare("INSERT INTO skill_runs (id, skill, status, values_json, state_json, created_at, updated_at) VALUES (?, ?, 'running', ?, ?, ?, ?)")
    .run(id, skill.name, JSON.stringify(values), JSON.stringify(state), now, now);
  ensureSkillRunSweep();
  return (await advanceSkillRun(id))!;
}

/** One run as its progress shows it (null: no such run). */
export function getSkillRun(id: string): SkillRunView | null {
  const found = load(id);
  return found ? view(found.row, found.state) : null;
}

/**
 * A skill's newest runs (dry runs left out), or with `ids` exactly those of its runs (a CSV's runs, up to
 * RECIPE_LIMITS.rows, which the CLI follows however many newer runs started since).
 */
export function listSkillRuns(skill: string, limit = 8, ids?: string[]): SkillRunView[] {
  const rows = (
    ids
      ? ids.length
        ? db()
            .prepare(`SELECT * FROM skill_runs WHERE skill = ? AND id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at DESC`)
            .all(skill, ...ids)
        : []
      : db().prepare("SELECT * FROM skill_runs WHERE skill = ? ORDER BY created_at DESC LIMIT ?").all(skill, limit * 2)
  ) as Row[];
  return rows
    .map((row) => ({ row, state: JSON.parse(row.state_json) as RunState }))
    .filter((r) => !r.state.check)
    .slice(0, limit)
    .map((r) => view(r.row, r.state));
}

/** Every generation a run made, with the rows each shares a batch with. */
export function skillRunGenerations(id: string): string[] {
  const found = load(id);
  return found ? withBatchMates(found.state.parts.flatMap((p) => p.ids)) : [];
}

/**
 * The end of a dry run: what it made goes to the Trash, the studio records it opened are deleted, and the row goes
 * (a check isn't a run the user asked for).
 */
export async function discardSkillRun(id: string): Promise<void> {
  const found = load(id);
  if (!found) return;
  await deleteRecords(found.state);
  trashGenerations(skillRunGenerations(id));
  db().prepare("DELETE FROM skill_runs WHERE id = ?").run(id);
}

/** Stop a run: its unfinished parts fail with the reason (a check whose time ran out). */
export function stopSkillRun(id: string, why: string): void {
  const found = load(id);
  if (!found || found.row.status !== "running") return;
  for (const p of found.state.parts) {
    if (p.status === "waiting" || p.status === "running") {
      p.status = "failed";
      p.error = why;
    }
  }
  found.state.error ??= why;
  save(id, found.state, "failed");
}

// ---------------------------------------------------------------------------
// The sweep

declare global {
  var __fuobeSkillRunSweep: { tick: () => void; timer: NodeJS.Timeout } | undefined;
}

/** How often running runs are moved on: a studio step's results start the steps that wait for them. */
const SWEEP_MS = 10_000;

/** Advance every running run (each on its own: one run's error never stops the others). */
export async function sweepSkillRuns(): Promise<void> {
  const ids = (db().prepare("SELECT id FROM skill_runs WHERE status = 'running'").all() as { id: string }[]).map((r) => r.id);
  for (const id of ids) {
    try {
      await advanceSkillRun(id);
    } catch (e) {
      console.warn(`[fuobe] skill run ${id} couldn't move on: ${(e as Error).message}`);
    }
  }
}

const tick = () => void sweepSkillRuns().catch((e: Error) => console.warn(`[fuobe] skill run sweep failed: ${e.message}`));

/** Start the sweep once per process (at boot, and when a run starts); runs left running before a restart carry on. */
export function ensureSkillRunSweep(): void {
  const cur = globalThis.__fuobeSkillRunSweep;
  if (cur) {
    cur.tick = tick;
    return;
  }
  // Outside a dry run's demo scope, which the timer would otherwise keep for every run it moves on.
  const state = { tick, timer: outsideDemo(() => setInterval(() => globalThis.__fuobeSkillRunSweep?.tick(), SWEEP_MS)) };
  state.timer.unref?.();
  globalThis.__fuobeSkillRunSweep = state;
}
