import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { buildPayload, sizeValue } from "@/lib/catalog/payload";
import { controlSets, estimateCost, planGeneration, routesFor } from "@/lib/catalog/plan";
import type { GenerationRequest, ModelRoute } from "@/lib/catalog/types";
import { layoutCompilerFor, type LayoutDraft } from "@/lib/layout-prompt";

// N7-1 (docs/research/new-models-7.md §4.7): MOSS-Image on fal from research #7's endpointRecords, priced per megapixel, and
// on your GPU; the layout flag on the models that read layouts; the Settings → Models & licences rows.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-moss-"));
process.env.FUOBE_DATA_DIR = tmp;
const { modelLicence, accessList } = await import("@/server/model-access");
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

type Spec = { type?: string; values?: unknown[]; minimum?: number; maximum?: number; default?: unknown; desc?: string; maxItems?: number; itemSchema?: Record<string, Spec> };
type Record7 = { endpoint: string; provider: string; inputs: Record<string, Spec>; pricing: { usd: number | null; unit: string } };
const records = (JSON.parse(fs.readFileSync("docs/research/new-models-7.json", "utf8")) as { endpointRecords: Record7[] }).endpointRecords;
const BASE = records.find((r) => r.endpoint === "fal-ai/moss-image")!;
const LORA = records.find((r) => r.endpoint === "fal-ai/moss-image/lora")!;

const cloud = getModel("moss-image")!;
const open = getModel("oss-moss-image")!;
const route = cloud.routes[0] as ModelRoute & { map: NonNullable<ModelRoute["map"]> };
const poster: LayoutDraft = {
  summary: { caption: "A candle sale poster", meta: [], canvas: "single" },
  items: [{ label: "text", caption: "Bold serif.", text: "30% OFF", box: [0.1, 0.05, 0.9, 0.2] }],
};
const plan = (req: Partial<GenerationRequest>) => planGeneration({ feature: "image", op: "t2i", prompt: "a poster", ...req } as GenerationRequest, getModel, getPreset);
const payload = (params: GenerationRequest["params"] = {}, prompt = "a poster") => {
  const p = plan({ modelId: "moss-image", prompt, params });
  return buildPayload(route.map, { prompt: p.prompt, ...p.params });
};

