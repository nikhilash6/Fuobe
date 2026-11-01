import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getModel, getPreset, MODELS } from "@/lib/catalog";
import { loraEndpointFor } from "@/lib/catalog/loras";
import { buildPayload } from "@/lib/catalog/payload";
import { estimateCost, planGeneration, routesFor } from "@/lib/catalog/plan";
import { modelChoices } from "@/lib/catalog/canvas";
import { aiToolkitJob, falTrainingInput, familyOfModel, getTrainer, getTrainingTarget, TRAINING_FAMILIES } from "@/lib/catalog/training";
import type { GenerationRequest, GenInput, LoraRef, ModelRoute, Operation } from "@/lib/catalog/types";
import { PROMPT_HELPER_GRAPHS, skipPromptHelper, type ComfyWorkflow, type Manifest } from "@/lib/comfy";
import { filterModels, settingsShape, studioBest } from "@/lib/composer";
import { compileFlux3, flux3Boxes, flux3Caption, validateLayout, type LayoutDraft } from "@/lib/layout-prompt";
import { licenceInfo } from "@/lib/licences";
import { EDIT_STUDIO, IMAGE_STUDIO } from "@/lib/studios";

// Package nm10-flux3-klein (docs/research/new-models-10.md §6.3): FLUX 3 Image Klein on both engines. Three ComfyUI graphs from
// Comfy-Org's Klein templates on BFL's pinned repack, fal's routes and LoRA twins from research #10's endpoint records, a layout
// as fal's bounding_boxes, and a Soul ID training target on fal's Klein Base trainer and on AI-Toolkit's flux3 model.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-klein-"));
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const { setSetting } = await import("@/server/settings");
const { createGenerations, getGeneration } = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");
const { db } = await import("@/server/db");
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const dir = path.join(process.cwd(), "workflows/comfyui");
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;
const pins = JSON.parse(fs.readFileSync(path.join(dir, "model-pins.json"), "utf8")) as Record<string, { revision: string; sizeBytes: number }>;
const entry = (id: string) => manifest.workflows.find((w) => w.id === id)!;
const graph = (id: string) => JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8")) as ComfyWorkflow;

const REPO = "https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy/resolve/feef60b0aaf63a4773ace96636ebbcf43b881312";
/** The repack's sizes in bytes (the Hugging Face tree at feef60b0, read 2026-11-01). */
const SIZES: Record<string, number> = {
  "diffusion_models/flux3-image-klein-int8-convrot.safetensors": 5827874779,
  "diffusion_models/flux3-image-klein-nvfp4.safetensors": 5277685632,
  "diffusion_models/flux3-image-klein-bf16.safetensors": 11097404512,
  "diffusion_models/flux3-image-klein-base-int8-convrot.safetensors": 5807427339,
  "diffusion_models/flux3-image-klein-base-nvfp4.safetensors": 5257238192,
  "diffusion_models/flux3-image-klein-base-bf16.safetensors": 11076957072,
  "text_encoders/qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors": 6724090780,
};

async function prepare(id: string, input: GenInput, op: Operation, loras?: LoraRef[]) {
  const uploads: string[] = [];
  const res = await prepareWorkflow(id, { seed: 7, ...input, ...(loras && { loras }) }, {
    generationId: "g-klein",
    op,
    upload: async (_d, _t, name) => {
      uploads.push(name);
      return `up_${name}`;
    },
  });
  return { ...res, uploads };
}
const classes = (wf: ComfyWorkflow) => Object.values(wf).map((n) => n.class_type);

