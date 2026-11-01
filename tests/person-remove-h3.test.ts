import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { graphLoras, h3Canvas, H3_REMOVAL_WORKFLOW, PERSON_REMOVER_LORA } from "@/lib/catalog/character-swap";
import { planGeneration } from "@/lib/catalog/plan";
import { chooseEraser, cleanFramePrompt, erasersFor, getEraser, PERSON_REMOVAL_FPS, planRemoval, REMOVE, type RemovalPlanInput } from "@/lib/catalog/remove-object";
import type { GenInput } from "@/lib/catalog/types";
import type { ManifestWorkflow } from "@/lib/comfy";
import { licenceInfo, nodePack } from "@/lib/licences";
import type { MediaInfo } from "@/lib/media-probe";

// Remove object's "Remove a person (H3)" (docs/research/openjutsu-6.md §4.4, §11.1 item 9): H3 Relay's Person Removal
// graph with Akatz Labs' Person Remover LoRA, from a clean first frame, on a clip fitted to 24 fps on the 32 grid.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-person-remove-"));
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { prepareWorkflow } = await import("@/server/providers/comfyui");
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../workflows/comfyui/manifest.json"), "utf8")) as { workflows: (ManifestWorkflow & { validationError?: string })[] };
const entry = manifest.workflows.find((w) => w.id === H3_REMOVAL_WORKFLOW)!;
const src = { url: "/api/files/uploads/clip.mp4", duration: 12, fps: 30, width: 1280, height: 720, hasAudio: true };
const eraser = getEraser("oss-h3-person-remove")!;
const input = (over: Partial<RemovalPlanInput> = {}): RemovalPlanInput => ({
  engine: "open",
  mode: "type",
  eraser,
  title: "Remove · the man in the grey shirt",
  source: src,
  range: { start: 2, end: 9 },
  prompt: "Remove the man in the grey shirt",
  ...over,
});

describe("H3 person removal: the eraser", () => {
  it("is an open eraser you type at, a catalog model on the Person Removal graph; VACE stays the default", () => {
    expect(erasersFor("open", "type").map((e) => e.id)).toContain("oss-h3-person-remove");
    expect(eraser).toMatchObject({ engine: "open", modes: ["type"], cleanFrame: true, keepsSound: false });
    const model = getModel("oss-h3-person-remove")!;
    expect(model.routes).toEqual([expect.objectContaining({ op: "remove-object", provider: "comfyui", endpoint: H3_REMOVAL_WORKFLOW })]);
    expect(chooseEraser({ engine: "open", mode: "type" })).toMatchObject({ eraser: { id: "oss-vace-remove" } });
    expect(chooseEraser({ engine: "open", mode: "type", modelId: "oss-h3-person-remove" })).toMatchObject({ eraser: { id: "oss-h3-person-remove" } });
  });
});

