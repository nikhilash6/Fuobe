import { connection } from "next/server";
import { authVersion, isOwnerRequest, sessionCookieOf } from "@/server/auth";
import { ensureRunner } from "@/server/generations";
import { generationEventStream } from "@/server/live";

/**
 * Live generation updates (server-sent events), behind the same sign-in as the REST API (proxy):
 *   event: generation   data: the Generation JSON, exactly as GET /api/generations returns it
 *   event: deleted      data: {"id": "…"}
 *   : ping              every 15 s
 * Sent on every insert or update of a generation row (status, progress, outputs…).
 *
 * The owner's feed only. The proxy checks who is asking when the stream opens; while it stays open (it can for days),
 * the sign-in is checked again whenever the sign-in file changes and on every ping, and the stream ends once it no
 * longer holds: after Sign everyone out, a new password, a revoked token, or the sign-in's own end.
 */
export async function GET(request: Request) {
  // Never prerendered, and the runner that produces the updates is running.
  await connection();
  const cookie = sessionCookieOf(request);
  if (!isOwnerRequest(request, cookie)) return Response.json({ error: "Sign in first" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  ensureRunner();
  let seen = authVersion();
  let ok = true;
  const allowed = (ping: boolean) => {
    const now = authVersion();
    if (ping || now !== seen) {
      seen = now;
      ok = isOwnerRequest(request, cookie);
    }
    return ok;
  };
  return generationEventStream(request.signal, { allowed });
}