describe("FLUX 3 Image Klein's ComfyUI graphs", () => {
  it("are validated core-node graphs with the contract's bindings, limits and licence", () => {
    for (const id of ["flux3-klein-t2i", "flux3-klein-edit", "flux3-klein-base-t2i-lora"]) {
      const e = entry(id);
      expect(e, id).toMatchObject({ validated: true, customNodes: [], vramGb: 16, source: `hand-built (scripts/comfy/hand-built/${id}.json)` });
      expect(e.license, id).toMatch(/^FLUX Kommunity License v1\.0 .*not blanket permission for commercial fine-tuning/);
      expect(e.outputs, id).toEqual([{ node: "9", kind: "image" }]);
      // The prompt goes to the helper, the seed to the sampler and to the helper's sampling.
      expect(e.bindings.prompt, id).toEqual([{ node: "11", input: "prompt" }]);
      expect(e.bindings.seed, id).toEqual([
        { node: "7", input: "seed" },
        { node: "11", input: "sampling_mode.seed" },
      ]);
      expect(e.notes, id).toBeTruthy();
      expect(PROMPT_HELPER_GRAPHS.has(id), id).toBe(true);
    }
    expect(Object.keys(entry("flux3-klein-t2i").bindings).sort()).toEqual(["filenamePrefix", "height", "prompt", "seed", "steps", "unet", "width"]);
    expect(entry("flux3-klein-t2i").defaults).toEqual({ width: 1024, height: 1024, steps: 16, unet: "flux3-image-klein-int8-convrot.safetensors" });
    expect(entry("flux3-klein-t2i").limits).toEqual({ maxWidth: 4096, maxHeight: 4096, dimensionMultiple: 16 });
    // Klein Base: the card's 50 steps and CFG 3.5, the one LoRAs are trained on.
    expect(entry("flux3-klein-base-t2i-lora").defaults).toEqual({ width: 1024, height: 1024, steps: 50, cfg: 3.5, unet: "flux3-image-klein-base-int8-convrot.safetensors" });
    // The edit binds ten references, each on its own LoadImage, and follows reference 1's shape (no size bindings).
    const edit = entry("flux3-klein-edit");
    const refs = ["image", "image2", "image3", "image4", "image5", "image6", "image7", "image8", "image9", "image10"];
    expect(refs.map((k) => edit.bindings[k]?.[0])).toEqual(refs.map((_, i) => ({ node: String(20 + i), input: "image" })));
    for (const k of refs) expect(graph("flux3-klein-edit")[edit.bindings[k]![0].node].class_type).toBe("LoadImage");
    expect(edit.bindings.width).toBeUndefined();
    expect(edit.limits).toEqual({ maxImages: 10 });
  });

  it("runs the distilled model at 16 steps without guidance, Base at 50 with CFG 3.5, behind BFL's prompt helper", () => {
    const t2i = graph("flux3-klein-t2i");
    expect(t2i["7"].inputs).toMatchObject({ steps: 16, cfg: 1, sampler_name: "er_sde", scheduler: "simple" });
    expect(graph("flux3-klein-base-t2i-lora")["7"].inputs).toMatchObject({ steps: 50, cfg: 3.5, sampler_name: "euler" });
    expect(graph("flux3-klein-edit")["7"].inputs).toMatchObject({ steps: 16, cfg: 1, sampler_name: "euler" });
    for (const id of ["flux3-klein-t2i", "flux3-klein-edit", "flux3-klein-base-t2i-lora"]) {
      const g = graph(id);
      expect(g["10"].inputs, id).toEqual({ clip_name: "qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors", type: "flux3", device: "default" });
      expect(g["2"].inputs, id).toMatchObject({ clip_name: "qwen3vl_4b_int8_convrot.safetensors", type: "flux3" });
      expect(g["11"].class_type).toBe("TextGenerate");
      // The card's decoding: greedy (top_k 1), presence penalty 1.5 for text to image and 0 for edits.
      expect(g["11"].inputs).toMatchObject({ max_length: 3584, "sampling_mode.top_k": 1, "sampling_mode.top_p": 0.95, thinking: false });
      expect(g["11"].inputs["sampling_mode.presence_penalty"]).toBe(id === "flux3-klein-edit" ? 0 : 1.5);
      expect(g["4"].inputs.text, id).toEqual(["11", 0]);
      // BFL's system prompts (flux-3-image-klein-pup, Apache-2.0), with real line breaks.
      expect(String(g["12"].inputs.value)).toMatch(id === "flux3-klein-edit" ? /^You are the prompt upsampler of an image-editing model/ : /^You are the prompt upsampler of a text-to-image model/);
      expect(String(g["12"].inputs.value)).toContain("\n\n");
    }
    // The edit's references sit on one ReferenceMultiLatent (1 MP each) and on the batch the helper looks at.
    const e = graph("flux3-klein-edit");
    expect(e["30"].inputs).toMatchObject({ resolution: "resize", "resolution.megapixels": 1 });
    for (let i = 0; i < 10; i++) {
      expect(e["30"].inputs[`images.image${i}`]).toEqual([String(20 + i), 0]);
      expect(e["31"].inputs[`images.image${i}`]).toEqual([String(20 + i), 0]);
    }
    expect(e["11"].inputs.image).toEqual(["31", 0]);
  });

  it("pins BFL's gated repack at feef60b0 with its sizes; the shared encoder and VAE download without a token", () => {
    for (const id of ["flux3-klein-t2i", "flux3-klein-edit", "flux3-klein-base-t2i-lora"]) {
      const files = Object.fromEntries(entry(id).models.map((m) => [m.file, m]));
      expect(files["qwen3vl_4b_int8_convrot.safetensors"]).toMatchObject({ folder: "text_encoders", sizeGb: 4.86 });
      expect(files["qwen3vl_4b_int8_convrot.safetensors"].gated).toBeUndefined();
      expect(files["flux2-vae.safetensors"]).toMatchObject({ folder: "vae", sizeGb: 0.34 });
      expect(files["qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors"]).toMatchObject({ folder: "text_encoders", sizeGb: 6.72, gated: true });
    }
    const t2i = Object.fromEntries(entry("flux3-klein-t2i").models.map((m) => [m.file, m]));
    expect(t2i["flux3-image-klein-int8-convrot.safetensors"]).toMatchObject({ folder: "diffusion_models", sizeGb: 5.83, gated: true });
    expect(t2i["flux3-image-klein-nvfp4.safetensors"]).toMatchObject({ sizeGb: 5.28, gated: true, optional: true });
    expect(t2i["flux3-image-klein-bf16.safetensors"]).toMatchObject({ sizeGb: 11.1, gated: true, optional: true });
    const base = Object.fromEntries(entry("flux3-klein-base-t2i-lora").models.map((m) => [m.file, m]));
    expect(base["flux3-image-klein-base-int8-convrot.safetensors"]).toMatchObject({ sizeGb: 5.81, gated: true });
    for (const [file, bytes] of Object.entries(SIZES)) {
      expect(pins[`${REPO}/${file}`], file).toEqual({ revision: "feef60b0aaf63a4773ace96636ebbcf43b881312", sizeBytes: bytes });
    }
    // Every Klein file in the manifest points at the pinned revision.
    for (const id of ["flux3-klein-t2i", "flux3-klein-edit", "flux3-klein-base-t2i-lora"]) {
      for (const m of entry(id).models.filter((x) => x.file.includes("flux3"))) expect(m.url, m.file).toBe(`${REPO}/${m.folder}/${m.file}`);
    }
  });
});

