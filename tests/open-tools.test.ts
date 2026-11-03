import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { GenInput, ModelDef, ModelRoute, Operation } from "@/lib/catalog/types";
import type { ComfyWorkflow } from "@/lib/comfy";
import { tempDir } from "./helpers/temp-dir";

// Build plan O11 (rebranded open tools, Speak and finishing): Fuobe Angles (Qwen-Image-Edit 2509 + dx8152's
// Multiple-angles LoRA on both engines, the Angles app's Higgsfield-like controls), Fuobe Speak (InfiniteTalk with
// Higgsfield's Infinite Talk settings on the GPU, fal's InfiniteTalk) and Fuobe Speak · Motion (Wan 2.2 S2V), Depth
// Map's Large model as a labelled alternative, the HDR route's LoRA endpoint, and Soul's face mosaic (SAM 3.1 + a
// mosaic on the GPU, fal's SAM 3.1 masks pixelated in the browser).
const dir = tempDir("fuobe-o11-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9"; // nothing listens here: open runs fall back to the demo

const { setSetting } = await import("@/server/settings");
const { createGenerations, ensureRunner, getGeneration, previewGeneration } = await import("@/server/generations");
const { createPipeline } = await import("@/server/chains");
const { db } = await import("@/server/db");
const { saveFile, readRef } = await import("@/server/storage");
const { decodePng, encodePng } = await import("@/server/png");
const { mockProvider } = await import("@/server/providers/mock");
const { falProvider } = await import("@/server/providers/fal");
const { prepareWorkflow, getWorkflow } = await import("@/server/providers/comfyui");
const { getModel, getPreset } = await import("@/lib/catalog");
const { onEngine } = await import("@/lib/catalog/engines");
const { planGeneration, estimateCost } = await import("@/lib/catalog/plan");
const { extractOutputs, numFramesValue } = await import("@/lib/catalog/payload");
const { soulPostStep, soulLook } = await import("@/lib/catalog/soul");
const tools = await import("@/lib/catalog/open-tools");
const { finishSteps, mosaicPixels, unionMasks } = await import("@/lib/soul-post");
const { accessList } = await import("@/server/model-access");
const { licenceInfo } = await import("@/lib/licences");

beforeAll(() => setSetting("demoMode", "auto"));

const view = (id: string, engine: "open" | "cloud") => onEngine(getModel(id)!, engine);
const plan = (r: Parameters<typeof planGeneration>[0], engine: "open" | "cloud") =>
  planGeneration(r, (id) => (getModel(id)?.engines ? view(id, engine) : getModel(id)), getPreset);
const research = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/research/fuobe-originals-recipes-5.json"), "utf8"));

async function prepare(id: string, input: GenInput, op: Operation, ctx: { loraSlot?: boolean; media?: (name: string) => { duration?: number } | undefined } = {}): Promise<ComfyWorkflow> {
  const { workflow } = await prepareWorkflow(id, { seed: 7, ...input }, { generationId: "g", op, upload: async (_d, _t, name) => `up_${name}`, media: (ctx.media ?? (() => undefined)) as never, serverRam: async () => undefined, loraSlot: ctx.loraSlot });
  return workflow;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function settled(id: string, ms = 20_000) {
  const end = Date.now() + ms;
  for (;;) {
    const g = getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`${id} is still ${g.status}`);
    await sleep(50);
  }
}

/** A `w` × `h` PNG: `paint(x, y)` gives each pixel's RGB. */
function png(w: number, h: number, paint: (x: number, y: number) => [number, number, number]): Buffer {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...paint(x, y), 255], (y * w + x) * 4);
  return encodePng({ width: w, height: h, data });
}
const dataUri = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;

/** Submit through the fal adapter and return the endpoint URL and the JSON body it posted. */
async function submit(model: ModelDef, route: ModelRoute, given: GenInput): Promise<{ url: string; body: Record<string, unknown> }> {
  const real = globalThis.fetch;
  let seen: { url: string; body: Record<string, unknown> } | undefined;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen = { url: String(url), body: JSON.parse(String(init?.body ?? "{}")) };
    return new Response(JSON.stringify({ request_id: "r1", status_url: "s", response_url: "r", cancel_url: "c" }), { status: 200 });
  }) as typeof fetch;
  try {
    await falProvider.submit({ generationId: "g", model, route, input: given });
  } finally {
    globalThis.fetch = real;
  }
  return seen!;
}

