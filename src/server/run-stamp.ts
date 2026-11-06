import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { GenerationRequest } from "@/lib/catalog/types";

/**
 * What the server decided about one run before it was created, stamped on every row the run makes (its jobs, and every
 * step its chains queue), the way `account` is stamped (generations.ts stampTenant). A client never sets these: the
 * request schema drops them, and stampTenant replaces whatever a stored request carried with the current stamp.
 *
 * - `place: "pool"`: the run goes to this install's GPUs (hosted runs, hosted.ts), not the account's own.
 * - `hold`: the billing service's hold for the run (billing.ts reserve); every row reports to it once (billing-outbox.ts).
 * - `charge`: the words the billing service gave for the charge ("7 units"), shown on the result.
 * - `charged`: the hold set an amount aside (a free run's sets aside nothing), so a run that ends early says it wasn't
 *   charged.
 * - `checkOutputs`: the moderation service asked to see this run's outputs before they show (moderation.ts).
 * - `class` and `boostMs`: its class in the line ("paid" before "free") and its head start inside that class.
 * - `light`: a run on this install's GPUs made of light work only (joins, trims): free, and never counted against the
 *   policy's limits on runs there (pool-limits.ts).
 * - `standalone`: an account's run made on its own in a studio (POST /api/generations, Image to 3D's route), not by a
 *   tool for one of its projects: Run with your key may take its place while it waits (generations.ts keyMoveBlock).
 */
export interface RunStamp {
  place?: "pool";
  hold?: string;
  charge?: string;
  charged?: boolean;
  checkOutputs?: boolean;
  /**
   * How long it may wait in line on this install's GPUs before it first starts (ms), from the billing service. 0: as long
   * as it takes (no wait limit). Absent: the install's own limit (FUOBE_POOL_WAIT_MIN).
   */
  waitMs?: number;
  /** Its class in the line on this install's GPUs, from the billing service (none: "free"). */
  class?: "paid" | "free";
  /** A head start in line within its class (ms), from the billing service. */
  boostMs?: number;
  /** Light work only (hosted-run.ts lightRun): free, and not counted against the policy's limits. */
  light?: boolean;
  /**
   * In scope only, never stored (not a STAMP_FIELDS field): the time a run that waited to enter the line takes its place
   * at (its press, pool-holds.ts), when its first job is sent. Absent: the time it is sent.
   */
  rankAt?: number;
  /** Made on its own in a studio, not by a tool for one of the account's projects. */
  standalone?: boolean;
}

declare global {
  var __fuobeRunStamp: AsyncLocalStorage<RunStamp> | undefined;
}

const store = () => (globalThis.__fuobeRunStamp ??= new AsyncLocalStorage<RunStamp>());

/** Run `fn` with this run's stamp: every row createGenerations makes inside carries it. */
export const withRunStamp = <T,>(stamp: RunStamp, fn: () => T): T => store().run(stamp, fn);

/** The stamp in scope (none: a run with nothing decided, as every run was before these hooks). */
export const runStamp = (): RunStamp | undefined => store().getStore();

/** The server-only fields of a request. */
export const STAMP_FIELDS = ["place", "hold", "charge", "charged", "checkOutputs", "waitMs", "class", "boostMs", "light", "standalone"] as const;

/** A request with the current stamp's fields, and none of a stored request's own. */
export function stamped(req: GenerationRequest): GenerationRequest {
  const out = { ...req };
  for (const k of STAMP_FIELDS) delete out[k];
  const s = runStamp();
  if (!s) return out;
  return {
    ...out,
    ...(s.place && { place: s.place }),
    ...(s.hold && { hold: s.hold }),
    ...(s.charge && { charge: s.charge }),
    ...(s.charged && { charged: true }),
    ...(s.checkOutputs && { checkOutputs: true }),
    ...(waitOf(s.waitMs) !== undefined && { waitMs: s.waitMs }),
    ...(s.class === "paid" && { class: "paid" as const }),
    ...(s.boostMs && s.boostMs > 0 && { boostMs: s.boostMs }),
    ...(s.light && { light: true }),
    ...(s.standalone && { standalone: true }),
  };
}

/** A stamped wait limit as kept (0: no limit), or undefined for none at all (the install's own limit applies). */
const waitOf = (ms: unknown): number | undefined => (typeof ms === "number" && Number.isFinite(ms) && ms >= 0 ? ms : undefined);

/** A stored request's stamp, to run a later step of it (advanceDependents, polls) as it was decided. */
export function stampOf(req: Pick<GenerationRequest, (typeof STAMP_FIELDS)[number]>): RunStamp {
  return {
    ...(req.place === "pool" && { place: "pool" as const }),
    ...(req.hold && { hold: req.hold }),
    ...(req.charge && { charge: req.charge }),
    ...(req.charged && { charged: true }),
    ...(req.checkOutputs && { checkOutputs: true }),
    ...(waitOf(req.waitMs) !== undefined && { waitMs: req.waitMs }),
    ...(req.class === "paid" && { class: "paid" as const }),
    ...(req.boostMs && req.boostMs > 0 && { boostMs: req.boostMs }),
    ...(req.light && { light: true }),
    ...(req.standalone && { standalone: true }),
  };
}

/** A request without its server-only fields: what a browser or a script is sent (and so what a retry sends back). */
export function withoutStamp<T extends Partial<Record<(typeof STAMP_FIELDS)[number], unknown>>>(req: T): Omit<T, (typeof STAMP_FIELDS)[number]> {
  const out = { ...req };
  for (const k of STAMP_FIELDS) delete out[k];
  return out;
}
