import "server-only";
import type Database from "better-sqlite3";
import { onShutdown } from "@/server/shutdown";

/**
 * Live updates for the feed (GET /api/generations/stream). Every write to the generations
 * table, from any code path, reaches here through temporary SQLite triggers that call into JS
 * (so there is exactly one hook, and new writers are covered without remembering to emit).
 * Changes are batched per event-loop turn and turned into events by the generations module.
 * State lives on globalThis so it survives dev hot reloads.
 */

export type LiveEventType = "generation" | "deleted";

export interface LiveEvent {
  type: LiveEventType;
  id: string;
  /** Serialized once per change, shared by every open stream. */
  json: string;
}

type Listener = (e: LiveEvent) => void;

interface LiveState {
  listeners: Set<Listener>;
  pending: Set<string>;
  scheduled: boolean;
  /** Turns changed ids into events: set (and re-set after hot reloads) by src/server/generations.ts. */
  resolve?: (ids: string[]) => LiveEvent[];
  hooked: WeakSet<object>;
  /** The connection the change hooks are on (read by the sweep for other processes' writes). */
  db?: Database.Database;
  /** The last updated_at each changed row had, as this process saw it (its own writes, or the sweep). */
  seen: Map<string, number>;
  /** Rows updated after this (less a margin) are what the sweep reads. */
  mark: number;
  sweep: ReturnType<typeof setInterval> | null;
}

declare global {
  var __fuobeLive: LiveState | undefined;
}

const state = (): LiveState => {
  const s = (globalThis.__fuobeLive ??= { listeners: new Set(), pending: new Set(), scheduled: false, hooked: new WeakSet(), seen: new Map(), mark: Date.now(), sweep: null });
  // A state kept across a dev hot reload may predate these.
  s.seen ??= new Map();
  s.mark ??= Date.now();
  s.sweep ??= null;
  return s;
};

/**
 * Writes by another app process (the site's other instance while an update switches over: both run for a moment, and
 * the runner in either may save a run's result) fire no trigger here: TEMP triggers belong to their own connection.
 * So while anyone listens, this process also reads the rows updated lately every SWEEP_MS, and passes on the ones
 * whose change it hasn't seen. A stream then brings every change within seconds, whichever process wrote it.
 */
export const SWEEP_MS = 2000;
/** How far back each sweep reads (the processes share a clock; a write can commit a moment after its timestamp). */
const SWEEP_MARGIN_MS = 10_000;

/** Read the rows updated since the last sweep and pass on the ones another process changed (exported for tests). */
export function sweepForeign(now = Date.now()): number {
  const s = state();
  if (!s.db || !s.listeners.size) return 0;
  const since = s.mark - SWEEP_MARGIN_MS;
  let rows: { id: string; updated_at: number }[];
  try {
    rows = s.db.prepare("SELECT id, updated_at FROM main.generations WHERE updated_at > ?").all(since) as { id: string; updated_at: number }[];
  } catch {
    return 0;
  }
  let n = 0;
  for (const r of rows) {
    if ((s.seen.get(r.id) ?? -Infinity) >= r.updated_at) continue;
    s.seen.set(r.id, r.updated_at);
    changed(r.id);
    n++;
  }
  s.mark = Math.max(s.mark, now);
  // Forget what is out of the sweep's reach.
  for (const [id, at] of s.seen) if (at < since - 60_000) s.seen.delete(id);
  return n;
}

function startSweep(): void {
  const s = state();
  if (s.sweep) return;
  s.mark = Date.now();
  s.sweep = setInterval(() => sweepForeign(), SWEEP_MS);
  s.sweep.unref?.();
}

function stopSweep(): void {
  const s = state();
  if (!s.sweep) return;
  clearInterval(s.sweep);
  s.sweep = null;
}

export function subscribe(listener: Listener): () => void {
  const s = state();
  s.listeners.add(listener);
  startSweep();
  return () => {
    s.listeners.delete(listener);
    if (!s.listeners.size) stopSweep();
  };
}

export const listenerCount = () => state().listeners.size;

export function setResolver(resolve: (ids: string[]) => LiveEvent[]): void {
  state().resolve = resolve;
}

