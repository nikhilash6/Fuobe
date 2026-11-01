import { connection } from "next/server";
import { z } from "zod";
import { accountsWithStats } from "@/server/account-admin";
import { adminAccess, audit, auditRead, type Actor } from "@/server/admin-tokens";
import { AccountError, listAccounts, setAccountDisabled, signOutAccount } from "@/server/auth";
import { removeAccount } from "@/server/account-sweep";

const NO_STORE = { "Cache-Control": "no-store" };
const DENIED = "You can't open this.";

/** The answer for a failed change, written to the admin log too. */
function failed(e: unknown, actor: Actor, action: string, id: string): Response {
  if (e instanceof AccountError) {
    audit(actor, action, id, null, e.status);
    return Response.json({ error: e.message }, { status: e.status, headers: NO_STORE });
  }
  throw e;
}

/** One account with its numbers (an admin token with accounts:read, or the owner). */
export async function GET(request: Request, ctx: RouteContext<"/api/admin/accounts/[id]">) {
  await connection();
  const access = adminAccess(request, "accounts:read", DENIED);
  if (access instanceof Response) return access;
  const { id } = await ctx.params;
  const account = listAccounts().find((a) => a.id === id);
  if (!account) return Response.json({ error: "No such account" }, { status: 404, headers: NO_STORE });
  auditRead(access.actor, "account.read", null, id);
  return Response.json(accountsWithStats([account]).items[0], { headers: NO_STORE });
}

const Patch = z.union([z.object({ disabled: z.boolean() }).strict(), z.object({ signOut: z.literal(true) }).strict()]);

/**
 * Switch an account off (`{ disabled: true }`: signed out, can't log in) or on again, or sign it out everywhere
 * (`{ signOut: true }`: every sign-in ends, and it stays on).
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/accounts/[id]">) {
  const access = adminAccess(request, "accounts:write", DENIED);
  if (access instanceof Response) return access;
  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send { disabled: true }, { disabled: false } or { signOut: true }" }, { status: 400, headers: NO_STORE });
  const { id } = await ctx.params;
  const action = "signOut" in parsed.data ? "account.signout" : parsed.data.disabled ? "account.disable" : "account.enable";
  try {
    if ("signOut" in parsed.data) signOutAccount(id);
    else setAccountDisabled(id, parsed.data.disabled);
  } catch (e) {
    return failed(e, access.actor, action, id);
  }
  audit(access.actor, action, id, null, 200);
  return Response.json(listAccounts().find((a) => a.id === id), { headers: NO_STORE });
}

/** Delete an account. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/admin/accounts/[id]">) {
  const access = adminAccess(request, "accounts:delete", DENIED);
  if (access instanceof Response) return access;
  const { id } = await ctx.params;
  // Switched off at once, its running jobs stopped (on its own keys), then its runs, files and record go.
  try {
    await removeAccount(id);
  } catch (e) {
    return failed(e, access.actor, "account.delete", id);
  }
  audit(access.actor, "account.delete", id, null, 204);
  return new Response(null, { status: 204, headers: NO_STORE });
}
