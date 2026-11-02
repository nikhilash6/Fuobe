import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { nanoid } from "nanoid";
import { normalizeAgent, threadTitle, type AssistItem, type AssistModeChoice } from "@/lib/assist";
import {
  DEFAULT_SCHEDULE_CAP_USD,
  describeRule,
  formatWhen,
  newestWords,
  nextRun,
  ruleError,
  skillTaskLine,
  validTimeZone,
  type ScheduleApproval,
  type ScheduleResult,
  type ScheduleRule,
  type ScheduleSkill,
  type ScheduleView,
} from "@/lib/assist-schedule";
import type { Engine } from "@/lib/catalog/types";
import { formatCost } from "@/lib/format";
import { checkValues, isMediaType } from "@/lib/recipe";
import { db } from "../db";
import { recipeEngines } from "../recipes";
import { getSkill, skillRecipe } from "../skills";
import { listAssets } from "../storage";
import { addMessage, createThread, getThread, resolveMode, run, type ModelCall } from "./agent";
import { canUseSkill } from "./context";
import { getProject } from "./projects";

/**
 * Assist's scheduled tasks. A task is a prompt with a rule (daily, weekly, every N hours, once) in a
 * time zone; each run is a new chat (in the task's project, when it has one) that the server's sweep
 * starts — `ensureScheduleRunner()`, started at boot by src/instrumentation.ts, checks every 30 s.
 *
 * Approval per task: "ask" runs the chat until its first plan, which then waits as an approval card
 * (no generation starts until the user approves); "auto" lets plans start on their own while they fit
 * the task's cost cap for that run, and leaves the rest waiting (see withinCap and the agent's step()).
 * Custom MCP connectors are off in runs unless the task opts in (`connectors`): their tools run inside
 * Claude's reply, where neither mode can hold them back.
 * A run the server missed (it was off) happens once when it's back, not once per missed time.
 *
 * A task can run a saved skill instead (Skills W4, `skill`): each run is still a chat, with the same approval and cap,
 * but no model plans it — a fixed reply (skillCall) makes one run_skill call with the task's values, and a file input
 * set to "newest upload" reads the newest upload of its kind when the run starts.
 */

export class ScheduleError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const SWEEP_MS = 30_000;
/** The first sweep after boot. */
const BOOT_SWEEP_MS = 5_000;
/** At most this many tasks start in one sweep; the rest start on the next. */
const PER_SWEEP = 10;

interface Row {
  id: string;
  title: string;
  prompt: string;
  attachments_json: string;
  project_id: string | null;
  rule_json: string;
  tz: string;
  approval: ScheduleApproval;
  cap_usd: number | null;
  connectors: number;
  engine: "cloud" | "open";
  mode_json: string | null;
  skill_json: string | null;
  paused: number;
  next_run_at: number | null;
  last_run_at: number | null;
  last_thread_id: string | null;
  last_status: ScheduleResult["status"] | null;
  last_text: string | null;
  runs: number;
  created_at: number;
  updated_at: number;
}

/** A rule as the dialog sends it: "every N hours" gets its start (`from`) here. */
export type RuleInput = ScheduleRule extends infer R ? (R extends { kind: "hours" } ? Omit<R, "from"> & { from?: number } : R) : never;

export interface ScheduleInput {
  title: string;
  prompt: string;
  attachments?: string[];
  projectId?: string | null;
  rule: RuleInput;
  tz: string;
  approval: ScheduleApproval;
  capUsd?: number | null;
  engine: "cloud" | "open";
  mode?: AssistModeChoice | null;
  /** Whether runs may use the connectors in Settings (off unless set). */
  connectors?: boolean;
  /** Run this skill instead of a request (null: a request). */
  skill?: ScheduleSkill | null;
  paused?: boolean;
}

const getRow = (id: string) => db().prepare("SELECT * FROM assist_schedules WHERE id = ?").get(id) as Row | undefined;

/**
 * How the last run went. A run that made a chat is read from the chat itself (so an approval given
 * later shows); a skip, a failure to start or a pause (no chat of its own: last_thread_id is cleared
 * then) shows the stored reason.
 */
