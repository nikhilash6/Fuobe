import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { GenInput, Operation } from "@/lib/catalog/types";
import type { ComfyWorkflow, Manifest } from "@/lib/comfy";

/**
 * Krea 2 on the open engine (the owner's SOTA image families, 2026-10-31): Realism and Turbo for text to image, the
 * General and Identity Edit V2 LoRAs, image to image at a strength, and Inpaint / Expand on Ostris' edit nodes. Each
 * graph follows the owner's workflow (scripts/comfy/library.spec.mjs notes); the person in Krea 2 Edit is optional.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-krea2-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { prepareWorkflow } = await import("@/server/providers/comfyui");
const { getModel, getPreset, MODELS } = await import("@/lib/catalog");
const { planGeneration } = await import("@/lib/catalog/plan");
const { computeDimensions, dropBranch } = await import("@/lib/comfy");
const { licenceTerms, NODE_PACKS, workflowLicence } = await import("@/lib/licences");
const { CUSTOM_NODE_REPOS, KNOWN_MODELS, PACK_CLASSES } = await import("../scripts/comfy/library.spec.mjs");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const LIBRARY = path.join(process.cwd(), "workflows/comfyui");
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(LIBRARY, f), "utf8"));
const manifest = read("manifest.json") as Manifest;
const entry = (id: string) => manifest.workflows.find((w) => w.id === id)!;
const handBuilt = (id: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts/comfy/hand-built", `${id}.json`), "utf8")) as ComfyWorkflow;

const ROUTES: Record<string, Partial<Record<Operation, string>>> = {
  "oss-krea2-realism": { t2i: "krea2-realism-t2i" },
  "oss-krea2-turbo": { t2i: "krea2-turbo-t2i" },
  "oss-krea2-edit": { edit: "krea2-edit-general" },
  "oss-krea2-identity-edit": { edit: "krea2-edit-identity" },
  "oss-krea2-i2i": { edit: "krea2-turbo-i2i" },
  "oss-krea2-inpaint": { inpaint: "krea2-inpaint", outpaint: "krea2-outpaint" },
};
const IDS = Object.values(ROUTES).flatMap((r) => Object.values(r)) as string[];

/** A photo's header size, as the server remembers it for an upload ("auto" keeps its shape). */
const SIZES: Record<string, { width: number; height: number }> = { "photo.png": { width: 1600, height: 1200 }, "tall.png": { width: 900, height: 1600 } };

async function prepare(id: string, input: GenInput, op: Operation): Promise<ComfyWorkflow> {
  const { workflow } = await prepareWorkflow(id, { seed: 7, ...input }, { generationId: "g", op, upload: async (_d, _t, name) => `up_${name}`, media: ((name: string) => SIZES[name]) as never });
  return workflow;
}
const plan = (r: Record<string, unknown>) => planGeneration({ feature: "image", ...r } as Parameters<typeof planGeneration>[0], getModel, getPreset);

