import { z } from "zod";
import { endJob } from "@/server/layers";

const Patch = z.object({ state: z.enum(["dismissed", "applied"]) });

/** Dismiss a finished job (a failure you've read, a text detection you've used). */
export async function PATCH(request: Request, ctx: RouteContext<"/api/layers/[id]/jobs/[jobId]">) {
  const { id, jobId } = await ctx.params;
  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid change" }, { status: 400 });
  const job = await endJob(id, jobId, { state: parsed.data.state });
  return job ? Response.json(job) : Response.json({ error: "Not found" }, { status: 404 });
}

/** Cancel a job that's still running (its generations are canceled too). */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/layers/[id]/jobs/[jobId]">) {
  const { id, jobId } = await ctx.params;
  const job = await endJob(id, jobId, { cancel: true });
  return job ? Response.json(job) : Response.json({ error: "Not found" }, { status: 404 });
}
