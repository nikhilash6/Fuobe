import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { GenInput, Operation } from "@/lib/catalog/types";
import { injectLoras, type ComfyWorkflow } from "@/lib/comfy";

// Build plan O10: Fuobe Marketing Image and Fuobe Try-On on both engines, the try-on LoRA as an adapter with its
// licence and switch, the AI Influencer app on Fuobe Soul, and the product-shot graph inside Marketing Image.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-originals-marketing-"));
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { getModel, getPreset } = await import("@/lib/catalog");
const { onEngine, enginesOf } = await import("@/lib/catalog/engines");
const { planGeneration } = await import("@/lib/catalog/plan");
const { loraEndpointFor, loraFields, routeLoraField } = await import("@/lib/catalog/loras");
const { LORA_LIBRARY } = await import("@/lib/catalog/lora-library.generated");
const { AD_VISUAL_MODELS, adVisualModel, formatModels, FORMATS, MARKETING_IMAGE_MODEL, wordsOnTop } = await import("@/lib/catalog/marketing");
const { FASHION_MODELS, PHOTODUMP_MODELS, TRYON_MODEL } = await import("@/lib/catalog/packs");
const { CAST_LOOK } = await import("@/lib/catalog/soul-cards");
const { setSetting } = await import("@/server/settings");
const { previewGeneration, appEngine } = await import("@/server/generations");
const { changeAccess, accessList } = await import("@/server/model-access");
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const research = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs/research/fuobe-originals-recipes-5.json"), "utf8"));

setSetting("demoMode", "auto");
afterEach(() => changeAccess([{ kind: "reset" }]));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const TRYON_FILE = "tryon-klein-4b.safetensors";
const plan = (r: Parameters<typeof planGeneration>[0], engine: "cloud" | "open") =>
  planGeneration(r, (id) => (getModel(id) && enginesOf(getModel(id)!).length > 1 ? onEngine(getModel(id)!, engine) : getModel(id)), getPreset);

async function prepare(id: string, input: GenInput, op: Operation) {
  return prepareWorkflow(id, { seed: 7, ...input }, { generationId: "g", op, upload: async (_d, _t, name) => `up_${name}`, media: () => undefined, serverRam: async () => undefined });
}

