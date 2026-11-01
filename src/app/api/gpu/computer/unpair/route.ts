import { revokeWorker, workerFromAuth } from "@/server/computer/workers";

/**
 * A paired ComfyUI disconnects itself (Fuobe Connect's Disconnect): its own token stops. Only with that token, and only
 * for that one worker.
 */
export async function POST(request: Request) {
  const w = workerFromAuth(request.headers.get("authorization"));
  if (!w || w.kind !== "personal") return Response.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  revokeWorker(w.id);
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
