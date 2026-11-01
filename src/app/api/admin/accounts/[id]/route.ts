import { z } from "zod";
import { AccountError, isOwnerRequest, listAccounts, sessionCookieOf, setAccountDisabled } from "@/server/auth";
import { removeAccount } from "@/server/account-sweep";

async function owner(request: Request): Promise<Response | null> {
  return isOwnerRequest(request, sessionCookieOf(request)) ? null : Response.json({ error: "Only the studio's owner manages accounts" }, { status: 403 });
}

const failed = (e: unknown) => {
  if (e instanceof AccountError) return Response.json({ error: e.message }, { status: e.status });
  throw e;
};

/** Switch an account off (`{ disabled: true }`: signed out, can't log in) or on again. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/accounts/[id]">) {
  const denied = await owner(request);
  if (denied) return denied;
  const parsed = z.object({ disabled: z.boolean() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send { disabled: true } or { disabled: false }" }, { status: 400 });
  const { id } = await ctx.params;
  try {
    setAccountDisabled(id, parsed.data.disabled);
  } catch (e) {
    return failed(e);
  }
  return Response.json(listAccounts().find((a) => a.id === id));
}

/** Delete an account. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/admin/accounts/[id]">) {
  const denied = await owner(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  // Switched off at once, its running jobs stopped (on its own keys), then its runs, files and record go.
  try {
    await removeAccount(id);
  } catch (e) {
    return failed(e);
  }
  return new Response(null, { status: 204 });
}
