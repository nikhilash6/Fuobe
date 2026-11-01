import { describe, expect, it } from "vitest";
import { buildViews, DescribeCache, EMPTY_RESULTS, foldResultsKeep, type NodeResults } from "@/components/canvas/canvas-context";
import { describeNode, planCanvas, type CanvasGraph, type CanvasNode } from "@/lib/catalog/canvas";
import type { Generation } from "@/lib/catalog/types";
import { applyToCanvasView, type CanvasViewLike } from "@/lib/generation-stream";

let n = 0;
function gen(p: Partial<Generation> = {}): Generation {
  n++;
  return {
    id: p.id ?? `g${n}`,
    batchId: null,
    feature: "canvas",
    presetId: null,
    modelId: "nano-banana-pro",
    engine: "cloud",
    provider: "mock",
    op: "t2i",
    kind: "image",
    status: "succeeded",
    progress: 1,
    message: null,
    prompt: "a fox",
    request: { feature: "canvas", modelId: "nano-banana-pro", prompt: "a fox" },
    outputs: [{ url: `/api/files/outputs/d/${n}.png`, kind: "image" }],
    error: null,
    costUsd: 0,
    favorite: false,
    createdAt: 1000 + n,
    updatedAt: 1000 + n,
    completedAt: null,
    deletedAt: null,
    folderId: null,
    ...p,
  };
}

describe("canvas board cache ← live stream", () => {
  const view = (gens: Generation[], ids = gens.map((g) => g.id)): CanvasViewLike => ({ canvas: { runs: { img: { ids } } }, generations: gens });

  it("replaces a result by id, ignoring late events and other boards' generations", () => {
    const a = gen({ status: "running", updatedAt: 10 });
    const v = view([a]);
    const done = { ...a, status: "succeeded" as const, updatedAt: 20 };
    expect(applyToCanvasView(v, { type: "generation", generation: done })!.generations).toEqual([done]);
    // An older copy (a late event) changes nothing.
    expect(applyToCanvasView(v, { type: "generation", generation: { ...a, updatedAt: 5 } })).toBe(v);
    // Someone else's generation: same object back.
    expect(applyToCanvasView(v, { type: "generation", generation: gen() })).toBe(v);
  });

  it("drops a result moved to the Trash (Viewer → Delete) and brings it back on Restore", () => {
    const a = gen();
    const v = view([a]);
    const trashed = applyToCanvasView(v, { type: "generation", generation: { ...a, deletedAt: 99, updatedAt: a.updatedAt + 1 } })!;
    expect(trashed.generations).toEqual([]);
    expect(applyToCanvasView(v, { type: "deleted", id: a.id })!.generations).toEqual([]);
    // Restored: the node's run still names it, so it comes back.
    const restored = { ...a, deletedAt: null, updatedAt: a.updatedAt + 2 };
    expect(applyToCanvasView(trashed, { type: "generation", generation: restored })!.generations).toEqual([restored]);
    expect(applyToCanvasView(undefined, { type: "deleted", id: a.id })).toBeUndefined();
  });
});

describe("canvas node views", () => {
  const graph: CanvasGraph = {
    nodes: [
      { id: "p", type: "prompt", position: { x: 0, y: 0 }, data: { text: "A red fox" } },
      { id: "img", type: "model", position: { x: 300, y: 0 }, data: { modelId: "nano-banana-pro" } },
      { id: "vid", type: "model", position: { x: 600, y: 0 }, data: { modelId: "kling-2-5-turbo", op: "i2v", prompt: "It runs" } },
    ],
    edges: [
      { id: "e1", source: "p", sourceHandle: "out", target: "img", targetHandle: "prompt" },
      { id: "e2", source: "img", sourceHandle: "out", target: "vid", targetHandle: "images" },
    ],
  };
  const describe_ = (g: CanvasGraph) => (id: string) => describeNode(g, g.nodes.find((x) => x.id === id)!);

  it("keeps every unchanged node's view object, so only the edited node re-renders", () => {
    const plan = planCanvas(graph);
    const results = new Map<string, NodeResults>();
    const first = buildViews(null, graph, plan, describe_(graph), results, {});
    expect(first.get("img")).toMatchObject({ op: "t2i", counts: { prompt: 1 }, step: "new", reused: false, results: EMPTY_RESULTS });
    expect(first.get("vid")).toMatchObject({ op: "i2v", counts: { images: 1 } });
    expect(first.has("p")).toBe(false);

    // Nothing changed: identical objects.
    const same = buildViews(first, graph, planCanvas(graph), describe_(graph), results, {});
    expect(same.get("img")).toBe(first.get("img"));
    expect(same.get("vid")).toBe(first.get("vid"));

    // The video's own prompt changes: the image's view is untouched.
    const edited: CanvasGraph = { ...graph, nodes: graph.nodes.map((x): CanvasNode => (x.id === "vid" ? { ...x, data: { ...x.data, prompt: "" } } : x)) };
    const next = buildViews(first, edited, planCanvas(edited), describe_(edited), results, { vid: "Nope" });
    expect(next.get("img")).toBe(first.get("img"));
    expect(next.get("vid")).not.toBe(first.get("vid"));
    expect(next.get("vid")).toMatchObject({ error: "Write a prompt first", runError: "Nope" });
  });

  it("describes again only the nodes whose own data or inputs changed", () => {
    const cache = new DescribeCache();
    const first = cache.run(graph, "both");
    expect(first.get("img")).toMatchObject({ op: "t2i", d: { request: { prompt: "A red fox" } } });
    expect(first.get("vid")?.op).toBe("i2v");
    // Same graph: same objects.
    const again = cache.run(graph, "both");
    expect(again.get("img")).toBe(first.get("img"));
    // Typing in the prompt touches the image (its input) and nothing downstream of it.
    const typed: CanvasGraph = { ...graph, nodes: graph.nodes.map((x): CanvasNode => (x.id === "p" ? { ...x, data: { text: "A red fox in snow" } } : x)) };
    const next = cache.run(typed, "both");
    expect(next.get("img")).not.toBe(first.get("img"));
    expect(next.get("img")?.d.request?.prompt).toBe("A red fox in snow");
    expect(next.get("vid")).toBe(first.get("vid"));
    // The engine mode changes every description.
    expect(cache.run(typed, "open").get("vid")?.d.error).toMatch(/cloud model/);
  });

  it("folds a node's results once per change of its generations", () => {
    const a = gen();
    const r = foldResultsKeep(undefined, [a]);
    expect(r).toMatchObject({ state: "succeeded", outputs: [{ g: a, i: 0 }] });
    expect(foldResultsKeep(r, [a])).toBe(r);
    const b = { ...a, status: "running" as const, progress: 0.5 };
    expect(foldResultsKeep(r, [b])).toMatchObject({ state: "running", progress: 0.5 });
    expect(foldResultsKeep(r, [])).toBe(EMPTY_RESULTS);
  });
});