describe("Fuobe Marketing Image", () => {
  const m = getModel(MARKETING_IMAGE_MODEL)!;

  it("runs Qwen-Image 2.1 on your GPU (edit with up to 4 references, text to image without a photo) and hosted Qwen-Image-Edit 2511", () => {
    expect(m).toMatchObject({ vendor: "Fuobe Original", engines: ["open", "cloud"], kind: "image" });
    const open = onEngine(m, "open");
    expect(open.routes.map((r) => [r.op, r.endpoint])).toEqual([
      ["edit", "qwen-image-21-edit"],
      ["t2i", "qwen-image-21-t2i"],
    ]);
    expect(open.options.maxImages).toBe(4);
    // Neither Qwen-Image 2.1 graph takes a negative prompt; the hosted half keeps one.
    expect(open.options.negativePrompt).toBe(false);
    expect(onEngine(m, "cloud").options.negativePrompt).toBe(true);
    const cloud = onEngine(m, "cloud");
    expect(cloud.routes.map((r) => [r.op, r.provider, r.endpoint, r.loraEndpoint])).toEqual([
      ["edit", "fal", "fal-ai/qwen-image-edit-2511", "fal-ai/qwen-image-edit-2511/lora"],
      ["edit", "replicate", "qwen/qwen-image-edit-2511", undefined],
      ["t2i", "fal", "fal-ai/qwen-image-2512", "fal-ai/qwen-image-2512/lora"],
    ]);
    expect(cloud.options.maxImages).toBe(10);
    expect(m.pricing).toMatchObject({ unit: "megapixel", usd: 0.03, withLoras: 0.035 });
    expect(m.licence).toMatchObject({ licence: "Apache-2.0", commercial: true });
    // Its research record says what it is and which partners stay choices.
    const studio = research.studios.find((s: { id: string }) => s.id === "marketing");
    expect(studio.original.model).toBe(MARKETING_IMAGE_MODEL);
    for (const id of studio.original.partners) expect(getModel(id), id).toBeDefined();
  });

  it("is the first model of every image format and of Ads Studio's pictures, partners after it", () => {
    for (const f of Object.values(FORMATS).filter((x) => x.pipeline === "image")) {
      for (const engine of ["cloud", "open"] as const) {
        for (const product of [true, false]) expect(formatModels(f, engine, { product, avatar: false })[0].id, `${f.id}/${engine}`).toBe(MARKETING_IMAGE_MODEL);
      }
    }
    expect(formatModels(FORMATS.ads, "cloud", { product: true, avatar: false }).map((c) => c.id)).toContain("gpt-image-2-5");
    // The Standalone recipe's graph has no hosted copy: the cloud's line says it stays on the GPU (the owner's 10-30 rule).
    expect(formatModels(FORMATS["product-standalone"], "cloud", { product: true, avatar: false })[0].note).toBe("Fuobe Original · Qwen-Image-Edit 2511, hosted · the cut-out and relight run on your GPU only");
    expect(formatModels(FORMATS["product-standalone"], "open", { product: true, avatar: false })[0].note).toBe("Fuobe Original · Qwen-Image 2.1 on your GPU");
    expect(AD_VISUAL_MODELS.cloud.map((c) => c.id)).toEqual([MARKETING_IMAGE_MODEL, "nano-banana-pro", "gpt-image-2-5"]);
    expect(adVisualModel("open", "nano-banana-pro")).toBe(MARKETING_IMAGE_MODEL);
    expect(adVisualModel("cloud", "gpt-image-2-5")).toBe("gpt-image-2-5");
    // Its words are set over the picture on both engines; a partner draws them.
    expect([wordsOnTop("cloud", MARKETING_IMAGE_MODEL), wordsOnTop("open", MARKETING_IMAGE_MODEL), wordsOnTop("cloud", "gpt-image-2-5")]).toEqual([true, true, false]);
  });

  it("runs a Standalone product shot of one photo on the product-shot graph on the user's GPU", async () => {
    const shot = await prepare("qwen-image-21-edit", { prompt: "on wet marble", images: ["product.png"], extra: { productShot: true } }, "edit");
    expect(shot.manifest.id).toBe("product-shot-qwen-edit-2509");
    expect(JSON.stringify(shot.workflow)).not.toContain("productShot");
    // Two photos (or no flag): the multi-reference edit.
    expect((await prepare("qwen-image-21-edit", { prompt: "x", images: ["a.png", "b.png"], extra: { productShot: true } }, "edit")).manifest.id).toBe("qwen-image-21-edit");
    expect((await prepare("qwen-image-21-edit", { prompt: "x", images: ["a.png"] }, "edit")).manifest.id).toBe("qwen-image-21-edit");
  });
});

