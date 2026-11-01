import "server-only";
import { z } from "zod";
import type { PlannedJob } from "@/lib/assist";
import type { Engine } from "@/lib/catalog/types";
import { RECIPE_LIMITS, type ParamType, type Recipe } from "@/lib/recipe";
import { estimateRecipe, getRecipe, recipeEngines, runRecipe, verifyRecipe } from "../recipes";
import { getSkill, skillRecipe } from "../skills";
import { canUseSkill, skillsFor } from "./context";
import { defineTool, type ToolContext } from "./define";

/**
 * run_skill (package W3): a saved skill whose files hold a recipe runs by itself with values for its inputs — the
 * same steps, priced first, no planning. Gated like generate, so Assist shows one priced card (an atomic pipeline,
 * or a studio's tool call that opens in its studio), MCP lists it and estimate_job prices it.
 */

const Value = z.union([z.string(), z.number()]);
const Values = z.record(z.string(), Value);

const RunSkillInput = z.object({
  name: z.string().describe("The skill's name, without the slash (e.g. lamp-turntable). Only skills marked “runs by itself” have a recipe."),
  values: Values.optional().describe("A value for each of the skill's inputs, by input id: file URLs (/api/files/… from the chat) for image, video and audio inputs, words for text, a number, one of a choice's options, an @handle for an element. Inputs left out take their default."),
  rows: z
    .array(Values)
    .max(RECIPE_LIMITS.rows)
    .optional()
    .describe(`Several runs at once (up to ${RECIPE_LIMITS.rows}), each with its own values, instead of values.`),
  engine: z.enum(["cloud", "open"]).optional().describe("Where to run it: cloud (paid APIs) or open (the user's GPU). Leave it out to use the chat's engine when the skill runs there."),
});
type RunSkill = z.infer<typeof RunSkillInput>;

const ENGINE_WORDS: Record<Engine, string> = { cloud: "the cloud", open: "your GPU" };
const TYPE_WORDS: Record<ParamType, string> = { image: "image", video: "video", audio: "audio", text: "text", number: "number", choice: "choice", element: "@element" };

/** "product (image) and name (text)": what a skill's inputs are, for an error the model can fix. */
export function inputList(recipe: Pick<Recipe, "params">, only?: (id: string) => boolean): string {
  const list = recipe.params.filter((p) => !only || only(p.id)).map((p) => `${p.id} (${p.type === "choice" ? (p.options ?? []).join(" | ") : TYPE_WORDS[p.type]})`);
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : (list[0] ?? "nothing");
}

/** The skill to run, when this chat (or MCP, which has every enabled skill) may use it; else why not, with the ones that run. */
function find(name: string, ctx: ToolContext): { recipe: Recipe; title: string; name: string } | { error: string } {
  const n = name.replace(/^\//, "").trim();
  const projectId = ctx.thread?.projectId ?? null;
  const runnable = () =>
    skillsFor(projectId)
      .filter((s) => s.recipe)
      .map((s) => s.name);
  const s = getSkill(n);
  if (!s || !canUseSkill(n, projectId)) return { error: `No skill called “${n}” is available here. Skills that run by themselves: ${runnable().join(", ") || "none yet"}.` };
  const recipe = s.recipe ? skillRecipe(n) : null;
  if (!recipe) return { error: `/${n} has no recipe, so it doesn't run by itself: load it with load_skill and follow it instead. Skills that run by themselves: ${runnable().join(", ") || "none yet"}.` };
  return { recipe, title: s.title, name: n };
}

/** The engine to ask for: the call's, else the chat's when the skill runs there (else the skill picks). */
function engineOf(input: RunSkill, recipe: Recipe, ctx: ToolContext): Engine | undefined {
  if (input.engine) return input.engine;
  return recipeEngines(recipe).includes(ctx.engine) ? ctx.engine : undefined;
}

/** What's wrong with the values, naming the inputs: "needs product (image) and name (text)". */
function valueErrors(input: RunSkill, recipe: Recipe, name: string): string | null {
  const rows = input.rows ?? [input.values ?? {}];
  const known = new Set(recipe.params.map((p) => p.id));
  const unknown = [...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => !known.has(k))))];
  if (unknown.length) return `/${name} has no input ${unknown.map((k) => `“${k}”`).join(", ")}: it takes ${inputList(recipe)}`;
  const missing = recipe.params.filter((p) => p.required && p.default === undefined && rows.some((r) => r[p.id] === undefined || (typeof r[p.id] === "string" && !String(r[p.id]).trim())));
  if (missing.length) return `/${name} needs ${inputList(recipe, (id) => missing.some((p) => p.id === id))}`;
  return null;
}

