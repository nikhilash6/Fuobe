import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * Run on this studio's GPUs (hosted runs) before it is pressed: the price in the service's words, where the run would
 * stand in line and the wait, or a refusal (busy, a limit, not offered here, paused) that turns Run off and says why.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {}, push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => "/image",
  useSearchParams: () => new URLSearchParams(),
}));

const { lineWords } = await import("@/lib/pool-line");
const { poolRunState } = await import("@/lib/hosted");
const { checkedPool, runPlace } = await import("@/lib/run-place");
const { PoolNote } = await import("@/components/studio/pool-note");
const { waitWords } = await import("@/lib/pool-line");
const { TooltipProvider } = await import("@/components/ui/tooltip");

const render = (node: ReactNode) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(TooltipProvider, null, node)));

describe("the words for a place in line", () => {
  it("says you're next, or how many are ahead, with when it would be ready", () => {
    expect(lineWords({ place: 1, etaSeconds: null })).toBe("You're next");
    expect(lineWords({ place: 1, etaSeconds: 38 })).toBe("You're next · ready in about 40 s");
    expect(lineWords({ place: 3, etaSeconds: 130 })).toBe("2 ahead of you · about 2 min");
    expect(lineWords({ place: 2, etaSeconds: 3 * 3600 })).toBe("1 ahead of you · about 3 h");
    // Lots of people only when lots really are waiting ahead.
    expect(lineWords({ place: 12, etaSeconds: null })).toBe("11 ahead of you · lots of people are creating right now");
    expect(lineWords({ place: 22, etaSeconds: 3 })).toBe("21 ahead of you · about 5 s · lots of people are creating right now");
    // Never a place before the first, nor a wait that can't be.
    expect(lineWords({ place: 0, etaSeconds: -5 })).toBe("You're next");
  });
  it("no GPU can take it now: warming up, starting by itself or when the first is due back", () => {
    const now = 1_000_000_000_000;
    expect(lineWords({ place: 3, etaSeconds: null, unknown: true }, now)).toBe("Warming up · starts automatically");
    expect(lineWords({ place: 1, etaSeconds: null, unknown: true, returnAt: now + 3 * 3600_000 }, now)).toBe("Warming up · starts in about 3 h");
    expect(lineWords({ place: 1, etaSeconds: null, unknown: true, returnAt: now + 60_000 }, now)).toBe("Warming up · starting in a moment");
    // A return time already past says nothing it can't keep.
    expect(lineWords({ place: 1, etaSeconds: null, unknown: true, returnAt: now - 1000 }, now)).toBe("Warming up · starts automatically");
  });
  it("before Run: when the result would be ready, and nothing when nothing is known", () => {
    expect(waitWords({ place: 3, etaSeconds: 130 })).toBe("ready in about 2 min");
    expect(waitWords({ place: 1, etaSeconds: 40 })).toBe("ready in about 40 s");
    expect(waitWords({ place: 4, etaSeconds: null, unknown: true })).toBe("starts automatically");
    expect(waitWords({ place: 1, etaSeconds: null, light: true })).toBe("ready in seconds");
    expect(waitWords({ place: 1, etaSeconds: null })).toBeNull();
  });
});