describe("Krea 2 in the catalog", () => {
  it.each(Object.entries(ROUTES))("%s routes each operation to its workflow in the library", (id, ops) => {
    const m = getModel(id)!;
    expect(m, id).toBeDefined();
    expect(m).toMatchObject({ engine: "open", vendor: "Krea", family: "krea", kind: "image" });
    // Krea 2 Inpaint has no `new`: it stays out of Inpaint's Best list while its add-on isn't on the owner's ComfyUI.
    expect(m.badges).toEqual(expect.arrayContaining(id === "oss-krea2-inpaint" ? ["open"] : ["open", "new"]));
    // Taglines tell people what the GPU and the licence ask of them.
    expect(m.tagline).toMatch(/20 GB GPU/);
    expect(Object.fromEntries(m.routes.map((r) => [r.op, r.endpoint]))).toEqual(ops);
    for (const [op, wid] of Object.entries(ops)) {
      expect(m.routes.find((r) => r.op === op)!.provider).toBe("comfyui");
      expect(entry(wid!)?.capability, wid).toBe(op);
    }
  });

  it("lists Krea 2 ahead of the older open image models: text to image first, then the edits", () => {
    const at = (id: string) => MODELS.findIndex((m) => m.id === id);
    const order = ["oss-krea2-realism", "oss-krea2-turbo", "oss-krea2-edit", "oss-krea2-identity-edit", "oss-krea2-i2i", "oss-krea2-inpaint"].map(at);
    expect(order.every((n, i) => n >= 0 && (i === 0 || n > order[i - 1]))).toBe(true);
    for (const old of ["oss-z-image-turbo", "oss-qwen-edit", "oss-flux-fill"]) expect(order[order.length - 1]).toBeLessThan(at(old));
    expect(getModel("oss-krea2-realism")!.badges).toContain("top");
    expect(getModel("oss-krea2-edit")!.badges).toContain("top");
    expect(getModel("oss-krea2-turbo")!.badges).toContain("fast");
  });

  it("plans text to image, edits, inpaint and expand from what is attached, and asks for what's missing", () => {
    expect(plan({ modelId: "oss-krea2-realism", prompt: "a woman in a camel coat on a sunlit street" }).op).toBe("t2i");
    expect(plan({ modelId: "oss-krea2-turbo", prompt: "a lighthouse at dawn" }).op).toBe("t2i");
    for (const id of ["oss-krea2-edit", "oss-krea2-identity-edit", "oss-krea2-i2i"]) {
      expect(plan({ modelId: id, prompt: "relight it with warm sunset light", inputs: { images: ["/a.png"] } }).op, id).toBe("edit");
      expect(() => plan({ modelId: id, prompt: "relight it" }), id).toThrow("Add an image to edit");
    }
    expect(plan({ modelId: "oss-krea2-edit", prompt: "put this person at the cafe table", inputs: { images: ["/scene.png", "/person.png"] } }).op).toBe("edit");
    expect(plan({ modelId: "oss-krea2-inpaint", prompt: "a wooden boat", inputs: { images: ["/a.png"], mask: "/m.png" } }).op).toBe("inpaint");
    expect(() => plan({ modelId: "oss-krea2-inpaint", prompt: "a wooden boat", inputs: {} })).toThrow(/Add an image/);
    expect(plan({ modelId: "oss-krea2-inpaint", op: "outpaint", prompt: "the rest of the beach", inputs: { images: ["/a.png"] } }).op).toBe("outpaint");
  });

  it("shows the value each graph runs with on its sliders, and every slider is a binding", () => {
    for (const [id, ops] of Object.entries(ROUTES)) {
      for (const s of getModel(id)!.options.sliders ?? []) {
        for (const wid of Object.values(ops) as string[]) {
          const t = entry(wid).bindings[s.param]?.[0];
          expect(t, `${id} ${s.param} → ${wid}`).toBeDefined();
          expect(handBuilt(wid)[t!.node].inputs[t!.input], `${id} ${s.param}`).toBe(s.default);
        }
      }
    }
    expect(getModel("oss-krea2-realism")!.options.sliders).toEqual([expect.objectContaining({ param: "loraStrength", label: "Realism", default: 1 })]);
    expect(getModel("oss-krea2-i2i")!.options.sliders).toEqual([expect.objectContaining({ param: "strength", label: "Change", default: 0.6 })]);
  });
});

