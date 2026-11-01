import { connection } from "next/server";
import { z } from "zod";
import { CanvasConflict, canvasView, deleteCanvas, graphProblem, pagesProblem, parseGraph, parsePages, updateCanvas } from "@/server/canvas";

const Patch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  /** Every page (the editor's autosave). */
  pages: z.unknown().optional(),
  /** One page's board (`page`, else the first page). */
  graph: z.unknown().optional(),
  page: z.string().max(40).optional(),
});

/** The board, its nodes' last runs and the generations they made. */
export async function GET(_req: Request, ctx: RouteContext<"/api/canvases/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const view = canvasView(id);
  return view ? Response.json(view) : Response.json({ error: "Not found" }, { status: 404 });
}

/** Rename and/or autosave the pages (or one page's graph). */
export async function PATCH(request: Request, ctx: RouteContext<"/api/canvases/[id]">) {
  const { id } = await ctx.params;
  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Give the canvas a name" }, { status: 400 });
  const pages = parsed.data.pages === undefined ? undefined : parsePages(parsed.data.pages);
  if (pages === null) return Response.json({ error: pagesProblem(parsed.data.pages) }, { status: 400 });
  const graph = parsed.data.graph === undefined ? undefined : parseGraph(parsed.data.graph);
  if (graph === null) return Response.json({ error: graphProblem(parsed.data.graph) }, { status: 400 });
  try {
    const c = updateCanvas(id, { name: parsed.data.name, pages, graph, page: parsed.data.page });
    return c ? Response.json(c) : Response.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    if (e instanceof CanvasConflict) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/canvases/[id]">) {
  const { id } = await ctx.params;
  return deleteCanvas(id) ? new Response(null, { status: 204 }) : Response.json({ error: "Not found" }, { status: 404 });
}
