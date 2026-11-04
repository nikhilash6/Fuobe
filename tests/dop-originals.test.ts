import { beforeAll, describe, expect, it } from "vitest";
import type { ComfyWorkflow } from "@/lib/comfy";
import type { GenerationRequest, GenInput, ModelDef, ModelRoute } from "@/lib/catalog/types";
import { tempDir } from "./helpers/temp-dir";

// Fuobe DoP as a run (build plan O4): one model on both engines for the camera motions and effects, the cloud payload
// from the research's FieldMaps (49 or 81 frames at 16 fps, interpolation off), Mix on both engines, the LTX-2.3 graphs
// with LoRAs, the Fun Camera pose, the relight step and the grade the browser applies.
const dir = tempDir("fuobe-dop-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9"; // nothing listens here: open runs fall back to the demo

const { setSetting } = await import("@/server/settings");
const { createGenerations, previewGeneration } = await import("@/server/generations");
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const { falProvider } = await import("@/server/providers/fal");
const { EFFECTS, getModel, getPreset, modelsFor, MOTIONS } = await import("@/lib/catalog");
const { onEngine } = await import("@/lib/catalog/engines");
const { estimateCost, planGeneration, routesFor } = await import("@/lib/catalog/plan");
const { engineSwitchModel, followEngineParams, presetModel, presetOriginal, presetParams, prestepCost } = await import("@/lib/composer");
const { gradeOf, nextSteps } = await import("@/lib/output-actions");
const { lorasFit } = await import("@/lib/catalog/loras");

beforeAll(() => setSetting("demoMode", "auto"));

const view = (id: string, engine: "open" | "cloud") => onEngine(getModel(id)!, engine);
// A move's own route: as when the model its preview was made with (MiniMax H3) isn't in the catalog, or Fuobe DoP is picked.
const noRecipe = () => false;
const inCatalog = (id: string) => !!getModel(id);
const plan = (engine: "open" | "cloud", req: Partial<GenerationRequest> & { presetId?: string }, modelId = presetModel(getPreset(req.presetId ?? "")!, engine, noRecipe) ?? "fuobe-dop") => {
  const m = view(modelId, engine);
  return planGeneration({ feature: "motion", modelId: m.id, prompt: "a woman in a red coat on a bridge", inputs: { images: ["/a.png"] }, ...req }, (id) => (id === m.id ? m : getModel(id)), getPreset);
};
const falRoute = (m: ModelDef, op = "i2v") => m.routes.find((r) => r.provider === "fal" && r.op === op)!;

/** Submit through the fal adapter and return the URL and JSON body it posted. */
async function submit(model: ModelDef, route: ModelRoute, input: GenInput): Promise<{ url: string; body: Record<string, unknown> }> {
  const real = globalThis.fetch;
  let seen: { url: string; body: Record<string, unknown> } | undefined;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen = { url: String(url), body: JSON.parse(String(init?.body ?? "{}")) };
    return new Response(JSON.stringify({ request_id: "r1", status_url: "s", response_url: "r", cancel_url: "c" }), { status: 200 });
  }) as typeof fetch;
  try {
    await falProvider.submit({ generationId: "g", model, route, input });
  } finally {
    globalThis.fetch = real;
  }
  return seen!;
}

const ctx = (media: (n: unknown) => unknown = () => undefined, op: "i2v" | "flf2v" = "i2v") => ({
  generationId: "g",
  op,
  upload: async (_d: Buffer, _t: string, name: string) => `up_${name}`,
  media: media as never,
  serverRam: async () => undefined,
});

