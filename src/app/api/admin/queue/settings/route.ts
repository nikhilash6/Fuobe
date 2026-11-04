import { connection } from "next/server";
import { adminAccess, audit } from "@/server/admin-tokens";
import { checkQueuePatch, queueSettings, saveQueueSettings } from "@/server/queue-settings";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The line's settings (owner only, or an admin token with queue:read): the run ceiling (a default and per lane, in
 * seconds), the owner's wait limit, fair share and the pick allowance (src/server/queue-settings.ts).
 */
export async function GET(request: Request) {
  await connection();
  const access = adminAccess(request, "queue:read", "Only the studio's owner sees the queue");
  if (access instanceof Response) return access;
  return Response.json({ settings: queueSettings() }, { headers: NO_STORE });
}

/**
 * Change them (owner only, or an admin token with queue:write): any of `{ runCeilingS: { default, lanes },
 * ownerWaitLimitS, fairShare, pickAllowanceMs }`. A given runCeilingS replaces the default and every lane's value. Each
 * change is written to the admin log with the values before and after. It applies to new claims and clocks at once.
 */
export async function PATCH(request: Request) {
  const access = adminAccess(request, "queue:write", "Only the studio's owner changes the queue");
  if (access instanceof Response) return access;
  const body = (await request.json().catch(() => null)) as unknown;
  const before = queueSettings();
  const r = checkQueuePatch(body, before);
  if ("error" in r) {
    audit(access.actor, "queue.settings", null, { keys: body && typeof body === "object" ? Object.keys(body).slice(0, 8) : [] }, 400);
    return Response.json({ error: r.error }, { status: 400, headers: NO_STORE });
  }
  const settings = saveQueueSettings(r.settings);
  audit(access.actor, "queue.settings", null, { before, after: settings }, 200);
  return Response.json({ settings }, { headers: NO_STORE });
}
