import { deleteSource } from "@/server/assist/projects";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/assist/projects/[projectId]/sources/[sourceId]">) {
  const { projectId, sourceId } = await ctx.params;
  return deleteSource(projectId, sourceId) ? new Response(null, { status: 204 }) : Response.json({ error: "That source isn't in this project" }, { status: 404 });
}
