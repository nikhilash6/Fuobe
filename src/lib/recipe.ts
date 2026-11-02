/**
 * Skill recipes (`recipe.json`): the part of a user skill Fuobe runs by itself, with new inputs and no LLM
 * (docs/research/work2skill-7.md §9, package W1). `SKILL.md` stays the playbook people and agents read; a skill
 * "runs by itself" when its files hold a valid `recipe.json`.
 *
 * A recipe has typed inputs (`params`) and either a graph of generate steps (one `createPipeline`) or one call of a
 * gated Assist tool (`dub_video`, `add_captions`…). A string that is exactly `"{{id}}"` takes the input with its type;
 * `{{id}}` inside a longer string inserts its text. Unknown or unused placeholders are refused when the recipe is
 * saved (`recipeProblems`), never at run time. Step outputs travel only through `after` and `chain`, exactly as
 * createPipeline takes them.
 *
 * Pure and browser-safe: the Run form validates a row and parses a CSV with it, the server compiles the requests
 * (src/server/recipes.ts). Nothing here reads the catalog: the server checks models, prices and engines.
 */
import { z } from "zod";
import type { PlannedJob } from "./assist";
import type { ChainSlot, GenerationRequest, MediaKind, OutputFile } from "./catalog/types";
import type { MediaInfo } from "./media-probe";

export const RECIPE_FILE = "recipe.json";

/** Sane caps (a guess, W1): a form of 12 fields and a graph of 24 steps; rows as a Canvas table (TABLE_LIMITS.rows). */
export const RECIPE_LIMITS = { params: 12, steps: 24, rows: 50, text: 2000, options: 24 } as const;

export const PARAM_TYPES = ["image", "video", "audio", "text", "number", "choice", "element"] as const;
export type ParamType = (typeof PARAM_TYPES)[number];
export const MEDIA_TYPES: readonly ParamType[] = ["image", "video", "audio"];
export const isMediaType = (t: ParamType): t is "image" | "video" | "audio" => MEDIA_TYPES.includes(t);

const PARAM_ID = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const STEP_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
/** A placeholder anywhere in a string, and a string that is exactly one. */
const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
/**
 * A step reference (recipe version 2): `{{steps.<key>.output}}`, the first output of that earlier step of the kind the
 * field takes. It isn't an input: filling a recipe leaves it for the runner, which puts in the file once the step is done.
 */
const STEP_REF = /\{\{\s*steps\.([A-Za-z0-9][A-Za-z0-9_-]{0,39})\.output\s*\}\}/g;
const STEP_REF_EXACT = /^\{\{\s*steps\.([A-Za-z0-9][A-Za-z0-9_-]{0,39})\.output\s*\}\}$/;
/** `{{steps.<key>.output}}` for a step. */
export const stepRef = (key: string) => `{{steps.${key}.output}}`;
/** The step a value refers to when it is exactly one step reference. */
export const stepRefOf = (v: unknown): string | null => (typeof v === "string" ? (STEP_REF_EXACT.exec(v)?.[1] ?? null) : null);
const EXACT = /^\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ELEMENT = /^@[\p{L}\p{N}_-]{1,40}$/u;

/** A media input: a file saved in Fuobe or a public http(s) link (read through remote-fetch.ts). */
export const isMediaRef = (v: string): boolean => /^\/api\/files\/[^\s]+$/.test(v) || /^https?:\/\/[^\s]+$/i.test(v);

const Scalar = z.union([z.string().max(RECIPE_LIMITS.text), z.number()]);

export const ParamSchema = z.object({
  id: z.string().regex(PARAM_ID, "an input's id is a letter, then letters, digits or _ (up to 32)"),
  label: z.string().trim().min(1).max(60),
  type: z.enum(PARAM_TYPES),
  required: z.boolean().optional(),
  default: Scalar.optional(),
  /** The value from the original run (stripped from exports). */
  example: Scalar.nullable().optional(),
  /** Text: the longest it may be; number: the largest. */
  max: z.number().optional(),
  min: z.number().optional(),
  step: z.number().positive().optional(),
  options: z.array(z.string().trim().min(1).max(80)).min(1).max(RECIPE_LIMITS.options).optional(),
  /** One line under the field. */
  hint: z.string().trim().max(200).optional(),
});
export type RecipeParam = z.infer<typeof ParamSchema>;

const SLOTS = ["images", "endImage", "video", "videos", "audio", "voiceAudio", "audio2", "audios", "model3d", "mask", "prompt"] as const satisfies readonly ChainSlot["slot"][];

const ChainSlotSchema = z.object({
  slot: z.enum(SLOTS),
  position: z.enum(["first", "last"]).optional(),
  stem: z.string().max(40).optional(),
  index: z.number().int().min(0).optional(),
  of: z.number().int().positive().optional(),
  optional: z.object({ prompt: z.string().max(RECIPE_LIMITS.text).optional(), notice: z.string().max(300) }).optional(),
});

/**
 * Fields the server sets on a request (the run's stamp, the demo flag, what the runner filled in, a step's label):
 * a recipe never carries them, whatever its file says.
 */
export const SERVER_FIELDS = ["skill", "demo", "chainFilled", "chainSkipped", "notice", "step", "batchTitle", "asked"] as const;

/** A GenerationRequest with placeholders in it: checked for its shape here, for its models and values on the server. */
const RequestSchema = z
  .object({ feature: z.string().trim().min(1).max(60), modelId: z.string().trim().min(1).max(120) })
  .catchall(z.unknown())
  .transform((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !(SERVER_FIELDS as readonly string[]).includes(k))) as RecipeRequest);

/** A request as a recipe holds it: any field may still be a placeholder until it is filled. */
export type RecipeRequest = GenerationRequest & Record<string, unknown>;

const StepBase = { key: z.string().regex(STEP_KEY, "a step's key is letters, digits, - or _ (up to 40)"), label: z.string().trim().min(1).max(80).optional() };

const GenerateStepSchema = z.object({
  ...StepBase,
  kind: z.literal("generate"),
  after: z.union([z.string(), z.array(z.string()).max(RECIPE_LIMITS.steps)]).optional(),
  chain: z.array(ChainSlotSchema).max(RECIPE_LIMITS.steps).optional(),
  request: RequestSchema,
});
/** Why a step can't be a saved skill (run_skill): a skill runs its own steps, never another skill or itself. */
export const NESTED_SKILL = "a skill can't run another skill: put that skill's steps in this one instead";
/** Tools a recipe's step never calls. */
const NOT_A_STEP = new Set(["run_skill"]);

/** Whether a recipe.json's text has a step that runs a skill (checked before its shape, so an upload is refused by name). */
export function runsASkill(text: string): boolean {
  try {
    const json = JSON.parse(text.replace(/^\uFEFF/, "")) as { steps?: unknown };
    return Array.isArray(json?.steps) && json.steps.some((s) => !!s && typeof s === "object" && NOT_A_STEP.has(String((s as { tool?: unknown }).tool)));
  } catch {
    return false;
  }
}

