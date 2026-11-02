/**
 * Skills as canvases (package W5): a skill's recipe drawn as a canvas, and a canvas turned into a recipe. Pure and
 * browser-safe (the canvas list draws a skill; the server drafts a skill from a canvas).
 *
 * recipe → canvas: inputs become input nodes (text → a text prompt, image/video/audio → a file node with the example,
 * element → an element node), generate steps become model nodes, and `after` with its chain slots becomes edges. Only
 * when every slot maps to a port: a recipe that uses audio2, audios, model3d or mask, a chain with stem, index or a
 * position, a prompt with more than one input in it, or a studio step can't be drawn yet (a studio step shows as one
 * read-only "Studio step" note).
 *
 * canvas → recipe (the canvas is the demonstration): the request each model node makes, as describeNode builds it, with
 * an input node that came from a skill's input put back as its {{id}}; every other input node's file or words stay as
 * they are (Fixed, until the review screen says they vary). A Table's columns become text inputs and its rows the Many
 * tab's rows (at most 50 × 8, TABLE_LIMITS).
 */
import type { ChainSlot, GenerationRequest } from "./types";
import { describeNode, isGenerator, nodeLabel, TABLE_LIMITS, tableRows, topoOrder, type CanvasEdge, type CanvasGraph, type CanvasNode, type CanvasNodeType, type InputPortId } from "./canvas";
import type { Recipe, RecipeParam, RecipeStep } from "../recipe";

export const CANT_DRAW = "This skill can't be drawn yet";

/** What a node made from a skill's input keeps, so the way back gives the same input. */
type ParamData = RecipeParam;

const INPUT_NODE: Record<RecipeParam["type"], CanvasNodeType | null> = { text: "prompt", image: "image-input", video: "video-input", audio: "audio-input", element: "element", number: null, choice: null };
const SLOT_PORT: Partial<Record<ChainSlot["slot"], InputPortId>> = { images: "images", endImage: "endImage", video: "video", videos: "videos", audio: "audio", voiceAudio: "voice", prompt: "prompt" };
const INPUT_PORT: Record<string, InputPortId> = { images: "images", endImage: "endImage", video: "video", videos: "videos", audio: "audio", voiceAudio: "voice" };
const PLACE = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
const EXACT = /^\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}$/;

const asList = (a: string | string[] | undefined): string[] => (a === undefined ? [] : Array.isArray(a) ? a : [a]);

/** Why a recipe can't be drawn, or null. */
export function undrawable(recipe: Pick<Recipe, "steps" | "params">): string | null {
  for (const s of recipe.steps) {
    if (s.kind === "tool") continue;
    const r = s.request as GenerationRequest & Record<string, unknown>;
    const inputs = (r.inputs ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(inputs)) if (!INPUT_PORT[k] && inputs[k] !== undefined) return `${CANT_DRAW}: step “${s.key}” takes ${k}, which a canvas has no port for`;
    const chain = (s.chain ?? (r.chain as ChainSlot[] | undefined)) ?? [];
    for (const c of chain) {
      if (!SLOT_PORT[c.slot]) return `${CANT_DRAW}: step “${s.key}” takes ${c.slot} from an earlier step`;
      if (c.stem !== undefined || c.index !== undefined || c.position !== undefined) return `${CANT_DRAW}: step “${s.key}” takes one part of an earlier result`;
    }
    const prompt = typeof r.prompt === "string" ? r.prompt : "";
    if ([...prompt.matchAll(PLACE)].length > 1) return `${CANT_DRAW}: step “${s.key}” puts several inputs into its words`;
    for (const id of [...JSON.stringify(r.params ?? {}).matchAll(PLACE)].map((m) => m[1])) return `${CANT_DRAW}: step “${s.key}” takes a setting from {{${id}}}`;
    if (JSON.stringify(r).includes("{{steps.")) return `${CANT_DRAW}: step “${s.key}” takes a studio step's result`;
  }
  for (const p of recipe.params) if (!INPUT_NODE[p.type]) return `${CANT_DRAW}: “${p.label}” is a ${p.type === "number" ? "number" : "choice"}, which a canvas has no input for`;
  return null;
}

