/**
 * Assist: a chat agent that plans a shoot, picks models, shows the cost, asks before spending
 * and then runs the generations (Higgsfield's "Supercomputer"). Shared by the server loop and the UI.
 *
 * Besides the chat itself this holds the pure parts of Skills (SKILL.md parsing and validation,
 * `/name` invocation), Memory (categories, import parsing) and the context the agent is given
 * (rendered once per chat, then updated with append-only "Context update" messages).
 */
import { getLlmModel } from "./catalog/llm-providers";
import type { Engine, Generation, MediaKind, Operation } from "./catalog/types";

/** One job the agent wants to run, priced before the user approves it. */
export interface PlannedJob {
  /** The tool that would run it (generate, create_storyboard, katana, remember, a studio tool…). */
  tool: string;
  modelId: string;
  modelName: string;
  kind: MediaKind;
  /** "memory" for a note the agent wants to remember (no cost). */
  op: Operation | "storyboard" | "memory";
  prompt: string;
  /** Generations this job creates (outputs × jobs, or storyboard frames). */
  count: number;
  costUsd: number | null;
  /** No provider connected: it would run as a demo. */
  demo: boolean;
  /** Can't run as planned (missing input, model blocked by engine mode…). */
  error?: string;
  /** A short extra line on the card (a studio's step, what a step waits for). */
  note?: string;
  /** One step of a pipeline: it only starts when every step can, so one error blocks the run. */
  atomic?: boolean;
}

/** Whether an approval card's plan can run: something to run, and no pipeline with a broken step. */
export const planRunnable = (jobs: PlannedJob[]): boolean => jobs.some((j) => !j.error) && !jobs.some((j) => j.atomic && j.error);

/** The line under a "Remember this?" card: nothing is saved until the person says yes, and nothing when they don't. */
export const memoryCardLine = (status: "pending" | "approved" | "declined"): string =>
  status === "approved" ? "Saved to memory for future chats" : status === "declined" ? "Not saved to memory" : "Saves to memory for future chats";

export type AssistItem =
  | { id: string; role: "user"; text: string; attachments?: string[]; skills?: string[] }
  | { id: string; role: "assistant"; text: string }
  /** `studio`: a job a studio took ("Layers"); its card offers "Open in Layers" (href). `connector`: a tool of a custom MCP connector Claude used. */
  | { id: string; role: "tool"; text: string; href?: string; studio?: string; connector?: string; failed?: boolean }
  /** `opens`: the studios the plan's jobs open in; `notes`: why a studio job runs in the Library instead. */
  | { id: string; role: "approval"; summary: string; jobs: PlannedJob[]; totalUsd: number | null; status: "pending" | "approved" | "declined"; opens?: string[]; notes?: string[] }
  | { id: string; role: "generations"; ids: string[]; storyboard?: boolean }
  | { id: string; role: "notice"; text: string; tone: "info" | "error" };

export type AssistStatus = "idle" | "running" | "waiting";

export type AssistAgent = "claude" | "hosted" | "local" | "offline";

/** Chats saved before LM Studio and Unsloth Studio came along call the local model "ollama". */
export const normalizeAgent = (a: string | null | undefined): AssistAgent | undefined =>
  a === "ollama" ? "local" : a === "claude" || a === "hosted" || a === "local" || a === "offline" ? a : undefined;

export interface AssistThread {
  id: string;
  title: string;
  status: AssistStatus;
  /**
   * "claude" = Claude; "hosted" = another provider's model on the owner's key (OpenAI, Gemini, DeepSeek, OpenRouter…);
   * "local" = a local model (Ollama, LM Studio, Unsloth Studio…); "offline" = a rule-based planner (no LLM).
   */
  agent: AssistAgent;
  engine: Engine;
  /** Run plans without the approval card. */
  autoApprove: boolean;
  items: AssistItem[];
  createdAt: number;
  updatedAt: number;
  /** The project this chat belongs to (null: a personal chat). */
  projectId?: string | null;
  /** How the LLM was chosen (Free / Smart / Manual). */
  mode?: AssistMode;
  /** The model's id at its provider, or the local model's name (null: the default). */
  model?: string | null;
  /** Hosted models: the provider ("openai", "openrouter"…; src/lib/catalog/llm-providers.ts). */
  provider?: string | null;
  effort?: AssistEffort | null;
  /** Skills loaded into this chat (by `/name` or by the agent). */
  skills?: string[];
  /** The scheduled task that started this chat. */
  scheduleId?: string;
  /** Auto-run's cost cap for this chat (a scheduled run's), and what ran without asking has cost. */
  capUsd?: number;
  spentUsd?: number;
}

export interface AssistThreadSummary {
  id: string;
  title: string;
  status: AssistStatus;
  updatedAt: number;
  projectId?: string | null;
}