const ToolStepSchema = z.object({
  ...StepBase,
  kind: z.literal("tool"),
  tool: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,40}$/, "an Assist tool's name, e.g. dub_video")
    .refine((t) => !NOT_A_STEP.has(t), NESTED_SKILL),
  input: z.record(z.string(), z.unknown()),
});
const StepSchema = z.discriminatedUnion("kind", [GenerateStepSchema, ToolStepSchema]);
export type RecipeStep = z.infer<typeof StepSchema>;
export type GenerateStep = z.infer<typeof GenerateStepSchema>;
export type ToolStep = z.infer<typeof ToolStepSchema>;

const KINDS = ["image", "video", "audio", "text", "model3d"] as const satisfies readonly MediaKind[];

export const CheckSchema = z.object({
  /** What the step makes. */
  kind: z.enum(KINDS).optional(),
  /** How many outputs (a number, or a number input's placeholder). */
  count: z.union([z.number().int().min(1).max(64), z.string().regex(EXACT)]).optional(),
  /** "16:9", or a choice input's placeholder. */
  aspect: z.string().max(40).optional(),
  /** Seconds: a range, or one length (±10%). */
  seconds: z.union([z.number().positive(), z.tuple([z.number().min(0), z.number().positive()])]).optional(),
  /** Whether a clip has sound. */
  sound: z.boolean().optional(),
  /** A sentence a model that sees images judges (only when one is available). */
  look: z.string().trim().min(1).max(300).optional(),
});
export type RecipeCheck = z.infer<typeof CheckSchema>;

/** One engine's checks: the day each passed (null: not yet), and the hash of what the plan ran when it was checked. */
const VerifiedEngineSchema = z.object({
  plan: z.string().regex(DAY).nullable(),
  dryRun: z.string().regex(DAY).nullable().optional(),
  real: z.string().regex(DAY).nullable().optional(),
  /** sha256 of each step's model, operation, route provider and price (src/server/recipes.ts planHash). */
  catalog: z.string().max(100).optional(),
  /** What the last check found that isn't a failure ("look not judged: no model that sees images"). */
  notes: z.array(z.string().max(300)).max(12).optional(),
});
export type VerifiedEngine = z.infer<typeof VerifiedEngineSchema>;

/** The newest recipe version: 2 lets a step take an earlier step's output by reference, and studio steps sit anywhere. */
export const RECIPE_VERSION = 2;

export const RecipeSchema = z.object({
  fuobeRecipe: z.union([z.literal(1), z.literal(2)]),
  params: z.array(ParamSchema).max(RECIPE_LIMITS.params, `at most ${RECIPE_LIMITS.params} inputs`),
  steps: z.array(StepSchema).min(1, "a recipe needs a step").max(RECIPE_LIMITS.steps, `at most ${RECIPE_LIMITS.steps} steps`),
  checks: z.record(z.string(), CheckSchema).optional(),
  verified: z.object({ cloud: VerifiedEngineSchema.nullable().optional(), open: VerifiedEngineSchema.nullable().optional() }).optional(),
  source: z
    .object({
      from: z.string().trim().min(1).max(40),
      generations: z.array(z.string().max(40)).max(200).optional(),
      thread: z.string().max(40).optional(),
      canvas: z.string().max(40).optional(),
      at: z.string().regex(DAY).optional(),
      /** Made from results the demo provider made (W2): nothing has shown it works on a real engine yet. */
      demo: z.boolean().optional(),
    })
    .optional(),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export type RecipeValue = string | number;
export type RecipeValues = Record<string, RecipeValue | undefined>;
export type RecipeEngine = "cloud" | "open";

const issueText = (issues: z.core.$ZodIssue[]) => issues.map((i) => (i.path.length ? `${i.path.map(String).join(".")}: ${i.message}` : i.message)).join("; ");

/** A recipe.json's text as a recipe, or what is wrong with its shape (recipeProblems checks the rest). */
export function parseRecipe(text: string): { ok: true; recipe: Recipe } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { ok: false, error: "recipe.json isn't valid JSON" };
  }
  const parsed = RecipeSchema.safeParse(json);
  return parsed.success ? { ok: true, recipe: parsed.data } : { ok: false, error: `recipe.json: ${issueText(parsed.error.issues)}` };
}

// ---------------------------------------------------------------------------
// Placeholders

/** Every placeholder id in a value (strings, lists and objects, all the way down). */
export function placeholders(v: unknown, out = new Set<string>()): Set<string> {
  if (typeof v === "string") for (const m of v.matchAll(PLACEHOLDER)) out.add(m[1]);
  else if (Array.isArray(v)) for (const x of v) placeholders(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) placeholders(x, out);
  return out;
}

const asList = (a: string | string[] | undefined): string[] => (a === undefined ? [] : Array.isArray(a) ? a : [a]);
const stepBody = (s: RecipeStep): unknown => (s.kind === "tool" ? s.input : s.request);

/** Every step a value refers to (`{{steps.<key>.output}}`), all the way down. */
export function stepRefs(v: unknown, out = new Set<string>()): Set<string> {
  if (typeof v === "string") for (const m of v.matchAll(STEP_REF)) out.add(m[1]);
  else if (Array.isArray(v)) for (const x of v) stepRefs(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) stepRefs(x, out);
  return out;
}

