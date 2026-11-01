import { connection } from "next/server";
import { deleteProject, getProject, ProjectError, updateProject } from "@/server/assist/projects";
import { ProjectBody } from "@/server/assist/schemas";

export async function GET(_req: Request, ctx: RouteContext<"/api/assist/projects/[projectId]">) {
  await connection();
  const p = getProject((await ctx.params).projectId);
  return p ? Response.json(p) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/assist/projects/[projectId]">) {
  const parsed = ProjectBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid change" }, { status: 400 });
  try {
    return Response.json(updateProject((await ctx.params).projectId, parsed.data));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof ProjectError ? e.status : 500 });
  }
}

/** Delete the project, its sources and project memories; its chats move to your chats. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/assist/projects/[projectId]">) {
  return deleteProject((await ctx.params).projectId) ? new Response(null, { status: 204 }) : Response.json({ error: "Not found" }, { status: 404 });
}
