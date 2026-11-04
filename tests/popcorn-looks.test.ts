import { beforeAll, describe, expect, it, vi } from "vitest";
import { planStoryboard, STORYBOARD_LOOK_MODEL } from "@/lib/catalog/storyboard";
import { buildPayload } from "@/lib/catalog/payload";
import { filmReady } from "@/lib/storyboard-board";
import { soulLook } from "@/lib/catalog/soul";
import type { OutputFile } from "@/lib/catalog/types";
import { tempDir } from "./helpers/temp-dir";

vi.setConfig({ testTimeout: 90_000 });

// Popcorn with Fuobe Soul's looks (build plan O13): the planner, then boards end to end in demo mode.
const dir = tempDir("fuobe-popcorn-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { createStoryboard, createStoryboardFilm, estimateStoryboard } = await import("@/server/storyboard");
const estimateRoute = await import("@/app/api/storyboards/estimate/route");
const { db } = await import("@/server/db");

beforeAll(() => setSetting("demoMode", "auto"));

const look = soulLook("v1-digitalcam")!;
const scenes = ["a girl at a bus stop at night", "the bus arrives", "she looks back"];

describe("Popcorn looks: the planner", () => {
  it("frame 1 on Fuobe Soul with the look on the board's engine; the next frames carry its words and take the raw frame before", () => {
    for (const engine of ["cloud", "open"] as const) {
      const frames = planStoryboard({ engine, scenes, look: { id: look.id, words: look.look, strength: 0.8 }, aspectRatio: "16:9" });
      expect(frames[0]).toMatchObject({ modelId: STORYBOARD_LOOK_MODEL, engine, presetId: look.id, presetStrength: 0.8, frame: { index: 0, look: look.id } });
      // The look's words come from Soul's recipe on frame 1, not twice.
      expect(frames[0].prompt).not.toContain(look.look.replace(/[.\s]+$/, ""));
      const next = frames[1];
      expect(next.modelId).toBe(engine === "cloud" ? "qwen-image-edit-2509-cloud" : "oss-qwen-image-21-next-scene");
      expect(next.prompt).toMatch(/^Next Scene: the bus arrives\./);
      expect(next.prompt).toContain(`Style: ${look.look.replace(/[.\s]+$/, "")}`);
      expect(next.chain).toEqual([{ slot: "images", position: "first", raw: true }]);
      expect(next.chainFrom).toBeUndefined();
      expect(next.frame).toMatchObject({ index: 1, of: 3, look: look.id });
    }
  });

  it("in the cloud the board is open weights end to end: hosted Z-Image Turbo, then Qwen-Image-Edit 2509 with the GPU graph's next-scene LoRA", () => {
    const frames = planStoryboard({ engine: "cloud", scenes, references: ["/api/files/hero.png", "/api/files/coat.png"] });
    expect(frames[0]).toMatchObject({ modelId: "qwen-image-edit-2511-cloud", inputs: { images: ["/api/files/hero.png", "/api/files/coat.png"] } });
    expect(planStoryboard({ engine: "cloud", scenes })[0].modelId).toBe("z-image-turbo-cloud");
    const next = frames[1];
    // The previous frame goes in first (chainFrom), the first reference after it, as on the GPU graph.
    expect(next).toMatchObject({ modelId: "qwen-image-edit-2509-cloud", chainFrom: "first", inputs: { images: ["/api/files/hero.png"] } });
    expect(next.prompt).toBe("Next Scene: the bus arrives.");
    expect(next.loras).toEqual([
      expect.objectContaining({
        file: "next-scene_lora-v2-3000.safetensors",
        strength: 0.75,
        url: "https://huggingface.co/lovis93/next-scene-qwen-image-lora-2509/resolve/9b9da698b8a5370efd875f18b1727cc1119f3863/next-scene_lora-v2-3000.safetensors",
        licence: expect.objectContaining({ name: "MIT", commercial: true }),
      }),
    ]);
    expect(frames[0].loras).toBeUndefined();
    // The GPU graph loads the LoRA itself.
    expect(planStoryboard({ engine: "open", scenes })[1].loras).toBeUndefined();
  });

  it("Nano Banana Pro stays a separate choice in the cloud: every frame on it, each from the last one, no LoRA", () => {
    const frames = planStoryboard({ engine: "cloud", partner: "nano-banana-pro", scenes, references: ["/api/files/hero.png"] });
    expect(frames.map((f) => f.modelId)).toEqual(["nano-banana-pro", "nano-banana-pro", "nano-banana-pro"]);
    expect(frames[1]).toMatchObject({ chainFrom: "last", inputs: { images: ["/api/files/hero.png"] } });
    expect(frames.every((f) => !f.loras)).toBe(true);
    // With a look, frame 1 is still the look's Fuobe Soul picture; the GPU has no partner.
    expect(planStoryboard({ engine: "cloud", partner: "nano-banana-pro", scenes, look: { id: look.id, words: look.look } })[0].modelId).toBe(STORYBOARD_LOOK_MODEL);
    expect(planStoryboard({ engine: "open", partner: "nano-banana-pro", scenes })[1].modelId).toBe("oss-qwen-image-21-next-scene");
  });

  it("with references, frame 1 stays on the reference model with the look's words, and still gets the look's finish", () => {
    const [first] = planStoryboard({ engine: "cloud", scenes, references: ["/api/files/hero.png"], style: "35mm", look: { id: look.id, words: look.look } });
    expect(first).toMatchObject({ modelId: "qwen-image-edit-2511-cloud", inputs: { images: ["/api/files/hero.png"] }, frame: { look: look.id } });
    expect(first.presetId).toBeUndefined();
    expect(first.prompt).toContain(`Style: 35mm. ${look.look.replace(/[.\s]+$/, "")}`);
  });

  it("21:9 with a look: made at 16:9 (Fuobe Soul has no 21:9) and cropped after; without a look nothing changes", () => {
    const wide = planStoryboard({ engine: "open", scenes, look: { id: look.id, words: look.look }, aspectRatio: "21:9" });
    expect(wide.every((f) => f.params?.aspectRatio === "16:9" && f.frame?.crop === "21:9")).toBe(true);
    const plain = planStoryboard({ engine: "open", scenes, aspectRatio: "21:9" });
    expect(plain[0]).toMatchObject({ modelId: "oss-qwen-image-21", params: { aspectRatio: "21:9" } });
    expect(plain[1]).toMatchObject({ chainFrom: "first" });
    expect(plain[1].chain).toBeUndefined();
    expect(plain.every((f) => !f.frame?.look && !f.frame?.crop)).toBe(true);
  });
});

describe("Popcorn looks: boards (demo)", () => {
  const settle = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const g = gens.getGeneration(id)!;
      if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error("timed out");
  };

  it("every frame carries the look's finish as meta; a next frame is made from the frame before as it came out", async () => {
    const board = await createStoryboard({ engine: "cloud", scenes, look: look.id, aspectRatio: "21:9" });
    expect(board.items.map((g) => g.modelId)).toEqual(["fuobe-soul", "qwen-image-edit-2509-cloud", "qwen-image-edit-2509-cloud"]);
    const first = await settle(board.items[0].id);
    expect(first.status).toBe("succeeded");
    expect(first.outputs[0].meta).toMatchObject({ look: look.id, overlay: "date-stamp", crop: "21:9", ...(look.grade && { grade: look.grade }) });
    // A browser finished frame 1 before frame 2 started: frame 2 still gets the raw picture.
    const finished: OutputFile[] = first.outputs.map((o) => ({ ...o, url: "/api/files/finished.png", meta: { ...o.meta, finished: true, original: o.url } }));
    db().prepare("UPDATE generations SET outputs_json = ? WHERE id = ?").run(JSON.stringify(finished), first.id);
    const second = await settle(board.items[1].id);
    expect(second.status).toBe("succeeded");
    expect(second.request.inputs?.images?.[0]).toBe(first.outputs[0].url);
    expect(second.request.loras?.map((l) => l.file)).toEqual(["next-scene_lora-v2-3000.safetensors"]);
    expect(second.outputs[0].meta).toMatchObject({ look: look.id, overlay: "date-stamp", crop: "21:9" });
    const third = await settle(board.items[2].id);

    // The film waits for the browser's finish, and a 21:9 look board's film is 21:9 like its frames.
    const frames = [gens.getGeneration(first.id)!, second, third];
    expect(filmReady(frames)).toBe(false);
    expect(filmReady(frames, (g) => g.id !== first.id)).toBe(true);
    for (const g of [second, third]) {
      const done: OutputFile[] = g.outputs.map((o) => ({ ...o, url: `/api/files/${g.id}-finished.png`, meta: { ...o.meta, finished: true, original: o.url } }));
      db().prepare("UPDATE generations SET outputs_json = ? WHERE id = ?").run(JSON.stringify(done), g.id);
    }
    expect(filmReady(board.items.map((g) => gens.getGeneration(g.id)!))).toBe(true);
    const film = createStoryboardFilm(board.batchId);
    const shots = film.items.filter((g) => g.op !== "concat");
    expect(shots.length).toBe(3);
    expect(shots.every((g) => g.request.params?.aspectRatio === "21:9")).toBe(true);
    for (const g of film.items) await settle(g.id);
  });

  it("the next frame's hosted route sends the next-scene LoRA as a URL at its strength", async () => {
    setSetting("falKey", "fal-test-key");
    try {
      const [, next] = planStoryboard({ engine: "cloud", scenes });
      const p = gens.previewChained(next, 1);
      expect(p).toMatchObject({ demo: false, route: { provider: "fal", endpoint: "fal-ai/qwen-image-edit-plus-lora" } });
      expect(p.loras.applied.map((l) => l.file)).toEqual(["next-scene_lora-v2-3000.safetensors"]);
      const route = p.model.routes.find((r) => r.provider === "fal")!;
      const body = buildPayload(route.map!, { prompt: p.prompt, images: ["https://x/prev.png"], aspectRatio: "16:9", loras: p.loras.applied });
      expect(body).toMatchObject({
        prompt: "Next Scene: the bus arrives.",
        image_urls: ["https://x/prev.png"],
        loras: [{ path: "https://huggingface.co/lovis93/next-scene-qwen-image-lora-2509/resolve/9b9da698b8a5370efd875f18b1727cc1119f3863/next-scene_lora-v2-3000.safetensors", scale: 0.75 }],
      });
    } finally {
      setSetting("falKey", "");
    }
  });

  it("a raw slot takes the picture before its finish; any other slot the finished one", async () => {
    const o: OutputFile = { url: "/api/files/finished.png", kind: "image", meta: { finished: true, original: "/api/files/raw.png" } };
    expect(await gens.chainValue(o, { slot: "images", position: "last", raw: true })).toBe("/api/files/raw.png");
    expect(await gens.chainValue(o, { slot: "images", position: "last" })).toBe("/api/files/finished.png");
    expect(await gens.chainValue({ url: "/api/files/plain.png", kind: "image" }, { slot: "images", raw: true })).toBe("/api/files/plain.png");
  });

  it("prices a board before it runs: the look's model for frame 1, Free on the GPU", async () => {
    setSetting("falKey", "fal-test-key");
    try {
      const e = estimateStoryboard({ engine: "cloud", frames: 4, look: look.id });
      expect(e).toMatchObject({ frames: 4, demo: false, models: ["Fuobe Soul", "Qwen-Image-Edit 2509 (hosted)"] });
      // Fuobe Soul's picture at about a cent, then three hosted Qwen-Image-Edit 2509 edits at $0.035 a megapixel.
      expect(e.costUsd).toBeGreaterThan(0.05);
      expect(e.costUsd).toBeLessThan(0.2);
      const plain = estimateStoryboard({ engine: "cloud", frames: 4 });
      expect(plain.models).toEqual(["Z-Image Turbo (hosted)", "Qwen-Image-Edit 2509 (hosted)"]);
      expect(plain.costUsd).toBeLessThan(0.2);
      // The partner board as boards ran before: four Nano Banana Pro pictures at $0.15.
      const partner = estimateStoryboard({ engine: "cloud", frames: 4, partner: "nano-banana-pro" });
      expect(partner.models).toEqual(["Nano Banana Pro"]);
      expect(partner.costUsd).toBeCloseTo(0.6, 3);
    } finally {
      setSetting("falKey", "");
    }
    const res = await estimateRoute.POST(new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engine: "open", scenes, look: look.id }) }));
    expect(await res.json()).toMatchObject({ costUsd: 0, frames: 3 });
    const bad = await estimateRoute.POST(new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engine: "open", scenes, look: "v9-nope" }) }));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error).toBe("That look doesn't exist — pick another one");
  });
});