/**
 * A skill's recipe as a canvas: its graph, and when it can't be drawn as it runs, why (the canvas then opens read-only).
 */
export function recipeToCanvas(recipe: Recipe): { graph: CanvasGraph; readOnly?: string } {
  const why = undrawable(recipe);
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const byParam = new Map<string, string>();
  let fixed = 0;
  recipe.params.forEach((p, i) => {
    const type = INPUT_NODE[p.type];
    if (!type) return;
    const id = `in-${p.id}`;
    const v = p.example ?? p.default;
    const data: CanvasNode["data"] = { label: p.label, param: p as ParamData };
    if (type === "prompt") data.text = typeof v === "string" || typeof v === "number" ? String(v) : "";
    else if (type === "element") data.handle = typeof v === "string" ? v.replace(/^@?/, "@") : undefined;
    else if (typeof v === "string") data.url = v;
    nodes.push({ id, type, position: { x: 0, y: i * 220 }, data });
    byParam.set(p.id, id);
  });
  const depth = new Map<string, number>();
  for (const s of recipe.steps) depth.set(s.key, Math.max(0, ...asList(s.kind === "generate" ? s.after : undefined).map((a) => (depth.get(a) ?? 0) + 1)));
  const column = new Map<number, number>();
  const edge = (source: string, target: string, port: InputPortId) => edges.push({ id: `e-${source}-${target}-${port}-${edges.length}`, source, target, sourceHandle: "out", targetHandle: port });
  for (const s of recipe.steps) {
    const d = depth.get(s.key) ?? 0;
    const row = column.get(d) ?? 0;
    column.set(d, row + 1);
    const position = { x: 380 + d * 380, y: row * 260 };
    if (s.kind === "tool") {
      nodes.push({ id: s.key, type: "note", position, data: { label: "Studio step", text: `Studio step: ${s.label ?? s.tool.replace(/_/g, " ")}. It runs in its studio and can't be changed here.` } });
      continue;
    }
    const r = { ...(s.request as GenerationRequest & Record<string, unknown>) };
    const prompt = typeof r.prompt === "string" ? r.prompt : undefined;
    const fromInput = prompt ? [...prompt.matchAll(PLACE)].map((m) => m[1]).find((id) => byParam.has(id)) : undefined;
    const ownPrompt = prompt && fromInput ? (EXACT.test(prompt.trim()) ? "" : prompt.replace(PLACE, "{text}")) : prompt;
    nodes.push({
      id: s.key,
      type: "model",
      position,
      data: {
        label: s.label ?? s.key,
        modelId: String(r.modelId),
        ...(r.op && { op: r.op }),
        ...(r.engine && { engine: r.engine }),
        ...(ownPrompt && { prompt: ownPrompt }),
        ...(r.params && { params: r.params }),
        // What the node was made from: the step's request as the recipe holds it, so drawing it back loses nothing.
        recipeStep: { key: s.key, label: s.label, request: r },
      },
    });
    if (fromInput) edge(byParam.get(fromInput)!, s.key, "prompt");
    for (const [k, v] of Object.entries((r.inputs ?? {}) as Record<string, unknown>)) {
      const port = INPUT_PORT[k];
      if (!port) continue;
      for (const x of Array.isArray(v) ? v : [v]) {
        const m = typeof x === "string" ? EXACT.exec(x) : null;
        if (m && byParam.has(m[1])) edge(byParam.get(m[1])!, s.key, port);
        else if (typeof x === "string") {
          // A file fixed in the step: a file node of its own.
          const id = `file-${s.key}-${fixed++}`;
          nodes.push({ id, type: port === "video" || port === "videos" ? "video-input" : port === "audio" || port === "voice" ? "audio-input" : "image-input", position: { x: position.x - 190, y: position.y + 120 }, data: { url: x } });
          edge(id, s.key, port);
        }
      }
    }
    const chain = (s.chain ?? (r.chain as ChainSlot[] | undefined)) ?? [];
    asList(s.after).forEach((a, i) => edge(a, s.key, SLOT_PORT[chain[i]?.slot ?? "images"] ?? "images"));
  }
  return { graph: { nodes, edges }, ...(why && { readOnly: why }) };
}