export interface AssistThreadView {
  thread: AssistThread;
  /** Generations referenced by the thread's cards. */
  generations: Generation[];
}

export const totalCost = (jobs: PlannedJob[]): number | null =>
  jobs.some((j) => j.costUsd === null && !j.demo) ? null : Math.round(jobs.reduce((s, j) => s + (j.costUsd ?? 0), 0) * 1000) / 1000;

export function threadTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 60 ? `${t.slice(0, 57).replace(/\s+\S*$/, "")}…` : t || "New chat";
}

/**
 * The starter requests on Assist's empty page. Each one must plan right without an LLM too
 * (tests/assist-suggestions.test.ts runs them through the offline planner).
 */
export const ASSIST_SUGGESTIONS = [
  "A 3-shot product ad for a matte black perfume bottle — hero still, then animate it",
  "Four moody portraits of a lighthouse keeper, 35mm film, then pick the best and animate it",
  "Storyboard a 6-frame heist in Paris at night",
  "A 10-second vertical video of a fox running through snow, with sound",
] as const;

/** The longest prompt a link can type into a new chat (/assist?prompt=). */
export const ASSIST_PROMPT_MAX = 2000;

/**
 * What a new chat's composer starts with, from its address: "/name " for ?skill=<name> (a skill's "Use in a new
 * chat"), else ?prompt=<text> (Home's examples), cut to ASSIST_PROMPT_MAX. Nothing is sent until the viewer sends it.
 */
export function assistDraft(skill: string | null, prompt: string | null): string {
  if (skill) return /^[a-z0-9-]+$/.test(skill) ? `/${skill} ` : "";
  return (prompt ?? "").slice(0, ASSIST_PROMPT_MAX);
}

// ---------------------------------------------------------------------------
// Modes (Supercomputer's Free / Smart / Manual)

export type AssistMode = "free" | "smart" | "manual";
export type AssistEffort = "low" | "medium" | "high" | "xhigh" | "max";

export const ASSIST_MODES: { id: AssistMode; label: string; hint: string }[] = [
  { id: "smart", label: "Smart", hint: "The best model you've connected plans, picks models and checks results" },
  { id: "free", label: "Free", hint: "Free models only (on this machine, OpenRouter's free models, free plans), then the offline planner" },
  { id: "manual", label: "Manual", hint: "Pick the model and how hard it thinks" },
];

export const ASSIST_EFFORTS: { id: AssistEffort; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra" },
  { id: "max", label: "Max" },
];

/** Claude models Manual mode offers (all take adaptive thinking, effort and mid-chat system messages). */
export const CLAUDE_MODELS: { id: string; label: string; hint: string }[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "Best plans — the Smart default" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "Faster, about half the price" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", hint: "Fastest and cheapest" },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", hint: "Most capable, slowest, priciest" },
];
export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";
export const DEFAULT_EFFORT: AssistEffort = "medium";

/** What the composer's mode picker sends. `agent`, `provider` and `model` only matter in Manual mode. */
export interface AssistModeChoice {
  mode: AssistMode;
  agent?: AssistAgent;
  /** Hosted models: the provider of `model`. */
  provider?: string | null;
  model?: string | null;
  effort?: AssistEffort | null;
}

/** A chat's mode as the picker shows it and Schedule this request saves it: with a hosted model's provider, or Manual can't find the model. */
export const threadModeChoice = (t: Pick<AssistThread, "mode" | "agent" | "provider" | "model" | "effort">): AssistModeChoice => ({
  mode: t.mode ?? "smart",
  agent: t.agent,
  provider: t.provider ?? null,
  model: t.model ?? null,
  effort: t.effort ?? null,
});

/** A model the mode picker offers (GET /api/assist): words and flags only, never a key or an address. */
export interface AssistModelOption {
  provider: string;
  model: string;
  name: string;
  providerLabel: string;
  agent: "claude" | "hosted" | "local";
  /** "$2 in, $10 out per million tokens", "Free · 20 a minute, 50 a day". */
  price: string;
  note?: string;
  /** "Open weights · MIT · runs on DeepSeek's servers". */
  open?: string;
  caveat?: string;
  sees: boolean;
  free: boolean;
  /** The effort levels it offers. */
  efforts: AssistEffort[];
  /** Why it can't be picked now. */
  disabled?: string;
  /** Smart and Free never pick it ("Most capable, slowest, priciest"). */
  manualOnly?: string;
}

