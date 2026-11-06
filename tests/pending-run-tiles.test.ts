import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Generation } from "@/lib/catalog/types";

/*
 * A run on its way never shows a blank tile: in the studio feed and on a Library card it has a turning ring, its own
 * words (a blank message reads "Queued" or "Generating…"), and, while it waits for the workers, its place in their line
 * when its words don't say it already. The owner's jobs on the workers, a step waiting for the steps before it, and
 * runs on this studio's GPUs (hosted runs) alike.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {}, push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => "/image",
  useSearchParams: () => new URLSearchParams(),
}));

const { POOL_WORDS } = await import("@/lib/relay");
const { pendingWords } = await import("@/lib/pending-words");
const { PendingTile, Feed } = await import("@/components/studio/feed");
const { StatusCover } = await import("@/components/library/asset-card");
const { TooltipProvider } = await import("@/components/ui/tooltip");

const render = (node: ReactNode) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(TooltipProvider, null, node)));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

const gen = (o: Partial<Generation> = {}): Generation =>
  ({
    id: "g1",
    batchId: null,
    feature: "image",
    presetId: null,
    modelId: "oss-qwen-image-21",
    engine: "open",
    provider: "comfyui",
    op: "edit",
    kind: "image",
    status: "queued",
    progress: null,
    message: null,
    prompt: "a model in a red coat",
    request: { feature: "image", modelId: "oss-qwen-image-21", prompt: "a model in a red coat" },
    outputs: [],
    error: null,
    costUsd: null,
    favorite: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedAt: null,
    ...o,
  }) as Generation;

/** The tile of one run as the studio feed draws it (its group: the prompt, then the tile). */
const feedTile = (g: Generation) => render(createElement(Feed, { items: [g] }));

describe("a run on its way in the studio feed", () => {
  it("the owner's job waiting for the workers: a ring, its words with its place, and the time it has waited", () => {
    const html = feedTile(gen({ status: "queued", message: "Waiting for a GPU · 1 ahead", queue: { place: 2, etaSeconds: 90 } }));
    expect(html).toContain("data-run-spinner");
    expect(text(html)).toContain("Waiting for a GPU · 1 ahead");
    // Its words say its place already: not said twice.
    expect(text(html)).not.toContain("In line · 2nd");
    expect(text(html)).toMatch(/\d+s/);
  });

  it("the owner's job waiting with words that don't say its place: its place in the workers' line under them", () => {
    const html = feedTile(gen({ status: "queued", message: "Waiting for a GPU to come on", queue: { place: 3, etaSeconds: 130 } }));
    expect(text(html)).toContain("Waiting for a GPU to come on");
    expect(text(html)).toContain("In line · 3rd · ready in about 2 min");
    const next = feedTile(gen({ status: "queued", message: "Submitting", queue: { place: 1, etaSeconds: null, unknown: true } }));
    expect(text(next)).toContain("Next in line · starts when a GPU is free");
  });

  it("the owner's job running on a worker: a ring, its step words and its progress", () => {
    const html = feedTile(gen({ status: "running", message: "Making your picture · step 3 of 8", progress: 0.375 }));
    expect(html).toContain("data-run-spinner");
    expect(text(html)).toContain("Making your picture · step 3 of 8");
    expect(text(html)).toContain("38%");
    expect(html).toContain("scaleX(0.38)");
  });

  it("a step waiting for the steps before it: a ring and its words", () => {
    const html = feedTile(gen({ kind: "video", op: "i2v", status: "queued", message: "Waits for the earlier steps", request: { feature: "video", modelId: "oss-minimax-h3", prompt: "she turns" } }));
    expect(html).toContain("data-run-spinner");
    expect(text(html)).toContain("Waits for the earlier steps");
  });

  it("a blank or missing message still says something", () => {
    for (const message of [null, "", "   "]) {
      expect(text(render(createElement(PendingTile, { g: gen({ status: "queued", message }), ratio: 1 })))).toContain("Queued");
      expect(text(render(createElement(PendingTile, { g: gen({ status: "running", message }), ratio: 1 })))).toContain("Generating…");
    }
  });

  it("runs on this studio's GPUs keep their words, now with the ring too", () => {
    const html = render(createElement(PendingTile, { g: gen({ place: "pool", status: "queued", message: POOL_WORDS.inLine, queue: { place: 3, etaSeconds: 130 } }), ratio: 1 }));
    expect(html).toContain("data-run-spinner");
    expect(text(html)).toContain("In line · 3rd · ready in about 2 min");
    expect(pendingWords({ place: "pool", status: "running", message: "", queue: undefined })).toEqual({ label: POOL_WORDS.working, place: null });
  });

  it("a job on this computer's ComfyUI says its own words", () => {
    expect(pendingWords(gen({ status: "queued", message: "Submitting", queue: { place: 2, etaSeconds: 10 } }), "In ComfyUI's queue · 1 ahead")).toEqual({ label: "In ComfyUI's queue · 1 ahead", place: null });
  });
});

describe("a run on its way on a Library card", () => {
  it("the same ring, words and place", () => {
    const waiting = render(createElement(StatusCover, { g: gen({ status: "queued", message: "Waiting for a GPU to come on", queue: { place: 1, etaSeconds: null, unknown: true } }) }));
    expect(waiting).toContain("data-run-spinner");
    expect(text(waiting)).toContain("Waiting for a GPU to come on");
    expect(text(waiting)).toContain("Next in line · starts when a GPU is free");
    const running = render(createElement(StatusCover, { g: gen({ status: "running", message: "Making your picture · step 3 of 8", progress: 0.375 }) }));
    expect(text(running)).toContain("Making your picture · step 3 of 8");
    expect(text(render(createElement(StatusCover, { g: gen({ status: "queued", message: "" }) })))).toContain("Queued");
  });
});