describe("the provider fills Klein's graphs", () => {
  it("sends the words through the prompt helper by default", async () => {
    const { workflow: wf } = await prepare("flux3-klein-t2i", { prompt: "a fox in snow", extra: { width: 1536, height: 1024 } }, "t2i");
    expect(wf["11"].inputs.prompt).toBe("a fox in snow");
    expect(wf["11"].inputs["sampling_mode.seed"]).toBe(7);
    expect(wf["7"].inputs.seed).toBe(7);
    expect(wf["4"].inputs.text).toEqual(["11", 0]);
    expect(wf["6"].inputs).toMatchObject({ width: 1536, height: 1024 });
  });

  it("takes the helper out when it's off or a layout places boxes: the words reach the encoder as typed", async () => {
    const off = (await prepare("flux3-klein-t2i", { prompt: "a fox in snow", extra: { promptHelper: "off" } }, "t2i")).workflow;
    expect(off["4"].inputs.text).toBe("a fox in snow");
    expect(classes(off)).not.toContain("TextGenerate");
    expect(classes(off)).not.toContain("PrimitiveStringMultiline");
    expect(Object.values(off).some((n) => n.inputs.clip_name === "qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors")).toBe(false);
    const layout = compileFlux3(POSTER);
    const laid = (await prepare("flux3-klein-t2i", { prompt: layout, extra: { layout: POSTER } }, "t2i")).workflow;
    expect(laid["4"].inputs.text).toBe(layout);
    expect(classes(laid)).not.toContain("TextGenerate");
    // Layout mode with no boxes yet: the prompt is the caption alone, and the helper stays (as the control's label says).
    const empty = (await prepare("flux3-klein-t2i", { prompt: "A cozy reading nook", extra: { layout: { ...POSTER, items: [] } } }, "t2i")).workflow;
    expect(empty["4"].inputs.text).toEqual(["11", 0]);
    expect(empty["11"].inputs.prompt).toBe("A cozy reading nook");
    // The edit's helper goes with the batch of references it looked at; the references stay on the model.
    const edit = (await prepare("flux3-klein-edit", { prompt: "make it night", images: ["a.png"], extra: { promptHelper: "off" } }, "edit")).workflow;
    expect(classes(edit)).not.toContain("BatchImagesNode");
    expect(edit["30"].inputs["images.image0"]).toEqual(["20", 0]);
  });

  it("leaves out the references not given, from the last, on the model and on the helper's batch", async () => {
    const { workflow: wf } = await prepare("flux3-klein-edit", { prompt: "Put the cat of the second image on the sofa", images: ["a.png", "b.png", "c.png"] }, "edit");
    expect(Object.keys(wf["30"].inputs).filter((k) => k.startsWith("images.")).sort()).toEqual(["images.image0", "images.image1", "images.image2"]);
    expect(Object.keys(wf["31"].inputs).sort()).toEqual(["images.image0", "images.image1", "images.image2"]);
    for (const id of ["23", "24", "25", "26", "27", "28", "29"]) expect(wf[id], id).toBeUndefined();
    expect(wf["22"].inputs.image).toBe("c.png");
    const ten = (await prepare("flux3-klein-edit", { prompt: "a collage", images: Array.from({ length: 10 }, (_, i) => `r${i}.png`) }, "edit")).workflow;
    expect(Object.keys(ten["30"].inputs).filter((k) => k.startsWith("images."))).toHaveLength(10);
    expect(ten["29"].inputs.image).toBe("r9.png");
    await expect(prepare("flux3-klein-edit", { prompt: "x", images: [] }, "edit")).rejects.toThrow(/Add an image/);
  });

  it("loads your LoRAs after Klein Base's model loader", async () => {
    const { workflow: wf } = await prepare("flux3-klein-base-t2i-lora", { prompt: "photo of mayafz" }, "t2i", [{ file: "mayafz_flux3_klein.safetensors", strength: 0.9 }]);
    const lora = Object.entries(wf).find(([, n]) => n.class_type === "LoraLoaderModelOnly")!;
    expect(lora[1].inputs).toMatchObject({ model: ["1", 0], lora_name: "mayafz_flux3_klein.safetensors", strength_model: 0.9 });
    expect(wf["7"].inputs.model).toEqual([lora[0], 0]);
  });

  it("skipPromptHelper leaves a graph without a helper as it is", () => {
    const wf: ComfyWorkflow = { "1": { class_type: "CLIPTextEncode", inputs: { text: "plain", clip: ["2", 0] } }, "2": { class_type: "CLIPLoader", inputs: {} } };
    expect(skipPromptHelper(wf)).toBe(wf);
  });
});

