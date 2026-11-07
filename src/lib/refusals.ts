import { toast } from "sonner";

/**
 * Refusals that open their own card (watchGuestRefusals in ./api: "Create a free account", "Connect your GPU"). The
 * error a helper throws for one is marked, so a studio shows the card alone, with no error toast on top of it.
 */
const shown = new WeakSet<Response>();

/** The watcher opened a card for this response. */
export function markRefusalShown(res: Response): void {
  shown.add(res);
}

/** The error for a failed response (`e`, or an Error with that message): marked when its refusal shows its own card. */
export function responseError(res: Response, message: string): Error;
export function responseError<E extends Error>(res: Response, e: E): E;
export function responseError(res: Response, e: string | Error): Error {
  const err = typeof e === "string" ? new Error(e) : e;
  return shown.has(res) ? Object.assign(err, { refusalShown: true }) : err;
}

/** The refusal behind this error shows its own card already: no toast on top of it. */
export const refusalShown = (e: unknown): boolean => !!(e as { refusalShown?: boolean } | null)?.refusalShown;

/** What to do next after a refusal, a press away (a limit's "Run it self-hosted", src/lib/limit-words.ts). */
export type NextStep = { label: string; run: () => void };

/**
 * The error toast for a failed upload or run (its message, else `fallback`), unless its refusal shows its own card. A
 * refusal with a next step offers it on the toast.
 */
export function toastError(e: unknown, fallback?: string): void {
  if (refusalShown(e)) return;
  const next = (e as { next?: NextStep } | null)?.next;
  toast.error((e as Error).message || fallback, next ? { action: { label: next.label, onClick: next.run } } : undefined);
}