describe("Fuobe Try-On and its LoRA", () => {
  const m = getModel(TRYON_MODEL)!;

  it("carries the try-on LoRA on both engines, pinned, with its licence as information", () => {
    expect(m).toMatchObject({ vendor: "Fuobe Original", engines: ["open", "cloud"] });
    expect(onEngine(m, "open").routes).toEqual([expect.objectContaining({ provider: "comfyui", op: "edit", endpoint: "tryon-flux2-klein-4b" })]);
    expect(onEngine(m, "cloud").routes).toEqual([expect.objectContaining({ provider: "fal", op: "edit", endpoint: "fal-ai/flux-2/klein/4b/edit", loraEndpoint: "fal-ai/flux-2/klein/4b/edit/lora" })]);
    const entry = LORA_LIBRARY.find((e) => e.file === TRYON_FILE)!;
    expect(entry).toMatchObject({ key: "tryon-klein-4b", group: "adapter", base: "flux2-klein-4b", trigger: "TRYON", download: "direct", licence: { commercial: true, hostedOk: true, name: "Apache-2.0" } });
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.url).toBe(`https://huggingface.co/xocialize/tryon-FLUX.2-klein-4B-lora/resolve/${entry.version}/${TRYON_FILE}`);
    expect(m.options.loras).toEqual([expect.objectContaining({ file: TRYON_FILE, url: entry.url, strength: 1, trigger: "TRYON" })]);
  });

  it("plans the LoRA and its trigger on every run, and the LoRA card's words when none are given", () => {
    for (const engine of ["cloud", "open"] as const) {
      const p = plan({ feature: "image", modelId: TRYON_MODEL, op: "edit", inputs: { images: ["/me.png", "/dress.png"] } }, engine);
      expect(p.prompt).toMatch(/^TRYON a full-body photo of a person\. Replace the outfit/);
      expect(p.loras.map((l) => l.file)).toEqual([TRYON_FILE]);
    }
    const worded = plan({ feature: "image", modelId: TRYON_MODEL, op: "edit", prompt: "a summer dress", inputs: { images: ["/me.png", "/dress.png"] } }, "cloud");
    expect(worded.prompt).toBe("TRYON a summer dress");
    expect(() => plan({ feature: "image", modelId: TRYON_MODEL, op: "edit", inputs: { images: ["/me.png"] } }, "cloud")).toThrow("Add a photo of the person, then the garment");
    // fal's klein edit takes the LoRA by URL on its /lora endpoint.
    const route = onEngine(m, "cloud").routes[0];
    const loras = m.options.loras!;
    expect(loraEndpointFor(route, loras)).toBe("fal-ai/flux-2/klein/4b/edit/lora");
    expect(loraFields(routeLoraField(route)!, loras)).toEqual({ loras: [{ path: loras[0].url, scale: 1 }] });
  });

  it("isn't loaded twice on the graph that loads it itself", async () => {
    const lora = m.options.loras!;
    const { workflow } = await prepare("tryon-flux2-klein-4b", { prompt: "TRYON a dress", images: ["me.png", "dress.png"], loras: lora }, "edit");
    expect(Object.values(workflow).filter((n) => /^LoraLoader/.test(n.class_type)).map((n) => n.inputs.lora_name)).toEqual([TRYON_FILE]);
    // Another LoRA still goes on after the loader.
    const wf: ComfyWorkflow = {
      "1": { class_type: "UNETLoader", inputs: { unet_name: "klein.safetensors" } },
      "2": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: TRYON_FILE, strength_model: 1 } },
      "3": { class_type: "KSampler", inputs: { model: ["2", 0] } },
    };
    const out = injectLoras(wf, [...lora, { file: "other.safetensors", strength: 0.5 }]);
    expect(Object.values(out).filter((n) => n.class_type === "LoraLoaderModelOnly").map((n) => n.inputs.lora_name).sort()).toEqual(["other.safetensors", TRYON_FILE]);
    expect(injectLoras(wf, lora)).toBe(wf);
  });

  it("previews the hosted try-on with its LoRA, and refuses it while Settings switches the LoRA off", () => {
    const req = { feature: "image", modelId: TRYON_MODEL, engine: "cloud" as const, op: "edit" as const, inputs: { images: ["/api/files/me.png", "/api/files/dress.png"] } };
    const p = previewGeneration(req);
    expect(p).toMatchObject({ engine: "cloud", route: { provider: "fal", endpoint: "fal-ai/flux-2/klein/4b/edit/lora" } });
    expect(p.loras.applied.map((l) => l.file)).toEqual([TRYON_FILE]);
    expect(p.prompt).toMatch(/^TRYON /);
    // The LoRA's row in Settings → Models & licences: its licence, and a switch.
    const row = accessList().loras.find((l) => l.file === TRYON_FILE)!;
    expect(row).toMatchObject({ group: "adapter", on: true, licence: { class: "commercial", name: "Apache-2.0" } });
    changeAccess([{ kind: "lora", id: TRYON_FILE, on: false }]);
    for (const engine of ["cloud", "open"] as const) {
      expect(() => previewGeneration({ ...req, engine })).toThrow(/Fuobe Try-On runs with the LoRA “Virtual Try-On for FLUX\.2 \[klein\] 4B \(xocialize\)”, which is switched off in Settings → Models & licences/);
    }
  });

  it("is Fashion Factory's outfit model on both engines, with Qwen-Image-Edit 2511 making the photoset in the cloud", () => {
    expect(FASHION_MODELS.outfit.open[0]).toBe(TRYON_MODEL);
    expect(FASHION_MODELS.outfit.cloud[0]).toBe(TRYON_MODEL);
    expect(FASHION_MODELS.photoset).toEqual({ cloud: ["qwen-image-edit-2511-cloud", "nano-banana-pro"], open: ["oss-qwen-image-21", "oss-krea2-identity-edit"] });
    expect(PHOTODUMP_MODELS.cloud).toEqual(["fuobe-soul", "qwen-image-edit-2511-cloud", "nano-banana-pro", "nano-banana-2-1", "seedream-5-pro"]);
  });
});

