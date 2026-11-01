import { cookies } from "next/headers";
import { endSession, SESSION_COOKIE } from "@/server/auth";

/** Sign out: this session ends on the server too (a copy of its cookie stops working), and the browser forgets it. */
export async function POST() {
  const jar = await cookies();
  endSession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