describe("Krea 2 graphs", () => {
  it("Realism: the owner's Turbo graph with the Realism V2 LoRA at 1.0, 6 steps, about 2 MP by default", async () => {
    const m = getModel("oss-krea2-realism")!;
    expect(m.defaults).toMatchObject({ aspectRatio: "1:1", resolution: "1.5K" });
    const wf = await prepare("krea2-realism-t2i", { prompt: "a woman in a camel coat", aspectRatio: "16:9", resolution: "1.5K" }, "t2i");
    expect(wf["6"].inputs.text).toBe("a woman in a camel coat");
    expect(wf["5"].inputs).toMatchObject({ ...computeDimensions("16:9", "1.5K", {}, 16) });
    expect(wf["5"].inputs).toMatchObject({ width: 2048, height: 1152 });
    expect(wf["3"].inputs).toMatchObject({ seed: 7, steps: 6, cfg: 1, sampler_name: "euler", scheduler: "simple", model: ["15", 0], negative: ["13", 0] });
    expect(wf["15"]).toMatchObject({ class_type: "LoraLoaderModelOnly", inputs: { lora_name: "Krea2-realism-V2.safetensors", strength_model: 1, model: ["10", 0] } });
    // The fp8 Krea 2 Turbo the owner's edit workflow loads (his PC has no int8 build of Comfy-Org's).
    expect(wf["10"].inputs.unet_name).toBe("krea2_turbo_fp8_scaled.safetensors");
    expect(wf["11"].inputs).toMatchObject({ clip_name: "qwen3vl_4b_fp8_scaled.safetensors", type: "krea2" });
    // The Realism slider reaches the LoRA.
    const softer = await prepare("krea2-realism-t2i", { prompt: "x", extra: { loraStrength: 0.7 } }, "t2i");
    expect(softer["15"].inputs.strength_model).toBe(0.7);
    // Krea's own prompt refiner is left out: Fuobe's Enhance does that.
    expect(Object.values(wf).map((n) => n.class_type)).not.toContain("TextGenerate");
  });

  it("Turbo: the owner's graph as saved, 8 steps, no LoRA", async () => {
    const wf = await prepare("krea2-turbo-t2i", { prompt: "a lighthouse at dawn", aspectRatio: "1:1", resolution: "1K" }, "t2i");
    expect(wf["5"].inputs).toMatchObject({ width: 1024, height: 1024 });
    expect(wf["3"].inputs).toMatchObject({ seed: 7, steps: 8, cfg: 1, sampler_name: "euler", scheduler: "simple", model: ["10", 0] });
    expect(Object.values(wf).some((n) => n.class_type === "LoraLoaderModelOnly")).toBe(false);
  });

  it("Edit: the photo and a person to put in it, grounded on both, at the photo's shape", async () => {
    const wf = await prepare("krea2-edit-general", { prompt: "Place this person at the cafe table, holding a coffee.", images: ["photo.png", "person.png"], aspectRatio: "auto", resolution: "1K" }, "edit");
    expect(wf["72"].inputs.image).toBe("photo.png");
    expect(wf["90"].inputs.image).toBe("person.png");
    expect(wf["84"].inputs).toMatchObject({ prompt: "Place this person at the cafe table, holding a coffee.", image: ["72", 0], image_b: ["90", 0], grounding_px: 768 });
    expect(wf["85"].inputs).toMatchObject({ prompt: "", image: ["72", 0], image_b: ["90", 0] });
    expect(wf["79"].inputs).toMatchObject({ source_latent: ["73", 0], source_latent_b: ["92", 0], source_image: ["72", 0], source_image_b: ["90", 0], target_latent: ["82", 0], ref_boost: 4, ref_boost_a: 1, fit_mode: "fit" });
    expect(wf["71"].inputs).toMatchObject({ lora_name: "krea2_general_edit_v2.safetensors", strength_model: 1 });
    // "auto" keeps the photo's 4:3 at about 1 MP, on the 16-pixel grid.
    expect(wf["82"].inputs).toMatchObject({ width: 1184, height: 880 });
    expect(wf["53"].inputs).toMatchObject({ seed: 7, steps: 8, cfg: 1, sampler_name: "euler", scheduler: "simple" });
    const tall = await prepare("krea2-edit-general", { prompt: "x", images: ["tall.png"], aspectRatio: "auto", resolution: "1K" }, "edit");
    expect((tall["82"].inputs.width as number) < (tall["82"].inputs.height as number)).toBe(true);
  });

  it("Edit without a second photo: the person's loader goes and the encoders run on the photo alone", async () => {
    for (const id of ["krea2-edit-general", "krea2-edit-identity"]) {
      const wf = await prepare(id, { prompt: "Relight the scene with warm golden hour sunlight.", images: ["photo.png"] }, "edit");
      expect(wf["90"], id).toBeUndefined();
      expect(wf["92"], id).toBeUndefined();
      expect(Object.keys(wf["79"].inputs), id).not.toEqual(expect.arrayContaining(["source_latent_b"]));
      expect(wf["79"].inputs.source_image_b, id).toBeUndefined();
      expect(wf["84"].inputs.image_b, id).toBeUndefined();
      expect(wf["85"].inputs.image_b, id).toBeUndefined();
      expect(wf["84"].inputs.image, id).toEqual(["72", 0]);
      // Nothing else points at the removed nodes.
      const links = Object.values(wf).flatMap((n) => Object.values(n.inputs).filter((v): v is [string, number] => Array.isArray(v)));
      for (const [from] of links) expect(wf[from], `${id}: link from ${from}`).toBeDefined();
    }
  });

  it("Identity Edit: the Identity V2 LoRA with a lighter likeness dial, the person aligned as trained", async () => {
    const wf = await prepare("krea2-edit-identity", { prompt: "Put her in a red raincoat on a rainy Tokyo street at night.", images: ["photo.png"] }, "edit");
    expect(wf["71"].inputs.lora_name).toBe("krea2_identity_edit_v2.safetensors");
    expect(wf["79"].inputs).toMatchObject({ ref_boost: 2, ref_position: "aligned (trained)" });
  });

  it("Image to image: the picture at about 2 MP, redrawn at the strength picked", async () => {
    const wf = await prepare("krea2-turbo-i2i", { prompt: "the same photo, golden hour", images: ["photo.png"] }, "edit");
    expect(wf["1"].inputs.image).toBe("photo.png");
    expect(wf["2"].inputs).toMatchObject({ megapixels: 2, resolution_steps: 16, image: ["1", 0] });
    expect(wf["16"].inputs.pixels).toEqual(["2", 0]);
    expect(wf["3"].inputs).toMatchObject({ denoise: 0.6, steps: 8, cfg: 1, seed: 7, latent_image: ["16", 0] });
    const light = await prepare("krea2-turbo-i2i", { prompt: "x", images: ["photo.png"], extra: { strength: 0.35 } }, "edit");
    expect(light["3"].inputs.denoise).toBe(0.35);
  });

  it("Inpaint: the masked area black (red channel, white = paint), then the inpaint LoRA with the KV cache on", async () => {
    const wf = await prepare("krea2-inpaint", { prompt: "a small wooden boat", images: ["photo.png"], mask: "mask.png" }, "inpaint");
    expect(wf["1"].inputs.image).toBe("photo.png");
    expect(wf["2"]).toMatchObject({ class_type: "LoadImageMask", inputs: { image: "mask.png", channel: "red" } });
    expect(wf["5"]).toMatchObject({ class_type: "ImageCompositeMasked", inputs: { destination: ["1", 0], source: ["4", 0], mask: ["2", 0] } });
    expect(wf["4"]).toMatchObject({ class_type: "EmptyImage", inputs: { color: 0, width: ["3", 0], height: ["3", 1] } });
    expect(wf["6"].inputs).toMatchObject({ image: ["5", 0], megapixels: 1, resolution_steps: 16 });
    expect(wf["20"]).toMatchObject({ class_type: "TextEncodeKrea2OstrisEdit", inputs: { prompt: "a small wooden boat", image1: ["6", 0], vae: ["12", 0] } });
    expect(wf["16"]).toMatchObject({ class_type: "Krea2OstrisEditModelPatch", inputs: { kv_cache: true, model: ["15", 0] } });
    expect(wf["15"].inputs).toMatchObject({ lora_name: "krea2_inpaint_edit.safetensors", strength_model: 1, model: ["10", 0] });
    expect(wf["22"].inputs).toMatchObject({ width: ["7", 0], height: ["7", 1] });
    expect(wf["23"].inputs).toMatchObject({ seed: 7, steps: 8, cfg: 1, sampler_name: "euler_ancestral", scheduler: "simple", negative: ["21", 0] });
    await expect(prepare("krea2-inpaint", { prompt: "a boat", images: ["photo.png"] }, "inpaint")).rejects.toThrow("Paint the area to change");
  });

  it("Expand: the canvas grown on black by the pads asked for, 256 px a side by default", async () => {
    const wf = await prepare("krea2-outpaint", { prompt: "the rest of the beach", images: ["photo.png"], extra: { padLeft: 128, padTop: 0, padRight: 128, padBottom: 64 } }, "outpaint");
    expect(wf["8"]).toMatchObject({ class_type: "ImagePadForOutpaint", inputs: { image: ["1", 0], left: 128, top: 0, right: 128, bottom: 64, feathering: 0 } });
    expect(wf["5"].inputs).toMatchObject({ destination: ["8", 0], source: ["4", 0], mask: ["8", 1] });
    expect(wf["3"].inputs.image).toEqual(["8", 0]);
    expect(entry("krea2-outpaint").defaults).toMatchObject({ padLeft: 256, padTop: 256, padRight: 256, padBottom: 256 });
    expect(entry("krea2-outpaint").limits).toMatchObject({ padMultiple: 8 });
  });
});

