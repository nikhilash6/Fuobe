import type { Ceiling } from "@/lib/job-ticket";
import type { ClaimedTask } from "@/lib/relay";
import { composeTicket, type WorkerFacts } from "@/lib/ticket-compose";

/**
 * A worker's composer in the tests: a job ticket composed as `fuobe worker run` composes it (bin/lib/worker/run.mjs),
 * with this checkout's catalog and catalog version. The answer the shared runner's `compose` takes.
 */
export async function composeOnWorker(t: Pick<ClaimedTask, "ticket" | "generationId" | "inputs">, o: { ceiling?: Ceiling | null; facts?: WorkerFacts; catalogVersion?: string } = {}) {
  const { loadManifest, getWorkflow } = await import("@/server/providers/comfyui");
  const { catalogVersion } = await import("@/server/computer/catalog-version");
  const r = await composeTicket(
    { ticket: t.ticket, generationId: t.generationId, inputs: t.inputs },
    { catalog: { has: (id) => loadManifest().workflows.some((w) => w.id === id), get: getWorkflow }, catalogVersion: o.catalogVersion ?? catalogVersion()!, ceiling: o.ceiling, facts: o.facts },
  );
  return r.ok ? { graph: r.graph, made: r.made } : { refused: r.reason };
}

/** The graph a worker composes for a task's ticket, from the task's row (its ticket and the inputs it sends). */
export async function graphOfTask(row: { id: string; generation_id: string; ticket_json?: string | null }) {
  const tasks = await import("@/server/computer/tasks");
  const inputs = tasks.inputsOf(row.id).map((i) => ({ n: i.n!, name: i.name, size: i.size, sha256: i.sha256, contentType: i.content_type }));
  const r = await composeOnWorker({ ticket: JSON.parse(row.ticket_json ?? "null"), generationId: row.generation_id, inputs });
  if ("refused" in r) throw new Error(`The ticket was refused: ${r.refused}`);
  return r.graph as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
}