/** The local model server behind Free and Manual's local models (Ollama, LM Studio, Unsloth Studio, or another OpenAI-compatible one). */
export interface AssistLocal {
  /** "ollama" | "lmstudio" | "unsloth" | "custom"; null: Automatic found none. */
  kind: string | null;
  /** "LM Studio"; "a local model" when Automatic found none. */
  label: string;
  /** It answers and has a model to use. */
  ok: boolean;
  /** Its chat models (Manual mode lists them). */
  models: string[];
  /** The model a chat uses by default. */
  model: string | null;
  /** Why it can't run (needs a key, no model loaded…). */
  problem?: string;
}

/** What the server can run right now (GET /api/assist). */
export interface AssistAvailability {
  /** An Anthropic key is set and Settings allows Claude here. */
  claude: boolean;
  /** The local model server Free and Manual use. */
  local: AssistLocal;
  /** Settings → AI helper is "none": every chat runs the offline planner. */
  aiOff: boolean;
  /** Smart when its planner is a paid model, else Free. */
  defaultMode: AssistMode;
  /** The model Smart plans with, the one that checks pictures for a planner that can't, and the sentence that says so. */
  smart: { plan: AssistModelOption | null; check: AssistModelOption | null; text: string };
  /** The model Free runs on and the sentence that says so (with its limits). */
  free: { pick: AssistModelOption | null; text: string; caveat?: string };
  /** Manual: the connected providers' models, grouped, and the providers without a key. */
  manual: { groups: { id: string; label: string; status: string; models: AssistModelOption[] }[]; missing: { id: string; label: string }[] };
  /** Settings → Engine is Open source only: only open-weight models run. */
  openOnly: boolean;
  /** The day the model list was last checked against the providers' pages. */
  checked: string;
}

/** "Smart · GPT-6.1 Sol", "Free · Nemotron 3 Ultra", "GPT-6.1 Sol · Medium" (Manual), "Offline planner". */
export function modeLabel(t: Pick<AssistThread, "mode" | "agent" | "model" | "effort" | "provider">): string {
  if (t.agent === "offline") return "Offline planner";
  const effort = ASSIST_EFFORTS.find((e) => e.id === (t.effort ?? DEFAULT_EFFORT))?.label;
  let name: string;
  if (t.agent === "local") {
    if (t.mode === "manual" || !t.model) return t.model ? `Local · ${t.model}` : "Local LLM";
    name = t.model;
  } else if (t.agent === "hosted") {
    name = getLlmModel(t.provider, t.model)?.name ?? t.model ?? "a hosted model";
    if (t.mode === "manual") return `${name} · ${effort}`;
  } else {
    const m = CLAUDE_MODELS.find((x) => x.id === (t.model ?? DEFAULT_CLAUDE_MODEL));
    if (t.mode === "manual") return `${m?.label.replace("Claude ", "") ?? t.model} · ${effort}`;
    name = m?.label ?? "Claude";
  }
  return `${t.mode === "free" ? "Free" : "Smart"} · ${name}`;
}

// ---------------------------------------------------------------------------
// Skills: SKILL.md (frontmatter + Markdown body), as Anthropic's Agent Skills and Supercomputer use.
// The Agent Skills spec (agentskills.io) allows only name, description, license, compatibility,
// allowed-tools and a string-to-string `metadata` map at the top, so Fuobe's own fields (title,
// when_to_use, icon, studio, tags, and the offline hints as offline_kind / offline_aspect /
// offline_outputs / offline_style) live under `metadata`. Older files with them at the top still parse.

export interface SkillMeta {
  /** The id and the `/name` that loads it: lowercase letters, numbers and hyphens. */
  name: string;
  title: string;
  description: string;
  whenToUse: string;
  /** A lucide icon name from SKILL_ICONS. */
  icon?: string;
  /** A Fuobe page that does the same job by hand. */
  studio?: string;
  tags?: string[];
  /** Hints for the offline planner (no LLM): the kind of job and its defaults. */
  offline?: { kind?: "image" | "video" | "audio" | "text"; aspect?: string; outputs?: number; style?: string };
}

