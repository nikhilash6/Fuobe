import { connection } from "next/server";
import { getGeneration, setFavorite } from "@/server/generations";
import { deleteForever, setPinned, setReview, trashGenerations } from "@/server/library";
import { isReviewStatus } from "@/lib/library";
import { requestAccount } from "@/server/auth";

export async function GET(_req: Request, ctx: RouteContext<"/api/generations/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const g = getGeneration(id);
  return g ? Response.json(g) : Response.json({ error: "Not found" }, { status: 404 });
}

/** Favorite, pin (`pinned`) or set the review status (`review`, null clears it). */
export async function PATCH(request: Request, ctx: RouteContext<"/api/generations/[id]">) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { favorite?: boolean; pinned?: boolean; review?: unknown };
  if (body.review !== undefined && body.review !== null && !isReviewStatus(body.review)) return Response.json({ error: "Pick a review status" }, { status: 400 });
  if (typeof body.favorite === "boolean") setFavorite(id, body.favorite);
  if (typeof body.pinned === "boolean") setPinned([id], body.pinned);
  if (body.review !== undefined) setReview([id], body.review);
  const g = getGeneration(id);
  return g ? Response.json(g) : Response.json({ error: "Not found" }, { status: 404 });
}

/**
 * Move to the Trash (restore with POST /api/generations/bulk {action: "restore"}); `?forever=1` deletes for good. An
 * account's run (the proxy checks it is its own) is always deleted for good: an account has no Trash, and its space comes back at once.
 */
export async function DELETE(request: Request, ctx: RouteContext<"/api/generations/[id]">) {
  const { id } = await ctx.params;
  if (requestAccount(request) || new URL(request.url).searchParams.get("forever") === "1") await deleteForever([id]);
  else trashGenerations([id]);
  return new Response(null, { status: 204 });
}