/** Each step reference in a step with where it sits (the path in its request or input). */
export function stepRefSpots(v: unknown, path: (string | number)[] = [], out: { key: string; path: (string | number)[] }[] = []) {
  if (typeof v === "string") for (const m of v.matchAll(STEP_REF)) out.push({ key: m[1], path });
  else if (Array.isArray(v)) v.forEach((x, i) => stepRefSpots(x, [...path, i], out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) stepRefSpots(x, [...path, k], out);
  return out;
}

/** The steps a step waits for: its `after` (a generate step) and the steps it refers to. */
export const waitsFor = (s: RecipeStep): string[] => [...new Set([...(s.kind === "generate" ? asList(s.after) : []), ...stepRefs(stepBody(s))])];

/**
 * Whether a recipe runs in stages (W7): a studio step with other steps, or a step that takes an earlier step's output by
 * reference. Such a run starts each step when the ones it waits for are done (src/server/skill-runs.ts), not as one
 * createPipeline.
 */
export const isStaged = (recipe: Pick<Recipe, "steps">): boolean =>
  (recipe.steps.length > 1 && recipe.steps.some((s) => s.kind === "tool")) || recipe.steps.some((s) => stepRefs(stepBody(s)).size > 0);

/** Steps that wait for nothing later: the only ones whose output count may change (createPipeline's rule). */
export function leafKeys(recipe: Pick<Recipe, "steps">): Set<string> {
  const fed = new Set(recipe.steps.flatMap(waitsFor));
  return new Set(recipe.steps.filter((s) => !fed.has(s.key)).map((s) => s.key));
}

/**
 * The kind of file a field takes, from where it sits: a request's inputs by their slot, a studio step's input by its
 * name (video, clip, footage; audio, voice, music; image, photo, logo). Undefined when it can't be told.
 */
export function fieldKind(path: (string | number)[]): MediaKind | undefined {
  const names = path.filter((p): p is string => typeof p === "string");
  if (names[0] === "inputs") {
    const slot = names[1];
    if (slot === "images" || slot === "endImage" || slot === "mask") return "image";
    if (slot === "video" || slot === "videos") return "video";
    if (slot === "audio" || slot === "audio2" || slot === "audios" || slot === "voiceAudio") return "audio";
    if (slot === "model3d") return "model3d";
    return undefined;
  }
  if (names[0] === "prompt" || names[0] === "negativePrompt") return "text";
  const key = names.join(" ").toLowerCase();
  if (/video|clip|footage/.test(key)) return "video";
  if (/audio|voice|music|sound/.test(key)) return "audio";
  if (/image|photo|picture|still|frame|logo|product|reference/.test(key)) return "image";
  return undefined;
}

// ---------------------------------------------------------------------------
// Values

const blank = (v: unknown) => (v === null || v === undefined || (typeof v === "string" && !v.trim()) ? undefined : v);

/** The values one input takes, its limits and options applied (a choice is matched without minding case). */
function valueSchema(p: RecipeParam): z.ZodType<RecipeValue | undefined> {
  const label = p.label;
  let base: z.ZodType<RecipeValue>;
  switch (p.type) {
    case "image":
    case "video":
    case "audio":
      base = z.string({ error: `${label}: add a file` }).trim().refine(isMediaRef, `${label}: a file from Fuobe (/api/files/…) or an http(s) link`);
      break;
    case "text": {
      const max = Math.min(p.max ?? RECIPE_LIMITS.text, RECIPE_LIMITS.text);
      base = z.string({ error: `${label}: write some text` }).max(max, `${label}: at most ${max} characters`);
      break;
    }
    case "number": {
      let n = z.number({ error: `${label}: a number` }).refine(Number.isFinite, `${label}: a number`);
      if (p.min !== undefined) n = n.refine((x) => x >= p.min!, `${label}: at least ${p.min}`);
      if (p.max !== undefined) n = n.refine((x) => x <= p.max!, `${label}: at most ${p.max}`);
      // Text (a form, a CSV) counts as it is being typed: "0." and ".5" are numbers; anything else isn't.
      base = z.preprocess((v) => (typeof v === "string" && /^-?(\d+(\.\d*)?|\.\d+)$/.test(v.trim()) ? Number(v.trim()) : v), n) as z.ZodType<RecipeValue>;
      break;
    }
    case "choice": {
      const options = p.options ?? [];
      base = z
        .union([z.string(), z.number().transform(String)])
        .transform((v) => options.find((o) => o.toLowerCase() === v.trim().toLowerCase()) ?? v)
        .refine((v) => options.includes(v), `${label}: one of ${options.join(", ")}`);
      break;
    }
    case "element":
      base = z
        .string({ error: `${label}: pick an element` })
        .trim()
        .transform((v) => (v.startsWith("@") ? v : `@${v}`))
        .refine((v) => ELEMENT.test(v), `${label}: an element's @handle, e.g. @Maya`);
      break;
  }
  const missing = `${label} is needed`;
  if (p.default !== undefined) return z.preprocess((v) => blank(v) ?? p.default, base);
  if (p.required) return z.preprocess(blank, z.custom<unknown>((v) => v !== undefined, missing).pipe(base));
  return z.preprocess(blank, base.optional());
}

/** A zod object for one set of values: required inputs, defaults, limits, options; media and @handles by shape. */
export function valuesSchema(recipe: Pick<Recipe, "params">) {
  return z.object(Object.fromEntries(recipe.params.map((p) => [p.id, valueSchema(p)])));
}

/** One set of values checked: the values with defaults applied, or an error per input id. */
export function checkValues(recipe: Pick<Recipe, "params">, values: Record<string, unknown>): { values: RecipeValues; errors: Record<string, string> } | { values?: undefined; errors: Record<string, string> } {
  const parsed = valuesSchema(recipe).safeParse(values ?? {});
  if (parsed.success) return { values: parsed.data as RecipeValues, errors: {} };
  const errors: Record<string, string> = {};
  for (const i of parsed.error.issues) {
    const id = String(i.path[0] ?? "");
    const p = recipe.params.find((x) => x.id === id);
    errors[id] ??= i.message.startsWith(p?.label ?? "\0") ? i.message : p?.required && blank(values?.[id]) === undefined ? `${p.label} is needed` : `${p?.label ?? id}: ${i.message}`;
  }
  return { errors };
}

/** The values a check runs with: each input's example, else its default; a media input with neither gets `standIn`. */
export function exampleValues(recipe: Pick<Recipe, "params">, standIn: (type: "image" | "video" | "audio") => string): RecipeValues {
  return Object.fromEntries(
    recipe.params.map((p) => {
      const v = blank(p.example) ?? blank(p.default);
      if (v !== undefined) return [p.id, v as RecipeValue];
      if (isMediaType(p.type)) return [p.id, standIn(p.type)];
      if (p.type === "number") return [p.id, p.min ?? 1];
      if (p.type === "choice") return [p.id, p.options?.[0]];
      // An unknown @handle stays plain words in the prompt: enough to price and dry-run the steps.
      if (p.type === "element") return [p.id, p.required ? `@${p.label.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40)}` : undefined];
      return [p.id, p.required ? p.label : undefined];
    }),
  );
}

// ---------------------------------------------------------------------------
// Filling and compiling

/** A value with the inputs put in: an exact placeholder keeps the input's type; a missing one drops the field. */
function fillValue(v: unknown, values: RecipeValues): unknown {
  if (typeof v === "string") {
    const exact = EXACT.exec(v);
    if (exact) return values[exact[1]];
    if (!v.includes("{{")) return v;
    let emptied = false;
    const out = v.replace(PLACEHOLDER, (_, id: string) => {
      const x = values[id];
      if (x === undefined || x === "") emptied = true;
      return x === undefined ? "" : String(x);
    });
    // An optional input left empty: no double spaces or dangling commas where it was.
    return emptied ? out.replace(/\s+([,.;:])/g, "$1").replace(/([,;:])(\s*[,;:])+/g, "$1").replace(/[ \t]{2,}/g, " ").replace(/^[\s,;:]+|[\s,;:]+$/g, "") : out;
  }
  if (Array.isArray(v)) {
    const out = v.map((x) => fillValue(x, values)).filter((x) => x !== undefined);
    return v.length && !out.length ? undefined : out;
  }
  if (v && typeof v === "object") {
    const out = Object.fromEntries(Object.entries(v).flatMap(([k, x]) => {
      const f = fillValue(x, values);
      return f === undefined ? [] : [[k, f]];
    }));
    return Object.keys(v).length && !Object.keys(out).length ? undefined : out;
  }
  return v;
}

const defaultsOf = (recipe: Pick<Recipe, "params">): RecipeValues => Object.fromEntries(recipe.params.flatMap((p) => (p.default === undefined ? [] : [[p.id, p.default]])));

/** The recipe's steps and checks with the values put in (defaults for what isn't given). */
export function fill(recipe: Recipe, values: RecipeValues): { steps: RecipeStep[]; checks: Record<string, FilledCheck> } {
  const all = { ...defaultsOf(recipe), ...Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)) };
  const steps = recipe.steps.map((s): RecipeStep =>
    s.kind === "tool" ? { ...s, input: (fillValue(s.input, all) as Record<string, unknown>) ?? {} } : { ...s, request: fillValue(s.request, all) as RecipeRequest },
  );
  const checks = Object.fromEntries(Object.entries(recipe.checks ?? {}).map(([k, c]) => [k, fillCheck(c, all)]));
  return { steps, checks };
}

