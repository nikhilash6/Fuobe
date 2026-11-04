import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";
import type { GenInput } from "@/lib/catalog/types";
import type { ComfyWorkflow, ManifestWorkflow } from "@/lib/comfy";

// Restore Photo on your GPU: one pass of Qwen-Image 2.1 with AusBoss's Restore LoRA at about 2 MP (the same faces, on the
// picture's own frame), then SeedVR2 enlarges it 2x. Its choice of photo picks the instruction and the LoRA's strength.
const tmp = tempDir("fuobe-restore-");
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const { getModel, getPreset } = await import("@/lib/catalog");
const { planGeneration } = await import("@/lib/catalog/plan");
const { OWN_ROUTE_APPS, presetRoutes } = await import("@/lib/catalog/preset-recipe-routes");
const { licenceInfo, workflowLicence } = await import("@/lib/licences");
const { KNOWN_MODELS, SPEC } = await import("../scripts/comfy/library.spec.mjs");

const ID = "restore-qwen-image-21";
const APP = "app-restore-photo";
const LORA_URL = "https://huggingface.co/ausboss/Qwen-Image-2.1-Restore-LoRA/resolve/main/qwen-image-2.1-restore.safetensors";
const LIBRARY = path.join(process.cwd(), "workflows/comfyui");
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(LIBRARY, f), "utf8"));
const manifest = () => (read("manifest.json") as { workflows: ManifestWorkflow[] }).workflows.find((w) => w.id === ID)!;
const ofClass = (wf: ComfyWorkflow, cls: string) => Object.entries(wf).filter(([, n]) => n.class_type === cls);
const link = (v: unknown) => v as [string, number];

async function prepare(input: GenInput) {
  return prepareWorkflow(ID, { seed: 7, ...input }, {
    generationId: "g",
    op: "edit",
    upload: async (_d, _t, name) => `up_${name}`,
    media: () => undefined,
    serverRam: async () => undefined,
  });
}

const plan = (engine: "cloud" | "open", presetOptions?: Record<string, string>) => {
  const preset = getPreset(APP)!;
  const route = engine === "cloud" ? preset.cloud! : preset.open!;
  return planGeneration({ feature: `app:${APP}`, presetId: APP, modelId: route.modelId, inputs: { images: ["/api/files/print.png"] }, presetOptions }, getModel, getPreset);
};

