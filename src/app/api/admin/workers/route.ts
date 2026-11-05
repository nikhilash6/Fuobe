import { connection } from "next/server";
import { adminAccess, audit } from "@/server/admin-tokens";
import { addWorker, lanesCatalog, listWorkers } from "@/server/computer/pool";
import { heldView } from "@/server/pool-holds";

const NO_STORE = { "Cache-Control": "no-store" };
const DENIED = "Only the studio's owner manages workers";

/**
 * Settings → Workers (owner only, or an admin token with workers:read / workers:tokens; docs/gpu-workers.md): the
 * shared GPUs with their state in words, and the lanes this studio's catalog has (to allow per worker). POST
 * `{ name, pool? }` adds one: paused, with no hours and no lanes; its token is in this answer only. A worker's token
 * receives accounts' queued jobs and their files, so making one needs workers:tokens, not just workers:write. `held`:
 * the runs made but waiting to enter the line (hosted runs, pool-holds.ts), by why, and the oldest: counts only.
 */
export async function GET(request: Request) {
  await connection();
  const access = adminAccess(request, "workers:read", DENIED);
  if (access instanceof Response) return access;
  return Response.json({ workers: listWorkers(), lanes: lanesCatalog(), held: heldView() }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const access = adminAccess(request, "workers:tokens", DENIED);
  if (access instanceof Response) return access;
  const body = (await request.json().catch(() => null)) as { name?: unknown; pool?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.slice(0, 48) : "";
  const pool = typeof body?.pool === "string" ? body.pool : undefined;
  try {
    const w = addWorker(name, pool);
    // The worker's token is in this answer only: never in the log.
    audit(access.actor, "worker.add", w.id, { name: name.trim(), pool: pool ?? "pool" }, 201);
    return Response.json(w, { status: 201, headers: NO_STORE });
  } catch (e) {
    audit(access.actor, "worker.add", null, { name: name.trim().slice(0, 48) }, 400);
    return Response.json({ error: (e as Error).message }, { status: 400, headers: NO_STORE });
  }
}
