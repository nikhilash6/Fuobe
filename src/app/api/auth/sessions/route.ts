import { z } from "zod";
import { authEnabled, SESSION_COOKIE, sessionCookieOf, signOutEveryone, validSession } from "@/server/auth";

/**
 * Settings → Security → Sign everyone out: a new session secret, so every signed-in browser (the owner's, this one
 * too, and every account's) has to sign in again. It works while FUOBE_PASSWORD is set. Only from the owner's
 * signed-in browser (an API token can't do it). With { tokens: true }, every API token is revoked too.
 */
export async function POST(request: Request) {
  if (!authEnabled()) return Response.json({ error: "Set a password first. Without one, nobody signs in." }, { status: 400 });
  if (!validSession(sessionCookieOf(request))) return Response.json({ error: "Sign everyone out from the owner's signed-in browser" }, { status: 403 });
  const parsed = z.object({ tokens: z.boolean().optional() }).safeParse(await request.json().catch(() => ({})));
  const tokensRevoked = parsed.success && parsed.data.tokens === true;
  signOutEveryone({ tokens: tokensRevoked });
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return Response.json(
    { ok: true, tokensRevoked },
    { headers: { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`, "Cache-Control": "no-store" } },
  );
}
