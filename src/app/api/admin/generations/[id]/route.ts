import { connection } from "next/server";
import { generationAccount } from "@/server/account-library";
import { actorHas, adminAccess, audit, auditContentRead, lacksScope } from "@/server/admin-tokens";
import { deleteForever } from "@/server/library";
import { runDetails } from "@/server/run-details";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * One account's run in full, for the owner's Run details (owner only, or an admin token with runs:read and
 * outputs:view): what it asked for (each setting beside its default), its files, where it ran, what came back and what
 * the account was shown, and its batch and the account's runs around it. Keys, tokens and a GPU's address never are
 * part of it (src/server/run-details.ts). The account's email needs accounts:read. The owner's own runs aren't here
 * (404): they are in the Library. Each read is in the admin log with the account as its target.
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
  auditContentRead(access.actor, "runs.content", [details.run.account.id], { run: id });
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
