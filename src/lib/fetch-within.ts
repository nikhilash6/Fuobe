/**
 * A read that gives up after a time limit. A busy or restarting server can then never hold a placeholder on screen
 * for good: the read fails like any other, React Query retries it once, and the page shows what it shows without it.
 */

/** The error a read that ran out of time throws (`name` is "TimeoutError", like AbortSignal.timeout's). */
export class FetchTimeoutError extends Error {
  readonly name = "TimeoutError";
  constructor(readonly url: string, readonly ms: number) {
    super("The server took too long to answer. Please try again.");
  }
}

/**
 * fetch(), aborted when the server hasn't answered (its status and headers) within `ms`. The body is read after that
 * without a limit: these routes send a small JSON body at once. An abort of `init.signal` still ends it early.
 */
export function fetchWithin(url: string, ms: number, init: RequestInit = {}, fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = fetch): Promise<Response> {
  const ctl = new AbortController();
  const timeout = new FetchTimeoutError(url, ms);
  const timer = setTimeout(() => ctl.abort(timeout), ms);
  const outer = init.signal;
  const onOuter = () => ctl.abort(outer?.reason);
  if (outer?.aborted) onOuter();
  else outer?.addEventListener("abort", onOuter, { once: true });
  const done = () => {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuter);
  };
  return fetchImpl(url, { ...init, signal: ctl.signal }).then(
    (res) => {
      done();
      return res;
    },
    (err: unknown) => {
      done();
      throw ctl.signal.reason === timeout ? timeout : err;
    },
  );
}

/** How long the first screen's own reads may take, by what they are. */
export const READ_LIMIT_MS = {
  /** GET /api/status: the server already bounds its own ComfyUI and model checks to about 2 s. */
  status: 12_000,
  /** GET /api/auth/me: a cookie check. */
  viewer: 10_000,
  /** GET /api/generations: a short list (Home's Recent, the running jobs). */
  list: 20_000,
} as const;
