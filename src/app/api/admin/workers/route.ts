import { connection } from "next/server";
import { isOwnerRequest, sessionCookieOf } from "@/server/auth";
import { addWorker, lanesCatalog, listWorkers } from "@/server/computer/pool";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Settings → Workers (owner only, docs/gpu-workers.md): the shared GPUs with their state in words, and the lanes this
 * studio's catalog has (to allow per worker). POST `{ name, pool? }` adds one: paused, with no hours and no lanes; its
 * token is in this answer only.
 */
export async function GET(request: Request) {
  await connection();
  if (!isOwnerRequest(request, sessionCookieOf(request))) return Response.json({ error: "Only the studio's owner manages workers" }, { status: 403, headers: NO_STORE });
  return Response.json({ workers: listWorkers(), lanes: lanesCatalog() }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  if (!isOwnerRequest(request, sessionCookieOf(request))) return Response.json({ error: "Only the studio's owner manages workers" }, { status: 403, headers: NO_STORE });
  const body = (await request.json().catch(() => null)) as { name?: unknown; pool?: unknown } | null;
  try {
    const w = addWorker(typeof body?.name === "string" ? body.name.slice(0, 48) : "", typeof body?.pool === "string" ? body.pool : undefined);
    return Response.json(w, { status: 201, headers: NO_STORE });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400, headers: NO_STORE });
  }
}
