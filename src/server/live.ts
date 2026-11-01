import "server-only";
import type Database from "better-sqlite3";

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
}

declare global {
  var __fuobeLive: LiveState | undefined;
}

const state = (): LiveState => (globalThis.__fuobeLive ??= { listeners: new Set(), pending: new Set(), scheduled: false, hooked: new WeakSet() });

export function subscribe(listener: Listener): () => void {
  const s = state();
  s.listeners.add(listener);
  return () => void s.listeners.delete(listener);
}

export const listenerCount = () => state().listeners.size;

export function setResolver(resolve: (ids: string[]) => LiveEvent[]): void {
  state().resolve = resolve;
}

function changed(id: string): void {
  const s = state();
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
  d.function("fuobe_generation_changed", { deterministic: false }, (id: unknown) => {
    changed(String(id));
    return null;
  });
  d.exec(`
    CREATE TEMP TRIGGER IF NOT EXISTS fuobe_generations_insert AFTER INSERT ON main.generations BEGIN SELECT fuobe_generation_changed(NEW.id); END;
    CREATE TEMP TRIGGER IF NOT EXISTS fuobe_generations_update AFTER UPDATE ON main.generations BEGIN SELECT fuobe_generation_changed(NEW.id); END;
    CREATE TEMP TRIGGER IF NOT EXISTS fuobe_generations_delete AFTER DELETE ON main.generations BEGIN SELECT fuobe_generation_changed(OLD.id); END;
  `);
  s.hooked.add(d);
}

const encoder = new TextEncoder();
const PING_MS = 15_000;

/**
 * A server-sent events stream of generation changes: `event: generation` (the Generation JSON,
 * exactly as GET /api/generations returns it), `event: deleted` ({"id"}), `: ping` every 15 s.
 * The listener and the ping are removed as soon as the client goes away.
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
      stop = () => {
        if (!open) return;
        open = false;
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
