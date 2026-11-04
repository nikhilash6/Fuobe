import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APPS, MODELS, getModel } from "@/lib/catalog";
import { modelChoices } from "@/lib/catalog/canvas";
import type { Manifest } from "@/lib/comfy";
import { licenceTerms, workflowLicence } from "@/lib/licences";

/**
 * Idol 3D (docs/research/idol-9.md §5.5): the library entry, the graph (a copy of TripoSplat's with Idol's
 * files, its reference sampler, the core-node photo crop and the haze threshold), its licence notice and its name.
 */

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, "workflows", "comfyui", "manifest.json"), "utf8")) as Manifest;
const entry = manifest.workflows.find((w) => w.id === "image-to-splat-idol")!;
type Node = { class_type: string; inputs: Record<string, unknown> };
const graph = JSON.parse(fs.readFileSync(path.join(root, "workflows", "comfyui", "image-to-splat-idol.json"), "utf8")) as Record<string, Node>;
const tripo = JSON.parse(fs.readFileSync(path.join(root, "workflows", "comfyui", "image-to-splat-triposplat.json"), "utf8")) as Record<string, Node>;
const NYNXZ = "https://huggingface.co/nynxz/Idol/resolve/c718f2b1b95b353edd07d17e845719fc10880a44";

describe("image-to-splat-idol: the manifest entry", () => {
  it("is a splat on core nodes with Best's defaults, the photo crop off and 8 GB", () => {
    expect(entry).toMatchObject({ capability: "splat", customNodes: [], vramGb: 8, limits: { maxGaussians: 1048576 } });
    expect(entry.defaults).toMatchObject({ splatFormat: "spz", cutout: true, photoCrop: false, steps: 50, cfg: 4, numGaussians: 262144 });
    expect(Object.keys(entry.bindings).sort()).toEqual(["cfg", "cutout", "filenamePrefix", "image", "numGaussians", "orbitFrames", "photoCrop", "sampler", "seed", "splatFormat", "steps"]);
    expect(entry.bindings.sampler).toEqual([{ node: "88:6", input: "sampler_name" }]);
    expect(entry.bindings.photoCrop).toEqual([{ node: "88:104", input: "switch" }]);
    expect(entry.bindings.seed).toEqual([
      { node: "88:6", input: "seed" },
      { node: "88:55", input: "seed" },
    ]);
  });

  it("needs Idol's two pinned files and the three it shares with TripoSplat", () => {
    const models = Object.fromEntries(entry.models.map((m) => [m.file, m]));
    expect(Object.fromEntries(entry.models.map((m) => [m.file, m.sizeGb]))).toEqual({
      "idol_fp16.safetensors": 0.74,
      "idol_decoder_fp16.safetensors": 0.58,
      "dino_v3_vit_h.safetensors": 1.68,
      "flux2-vae.safetensors": 0.34,
      "birefnet.safetensors": 0.44,
    });
    expect(models["idol_fp16.safetensors"].url).toBe(`${NYNXZ}/diffusion_models/idol_fp16.safetensors`);
    expect(models["idol_decoder_fp16.safetensors"].url).toBe(`${NYNXZ}/vae/idol_decoder_fp16.safetensors`);
    const pins = JSON.parse(fs.readFileSync(path.join(root, "workflows", "comfyui", "model-pins.json"), "utf8")) as Record<string, { sizeBytes: number; sha256: string }>;
    expect(pins[`${NYNXZ}/diffusion_models/idol_fp16.safetensors`]).toMatchObject({ sizeBytes: 741107210, sha256: "cf452146f78e23a0d34be8f9f79bcde642b9a40ef493046c8e9d5f79096f6dd0" });
    expect(pins[`${NYNXZ}/vae/idol_decoder_fp16.safetensors`]).toMatchObject({ sizeBytes: 576148658, sha256: "c511d99eb668ec4b06d883cb6e43770bc35e3864e16e7058e8d6211ba5c509aa" });
  });

  it("is in the GPU check's index and validated", () => {
    const req = JSON.parse(fs.readFileSync(path.join(root, "workflows", "comfyui", "requirements.json"), "utf8")) as { workflows: Record<string, { files: string[]; packs: object }> };
    expect(req.workflows["image-to-splat-idol"].files).toEqual(["background_removal/birefnet.safetensors", "clip_vision/dino_v3_vit_h.safetensors", "diffusion_models/idol_fp16.safetensors", "vae/flux2-vae.safetensors", "vae/idol_decoder_fp16.safetensors"]);
    expect(req.workflows["image-to-splat-idol"].packs).toEqual({});
    const state = JSON.parse(fs.readFileSync(path.join(root, "scripts", "comfy", "validation-state.json"), "utf8")) as Record<string, { validated: boolean }>;
    expect(state["image-to-splat-idol"].validated).toBe(true);
  });
});