describe("Run before it is pressed (the price check's answer)", () => {
  it("allowed: the service's words as they are, and where the run would stand in line", () => {
    expect(poolRunState({ place: "pool", quote: { allowed: true, amount: 0, priceVersion: "v1", text: "Free" }, line: { place: 2, etaSeconds: 90 } })).toEqual({
      refused: false,
      text: "Free",
      wait: "ready in about 2 min",
    });
    // No service: no words of its own (Run keeps its own); nothing known of the wait, nothing said.
    expect(poolRunState({ place: "pool", quote: { allowed: true, amount: 0, priceVersion: "", text: "" }, line: { place: 1, etaSeconds: null } })).toEqual({ refused: false, text: "" });
    // Every GPU away: Run stays on, the line says it starts when one is free, and the wait is long.
    expect(poolRunState({ place: "pool", quote: { allowed: true, amount: 0, priceVersion: "", text: "Free" }, line: { place: 2, etaSeconds: null, unknown: true, long: true } })).toEqual({
      refused: false,
      text: "Free",
      wait: "starts automatically",
      long: true,
    });
  });
  it("refused (busy, a limit, not offered, paused, a top-up): Run is off, with the words, the line under them and the link", () => {
    for (const code of ["busy", "limit", "not-offered", "closed", "paused", "top-up"]) {
      const s = poolRunState({ place: "pool", quote: { allowed: false, amount: 0, priceVersion: "", text: "Busy right now. Try again in about 10 min.", code, action: { label: "Get more", url: "https://billing.example.com/top-up" } } });
      expect(s, code).toMatchObject({ refused: true, text: "Busy right now. Try again in about 10 min.", action: { label: "Get more" } });
      expect(s?.wait, code).toBeUndefined();
    }
  });
  it("nothing to say before the answer comes", () => {
    expect(poolRunState(null)).toBeNull();
    expect(poolRunState({ place: "pool" })).toBeNull();
  });
  it("a tool's place chip: a refusal turns its button off with the words; otherwise the price and the wait", () => {
    const refused = checkedPool({ place: "pool", quote: { allowed: false, text: "You have 2 runs going. Start this one when one finishes." } }, 3);
    expect(refused).toEqual({ text: "You have 2 runs going. Start this one when one finishes.", refused: true });
    const off = runPlace({ audience: "account", engine: "open", hosted: true, pool: refused, format: String });
    expect(off).toMatchObject({ where: "pool", refused: "You have 2 runs going. Start this one when one finishes.", send: "You have 2 runs going. Start this one when one finishes." });
    expect(off.needs).toBeUndefined();
    const ok = checkedPool({ place: "pool", quote: { allowed: true, text: "Free" }, line: { place: 1, etaSeconds: 40 } });
    expect(ok).toEqual({ text: "Free", wait: "ready in about 40 s" });
    const on = runPlace({ audience: "account", engine: "open", hosted: true, models: ["Qwen Image"], pool: ok, format: String });
    expect(on.refused).toBeUndefined();
    expect(on.tip).toBe("Runs on our GPUs with Qwen Image. Ready in about 40 s.");
  });
  it("the line under the toolbar: the wait before Run, or the refusal's words with its link and offer", () => {
    const wait = render(createElement(PoolNote, { state: { refused: false, text: "Free", wait: "ready in about 40 s" } }));
    expect(wait).toContain('data-pool-note="wait"');
    expect(wait).toContain("Ready in about 40 s");
    expect(render(createElement(PoolNote, { state: { refused: false, text: "Free" } }))).toBe("");
    // A long wait: the account's own GPU (or key, with its price) for this run, once; never on a short one.
    const offer = { label: "Run it now on your GPU", run: () => {} };
    const long = render(createElement(PoolNote, { state: { refused: false, text: "Free", wait: "starts automatically", long: true }, offer }));
    expect(long).toContain("Starts automatically");
    expect(long).toContain("Run it now on your GPU");
    expect(render(createElement(PoolNote, { state: { refused: false, text: "Free", wait: "ready in about 40 s" }, offer }))).not.toContain("Run it now");
    const refused = render(
      createElement(PoolNote, { state: { refused: true, text: "Busy right now. Try again in about 10 min.", action: { label: "Get more", url: "javascript:alert(1)" }, offer: { key: "priority", text: "Skip the line", label: "Tell me when" } } }),
    );
    expect(refused).toContain('data-pool-note="refused"');
    expect(refused).toContain("Busy right now. Try again in about 10 min.");
    expect(refused).toContain("Tell me when");
    // A link the service sent is opened only when it is a plain https (or same-site) link.
    expect(refused).not.toContain("javascript:");
  });
});

