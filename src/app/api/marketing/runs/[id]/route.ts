import { connection } from "next/server";
import { deleteRun, getRun } from "@/server/marketing";

export async function GET(_req: Request, ctx: RouteContext<"/api/marketing/runs/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const run = getRun(id);
  return run ? Response.json(run) : Response.json({ error: "Not found" }, { status: 404 });
}

/** Forget a run (its results stay in the Library). */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/marketing/runs/[id]">) {
  const { id } = await ctx.params;
  return deleteRun(id) ? new Response(null, { status: 204 }) : Response.json({ error: "Not found" }, { status: 404 });
}