function resultOf(r: Row): ScheduleResult | null {
  if (!r.last_status) return null;
  const stored: ScheduleResult = { threadId: r.last_thread_id, status: r.last_status, text: r.last_text ?? "" };
  if (r.last_status === "skipped" || !r.last_thread_id) return stored;
  const view = getThread(r.last_thread_id);
  // The chat was deleted: what was stored stands, but a run that never reported back isn't still going.
  if (!view) {
    const lost = stored.status === "running" || stored.status === "waiting";
    return { threadId: null, status: lost ? "failed" : stored.status, text: lost ? CHAT_DELETED : stored.text };
  }
  return { threadId: r.last_thread_id, ...summarize(view.thread.status, view.thread.items) };
}

const CHAT_DELETED = "Its chat was deleted";

/** A chat's outcome in a few words: still going, a plan waiting, an error, or what it made. */
export function summarize(status: "idle" | "running" | "waiting", items: AssistItem[]): Omit<ScheduleResult, "threadId"> {
  if (status === "running") return { status: "running", text: "Working…" };
  if (status === "waiting") {
    const card = items.findLast((i) => i.role === "approval");
    const price = card?.role === "approval" ? (card.totalUsd === null ? "" : ` (${card.totalUsd === 0 ? "free" : formatCost(card.totalUsd)})`) : "";
    return { status: "waiting", text: `A plan waits for your approval${price}` };
  }
  const lastUser = items.findLastIndex((i) => i.role === "user");
  const after = items.slice(lastUser + 1);
  const error = after.findLast((i) => i.role === "notice" && i.tone === "error");
  if (error?.role === "notice" && !after.slice(after.indexOf(error) + 1).some((i) => i.role === "assistant")) return { status: "failed", text: error.text };
  const made = items.reduce((n, i) => n + (i.role === "generations" ? i.ids.length : 0), 0);
  const said = after.findLast((i) => i.role === "assistant");
  const text = made ? `Started ${made} result${made === 1 ? "" : "s"}` : said?.role === "assistant" ? said.text.replace(/\s+/g, " ").slice(0, 140) : "Finished";
  return { status: "done", text };
}

/** A task's stored mode choice. Tasks saved before LM Studio and Unsloth Studio support say agent "ollama": shown as "local", as runs read it. */
function modeOf(json: string): ScheduleView["mode"] {
  const m = JSON.parse(json) as NonNullable<ScheduleView["mode"]>;
  return m.agent ? { ...m, agent: normalizeAgent(m.agent) ?? m.agent } : m;
}