function changed(id: string, updatedAt?: number): void {
  const s = state();
  // This process's own write: the sweep needn't pass it on again.
  if (typeof updatedAt === "number" && updatedAt > (s.seen.get(id) ?? -Infinity)) s.seen.set(id, updatedAt);
  if (!s.listeners.size) return;
  s.pending.add(id);
  if (s.scheduled) return;
  s.scheduled = true;
  // After the current statement/transaction: a trigger can't read the database itself.
  setImmediate(flush);
}

function flush(): void {
  const s = state();
  s.scheduled = false;
  const ids = [...s.pending];
  s.pending.clear();
  if (!ids.length || !s.listeners.size || !s.resolve) return;
  let events: LiveEvent[];
  try {
    events = s.resolve(ids);
  } catch (e) {
    console.warn(`[fuobe] live update failed: ${(e as Error).message}`);
    return;
  }
  for (const e of events) {
    for (const l of [...s.listeners]) {
      try {
        l(e);
      } catch {
        // A broken stream removes itself on its next write.
      }
    }
  }
}

/** Install the change hooks on a connection (once). TEMP triggers live only as long as the connection. */
export function watchGenerations(d: Database.Database): void {
  const s = state();
  if (s.hooked.has(d)) return;
  d.function("fuobe_generation_changed", { deterministic: false, varargs: true }, (id: unknown, updatedAt?: unknown) => {
    changed(String(id), typeof updatedAt === "number" ? updatedAt : typeof updatedAt === "bigint" ? Number(updatedAt) : undefined);
    return null;
  });
  d.exec(`
    CREATE TEMP TRIGGER IF NOT EXISTS fuobe_generations_insert AFTER INSERT ON main.generations BEGIN SELECT fuobe_generation_changed(NEW.id, NEW.updated_at); END;
    CREATE TEMP TRIGGER IF NOT EXISTS fuobe_generations_update AFTER UPDATE ON main.generations BEGIN SELECT fuobe_generation_changed(NEW.id, NEW.updated_at); END;
    CREATE TEMP TRIGGER IF NOT EXISTS fuobe_generations_delete AFTER DELETE ON main.generations BEGIN SELECT fuobe_generation_changed(OLD.id); END;
  `);
  s.db = d;
  s.hooked.add(d);
}

const encoder = new TextEncoder();
const PING_MS = 15_000;

/**
 * A server-sent events stream of generation changes: `event: generation` (the Generation JSON,
 * exactly as GET /api/generations returns it), `event: deleted` ({"id"}), `: ping` every 15 s.
 * The listener and the ping are removed as soon as the client goes away. The stream also ends when the server starts
 * stopping (shutdown.ts); the browser then reconnects, to whichever instance serves the site by then.
 *
 * `allowed`: whether whoever opened the stream may still read it, asked before every event and on every ping (`ping`
 * true: look again even when nothing changed, so a sign-in that expires is caught too). The stream ends at the first
 * no: a sign-in ended by Sign everyone out, a new password or a revoked token never receives another event.
 */
export function generationEventStream(signal: AbortSignal, opts: { pingMs?: number; allowed?: (ping: boolean) => boolean } = {}): Response {
  let stop = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          stop();
        }
      };
      const still = (ping: boolean) => {
        let ok = false;
        try {
          ok = !opts.allowed || opts.allowed(ping);
        } catch {}
        if (!ok) stop();
        return ok;
      };
      const off = subscribe((e) => {
        if (still(false)) send(`event: ${e.type}\ndata: ${e.json}\n\n`);
      });
      const ping = setInterval(() => {
        if (still(true)) send(": ping\n\n");
      }, opts.pingMs ?? PING_MS);
      let unhook = () => {};
      stop = () => {
        if (!open) return;
        open = false;
        unhook();
        off();
        clearInterval(ping);
        signal.removeEventListener("abort", stop);
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };
      signal.addEventListener("abort", stop);
      if (signal.aborted) return stop();
      // Ends when the server starts stopping, so an update's old instance stops at once (shutdown.ts).
      unhook = onShutdown(stop);
      if (!open) return;
      // Reconnect quickly after a restart; the first comment flushes the headers through proxies.
      send("retry: 2000\n: connected\n\n");
    },
    cancel() {
      stop();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform keeps compression (and its buffering) off; X-Accel-Buffering does the same for nginx.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
