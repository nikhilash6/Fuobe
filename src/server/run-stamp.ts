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
 * - `checkOutputs`: the moderation service asked to see this run's outputs before they show (moderation.ts).
 * - `standalone`: an account's run made on its own in a studio (POST /api/generations, Image to 3D's route), not by a
 *   tool for one of its projects: Run with your key may take its place while it waits (generations.ts keyMoveBlock).
 */
export interface RunStamp {
  place?: "pool";
  hold?: string;
  charge?: string;
  checkOutputs?: boolean;
  /** How long it may wait in line on this install's GPUs (ms), from the billing service. */
  waitMs?: number;
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
export const STAMP_FIELDS = ["place", "hold", "charge", "checkOutputs", "waitMs", "standalone"] as const;

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
    ...(s.checkOutputs && { checkOutputs: true }),
    ...(s.waitMs && s.waitMs > 0 && { waitMs: s.waitMs }),
    ...(s.standalone && { standalone: true }),
  };
}

/** A stored request's stamp, to run a later step of it (advanceDependents, polls) as it was decided. */
export function stampOf(req: Pick<GenerationRequest, (typeof STAMP_FIELDS)[number]>): RunStamp {
  return { ...(req.place === "pool" && { place: "pool" as const }), ...(req.hold && { hold: req.hold }), ...(req.charge && { charge: req.charge }), ...(req.checkOutputs && { checkOutputs: true }), ...(req.waitMs && { waitMs: req.waitMs }), ...(req.standalone && { standalone: true }) };
}
