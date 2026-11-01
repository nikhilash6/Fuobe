import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CanvasGraph, CanvasNode } from "@/lib/catalog/canvas";
import type { LoraRef } from "@/lib/catalog/types";

// Fuobe Soul after review (o/soul): the open engine's batch, a look beside a moved moodboard, the dual-engine
// model in the lists, the canvas, the CLI and Assist, fal's megapixel, the civitai rule, Soul HD with a picture,
// Soul Cinema's 21:9 crop and the hand-off over the composer's engine swap.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-soul-fixes-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9"; // nothing listens here: open runs fall back to the demo

const { setSetting } = await import("@/server/settings");
const { createGenerations, getGeneration, previewGeneration } = await import("@/server/generations");
const { getModel, getPreset, MODELS } = await import("@/lib/catalog");
const { onEngine } = await import("@/lib/catalog/engines");
const { estimateCost, planGeneration } = await import("@/lib/catalog/plan");
const { applySignature } = await import("@/lib/catalog/palettes");
const { loraEntry, loraRef } = await import("@/lib/catalog/loras");
const { OWN_LOOK, soulPostSteps } = await import("@/lib/catalog/soul");
const { cropRect, finishSteps } = await import("@/lib/soul-post");
const { findModels } = await import("@/lib/model-list");
const { toModelRow } = await import("@/lib/model-rows");
const { indexEntries } = await import("@/lib/command-search");
const { paletteIndex } = await import("@/lib/palette-index");
const { convertEngine, describeNode, graphEngine, nodeModel } = await import("@/lib/catalog/canvas");
const { followEngineDefault, mergeHandoff } = await import("@/lib/composer");
const { withoutUnreachableCivitai } = await import("@/server/loras");
const { formatCost } = await import("@/lib/format");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const plan = (engine: "open" | "cloud", req: Partial<Parameters<typeof planGeneration>[0]> = {}, id = "fuobe-soul") => {
  const m = onEngine(getModel(id)!, engine);
  return planGeneration({ feature: "image", modelId: m.id, prompt: "a fox in the snow", ...req }, (x) => (x === m.id ? m : getModel(x)), getPreset);
};

describe("the open engine makes every picture asked for", () => {
  it("runs one ComfyUI job per picture (a graph makes one), fal one job of four", () => {
    // ComfyUI answers (not a demo): the graph binds no batch size.
    globalThis.__fuobeComfyReach = { ok: true, at: Date.now(), url: "http://127.0.0.1:9" };
    try {
      const open = previewGeneration({ feature: "image", modelId: "fuobe-soul", prompt: "a fox", engine: "open", params: { numOutputs: 4 } });
      expect(open).toMatchObject({ demo: false, engine: "open", jobs: 4, outputs: 4, costUsd: 0 });
      // Every Soul model on the GPU.
      for (const id of ["fuobe-soul-hd", "fuobe-soul-cinema"]) expect(previewGeneration({ feature: "image", modelId: id, prompt: "a fox", engine: "open", params: { numOutputs: 3 } })).toMatchObject({ jobs: 3, outputs: 3 });
      const gens = createGenerations({ feature: "image", modelId: "fuobe-soul", prompt: "a fox", engine: "open", params: { numOutputs: 2, seed: 7 } });
      expect(gens).toHaveLength(2);
    } finally {
      globalThis.__fuobeComfyReach = undefined;
    }
    // fal's num_images makes the four in one job.
    setSetting("falKey", "fal_test_key_123456");
    try {
      expect(previewGeneration({ feature: "image", modelId: "fuobe-soul", prompt: "a fox", engine: "cloud", params: { numOutputs: 4 } })).toMatchObject({ jobs: 1, outputs: 4 });
    } finally {
      setSetting("falKey", "");
    }
  });
});

