import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Generation } from "@/lib/catalog/types";

/*
 * The studio feed's run cards: every run on its way has a stage (in line, warming up, creating, finishing) that drives
 * its look, its ring and what a screen reader hears; every card keeps its run's shape whatever it holds; a press of Run
 * shows its card at once; and lists with a run on their way keep asking, so a change the live stream missed still shows.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {}, push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => "/image",
  useSearchParams: () => new URLSearchParams(),
}));

const { runStage, STAGE_WORDS, tileBox, tileCount, shownMaking, FINISHING_AT } = await import("@/lib/run-stage");
const { pollDelay, STREAM_IDLE_MS, streamResponse, backoff } = await import("@/lib/generation-stream");
const { Feed, PendingTile } = await import("@/components/studio/feed");
const { CREATE_GENERATION_KEY } = await import("@/lib/api");
const { TooltipProvider } = await import("@/components/ui/tooltip");

const gen = (o: Partial<Generation> = {}): Generation =>
  ({
    id: "g1",
    batchId: null,
    feature: "image",
    presetId: null,
    modelId: "moss-image",
    engine: "open",
    provider: "comfyui",
    op: "t2i",
    kind: "image",
    status: "queued",
    progress: null,
    message: null,
    prompt: "a flying cat",
    request: { feature: "image", modelId: "moss-image", prompt: "a flying cat", params: { aspectRatio: "1:1" } },
    outputs: [],
    error: null,
    costUsd: null,
    favorite: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedAt: null,
    ...o,
  }) as Generation;

const render = (node: ReactNode, client = new QueryClient()) => renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, node)));

/** Each tile slot in a rendered feed: its inline width. */
const slotWidths = (html: string) => [...html.matchAll(/class="max-w-full shrink-0 h-\(--tile-h\)[^"]*" style="width:([^"]+)"/g)].map((m) => m[1]);

describe("a run's stage", () => {
  it("in line, warming up, creating, finishing, and none once it is over", () => {
    expect(runStage(gen({ status: "queued" }))).toEqual({ stage: "in-line", fraction: null });
    // In line after a recovery: whatever an earlier attempt reached says nothing now.
    expect(runStage(gen({ status: "queued", progress: 0.6 }))).toEqual({ stage: "in-line", fraction: null });
    expect(runStage(gen({ status: "running", progress: null }))).toEqual({ stage: "warming", fraction: null });
    expect(runStage(gen({ status: "running", progress: 0 }))).toEqual({ stage: "warming", fraction: null });
    expect(runStage(gen({ status: "running", progress: 0.42 }))).toEqual({ stage: "creating", fraction: 0.42 });
    expect(runStage(gen({ status: "running", progress: FINISHING_AT }))?.stage).toBe("finishing");
    expect(runStage(gen({ status: "running", progress: 0.99, stage: "checking" }))).toEqual({ stage: "finishing", fraction: null });
    for (const status of ["succeeded", "failed", "canceled"] as const) expect(runStage(gen({ status }))).toBeNull();
  });

  it("a job on this computer's ComfyUI goes by its own steps and phase", () => {
    expect(runStage(gen({ status: "running" }), { fraction: 0.25 })).toEqual({ stage: "creating", fraction: 0.25 });
    expect(runStage(gen({ status: "running" }), { fraction: null })).toEqual({ stage: "warming", fraction: null });
    expect(runStage(gen({ status: "running" }), { fraction: 1, saving: true })).toEqual({ stage: "finishing", fraction: null });
    expect(runStage(gen({ status: "running" }), { fraction: 2 })?.fraction).toBe(1);
  });

  it("each stage has a short friendly word for screen readers, with no machinery in it", () => {
    for (const w of Object.values(STAGE_WORDS)) expect(w).not.toMatch(/gpu|worker|queue|busy|error|fail|wait/i);
  });

  it("a card on its way says its stage to screen readers in a polite live region, and shows its progress", () => {
    const html = render(createElement(PendingTile, { g: gen({ status: "running", progress: 0.42, message: "Making your picture · step 5 of 12" }), ratio: 1 }));
    expect(html).toContain('data-stage="creating"');
    expect(html).toMatch(/role="status" aria-live="polite">Creating</);
    expect(html).toContain("42%");
    expect(html).toContain("data-run-spinner");
    expect(html).toContain("run-aura");
  });
});

describe("a run card's size (the collapsed card)", () => {
  // The cause: a card on its way or a failed one sized itself by `aspect-ratio` through a percentage height inside a
  // flex row item with no width of its own. Its width came only from that transfer: where a browser gives such a box
  // its content's width instead (its minimum content contribution when the row is measured), a card on its way (only
  // an overlay in it) had no width at all, a blank area under its title, and a failed one shrank to its widest word
  // or button, a thin strip with an icon and Retry. Each card's place in the row now has its width set outright.
  it("sets each card's width from the row height and its shape, whatever the card holds", () => {
    expect(tileBox(1)).toEqual({ width: "calc(var(--tile-h) * 1)", aspectRatio: 1 });
    expect(tileBox(16 / 9).width).toBe("calc(var(--tile-h) * 1.7778)");
    expect(tileBox(9 / 16, 0.8).width).toBe("calc(var(--tile-h) * 0.8)");
    // A shape that can't be read is square, never zero.
    for (const bad of [NaN, 0, -1, Infinity]) expect(tileBox(bad).width).toBe("calc(var(--tile-h) * 1)");
  });

  it("in the feed, a run on its way and a failed run each keep their full width", () => {
    const html = render(
      createElement(Feed, {
        items: [
          gen({ id: "a", status: "queued", place: "pool", request: { feature: "image", modelId: "moss-image", prompt: "a", params: { aspectRatio: "3:4", numOutputs: 2 } } }),
          gen({ id: "b", status: "failed", place: "pool", error: "That one didn't come out right." }),
          gen({ id: "c", status: "canceled", request: { feature: "image", modelId: "moss-image", prompt: "c", params: { aspectRatio: "9:16" } } }),
        ],
      }),
    );
    // Two tiles at 3:4 for the run asked for two, one square failed card, and a 9:16 stopped run kept at its 0.8 floor.
    expect(slotWidths(html)).toEqual(["calc(var(--tile-h) * 0.75)", "calc(var(--tile-h) * 0.75)", "calc(var(--tile-h) * 1)", "calc(var(--tile-h) * 0.8)"]);
    // The failed card's way on is there: Retry, and Reuse to change the words first.
    expect(html).toContain("Retry");
    expect(tileCount(undefined)).toBe(1);
    expect(tileCount(4)).toBe(4);
    expect(tileCount(40)).toBe(8);
  });
});

describe("a press of Run", () => {
  const making = (requests: object[], items: Generation[] = [], features?: string[]) => {
    const client = new QueryClient();
    for (const r of requests) void client.getMutationCache().build(client, { mutationKey: CREATE_GENERATION_KEY, mutationFn: () => new Promise(() => {}) }).execute(r);
    return render(createElement(Feed, { items, features, empty: createElement("p", null, "Nothing yet") }), client);
  };

  it("shows its card at once: its words, and a tile for each picture asked for, at its shape", () => {
    const html = making([{ feature: "image", modelId: "moss-image", prompt: "a flying cat", params: { aspectRatio: "16:9", numOutputs: 3 } }]);
    expect(html).toContain("data-making");
    expect(html).toContain(">a flying cat<");
    expect(html.match(/data-stage="sending"/g)).toHaveLength(3);
    expect(slotWidths(html)).toEqual(Array(3).fill("calc(var(--tile-h) * 1.7778)"));
  });

  it("only in its own studio's feed", () => {
    expect(making([{ feature: "audio", modelId: "x", prompt: "a song" }], [], ["image"])).toContain("Nothing yet");
    expect(making([{ feature: "image", modelId: "x", prompt: "a cat" }], [], ["image"])).toContain("data-making");
    // A feed that names none goes by the features it lists.
    expect(making([{ feature: "audio", modelId: "x", prompt: "a song" }], [gen({ status: "succeeded" })])).not.toContain("data-making");
  });

  it("hands over to its run once the run is made (matched by its words and model, the clocks a minute apart at most)", () => {
    const at = 1_000_000;
    const m = { at, request: { feature: "image", modelId: "moss-image", prompt: "a flying cat" } };
    expect(shownMaking([m], [gen({ createdAt: at + 30_000 })])).toEqual([]);
    expect(shownMaking([m], [gen({ createdAt: at - 30_000 })])).toEqual([]);
    // An older run, a finished one, other words or another model: the press keeps its card.
    expect(shownMaking([m], [gen({ createdAt: at - 120_000 })])).toEqual([m]);
    expect(shownMaking([m], [gen({ createdAt: at, status: "succeeded" })])).toEqual([m]);
    expect(shownMaking([m], [gen({ createdAt: at, request: { feature: "image", modelId: "moss-image", prompt: "a dog" } })])).toEqual([m]);
    expect(shownMaking([m], [gen({ createdAt: at, modelId: "other" })])).toEqual([m]);
  });
});

describe("live updates that never stall", () => {
  it("lists with a run on their way keep asking: often for a run just sent, less for a long one, never when none is", () => {
    const now = 10_000_000;
    const run = (age: number, status: Generation["status"] = "running") => ({ status, createdAt: now - age });
    expect(pollDelay([], true, now)).toBeNull();
    expect(pollDelay([run(5_000, "succeeded")], false, now)).toBeNull();
    // With the live stream: a safety net every few seconds (a missed change shows within one).
    expect(pollDelay([run(5_000)], true, now)).toBe(4000);
    expect(pollDelay([run(10 * 60_000)], true, now)).toBe(10_000);
    // Without it: the list is how the card learns.
    expect(pollDelay([run(5_000, "queued")], false, now)).toBe(1500);
    expect(pollDelay([run(5 * 60_000)], false, now)).toBe(3000);
    expect(pollDelay([run(60 * 60_000)], false, now)).toBe(6000);
    // The youngest run decides.
    expect(pollDelay([run(60 * 60_000), run(2_000)], true, now)).toBe(4000);
  });

  it("a quiet stream is dropped well after the server's 15 s pings, and a server that is switching over is tried again within seconds", () => {
    expect(STREAM_IDLE_MS).toBeGreaterThan(2 * 15_000);
    expect(STREAM_IDLE_MS).toBeLessThanOrEqual(60_000);
    // The site's "updating" page (502/503) while an update switches over: 1 s, 2 s, 4 s …
    expect(streamResponse({ ok: false, status: 503, contentType: "text/html", hasBody: true }, 0)).toEqual({ open: false, retryIn: 1000 });
    expect(backoff(2)).toBe(4000);
  });
});
