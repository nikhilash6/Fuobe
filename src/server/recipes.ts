import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { planRunnable, totalCost, type PlannedJob } from "@/lib/assist";
import { getModel } from "@/lib/catalog";
import { dualEngine } from "@/lib/catalog/engines";
import { currentModelId, replacedBy } from "@/lib/catalog/replaced";
import type { ChainSlot, Engine, Generation, GenerationRequest, MediaKind } from "@/lib/catalog/types";
import { probeMedia, type MediaInfo } from "@/lib/media-probe";
import { studioForTool } from "@/lib/recipe-builder";
import {
  checkOutputs,
  checkValues,
  compile,
  exampleValues,
  fieldKind,
  stepRefs,
  type CompiledStep,
  type GenerateStep,
  type RecipeStep,
  isMediaRef,
  isMediaType,
  parseRecipe,
  parseRows,
  RECIPE_FILE,
  RECIPE_LIMITS,
  recipeProblems,
  RecipeSchema,
  SKILL_CHECK_FEATURE,
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
} from "@/lib/recipe";
import type { Skill } from "@/lib/assist";
import { planSteps } from "./assist/studio-tools";
import { executeTool, getTool, planFor, validateInput } from "./assist/tools";
import { createPipeline } from "./chains";
import { llmSeesImages, llmText } from "./enhance";
import { cancelGeneration, createGenerations, currentRequest, getGeneration, previewChained, stampRequests } from "./generations";
import { trashGenerations } from "./library";
import { isOffered, modelLicence } from "./model-access";
import { GenerationRequestSchema } from "./request-schema";
import { db } from "./db";
import { engineMode } from "./settings";
import { createSkill, deleteSkill, getSkill, setSkillFile, skillFile, SkillError } from "./skills";
import { beginSkillRun, stagedDryRun } from "./skill-runs";
import { runAsDemo } from "./demo-scope";
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
    compileRun({ name: "check", title: "Test run" }, recipe, valuesForCheck(recipe), "cloud", { run: "check" });
  } catch (e) {
    out.push((e as Error).message);
  }
  return out;
}

/** What a studio tool's step makes, for a later step that takes its result (W7). */
const TOOL_KINDS: Record<string, MediaKind> = {
  dub_video: "video",
  add_captions: "video",
  restore_video: "video",
  restyle_footage: "video",
  faceless_episode: "video",
  blockout_film: "video",
  katana: "video",
  split_layers: "image",
  create_ads: "image",
};

/** What each step makes (its model's kind, or its studio's), so a step reference is checked against its field. */
function stepKinds(recipe: Recipe): Record<string, MediaKind | undefined> {
  return Object.fromEntries(recipe.steps.map((s) => [s.key, s.kind === "tool" ? TOOL_KINDS[s.tool] : getModel(currentModelId(s.request.modelId))?.kind]));
}

/** Everything that keeps a recipe from being saved: its shape (recipeProblems), then the catalog and the API's limits. */
export function allProblems(recipe: Recipe): string[] {
  const own = recipeProblems(recipe, { kinds: stepKinds(recipe) });
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

/** One generate step as the API takes it (shape and limits checked), an Original put on the run's engine. */
export function apiStep(s: CompiledStep, engine: Engine): CompiledStep {
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
}

/**
 * A run in stages with a stand-in for each step reference (W7): a file of the kind its field takes (a link to price
 * with; a real small file when the run will read it, `files`), or a few words in a prompt. What a check and a price use.
 */
export function withStandIns<T>(v: T, files = false, path: (string | number)[] = []): T {
  if (typeof v === "string") {
    if (!stepRefs(v).size) return v;
    const kind = fieldKind(path);
    if (kind === "image" || kind === "video" || kind === "audio") return (files ? standIn(kind) : PRICE_STAND_IN[kind]) as T;
    return v.replace(/\{\{\s*steps\.[^}]+\}\}/g, "the earlier step's words") as T;
  }
  if (Array.isArray(v)) return v.map((x, i) => withStandIns(x, files, [...path, i])) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withStandIns(x, files, [...path, k])])) as T;
  return v;
}

