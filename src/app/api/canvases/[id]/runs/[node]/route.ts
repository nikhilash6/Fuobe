import { z } from "zod";
import { KINETIC_RUN_ROWS, KineticRunProblem, recordKineticRun } from "@/server/canvas";

const Id = z.string().min(1).max(40);
const Body = z
  .object({
    sig: z.string().max(400),
    ids: z.array(Id).min(1).max(KINETIC_RUN_ROWS),
    rows: z.array(Id).max(KINETIC_RUN_ROWS).optional(),
    rowSigs: z.array(z.string().max(400)).max(KINETIC_RUN_ROWS).optional(),
  })
  .superRefine((b, ctx) => {
    // One result per row, each once; the rows and their signatures line up with the results.
    if (new Set(b.ids).size !== b.ids.length) ctx.addIssue({ code: "custom", path: ["ids"], message: "A result twice" });
    if (b.rows && (b.rows.length !== b.ids.length || b.rows.some((r) => !b.ids.includes(r)))) ctx.addIssue({ code: "custom", path: ["rows"], message: "The rows" });
    if (b.rowSigs && b.rowSigs.length !== b.ids.length) ctx.addIssue({ code: "custom", path: ["rowSigs"], message: "The row signatures" });
  });

/**
 * Keeps a Kinetic node's run on the canvas: it renders in the owner's browser (each row saved as a Kinetic Motion
 * result), and this records which results it made, so the Output nodes it feeds show them. Canvas changes are the
 * owner's (the proxy refuses accounts and guests).
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/canvases/[id]/runs/[node]">) {
  const { id, node } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send the run's results" }, { status: 400 });
  try {
    const canvas = recordKineticRun(id, node, parsed.data);
    return Response.json({ runs: canvas.runs });
  } catch (e) {
    if (e instanceof KineticRunProblem) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