describe("image-to-splat-idol: the graph", () => {
  it("loads Idol's files and samples at its reference settings", () => {
    expect(graph["88:16"].inputs).toMatchObject({ unet_name: "idol_fp16.safetensors", weight_dtype: "default" });
    expect(graph["88:11"].inputs.vae_name).toBe("idol_decoder_fp16.safetensors");
    expect(graph["88:6"].inputs).toMatchObject({ steps: 50, cfg: 4, sampler_name: "euler", scheduler: "simple", denoise: 1 });
    expect(Object.values(graph).some((n) => n.class_type === "ModelSamplingSD3")).toBe(false);
  });

  it("drops the haze from the orbit video only", () => {
    expect(graph["75"].inputs.opacity_threshold).toBe(0.05);
    expect(graph["92"].inputs.splat).toEqual(["88:55", 0]);
  });

  it("crops a photo looser on core nodes, behind a switch that is off by default", () => {
    expect(graph["88:101"]).toMatchObject({ class_type: "ImageScale", inputs: { image: ["88:2", 0], upscale_method: "lanczos", width: 720, height: 720, crop: "disabled" } });
    expect(graph["88:102"]).toMatchObject({ class_type: "EmptyImage", inputs: { width: 1024, height: 1024, batch_size: 1, color: 0 } });
    expect(graph["88:103"]).toMatchObject({ class_type: "ImageCompositeMasked", inputs: { destination: ["88:102", 0], source: ["88:101", 0], x: 152, y: 152, resize_source: false } });
    expect(graph["88:104"]).toMatchObject({ class_type: "ComfySwitchNode", inputs: { switch: false, on_false: ["88:2", 0], on_true: ["88:103", 0] } });
    expect(graph["88:24"].inputs.image).toEqual(["88:104", 0]);
    // The object spans 720 / 1.2 = 600 px on the 1024 canvas, as Idol's "real" crop (1024 / 1.7 ≈ 602 px) does.
    expect(Math.round(720 / 1.2)).toBe(600);
    expect(152 * 2 + 720).toBe(1024);
  });

  it("keeps everything else as TripoSplat's graph has it", () => {
    const changed = new Set(["88:16", "88:11", "88:6", "75", "88:24", "88:101", "88:102", "88:103", "88:104"]);
    for (const [id, node] of Object.entries(tripo)) {
      expect(graph[id]?.class_type, id).toBe(node.class_type);
      if (!changed.has(id) && !["51", "42"].includes(id)) expect(graph[id].inputs, id).toEqual(node.inputs);
    }
    expect(Object.keys(graph).filter((id) => !tripo[id]).sort()).toEqual(["88:101", "88:102", "88:103", "88:104"]);
  });
});

describe("Idol 3D: licence, name and where it shows", () => {
  it("names Apache-2.0, the TripoSplat MIT attribution and the DINOv3 notice", () => {
    const text = workflowLicence(entry);
    expect(text).toMatch(/^Apache-2.0/);
    expect(text).toMatch(/TripoSplat architecture \(MIT/);
    expect(licenceTerms(text).notices).toEqual(["Built with DINOv3"]);
    // The same catches as TripoSplat's (the DINOv3 License's trade-control terms).
    const triposplat = manifest.workflows.find((w) => w.id === "image-to-splat-triposplat")!;
    expect(licenceTerms(text).flags).toEqual(licenceTerms(workflowLicence(triposplat)).flags);
  });

  it("is the only model or app called Idol 3D (one per engine), apart from the K-pop Idol app", () => {
    expect(MODELS.filter((m) => m.name === "Idol 3D").map((m) => [m.id, m.engine])).toEqual(
      expect.arrayContaining([
        ["oss-idol", "open"],
        ["idol-3d", "cloud"],
      ]),
    );
    expect(MODELS.filter((m) => m.name === "Idol 3D")).toHaveLength(2);
    expect(APPS.filter((a) => a.name === "Idol 3D")).toEqual([]);
    expect(APPS.some((a) => a.name === "Idol")).toBe(true);
  });

  it("is offered by a Canvas 3D model node, with its sliders", () => {
    const ids = modelChoices({ type: "model", data: { mediaKind: "model3d" } } as never).map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(["oss-idol", "idol-3d"]));
    expect(getModel("oss-idol")!.options?.sliders?.map((s) => s.param)).toEqual(["numGaussians", "steps"]);
  });
});
