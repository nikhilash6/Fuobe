import { connection } from "next/server";
import { adminAccess } from "@/server/admin-tokens";
import { listWorkerJobs, workerJobsQueryFrom } from "@/server/computer/tasks";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The workers' log, newest first (owner only, or an admin token with workers:read; docs/gpu-workers.md): which worker
 * took which job and when, and how it ended, with the measured run. Ids, times and those facts only. `before=<id>` (the
 * `next` of the last page), `limit` (1 to 200, 50 when not given), `worker=<id>`, `generation=<run id>`.
 */
export async function GET(request: Request) {
  await connection();
  const access = adminAccess(request, "workers:read", "Only the studio's owner sees the workers' log");
  if (access instanceof Response) return access;
  const q = workerJobsQueryFrom(new URL(request.url).searchParams);
  if ("error" in q) return Response.json({ error: q.error }, { status: 400, headers: NO_STORE });
  return Response.json(listWorkerJobs(q), { headers: NO_STORE });
}
