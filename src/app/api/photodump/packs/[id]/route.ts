import { deleteUserPack } from "@/server/photodump";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/photodump/packs/[id]">) {
  const { id } = await ctx.params;
  return deleteUserPack(id) ? new Response(null, { status: 204 }) : Response.json({ error: "Not found" }, { status: 404 });
}
