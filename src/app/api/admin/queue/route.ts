import { connection } from "next/server";
import { adminAccess } from "@/server/admin-tokens";
import { queueView } from "@/server/computer/pool";
import { liveQueue } from "@/server/computer/queue-live";

/**
 * The line for workers (owner only, or an admin token with queue:read): per lane, how many wait, the oldest, the
 * estimate, and which workers have it warm; and what the workers do now (queue-live.ts): the jobs they run, the jobs
 * and the line they hold back and why, the later steps of chains that wait, and the text helper's line.
 */
export async function GET(request: Request) {
  await connection();
  const access = adminAccess(request, "queue:read", "Only the studio's owner sees the queue");
  if (access instanceof Response) return access;
  const now = Date.now();
  return Response.json({ ...queueView(now), ...liveQueue(now), now }, { headers: { "Cache-Control": "no-store" } });
}