/** The skill's price as the card shows it: every job of every run, atomic when it's a pipeline. */
function plan(input: RunSkill, ctx: ToolContext): PlannedJob[] {
  const found = find(input.name, ctx);
  const failed = (error: string): PlannedJob[] => [
    { tool: "run_skill", modelId: "skill", modelName: "title" in found ? found.title : input.name, kind: "image", op: "t2i", note: "Run a skill", prompt: "", count: 1, costUsd: null, demo: false, error },
  ];
  if ("error" in found) return failed(found.error);
  const bad = valueErrors(input, found.recipe, found.name);
  if (bad) return failed(bad);
  try {
    const est = estimateRecipe(found.name, { ...(input.rows ? { rows: input.rows } : { values: input.values ?? {} }) }, engineOf(input, found.recipe, ctx));
    const pipeline = found.recipe.steps.every((s) => s.kind === "generate");
    const jobs = est.runs.flatMap((r) => r.jobs.map((j) => ({ ...j, tool: "run_skill", ...(pipeline && { atomic: true }) })));
    const errors = [...est.errors, ...est.runs.flatMap((r) => r.errors.map((e) => (est.runs.length > 1 ? `Row ${r.line}: ${e}` : e)))];
    if (!jobs.length) return failed(errors[0] ?? "Nothing to run");
    // What stops it is said once, on the first job (a job's own error stays on it).
    return errors.length && !jobs.some((j) => j.error) ? [{ ...jobs[0], error: errors.join("; ") }, ...jobs.slice(1)] : jobs;
  } catch (e) {
    return failed((e as Error).message);
  }
}

const runSkill = defineTool({
  name: "run_skill",
  description:
    "Run a saved skill that runs by itself (the skills list marks them “runs by itself” and names their inputs): the same steps it was saved with, with new values for its inputs — no planning needed. When a skill like that fits the request, call this with values from the user's message and attachments instead of planning the steps again. Gated by the same approval card as generate.",
  schema: RunSkillInput,
  gated: true,
  // Values that don't fit go back to the model as an error naming the inputs, not onto an approval card.
  check: (input, ctx) => {
    const found = find(input.name, ctx);
    return "error" in found ? found.error : valueErrors(input, found.recipe, found.name);
  },
  plan,
  title: (input) => getSkill(input.name.replace(/^\//, "").trim())?.title ?? input.name,
  place: (input, ctx) => {
    const found = find(input.name, ctx);
    if ("error" in found || found.recipe.steps.every((s) => s.kind === "generate")) return {};
    try {
      return estimateRecipe(found.name, { values: input.rows?.[0] ?? input.values ?? {} }, engineOf(input, found.recipe, ctx)).place ?? {};
    } catch {
      return {};
    }
  },
  async run(input, ctx) {
    const found = find(input.name, ctx);
    if ("error" in found) return { content: JSON.stringify({ error: found.error }), isError: true };
    const bad = valueErrors(input, found.recipe, found.name);
    if (bad) return { content: JSON.stringify({ error: bad }), isError: true };
    const asked = engineOf(input, found.recipe, ctx);
    const body = input.rows ? { rows: input.rows } : { values: input.values ?? {} };
    // A recipe not yet priced on this engine gets its free plan check first (a saved draft has had it already).
    const { recipe, skill } = getRecipe(found.name);
    const engine = asked ?? recipeEngines(recipe)[0];
    if (engine && !recipe.verified?.[engine]?.plan && skill.source === "user") {
      const check = await verifyRecipe(found.name, "plan", engine).catch((e: Error) => ({ ok: false, why: e.message }));
      if (!check.ok) return { content: JSON.stringify({ error: `/${found.name} doesn't run on ${ENGINE_WORDS[engine]} as it is: check it on the Skills page` }), isError: true };
    }
    const out = await runRecipe(found.name, body, asked);
    const ids = out.runs.flatMap((r) => r.ids);
    const href = out.runs.find((r) => r.href && r.href !== "/library")?.href;
    return {
      content: JSON.stringify({
        skill: found.name,
        engine: out.engine,
        runs: out.runs.map((r) => ({ started: r.ids, ...(r.batchId && { batch: r.batchId }), ...(r.href && { href: r.href }), ...(r.error && { error: r.error }) })),
        ...(out.demo && { demo: true }),
        note: href ? "The skill's studio job opens at href; its results appear there and in the Library." : "Each run's steps start by themselves as the ones they wait for finish; results appear in the Library.",
      }),
      items: ids.length ? [{ id: "", role: "generations", ids }] : undefined,
    };
  },
});

export const SKILL_TOOLS = [runSkill];
