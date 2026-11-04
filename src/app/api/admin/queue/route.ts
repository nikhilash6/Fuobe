import { connection } from "next/server";
import { adminAccess } from "@/server/admin-tokens";
import { queueView } from "@/server/computer/pool";

/**
 * The line for workers (owner only, or an admin token with queue:read): per lane, how many wait, the oldest, the
 * estimate, and which workers have it warm.
 */
export async function GET(request: Request) {
  await connection();
  const access = adminAccess(request, "queue:read", "Only the studio's owner sees the queue");
  if (access instanceof Response) return access;
  return Response.json(queueView(), { headers: { "Cache-Control": "no-store" } });
}