/** A check with its placeholders filled: a count and an aspect as values. */
export interface FilledCheck {
  kind?: MediaKind;
  count?: number;
  aspect?: string;
  seconds?: number | [number, number];
  sound?: boolean;
  look?: string;
}

function fillCheck(c: RecipeCheck, values: RecipeValues): FilledCheck {
  const count = typeof c.count === "string" ? Number(fillValue(c.count, values)) : c.count;
  const aspect = c.aspect === undefined ? undefined : String(fillValue(c.aspect, values) ?? "");
  return {
    ...(c.kind && { kind: c.kind }),
    ...(count !== undefined && Number.isFinite(count) && count > 0 && { count }),
    ...(aspect && /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(aspect) && { aspect }),
    ...(c.seconds !== undefined && { seconds: c.seconds }),
    ...(c.sound !== undefined && { sound: c.sound }),
    ...(c.look && { look: c.look }),
  };
}

/** A step of a compiled pipeline: createPipeline's PipelineStep. */
export interface CompiledStep {
  key: string;
  request: GenerationRequest;
  after?: string | string[];
  chain?: ChainSlot[];
}

export type Compiled =
  | { kind: "pipeline"; steps: CompiledStep[]; checks: Record<string, FilledCheck> }
  | { kind: "tool"; key: string; tool: string; input: Record<string, unknown>; checks: Record<string, FilledCheck> }
  /** A run in stages (W7): each step filled with the values, step references left for the runner. */
  | { kind: "staged"; steps: RecipeStep[]; checks: Record<string, FilledCheck> };

export interface CompileOptions {
  /** The skill's name and this run's id: the server-set stamp on every request. */
  skill: string;
  run: string;
  /** The skill's title: the Library stack's name (batchTitle). */
  title: string;
  /** The free dry run: every job on the demo provider, as a hidden helper row (feature skill-check). */
  demo?: boolean;
}

/** The feature of a dry run's rows: a helper the Library hides (HELPER_FEATURES). */
export const SKILL_CHECK_FEATURE = "skill-check";

/** One run of a recipe: a pipeline of generate steps, or one tool call. Values are checked first (checkValues). */
export function compile(recipe: Recipe, values: RecipeValues, o: CompileOptions): Compiled {
  const { steps, checks } = fill(recipe, values);
  if (isStaged(recipe)) {
    const n = steps.length;
    return {
      kind: "staged",
      checks,
      steps: steps.map((s, i) =>
        s.kind === "tool"
          ? s
          : {
              ...s,
              request: {
                ...s.request,
                batchTitle: o.title.slice(0, 200),
                skill: { name: o.skill, run: o.run },
                ...(s.label && { step: { label: s.label, index: i, of: n } }),
                ...(o.demo && { demo: true, feature: SKILL_CHECK_FEATURE }),
              },
            },
      ),
    };
  }
  const tool = steps.find((s): s is ToolStep => s.kind === "tool");
  if (tool) return { kind: "tool", key: tool.key, tool: tool.tool, input: tool.input, checks };
  const n = steps.length;
  return {
    kind: "pipeline",
    checks,
    steps: (steps as GenerateStep[]).map((s, i) => ({
      key: s.key,
      request: {
        ...s.request,
        batchTitle: o.title.slice(0, 200),
        skill: { name: o.skill, run: o.run },
        ...(s.label && { step: { label: s.label, index: i, of: n } }),
        ...(o.demo && { demo: true, feature: SKILL_CHECK_FEATURE }),
      },
      ...(s.after !== undefined && { after: s.after }),
      ...(s.chain && { chain: s.chain as ChainSlot[] }),
    })),
  };
}

// ---------------------------------------------------------------------------
// Save-time problems

/**
 * What would make a recipe fail or mislead, said when it is saved (never at run time): unknown or unused placeholders,
 * a count that varies on a step others wait for, duplicate ids and keys, a tool step that isn't alone, a graph
 * createPipeline would refuse, and inputs whose default, example or options don't fit their type.
 */