describe("Fuobe Angles", () => {
  it("writes the Multiple-angles LoRA's own words for a camera, and refuses one that doesn't move", () => {
    expect(tools.anglesWords({ rotate_right_left: 45 })).toBe("将镜头向左旋转45度 Rotate the camera 45 degrees to the left.");
    expect(tools.anglesWords({ rotate_right_left: -90, move_forward: 10, vertical_angle: -1, wide_angle_lens: true })).toBe(
      "将镜头向右旋转90度 Rotate the camera 90 degrees to the right. 将镜头转为特写镜头 Turn the camera to a close-up. 将相机转向鸟瞰视角 Turn the camera to a bird's-eye view. 将镜头转为广角镜头 Turn the camera to a wide-angle lens.",
    );
    expect(tools.anglesWords({ move_forward: 3, vertical_angle: 1 })).toBe("将镜头向前移动 Move the camera forward. 将相机切换到仰视视角 Turn the camera to a worm's-eye view.");
    // A half tilt isn't one of the LoRA's views, and out-of-range values are clamped.
    expect(tools.anglesWords({ vertical_angle: 0.5, rotate_right_left: 400 })).toBe("将镜头向左旋转90度 Rotate the camera 90 degrees to the left.");
    expect(tools.anglesWords({})).toBe("");
    expect(() => tools.anglesPrompt({}, "")).toThrow(/Move the camera first/);
    expect(tools.anglesPrompt({ rotate_right_left: 45 }, "keep the red scarf")).toBe("将镜头向左旋转45度 Rotate the camera 45 degrees to the left. keep the red scarf");
  });

  it("is an Original on both engines: the 2509 graph with the LoRA on your GPU, fal's LoRA gallery route in the cloud", () => {
    const m = getModel("fuobe-angles")!;
    expect(m.engines).toEqual(["open", "cloud"]);
    const open = view("fuobe-angles", "open");
    const cloud = view("fuobe-angles", "cloud");
    expect(open.routes.map((r) => r.endpoint)).toEqual(["qwen-image-edit-2509-angles"]);
    expect(cloud.routes.map((r) => r.endpoint)).toEqual(["fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles"]);
    // Higgsfield's controls on both engines: rotate −90…90°, tilt −1…1, move forward 0–10 (the research's fields).
    expect(m.options.sliders?.map((s) => [s.param, s.min, s.max])).toEqual([["rotate_right_left", -90, 90], ["vertical_angle", -1, 1], ["move_forward", 0, 10]]);
    // The LoRA is the recipe's on the GPU (downloaded before a run, switchable); fal has it built in at 1.25, 6 steps.
    expect(open.options.loras?.map((l) => [l.file, l.strength])).toEqual([["qwen-edit-2509-multiple-angles-dx8152.safetensors", 1.25]]);
    expect(cloud.options.loras).toBeUndefined();
    const record = research.studios.find((s: { id: string }) => s.id === "angles").original;
    expect(cloud.routes[0].map?.defaults).toEqual(record.cloud.defaults);
    expect(cloud.routes[0].map?.prompt).toBe(false);
  });

  it("the Angles app keeps its 2511 recipe until the angles eval suite promotes Fuobe Angles: results made before O11 run again", () => {
    const angles = getPreset("app-angles")!;
    expect([angles.cloud?.modelId, angles.open?.modelId]).toEqual(["qwen-multiple-angles", "oss-qwen-edit"]);
    expect(angles.open?.loras).toEqual([tools.ANGLES_2511_LORA]);
    // A stored Angles request (Retry, Reuse, an API client's script) plans as it did, on both engines.
    const old = { feature: "app:app-angles", presetId: "app-angles", op: "edit" as const, inputs: { images: ["/api/files/a.png"] }, presetOptions: { angle: "back-left", height: "high-angle", distance: "close-up" } };
    expect(plan({ ...old, modelId: "qwen-multiple-angles" }, "cloud").params.extra).toMatchObject({ horizontal_angle: 225, vertical_angle: 60, zoom: 10 });
    expect(previewGeneration({ ...old, modelId: "qwen-multiple-angles" }).model.id).toBe("qwen-multiple-angles");
    expect(previewGeneration({ ...old, modelId: "oss-qwen-edit" }).model.id).toBe("oss-qwen-edit");
    expect(plan({ ...old, modelId: "oss-qwen-edit" }, "open").prompt).toMatch(/^<sks> back-left quarter view high-angle shot close-up/);
    expect(createGenerations({ ...old, modelId: "qwen-multiple-angles" })).toHaveLength(1);
    // Fuobe Angles is its own app next to it, marked as not yet measured; the suite that measures it is in place.
    const fuobe = getPreset("app-fuobe-angles")!;
    expect([fuobe.cloud?.modelId, fuobe.open?.modelId, fuobe.category]).toEqual(["fuobe-angles", "fuobe-angles", angles.category]);
    expect(fuobe.badges).toContain("beta");
    const suite = JSON.parse(fs.readFileSync(path.join(__dirname, "../scripts/eval/cases/angles.json"), "utf8"));
    expect(suite).toMatchObject({ original: "fuobe-angles", defaults: { candidate: "recipe" } });
    expect(Object.keys(suite.variants)).toEqual(["recipe", "today-open", "today-cloud"]);
  });

  it("the Fuobe Angles app turns its picks into fal's fields in the cloud and the LoRA's words on your GPU", async () => {
    const req = { feature: "app:app-fuobe-angles", modelId: "fuobe-angles", presetId: "app-fuobe-angles", prompt: "keep the logo", inputs: { images: ["/a.png"] }, presetOptions: { rotate: "90-right", height: "from-above", distance: "close-up", lens: "wide" } };
    const open = plan(req, "open");
    expect(open.prompt).toBe(
      "将镜头向右旋转90度 Rotate the camera 90 degrees to the right. 将镜头转为特写镜头 Turn the camera to a close-up. 将相机转向鸟瞰视角 Turn the camera to a bird's-eye view. 将镜头转为广角镜头 Turn the camera to a wide-angle lens. keep the logo",
    );
    expect(open.loras.map((l) => l.file)).toEqual(["qwen-edit-2509-multiple-angles-dx8152.safetensors"]);
    const cloud = plan(req, "cloud");
    expect(cloud.prompt).toBe("");
    expect(cloud.params.extra).toMatchObject({ rotate_right_left: -90, vertical_angle: -1, move_forward: 10, wide_angle_lens: true });
    expect(cloud.notes?.join(" ")).toMatch(/takes no words/);
    // The app's default turns the camera 45° left; an unmoved camera is refused before anything runs.
    expect(plan({ ...req, presetOptions: undefined }, "cloud").params.extra).toMatchObject({ rotate_right_left: 45 });
    expect(() => plan({ ...req, presetOptions: { rotate: "front" } }, "cloud")).toThrow(/Move the camera first/);
    // fal's payload: the fields as they are, the LoRA scale and steps from the research, no prompt.
    setSetting("falKey", "fal_test_key_123456");
    try {
      const model = view("fuobe-angles", "cloud");
      const sent = await submit(model, model.routes[0], { prompt: "", images: ["https://x/a.png"], extra: cloud.params.extra, seed: 3 });
      expect(sent.url).toMatch(/fal-ai\/qwen-image-edit-2509-lora-gallery\/multiple-angles$/);
      expect(sent.body).toMatchObject({ image_urls: ["https://x/a.png"], rotate_right_left: -90, vertical_angle: -1, move_forward: 10, wide_angle_lens: true, lora_scale: 1.25, num_inference_steps: 6, seed: 3 });
      expect(sent.body.prompt).toBeUndefined();
    } finally {
      setSetting("falKey", "");
    }
  });

  it("the GPU graph: Lightning, then the Multiple-angles LoRA at 1.25, 6 steps, the words as the instruction", async () => {
    const wf = await prepare(
      "qwen-image-edit-2509-angles",
      { prompt: tools.anglesWords({ rotate_right_left: 45 }), images: ["a.png"], loras: tools.ANGLES_LORA ? [tools.ANGLES_LORA] : [] },
      "edit",
    );
    const loras = Object.fromEntries(Object.entries(wf).filter(([, n]) => n.class_type === "LoraLoaderModelOnly").map(([id, n]) => [String(n.inputs.lora_name), { id, strength: n.inputs.strength_model, from: n.inputs.model }]));
    // The recipe's LoRA is the graph's own: not loaded twice. Lightning on the model, the Multiple-angles LoRA after it.
    expect(Object.keys(loras).sort()).toEqual(["Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors", "qwen-edit-2509-multiple-angles-dx8152.safetensors"]);
    expect(loras["qwen-edit-2509-multiple-angles-dx8152.safetensors"]).toMatchObject({ strength: 1.25, from: [loras["Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors"].id, 0] });
    expect(wf["433:111"].inputs.prompt).toBe("将镜头向左旋转45度 Rotate the camera 45 degrees to the left.");
    expect(wf["433:436"].inputs.value).toBe(6);
    expect(wf["78"].inputs.image).toBe("a.png");
  });

  it("asks fal for about 1 megapixel in the photo's shape, as it's priced and as the GPU graph scales it", async () => {
    // Without a size fal draws (and bills) the photo's own: a 12-megapixel phone photo would cost 12 times the price shown.
    const photo = saveFile({ data: png(400, 300, () => [120, 80, 40]), contentType: "image/png", source: "upload" });
    const submit = mockProvider.submit;
    const seen: GenInput[] = [];
    mockProvider.submit = async (ctx) => {
      if (ctx.model.id === "fuobe-angles") seen.push(ctx.input);
      return submit(ctx);
    };
    try {
      createGenerations({ feature: "app:app-fuobe-angles", presetId: "app-fuobe-angles", modelId: "fuobe-angles", engine: "cloud", inputs: { images: [photo.url] } });
      for (let i = 0; i < 200 && !seen.length; i++) await sleep(25);
      expect(seen[0]?.extra).toMatchObject({ rotate_right_left: 45, image_size: { width: 1184, height: 880 } });
    } finally {
      mockProvider.submit = submit;
    }
    // Priced for the size it asks for; a size the caller sends is kept.
    setSetting("falKey", "fal_test_key_123456");
    try {
      const ask = (extra: Record<string, unknown>) => previewGeneration({ feature: "image", modelId: "fuobe-angles", engine: "cloud", op: "edit", inputs: { images: [photo.url] }, params: { extra } }).costUsd;
      expect(ask({ rotate_right_left: 45 })).toBeCloseTo(0.035, 3);
      expect(ask({ rotate_right_left: 45, image_size: { width: 2048, height: 2048 } })).toBeCloseTo(0.14, 3);
    } finally {
      setSetting("falKey", "");
    }
  });
});

