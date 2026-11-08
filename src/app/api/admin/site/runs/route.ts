import { connection } from "next/server";
import { adminAccess, audit } from "@/server/admin-tokens";
import { runFailureDetail, setSetting } from "@/server/settings";

const NO_STORE = { "Cache-Control": "no-store" };
const VALUES = ["full", "friendly"] as const;

/**
 * What people read when a run of theirs fails (owner only, or an admin token with site:read): `failureDetail` is "full"
 * (the plain sentence and, under it, the cleaned technical reason) or "friendly" (the plain sentence only). The same
 * choice as Settings → Failed runs (src/server/settings.ts runFailureDetail).
 */
export async function GET(request: Request) {
  await connection();
  const access = adminAccess(request, "site:read", "Only the studio's owner sees the site's switches");
  if (access instanceof Response) return access;
  return Response.json({ failureDetail: runFailureDetail() }, { headers: NO_STORE });
}

/**
 * Change it (owner only, or an admin token with site:write): `{ failureDetail: "full" | "friendly" }`. Each change is
 * written to the admin log with the value before and after. Runs read it the next time they are shown.
 */
export async function PATCH(request: Request) {
  const access = adminAccess(request, "site:write", "Only the studio's owner changes the site's switches");
  if (access instanceof Response) return access;
  const body = (await request.json().catch(() => null)) as { failureDetail?: unknown } | null;
  const value = body && typeof body === "object" ? body.failureDetail : undefined;
  if (typeof value !== "string" || !(VALUES as readonly string[]).includes(value) || Object.keys(body ?? {}).length !== 1) {
    audit(access.actor, "site.runs", null, { keys: body && typeof body === "object" ? Object.keys(body).slice(0, 8) : [] }, 400);
    return Response.json({ error: `Send { "failureDetail": "full" } or { "failureDetail": "friendly" }` }, { status: 400, headers: NO_STORE });
  }
  const before = runFailureDetail();
  setSetting("runFailureDetail", value, { audited: true });
  const after = runFailureDetail();
  audit(access.actor, "site.runs", null, { before, after }, 200);
  return Response.json({ failureDetail: after }, { headers: NO_STORE });
}