describe("the AI Influencer app on Fuobe Soul", () => {
  const app = getPreset("app-ai-influencer")!;

  it("draws the sheet on Fuobe Soul in the casting look in the cloud, on the Soul Cast graph on the user's GPU", () => {
    expect(app.cloud).toMatchObject({ modelId: "fuobe-soul", op: "t2i", look: CAST_LOOK, params: { aspectRatio: "16:9", resolution: "1080p" } });
    expect(app.open).toMatchObject({ modelId: "oss-zimage-soul-cast" });
    const p = plan({ feature: "app:app-ai-influencer", presetId: app.id, modelId: "fuobe-soul", engine: "cloud", prompt: "a surfer from Lisbon" }, "cloud");
    expect(p.soul?.look).toBe(CAST_LOOK);
    expect(p.prompt).toContain("A character sheet of an original character: a surfer from Lisbon");
    expect(p.params).toMatchObject({ aspectRatio: "16:9", resolution: "1080p" });
    // Fuobe Soul's own looks still go by their id.
    expect(plan({ feature: "image", modelId: "fuobe-soul", presetId: "v1-general", prompt: "a fox" }, "cloud").soul?.look).toBe("v1-general");
    expect(() => plan({ feature: "image", modelId: "fuobe-soul", presetId: "app-nope", prompt: "a fox" }, "cloud")).toThrow(/Unknown Soul look/);
  });

  it("runs on the engine whose route names the Original when the request names none", () => {
    expect(appEngine({ presetId: app.id }, getModel("fuobe-soul")!)).toBe("cloud");
    expect(appEngine({ presetId: app.id }, getModel("oss-zimage-soul-cast")!)).toBe("open");
    expect(appEngine({ presetId: "v1-general" }, getModel("fuobe-soul")!)).toBeUndefined();
    const p = previewGeneration({ feature: "app:app-ai-influencer", presetId: app.id, modelId: "fuobe-soul", prompt: "a surfer" });
    expect(p).toMatchObject({ engine: "cloud", demo: true });
  });
});

// ---------------------------------------------------------------------------
// After review (O10 fix): the studio's engine, the sheet's shape, the recipe LoRA, Fashion's fallbacks, the eval case.

const { planMarketing, estimatePlan, onPlanEngine } = await import("@/server/marketing");
const { planInfluencer, INFLUENCER_SOUL } = await import("@/lib/influencer");
const { buildPayload } = await import("@/lib/catalog/payload");
const { fashionModel, fashionOutfitRequest, fashionPhotosetRequests, getTemplate } = await import("@/lib/catalog/packs");
const { isOffered, offeredSummary } = await import("@/server/model-access");
const { previewFashion, previewSheet } = await import("@/server/photodump");

