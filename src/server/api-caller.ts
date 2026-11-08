import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";

/**
 * Was this request sent with the owner's API token (a script, the CLI, MCP, an agent), not from the signed-in browser?
 * Every route that makes a run (POST /api/generations, the studios, apps, Canvas, Chat's tools…) reads it in one place:
 * an owner's run made this way that says no source of its own is recorded as `source: "api"` (generations.ts
 * createGenerations). The generation runner and the other loops start when the server starts, outside any request, so
 * they never carry it.
 *
 * Two ways to know: auth.ts validToken marks the request it accepts a token for, for the rest of that request's work
 * (an async helper that checks the token after an await of its own marks only its own work), and the request Next is
 * handling carries its Authorization header (requestAuthorization), which generations.ts checks again.
 */

declare global {
  var __fuobeApiCaller: AsyncLocalStorage<boolean> | undefined;
}

// One store for the whole server process, however its modules are bundled.
const store = (globalThis.__fuobeApiCaller ??= new AsyncLocalStorage<boolean>());

/** Mark the request being handled as one sent with an API token (for the rest of its work). */
export const markApiCaller = (): void => store.enterWith(true);

/** Was the work in hand marked as part of a request sent with an API token? */
export const apiCaller = (): boolean => store.getStore() === true;

/** Run `fn` as a request of its own, which a token it accepts marks without touching the caller's (tests). */
export const asOwnRequest = <T,>(fn: () => T): T => store.run(false, fn);

/** The Authorization header of the request Next is handling now (null: none, or no request: a loop, a test). */
export function requestAuthorization(): string | null {
  try {
    const s = workUnitAsyncStorage.getStore();
    if (s?.type !== "request" || typeof s.headers?.get !== "function") return null;
    return s.headers.get("authorization");
  } catch {
    return null;
  }
}