describe("moss-image on fal", () => {
  it("is built from research #7's endpoint records: every field it sends is in fal's schema", () => {
    expect(cloud).toMatchObject({ engine: "cloud", kind: "image", vendor: "OpenMOSS", family: "moss", name: "MOSS-Image" });
    expect(routesFor(cloud, "t2i").map((r) => [r.provider, r.endpoint, r.loraEndpoint])).toEqual([["fal", "fal-ai/moss-image", "fal-ai/moss-image/lora"]]);
    const m = route.map;
    expect(m.size).toEqual({ key: "image_size", multiple: 16, min: 512, max: 2048 });
    expect(BASE.inputs.image_size.desc).toMatch(/multiples of 16 between 512 and 2048/);
    expect([m.negativePrompt, m.numOutputs, m.seed, m.promptExpansion]).toEqual(["negative_prompt", "num_images", "seed", "enable_prompt_expansion"]);
    for (const k of [m.negativePrompt, m.numOutputs, m.seed, m.promptExpansion, m.size!.key!, ...Object.keys(m.fixed ?? {})]) expect(BASE.inputs[k!], k).toBeDefined();
    expect(BASE.inputs.output_format.values).toContain(m.fixed!.output_format);
    expect(m.fixed).toEqual({ output_format: "png" });
    expect(BASE.inputs.num_images).toMatchObject({ minimum: 1, maximum: 4 });
    expect(cloud.options.maxOutputs).toBe(4);
    // Steps and guidance are fal's own fields, with fal's range and default; guidance (a float) moves in halves, so the
    // GPU's Standard CFG 2.5 can be asked for in the cloud too.
    expect(cloud.options.sliders).toEqual([
      { param: "num_inference_steps", label: "Steps", min: 1, max: 100, step: 1, default: 50 },
      { param: "guidance_scale", label: "Guidance", min: 0, max: 10, step: 0.5, default: 3 },
    ]);
    expect(BASE.inputs.guidance_scale.type).toBe("number");
    const guidance = cloud.options.sliders!.find((x) => x.param === "guidance_scale")!;
    for (const set of Object.values(open.options.controls!.find((c) => c.param === "quality")!.sets!)) {
      expect(Number.isInteger((Number(set.cfg) - guidance.min) / guidance.step), `cfg ${set.cfg}`).toBe(true);
    }
    expect(BASE.inputs.num_inference_steps).toMatchObject({ minimum: 1, maximum: 100, default: 50 });
    expect(BASE.inputs.guidance_scale).toMatchObject({ minimum: 0, maximum: 10, default: 3 });
    // LoRAs go through the /lora twin: up to 3 of {path, scale 0-4}.
    expect(m.loras).toEqual({ shape: "items", key: "loras", max: 3, range: { min: 0, max: 4 } });
    expect(LORA.inputs.loras).toMatchObject({ maxItems: 3, itemSchema: { scale: { minimum: 0, maximum: 4 } } });
  });

  it("sends image_size {width, height} on fal's 16-pixel grid, kept within 512-2048", () => {
    expect(payload({ aspectRatio: "1:1" }).image_size).toEqual({ width: 1024, height: 1024 });
    expect(payload({ aspectRatio: "16:9" }).image_size).toEqual({ width: 1360, height: 768 });
    expect(payload({ aspectRatio: "21:9" }).image_size).toEqual({ width: 1568, height: 672 });
    // A layout's canvas, asked for exactly: kept when it fits, else fitted to the grid and the limits.
    expect(payload({ extra: { image_size: { width: 1536, height: 1024 } } }).image_size).toEqual({ width: 1536, height: 1024 });
    expect(payload({ extra: { image_size: { width: 1000, height: 1000 } } }).image_size).toEqual({ width: 1008, height: 1008 });
    expect(payload({ extra: { image_size: { width: 4096, height: 4096 } } }).image_size).toEqual({ width: 2048, height: 2048 });
    expect(payload({ extra: { image_size: { width: 2400, height: 400 } } }).image_size).toEqual({ width: 2048, height: 512 });
    expect(payload({ extra: { image_size: { width: 320, height: 320 } } }).image_size).toEqual({ width: 512, height: 512 });
    for (const ar of ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9", "5:4", "4:5"]) {
      const { width, height } = payload({ aspectRatio: ar }).image_size as { width: number; height: number };
      expect([width % 16, height % 16], ar).toEqual([0, 0]);
      expect(Math.min(width, height), ar).toBeGreaterThanOrEqual(512);
      expect(Math.max(width, height), ar).toBeLessThanOrEqual(2048);
    }
    expect(payload().output_format).toBe("png");
  });

  it("turns fal's prompt expansion off for a layout, and leaves fal's default for plain words", () => {
    expect(BASE.inputs.enable_prompt_expansion).toMatchObject({ type: "boolean", default: true });
    const plain = payload({ aspectRatio: "1:1" });
    expect(plain).not.toHaveProperty("enable_prompt_expansion");
    const compiled = layoutCompilerFor(cloud)(poster, 1024, 1024);
    expect(compiled.format).toBe("moss");
    // The plan compiles the draft (N7-2): the prompt is its caption.
    const laid = payload({ aspectRatio: "1:1", extra: { layout: poster } }, poster.summary.caption);
    expect(laid.enable_prompt_expansion).toBe(false);
    expect(laid.prompt).toBe(compiled.prompt);
    expect(laid.image_size).toEqual({ width: 1024, height: 1024 });
    // The draft rides along for Reuse; it is never sent as a field.
    expect(laid).not.toHaveProperty("layout");
  });

  it("puts LoRAs in the /lora endpoint's loras field", () => {
    const out = buildPayload(route.map, { prompt: "a poster", loras: [{ file: "moss-style.safetensors", url: "https://example.com/moss-style.safetensors", strength: 5 }] });
    expect(out.loras).toEqual([{ path: "https://example.com/moss-style.safetensors", scale: 4 }]);
  });

  it("costs $0.05 per megapixel of fal's 1024 × 1024 megapixel; a LoRA run's price is unknown, never free", () => {
    expect(BASE.pricing).toMatchObject({ usd: 0.05, unit: "megapixel" });
    expect(cloud.pricing).toEqual({ unit: "megapixel", usd: 0.05, lorasUnknown: true });
    expect(estimateCost(cloud, { aspectRatio: "1:1" }, 1, "t2i")).toBe(0.05);
    expect(estimateCost(cloud, { extra: { image_size: { width: 1536, height: 1024 } } }, 1, "t2i")).toBe(0.075);
    expect(estimateCost(cloud, { aspectRatio: "1:1", numOutputs: 2 }, 1, "t2i")).toBe(0.1);
    expect(LORA.pricing).toMatchObject({ usd: null, unit: "unknown" });
    expect(estimateCost(cloud, { aspectRatio: "1:1" }, 1, "t2i", true)).toBeNull();
    // Other per-megapixel models keep their 1-megapixel estimate (no size field on their route).
    expect(estimateCost(getModel("flux-2-pro")!, { aspectRatio: "16:9" }, 1, "t2i")).toBe(0.03);
  });
});

