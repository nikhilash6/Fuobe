import { connection } from "next/server";
import { isOwnerRequest, sessionCookieOf } from "@/server/auth";
import { queueView } from "@/server/computer/pool";

/** The line for workers (owner only): per lane, how many wait, the oldest, the estimate, and which workers have it warm. */
export async function GET(request: Request) {
  await connection();
  if (!isOwnerRequest(request, sessionCookieOf(request))) return Response.json({ error: "Only the studio's owner sees the queue" }, { status: 403 });
  return Response.json(queueView(), { headers: { "Cache-Control": "no-store" } });
}