describe("Fuobe Speak", () => {
  it("is InfiniteTalk on both engines and Speak · Motion is Wan 2.2 S2V, each as long as the voice", () => {
    expect(view("fuobe-speak", "open").routes.map((r) => r.endpoint)).toEqual(["infinitetalk-wanwrapper"]);
    expect(view("fuobe-speak", "cloud").routes.map((r) => r.endpoint)).toEqual(["fal-ai/infinitalk"]);
    expect(view("fuobe-speak-motion", "open").routes.map((r) => r.endpoint)).toEqual(["wan22-s2v-14b"]);
    expect(view("fuobe-speak-motion", "cloud").routes.map((r) => r.endpoint)).toEqual(["fal-ai/wan/v2.2-14b/speech-to-video"]);
    // fal's InfiniteTalk renders 25 fps frames (41–721): 6 s of voice is 150; S2V 16 fps, a multiple of 4 up to 120.
    const it = view("fuobe-speak", "cloud").routes[0].map!.numFrames!;
    expect(numFramesValue(it, { sourceDuration: 6 })).toBe(150);
    expect(numFramesValue(it, { sourceDuration: 60 })).toBe(721);
    const s2v = view("fuobe-speak-motion", "cloud").routes[0].map!.numFrames!;
    expect(numFramesValue(s2v, { sourceDuration: 5.1 })).toBe(80);
    expect(numFramesValue(s2v, { sourceDuration: 1 })).toBe(40);
    expect(numFramesValue(s2v, { sourceDuration: 30 })).toBe(120);
    // The hosted InfiniteTalk used to be sent seconds as num_frames: it follows the voice now too.
    expect(getModel("infinitetalk-cloud")!.routes[0].map?.numFrames).toMatchObject({ key: "num_frames", fps: 25 });
    // Prices before a run: $0.20 a second (InfiniteTalk); $0.10 / $0.15 / $0.20 by resolution (S2V).
    expect(estimateCost(view("fuobe-speak", "cloud"), { duration: 10 })).toBeCloseTo(2, 5);
    expect(estimateCost(view("fuobe-speak-motion", "cloud"), { duration: 5, resolution: "720p" })).toBeCloseTo(1, 5);
    expect(estimateCost(view("fuobe-speak", "open"), { duration: 10 })).toBe(0);
  });

  it("prices a talking avatar for its voice, as fal bills the frames it renders", () => {
    const speak = view("fuobe-speak", "cloud");
    // The Lipsync studio sends no duration: without the voice's length it's the 5 s guess; with it, the voice's seconds.
    expect(estimateCost(speak, {}, 1, "avatar")).toBeCloseTo(1, 5);
    expect(estimateCost(speak, { sourceDuration: 25 }, 1, "avatar")).toBeCloseTo(5, 5);
    // Past fal's 721 frames (28.84 s) it renders, and bills, 721.
    expect(estimateCost(speak, { sourceDuration: 40 }, 1, "avatar")).toBeCloseTo(5.768, 3);
    // Wan 2.2 S2V: frames ÷ 16 video seconds, a multiple of 4 frames, 120 at most (7.5 s).
    const motion = view("fuobe-speak-motion", "cloud");
    expect(estimateCost(motion, { sourceDuration: 7.5, resolution: "720p" }, 1, "avatar")).toBeCloseTo(1.5, 5);
    expect(estimateCost(motion, { sourceDuration: 30, resolution: "480p" }, 1, "avatar")).toBeCloseTo(0.75, 5);
    // Partner avatars bill the voice's seconds too.
    expect(estimateCost(getModel("kling-avatar-2")!, { sourceDuration: 12 }, 1, "avatar")).toBeCloseTo(1.38, 5);
    // Lip re-sync of a clip isn't priced by the voice.
    expect(estimateCost(speak, { sourceDuration: 25 }, 1, "lipsync")).toBeCloseTo(1, 5);
  });

  it("says when fal stops a voice short, and prices the run for the voice once the server reads its header", async () => {
    setSetting("falKey", "fal_test_key_123456");
    try {
      const p = previewGeneration({ feature: "lipsync", modelId: "fuobe-speak", engine: "cloud", inputs: { images: ["/api/files/p.png"], audio: "/api/files/v.wav" }, params: { sourceDuration: 40 } });
      expect(p.costUsd).toBeCloseTo(5.768, 3);
      expect(p.notes?.join(" ")).toMatch(/makes up to 29 s a call, so this one stops 29 s into the 40 s voice/);
      expect(previewGeneration({ feature: "lipsync", modelId: "fuobe-speak", engine: "cloud", inputs: { images: ["/api/files/p.png"], audio: "/api/files/v.wav" }, params: { sourceDuration: 12 } }).notes ?? []).not.toContainEqual(expect.stringMatching(/stops/));
    } finally {
      setSetting("falKey", "");
    }
    // An API call that didn't say how long the voice is: priced for the voice when submit reads its header.
    const wav = (seconds: number) => {
      const rate = 8000;
      const data = Buffer.alloc(rate * seconds * 2);
      const head = Buffer.alloc(44);
      head.write("RIFF", 0);
      head.writeUInt32LE(36 + data.length, 4);
      head.write("WAVEfmt ", 8);
      head.writeUInt32LE(16, 16);
      head.writeUInt16LE(1, 20);
      head.writeUInt16LE(1, 22);
      head.writeUInt32LE(rate, 24);
      head.writeUInt32LE(rate * 2, 28);
      head.writeUInt16LE(2, 32);
      head.writeUInt16LE(16, 34);
      head.write("data", 36);
      head.writeUInt32LE(data.length, 40);
      return Buffer.concat([head, data]);
    };
    const voice = saveFile({ data: wav(12), contentType: "audio/wav", source: "upload" });
    const face = saveFile({ data: png(64, 64, () => [200, 160, 140]), contentType: "image/png", source: "upload" });
    setSetting("falKey", "fal_test_key_123456");
    const real = globalThis.fetch;
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).includes("fal-ai/infinitalk")) bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ request_id: "r1", status_url: "https://queue.fal.test/s", response_url: "https://queue.fal.test/r", cancel_url: "https://queue.fal.test/c", file_url: "https://v3.fal.media/files/x", upload_url: "https://upload.fal.test/u" }), { status: 200 });
    }) as typeof fetch;
    const { falProvider: fal } = await import("@/server/providers/fal");
    const upload = fal.prepareFile;
    fal.prepareFile = async (_d, _t, name) => `https://v3.fal.media/files/${name}`;
    try {
      const [g] = createGenerations({ feature: "lipsync", modelId: "fuobe-speak", engine: "cloud", inputs: { images: [face.url], audio: voice.url } });
      expect(g.costUsd).toBeCloseTo(1, 5);
      for (let i = 0; i < 200 && !bodies.length; i++) await sleep(25);
      expect(bodies[0]).toMatchObject({ num_frames: 300 });
      for (let i = 0; i < 100 && getGeneration(g.id)!.costUsd !== 2.4; i++) await sleep(25);
      expect(getGeneration(g.id)!.costUsd).toBeCloseTo(2.4, 5);
      // Nothing is listening at fal's test queue: stop the job here so the runner doesn't keep polling it.
      db().prepare("UPDATE generations SET status = 'canceled' WHERE id = ?").run(g.id);
    } finally {
      globalThis.fetch = real;
      fal.prepareFile = upload;
      setSetting("falKey", "");
    }
  });

  it("on your GPU renders as long as the voice (not the graph's 20 s), and refuses one past its 40 s cap", async () => {
    const m = view("fuobe-speak", "open");
    const run = (input: Partial<GenInput>, media?: (name: string) => { duration?: number } | undefined) =>
      prepare("infinitetalk-wanwrapper", { prompt: tools.SPEAK_PROMPT, images: ["face.png"], audio: "voice.wav", loras: m.options.loras, extra: { ...m.routes[0].extra }, ...input }, "avatar", { loraSlot: true, media });
    expect((await run({ sourceDuration: 30 }))["270"].inputs.value).toBe(753);
    // The voice's header when the run doesn't say.
    expect((await run({}, (name) => (name === "voice.wav" ? { duration: 8 } : undefined)))["270"].inputs.value).toBe(201);
    await expect(run({ sourceDuration: 45 })).rejects.toThrow(/A talking avatar on the open engine takes up to 40 s of speech per job \(this voice is 45 s\)/);
  });

  it("sends Higgsfield's Infinite Talk settings on your GPU: FusioniX in the wrapper's LoRA slot, 15 motion frames, 25 steps, shift 10, guidance 5 / 5", async () => {
    const m = view("fuobe-speak", "open");
    expect(m.options.loras?.map((l) => l.file)).toEqual(["Wan2.1_I2V_14B_FusionX_LoRA.safetensors"]);
    const route = m.routes[0];
    expect(route.extra).toEqual(tools.SPEAK_GRAPH);
    const record = research.studios.find((s: { id: string }) => s.id === "speak").original.open.defaults;
    expect(route.extra).toMatchObject({ motionFrame: record.motionFrame, steps: record.steps, shift: record.shift, cfg: record.cfg, audioCfg: record.audioCfg, scheduler: record.scheduler });
    // The provider merges the route's settings under the run's own (a run that asks for 30 steps gets 30).
    expect(route.loraSlot).toBe(true);
    const run = async (extra?: Record<string, unknown>) =>
      prepare("infinitetalk-wanwrapper", { prompt: tools.SPEAK_PROMPT, images: ["face.png"], audio: "voice.wav", loras: m.options.loras, extra: { ...route.extra, ...extra } }, "avatar", { loraSlot: true });
    const wf = await run();
    expect(wf["138"].inputs).toMatchObject({ lora: "Wan2.1_I2V_14B_FusionX_LoRA.safetensors", strength: 1 });
    expect(wf["128"].inputs).toMatchObject({ steps: 25, cfg: 5, shift: 10, scheduler: "unipc" });
    expect(wf["192"].inputs).toMatchObject({ motion_frame: 15, colormatch: "reinhard", mode: "infinitetalk" });
    expect(wf["194"].inputs.audio_cfg_scale).toBe(5);
    expect((await run({ steps: 30 }))["128"].inputs.steps).toBe(30);
    // The solver and colour match it sends are ones the wrapper's nodes take (object_info, the validation server's).
    const subset = JSON.parse(fs.readFileSync(path.join(__dirname, "../workflows/comfyui/object_info.subset.json"), "utf8"));
    expect(subset.WanVideoSampler.input.required.scheduler[0]).toContain("unipc");
    expect(subset.WanVideoImageToVideoMultiTalk.input.required.colormatch[0]).toContain("reinhard");
    // The graph's own defaults stay the fast lightx2v pass (InfiniteTalk Long runs it as before).
    const plain = await prepare("infinitetalk-wanwrapper", { prompt: "talk", images: ["face.png"], audio: "voice.wav" }, "avatar");
    expect(plain["138"].inputs.lora).toBe("lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors");
    expect(plain["128"].inputs.steps).toBe(6);
    // Two LoRAs don't fit the wrapper's one slot.
    await expect(prepare("infinitetalk-wanwrapper", { prompt: "talk", images: ["f.png"], audio: "v.wav", loras: [{ file: "a.safetensors" }, { file: "b.safetensors" }] }, "avatar", { loraSlot: true })).rejects.toThrow(/takes one LoRA/);
    // InfiniteTalk Long (the same graph, tuned for its lightx2v distill LoRA: 6 steps, guidance 1) refuses a LoRA rather
    // than swap it out under those settings.
    expect(getModel("oss-infinitetalk-long")!.routes[0]).toMatchObject({ endpoint: "infinitetalk-wanwrapper" });
    expect(getModel("oss-infinitetalk-long")!.routes[0].loraSlot).toBeUndefined();
    await expect(prepare("infinitetalk-wanwrapper", { prompt: "talk", images: ["f.png"], audio: "v.wav", loras: [{ file: "my-character-wan21.safetensors", strength: 0.8 }] }, "avatar")).rejects.toThrow(/can't take LoRAs/);
  });

  it("runs without words, in the portrait's shape on your GPU", () => {
    const open = plan({ feature: "lipsync", modelId: "fuobe-speak", inputs: { images: ["/p.png"], audio: "/v.wav" } }, "open");
    expect(open.prompt).toBe(tools.SPEAK_PROMPT);
    expect(open.params.aspectRatio).toBe("auto");
    expect(open.loras.map((l) => l.file)).toEqual(["Wan2.1_I2V_14B_FusionX_LoRA.safetensors"]);
    const cloud = plan({ feature: "lipsync", modelId: "fuobe-speak", inputs: { images: ["/p.png"], audio: "/v.wav" } }, "cloud");
    expect(cloud.loras).toEqual([]);
    expect(cloud.prompt).toBe(tools.SPEAK_PROMPT);
  });

  it("lists FusioniX and the Multiple-angles LoRA with their licences in Settings → Models & licences", () => {
    const list = accessList();
    const fusionix = list.loras.find((l) => l.file === "Wan2.1_I2V_14B_FusionX_LoRA.safetensors")!;
    expect(fusionix).toMatchObject({ group: "adapter", on: true, licence: { name: "Apache-2.0", class: "commercial" } });
    expect(fusionix.licence.note).toMatch(/merges other LoRAs.*not checked/);
    expect(list.models.find((m) => m.id === "oss-video-depth-vda-large")).toMatchObject({ on: true, licence: { class: "non-commercial" } });
    expect(list.models.find((m) => m.id === "fuobe-speak")).toBeTruthy();
  });

  it("says what each engine runs: the GPU adds FusioniX, the cloud runs fal's InfiniteTalk without it", () => {
    const speak = getModel("fuobe-speak")!;
    // The model menu's line on both engines.
    for (const e of ["open", "cloud"] as const) expect(view("fuobe-speak", e).tagline).toMatch(/InfiniteTalk \+ the FusioniX LoRA free on your GPU \(16 GB\), or fal's InfiniteTalk without the LoRA$/);
    expect(speak.name).toBe("Fuobe Speak");
    // Settings → Models & licences.
    const entry = accessList().models.find((m) => m.id === "fuobe-speak")!;
    expect(entry.engineNote).toBe("Your GPU adds FusioniX to InfiniteTalk; the cloud runs InfiniteTalk without it");
    // No hosted InfiniteTalk takes a LoRA (fal's three endpoints, checked): the research says so, and the cloud route has no LoRA field.
    const research = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/research/fuobe-originals-recipes-5.json"), "utf8"));
    expect(research.studios.find((s: { id: string }) => s.id === "speak").original.cloud.loraCheck.result).toMatch(/no hosted InfiniteTalk takes a LoRA/);
    expect(view("fuobe-speak", "cloud").routes[0].map?.loras).toBeUndefined();
    expect(view("fuobe-speak", "cloud").routes[0].loraEndpoint).toBeUndefined();
    // Evolution and Marketing Image say theirs too; a model whose engines match says nothing.
    expect(accessList().models.find((m) => m.id === "fuobe-evolution")?.engineNote).toMatch(/^Both engines run Wan 2\.2 Fun VACE/);
    expect(accessList().models.find((m) => m.id === "fuobe-marketing-image")?.engineNote).toMatch(/Standalone shot .* on your GPU only/);
    expect(accessList().models.find((m) => m.id === "fuobe-speak-motion")?.engineNote).toBeUndefined();
  });
});

