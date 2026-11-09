import { adminAccess, audit } from "@/server/admin-tokens";
import { pauseRun } from "@/server/computer/pool";
import { overrideView } from "@/server/computer/queue-controls";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Pause a run (owner only, or an admin token with queue:control): `{ generationId }`. It is held, and a job of it that a
 * worker's GPU runs now goes back in line with no attempt counted and its place kept; the worker takes it off its
 * ComfyUI at its next beat (src/server/computer/pool.ts pauseRun). Ending the hold (DELETE
 * /api/admin/queue/overrides/{id}) resumes it: it runs again from the start. 404 for no such run; 409 for one that
 * ended, one that isn't in this site's line, or one saving its results now.
 */
export async function POST(request: Request) {
  const access = adminAccess(request, "queue:control", "Only the studio's owner changes the queue");
  if (access instanceof Response) return access;
  const by = access.actor.kind === "token" ? access.actor.name : "owner";
  const body = (await request.json().catch(() => null)) as { generationId?: unknown } | null;
  const id = body && typeof body === "object" && typeof body.generationId === "string" && /^[\w-]{1,80}$/.test(body.generationId) ? body.generationId : null;
  const now = Date.now();
  if (!id) {
    audit(access.actor, "queue.pause", null, null, 400, now);
    return Response.json({ error: "generationId is a run's id" }, { status: 400, headers: NO_STORE });
  }
  const r = pauseRun(id, by, now);
  if ("error" in r) {
    audit(access.actor, "queue.pause", id, null, r.status, now);
    return Response.json({ error: r.error }, { status: r.status, headers: NO_STORE });
  }
  audit(access.actor, "queue.pause", id, { override: r.override.id, sentBack: r.sentBack.length, replaced: r.replaced.map((x) => x.id) }, 200, now);
  return Response.json({ generationId: id, override: overrideView(r.override), replaced: r.replaced.map(overrideView), sentBack: r.sentBack.length }, { headers: NO_STORE });
}
