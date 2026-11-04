import { describe, expect, it } from "vitest";
import type { ManifestWorkflow } from "@/lib/comfy";
import type { GenerationRequest } from "@/lib/catalog/types";
import type { LayerJobInput } from "@/lib/layers";
import type { MediaInfo } from "@/lib/media-probe";
import { tempDir } from "./helpers/temp-dir";

// The Layers tools' open-engine requests, bound into the real library graphs: extras bind by name and
// silently fall back to defaults when a name is wrong, so check the values land where they should.
const dir = tempDir("fuobe-layers-comfy-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { collectOutputs, getWorkflow, prepareWorkflow } = await import("@/server/providers/comfyui");
const { jobSteps } = await import("@/server/layers");
const { getModel } = await import("@/lib/catalog");


/** The request bound into its graph; `size` is what the server read of the picture it sent (its width and height). */
async function bind(req: GenerationRequest, size?: { width: number; height: number }) {
  const route = getModel(req.modelId)!.routes.find((r) => r.op === req.op)!;
  expect(route.provider).toBe("comfyui");
  const media = (name: unknown): MediaInfo | undefined => (size && name === req.inputs?.images?.[0] ? { container: "image", ...size, hasVideo: false, hasAudio: false } : undefined);
  const res = await prepareWorkflow(
    route.endpoint,
    { prompt: req.prompt, images: req.inputs?.images, ...(req.inputs?.mask ? { mask: req.inputs.mask } : {}), ...req.params },
    { generationId: "gen1", op: req.op!, upload: async (_d, _t, name) => `up_${name}`, media, serverRam: async () => undefined },
  );
  const wf = res.workflow as Record<string, { inputs: Record<string, unknown> }>;
  const m = res.manifest as ManifestWorkflow;
  return (key: string) => (m.bindings[key] ?? []).map((t) => wf[t.node].inputs[t.input]);
}

const step = (i: Partial<LayerJobInput>) => jobSteps({ tool: "decompose", engine: "open", frame: [0, 0, 100, 100], image: "/api/files/a.png", ...i } as LayerJobInput)[0].request;

describe("Layers on the cloud engine", () => {
  it("Seedream gets its resolution tier, mode and instruction; Qwen hosted its layer count", async () => {
    const { buildPayload } = await import("@/lib/catalog/payload");
    const payload = (req: GenerationRequest) => {
      const route = getModel(req.modelId)!.routes.find((r) => r.op === req.op)!;
      return buildPayload(route.map!, { prompt: req.prompt, images: req.inputs?.images, ...req.params });
    };
    expect(payload(step({ engine: "cloud", settings: { resolution: "1.5K", mode: "fast", layers: 6 } }))).toEqual({
      image_url: "/api/files/a.png",
      image_size: "auto_1.5K",
      enhance_prompt_mode: "fast",
      prompt: "Separate the major elements into up to 6 layers. Return name and description in English.",
    });
    expect(payload(step({ engine: "cloud", modelId: "qwen-image-layered-cloud", settings: { layers: 5 } }))).toMatchObject({ image_url: "/api/files/a.png", num_layers: 5 });
  });
});

describe("Layers on the open engine", () => {
  it("decomposition: layer count, Fast steps and the resolution tier reach Qwen-Image-Layered", async () => {
    const at = await bind(step({ settings: { layers: 6, mode: "fast", resolution: "2K" } }));
    expect(at("numLayers")).toEqual([6]);
    expect(at("steps")).toEqual([10]);
    expect(at("maxSize")).toEqual([1024]);
    // (The runner uploads inputs before this; here the name passes through.)
    expect(at("image")).toEqual(["/api/files/a.png"]);
  });

  it("separate by name: Layered-Control gets the element and two layers", async () => {
    const at = await bind(step({ tool: "split", prompt: "the guitar" }));
    expect(at("prompt")).toEqual(["the guitar"]);
    expect(at("numLayers")).toEqual([2]);
  });

  it("expand: the padding reaches both of Qwen-Image 2.1's pad nodes, or FLUX Fill when picked", async () => {
    const pads = { pads: { left: 64, top: 0, right: 128, bottom: 8 } };
    const at = await bind(step({ tool: "expand", settings: pads }));
    expect([at("padLeft"), at("padTop"), at("padRight"), at("padBottom")]).toEqual([[64, 64], [0, 0], [128, 128], [8, 8]]);
    // The words only say what fills the margins: the graph keeps the picture itself.
    expect(at("prompt")).toEqual(["Continue the scene naturally beyond every edge with matching perspective, lighting, textures and grain."]);
    const fill = await bind(step({ tool: "expand", modelId: "oss-flux-fill", settings: pads }));
    expect([fill("padLeft"), fill("padTop"), fill("padRight"), fill("padBottom")]).toEqual([[64], [0], [128], [8]]);
  });

  it("relight and edit text: the instruction reaches the edit graphs", async () => {
    // Qwen-Image 2.1 Turbo in its own picture tags; the Relight LoRA graph (a choice) with the light alone.
    const relight = await bind(step({ tool: "relight", settings: { light: "Candlelight", direction: "Left" } }));
    expect(String(relight("prompt")[0])).toMatch(/^Relight <image1> with warm flickering candlelight coming from the left\. /);
    const lora = await bind(step({ tool: "relight", modelId: "oss-qwen-relight", settings: { light: "Candlelight", direction: "Left" } }));
    expect(String(lora("prompt")[0])).toContain("warm flickering candlelight, coming from the left");
    const text = await bind(step({ tool: "text-edit", settings: { rows: [{ from: "SALE", to: "OPEN" }] } }));
    expect(text("prompt")).toEqual(["Preserve the original design and change only the requested text. Change “SALE” to “OPEN”."]);
  });
});

describe("Inpaint and Enhancer on the open engine", () => {
  it("inpaint: the picture, its painted mask and the prompt reach Qwen-Image 2.1's inpaint graph", async () => {
    const req = step({ tool: "inpaint", prompt: "a vase of tulips", mask: "/api/files/m.png", sketch: "/api/files/s.png" });
    const at = await bind(req);
    expect(at("image")).toEqual(["/api/files/a.png"]);
    expect(at("mask")).toEqual(["/api/files/m.png"]);
    expect(String(at("prompt")[0])).toMatch(/^a vase of tulips\. Blend it into the surroundings/);
  });

  it("enhancer: a retouch reaches Qwen-Image 2.1, Detail the SeedVR2 upscaler", async () => {
    const skin = await bind(step({ tool: "enhance", settings: { look: "skin" } }));
    expect(String(skin("prompt")[0])).toMatch(/^Give the portrait a subtle natural retouch/);
    const detail = await bind(step({ tool: "enhance", settings: { look: "detail" } }));
    expect(detail("image")).toEqual(["/api/files/a.png"]);
    // 2×, not the graph's default 4×: SeedVR2's output multiplier, ESRGAN's resize after its fixed 4×.
    expect(detail("scale")).toEqual([2]);
    const esrgan = await bind(step({ tool: "enhance", modelId: "oss-upscale-image", settings: { look: "detail" } }));
    expect(esrgan("scale")).toEqual([0.5]);
  });

  it("upscale: SeedVR2's multiplier keeps the picture inside its graph's 4096 px", async () => {
    const up = step({ tool: "upscale" });
    expect(up).toMatchObject({ modelId: "oss-seedvr2-image", op: "upscale-image" });
    // The template's 4x while it fits: 1024 → 4096.
    expect((await bind(up, { width: 1024, height: 768 }))("scale")).toEqual([4]);
    // A 3000 × 2000 photo: 4096 / 3000, to the resize node's 0.01 step (4095 px), not 12000 px.
    expect((await bind(up, { width: 3000, height: 2000 }))("scale")).toEqual([1.36]);
    // The Enhancer's 2x on a 3000 px layer comes down the same way; a smaller ask stays as it is.
    expect((await bind(step({ tool: "enhance", settings: { look: "detail" } }), { width: 3000, height: 1000 }))("scale")).toEqual([1.36]);
    expect((await bind(step({ tool: "enhance", settings: { look: "detail" } }), { width: 1500, height: 1000 }))("scale")).toEqual([2]);
    // A picture already past it has no room to grow, and says which upscaler takes it.
    await expect(bind(up, { width: 5000, height: 3000 })).rejects.toThrow(/up to 4096 × 4096 px on your GPU, and this one is already 5000 × 3000: pick 4x ESRGAN/);
    // 4x ESRGAN is not capped here (its scale resizes after the model's own 4x).
    expect((await bind(step({ tool: "upscale", modelId: "oss-upscale-image" }), { width: 3000, height: 2000 }))("scale")).toEqual([1]);
  });
});

describe("Text detection on the open engine (ocr-lines-qwen35)", () => {
  const file = (filename: string) => ({ filename, subfolder: "fuobe", type: "output" });
  const done = (outputs: Record<string, Record<string, unknown>>) => ({ status: { status_str: "success", completed: true }, outputs });

  it("binds the picture to OvisOCR3 with the workflow's own instruction, checkpoint and size", async () => {
    const req = step({ tool: "text-detect" });
    expect(req).toMatchObject({ modelId: "oss-ocr-lines", op: "ocr", inputs: { images: ["/api/files/a.png"] } });
    const at = await bind(req);
    expect(at("image")).toEqual(["/api/files/a.png"]);
    expect(at("checkpoint")).toEqual(["ovisocr3_0.8b_bf16.safetensors"]);
    expect(at("maxSize")).toEqual([1280]);
    expect(at("maxTokens")).toEqual([2048]);
    expect(String(at("instruction")[0])).toMatch(/scaled to \[0, 1000\)/);
  });

  it("reads the answer into lines with 0–1 boxes, and folds the frame in as the size", () => {
    const outs = collectOutputs(
      done({
        "8": { text: ['{"width": 1280, "height": 960, "coords": "relative-1000"}'] },
        "5": { text: ['```json\n[{"bbox_2d": [62, 96, 594, 205], "text_content": "SUMMER SALE"}, {"bbox_2d": [700, 820, 940, 880], "text_content": "SAVE 30%"}]\n```'], files: [file("ocr_00001_.json")] },
      }),
      getWorkflow("ocr-lines-qwen35").manifest,
      "http://comfy.test:8188",
    );
    expect(outs).toHaveLength(1);
    expect(outs[0]).toMatchObject({
      kind: "text",
      contentType: "text/plain",
      text: "SUMMER SALE\nSAVE 30%",
      meta: {
        size: [1280, 960],
        lines: [
          { text: "SUMMER SALE", bbox: [0.062, 0.096, 0.532, 0.109] },
          { text: "SAVE 30%", bbox: [0.7, 0.82, 0.24, 0.06] },
        ],
      },
    });
    // The text travels as plain lines (like Florence-2's), not as the model's JSON file.
    expect(outs[0].url.startsWith("data:text/plain;base64,")).toBe(true);
  });

  it("keeps an answer that isn't a list as its words, with no lines", () => {
    const outs = collectOutputs(done({ "5": { text: ["Sorry, I can't read this."], files: [file("ocr_00002_.json")] } }), getWorkflow("ocr-lines-qwen35").manifest);
    expect(outs[0]).toMatchObject({ text: "Sorry, I can't read this.", meta: { lines: [], unreadable: true } });
  });
});
