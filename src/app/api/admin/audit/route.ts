import { connection } from "next/server";
import { adminAccess, auditQueryFrom, auditRead, listAudit } from "@/server/admin-tokens";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The admin log, newest first (an admin token with audit:read, or the owner): `before=<id>` (the `next` of the last
 * page), `limit` (1 to 200, 50 when not given), `actor=owner|token`, `token=<id>`, `action=<name>`.
 */
export async function GET(request: Request) {
  await connection();
  const access = adminAccess(request, "audit:read", "You can't open this.");
  if (access instanceof Response) return access;
  const q = auditQueryFrom(new URL(request.url).searchParams);
  if ("error" in q) return Response.json({ error: q.error }, { status: 400, headers: NO_STORE });
  auditRead(access.actor, "audit.read");
  return Response.json(listAudit(q), { headers: NO_STORE });
}
