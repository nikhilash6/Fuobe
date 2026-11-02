import "server-only";
import type { Engine, Generation, GenerationRequest, MediaKind } from "@/lib/catalog/types";
import { fieldKind, stepRefOf, stepRefs, type RecipeStep, type RecipeValues } from "@/lib/recipe";
import type { SkillRunStatus, SkillRunStep, SkillRunView } from "@/lib/skill-runs";
import { executeTool } from "./assist/tools";
import { createPipeline } from "./chains";
import { db } from "./db";
import { outsideDemo, runAsDemo } from "./demo-scope";
import { ASSET_REFS, getGeneration, stampRequests } from "./generations";
import { trashGenerations } from "./library";
import { apiStep, stagedParts, standIn } from "./recipes";

/**
 * Skills whose steps wait for each other across studios (package W7): "dub, then captions, then a 9:16 cut". A run is a
 * `skill_runs` row: every step whose inputs exist starts at once (generate steps joined by `after` as one createPipeline,
 * a studio step through its Assist tool, keeping the studio's page), and a sweep starts each waiting step when the steps
 * it takes results from are done, putting the first output of the kind its field takes in for `{{steps.<key>.output}}`.
 * A failure fails the steps after it and says which step and why. The state lives in the database, so a restart picks
 * up where it was.
 */

interface StepState extends SkillRunStep {
  /** The part it starts with (stagedParts). */
  part: string;
  /** The generation whose output later steps take. */
  final?: string;
}

interface State {
  title: string;
  /** The steps as filled with the run's values, references kept. */
  plan: RecipeStep[];
  steps: StepState[];
  error?: string;
  /** A skill's dry run (its rows go to the Trash at the end; never shown in its history). */
  check?: boolean;
}

interface Row {
  id: string;
  skill: string;
  engine: Engine;
  status: SkillRunStatus;
  values_json: string;
  state_json: string;
  created_at: number;
  updated_at: number;
}

const TERMINAL = new Set(["succeeded", "failed", "canceled"]);
const SWEEP_MS = 10_000;

const load = (id: string): (Row & { state: State }) | null => {
  const r = db().prepare("SELECT * FROM skill_runs WHERE id = ?").get(id) as Row | undefined;
  return r ? { ...r, state: JSON.parse(r.state_json) as State } : null;
};

function save(id: string, status: SkillRunStatus, state: State): void {
  db().prepare("UPDATE skill_runs SET status = ?, state_json = ?, updated_at = ? WHERE id = ?").run(status, JSON.stringify(state), Date.now(), id);
}

const words = (s: Pick<StepState, "label">) => `“${s.label}”`;

/** The first output of a kind a generation made (text: its words; a field whose kind can't be told: its first output, a file or words). */
function outputOf(g: Generation, kind: MediaKind | undefined): string | undefined {
  if (kind === "text") return g.outputs.find((o) => typeof o.text === "string")?.text;
  if (kind) return g.outputs.find((o) => o.kind === kind)?.url;
  const first = g.outputs[0];
  return first?.url || (typeof first?.text === "string" ? first.text : undefined);
}

/** A value with each step reference put in: the referenced step's output of the kind its field takes. */
function resolve(v: unknown, outputs: (key: string, kind: MediaKind | undefined) => string, path: (string | number)[] = []): unknown {
  if (typeof v === "string") {
    if (!stepRefs(v).size) return v;
    const exact = stepRefOf(v);
    if (exact) return outputs(exact, fieldKind(path));
    return v.replace(/\{\{\s*steps\.([A-Za-z0-9][A-Za-z0-9_-]{0,39})\.output\s*\}\}/g, (_, k: string) => outputs(k, "text"));
  }
  if (Array.isArray(v)) return v.map((x, i) => resolve(x, outputs, [...path, i]));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x, outputs, [...path, k])]));
  return v;
}

