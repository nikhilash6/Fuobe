import { adminAccess, audit } from "@/server/admin-tokens";
import { askWorkerUpdate } from "@/server/computer/pool";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Update a worker now (owner only, or an admin token with workers:update or workers:write). Its next beat answer says
 * so: the worker looks for new code at once and restarts on it after the job in hand, never cutting off a person's job.
 * Answers with the worker as Settings → Workers shows it.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/workers/[id]/update">) {
  const access = adminAccess(request, ["workers:update", "workers:write"], "Only the studio's owner manages workers");
  if (access instanceof Response) return access;
  const { id } = await ctx.params;
  const view = askWorkerUpdate(id, access.actor.kind === "token" ? access.actor.name : "owner");
  audit(access.actor, "worker.update", id, {}, view ? 200 : 404);
  if (!view) return Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  return Response.json({ worker: view }, { headers: NO_STORE });
}