export function recipeProblems(recipe: Recipe, o: { kinds?: Record<string, MediaKind | undefined> } = {}): string[] {
  const out: string[] = [];
  const ids = recipe.params.map((p) => p.id);
  const keys = recipe.steps.map((s) => s.key);
  const dup = (list: string[]) => [...new Set(list.filter((x, i) => list.indexOf(x) !== i))];
  for (const d of dup(ids)) out.push(`Two inputs are called “${d}”`);
  for (const d of dup(keys)) out.push(`Two steps are called “${d}”`);
  const known = new Set(ids);
  const used = new Set<string>();
  for (const s of recipe.steps) {
    for (const id of placeholders(stepBody(s))) {
      if (known.has(id)) used.add(id);
      else out.push(`Step “${s.key}” uses {{${id}}}, which isn't an input`);
    }
  }
  for (const [k, c] of Object.entries(recipe.checks ?? {})) {
    if (!keys.includes(k)) out.push(`The checks name a step “${k}” the recipe doesn't have`);
    for (const id of placeholders(c)) if (!known.has(id)) out.push(`The check on “${k}” uses {{${id}}}, which isn't an input`);
  }
  for (const p of recipe.params) if (!used.has(p.id)) out.push(`The input “${p.label}” ({{${p.id}}}) isn't used by any step`);

  // Version 1: one tool step alone, and no step references. Version 2: each reference names an earlier step that makes
  // the kind of file its field takes.
  const tools = recipe.steps.filter((s) => s.kind === "tool");
  if (recipe.fuobeRecipe === 1) {
    if (tools.length && recipe.steps.length > 1) out.push(`The tool step “${tools[0].key}” must be the recipe's only step (set "fuobeRecipe": 2 for a studio step that feeds other steps)`);
    for (const s of recipe.steps) if (stepRefs(stepBody(s)).size) out.push(`Step “${s.key}” takes an earlier step's output: that needs "fuobeRecipe": 2`);
  } else {
    // Generate steps joined by `after` start together as one chain: one can't also take another's output by reference.
    const group = new Map(keys.map((k) => [k, k]));
    const root = (k: string): string => (group.get(k) === k ? k : root(group.get(k)!));
    for (const s of recipe.steps) if (s.kind === "generate") for (const a of asList(s.after)) if (group.has(a) && root(a) !== root(s.key)) group.set(root(s.key), root(a));
    const referenced = new Set<string>();
    for (const [i, s] of recipe.steps.entries()) {
      for (const ref of stepRefSpots(stepBody(s))) {
        const at = keys.indexOf(ref.key);
        if (at >= 0 && at < i) referenced.add(ref.key);
        if (at < 0) out.push(`Step “${s.key}” takes the output of “${ref.key}”, which isn't a step`);
        else if (at >= i) out.push(`Step “${s.key}” takes the output of “${ref.key}”, which comes ${at === i ? "from itself" : "later"}: a step can only take an earlier step's output`);
        else if (root(ref.key) === root(s.key)) out.push(`Step “${s.key}” takes the output of “${ref.key}”, which starts with it (they are joined by "after"): take it through "after" and a chain slot, or drop "after"`);
        else {
          const want = fieldKind(ref.path);
          const made = o.kinds?.[ref.key] ?? recipe.checks?.[ref.key]?.kind;
          if (want && made && want !== made && want !== "text") out.push(`Step “${s.key}” takes ${want === "image" ? "an image" : `a ${want}`} from “${ref.key}”, which makes ${made === "image" ? "an image" : `a ${made}`}`);
        }
      }
      if (s.kind === "generate" && asList(s.after).some((a) => recipe.steps.find((x) => x.key === a)?.kind === "tool")) out.push(`Step “${s.key}” waits for the studio step “${asList(s.after).find((a) => recipe.steps.find((x) => x.key === a)?.kind === "tool")}”: take its output with {{steps.<key>.output}} instead`);
    }
    // A dub that waits for its lines to be checked (review, the default) has no video until someone voices it.
    for (const s of recipe.steps) {
      if (s.kind === "tool" && s.tool === "dub_video" && referenced.has(s.key) && (s.input as { review?: unknown }).review !== false) out.push(`Step “${s.key}” dubs for review, so it makes no video for the steps after it: set "review": false to dub in one go`);
    }
  }

  // The graph, as createPipeline checks it.
  const keySet = new Set(keys);
  for (const s of recipe.steps) {
    if (s.kind !== "generate") continue;
    const after = asList(s.after);
    for (const a of after) {
      if (a === s.key) out.push(`Step “${s.key}” can't wait for itself`);
      else if (!keySet.has(a)) out.push(`Step “${s.key}” waits for “${a}”, which isn't a step`);
    }
    // A step that takes an earlier step's output by reference waits for it; its chain slots are only for `after`.
    const chain = s.chain ?? (s.request.chain as ChainSlot[] | undefined);
    if (chain && chain.length !== after.length) out.push(`Step “${s.key}” has ${chain.length} chain slot${chain.length === 1 ? "" : "s"} for ${after.length} earlier step${after.length === 1 ? "" : "s"}`);
  }
  if (!out.some((p) => p.includes("waits for") || p.includes("itself"))) {
    const loop = loopOf(recipe.steps);
    if (loop.length) out.push(`These steps wait for each other in a loop: ${loop.map((k) => `“${k}”`).join(", ")}`);
  }
  // A count may vary only where nothing waits (createPipeline needs one result from a step that feeds others).
  const leaves = leafKeys(recipe);
  for (const s of recipe.steps) {
    if (s.kind !== "generate" || leaves.has(s.key)) continue;
    const n = (s.request.params as Record<string, unknown> | undefined)?.numOutputs;
    if (typeof n === "string" && placeholders(n).size) out.push(`Step “${s.key}” feeds later steps, so its count can't come from an input (${n})`);
    else if (typeof n === "number" && n > 1) out.push(`Step “${s.key}” feeds later steps, so it must make one result (it asks for ${n})`);
  }

  // Inputs that can't hold what they say.
  for (const p of recipe.params) {
    if (p.type === "choice" && !p.options?.length) out.push(`The choice “${p.label}” needs options`);
    if (p.min !== undefined && p.max !== undefined && p.min > p.max) out.push(`“${p.label}”: its minimum is above its maximum`);
    for (const [what, v] of [
      ["default", p.default],
      ["example", p.example],
    ] as const) {
      if (blank(v) === undefined) continue;
      const one = valueSchema({ ...p, required: false, default: undefined }).safeParse(v);
      if (!one.success) out.push(`The ${what} of “${p.label}” doesn't fit: ${one.error.issues[0]?.message.replace(`${p.label}: `, "")}`);
    }
  }
  return [...new Set(out)];
}

/** Steps caught in a loop of `after`s (Kahn's algorithm), or none. */
function loopOf(steps: RecipeStep[]): string[] {
  const keys = new Set(steps.map((s) => s.key));
  const waits = new Map(steps.map((s) => [s.key, new Set(s.kind === "generate" ? asList(s.after).filter((a) => keys.has(a)) : [])]));
  const done = new Set<string>();
  let moved = true;
  while (moved) {
    moved = false;
    for (const [k, w] of waits) {
      if (done.has(k) || [...w].some((a) => !done.has(a))) continue;
      done.add(k);
      moved = true;
    }
  }
  return steps.map((s) => s.key).filter((k) => !done.has(k));
}

// ---------------------------------------------------------------------------
// Many runs: rows from a CSV

export interface RecipeRow {
  /** The row's line in the file (1-based, the header is line 1 when it comes first). */
  line: number;
  cells: string[];
  values?: RecipeValues;
  errors: string[];
}

export interface ParsedRows {
  header: string[];
  /** The input each column fills (null: a column that isn't an input, left out). */
  columns: (string | null)[];
  rows: RecipeRow[];
  /** What stops every row (no column for a required input, too many rows, an empty file). */
  errors: string[];
  /** What was left out without stopping anything (a column that isn't an input). */
  notes: string[];
}

/** Cells of a CSV or TSV text (a spreadsheet's paste is tab-separated): quotes, doubled quotes, line breaks in quotes. */
export function csvCells(text: string): { cells: string[]; line: number }[] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : firstLine.includes(";") && !firstLine.includes(",") && !firstLine.includes("\t") ? ";" : ",";
  const rows: { cells: string[]; line: number }[] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else {
        if (c === "\n") line++;
        cell += c;
      }
      continue;
    }
    if (c === '"' && !cell.trim()) {
      quoted = true;
      cell = "";
    } else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push({ cells: row, line: start });
      row = [];
      cell = "";
      line++;
      start = line;
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push({ cells: row, line: start });
  }
  return rows.map((r) => ({ ...r, cells: r.cells.map((x) => x.trim()) }));
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, " ").trim();

/**
 * Rows of values from a CSV (or a spreadsheet's paste): a header row naming each input by its id or its label, then
 * one run per row. Empty rows are skipped; at most RECIPE_LIMITS.rows. Each row is checked like the form (checkValues).
 */
export function parseRows(csv: string, recipe: Pick<Recipe, "params">): ParsedRows {
  const all = csvCells(csv).filter((r) => r.cells.some((c) => c));
  const empty: ParsedRows = { header: [], columns: [], rows: [], errors: [], notes: [] };
  if (!all.length) return { ...empty, errors: ["Paste a table: a header row with the inputs' names, then one row per run"] };
  const [head, ...body] = all;
  const header = head.cells;
  const byName = new Map<string, string>();
  for (const p of recipe.params) {
    byName.set(norm(p.id), p.id);
    byName.set(norm(p.label), p.id);
  }
  const columns = header.map((h) => byName.get(norm(h)) ?? null);
  const errors: string[] = [];
  const notes: string[] = [];
  header.forEach((h, i) => {
    if (!columns[i] && h) notes.push(`“${h}” isn't an input of this skill, so it's left out`);
  });
  for (const id of new Set(columns.filter((c): c is string => !!c))) {
    if (columns.filter((c) => c === id).length > 1) errors.push(`Two columns fill “${recipe.params.find((p) => p.id === id)!.label}”`);
  }
  if (!columns.some(Boolean)) errors.push(`The first row names no input: use ${recipe.params.map((p) => `“${p.label}”`).join(", ")}`);
  else
    for (const p of recipe.params) {
      if (p.required && p.default === undefined && !columns.includes(p.id)) errors.push(`No column for “${p.label}”`);
    }
  if (body.length > RECIPE_LIMITS.rows) errors.push(`At most ${RECIPE_LIMITS.rows} rows at a time — this has ${body.length}`);
  if (!body.length && columns.some(Boolean)) errors.push("Add a row under the header: one row per run");
  const rows = body.slice(0, RECIPE_LIMITS.rows).map((r): RecipeRow => {
    const raw: Record<string, unknown> = {};
    columns.forEach((id, i) => {
      if (id && raw[id] === undefined) raw[id] = r.cells[i] ?? "";
    });
    const checked = checkValues(recipe, raw);
    return { line: r.line, cells: r.cells, ...(checked.values && { values: checked.values }), errors: Object.values(checked.errors) };
  });
  return { header, columns, rows, errors, notes };
}

