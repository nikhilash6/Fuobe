/**
 * Making a skill from results already made (package W2, docs/research/work2skill-7.md §10): Work2Skill's induction
 * without the screen recording. The server rebuilds the steps behind the picked results from Fuobe's exact records
 * (src/server/recipe-builder.ts: requests, `depends_on`, chain slots) into a draft whose every input is Fixed; the review
 * screen (src/components/skills/skill-builder.tsx) says which inputs vary next time and which words in a prompt are a
 * slot, and this module turns those choices into the recipe (src/lib/recipe.ts) and a SKILL.md body.
 *
 * Pure and browser-safe: the review screen builds the recipe live as the choices change; the server checks and saves it.
 */
import { z } from "zod";
import { SKILL_LIMITS } from "./assist";
import type { Engine, MediaKind } from "./catalog/types";
import { isMediaType, leafKeys, type ParamType, type Recipe, type RecipeParam, type RecipeStep } from "./recipe";

// ---------------------------------------------------------------------------
// What the draft holds

/** One step of the draft as the review screen shows it. */
export interface DraftStep {
  key: string;
  kind: "generate" | "tool";
  /** "Image to video", "Translate & dub". */
  label: string;
  /** The model (a generate step) or the studio (a tool step). */
  modelName: string;
  /** The engine the result ran on. */
  engine?: Engine;
  /** The result the step was rebuilt from, and a still of it. */
  generation: string;
  thumb?: { url: string; kind: MediaKind; poster?: string };
  /** The labels of the steps it waits for, in order. */
  waits: string[];
  /** Nothing waits for it: its count may vary. */
  leaf: boolean;
  /** What changed when it was rebuilt ("Kling 3 was replaced by Kling 3.1"). */
  notes: string[];
}

export type CandidateKind = "media" | "element" | "text" | "setting";

/** Where a candidate's value sits: a step, and the path in its request (or a tool step's input). */
export interface CandidateSpot {
  step: string;
  path: (string | number)[];
}

/** An input that could vary next time. Every one starts Fixed (a templated prompt can lose what made the result good). */
export interface DraftCandidate {
  /** Its input id when it varies (unique in the draft). */
  id: string;
  label: string;
  type: ParamType;
  kind: CandidateKind;
  /** The value it had: a file link, an @handle, the words, a setting. */
  example: string | number;
  /** A media value, a setting or a whole prompt: the value at each spot; an element: the prompts naming it. */
  at: CandidateSpot[];
  /** A setting: an optional input whose default is what it was. */
  optional?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  /** The setting it is (numOutputs, aspectRatio, duration, resolution). */
  setting?: SettingId;
  /** Why it can't vary. */
  locked?: string;
}

export type SettingId = "numOutputs" | "aspectRatio" | "duration" | "resolution";

export interface SkillDraft {
  /** The recipe with every candidate Fixed: no inputs, each value where it was. */
  recipe: Recipe;
  steps: DraftStep[];
  candidates: DraftCandidate[];
  /** Prefilled: a name (/name), a title, a description and when to use it. */
  name: string;
  title: string;
  description: string;
  whenToUse: string;
  /** Made from results the demo provider made: check it on a real engine before trusting it. */
  demo: boolean;
  /** What the review screen says once (a model that moved, a step left as a fixed input). */
  notes: string[];
  /** The LLM the optional naming pass would ask (null: none, so there is none). */
  llm: "claude" | "ollama" | null;
}

/** A picked result the builder couldn't use, and why. */
export interface DraftRefusal {
  id: string;
  title: string;
  reason: string;
}

export const DEMO_NOTE = "Made from demo results: check it on your engine before trusting it";
export const STEPS_REFUSAL = "This was made in steps from one request: open it, press Reuse settings, run it again, then make the skill";

// ---------------------------------------------------------------------------
// Studios: work that plans its own steps from its input

interface StudioInfo {
  name: string;
  /** The Assist tool that makes the same thing from the studio's input. */
  tool?: string;
}

