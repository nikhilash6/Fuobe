import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { planRunnable, totalCost, type PlannedJob } from "@/lib/assist";
import { getModel, modelsFor } from "@/lib/catalog";
import { dualEngine } from "@/lib/catalog/engines";
import { currentModelId, replacedBy } from "@/lib/catalog/replaced";
import { OPERATION_LABELS, type Engine, type Generation, type GenerationRequest, type MediaKind, type Operation } from "@/lib/catalog/types";
import { probeMedia, type MediaInfo } from "@/lib/media-probe";
import {
  checkOutputs,
  checkValues,
  compile,
  exampleValues,
  isMediaRef,
  isMediaType,
  parseRecipe,
  parseRows,
  RECIPE_FILE,
  RECIPE_LIMITS,
  recipeProblems,
  RecipeSchema,
  isShapeHelper,
  shapeOf,
  shapeOfRecipe,
  SKILL_CHECK_FEATURE,
  SUGGEST_RULE,
  today,
  verifiedLine,
  type Compiled,
  type FilledCheck,
  type Recipe,
  type RecipeValues,
  type EngineCheck,
  type RecipePlace,
  type RecipeEstimate,
  type RecipeRun,
  type RecipeView,
  type VerifiedEngine,
  type VerifyResult,
  type FixCandidate,
  type ShapeNode,
  type SkillHistory,
  type SkillRunRecord,
  type SkillSuggestion,
  type StepFix,
} from "@/lib/recipe";
import type { Skill } from "@/lib/assist";
import { planSteps } from "./assist/studio-tools";
import { executeTool, getTool, planFor, validateInput } from "./assist/tools";
import { createPipeline } from "./chains";
import { llmSeesImages, llmText } from "./enhance";
import { cancelGeneration, createGenerations, currentRequest, getGeneration, previewChained, stampRequests, waitedOnFailure } from "./generations";
import { trashGenerations } from "./library";
import { db } from "./db";
import { isOffered, modelLicence, offeredModels } from "./model-access";
import { GenerationRequestSchema } from "./request-schema";
import { engineMode } from "./settings";
import { createSkill, deleteSkill, getSkill, listSkills, setSkillFile, skillFile, skillRecipe, SkillError } from "./skills";
import { absolutePath, readRef, saveFile } from "./storage";

/**
 * Running a skill's recipe (src/lib/recipe.ts, package W1): price it, run it with new inputs (one createPipeline per
 * row, or one gated Assist tool call), and check it before it's trusted — the plan on each engine its steps allow, a
 * free dry run on the demo provider (GenerationRequest.demo, whatever Settings → Demo mode says), and an optional
 * real test whose outputs are checked by their structure (probeMedia), never by their pixels. What was checked is
 * written back into the recipe's `verified`; "needs a re-check" is computed when it's read.
 */

/** A recipe that can't be saved or run as it is, with every reason. */
export class RecipeError extends SkillError {
  constructor(
    readonly problems: string[],
    status = 422,
  ) {
    super(problems.length === 1 ? problems[0] : `Fix the recipe first: ${problems.join("; ")}`, status);
  }
}

const ENGINES: Engine[] = ["cloud", "open"];
const ENGINE_NAME: Record<Engine, string> = { cloud: "the cloud", open: "your GPU" };
const asList = (a: string | string[] | undefined): string[] => (a === undefined ? [] : Array.isArray(a) ? a : [a]);

// ---------------------------------------------------------------------------
// Reading and saving

/** A skill and its recipe; a skill without one (or with a broken one) is refused with the reason. */
export function getRecipe(name: string): { skill: Skill; recipe: Recipe } {
  const skill = getSkill(name);
  if (!skill) throw new SkillError("No such skill", 404);
  const text = skillFile(name, RECIPE_FILE);
  if (text === null) throw new SkillError(`/${name} has no recipe: it runs through Assist`, 404);
  const parsed = parseRecipe(text);
  if (!parsed.ok) throw new SkillError(parsed.error, 422);
  return { skill, recipe: parsed.recipe };
}

/** Tools a recipe may call: the gated ones that make something (not remember, which changes what Assist knows). */
const runnableTool = (name: string) => !!getTool(name)?.gated && name !== "remember" && name !== "run_skill";

/**
 * Problems only the server can see: a model the catalog doesn't have (after REPLACED_BY), a tool a recipe can't call,
 * and a step whose request, filled with the examples, the API itself would refuse (shape and limits).
 */
function serverProblems(recipe: Recipe): string[] {
  const out: string[] = [];
  for (const s of recipe.steps) {
    if (s.kind === "tool") {
      if (!runnableTool(s.tool)) out.push(`Step “${s.key}”: “${s.tool}” isn't a tool a recipe can run`);
    } else if (!getModel(currentModelId(s.request.modelId))) out.push(`Step “${s.key}”: Fuobe has no model “${s.request.modelId}”`);
  }
  if (out.length) return out;
  try {
    compileRun({ name: "check", title: "Check" }, recipe, valuesForCheck(recipe), "cloud", { run: "check" });
  } catch (e) {
    out.push((e as Error).message);
  }
  return out;
}

/** Everything that keeps a recipe from being saved: its shape (recipeProblems), then the catalog and the API's limits. */
export function allProblems(recipe: Recipe): string[] {
  const own = recipeProblems(recipe);
  return own.length ? own : serverProblems(recipe);
}

/**
 * Save a skill's recipe.json (user skills only: "Duplicate it first" for a built-in), refusing one with problems.
 * `verified` is the server's to write: a recipe saved from outside (an edit, an upload) starts unchecked.
 */
export function saveRecipe(name: string, input: unknown, o: { keepVerified?: boolean } = {}): Recipe {
  const skill = getSkill(name);
  if (!skill) throw new SkillError("No such skill", 404);
  if (skill.source === "builtin") throw new SkillError("Built-in skills can't be changed — Duplicate it first, then change your copy", 403);
  const parsed = RecipeSchema.safeParse(input);
  if (!parsed.success) throw new RecipeError(parsed.error.issues.map((i) => (i.path.length ? `${i.path.map(String).join(".")}: ${i.message}` : i.message)));
  const recipe: Recipe = { ...parsed.data };
  if (!o.keepVerified) delete recipe.verified;
  const problems = allProblems(recipe);
  if (problems.length) throw new RecipeError(problems);
  setSkillFile(name, RECIPE_FILE, `${JSON.stringify(recipe, null, 2)}\n`);
  return recipe;
}

// ---------------------------------------------------------------------------
// Engines

/** The engines one step can run on: an Original on both (unless the step names one), any other model on its own. */
function stepEngines(s: Recipe["steps"][number]): Engine[] {
  if (s.kind === "tool") return ENGINES;
  const m = getModel(currentModelId(s.request.modelId));
  if (!m) return [];
  if (dualEngine(m)) return s.request.engine ? [s.request.engine] : (m.engines ?? ENGINES);
  return [m.engine];
}

/** The engines every step allows on this install (Settings → Engine mode applied). Fuobe never swaps a model across engines. */
export function recipeEngines(recipe: Recipe): Engine[] {
  const mode = engineMode();
  return ENGINES.filter((e) => recipe.steps.every((s) => stepEngines(s).includes(e)) && (mode === "both" || mode === e));
}

/** Why no engine is left, in words. */
function noEngine(recipe: Recipe): string {
  const sides = ENGINES.filter((e) => recipe.steps.every((s) => stepEngines(s).includes(e)));
  if (!sides.length) return "Its steps need both engines at once (a cloud model and a model on your GPU): run them as two skills";
  return sides[0] === "open"
    ? "It runs on open-source models, which aren't available here"
    : "It runs on cloud models, which aren't available here";
}

// ---------------------------------------------------------------------------
// Compiling one run

