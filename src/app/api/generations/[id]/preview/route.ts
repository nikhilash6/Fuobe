import fs from "node:fs";
import { connection } from "next/server";
import { runPreview } from "@/server/computer/tasks";
import { getGeneration } from "@/server/generations";

/** Never kept by a browser or a cache in between: the picture changes while the run works, and it is the account's own. */
const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

/**
 * A run's latest preview picture while it works on this install's GPUs (a JPEG its worker sent with its progress).
 * Only the run's own account (or the owner) reaches it: the sign-in proxy checks whose run it is, as for the run
 * itself (guest-access.ts accountGeneration). Nothing once the run has ended or gone back in line: 404.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/generations/[id]/preview">) {
  await connection();
  const { id } = await ctx.params;
  const g = getGeneration(id);
  const p = g && g.status === "running" ? runPreview(id) : null;
  let data: Buffer | null = null;
  try {
    data = p ? fs.readFileSync(p.path) : null;
  } catch {
    // Dropped between the look and the read (the run moved on).
  }
  if (!data) return Response.json({ error: "Not found" }, { status: 404, headers: HEADERS });
  return new Response(new Uint8Array(data), { headers: { ...HEADERS, "Content-Type": "image/jpeg", "Content-Length": String(data.length) } });
}
