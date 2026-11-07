import { adminAccess, audit } from "@/server/admin-tokens";
import { applyModeChange, checkModeChange } from "@/server/computer/queue-controls";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Who the GPUs serve first (owner only, or an admin token with queue:control): `{ pool?: "pool", worker?: id, mode,
 * forMin? }`, mode one of people-first, people-only, ours-first, balanced, or null for back to normal (the pool to people
 * first, a worker to its pool's mode). forMin: 1 to 10080 minutes, or null for until it is switched back. Workers follow
 * it from their next claim and beat. Each change is in the admin log with the mode before and after.
 */
export async function POST(request: Request) {
  const access = adminAccess(request, "queue:control", "Only the studio's owner changes the queue");
  if (access instanceof Response) return access;
  const by = access.actor.kind === "token" ? access.actor.name : "owner";
  const body = (await request.json().catch(() => null)) as unknown;
  const now = Date.now();
  const c = checkModeChange(body, by, now);
  if ("error" in c) {
    audit(access.actor, "queue.mode", null, null, 400, now);
    return Response.json({ error: c.error }, { status: 400, headers: NO_STORE });
  }
  const target = c.scope === "pool" ? `pool:${c.pool}` : `worker:${c.worker}`;
  const r = applyModeChange(c, now);
  if (!r) {
    audit(access.actor, "queue.mode", target, null, 404, now);
    return Response.json({ error: "No such worker" }, { status: 404, headers: NO_STORE });
  }
  audit(access.actor, "queue.mode", target, { before: r.before.mode, after: r.after.mode, from: r.after.from, until: r.after.until }, 200, now);
  return Response.json({ mode: r.after, before: r.before }, { headers: NO_STORE });
}