/** Validate and compile one run: each filled request as the API takes it, an Original put on the run's engine. */
function compileRun(skill: { name: string; title: string }, recipe: Recipe, values: RecipeValues, engine: Engine, o: { run: string; demo?: boolean }): Compiled {
  const c = compile(recipe, values, { skill: skill.name, run: o.run, title: skill.title, demo: o.demo });
  if (c.kind === "tool") {
    const error = validateInput(c.tool, c.input);
    if (error) throw new SkillError(`Step “${c.key}”: ${error.replace(/^Invalid input: /, "")}`, 422);
    return c;
  }
  return {
    ...c,
    steps: c.steps.map((s) => {
      const { skill: stamp, demo, batchTitle, step, chain, ...asked } = s.request;
      const parsed = GenerationRequestSchema.safeParse(asked);
      if (!parsed.success) throw new SkillError(`Step “${s.key}”: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, 422);
      const req = parsed.data as GenerationRequest;
      const m = getModel(currentModelId(req.modelId));
      const slots = s.chain ?? chain;
      return {
        ...s,
        ...(slots && { chain: slots }),
        request: { ...req, ...(m && dualEngine(m) && !req.engine && { engine }), batchTitle, skill: stamp, ...(step && { step }), ...(demo && { demo }) },
      };
    }),
  };
}

interface RunPlan {
  jobs: PlannedJob[];
  total: number | null;
  errors: string[];
  place?: RecipePlace;
  /** Every error is only a provider to connect (with Settings → Demo mode off): this install's, not the recipe's. */
  connectOnly?: boolean;
}

/**
 * Whether a run's refusals are all "connect a provider" (chooseRoute's when nothing on a route is connected and Demo
 * mode is off, and llmMissing's): what only this install lacks, which the demo route may stand in for.
 */
export const onlyConnect = (errors: string[]): boolean => errors.length > 0 && errors.every((e) => /^Connect\b/.test(e));

/** Price one compiled run the way it would start (planSteps / planFor), with what stops it. */
function planRun(c: Compiled, engine: Engine): RunPlan {
  if (c.kind === "tool") {
    const p = planFor(c.tool, c.input, { engine });
    const errors = [...(p.error ? [p.error] : []), ...p.jobs.filter((j) => j.error).map((j) => `${j.note ?? j.modelName}: ${j.error}`)];
    return { jobs: p.jobs, total: p.total, errors, place: { ...(p.studio && { studio: p.studio }), ...(p.href && { href: p.href }), ...(p.fallback && { fallback: p.fallback }) } };
  }
  const jobs = planSteps("run_skill", c.steps);
  const failed = jobs.filter((j) => j.error);
  const errors = failed.map((j) => `${j.note && j.note !== j.modelName ? `${j.note} (${j.modelName})` : j.modelName}: ${j.error}`);
  if (!errors.length && !planRunnable(jobs)) errors.push("Nothing to run");
  return { jobs, total: totalCost(jobs), errors, connectOnly: failed.length === errors.length && onlyConnect(failed.map((j) => j.error!)) };
}

/** The run with every request on the demo provider: valid and priced the same whether or not a provider is connected. */
function asDemo(c: Compiled): Compiled {
  return c.kind === "tool" ? c : { ...c, steps: c.steps.map((s) => ({ ...s, request: { ...s.request, demo: true } })) };
}

/**
 * The plan check: the run as it would start. When the only thing stopping it is a provider to connect (with Settings →
 * Demo mode off), the recipe itself is fine: the same run on the demo provider passes it, and the reason is a note.
 * Any other refusal (a route's image limit, a LoRA a route can't carry…) fails the check: the demo route skips those.
 */
function planCheck(c: Compiled, engine: Engine): RunPlan & { notes: string[] } {
  const plan = planRun(c, engine);
  if (!plan.errors.length || c.kind === "tool" || !plan.connectOnly) return { ...plan, notes: [] };
  const demo = planRun(asDemo(c), engine);
  return demo.errors.length ? { ...plan, notes: [] } : { ...demo, notes: [...new Set(plan.jobs.flatMap((j) => (j.error ? [j.error] : [])))] };
}

/**
 * sha256 of what a run uses: each step's model, operation, route (the first one on, as the demo provider would name it,
 * so connecting a key doesn't count as a change) and price table.
 */
function planHash(compiled: Compiled, engine: Engine): string {
  const c = asDemo(compiled);
  const parts =
    c.kind === "tool"
      ? planFor(c.tool, c.input, { engine }).jobs.map((j) => [j.modelId, j.op, getModel(j.modelId)?.pricing ?? null])
      : c.steps.map((s) => {
          const p = previewChained({ ...s.request, ...(s.chain && { chain: s.chain }) }, asList(s.after).length);
          return [p.model.id, p.op, p.route.provider, p.route.endpoint, p.model.pricing ?? null];
        });
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}

// ---------------------------------------------------------------------------
// Stand-in files: a check's media input with no example (or one whose file is gone)

declare global {
  var __fuobeStandIns: Map<string, string> | undefined;
}

/** A small real file of a kind, saved once as a hidden (derived) asset: the dry run's providers read their inputs. */
function standIn(kind: "image" | "video" | "audio"): string {
  const cache = (globalThis.__fuobeStandIns ??= new Map());
  const known = cache.get(kind);
  if (known && fs.existsSync(absolutePath(decodeURIComponent(known.slice("/api/files/".length))))) return known;
  const samples = path.join(process.cwd(), "public", "samples");
  const file =
    kind === "image"
      ? { data: fs.readFileSync(path.join(samples, "grade-sample.jpg")), contentType: "image/jpeg" }
      : kind === "video"
        ? { data: fs.readFileSync(path.join(samples, "demo-landscape.mp4")), contentType: "video/mp4" }
        : { data: silentWav(2), contentType: "audio/wav" };
  const url = saveFile({ ...file, source: "derived", name: `skill-check-${kind}` }).url;
  cache.set(kind, url);
  return url;
}

function silentWav(seconds: number): Buffer {
  const rate = 16000;
  const n = rate * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  return buf;
}

/** Whether a Fuobe file a recipe names still exists (a link elsewhere counts as there). */
const fileThere = (ref: string) => {
  if (!ref.startsWith("/api/files/")) return true;
  try {
    return fs.existsSync(absolutePath(decodeURIComponent(ref.slice("/api/files/".length).split("?")[0])));
  } catch {
    return false;
  }
};

/** A stand-in link to price with, as the CLI's estimate does: nothing reads it. */
const PRICE_STAND_IN = { image: "/api/files/uploads/estimate/stand-in.png", video: "/api/files/uploads/estimate/stand-in.mp4", audio: "/api/files/uploads/estimate/stand-in.wav" } as const;

/**
 * The values a check runs with: the examples, with a stand-in for a media input that has none or whose file is gone
 * (a link to price with; a real small file when the run will read it: `files`).
 */
function valuesForCheck(recipe: Recipe, files = false): RecipeValues {
  const fill = (kind: "image" | "video" | "audio") => (files ? standIn(kind) : PRICE_STAND_IN[kind]);
  const values = exampleValues(recipe, fill);
  for (const p of recipe.params) {
    const v = values[p.id];
    if (isMediaType(p.type) && (typeof v !== "string" || !isMediaRef(v) || (files && !fileThere(v)))) values[p.id] = fill(p.type);
  }
  const checked = checkValues(recipe, values);
  return checked.values ?? values;
}

// ---------------------------------------------------------------------------
// What a page shows

export function recipeView(name: string): RecipeView {
  const { skill, recipe } = getRecipe(name);
  const engines = recipeEngines(recipe);
  const ready = engines.filter((e) => !!recipe.verified?.[e]?.plan);
  const models = engines.flatMap((e) =>
    recipe.steps.flatMap((s) => {
      if (s.kind === "tool") return [];
      const m = getModel(currentModelId(s.request.modelId));
      if (!m) return [];
      const l = modelLicence(m);
      return [{ engine: e, name: m.name, licence: (e === "cloud" && dualEngine(m) ? l.cloud : undefined)?.name ?? l.licence.name }];
    }),
  );
  return {
    name: skill.name,
    title: skill.title,
    ...(skill.icon && { icon: skill.icon }),
    builtin: skill.source === "builtin",
    enabled: skill.enabled,
    recipe,
    engines,
    ready,
    recheck: needsRecheck(recipe, ready),
    line: verifiedLine(recipe, engines),
    ...(!engines.length && { why: noEngine(recipe) }),
    models: [...new Map(models.map((x) => [`${x.engine}:${x.name}`, x])).values()],
  };
}

/**
 * Why a checked recipe should be checked again, per engine (none: it's fine): a step's model moved by REPLACED_BY, a
 * model switched off in Settings → Models & licences, a plan that no longer passes, or a plan hash (models, routes,
 * prices) that differs from the one checked. Computed when read: there is no background job.
 */
export function needsRecheck(recipe: Recipe, engines: Engine[] = recipeEngines(recipe).filter((e) => !!recipe.verified?.[e]?.plan)): Partial<Record<Engine, string[]>> {
  const out: Partial<Record<Engine, string[]>> = {};
  const replaced = recipe.steps.flatMap((s) => {
    if (s.kind !== "generate") return [];
    const r = replacedBy(s.request.modelId);
    return r ? [`${r.was} was replaced by ${getModel(r.id)?.name ?? r.id}`] : [];
  });
  for (const e of engines) {
    const v = recipe.verified?.[e];
    if (!v?.plan) continue;
    const reasons = [...replaced];
    for (const s of recipe.steps) {
      if (s.kind !== "generate") continue;
      const id = currentModelId(s.request.modelId);
      const m = getModel(id);
      if (m && !isOffered(id, dualEngine(m) ? e : undefined)) reasons.push(`${m.name} is switched off in Settings → Models & licences`);
    }
    if (!reasons.length) {
      try {
        const c = compileRun({ name: "check", title: "Check" }, recipe, valuesForCheck(recipe), e, { run: "check" });
        const plan = planCheck(c, e);
        if (plan.errors.length) reasons.push(plan.errors[0]);
        else if (v.catalog && planHash(c, e) !== v.catalog) reasons.push("The models, routes or prices it uses changed since it was checked");
      } catch (err) {
        reasons.push((err as Error).message);
      }
    }
    if (reasons.length) out[e] = [...new Set(reasons)];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rows

export interface RunInput {
  values?: Record<string, unknown>;
  rows?: Record<string, unknown>[];
  csv?: string;
}

interface Row {
  line: number;
  values?: RecipeValues;
  errors: string[];
}

/** The runs asked for: one set of values, a list of rows, or a CSV (parsed and checked like the form). */
function rowsOf(recipe: Recipe, input: RunInput): { rows: Row[]; errors: string[] } {
  if (input.csv !== undefined) {
    const p = parseRows(input.csv, recipe);
    return { rows: p.rows.map((r) => ({ line: r.line, values: r.values, errors: r.errors })), errors: p.errors };
  }
  const list = input.rows ?? [input.values ?? {}];
  const errors = list.length > RECIPE_LIMITS.rows ? [`At most ${RECIPE_LIMITS.rows} rows at a time — this has ${list.length}`] : list.length ? [] : ["Add a row to run"];
  return {
    errors,
    rows: list.slice(0, RECIPE_LIMITS.rows).map((v, i) => {
      const c = checkValues(recipe, v ?? {});
      return { line: i + 1, values: c.values, errors: Object.values(c.errors) };
    }),
  };
}

/** The engine asked for, else the first one its plan check passed on (else the first its steps allow). */
function engineFor(recipe: Recipe, asked: Engine | undefined): Engine {
  const engines = recipeEngines(recipe);
  if (!engines.length) throw new SkillError(noEngine(recipe), 422);
  if (asked && !engines.includes(asked)) throw new SkillError(`This skill doesn't run on ${ENGINE_NAME[asked]}: its steps run on ${engines.map((e) => ENGINE_NAME[e]).join(" or ")}`, 422);
  return asked ?? engines.find((e) => !!recipe.verified?.[e]?.plan) ?? engines[0];
}

/** A skill switched off on the Skills page doesn't run (by its form, a link or the API) until it's switched on. */
function mustBeOn(skill: Skill): void {
  if (!skill.enabled) throw new SkillError(`/${skill.name} is switched off — switch it on in Skills to run it`, 409);
}

// ---------------------------------------------------------------------------
// Estimate and run

/** Price one run or many (rows priced together, with a total) on an engine, without starting anything. */
export function estimateRecipe(name: string, input: RunInput, asked?: Engine): RecipeEstimate {
  const { skill, recipe } = getRecipe(name);
  mustBeOn(skill);
  const engine = engineFor(recipe, asked);
  const { rows, errors } = rowsOf(recipe, input);
  let place: RecipePlace | undefined;
  const runs = rows.map((r) => {
    if (!r.values) return { line: r.line, jobs: [], total: null, errors: r.errors };
    try {
      const plan = planRun(compileRun(skill, recipe, r.values, engine, { run: "estimate" }), engine);
      place ??= plan.place;
      return { line: r.line, jobs: plan.jobs, total: plan.total, errors: plan.errors };
    } catch (e) {
      return { line: r.line, jobs: [], total: null, errors: [(e as Error).message] };
    }
  });
  const jobs = runs.flatMap((r) => r.jobs);
  const totals = runs.map((r) => r.total);
  const total = totals.some((t) => t === null) ? null : Math.round(totals.reduce<number>((s, t) => s + (t ?? 0), 0) * 1000) / 1000;
  return {
    engine,
    runs,
    jobs: runs.find((r) => r.jobs.length)?.jobs ?? [],
    total: runs.every((r) => !r.errors.length) ? total : null,
    demo: jobs.length > 0 && jobs.every((j) => j.demo || j.error),
    runnable: !errors.length && runs.length > 0 && runs.every((r) => !r.errors.length),
    errors,
    ...(place && { place }),
  };
}

/**
 * A studio tool makes its own requests: once it has, they get the run's stamp and the skill's title as their batch's
 * name, as a pipeline's are given when compiled. The run is the tool's batch (else `run`), which is returned.
 */
function stampToolRun(skill: { name: string; title: string }, ids: string[], run: string): string | undefined {
  let batch: string | undefined;
  stampRequests(ids, (batches) => {
    batch = batches[0];
    return { skill: { name: skill.name, run: batch ?? run }, batchTitle: skill.title.slice(0, 200) };
  });
  return batch;
}

/**
 * Run a recipe once or once per row on an engine whose plan check passed. Every row is validated and priced first:
 * one bad row starts nothing. A pipeline is one createPipeline per row; a tool recipe one executeTool call per row.
 */
export async function runRecipe(name: string, input: RunInput, asked?: Engine): Promise<{ engine: Engine; runs: RecipeRun[]; demo: boolean }> {
  const { skill, recipe } = getRecipe(name);
  mustBeOn(skill);
  const engine = engineFor(recipe, asked);
  if (!recipe.verified?.[engine]?.plan) throw new SkillError(`Check this skill on ${ENGINE_NAME[engine]} first — the check is free`, 409);
  const { rows, errors } = rowsOf(recipe, input);
  if (errors.length) throw new RecipeError(errors);
  if (!rows.length) throw new RecipeError(["Add a row to run"]);
  const bad = rows.flatMap((r) => (r.errors.length ? [`${rows.length > 1 ? `Row ${r.line}: ` : ""}${r.errors.join("; ")}`] : []));
  if (bad.length) throw new RecipeError(bad);
  // Compile and price every row before anything starts.
  const compiled = rows.map((r) => {
    const run = nanoid(10);
    const c = compileRun(skill, recipe, r.values!, engine, { run });
    const plan = planRun(c, engine);
    if (plan.errors.length) throw new RecipeError(plan.errors.map((e) => `${rows.length > 1 ? `Row ${r.line}: ` : ""}${e}`));
    return { run, c };
  });
  const runs: RecipeRun[] = [];
  let demo = true;
  if (compiled[0].c.kind === "tool") {
    for (const { run, c } of compiled) {
      if (c.kind !== "tool") continue;
      const out = await executeTool(c.tool, c.input, { engine });
      const text = typeof out.content === "string" ? out.content : "";
      if (out.isError) {
        const error = text.replace(/^\{"error":"(.*)"\}$/, "$1") || "The tool couldn't start";
        if (compiled.length === 1) throw new SkillError(error, 422);
        // Each tool call stands alone: the other rows still run, and this one says why it didn't.
        runs.push({ ids: [], error });
        continue;
      }
      let href: string | undefined;
      try {
        href = (JSON.parse(text) as { href?: string }).href;
      } catch {
        href = undefined;
      }
      const ids = (out.items ?? []).flatMap((i) => (i.role === "generations" ? i.ids : []));
      const batchId = stampToolRun(skill, ids, run);
      demo &&= ids.every((id) => getGeneration(id)?.provider === "mock");
      runs.push({ ...(batchId && { batchId }), ids, ...(href && { href }) });
    }
    if (!runs.some((r) => !r.error)) throw new SkillError(runs[0]?.error ?? "Nothing could start", 422);
    return { engine, runs, demo };
  }
  const made: Generation[] = [];
  try {
    for (const { run, c } of compiled) {
      if (c.kind !== "pipeline") continue;
      const p = createPipeline(c.steps, { batchId: run });
      made.push(...p.items);
      runs.push({ batchId: p.batchId, ids: p.items.map((g) => g.id), href: "/library" });
    }
  } catch (e) {
    // One row couldn't start after all (a race with Settings): stop the rows already started.
    for (const g of made) void cancelGeneration(g.id);
    throw e;
  }
  demo = made.every((g) => g.provider === "mock");
  return { engine, runs, demo };
}

// ---------------------------------------------------------------------------
// Checks

export type VerifyLevel = "plan" | "demo" | "real";

/** Whether two recipes are the same but for what was checked (`verified`). */
const sameRecipe = (a: Recipe, b: Recipe) => {
  const bare = (r: Recipe) => JSON.stringify({ ...r, verified: undefined });
  return bare(a) === bare(b);
};

const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

/** Wait for generations to finish (the runner moves them), at most `ms`; cancels what's left when time runs out. */
async function settle(ids: string[], ms: number): Promise<Generation[]> {
  const until = Date.now() + ms;
  for (;;) {
    const gens = ids.map((id) => getGeneration(id, { includeDeleted: true })).filter((g): g is Generation => !!g);
    if (gens.length === ids.length && gens.every((g) => TERMINAL.has(g.status))) return gens;
    if (Date.now() > until) {
      for (const g of gens) if (!TERMINAL.has(g.status)) await cancelGeneration(g.id);
      return ids.map((id) => getGeneration(id, { includeDeleted: true })).filter((g): g is Generation => !!g);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** What a step should make: its check's kind, else the kind of the row it made. */
const kindOf = (check: FilledCheck | undefined, g: Generation): MediaKind => check?.kind ?? g.kind;

/** A step's own failure, in words. */
const failure = (key: string, g: Generation | undefined) =>
  !g ? `Step “${key}” wasn't made` : g.status !== "succeeded" ? `Step “${key}” ${g.status === "canceled" ? "was stopped" : "failed"}${g.error ? `: ${g.error}` : ""}` : null;

const DRY_RUN_MS = 120_000;
const REAL_RUN_MS = 15 * 60_000;

/** The free dry run: one run on the demo provider, its rows hidden (skill-check) and moved to the Trash at the end. */
async function dryRun(skill: { name: string; title: string }, recipe: Recipe, engine: Engine): Promise<NonNullable<EngineCheck["dryRun"]>> {
  const c = compileRun(skill, recipe, valuesForCheck(recipe, true), engine, { run: nanoid(10), demo: true });
  // A studio step would make a record the user sees (a demo dub, a Layers project): its plan is its check in W1.
  if (c.kind === "tool") return { ok: true, problems: [], skipped: `A studio step (${c.tool}) is checked by its plan only` };
  const p = createPipeline(c.steps, { batchId: nanoid(10) });
  const ids = p.items.map((g) => g.id);
  try {
    const done = new Map((await settle(ids, DRY_RUN_MS)).map((g) => [g.id, g]));
    const problems: string[] = [];
    for (const s of c.steps) {
      const g = done.get(p.byKey[s.key]?.id);
      const why = failure(s.key, g);
      if (why) {
        problems.push(why);
        continue;
      }
      const kind = kindOf(c.checks[s.key], g!);
      if (!g!.outputs.some((o) => o.kind === kind)) problems.push(`Step “${s.key}” made no ${kind}`);
    }
    return { ok: !problems.length, problems };
  } finally {
    trashGenerations(ids);
  }
}

/** A stored output's header facts (duration, size, sound), or null when it can't be read. */
async function infoOf(url: string, kind: MediaKind): Promise<MediaInfo | null> {
  if (kind !== "video" && kind !== "audio") return null;
  try {
    return probeMedia(new Uint8Array((await readRef(url)).data));
  } catch {
    return null;
  }
}

/**
 * Whether a picture shows a sentence, judged only by a model that sees images (llmSeesImages): null when there is none
 * (a text-only model would answer from the words alone) or it doesn't answer. On the open engine only a local model is
 * asked, as everywhere the open engine runs: never a paid API.
 */
async function judgeLook(look: string, image: string, engine: Engine): Promise<boolean | null> {
  const local = { ollamaOnly: engine === "open" };
  if (!(await llmSeesImages(local))) return null;
  try {
    const f = await readRef(image);
    const answer = await llmText(
      "You check whether a picture matches a short description. Answer yes or no first, then one short reason.",
      `Description: ${look}`,
      [{ data: f.data, contentType: f.contentType }],
      local,
    );
    if (!answer) return null;
    return /^\W*yes\b/i.test(answer) ? true : /^\W*no\b/i.test(answer) ? false : null;
  } catch {
    return null;
  }
}

/** One frame of a clip, through the cloud extract-frame model (the open engine has none to ask). */
async function frameOf(video: string, engine: Engine): Promise<{ url?: string; ids: string[] }> {
  if (engine !== "cloud" || !isOffered("extract-frame")) return { ids: [] };
  try {
    const [g] = createGenerations({ feature: SKILL_CHECK_FEATURE, modelId: "extract-frame", op: "frame", inputs: { video }, params: { extra: { frame_type: "middle" } } });
    const [done] = await settle([g.id], 120_000);
    return { url: done?.outputs.find((o) => o.kind === "image")?.url, ids: [g.id] };
  } catch {
    return { ids: [] };
  }
}

/** The optional real test: the examples run for real, then each checked step's outputs are measured. */
async function realRun(skill: { name: string; title: string }, recipe: Recipe, engine: Engine): Promise<NonNullable<EngineCheck["real"]>> {
  const notes: string[] = [];
  const problems: string[] = [];
  const c = compileRun(skill, recipe, valuesForCheck(recipe, true), engine, { run: nanoid(10) });
  const helpers: string[] = [];
  let made: Generation[];
  let byKey: Record<string, string> = {};
  if (c.kind === "tool") {
    const out = await executeTool(c.tool, c.input, { engine });
    if (out.isError) return { ok: false, problems: [typeof out.content === "string" ? out.content : "The tool couldn't start"], notes, demo: false };
    const ids = (out.items ?? []).flatMap((i) => (i.role === "generations" ? i.ids : []));
    stampToolRun(skill, ids, nanoid(10));
    made = await settle(ids, REAL_RUN_MS);
    if (ids.length) byKey = { [c.key]: ids[0] };
  } else {
    const p = createPipeline(c.steps, { batchId: nanoid(10) });
    made = await settle(p.items.map((g) => g.id), REAL_RUN_MS);
    byKey = Object.fromEntries(Object.entries(p.byKey).map(([k, g]) => [k, g.id]));
  }
  const demo = made.length > 0 && made.every((g) => g.provider === "mock");
  if (demo) notes.push(`It ran as a demo (no provider connected for ${ENGINE_NAME[engine]}): connect one in Settings for a real test`);
  const byId = new Map(made.map((g) => [g.id, g]));
  for (const [key, check] of Object.entries(c.checks)) {
    const g = byId.get(byKey[key]);
    const why = failure(key, g);
    if (why) {
      problems.push(why);
      continue;
    }
    // A real check's length is ±10% of one length; a range stays a range.
    const infos = await Promise.all(g!.outputs.map((o) => infoOf(o.url, o.kind)));
    const res = checkOutputs(check, g!.outputs, infos);
    problems.push(...res.problems.map((x) => `Step “${key}”: ${x}`));
    notes.push(...res.skipped.map((x) => `Step “${key}”: couldn't read ${x}`));
    if (check.look && res.ok) {
      const still = g!.outputs.find((o) => o.kind === "image")?.url;
      const clip = still ? undefined : g!.outputs.find((o) => o.kind === "video")?.url;
      const frame = clip ? await frameOf(clip, engine) : { url: still, ids: [] };
      helpers.push(...frame.ids);
      const verdict = frame.url ? await judgeLook(check.look, frame.url, engine) : null;
      if (verdict === false) problems.push(`Step “${key}” doesn't look like “${check.look}”`);
      else if (verdict === null) notes.push(`Step “${key}”: the look wasn't judged (no model that sees images${clip && engine === "open" ? ", and no frame extractor on your GPU" : ""})`);
    }
  }
  if (helpers.length) trashGenerations(helpers);
  return { ok: !problems.length, problems, notes, demo };
}

/**
 * Check a recipe on each engine given, whether or not it is saved yet (a draft from the Library, W2): the plan, then at
 * `demo` the free dry run, at `real` the real test. Returns what each check found and the `verified` it earns, built on
 * `prev` (checks made against the same plan hash are kept). Writes nothing.
 */
async function checkEngines(skill: { name: string; title: string }, recipe: Recipe, level: VerifyLevel, engines: Engine[], prev: Recipe["verified"] = {}): Promise<{ checks: EngineCheck[]; verified: NonNullable<Recipe["verified"]> }> {
  const verified: NonNullable<Recipe["verified"]> = { ...prev };
  const day = today();
  const checks: EngineCheck[] = [];
  for (const e of engines) {
    const before = prev?.[e] ?? null;
    let check: EngineCheck;
    let hash: string | undefined;
    try {
      const c = compileRun(skill, recipe, valuesForCheck(recipe), e, { run: "check" });
      const plan = planCheck(c, e);
      check = { engine: e, plan: { ok: !plan.errors.length, total: plan.total, demo: plan.jobs.every((j) => j.demo), errors: plan.errors, notes: plan.notes } };
      if (check.plan.ok) hash = planHash(c, e);
    } catch (err) {
      check = { engine: e, plan: { ok: false, total: null, demo: false, errors: [(err as Error).message], notes: [] } };
    }
    if (!check.plan.ok || !hash) {
      verified[e] = null;
      checks.push(check);
      continue;
    }
    // Checks made against another plan don't count for this one.
    const same = before?.catalog === hash;
    const next: VerifiedEngine = { plan: day, dryRun: same ? (before?.dryRun ?? null) : null, real: same ? (before?.real ?? null) : null, catalog: hash, ...(same && before?.notes && { notes: before.notes }) };
    if (check.plan.notes.length) next.notes = check.plan.notes.slice(0, 12);
    if (level !== "plan") {
      check.dryRun = await dryRun(skill, recipe, e).catch((err) => ({ ok: false, problems: [(err as Error).message] }));
      next.dryRun = check.dryRun.ok && !check.dryRun.skipped ? day : check.dryRun.ok ? next.dryRun : null;
      if (check.dryRun.skipped) next.notes = [...(next.notes ?? []), check.dryRun.skipped].slice(0, 12);
    }
    if (level === "real" && check.dryRun?.ok) {
      check.real = await realRun(skill, recipe, e).catch((err) => ({ ok: false, problems: [(err as Error).message], notes: [], demo: false }));
      next.real = check.real.ok && !check.real.demo ? day : check.real.ok ? next.real : null;
      next.notes = check.real.notes.slice(0, 12);
    }
    verified[e] = next;
    checks.push(check);
  }
  return { checks, verified };
}

/** A recipe as every run reads it: a step naming a model Fuobe retired runs on what replaced it. */
const asRunsNow = (recipe: Recipe): Recipe => ({
  ...recipe,
  steps: recipe.steps.map((s) => (s.kind === "generate" ? { ...s, request: currentRequest(s.request).request as typeof s.request } : s)),
});

/** Whether checks passed: every plan, and every dry run and real test that ran. */
const allPassed = (checks: EngineCheck[]) => checks.every((c) => c.plan.ok && (c.dryRun?.ok ?? true) && (c.real?.ok ?? true));

/**
 * Check a recipe and write what passed into its `verified`:
 * - `plan`: compile with the examples (a stand-in file for a media input with none) and price it on each engine its
 *   steps allow (or the one asked). Free.
 * - `demo`: the plan, then one dry run per engine on the demo provider, with or without keys and whatever Settings →
 *   Demo mode says. Free; its rows are hidden and go to the Trash.
 * - `real`: the above, then the examples for real (asks first: `confirm`), each checked step measured.
 */
export async function verifyRecipe(name: string, level: VerifyLevel, asked?: Engine, o: { confirm?: boolean } = {}): Promise<VerifyResult> {
  const found = getRecipe(name);
  const { skill } = found;
  if (skill.source === "builtin") throw new SkillError("Built-in skills can't be changed — Duplicate it first, then check your copy", 403);
  // A step that names a model Fuobe retired runs on what replaced it (as every run does): the re-check writes that down.
  const recipe = asRunsNow(found.recipe);
  const problems = allProblems(recipe);
  if (problems.length) throw new RecipeError(problems);
  const all = recipeEngines(recipe);
  if (!all.length) throw new SkillError(noEngine(recipe), 422);
  if (asked && !all.includes(asked)) throw new SkillError(`This skill doesn't run on ${ENGINE_NAME[asked]}`, 422);
  if (level === "real" && !o.confirm) throw new SkillError("A real test spends money or GPU time: confirm it with its price first", 409);
  const engines = asked ? [asked] : all;
  const { checks, verified } = await checkEngines(skill, recipe, level, engines, recipe.verified);
  // A check takes a while (a dry run, a real test): a recipe saved or uploaded meanwhile is never overwritten, and what
  // was checked is never written onto it. Checks of other engines that finished meanwhile are kept.
  const now = getRecipe(name).recipe;
  if (!sameRecipe(now, found.recipe)) throw new SkillError("The recipe changed while it was being checked — check it again", 409);
  const merged: NonNullable<Recipe["verified"]> = { ...now.verified, ...Object.fromEntries(engines.map((e) => [e, verified[e] ?? null])) };
  saveRecipe(name, { ...recipe, verified: merged }, { keepVerified: true });
  return { ok: allPassed(checks), engines: checks, view: recipeView(name) };
}

// ---------------------------------------------------------------------------
// A skill made from results (W2): its recipe is checked before it is saved

interface DraftChecks {
  verified: NonNullable<Recipe["verified"]>;
  at: number;
  /** The skill it was saved as, while its dry run was still going (that run's result is written into it). */
  saved?: string;
}

declare global {
  var __fuobeDraftChecks: Map<string, DraftChecks> | undefined;
}

const DRAFT_TTL_MS = 6 * 60 * 60_000;
const DRAFT_MAX = 200;

/** What drafts' checks found, by recipe (the newest few hundred for a few hours, in memory: the server's own word, never the browser's). */
function draftChecks(): Map<string, DraftChecks> {
  const m = (globalThis.__fuobeDraftChecks ??= new Map());
  for (const [k, v] of m) if (Date.now() - v.at > DRAFT_TTL_MS) m.delete(k);
  // Oldest first (a Map keeps insertion order; a check of the same recipe is set again, so it moves to the end).
  while (m.size > DRAFT_MAX) m.delete(m.keys().next().value!);
  return m;
}

/** A recipe's identity for its checks: its JSON with sorted keys, without what was checked. */
export function draftKey(recipe: Recipe): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, stable(x)]),
          )
        : v;
  return crypto.createHash("sha256").update(JSON.stringify(stable({ ...recipe, verified: undefined }))).digest("hex");
}

/** A draft's recipe as it would be saved: its shape, then everything a save refuses. */
function draftRecipe(input: unknown): Recipe {
  const parsed = RecipeSchema.safeParse(input);
  if (!parsed.success) throw new RecipeError(parsed.error.issues.map((i) => (i.path.length ? `${i.path.map(String).join(".")}: ${i.message}` : i.message)));
  const recipe: Recipe = { ...parsed.data };
  delete recipe.verified;
  const problems = allProblems(recipe);
  if (problems.length) throw new RecipeError(problems);
  return recipe;
}

export interface DraftCheck {
  ok: boolean;
  engines: EngineCheck[];
  /** Engines whose plan check passed: the skill runs there once saved. */
  ready: Engine[];
  /** Why it runs on no engine of this install. */
  why?: string;
}

/** Write a draft's finished checks into the skill it was saved as, when that skill still holds the same recipe. */
function adoptChecks(name: string, recipe: Recipe, verified: NonNullable<Recipe["verified"]>): void {
  try {
    const now = getRecipe(name).recipe;
    if (draftKey(now) !== draftKey(recipe)) return;
    const merged: NonNullable<Recipe["verified"]> = { ...now.verified };
    for (const e of ENGINES) {
      const v = verified[e];
      const cur = now.verified?.[e];
      // Only what was checked against the plan it holds (a later re-check stands).
      if (v?.catalog && (!cur || cur.catalog === v.catalog)) merged[e] = { ...cur, ...v };
    }
    saveRecipe(name, { ...now, verified: merged }, { keepVerified: true });
  } catch {
    // Deleted or changed meanwhile: it is checked again from the Skills page.
  }
}

/**
 * Check a draft's recipe before it is saved (the review screen's Check it): `plan` prices it on each engine its steps
 * allow (free, quick); `demo` adds the free dry run on the demo provider. What passed is kept for the save; a draft saved
 * while its dry run was going gets the result when it ends.
 */
export async function checkDraft(input: unknown, level: "plan" | "demo", title = "Skill check"): Promise<DraftCheck> {
  const recipe = draftRecipe(input);
  const engines = recipeEngines(recipe);
  if (!engines.length) return { ok: false, engines: [], ready: [], why: noEngine(recipe) };
  const key = draftKey(recipe);
  const { checks, verified } = await checkEngines({ name: "draft", title }, recipe, level, engines, draftChecks().get(key)?.verified);
  const entry = draftChecks().get(key);
  draftChecks().delete(key);
  draftChecks().set(key, { verified: { ...entry?.verified, ...verified }, at: Date.now(), ...(entry?.saved && { saved: entry.saved }) });
  if (entry?.saved) adoptChecks(entry.saved, recipe, verified);
  return { ok: allPassed(checks), engines: checks, ready: engines.filter((e) => !!verified[e]?.plan) };
}

export interface DraftSave {
  name: string;
  title: string;
  description: string;
  whenToUse?: string;
  body: string;
  icon?: string;
  recipe: unknown;
}

/**
 * Save a draft as a user skill: SKILL.md (createSkill) with its recipe.json (saveRecipe), once its plan passes on an
 * engine (checked again here: free). The draft's checks of this same recipe come with it; anything else starts unchecked.
 */
export async function saveDraft(input: DraftSave): Promise<RecipeView> {
  const recipe = draftRecipe(input.recipe);
  const engines = recipeEngines(recipe);
  if (!engines.length) throw new SkillError(noEngine(recipe), 422);
  const key = draftKey(recipe);
  const known = draftChecks().get(key)?.verified;
  const { checks, verified } = await checkEngines({ name: input.name, title: input.title }, recipe, "plan", engines, known);
  if (!checks.some((c) => c.plan.ok)) throw new RecipeError([...new Set(checks.flatMap((c) => c.plan.errors))]);
  createSkill({ name: input.name, title: input.title, description: input.description, whenToUse: input.whenToUse, body: input.body, ...(input.icon && { icon: input.icon }) });
  try {
    saveRecipe(input.name, { ...recipe, verified }, { keepVerified: true });
  } catch (e) {
    deleteSkill(input.name);
    throw e;
  }
  draftChecks().delete(key);
  draftChecks().set(key, { verified: { ...known, ...verified }, at: Date.now(), saved: input.name });
  return recipeView(input.name);
}

// ---------------------------------------------------------------------------
// Suggestions, run history, fixes and use (package W6: Fuobe suggests skills and keeps them working)

const DAY_MS = 86_400_000;

/** The settings row that remembers the sweep and the shapes not to suggest (JSON; no migration). The owner's alone. */
const SUGGEST_KEY = "skills.suggestions";

interface SuggestState {
  /** "Don't suggest this": shape ids. */
  dismissed: string[];
  /** "Not now": shape id → when it may come back. */
  later: Record<string, number>;
  /** The last sweep: when, and what it found (before dismissals and saved skills are taken out). */
  swept?: { at: number; list: SkillSuggestion[] };
}

function suggestState(): SuggestState {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(SUGGEST_KEY) as { value: string } | undefined;
  try {
    const v = row ? (JSON.parse(row.value) as Partial<SuggestState>) : {};
    return { dismissed: Array.isArray(v.dismissed) ? v.dismissed.filter((x) => typeof x === "string") : [], later: v.later && typeof v.later === "object" ? v.later : {}, ...(v.swept && { swept: v.swept }) };
  } catch {
    return { dismissed: [], later: {} };
  }
}

function saveSuggestState(s: SuggestState): void {
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SUGGEST_KEY, JSON.stringify(s));
}

/** A shape's id: short, stable, and what dismissals remember. */
const shapeId = (key: string) => crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);

const depList = (v: string | null): string[] => {
  if (!v) return [];
  if (!v.startsWith("[")) return [v];
  try {
    const a = JSON.parse(v) as unknown;
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

/** The rows the sweep reads at most (the newest first). */
const SWEEP_ROWS = 5000;

interface SweepRow {
  id: string;
  feature: string;
  provider: string;
  status: string;
  created_at: number;
  depends_on: string | null;
  request_json: string;
  outputs_json: string;
}

/** Inputs that take a list of files, and those that take one: a result handed on by hand fills them (W2's linkByFile). */
const LIST_INPUTS = ["images", "videos", "audios"] as const;
const ONE_INPUTS = ["endImage", "video", "audio", "audio2", "voiceAudio"] as const;

/**
 * Group the owner's chains of the last SUGGEST_RULE.days days by shape (shapeOf) and keep the shapes made
 * SUGGEST_RULE.runs times or more. Only the owner's own runs count (an account's stay out of the owner's lists), and
 * never a skill's own runs or a helper row. A chain is the rows linked by depends_on, or by a result handed on by hand
 * (its file is another step's input, as the skill builder links them). Only a finished chain counts, and only when it
 * worked: a step that failed or was stopped must have been made again in it (a retry), and its shape and rows are the
 * steps that succeeded, so Make a skill is handed rows the builder can repeat.
 */
export function sweepSuggestions(now = Date.now()): SkillSuggestion[] {
  const rows = db()
    .prepare(
      `SELECT g.id, g.feature, g.provider, g.status, g.created_at, g.depends_on, g.request_json, g.outputs_json FROM generations g
       LEFT JOIN generation_trash t ON t.generation_id = g.id
       WHERE t.deleted_at IS NULL AND g.created_at >= ? AND g.created_at <= ?
         AND json_extract(g.request_json, '$.account') IS NULL AND json_extract(g.request_json, '$.skill') IS NULL
       ORDER BY g.created_at DESC LIMIT ${SWEEP_ROWS}`,
    )
    .all(now - SUGGEST_RULE.days * DAY_MS, now) as SweepRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Chains: rows joined by depends_on (union-find over the window).
  const parent = new Map(rows.map((r) => [r.id, r.id]));
  const find = (id: string): string => {
    let p = parent.get(id)!;
    while (p !== parent.get(p)) p = parent.get(p)!;
    parent.set(id, p);
    return p;
  };
  // Who made each file: a result handed on by hand (Edit, Animate, Use as input) links two steps as a chain slot does.
  const madeBy = new Map<string, SweepRow>();
  for (const r of [...rows].reverse()) {
    try {
      for (const o of JSON.parse(r.outputs_json) as { url?: string }[]) if (o.url && !madeBy.has(o.url)) madeBy.set(o.url, r);
    } catch {
      // A row without readable outputs feeds nothing.
    }
  }
  const nodes = new Map<string, ShapeNode>();
  for (const r of rows) {
    let req: GenerationRequest;
    try {
      req = JSON.parse(r.request_json) as GenerationRequest;
    } catch {
      continue;
    }
    const after = depList(r.depends_on).filter((d) => byId.has(d));
    const slots: string[] = after.map((_, i) => req.chain?.[i]?.slot ?? "images");
    const inputs = (req.inputs ?? {}) as Record<string, unknown>;
    const link = (url: unknown, slot: string) => {
      const src = typeof url === "string" ? madeBy.get(url) : undefined;
      if (!src || src.id === r.id || src.created_at > r.created_at || after.includes(src.id)) return;
      after.push(src.id);
      slots.push(slot);
    };
    for (const k of LIST_INPUTS) if (Array.isArray(inputs[k])) for (const url of inputs[k] as unknown[]) link(url, k);
    for (const k of ONE_INPUTS) link(inputs[k], k);
    for (const d of after) parent.set(find(r.id), find(d));
    nodes.set(r.id, { id: r.id, modelId: currentModelId(req.modelId), op: req.op, feature: req.feature ?? r.feature, after, slots });
  }
  const chains = new Map<string, ShapeNode[]>();
  for (const n of nodes.values()) {
    const root = find(n.id);
    chains.set(root, [...(chains.get(root) ?? []), n]);
  }
  const groups = new Map<string, { labels: string[]; runs: { ids: string[]; last: number; demo: boolean }[] }>();
  const statusOf = (n: ShapeNode) => byId.get(n.id)!.status;
  for (const all of chains.values()) {
    // Still running: it counts once it has finished.
    if (all.some((n) => statusOf(n) === "queued" || statusOf(n) === "running")) continue;
    const chain = all.filter((n) => statusOf(n) === "succeeded");
    const done = (n: ShapeNode) => chain.some((o) => o.modelId === n.modelId && o.op === n.op);
    if (all.some((n) => statusOf(n) !== "succeeded" && !isShapeHelper(n.feature) && !done(n))) continue;
    const shape = shapeOf(chain);
    if (shape.steps < 2) continue;
    const ids = chain.map((n) => n.id);
    const run = { ids, last: Math.max(...ids.map((id) => byId.get(id)!.created_at)), demo: ids.every((id) => byId.get(id)!.provider === "mock") };
    const id = shapeId(shape.key);
    const g = groups.get(id) ?? { labels: shape.labels, runs: [] };
    g.runs.push(run);
    groups.set(id, g);
  }
  return [...groups.entries()]
    .filter(([, g]) => g.runs.length >= SUGGEST_RULE.runs)
    .map(([shape, g]) => {
      const newest = g.runs.reduce((a, b) => (b.last > a.last ? b : a));
      // The newest run's rows, oldest first (as the builder walks them).
      const ids = [...newest.ids].sort((a, b) => byId.get(a)!.created_at - byId.get(b)!.created_at);
      return { shape, labels: g.labels, count: g.runs.length, ids, last: newest.last, demo: g.runs.every((r) => r.demo) };
    })
    .sort((a, b) => b.count - a.count || b.last - a.last);
}

/** The shapes the owner's saved recipe skills already have (a tool recipe has none). */
function savedShapes(): Set<string> {
  const out = new Set<string>();
  for (const s of listSkills()) {
    if (s.source !== "user" || !s.recipe) continue;
    const r = skillRecipe(s.name);
    const shape = r && shapeOfRecipe(r, currentModelId);
    if (shape) out.add(shapeId(shape.key));
  }
  return out;
}

/**
 * The Library's suggestions: the day's sweep (run again at most once a day, when the Library opens, or with `fresh`),
 * without the shapes the owner dismissed or put off, those a saved skill already has, and runs since trashed.
 */
export function skillSuggestions(o: { now?: number; fresh?: boolean } = {}): SkillSuggestion[] {
  const now = o.now ?? Date.now();
  const state = suggestState();
  let list = state.swept?.list;
  if (!list || o.fresh || !(now - state.swept!.at < DAY_MS && state.swept!.at <= now)) {
    list = sweepSuggestions(now);
    // Put-offs that have come back are forgotten.
    const later = Object.fromEntries(Object.entries(state.later).filter(([, until]) => until > now));
    saveSuggestState({ ...state, later, swept: { at: now, list } });
  }
  const saved = savedShapes();
  const dismissed = new Set(state.dismissed);
  const shown = list.filter((s) => !dismissed.has(s.shape) && !((state.later[s.shape] ?? 0) > now) && !saved.has(s.shape));
  if (!shown.length) return [];
  // The newest run's rows must still be there (not trashed since the sweep) for Make a skill to draft from them.
  const ids = shown.flatMap((s) => s.ids);
  const there = new Set(
    (db().prepare(`SELECT g.id FROM generations g LEFT JOIN generation_trash t ON t.generation_id = g.id WHERE t.deleted_at IS NULL AND g.id IN (${ids.map(() => "?").join(", ")})`).all(...ids) as { id: string }[]).map((r) => r.id),
  );
  return shown.filter((s) => s.ids.every((id) => there.has(id)));
}

/** How long "Not now" puts a suggestion off. */
const LATER_MS = 7 * DAY_MS;
const DISMISSED_MAX = 500;

/** "Don't suggest this" (never again) or "Not now" (a week). */
export function dismissSuggestion(shape: string, how: "never" | "later", now = Date.now()): void {
  if (!/^[0-9a-f]{16}$/.test(shape)) throw new SkillError("No such suggestion", 404);
  const state = suggestState();
  if (how === "never") state.dismissed = [...state.dismissed.filter((s) => s !== shape), shape].slice(-DISMISSED_MAX);
  else state.later = { ...state.later, [shape]: now + LATER_MS };
  saveSuggestState(state);
}

interface HistoryRow {
  id: string;
  batch_id: string | null;
  status: string;
  cost_usd: number | null;
  favorite: number;
  created_at: number;
  provider: string;
  engine: string;
  error: string | null;
  model: string | null;
  run: string | null;
  /** The recipe step that made the row (older rows have none). */
  step: string | null;
}

/** The owner's runs of a skill (its stamp in request_json), newest first; a skill's own dry runs don't count. */
function historyRows(name: string, limit = 2000): HistoryRow[] {
  return db()
    .prepare(
      `SELECT g.id, g.batch_id, g.status, g.cost_usd, g.favorite, g.created_at, g.provider, g.engine, g.error,
              json_extract(g.request_json, '$.modelId') AS model, json_extract(g.request_json, '$.skill.run') AS run,
              json_extract(g.request_json, '$.skill.step') AS step
       FROM generations g
       WHERE json_extract(g.request_json, '$.skill.name') = ? AND g.feature != ? AND json_extract(g.request_json, '$.account') IS NULL
       ORDER BY g.created_at DESC LIMIT ?`,
    )
    .all(name, SKILL_CHECK_FEATURE, limit) as HistoryRow[];
}

/** Rows grouped into runs (by the run stamp), newest first. */
function runsOf(rows: HistoryRow[]): { run: string; rows: HistoryRow[] }[] {
  const runs = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    const key = r.run ?? r.batch_id ?? r.id;
    runs.set(key, [...(runs.get(key) ?? []), r]);
  }
  return [...runs.entries()].map(([run, list]) => ({ run, rows: list })).sort((a, b) => Math.max(...b.rows.map((r) => r.created_at)) - Math.max(...a.rows.map((r) => r.created_at)));
}

function runRecord(run: string, rows: HistoryRow[]): SkillRunRecord {
  const statuses = rows.map((r) => r.status);
  const status: SkillRunRecord["status"] = statuses.some((s) => s === "queued" || s === "running")
    ? "running"
    : statuses.includes("failed")
      ? "failed"
      : statuses.includes("canceled")
        ? "canceled"
        : "succeeded";
  const demo = rows.every((r) => r.provider === "mock");
  const known = rows.filter((r) => r.cost_usd !== null);
  const free = demo || rows.every((r) => r.engine === "open");
  const error = rows.find((r) => r.status === "failed")?.error ?? undefined;
  return {
    run,
    batchId: rows.find((r) => r.batch_id)?.batch_id ?? null,
    status,
    costUsd: free ? 0 : known.length ? Math.round(known.reduce((s, r) => s + (r.cost_usd ?? 0), 0) * 1000) / 1000 : null,
    createdAt: Math.min(...rows.map((r) => r.created_at)),
    steps: rows.length,
    favorite: rows.some((r) => r.favorite === 1),
    demo,
    ...(error && { error }),
  };
}

/** A skill's run history: runs, success rate, spend, last run, favourites and the newest `limit` runs. */
export function skillHistory(name: string, limit = 10): SkillHistory {
  if (!getSkill(name)) throw new SkillError("No such skill", 404);
  const runs = runsOf(historyRows(name)).map((r) => runRecord(r.run, r.rows));
  const finished = runs.filter((r) => r.status === "succeeded" || r.status === "failed");
  return {
    runs: runs.length,
    successRate: finished.length ? Math.round((finished.filter((r) => r.status === "succeeded").length / finished.length) * 100) / 100 : null,
    spentUsd: Math.round(runs.reduce((s, r) => s + (r.costUsd ?? 0), 0) * 1000) / 1000,
    lastRun: runs[0]?.createdAt ?? null,
    favorites: runs.filter((r) => r.favorite).length,
    recent: runs.slice(0, limit),
  };
}


/** Candidates considered for one step at most, and shown. */
const FIX_CONSIDER = 16;
const FIX_SHOW = 6;

/**
 * A recipe with one step's model swapped. A step kept on one engine (for what only that engine does) stays there when
 * the new model also runs on both; otherwise its engine is left to the new model.
 */
function withModel(recipe: Recipe, key: string, modelId: string): Recipe {
  const next = getModel(modelId);
  return {
    ...recipe,
    steps: recipe.steps.map((s) => {
      if (s.kind !== "generate" || s.key !== key) return s;
      const request: Record<string, unknown> = { ...s.request, modelId };
      const pinned = s.request.engine;
      if (!(pinned && dualEngine(next) && next!.engines!.includes(pinned))) delete request.engine;
      return { ...s, request: request as typeof s.request };
    }),
  };
}

/** A waiting step's failure that an earlier step caused (advanceDependents: waitedOnFailure, or an input that fell short). */
const UPSTREAM = waitedOnFailure().replace(/ didn't finish$/, " ");
const upstreamFailure = (error: string | null) => !!error && (error === waitedOnFailure() || error.startsWith(UPSTREAM));

/** Why a step needs a fix: it failed in 2 of the last 5 runs, it was moved by REPLACED_BY, or it's switched off. */
function stepTrouble(s: Recipe["steps"][number], lastRuns: { rows: HistoryRow[] }[]): { why: string; failing?: boolean } | null {
  if (s.kind !== "generate") return null;
  const r = replacedBy(s.request.modelId);
  if (r) return { why: `${r.was} was replaced by ${getModel(r.id)?.name ?? r.id}` };
  const id = currentModelId(s.request.modelId);
  const m = getModel(id);
  if (!m) return { why: `Fuobe has no model “${s.request.modelId}” anymore` };
  const engines = dualEngine(m) ? (s.request.engine ? [s.request.engine] : (m.engines ?? ENGINES)) : [undefined];
  if (!engines.some((e) => isOffered(id, e))) return { why: `${m.name} is switched off in Settings → Models & licences` };
  // A step's own failure only: a step failed by what an earlier one did ("An earlier step didn't finish", or made too
  // little) never ran, so it isn't blamed. A row says which step made it; an older row without that is matched by model.
  const ownFailure = (row: HistoryRow) =>
    row.status === "failed" && !upstreamFailure(row.error) && (row.step !== null ? row.step === s.key : row.model !== null && currentModelId(row.model) === id);
  const failed = lastRuns.filter((run) => run.rows.some(ownFailure)).length;
  if (failed >= 2) return { why: `${m.name} failed in ${failed} of the last ${lastRuns.length} runs`, failing: true };
  return null;
}

/**
 * The steps of a saved skill that need a fix, each with the models that could take its place: the same operation and
 * kind, switched on (search_models' list), each priced as the whole run would be with it. Nothing is swapped here.
 */
export function stepFixes(name: string): StepFix[] {
  const { recipe } = getRecipe(name);
  const lastRuns = runsOf(historyRows(name, 400))
    .slice(0, 5)
    .filter((r) => r.rows.every((x) => x.status !== "queued" && x.status !== "running"));
  const mode = engineMode();
  const out: StepFix[] = [];
  for (const s of recipe.steps) {
    if (s.kind !== "generate") continue;
    const trouble = stepTrouble(s, lastRuns);
    if (!trouble) continue;
    const { why, failing } = trouble;
    const was = getModel(s.request.modelId);
    const id = currentModelId(s.request.modelId);
    const m = getModel(id) ?? was;
    const op = (typeof s.request.op === "string" ? s.request.op : m?.routes[0]?.op) as Operation | undefined;
    const replaced = id !== s.request.modelId;
    const candidates: FixCandidate[] = [];
    if (m && op) {
      const pool = offeredModels(modelsFor({ kind: m.kind, ops: [op], engine: mode === "both" ? "all" : mode })).filter((c) => (replaced ? true : c.id !== id) && c.id !== s.request.modelId);
      // What replaced it first (a re-check's own fix), then the catalog's order.
      pool.sort((a, b) => Number(b.id === id) - Number(a.id === id));
      for (const c of pool.slice(0, FIX_CONSIDER)) {
        const next = withModel(recipe, s.key, c.id);
        const engines = recipeEngines(next);
        let found: FixCandidate | null = null;
        for (const e of engines) {
          try {
            const plan = planCheck(compileRun({ name, title: "Check" }, next, valuesForCheck(next), e, { run: "check" }), e);
            if (plan.errors.length) continue;
            const demo = plan.jobs.length > 0 && plan.jobs.every((j) => j.demo);
            found = { modelId: c.id, name: c.name, engine: e, total: plan.total, free: e === "open" || plan.total === 0, demo };
            break;
          } catch {
            continue;
          }
        }
        if (found) candidates.push(found);
        if (candidates.length >= FIX_SHOW) break;
      }
    }
    out.push({ key: s.key, label: s.label ?? (op ? (OPERATION_LABELS[op] ?? op) : s.key), modelId: s.request.modelId, modelName: was?.name ?? m?.name ?? s.request.modelId, why, ...(failing && { failing }), candidates });
  }
  return out;
}

/**
 * Put the picked model in a step that needs a fix, after W1's checks pass with it (the plan, then the free dry run) on
 * an engine: then it is saved with what passed. Only a candidate stepFixes offers is taken; nothing changes otherwise.
 */
export async function applyFix(name: string, key: string, modelId: string): Promise<VerifyResult> {
  const found = getRecipe(name);
  if (found.skill.source === "builtin") throw new SkillError("Built-in skills can't be changed — Duplicate it first, then change your copy", 403);
  const fix = stepFixes(name).find((f) => f.key === key);
  if (!fix) throw new SkillError(`Step “${key}” doesn't need a fix`, 409);
  if (!fix.candidates.some((c) => c.modelId === modelId)) throw new SkillError("Pick one of the models offered for this step", 422);
  const next = withModel(found.recipe, key, modelId);
  const problems = allProblems(next);
  if (problems.length) throw new RecipeError(problems);
  const engines = recipeEngines(next);
  if (!engines.length) throw new SkillError(noEngine(next), 422);
  const { checks, verified } = await checkEngines(found.skill, next, "demo", engines, {});
  const passed = checks.filter((c) => c.plan.ok && (c.dryRun?.ok ?? true));
  if (!passed.length) throw new RecipeError([...new Set(checks.flatMap((c) => [...c.plan.errors, ...(c.dryRun?.problems ?? [])]))].slice(0, 6));
  if (!sameRecipe(getRecipe(name).recipe, found.recipe)) throw new SkillError("The recipe changed while it was being checked — try again", 409);
  saveRecipe(name, { ...next, verified }, { keepVerified: true });
  return { ok: allPassed(checks), engines: checks, view: recipeView(name) };
}
