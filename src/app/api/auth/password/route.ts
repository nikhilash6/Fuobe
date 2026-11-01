import { cookies } from "next/headers";
import { connection } from "next/server";
import { z } from "zod";
import { authEnabled, authStatus, checkPassword, createSession, SESSION_COOKIE, sessionCookieOf, setPassword, validSession } from "@/server/auth";

const Body = z.object({ current: z.string().max(500).optional(), password: z.string().max(500).nullable() });

export async function GET() {
  await connection();
  return Response.json(authStatus());
}

/** Set, change or remove the password. Changing it needs the current one; this browser stays signed in. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { current, password } = parsed.data;
  const jar = await cookies();
  if (authEnabled() && !validSession(sessionCookieOf(request))) return Response.json({ error: "Change the password from a signed-in browser" }, { status: 403 });
  if (authEnabled() && !checkPassword(current ?? "")) return Response.json({ error: "The current password is wrong" }, { status: 403 });
  try {
    setPassword(password);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  if (password) {
    const s = createSession();
    jar.set(SESSION_COOKIE, s.value, { httpOnly: true, sameSite: "lax", secure: new URL(request.url).protocol === "https:", path: "/", maxAge: s.maxAge });
  } else {
    jar.delete(SESSION_COOKIE);
  }
  return Response.json(authStatus());
}