const POSTER: LayoutDraft = {
  summary: { caption: "A cozy reading nook", meta: [], canvas: "single" },
  items: [
    { label: "object", caption: "a green armchair", box: [0.1, 0.4, 0.5, 0.95] },
    { label: "text", caption: "neon sign", text: "READ", box: [0.55, 0.1, 0.9, 0.3] },
  ],
};

describe("FLUX 3 Klein in the catalog, both engines", () => {
  const cloud = getModel("flux-3-klein")!;
  const base = getModel("flux-3-klein-base")!;
  const open = getModel("oss-flux3-klein")!;
  const openBase = getModel("oss-flux3-klein-base")!;

  it("runs on your GPU (text to image, edits with 10 references, Base with LoRAs) and on fal's hosted routes", () => {
    expect(open).toMatchObject({ engine: "open", kind: "image", vendor: "Black Forest Labs" });
    expect(open.routes.map((r) => [r.op, r.endpoint])).toEqual([
      ["t2i", "flux3-klein-t2i"],
      ["edit", "flux3-klein-edit"],
    ]);
    expect(open.options).toMatchObject({ maxImages: 10, layout: "flux3", resolutions: ["1K", "1.5K", "2K", "4K"] });
    expect(open.routes.find((r) => r.op === "edit")!.unsized).toBe(true);
    expect(open.options.controls).toEqual([
      { param: "promptHelper", label: "Prompt helper", values: ["on", "off"], default: "on", labels: expect.any(Object) },
    ]);
    expect(openBase.routes.map((r) => [r.op, r.endpoint])).toEqual([["t2i", "flux3-klein-base-t2i-lora"]]);
    expect(routesFor(cloud, "t2i").map((r) => [r.endpoint, r.loraEndpoint])).toEqual([["blackforestlabs/flux-3/klein/text-to-image", "blackforestlabs/flux-3/klein/text-to-image/lora"]]);
    expect(routesFor(cloud, "edit").map((r) => [r.endpoint, r.loraEndpoint])).toEqual([["blackforestlabs/flux-3/klein/edit-image", "blackforestlabs/flux-3/klein/edit-image/lora"]]);
    // Klein Base: fal's plain routes, and their /lora twins for a run with LoRAs.
    expect(base.routes.map((r) => [r.endpoint, r.loraEndpoint])).toEqual([
      ["blackforestlabs/flux-3/klein/base/text-to-image", "blackforestlabs/flux-3/klein/base/text-to-image/lora"],
      ["blackforestlabs/flux-3/klein/base/edit-image", "blackforestlabs/flux-3/klein/base/edit-image/lora"],
    ]);
    expect(cloud.options).toMatchObject({ maxImages: 10, maxOutputs: 4, layout: "flux3", resolutions: ["1K", "1.5K", "2K", "4K"] });
    // The licence is information: recorded, switched on, never a gate.
    expect(cloud.licence).toMatchObject({ licence: "FLUX Kommunity License v1.0", commercial: null });
    expect(cloud.licence!.note).toMatch(/not blanket permission for commercial fine-tuning/);
    expect(licenceInfo(entry("flux3-klein-t2i").license!)).toMatchObject({ name: "FLUX Kommunity License v1.0", class: "conditions" });
    for (const m of [cloud, base, open, openBase]) expect(m.hidden, m.id).toBeFalsy();
  });

  it("sits in the Image studio's Best list on your GPU, beside Ideogram 4 and Qwen-Image 2.1; the Edit studio offers it outside its Best list", () => {
    expect(IMAGE_STUDIO.defaultModels).toEqual({ cloud: "nano-banana-pro", open: "oss-ideogram-4" });
    expect(EDIT_STUDIO.defaultModels).toEqual({ cloud: "nano-banana-pro", open: "oss-qwen-image-21" });
    const image = studioBest(filterModels(MODELS, { kind: "image", ops: IMAGE_STUDIO.pickerOps }), "open", IMAGE_STUDIO.defaultModels.open, IMAGE_STUDIO.ops);
    expect(image.slice(0, 3)).toEqual(["oss-ideogram-4", "oss-qwen-image-21", "oss-flux3-klein"]);
    const editable = filterModels(MODELS, { kind: "image", ops: EDIT_STUDIO.ops });
    expect(editable.map((m) => m.id)).toContain("oss-flux3-klein");
    const edit = studioBest(editable, "open", EDIT_STUDIO.defaultModels.open, EDIT_STUDIO.ops);
    expect(edit).toEqual(["oss-qwen-image-21", "oss-qwen-image-21-turbo", "oss-fibo2-dev", "oss-fibo2-edit-turbo"]);
    expect(getModel("oss-flux3-klein")!.bestOps).toEqual(["t2i"]);
    // Ten references: the Image studio's refs, or the Edit studio's image and nine refs.
    expect(IMAGE_STUDIO.multiRef!.max).toBe(10);
    expect(1 + EDIT_STUDIO.multiRef!.max).toBe(10);
  });

  it("is a choice on the Canvas image node, on both engines", () => {
    const ids = modelChoices({ type: "model", data: { mediaKind: "image" } }).map((m) => m.id);
    for (const id of ["oss-flux3-klein", "oss-flux3-klein-base", "flux-3-klein", "flux-3-klein-base"]) expect(ids, id).toContain(id);
  });

  it("plans an edit with ten references on either engine; your GPU's graph refuses an eleventh rather than drop it", () => {
    const images = Array.from({ length: 10 }, (_, i) => `/api/files/r${i}.png`);
    for (const modelId of ["oss-flux3-klein", "flux-3-klein"]) {
      const p = planGeneration({ feature: "edit", modelId, prompt: "a collage", inputs: { images } } as GenerationRequest, getModel, getPreset);
      expect(p.op, modelId).toBe("edit");
    }
    const eleven = { feature: "edit", modelId: "oss-flux3-klein", prompt: "x", inputs: { images: [...images, "/api/files/r10.png"] } } as GenerationRequest;
    expect(() => planGeneration(eleven, getModel, getPreset)).toThrow(/up to 10 images/);
  });
});