describe("optional references (encoders that take extra images as optional inputs)", () => {
  it("drops a left-out reference from Qwen-Image 2.1, FIBO 2 or Krea 2 encoders, and from nothing else", () => {
    const wf: ComfyWorkflow = {
      "1": { class_type: "LoadImage", inputs: { image: "a.png" } },
      "2": { class_type: "LoadImage", inputs: { image: "b.png" } },
      "3": { class_type: "ImageScaleToMaxDimension", inputs: { image: ["2", 0], upscale_method: "lanczos", largest_size: 2048 } },
      "4": { class_type: "TextEncodeQwenImage21", inputs: { prompt: "x", "images.image_1": ["1", 0], "images.image_2": ["3", 0] } },
      "9": { class_type: "SaveImage", inputs: { images: ["4", 0] } },
    };
    const into = new Set(["TextEncodeQwenImage21", "TextEncodeFibo2", "Krea2EditModelPatch", "Krea2EditGroundedEncode"]);
    const out = dropBranch(wf, "2", into, ["9"])!;
    expect(Object.keys(out).sort()).toEqual(["1", "4", "9"]);
    expect(out["4"].inputs).toEqual({ prompt: "x", "images.image_1": ["1", 0] });
    // A branch that ends anywhere else (an output, another encoder) is not the encoder's to drop.
    expect(dropBranch(wf, "2", new Set(["TextEncodeQwenImageEditPlus"]), ["9"])).toBeNull();
    expect(dropBranch(wf, "1", into, ["9"])).not.toBeNull();
    expect(dropBranch(wf, "2", "TextEncodeQwenImage21", ["9"])).toEqual(out);
  });

  it("keeps the old rules for other graphs: Qwen-Image-Edit 2511 repeats the photo for a reference left out", async () => {
    const wf = await prepare("qwen-image-edit-2511-multi", { prompt: "make it night", images: ["photo.png"] }, "edit");
    expect(wf["83"].inputs.image).toBe("photo.png");
  });
});

