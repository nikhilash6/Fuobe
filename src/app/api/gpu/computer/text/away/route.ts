import { connection } from "next/server";
import { callerKey, principalOf, rateOf, requestWorker } from "@/server/computer/http";
import { noteHelperAway } from "@/server/text-helper";

const answer = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * A worker's text slot says why it takes no text jobs for now (`{ state }`): "updating" (its worker restarts on new code
 * and is back in moments: a chat waits for it), "paused" or "stopped". Its next claim says it is back.
 */
export async function POST(request: Request) {
  await connection();
  const principal = principalOf(request);
  if (principal instanceof Response) return principal;
  const worker = requestWorker(request);
  if (worker?.kind !== "pool") return answer(403, { error: "Only a shared worker takes text jobs." });
  const limited = rateOf(callerKey(request, principal), "text-away", 30);
  if (limited) return limited;
  const body = ((await request.json().catch(() => null)) ?? {}) as { state?: unknown };
  return noteHelperAway(worker, body.state) ? answer(200, { ok: true }) : answer(400, { error: 'Send { state: "updating" | "paused" | "stopped" } from a slot that has claimed.' });
}
