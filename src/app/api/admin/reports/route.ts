import { connection } from "next/server";
import { adminAccess, auditRead } from "@/server/admin-tokens";
import { listReports } from "@/server/moderation";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The reports kept here (no moderation service set), newest first, for an admin token with reports:read or the owner:
 * the same list as the owner's GET /api/reports. `limit` 1 to 500 (100 when not given).
 */
export async function GET(request: Request) {
  await connection();
  const access = adminAccess(request, "reports:read", "Only the studio's owner sees reports");
  if (access instanceof Response) return access;
  const asked = new URL(request.url).searchParams.get("limit");
  const limit = asked === null ? 100 : Math.trunc(Number(asked));
  if (!Number.isFinite(limit) || limit < 1 || limit > 500) return Response.json({ error: "limit is 1 to 500" }, { status: 400, headers: NO_STORE });
  auditRead(access.actor, "reports.list");
  return Response.json({ items: listReports(limit) }, { headers: NO_STORE });
}
