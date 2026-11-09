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
const { CREATE_GENERATION_KEY, goesToPool, newPressId, PRESS_RESEND, sendPress } = await import("@/lib/api");
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
    expect(html).toContain("2 ahead of you · about 2 min");
    expect(html).not.toContain("60%");
    expect(html).not.toContain("scaleX");
  });
  it("in line while no GPU can take it now: its place, and it starts when one is free", () => {
    const html = render(createElement(PendingTile, { g: gen({ place: "pool", status: "queued", message: POOL_WORDS.inLine, queue: { place: 3, etaSeconds: null, unknown: true } }), ratio: 1 }));
    expect(html).toContain("Warming up · starts automatically");
  });
  it("working while its model loads: Loading the model, with no % before its try reports one", () => {
    const html = render(createElement(PendingTile, { g: gen({ place: "pool", status: "running", message: POOL_WORDS.gettingReady, progress: null }), ratio: 1 }));
    expect(html).toContain('data-run-state="working"');
    expect(html).toContain("Loading the model");
    expect(html).not.toContain("%");
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
    const html = feedWhileMaking([{ feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox", shown: { amount: 0, priceVersion: "" } }], [gen({ place: "pool", status: "running", message: POOL_WORDS.working, prompt: "an earlier fox", request: { feature: "image", modelId: "oss-z-image-turbo", prompt: "an earlier fox" } })]);
    expect(html.indexOf('data-run-state="in-line"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-run-state="in-line"')).toBeLessThan(html.indexOf('data-run-state="working"'));
  });
  it("every other run being made shows its card at once too, saying it is starting (never In line)", () => {
    const html = feedWhileMaking([{ feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" }, { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox", place: "own" }]);
    expect(html).not.toContain("data-run-state");
    expect(html).not.toContain("Nothing yet");
    expect(html.match(/data-stage="sending"/g)).toHaveLength(2);
    expect(html).toContain(">Starting<");
    expect(html).not.toContain(`>${POOL_WORDS.inLine}<`);
    expect(goesToPool(undefined)).toBe(false);
  });
  it("a run made meanwhile takes its press's place: one card, never two", () => {
    const html = feedWhileMaking([{ feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox", place: "pool" }], [gen({ place: "pool", status: "queued", message: POOL_WORDS.inLine })]);
    expect(html.match(/data-run-state="in-line"/g)).toHaveLength(1);
    expect(html).not.toContain("data-making");
  });
});

describe("one press of Run", () => {
  const answer = (status: number) => new Response(JSON.stringify({ items: [] }), { status });

  it("each press gets its own id, made of plain letters and digits", () => {
    const a = newPressId();
    const b = newPressId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(b).not.toBe(a);
  });

  it("on this studio's GPUs, a press whose answer is lost on the way is sent again as it was, a few times at most", async () => {
    const waits: number[] = [];
    const wait = async (ms: number) => void waits.push(ms);
    // The network dropped, then a proxy gave up on a slow answer, then the answer came.
    const seen: string[] = [];
    const outcomes: (() => Response)[] = [
      () => {
        throw new TypeError("Failed to fetch");
      },
      () => answer(504),
      () => answer(201),
    ];
    const res = await sendPress(async () => (seen.push("send"), outcomes[seen.length - 1]()), true, wait);
    expect(res.status).toBe(201);
    expect(seen).toHaveLength(3);
    expect(waits).toEqual([PRESS_RESEND.afterMs, PRESS_RESEND.afterMs]);
    // Never more than PRESS_RESEND.times again: the last answer stands.
    let n = 0;
    const last = await sendPress(async () => (n++, answer(502)), true, wait);
    expect(last.status).toBe(502);
    expect(n).toBe(PRESS_RESEND.times + 1);
    // The studio's own answers (a refusal, a busy line) are never sent again.
    n = 0;
    expect((await sendPress(async () => (n++, answer(503)), true, wait)).status).toBe(503);
    expect(n).toBe(1);
  });

  it("every other run is sent once, as before", async () => {
    let n = 0;
    expect((await sendPress(async () => (n++, answer(504)), false, async () => {})).status).toBe(504);
    expect(n).toBe(1);
    n = 0;
    await expect(
      sendPress(
        async () => {
          n++;
          throw new TypeError("Failed to fetch");
        },
        false,
        async () => {},
      ),
    ).rejects.toThrow("Failed to fetch");
    expect(n).toBe(1);
  });
});
