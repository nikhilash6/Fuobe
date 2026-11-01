import { connection } from "next/server";
import { projectAssets } from "@/server/assist/agent";
import { getProject } from "@/server/assist/projects";

/** The project's assets: what its chats made (finished generations, newest first). */
export async function GET(_req: Request, ctx: RouteContext<"/api/assist/projects/[projectId]/assets">) {
  await connection();
  const { projectId } = await ctx.params;
  if (!getProject(projectId)) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ items: projectAssets(projectId) });
}