const PRODUCT = { id: "p1", brandId: null, name: "Maple Granola", sellingPoints: [], images: ["/api/files/product.png"], createdAt: 0, updatedAt: 0 };
/** fal connected and ComfyUI reachable or not: an Original that names no engine would run on whichever is ready first. */
function connected(comfy: boolean) {
  setSetting("falKey", "fal_test_key_123456");
  globalThis.__fuobeComfyReach = { ok: comfy, at: Date.now(), url: "http://127.0.0.1:9" };
  return () => {
    setSetting("falKey", "");
    globalThis.__fuobeComfyReach = undefined;
  };
}

describe("Marketing Studio runs Fuobe Marketing Image on the studio's engine", () => {
  it("names the engine on the image step, so the GPU run isn't billed on fal and the cloud run doesn't land on ComfyUI", () => {
    const open = planMarketing({ engine: "open", format: "product-standalone", templateId: "ps-ice-bath" }, { product: PRODUCT });
    const cloud = planMarketing({ engine: "cloud", format: "ads", templateId: "ad-hero-headline" }, { product: PRODUCT });
    expect(open.steps[0].request).toMatchObject({ modelId: MARKETING_IMAGE_MODEL, engine: "open", params: { extra: { productShot: true } } });
    expect(cloud.steps[0].request).toMatchObject({ modelId: MARKETING_IMAGE_MODEL, engine: "cloud" });
    // A partner model runs on its own engine: no engine named.
    expect(planMarketing({ engine: "cloud", format: "ads", templateId: "ad-hero-headline", modelId: "gpt-image-2-5" }, { product: PRODUCT }).steps[0].request.engine).toBeUndefined();

    // ComfyUI down, fal connected: the open run stays on the GPU side (free, a demo here), never fal's $0.03.
    let off = connected(false);
    try {
      const p = previewGeneration(open.steps[0].request);
      expect(p).toMatchObject({ engine: "open", costUsd: 0 });
      expect(estimatePlan(open).costUsd).toBe(0);
    } finally {
      off();
    }
    // ComfyUI up, fal connected: the cloud run goes to fal, without the GPU-only product-shot flag.
    off = connected(true);
    try {
      const p = previewGeneration(cloud.steps[0].request);
      expect(p).toMatchObject({ engine: "cloud", demo: false, route: { provider: "fal", endpoint: "fal-ai/qwen-image-edit-2511" } });
      expect(p.costUsd).toBeGreaterThan(0);
    } finally {
      off();
    }
  });

  it("pins every step of a plan that names no engine to the run's engine (estimates, launches, Run again, Assist)", () => {
    const base = planMarketing({ engine: "open", format: "poster", prompt: "Autumn" }, { product: null });
    const bare = { ...base.steps[0].request };
    delete bare.engine;
    const plan = { ...base, steps: [{ ...base.steps[0], request: bare }] };
    expect(onPlanEngine(plan).steps[0].request.engine).toBe("open");
    // A partner step, or one that already names its engine, is left as it is.
    expect(onPlanEngine(base)).toBe(base);
    const gpt = planMarketing({ engine: "cloud", format: "ads", templateId: "ad-hero-headline", modelId: "gpt-image-2-5" }, { product: PRODUCT });
    expect(onPlanEngine(gpt).steps[0].request.engine).toBeUndefined();
  });
});

