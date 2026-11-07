import "server-only";
import { z } from "zod";
import { guessCategory, MEMORY_CATEGORIES, MEMORY_MAX_CHARS, toCategory, type MemoryCategory } from "@/lib/assist";
import { recipeMarkdown } from "@/lib/recipe";
import { getSkill, skillFile, skillRecipe } from "../skills";
import { rankSkills } from "../skill-usage";
import { canUseSkill, skillsFor } from "./context";
import { defineTool } from "./define";
import { addMemory, deleteMemory, memoriesFor } from "./memory";
import { getProject, listProjects, sourceText } from "./projects";

/** A memory this chat may replace: one of those its context shows (the personal ones, unless its project leaves them out, and its project's own). */
function replaceable(id: string, projectId: string | null) {
  const project = projectId ? getProject(projectId) : null;
  return memoriesFor(project?.id ?? null, project?.usePersonalMemory ?? true).find((m) => m.id === id) ?? null;
}

/** Tools for Skills, Memory and Projects (Supercomputer's "load skill", "use and update memory", "project assets"). */

const listSkills = defineTool({
  name: "list_skills",
  description:
    "List the skills you can load: playbooks for whole kinds of jobs (product photos, UGC videos, thumbnails, faceless videos, dubbing…) with what each does and when to use it. The context already lists them briefly; call this for the full descriptions or to search by words.",
  schema: z.object({
    query: z.string().optional().describe("Words to match in a skill's name, title or description."),
  }),
  async run({ query }, ctx) {
    const projectId = ctx.thread?.projectId ?? null;
    // By the words, then the skills used most and most lately.
    const list = rankSkills(skillsFor(projectId), { words: query });
    return {
      content: JSON.stringify(
        list.map((s) => {
          // A recipe skill runs by itself with run_skill: its inputs by id and type.
          const recipe = s.recipe ? skillRecipe(s.name) : null;
          return {
            name: s.name,
            title: s.title,
            description: s.description,
            whenToUse: s.whenToUse || undefined,
            loaded: ctx.thread?.skills.includes(s.name) || undefined,
            ...(recipe && { runsByItself: { tool: "run_skill", inputs: recipe.params.map((p) => ({ id: p.id, type: p.type, label: p.label, ...(p.required && p.default === undefined && { required: true }) })) } }),
          };
        }),
      ),
      items: [{ id: "", role: "tool", text: `Looked through ${list.length} skill${list.length === 1 ? "" : "s"}` }],
    };
  },
});