describe("fal's FLUX 3 Klein payloads", () => {
  const cloud = getModel("flux-3-klein")!;
  const base = getModel("flux-3-klein-base")!;
  const t2i = (m = cloud) => m.routes.find((r) => r.op === "t2i") as ModelRoute & { map: NonNullable<ModelRoute["map"]> };
  const edit = (m = cloud) => m.routes.find((r) => r.op === "edit") as ModelRoute & { map: NonNullable<ModelRoute["map"]> };
  const plan = (req: Partial<GenerationRequest>) => planGeneration({ feature: "image", prompt: "a fox", ...req } as GenerationRequest, getModel, getPreset);
  const LORA: LoraRef = { file: "mayafz.safetensors", url: "https://v3.fal.media/files/mayafz.safetensors", strength: 0.8 };

  it("sends the size as image_size on the tier's square and keeps fal's prompt expansion for plain words", () => {
    const p = plan({ modelId: "flux-3-klein", params: { aspectRatio: "16:9", resolution: "2K", seed: 3 } });
    const body = buildPayload(t2i().map, { prompt: p.prompt, ...p.params });
    expect(body).toMatchObject({ prompt: "a fox", image_size: { width: 2736, height: 1536 }, seed: 3 });
    expect(body.enable_prompt_expansion).toBeUndefined();
    expect(body.bounding_boxes).toBeUndefined();
    expect(buildPayload(t2i().map, { prompt: "x", aspectRatio: "1:1", resolution: "4K" }).image_size).toEqual({ width: 4096, height: 4096 });
    // 4K at 16:9 is held at fal's 4096 a side.
    expect(buildPayload(t2i().map, { prompt: "x", aspectRatio: "16:9", resolution: "4K" }).image_size).toEqual({ width: 4096, height: 2304 });
  });

  it("goes to the /lora twin with up to 3 LoRAs of {path, scale 0-4}", () => {
    for (const r of [t2i(), edit()]) {
      expect(loraEndpointFor(r, [LORA])).toBe(`${r.endpoint}/lora`);
      expect(loraEndpointFor(r, [])).toBe(r.endpoint);
      expect(r.map.loras).toEqual({ shape: "items", key: "loras", max: 3, range: { min: 0, max: 4 } });
      const body = buildPayload(r.map, { prompt: "photo of mayafz", aspectRatio: "1:1", resolution: "1K", loras: [LORA], ...(r.op === "edit" && { images: ["https://x/a.png"] }) });
      expect(body.loras).toEqual([{ path: LORA.url, scale: 0.8 }]);
      expect(body.image_size).toEqual({ width: 1024, height: 1024 });
    }
    expect(buildPayload(edit().map, { prompt: "x", images: Array.from({ length: 10 }, (_, i) => `https://x/${i}.png`) }).image_urls).toHaveLength(10);
    // Klein Base: its plain routes without LoRAs, its /lora twins with them.
    for (const r of [t2i(base), edit(base)]) {
      expect(loraEndpointFor(r, [LORA])).toBe(`${r.endpoint}/lora`);
      expect(loraEndpointFor(r, [])).toBe(r.endpoint);
    }
    expect(buildPayload(t2i(base).map, { prompt: "photo of mayafz", loras: [LORA] }).loras).toEqual([{ path: LORA.url, scale: 0.8 }]);
  });

  it("puts a layout's boxes in bounding_boxes, the caption naming them, with prompt expansion off", () => {
    for (const [m, op] of [
      [cloud, "t2i"],
      [cloud, "edit"],
      [base, "t2i"],
      [base, "edit"],
    ] as const) {
      const p = plan({ modelId: m.id, op, prompt: "A cozy reading nook", params: { extra: { layout: POSTER } }, ...(op === "edit" && { inputs: { images: ["/api/files/a.png"] } }) });
      const route = op === "t2i" ? t2i(m) : edit(m);
      const body = buildPayload(route.map, { prompt: p.prompt, ...p.params, ...(op === "edit" && { images: ["https://x/a.png"] }) });
      expect(body.prompt, `${m.id} ${op}`).toBe(flux3Caption(POSTER));
      expect(body.prompt).toContain("<obj_1> a green armchair, <obj_2> the words \"READ\"");
      expect(String(body.prompt)).not.toContain("bbox");
      expect(body.bounding_boxes).toEqual(flux3Boxes(POSTER));
      expect(body.enable_prompt_expansion).toBe(false);
      expect(body.layout).toBeUndefined();
    }
    // The same boxes as the open engine's table (0-1000 grid, y before x), as fractions.
    expect(flux3Boxes(POSTER)).toEqual([
      { label: "obj_1", description: "a green armchair", box: { x_min: 0.1, y_min: 0.4, x_max: 0.5, y_max: 0.95 } },
      { label: "obj_2", description: 'neon sign "READ"', box: { x_min: 0.55, y_min: 0.1, x_max: 0.9, y_max: 0.3 } },
    ]);
    expect(compileFlux3(POSTER)).toBe(`${flux3Caption(POSTER)} [{"id": "obj_1", "bbox": [400, 100, 950, 500], "desc": "a green armchair"}, {"id": "obj_2", "bbox": [100, 550, 300, 900], "desc": "neon sign \\"READ\\""}]`);
    // On your GPU the compiled table is the prompt (the helper is taken out by the provider).
    const local = plan({ modelId: "oss-flux3-klein", prompt: "A cozy reading nook", params: { extra: { layout: POSTER } } });
    expect(local.prompt).toBe(compileFlux3(POSTER));
    expect(local.params.extra?.bounding_boxes).toBeUndefined();
  });

  it("checks fal's limits on boxes before the run", () => {
    const many: LayoutDraft = { ...POSTER, items: Array.from({ length: 33 }, (_, i) => ({ label: "object" as const, caption: `thing ${i}`, box: [0, 0, 0.1, 0.1] as [number, number, number, number] })) };
    expect(validateLayout(many, 1024, 1024, "flux3-boxes").map((x) => x.message)).toContain("FLUX 3 Klein takes up to 32 boxes (this layout has 33)");
    expect(() => plan({ modelId: "flux-3-klein", prompt: "x", params: { extra: { layout: many } } })).toThrow(/up to 32 boxes/);
    const long: LayoutDraft = { ...POSTER, items: [{ label: "object", caption: "x".repeat(501), box: [0, 0, 0.5, 0.5] }] };
    expect(() => plan({ modelId: "flux-3-klein", prompt: "x", params: { extra: { layout: long } } })).toThrow(/500 characters/);
    // Your GPU reads the table in the prompt: no such limit there.
    expect(() => plan({ modelId: "oss-flux3-klein", prompt: "x", params: { extra: { layout: many } } })).not.toThrow();
  });

  it("prices fal's planned per-image tiers, and $0.012 per megapixel with LoRAs (1024 and 2048 squares)", () => {
    expect(cloud.pricing).toMatchObject({ unit: "image", usd: 0.009, byResolution: { "1K": 0.009, "1.5K": 0.011, "2K": 0.014, "4K": 0.036 }, withLorasPerMegapixel: 0.012 });
    expect(estimateCost(cloud, { aspectRatio: "1:1", resolution: "1K" }, 1, "t2i")).toBe(0.009);
    expect(estimateCost(cloud, { aspectRatio: "1:1", resolution: "2K", numOutputs: 2 }, 1, "t2i")).toBe(0.028);
    expect(estimateCost(cloud, { aspectRatio: "1:1", resolution: "1K" }, 1, "t2i", true)).toBe(0.012);
    expect(estimateCost(cloud, { aspectRatio: "1:1", resolution: "2K" }, 1, "t2i", true)).toBe(0.048);
    expect(estimateCost(cloud, { aspectRatio: "1:1", resolution: "2K" }, 1, "edit", true)).toBe(0.048);
    // Klein Base: fal's planned per-image tiers on its plain routes ($0.027 at 1K … $0.108 at 4K), $0.035 per megapixel with LoRAs.
    expect(base.pricing).toMatchObject({ unit: "image", usd: 0.027, byResolution: { "1K": 0.027, "1.5K": 0.033, "2K": 0.042, "4K": 0.108 }, withLorasPerMegapixel: 0.035 });
    expect(estimateCost(base, { aspectRatio: "1:1", resolution: "1K" }, 1, "t2i")).toBe(0.027);
    expect(estimateCost(base, { aspectRatio: "1:1", resolution: "4K" }, 1, "t2i")).toBe(0.108);
    expect(estimateCost(base, { aspectRatio: "1:1", resolution: "1K" }, 1, "t2i", true)).toBe(0.035);
    expect(estimateCost(base, { aspectRatio: "1:1", resolution: "2K" }, 1, "t2i", true)).toBe(0.14);
    // Free on your GPU.
    expect(estimateCost(getModel("oss-flux3-klein")!, { aspectRatio: "1:1", resolution: "4K" }, 1, "t2i")).toBe(0);
  });
});

