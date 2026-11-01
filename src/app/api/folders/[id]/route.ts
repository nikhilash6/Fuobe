import { connection } from "next/server";
import { z } from "zod";
import { deleteFolder, getFolder, LibraryError, updateFolder } from "@/server/library";

const Patch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: z.string().max(20).optional(),
  /** Move it into another folder, or (null) to the library root ("" is refused). */
  parentId: z.string().min(1).max(40).nullable().optional(),
  pinned: z.boolean().optional(),
});

export async function GET(_req: Request, ctx: RouteContext<"/api/folders/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const f = getFolder(id);
  return f ? Response.json(f) : Response.json({ error: "Not found" }, { status: 404 });
}

/** Rename, recolour, pin or move (refused into itself or one of its subfolders). */
export async function PATCH(request: Request, ctx: RouteContext<"/api/folders/[id]">) {
  const { id } = await ctx.params;
  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.some((i) => i.path[0] === "parentId") ? "Pick a folder to move it into, or null for the top of the Library" : "Give the folder a name" }, { status: 400 });
  try {
    const f = updateFolder(id, parsed.data);
    return f ? Response.json(f) : Response.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof LibraryError ? e.status : 409 });
  }
}

/** Delete the folder; its results and subfolders move up to its parent (the library root at the top). */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/folders/[id]">) {
  const { id } = await ctx.params;
  return deleteFolder(id) ? new Response(null, { status: 204 }) : Response.json({ error: "Not found" }, { status: 404 });
}
