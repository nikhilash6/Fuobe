import { describe, expect, it } from "vitest";
import { getModel, getPreset, PRESETS } from "@/lib/catalog";
import { fitLoras, loraEntry, loraRef } from "@/lib/catalog/loras";
import { planGeneration } from "@/lib/catalog/plan";
import type { Generation, GenInput, LoraRef, ModelRoute } from "@/lib/catalog/types";
import { onEngine } from "@/lib/catalog/engines";
import { tempDir } from "./helpers/temp-dir";

// Providers and route choice read keys and preferences from the settings table: a throwaway database.
const dir = tempDir("fuobe-replicate-lora-");
process.env.FUOBE_DATA_DIR = dir;
const { replicateProvider } = await import("@/server/providers/replicate");
const { setSetting } = await import("@/server/settings");
const { chooseRoute, createGenerations, getGeneration, previewGeneration } = await import("@/server/generations");
const { changeAccess } = await import("@/server/model-access");

async function submit(route: ModelRoute, input: GenInput): Promise<{ url: string; body: Record<string, unknown> }> {
  const real = globalThis.fetch;
  let seen: { url: string; body: Record<string, unknown> } | undefined;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen = { url: String(url), body: JSON.parse(String(init?.body ?? "{}")) };
    return new Response(JSON.stringify({ id: "p1" }), { status: 201 });
  }) as typeof fetch;
  try {
    await replicateProvider.submit({ generationId: "g", model: getModel("z-image-turbo-cloud")!, route, input });
  } finally {
    globalThis.fetch = real;
  }
  return seen!;
}

const route = (modelId: string, op: string, provider = "replicate") => {
  const r = getModel(modelId)?.routes.find((x) => x.op === op && x.provider === provider);
  if (!r) throw new Error(`${modelId} has no ${provider} ${op} route`);
  return r;
};
const hf = (file: string, extra: Partial<LoraRef> = {}): LoraRef => ({ file, url: `https://huggingface.co/a/b/resolve/main/${file}`, strength: 1, ...extra });

