import { connection } from "next/server";
import { generationAccount } from "@/server/account-library";
import { actorHas, adminAccess, audit, auditContentRead, lacksScope } from "@/server/admin-tokens";
import { deleteForever } from "@/server/library";
import { runDetails } from "@/server/run-details";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * One run in full, an account's, a guest's or the owner's own, for the owner's Run details and the admin panel (owner
 * only, or an admin token with runs:read and outputs:view): what it asked for (each setting beside its default), its
 * files, where it ran, what came back and what the account was shown, its batch, its chain's earlier and later steps,
 * and the runs around it. Keys, tokens and a GPU's address never are part of it (src/server/run-details.ts). The
 * account's email needs accounts:read. Each read is in the admin log with the account (or "owner") as its target.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/admin/generations/[id]">) {
  await connection();
  const access = adminAccess(request, "runs:read", "You can't open this.");
  if (access instanceof Response) return access;
  const denied = lacksScope(access.actor, "outputs:view", request);
  if (denied) return denied;
  const { id } = await ctx.params;
  const details = runDetails(id, { emails: actorHas(access.actor, "accounts:read") });
  if (!details) return Response.json({ error: "No such run" }, { status: 404, headers: NO_STORE });
  auditContentRead(access.actor, "runs.content", [details.run.account?.id ?? "owner"], { run: id });
  return Response.json(details, { headers: NO_STORE });
}

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
