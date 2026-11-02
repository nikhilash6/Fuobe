import type { Metadata } from "next";
import { CanvasList, type TemplateCardData } from "@/components/canvas/canvas-list";
import { getModel } from "@/lib/catalog";
import { CANVAS_TEMPLATES, isGenerator, outline, type CanvasTemplate } from "@/lib/catalog/canvas";
import type { Engine } from "@/lib/catalog/types";

export const metadata: Metadata = { title: "Canvas" };

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

/** Template cards built here, so the browser never loads the model catalog for /canvas (nor for the pages that prefetch it). */
function templateCards(): TemplateCardData[] {
  return CANVAS_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    icon: t.icon,
    hue: t.hue,
    ...(t.group && { group: t.group }),
    byEngine: { cloud: forEngine(t, "cloud"), open: forEngine(t, "open") },
  }));
}

export default function Page() {
  return <CanvasList templates={templateCards()} />;
}
