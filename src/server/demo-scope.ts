import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Work done as a demo, whatever its code asks for (package W7): a skill's free dry run of a studio step runs the studio's
 * own module inside runAsDemo, so every generation it creates goes to the demo provider (chooseRoute) and is marked
 * `request.demo`, with no change to the studio's code. Nothing outside the scope is affected.
 */
const scope = new AsyncLocalStorage<true>();

/** Run `fn` (and everything it awaits) as a demo. */
export const runAsDemo = <T>(fn: () => T): T => scope.run(true, fn);

/** Whether this code runs inside runAsDemo. */
export const inDemoScope = (): boolean => scope.getStore() === true;

/** Run `fn` outside any runAsDemo (a process-wide timer created during a dry run mustn't keep its scope). */
export const outsideDemo = <T>(fn: () => T): T => scope.exit(fn);
