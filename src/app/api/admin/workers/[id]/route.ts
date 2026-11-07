import { adminAccess, audit, lacksScope } from "@/server/admin-tokens";
import { patchWorker, type WorkerPatch } from "@/server/computer/pool";

const NO_STORE = { "Cache-Control": "no-store" };

/** The changes a worker takes: the log names which were sent, never their values (a rotate's token least of all). */
const KEYS = ["paused", "pauseNow", "drain", "autoResume", "hours", "allow", "claimAfterMs", "switchAfterMs", "rotate", "revoke"] as const;

/**
 * Change a worker (owner only, or an admin token with workers:write):
 * `{ paused, pauseNow, drain, autoResume, hours, allow, claimAfterMs, switchAfterMs, rotate, revoke }`.
 * Each reaches the worker at its next beat. Rotate answers with the new token, once (an admin token needs
 * workers:tokens for it); revoke stops the old token at once and puts its job back in line.
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/workers/[id]">) {
  const access = adminAccess(request, "workers:write", "Only the studio's owner manages workers");
  if (access instanceof Response) return access;
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as WorkerPatch | null;
  if (!body || typeof body !== "object") return Response.json({ error: "Say what to change" }, { status: 400, headers: NO_STORE });
  if (body.rotate) {
    const refused = lacksScope(access.actor, "workers:tokens", request);
    if (refused) return refused;
  }
  const action = body.revoke ? "worker.revoke" : body.rotate ? "worker.rotate" : "worker.change";
  const keys = KEYS.filter((k) => k in body);
  try {
    const r = patchWorker(id, body, Date.now(), access.actor.kind === "token" ? access.actor.name : "owner");
    if (!r.view && !body.revoke) {
      audit(access.actor, action, id, { keys }, 404);
      return Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    }
    audit(access.actor, action, id, { keys }, 200);
    return Response.json({ worker: r.view, ...(r.token && { token: r.token }) }, { headers: NO_STORE });
  } catch (e) {
    audit(access.actor, action, id, { keys }, 400);
    return Response.json({ error: (e as Error).message }, { status: 400, headers: NO_STORE });
  }
}