const STUDIOS: [RegExp, StudioInfo][] = [
  [/^dub$/, { name: "Translate & dub", tool: "dub_video" }],
  [/^katana$/, { name: "Katana", tool: "katana" }],
  [/^captions$/, { name: "Captions", tool: "add_captions" }],
  [/^layers$/, { name: "Layers", tool: "split_layers" }],
  [/^shorts$/, { name: "Shorts Studio", tool: "restyle_footage" }],
  [/^faceless/, { name: "Faceless Studio", tool: "faceless_episode" }],
  // An Explainer episode is Faceless's graph (scene stills, narration, Ken Burns, joins), but faceless_episode makes
  // channel episodes only.
  [/^explainer$/, { name: "Explainer" }],
  [/^ads$/, { name: "Ads Studio", tool: "create_ads" }],
  [/^ad-multiplier$/, { name: "Ad Multiplier" }],
  [/^click-to-ad$/, { name: "Click to Ad" }],
  [/^storyboard/, { name: "Storyboard" }],
  [/^cinema/, { name: "Cinema Studio" }],
  [/^genjutsu$/, { name: "Genjutsu" }],
  [/^remove-object$/, { name: "Remove object" }],
  [/^content-factory$/, { name: "Content Factory" }],
  [/^influencer$/, { name: "AI Influencer" }],
  [/^swap-studio$/, { name: "Character Swap Studio" }],
  [/^photodump$/, { name: "Photodump" }],
  [/^character-sheet$/, { name: "Character Sheet" }],
  [/^fashion$/, { name: "Fashion Factory" }],
  [/^mixed-media/, { name: "Mixed Media" }],
  [/^evolution/, { name: "Evolution" }],
  [/^canvas/, { name: "Canvas" }],
  [/^audio-(loop|join)$/, { name: "Audio tools" }],
  [/^moodboard$/, { name: "Moodboards" }],
  [/^eval$/, { name: "the evaluation harness" }],
  [/^skill-check$/, { name: "a skill's check" }],
];

/**
 * Studios whose own results are plain requests (a Marketing Studio picture replays as it was asked) but whose helper
 * steps (`<feature>-step`: a UGC video's shots, a text-to-3D's still) are their planner's, named when refused.
 */
const HELPER_STUDIOS: Record<string, string> = { marketing: "Marketing Studio", "image-to-3d": "Image to 3D" };

/**
 * The studio a feature belongs to when that studio plans its own steps (a helper step `<feature>-step` belongs to its
 * feature's studio), or undefined for a plain request (Image, Video, Edit, Assist, an app…).
 */
export function studioOf(feature: string): StudioInfo | undefined {
  const base = feature.replace(/(-frame)?-step$/, "").replace(/-(preview|avatar|voice)$/, "");
  const found = STUDIOS.find(([re]) => re.test(base))?.[1];
  if (found || base === feature) return found;
  return { name: HELPER_STUDIOS[base] ?? "another studio" };
}

/** The studio an Assist tool makes its work in ("dub_video" → "Translate & dub"; a storyboard is the Storyboard's). */
export function studioForTool(tool: string): string | undefined {
  if (tool === "create_storyboard") return "Storyboard";
  return STUDIOS.find(([, s]) => s.tool === tool)?.[1].name;
}

export const notSupported = (studio: string) => `Made in ${studio}: making a skill from it isn't supported yet`;

/**
 * Step labels an expansion gave its rows before it kept the request as asked (createShotFilm, createKeyframeFilm,
 * createExtendChain, createStillTo3d, createRelitClip in src/server/chains.ts). A heuristic for rows made before W2.
 */
const EXPANSION_LABELS = [/^Shot \d+ of \d+$/, /^Film · \d+ (shots|frames)$/, /^Frames \d+ → \d+$/, /^After frame \d+$/, /^Joining clips$/, /^(Last frame|Continuation|Extended video)$/, /^(Still|3D model)$/, /^(Relit start frame|Relit clip)$/];
export const isExpansionLabel = (label: string | undefined): boolean => !!label && EXPANSION_LABELS.some((re) => re.test(label));

// ---------------------------------------------------------------------------
// The optional naming pass's answer (src/server/recipe-builder.ts nameDraft)

const PARAM_ID = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

export const NamingSchema = z.object({
  name: z.string().trim().max(SKILL_LIMITS.name).optional(),
  title: z.string().trim().min(1).max(SKILL_LIMITS.title).optional(),
  description: z.string().trim().min(1).max(SKILL_LIMITS.description).optional(),
  when_to_use: z.string().trim().min(1).max(SKILL_LIMITS.whenToUse).optional(),
  body: z.string().trim().min(1).max(SKILL_LIMITS.body).optional(),
  inputs: z.array(z.object({ candidate: z.string(), id: z.string().regex(PARAM_ID), label: z.string().trim().min(1).max(60) })).max(40).optional(),
  slots: z.array(z.object({ step: z.string(), text: z.string().min(2).max(200), id: z.string().regex(PARAM_ID), label: z.string().trim().min(1).max(60) })).max(20).optional(),
});

