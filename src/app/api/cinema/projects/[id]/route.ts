import { connection } from "next/server";
import { CinemaError, deleteProject, getProject, listFolders, spentUsd, updateProject } from "@/server/cinema";
import { ProjectPatch, body, handle } from "@/server/cinema-schemas";
import { requestViewer } from "@/server/auth";
import { cinemaContext } from "@/server/cinema-generate";
import { worldcastContextNow } from "@/server/worldcast-on";

/** The project with its folders, its estimated spend and what this install can run (cloud models allowed, a civitai key). */
export async function GET(req: Request, ctx: RouteContext<"/api/cinema/projects/[id]">) {
  await connection();
  return handle(async () => {
    const { id } = await ctx.params;
    const project = getProject(id);
    if (!project) throw new CinemaError("Project not found", 404);
    const { cloudAllowed, civitai } = cinemaContext();
    // The studio's WorldCast worker, for its owner only (N7-9): the Fly path says what it films on.
    const worldcast = requestViewer(req).kind === "owner" ? await worldcastContextNow() : undefined;
    return Response.json({ project, folders: listFolders(id), spentUsd: spentUsd(id), context: { cloudAllowed, civitai, ...(worldcast !== undefined && { worldcast }) } });
  });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/cinema/projects/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const patch = await body(request, ProjectPatch, "Those project settings aren't valid");
    return Response.json(updateProject(id, patch));
  }, request);
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/cinema/projects/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    deleteProject(id);
    return new Response(null, { status: 204 });
  }, request);
}
