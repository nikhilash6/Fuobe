import { connection } from "next/server";
import { callerKey, principalOf, rateOf, requestWorker } from "@/server/computer/http";
import { finishHelperJob } from "@/server/text-helper";

const answer = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** A worker's text slot sends the answer to its text job (`{ lease, text }`), or why it has none (`{ lease, error }`). */
export async function POST(request: Request, ctx: RouteContext<"/api/gpu/computer/text/[id]">) {
  await connection();
  const principal = principalOf(request);
  if (principal instanceof Response) return principal;
  const worker = requestWorker(request);
  if (worker?.kind !== "pool") return answer(403, { error: "Only a shared worker takes text jobs." });
  const limited = rateOf(callerKey(request, principal), "text-result", 60);
  if (limited) return limited;
  const { id } = await ctx.params;
  const body = ((await request.json().catch(() => null)) ?? {}) as { lease?: unknown; text?: unknown; error?: unknown };
  return finishHelperJob(worker, id, body) ? answer(200, { ok: true }) : answer(409, { error: "That text job isn't this worker's any more." });
}
