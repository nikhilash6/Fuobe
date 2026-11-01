import { generationAccount } from "@/server/account-library";
import { adminAccess, audit } from "@/server/admin-tokens";
import { deleteForever } from "@/server/library";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Delete an account's run for good (owner only, or an admin token with runs:delete), as the account's own delete does:
 * a run still going is canceled first, and its files go unless another run still uses them, so the account's space
 * comes back at once. The owner's own runs aren't deleted here (the Library has its Trash).
 */
export async function DELETE(request: Request, ctx: RouteContext<"/api/admin/generations/[id]">) {
  const access = adminAccess(request, "runs:delete", "You can't open this.");
  if (access instanceof Response) return access;
  const { id } = await ctx.params;
  const account = generationAccount(id);
  if (account === undefined || account === null) audit(access.actor, "run.delete", id, null, 404);
  if (account === undefined) return Response.json({ error: "No such run" }, { status: 404, headers: NO_STORE });
  if (account === null) return Response.json({ error: "That run is yours, not an account's. Delete it in the Library." }, { status: 404, headers: NO_STORE });
  await deleteForever([id]);
  audit(access.actor, "run.delete", id, { account }, 204);
  return new Response(null, { status: 204, headers: NO_STORE });
}
