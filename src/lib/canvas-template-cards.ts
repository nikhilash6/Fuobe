import "server-only";
import { getModel } from "@/lib/catalog";
import { CANVAS_TEMPLATES, getTemplate, isGenerator, outline, type CanvasNodeType, type CanvasTemplate } from "@/lib/catalog/canvas";
import type { Engine } from "@/lib/catalog/types";
import { EXAMPLE_MEDIA } from "@/lib/examples/media.generated";
import plan from "@/lib/examples/plan.json";
import { presetCover } from "@/lib/preset-covers";
import { templateCover } from "@/lib/template-covers";
import type { CanvasIntro, TemplateCardData, TemplateDetail, TemplateInput } from "@/lib/canvas-sections";

/**
 * One template's board outline and model names on an engine, with the name a node falls back to when its model is
 * switched off in Models & licences (the card swaps it in the browser, as the board the server makes does).
 */
function forEngine(t: CanvasTemplate, engine: Engine): TemplateCardData["byEngine"][Engine] {
  const graph = t.build(engine);
  const nameOf = (id?: string) => getModel(id ?? "")?.name;
  const names = graph.nodes.filter(isGenerator).map((n) => nameOf(n.data.modelId));
  const without = t.build(engine, () => false).nodes;
  const ifOff: NonNullable<TemplateCardData["byEngine"][Engine]["ifOff"]> = [];
  for (const n of graph.nodes) {
    const id = n.data.modelId;
    const name = nameOf(id);
    const instead = nameOf(without.find((x) => x.id === n.id)?.data.modelId);
    if (id && name && instead && instead !== name && !ifOff.some((x) => x.id === id)) ifOff.push({ id, name, instead });
  }
  return { outline: outline(graph), models: [...new Set(names.filter((m): m is string => !!m))], ...(ifOff.length && { ifOff }) };
}

function card(t: CanvasTemplate): TemplateCardData {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    icon: t.icon,
    hue: t.hue,
    section: t.group ?? "",
    rank: t.rank,
    flow: t.flow,
    ...(t.starter === false && { starter: false as const }),
    byEngine: { cloud: forEngine(t, "cloud"), open: forEngine(t, "open") },
  };
}

/** Template cards built here, so the browser never loads the model catalog for /canvas (nor for the pages that prefetch it). */
export function templateCards(): TemplateCardData[] {
  return CANVAS_TEMPLATES.map(card);
}

/** What a kind of input is, in plain words, where the template doesn't say. */
const INPUT_HINT: Partial<Record<CanvasNodeType, string>> = {
  "image-input": "A photo you add.",
  "video-input": "A clip you add.",
  "audio-input": "A recording you add.",
  "clone-voice": "A short recording of the voice to copy.",
  element: "One of your saved elements.",
};
const INPUT_TYPES = new Set<CanvasNodeType>(["prompt", "table", "image-input", "video-input", "audio-input", "clone-voice", "element"]);

/** The example ids the pages have (src/lib/examples/plan.json): "effect-pearl-earring.1". */
const EXAMPLE_IDS = new Set((plan as { id: string }[]).map((r) => r.id));

/** The Video effect a template's "Try this effect in Video" opens, with the effect's own example loaded when it has one. */
function oneStepHref(href: string): string {
  const preset = new URL(href, "http://x").searchParams.get("preset");
  return preset && EXAMPLE_IDS.has(`${preset}.1`) ? `${href}&example=${preset}.1` : href;
}

/** What a sample is, as a template's page shows it: a picture's small copy (a published example's inset), else its kind. */
function sampleOf(t: CanvasTemplate, nodeId: string, type: CanvasNodeType): TemplateInput["sample"] {
  const s = t.samples?.[nodeId];
  if (!s) return undefined;
  const kind = type === "image-input" ? "image" : type === "video-input" ? "video" : "audio";
  return { kind, name: s.name, ...(kind === "image" && { thumb: EXAMPLE_MEDIA[s.src]?.thumb ?? s.src }) };
}

/** A template's page (/canvas/start/<id>): its card, what goes in, the steps and what comes out, in plain words. */
export function templateDetail(id: string): TemplateDetail | undefined {
  const t = getTemplate(id);
  if (!t) return undefined;
  // The words a board starts with are the same on both engines: read them from one.
  const graph = t.build("open");
  const inputs: TemplateInput[] = graph.nodes
    .filter((n) => INPUT_TYPES.has(n.type))
    .map((n) => ({
      id: n.id,
      type: n.type,
      label: n.data.label ?? (n.type === "prompt" ? "Prompt" : "Input"),
      ...((t.inputs?.[n.id] ?? INPUT_HINT[n.type]) && { hint: t.inputs?.[n.id] ?? INPUT_HINT[n.type] }),
      ...(n.type === "prompt" && n.data.text && { text: n.data.text }),
      ...(n.type === "table" && n.data.columns && n.data.rows && { table: { columns: n.data.columns, rows: n.data.rows } }),
      ...(t.samples?.[n.id] && { sample: sampleOf(t, n.id, n.type) }),
    }));
  return { ...card(t), makes: t.makes, steps: t.steps, inputs, ...(t.oneStep && { oneStep: { ...t.oneStep, href: oneStepHref(t.oneStep.href) } }) };
}

/** Every template's page, prerendered. */
export const templateIds = () => CANVAS_TEMPLATES.map((t) => t.id);

/**
 * "What's a canvas?": one real effect film in three tiles, the photo that went in, the scene it became and the moving
 * shot. The photo is the clip's first frame (the effect's own cover), the scene its peak (the template's cover).
 */
export function canvasIntro(templateId = "effect-chain-pearl-earring"): CanvasIntro | undefined {
  const film = templateCover("canvas", templateId);
  const photo = presetCover(templateId.replace(/^effect-chain-/, "effect-"));
  if (!film?.video || !photo) return undefined;
  return { templateId, photo: { src: photo.poster, thumb: photo.thumb }, film };
}