describe("Fuobe DoP on both engines", () => {
  it("is one model with ComfyUI routes and hosted open-weight routes, 480p on the GPU and 720p in the cloud", () => {
    const m = getModel("fuobe-dop")!;
    expect(m.engines).toEqual(["open", "cloud"]);
    expect(view("fuobe-dop", "open").routes.map((r) => [r.op, r.endpoint])).toEqual([["i2v", "wan22-i2v-14b"], ["flf2v", "wan22-flf2v-14b"], ["keyframes", "wan22-flf2v-14b"]]);
    expect(new Set(view("fuobe-dop", "cloud").routes.map((r) => r.provider))).toEqual(new Set(["fal", "replicate"]));
    expect(view("fuobe-dop", "open").defaults).toMatchObject({ resolution: "480p", duration: 5, aspectRatio: "auto" });
    expect(view("fuobe-dop", "cloud").defaults).toMatchObject({ resolution: "720p", duration: 5 });
    expect(view("fuobe-dop-ltx", "open").routes.map((r) => [r.op, r.endpoint])).toEqual([["i2v", "ltx23-i2v-lora"], ["flf2v", "ltx23-flf2v-lora"]]);
    for (const engine of ["open", "cloud"] as const) expect(modelsFor({ kind: "video", engine }).some((x) => x.id === "fuobe-dop")).toBe(true);
  });

  it("asks for a start frame", () => {
    expect(() => plan("open", { inputs: undefined, prompt: "a slow push in" })).toThrow(/start frame/);
  });

  it("sends 49 or 81 frames at 16 fps with interpolation off and 20 steps, each LoRA on its expert", async () => {
    const m = view("fuobe-dop", "cloud");
    const p = plan("cloud", { presetId: "motion-overhead" });
    expect(p.loras.map((l) => l.target)).toEqual(["high", "low"]);
    const loras = p.loras.map((l) => ({ ...l, hostedUrl: `https://v3.fal.media/files/${l.version}.safetensors` }));
    for (const [duration, frames] of [[5, 81], [3, 49]] as const) {
      const { url, body } = await submit(m, falRoute(m), { ...p.params, duration, prompt: p.prompt, images: ["https://fal.media/a.png"], loras });
      expect(url).toContain("fal-ai/wan/v2.2-a14b/image-to-video/lora");
      expect(body).toMatchObject({ num_frames: frames, frames_per_second: 16, interpolator_model: "none", num_inference_steps: 20, resolution: "720p" });
      expect((body.loras as { transformer: string }[]).map((l) => l.transformer)).toEqual(["high", "low"]);
    }
    // Without a LoRA (a move on its words, Fuobe DoP picked) the plain endpoint, at the same frame rate.
    const words = plan("cloud", { presetId: "motion-whip-pan" }, "fuobe-dop");
    const plain = await submit(m, falRoute(m), { ...words.params, prompt: words.prompt, images: ["https://fal.media/a.png"] });
    expect(plain.url).toMatch(/fal-ai\/wan\/v2\.2-a14b\/image-to-video$/);
    expect(plain.body).toMatchObject({ num_frames: 81, frames_per_second: 16, interpolator_model: "none" });
  });

  it("prices the clip: free on the GPU, the LoRA endpoint's $0.10/s in the cloud", () => {
    const p = plan("cloud", { presetId: "motion-overhead" });
    expect(estimateCost(view("fuobe-dop", "cloud"), p.params, 1, "i2v", true)).toBeCloseTo(0.5);
    expect(estimateCost(view("fuobe-dop", "cloud"), { ...p.params, duration: 3 }, 1, "i2v", true)).toBeCloseTo(0.3);
    expect(estimateCost(view("fuobe-dop", "open"), p.params, 1, "i2v")).toBe(0);
  });
});

