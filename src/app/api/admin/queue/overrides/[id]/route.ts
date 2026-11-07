import { adminAccess, audit } from "@/server/admin-tokens";
import { endOverride, overrideView } from "@/server/computer/queue-controls";

const NO_STORE = { "Cache-Control": "no-store" };

/** Back to normal for one run or person (owner only, or an admin token with queue:control): the override ends now. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/admin/queue/overrides/[id]">) {
  const access = adminAccess(request, "queue:control", "Only the studio's owner changes the queue");
  if (access instanceof Response) return access;
  const by = access.actor.kind === "token" ? access.actor.name : "owner";
  const { id } = await ctx.params;
  if (!/^[0-9a-f]{12}$/.test(id)) return Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  const ended = endOverride(id, by, "released");
  audit(access.actor, "queue.override.end", ended?.target ?? id, ended ? { id, kind: ended.kind, action: ended.action, why: "released" } : null, ended ? 200 : 404);
  if (!ended) return Response.json({ error: "No such override in effect" }, { status: 404, headers: NO_STORE });
  return Response.json({ override: overrideView(ended) }, { headers: NO_STORE });
}