describe("FLUX 3 Klein as a Soul ID training target", () => {
  it("trains on fal's Klein Base trainer at $0.0043 a step, and on AI-Toolkit's flux3 model on your GPU", () => {
    const fal = getTrainingTarget("fal-flux3-klein")!;
    expect(fal).toMatchObject({ engine: "cloud", provider: "fal", family: "flux3-klein", trainer: "blackforestlabs/flux-3/klein/base/trainer", steps: 1000, costUsd: 4.3 });
    expect(fal.price).toBe("≈ $4.30 (1,000 steps)");
    expect(fal.licence).toMatch(/^FLUX Kommunity License v1\.0/);
    expect(fal.commercial).toBeNull();
    expect(fal.description).toMatch(/not blanket permission for commercial fine-tuning/);
    const tr = getTrainer(fal.trainer)!;
    expect(tr).toMatchObject({ usdPerStep: 0.0043, minBilledSteps: 100, dataField: "images_data_url", loraOutput: ["lora_file"], status: "active" });
    expect(falTrainingInput(fal, "https://x/data.zip", "photo of mayafz", "mayafz")).toEqual({
      images_data_url: "https://x/data.zip",
      steps: 1000,
      trigger_phrase: "mayafz",
      resolution: 1024,
    });
    // The edit trainer's price grows with the references per pair: no single rate is guessed.
    expect(getTrainer("blackforestlabs/flux-3/klein/base/trainer/edit")!.usdPerStep).toBeUndefined();
    const gpu = getTrainingTarget("aitk-flux3-klein")!;
    expect(gpu).toMatchObject({ engine: "open", provider: "ai-toolkit", family: "flux3-klein", costUsd: 0, price: "Free" });
    const job = aiToolkitJob({ name: "maya", trigger: "mayafz", datasetFolder: "/d", outputFolder: "/o", family: "flux3-klein" });
    const proc = job.config.process[0];
    expect(proc.model).toMatchObject({ name_or_path: "black-forest-labs/flux-3-image-klein-base", arch: "flux3", quantize: true, qtype: "convrot8" });
    expect(proc.train.timestep_type).toBe("shift");
    expect(proc.sample).toMatchObject({ guidance_scale: 3.5, sample_steps: 28 });
  });

  it("a FLUX 3 Klein LoRA runs on Klein Base first, and on the distilled Klein, on both engines", () => {
    expect(TRAINING_FAMILIES["flux3-klein"].lead).toEqual({ open: "oss-flux3-klein-base", cloud: "flux-3-klein-base" });
    for (const id of ["oss-flux3-klein-base", "oss-flux3-klein", "flux-3-klein-base", "flux-3-klein"]) expect(familyOfModel(id), id).toBe("flux3-klein");
  });
});