describe("Replicate LoRA payloads", () => {
  it("prunaai/z-image-turbo-lora: lora_weights[] and lora_scales[], run by its pinned version, size from the aspect ratio", async () => {
    const r = route("z-image-turbo-cloud", "t2i");
    expect(r.endpoint).toMatch(/^prunaai\/z-image-turbo-lora:[0-9a-f]{64}$/);
    const looks = ["awportrait", "grainscape"].map((k) => loraRef(loraEntry(k)!));
    const { url, body } = await submit(r, { prompt: "a portrait", aspectRatio: "16:9", seed: 7, loras: looks });
    // A community model: POST /v1/predictions with the version.
    expect(url).toBe("https://api.replicate.com/v1/predictions");
    expect(body.version).toBe(r.endpoint.split(":")[1]);
    const input = body.input as Record<string, unknown>;
    expect(input.lora_weights).toEqual(looks.map((l) => l.url));
    expect(input.lora_scales).toEqual([0.6, 0.5]);
    expect(input).toMatchObject({ prompt: "a portrait", seed: 7, width: 1360, height: 768 });
  });

  it("wan-2.2 fast: one LoRA per expert (lora_weights_transformer = high, _2 = low), a both-LoRA fills the two", async () => {
    const r = route("wan-2-2-a14b-cloud", "i2v");
    const pair = ["civitai-2126493-camera-tilt-up-overhead", "civitai-2126538-camera-tilt-up-overhead"].map((k) => ({ ...loraRef(loraEntry(k)!), hostedUrl: `https://replicate.delivery/${k}.safetensors` }));
    const { url, body } = await submit(r, { prompt: "rise", images: ["https://x/a.png"], duration: 5, loras: pair });
    expect(url).toBe("https://api.replicate.com/v1/models/wan-video/wan-2.2-i2v-fast/predictions");
    expect(body.input).toMatchObject({
      lora_weights_transformer: pair[0].hostedUrl,
      lora_scale_transformer: 1,
      lora_weights_transformer_2: pair[1].hostedUrl,
      lora_scale_transformer_2: 1,
      num_frames: 81,
    });
    const both = await submit(r, { prompt: "squish", images: ["https://x/a.png"], loras: [hf("squish_18.safetensors", { target: "both", strength: 0.7 })] });
    expect(both.body.input).toMatchObject({ lora_weights_transformer: expect.stringContaining("squish"), lora_weights_transformer_2: expect.stringContaining("squish"), lora_scale_transformer_2: 0.7 });
  });

  it("leaves out what doesn't fit one LoRA per expert, with a note", () => {
    const r = route("wan-2-2-a14b-cloud", "i2v");
    const motion = hf("motion_high.safetensors", { target: "high" });
    const effect = hf("effect_high.safetensors", { target: "high" });
    const fitted = fitLoras([motion, effect], r);
    expect(fitted.loras).toEqual([motion]);
    expect(fitted.notes).toEqual(["This API takes one LoRA per expert, so the effect_high LoRA is left out"]);
  });

  it("qwen-image-edit-2511: a single LoRA in lora_weights / lora_scale", async () => {
    const r = route("qwen-image-edit-2511-cloud", "edit");
    const { body } = await submit(r, { prompt: "relight", images: ["https://x/a.png"], loras: [hf("relight.safetensors", { strength: 0.9 })] });
    expect(body.input).toMatchObject({ image: ["https://x/a.png"], lora_weights: expect.stringContaining("relight"), lora_scale: 0.9 });
  });

  it("runs a Mix on Replicate's one-per-expert model, the LoRA with no expert left out with the reason", () => {
    setSetting("falKey", "id:secret");
    setSetting("replicateToken", "r8_test");
    setSetting("demoMode", "auto");
    // fal's Wan 2.2 A14B is gone (2027-01-04): Replicate's fast Wan 2.2 is the only cloud route, whatever the LoRAs.
    const routes = getModel("wan-2-2-a14b-cloud")!.routes.filter((r) => r.op === "i2v");
    const one = [hf("motion_high.safetensors", { target: "high" })];
    const mix = [...one, hf("effect_high.safetensors", { target: "high" })];
    expect(chooseRoute(routes, 1, one).route.provider).toBe("replicate");
    expect(chooseRoute(routes, 1, mix).route.provider).toBe("replicate");
    const fit = fitLoras(mix, routes[0]);
    expect(fit.loras.map((l) => l.file)).toEqual(["motion_high.safetensors"]);
    expect(fit.notes.join(" "), fit.notes.join(" ")).toMatch(/one LoRA per expert/);
    // A high and a low one fit side by side.
    expect(fitLoras([...one, hf("effect_low.safetensors", { target: "low" })], routes[0]).loras).toHaveLength(2);
  });

  it("wan-2.2 t2v fast: stays at 16 fps (interpolate_output off) and gets only values it takes", async () => {
    const r = route("wan-2-2-a14b-cloud", "t2v");
    const { url, body } = await submit(r, { prompt: "a street", aspectRatio: "1:1", resolution: "580p", duration: 5 });
    expect(url).toBe("https://api.replicate.com/v1/models/wan-video/wan-2.2-t2v-fast/predictions");
    // Replicate's t2v takes 16:9 / 9:16 and 480p / 720p: the nearest shape, the largest tier not above 580p.
    expect(body.input).toMatchObject({ interpolate_output: false, aspect_ratio: "16:9", resolution: "480p", num_frames: 81 });
    const i2v = await submit(route("wan-2-2-a14b-cloud", "i2v"), { prompt: "go", images: ["https://x/a.png"], resolution: "720p", duration: 5 });
    expect(i2v.body.input).toMatchObject({ interpolate_output: false, resolution: "720p" });
    // Replicate is its only route now: the model offers what Replicate makes.
    expect(getModel("wan-2-2-a14b-cloud")!.routes.every((r) => r.provider === "replicate")).toBe(true);
    expect(getModel("wan-2-2-a14b-cloud")!.options.resolutions).toEqual(["480p", "720p"]);
  });

  it("qwen-image-edit-2511: an aspect ratio Replicate lacks goes as the nearest one it takes", async () => {
    const r = route("qwen-image-edit-2511-cloud", "edit");
    const { body } = await submit(r, { prompt: "wider", images: ["https://x/a.png"], aspectRatio: "21:9" });
    expect((body.input as Record<string, unknown>).aspect_ratio).toBe("16:9");
  });

  it("says what Replicate's fast Wan 2.2 makes when the length asked is outside its 81–121 frames", () => {
    setSetting("falKey", "");
    setSetting("replicateToken", "r8_test");
    setSetting("cloudProvider", "replicate");
    setSetting("demoMode", "auto");
    const routes = getModel("wan-2-2-a14b-cloud")!.routes.filter((r) => r.op === "i2v");
    // Replicate's fast model renders 81–121 frames (5–7.5 s at 16 fps), its only route.
    for (const s of [3, 5, 10]) expect(chooseRoute(routes, 1, [], s).route.provider).toBe("replicate");
    const req = { feature: "video", modelId: "wan-2-2-a14b-cloud", prompt: "a wave", inputs: { images: ["https://x/a.png"] }, params: { duration: 10 } };
    const p = previewGeneration(req);
    expect(p.providerId).toBe("replicate");
    expect(p.notes).toEqual(["Wan 2.2 A14B (hosted) on Replicate makes 5–7.5 s clips, so this one is about 7.5 s, not 10 s"]);
    expect(previewGeneration({ ...req, params: { duration: 5 } }).notes).toBeUndefined();
    setSetting("cloudProvider", "auto");
  });

  it("puts the user's own LoRA first, so a look's LoRAs give way to it on an API that takes so many", () => {
    const preset = PRESETS.find((x) => /motion|effect/.test(x.type) && x.open?.modelId === "fuobe-dop" && x.open.loras?.length)!;
    const identity: LoraRef = { file: "", url: "https://v3.fal.media/files/maya.safetensors", strength: 1, trigger: "mya" };
    const open = (id: string) => (id === "fuobe-dop" ? onEngine(getModel(id)!, "open") : getModel(id));
    const plan = planGeneration({ feature: "motion", presetId: preset.id, modelId: "fuobe-dop", prompt: "x", inputs: { images: ["a.png"] }, loras: [identity] }, open, getPreset);
    expect(plan.loras[0]).toEqual(identity);
    expect(plan.loras.length).toBe(1 + preset.open!.loras!.length);
    // Three look LoRAs and the identity on fal's 3-slot Z-Image: the identity stays, the last look goes.
    const looks = ["awportrait", "lenovo", "grainscape"].map((k) => loraRef(loraEntry(k)!));
    const fitted = fitLoras([identity, ...looks], route("z-image-turbo-cloud", "t2i", "fal"));
    expect(fitted.loras).toEqual([identity, looks[0], looks[1]]);
    expect(fitted.notes).toEqual([`This API takes up to 3 LoRAs, so ${loraEntry("grainscape")!.name} is left out`]);
  });

  it("returns what a run leaves out with the generations it creates", async () => {
    setSetting("demoMode", "on");
    const wiggle = loraRef(loraEntry("civitai-2490836-wiggle-redmond")!);
    // Sent (its licence is information, on Thanks & licences, not a note)...
    const [sent] = createGenerations({ feature: "image", modelId: "z-image-turbo-cloud", prompt: "a cat", loras: [wiggle] });
    expect(sent.notes ?? []).toEqual([]);
    // ...or left out while the admin keeps LoRAs licensed for the GPU only there.
    changeAccess([{ kind: "keepGpuOnlyLoras", on: true }]);
    const [g] = createGenerations({ feature: "image", modelId: "z-image-turbo-cloud", prompt: "a cat", loras: [wiggle] });
    changeAccess([{ kind: "reset" }]);
    expect(g.notes).toEqual(["Wiggle Redmond is licensed for your GPU only and Settings → Models & licences keeps such LoRAs off the cloud, so this run leaves it out"]);
    // Not stored: the run itself is an ordinary one.
    for (let i = 0; i < 200; i++) {
      const now = getGeneration(g.id) as Generation;
      if (!["queued", "running"].includes(now.status)) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(getGeneration(g.id)?.notes).toBeUndefined();
    setSetting("demoMode", "auto");
  });
});
