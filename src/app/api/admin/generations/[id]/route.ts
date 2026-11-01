import { generationAccount } from "@/server/account-library";
import { isOwnerRequest, sessionCookieOf } from "@/server/auth";
import { deleteForever } from "@/server/library";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Delete an account's run for good (owner only), as the account's own delete does: a run still going is canceled
 * first, and its files go unless another run still uses them, so the account's space comes back at once. The
 * owner's own runs aren't deleted here (the Library has its Trash).
 */
export async function DELETE(request: Request, ctx: RouteContext<"/api/admin/generations/[id]">) {
  if (!isOwnerRequest(request, sessionCookieOf(request))) return Response.json({ error: "Only the studio's owner manages accounts" }, { status: 403, headers: NO_STORE });
  const { id } = await ctx.params;
  const account = generationAccount(id);
  if (account === undefined) return Response.json({ error: "No such run" }, { status: 404, headers: NO_STORE });
  if (account === null) return Response.json({ error: "That run is yours, not an account's. Delete it in the Library." }, { status: 404, headers: NO_STORE });
  await deleteForever([id]);
  return new Response(null, { status: 204, headers: NO_STORE });
}
