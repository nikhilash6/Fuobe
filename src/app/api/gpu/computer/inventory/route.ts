import { callerKey, principalOf, rateOf, requestWorker } from "@/server/computer/http";
import { MODELS_NOT_READY, saveInventory } from "@/server/computer/pool";

/** What an inventory may weigh: 20,000 files with their names and hashes. */
const MAX_BYTES = 8 * 2 ** 20;

/**
 * A worker's verified model files and node packs (docs/gpu-workers.md): the answer is the lanes it can run now, and what
 * each other lane lacks. Only a shared GPU's worker sends one.
 */
export async function PUT(request: Request) {
  const principal = principalOf(request);
  if (principal instanceof Response) return principal;
  const worker = requestWorker(request);
  if (worker?.kind !== "pool") return Response.json({ error: "Only a worker sends its files" }, { status: 403 });
  // A model folder of its isn't there yet: the list it has now lacks those files, so the last one stands.
  if (worker.paused_local && worker.local_why === MODELS_NOT_READY) return Response.json({ error: "Its model folders aren't all there yet. Its last list of files stays." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  const limited = rateOf(callerKey(request, principal), "inventory", 6);
  if (limited) return limited;
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BYTES) return Response.json({ error: "Too much at once" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Send JSON" }, { status: 400 });
  }
  return Response.json({ ok: true, ...saveInventory(worker, body) }, { headers: { "Cache-Control": "no-store" } });
}
