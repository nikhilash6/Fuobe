import "server-only";
import crypto from "node:crypto";
import type { JobTicket, TicketInput } from "@/lib/job-ticket";
import { graphLoraNames, runtimeNeeds } from "@/lib/runtime-files";
import { composeTicket, inputKind } from "@/lib/ticket-compose";
import { db } from "../db";
import { loadIndex } from "../gpu/index-file";
import { getWorkflow, loadManifest } from "../providers/comfyui";
import { catalogVersion } from "./catalog-version";
import { GAVE_BACK_WORDS, poolFields } from "./pool";
import { endTask, inputsOf, json, setTask, swapTaskInput, type TaskRow } from "./tasks";

/**
 * Job tickets made before this studio's catalog changed (a new version of the app): a task still waiting in line gets
 * its ticket made again for the catalog it runs now, with its place kept (its rank, class and wait). The same request is
 * composed with this studio's composer, so its files and settings are checked again; the files the graph makes are made
 * again too, and staged in place of the old ones when they came out other than before. Its lane and what it needs come
 * from this catalog. A ticket that no longer composes (its workflow left the catalog, or its settings are no longer
 * allowed) ends its run in one plain sentence. Only waiting tasks: one a worker holds finishes with the ticket it has.
 *
 * Only forward: while a deploy's two app processes share the database, only the one started last (the newest version)
 * makes tickets again, and only it ever ends a run for it. The other leaves every ticket as it is. Each app process says
 * its version and start in the database from its start, and again with its beat (noteCatalogProcess), so the newer one
 * is known before it serves any claim. And a process remakes only the tickets of a version it knows to be older: one whose
 * processes started before it, or have all stopped. A ticket of a version it doesn't know is never touched.
 */

declare global {
  var __fuobeProcessStart: number | undefined;
}

/** When this app process started. */
export const processStart = () => (globalThis.__fuobeProcessStart ??= Math.round(Date.now() - process.uptime() * 1000));

/** An app process that said nothing for this long has stopped (each one says so with its beat, every few seconds). */
const GONE_MS = 5 * 60_000;

/**
 * Say that an app process of this catalog version runs (started at `startedAt`): at its start and with its beat
 * (generations.ts keepBeating), and before it remakes tickets.
 */
export function noteCatalogProcess(version: string | null = catalogVersion(), startedAt = processStart(), now = Date.now()): void {
  if (!version) return;
  db()
    .prepare("INSERT INTO catalog_processes (version, started_at, seen_at) VALUES (?, ?, ?) ON CONFLICT(version) DO UPDATE SET started_at = MAX(started_at, excluded.started_at), seen_at = MAX(seen_at, excluded.seen_at)")
    .run(version, startedAt, now);
}

/**
 * Say that a process of this catalog version runs (started at `startedAt`), and whether it is the newest: of the app
 * processes on this database heard from lately, none started after it with another version. A deploy's new process is
 * the newest from its start; so is a rollback's.
 */
export function newestCatalog(version: string, startedAt = processStart(), now = Date.now()): boolean {
  noteCatalogProcess(version, startedAt, now);
  const later = db().prepare("SELECT 1 FROM catalog_processes WHERE version != ? AND seen_at > ? AND started_at > ? LIMIT 1").get(version, now - GONE_MS, startedAt);
  return !later;
}

/**
 * SQL: the catalog versions a process of version @version started at @startedAt may remake tickets of. Only versions it
 * knows (their processes said so) and that are older than it: started before it, or every process of it has stopped.
 */
const OLDER_VERSIONS = "SELECT version FROM catalog_processes WHERE version != @version AND (started_at < @startedAt OR seen_at <= @gone)";

export async function refreshTickets(o: { version?: string; startedAt?: number; now?: number } = {}): Promise<{ refreshed: number; ended: number }> {
  const version = o.version ?? catalogVersion();
  if (!version) return { refreshed: 0, ended: 0 };
  const startedAt = o.startedAt ?? processStart();
  const now = o.now ?? Date.now();
  // A process of an older version (a deploy's overlap) leaves every ticket as it is.
  if (!newestCatalog(version, startedAt, now)) return { refreshed: 0, ended: 0 };
  // Only tickets of a version known to be older: never one this process doesn't know (it may be newer).
  const rows = db()
    .prepare(`SELECT * FROM relay_tasks WHERE pools IS NOT NULL AND state = 'waiting' AND ticket_json IS NOT NULL AND json_extract(ticket_json, '$.catalogVersion') IN (${OLDER_VERSIONS})`)
    .all({ version, startedAt, gone: now - GONE_MS }) as TaskRow[];
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
    const r = await composeTicket({ ticket, generationId: t.generation_id, inputs }, { catalog, catalogVersion: version, remake: true }).catch(() => null);
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
        // The files the graph makes, as they came out now: the same bytes keep their staged file, new ones take the old
        // one's place.
        const wasMade = ticket.inputs.filter((i) => i.slot.startsWith("made.")).sort((a, b) => Number(a.slot.slice(5)) - Number(b.slot.slice(5)));
        const made: TicketInput[] = r.made.map((m, i) => {
          const had = wasMade[i];
          const sha256 = crypto.createHash("sha256").update(m.data).digest("hex");
          if (had && had.sha256 === sha256) return had;
          const swapped = swapTaskInput(t, had?.name ?? null, { data: m.data, contentType: m.contentType, name: `made-${i}` })!;
          return { slot: `made.${i}`, name: swapped.name, kind: inputKind(m.contentType, swapped.name), sha256: swapped.sha256 };
        });
        for (const gone of wasMade.slice(r.made.length)) swapTaskInput(t, gone.name, null);
        const fresh: JobTicket = { ...ticket, inputs: [...ticket.inputs.filter((i) => !i.slot.startsWith("made.")), ...made], size: r.size };
        // Its lane and what it needs, from this catalog (the workflow may have moved to other files), with the files its
        // graph adds at run time (a look's LoRAs); its rank, class and wait as they were.
        const runtime = runtimeNeeds(graphLoraNames(r.graph), loadIndex(), r.workflowId).files;
        const fields = poolFields(r.workflowId, { size: r.size, catalogVersion: version, runtime });
        // A new ticket: a worker that refused the old one may take it.
        const { refusedBy: _refused, ...extra } = json<Record<string, unknown>>(t.extra_json, {});
        void _refused;
        setTask(t.id, { ticket_json: JSON.stringify(fresh), needs_json: JSON.stringify(fields.needs), lane: fields.lane, slot: fields.slot ?? null, extra_json: JSON.stringify(extra) });
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
