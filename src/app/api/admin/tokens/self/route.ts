import { connection } from "next/server";
import { listAdminTokens, tokenActor } from "@/server/admin-tokens";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The admin token this request carries: its name, scopes and dates (never its value or hash), so a tool can offer only
 * what the token may do. Any valid admin token; nothing else.
 */
export async function GET(request: Request) {
  await connection();
  const t = tokenActor(request);
  if (t instanceof Response) return t;
  if (!t) {
    return Response.json(
      { error: "Send an admin token as Authorization: Bearer fuobe_adm_…", code: "token" },
      { status: 401, headers: { ...NO_STORE, "WWW-Authenticate": 'Bearer realm="fuobe"' } },
    );
  }
  const info = listAdminTokens().find((x) => x.id === t.id);
  if (!info) return Response.json({ error: "This admin token isn't valid.", code: "token" }, { status: 401, headers: NO_STORE });
  return Response.json({ id: info.id, name: info.name, prefix: info.prefix, scopes: info.scopes, expiresAt: info.expiresAt, createdAt: info.createdAt }, { headers: NO_STORE });
}