describe("Mix on both engines", () => {
  it("sends both presets' LoRAs, each scaled by its strength, with the second one's trigger", () => {
    for (const engine of ["open", "cloud"] as const) {
      const p = plan(engine, { presetId: "motion-overhead", presetStrength: 0.8, mix: { presetId: "effect-building-explosion", strength: 0.5 } });
      expect(p.loras.map((l) => l.strength)).toEqual([0.8, 0.8, 0.5, 0.5]);
      expect(p.loras.slice(2).every((l) => /explosion-redmond/.test(l.file))).toBe(true);
      expect(p.prompt).toMatch(/Also, more subtly: explosion, /);
    }
    // Two Wan 2.2 pairs fit fal's list, not Replicate's one LoRA per expert: the run goes to fal.
    const both = plan("cloud", { presetId: "motion-overhead", mix: { presetId: "effect-building-explosion", strength: 0.5 } });
    const m = view("fuobe-dop", "cloud");
    expect(lorasFit(falRoute(m), both.loras)).toBe(true);
    expect(lorasFit(m.routes.find((r) => r.provider === "replicate")!, both.loras)).toBe(false);
  });

  it("joins a preset whose LoRA is for another base as words, and says so", () => {
    const p = plan("open", { presetId: "motion-overhead", mix: { presetId: "motion-fpv-drone", strength: 0.9 } });
    expect(p.loras).toHaveLength(2);
    expect(p.notes?.join(" ")).toMatch(/FPV Drone's LoRA runs on LTX-2\.3, so it joins this mix as words only/);
    expect(p.prompt).toMatch(/At the same time: /);
  });

  it("gives a partner model the words without the LoRA's trigger", () => {
    const kling = planGeneration({ feature: "motion", modelId: "kling-2-5-turbo", presetId: "effect-thunder-god", prompt: "a knight", inputs: { images: ["/a.png"] } }, getModel, getPreset);
    expect(kling.loras).toEqual([]);
    expect(kling.prompt.startsWith("a knight. ")).toBe(true);
    expect(plan("open", { presetId: "effect-thunder-god", prompt: "a knight" }).prompt.startsWith("Thunder Hero. a knight. ")).toBe(true);
  });
});

describe("Fuobe DoP · LTX", () => {
  it("runs a camera LoRA alone on the plain LTX-2.3 endpoint, its strength on camera_lora_scale, silent and unexpanded", async () => {
    const m = view("fuobe-dop-ltx", "cloud");
    const p = plan("cloud", { presetId: "motion-jib-up", presetStrength: 0.6 });
    expect(p.model.id).toBe("fuobe-dop-ltx");
    expect(p.loras).toEqual([]);
    const { url, body } = await submit(m, falRoute(m), { ...p.params, ...p.params.extra, prompt: p.prompt, images: ["https://fal.media/a.png"] } as GenInput);
    expect(url).toMatch(/fal-ai\/ltx-2\.3-22b\/image-to-video$/);
    expect(body).toMatchObject({ camera_lora: "jib_up", camera_lora_scale: 0.6, enable_prompt_expansion: false, generate_audio: false, num_frames: 121 });
  });

  it("sends a transition's LoRA with both frames to the LTX-2.3 LoRA endpoint", async () => {
    const m = view("fuobe-dop-ltx", "cloud");
    const p = plan("cloud", { presetId: "effect-melt-transition", inputs: { images: ["/a.png"], endImage: "/b.png" } });
    expect(p.op).toBe("flf2v");
    const { url, body } = await submit(m, falRoute(m, "flf2v"), { ...p.params, prompt: p.prompt, images: ["https://fal.media/a.png"], endImage: "https://fal.media/b.png", loras: p.loras });
    expect(url).toContain("fal-ai/ltx-2.3-22b/image-to-video/lora");
    expect(body).toMatchObject({ image_url: "https://fal.media/a.png", end_image_url: "https://fal.media/b.png" });
    expect((body.loras as { path: string }[])[0].path).toMatch(/ltx2\.3-transition\.safetensors$/);
    expect(p.prompt.startsWith("zhuanchang. ")).toBe(true);
  });

  it("injects the LoRAs after the LTX-2.3 checkpoint and sizes the clip from the start frame on the GPU", async () => {
    const p = plan("open", { presetId: "motion-fpv-drone", params: { aspectRatio: "auto", duration: 5 } });
    const { workflow } = await prepareWorkflow(
      "ltx23-i2v-lora",
      { ...p.params, prompt: p.prompt, images: ["up_a.png"], loras: p.loras, seed: 3 },
      ctx((n) => (n === "up_a.png" ? { container: "image", width: 1080, height: 1920, hasVideo: false, hasAudio: false } : undefined)),
    );
    const wf = workflow as ComfyWorkflow;
    const lora = Object.entries(wf).find(([, n]) => n.class_type === "LoraLoaderModelOnly")!;
    expect(lora[1].inputs.lora_name).toBe(p.loras[0].file);
    const ckpt = Object.entries(wf).find(([, n]) => n.class_type === "CheckpointLoaderSimple")![0];
    expect(lora[1].inputs.model).toEqual([ckpt, 0]);
    // The guider samples with the LoRA's model, not the bare checkpoint.
    expect(Object.values(wf).find((n) => n.class_type === "CFGGuider")!.inputs.model).toEqual([lora[0], 0]);
    expect(wf["130"].inputs.value).toBe(121);
    expect(wf["114"].inputs.value).toBe(24);
    const [w, h] = [wf["113"].inputs.value as number, wf["98"].inputs.value as number];
    expect(w % 32).toBe(0);
    expect(h % 32).toBe(0);
    expect(h).toBeGreaterThan(w);
    expect(wf["31"].inputs.image).toBe("up_a.png");
  });
});

describe("Fuobe DoP on the GPU", () => {
  it("runs a Fun Camera pose on its graph, a LoRA mixed in on its experts", async () => {
    const p = plan("open", { presetId: "motion-zoom", mix: { presetId: "effect-building-explosion", strength: 0.7 } });
    expect(routesFor(p.model, "i2v")[0].endpoint).toBe("wan22-i2v-14b");
    expect(p.params.extra).toEqual({ cameraMotion: "Zoom In" });
    const { manifest, workflow } = await prepareWorkflow("wan22-i2v-14b", { ...p.params, prompt: p.prompt, images: ["up_a.png"], loras: p.loras, seed: 1 }, ctx());
    expect(manifest.id).toBe("wan22-fun-camera-14b");
    const wf = workflow as ComfyWorkflow;
    expect(Object.values(wf).find((n) => n.class_type === "WanCameraEmbedding")!.inputs.camera_pose).toBe("Zoom In");
    const loras = Object.values(wf).filter((n) => n.class_type === "LoraLoaderModelOnly").map((n) => n.inputs.lora_name);
    expect(loras.sort()).toEqual(p.loras.map((l) => l.file).sort());
    // Without a pose the plain image-to-video graph.
    const plain = await prepareWorkflow("wan22-i2v-14b", { prompt: "x", images: ["up_a.png"], duration: 3, resolution: "480p", aspectRatio: "16:9" }, ctx());
    expect(plain.manifest.id).toBe("wan22-i2v-14b");
  });

  it("runs an LTX-2.5 LoRA on the open LTX-2.5 graph, and its words in the cloud", () => {
    expect(plan("open", { presetId: "motion-slow-motion" }).model.id).toBe("oss-ltx25");
    // fal has no LTX-2.5 LoRA endpoint: the words, on the partner model until the harness measures Fuobe DoP on them.
    const cloud = plan("cloud", { presetId: "motion-slow-motion" });
    expect(cloud.model.id).toBe("kling-2-5-turbo");
    expect(cloud.loras).toEqual([]);
    const dop = plan("cloud", { presetId: "motion-slow-motion" }, "fuobe-dop");
    expect(dop.loras).toEqual([]);
  });
});

describe("effects as steps", () => {
  it("grades a colour-grade effect in the browser: the clip carries the grade, its next step applies it", () => {
    const pink = getPreset("effect-candy-pink")!;
    expect(pink.grade).toBe("candy-pink");
    // The grade is Fuobe DoP's step: the effect runs on it on both engines, without a LoRA.
    for (const engine of ["open", "cloud"] as const) expect(presetModel(pink, engine, noRecipe)).toBe("fuobe-dop");
    expect(plan("cloud", { presetId: "effect-candy-pink" }).loras).toEqual([]);
    const g = {
      id: "gen123",
      status: "succeeded",
      prompt: "a woman on a bridge",
      modelId: "fuobe-dop",
      op: "i2v",
      request: { feature: "motion", modelId: "fuobe-dop", presetId: "effect-candy-pink" },
      outputs: [{ url: "/api/files/outputs/c.mp4", kind: "video", meta: { grade: "candy-pink" } }],
    } as never;
    expect(gradeOf({ kind: "video", meta: { grade: "candy-pink" } })).toEqual({ id: "candy-pink", name: "Candy Pink" });
    expect(nextSteps(g, 0)[0]).toMatchObject({ id: "grade", label: "Apply the Candy Pink grade", href: "/color-grade?video=%2Fapi%2Ffiles%2Foutputs%2Fc.mp4&preset=candy-pink" });
  });

  it("relights the start frame first, then animates the relit picture, on the engine asked for", () => {
    const req = { feature: "motion", modelId: "fuobe-dop", presetId: "effect-window", prompt: "a woman reading", inputs: { images: ["/api/files/uploads/a.png"] } };
    for (const engine of ["open", "cloud"] as const) {
      const [clip, relit] = createGenerations({ ...req, engine });
      expect(relit.modelId).toBe(engine === "open" ? "oss-qwen-image-21-turbo" : "qwen-image-edit-2509-cloud");
      if (engine === "open") expect(relit.prompt).toMatch(/^Relight <image1>: soft natural window light from the side/);
      expect(relit.op).toBe("edit");
      expect(clip.modelId).toBe("fuobe-dop");
      expect(clip.engine).toBe(engine);
      expect(clip.request.chain).toEqual([{ slot: "images", position: "first" }]);
      expect(clip.request.inputs?.images).toBeUndefined();
      if (engine === "cloud") expect(relit.request.loras?.map((l) => l.file)).toEqual(["Qwen-Image-Edit-2509-Relight.safetensors"]);
    }
    // The price says so before the run: about $0.04 in the cloud, free on the GPU.
    const window = getPreset("effect-window")!;
    expect(prestepCost(window, "fuobe-dop", "cloud")).toBeCloseTo(0.035);
    expect(prestepCost(window, "fuobe-dop", "open")).toBe(0);
    expect(prestepCost(window, "kling-2-5-turbo", "cloud")).toBe(0);
    // On a partner model the effect is its words: no relight step.
    expect(createGenerations({ ...req, modelId: "kling-2-5-turbo" })).toHaveLength(1);
  });

  it("previews a DoP motion on the engine asked for, free on the GPU", () => {
    const open = previewGeneration({ feature: "motion", modelId: "fuobe-dop", presetId: "motion-overhead", prompt: "x", inputs: { images: ["/a.png"] }, engine: "open" });
    expect(open).toMatchObject({ engine: "open", costUsd: 0, route: { provider: "comfyui", endpoint: "wan22-i2v-14b" } });
    expect(open.loras.applied.map((l) => l.file)).toHaveLength(2);
  });
});

describe("review fixes", () => {
  it("keeps the start frame's shape on Fuobe DoP · LTX: \"auto\" on both engines, never a square by default", async () => {
    for (const engine of ["open", "cloud"] as const) expect(view("fuobe-dop-ltx", engine).defaults?.aspectRatio).toBe("auto");
    // Jib Up from the gallery: the composer sends the model's defaults, and fal gets video_size "auto".
    const m = view("fuobe-dop-ltx", "cloud");
    const p = plan("cloud", { presetId: "motion-jib-up", params: { ...m.defaults } });
    const { body } = await submit(m, falRoute(m), { ...p.params, prompt: p.prompt, images: ["https://fal.media/a.png"] });
    expect(body.video_size).toBe("auto");
    expect(body.camera_lora).toBe("jib_up");
    // A shape picked on purpose still maps to fal's size names.
    const wide = await submit(m, falRoute(m), { ...p.params, aspectRatio: "16:9", prompt: p.prompt, images: ["https://fal.media/a.png"] });
    expect(wide.body.video_size).toBe("landscape_16_9");
    // On the GPU, FPV Drone from a 1920x1080 still with the model's defaults is a landscape clip, not a 960x960 crop.
    const open = view("fuobe-dop-ltx", "open");
    const fpv = plan("open", { presetId: "motion-fpv-drone", params: { ...open.defaults } });
    const { workflow } = await prepareWorkflow(
      "ltx23-i2v-lora",
      { ...fpv.params, prompt: fpv.prompt, images: ["up_wide.png"], loras: fpv.loras, seed: 1 },
      ctx((n) => (n === "up_wide.png" ? { container: "image", width: 1920, height: 1080, hasVideo: false, hasAudio: false } : undefined)),
    );
    const wf = workflow as ComfyWorkflow;
    const [w, h] = [wf["113"].inputs.value as number, wf["98"].inputs.value as number];
    expect(w).toBeGreaterThan(h);
    expect(w / h).toBeCloseTo(16 / 9, 1);
  });

  it("binds both frames of an LTX-2.3 transition on the GPU", async () => {
    const p = plan("open", { presetId: "effect-melt-transition", inputs: { images: ["/a.png"], endImage: "/b.png" } });
    expect(routesFor(p.model, "flf2v")[0].endpoint).toBe("ltx23-flf2v-lora");
    const { manifest, workflow } = await prepareWorkflow(
      "ltx23-flf2v-lora",
      { ...p.params, prompt: p.prompt, images: ["up_a.png"], endImage: "up_b.png", loras: p.loras, seed: 2 },
      ctx(() => undefined, "flf2v"),
    );
    expect(manifest.id).toBe("ltx23-flf2v-lora");
    const wf = workflow as ComfyWorkflow;
    expect(wf["31"].inputs.image).toBe("up_a.png");
    expect(wf["39"].inputs.image).toBe("up_b.png");
    const lora = Object.values(wf).find((n) => n.class_type === "LoraLoaderModelOnly")!;
    expect(lora.inputs.lora_name).toBe(p.loras[0].file);
  });

  it("offers sound on Fuobe DoP · LTX in the cloud only, and says it needs 32 GB on the GPU", () => {
    expect(view("fuobe-dop-ltx", "cloud").options.audio).toBe(true);
    expect(view("fuobe-dop-ltx", "open").options.audio).toBe(false);
    expect(getModel("fuobe-dop-ltx")!.tagline).toMatch(/32 GB/);
    // The open engine's other options stay the Original's.
    expect(view("fuobe-dop-ltx", "open").options.aspectRatios).toEqual(view("fuobe-dop-ltx", "cloud").options.aspectRatios);
  });

  it("runs Focus Change on LTX-2.5's fast endpoint: 720p, the start frame's shape, silent, about $0.54", async () => {
    const focus = getPreset("motion-focus-change")!;
    expect(presetModel(focus, "cloud", noRecipe)).toBe("ltx-2-5-fast");
    const m = getModel("ltx-2-5-fast")!;
    expect(m.hidden).toBe(true);
    // As the composer sends it: the model's defaults, then the move's own settings over them.
    const p = plan("cloud", { presetId: "motion-focus-change", params: { ...m.defaults, ...presetParams(focus, "cloud", noRecipe) } });
    expect(p.params).toMatchObject({ duration: 6, resolution: "720p", aspectRatio: "auto", generateAudio: false, extra: { camera_motion: "focus_shift" } });
    expect(estimateCost(m, p.params, 1, "i2v")).toBeCloseTo(0.54);
    const { url, body } = await submit(m, m.routes[0], { ...p.params, prompt: p.prompt, images: ["https://fal.media/a.png"] });
    expect(url).toContain("lightricks/ltx-2.5/image-to-video/fast");
    expect(body).toMatchObject({ camera_motion: "focus_shift", generate_audio: false, aspect_ratio: "auto", resolution: "720p", duration: "6" });
  });

  it("keeps a move's partner model in the cloud when Fuobe DoP has nothing of its own there yet", () => {
    const whip = getPreset("motion-whip-pan")!;
    expect(whip.open).toMatchObject({ modelId: "fuobe-dop" });
    expect(whip.cloud).toMatchObject({ modelId: "kling-2-5-turbo", partner: true });
    expect(whip.parity).toMatch(/^On your GPU, Fuobe DoP [^.]+\.$/);
    // The Details popover reads as plain words: no notes for us about checks still to run.
    for (const p of [...MOTIONS, ...EFFECTS]) expect(p.parity ?? "", p.id).not.toMatch(/evaluation harness|checked on a GPU run|unverified/);
    // Every cloud route on Fuobe DoP brings something of its own: a LoRA, a camera LoRA or move, a grade or a relight.
    for (const p of [...MOTIONS, ...EFFECTS]) {
      if (!p.cloud || p.cloud.partner) continue;
      expect(!!(p.cloud.loras?.length || p.cloud.params?.extra || p.grade || p.prestep), p.id).toBe(true);
    }
    // Fuobe DoP on the words is still a pick away.
    expect(plan("cloud", { presetId: "motion-whip-pan" }, "fuobe-dop").model.id).toBe("fuobe-dop");
  });

  it("says when a cloud route carries a LoRA licensed for the GPU only, and prices Wiggle as what runs", () => {
    for (const p of [...MOTIONS, ...EFFECTS]) if ((p.cloud?.loras ?? []).some((l) => l.licence?.hostedOk === false)) expect(p.parity, p.id).toMatch(/licensed for your GPU only/);
    const wiggle = getPreset("motion-wiggle")!;
    expect(wiggle.open!.loras!.every((l) => l.licence?.hostedOk === false)).toBe(true);
    expect(wiggle.cloud).toMatchObject({ modelId: "kling-2-5-turbo", partner: true });
    // Picked on Fuobe DoP in the cloud: the words without the trigger, at the plain endpoint's price.
    const p = plan("cloud", { presetId: "motion-wiggle" }, "fuobe-dop");
    expect(p.loras).toEqual([]);
    expect(p.prompt.startsWith("Wiggle. ")).toBe(false);
    expect(estimateCost(view("fuobe-dop", "cloud"), p.params, 1, "i2v", false)).toBeCloseTo(0.4);
  });

  it("leads with a LoRA's trigger once, without its full stop or brackets", () => {
    expect(getPreset("motion-overhead")!.open!.promptTemplate).toMatch(/^过顶升摇\. \{prompt\}/);
    expect(getPreset("motion-incline")!.open!.promptTemplate).toMatch(/^弧降仰底\. \{prompt\}/);
    expect(getPreset("effect-outfit-switch")!.open!.promptTemplate).toMatch(/^8r1d3 bride effect\. \{prompt\}/);
    for (const p of [...MOTIONS, ...EFFECTS]) for (const r of [p.open, p.cloud]) expect(r?.promptTemplate ?? "", p.id).not.toMatch(/\.\.|^\(/);
    // In a Mix too.
    const mix = plan("open", { presetId: "effect-building-explosion", mix: { presetId: "motion-overhead", strength: 0.8 } });
    expect(mix.prompt).toMatch(/At the same time: 过顶升摇, /);
  });

  it("prices a clip at the length the route makes (Replicate's Wan 2.2 fast makes 5 s when 3 s is asked)", () => {
    setSetting("replicateToken", "r8_test");
    try {
      const req = { feature: "motion", modelId: "fuobe-dop", presetId: "motion-whip-pan", prompt: "x", inputs: { images: ["/a.png"] }, params: { duration: 3, resolution: "720p" }, engine: "cloud" as const };
      const p = previewGeneration(req);
      expect(p.route).toMatchObject({ provider: "replicate" });
      expect(p.notes?.join(" ")).toMatch(/about 5 s, not 3 s/);
      expect(p.costUsd).toBeCloseTo(0.4);
    } finally {
      setSetting("replicateToken", "");
    }
  });
});

describe("the composer follows the engine, not a person's pick", () => {
  const jib = getPreset("motion-jib-up")!;
  const defaults = { open: "oss-wan22-14b", cloud: "kling-2-5-turbo" };
  it("moves a move to its model on the new engine when the engine changes", () => {
    expect(presetModel(jib, "open", noRecipe)).toBe("fuobe-dop");
    expect(presetModel(jib, "cloud", noRecipe)).toBe("fuobe-dop-ltx");
    // GPU → cloud on Fuobe DoP: Jib Up follows to Fuobe DoP · LTX.
    expect(engineSwitchModel({ model: view("fuobe-dop", "cloud"), preset: jib, engine: "cloud", from: "open", defaults, has: noRecipe })).toBe("fuobe-dop-ltx");
    // A partner model left behind on the other engine gives way to the move's model here.
    expect(engineSwitchModel({ model: getModel("kling-2-5-turbo")!, preset: jib, engine: "open", from: "cloud", defaults, has: noRecipe })).toBe("fuobe-dop");
  });

  it("opens a Fuobe DoP move on the model its preview was made with, DoP one pick away and following the engine", () => {
    // MiniMax H3 on both engines when the catalog has it.
    expect(presetModel(jib, "open", inCatalog)).toBe("oss-minimax-h3");
    expect(presetModel(jib, "cloud", inCatalog)).toBe("minimax-h3");
    expect(presetOriginal(getPreset("motion-whip-pan")!, "cloud", inCatalog)).toBe("minimax-h3");
    // Hosted H3 follows to H3 on the GPU; Fuobe DoP picked on the GPU still follows to Jib Up's DoP · LTX in the cloud.
    expect(engineSwitchModel({ model: getModel("minimax-h3")!, preset: jib, engine: "open", from: "cloud", defaults, has: inCatalog })).toBe("oss-minimax-h3");
    expect(engineSwitchModel({ model: view("fuobe-dop", "cloud"), preset: jib, engine: "cloud", from: "open", defaults, has: inCatalog })).toBe("fuobe-dop-ltx");
    expect(engineSwitchModel({ model: view("fuobe-dop", "open"), preset: jib, engine: "open", from: "open", defaults, has: inCatalog })).toBeUndefined();
    // The effects with a start-frame step (relight, Mixed Media) stay on Fuobe DoP, which runs the step.
    const steps = EFFECTS.filter((p) => p.prestep);
    expect(steps).toHaveLength(38);
    for (const p of steps) for (const engine of ["open", "cloud"] as const) expect(presetModel(p, engine, inCatalog), p.id).toBe(p[engine]!.modelId);
    // A colour-grade effect stays on Fuobe DoP on both engines, whose clip carries the grade (as its cover was made).
    for (const engine of ["open", "cloud"] as const) expect(presetModel(getPreset("effect-candy-pink")!, engine, inCatalog)).toBe("fuobe-dop");
    // Fuobe DoP picked: its own route runs as before (LoRAs, the trigger, its settings).
    const dop = plan("open", { presetId: "motion-jib-up" }, "fuobe-dop");
    expect(dop.loras.map((l) => l.file)).toEqual(jib.open!.loras?.map((l) => l.file) ?? []);
  });

  it("keeps the sibling Original picked on purpose on the same engine", () => {
    // In the cloud, Fuobe DoP (Wan) picked for Jib Up stays: the engine didn't change.
    expect(engineSwitchModel({ model: view("fuobe-dop", "cloud"), preset: jib, engine: "cloud", from: "cloud", defaults, has: noRecipe })).toBeUndefined();
    // On the GPU, Fuobe DoP · LTX picked for Jib Up stays too.
    expect(engineSwitchModel({ model: view("fuobe-dop-ltx", "open"), preset: jib, engine: "open", from: "open", defaults, has: noRecipe })).toBeUndefined();
    // Focus Change: Fuobe DoP picked in the cloud doesn't snap back to LTX 2.5 Fast.
    expect(engineSwitchModel({ model: view("fuobe-dop", "cloud"), preset: getPreset("motion-focus-change")!, engine: "cloud", from: "cloud", defaults, has: noRecipe })).toBeUndefined();
  });

  it("moves to a picked or linked move's Original, never to a partner route", () => {
    expect(presetOriginal(jib, "cloud", noRecipe)).toBe("fuobe-dop-ltx");
    expect(presetOriginal(getPreset("motion-whip-pan")!, "cloud", noRecipe)).toBeUndefined();
    expect(presetOriginal(getPreset("motion-whip-pan")!, "open", noRecipe)).toBe("fuobe-dop");
    expect(presetOriginal(getPreset("app-face-swap") ?? undefined, "cloud", inCatalog)).toBeUndefined();
    // The move's own settings start the composer, its extra (a camera LoRA) stays the preset's.
    expect(presetParams(jib, "cloud", noRecipe)).toEqual({ duration: 5 });
  });

  it("takes the other engine's defaults for the settings left alone when the same Original changes engine", () => {
    const [open, cloud] = [view("fuobe-dop", "open").defaults!, view("fuobe-dop", "cloud").defaults!];
    expect(followEngineParams({ ...open, numOutputs: 1 }, open, cloud)).toEqual({ ...open, numOutputs: 1, resolution: "720p" });
    expect(followEngineParams({ ...cloud }, cloud, open)).toMatchObject({ resolution: "480p" });
    // 720p picked on the GPU on purpose: it stays in the cloud (nothing moves).
    expect(followEngineParams({ ...open, resolution: "720p" }, open, cloud)).toBeUndefined();
  });
});
