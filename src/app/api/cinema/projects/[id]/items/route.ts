import { connection } from "next/server";
import { listItems, listStudioGenerations, moveItems, removeItems, setFavorites } from "@/server/cinema";
import { ItemsDelete, ItemsPatch, body, handle } from "@/server/cinema-schemas";

/**
 * The project's generations. `?folder=<id>` one folder (`&nested=1` with its subfolders),
 * `?folder=root` the takes outside any folder, `?favorites=1` liked takes, `?scope=studio` every
 * Cinema Studio generation in every project ("My Generations"). Default: the whole project.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/cinema/projects/[id]/items">) {
  await connection();
  return handle(async () => {
    const { id } = await ctx.params;
    const qs = new URL(request.url).searchParams;
    if (qs.get("scope") === "studio") return Response.json({ items: listStudioGenerations() });
    const folder = qs.get("folder");
    const items = listItems(id, {
      folderId: folder === "root" ? null : folder || undefined,
      nested: qs.get("nested") === "1",
      favorites: qs.get("favorites") === "1",
    });
    return Response.json({ items });
  });
}

/** Bulk: move to a folder (`folderId`, null = project root) and/or like / unlike. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/cinema/projects/[id]/items">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const b = await body(request, ItemsPatch, "Pick the takes to change");
    // Only this project's takes change; the counts say how many did.
    const moved = b.folderId !== undefined ? moveItems(id, b.ids, b.folderId) : 0;
    const liked = b.favorite !== undefined ? setFavorites(id, b.ids, b.favorite) : 0;
    return Response.json({ ok: true, moved, liked });
  }, request);
}

/** Bulk: take out of the project; `deleteGenerations` moves them to the library's Trash (restorable, still filed here). Only this project's takes are touched. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/cinema/projects/[id]/items">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const b = await body(request, ItemsDelete, "Pick the takes to delete");
    return Response.json({ removed: removeItems(id, b.ids, { deleteGenerations: b.deleteGenerations }) });
  }, request);
}