/** Start one part: its generate steps as one createPipeline, or its studio step through its tool. */
async function startPart(run: Row & { state: State }, partId: string): Promise<void> {
  const { state } = run;
  const members = state.steps.filter((s) => s.part === partId);
  const outputs = (key: string, kind: MediaKind | undefined): string => {
    const from = state.steps.find((s) => s.key === key);
    const g = from?.final ? getGeneration(from.final, { includeDeleted: true }) : null;
    const out = g && outputOf(g, kind);
    if (!out) throw new Error(`${words(from ?? { label: key })} made no ${kind ?? "result"} for the next step`);
    return out;
  };
  const fail = (error: string) => {
    for (const m of members) Object.assign(m, { status: "failed", error });
  };
  try {
    const plan = state.plan.filter((s) => members.some((m) => m.key === s.key));
    const tool = plan.find((s) => s.kind === "tool");
    if (tool && tool.kind === "tool") {
      const input = resolve(tool.input, outputs) as Record<string, unknown>;
      const out = await executeTool(tool.tool, input, { engine: run.engine });
      const text = typeof out.content === "string" ? out.content : "";
      if (out.isError) return fail(text.replace(/^\{"error":"(.*)"\}$/, "$1") || "The studio couldn't start it");
      let body: { href?: string; studio?: string; results?: string[] } = {};
      try {
        body = JSON.parse(text) as typeof body;
      } catch {
        body = {};
      }
      const ids = (out.items ?? []).flatMap((i) => (i.role === "generations" ? i.ids : []));
      const studio = (out.items ?? []).find((i) => i.role === "tool" && "studio" in i && i.studio) as { studio?: string } | undefined;
      // The run's stamp and the skill's title on everything the studio started.
      stampRequests(ids, () => ({ skill: { name: run.skill, run: run.id }, batchTitle: state.title.slice(0, 200) }));
      const m = members[0];
      Object.assign(m, { status: ids.length ? "running" : "failed", ids, final: body.results?.[0] ?? ids[0], ...(body.href && { href: body.href }), ...((studio?.studio ?? body.studio) && { studio: studio?.studio ?? body.studio }), ...(!ids.length && { error: "The studio started nothing" }) });
      return;
    }
    const steps = plan.map((s) => {
      if (s.kind !== "generate") throw new Error("A part mixes studio and generate steps");
      return apiStep({ key: s.key, request: resolve(s.request, outputs) as GenerationRequest, ...(s.after !== undefined && { after: s.after }), ...(s.chain && { chain: s.chain as never }) }, run.engine);
    });
    const p = createPipeline(steps, { batchId: run.id });
    for (const m of members) {
      const g = p.byKey[m.key];
      Object.assign(m, { status: "running", ids: g ? [g.id] : [], final: g?.id });
    }
  } catch (e) {
    fail((e as Error).message);
  }
}

/** Whether a step's work is over: the step's generations (and the rest of their batches, for a studio) are finished. */
function settled(s: StepState): { done: boolean; ok: boolean; error?: string } {
  if (!s.ids.length) return { done: true, ok: false, error: s.error ?? "It started nothing" };
  const gens = s.ids.map((id) => getGeneration(id, { includeDeleted: true })).filter((g): g is Generation => !!g);
  // A studio's later steps share its first steps' batch: wait for the whole batch.
  const batches = [...new Set(gens.map((g) => g.batchId).filter((b): b is string => !!b))];
  const more =
    s.kind === "tool" && batches.length
      ? (db().prepare(`SELECT id, status FROM generations WHERE batch_id IN (${batches.map(() => "?").join(", ")})`).all(...batches) as { id: string; status: string }[])
      : [];
  if (gens.some((g) => !TERMINAL.has(g.status)) || more.some((r) => !TERMINAL.has(r.status))) return { done: false, ok: false };
  const final = s.final ? getGeneration(s.final, { includeDeleted: true }) : gens.at(-1);
  if (final?.status === "succeeded") return { done: true, ok: true };
  const bad = final ?? gens.find((g) => g.status !== "succeeded");
  return { done: true, ok: false, error: bad?.error ?? (bad?.status === "canceled" ? "It was stopped" : "It didn't finish") };
}