/** Validate and compile one run: each filled request as the API takes it, an Original put on the run's engine. */
function compileRun(skill: { name: string; title: string }, recipe: Recipe, values: RecipeValues, engine: Engine, o: { run: string; demo?: boolean }): Compiled {
  const c = compile(recipe, values, { skill: skill.name, run: o.run, title: skill.title, demo: o.demo });
  if (c.kind === "tool") {
    const error = validateInput(c.tool, c.input);
    if (error) throw new SkillError(`Step “${c.key}”: ${error.replace(/^Invalid input: /, "")}`, 422);
    return c;
  }
  if (c.kind === "staged") {
    // Each step is checked with stand-ins for the results it waits for; the run keeps the references.
    for (const s of c.steps) {
      if (s.kind === "tool") {
        const error = validateInput(s.tool, withStandIns(s.input));
        if (error) throw new SkillError(`Step “${s.key}”: ${error.replace(/^Invalid input: /, "")}`, 422);
      } else apiStep({ key: s.key, request: withStandIns(s.request) as GenerationRequest, ...(s.chain && { chain: s.chain as ChainSlot[] }) }, engine);
    }
    return c;
  }
  return { ...c, steps: c.steps.map((s) => apiStep(s, engine)) };
}

/**
 * A run in stages as parts that start on their own (W7): each studio step alone, and generate steps joined by `after`
 * as one createPipeline. A part waits for the steps its members take results from.
 */