// ---------------------------------------------------------------------------
// Checking outputs (a real test): structure only, never pixels

export interface OutputCheck {
  ok: boolean;
  problems: string[];
  /** Checks that couldn't be read (a container probeMedia doesn't know). */
  skipped: string[];
}

const ratioOf = (a: string) => {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(a);
  return m ? Number(m[1]) / Number(m[2]) : NaN;
};

/**
 * A step's outputs against its check: kind, count, aspect from width and height (±2%), seconds (a range, or one
 * length ±10%), and sound. Pure: `infos` are each output's probeMedia (null when it couldn't be read).
 */
export function checkOutputs(check: FilledCheck, outputs: Pick<OutputFile, "kind" | "width" | "height">[], infos: (MediaInfo | null | undefined)[] = []): OutputCheck {
  const problems: string[] = [];
  const skipped: string[] = [];
  const main = check.kind ? outputs.filter((o) => o.kind === check.kind) : outputs;
  if (check.kind && !main.length) problems.push(`it made no ${check.kind}${outputs.length ? ` (got ${[...new Set(outputs.map((o) => o.kind))].join(", ")})` : ""}`);
  if (check.count !== undefined && main.length !== check.count) problems.push(`it made ${main.length} ${check.kind ?? "output"}${main.length === 1 ? "" : "s"}, not ${check.count}`);
  const at = (o: (typeof outputs)[number]) => infos[outputs.indexOf(o)] ?? null;
  if (check.aspect) {
    const want = ratioOf(check.aspect);
    for (const [i, o] of main.entries()) {
      const info = at(o);
      const w = o.width ?? info?.width;
      const h = o.height ?? info?.height;
      if (!w || !h) {
        skipped.push(`the shape of output ${i + 1}`);
        continue;
      }
      if (Math.abs(w / h - want) / want > 0.02) problems.push(`output ${i + 1} is ${w}×${h}, not ${check.aspect}`);
    }
  }
  if (check.seconds !== undefined) {
    const [lo, hi] = Array.isArray(check.seconds) ? check.seconds : [check.seconds * 0.9, check.seconds * 1.1];
    for (const [i, o] of main.entries()) {
      const d = at(o)?.duration;
      if (d === undefined) skipped.push(`the length of output ${i + 1}`);
      else if (d < lo - 1e-6 || d > hi + 1e-6) problems.push(`output ${i + 1} is ${Math.round(d * 10) / 10} s, not ${Array.isArray(check.seconds) ? `${lo}–${hi}` : check.seconds} s`);
    }
  }
  if (check.sound !== undefined) {
    for (const [i, o] of main.entries()) {
      const info = at(o);
      if (!info) skipped.push(`the sound of output ${i + 1}`);
      else if (info.hasAudio !== check.sound) problems.push(`output ${i + 1} ${info.hasAudio ? "has sound" : "is silent"}`);
    }
  }
  return { ok: !problems.length, problems, skipped };
}

// ---------------------------------------------------------------------------
// Export and reading

const FILE_KIND: [RegExp, "image" | "video" | "audio"][] = [
  [/\.(png|jpe?g|webp|gif|avif)$/i, "image"],
  [/\.(mp4|webm|mov|m4v)$/i, "video"],
  [/\.(mp3|wav|m4a|ogg|flac|aac|opus)$/i, "audio"],
];

/**
 * The recipe as it is shared: no examples, no source and no checks of this install (the other install checks it
 * again). Files fixed in its steps (a logo, a music bed) are files of this Fuobe and don't travel in the zip, so each
 * becomes a required input the form asks for on the first run there.
 */
export function stripExamples(recipe: Recipe): Recipe {
  const params = recipe.params.map((p) => {
    const q = { ...p };
    delete q.example;
    return q;
  });
  const taken = new Set(params.map((p) => p.id));
  const files = new Map<string, string>();
  const swap = (v: unknown, where: string): unknown => {
    if (typeof v === "string" && v.startsWith("/api/files/") && !/\s/.test(v)) {
      const kind = FILE_KIND.find(([re]) => re.test(v.split("?")[0]))?.[1];
      if (!kind || params.length >= RECIPE_LIMITS.params) return v;
      let id = files.get(v);
      if (!id) {
        let n = files.size + 1;
        while (taken.has(`file_${n}`)) n++;
        id = `file_${n}`;
        taken.add(id);
        files.set(v, id);
        params.push({ id, label: `${kind === "image" ? "Image" : kind === "video" ? "Video" : "Audio"} for “${where}”`.slice(0, 60), type: kind, required: true });
      }
      return `{{${id}}}`;
    }
    if (Array.isArray(v)) return v.map((x) => swap(x, where));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x, where)]));
    return v;
  };
  const steps = recipe.steps.map((s): RecipeStep => (s.kind === "tool" ? { ...s, input: swap(s.input, s.label ?? s.key) as Record<string, unknown> } : { ...s, request: swap(s.request, s.label ?? s.key) as RecipeRequest }));
  const out: Recipe = { ...recipe, params, steps };
  delete out.source;
  delete out.verified;
  return out;
}

/** The recipe as kept with its examples (a backup, a move between installs): only this install's checks are left out. */
export function stripChecks(recipe: Recipe): Recipe {
  const out: Recipe = { ...recipe };
  delete out.verified;
  return out;
}

const TYPE_WORDS: Record<ParamType, string> = { image: "an image", video: "a video", audio: "an audio file", text: "text", number: "a number", choice: "one of", element: "an element's @handle" };

/** A line's text cut to `n` characters (the Run it section stays a few pages, whatever a recipe holds). */
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function paramLine(p: RecipeParam): string {
  const what = p.type === "choice" ? `${TYPE_WORDS.choice} ${(p.options ?? []).map((o) => `\`${o}\``).join(", ")}` : TYPE_WORDS[p.type];
  const limits = [
    p.type === "number" && p.min !== undefined ? `from ${p.min}` : "",
    p.type === "number" && p.max !== undefined ? `to ${p.max}` : "",
    p.type === "text" && p.max !== undefined ? `up to ${p.max} characters` : "",
  ].filter(Boolean);
  const need = p.required && p.default === undefined ? "required" : p.default !== undefined ? `default \`${cut(String(p.default), 120)}\`` : "optional";
  return cut(`- \`${p.id}\` — ${p.label}: ${what}${limits.length ? ` (${limits.join(" ")})` : ""}; ${need}${p.hint ? `. ${p.hint}` : ""}`, 600);
}