/** A column's input id: its words as letters, digits and _ (col_<n> when none are left). */
const columnId = (name: string, i: number, taken: Set<string>) => {
  let id = name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "c$1").slice(0, 32) || `col_${i + 1}`;
  if (!/^[A-Za-z]/.test(id)) id = `c_${id}`.slice(0, 32);
  while (taken.has(id)) id = `${id.slice(0, 29)}_${i + 1}`;
  taken.add(id);
  return id;
};

export interface CanvasRecipe {
  recipe: Recipe;
  /** A Table's rows, one run each (the Many tab). */
  rows: Record<string, string>[];
  /** The canvas's generator nodes each step came from. */
  nodes: Record<string, string>;
  /** What a node can't do as a step, by node. */
  refusals: { node: string; label: string; reason: string }[];
}

/**
 * A canvas as a recipe: every generator node a generate step (its request as describeNode builds it), its links to other
 * generator nodes `after` with their chain slots, and the input nodes that came from a skill's inputs put back as
 * {{id}}. `page` names it in the recipe's source.
 */
export function canvasToRecipe(graph: CanvasGraph, page?: { id: string }): CanvasRecipe | { error: string } {
  const refusals: CanvasRecipe["refusals"] = [];
  const params: RecipeParam[] = [];
  const taken = new Set<string>();
  let rows: Record<string, string>[] = [];
  // Inputs from a skill: their node's value becomes the placeholder, so the request is built with it.
  const nodes = graph.nodes.map((n): CanvasNode => {
    const p = n.data.param as ParamData | undefined;
    if (!p || taken.has(p.id)) return n;
    taken.add(p.id);
    params.push(p);
    if (n.type === "prompt") return { ...n, data: { ...n.data, text: `{{${p.id}}}` } };
    if (n.type === "element") return n;
    return { ...n, data: { ...n.data, url: `{{${p.id}}}` } };
  });
  // A Table: one text input per column; the node it feeds reads the row's cells (rowText), so it becomes a text prompt
  // of the columns' inputs, and "{Column}" in a prompt becomes that column's input.
  const tables = nodes.filter((n) => n.type === "table");
  if (tables.length > 1) return { error: "A canvas with more than one table can't be a skill yet" };
  const columnIds = new Map<string, string>();
  const withTables = nodes.map((n) => {
    if (n.type !== "table") return n;
    const cols = (n.data.columns ?? []).slice(0, TABLE_LIMITS.columns);
    cols.forEach((c, i) => {
      const id = columnId(c, i, taken);
      columnIds.set(c, id);
      params.push({ id, label: (c || `Column ${i + 1}`).slice(0, 60), type: "text", required: true });
    });
    rows = tableRows(n)
      .slice(0, TABLE_LIMITS.rows)
      .map((cells) => Object.fromEntries(cols.map((c, i) => [columnIds.get(c)!, cells[i] ?? ""])));
    const first = rows[0] ?? {};
    for (const p of params) if (columnIds.has(p.label) && first[p.id]) p.example = first[p.id];
    return { ...n, type: "prompt" as const, data: { ...n.data, text: cols.map((c) => `{{${columnIds.get(c)}}}`).join(", ") } };
  });
  const prepared: CanvasGraph = {
    ...graph,
    nodes: withTables.map((n) =>
      typeof n.data.prompt === "string" && columnIds.size ? { ...n, data: { ...n.data, prompt: n.data.prompt.replace(/\{([^{}]+)\}/g, (m, c: string) => (columnIds.has(c) ? `{{${columnIds.get(c)}}}` : m)) } } : n,
    ),
  };
  const { cyclic } = topoOrder(prepared);
  if (cyclic.length) return { error: "Some nodes wait for each other in a loop: break the loop first" };
  // The board's own order where the links allow it (a skill drawn and saved back keeps its steps' order).
  const order: string[] = [];
  const placed = new Set<string>();
  while (order.length < prepared.nodes.length) {
    const next = prepared.nodes.find((n) => !placed.has(n.id) && prepared.edges.filter((e) => e.target === n.id).every((e) => placed.has(e.source) || !prepared.nodes.some((x) => x.id === e.source)));
    if (!next) break;
    order.push(next.id);
    placed.add(next.id);
  }
  const byId = new Map(prepared.nodes.map((n) => [n.id, n]));
  const steps: RecipeStep[] = [];
  const stepOf = new Map<string, string>();
  const keys = new Set<string>();
  const keyFor = (n: CanvasNode) => {
    let k = (n.id.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "") || "step").slice(0, 36);
    for (let i = 2; keys.has(k); i++) k = `${k.slice(0, 33)}-${i}`;
    keys.add(k);
    return k;
  };
  for (const id of order) {
    const n = byId.get(id);
    if (!n || !isGenerator(n)) continue;
    const label = nodeLabel(n);
    const d = describeNode(prepared, n);
    if (!d.request) {
      refusals.push({ node: n.id, label, reason: d.error ?? "It can't run as it is" });
      continue;
    }
    const missing = d.deps?.find((dep) => !stepOf.has(dep));
    if (missing) {
      refusals.push({ node: n.id, label, reason: `It waits for “${nodeLabel(byId.get(missing) ?? n)}”, which can't be a step` });
      continue;
    }
    const base = (n.data.recipeStep as { label?: string; request?: Record<string, unknown> } | undefined) ?? {};
    if (d.steps?.length) {
      // A node made in several steps (Assemble film): each step, fed by the nodes and steps it takes.
      if (d.steps.some((st) => st.from.some((f) => "row" in f && f.row !== undefined))) {
        refusals.push({ node: n.id, label, reason: "A film of a table's rows can't be a skill yet" });
        continue;
      }
      const own = new Map<string, string>();
      for (const st of d.steps) {
        const key = keyFor({ ...n, id: `${n.id}-${st.key}` });
        own.set(st.key, key);
        const after = st.from.map((f) => ("node" in f ? stepOf.get(f.node)! : own.get(f.step)!));
        const { chain, ...request } = st.request;
        steps.push({ key, kind: "generate", label: st.request.step?.label ?? label, ...(after.length && { after: after.length === 1 ? after[0] : after }), ...(chain?.length && { chain }), request: { ...request, feature: "skill" } as never });
      }
      stepOf.set(n.id, own.get(d.steps.at(-1)!.key)!);
      continue;
    }
    const key = typeof (base as { key?: unknown }).key === "string" && !keys.has((base as { key: string }).key) ? (keys.add((base as { key: string }).key), (base as { key: string }).key) : keyFor(n);
    stepOf.set(n.id, key);
    const { chain, ...built } = d.request;
    // The step as the recipe held it, with what the canvas says now (its model, operation, words, settings, inputs).
    const request = { ...(base.request ?? {}), ...built, feature: "skill" } as Record<string, unknown>;
    if (!built.inputs) delete request.inputs;
    if (!built.prompt) delete request.prompt;
    if (!built.params) delete request.params;
    if (!built.op && !(base.request as { op?: unknown } | undefined)?.op) delete request.op;
    delete request.chain;
    const after = (d.deps ?? []).map((dep) => stepOf.get(dep)!);
    steps.push({
      key,
      kind: "generate",
      ...((base.label ?? (n.data.label as string | undefined)) && { label: String(base.label ?? n.data.label).slice(0, 80) }),
      ...(after.length && { after: after.length === 1 ? after[0] : after }),
      ...(chain?.length && { chain: chain.map((c) => ({ slot: c.slot })) }),
      request: request as never,
    });
  }
  if (!steps.length) return { error: refusals[0]?.reason ? `Nothing on this canvas can be a step: ${refusals[0].reason}` : "Add a model node first: a skill needs a step" };
  // Inputs no step uses (a node left unconnected) stay out.
  const used = JSON.stringify(steps);
  const kept = params.filter((p) => used.includes(`{{${p.id}}}`));
  const recipe: Recipe = { fuobeRecipe: 1, params: kept, steps, ...(page && { source: { from: "canvas", canvas: page.id } }) };
  return { recipe, rows: rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => kept.some((p) => p.id === k)))), nodes: Object.fromEntries([...stepOf.entries()].map(([node, step]) => [step, node])), refusals };
}
