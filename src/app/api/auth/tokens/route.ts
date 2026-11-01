import { headers } from "next/headers";
import { connection } from "next/server";
import { z } from "zod";
import { authEnabled, authStatus, createToken, revokeToken, sessionCookieFrom, validSession } from "@/server/auth";

/** Tokens are managed from a signed-in browser only: a token can't mint or revoke tokens. */
async function browserOnly(): Promise<Response | null> {
  if (!authEnabled() || validSession(sessionCookieFrom((await headers()).get("cookie")))) return null;
  return Response.json({ error: "Manage API tokens from a signed-in browser" }, { status: 403 });
}

export async function GET() {
  await connection();
  const denied = await browserOnly();
  if (denied) return denied;
  return Response.json({ tokens: authStatus().tokens });
}

/** Create a token; the full value is in this response only. */
export async function POST(request: Request) {
  const denied = await browserOnly();
  if (denied) return denied;
  const parsed = z.object({ name: z.string().max(60) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Name the token" }, { status: 400 });
  return Response.json(createToken(parsed.data.name), { status: 201 });
}

export async function DELETE(request: Request) {
  const denied = await browserOnly();
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Which token?" }, { status: 400 });
  revokeToken(id);
  return new Response(null, { status: 204 });
}