function toView(r: Row): ScheduleView {
  return {
    id: r.id,
    title: r.title,
    prompt: r.prompt,
    attachments: JSON.parse(r.attachments_json) as string[],
    projectId: r.project_id,
    rule: JSON.parse(r.rule_json) as ScheduleRule,
    tz: r.tz,
    approval: r.approval,
    capUsd: r.cap_usd,
    engine: r.engine,
    mode: r.mode_json ? modeOf(r.mode_json) : null,
    connectors: !!r.connectors,
    skill: r.skill_json ? (JSON.parse(r.skill_json) as ScheduleSkill) : null,
    paused: !!r.paused,
    nextRunAt: r.paused ? null : r.next_run_at,
    lastRunAt: r.last_run_at,
    last: resultOf(r),
    runs: r.runs,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Tasks, soonest first (paused ones last). `project`: one project's; null: those outside projects. */
export function listSchedules(f: { project?: string | null } = {}): ScheduleView[] {
  const where = f.project === null ? "WHERE project_id IS NULL" : f.project ? "WHERE project_id = ?" : "";
  const rows = db()
    .prepare(`SELECT * FROM assist_schedules ${where} ORDER BY paused, next_run_at IS NULL, next_run_at, created_at DESC LIMIT 200`)
    .all(...(f.project ? [f.project] : [])) as Row[];
  return rows.map(toView);
}

export function getSchedule(id: string): ScheduleView | null {
  const r = getRow(id);
  return r ? toView(r) : null;
}

const ENGINE_WORDS: Record<Engine, string> = { cloud: "the cloud", open: "your GPU" };
/** What a "newest upload" input is checked with when the task is saved (the real file is read when it runs). */
const NEWEST_STAND_IN = "/api/files/uploads/newest";

/** One line of what's wrong: "needs product (image)", or the first value that doesn't fit. */
const firstError = (errors: Record<string, string>) => Object.values(errors)[0] ?? "Check the skill's inputs";

/**
 * A skill task as it's saved: a skill here that runs by itself, is on, may run in the task's project and on its engine,
 * with values that fit its inputs (a "newest upload" input is checked with a stand-in file). Returns what's stored.
 */
function checkedSkill(task: ScheduleSkill, projectId: string | null, engine: Engine): { task: ScheduleSkill; title: string; line: string } {
  const name = task.name.replace(/^\//, "").trim();
  const s = getSkill(name);
  if (!s) throw new ScheduleError(`There's no skill called /${name}`, 404);
  const recipe = s.recipe ? skillRecipe(name) : null;
  if (!recipe) throw new ScheduleError(`/${name} doesn't run by itself: pick a skill that does, or schedule a request`);
  if (!s.enabled) throw new ScheduleError(`/${name} is switched off — switch it on in Skills first`);
  if (!canUseSkill(name, projectId)) throw new ScheduleError(`/${name} isn't one of this project's skills: add it to the project, or pick no project`);
  const engines = recipeEngines(recipe);
  if (!engines.includes(engine)) {
    throw new ScheduleError(engines.length ? `/${name} runs on ${engines.map((e) => ENGINE_WORDS[e]).join(" or ")} only: pick that engine` : `/${name} can't run on this install as it is`);
  }
  const params = new Map(recipe.params.map((p) => [p.id, p]));
  const unknown = [...Object.keys(task.values), ...Object.keys(task.sources ?? {})].find((k) => !params.has(k));
  if (unknown) throw new ScheduleError(`/${name} has no input “${unknown}”`);
  const sources = Object.keys(task.sources ?? {});
  const notFile = sources.find((id) => !isMediaType(params.get(id)!.type));
  if (notFile) throw new ScheduleError(`${params.get(notFile)!.label} isn't a file: only a file input can take your newest upload`);
  const values = Object.fromEntries(Object.entries(task.values).filter(([id, v]) => !sources.includes(id) && v.trim() !== ""));
  const check = checkValues(recipe, { ...values, ...Object.fromEntries(sources.map((id) => [id, NEWEST_STAND_IN])) });
  if (!check.values) throw new ScheduleError(firstError(check.errors));
  const clean: ScheduleSkill = { name, values, ...(sources.length && { sources: Object.fromEntries(sources.map((id) => [id, "newest" as const])) }) };
  return { task: clean, title: s.title, line: skillTaskLine(clean, recipe.params) };
}

function checked(input: ScheduleInput, prev: Row | undefined, now: number): Omit<Row, "id" | "last_run_at" | "last_thread_id" | "last_status" | "last_text" | "runs" | "created_at"> {
  if (!validTimeZone(input.tz)) throw new ScheduleError("Pick a time zone");
  if (input.projectId && !getProject(input.projectId)) throw new ScheduleError("That project doesn't exist anymore", 404);
  const paused = input.paused ?? !!prev?.paused;
  // A skill task is checked when it's saved, changed or resumed; an edit that leaves it alone (a pause, a new name)
  // keeps it, so a task whose skill went away can still be paused, renamed or deleted.
  const sameSkill =
    !!prev?.skill_json && !!input.skill && JSON.stringify(input.skill) === prev.skill_json && prev.project_id === (input.projectId ?? null) && prev.engine === input.engine && (paused || !prev.paused);
  const skill = input.skill ? (sameSkill ? { task: input.skill, title: prev!.title, line: prev!.prompt } : checkedSkill(input.skill, input.projectId ?? null, input.engine)) : null;
  if (!skill && !input.prompt.trim()) throw new ScheduleError("Write what Assist should do each time");
  const before = prev ? (JSON.parse(prev.rule_json) as ScheduleRule) : null;
  // "Every N hours" counts from when it was set up; an unchanged one keeps counting from then.
  const rule: ScheduleRule =
    input.rule.kind === "hours"
      ? { kind: "hours", every: input.rule.every, from: before?.kind === "hours" && before.every === input.rule.every ? before.from : (input.rule.from ?? now) }
      : (input.rule as ScheduleRule);
  const bad = ruleError(rule);
  if (bad) throw new ScheduleError(bad);
  const ruleJson = JSON.stringify(rule);
  // An edit that leaves when it runs alone (a rename, a new prompt) keeps the next time, even one that
  // is due and not yet swept; a new rule or zone, or resuming, picks it from now.
  const unchanged = prev && !prev.paused && !paused && prev.next_run_at !== null && prev.rule_json === ruleJson && prev.tz === input.tz;
  const next = unchanged ? prev.next_run_at : nextRun(rule, input.tz, now);
  if (next === null && !paused) throw new ScheduleError(rule.kind === "once" ? "That time has passed — pick a later one" : "This schedule never runs");
  const cap = input.approval === "auto" ? (input.capUsd ?? DEFAULT_SCHEDULE_CAP_USD) : null;
  return {
    title: input.title.trim().slice(0, 80) || (skill ? skill.title.slice(0, 80) : threadTitle(input.prompt)),
    // A skill task's prompt is what it runs, in words (the Scheduled page shows it).
    prompt: skill ? skill.line : input.prompt.trim(),
    attachments_json: JSON.stringify(skill ? [] : (input.attachments ?? [])),
    project_id: input.projectId ?? null,
    rule_json: ruleJson,
    tz: input.tz,
    approval: input.approval,
    cap_usd: cap === null ? null : Math.round(cap * 100) / 100,
    // No model plans a skill task's runs: no mode, and no connectors (they're Claude's).
    connectors: !skill && (input.connectors ?? !!prev?.connectors) ? 1 : 0,
    engine: input.engine,
    mode_json: !skill && input.mode ? JSON.stringify(input.mode) : null,
    skill_json: skill ? JSON.stringify(skill.task) : null,
    paused: paused ? 1 : 0,
    next_run_at: next,
    updated_at: now,
  };
}

export function createSchedule(input: ScheduleInput, now = Date.now()): ScheduleView {
  const row: Row = { id: nanoid(10), ...checked(input, undefined, now), last_run_at: null, last_thread_id: null, last_status: null, last_text: null, runs: 0, created_at: now };
  db()
    .prepare(
      `INSERT INTO assist_schedules (id, title, prompt, attachments_json, project_id, rule_json, tz, approval, cap_usd, connectors, engine, mode_json, skill_json, paused,
         next_run_at, last_run_at, last_thread_id, last_status, last_text, runs, created_at, updated_at)
       VALUES (@id, @title, @prompt, @attachments_json, @project_id, @rule_json, @tz, @approval, @cap_usd, @connectors, @engine, @mode_json, @skill_json, @paused,
         @next_run_at, @last_run_at, @last_thread_id, @last_status, @last_text, @runs, @created_at, @updated_at)`,
    )
    .run(row);
  ensureScheduleRunner();
  return toView(row);
}

/** Edit any part; pausing keeps the task, resuming picks the next time from now, and an edit that leaves the timing alone keeps it. */
export function updateSchedule(id: string, patch: Partial<ScheduleInput>, now = Date.now()): ScheduleView | null {
  const r = getRow(id);
  if (!r) return null;
  const current = toView(r);
  const merged: ScheduleInput = {
    title: patch.title ?? current.title,
    prompt: patch.prompt ?? current.prompt,
    attachments: patch.attachments ?? current.attachments,
    projectId: patch.projectId !== undefined ? patch.projectId : current.projectId,
    rule: patch.rule ?? current.rule,
    tz: patch.tz ?? current.tz,
    approval: patch.approval ?? current.approval,
    capUsd: patch.capUsd !== undefined ? patch.capUsd : current.capUsd,
    engine: patch.engine ?? current.engine,
    mode: patch.mode !== undefined ? patch.mode : (current.mode as AssistModeChoice | null),
    connectors: patch.connectors ?? current.connectors,
    skill: patch.skill !== undefined ? patch.skill : current.skill,
    paused: patch.paused ?? current.paused,
  };
  const next = { ...r, ...checked(merged, r, now) };
  db()
    .prepare(
      `UPDATE assist_schedules SET title = @title, prompt = @prompt, attachments_json = @attachments_json, project_id = @project_id, rule_json = @rule_json,
         tz = @tz, approval = @approval, cap_usd = @cap_usd, connectors = @connectors, engine = @engine, mode_json = @mode_json, skill_json = @skill_json, paused = @paused,
         next_run_at = @next_run_at, updated_at = @updated_at WHERE id = @id`,
    )
    .run(next);
  return toView(next);
}

/** Delete the task; the chats its runs made stay. */
export function deleteSchedule(id: string): boolean {
  return db().prepare("DELETE FROM assist_schedules WHERE id = ?").run(id).changes > 0;
}

function record(id: string, fields: Partial<Pick<Row, "last_run_at" | "last_thread_id" | "last_status" | "last_text" | "paused">> & { addRun?: boolean }): void {
  const { addRun, ...set } = fields;
  const cols = Object.keys(set).map((k) => `${k} = @${k}`);
  if (addRun) cols.push("runs = runs + 1");
  db()
    .prepare(`UPDATE assist_schedules SET ${cols.join(", ")} WHERE id = @id`)
    .run({ id, ...set });
}

/** A chat one of this task's runs started that is still working (a run interrupted by a restart isn't). */
function runningChat(id: string): string | null {
  const rows = db()
    .prepare("SELECT s.thread_id AS id FROM assist_thread_state s JOIN assist_threads t ON t.id = s.thread_id WHERE s.schedule_id = ? AND t.status = 'running'")
    .all(id) as { id: string }[];
  return rows.find((r) => getThread(r.id)?.thread.status === "running")?.id ?? null;
}

type MessageReply = Anthropic.Beta.BetaMessage;

/**
 * A skill task's "model": no LLM. Its first turn makes one run_skill call with the task's values (on an approval card
 * when the task asks first, or within its cap); once the call has an answer it says the run started, and a call that
 * couldn't start ends the run with the reason (the task then shows it as failed).
 */
export function skillCall(skill: { name: string; title: string }, values: Record<string, string>, engine: Engine): ModelCall {
  const reply = (content: unknown[], stop: Anthropic.Beta.BetaStopReason): MessageReply =>
    ({ id: `msg_sched_${nanoid(8)}`, type: "message", role: "assistant", model: "skill", content, stop_reason: stop, stop_sequence: null, stop_details: null, usage: null }) as unknown as MessageReply;
  const text = (t: string) => ({ type: "text", text: t, citations: null });
  return async ({ messages }) => {
    const last = messages.findLast((m) => m.role !== "system");
    const blocks = last && last.role === "user" && typeof last.content !== "string" ? last.content : [];
    const result = blocks.find((b) => b.type === "tool_result");
    if (!result) {
      const use = { type: "tool_use", id: `toolu_sched_${nanoid(10)}`, name: "run_skill", input: { name: skill.name, values, engine }, caller: { type: "direct" } };
      return reply([text(`Running ${skill.title} with this task's inputs.`), use], "tool_use");
    }
    const body = typeof result.content === "string" ? result.content : (result.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join(" ");
    if (result.is_error) {
      let why = body;
      try {
        why = (JSON.parse(body) as { error?: string }).error ?? body;
      } catch {
        // Plain words already.
      }
      throw new Error(`${skill.title} didn't start: ${why || "no reason given"}`);
    }
    return reply([text(`Started ${skill.title}. The results appear here and in your Library as they finish.`)], "end_turn");
  };
}

/** A skill task's run, ready to start: its values with each "newest upload" read now, the files to attach and its first message. */
type SkillRun = { name: string; title: string; values: Record<string, string>; files: string[]; line: string } | { stop: "paused" | "failed"; message: string };

function prepareSkillRun(task: ScheduleSkill, projectId: string | null): SkillRun {
  const s = getSkill(task.name);
  if (!s) return { stop: "paused", message: "Its skill was deleted — edit the task to pick another" };
  const recipe = s.recipe ? skillRecipe(task.name) : null;
  if (!recipe) return { stop: "paused", message: "Its skill no longer runs by itself — edit the task to pick another" };
  if (!s.enabled) return { stop: "failed", message: `/${task.name} is switched off — switch it on in Skills, then run the task again` };
  if (!canUseSkill(task.name, projectId)) return { stop: "failed", message: `/${task.name} isn't one of its project's skills any more — add it back, or edit the task` };
  const values = { ...task.values };
  for (const p of recipe.params) {
    if (task.sources?.[p.id] !== "newest" || !isMediaType(p.type)) continue;
    // The owner's newest upload of that kind, as the Library's Uploads list shows it.
    const newest = listAssets({ source: "upload", kind: p.type, limit: 1 })[0];
    if (newest) values[p.id] = newest.url;
    // An input the skill can do without (or has a file of its own for) is left out until there's an upload.
    else if (!p.required || p.default !== undefined) delete values[p.id];
    else return { stop: "failed", message: `There's no ${newestWords(p.type).replace(/^your newest /, "")} yet for “${p.label}” — upload one, or edit the task to pick a file` };
  }
  const files = [...new Set(recipe.params.flatMap((p) => (isMediaType(p.type) && values[p.id]?.startsWith("/api/files/") ? [values[p.id]] : [])))].slice(0, 8);
  const line = skillTaskLine({ ...task, values }, recipe.params, (url) => (files.includes(url) ? `file ${files.indexOf(url) + 1}` : url));
  return { name: task.name, title: s.title, values, files, line };
}

/**
 * What starting a run came to: a new chat (`threadId`, with `done` settling when the agent stops),
 * or none and why — `busy` (the run before is still going), `paused` (its project or its skill is gone) or
 * `failed` (the chat couldn't be started, or a skill task's input isn't there yet) — with the text the Scheduled page shows.
 */
export type ScheduleStart = { threadId: string; done: Promise<void> } | { threadId: null; done: Promise<void>; reason: "busy" | "paused" | "failed"; message: string };

/**
 * Start one run of a task: a new chat with the task's prompt, in its project, on its engine and mode,
 * asking first or auto-running within its cap, with connectors only when the task allows them.
 * Resolves once the chat exists; `done` settles when the agent stops (a finished reply, or a plan
 * waiting for approval).
 */
export async function startSchedule(id: string, o: { now?: number; model?: ModelCall; manual?: boolean } = {}): Promise<ScheduleStart> {
  const now = o.now ?? Date.now();
  const r = getRow(id);
  if (!r) throw new ScheduleError("No such scheduled task", 404);
  const none = (reason: "busy" | "paused" | "failed", message: string): ScheduleStart => ({ threadId: null, done: Promise.resolve(), reason, message });
  if (runningChat(id)) {
    // A scheduled time that passes while the last run works is recorded; a Run now click just gets the answer.
    if (!o.manual) record(id, { last_status: "skipped", last_text: `Skipped at ${formatWhen(now, r.tz)}: the run before was still going` });
    return none("busy", "The last run is still going — try again when it stops");
  }
  // A failure without a chat of its own clears last_thread_id, so the reason shows instead of the previous run's chat.
  if (r.project_id && !getProject(r.project_id)) {
    const message = "Its project was deleted — edit the task to pick another";
    record(id, { last_run_at: now, last_thread_id: null, last_status: "failed", last_text: message, paused: 1 });
    return none("paused", message);
  }
  // A skill task: its skill must still run here, and each "newest upload" input is read now.
  const task = r.skill_json ? (JSON.parse(r.skill_json) as ScheduleSkill) : null;
  const skill = task ? prepareSkillRun(task, r.project_id) : null;
  if (skill && "stop" in skill) {
    if (skill.stop === "paused") record(id, { last_run_at: now, last_thread_id: null, last_status: "failed", last_text: skill.message, paused: 1 });
    else record(id, { last_run_at: now, last_thread_id: null, last_status: "failed", last_text: skill.message, addRun: true });
    return none(skill.stop, skill.message);
  }
  const rule = JSON.parse(r.rule_json) as ScheduleRule;
  const mode = r.mode_json ? (JSON.parse(r.mode_json) as AssistModeChoice) : undefined;
  const cap = r.approval === "auto" ? (r.cap_usd ?? DEFAULT_SCHEDULE_CAP_USD) : null;
  const how = cap === null ? "plans wait for your approval" : cap === 0 ? "only free plans run on their own" : `plans up to ${formatCost(cap)} run on their own`;
  let threadId: string;
  try {
    // A skill task's chat is on the offline planner: no model plans it, and an approval later resumes it without one.
    const m = await resolveMode(skill ? { mode: "manual", agent: "offline" } : mode);
    const uses = !skill && !!r.connectors && m.agent === "claude";
    const t = createThread({
      engine: r.engine,
      agent: m.agent,
      autoApprove: r.approval === "auto",
      title: `${r.title} · ${formatWhen(now, r.tz)}`,
      projectId: r.project_id,
      mode: m.mode,
      provider: m.provider,
      model: m.model,
      effort: m.effort,
      scheduleId: r.id,
      capUsd: cap,
      connectors: !skill && !!r.connectors,
      note: skill
        ? `Scheduled run of “${r.title}” · ${describeRule(rule)} · ${how} · runs the ${skill.title} skill as it was saved, with no AI model planning it.`
        : `Scheduled run of “${r.title}” · ${describeRule(rule)} · ${how}${uses ? " · connectors on (their tools run without asking)" : ""}.${m.note ? ` ${m.note}` : ""}`,
    });
    threadId = t.id;
    if (skill) addMessage(t.id, skill.line, skill.files);
    else addMessage(t.id, r.prompt, JSON.parse(r.attachments_json) as string[]);
  } catch (e) {
    const message = (e as Error).message || "The run couldn't start";
    record(id, { last_run_at: now, last_thread_id: null, last_status: "failed", last_text: message, addRun: true });
    return none("failed", message);
  }
  record(id, { last_run_at: now, last_thread_id: threadId, last_status: "running", last_text: "Working…", addRun: true });
  const done = run(threadId, skill ? skillCall(skill, skill.values, r.engine) : o.model)
    .catch((e: Error) => console.warn(`[fuobe] scheduled task ${id} failed: ${e.message}`))
    .finally(() => {
      // Only while this run is still the task's last (a pause since then keeps its reason).
      const view = getThread(threadId);
      const s = view ? summarize(view.thread.status, view.thread.items) : { status: "failed" as const, text: CHAT_DELETED };
      db()
        .prepare("UPDATE assist_schedules SET last_status = ?, last_text = ? WHERE id = ? AND last_thread_id = ?")
        .run(s.status, s.text, id, threadId);
    });
  return { threadId, done };
}

/**
 * Start every task that is due at `now`. Each task's next time is claimed first (a compare-and-set
 * on next_run_at), so two sweeps never start the same run. Resolves when the started runs settle.
 */
export async function sweepSchedules(now = Date.now(), o: { model?: ModelCall } = {}): Promise<string[]> {
  const due = db().prepare("SELECT * FROM assist_schedules WHERE paused = 0 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT ?").all(now, PER_SWEEP) as Row[];
  const started: string[] = [];
  const runs: Promise<void>[] = [];
  for (const r of due) {
    const next = nextRun(JSON.parse(r.rule_json) as ScheduleRule, r.tz, now);
    const claimed = db().prepare("UPDATE assist_schedules SET next_run_at = ? WHERE id = ? AND next_run_at = ? AND paused = 0").run(next, r.id, r.next_run_at).changes;
    if (!claimed) continue;
    const begun = await startSchedule(r.id, { now, model: o.model }).catch((e: Error) => {
      record(r.id, { last_run_at: now, last_thread_id: null, last_status: "failed", last_text: e.message });
      return null;
    });
    if (begun?.threadId) started.push(begun.threadId);
    if (begun) runs.push(begun.done);
  }
  await Promise.all(runs);
  return started;
}

declare global {
  var __fuobeScheduleRunner: { tick: () => void; timer: NodeJS.Timeout } | undefined;
}

const tick = () => void sweepSchedules().catch((e: Error) => console.warn(`[fuobe] schedule sweep failed: ${e.message}`));

/**
 * Start the 30 s sweep (once per process: at boot, and when a task is created). At boot (`soon`) the
 * first sweep also runs a few seconds in, so a run missed while the server was off doesn't wait for
 * the first interval.
 */
export function ensureScheduleRunner(o: { soon?: boolean } = {}): void {
  const cur = globalThis.__fuobeScheduleRunner;
  if (cur) {
    // After a dev hot reload, point the timer at this module's code.
    cur.tick = tick;
    return;
  }
  const state = { tick, timer: setInterval(() => globalThis.__fuobeScheduleRunner?.tick(), SWEEP_MS) };
  state.timer.unref?.();
  globalThis.__fuobeScheduleRunner = state;
  if (o.soon) setTimeout(() => globalThis.__fuobeScheduleRunner?.tick(), BOOT_SWEEP_MS).unref?.();
}