describe("the restore graph in the library", () => {
  it("is the hand-built graph, unchanged, with its bindings, defaults and the six files it reads", () => {
    const m = manifest();
    expect(m).toBeDefined();
    expect(read(`${ID}.json`)).toEqual(JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts/comfy/hand-built", `${ID}.json`), "utf8")));
    expect(m.capability).toBe("edit");
    expect(m.validated, "checked against ComfyUI").toBe(true);
    expect(Object.keys(m.bindings).sort()).toEqual(["filenamePrefix", "image", "loraStrength", "prompt", "scale", "seed", "steps"]);
    expect(m.defaults).toEqual({ steps: 25, scale: 2, loraStrength: 1 });
    expect(m.customNodes).toEqual([]);
    expect(m.models.map((x) => `${x.folder}/${x.file}`).sort()).toEqual([
      "diffusion_models/qwen_image_2.1_int8_convrot.safetensors",
      "diffusion_models/seedvr2_7b_int8_convrot.safetensors",
      "loras/qwen-image-2.1-restore.safetensors",
      "text_encoders/qwen3vl_8b_int8_convrot.safetensors",
      "vae/qwen_image_2.1_vae_bf16.safetensors",
      "vae/seedvr2_ema_vae_fp16.safetensors",
    ]);
    // The spec and the manifest say the same thing.
    const spec = (SPEC as { id: string; bindings: Record<string, unknown>; license: string; notes: string }[]).find((s) => s.id === ID)!;
    for (const [k, v] of Object.entries(spec.bindings)) expect(m.bindings[k], k).toEqual(v);
    expect(m.license).toBe(spec.license);
    expect(m.notes).toBe(spec.notes);
  });

  it("pins the LoRA to the revision, size and SHA-256 that were read", () => {
    expect((KNOWN_MODELS as Record<string, { folder: string; url: string }>)["qwen-image-2.1-restore.safetensors"]).toEqual({ folder: "loras", url: LORA_URL });
    expect(read("model-pins.json")[LORA_URL]).toEqual({
      revision: "a223f1255f4738b89b36d79c44d61740d3b3546f",
      sizeBytes: 159436584,
      sha256: "65de4f6c2468071d5aa6ffbd82c76bfee7cc8ac28fe960e91bbca4a58f43c08c",
    });
    const req = read("requirements.json") as { workflows: Record<string, { files: string[]; packs: object }>; files: Record<string, { pinnedUrl: string }> };
    expect(req.workflows[ID].packs).toEqual({});
    expect(req.workflows[ID].files).toContain("loras/qwen-image-2.1-restore.safetensors");
    expect(req.files["loras/qwen-image-2.1-restore.safetensors"].pinnedUrl).toBe(LORA_URL.replace("/main/", "/a223f1255f4738b89b36d79c44d61740d3b3546f/"));
  });

  it("records the licence as non-commercial (Qwen Research, the LoRA under the same terms)", () => {
    expect(licenceInfo(workflowLicence(manifest()))).toMatchObject({ name: "Qwen Research License", class: "non-commercial" });
    expect(manifest().license).toMatch(/Restore LoRA by AusBoss under the same licence/);
  });
});

describe("the restore graph as Fuobe sends it", () => {
  it("one pass at about 2 MP with the LoRA before the cache, 25 steps at cfg 1, then SeedVR2 2x", async () => {
    const { workflow: wf, manifest: m } = await prepare({ prompt: "Restore the old photo.", images: ["print.png"], extra: { loraStrength: 0.5 } });
    // The photo, scaled to about 2 MP on the 32 grid, is image 1 of the encoder.
    const [encId, enc] = ofClass(wf, "TextEncodeQwenImage21")[0];
    expect(enc.inputs).toMatchObject({ prompt: "Restore the old photo.", negative_prompt: "", resolution: 0 });
    const scale = wf[link(enc.inputs["images.image_1"])[0]];
    expect(scale).toMatchObject({ class_type: "ImageScaleToTotalPixels", inputs: { megapixels: 2, resolution_steps: 32, upscale_method: "lanczos" } });
    expect(wf[link(scale.inputs.image)[0]].inputs.image).toBe("print.png");
    // The Restore LoRA sits between the model and the cache, at the strength asked for.
    const [, lora] = ofClass(wf, "LoraLoaderModelOnly")[0];
    expect(ofClass(wf, "LoraLoaderModelOnly")).toHaveLength(1);
    expect(lora.inputs).toMatchObject({ lora_name: "qwen-image-2.1-restore.safetensors", strength_model: 0.5 });
    expect(wf[link(lora.inputs.model)[0]].inputs.unet_name).toBe("qwen_image_2.1_int8_convrot.safetensors");
    const [cacheId, cache] = ofClass(wf, "QwenImage21Cache")[0];
    expect(wf[link(cache.inputs.model)[0]].class_type).toBe("LoraLoaderModelOnly");
    const restore = ofClass(wf, "KSampler").find(([, n]) => link(n.inputs.model)[0] === cacheId)![1];
    expect(restore.inputs).toMatchObject({ steps: 25, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1, seed: 7, latent_image: [encId, 2] });
    // SeedVR2 enlarges the restored picture (alpha dropped) twice, takes its colour from it, and that is what is saved.
    const [, resize] = ofClass(wf, "ResizeImageMaskNode")[0];
    expect(resize.inputs).toMatchObject({ resize_type: "scale by multiplier", "resize_type.multiplier": 2, scale_method: "lanczos" });
    expect(wf[link(resize.inputs.input)[0]].class_type).toBe("SplitImageWithAlpha");
    const saved = wf[link(wf[m.outputs[0].node].inputs.images)[0]];
    expect(saved).toMatchObject({ class_type: "SeedVR2PostProcessing", inputs: { color_correction_method: "lab" } });
    const seedvr = ofClass(wf, "KSampler").find(([, n]) => wf[link(n.inputs.model)[0]].inputs.unet_name === "seedvr2_7b_int8_convrot.safetensors")![1];
    expect(seedvr.inputs).toMatchObject({ steps: 1, seed: 7 });
    expect(wf[m.outputs[0].node].inputs.filename_prefix).toBe("fuobe/g");
  });

  it("runs the LoRA at 1.0 when nothing asks otherwise, and needs the photo", async () => {
    const { workflow: wf } = await prepare({ prompt: "Restore the photo.", images: ["p.png"] });
    expect(ofClass(wf, "LoraLoaderModelOnly")[0][1].inputs.strength_model).toBe(1);
    await expect(prepare({ prompt: "Restore the photo." })).rejects.toThrow();
  });
});

describe("the Restore Photo app", () => {
  it("runs its own route on your GPU, whatever its preview ran", () => {
    expect(OWN_ROUTE_APPS.has(APP)).toBe(true);
    const preset = getPreset(APP)!;
    expect(preset.open).toMatchObject({ modelId: "oss-qwen-image-21-restore", op: "edit" });
    expect(presetRoutes(preset, "open", (id) => !!getModel(id)).map((r) => r.modelId)).toEqual(["oss-qwen-image-21-restore"]);
    const model = getModel("oss-qwen-image-21-restore")!;
    expect(model).toMatchObject({ engine: "open", hidden: true, kind: "image" });
    expect(model.routes).toEqual([expect.objectContaining({ op: "edit", provider: "comfyui", endpoint: ID, unsized: true, maxImages: 1 })]);
    expect(preset.userPrompt).toBe("none");
  });

  it("asks only which kind of photo it is: three plain choices, an old print first", () => {
    const [opt] = getPreset(APP)!.options!;
    expect(getPreset(APP)!.options).toHaveLength(1);
    expect(opt.choices.map((c) => c.label)).toEqual(["Old print", "Soft or blurry", "Small or grainy"]);
    for (const c of opt.choices) expect(c.label.length, c.label).toBeLessThanOrEqual(16);
  });

  it.each([
    ["old-print", /^Restore the old photo: remove scratches, dust, fading and grain/, 1],
    ["soft-or-blurry", /^Restore the photo: remove blur, noise and compression artifacts/, 0.5],
    ["small-or-grainy", /^Restore the photo: remove blur, noise and compression artifacts/, 1],
  ] as const)("%s: the trained instruction alone, and the LoRA at the card's strength on your GPU", (choice, words, strength) => {
    const open = plan("open", { photo: choice });
    expect(open.model.id).toBe("oss-qwen-image-21-restore");
    expect(open.op).toBe("edit");
    expect(open.prompt).toMatch(words);
    expect(open.prompt).not.toMatch(/Scene:/);
    expect(open.params.extra?.loraStrength).toBe(strength);
    // The cloud runs the same words on its edit model, without a setting only the GPU graph reads.
    const cloud = plan("cloud", { photo: choice });
    expect(cloud.prompt).toBe(open.prompt);
    expect(cloud.params.extra?.loraStrength).toBeUndefined();
  });

  it("starts on an old print", () => {
    expect(plan("open").params.extra?.loraStrength).toBe(1);
    expect(plan("open").prompt).toMatch(/^Restore the old photo/);
  });

  it("says what it does in plain words, with no model names", () => {
    const p = getPreset(APP)!;
    for (const text of [p.name, p.description, p.parity ?? "", ...p.options!.flatMap((o) => [o.label, ...o.choices.map((c) => c.label)])]) {
      expect(text, text).not.toMatch(/qwen|lora|seedvr|ausboss|comfy|\bMP\b|megapixel/i);
    }
    expect(p.description).toMatch(/same faces/);
  });
});
