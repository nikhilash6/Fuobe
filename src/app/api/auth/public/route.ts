import { connection } from "next/server";
import { z } from "zod";
import { authEnabled, publicSignup, publicSignupFromEnv, publicSignupSetting, sessionCookieOf, setPublicSignup, validSession } from "@/server/auth";

const status = (request: Request) => ({
  /** The Settings switch. */
  setting: publicSignupSetting(),
  /** FUOBE_PUBLIC_SIGNUP when set (then the switch does nothing). */
  fromEnv: publicSignupFromEnv(),
  /** On for this address right now. */
  active: publicSignup(request.headers.get("host")),
});

/** Settings → Security: public sign-up (guests browse read-only, anyone can make an account). */
export async function GET(request: Request) {
  await connection();
  return Response.json(status(request));
}

/** Switch it on or off: the owner, from a signed-in browser. */
export async function PUT(request: Request) {
  if (!authEnabled()) return Response.json({ error: "Set a password first: without one the studio is open to everyone who can reach it" }, { status: 400 });
  if (!validSession(sessionCookieOf(request))) return Response.json({ error: "Change this from the owner's signed-in browser" }, { status: 403 });
  const parsed = z.object({ on: z.boolean() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send { on: true } or { on: false }" }, { status: 400 });
  try {
    setPublicSignup(parsed.data.on);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  return Response.json(status(request));
}
