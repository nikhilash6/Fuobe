import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who a piece of server work is for (public sign-up). An account's run, its polls and its chained steps run
 * inside `runAsTenant({ kind: "account", id })` (generations.ts accountRun), a visitor's price check inside
 * `{ kind: "guest" }` (asVisitor). Inside a tenant the server uses only that tenant's own things: its files
 * (storage.ts readRef, localHead), its runs (createGenerations), never the owner's elements, LLM or LoRA folder.
 * Outside any tenant: the owner, or the owner's background work.
 */
export type Tenant = { kind: "account"; id: string } | { kind: "guest" };

declare global {
  var __fuobeTenant: AsyncLocalStorage<Tenant> | undefined;
}

const store = () => (globalThis.__fuobeTenant ??= new AsyncLocalStorage<Tenant>());

export const runAsTenant = <T,>(t: Tenant, fn: () => T): T => store().run(t, fn);

/** Undefined: the owner (or the owner's background work). */
export const tenant = (): Tenant | undefined => store().getStore();

/** Run `fn` as the owner's work, outside any tenant (timers and background work it starts stay outside too). */
export const outsideTenant = <T,>(fn: () => T): T => store().exit(fn);

/** The account the current work is for, if any. */
export const tenantAccount = (): string | undefined => {
  const t = tenant();
  return t?.kind === "account" ? t.id : undefined;
};