/**
 * Move a run on: finish the steps whose work is over, fail the steps after a failure (with which step and why), and
 * start each part whose waits are all done. Returns the run's status.
 */
export async function advanceSkillRun(id: string): Promise<SkillRunStatus | null> {
  // One move at a time per run: a studio step's tool takes a moment, and a sweep meanwhile mustn't start it again.
  const busy = (globalThis.__fuobeSkillRunsBusy ??= new Set<string>());
  if (busy.has(id)) return load(id)?.status ?? null;
  busy.add(id);
  try {
    return await advance(id);
  } finally {
    busy.delete(id);
  }
}

async function advance(id: string): Promise<SkillRunStatus | null> {
  const run = load(id);
  if (!run) return null;
  if (run.status !== "running") return run.status;
  const { state } = run;
  for (const s of state.steps) {
    if (s.status !== "running") continue;
    const r = settled(s);
    if (!r.done) continue;
    s.status = r.ok ? "done" : "failed";
    if (!r.ok) s.error = r.error;
  }
  const parts = stagedParts(state.plan);
  const statusOf = (key: string) => state.steps.find((s) => s.key === key)?.status;
  // A step after a failed one fails too, saying which step failed (and so on down the chain).
  for (let moved = true; moved; ) {
    moved = false;
    for (const part of parts) {
      const members = state.steps.filter((s) => s.part === part.id && s.status === "waiting");
      if (!members.length) continue;
      const broken = part.waits.find((k) => statusOf(k) === "failed");
      if (!broken) continue;
      const from = state.steps.find((s) => s.key === broken)!;
      // The step that failed first is named all the way down the chain.
      const error = from.error?.endsWith("so this didn't start") ? from.error : `${words(from)} failed, so this didn't start`;
      for (const m of members) Object.assign(m, { status: "failed", error });
      moved = true;
    }
  }
  for (const part of parts) {
    const waiting = state.steps.filter((s) => s.part === part.id);
    if (!waiting.every((s) => s.status === "waiting") || !part.waits.every((k) => statusOf(k) === "done")) continue;
    // A dry run's steps always run as demos, whoever moves it on (never real studio work on real keys or a GPU).
    if (state.check) await runAsDemo(() => startPart(run, part.id));
    else await startPart(run, part.id);
  }
  const failed = state.steps.find((s) => s.status === "failed" && !/didn't start$/.test(s.error ?? ""));
  if (failed && !state.error) state.error = `${words(failed)} failed${failed.error ? `: ${failed.error}` : ""}`;
  const going = state.steps.some((s) => s.status === "running" || (s.status === "waiting" && !failed));
  const status: SkillRunStatus = going ? "running" : state.steps.every((s) => s.status === "done") ? "done" : "failed";
  save(id, status, state);
  return status;
}

export interface StartedRun {
  /** The generations started now. */
  ids: string[];
  /** The first studio page a step opened in. */
  href?: string;
  /** The labels of the steps that start later. */
  waiting: string[];
  /** Why nothing could start. */
  error?: string;
}

const labelOf = (s: RecipeStep, i: number) => s.label ?? (s.kind === "tool" ? s.tool.replace(/_/g, " ") : `Step ${i + 1}`);

/**
 * Start a run in stages: a `skill_runs` row with every step waiting, then every part with nothing to wait for. The sweep
 * starts the rest. `check`: a skill's dry run (kept out of its history).
 */
export function startSkillRun(o: { id: string; skill: string; title: string; engine: Engine; values: RecipeValues; steps: RecipeStep[]; check?: boolean }): { done: Promise<SkillRunStatus | null> } {
  const parts = stagedParts(o.steps);
  const partOf = new Map(parts.flatMap((p) => p.keys.map((k) => [k, p.id] as const)));
  const state: State = {
    title: o.title,
    plan: o.steps,
    steps: o.steps.map((s, i) => ({ key: s.key, label: labelOf(s, i), kind: s.kind, status: "waiting", ids: [], part: partOf.get(s.key)! })),
    ...(o.check && { check: true }),
  };
  const now = Date.now();
  db()
    .prepare("INSERT INTO skill_runs (id, skill, engine, status, values_json, state_json, created_at, updated_at) VALUES (?, ?, ?, 'running', ?, ?, ?, ?)")
    .run(o.id, o.skill, o.engine, JSON.stringify(o.values), JSON.stringify(state), now, now);
  ensureSkillRunRunner();
  // The first parts start now (a studio step's tool may take a moment).
  return { done: advanceSkillRun(o.id) };
}

/** Start a run and wait for its first parts to have started (a studio step's tool is asynchronous). */
export async function beginSkillRun(o: Parameters<typeof startSkillRun>[0]): Promise<StartedRun> {
  const started = startSkillRun(o);
  await started.done;
  const r = load(o.id)!;
  const steps = r.state.steps;
  const error = steps.every((s) => s.status === "failed") ? (r.state.error ?? steps[0]?.error) : undefined;
  return { ids: steps.flatMap((s) => s.ids), href: steps.find((s) => s.href)?.href, waiting: steps.filter((s) => s.status === "waiting").map((s) => s.label), ...(error && { error }) };
}

/** A run as the skill's dialog shows it. */
const toView = (r: Row & { state: State }): SkillRunView => ({
  id: r.id,
  skill: r.skill,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  steps: r.state.steps.map((s) => ({ key: s.key, label: s.label, kind: s.kind, status: s.status, ids: s.ids, ...(s.studio && { studio: s.studio }), ...(s.href && { href: s.href }), ...(s.error && { error: s.error }) })),
  ...(r.state.error && { error: r.state.error }),
});

export function getSkillRun(id: string): SkillRunView | null {
  const r = load(id);
  return r && !r.state.check ? toView(r) : null;
}

/** A skill's newest runs in stages (dry runs left out). */
export function listSkillRuns(skill: string, limit = 5): SkillRunView[] {
  const rows = db().prepare("SELECT * FROM skill_runs WHERE skill = ? ORDER BY created_at DESC LIMIT ?").all(skill, limit * 3) as Row[];
  return rows
    .map((r) => ({ ...r, state: JSON.parse(r.state_json) as State }))
    .filter((r) => !r.state.check)
    .slice(0, limit)
    .map(toView);
}

// ---------------------------------------------------------------------------
// The sweep

/**
 * Move every run that is still going (also after a restart: the state is in the database). A dry run's row is left out:
 * only its own loop (inside runAsDemo) moves it, and its row is removed when that loop ends.
 */
export async function sweepSkillRuns(): Promise<void> {
  const ids = (db().prepare("SELECT id FROM skill_runs WHERE status = 'running' AND id NOT LIKE 'check-%' ORDER BY created_at LIMIT 200").all() as { id: string }[]).map((r) => r.id);
  for (const id of ids) {
    try {
      await advanceSkillRun(id);
    } catch (e) {
      console.warn(`[fuobe] skill run ${id}: ${(e as Error).message}`);
    }
  }
}

declare global {
  var __fuobeSkillRuns: { tick: () => void; timer: NodeJS.Timeout } | undefined;
  var __fuobeSkillRunsBusy: Set<string> | undefined;
}

const tick = () => void sweepSkillRuns().catch((e: Error) => console.warn(`[fuobe] skill run sweep failed: ${e.message}`));

/** Start the sweep (once per process: at boot, and when a run in stages starts). */
export function ensureSkillRunRunner(): void {
  const cur = globalThis.__fuobeSkillRuns;
  if (cur) {
    cur.tick = tick;
    return;
  }
  // Made outside any dry run's demo scope, so the sweep never runs a real step as a demo.
  const state = { tick, timer: outsideDemo(() => setInterval(() => globalThis.__fuobeSkillRuns?.tick(), SWEEP_MS)) };
  state.timer.unref?.();
  globalThis.__fuobeSkillRuns = state;
}

// ---------------------------------------------------------------------------
// The dry run of a run in stages

/** Tables whose rows a studio makes (a dub session, a Layers project…): the ones ASSET_REFS keys by their own id. */
const STUDIO_TABLES = () => ASSET_REFS.filter((r) => !r.key && !["generations", "assist_threads", "assist_schedules", "skills", "skill_runs", "canvases"].includes(r.table));

function snapshot(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const r of STUDIO_TABLES()) {
    try {
      out.set(r.table, new Set((db().prepare(`SELECT id FROM ${r.table}`).all() as { id: string }[]).map((x) => String(x.id))));
    } catch {
      // A table this install doesn't have.
    }
  }
  return out;
}

