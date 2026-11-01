import { connection } from "next/server";
import { AdminTokenError, audit, createAdminToken, listAdminTokens, ownerBrowser, revokeAdminToken, SCOPE_LABELS, SCOPES } from "@/server/admin-tokens";

const NO_STORE = { "Cache-Control": "no-store" };

/** Admin tokens are managed from the owner's signed-in browser only: an API token or an admin token can't. */
const denied = () => Response.json({ error: "Manage admin tokens from the owner's signed-in browser" }, { status: 403, headers: NO_STORE });

/** The admin tokens (never their values) and the scopes one may have. */
export async function GET(request: Request) {
  await connection();
  if (!ownerBrowser(request)) return denied();
  return Response.json({ tokens: listAdminTokens(), scopes: SCOPES.map((id) => ({ id, label: SCOPE_LABELS[id] })) }, { headers: NO_STORE });
}

/** Make one: `{ name, scopes, expiresInDays? }`. The token's value is in this answer only. */
export async function POST(request: Request) {
  if (!ownerBrowser(request)) return denied();
  const body = (await request.json().catch(() => null)) as { name?: unknown; scopes?: unknown; expiresInDays?: unknown } | null;
  try {
    const made = createAdminToken({ name: body?.name, scopes: body?.scopes, expiresInDays: body?.expiresInDays });
    audit({ kind: "owner" }, "token.create", made.info.id, { name: made.info.name, scopes: made.info.scopes, expiresAt: made.info.expiresAt }, 201);
    return Response.json(made, { status: 201, headers: NO_STORE });
  } catch (e) {
    if (e instanceof AdminTokenError) return Response.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    throw e;
  }
}

/** Revoke one (`?id=`): it stops working at once. */
export async function DELETE(request: Request) {
  if (!ownerBrowser(request)) return denied();
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[0-9a-f]{12}$/.test(id)) return Response.json({ error: "Which token?" }, { status: 400, headers: NO_STORE });
  const revoked = revokeAdminToken(id);
  if (revoked) audit({ kind: "owner" }, "token.revoke", id, { name: revoked.name }, 204);
  return new Response(null, { status: 204, headers: NO_STORE });
}
