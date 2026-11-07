import { connection } from "next/server";
import { adminAccess, audit } from "@/server/admin-tokens";
import { addOverride, checkOverride, liveOverrides, overrideView, recentOverrides } from "@/server/computer/queue-controls";

const NO_STORE = { "Cache-Control": "no-store" };

/** The overrides in effect, and the last 20 that ended (owner only, or an admin token with queue:read). */
export async function GET(request: Request) {
  await connection();
  const access = adminAccess(request, "queue:read", "Only the studio's owner sees the queue");
  if (access instanceof Response) return access;
  return Response.json({ live: liveOverrides().map(overrideView), ended: recentOverrides().map(overrideView) }, { headers: NO_STORE });
}

/**
 * A run or a person first, or held (owner only, or an admin token with queue:control; src/server/computer/queue-controls.ts
 * checkOverride): `{ kind: "run", generationId, action: "next" | "hold", worker?, forMin? }` or `{ kind: "person",
 * person (their key on the Queue page) | account, action: "boost" | "hold", forMin }` (a boost needs forMin). A newer one for the same run or person ends the
 * older. 201 with the override; 404 for no such run or worker; 409 for a run that ended.
 */
export async function POST(request: Request) {
  const access = adminAccess(request, "queue:control", "Only the studio's owner changes the queue");
  if (access instanceof Response) return access;
  const by = access.actor.kind === "token" ? access.actor.name : "owner";
  const body = (await request.json().catch(() => null)) as unknown;
  const now = Date.now();
  const o = checkOverride(body, now);
  if ("error" in o) {
    audit(access.actor, "queue.override", null, null, 400, now);
    return Response.json({ error: o.error }, { status: 400, headers: NO_STORE });
  }
  const r = addOverride(o, by, now);
  const target = o.kind === "run" ? o.generationId : ("override" in r ? r.override.target : (o.account ?? o.person!));
  if ("error" in r) {
    audit(access.actor, "queue.override", target, { kind: o.kind, action: o.action }, r.status, now);
    return Response.json({ error: r.error }, { status: r.status, headers: NO_STORE });
  }
  audit(access.actor, "queue.override", target, { id: r.override.id, kind: o.kind, action: o.action, worker: r.override.workerId, until: r.override.until, replaced: r.replaced.map((x) => x.id) }, 201, now);
  return Response.json({ override: overrideView(r.override), replaced: r.replaced.map(overrideView) }, { status: 201, headers: NO_STORE });
}