describe("H3 person removal: the plan", () => {
  it("fits the part to 24 fps on the 32 grid, takes its first frame, cleans it, removes the person, puts the sound back", () => {
    const p = planRemoval(input({ seed: 7 }));
    expect(p.steps.map((s) => s.key)).toEqual(["fit", "frame", "clean", "erase0", "sound", "final"]);
    const size = h3Canvas(1280, 720, "768p");
    expect(size).toEqual({ width: 1344, height: 736 });
    const step = (k: string) => p.steps.find((s) => s.key === k)!;
    expect(step("fit").request).toMatchObject({ modelId: "oss-fit-clip", op: "trim", inputs: { video: src.url }, params: { startTime: 2, endTime: 9, fps: PERSON_REMOVAL_FPS, extra: size } });
    expect(step("frame").request).toMatchObject({ modelId: "oss-extract-frame", op: "frame", params: { startTime: 0, extra: { frameIndex: 0 } } });
    expect(step("frame").chain).toEqual([{ slot: "video" }]);
    expect(step("clean").request).toMatchObject({ modelId: "oss-qwen-image-21", op: "edit", params: { seed: 7 }, step: { label: "A clean first frame (Qwen-Image 2.1)" } });
    expect(step("clean").request.prompt).toBe(cleanFramePrompt("Remove the man in the grey shirt"));
    expect(step("clean").request.prompt).toMatch(/^Remove the man in the grey shirt from the picture completely/);
    // The removal reads the fitted part and the clean frame; SAM 3.1 gets the person's words.
    expect(step("erase0").request).toMatchObject({ modelId: "oss-h3-person-remove", op: "remove-object", prompt: "the man in the grey shirt", feature: REMOVE.stepFeature, params: { seed: 7 } });
    expect(step("erase0").after).toEqual(["fit", "clean"]);
    expect(step("erase0").chain).toEqual([{ slot: "video" }, { slot: "images", position: "first" }]);
    // The graph's output is silent: the part's own sound goes back on.
    expect(step("sound").request).toMatchObject({ modelId: "oss-trim", params: { startTime: 2, endTime: 9 } });
    expect(step("final").request).toMatchObject({ modelId: "oss-mux", op: "mux", feature: REMOVE.feature });
    expect(p.final).toBe("final");
    expect(p.sound).toBe(true);
  });

  it("a silent clip: the removal is the result", () => {
    const p = planRemoval(input({ source: { ...src, hasAudio: false } }));
    expect(p.steps.map((s) => s.key)).toEqual(["fit", "frame", "clean", "erase0"]);
    expect(p.steps.at(-1)!.request).toMatchObject({ feature: REMOVE.feature, title: "Remove · the man in the grey shirt" });
    expect(p.final).toBe("erase0");
  });

  it("every step is a request the catalog accepts", () => {
    for (const s of planRemoval(input()).steps) {
      const chained: Record<string, unknown> = {};
      for (const c of s.chain ?? []) chained[c.slot] = c.slot === "images" ? ["/api/files/x.png"] : "/api/files/x.mp4";
      expect(() => planGeneration({ ...s.request, inputs: { ...s.request.inputs, ...chained } }, getModel, getPreset), s.key).not.toThrow();
    }
  });
});