describe("a look beside a moodboard that moves the run", () => {
  const board = { id: "mb1", kind: "personal" as const, name: "Dusk", status: "complete" as const, refs: ["/api/files/uploads/r1.png", "/api/files/uploads/r2.png"], collages: ["/api/files/uploads/c1.png"] };
  const view = (engine: "open" | "cloud") => (id: string) => {
    const m = getModel(id);
    return m && onEngine(m, engine);
  };

  it("leaves the look with Fuobe Soul and says so, so the moved run plans", () => {
    for (const engine of ["cloud", "open"] as const) {
      const signed = applySignature({ feature: "image", modelId: "fuobe-soul", prompt: "a lighthouse", presetId: "v1-y2k", presetStrength: 0.5, engine }, { moodboard: board }, { caps: { native: {} }, getModel: view(engine) });
      expect(signed.modelId).not.toBe("fuobe-soul");
      expect(signed.request.presetId).toBeUndefined();
      expect(signed.request.presetStrength).toBeUndefined();
      expect(signed.notes.join(" ")).toMatch(/Y2K look is Fuobe Soul's own/);
      expect(() => planGeneration(signed.request, view(engine), getPreset)).not.toThrow();
    }
    // A trained style is a Fuobe look (build plan O3): it stays on Fuobe Soul on either engine, the LoRA as the look.
    for (const engine of ["cloud", "open"] as const) {
      const trained = applySignature({ feature: "image", modelId: "fuobe-soul", prompt: "a lighthouse", presetId: "v1-y2k", engine }, { moodboard: { ...board, loraHandle: "dusk" } }, { caps: { native: {} }, getModel: view(engine) });
      expect(trained.modelId).toBe("fuobe-soul");
      expect(trained.request).toMatchObject({ presetId: OWN_LOOK, engine, signature: { words: "In the style of @dusk." } });
      expect(() => planGeneration(trained.request, view(engine), getPreset)).not.toThrow();
    }
    // Soul Cinema's look is fixed: the board's look moves the run to Fuobe Soul.
    const cine = applySignature({ feature: "image", modelId: "fuobe-soul-cinema", prompt: "a lighthouse", engine: "cloud" }, { moodboard: { ...board, loraHandle: "dusk" } }, { caps: { native: {} }, getModel: view("cloud") });
    expect(cine).toMatchObject({ modelId: "fuobe-soul", request: { presetId: OWN_LOOK, engine: "cloud" } });
    // A curated look stays a look on Fuobe Soul.
    const curated = applySignature({ feature: "image", modelId: "fuobe-soul", prompt: "a lighthouse", engine: "cloud" }, { moodboard: { id: "v2-y2k-studio", kind: "curated", name: "Y2K Studio", status: "complete" } }, { caps: { native: {} }, getModel: view("cloud") });
    expect(curated.request.presetId).toBe("v2-y2k-studio");
  });
});

describe("one model on both engines in every list", () => {
  it("is in each engine's model list, and the Models page row says both", () => {
    for (const engine of ["open", "cloud"] as const) expect(findModels(MODELS, { kind: "image", engine }).map((m) => m.id)).toContain("fuobe-soul");
    const row = toModelRow(getModel("fuobe-soul")!);
    expect(row.engines).toEqual(["open", "cloud"]);
    expect(row.price).toBe(`Free · ${formatCost(0.0085)} / megapixel`);
    // As it runs on one engine: that engine alone, its own price.
    expect(toModelRow(onEngine(getModel("fuobe-soul")!, "cloud"))).toMatchObject({ engine: "cloud", engines: ["cloud"], price: `${formatCost(0.0085)} / megapixel` });
    expect(toModelRow(onEngine(getModel("fuobe-soul")!, "open"))).toMatchObject({ engine: "open", engines: ["open"], price: "Free" });
    expect(toModelRow(getModel("nano-banana-pro")!).engines).toEqual(["cloud"]);
  });

  it("GET /api/models lists it for the cloud and on a cloud-only install, as its cloud half", async () => {
    const { GET } = await import("@/app/api/models/route");
    const list = async (q: string) => ((await (await GET(new Request(`http://localhost/api/models?${q}`))).json()) as { items: { id: string; engine: string; engines: string[]; routes: string[] }[] }).items;
    const cloud = (await list("kind=image&engine=cloud")).find((m) => m.id === "fuobe-soul");
    expect(cloud).toMatchObject({ engine: "cloud", engines: ["cloud"] });
    expect(cloud!.routes.every((r) => !r.startsWith("comfyui"))).toBe(true);
    expect((await list("kind=image")).find((m) => m.id === "fuobe-soul")).toMatchObject({ engines: ["open", "cloud"] });
    setSetting("engineMode", "cloud");
    try {
      expect((await list("kind=image")).find((m) => m.id === "fuobe-soul")).toMatchObject({ engine: "cloud" });
    } finally {
      setSetting("engineMode", "both");
    }
  });

  it("is in ⌘K on either engine, once, marked as both", () => {
    const index = paletteIndex();
    for (const mode of ["open", "cloud", "both"] as const) expect(indexEntries(index, mode).filter((e) => e.key === "model:fuobe-soul")).toHaveLength(1);
    const both = indexEntries(index, "both").find((e) => e.key === "model:fuobe-soul")!;
    expect(both.hint).toMatch(/Open source \+ cloud/);
    expect(both.keywords).toMatch(/cloud/);
  });
});

describe("the canvas runs an Original on the node's engine", () => {
  const node = (data: CanvasNode["data"]): CanvasNode => ({ id: "s", type: "model", position: { x: 0, y: 0 }, data: { prompt: "a fox in the snow", ...data } });
  const graph = (n: CanvasNode): CanvasGraph => ({ nodes: [n], edges: [] });

  it("runs on a cloud-only install, priced as the cloud runs it, and names its engine", () => {
    const n = node({ modelId: "fuobe-soul" });
    const d = describeNode(graph(n), n, { engineMode: "cloud" });
    expect(d.error).toBeUndefined();
    expect(d.model?.engine).toBe("cloud");
    expect(d.request?.engine).toBe("cloud");
    expect(d.costUsd).toBeGreaterThan(0);
    // The node's own engine on an install with both.
    const open = describeNode(graph(node({ modelId: "fuobe-soul", engine: "open" })), node({ modelId: "fuobe-soul", engine: "open" }));
    expect(open).toMatchObject({ costUsd: 0, request: { engine: "open" } });
    const cloud = node({ modelId: "fuobe-soul", engine: "cloud" });
    expect(describeNode(graph(cloud), cloud).costUsd).toBeGreaterThan(0);
    expect(nodeModel(cloud)?.routes.every((r) => r.provider !== "comfyui")).toBe(true);
  });

  it("keeps the Original when the board switches engine (only its engine changes)", () => {
    const g = graph(node({ modelId: "fuobe-soul", params: { aspectRatio: "9:16" } }));
    const toCloud = convertEngine(g, "cloud");
    expect(toCloud.changed).toBe(1);
    expect(toCloud.graph.nodes[0].data).toMatchObject({ modelId: "fuobe-soul", engine: "cloud", params: { aspectRatio: "9:16" } });
    expect(graphEngine(toCloud.graph)).toBe("cloud");
    // Back to open, then open again: nothing left to change.
    const back = convertEngine(toCloud.graph, "open");
    expect(back.graph.nodes[0].data).toMatchObject({ modelId: "fuobe-soul", engine: "open" });
    expect(convertEngine(back.graph, "open").changed).toBe(0);
  });

  it("saves the node's engine with the board", async () => {
    const { parseGraph } = await import("@/server/canvas");
    const saved = parseGraph(graph(node({ modelId: "fuobe-soul", engine: "cloud" })));
    expect(saved?.nodes[0].data.engine).toBe("cloud");
    expect(parseGraph(graph(node({ modelId: "fuobe-soul", engine: "gpu" as "open" })))).toBeNull();
  });
});

describe("the CLI and Assist name the engine", () => {
  it("sends --engine and --look", async () => {
    const { generationRequest } = await import("../bin/lib/build.mjs");
    const body = generationRequest({ prompt: "a fox", modelId: "fuobe-soul", values: { engine: "cloud", look: "v1-y2k", "look-strength": 0.4 } });
    expect(body).toMatchObject({ modelId: "fuobe-soul", engine: "cloud", presetId: "v1-y2k", presetStrength: 0.4 });
    expect(() => generationRequest({ prompt: "a fox", modelId: "fuobe-soul", values: { "look-strength": 2 } })).toThrow(/0 to 1/);
    // The server honours it even when the GPU would be picked first.
    globalThis.__fuobeComfyReach = { ok: true, at: Date.now(), url: "http://127.0.0.1:9" };
    try {
      expect(previewGeneration(body)).toMatchObject({ engine: "cloud" });
    } finally {
      globalThis.__fuobeComfyReach = undefined;
    }
  });

  it("an Assist job without an engine follows the user's", async () => {
    const tools = await import("@/server/assist/tools");
    const out = await tools.executeTool("generate", { summary: "a fox", jobs: [{ model_id: "fuobe-soul", prompt: "a fox" }] }, { engine: "cloud" });
    const id = (JSON.parse(out.content as string) as { started: string[] }[])[0].started[0];
    expect(getGeneration(id)?.engine).toBe("cloud");
    // Named, it wins.
    const named = await tools.executeTool("generate", { summary: "a fox", jobs: [{ model_id: "fuobe-soul", prompt: "a fox", engine: "open" }] }, { engine: "cloud" });
    expect(getGeneration((JSON.parse(named.content as string) as { started: string[] }[])[0].started[0])?.engine).toBe("open");
  });
});

describe("prices on fal's megapixel", () => {
  it("bills Soul's 720p tier as one megapixel (fal counts 1024 × 1024), Soul HD's whole megapixels too", () => {
    const soul = onEngine(getModel("fuobe-soul")!, "cloud");
    expect(estimateCost(soul, { aspectRatio: "1:1", resolution: "720p", numOutputs: 4 }, 1, "t2i", true)).toBeCloseTo(0.0085 * 4, 4);
    const hd = onEngine(getModel("fuobe-soul-hd")!, "cloud");
    for (const aspect of ["1:1", "3:4", "16:9", "2:3"]) expect(estimateCost(hd, { aspectRatio: aspect, resolution: "720p", numOutputs: 1 }, 1, "t2i")).toBeCloseTo(0.02, 4);
    expect(estimateCost(hd, { aspectRatio: "16:9", resolution: "1080p", numOutputs: 1 }, 1, "t2i")).toBeCloseTo(0.04, 4);
  });
});

describe("civitai LoRAs without a key", () => {
  it("leaves them out of a Soul look only; a motion's LoRA still stops at the download", () => {
    setSetting("falKey", "fal_test_key_123456");
    try {
      const hard = loraRef(loraEntry("hardflash")!);
      // Not Soul: the run carries it (and fails at the download, asking for the key) rather than charging without it.
      const other = previewGeneration({ feature: "image", modelId: "z-image-turbo-cloud", prompt: "a fox", loras: [hard] });
      expect(other.loras.dropped.some((d) => /civitai key/.test(d.reason))).toBe(false);
      const soul = previewGeneration({ feature: "image", modelId: "fuobe-soul", prompt: "a fox", engine: "cloud", presetId: "v1-indie-sleaze" });
      expect(soul.loras.dropped.map((d) => d.file)).toContain(hard.file);
    } finally {
      setSetting("falKey", "");
    }
  });

  it("drops a local-only (RentCivit) civitai LoRA on the GPU too, when the LoRA folder lacks it", () => {
    const folder = fs.mkdtempSync(path.join(dir, "loras-"));
    setSetting("comfyLorasDir", folder);
    try {
      const rent: LoraRef = { file: "rent-only.safetensors", url: "https://civitai.com/api/download/models/999", strength: 1, licence: { commercial: true, hostedOk: false } as LoraRef["licence"] };
      expect(withoutUnreachableCivitai([rent], "comfyui").loras).toEqual([]);
      // On the cloud it goes like any LoRA (its licence is information), so without a key it's unreachable there too...
      expect(withoutUnreachableCivitai([rent], "fal").loras).toEqual([]);
      // ...unless the admin keeps such LoRAs on the GPU: then fitLoras leaves it out and says so, so it isn't listed twice.
      const kept = { ...rent, keepOnGpu: true as const };
      expect(withoutUnreachableCivitai([kept], "fal")).toEqual({ loras: [kept], notes: [] });
    } finally {
      setSetting("comfyLorasDir", "");
    }
  });
});

describe("Soul HD and Soul Cinema", () => {
  it("says when Soul HD can't use an attached picture", () => {
    const p = plan("cloud", { presetId: "v1-graffiti", inputs: { images: ["/api/files/uploads/x.png"] } }, "fuobe-soul-hd");
    expect(p.op).toBe("t2i");
    expect(p.notes?.join(" ")).toMatch(/doesn't use the picture you attached/);
    expect(plan("cloud", { presetId: "v1-graffiti" }, "fuobe-soul-hd").notes ?? []).toEqual([]);
  });

  it("makes Soul Cinema's 21:9 at 16:9 and crops it after", () => {
    expect(getModel("fuobe-soul-cinema")!.options.aspectRatios).toContain("21:9");
    expect(getModel("fuobe-soul")!.options.aspectRatios).not.toContain("21:9");
    for (const engine of ["open", "cloud"] as const) {
      const p = plan(engine, { params: { aspectRatio: "21:9", resolution: "720p" } }, "fuobe-soul-cinema");
      expect(p.params.aspectRatio).toBe("16:9");
      expect(p.soul?.crop).toBe("21:9");
      if (engine === "open") expect(p.params.extra).toMatchObject({ width: 1344, height: 768 });
    }
    expect(soulPostSteps("fuobe-soul-cinema", null, "21:9")).toEqual({ grade: "teal-orange", crop: "21:9" });
    expect(soulPostSteps("fuobe-soul-cinema", null, "16:9")).toEqual({ grade: "teal-orange" });
    expect(finishSteps({ kind: "image", meta: { crop: "21:9" } })).toEqual({ crop: "21:9" });
    // The middle band of a 1344x768 picture: full width, 576 rows.
    expect(cropRect(1344, 768, "21:9")).toEqual({ x: 0, y: 96, width: 1344, height: 576 });
    expect(cropRect(1000, 1000, "16:9")).toEqual({ x: 0, y: 219, width: 1000, height: 563 });
  });
});

describe("a hand-off over the composer's engine swap", () => {
  const draft = (modelId: string, params = {}) => ({ prompt: "", negativePrompt: "", modelId, params, slots: {}, refs: [], presetOptions: {} });
  const defaults = { cloud: "nano-banana-pro", open: "oss-z-image-turbo" };

  it("applies ?model= after the open engine swapped the untouched default", () => {
    const base = draft("nano-banana-pro");
    const swapped = draft("oss-z-image-turbo", { aspectRatio: "1:1" });
    const next = draft("fuobe-soul", { aspectRatio: "3:4" });
    // Before: the swap read as the person's pick, so the hand-off's model was dropped.
    expect(mergeHandoff(base, swapped, next).modelId).toBeUndefined();
    expect(mergeHandoff(followEngineDefault(base, swapped, defaults, "open"), swapped, next)).toMatchObject({ modelId: "fuobe-soul", params: { aspectRatio: "3:4" } });
    // A model the person picked is still theirs.
    const picked = draft("flux-2-pro");
    expect(followEngineDefault(base, picked, defaults, "open")).toBe(base);
    expect(followEngineDefault(base, base, defaults, "cloud")).toBe(base);
  });

  it("applies ?model= after the composer moved the open default to its stand-in (no caption writer)", () => {
    // The Image studio's open default is Ideogram 4; where the server writes no caption the composer moves an untouched
    // one to Qwen-Image 2.1, and a link (a paid model an account has no key for yet, a Models page row) still lands.
    const image = { cloud: "nano-banana-pro", open: "oss-ideogram-4" };
    const base = draft("oss-ideogram-4");
    const standIn = draft("oss-qwen-image-21", { aspectRatio: "1:1" });
    const next = draft("nano-banana-pro", { aspectRatio: "16:9" });
    expect(mergeHandoff(followEngineDefault(base, standIn, image, "open"), standIn, next).modelId).toBeUndefined();
    expect(mergeHandoff(followEngineDefault(base, standIn, image, "open", { open: "oss-qwen-image-21" }), standIn, next)).toMatchObject({ modelId: "nano-banana-pro" });
    // Qwen-Image 2.1 picked on purpose over a draft that wasn't the default stays.
    expect(followEngineDefault(draft("flux-2-pro"), standIn, image, "open", { open: "oss-qwen-image-21" }).modelId).toBe("flux-2-pro");
  });

  it("keeps the curated eval baseline on the library's pinned commit", () => {
    const suite = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts/eval/cases/soul-cinema.json"), "utf8")) as { variants: { recipe: { loras: { file: string; url: string }[] } } };
    const film = suite.variants.recipe.loras.find((l) => l.file === loraEntry("filmstill")!.file)!;
    expect(film.url).toBe(loraEntry("filmstill")!.url);
    expect(film.url).not.toMatch(/resolve\/main\//);
  });
});