describe("Depth Map and Upscale routes", () => {
  it("offers Video Depth Anything Large on your GPU, its licence recorded as non-commercial, without making it the default", async () => {
    const m = getModel("oss-video-depth-vda-large")!;
    expect(m.tagline).not.toMatch(/non-commercial/);
    const wf = await prepare("video-depth-vda-large", { video: "clip.mp4", colormap: "inferno" }, "depth-video");
    expect(Object.values(wf).find((n) => n.class_type === "LoadVideoDepthAnythingModel")?.inputs.model).toBe("video_depth_anything_vitl.pth");
    expect(licenceInfo(getWorkflow("video-depth-vda-large").manifest.license ?? "").class).toBe("non-commercial");
    const { VIDEO_DEPTH_STUDIO } = await import("@/lib/studios");
    expect(VIDEO_DEPTH_STUDIO.defaultModels).toEqual({ cloud: "depth-anything-video-cloud", open: "oss-video-depth-vda" });
  });

  it("SDR to HDR on fal switches to the /lora endpoint when a LoRA rides along", () => {
    const r = getModel("ltx-2-3-hdr")!.routes[0];
    expect(r.loraEndpoint).toBe("fal-ai/ltx-2.3-quality/hdr/lora");
    expect(r.map?.loras).toMatchObject({ key: "loras", max: 3, required: true });
  });
});