/** A word or phrase in a step's prompt that becomes an input of its own ("a matte black desk lamp" → {{product}}). */
export interface Slot {
  step: string;
  text: string;
  id: string;
  label: string;
}

/** What the naming pass suggests: each shown as a change, each off until ticked. */
export interface Naming {
  name?: string;
  title?: string;
  description?: string;
  whenToUse?: string;
  body?: string;
  inputs: { candidate: string; id: string; label: string }[];
  slots: Slot[];
}

/** The first JSON object in a model's answer (in a ```json fence or not), or null. */
function firstObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const src = fenced ?? text;
  const start = src.indexOf("{");
  const end = src.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(src.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * The naming pass's JSON, checked against the draft: a suggestion for an input or a step the draft doesn't have, or a
 * slot whose words aren't in that step's prompt, is left out. Malformed output gives null (it's ignored).
 */
export function parseNaming(text: string | null | undefined, draft: Pick<SkillDraft, "candidates" | "recipe">): Naming | null {
  if (!text) return null;
  const parsed = NamingSchema.safeParse(firstObject(text));
  if (!parsed.success) return null;
  const n = parsed.data;
  const ids = new Set(draft.candidates.filter((c) => !c.locked).map((c) => c.id));
  const prompts = new Map(draft.recipe.steps.flatMap((s) => (s.kind === "generate" && typeof s.request.prompt === "string" ? [[s.key, s.request.prompt]] : [])));
  const name = n.name ? slugify(n.name) : undefined;
  return {
    ...(name && { name }),
    ...(n.title && { title: n.title }),
    ...(n.description && { description: n.description }),
    ...(n.when_to_use && { whenToUse: n.when_to_use }),
    ...(n.body && { body: n.body }),
    inputs: (n.inputs ?? []).filter((i) => ids.has(i.candidate)),
    slots: (n.slots ?? []).filter((s) => prompts.get(s.step)?.includes(s.text)),
  };
}

// ---------------------------------------------------------------------------
// Names

/** A skill name from words: lowercase, digits and single hyphens (SKILL_NAME_RE), at most 64 characters. */
export function slugify(words: string): string {
  return words
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SKILL_LIMITS.name)
    .replace(/-+$/, "");
}

/** An input id from a label ("Product photo" → product_photo), unique among `taken`. */
export function paramIdFrom(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    label
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^(\d)/, "n$1")
      .slice(0, 28) || "input";
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}_${i}`;
  return id;
}

// ---------------------------------------------------------------------------
// Choices → the recipe

export interface BuilderChoices {
  /** Candidate id → it varies next time (absent: Fixed). */
  varies: Record<string, boolean>;
  /** Candidate id → its label and its input id, when changed. */
  labels?: Record<string, string>;
  ids?: Record<string, string>;
  /** Candidate id → whether the form requires it (media, element and text; default yes). */
  required?: Record<string, boolean>;
  /** Words in prompts that become inputs of their own, accepted one by one. */
  slots?: Slot[];
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const bodyOf = (s: RecipeStep): Record<string, unknown> => (s.kind === "tool" ? s.input : (s.request as Record<string, unknown>));

/** Set the value at `path` in `obj` (lists and objects), creating objects on the way. */
function setAt(obj: Record<string, unknown>, path: (string | number)[], value: unknown): void {
  let cur: Record<string | number, unknown> = obj;
  for (const [i, k] of path.entries()) {
    if (i === path.length - 1) {
      cur[k] = value;
      return;
    }
    if (cur[k] === undefined || cur[k] === null || typeof cur[k] !== "object") cur[k] = typeof path[i + 1] === "number" ? [] : {};
    cur = cur[k] as Record<string | number, unknown>;
  }
}

export function getAt(obj: unknown, path: (string | number)[]): unknown {
  let cur = obj;
  for (const k of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** An @handle as a whole word (not inside a longer handle or an e-mail address). */
const handleRe = (handle: string) => new RegExp(`(?<![\\p{L}\\p{N}_@.-])${escapeRe(handle)}(?![\\p{L}\\p{N}_-])`, "gu");

/** The input id a candidate gets: the one typed, else its own. */
const idOf = (c: DraftCandidate, choices: BuilderChoices) => choices.ids?.[c.id]?.trim() || c.id;

/**
 * The recipe the choices make: each candidate that varies becomes an input and `{{id}}` where its value was (an element
 * is put in for its @handle in the words), each accepted slot replaces its words in every prompt that still has them,
 * and the checks follow (a count or a shape that varies is checked against the input; a length that varies isn't
 * checked). An element or slot that ends up nowhere (every prompt naming it varies as a whole) adds no input.
 */
export function buildRecipe(draft: Pick<SkillDraft, "recipe" | "candidates">, choices: BuilderChoices): Recipe {
  const recipe = clone(draft.recipe);
  const params: RecipeParam[] = [];
  const byKey = new Map(recipe.steps.map((s) => [s.key, s]));
  const checks = recipe.checks ?? {};
  const varying = draft.candidates.filter((c) => choices.varies[c.id] && !c.locked);
  // Elements last: a prompt that varies as a whole has replaced its words by then, so an element named only there
  // finds no @handle and adds no input (the whole prompt's input carries it).
  const order = [...varying.filter((c) => c.kind !== "element"), ...varying.filter((c) => c.kind === "element")];
  const placed: RecipeParam[] = [];
  for (const c of order) {
    const id = idOf(c, choices);
    const label = (choices.labels?.[c.id]?.trim() || c.label).slice(0, 60);
    let used = 0;
    for (const spot of c.at) {
      const step = byKey.get(spot.step);
      if (!step) continue;
      const body = bodyOf(step);
      if (c.kind === "element") {
        const words = getAt(body, spot.path);
        if (typeof words !== "string") continue;
        const next = words.replace(handleRe(String(c.example)), `{{${id}}}`);
        if (next !== words) {
          setAt(body, spot.path, next);
          used++;
        }
        continue;
      }
      setAt(body, spot.path, `{{${id}}}`);
      used++;
      // A count that varies is checked against the input when one job made every result (else it isn't checked: a
      // step whose results came as several jobs has no count check to follow).
      if (c.setting === "numOutputs" && checks[spot.step]) {
        const cur = checks[spot.step].count;
        const rest = { ...checks[spot.step] };
        delete rest.count;
        checks[spot.step] = cur === c.example ? { ...rest, count: `{{${id}}}` } : rest;
      }
      if (c.setting === "aspectRatio" && checks[spot.step]) checks[spot.step] = { ...checks[spot.step], aspect: `{{${id}}}` };
      if (c.setting === "duration" && checks[spot.step]) {
        const rest = { ...checks[spot.step] };
        delete rest.seconds;
        checks[spot.step] = rest;
      }
    }
    if (!used) continue;
    const required = c.optional ? false : (choices.required?.[c.id] ?? true);
    placed.push({
      id,
      label,
      type: c.type,
      ...(required && { required: true }),
      ...(c.optional ? { default: c.example } : { example: c.example }),
      ...(c.options && { options: c.options }),
      ...(c.min !== undefined && { min: c.min }),
      ...(c.max !== undefined && { max: c.max }),
      ...(c.step !== undefined && { step: c.step }),
    });
  }
  // Slots: their words in every prompt that still has them (the same words are the same input everywhere).
  const slotParams: RecipeParam[] = [];
  for (const slot of choices.slots ?? []) {
    if (!slot.text.trim() || slotParams.some((p) => p.id === slot.id)) continue;
    let used = 0;
    for (const s of recipe.steps) {
      if (s.kind !== "generate" || typeof s.request.prompt !== "string" || !s.request.prompt.includes(slot.text)) continue;
      s.request.prompt = s.request.prompt.split(slot.text).join(`{{${slot.id}}}`);
      used++;
    }
    if (used) slotParams.push({ id: slot.id, label: slot.label.slice(0, 60), type: "text", required: true, example: slot.text, max: Math.max(200, slot.text.length) });
  }
  // The form's order: files first, then elements, words, settings.
  const rank = (p: RecipeParam) => (isMediaType(p.type) ? 0 : p.type === "element" ? 1 : p.type === "text" ? 2 : 3);
  params.push(...[...placed, ...slotParams].sort((a, b) => rank(a) - rank(b)));
  recipe.params = params;
  if (Object.keys(checks).length) recipe.checks = checks;
  return recipe;
}

// ---------------------------------------------------------------------------
// SKILL.md

const TYPE_WORDS: Record<ParamType, string> = { image: "an image", video: "a video", audio: "an audio file", text: "words", number: "a number", choice: "one of", element: "a saved element (@handle)" };
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function inputLine(p: RecipeParam): string {
  const what = p.type === "choice" ? `${TYPE_WORDS.choice} ${(p.options ?? []).join(", ")}` : TYPE_WORDS[p.type];
  const need = p.default !== undefined ? `default ${String(p.default)}` : p.required ? "required" : "optional";
  const was = p.example !== undefined && p.example !== null && !isMediaType(p.type) ? `; first made with “${cut(String(p.example), 120)}”` : "";
  return `- **${p.label}** (\`${p.id}\`) — ${what}, ${need}${was}.`;
}

