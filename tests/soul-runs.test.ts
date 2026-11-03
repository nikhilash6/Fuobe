import { beforeAll, describe, expect, it } from "vitest";
import type { ComfyWorkflow } from "@/lib/comfy";
import { tempDir } from "./helpers/temp-dir";

// Fuobe Soul as a run (build plan O2): one model on both engines, the look applied on the server, the cloud
// payload from the research's FieldMaps, the ComfyUI graph with the look's LoRA chain, prices and post steps.
const dir = tempDir("fuobe-soul-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9"; // nothing listens here: open runs fall back to the demo

const { setSetting } = await import("@/server/settings");
const { createGenerations, previewGeneration } = await import("@/server/generations");
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const { getModel, getPreset, modelsFor } = await import("@/lib/catalog");
const { onEngine, pickEngine } = await import("@/lib/catalog/engines");
const { estimateCost, planGeneration, routesFor } = await import("@/lib/catalog/plan");
const { buildPayload } = await import("@/lib/catalog/payload");
const { loraEntry } = await import("@/lib/catalog/loras");
const { SOUL_TAILS } = await import("@/lib/catalog/soul-originals.generated");

beforeAll(() => setSetting("demoMode", "auto"));

const soul = () => getModel("fuobe-soul")!;
const plan = (engine: "open" | "cloud", req: Partial<Parameters<typeof planGeneration>[0]> = {}) => {
  const m = onEngine(soul(), engine);
  return planGeneration({ feature: "image", modelId: m.id, prompt: "a woman in a silver slip dress leaving a club at 2am", ...req }, (id) => (id === m.id ? m : getModel(id)), getPreset);
};

describe("Fuobe Soul on both engines", () => {
  it("is one model with ComfyUI routes and hosted open-weight routes", () => {
    const m = soul();
    expect(m.engines).toEqual(["open", "cloud"]);
    expect(onEngine(m, "open").routes.map((r) => [r.op, r.endpoint])).toEqual([["t2i", "z-image-turbo-t2i"], ["edit", "z-image-turbo-i2i"]]);
    expect(new Set(onEngine(m, "cloud").routes.map((r) => r.provider))).toEqual(new Set(["fal", "replicate"]));
    expect(onEngine(m, "cloud")).toBe(onEngine(m, "cloud"));
    // The pickers list it on both engines.
    expect(modelsFor({ kind: "image", engine: "open" }).some((x) => x.id === "fuobe-soul")).toBe(true);
    expect(modelsFor({ kind: "image", engine: "cloud" }).some((x) => x.id === "fuobe-soul")).toBe(true);
    for (const id of ["fuobe-soul-hd", "fuobe-soul-cinema"]) expect(getModel(id)?.engines).toEqual(["open", "cloud"]);
  });

  it("picks the engine asked for, else the engine mode, else the first connected", () => {
    const m = soul();
    expect(pickEngine(m, "cloud", "both", () => false)).toBe("cloud");
    expect(pickEngine(m, undefined, "cloud", () => false)).toBe("cloud");
    expect(pickEngine(m, undefined, "both", (e) => e === "cloud")).toBe("cloud");
    expect(pickEngine(m, undefined, "both", () => true)).toBe("open");
    expect(() => pickEngine(m, "cloud", "open", () => true)).toThrow(/open source only/);
  });

  it("applies the look: triggers in front, the user's words, the look, the tail, its LoRAs", () => {
    const p = plan("open", { presetId: "v1-indie-sleaze" });
    expect(p.prompt.startsWith("hardflashy, emoessence, a woman in a silver slip dress leaving a club at 2am. ")).toBe(true);
    expect(p.prompt.endsWith(SOUL_TAILS.flash)).toBe(true);
    expect(p.loras.map((l) => l.file)).toEqual(["hardflash", "emo"].map((k) => loraEntry(k)!.file));
    expect(p.soul).toMatchObject({ look: "v1-indie-sleaze", triggers: ["hardflashy", "emoessence"], words: "a woman in a silver slip dress leaving a club at 2am" });
    // Soul's exact size on the user's GPU.
    expect(p.params.extra).toMatchObject({ width: 896, height: 1152 });
    expect(plan("open", { params: { aspectRatio: "16:9", resolution: "1080p" } }).params.extra).toMatchObject({ width: 1920, height: 1088 });
  });

  it("asks for words, and refuses a look id that doesn't exist", () => {
    expect(() => plan("open", { prompt: "" })).toThrow(/Write a prompt/);
    expect(() => plan("open", { presetId: "v9-nope" })).toThrow(/Unknown Soul look/);
  });

  it("builds fal's payload from the research: image_size from Soul's table, 8 steps, no prompt expansion, loras [{path, scale}]", () => {
    const p = plan("cloud", { presetId: "v1-sunset-beach", params: { aspectRatio: "9:16", resolution: "720p", numOutputs: 4 } });
    const route = routesFor(p.model, "t2i").find((r) => r.provider === "fal")!;
    expect(route.loraEndpoint).toBe("fal-ai/z-image/turbo/lora");
    const body = buildPayload(route.map!, { ...p.params, prompt: p.prompt, loras: p.loras.map((l) => ({ ...l, hostedUrl: l.hostedUrl ?? `https://fal.media/${l.file}` })) });
    expect(body).toMatchObject({ image_size: { width: 768, height: 1344 }, num_inference_steps: 8, enable_prompt_expansion: false, output_format: "png", num_images: 4 });
    expect(body.loras).toEqual(p.loras.map((l) => ({ path: l.hostedUrl ?? `https://fal.media/${l.file}`, scale: l.strength })));
    expect(body).not.toHaveProperty("width");
    expect(body).not.toHaveProperty("extra");
  });

  it("builds Replicate's payload: width / height within its 1440 limit, LoRAs as two arrays", () => {
    const p = plan("cloud", { presetId: "v1-general", params: { aspectRatio: "16:9", resolution: "1080p" } });
    const route = routesFor(p.model, "t2i").find((r) => r.provider === "replicate")!;
    const body = buildPayload(route.map!, { ...p.params, prompt: p.prompt, loras: p.loras });
    expect(body).toMatchObject({ width: 1440, height: 816, num_inference_steps: 8, output_format: "png" });
    expect(body.lora_weights).toEqual(p.loras.map((l) => l.url));
    expect(body.lora_scales).toEqual(p.loras.map((l) => l.strength));
  });

  it("chains the look's LoRAs after Z-Image Turbo's loader on ComfyUI, at Soul's size", async () => {
    const p = plan("open", { presetId: "v1-y2k", params: { aspectRatio: "3:4", resolution: "720p" } });
    const { workflow } = await prepareWorkflow(
      "z-image-turbo-t2i",
      { ...p.params, prompt: p.prompt, loras: p.loras, seed: 7 },
      { generationId: "g", op: "t2i", upload: async (_d, _t, name) => `up_${name}`, media: () => undefined, serverRam: async () => undefined },
    );
    const wf = workflow as ComfyWorkflow;
    const chain = Object.values(wf).filter((n) => n.class_type === "LoraLoaderModelOnly").map((n) => [n.inputs.lora_name, n.inputs.strength_model]);
    expect(chain).toEqual(p.loras.map((l) => [l.file, l.strength]));
    const latent = Object.values(wf).find((n) => n.class_type === "EmptySD3LatentImage")!;
    expect([latent.inputs.width, latent.inputs.height]).toEqual([896, 1152]);
    const sampler = Object.values(wf).find((n) => n.class_type === "KSampler")!;
    expect(sampler.inputs).toMatchObject({ steps: 8, cfg: 1, sampler_name: "res_multistep", scheduler: "simple" });
  });

  it("restyles a picture with the look on both engines (Soul 2.0's image to image)", async () => {
    const open = plan("open", { presetId: "v2-y2k-studio", inputs: { images: ["/api/files/uploads/x.png"] }, params: { resolution: "1080p" } });
    expect(open.op).toBe("edit");
    expect(routesFor(open.model, "edit")[0].endpoint).toBe("z-image-turbo-i2i");
    expect(open.params.extra).toMatchObject({ megapixels: 2 });
    const { workflow } = await prepareWorkflow(
      "z-image-turbo-i2i",
      { ...open.params, prompt: open.prompt, images: ["up_x.png"], loras: open.loras, seed: 7 },
      { generationId: "g", op: "edit", upload: async (_d, _t, name) => `up_${name}`, media: () => undefined, serverRam: async () => undefined },
    );
    const wf = workflow as ComfyWorkflow;
    expect(Object.values(wf).find((n) => n.class_type === "ImageScaleToTotalPixels")!.inputs.megapixels).toBe(2);
    expect(Object.values(wf).find((n) => n.class_type === "KSampler")!.inputs.denoise).toBe(0.6);
    expect(Object.values(wf).filter((n) => n.class_type === "LoraLoaderModelOnly").map((n) => n.inputs.lora_name)).toEqual(open.loras.map((l) => l.file));

    const cloud = plan("cloud", { presetId: "v1-general", inputs: { images: ["/api/files/uploads/x.png"] }, params: { extra: { strength: 0.3 } } });
    const route = routesFor(cloud.model, "edit")[0];
    expect(route.loraEndpoint).toBe("fal-ai/z-image/turbo/image-to-image/lora");
    const body = buildPayload(route.map!, { ...cloud.params, prompt: cloud.prompt, images: ["https://fal.media/x.png"], loras: cloud.loras });
    expect(body).toMatchObject({ image_url: "https://fal.media/x.png", strength: 0.3, enable_prompt_expansion: false });
    expect(body).not.toHaveProperty("image_size");
    // A new picture has nothing to change: the edit strength isn't sent.
    expect(plan("cloud", { params: { extra: { strength: 0.3 } } }).params.extra).toBeUndefined();
  });

  it("prices per megapixel of every image: free on the GPU, the /lora price with LoRAs, whole megapixels on Soul HD", () => {
    const cloud = onEngine(soul(), "cloud");
    const p = plan("cloud", { params: { aspectRatio: "1:1", resolution: "720p", numOutputs: 4 } });
    expect(estimateCost(cloud, p.params, p.jobs, p.op, true)).toBeCloseTo(0.0085 * 4, 4);
    expect(estimateCost(onEngine(soul(), "open"), p.params, p.jobs, p.op)).toBe(0);
    const hd = onEngine(getModel("fuobe-soul-hd")!, "cloud");
    expect(estimateCost(hd, { aspectRatio: "16:9", resolution: "1080p", numOutputs: 1 }, 1, "t2i")).toBeCloseTo(0.02 * 2, 3);
  });

  it("gives Soul Cinema its film look and Soul HD the look's words without Z-Image LoRAs", () => {
    const c = planGeneration({ feature: "image", modelId: "fuobe-soul-cinema", prompt: "a detective in the rain" }, getModel, getPreset);
    expect(c.loras.map((l) => l.file)).toEqual(["filmstill", "moviewide"].map((k) => loraEntry(k)!.file));
    expect(c.soul?.grade).toBe("teal-orange");
    const hd = planGeneration({ feature: "image", modelId: "fuobe-soul-hd", prompt: "a poster that says OPEN LATE", presetId: "v1-y2k-posters" }, getModel, getPreset);
    expect(hd.loras).toEqual([]);
    expect(hd.notes?.join(" ")).toMatch(/words only/);
  });
});

describe("Fuobe Soul through the server", () => {
  it("previews on the engine asked for, with its engine and route", () => {
    const open = previewGeneration({ feature: "image", modelId: "fuobe-soul", prompt: "a fox", engine: "open" });
    expect(open).toMatchObject({ engine: "open", demo: true, costUsd: 0, route: { provider: "comfyui", endpoint: "z-image-turbo-t2i" } });
    const cloud = previewGeneration({ feature: "image", modelId: "fuobe-soul", prompt: "a fox", engine: "cloud" });
    expect(cloud).toMatchObject({ engine: "cloud", demo: true });
    expect(cloud.route.provider).toBe("fal");
  });

  it("leaves civitai LoRAs out without a civitai key (and says so) on the cloud, and keeps their triggers off", () => {
    setSetting("falKey", "fal_test_key_123456");
    const p = previewGeneration({ feature: "image", modelId: "fuobe-soul", prompt: "a fox", engine: "cloud", presetId: "v1-indie-sleaze" });
    // Hard Flash is on civitai, Rebel Essence Emo on Hugging Face.
    expect(p.loras.applied.map((l) => l.file)).toEqual([loraEntry("emo")!.file]);
    expect(p.loras.dropped).toEqual([{ file: loraEntry("hardflash")!.file, reason: expect.stringMatching(/civitai key/) }]);
    expect(p.notes?.join(" ")).toMatch(/Hard Flash downloads from civitai, which needs your free API key/);
    expect(p.prompt.startsWith("emoessence, a fox. ")).toBe(true);
    // A Hugging Face LoRA needs no key.
    const g = previewGeneration({ feature: "image", modelId: "fuobe-soul", prompt: "a fox", engine: "cloud", presetId: "v1-general" });
    expect(g.loras.applied.length).toBe(2);
    expect(g.route.endpoint).toBe("fal-ai/z-image/turbo/lora");
    setSetting("falKey", "");
  });

  it("keeps the finished picture (grade, overlay) in place of the raw one, once", async () => {
    const { finishOutput, getGeneration } = await import("@/server/generations");
    const { db } = await import("@/server/db");
    const [g] = createGenerations({ feature: "image", modelId: "fuobe-soul", prompt: "a fox", engine: "open", presetId: "v1-90s-grain" });
    expect(g.presetName).toBe("90s Grain");
    const raw = { url: "/api/files/outputs/raw.png", kind: "image", meta: { look: "v1-90s-grain", grade: "portra" } };
    db().prepare("UPDATE generations SET status = 'succeeded', outputs_json = ? WHERE id = ?").run(JSON.stringify([raw]), g.id);
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const done = finishOutput(g.id, 0, png);
    expect(done.outputs[0]).toMatchObject({ kind: "image", meta: { grade: "portra", finished: true, original: raw.url } });
    expect(done.outputs[0].url).not.toBe(raw.url);
    expect(() => finishOutput(g.id, 0, png)).toThrow(/Already finished/);
    expect(() => finishOutput(g.id, 3, png)).toThrow(/No such output/);
    expect(getGeneration(g.id)!.outputs[0].meta?.finished).toBe(true);
  });

  it("takes the engine through the REST API, and the preview says which (what the evaluation harness checks)", async () => {
    const { POST } = await import("@/app/api/generations/route");
    const res = await POST(new Request("http://localhost/api/generations?preview=1", { method: "POST", body: JSON.stringify({ feature: "eval", modelId: "fuobe-soul", prompt: "a fox", presetId: "v1-y2k", engine: "cloud" }) }));
    const p = (await res.json()) as { engine: string; route: { provider: string } };
    expect(p.engine).toBe("cloud");
    expect(p.route.provider).toBe("fal");
    const bad = await POST(new Request("http://localhost/api/generations?preview=1", { method: "POST", body: JSON.stringify({ feature: "eval", modelId: "fuobe-soul", prompt: "a fox", engine: "gpu" }) }));
    expect(bad.status).toBe(400);
  });

  it("remembers the engine on the row, and the engine mode still holds", () => {
    const [g] = createGenerations({ feature: "image", modelId: "fuobe-soul", prompt: "a fox", engine: "cloud" });
    expect(g.engine).toBe("cloud");
    expect(g.request.engine).toBe("cloud");
    setSetting("engineMode", "open");
    expect(() => createGenerations({ feature: "image", modelId: "fuobe-soul", prompt: "a fox", engine: "cloud" })).toThrow(/open source only/);
    const [o] = createGenerations({ feature: "image", modelId: "fuobe-soul", prompt: "a fox" });
    expect(o.engine).toBe("open");
    setSetting("engineMode", "both");
  });
});

describe("Soul HEX: a palette on Fuobe Soul", () => {
  const PAL = { id: "p1", name: "Teal Dusk", colors: ["#102030", "#2A9D8F"], background: "#264653", slug: null };
  const signed = async (engine: "open" | "cloud", modelId = "fuobe-soul", lock?: boolean, visitor?: boolean) => {
    const { applySignature } = await import("@/lib/catalog/palettes");
    const { signatureCaps } = await import("@/server/palettes");
    // The composer's catalog is the engine's view of each model.
    const view = (id: string) => {
      const m = getModel(id);
      return m && onEngine(m, engine);
    };
    return applySignature({ feature: "image", modelId, prompt: "a lighthouse at dusk", presetId: "v1-90s-grain", engine }, { palette: { ...PAL, ...(lock !== undefined && { lock }) } }, { caps: signatureCaps(), getModel: view, visitor });
  };

  it("writes the colours into the prompt on both engines and locks them on the open engine unless turned off", async () => {
    const open = await signed("open");
    expect(open.modelId).toBe("fuobe-soul");
    expect(open.request.presetId).toBe("v1-90s-grain");
    expect(open.request.signature?.words).toMatch(/^Color palette: use only these colors.*#102030, #2A9D8F; background color #264653\.$/);
    expect(open.lock).toEqual({ colors: ["#102030", "#2A9D8F", "#264653"] });
    expect((await signed("open", "fuobe-soul-cinema")).lock).toBeTruthy();
    expect((await signed("open", "fuobe-soul", false)).lock).toBeUndefined();
    // A guest or a free account: the colors in the prompt only (the lock runs on the studio's own ComfyUI).
    const visitor = await signed("open", "fuobe-soul", undefined, true);
    expect(visitor.lock).toBeUndefined();
    expect(visitor.request.signature?.words).toMatch(/Color palette/);
    // fal has no colour-match step: the cloud gets the words only.
    const cloud = await signed("cloud");
    expect(cloud.lock).toBeUndefined();
    expect(cloud.request.signature?.words).toMatch(/Color palette/);
    // Other open models still lock only when asked.
    expect((await signed("open", "oss-qwen-image")).lock).toBeUndefined();
  });

  it("puts the palette's words inside the look's prompt, and the lock keeps the look's strength and engine", async () => {
    const open = await signed("open");
    const p = previewGeneration(open.request);
    expect(p.prompt).toMatch(/a lighthouse at dusk\. Color palette: use only these colors/);
    const { POST } = await import("@/app/api/palettes/lock/route");
    const res = await POST(
      new Request("http://localhost/api/palettes/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: { ...open.request, presetStrength: 0.6 }, colors: open.lock!.colors }),
      }),
    );
    expect(res.status).toBe(201);
    const { items } = (await res.json()) as { items: { modelId: string; engine: string; request: { presetId?: string; presetStrength?: number; engine?: string } }[] };
    const first = items.find((g) => g.modelId === "fuobe-soul")!;
    expect(first.request).toMatchObject({ presetId: "v1-90s-grain", presetStrength: 0.6, engine: "open" });
    expect(first.engine).toBe("open");
    expect(items.some((g) => g.modelId === "oss-palette-image")).toBe(true);
  });
});