/** A step as a line: its model and operation, its words with the inputs as {{id}}, what it waits for. */
function stepLine(s: RecipeStep, i: number, keys: string[]): string {
  const refs = [...stepRefs(stepBody(s))].map((a) => `step ${keys.indexOf(a) + 1}`);
  if (s.kind === "tool") return `${i + 1}. \`${s.tool}\` with ${cut(JSON.stringify(s.input), 400)}${refs.length ? `, from the result of ${refs.join(" and ")}` : ""}`;
  const r = s.request;
  const waits = [...new Set([...asList(s.after).map((a) => `step ${keys.indexOf(a) + 1}`), ...refs])];
  return `${i + 1}. ${s.label ? `${s.label}: ` : ""}\`${r.modelId}\`${r.op ? ` (${r.op})` : ""}${r.prompt ? ` — “${cut(String(r.prompt), 240)}”` : ""}${waits.length ? `, from the result of ${waits.join(" and ")}` : ""}`;
}

/** Request fields the `generate` tool's job takes (src/server/assist/tools.ts Job → asRequest), by its name for each. */
const JOB_INPUTS: Record<string, string> = { images: "images", endImage: "end_image", video: "video", audio: "audio", audio2: "background_audio", voiceAudio: "voice_audio" };
const JOB_PARAMS: Record<string, string> = {
  aspectRatio: "aspect_ratio",
  resolution: "resolution",
  duration: "duration",
  numOutputs: "outputs",
  generateAudio: "generate_audio",
  voice: "voice",
  targetLanguage: "target_language",
  sourceLanguage: "source_language",
  startTime: "start_time",
  endTime: "end_time",
  numLayers: "num_layers",
};
/** Request fields that don't change what is made (or that `after` stands for). */
const JOB_IGNORED = new Set(["feature", "modelId", "op", "prompt", "negativePrompt", "presetId", "inputs", "params", "engine", "chain", "chainFrom", "title", "step"]);
const LEFT_OUT_WORDS: Record<string, string> = { loras: "its LoRAs", presetOptions: "its preset options", presetStrength: "its preset strength", mix: "its second preset (mix)" };

/**
 * The equivalent `generate` call, when every step waits for at most one earlier step (Assist's `after`), with the
 * inputs left as {{id}} for the agent to fill in, and what it can't carry (the generate tool has no field for it).
 */
function generateCall(recipe: Recipe): { json: string; leftOut: string[] } | null {
  const steps = recipe.steps as GenerateStep[];
  if (steps.some((s) => s.kind !== "generate" || asList(s.after).length > 1)) return null;
  const keys = steps.map((s) => s.key);
  const leftOut = new Set<string>();
  const jobs = steps.map((s) => {
    const r = s.request as Record<string, unknown>;
    const p = (r.params ?? {}) as Record<string, unknown>;
    const inputs = (r.inputs ?? {}) as Record<string, unknown>;
    const extra = (p.extra ?? {}) as Record<string, unknown>;
    const after = asList(s.after)[0];
    for (const [k, v] of Object.entries(r)) if (v !== undefined && !JOB_IGNORED.has(k)) leftOut.add(LEFT_OUT_WORDS[k] ?? `\`${k}\``);
    for (const [k, v] of Object.entries(inputs)) if (v !== undefined && !JOB_INPUTS[k]) leftOut.add(`the input \`${k}\``);
    for (const [k, v] of Object.entries(p)) if (v !== undefined && !JOB_PARAMS[k] && k !== "extra") leftOut.add(`\`params.${k}\``);
    for (const k of Object.keys(extra)) if (k !== "system") leftOut.add(`\`params.extra.${k}\``);
    return Object.fromEntries(
      Object.entries({
        model_id: r.modelId,
        op: r.op,
        prompt: r.prompt,
        negative_prompt: r.negativePrompt,
        look: r.presetId,
        ...Object.fromEntries(Object.entries(JOB_INPUTS).map(([k, name]) => [name, inputs[k]])),
        ...Object.fromEntries(Object.entries(JOB_PARAMS).map(([k, name]) => [name, p[k]])),
        system: extra.system,
        engine: r.engine,
        after: after === undefined ? undefined : keys.indexOf(after),
      }).filter(([, v]) => v !== undefined),
    );
  });
  return { json: JSON.stringify({ summary: "…", jobs }, null, 2), leftOut: [...leftOut] };
}

/** The longest Run it section (load_skill, the chat's context, MCP prompts): about the size of a long playbook. */
export const RECIPE_MARKDOWN_MAX = 20_000;

/**
 * The "Run it" section for agents (load_skill appends it): the inputs, the steps, and how another agent runs the
 * same job with Fuobe's tools: the `run_skill` call (Assist and MCP, W3), else the equivalent `generate` or studio
 * tool call. At most RECIPE_MARKDOWN_MAX characters: a call too long to show is left to run_skill.
 */
export function recipeMarkdown(recipe: Recipe, skill?: { name: string }): string {
  const keys = recipe.steps.map((s) => s.key);
  // A run in stages has no one call to show: run_skill (or the steps in order) runs it.
  const staged = isStaged(recipe);
  const tool = staged ? undefined : recipe.steps.find((s): s is ToolStep => s.kind === "tool");
  const gen = tool || staged ? null : generateCall(recipe);
  const call = tool ? JSON.stringify({ tool: tool.tool, input: tool.input }, null, 2) : gen?.json;
  const values = Object.fromEntries(recipe.params.map((p) => [p.id, `{{${p.id}}}`]));
  const build = (withCall: boolean) => {
    const shown = withCall && !!call;
    const how = staged
      ? "run the steps in order, each once the steps it takes a result from are done, putting each earlier result in for {{steps.<key>.output}}"
      : tool
        ? `call the studio tool \`${tool.tool}\` the same way`
        : call
          ? "make the same `generate` call"
          : "run the steps with `generate`, in order";
    return [
      "## Run it",
      "",
      `This skill runs by itself in Fuobe: the same steps with new inputs, priced first, no LLM needed (Skills → ${skill ? `/${skill.name}` : "this skill"} → Run…).`,
      "",
      recipe.params.length ? "**Inputs**" : "It takes no inputs.",
      ...recipe.params.map(paramLine),
      "",
      "**Steps**",
      ...recipe.steps.map((s, i) => stepLine(s, i, keys)),
      "",
      "**From an agent**",
      "",
      `With Fuobe's MCP server, \`run_skill\` runs it with values for the inputs${skill ? `: \`${JSON.stringify({ name: skill.name, values })}\`` : ""}. Where that tool isn't available, ${how}, with the inputs put in for {{id}}${shown ? ":" : call ? " (the call is too long to show here)." : "."}`,
      ...(shown ? ["", "```json", call, "```"] : []),
      ...(gen?.leftOut.length ? ["", `That call leaves out ${gen.leftOut.join(", ")} (the \`generate\` tool has no field for ${gen.leftOut.length === 1 ? "it" : "them"}), so its result can differ: only \`run_skill\` makes the same thing.`] : []),
      "",
      "Price it first with `estimate_cost` (or `estimate_job` for a studio tool) and confirm with the user.",
    ].join("\n");
  };
  const full = build(true);
  if (full.length <= RECIPE_MARKDOWN_MAX) return full;
  return cut(build(false), RECIPE_MARKDOWN_MAX);
}

