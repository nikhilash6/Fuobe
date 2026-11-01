import { z } from "zod";
import { CanvasConflict, graphProblem, pagesProblem, parseGraph, parsePages, runCanvas } from "@/server/canvas";

const Body = z.object({
  /** The page to run (the first one when omitted). */
  page: z.string().max(40).optional(),
  /** Node ids to run with everything upstream (Run node, Run selected); omit for Run all. */
  targets: z.array(z.string().max(80)).max(300).optional(),
  /** Run a group's nodes (and what they need). */
  group: z.string().max(80).optional(),
  /** Re-run the targets even when their result is still fresh. */
  force: z.boolean().optional(),
  /** Every page as the editor has them (saved first, like the autosave). */
  pages: z.unknown().optional(),
  /** Or only this page's board as the editor shows it (saved first). */
  graph: z.unknown().optional(),
});

/**
 * Turn the graph into generations: one per generator node that needs to run, chained with
 * dependsOn along the edges. Fresh and pinned nodes are reused. 422 when nothing could start.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/canvases/[id]/run">) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid run request" }, { status: 400 });
  const pages = parsed.data.pages === undefined ? undefined : parsePages(parsed.data.pages);
  if (pages === null) return Response.json({ error: pagesProblem(parsed.data.pages) }, { status: 400 });
  const graph = parsed.data.graph === undefined ? undefined : parseGraph(parsed.data.graph);
  if (graph === null) return Response.json({ error: graphProblem(parsed.data.graph) }, { status: 400 });
  let result: ReturnType<typeof runCanvas>;
  try {
    result = runCanvas(id, { page: parsed.data.page, pages, targets: parsed.data.targets, group: parsed.data.group, force: parsed.data.force, graph });
  } catch (e) {
    if (e instanceof CanvasConflict) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
  if (!result) return Response.json({ error: "Not found" }, { status: 404 });
  if (!result.ran.length && result.errors.length) {
    const first = result.errors[0].message;
    return Response.json({ ...result, error: result.errors.length > 1 ? `${first} (and ${result.errors.length - 1} more)` : first }, { status: 422 });
  }
  return Response.json(result, { status: result.ran.length ? 201 : 200 });
}
