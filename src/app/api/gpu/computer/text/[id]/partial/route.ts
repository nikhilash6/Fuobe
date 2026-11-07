import { connection } from "next/server";
import { callerKey, principalOf, rateOf, requestWorker } from "@/server/computer/http";
import { HELPER_LIMITS, partialHelperJob } from "@/server/text-helper";

const answer = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * A worker's text slot sends the words so far for its text job (`{ lease, text }`), a few times a second while it writes.
 * 409 with `stop: true`: the job isn't its own any more (the person went, or it ended), so the slot stops writing.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/gpu/computer/text/[id]/partial">) {
  await connection();
  const principal = principalOf(request);
  if (principal instanceof Response) return principal;
  const worker = requestWorker(request);
  if (worker?.kind !== "pool") return answer(403, { error: "Only a shared worker takes text jobs." });
  const limited = rateOf(callerKey(request, principal), "text-partial", 600);
  if (limited) return limited;
  const { id } = await ctx.params;
  const raw = await request.text().catch(() => "");
  // The words in JSON, with room for escapes: anything bigger isn't a partial answer.
  if (raw.length > HELPER_LIMITS.textBytes * 2 + 1024) return answer(413, { error: "Too long." });
  let body: { lease?: unknown; text?: unknown } = {};
  try {
    body = (JSON.parse(raw) ?? {}) as typeof body;
  } catch {}
  const r = partialHelperJob(worker, id, body);
  if (r === "bad") return answer(400, { error: "Send { lease, text }." });
  return r === "ok" ? answer(200, { ok: true }) : answer(409, { error: "That text job isn't this worker's any more.", stop: true });
}