describe("H3 person removal: the graph", () => {
  const clip: MediaInfo = { container: "mp4", hasVideo: true, hasAudio: false, duration: 7, videoDuration: 7, width: 1344, height: 736, fps: 24, frames: 168 };
  type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  const prepare = (over: Partial<GenInput>) =>
    prepareWorkflow(H3_REMOVAL_WORKFLOW, { video: "fit.mp4", images: ["clean.png"], ...over } as GenInput, { generationId: "g1", op: "remove-object", upload: async (_d, _t, name) => `up_${name}`, media: (n) => (n === "fit.mp4" ? clip : undefined) }).then(
      (r) => r.workflow as Graph,
    );
  const at = (wf: Graph, node: string, input: string) => wf[node]?.inputs[input];

  it("binds the fitted part, the clean first frame (fitted to the video's size), the person's words and the seed", async () => {
    const wf = await prepare({ prompt: "the man in the grey shirt", seed: 11 });
    expect(at(wf, "source", "file")).toBe("fit.mp4");
    expect(at(wf, "anchor", "image")).toBe("clean.png");
    expect(at(wf, "subject", "text")).toBe("the man in the grey shirt");
    expect(at(wf, "plan", "seed")).toBe(11);
    // The clean frame reaches the windows at the video's exact size.
    expect(wf.anchor_fit).toMatchObject({ class_type: "ImageScale", inputs: { image: ["anchor", 0], width: ["dimensions", 0], height: ["dimensions", 1], crop: "center" } });
    expect([at(wf, "window", "anchor"), at(wf, "review", "anchor")]).toEqual([
      ["anchor_fit", 0],
      ["anchor_fit", 0],
    ]);
    // Akatz's settings: the Person Remover LoRA at 1.0, 22-frame windows with 18 of history, 12 steps, mask grown 5 px.
    expect([at(wf, "adapter", "lora_name"), at(wf, "adapter", "strength_model")]).toEqual(["H3-Person-Remover-V1.safetensors", 1]);
    expect([at(wf, "plan", "window_frames"), at(wf, "plan", "history_frames"), at(wf, "schedule", "steps"), at(wf, "grow_mask", "expand")]).toEqual(["22", "18", 12, 5]);
    expect(wf.save.class_type).toBe("SaveVideo");
    await expect(prepare({ prompt: "" })).rejects.toThrow(/Say what to remove/);
  });

  it("the clean frame keeps the part's framing: Qwen-Image 2.1 follows image 1's shape, the relay centre-crops it back", async () => {
    // The planned clean step, bound into its graph with the frame the plan chains in.
    const clean = planRemoval(input()).steps.find((s) => s.key === "clean")!.request;
    const route = getModel(clean.modelId)!.routes.find((r) => r.op === clean.op)!;
    const bound = (await prepareWorkflow(route.endpoint, { prompt: clean.prompt, images: ["frame.png"], ...clean.params } as GenInput, {
      generationId: "g2",
      op: clean.op!,
      upload: async (_d, _t, name) => `up_${name}`,
      media: (n) => (n === "frame.png" ? { container: "image", width: 1344, height: 736, hasVideo: false, hasAudio: false } : undefined),
    })).workflow as Graph;
    // Image 1 is the frame, scaled to 2048 px on its long side, and the latent is made on its own shape (resolution 0):
    // nothing in the request sets a canvas of its own.
    expect(bound["10"]).toMatchObject({ class_type: "LoadImage", inputs: { image: "frame.png" } });
    expect(bound["20"]).toMatchObject({ class_type: "ImageScaleToMaxDimension", inputs: { image: ["10", 0], largest_size: 2048 } });
    expect(bound["30"]).toMatchObject({ class_type: "TextEncodeQwenImage21", inputs: { resolution: 0 } });
    // The relay fits the clean frame back to the part's exact size from its centre.
    const relay = await prepare({ prompt: "the man in the grey shirt" });
    expect(relay.anchor_fit).toMatchObject({ class_type: "ImageScale", inputs: { image: ["anchor", 0], width: ["dimensions", 0], height: ["dimensions", 1], crop: "center" } });
  });

  it("downloads the Person Remover LoRA before it runs", () => {
    expect(graphLoras(H3_REMOVAL_WORKFLOW, {})).toEqual([PERSON_REMOVER_LORA]);
    expect(PERSON_REMOVER_LORA.url).toBe("https://huggingface.co/akatz-ai/MiniMax-H3-Person-Remover-LoRA/resolve/fe136b3dc93aea993b9f194d48ea9859fdc2de14/H3-Person-Remover-V1.safetensors");
  });

  it("is in the library with its pinned files, its pack and its licence; not validated here (the pack isn't installed)", () => {
    expect(entry).toMatchObject({ capability: "remove-object", validated: false, vramGb: 24 });
    expect(entry.validationError).toMatch(/missing_node_type/);
    expect(entry.customNodes).toEqual([{ name: "h3-relay", repo: "https://github.com/akatz-ai/h3-relay/tree/e2a7665b6eb8ea37a88c0de2c9c6b69a8f7c9220" }]);
    expect(nodePack("h3-relay")?.licence.name).toBe("GPL-3.0");
    const lora = entry.models.find((m) => m.file === "H3-Person-Remover-V1.safetensors")!;
    expect(lora).toMatchObject({ folder: "loras", url: PERSON_REMOVER_LORA.url, sizeGb: 0.16 });
    expect(entry.models.map((m) => m.file)).toEqual(expect.arrayContaining(["minimax_h3_ref2va_pruned_int8_convrot.safetensors", "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "sam3.1_multiplex_fp16.safetensors"]));
    expect(licenceInfo(entry.license!)).toMatchObject({ name: "MiniMax H3 Community License", class: "regions", notices: ["MiniMax H3"] });
  });
});
