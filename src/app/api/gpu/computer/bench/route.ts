import { callerKey, principalOf, rateOf, requestWorker } from "@/server/computer/http";
import { benchTasks } from "@/server/computer/bench";

/**
 * `fuobe worker bench`: small fixed jobs, one per lane this worker is allowed, for this worker only and never billed.
 * Their times become the worker's wait estimates and run limits. `{ lanes?: string[] }` narrows them.
 */
export async function POST(request: Request) {
  const principal = principalOf(request);
  if (principal instanceof Response) return principal;
  const worker = requestWorker(request);
  if (worker?.kind !== "pool") return Response.json({ error: "Only a worker benchmarks itself" }, { status: 403 });
  const limited = rateOf(callerKey(request, principal), "bench", 2);
  if (limited) return limited;
  const body = (await request.json().catch(() => null)) as { lanes?: unknown } | null;
  const lanes = Array.isArray(body?.lanes) ? body.lanes.filter((x): x is string => typeof x === "string").slice(0, 64) : undefined;
  return Response.json({ tasks: await benchTasks(worker, lanes) }, { headers: { "Cache-Control": "no-store" } });
}
