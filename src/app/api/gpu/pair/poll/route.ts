import { pollPairing } from "@/server/computer/workers";
import { hit } from "@/server/rate";

/**
 * Fuobe Connect asks whether its code was approved, with the secret only it has: "waiting", "approved" with its token
 * (once: the token is made now, and only its hash is kept), or "gone" (denied, expired, or already delivered).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: unknown; secret?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id.slice(0, 32) : "";
  const r = hit(`pair-poll:${id}`, 60, 60_000);
  if (!r.ok) return Response.json({ error: "Too many at once" }, { status: 429, headers: { "Retry-After": String(r.retryAfterS) } });
  const a = pollPairing(body?.id, body?.secret);
  return Response.json(a, { status: a.state === "gone" ? 404 : 200, headers: { "Cache-Control": "no-store" } });
}
