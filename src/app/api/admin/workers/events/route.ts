import { connection } from "next/server";
import { adminAccess } from "@/server/admin-tokens";
import { noteSilentWorkers } from "@/server/computer/pool";
import { listWorkerEvents, workerEventsQueryFrom } from "@/server/computer/worker-events";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The workers' timeline, newest first (owner only, or an admin token with workers:read; docs/gpu-workers.md): state
 * changes, jobs taken, sent back and delivered, stages, answers to claims, admin actions, version changes and each
 * worker's own log lines. `worker=<id>`, `kinds=state,job,stage,looking,admin,version,log` (any of them; all when not
 * given), `before=<id>` (older rows: the `next` of the last page), `after=<id>` (only newer rows: the `latest` of the
 * last answer), `generation=<run id>`, `limit` (1 to 500, 100 when not given).
 */
export async function GET(request: Request) {
  await connection();
  const access = adminAccess(request, "workers:read", "Only the studio's owner sees the workers' timeline");
  if (access instanceof Response) return access;
  const q = workerEventsQueryFrom(new URL(request.url).searchParams);
  if ("error" in q) return Response.json({ error: q.error }, { status: 400, headers: NO_STORE });
  noteSilentWorkers();
  return Response.json(listWorkerEvents(q), { headers: NO_STORE });
}
