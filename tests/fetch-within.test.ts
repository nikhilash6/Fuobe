import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchTimeoutError, fetchWithin, READ_LIMIT_MS } from "@/lib/fetch-within";

// The first screen's reads (status, who is looking, Recent) give up after a time limit, so a busy or restarting server
// never holds a placeholder on screen for good.

/** A fetch that never answers, but ends when its signal aborts, as the browser's does. */
function hangingFetch() {
  const calls: RequestInit[] = [];
  const impl = ((_url: string, init: RequestInit = {}) => {
    calls.push(init);
    return new Promise<Response>((_ok, fail) => {
      init.signal?.addEventListener("abort", () => fail(init.signal?.reason ?? new Error("aborted")), { once: true });
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

afterEach(() => vi.useRealTimers());

describe("fetchWithin", () => {
  it("gives up with a TimeoutError when the server doesn't answer in time", async () => {
    vi.useFakeTimers();
    const { impl, calls } = hangingFetch();
    const read = fetchWithin("/api/status", 1000, {}, impl);
    const caught = read.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(999);
    expect(calls[0].signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = await caught;
    expect(err).toBeInstanceOf(FetchTimeoutError);
    expect((err as Error).name).toBe("TimeoutError");
    expect((err as FetchTimeoutError).url).toBe("/api/status");
  });

  it("passes an answer through and stops its timer", async () => {
    vi.useFakeTimers();
    const res = new Response("{}", { status: 200 });
    let signal: AbortSignal | undefined;
    const impl = ((_u: string, init: RequestInit = {}) => ((signal = init.signal ?? undefined), Promise.resolve(res))) as unknown as typeof fetch;
    await expect(fetchWithin("/api/auth/me", 1000, {}, impl)).resolves.toBe(res);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(signal?.aborted).toBe(false);
  });

  it("keeps a caller's own abort, with its reason", async () => {
    const { impl } = hangingFetch();
    const outer = new AbortController();
    const read = fetchWithin("/api/generations", 60_000, { signal: outer.signal }, impl);
    outer.abort(new Error("left the page"));
    await expect(read).rejects.toThrow("left the page");
  });

  it("passes a network error through as it is", async () => {
    const impl = (() => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch;
    await expect(fetchWithin("/api/status", 1000, {}, impl)).rejects.toThrow(TypeError);
  });

  it("bounds every first-screen read to a few seconds", () => {
    for (const ms of Object.values(READ_LIMIT_MS)) expect(ms).toBeGreaterThan(2_000);
    for (const ms of Object.values(READ_LIMIT_MS)) expect(ms).toBeLessThanOrEqual(20_000);
  });
});