export function stagedParts(steps: RecipeStep[]): { id: string; keys: string[]; waits: string[] }[] {
  const parent = new Map(steps.map((s) => [s.key, s.key]));
  const root = (k: string): string => (parent.get(k) === k ? k : root(parent.get(k)!));
  for (const s of steps) if (s.kind === "generate") for (const a of typeof s.after === "string" ? [s.after] : (s.after ?? [])) if (parent.has(a)) parent.set(root(s.key), root(a));
  const parts = new Map<string, string[]>();
  for (const s of steps) parts.set(root(s.key), [...(parts.get(root(s.key)) ?? []), s.key]);
  return [...parts.entries()].map(([id, keys]) => ({ id, keys, waits: [...new Set(steps.filter((s) => keys.includes(s.key)).flatMap((s) => [...stepRefs(s.kind === "tool" ? s.input : s.request)]))].filter((k) => !keys.includes(k)) }));
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

/** Units priced by the input's length or size (a step reference's stand-in has neither, so its price is a guess). */
const SIZED_UNITS = new Set(["second", "minute", "megapixel"]);

/** A job of a part that waits for earlier results, marked `estimate` when its price depends on those results' length or size. */
function guessed(j: PlannedJob, fixedLength: boolean): PlannedJob {
  const unit = getModel(j.modelId)?.pricing?.unit;
  if (!unit || !SIZED_UNITS.has(unit) || (fixedLength && unit !== "megapixel")) return j;
  return { ...j, estimate: true };
}

/** Price one compiled run the way it would start (planSteps / planFor), with what stops it. */
function planRun(c: Compiled, engine: Engine): RunPlan {
  if (c.kind === "staged") {
    // Each part priced on its own, with stand-ins for the results it waits for; studio steps open in their studios.
    const jobs: PlannedJob[] = [];
    const errors: string[] = [];
    let place: RecipePlace | undefined;
    let connect = true;
    for (const part of stagedParts(c.steps)) {
      const members = c.steps.filter((s) => part.keys.includes(s.key));
      const tool = members.find((s) => s.kind === "tool");
      if (tool && tool.kind === "tool") {
        const sub = planRun({ kind: "tool", key: tool.key, tool: tool.tool, input: withStandIns(tool.input), checks: {} }, engine);
        jobs.push(...sub.jobs.map((j) => ({ ...(part.waits.length ? guessed(j, false) : j), note: tool.label ?? j.note })));
        errors.push(...sub.errors);
        connect &&= !sub.errors.length || onlyConnect(sub.errors);
        place ??= sub.place;
        continue;
      }
      const sub = planRun({ kind: "pipeline", checks: {}, steps: members.map((s) => apiStep({ key: s.key, request: withStandIns((s as GenerateStep).request) as GenerationRequest, ...((s as GenerateStep).after !== undefined && { after: (s as GenerateStep).after }), ...((s as GenerateStep).chain && { chain: (s as GenerateStep).chain as ChainSlot[] }) }, engine)) }, engine);
      // A step that sets its own length (params.duration) is priced for it; one that takes it from an earlier result is a guess.
      const fixed = (i: number) => (members[i] as GenerateStep | undefined)?.request.params?.duration !== undefined;
      jobs.push(...(part.waits.length ? sub.jobs.map((j, i) => guessed(j, fixed(i))) : sub.jobs));
      errors.push(...sub.errors);
      connect &&= !sub.errors.length || !!sub.connectOnly;
    }
    return { jobs, total: totalCost(jobs), errors: [...new Set(errors)], ...(place && { place }), connectOnly: errors.length > 0 && connect };
  }
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
  if (c.kind === "tool") return c;
  if (c.kind === "staged") return { ...c, steps: c.steps.map((s) => (s.kind === "generate" ? { ...s, request: { ...s.request, demo: true } } : s)) };
  return { ...c, steps: c.steps.map((s) => ({ ...s, request: { ...s.request, demo: true } })) };
}

/**
 * The plan check: the run as it would start. When the only thing stopping it is a provider to connect (with Settings →
 * Demo mode off), the recipe itself is fine: the same run on the demo provider passes it, and the reason is a note.
 * Any other refusal (a route's image limit, a LoRA a route can't carry…) fails the check: the demo route skips those.
 */
function planCheck(c: Compiled, engine: Engine): RunPlan & { notes: string[] } {
  const plan = planRun(c, engine);
  if (!plan.errors.length || c.kind === "tool" || !plan.connectOnly) return { ...plan, notes: [] };
  // A run in stages: its studio steps are planned as demos too (runAsDemo), as its dry run runs them.
  const demo = c.kind === "staged" ? runAsDemo(() => planRun(asDemo(c), engine)) : planRun(asDemo(c), engine);
  return demo.errors.length ? { ...plan, notes: [] } : { ...demo, notes: [...new Set(plan.jobs.flatMap((j) => (j.error ? [j.error] : [])))] };
}

/**
 * Each generate step of a recipe priced on an engine with the check's values (the examples, or stand-ins): its model,
 * operation, kind and price, as a run would plan it. Null for a tool recipe or one that doesn't compile.
 */
export function stepPlans(recipe: Recipe, engine: Engine): { key: string; job: PlannedJob }[] | null {
  try {
    const c = compileRun({ name: "check", title: "Check" }, recipe, valuesForCheck(recipe), engine, { run: "check" });
    if (c.kind !== "pipeline") return null;
    const plan = planCheck(c, engine);
    return c.steps.map((s, i) => ({ key: s.key, job: plan.jobs[i] }));
  } catch {
    return null;
  }
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
      : c.kind === "staged"
        ? c.steps.map((s) =>
            s.kind === "tool"
              ? [s.tool, ...planFor(s.tool, withStandIns(s.input), { engine }).jobs.map((j) => [j.modelId, j.op, getModel(j.modelId)?.pricing ?? null])]
              : (() => {
                  const p = previewChained({ ...(withStandIns(s.request) as GenerationRequest), ...(s.chain && { chain: s.chain as ChainSlot[] }) }, asList(s.after).length);
                  return [p.model.id, p.op, p.route.provider, p.route.endpoint, p.model.pricing ?? null];
                })(),
          )
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
export function standIn(kind: "image" | "video" | "audio"): string {
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
    ...(recipe.source?.demo && madeRealResult(skill.name) && { madeReal: true as const }),
    models: [...new Map(models.map((x) => [`${x.engine}:${x.name}`, x])).values()],
  };
}

/**
 * Whether a skill has made a real result: one of its runs (its steps share `request.skill.run`, else a batch) whose
 * every step succeeded and none was a placeholder. A free test run's steps are placeholders, so they never count.
 * Only the owner's runs count (an account's stay out of the owner's skills).
 */
export function madeRealResult(name: string): boolean {
  return !!db()
    .prepare(
      `SELECT 1 FROM generations WHERE json_valid(request_json) AND json_extract(request_json, '$.skill.name') = ? AND json_extract(request_json, '$.account') IS NULL
       GROUP BY COALESCE(json_extract(request_json, '$.skill.run'), batch_id, id)
       HAVING SUM(status != 'succeeded') = 0 AND SUM(provider = 'mock') = 0 LIMIT 1`,
    )
    .get(name);
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
        const c = compileRun({ name: "check", title: "Test run" }, recipe, valuesForCheck(recipe), e, { run: "check" });
        const plan = planCheck(c, e);
        if (plan.errors.length) reasons.push(plan.errors[0]);
        else if (v.catalog && planHash(c, e) !== v.catalog) reasons.push("The models, routes or prices it uses changed since its last test run");
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
  if (!recipe.verified?.[engine]?.plan) throw new SkillError(`Give this skill a free test run on ${ENGINE_NAME[engine]} first — nothing runs for real`, 409);
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
    return { run, c, values: r.values! };
  });
  const runs: RecipeRun[] = [];
  let demo = true;
  if (compiled[0].c.kind === "staged") {
    // A run in stages: each row's steps start as the ones they wait for finish (src/server/skill-runs.ts).
    for (const { run, c, values } of compiled) {
      if (c.kind !== "staged") continue;
      const started = await beginSkillRun({ id: run, skill: skill.name, title: skill.title, engine, values, steps: c.steps });
      demo &&= started.ids.every((id) => getGeneration(id)?.provider === "mock");
      runs.push({ batchId: run, ids: started.ids, ...(started.href && { href: started.href }), skillRun: run, waiting: started.waiting, ...(started.error && { error: started.error }) });
    }
    if (!runs.some((r) => !r.error)) throw new SkillError(runs[0]?.error ?? "Nothing could start", 422);
    return { engine, runs, demo };
  }
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
  // A run in stages: its studio steps run as demos (runAsDemo), each when the steps before are done; then every record a
  // studio made for it (a dub session, a Layers project…) is deleted and its rows go to the Trash.
  if (c.kind === "staged") return stagedDryRun(skill, c.steps, engine, valuesForCheck(recipe, true), DRY_RUN_MS);
  // A studio step would make a record the user sees (a demo dub, a Layers project): its plan is its check in W1.
  if (c.kind === "tool") return { ok: true, problems: [], skipped: `A ${studioForTool(c.tool) ?? "studio"} step is priced only, not test-run` };
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
  // A run in stages is checked by its plan and its dry run; a real test of one isn't offered yet.
  if (c.kind === "staged") return { ok: true, problems: [], notes: ["A real test of a skill whose steps wait across studios isn't offered yet: its price and its placeholder run test it"], demo: false };
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
  if (demo) notes.push(`It ran with placeholder results on ${ENGINE_NAME[engine]} (placeholders are on in Settings): turn placeholders off in Settings for a real test`);
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
  if (skill.source === "builtin") throw new SkillError("Built-in skills can't be changed — Duplicate it first, then test your copy", 403);
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
  if (!sameRecipe(now, found.recipe)) throw new SkillError("The recipe changed during its test run: test it again", 409);
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
 * Check a draft's recipe before it is saved (the review screen's Test run): `plan` prices it on each engine its steps
 * allow (free, quick); `demo` adds the free dry run on the demo provider. What passed is kept for the save; a draft saved
 * while its dry run was going gets the result when it ends.
 */
export async function checkDraft(input: unknown, level: "plan" | "demo", title = "Skill test run"): Promise<DraftCheck> {
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
