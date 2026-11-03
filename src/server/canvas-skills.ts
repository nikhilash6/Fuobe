import "server-only";
import { getModel } from "@/lib/catalog";
import { canvasToRecipe, nodeLabel, recipeToCanvas, runOutput, withCurrentElements } from "@/lib/catalog/canvas";
import { pageOf } from "@/lib/catalog/canvas-board";
import { OPERATION_LABELS, type Operation } from "@/lib/catalog/types";
import { leafKeys, today, type GenerateStep } from "@/lib/recipe";
import { fixedDraft, slugify, type DraftRefusal, type DraftStep, type SkillDraft } from "@/lib/recipe-builder";
import { createCanvas, getCanvas, silenceWriter } from "./canvas";
import { listElements } from "./elements";
import { llmTextBackend } from "./enhance";
import { getGeneration } from "./generations";
import { videoPoster } from "@/lib/output-actions";
import { getRecipe } from "./recipes";
import { getSkill, SkillError } from "./skills";

/**
 * Skills as canvases (package W5, docs/research/work2skill-7.md §10): open a recipe skill as a new canvas to see and
 * change its steps, and draft a skill from a canvas for W2's review screen, so a board runs from a form, Assist, MCP,
 * the CLI and schedules. The drawing and the reading are pure (recipeToCanvas, canvasToRecipe in
 * src/lib/catalog/canvas.ts); this module reads and writes the records.
 */

const elementInfos = () => listElements().map((e) => ({ id: e.id, handle: e.handle, name: e.name, references: e.references }));

/** A new canvas with a recipe skill drawn on it; a skill that can't be drawn is refused with the reason (422). */
export function canvasFromSkill(name: string) {
  const { skill, recipe } = getRecipe(name);
  const drawing = recipeToCanvas(recipe, { elements: elementInfos(), ...(skill.source !== "builtin" && { from: name }) });
  if (!drawing.ok) throw new SkillError(`${drawing.reason}: ${drawing.detail}`, 422);
  return createCanvas({ name: skill.title || name, graph: drawing.graph });
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** A free skill name like the title ("lamp-turntable", "lamp-turntable-2"…). */
function freeName(title: string): string {
  const base = slugify(title).slice(0, 56).replace(/-+$/, "") || "my-skill";
  let name = base;
  for (let i = 2; getSkill(name) || ["upload", "new", "draft"].includes(name); i++) name = `${base}-${i}`;
  return name;
}

/**
 * The draft of a skill from a canvas page (the canvas is the "demo"): the board read as a recipe, each input put back
 * Fixed (an input of the skill the board was drawn from, and a Table's columns, start as Varies), each step with the
 * node's last result as its picture. A node that can't run is a refusal naming it.
 */
export function draftFromCanvas(id: string, page?: string): { draft: SkillDraft | null; refusals: DraftRefusal[] } {
  const canvas = getCanvas(id);
  if (!canvas) throw new SkillError("No such canvas", 404);
  if (page && !canvas.pages.some((p) => p.id === page)) throw new SkillError("That page isn't on this canvas any more — reload it", 409);
  const on = pageOf(canvas.pages, page);
  const graph = withCurrentElements(on.graph, elementInfos());
  const read = canvasToRecipe(graph, { canvas: id });
  if (!read.recipe) {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    return { draft: null, refusals: read.problems.map((p) => ({ id: p.nodeId ?? id, title: p.nodeId && byId.get(p.nodeId) ? nodeLabel(byId.get(p.nodeId)!) : canvas.name, reason: p.message })) };
  }
  const recipe = read.recipe;
  // A muted clip's silence is a file the run reads (as Run all writes it).
  const withSilence = silenceWriter();
  for (const s of recipe.steps as GenerateStep[]) s.request = withSilence(s.request) as GenerateStep["request"];
  recipe.source = { from: "canvas", canvas: id, at: today() };
  const { recipe: fixed, candidates } = fixedDraft(recipe, read.varies);
  const leaves = leafKeys(fixed);
  const byNode = new Map(graph.nodes.map((n) => [n.id, n]));
  const labelOf = new Map<string, string>();
  const steps: DraftStep[] = (fixed.steps as GenerateStep[]).map((s) => {
    const node = byNode.get(read.nodes[s.key] ?? "");
    const model = getModel(s.request.modelId);
    const op = s.request.op ? (OPERATION_LABELS[s.request.op as Operation] ?? s.request.op) : undefined;
    const label = s.label ?? (node ? nodeLabel(node) : (op ?? model?.name ?? s.key));
    labelOf.set(s.key, label);
    const run = node ? canvas.runs[node.id] : undefined;
    const g = run ? getGeneration(runOutput(run)) : null;
    const o = g?.status === "succeeded" ? (g.outputs.find((x) => x.kind === g.kind) ?? g.outputs[0]) : undefined;
    const poster = g && o ? videoPoster(g, o) : undefined;
    return {
      key: s.key,
      kind: "generate",
      label,
      modelName: model?.name ?? s.request.modelId,
      ...(s.request.engine && { engine: s.request.engine }),
      generation: g?.id ?? "",
      ...(o && { thumb: { url: o.url, kind: o.kind, ...(poster && { poster }) } }),
      waits: [],
      leaf: leaves.has(s.key),
      notes: [],
    };
  });
  for (const [i, s] of (fixed.steps as GenerateStep[]).entries()) steps[i].waits = (Array.isArray(s.after) ? s.after : s.after ? [s.after] : []).map((a) => labelOf.get(a) ?? a);
  const from = read.from ? getSkill(read.from) : null;
  const replaces = from && from.source !== "builtin" ? { name: from.name, title: from.title || from.name } : undefined;
  const title = cut(from?.title || canvas.name || "Canvas skill", 60);
  const models = [...new Set(steps.map((s) => s.modelName))];
  const flow = steps.map((s) => s.label).join(" → ");
  const rows = read.rows?.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "")])));
  const draft: SkillDraft = {
    recipe: fixed,
    steps,
    candidates,
    // A free name for a new skill: saving back into the skill it was drawn from (replaces) doesn't use it.
    name: freeName(title),
    title,
    description: from?.description || cut(`${steps.length === 1 ? flow : `${steps.length} steps: ${flow}`}, with ${models.join(", ")}. Made on a canvas and run again with new inputs.`, 1000),
    whenToUse: from?.whenToUse || cut(`When you want the “${canvas.name}” canvas run again with new inputs, from a form, Assist or a schedule.`, 1000),
    demo: false,
    notes: [
      ...(rows?.length ? [`The table's ${rows.length} row${rows.length === 1 ? "" : "s"} become the runs of the Many tab once it's saved`] : []),
      ...(graph.nodes.some((n) => n.data.pinned) ? ["Pinned nodes run again each time: a skill makes every step afresh"] : []),
    ],
    llm: llmTextBackend(),
    ...(rows?.length && { rows }),
    ...(replaces && { replaces }),
  };
  return { draft, refusals: [] };
}