const loadSkill = defineTool({
  name: "load_skill",
  description:
    "Load a skill by name before you plan a job it covers; its instructions then guide this chat. Load one whenever the user's request matches a listed skill — once per chat is enough. With `file`, read one of the extra files a skill comes with.",
  schema: z.object({
    name: z.string().describe("The skill's name, e.g. product-photoshoot (without the slash)."),
    file: z.string().optional().describe("A file bundled with the skill, as listed under it."),
  }),
  async run({ name, file }, ctx) {
    const n = name.replace(/^\//, "").trim();
    const s = getSkill(n);
    const projectId = ctx.thread?.projectId ?? null;
    if (!s || !canUseSkill(n, projectId)) {
      const names = skillsFor(projectId).map((x) => x.name);
      return { content: `No skill called “${n}” is available here. Available: ${names.join(", ") || "none"}.`, isError: true };
    }
    if (file) {
      const text = skillFile(n, file);
      if (text === null) return { content: `/${n} has no file “${file}”. Its files: ${s.files.map((f) => f.path).join(", ") || "none"}.`, isError: true };
      return { content: text.length > 40_000 ? `${text.slice(0, 40_000)}\n… (cut at 40,000 characters)` : text, items: [{ id: "", role: "tool", text: `Read ${file} from ${s.title}` }] };
    }
    const item = { id: "", role: "tool" as const, text: `Using the ${s.title} skill`, href: `/assist/skills?skill=${s.name}` };
    // A skill with a recipe also runs by itself: its "Run it" section follows the instructions.
    const recipe = skillRecipe(n);
    const runs = recipe ? `\n\n${recipeMarkdown(recipe, { name: n })}` : "";
    if (ctx.thread) {
      if (ctx.thread.skills.includes(n)) return { content: `/${n} is already loaded — its instructions are in your context. Follow them.` };
      ctx.thread.loadSkill(n);
      return { content: `Loaded /${n} (${s.title}). Its instructions are added to your context right after this result — read them, then follow them for this job.${recipe ? " It also runs by itself with new inputs (see its Run it section)." : ""}`, items: [item] };
    }
    // Over MCP there's no chat context to add to: the instructions come back as the result.
    return { content: `# ${s.title} (/${s.name})\n\n${s.body}${runs}`, items: [item] };
  },
});

const remember = defineTool({
  name: "remember",
  description:
    "Save a lasting fact about the user to memory so every future chat follows it: a preference (\"always vertical 9:16\"), their style, how they like replies, a naming or brand convention, their setup, a fix that worked. One short sentence per call, in the third person or as an instruction. Don't save one-off details of the current job, guesses, or secrets (keys, passwords). To correct a memory, pass its id as `replaces`. In ask-first mode the user approves each memory.",
  schema: z.object({
    text: z.string().describe(`The memory, one sentence (under ${MEMORY_MAX_CHARS} characters).`),
    category: z.string().optional().describe(`One of: ${MEMORY_CATEGORIES.join(", ")}.`),
    scope: z.enum(["personal", "project"]).optional().describe("project = only this project's chats (default inside a project); personal = every chat."),
    replaces: z.string().optional().describe("The id of a memory this one corrects or replaces."),
  }),
  gated: true,
  title: () => "Remember this?",
  plan: ({ text, category, scope, replaces }, ctx) => {
    const cat: MemoryCategory = toCategory(category) ?? guessCategory(text);
    const where = (scope ?? (ctx.thread?.projectId ? "project" : "personal")) === "project" ? "This project" : "All chats";
    // The memory it replaces is shown on the card: approving a new memory must never remove another one unseen.
    const old = replaces ? replaceable(replaces, ctx.thread?.projectId ?? null) : null;
    const error =
      text.trim().length > MEMORY_MAX_CHARS ? `Too long — keep it under ${MEMORY_MAX_CHARS} characters` : replaces && !old ? "The memory it replaces isn't one this chat can change" : undefined;
    return [
      {
        tool: "remember",
        modelId: "memory",
        modelName: `Memory · ${cat}`,
        kind: "text",
        op: "memory",
        prompt: text.trim(),
        count: 0,
        costUsd: 0,
        demo: false,
        note: where,
        ...(old && { changes: [`Replaces: “${old.text}”`] }),
        ...(error && { error }),
      },
    ];
  },
  async run({ text, category, scope, replaces }, ctx) {
    const projectId = ctx.thread?.projectId ?? null;
    // Checked before anything is saved: only a memory this chat sees (and the card showed) can be replaced.
    if (replaces && !replaceable(replaces, projectId)) throw new Error("The memory it replaces isn't one this chat can change. Leave out replaces, or use an id from this chat's memory.");
    const sc = scope ?? (projectId ? "project" : "personal");
    const cat: MemoryCategory = toCategory(category) ?? guessCategory(text);
    const m = addMemory({ text, category: cat, scope: sc, projectId: sc === "project" ? projectId : null, source: "agent" });
    if (replaces && replaces !== m.id) deleteMemory(replaces);
    return {
      content: JSON.stringify({ saved: m.id, category: m.category, scope: m.scope }),
      items: [{ id: "", role: "tool", text: `Remembered: ${m.text}`, href: "/assist/memory" }],
    };
  },
});

const readSource = defineTool({
  name: "read_source",
  description:
    "Read the full text of one of this project's sources (a page, a document, a note) by the id shown in the project's source list. Only works inside a project. Over MCP (no chat), pass project_id too; leave out id to list the projects and their sources.",
  schema: z.object({
    id: z.string().optional().describe("The source id from the context, e.g. Ab3dE9xK1q."),
    project_id: z.string().optional().describe("Over MCP only: the project the source belongs to (a chat always reads its own project)."),
  }),
  async run({ id, project_id }, ctx) {
    // A chat reads only its own project's sources; MCP names the project.
    const projectId = ctx.thread ? ctx.thread.projectId : project_id?.trim() || null;
    const project = projectId ? getProject(projectId) : null;
    const sourceId = id?.replace(/^\[|\]$/g, "").trim();
    if (!ctx.thread && (!project || !sourceId)) {
      if (projectId && !project) return { content: `No project ${projectId}. Call read_source without arguments to list them.`, isError: true };
      const list = project ? [project] : listProjects();
      return {
        content: JSON.stringify(
          list.map((p) => ({ project_id: p.id, name: p.name, sources: p.sources.map((x) => ({ id: x.id, kind: x.kind, title: x.title, ...(x.url && { url: x.url }), ...(x.chars && { chars: x.chars }), ...(x.status === "error" && { error: x.error }) })) })),
        ),
      };
    }
    if (!project) return { content: "This chat isn't in a project, so it has no sources.", isError: true };
    if (!sourceId) return { content: `Pass the id of a source: ${project.sources.map((x) => `${x.id} (${x.title})`).join(", ") || "this project has none"}.`, isError: true };
    const s = sourceText(project.id, sourceId);
    if (!s) return { content: `No source ${sourceId} in this project.`, isError: true };
    if (!s.text) return { content: JSON.stringify({ title: s.source.title, kind: s.source.kind, url: s.source.url, note: s.source.error ?? "This source has no text: pass its URL as an input instead." }) };
    return {
      content: `# ${s.source.title}${s.source.url ? `\n${s.source.url}` : ""}\n\n${s.text}`,
      items: [{ id: "", role: "tool", text: `Read ${s.source.title}` }],
    };
  },
});

export const CONTEXT_TOOLS = [listSkills, loadSkill, remember, readSource];