/** "29 Oct" from a stored day. */
export const shortDay = (day: string): string => {
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
};

/** The day a check passed, for `verified` (UTC, so every install agrees). */
export const today = (now = Date.now()): string => new Date(now).toISOString().slice(0, 10);

export const ENGINE_WORDS: Record<RecipeEngine, string> = { cloud: "Cloud", open: "GPU" };

/**
 * "Checked 29 Oct · Cloud ✓ · GPU not checked": the line under a recipe skill's description. `engines` are the ones
 * its steps allow on this install.
 */
export function verifiedLine(recipe: Pick<Recipe, "verified">, engines: RecipeEngine[]): string {
  const v = recipe.verified ?? {};
  const days = engines.map((e) => v[e]?.dryRun ?? v[e]?.plan).filter((d): d is string => !!d);
  if (!days.length) return "Not checked yet — check it once (free) before the first run";
  const last = days.sort().at(-1)!;
  const parts = engines.map((e) => (v[e]?.dryRun ? `${ENGINE_WORDS[e]} ✓` : v[e]?.plan ? `${ENGINE_WORDS[e]} priced` : `${ENGINE_WORDS[e]} not checked`));
  return [`Checked ${shortDay(last)}`, ...parts].join(" · ");
}

// ---------------------------------------------------------------------------
// What the recipe routes answer (src/server/recipes.ts)

/** Where a studio tool's run opens (its studio and page), or why it runs in the Library. */
export interface RecipePlace {
  studio?: string;
  href?: string;
  fallback?: string;
}

export interface RecipeView {
  name: string;
  title: string;
  /** The skill's icon (a lucide name from SKILL_ICONS). */
  icon?: string;
  builtin: boolean;
  /** Switched on on the Skills page: a skill that's off doesn't run. */
  enabled: boolean;
  recipe: Recipe;
  /** Engines its steps allow on this install. */
  engines: RecipeEngine[];
  /** Engines it may run on now: its plan check passed there. */
  ready: RecipeEngine[];
  /** Why it needs a re-check, per engine checked before. */
  recheck: Partial<Record<RecipeEngine, string[]>>;
  /** "Checked 29 Oct · Cloud ✓ · GPU not checked". */
  line: string;
  /** Why it runs nowhere on this install. */
  why?: string;
  /** Each step's model and its licence on each engine, as information. */
  models: { engine: RecipeEngine; name: string; licence: string }[];
}

export interface RecipeEstimate {
  engine: RecipeEngine;
  /** One entry per row: its jobs priced, and what stops it. */
  runs: { line: number; jobs: PlannedJob[]; total: number | null; errors: string[] }[];
  /** The first run's jobs ("What runs"). */
  jobs: PlannedJob[];
  /** Every run together (null: a price that varies). */
  total: number | null;
  /** Every job would run on the demo provider. */
  demo: boolean;
  runnable: boolean;
  /** What stops every run (no column for an input, too many rows, a recipe that runs nowhere). */
  errors: string[];
  place?: RecipePlace;
}

export interface RecipeRun {
  /** The run's batch (a pipeline's rows share it), its generations, and the studio page a tool run opens in. */
  batchId?: string;
  ids: string[];
  href?: string;
  /** A tool run that couldn't start after the rows before it had (each tool call stands alone). */
  error?: string;
  /** A run in stages (W7): its id (its steps' progress in the skill's dialog), and the steps that start later. */
  skillRun?: string;
  waiting?: string[];
}

export interface EngineCheck {
  engine: RecipeEngine;
  /** `notes`: what stops a real run on this install that isn't the recipe's fault (a provider to connect). */
  plan: { ok: boolean; total: number | null; demo: boolean; errors: string[]; notes: string[] };
  dryRun?: { ok: boolean; problems: string[]; skipped?: string };
  real?: { ok: boolean; problems: string[]; notes: string[]; demo: boolean };
}

export interface VerifyResult {
  ok: boolean;
  engines: EngineCheck[];
  view: RecipeView;
}

// ---------------------------------------------------------------------------
// Shapes: the same chain made again with other words and files (W6's suggestions)

/** One step of a graph as its shape reads it: its model and operation, and the steps it waits for with their slots. */
export interface ShapeNode {
  id: string;
  modelId: string;
  op?: string;
  /** The steps it waits for, in order (createPipeline's `after`, a run's `depends_on`). */
  after: string[];
  /** The slot each of those fills (images, endImage, video…); images when it isn't said. */
  slots?: string[];
}

/** A shape: a stable key, the steps in order (for the words) and how many steps. */
export interface Shape {
  key: string;
  steps: { modelId: string; op?: string }[];
}

/**
 * The shape of a graph of generate steps: the sorted models and operations, and each link as the two steps it joins and
 * the slot it fills. Prompts, inputs and settings don't count, so the same chain made with other words and files has
 * one shape. Steps come in the order they run (a step after the ones it waits for). Null for a graph that isn't one
 * (a step waits for one that isn't in it, or a loop).
 */
export function shapeOf(nodes: ShapeNode[]): Shape | null {
  if (!nodes.length) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const label = (n: ShapeNode) => `${n.modelId}:${n.op ?? ""}`;
  // Each step's depth (how many steps run before it), so equal shapes list their steps alike.
  const depth = new Map<string, number>();
  const visit = (n: ShapeNode, seen: Set<string>): number => {
    if (depth.has(n.id)) return depth.get(n.id)!;
    if (seen.has(n.id)) throw new Error("loop");
    seen.add(n.id);
    let d = 0;
    for (const a of n.after) {
      const p = byId.get(a);
      if (!p) throw new Error("missing");
      d = Math.max(d, visit(p, seen) + 1);
    }
    depth.set(n.id, d);
    return d;
  };
  try {
    for (const n of nodes) visit(n, new Set());
  } catch {
    return null;
  }
  const ordered = [...nodes].sort((a, b) => depth.get(a.id)! - depth.get(b.id)! || label(a).localeCompare(label(b)));
  const steps = ordered.map((n) => `${depth.get(n.id)}|${label(n)}`).sort();
  const links = nodes.flatMap((n) => n.after.map((a, i) => `${depth.get(a)}|${label(byId.get(a)!)}>${depth.get(n.id)}|${label(n)}:${n.slots?.[i] ?? "images"}`)).sort();
  return { key: JSON.stringify([steps, links]), steps: ordered.map((n) => ({ modelId: n.modelId, ...(n.op && { op: n.op }) })) };
}

/** A recipe's generate steps as a graph for shapeOf (a recipe with a tool step has no shape). */
export function recipeShapeNodes(recipe: Pick<Recipe, "steps">, modelId: (id: string) => string = (id) => id): ShapeNode[] | null {
  if (recipe.steps.some((s) => s.kind !== "generate")) return null;
  return (recipe.steps as GenerateStep[]).map((s) => {
    const after = asList(s.after);
    const chain = s.chain ?? (s.request.chain as ChainSlot[] | undefined);
    return { id: s.key, modelId: modelId(String(s.request.modelId)), ...(typeof s.request.op === "string" && { op: s.request.op }), after, slots: after.map((_, i) => chain?.[i]?.slot ?? "images") };
  });
}