describe("Krea 2 files, packs and licences", () => {
  const pins = read("model-pins.json") as Record<string, { revision: string; sizeBytes: number; sha256?: string }>;
  const packs = read("packs.json") as Record<string, { repo: string; commit: string; registry: { id: string } | null }>;
  const requirements = read("requirements.json");

  it("pins every file of every Krea 2 graph to a revision, a size and a SHA-256 from Hugging Face", () => {
    for (const id of IDS) {
      for (const m of entry(id).models) {
        const pin = pins[m.url!];
        expect(pin, `${id} ${m.file}`).toBeDefined();
        expect(pin.revision, m.file).toMatch(/^[0-9a-f]{40}$/);
        expect(pin.sha256, m.file).toMatch(/^[0-9a-f]{64}$/);
        expect(new URL(m.url!).host).toBe("huggingface.co");
      }
    }
    expect(pins["https://huggingface.co/conradlocke/krea2-identity-edit/resolve/main/krea2_general_edit_v2.safetensors"]).toEqual({
      revision: "f33b26291c640e8ec50b0da420bfee3c9a660daa",
      sizeBytes: 1828285656,
      sha256: "fb5315477444c8df6dea2ad347a852bd90e97ab0f9109f4100a39714a7a09356",
    });
  });

  it("names the Krea 2 Turbo and text encoder files the ComfyUI may hold in another precision", () => {
    expect(KNOWN_MODELS["krea2_turbo_int8_convrot.safetensors"].variants).toEqual(["krea2_turbo_fp8_scaled.safetensors", "krea2_turbo_bf16.safetensors"]);
    // Every new Krea 2 graph loads the fp8 build, pinned to Comfy-Org's revision with the Hugging Face API's size and SHA-256.
    for (const id of ["krea2-realism-t2i", "krea2-turbo-t2i", "krea2-edit-general", "krea2-edit-identity", "krea2-turbo-i2i", "krea2-inpaint", "krea2-outpaint"]) {
      expect(entry(id).models.map((f) => f.file), id).toContain("krea2_turbo_fp8_scaled.safetensors");
      expect(entry(id).models.map((f) => f.file), id).not.toContain("krea2_turbo_int8_convrot.safetensors");
    }
    expect(pins[KNOWN_MODELS["krea2_turbo_fp8_scaled.safetensors"].url]).toEqual({
      revision: "1171f4dc7e325bf3734586942e737872506c73e1",
      sizeBytes: 13141730784,
      sha256: "eb4dd8c612cfd10f64f25b057e6e6bbcb5737c94a7372177e456dbf7579502f1",
    });
    expect(KNOWN_MODELS["qwen3vl_4b_fp8_scaled.safetensors"].variants).toEqual(["qwen3vl_4b_int8_convrot.safetensors", "qwen3vl_4b_bf16.safetensors"]);
  });

  it("needs the Krea 2 Identity Edit nodes for the edits, and Ostris' edit nodes for Inpaint and Expand", () => {
    for (const id of ["krea2-edit-general", "krea2-edit-identity"]) {
      expect(entry(id).customNodes.map((c) => c.name), id).toEqual(["comfyui-krea2edit"]);
      expect(requirements.workflows[id].packs, id).toEqual({ "comfyui-krea2edit": ["Krea2EditGroundedEncode", "Krea2EditModelPatch"] });
    }
    for (const id of ["krea2-inpaint", "krea2-outpaint"]) {
      expect(entry(id).customNodes.map((c) => c.name), id).toEqual(["ComfyUI-Krea2-Ostris-Edit"]);
      expect(requirements.workflows[id].packs, id).toEqual({ "ComfyUI-Krea2-Ostris-Edit": ["Krea2OstrisEditModelPatch", "TextEncodeKrea2OstrisEdit"] });
    }
    for (const id of ["krea2-realism-t2i", "krea2-turbo-t2i", "krea2-turbo-i2i"]) expect(entry(id).customNodes, id).toEqual([]);
    expect(packs["comfyui-krea2edit"]).toMatchObject({ repo: CUSTOM_NODE_REPOS["comfyui-krea2edit"], commit: "13ef60f20828949becada815d3cbc371eb5ccaab" });
    expect(packs["ComfyUI-Krea2-Ostris-Edit"]).toMatchObject({ repo: CUSTOM_NODE_REPOS["ComfyUI-Krea2-Ostris-Edit"], commit: "7756566160c4a1b24bb1bd9f0ff3ced1a83d7547", registry: { id: "comfyui-krea2-ostris-edit" } });
    expect(PACK_CLASSES["comfyui-krea2edit"].test("Krea2EditModelPatch")).toBe(true);
    expect(PACK_CLASSES["ComfyUI-Krea2-Ostris-Edit"].test("TextEncodeKrea2OstrisEdit")).toBe(true);
  });

  it("records the licences as information: the V2 edit LoRAs are non-commercial, the rest the Krea 2 Community License", () => {
    for (const id of ["krea2-edit-general", "krea2-edit-identity"]) expect(licenceTerms(workflowLicence(entry(id))).flags, id).toContain("non-commercial");
    for (const id of ["krea2-realism-t2i", "krea2-turbo-t2i", "krea2-turbo-i2i", "krea2-inpaint", "krea2-outpaint"]) {
      expect(licenceTerms(workflowLicence(entry(id))).flags, id).toEqual(["conditions"]);
    }
    expect(getModel("oss-krea2-edit")!.tagline).toMatch(/non-commercial/);
    expect(NODE_PACKS.find((p) => p.name === "comfyui-krea2edit")!.licence.name).toBe("Apache-2.0");
    expect(NODE_PACKS.find((p) => p.name === "ComfyUI-Krea2-Ostris-Edit")!.licence.name).toBe("MIT");
  });
});
