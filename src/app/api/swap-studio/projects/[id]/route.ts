import { connection } from "next/server";
import { body, handle } from "@/server/shorts-schemas";
import { deleteProject, EditSchema, editProject, projectView } from "@/server/swap-studio";

/** The project with every job's state (finished jobs are filled in, ready waiting takes launched). */
export async function GET(_req: Request, ctx: RouteContext<"/api/swap-studio/projects/[id]">) {
  await connection();
  return handle(async () => Response.json(projectView((await ctx.params).id)));
}

/** One edit (rename, character, cuts, shot and segment settings, layouts, takes, review…): the project as it is after it. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/swap-studio/projects/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(await editProject(id, await body(request, EditSchema, "That change isn't valid")));
  }, request);
}

/** Delete the project, stopping what it still makes (the assembled clips stay in the Library). */
export async function DELETE(request: Request, ctx: RouteContext<"/api/swap-studio/projects/[id]">) {
  return handle(async () => {
    await deleteProject((await ctx.params).id);
    return new Response(null, { status: 204 });
  }, request);
}