describe("fal's FLUX 3 Klein Prompt helper, as on your GPU", () => {
  const cloud = getModel("flux-3-klein")!;
  const base = getModel("flux-3-klein-base")!;
  const route = (m: typeof cloud, op: Operation) => m.routes.find((r) => r.op === op) as ModelRoute & { map: NonNullable<ModelRoute["map"]> };
  const plan = (req: Partial<GenerationRequest>) => planGeneration({ feature: "image", prompt: "a fox", ...req } as GenerationRequest, getModel, getPreset);

  it("offers the same Options → Prompt helper on both engines, saying a layout with boxes goes as typed", () => {
    for (const m of [cloud, base, getModel("oss-flux3-klein")!, getModel("oss-flux3-klein-base")!]) {
      const helper = m.options.controls?.find((c) => c.param === "promptHelper");
      expect(helper, m.id).toMatchObject({ label: "Prompt helper", values: ["on", "off"], default: "on" });
      expect(helper!.labels!.on, m.id).toMatch(/full caption \(not with layout boxes\)$/);
      expect(helper!.labels!.off).toBe("Off · your words as typed");
    }
  });

  it("sends enable_prompt_expansion false when it's off, and leaves fal's default (on) when it's on", () => {
    for (const m of [cloud, base]) {
      for (const op of ["t2i", "edit"] as const) {
        const images = op === "edit" ? { images: ["https://x/a.png"] } : {};
        const off = plan({ modelId: m.id, op, params: { extra: { promptHelper: "off" } }, ...(op === "edit" && { inputs: { images: ["/api/files/a.png"] } }) });
        const sent = buildPayload(route(m, op).map, { prompt: off.prompt, ...off.params, ...images });
        expect(sent.enable_prompt_expansion, `${m.id} ${op}`).toBe(false);
        expect(sent.promptHelper).toBeUndefined();
        const on = buildPayload(route(m, op).map, { prompt: "a fox", extra: { promptHelper: "on" }, ...images });
        expect(on.enable_prompt_expansion).toBeUndefined();
        expect(on.promptHelper).toBeUndefined();
      }
    }
  });

  it("is overridden in Layout mode only once the draft places a box", () => {
    const empty = plan({ modelId: "flux-3-klein", prompt: "A cozy reading nook", params: { extra: { layout: { ...POSTER, items: [] }, promptHelper: "on" } } });
    const sent = buildPayload(route(cloud, "t2i").map, { prompt: empty.prompt, ...empty.params });
    expect(sent.prompt).toBe("A cozy reading nook");
    expect(sent.enable_prompt_expansion).toBeUndefined();
    expect(sent.bounding_boxes).toBeUndefined();
    const boxed = plan({ modelId: "flux-3-klein", prompt: "A cozy reading nook", params: { extra: { layout: POSTER, promptHelper: "on" } } });
    expect(buildPayload(route(cloud, "t2i").map, { prompt: boxed.prompt, ...boxed.params }).enable_prompt_expansion).toBe(false);
    // Other models' prompt expansion still goes off for any layout (their compiled prompt is the layout's, boxes or not).
    const flux3 = getModel("flux-3")!.routes.find((r) => r.op === "t2i")!;
    expect(buildPayload(flux3.map!, { prompt: "x", extra: { layout: { ...POSTER, items: [] } } }).enable_prompt_expansion).toBe(false);
  });
});

