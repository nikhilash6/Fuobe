import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * The price check before Run on this studio's GPUs (hosted runs) asks again by itself: soon while it refuses the run (a
 * limit on runs going, busy, paused), so Run comes back once that passes with no change to the draft; less often while
 * it shows a place in line, so the place and the wait stay current; and at once when a run starts or one ends.
 */

// A browser page: the query library runs its timers only outside a server.
vi.stubGlobal("window", new EventTarget());

const { QueryClient, QueryClientProvider, QueryObserver } = await import("@tanstack/react-query");
const { HOSTED_QUOTE_KEY, hostedQuoteQuery, poolRunState, quoteRefetchMs, refreshPriceChecks } = await import("@/lib/hosted");
const { useCreateGeneration } = await import("@/lib/api");

const body = JSON.stringify({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox", place: "pool" });
const limit = { place: "pool" as const, quote: { allowed: false, amount: 0, priceVersion: "", text: "You have 2 runs going. Start this one when one finishes.", code: "limit" }, line: { place: 1, etaSeconds: null } };
const free = { place: "pool" as const, quote: { allowed: true, amount: 0, priceVersion: "v1", text: "Free" }, line: { place: 2, etaSeconds: 40 } };

describe("the price check asks again by itself", () => {
  it("soon while refused, less often while it shows a place in line, never for a run elsewhere", () => {
    expect(quoteRefetchMs(limit)).toBe(15_000);
    for (const code of ["busy", "paused", "not-offered"]) expect(quoteRefetchMs({ ...limit, quote: { ...limit.quote, code } })).toBe(15_000);
    expect(quoteRefetchMs(free)).toBe(30_000);
    expect(quoteRefetchMs({})).toBe(false);
    expect(quoteRefetchMs(null)).toBe(false);
  });

  it("a refused check is asked again with no change to the draft, and Run turns on once the runs going finish", async () => {
    vi.useFakeTimers();
    const answers: unknown[] = [limit, free];
    const sent: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push(String(init.body));
      return Response.json(answers.shift() ?? free);
    });
    try {
      const qc = new QueryClient();
      const observer = new QueryObserver(qc, hostedQuoteQuery(body));
      const stop = observer.subscribe(() => {});
      await vi.advanceTimersByTimeAsync(0);
      expect(poolRunState(observer.getCurrentResult().data)).toMatchObject({ refused: true, text: limit.quote.text });
      // Both runs finish; nothing about the draft changes: the check is asked again, and Run is on.
      await vi.advanceTimersByTimeAsync(15_000);
      expect(sent).toEqual([body, body]);
      expect(poolRunState(observer.getCurrentResult().data)).toMatchObject({ refused: false, text: "Free", wait: "In line · 2nd · about 40 s" });
      // A run starts or ends: asked again at once, not only on the next tick.
      refreshPriceChecks(qc);
      await vi.advanceTimersByTimeAsync(0);
      expect(sent).toHaveLength(3);
      // While it shows a place in line, every 30 s.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(sent).toHaveLength(4);
      stop();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.stubGlobal("window", new EventTarget());
    }
  });

  it("a run on this studio's GPUs that ends, or one started from a toast, asks it again too", () => {
    const src = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
    // The run's tile (In line, Working) leaves once it is done: as it goes, the checks ask again.
    const feed = src("src/components/studio/feed.tsx");
    const tile = feed.slice(feed.indexOf("export function PendingTile"), feed.indexOf("export function FailedTile"));
    expect(tile).toContain("useEffect(() => (pool ? () => refreshPriceChecks(qc) : undefined), [pool, qc]);");
    const toast = src("src/components/guest-prompt.tsx");
    expect(toast.slice(toast.indexOf("const runs = () => {"), toast.indexOf("window.addEventListener(CONNECT_GPU_EVENT"))).toContain("refreshPriceChecks(qc)");
  });

  it("a run made from a composer asks it again (the runs going and the line changed)", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ items: [] }, { status: 201 }));
    try {
      const qc = new QueryClient();
      qc.setQueryData([HOSTED_QUOTE_KEY, body], limit);
      let create: ReturnType<typeof useCreateGeneration> | undefined;
      function Probe() {
        create = useCreateGeneration();
        return null;
      }
      renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(Probe)));
      expect(qc.getQueryState([HOSTED_QUOTE_KEY, body])?.isInvalidated).toBe(false);
      await create!.mutateAsync({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" });
      expect(qc.getQueryState([HOSTED_QUOTE_KEY, body])?.isInvalidated).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.stubGlobal("window", new EventTarget());
    }
  });

  it("a press of Run that is refused asks it again too (every GPU that could run it went away since it was asked)", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "Try again in a moment.", code: "busy" }, { status: 503 }));
    try {
      const qc = new QueryClient();
      qc.setQueryData([HOSTED_QUOTE_KEY, body], free);
      let create: ReturnType<typeof useCreateGeneration> | undefined;
      function Probe() {
        create = useCreateGeneration();
        return null;
      }
      renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(Probe)));
      await expect(create!.mutateAsync({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" })).rejects.toThrow("Try again in a moment.");
      expect(qc.getQueryState([HOSTED_QUOTE_KEY, body])?.isInvalidated).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.stubGlobal("window", new EventTarget());
    }
  });
});