describe("the AI Influencer sheet keeps its shape in the cloud", () => {
  const state = { tier: "normal" as const, picks: {}, locked: [] };

  it("asks hosted Qwen-Image-Edit for the input's shape, so fal and Replicate keep the 16:9 sheet's size", () => {
    const p = planInfluencer({ engine: "cloud", state, start: "face", photo: "/api/files/me.png" }, { has: () => true });
    const dress = p.steps.find((s) => s.key === "dress")!.request;
    expect(dress).toMatchObject({ modelId: INFLUENCER_SOUL.edit, params: { aspectRatio: "auto" } });
    const planned = plan({ ...dress, inputs: { images: ["/sheet.png", "/me.png"] } }, "cloud");
    const [fal, replicate] = getModel(INFLUENCER_SOUL.edit)!.routes;
    const input = { prompt: planned.prompt, images: ["/sheet.png", "/me.png"], ...planned.params };
    expect(buildPayload(fal.map!, input)).not.toHaveProperty("image_size");
    expect(buildPayload(replicate.map!, input)).not.toHaveProperty("aspect_ratio");
    // A shape asked for is still sent, and the model's own default stays square.
    expect(buildPayload(fal.map!, { ...input, aspectRatio: "16:9" })).toMatchObject({ image_size: "landscape_16_9" });
    expect(getModel(INFLUENCER_SOUL.edit)!.defaults).toMatchObject({ aspectRatio: "1:1" });
    expect(getModel(INFLUENCER_SOUL.edit)!.options.aspectRatios).toContain("auto");
    // On the GPU the graph keeps image 1's shape itself.
    expect(planInfluencer({ engine: "open", state, start: "face", photo: "/api/files/me.png" }, { has: () => true }).steps[1].request.params).toEqual({ numOutputs: 1 });
  });

  it("needs hosted Qwen-Image-Edit only when there is a face or clothing to put on the sheet", () => {
    const noEdit = { has: (id: string) => id !== INFLUENCER_SOUL.edit };
    const scratch = planInfluencer({ engine: "cloud", state, start: "scratch" }, noEdit);
    expect(scratch).toMatchObject({ modelId: "fuobe-soul", notes: [] });
    const face = planInfluencer({ engine: "cloud", state, start: "face", photo: "/api/files/me.png" }, noEdit);
    expect(face.modelId).toBe("nano-banana-pro");
    expect(face.notes[0]).toMatch(/Qwen-Image-Edit 2511 \(hosted\) is switched off/);
  });
});

