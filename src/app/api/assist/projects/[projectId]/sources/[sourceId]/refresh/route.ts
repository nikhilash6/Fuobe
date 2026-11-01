import { ProjectError, refreshSource } from "@/server/assist/projects";

/** Fetch a link source again. */
export async function POST(_req: Request, ctx: RouteContext<"/api/assist/projects/[projectId]/sources/[sourceId]/refresh">) {
  const { projectId, sourceId } = await ctx.params;
  try {
    return Response.json(await refreshSource(projectId, sourceId));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof ProjectError ? e.status : 500 });
  }
}
