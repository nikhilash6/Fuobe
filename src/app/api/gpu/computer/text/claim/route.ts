import { connection } from "next/server";
import { callerKey, principalOf, rateOf, requestWorker } from "@/server/computer/http";
import { claimHelperJob, helperWaiting, HELPER_TIMES } from "@/server/text-helper";

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/**
 * A worker's text slot asks for the free helper's next text job (src/server/text-helper.ts). It waits up to 20 s for one
 * (or `wait` ms, less): the job, or 204.
 */
export async function POST(request: Request) {
  await connection();
  const principal = principalOf(request);
  if (principal instanceof Response) return principal;
  const worker = requestWorker(request);
  if (worker?.kind !== "pool") return no(403, "Only a shared worker takes text jobs.");
  const limited = rateOf(callerKey(request, principal), "claim-text", 60);
  if (limited) return limited;
  const body = ((await request.json().catch(() => null)) ?? {}) as { model?: unknown; device?: unknown; wait?: unknown };
  const asked = Number(body.wait);
  const wait = Number.isFinite(asked) ? Math.max(0, Math.min(HELPER_TIMES.claimWaitMs, asked)) : HELPER_TIMES.claimWaitMs;
  const end = Date.now() + wait;
  // The slot is noted live on the first look; later looks read the line first and claim only when a job waits.
  for (let first = true; ; first = false) {
    const job = first || helperWaiting() ? claimHelperJob(worker, body, Date.now(), first) : null;
    if (job) return Response.json({ job }, { headers: { "Cache-Control": "no-store" } });
    if (Date.now() >= end || request.signal.aborted) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    await new Promise((r) => setTimeout(r, HELPER_TIMES.pollMs));
  }
}