export interface Skill extends SkillMeta {
  body: string;
  source: "builtin" | "user";
  enabled: boolean;
  /** Extra files that came with an uploaded skill (references, examples), readable with load_skill. */
  files: { path: string; size: number }[];
  /** Its files hold a valid recipe.json: it runs by itself from a form, with no LLM (src/lib/recipe.ts). */
  recipe?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** What lists show (no body). */
export type SkillSummary = Omit<Skill, "body"> & { chars: number };

export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SKILL_LIMITS = { name: 64, title: 80, description: 1024, whenToUse: 1024, body: 60_000 };

const FRONTMATTER = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

type Yamlish = string | string[] | Record<string, string>;

/** A small YAML subset: `key: value`, quoted values, `|`/`>` blocks, `- item` lists and one level of nested maps. */
export function parseFrontmatter(src: string): Record<string, Yamlish> {
  const out: Record<string, Yamlish> = {};
  const lines = src.split(/\r?\n/);
  const unquote = (v: string) => {
    const t = v.trim();
    if ((t.startsWith('"') && t.endsWith('"') && t.length > 1) || (t.startsWith("'") && t.endsWith("'") && t.length > 1)) {
      if (t.startsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
      // Double-quoted scalars use JSON's escapes (toSkillMd writes them with JSON.stringify).
      try {
        const v = JSON.parse(t) as unknown;
        if (typeof v === "string") return v;
      } catch {
        // Not valid JSON (a lone backslash…): unescape the common cases only.
      }
      return t.slice(1, -1).replace(/\\(["\\])/g, "$1").replace(/\\n/g, "\n");
    }
    return t.replace(/\s+#.*$/, "");
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#") || /^\s/.test(line)) continue;
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase().replace(/-/g, "_");
    const rest = m[2];
    // Indented lines that follow belong to this key.
    const block: string[] = [];
    while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || (!lines[i + 1].trim() && i + 2 < lines.length && /^\s+\S/.test(lines[i + 2])))) block.push(lines[++i]);
    if (/^[|>][+-]?\s*$/.test(rest.trim())) {
      const indent = Math.min(...block.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length));
      const text = block.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
      out[key] = rest.trim().startsWith(">") ? text.join("\n").replace(/([^\n])\n(?=[^\n])/g, "$1 ").trim() : text.join("\n").trim();
    } else if (rest.trim()) {
      const v = rest.trim();
      out[key] = v.startsWith("[") && v.endsWith("]") ? v.slice(1, -1).split(",").map(unquote).filter(Boolean) : unquote(v);
    } else if (block.some((l) => /^\s*-\s/.test(l))) {
      out[key] = block.filter((l) => /^\s*-\s/.test(l)).map((l) => unquote(l.replace(/^\s*-\s/, "")));
    } else {
      const map: Record<string, string> = {};
      for (const l of block) {
        const mm = /^\s+([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(l);
        if (mm) map[mm[1].toLowerCase().replace(/-/g, "_")] = unquote(mm[2]);
      }
      out[key] = map;
    }
  }
  return out;
}

const str = (v: Yamlish | undefined): string | undefined => (typeof v === "string" ? v : Array.isArray(v) ? v.join(", ") : undefined);

export type SkillParse = { ok: true; skill: SkillMeta & { body: string } } | { ok: false; error: string };

const titleFromName = (name: string) => name.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

/** The offline hints written the spec's way: `metadata.offline_kind`, `offline_aspect`, `offline_outputs`, `offline_style`. */
function offlineFromMetadata(meta: Record<string, string>): Record<string, string> | undefined {
  const hints = Object.fromEntries(Object.entries(meta).flatMap(([k, v]) => (k.startsWith("offline_") && typeof v === "string" ? [[k.slice("offline_".length), v]] : [])));
  return Object.keys(hints).length ? hints : undefined;
}

/** Parse and validate a SKILL.md. Errors are user-facing ("Check SKILL.md and try again: …"). */
export function parseSkillMd(text: string): SkillParse {
  const fail = (why: string): SkillParse => ({ ok: false, error: `Check SKILL.md and try again: ${why}` });
  const m = FRONTMATTER.exec(text);
  if (!m) return fail("it needs a frontmatter block between --- lines at the top, with a name and a description.");
  const fm = parseFrontmatter(m[1]);
  const name = str(fm.name)?.trim() ?? "";
  if (!name) return fail("the frontmatter has no name.");
  if (name.length > SKILL_LIMITS.name || !SKILL_NAME_RE.test(name)) return fail(`“${name.slice(0, 70)}” isn't a valid name — use lowercase letters, numbers and hyphens (up to ${SKILL_LIMITS.name} characters), e.g. product-photos.`);
  const meta = (fm.metadata && typeof fm.metadata === "object" && !Array.isArray(fm.metadata) ? fm.metadata : {}) as Record<string, string>;
  const description = (str(fm.description) ?? "").trim();
  if (!description) return fail("the frontmatter has no description (what the skill does and when to use it).");
  if (description.length > SKILL_LIMITS.description) return fail(`the description is ${description.length} characters; keep it under ${SKILL_LIMITS.description}.`);
  const whenToUse = (str(fm.when_to_use) ?? str(fm.whentouse) ?? meta.when_to_use ?? "").trim();
  if (whenToUse.length > SKILL_LIMITS.whenToUse) return fail(`“when to use” is ${whenToUse.length} characters; keep it under ${SKILL_LIMITS.whenToUse}.`);
  const title = (str(fm.title) ?? str(fm.display_name) ?? meta.title ?? meta.display_name ?? titleFromName(name)).trim().slice(0, SKILL_LIMITS.title);
  const body = text.slice(m[0].length).trim();
  if (!body) return fail("there are no instructions under the frontmatter.");
  if (body.length > SKILL_LIMITS.body) return fail(`the instructions are ${Math.round(body.length / 1000)}k characters; keep them under ${SKILL_LIMITS.body / 1000}k (move long references into separate files).`);
  const offlineMap = fm.offline && typeof fm.offline === "object" && !Array.isArray(fm.offline) ? (fm.offline as Record<string, string>) : offlineFromMetadata(meta);
  const kind = offlineMap?.kind;
  const tags = Array.isArray(fm.tags) ? fm.tags : (str(fm.tags) ?? meta.tags)?.split(",").map((t) => t.trim()).filter(Boolean);
  const icon = str(fm.icon) ?? meta.icon;
  const studio = str(fm.studio) ?? meta.studio;
  return {
    ok: true,
    skill: {
      name,
      title,
      description,
      whenToUse,
      body,
      ...(icon && { icon }),
      ...(studio && { studio }),
      ...(tags?.length && { tags: tags.slice(0, 8) }),
      ...(offlineMap && {
        offline: {
          ...(kind === "image" || kind === "video" || kind === "audio" || kind === "text" ? { kind } : {}),
          ...(offlineMap.aspect && { aspect: offlineMap.aspect }),
          ...(Number(offlineMap.outputs) > 0 && { outputs: Math.min(4, Math.round(Number(offlineMap.outputs))) }),
          ...(offlineMap.style && { style: offlineMap.style }),
        },
      }),
    },
  };
}

/** A YAML scalar: plain when that can't be read as anything else (a number, a boolean, an anchor…), else JSON-quoted. */
const yamlValue = (v: string) => (/^[A-Za-z_/(][\w ./(),&+-]*$/.test(v) && !/\s$/.test(v) && !/^(true|false|null|yes|no|on|off|y|n)$/i.test(v) ? v : JSON.stringify(v));

const oneLine = (v: string) => v.replace(/\s*\n\s*/g, " ");

/**
 * Write a skill back out as SKILL.md (export, and the form's "Create skill"), in the Agent Skills
 * layout: the spec's fields at the top, Fuobe's under `metadata` (one line each, strings only), so
 * the file also loads in Claude Code, claude.ai and other agents' skill folders.
 */
export function toSkillMd(s: Pick<SkillMeta, "name" | "title" | "description" | "whenToUse" | "icon" | "studio" | "tags" | "offline"> & { body: string }): string {
  const meta: [string, string | number | undefined][] = [
    ["title", s.title],
    ["when_to_use", s.whenToUse && oneLine(s.whenToUse)],
    ["icon", s.icon],
    ["studio", s.studio],
    ["tags", s.tags?.length ? s.tags.join(", ") : undefined],
    ["offline_kind", s.offline?.kind],
    ["offline_aspect", s.offline?.aspect],
    ["offline_outputs", s.offline?.outputs],
    ["offline_style", s.offline?.style],
  ];
  const lines = ["---", `name: ${s.name}`, `description: ${yamlValue(oneLine(s.description))}`, "metadata:"];
  // Numbers are quoted: the spec's metadata maps strings to strings.
  for (const [k, v] of meta) if (v !== undefined && v !== "") lines.push(`  ${k}: ${typeof v === "number" ? JSON.stringify(String(v)) : yamlValue(v)}`);
  lines.push("---", "", s.body.trim(), "");
  return lines.join("\n");
}

/** A name from a title ("Product photos!" → "product-photos"). */
export function skillSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, SKILL_LIMITS.name)
      .replace(/-+$/, "") || "my-skill"
  );
}

/**
 * Leading `/name` tokens of a message: "/product-photoshoot /thumbnail-generation a coffee ad"
 * → skills [product-photoshoot, thumbnail-generation], text "a coffee ad". Unknown names stay in the text.
 */
export function slashSkills(text: string, known: (name: string) => boolean): { skills: string[]; text: string } {
  const skills: string[] = [];
  let rest = text.trimStart();
  for (;;) {
    const m = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/.exec(rest);
    if (!m || !known(m[1])) break;
    if (!skills.includes(m[1])) skills.push(m[1]);
    rest = rest.slice(m[0].length).trimStart();
  }
  return { skills, text: rest };
}

/** Where the skill tokens at the start of a message end (after the space that follows them). */
function skillTokensEnd(text: string, known: (name: string) => boolean): number {
  let pos = /^\s*/.exec(text)![0].length;
  for (;;) {
    const m = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/.exec(text.slice(pos));
    if (!m || !known(m[1])) return pos;
    pos += m[0].length;
    pos += /^\s*/.exec(text.slice(pos))![0].length;
  }
}

/**
 * The composer's "Use a skill" button: open a `/` after the skills already chosen (never inside
 * one), keeping the rest of the message. A lone `/`, or the start of a skill's name, already there
 * just gets the caret.
 */
export function insertSlash(text: string, names: readonly string[]): { text: string; caret: number } {
  const pos = skillTokensEnd(text, (n) => names.includes(n));
  const partial = /^\/([a-z0-9-]*)(?=\s|$)/.exec(text.slice(pos));
  if (partial && names.some((n) => n.startsWith(partial[1]))) return { text, caret: pos + partial[0].length };
  const head = text.slice(0, pos);
  const gap = head && !/\s$/.test(head) ? " " : "";
  const rest = text.slice(pos);
  return { text: `${head}${gap}/${rest ? ` ${rest}` : ""}`, caret: pos + gap.length + 1 };
}

/** Put a picked skill in place of the `/partial` that starts at `start` (the caret is in or after it). */
export function pickSlash(text: string, caret: number, start: number, name: string): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(caret).replace(/^\S*/, "").replace(/^\s*/, "");
  return { text: `${before}/${name} ${after}`, caret: before.length + name.length + 2 };
}

/** The `/partial` being typed at the caret, for the composer's skill menu (null when none). */
export function slashQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(?:^|\s)\/([a-z0-9-]*)$/.exec(before);
  if (!m) return null;
  // Only skill tokens at the start of the message (after other skill tokens) are recognised.
  const start = before.length - m[1].length - 1;
  if (!/^(\s*\/[a-z0-9-]+)*\s*$/.test(text.slice(0, start))) return null;
  return { start, query: m[1] };
}

// ---------------------------------------------------------------------------
// Memory

export const MEMORY_CATEGORIES = ["Preference", "Style", "Communication", "Convention", "Environment", "Tooling", "Troubleshooting", "Notes"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MEMORY_HINTS: Record<MemoryCategory, string> = {
  Preference: "Formats, lengths, models you like",
  Style: "Looks, palettes, moods, references",
  Communication: "How Assist should talk to you",
  Convention: "Naming, aspect ratios, brand rules",
  Environment: "Your setup: GPU, keys, where things live",
  Tooling: "Models and studios to use or avoid",
  Troubleshooting: "Fixes that worked before",
  Notes: "Anything else worth keeping",
};

export type MemoryScope = "personal" | "project";

export interface AssistMemory {
  id: string;
  scope: MemoryScope;
  projectId: string | null;
  category: MemoryCategory;
  text: string;
  /** Who wrote it: you on the Memory page, the agent (remember), or an import. */
  source: "user" | "agent" | "import";
  createdAt: number;
  updatedAt: number;
}

export const MEMORY_MAX_CHARS = 500;

const CATEGORY_WORDS: [MemoryCategory, RegExp][] = [
  ["Communication", /\b(reply|replies|respond|answer|tone|concise|brief|verbose|explain|language|speak|call me|address me|emoji|bullet)/i],
  ["Style", /\b(style|look|aesthetic|palette|colou?rs?|mood|lighting|film|cinematic|minimal|vibe|font|typography|grain)\b/i],
  ["Convention", /\b(always|never|naming|name files|format|aspect|9:16|16:9|1:1|4:5|brand|logo|watermark|caption|hashtag)/i],
  ["Environment", /\b(gpu|vram|cuda|mac|windows|linux|server|machine|install|comfyui|ollama|api key|disk|folder|path)\b/i],
  ["Tooling", /\b(model|seedance|kling|veo|flux|wan|nano banana|midjourney|elevenlabs|studio|tool|workflow|plugin)\b/i],
  ["Troubleshooting", /\b(fix|fixed|error|fails?|failed|crash|bug|workaround|broken|issue)\b/i],
  ["Preference", /\b(prefer|like|love|hate|dislike|favou?rite|want|rather|usually|tend to)\b/i],
];

export function guessCategory(text: string): MemoryCategory {
  return CATEGORY_WORDS.find(([, re]) => re.test(text))?.[0] ?? "Notes";
}

const CATEGORY_ALIASES: Record<string, MemoryCategory> = {
  preference: "Preference",
  preferences: "Preference",
  style: "Style",
  "coding style": "Style",
  "visual style": "Style",
  communication: "Communication",
  convention: "Convention",
  conventions: "Convention",
  environment: "Environment",
  tooling: "Tooling",
  tools: "Tooling",
  troubleshooting: "Troubleshooting",
  notes: "Notes",
  note: "Notes",
  other: "Notes",
  misc: "Notes",
  general: "Notes",
};

/** Lines an assistant writes around its list, not memories ("Here's what I remember:", "Let me know…"). */
const BOILERPLATE = [
  /^(?:here(?:'|’)?s|here (?:is|are)|below (?:is|are)|these are|this is|that's|that is)\b.*\b(?:memor\w*|remember\w*|know|saved|stored|things)\b.*$/i,
  /^(?:let me know|feel free|is there anything|if you(?:'|’)?d like|if you want|want me to|would you like|i can (?:also )?(?:update|forget|add))\b/i,
  /^(?:memories|memory|saved memories|my memories|your memories|what i (?:know|remember)(?: about you)?)$/i,
];

/** Leading dates some exports put on each memory ("2025-03-12:", "[12/03/2025]", "March 12, 2025 —"). */
const LEADING_DATE =
  /^\[?(?:\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?Z?)?|\d{1,2}[/.]\d{1,2}[/.]\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4})\]?\s*(?:[:—–-]\s*)?/i;

/** Markdown emphasis and code marks around words (**Name**, __x__, `y`). */
const stripMarks = (s: string) => s.replace(/(\*\*|__)(.+?)\1/g, "$2").replace(/(^|\s)[*_](\S(?:.*?\S)?)[*_](?=\s|[:.,;!?]|$)/g, "$1$2").replace(/`([^`]+)`/g, "$1");

/** "Sure! Here's…" → "Here's…"; "I remember that you prefer…" → "You prefer…". */
const stripLeadIn = (s: string) =>
  s
    .replace(/^(?:sure|of course|certainly|okay|ok|absolutely|great)\b[,!.]*\s*/i, "")
    .replace(/^i (?:remember|know|recall|noted|have saved)(?: that)?\s+(?=you\b)/i, "")
    .replace(/^you\b/, "You");

export const toCategory = (s: string | undefined): MemoryCategory | undefined => (s ? CATEGORY_ALIASES[s.trim().toLowerCase()] : undefined);

/**
 * Memories pasted from another assistant (Claude, ChatGPT, Codex…): one per bullet, numbered item
 * or line. A heading or a "Category:" prefix sets the category; otherwise it's guessed from the
 * words. Boilerplate ("Here is what I remember…"), duplicates and very short lines are dropped.
 */
export function parseMemoryImport(text: string): { category: MemoryCategory; text: string }[] {
  const out: { category: MemoryCategory; text: string }[] = [];
  const seen = new Set<string>();
  let heading: MemoryCategory | undefined;
  let jsonItems: unknown[] | null = null;
  try {
    const j = JSON.parse(text) as unknown;
    if (Array.isArray(j)) jsonItems = j;
    else if (j && typeof j === "object" && Array.isArray((j as { memories?: unknown[] }).memories)) jsonItems = (j as { memories: unknown[] }).memories;
  } catch {
    // Plain text.
  }
  const add = (raw: string, cat?: MemoryCategory) => {
    let t = stripLeadIn(stripMarks(raw.replace(/\s+/g, " ").trim()).replace(LEADING_DATE, "").trim());
    const prefix = /^\[?([A-Za-z ]{3,20})\]?\s*[:—–-]\s+(.+)$/.exec(t);
    const pc = prefix ? toCategory(prefix[1]) : undefined;
    if (pc) t = prefix![2].trim();
    t = t.replace(/^["“](.*)["”]$/, "$1").trim();
    // A lead-in or a heading ends with a colon and has nothing after it.
    if (t.length < 4 || /:\s*$/.test(t) || BOILERPLATE.some((re) => re.test(t))) return;
    const key = t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ category: pc ?? cat ?? guessCategory(t), text: t.slice(0, MEMORY_MAX_CHARS) });
  };
  if (jsonItems) {
    for (const it of jsonItems) {
      if (typeof it === "string") add(it);
      else if (it && typeof it === "object") {
        const o = it as Record<string, unknown>;
        const t = [o.text, o.content, o.memory, o.value].find((v) => typeof v === "string") as string | undefined;
        if (t) add(t, toCategory(typeof o.category === "string" ? o.category : typeof o.type === "string" ? o.type : undefined));
      }
    }
    return out.slice(0, 200);
  }
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    // "## Preferences", "**Your preferences:**", "Style:" set the category for the lines below.
    const h = /^(?:#{1,6}\s+)?([A-Za-z ]{3,30}?)\s*:?\s*$/.exec(stripMarks(l).replace(/:\s*$/, ""));
    const hc = h ? toCategory(h[1].replace(/^(?:your|my|the)\s+/i, "")) : undefined;
    if (hc && !/^[-*•]\s/.test(l)) {
      heading = hc;
      continue;
    }
    if (/^#{1,6}\s/.test(l)) continue;
    const item = l.replace(/^(?:[-*•·]|\d+[.)])\s+/, "").replace(/^\[[ x]\]\s+/i, "");
    // A paragraph of several sentences becomes one memory per sentence only when it's long.
    if (item.length > MEMORY_MAX_CHARS) for (const s of item.split(/(?<=[.!?])\s+/)) add(s, heading);
    else add(item, heading);
  }
  return out.slice(0, 200);
}

// ---------------------------------------------------------------------------
// Projects

export const MAX_PROJECT_SOURCES = 20;
export const PROJECT_COLORS = ["iris", "sky", "teal", "lime", "amber", "rose", "slate"] as const;
export type ProjectColor = (typeof PROJECT_COLORS)[number];
/** Hues for the project swatches (oklch), matching the Library's folder colours. */
export const PROJECT_HUE: Record<ProjectColor, number> = { iris: 280, sky: 230, teal: 185, lime: 130, amber: 75, rose: 15, slate: 260 };
/** The swatch colours: the same lightness for all, and slate nearly grey (a low chroma) so it doesn't read as another blue. */
export const PROJECT_SWATCH: Record<ProjectColor, string> = Object.fromEntries(
  Object.entries(PROJECT_HUE).map(([c, h]) => [c, `oklch(0.68 ${c === "slate" ? 0.025 : 0.13} ${h})`]),
) as Record<ProjectColor, string>;

export type SourceKind = "link" | "file" | "image" | "video" | "audio" | "element" | "text";

export interface ProjectSource {
  id: string;
  kind: SourceKind;
  title: string;
  /** /api/files/… for files and media, the page for links. */
  url?: string;
  elementId?: string;
  /** The first lines of the text Assist can read (links, text files, notes). */
  excerpt?: string;
  chars?: number;
  status: "ready" | "error";
  error?: string;
  createdAt: number;
}

export interface AssistProject {
  id: string;
  name: string;
  color: ProjectColor;
  instructions: string;
  /** Project skills: when set, the agent can use only these (they also come first). */
  skills: string[];
  /** Also give chats in this project your personal memory (project memory is always used). */
  usePersonalMemory: boolean;
  sources: ProjectSource[];
  chats: number;
  createdAt: number;
  updatedAt: number;
}

export const PROJECT_LIMITS = { name: 60, instructions: 8000, sourceText: 40_000, note: 20_000 };

// ---------------------------------------------------------------------------
// The agent's context: rendered once when a chat starts, then updated by appending messages

export type FactSection = "now" | "project" | "sources" | "memory" | "skills" | "active";

export interface ContextFact {
  section: FactSection;
  key: string;
  text: string;
}

const SECTION_TITLE: Record<FactSection, string> = {
  now: "This chat",
  project: "Project",
  sources: "Project sources",
  memory: "Memory (what you know about the user)",
  skills: "Skills you can load",
  active: "Skills in use — follow these",
};
const SECTION_ORDER: FactSection[] = ["now", "project", "sources", "memory", "skills", "active"];

const factId = (f: Pick<ContextFact, "section" | "key">) => `${f.section}:${f.key}`;

/** The full context block (the second system block of a chat, frozen once rendered). */
export function renderContext(facts: ContextFact[]): string {
  return SECTION_ORDER.flatMap((s) => {
    const items = facts.filter((f) => f.section === s);
    return items.length ? [`## ${SECTION_TITLE[s]}\n${items.map((f) => f.text).join("\n")}`] : [];
  }).join("\n\n");
}

export const factMap = (facts: ContextFact[]): Record<string, string> => Object.fromEntries(facts.map((f) => [factId(f), f.text]));

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * What changed since the context the model last saw, as one "Context update" message (null when
 * nothing did). The chat's earlier messages are never edited: the update is appended, so the
 * prompt cache and earlier thinking stay valid.
 */
export function contextUpdate(sent: Record<string, string>, facts: ContextFact[]): string | null {
  const now = factMap(facts);
  const parts: string[] = [];
  for (const s of SECTION_ORDER) {
    const changed = facts.filter((f) => f.section === s && sent[factId(f)] !== f.text).map((f) => f.text);
    const gone = Object.keys(sent)
      .filter((k) => k.startsWith(`${s}:`) && !(k in now))
      .map((k) => (s === "active" ? `- Stop following the /${k.slice(7)} skill.` : `- No longer applies: ${clip(sent[k].replace(/^[-#\s]+/, "").split("\n")[0], 160)}`));
    if (changed.length || gone.length) parts.push(`## ${SECTION_TITLE[s]}\n${[...changed, ...gone].join("\n")}`);
  }
  return parts.length ? `Context update — these replace the matching parts of your instructions:\n\n${parts.join("\n\n")}` : null;
}