/**
 * Delete what a studio made for a dry run: rows that weren't there before it and that name one of its files or results
 * (a stand-in input, a generation it started). Anything else made meanwhile stays.
 */
function deleteStudioRecords(before: Map<string, Set<string>>, marks: string[]): number {
  let n = 0;
  for (const r of STUDIO_TABLES()) {
    const had = before.get(r.table);
    if (!had) continue;
    try {
      const rows = db().prepare(`SELECT id, ${r.cols.map((c) => `COALESCE(${c}, '')`).join(" || ' ' || ")} AS text FROM ${r.table}`).all() as { id: string; text: string }[];
      for (const row of rows) {
        if (had.has(String(row.id)) || !marks.some((m) => row.text.includes(m))) continue;
        n += db().prepare(`DELETE FROM ${r.table} WHERE id = ?`).run(row.id).changes;
      }
    } catch {
      // A table or column this install doesn't have.
    }
  }
  return n;
}

/**
 * The free dry run of a run in stages: every step on the demo provider (studio steps inside runAsDemo, so their own code
 * runs as a demo), each started when the steps before it are done, at most `ms`. Then the studio records it made are
 * deleted, its rows go to the Trash and the run's row is removed.
 */
export async function stagedDryRun(skill: { name: string; title: string }, steps: RecipeStep[], engine: Engine, values: RecipeValues, ms: number): Promise<{ ok: boolean; problems: string[]; skipped?: string }> {
  const id = `check-${Math.random().toString(36).slice(2, 12)}`;
  const before = snapshot();
  const marks = [...new Set([standIn("image"), standIn("video"), standIn("audio"), ...Object.values(values).filter((v): v is string => typeof v === "string" && v.startsWith("/api/files/"))])];
  const made = new Set<string>();
  try {
    return await runAsDemo(async () => {
      await startSkillRun({ id, skill: skill.name, title: skill.title, engine, values, steps, check: true }).done;
      const until = Date.now() + ms;
      for (;;) {
        const status = await advanceSkillRun(id);
        const r = load(id);
        for (const s of r?.state.steps ?? []) for (const g of s.ids) made.add(g);
        if (status !== "running") {
          const problems = (r?.state.steps ?? []).filter((s) => s.status === "failed").map((s) => `Step “${s.key}”: ${s.error ?? "it failed"}`);
          return { ok: status === "done", problems };
        }
        if (Date.now() > until) return { ok: false, problems: ["The dry run took too long"] };
        await new Promise((res) => setTimeout(res, 300));
      }
    });
  } finally {
    // Every row of the runs it started (a studio's later steps share their batch), then the studio's records.
    const batches = made.size ? (db().prepare(`SELECT DISTINCT batch_id FROM generations WHERE id IN (${[...made].map(() => "?").join(", ")}) AND batch_id IS NOT NULL`).all(...made) as { batch_id: string }[]).map((b) => b.batch_id) : [];
    const all = batches.length ? (db().prepare(`SELECT id FROM generations WHERE batch_id IN (${batches.map(() => "?").join(", ")})`).all(...batches) as { id: string }[]).map((g) => g.id) : [];
    const ids = [...new Set([...made, ...all])];
    deleteStudioRecords(before, [...marks, ...ids]);
    if (ids.length) trashGenerations(ids);
    db().prepare("DELETE FROM skill_runs WHERE id = ?").run(id);
  }
}