function checkLine(key: string, steps: Pick<DraftStep, "key" | "label">[], c: NonNullable<Recipe["checks"]>[string]): string | null {
  const parts = [
    c.count !== undefined ? `${typeof c.count === "number" ? c.count : c.count} ${c.kind ?? "result"}${c.count === 1 ? "" : "s"}` : c.kind ? `a ${c.kind}` : "",
    c.aspect ? `${c.aspect}` : "",
    c.seconds !== undefined ? (Array.isArray(c.seconds) ? `${c.seconds[0]}–${c.seconds[1]} s` : `about ${c.seconds} s`) : "",
    c.sound === undefined ? "" : c.sound ? "with sound" : "silent",
    c.look ? `showing ${c.look}` : "",
  ].filter(Boolean);
  if (!parts.length) return null;
  const label = steps.find((s) => s.key === key)?.label ?? key;
  return `- ${label}: ${parts.join(", ")}.`;
}

/**
 * The SKILL.md body written from the recipe, with no LLM: the inputs, the steps in order with what each waits for, the
 * checks of a finished run, and how an agent runs it. Deterministic: the same recipe gives the same text.
 */
export function skillBody(recipe: Recipe, draft: Pick<SkillDraft, "steps">, meta: { title: string; description: string; name?: string }): string {
  const info = new Map(draft.steps.map((s) => [s.key, s]));
  const keys = recipe.steps.map((s) => s.key);
  const leaves = leafKeys(recipe);
  const stepLines = recipe.steps.map((s, i) => {
    const d = info.get(s.key);
    if (s.kind === "tool") return `${i + 1}. **${d?.label ?? s.tool}** — the studio tool \`${s.tool}\`, with the inputs below.`;
    const r = s.request;
    const waits = (Array.isArray(s.after) ? s.after : s.after ? [s.after] : []).map((a) => `step ${keys.indexOf(a) + 1}`);
    const words = typeof r.prompt === "string" && r.prompt.trim() ? ` — “${cut(r.prompt.trim(), 280)}”` : "";
    return `${i + 1}. **${d?.label ?? r.op ?? "Generate"}** with ${d?.modelName ?? r.modelId}${words}${waits.length ? `, from the result of ${waits.join(" and ")}` : ""}${leaves.has(s.key) && recipe.steps.length > 1 ? " (a result you keep)" : ""}.`;
  });
  const checkLines = Object.entries(recipe.checks ?? {}).flatMap(([k, c]) => {
    const line = checkLine(k, draft.steps, c);
    return line ? [line] : [];
  });
  const values = Object.fromEntries(recipe.params.map((p) => [p.id, `<${p.label.toLowerCase()}>`]));
  return [
    `# ${meta.title}`,
    "",
    meta.description,
    "",
    "## Inputs",
    ...(recipe.params.length ? recipe.params.map(inputLine) : ["It takes no inputs: each run makes the same thing again, as a new take."]),
    "",
    "## Steps",
    "Run them in this order; each one takes the result of the step it names.",
    ...stepLines,
    "",
    ...(checkLines.length ? ["## When it's done", "A finished run is checked by its structure, never by its pixels:", ...checkLines, ""] : []),
    "## Using Fuobe from an agent",
    `In Fuobe this skill runs by itself: Skills → ${meta.name ? `/${meta.name}` : "this skill"} → Run…, priced before anything starts, with no LLM. Over Fuobe's MCP server, \`run_skill\` runs it${meta.name ? ` (\`${JSON.stringify({ name: meta.name, values })}\`)` : ""}; where that tool isn't available, the "Run it" section Fuobe adds when the skill is loaded gives the equivalent \`generate\` or studio tool call. Price it first with \`estimate_cost\` (\`estimate_job\` for a studio tool) and confirm with the user.`,
  ].join("\n");
}
