import "server-only";
import type { JobTicket } from "@/lib/job-ticket";
import type { Needs } from "@/lib/lanes";
import { composeTicket } from "@/lib/ticket-compose";
import { db } from "../db";
import { getWorkflow, loadManifest } from "../providers/comfyui";
import { catalogVersion } from "./catalog-version";
import { GAVE_BACK_WORDS } from "./pool";
import { endTask, inputsOf, json, setTask, type TaskRow } from "./tasks";

/**
 * Job tickets made before this studio's catalog changed (a new version of the app): a task still waiting in line gets
 * its ticket made again for the catalog it runs now, with its place kept. The same request is composed with this
 * studio's composer, so its files and settings are checked again; the files the graph makes must come out the same. A
 * ticket that no longer composes (its workflow left the catalog, or its settings are no longer allowed) ends its run
 * in one plain sentence. Only waiting tasks: one a worker holds finishes with the ticket it has.
 */
export async function refreshTickets(): Promise<{ refreshed: number; ended: number }> {
  const version = catalogVersion();
  if (!version) return { refreshed: 0, ended: 0 };
  const rows = db()
    .prepare("SELECT * FROM relay_tasks WHERE pools IS NOT NULL AND state = 'waiting' AND ticket_json IS NOT NULL AND json_extract(ticket_json, '$.catalogVersion') IS NOT ?")
    .all(version) as TaskRow[];
  const catalog = { has: (id: string) => loadManifest().workflows.some((w) => w.id === id), get: getWorkflow };
  let refreshed = 0;
  let ended = 0;
  for (const t of rows) {
    const old = json<JobTicket | null>(t.ticket_json ?? null, null);
    if (!old) continue;
    const ticket: JobTicket = { ...old, catalogVersion: version };
    delete ticket.runLimitMs;
    delete ticket.stallMs;
    const inputs = inputsOf(t.id).map((i) => ({ name: i.name, sha256: i.sha256 }));
    const r = await composeTicket({ ticket, generationId: t.generation_id, inputs }, { catalog, catalogVersion: version }).catch(() => null);
    // Written only while the task is as it was read (still waiting, the same ticket).
    db()
      .transaction(() => {
        const nowRow = db().prepare("SELECT state, ticket_json FROM relay_tasks WHERE id = ?").get(t.id) as Pick<TaskRow, "state" | "ticket_json"> | undefined;
        if (!nowRow || nowRow.state !== "waiting" || nowRow.ticket_json !== t.ticket_json) return;
        if (!r?.ok) {
          endTask(t.id, "failed", { error: GAVE_BACK_WORDS });
          ended++;
          return;
        }
        const fresh: JobTicket = { ...ticket, size: r.size };
        const needs = { ...json<Needs | Record<string, never>>(t.needs_json, {}), catalogVersion: version, size: r.size };
        // A new ticket: a worker that refused the old one may take it.
        const { refusedBy: _refused, ...extra } = json<Record<string, unknown>>(t.extra_json, {});
        void _refused;
        setTask(t.id, { ticket_json: JSON.stringify(fresh), needs_json: JSON.stringify(needs), extra_json: JSON.stringify(extra) });
        refreshed++;
      })
      .immediate();
  }
  return { refreshed, ended };
}

declare global {
  var __fuobeTicketRefresh: { version: string; at: number; running: Promise<unknown> } | undefined;
}

/** How often a claim looks again for tickets made for another catalog (another app process may still make them). */
const REFRESH_EVERY_MS = 60_000;

/** Before a worker's claim: refresh old tickets once for each catalog version, and again at most once a minute. */
export async function refreshTicketsBeforeClaim(now = Date.now()): Promise<void> {
  const version = catalogVersion();
  if (!version) return;
  const last = globalThis.__fuobeTicketRefresh;
  if (last && last.version === version && now - last.at < REFRESH_EVERY_MS) {
    await last.running.catch(() => {});
    return;
  }
  const running = refreshTickets().catch(() => null);
  globalThis.__fuobeTicketRefresh = { version, at: now, running };
  await running;
}