describe("oss-moss-image on your GPU", () => {
  it("runs the core-node graph, free, with its size on the picker", () => {
    expect(open).toMatchObject({ engine: "open", kind: "image", vendor: "OpenMOSS", family: "moss" });
    expect(open.routes.map((r) => [r.op, r.provider, r.endpoint])).toEqual([["t2i", "comfyui", "moss-image-t2i"]]);
    expect(open.tagline).toMatch(/on your GPU, about 15 GB of files/);
    // The int8 Qwen3.5-9B, never the w4a8 build that faulted the driver.
    expect(open.routes[0].note).toContain("Qwen3.5-9B int8");
    expect(open.options).toMatchObject({ layout: "moss", seed: true, negativePrompt: true, resolutions: ["1K", "1.5K"] });
    expect(estimateCost(open, { aspectRatio: "1:1" })).toBe(0);
  });

  it("Quality stands for the sampler settings; a setting the request gives wins", () => {
    const at = (extra?: Record<string, unknown>) => plan({ modelId: "oss-moss-image", params: { aspectRatio: "1:1", ...(extra && { extra }) } }).params.extra;
    expect(at()).toEqual({ steps: 25, cfg: 2.5, sampler: "er_sde", scheduler: "simple" });
    expect(at({ quality: "quality" })).toEqual({ steps: 50, cfg: 3, sampler: "euler", scheduler: "simple" });
    expect(at({ quality: "fast" })).toEqual({ steps: 8, cfg: 1, sampler: "euler", scheduler: "simple", unet: "moss_image_sft_8stepdmd_int8_convrot.safetensors" });
    expect(at({ quality: "quality", steps: 60 })).toMatchObject({ steps: 60, cfg: 3 });
    // Base: MOSS-Image Base (the owner's image_moss_image_base_t2i) at the preview pipeline's settings.
    expect(at({ quality: "base" })).toEqual({ steps: 50, cfg: 3, sampler: "euler", scheduler: "simple", unet: "moss_image_base_int8_convrot.safetensors" });
    // A model without such a control is left alone.
    expect(controlSets(cloud, { extra: { num_inference_steps: 30 } })).toEqual({ extra: { num_inference_steps: 30 } });
  });
});

describe("the models that read layouts", () => {
  it("flags MOSS-Image on both engines, FLUX.3, Ideogram 4.5 and Bria FIBO 2", () => {
    expect(Object.fromEntries(["oss-moss-image", "moss-image", "flux-3", "ideogram-4-5", "bria-fibo-2", "nano-banana-pro"].map((id) => [id, getModel(id)!.options.layout ?? null]))).toEqual({
      "oss-moss-image": "moss",
      "moss-image": "moss",
      "flux-3": "flux3",
      "ideogram-4-5": "ideogram",
      "bria-fibo-2": "vgl",
      "nano-banana-pro": null,
    });
    // FLUX.3's and Ideogram's own prompt expansion is turned off for a layout too; Bria has none.
    expect(getModel("flux-3")!.routes.map((r) => r.map?.promptExpansion)).toEqual(["enable_prompt_expansion", "enable_prompt_expansion"]);
    expect(routesFor(getModel("ideogram-4-5")!, "t2i")[0].map?.promptExpansion).toBe("enable_prompt_expansion");
    expect(getModel("bria-fibo-2")!.routes.every((r) => !r.map?.promptExpansion)).toBe(true);
  });
});

describe("Settings → Models & licences", () => {
  it("shows the open weights' licence, and fal's route as a paid API with the host's catch", () => {
    const o = modelLicence(open);
    expect(o.licence).toMatchObject({ class: "commercial" });
    expect(o.licence.name).toMatch(/Apache-2\.0/);
    expect(o.packs).toEqual([]);
    const c = modelLicence(cloud);
    expect(c.licence).toMatchObject({ class: "paid-api", name: "Paid API · fal.ai" });
    // The weights and the host's catch are a line of their own (shown whole at 390 px), not the end of the paid-API note.
    expect(c.licence.note).not.toMatch(/Weights|safety checker/);
    expect(c.weights).toEqual({
      name: "Apache-2.0",
      class: "commercial",
      url: "https://spdx.org/licenses/Apache-2.0.html",
      note: "Apache-2.0 weights (OpenMOSS-Team/MOSS-Image-SFT); hosted under fal's terms. fal's safety checker returns a black image when it flags an output",
    });
    expect(o.weights).toBeUndefined();
  });

  it("names a hosted model's weights by their licence, its class from the research where the name doesn't say", () => {
    const w = (id: string) => modelLicence(getModel(id)!).weights;
    // Was "Weights: Weights are non-commercial; …" at the end of the paid-API note.
    expect(w("flux-1-dev-lora-cloud")).toMatchObject({ name: "FLUX.1 [dev] Non-Commercial License", class: "non-commercial" });
    expect(w("flux-2-klein-9b-lora-cloud")).toMatchObject({ class: "non-commercial" });
    expect(w("ltx-2-3-22b-cloud")).toMatchObject({ name: "LTX-2 Community License", class: "conditions" });
    // A closed model has no weights line; a Fuobe Original's open half names its licence as before.
    expect(w("nano-banana-pro")).toBeUndefined();
    expect(modelLicence(getModel("fuobe-soul")!).weights).toBeUndefined();
  });

  it("lists both, switched on", () => {
    const rows = accessList()
      .models.filter((m) => m.id === "oss-moss-image" || m.id === "moss-image")
      .map((r) => [r.id, r.on, r.offBy, r.engines])
      .sort();
    expect(rows).toEqual([
      ["moss-image", true, [], ["cloud"]],
      ["oss-moss-image", true, [], ["open"]],
    ]);
  });

  it("the size the price and the payload use is the same", () => {
    const size = route.map.size!;
    expect(sizeValue(size, "3:2")).toEqual(payload({ aspectRatio: "3:2" }).image_size);
  });
});
