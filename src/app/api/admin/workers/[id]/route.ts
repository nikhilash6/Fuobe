import { isOwnerRequest, sessionCookieOf } from "@/server/auth";
import { patchWorker, type WorkerPatch } from "@/server/computer/pool";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Change a worker (owner only): `{ paused, pauseNow, drain, autoResume, hours, allow, claimAfterMs, switchAfterMs, rotate, revoke }`.
 * Each reaches the worker at its next beat. Rotate answers with the new token, once; revoke stops the old token at once
 * and puts its job back in line.
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/workers/[id]">) {
  if (!isOwnerRequest(request, sessionCookieOf(request))) return Response.json({ error: "Only the studio's owner manages workers" }, { status: 403, headers: NO_STORE });
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as WorkerPatch | null;
  if (!body || typeof body !== "object") return Response.json({ error: "Say what to change" }, { status: 400, headers: NO_STORE });
  try {
    const r = patchWorker(id, body);
    if (!r.view && !body.revoke) return Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    return Response.json({ worker: r.view, ...(r.token && { token: r.token }) }, { headers: NO_STORE });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400, headers: NO_STORE });
  }
}
