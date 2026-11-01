import fs from "node:fs";
import { Readable } from "node:stream";
import { connection } from "next/server";
import { principalOf, rateOf, relayAnswer } from "@/server/computer/http";
import { inputFor, leased } from "@/server/computer/tasks";

/**
 * One input of a job, for the tab that took it (its token in X-Fuobe-Lease), while it sends the job's files to its
 * ComfyUI: a few reads each, as bytes that are never a page (no-sniff, never cached). The tab checks its SHA-256 before
 * it passes it on.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/gpu/computer/tasks/[id]/inputs/[n]">) {
  await connection();
  const principal = principalOf(request);
  if (principal instanceof Response) return principal;
  const limited = rateOf(principal, "input", 120);
  if (limited) return limited;
  const { id, n } = await ctx.params;
  try {
    const t = leased(principal, id, request.headers.get("x-fuobe-lease"));
    const file = inputFor(t, Number.parseInt(n, 10));
    const stream = Readable.toWeb(fs.createReadStream(file.path)) as ReadableStream<Uint8Array>;
    return new Response(stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(file.size),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
        "X-Fuobe-Sha256": file.sha256,
      },
    });
  } catch (e) {
    return relayAnswer(e);
  }
}
