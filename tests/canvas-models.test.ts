import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import { CANVAS_TEMPLATES, defaultModelFor, defaultModelForNode, EFFECT_CHAIN_MODELS, getTemplate, planCanvas, type CanvasNode } from "@/lib/catalog/canvas";
import type { Engine, Operation } from "@/lib/catalog/types";

// The models a new Canvas node and the templates start on: MiniMax H3 for video on both engines, Qwen-Image 2.1 for the
// open stills, SeedVR2 for open upscales, Sync Lipsync 3 in the cloud.

const node = (id: string, type: CanvasNode["type"], data: CanvasNode["data"] = {}): CanvasNode => ({ id, type, position: { x: 0, y: 0 }, data });

describe("Canvas defaults", () => {
  it.each([
    ["t2v", "cloud", "minimax-h3"],
    ["i2v", "cloud", "minimax-h3"],
    ["flf2v", "cloud", "minimax-h3"],
    ["t2v", "open", "oss-minimax-h3"],
    ["i2v", "open", "oss-minimax-h3"],
    ["flf2v", "open", "oss-minimax-h3"],
    ["ref2v", "cloud", "seedance-2-5"],
    ["ref2v", "open", "oss-wan-vace"],
    ["lipsync", "cloud", "sync-lipsync-3"],
    ["upscale-image", "open", "oss-seedvr2-image"],
    ["upscale-video", "open", "oss-seedvr2"],
  ] as [Operation, Engine, string][])("%s on %s starts on %s", (op, engine, id) => {
    expect(defaultModelFor(op, engine, { hidden: true })?.id).toBe(id);
  });

  it("a new video node and the Upscale utility start on those models", () => {
    expect(defaultModelForNode(node("v", "model", { mediaKind: "video" }), "open")?.id).toBe("oss-minimax-h3");
    expect(defaultModelForNode(node("v", "model", { mediaKind: "video", op: "i2v" }), "cloud")?.id).toBe("minimax-h3");
    expect(defaultModelForNode(node("u", "upscale", { mediaKind: "image" }), "open")?.id).toBe("oss-seedvr2-image");
    expect(defaultModelForNode(node("u", "upscale", { mediaKind: "video" }), "open")?.id).toBe("oss-seedvr2");
  });
});

describe("Canvas templates' models", () => {
  const models = (id: string, engine: Engine) => Object.fromEntries(getTemplate(id)!.build(engine).nodes.filter((n) => n.data.modelId).map((n) => [n.id, n.data.modelId]));

  it("Image → Animate and Table → shots → film: a Qwen-Image 2.1 still (open), a MiniMax H3 clip", () => {
    for (const id of ["image-animate", "table-film"]) {
      expect(models(id, "open")).toMatchObject({ still: "oss-qwen-image-21", animate: "oss-minimax-h3" });
      expect(models(id, "cloud")).toMatchObject({ still: "nano-banana-pro", animate: "minimax-h3" });
    }
  });

  it("Script → storyboard → film: Qwen-Image 2.1 frames, MiniMax H3 shots, joined", () => {
    const open = models("script-film", "open");
    for (const i of [1, 2, 3]) expect(open).toMatchObject({ [`frame${i}`]: "oss-qwen-image-21", [`shot${i}`]: "oss-minimax-h3" });
    expect(open.film).toBe("oss-join-clips");
    const cloud = models("script-film", "cloud");
    for (const i of [1, 2, 3]) expect(cloud).toMatchObject({ [`frame${i}`]: "nano-banana-pro", [`shot${i}`]: "minimax-h3" });
    // The shots are 5 s, the start of H3's trained range.
    const shots = getTemplate("script-film")!.build("open").nodes.filter((n) => n.id.startsWith("shot"));
    expect(shots.every((n) => n.data.params?.duration === 5)).toBe(true);
  });

  it("Compare 3 image models: FLUX.3 next to Nano Banana Pro and Seedream 5 Pro in the cloud", () => {
    expect(Object.values(models("compare-image", "cloud"))).toEqual(["nano-banana-pro", "seedream-5-pro", "flux-3"]);
    expect(Object.values(models("compare-image", "open"))).toEqual(["oss-ideogram-4", "oss-qwen-image-21", "oss-krea2-realism"]);
  });

  it("Effects 2.0 chains set the scene with Qwen-Image 2.1 Turbo on your GPU, then animate with Fuobe DoP", () => {
    expect(EFFECT_CHAIN_MODELS).toMatchObject({ edit: { open: "oss-qwen-image-21-turbo", cloud: "qwen-image-edit-2511-cloud" }, video: "fuobe-dop" });
    expect(getModel("oss-qwen-image-21-turbo")!.routes.some((r) => r.op === "edit")).toBe(true);
  });

  it("every template plans on the open engine with these models, for free", () => {
    for (const t of CANVAS_TEMPLATES) {
      const plan = planCanvas(t.build("open"), { engineMode: "open" });
      for (const e of plan.errors) expect(e.message, t.id).toMatch(/^(Add (an image|an audio clip|a video|a voice sample) to|Waiting on)/);
      expect(plan.costUsd, t.id).toBe(0);
    }
  });
});