describe("Fuobe Try-On's LoRA is never left out of a run", () => {
  const req = { feature: "image", modelId: TRYON_MODEL, engine: "cloud" as const, op: "edit" as const, inputs: { images: ["/api/files/me.png", "/api/files/dress.png"] } };
  const mine = (n: number) => Array.from({ length: n }, (_, i) => ({ file: `mine-${i}.safetensors`, url: `https://huggingface.co/me/l/resolve/main/mine-${i}.safetensors`, strength: 1 }));

  it("goes first, so fal's three-LoRA cap leaves out one of yours", () => {
    const p = previewGeneration({ ...req, loras: mine(3) });
    expect(p.loras.applied.map((l) => l.file)).toEqual([TRYON_FILE, "mine-0.safetensors", "mine-1.safetensors"]);
    expect(p.loras.dropped.map((d) => d.file)).toEqual(["mine-2.safetensors"]);
    expect(p.prompt).toMatch(/^TRYON /);
  });

  it("refuses a run whose route would leave it out (a copy named without a link can't reach fal)", () => {
    const off = connected(false);
    try {
      expect(() => previewGeneration({ ...req, loras: [{ file: TRYON_FILE, strength: 1 }] })).toThrow(/Fuobe Try-On runs with the LoRA “.*”, which this run leaves out \(.*only on your ComfyUI/);
      // With its link it goes, first.
      expect(previewGeneration({ ...req, loras: mine(3) }).loras.applied[0].file).toBe(TRYON_FILE);
    } finally {
      off();
    }
    // On the GPU the graph has it.
    expect(previewGeneration({ ...req, engine: "open", loras: [{ file: TRYON_FILE, strength: 1 }] }).engine).toBe("open");
  });
});

describe("Fashion Factory moves on when a model can't run", () => {
  const t = getTemplate("red-room")!;

  it("offers Qwen-Image 2.1 Turbo and Qwen-Image 2.1 after Fuobe Try-On on your GPU and takes the photoset's pick", () => {
    expect(FASHION_MODELS.outfit.open).toEqual([TRYON_MODEL, "oss-qwen-image-21-turbo", "oss-qwen-image-21"]);
    const qwen = fashionOutfitRequest(t, "/b.png", "/g.png", "open", "oss-qwen-image-21-turbo");
    expect(qwen).toMatchObject({ modelId: "oss-qwen-image-21-turbo", params: { aspectRatio: "3:4" } });
    expect(qwen.prompt).toMatch(/^Dress the person in image 1/);
    expect(fashionPhotosetRequests(t, "/d.png", "cloud", "nano-banana-pro")[0].modelId).toBe("nano-banana-pro");
    expect(fashionModel("photoset", "open", "nano-banana-pro")).toBe("oss-qwen-image-21");
    const set = previewFashion({ step: "photoset", templateId: t.id, dressed: "/api/files/d.png", engine: "cloud", modelId: "nano-banana-pro" });
    expect(set).toMatchObject({ modelId: "nano-banana-pro" });
  });

  it("drops Fuobe Try-On from the pickers and the defaults while its try-on LoRA is switched off", () => {
    expect(isOffered(TRYON_MODEL, "cloud")).toBe(true);
    changeAccess([{ kind: "lora", id: TRYON_FILE, on: false }]);
    expect(isOffered(TRYON_MODEL, "cloud")).toBe(false);
    expect(isOffered(TRYON_MODEL, "open")).toBe(false);
    expect(isOffered("oss-tryon-klein")).toBe(false);
    expect(offeredSummary()?.off).toEqual(expect.arrayContaining([TRYON_MODEL, "oss-tryon-klein"]));
    const base = { step: "outfit" as const, templateId: t.id, base: "/api/files/b.png", garment: "/api/files/g.png" };
    expect(previewFashion({ ...base, engine: "cloud" })).toMatchObject({ modelId: "fashn-tryon" });
    expect(previewFashion({ ...base, engine: "open" })).toMatchObject({ modelId: "oss-qwen-image-21-turbo" });
    // Picked anyway (the API): refused, naming the LoRA's switch.
    expect(previewFashion({ ...base, engine: "cloud", modelId: TRYON_MODEL })).toMatchObject({ error: expect.stringMatching(/switched off in Settings → Models & licences/) });
  });

  it("makes the photoset on Nano Banana Pro when hosted Qwen-Image-Edit is switched off", () => {
    changeAccess([{ kind: "model", id: "qwen-image-edit-2511-cloud", on: false }]);
    expect(previewFashion({ step: "photoset", templateId: t.id, dressed: "/api/files/d.png", engine: "cloud" })).toMatchObject({ modelId: "nano-banana-pro" });
  });
});

describe("the AI Influencer app and Character Sheet run the casting look on your GPU too", () => {
  it("puts the Realistic look's words and LoRAs on the Soul Cast sheet graph", () => {
    const app = getPreset("app-ai-influencer")!;
    expect(app.open).toMatchObject({ modelId: "oss-zimage-soul-cast", look: CAST_LOOK });
    const p = plan({ feature: "app:app-ai-influencer", presetId: app.id, modelId: "oss-zimage-soul-cast", prompt: "a surfer from Lisbon" }, "open");
    expect(p.prompt).toMatch(/^Realism, An original character: a surfer from Lisbon/);
    expect(p.loras.map((l) => l.file)).toEqual(["suayptalha-z-image-turbo-realism.safetensors", "AWPortrait-Z.safetensors"]);
    expect(p.soul).toBeUndefined();
    // Character Sheet's Soul Cast form on your GPU: priced on the sheet graph (its request is checked in image-studios-api).
    expect(previewSheet({ mode: "cast", engine: "open", cast: { gender: "Female", age: 30 } })).toMatchObject({ modelId: "oss-zimage-soul-cast", costUsd: 0 });
  });
});

describe("the marketing eval suite", () => {
  it("sends the product-shot flag only where ComfyUI reads it", () => {
    const suite = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts/eval/cases/marketing.json"), "utf8"));
    for (const c of suite.cases) {
      if (!JSON.stringify(c.params ?? {}).includes("productShot")) continue;
      expect(c.engines, c.id).toEqual(["open", "demo"]);
    }
    const cloud = suite.cases.find((c: { id: string }) => c.id === "marketing/product-plinth-cloud");
    expect(cloud).toMatchObject({ engines: ["cloud"], params: { aspectRatio: "3:4" }, variantModels: { partner: { cloud: ["gpt-image-2-5"] } } });
  });
});
