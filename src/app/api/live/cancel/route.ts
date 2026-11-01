import { connection } from "next/server";
import { liveWho } from "@/server/live/access";
import { sessionOf } from "@/server/live/sessions";

/**
 * Take this tab's stale renders off (a backup for a browser whose aborted request doesn't reach the server):
 * { sessionId, seqs?: number[], slot?: "live" | "settle" | "warm" }. Keeps are never cancelled here.
 */
export async function POST(request: Request) {
  await connection();
  const who = liveWho(request, { server: true });
  if (who instanceof Response) return who;
  const b = ((await request.json().catch(() => null)) ?? {}) as { sessionId?: unknown; seqs?: unknown; slot?: unknown };
  const s = sessionOf(who.principal, b.sessionId);
  if (!s) return Response.json({ error: "This live session ended", code: "session" }, { status: 410 });
  const seqs = Array.isArray(b.seqs) ? new Set(b.seqs.filter((n): n is number => Number.isSafeInteger(n)).slice(0, 64)) : null;
  const slot = b.slot === "live" || b.slot === "settle" || b.slot === "warm" ? b.slot : null;
  if (!seqs && !slot) return Response.json({ error: "Name the renders to stop" }, { status: 400 });
  s.scheduler.cancel((j) => j.slot !== "keep" && (!seqs || seqs.has(j.seq)) && (!slot || j.slot === slot));
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