/** A PNG's first bytes, enough for its size to be read. */
function pngHeader(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b[24] = 8;
  b[25] = 2;
  return b;
}

/** What a run handed its provider (the demo provider records the input it was given). */
async function handedOver(id: string): Promise<GenInput> {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    const row = db().prepare("SELECT provider_input_json, status, error FROM generations WHERE id = ?").get(id) as { provider_input_json: string | null; status: string; error: string | null };
    if (row.provider_input_json) return JSON.parse(row.provider_input_json);
    if (row.status === "failed") throw new Error(row.error ?? "failed");
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`${getGeneration(id)?.status}: nothing handed over`);
}

describe("fal's FLUX 3 Klein edit keeps image 1's shape, as your GPU's edit does", () => {
  const cloud = getModel("flux-3-klein")!;
  const edit = (m = cloud) => m.routes.find((r) => r.op === "edit") as ModelRoute & { map: NonNullable<ModelRoute["map"]> };
  const upload = (w: number, h: number) => saveFile({ data: pngHeader(w, h), contentType: "image/png", name: `p-${w}x${h}.png`, source: "upload" }).url;

  it("sends image 1's shape on the chosen tier's square as image_size, not the default 1:1", async () => {
    setSetting("demoMode", "auto");
    // Planned alone, the default aspect ratio would square a 16:9 photo.
    const p = planGeneration({ feature: "edit", modelId: "flux-3-klein", prompt: "make it night", inputs: { images: ["/api/files/a.png"] } } as GenerationRequest, getModel, getPreset);
    expect(buildPayload(edit().map, { prompt: p.prompt, ...p.params, images: ["https://x/a.png"] }).image_size).toEqual({ width: 1024, height: 1024 });
    // A run sizes it from the photo: 1K by default, the tier picked otherwise, on fal's 16 px grid.
    const wide = upload(4000, 2250);
    const [run] = createGenerations({ feature: "edit", modelId: "flux-3-klein", prompt: "make it night", inputs: { images: [wide] } });
    const sent = await handedOver(run.id);
    expect(sent.extra).toMatchObject({ image_size: { width: 1360, height: 768 } });
    expect(buildPayload(edit().map, { ...sent, images: ["https://x/a.png"] }).image_size).toEqual({ width: 1360, height: 768 });
    const [tall] = createGenerations({ feature: "edit", modelId: "flux-3-klein-base", prompt: "make it night", params: { resolution: "2K" }, inputs: { images: [upload(3000, 4000)] } });
    expect((await handedOver(tall.id)).extra).toMatchObject({ image_size: { width: 1776, height: 2368 } });
    // A size the request gives itself wins; text to image keeps the aspect ratio's.
    const [own] = createGenerations({ feature: "edit", modelId: "flux-3-klein", prompt: "x", params: { extra: { image_size: { width: 512, height: 512 } } }, inputs: { images: [wide] } });
    expect((await handedOver(own.id)).extra).toMatchObject({ image_size: { width: 512, height: 512 } });
    const [t2i] = createGenerations({ feature: "image", modelId: "flux-3-klein", prompt: "a fox", params: { aspectRatio: "16:9" } });
    expect((await handedOver(t2i.id)).extra?.image_size).toBeUndefined();
    // The tier's price stays; with LoRAs, the megapixels of the size sent.
    expect(estimateCost(cloud, { resolution: "1K", extra: { image_size: { width: 1360, height: 768 } } }, 1, "edit")).toBe(0.009);
    expect(estimateCost(cloud, { resolution: "1K", extra: { image_size: { width: 1360, height: 768 } } }, 1, "edit", true)).toBeCloseTo(0.012 * ((1360 * 768) / 1024 ** 2), 4);
  });

  it("offers Resolution but no Aspect ratio for the edit, as for text to image it offers both", () => {
    for (const m of [cloud, getModel("flux-3-klein-base")!]) {
      expect(edit(m).followsImage, m.id).toBe(true);
      expect(settingsShape(m, "edit", "image", true)).toMatchObject({ aspect: null, resolution: ["1K", "1.5K", "2K", "4K"] });
      expect(settingsShape(m, "t2i", "image", true).aspect).toContain("16:9");
    }
    // Your GPU's edit takes neither (it follows reference 1 at about 1 MP).
    expect(settingsShape(getModel("oss-flux3-klein")!, "edit", "image", true)).toMatchObject({ aspect: null, resolution: null });
  });
});
