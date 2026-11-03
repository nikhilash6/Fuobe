import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * A studio's dry run (skills that span studios, package W7): work done inside `runAsDemo` runs on the demo provider
 * whatever Settings → Demo mode says, so a studio module (a dub, a Layers project, captions) can be checked for free
 * with no change to its code. `chooseRoute` returns the demo route inside the scope, and every generation created in
 * it is stamped `request.demo`, so its waiting steps stay demos when the runner starts them later, outside the scope.
 */
const scope = new AsyncLocalStorage<{ demo: true }>();

/** Run `fn` (and everything it starts and awaits) on the demo provider. */
export function runAsDemo<T>(fn: () => T): T {
  return scope.run({ demo: true }, fn);
}

/** Whether this work runs inside runAsDemo. */
export function inDemoScope(): boolean {
  return scope.getStore()?.demo === true;
}
