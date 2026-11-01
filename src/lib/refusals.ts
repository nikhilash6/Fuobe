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

/** The error toast for a failed upload or run (its message, else `fallback`), unless its refusal shows its own card. */
export function toastError(e: unknown, fallback?: string): void {
  if (!refusalShown(e)) toast.error((e as Error).message || fallback);
}
