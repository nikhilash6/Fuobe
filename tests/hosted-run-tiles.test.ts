import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Generation } from "@/lib/catalog/types";

/*
 * A run's tile on this studio's GPUs (hosted runs): "In line" with its place and wait (again after any recovery, its
 * place kept), "Working" with its progress, then the result with an "AI-generated" tag, or one plain sentence when it
 * can't finish. Every other run's tiles render as before.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {}, push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => "/image",
  useSearchParams: () => new URLSearchParams(),
}));

const { POOL_WORDS } = await import("@/lib/relay");
const { PendingTile, FailedTile, Feed } = await import("@/components/studio/feed");
const { CREATE_GENERATION_KEY, goesToPool } = await import("@/lib/api");
const { AiTag } = await import("@/components/studio/ai-tag");
const { TooltipProvider } = await import("@/components/ui/tooltip");

const render = (node: ReactNode) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(TooltipProvider, null, node)));

const gen = (o: Partial<Generation> = {}): Generation =>
  ({
    id: "g1",
    batchId: null,
    feature: "image",
    presetId: null,
    modelId: "oss-z-image-turbo",
    engine: "open",
    provider: "comfyui",
    op: "t2i",
    kind: "image",
    status: "queued",
    progress: null,
    message: null,
    prompt: "a fox",
    request: { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" },
    outputs: [],
    error: null,
    costUsd: null,
    favorite: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedAt: null,
    ...o,
  }) as Generation;

describe("a run's tile on this studio's GPUs", () => {
  it("in line: its place and wait, no progress (after a recovery too, whatever an earlier attempt reached)", () => {
    const html = render(createElement(PendingTile, { g: gen({ place: "pool", status: "queued", message: POOL_WORDS.inLine, progress: 0.6, queue: { place: 3, etaSeconds: 130 } }), ratio: 1 }));
    expect(html).toContain('data-run-state="in-line"');
    expect(html).toContain("In line · 3rd · about 2 min");
    expect(html).not.toContain("60%");
    expect(html).not.toContain("scaleX");
  });
  it("in line with no place known yet: In line", () => {
    const html = render(createElement(PendingTile, { g: gen({ place: "pool", status: "queued", message: POOL_WORDS.inLine }), ratio: 1 }));
    expect(html).toContain(">In line<");
  });
  it("working: Working, with its progress", () => {
    const html = render(createElement(PendingTile, { g: gen({ place: "pool", status: "running", message: POOL_WORDS.working, progress: 0.4 }), ratio: 1 }));
    expect(html).toContain('data-run-state="working"');
    expect(html).toContain(">Working<");
    expect(html).toContain("40%");
  });
  it("working with a preview picture: the picture shows under Working; in line, none", () => {
    const src = "/api/generations/g1/preview?at=123";
    const working = render(createElement(PendingTile, { g: gen({ place: "pool", status: "running", message: POOL_WORDS.working, progress: 0.4, preview: src }), ratio: 1 }));
    expect(working).toContain(`src="${src}"`);
    expect(working).toContain(">Working<");
    const inLine = render(createElement(PendingTile, { g: gen({ place: "pool", status: "queued", message: POOL_WORDS.inLine, preview: src }), ratio: 1 }));
    expect(inLine).not.toContain("<img");
    // The owner's own job on the workers shows its picture too.
    const owner = render(createElement(PendingTile, { g: gen({ status: "running", message: "Generating", progress: 0.4, preview: src }), ratio: 1 }));
    expect(owner).toContain(`src="${src}"`);
  });
  it("a run that can't finish: one plain sentence, and Retry", () => {
    const html = render(createElement(FailedTile, { g: gen({ place: "pool", status: "failed", error: POOL_WORDS.failed, notCharged: true }), ratio: 1, onRetry: () => {} }));
    expect(html).toContain(POOL_WORDS.failed.replace("'", "&#x27;"));
    expect(html).not.toContain("Couldn&#x27;t generate this one");
    expect(html).toContain("Retry");
    // Nothing set aside for it (every run free): only the sentence and Retry, with nothing about a charge.
    const free = render(createElement(FailedTile, { g: gen({ place: "pool", status: "failed", error: POOL_WORDS.failed }), ratio: 1, onRetry: () => {} }));
    expect(free).toContain(POOL_WORDS.failed.replace("'", "&#x27;"));
    expect(free).toContain("Retry");
    expect(free).not.toMatch(/charged/i);
  });
  it("every other run's tiles are as before", () => {
    const own = render(createElement(PendingTile, { g: gen({ status: "running", message: "Generating", progress: 0.4 }), ratio: 1 }));
    expect(own).not.toContain("data-run-state");
    expect(own).toContain("Generating");
    expect(own).toContain("40%");
    const queued = render(createElement(PendingTile, { g: gen({ status: "queued", progress: 0.4 }), ratio: 1 }));
    expect(queued).toContain(">Queued<");
    const failed = render(createElement(FailedTile, { g: gen({ status: "failed", error: "Your ComfyUI answered HTTP 500." }), ratio: 1, onRetry: () => {} }));
    expect(failed).toContain("Couldn&#x27;t generate this one");
    expect(failed).toContain("Your ComfyUI answered HTTP 500.");
  });
  it("the AI-generated tag", () => {
    expect(render(createElement(AiTag))).toContain("AI-generated");
  });
});


describe("a run on this studio's GPUs between Run and its answer", () => {

  /** A feed whose page pressed Run with these requests and has no answer yet (the run is still being made). */
  const feedWhileMaking = (requests: object[], items: Generation[] = []) => {
    const client = new QueryClient();
    for (const r of requests) {
      const m = client.getMutationCache().build(client, { mutationKey: CREATE_GENERATION_KEY, mutationFn: () => new Promise(() => {}) });
      void m.execute(r);
    }
    return renderToStaticMarkup(
      createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, createElement(Feed, { items, empty: createElement("p", null, "Nothing yet") }))),
    );
  };

  it("shows In line while the run is made (a wait for the billing service included), with no other words", () => {
    const html = feedWhileMaking([{ feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox", place: "pool", params: { aspectRatio: "16:9" } }]);
    expect(html).toContain('data-run-state="in-line"');
    expect(html).toContain(`>${POOL_WORDS.inLine}<`);
    expect(html).not.toContain("Nothing yet");
    expect(html).not.toMatch(/pause|error|billing|GPU/i);
  });
  it("a run that names no place but sends the price it showed goes there too, above the runs already made", () => {
    const html = feedWhileMaking([{ feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox", shown: { amount: 0, priceVersion: "" } }], [gen({ place: "pool", status: "running", message: POOL_WORDS.working })]);
    expect(html.indexOf('data-run-state="in-line"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-run-state="in-line"')).toBeLessThan(html.indexOf('data-run-state="working"'));
  });
  it("every other run being made shows nothing new", () => {
    const html = feedWhileMaking([{ feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" }, { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox", place: "own" }]);
    expect(html).not.toContain("data-run-state");
    expect(html).toContain("Nothing yet");
    expect(goesToPool(undefined)).toBe(false);
  });
});
