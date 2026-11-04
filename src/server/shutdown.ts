import "server-only";

/**
 * A quick, clean stop when the server is asked to stop (SIGTERM from the service manager, SIGINT from a terminal).
 *
 * `next start` stops by closing its HTTP server and waiting for every open request to end. A live-updates stream never
 * ends by itself, so without this the old instance of an update kept running until the service manager killed it,
 * which also cut every request still in progress. On the signal, this:
 * - ends every live-updates stream (each browser reconnects on its own, to whichever instance serves the site now), so
 *   Next's own stop finishes once the real requests are done;
 * - stops the background runners (generations, trash, sweeps, schedules, skills, studios), so a stopping instance takes
 *   no new steps while the next one runs them. A step already under way finishes.
 *
 * Next's own signal handler still does the stopping and exits; this only adds to it.
 */

type Stop = () => void;

interface ShutdownState {
  stops: Set<Stop>;
  draining: boolean;
  hooked: boolean;
}

declare global {
  var __fuobeShutdown: ShutdownState | undefined;
}

const state = (): ShutdownState => (globalThis.__fuobeShutdown ??= { stops: new Set(), draining: false, hooked: false });

/** Whether the server is stopping. */
export const draining = () => state().draining;

/**
 * Calls `stop` once when the server starts stopping (right away when it already is). Returns the function that forgets
 * it, for a stream that ends for another reason first.
 */
export function onShutdown(stop: Stop): () => void {
  const s = state();
  if (s.draining) {
    stop();
    return () => {};
  }
  s.stops.add(stop);
  return () => void s.stops.delete(stop);
}

/** The intervals the background runners keep on globalThis (each module's `ensure…`). */
function runnerTimers(): (ReturnType<typeof setInterval> | undefined)[] {
  const g = globalThis;
  return [
    g.__fuobeRunner?.timer,
    g.__fuobeRunner?.fastTimer,
    g.__fuobeTrashPurge?.timer,
    g.__fuobeAccountSweep?.timer,
    g.__fuobeRelaySweep,
    g.__fuobeFacelessRunner?.timer,
    g.__fuobeScheduleRunner?.timer,
    g.__fuobeSkillRuns?.timer,
    g.__fuobeSwapStudioRunner,
  ];
}

/** Ends the streams and stops the runners. Safe to call more than once. */
export function drain(): void {
  const s = state();
  if (s.draining) return;
  s.draining = true;
  // The timers stay set on their objects, so a late `ensure…` call sees a runner and doesn't start another one.
  for (const t of runnerTimers()) if (t) clearInterval(t);
  for (const stop of [...s.stops]) {
    try {
      stop();
    } catch {
      // A stream the browser already closed.
    }
  }
  s.stops.clear();
}

/**
 * Drains on SIGTERM and SIGINT, next to Next's own handler (which then exits). Not when NEXT_MANUAL_SIG_HANDLE is set:
 * then Next adds no handler, and a listener here would keep the process from exiting on the signal.
 */
export function drainOnSignals(): void {
  const s = state();
  if (s.hooked || process.env.NEXT_MANUAL_SIG_HANDLE) return;
  s.hooked = true;
  process.once("SIGTERM", drain);
  process.once("SIGINT", drain);
}
