import { adminAccess, audit } from "@/server/admin-tokens";
import { runRows } from "@/server/computer/queue-controls";
import { cancelGeneration, getGeneration } from "@/server/generations";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Cancel a run that waits or runs on the GPUs (owner only, or an admin token with queue:control): `{ generationId }`. It
 * ends as the person's own Cancel ends it (its hold is released by the same rules, and steps that only fed it are
 * dropped). 404 for no such run, 409 for one that ended already.
 */
export async function POST(request: Request) {
  const access = adminAccess(request, "queue:control", "Only the studio's owner changes the queue");
  if (access instanceof Response) return access;
  const body = (await request.json().catch(() => null)) as { generationId?: unknown } | null;
  const id = body && typeof body === "object" && typeof body.generationId === "string" && /^[\w-]{1,80}$/.test(body.generationId) ? body.generationId : null;
  if (!id) {
    audit(access.actor, "queue.cancel", null, null, 400);
    return Response.json({ error: "generationId is a run's id" }, { status: 400, headers: NO_STORE });
  }
  const run = runRows(id);
  if (!run) {
    audit(access.actor, "queue.cancel", id, null, 404);
    return Response.json({ error: "No such run" }, { status: 404, headers: NO_STORE });
  }
  if (run.status !== "queued" && run.status !== "running") {
    audit(access.actor, "queue.cancel", id, { status: run.status }, 409);
    return Response.json({ error: "That run has ended" }, { status: 409, headers: NO_STORE });
  }
  await cancelGeneration(id);
  const after = getGeneration(id, { includeDeleted: true });
  audit(access.actor, "queue.cancel", id, { account: run.account, status: after?.status ?? null }, 200);
  return Response.json({ generationId: id, status: after?.status ?? null }, { headers: NO_STORE });
}
