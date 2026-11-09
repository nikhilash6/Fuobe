import { connection } from "next/server";
import { z } from "zod";
import { accountsWithStats } from "@/server/account-admin";
import { adminAccess, audit, auditRead, type Actor } from "@/server/admin-tokens";
import { AccountError, accountInfo, setAccountDisabled, setAccountEmailAsOwner, setAccountPasswordAsOwner, signOutAccount } from "@/server/auth";
import { removeAccount } from "@/server/account-sweep";
import { revokeWorkersOf } from "@/server/computer/workers";

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
  const account = accountInfo(id);
  if (!account) return Response.json({ error: "No such account" }, { status: 404, headers: NO_STORE });
  auditRead(access.actor, "account.read", null, id);
  return Response.json(accountsWithStats([account]).items[0], { headers: NO_STORE });
}

const Patch = z.union([
  z.object({ disabled: z.boolean() }).strict(),
  z.object({ signOut: z.literal(true) }).strict(),
  z.object({ password: z.string().max(500) }).strict(),
  z.object({ email: z.string().max(254) }).strict(),
]);

/**
 * Switch an account off (`{ disabled: true }`: signed out, can't log in) or on again, sign it out everywhere
 * (`{ signOut: true }`: every sign-in ends and its paired ComfyUIs stop, and it stays on), set a new password
 * (`{ password }`: 8 characters or more) or a new sign-in email (`{ email }`: 409 when another account uses it). A new
 * password or email ends every sign-in of the account. The log never holds a password or an email.
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/accounts/[id]">) {
  const access = adminAccess(request, "accounts:write", DENIED);
  if (access instanceof Response) return access;
  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send { disabled: true }, { disabled: false }, { signOut: true }, { password } or { email }" }, { status: 400, headers: NO_STORE });
  const { id } = await ctx.params;
  const body = parsed.data;
  const action =
    "signOut" in body ? "account.signout" : "password" in body ? "account.password" : "email" in body ? "account.email" : body.disabled ? "account.disable" : "account.enable";
  let computers = 0;
  try {
    if ("signOut" in body) {
      signOutAccount(id);
      computers = revokeWorkersOf(`acct:${id}`);
    } else if ("password" in body) await setAccountPasswordAsOwner(id, body.password);
    else if ("email" in body) setAccountEmailAsOwner(id, body.email);
    else setAccountDisabled(id, body.disabled);
  } catch (e) {
    return failed(e, access.actor, action, id);
  }
  audit(access.actor, action, id, computers ? { computers } : null, 200);
  return Response.json(accountInfo(id), { headers: NO_STORE });
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