describe("Soul's face mosaic", () => {
  it("PixeletedFace asks for it; other looks and Soul Cinema don't", () => {
    expect(soulLook("v1-pixeletedface")?.post).toBe("face-mosaic");
    expect(soulPostStep("fuobe-soul", "v1-pixeletedface")).toBe("face-mosaic");
    expect(soulPostStep("fuobe-soul", "v1-general")).toBeUndefined();
    expect(soulPostStep("fuobe-soul-cinema", "v1-pixeletedface")).toBeUndefined();
    expect(tools.faceMosaicStep("open")).toEqual({ modelId: "oss-face-mosaic", op: "face-mosaic", prompt: "face" });
    expect(tools.faceMosaicStep("cloud").modelId).toBe("sam-3-1-face-mask");
  });

  it("chains the picture and the mosaic on the engine it runs on, one pair per picture", () => {
    for (const engine of ["open", "cloud"] as const) {
      const made = createGenerations({ feature: "image", modelId: "fuobe-soul", prompt: "a skater", engine, presetId: "v1-pixeletedface", params: { numOutputs: 2 } });
      expect(made).toHaveLength(4);
      const steps = made.map((g) => getGeneration(g.id)!).map((g) => [g.modelId, g.op, g.request?.step?.label]);
      expect(steps).toEqual(
        expect.arrayContaining([
          ["fuobe-soul", "t2i", "Before the face mosaic 1 of 2"],
          [tools.FACE_MOSAIC_MODELS[engine], "face-mosaic", "Face mosaic 1 of 2"],
          ["fuobe-soul", "t2i", "Before the face mosaic 2 of 2"],
          [tools.FACE_MOSAIC_MODELS[engine], "face-mosaic", "Face mosaic 2 of 2"],
        ]),
      );
      expect(new Set(made.map((g) => g.batchId)).size).toBe(1);
    }
    // Another look runs as one job.
    expect(createGenerations({ feature: "image", modelId: "fuobe-soul", prompt: "a skater", engine: "cloud", presetId: "v1-general" })).toHaveLength(1);
  });

  it("gives each picture its own seed, as a batch does, and puts the mosaics first for whoever takes the first result", () => {
    for (const engine of ["open", "cloud"] as const) {
      const made = createGenerations({ feature: "image", modelId: "fuobe-soul", prompt: "a skater", engine, presetId: "v1-pixeletedface", params: { numOutputs: 3, seed: 42 } });
      const pictures = made.map((g) => getGeneration(g.id)!).filter((g) => g.modelId === "fuobe-soul");
      expect(pictures.map((g) => g.request?.params?.seed)).toEqual([42, 43, 44]);
      expect(pictures.every((g) => g.request?.postMade === true && g.request.params?.numOutputs === 1)).toBe(true);
      expect(made.slice(0, 3).map((g) => g.modelId)).toEqual(Array(3).fill(tools.FACE_MOSAIC_MODELS[engine]));
    }
    // Retrying the picture step alone doesn't start another mosaic.
    const [first] = createGenerations({ feature: "image", modelId: "fuobe-soul", prompt: "a skater", engine: "cloud", presetId: "v1-pixeletedface" });
    expect(getGeneration(first.id)!.op).toBe("face-mosaic");
    const before = createGenerations({ feature: "image", modelId: "fuobe-soul", prompt: "a skater", engine: "cloud", presetId: "v1-pixeletedface", postMade: true });
    expect(before.map((g) => g.modelId)).toEqual(["fuobe-soul"]);
  });

  it("pixelates in a pipeline step or a Canvas node too: the step waits with its picture, the next one gets the mosaic", () => {
    const dependsOn = (id: string) => {
      const v = (db().prepare("SELECT depends_on FROM generations WHERE id = ?").get(id) as { depends_on: string | null }).depends_on;
      return !v ? [] : v.startsWith("[") ? (JSON.parse(v) as string[]) : [v];
    };
    // A pipeline: a PixeletedFace picture, then an upscale of it.
    const { byKey, items } = createPipeline([
      { key: "face", request: { feature: "image", modelId: "fuobe-soul", prompt: "a skater", engine: "cloud", presetId: "v1-pixeletedface" } },
      { key: "big", request: { feature: "upscale", modelId: "topaz-image", op: "upscale-image" }, after: "face", chain: [{ slot: "images" }] },
    ]);
    expect(byKey.face.modelId).toBe("sam-3-1-face-mask");
    expect(byKey.face.op).toBe("face-mosaic");
    expect(dependsOn(byKey.big.id)).toEqual([byKey.face.id]);
    const picture = items.find((g) => g.modelId === "fuobe-soul")!;
    expect(dependsOn(byKey.face.id)).toEqual([picture.id]);
    // A Canvas node that waits for a text node: the picture waits for it, the mosaic for the picture.
    const [text] = createGenerations({ feature: "image", modelId: "nano-banana-pro", prompt: "a fox" });
    const made = createGenerations(
      { feature: "canvas", modelId: "fuobe-soul", prompt: "{text}", engine: "open", presetId: "v1-pixeletedface", chain: [{ slot: "prompt" }], step: { label: "Portrait", index: 1, of: 2 } },
      { dependsOn: text.id, batchId: "canvas-run" },
    );
    const [m, p] = made.map((g) => getGeneration(g.id)!);
    expect([m.modelId, p.modelId]).toEqual(["oss-face-mosaic", "fuobe-soul"]);
    expect(dependsOn(p.id)).toEqual([text.id]);
    expect(dependsOn(m.id)).toEqual([p.id]);
    expect(made.every((g) => g.batchId === "canvas-run")).toBe(true);
    expect([p.request?.step?.label, m.request?.step?.label]).toEqual(["Portrait · before the face mosaic", "Portrait"]);
  });

  it("the GPU graph: SAM 3.1 on the words ('face' by default), the mask grown, a 25 px mosaic under it", async () => {
    const p = plan({ feature: "image", modelId: "oss-face-mosaic", op: "face-mosaic", inputs: { images: ["/a.png"] } }, "open");
    expect(p.prompt).toBe("face");
    const wf = await prepare("image-face-mosaic-sam3", { prompt: p.prompt, images: ["a.png"] }, "face-mosaic");
    expect(wf["1"].inputs.image).toBe("a.png");
    expect(wf["3"].inputs.text).toBe("face");
    expect(wf["7"].inputs.scale_by).toBe(tools.MOSAIC_SCALE);
    expect(wf["9"].inputs.mask).toEqual(["5", 0]);
  });

  it("the cloud step: fal's SAM 3.1 masks, all of them in one answer, and the browser's finish for a picture the server can't read", async () => {
    const m = getModel("sam-3-1-face-mask")!;
    expect(m.hidden).toBe(true);
    setSetting("falKey", "fal_test_key_123456");
    try {
      const sent = await submit(m, m.routes[0], { prompt: "face", images: ["https://x/a.png"] });
      expect(sent.url).toMatch(/fal-ai\/sam-3-1\/image$/);
      expect(sent.body).toMatchObject({ image_url: "https://x/a.png", prompt: "face", apply_mask: false, return_multiple_masks: true, max_masks: 16, output_format: "png" });
    } finally {
      setSetting("falKey", "");
    }
    const out = extractOutputs({ masks: [{ url: "https://f/m1.png", content_type: "image/png" }, { url: "https://f/m2.png" }], image: { url: "https://f/preview.png" } }, "face-mosaic");
    expect(out).toEqual([{ url: "https://f/m1.png", kind: "image", contentType: "image/png", meta: { role: "mask", masks: ["https://f/m1.png", "https://f/m2.png"] } }]);
    // No face found is an answer (the picture stays as it is); no answer at all is no result.
    expect(extractOutputs({ masks: [] }, "face-mosaic")).toEqual([{ url: "", kind: "image", meta: { role: "mask", masks: [] } }]);
    expect(extractOutputs({ detail: "nope" }, "face-mosaic")).toEqual([]);
    // What the server writes on a picture it couldn't decode (meta.mosaic) is a finish the browser does once.
    const steps = finishSteps({ kind: "image", meta: { role: "mask", mosaic: { source: "/api/files/a.png", masks: ["/api/files/m1.png"] } } });
    expect(steps).toEqual({ mosaic: { source: "/api/files/a.png", masks: ["/api/files/m1.png"], scale: tools.MOSAIC_SCALE } });
    expect(finishSteps({ kind: "image", meta: { finished: true, mosaic: { source: "/a.png", masks: ["/m.png"] } } })).toBeNull();
  });

  it("the server pixelates fal's answer: a finished picture for the Library, share links, Canvas and API clients", { timeout: 60_000 }, async () => {
    ensureRunner();
    const w = 60;
    const h = 30;
    const picture = saveFile({ data: png(w, h, (x, y) => [x < 30 ? 200 : 20, (x * 7 + y) % 255, 90]), contentType: "image/png", source: "upload" });
    const mask = (x0: number, y0: number) => dataUri(png(w, h, (x, y) => (x >= x0 && x < x0 + 3 && y >= y0 && y < y0 + 3 ? [255, 255, 255] : [0, 0, 0])));
    const answers: Record<string, () => { url: string; kind: "image"; contentType?: string; meta: Record<string, unknown> }[]> = {};
    const poll = mockProvider.poll;
    mockProvider.poll = async (ctx) => {
      const want = ctx.model.id === "sam-3-1-face-mask" ? answers[String(ctx.meta.prompt)] : undefined;
      return want ? { state: "succeeded", outputs: want() } : poll(ctx);
    };
    try {
      const run = async (prompt: string, image: string) => {
        const [g] = createGenerations({ feature: "image", modelId: "sam-3-1-face-mask", op: "face-mosaic", prompt, inputs: { images: [image] } });
        return settled(g.id);
      };
      // Two faces: blocks (0,0) and (2,1) of the 25 px grid.
      answers.faces = () => {
        const m = [mask(3, 3), mask(55, 26)];
        return [{ url: m[0], kind: "image", contentType: "image/png", meta: { role: "mask", masks: m } }];
      };
      const done = await run("faces", picture.url);
      expect(done.status, done.error ?? "").toBe("succeeded");
      const out = done.outputs[0];
      expect(out).toMatchObject({ kind: "image", contentType: "image/png", url: expect.stringMatching(/^\/api\/files\//) });
      expect(out.meta).toMatchObject({ faces: 2, masks: [expect.stringMatching(/^\/api\/files\//), expect.stringMatching(/^\/api\/files\//)] });
      expect(out.meta?.mosaic).toBeUndefined();
      expect(finishSteps(out)).toBeNull();
      const img = decodePng((await readRef(out.url)).data);
      const src = decodePng((await readRef(picture.url)).data);
      const at = (d: Buffer, x: number, y: number) => Array.from(d.subarray((y * w + x) * 4, (y * w + x) * 4 + 3));
      expect(at(img.data, 0, 0)).toEqual(at(img.data, 24, 24));
      expect(at(img.data, 0, 0)).not.toEqual(at(src.data, 0, 0));
      expect(at(img.data, 30, 5)).toEqual(at(src.data, 30, 5));
      expect(at(img.data, 50, 25)).toEqual(at(img.data, 59, 29));
      // No face: the picture as it is, as the GPU graph returns it.
      answers.none = () => [{ url: "", kind: "image", meta: { role: "mask", masks: [] } }];
      const none = await run("none", picture.url);
      expect(none.status, none.error ?? "").toBe("succeeded");
      expect(none.outputs[0].meta).toMatchObject({ faces: 0, masks: [] });
      expect(Array.from(decodePng((await readRef(none.outputs[0].url)).data).data)).toEqual(Array.from(src.data));
      // A picture the server can't decode (a JPEG from another route) is kept with the masks, for the browser to pixelate.
      const jpeg = saveFile({ data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]), contentType: "image/jpeg", source: "upload" });
      const left = await run("faces", jpeg.url);
      expect(left.status, left.error ?? "").toBe("succeeded");
      expect(left.outputs[0].contentType).toBe("image/jpeg");
      expect(finishSteps(left.outputs[0])).toEqual({ mosaic: { source: left.outputs[0].url, masks: left.outputs[0].meta?.masks, scale: tools.MOSAIC_SCALE } });
    } finally {
      mockProvider.poll = poll;
    }
  });

  it("pixelates whole blocks wherever a mask touches them, and nothing else", () => {
    const w = 60;
    const h = 30;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set([i % w < 30 ? 200 : 20, (i * 7) % 255, 0, 255], i * 4);
    const before = rgba.slice();
    const mask = (x0: number, y0: number) => {
      const m = new Uint8ClampedArray(w * h * 4);
      m.set([255, 255, 255, 255], (y0 * w + x0) * 4);
      return m;
    };
    // Two masks, one pixel each: blocks (0,0) and (2,1) of the 25 px grid (3 × 2 blocks over 60 × 30).
    const changed = mosaicPixels(rgba, unionMasks([mask(3, 3), mask(55, 28)]), w, h, tools.MOSAIC_SCALE);
    expect(changed).toBe(2);
    const at = (x: number, y: number, a = rgba) => Array.from(a.slice((y * w + x) * 4, (y * w + x) * 4 + 4));
    // Inside a block every pixel is the block's average; outside the touched blocks nothing moved.
    expect(at(0, 0)).toEqual(at(24, 24));
    expect(at(0, 0)[0]).toBe(200);
    expect(at(30, 5)).toEqual(at(30, 5, before));
    expect(at(26, 26)).toEqual(at(26, 26, before));
    expect(at(50, 25)).toEqual(at(59, 29));
  });

  it("the preview prices the Soul picture and its mosaic step: $0.01 a picture in the cloud, free on your GPU", () => {
    expect(estimateCost(getModel("sam-3-1-face-mask")!, {})).toBeCloseTo(0.01, 5);
    expect(estimateCost(getModel("oss-face-mosaic")!, {})).toBe(0);
    expect(previewGeneration({ feature: "image", modelId: "oss-face-mosaic", op: "face-mosaic", inputs: { images: ["/a.png"] } }).op).toBe("face-mosaic");
    // The server's preview (CLI, MCP, Assist, Canvas estimates) counts the step, as the composer does.
    setSetting("falKey", "fal_test_key_123456");
    try {
      const look = { feature: "image", modelId: "fuobe-soul", prompt: "a skater", engine: "cloud" as const, params: { numOutputs: 2 } };
      const plain = previewGeneration({ ...look, presetId: "v1-general" }).costUsd!;
      expect(previewGeneration({ ...look, presetId: "v1-pixeletedface" }).costUsd).toBeCloseTo(plain + 0.02, 5);
      expect(previewGeneration({ ...look, presetId: "v1-pixeletedface", postMade: true }).costUsd).toBeCloseTo(plain, 5);
    } finally {
      setSetting("falKey", "");
    }
  });

  it("the Image studio knows the mosaic step's models before the full catalog loads, so its price counts the step", async () => {
    const { studioCatalog } = await import("@/lib/studio-catalog");
    const { IMAGE_STUDIO } = await import("@/lib/studios");
    const { postStepCost } = await import("@/lib/composer");
    const slice = studioCatalog(IMAGE_STUDIO);
    const known = new Map([...slice.models, ...(slice.lookup ?? [])].map((m) => [m.id, m]));
    for (const id of Object.values(tools.FACE_MOSAIC_MODELS)) expect(known.has(id)).toBe(true);
    // The composer's lookup is that slice (the browser has nothing else until the model menu opens).
    const lookup = (engine: "open" | "cloud") => (id: string) => (known.get(id) ? onEngine(known.get(id)!, engine) : undefined);
    expect(postStepCost("fuobe-soul", "v1-pixeletedface", "cloud", 2, lookup("cloud"))).toBeCloseTo(0.02, 5);
    expect(postStepCost("fuobe-soul", "v1-pixeletedface", "open", 2, lookup("open"))).toBe(0);
    expect(postStepCost("fuobe-soul", undefined, "cloud", 2, lookup("cloud"))).toBe(0);
  });
});
