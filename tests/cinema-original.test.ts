import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ComfyWorkflow } from "@/lib/comfy";
import type { GenInput, LoraRef, ModelDef, ModelRoute } from "@/lib/catalog/types";
import type { DirectorSettings } from "@/lib/catalog/cinema";
import { tempDir } from "./helpers/temp-dir";

// Fuobe Cinema as a run (build plan O6): one model on both engines. In the cloud the payload fal receives (LTX-2.3 22B,
// prompt expansion off, camera_lora, exact sizes, frames at 24 fps, the plain endpoint unless a LoRA rides along) and its
// price; on the user's GPU the Wan 2.2 Lightning graphs, a Fun Camera pose on its graph and a camera LoRA injected.
const dir = tempDir("fuobe-cinema-original-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9"; // nothing listens here: open runs fall back to the demo

const { setSetting } = await import("@/server/settings");
const { previewGeneration } = await import("@/server/generations");
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const { falProvider } = await import("@/server/providers/fal");
const { getModel, modelsFor } = await import("@/lib/catalog");
const { onEngine } = await import("@/lib/catalog/engines");
const { estimateCost } = await import("@/lib/catalog/plan");
const { planCinema, CINEMA_MODEL, ORIGINAL_LINES, modelLine, CAMERA_MOVES, CINEMA_EDIT_STRENGTH, CINEMA_MAX_SECONDS, cinemaMoveRoute, editPrompt } = await import("@/lib/catalog/cinema");
const { needsToken } = await import("@/lib/catalog/loras");
const { finishedUrl } = await import("@/lib/soul-post");

beforeAll(() => setSetting("demoMode", "auto"));

const view = (engine: "open" | "cloud") => onEngine(getModel(CINEMA_MODEL)!, engine);
const fal = (op: string) => view("cloud").routes.find((r) => r.provider === "fal" && r.op === op)!;

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

const ctx = () => ({
  generationId: "g",
  op: "i2v" as const,
  upload: async (_d: Buffer, _t: string, name: string) => `up_${name}`,
  media: (() => undefined) as never,
  serverRam: async () => undefined,
});

/** fal bills LTX-2.3 per megapixel of video made (width × height × frames), rounded up. */
const videoMp = (w: number, h: number, frames: number) => Math.ceil((w * h * frames) / 1e6);

const LTX_LORA: LoraRef = {
  file: "my-ltx-style.safetensors",
  url: "https://huggingface.co/someone/ltx-style/resolve/main/my-ltx-style.safetensors",
  strength: 0.8,
  licence: { commercial: true, hostedOk: true, snapshotDate: "2026-10-26" },
};

describe("Fuobe Cinema on both engines", () => {
  it("is one model: Wan 2.2 Lightning on the GPU, LTX-2.3 on fal, listed for video on both engines", () => {
    const m = getModel(CINEMA_MODEL)!;
    expect(m.engines).toEqual(["open", "cloud"]);
    expect(view("open").routes.map((r) => [r.op, r.endpoint])).toEqual([
      ["t2v", "wan22-t2v-14b-lightx2v"],
      ["i2v", "wan22-i2v-14b-lightx2v"],
      ["flf2v", "wan22-flf2v-14b"],
    ]);
    expect(view("cloud").routes.map((r) => [r.op, r.endpoint, r.loraEndpoint])).toEqual([
      ["t2v", "fal-ai/ltx-2.3-22b/text-to-video", "fal-ai/ltx-2.3-22b/text-to-video/lora"],
      ["i2v", "fal-ai/ltx-2.3-22b/image-to-video", "fal-ai/ltx-2.3-22b/image-to-video/lora"],
      ["flf2v", "fal-ai/ltx-2.3-22b/image-to-video", "fal-ai/ltx-2.3-22b/image-to-video/lora"],
      ["extend", "fal-ai/ltx-2.3-22b/extend-video", "fal-ai/ltx-2.3-22b/extend-video/lora"],
      ["v2v", "fal-ai/ltx-2.3-22b/video-to-video", "fal-ai/ltx-2.3-22b/video-to-video/lora"],
    ]);
    expect(view("open").options).toMatchObject({ durations: [3, 5], resolutions: ["480p", "720p"], audio: false, multiShot: { mode: "concat" } });
    expect(view("cloud").options).toMatchObject({ resolutions: ["480p", "720p", "1080p"], audio: true });
    expect(view("cloud").options.durations).toContain(20);
    expect(view("open").defaults).toMatchObject({ resolution: "480p", duration: 5 });
    expect(view("cloud").defaults).toMatchObject({ resolution: "720p", duration: 5, aspectRatio: "16:9", generateAudio: true });
    for (const engine of ["open", "cloud"] as const) expect(modelsFor({ kind: "video", engine }).some((x) => x.id === CINEMA_MODEL)).toBe(true);
    expect(modelLine(view("open"), "open")).toBe(ORIGINAL_LINES[CINEMA_MODEL].open);
    expect(modelLine(getModel("kling-3")!, "cloud")).toBe(getModel("kling-3")!.tagline);
  });

  it("prices a take on fal's per-megapixel price: its tier and shape's size × its frames, rounded up; free on the GPU", () => {
    const cloud = view("cloud");
    // 5 s = 121 frames at 24 fps; fal bills width × height × frames in whole megapixels.
    expect(estimateCost(cloud, { duration: 5, resolution: "720p", aspectRatio: "16:9" })).toBeCloseTo(videoMp(1280, 704, 121) * 0.001605, 3);
    expect(estimateCost(cloud, { duration: 5, resolution: "480p", aspectRatio: "16:9" })).toBeCloseTo(videoMp(864, 480, 121) * 0.001605, 3);
    expect(estimateCost(cloud, { duration: 5, resolution: "1080p", aspectRatio: "16:9" })).toBeCloseTo(videoMp(1920, 1088, 121) * 0.001605, 3);
    // Each shape at its own size: 480p 21:9 is 1120 × 480 and 4:3 is 640 × 480, not the 16:9 frame.
    expect(estimateCost(cloud, { duration: 10, resolution: "480p", aspectRatio: "21:9" })).toBeCloseTo(videoMp(1120, 480, 241) * 0.001605, 3);
    expect(estimateCost(cloud, { duration: 10, resolution: "480p", aspectRatio: "4:3" })).toBeCloseTo(videoMp(640, 480, 241) * 0.001605, 3);
    expect(estimateCost(cloud, { duration: 10, resolution: "720p", aspectRatio: "21:9" })).toBeCloseTo(videoMp(1504, 640, 241) * 0.001605, 3);
    // The model's defaults fill a missing tier or shape (720p, 16:9).
    expect(estimateCost(cloud, { duration: 5 })).toBeCloseTo(videoMp(1280, 704, 121) * 0.001605, 3);
    // The /lora endpoint's rate when a LoRA rides along.
    expect(estimateCost(cloud, { duration: 5, resolution: "720p", aspectRatio: "16:9" }, 1, "t2v", true)).toBeCloseTo(videoMp(1280, 704, 121) * 0.001805, 3);
    expect(estimateCost(cloud, { duration: 5, resolution: "1080p", aspectRatio: "9:16" }, 2, "t2v", true)).toBeCloseTo(2 * videoMp(1088, 1920, 121) * 0.001805, 3);
    // The per-second table stays the 16:9 rate for display: 1280 × 704 × 24 frames per second at $0.001605 per megapixel.
    expect(cloud.pricing!.byResolution!["720p"]).toBeCloseTo((1280 * 704 * 24 * 0.001605) / 1e6, 4);
    expect(cloud.pricing!.videoMegapixel).toEqual({ usd: 0.001605, withLoras: 0.001805 });
    expect(estimateCost(view("open"), { duration: 5 })).toBe(0);
  });

  it("sends fal the plain LTX-2.3 endpoint with camera_lora, prompt expansion off and the tier's exact size", async () => {
    const plan = planCinema({ engine: "cloud", mode: "video", action: "generate", prompt: "a lighthouse at dusk", moves: ["truck-left"], settings: {}, images: ["/api/files/a.png"], duration: 8, resolution: "720p", aspectRatio: "9:16" }, { cloudAllowed: true });
    const req = plan.steps[0].request;
    expect(req.params!.extra).toEqual({ camera_lora: "dolly_left" });
    const { url, body } = await submit(view("cloud"), fal("i2v"), { ...req.params, prompt: req.prompt, images: ["https://x/a.png"] });
    expect(url).toMatch(/\/fal-ai\/ltx-2\.3-22b\/image-to-video$/);
    expect(body).toMatchObject({
      image_url: "https://x/a.png",
      camera_lora: "dolly_left",
      enable_prompt_expansion: false,
      generate_audio: true,
      num_frames: 193,
      video_size: { width: 704, height: 1280 },
    });
    expect(body.loras).toBeUndefined();
  });

  it("switches to the /lora endpoint when a LoRA rides along; a GPU-only LoRA stays home only when the admin keeps it there", async () => {
    const { url, body } = await submit(view("cloud"), fal("t2v"), { prompt: "x", duration: 5, resolution: "720p", aspectRatio: "16:9", loras: [LTX_LORA] });
    expect(url).toMatch(/\/fal-ai\/ltx-2\.3-22b\/text-to-video\/lora$/);
    expect(body.loras).toEqual([{ path: LTX_LORA.url, scale: 0.8 }]);
    const gpuOnly = { ...LTX_LORA, licence: { commercial: true, hostedOk: false, snapshotDate: "2026-10-26" } };
    const sent = await submit(view("cloud"), fal("t2v"), { prompt: "x", duration: 5, loras: [gpuOnly] });
    expect(sent.url).toMatch(/\/fal-ai\/ltx-2\.3-22b\/text-to-video\/lora$/);
    const local = { ...gpuOnly, keepOnGpu: true as const };
    const plain = await submit(view("cloud"), fal("t2v"), { prompt: "x", duration: 5, loras: [local] });
    expect(plain.url).toMatch(/\/fal-ai\/ltx-2\.3-22b\/text-to-video$/);
    expect(plain.body.loras).toBeUndefined();
  });

  it("an extend and an edit keep their source clip's size; the prequel extends backward", async () => {
    const ext = await submit(view("cloud"), fal("extend"), { prompt: "x", video: "https://x/take.mp4", duration: 10, resolution: "720p", aspectRatio: "16:9", extra: { extend_direction: "backward" } });
    expect(ext.url).toMatch(/\/fal-ai\/ltx-2\.3-22b\/extend-video$/);
    expect(ext.body).toMatchObject({ video_url: "https://x/take.mp4", num_frames: 241, extend_direction: "backward", enable_prompt_expansion: false });
    expect(ext.body.video_size).toBeUndefined();
    const edit = await submit(view("cloud"), fal("v2v"), { prompt: "make it snow", video: "https://x/take.mp4" });
    expect(edit.url).toMatch(/\/fal-ai\/ltx-2\.3-22b\/video-to-video$/);
    expect(edit.body).toMatchObject({ video_url: "https://x/take.mp4", enable_prompt_expansion: false });
    expect(edit.body.video_size).toBeUndefined();
  });

  it("previews on the engine asked for: priced on fal, free on the GPU", () => {
    const req = { feature: "cinema", modelId: CINEMA_MODEL, prompt: "a lighthouse at dusk", params: { duration: 5, resolution: "720p", aspectRatio: "16:9" } };
    // Demo mode is free; with a fal key the run is priced.
    expect(previewGeneration({ ...req, engine: "cloud" })).toMatchObject({ demo: true, costUsd: 0 });
    setSetting("falKey", "test-key");
    try {
      const cloud = previewGeneration({ ...req, engine: "cloud" });
      expect(cloud).toMatchObject({ engine: "cloud", demo: false, route: { provider: "fal", endpoint: "fal-ai/ltx-2.3-22b/text-to-video" } });
      expect(cloud.costUsd).toBeCloseTo(videoMp(1280, 704, 121) * 0.001605, 3);
    } finally {
      setSetting("falKey", "");
    }
    const open = previewGeneration({ ...req, engine: "open" });
    expect(open).toMatchObject({ engine: "open", costUsd: 0, route: { provider: "comfyui", endpoint: "wan22-t2v-14b-lightx2v" } });
  });
});

describe("Fuobe Cinema on the GPU", () => {
  it("runs a Fun Camera pose on its graph and a camera LoRA on the Lightning image-to-video graph", async () => {
    const posed = planCinema({ engine: "open", mode: "video", action: "generate", prompt: "a lighthouse at dusk", moves: ["pan-left"], settings: {}, images: ["/api/files/a.png"], duration: 5 }, { cloudAllowed: true });
    const p = posed.steps[0].request;
    expect(p.params!.extra).toEqual({ cameraMotion: "Pan Left" });
    const fun = await prepareWorkflow("wan22-i2v-14b-lightx2v", { ...p.params, prompt: p.prompt, images: ["up_a.png"], seed: 1 }, ctx());
    expect(fun.manifest.id).toBe("wan22-fun-camera-14b");
    expect(Object.values(fun.workflow as ComfyWorkflow).find((n) => n.class_type === "WanCameraEmbedding")!.inputs.camera_pose).toBe("Pan Left");

    const lora = planCinema({ engine: "open", mode: "video", action: "generate", prompt: "a lighthouse at dusk", moves: ["arc-left"], settings: {}, images: ["/api/files/a.png"], duration: 5 }, { cloudAllowed: true });
    const l = lora.steps[0].request;
    const wan = await prepareWorkflow("wan22-i2v-14b-lightx2v", { ...l.params, prompt: l.prompt, images: ["up_a.png"], loras: l.loras, seed: 1 }, ctx());
    expect(wan.manifest.id).toBe("wan22-i2v-14b-lightx2v");
    const injected = Object.values(wan.workflow as ComfyWorkflow)
      .filter((n) => n.class_type === "LoraLoaderModelOnly")
      .map((n) => n.inputs.lora_name);
    for (const f of l.loras!.map((x) => x.file)) expect(injected).toContain(f);
  });
});

describe("Fuobe Cinema edits, extends and casts (review fixes)", () => {
  const take = (over: Record<string, unknown> = {}) => ({ url: "/api/files/take.mp4", kind: "video" as const, modelId: CINEMA_MODEL, prompt: "A lighthouse keeper climbs the stairs at dusk", seconds: 10, resolution: "720p", aspectRatio: "16:9", ...over });
  const edit = (source: ReturnType<typeof take>, over: Record<string, unknown> = {}) =>
    planCinema({ engine: "cloud", mode: "video", action: "edit", prompt: "make it snow", settings: {}, source, ...over }, { cloudAllowed: true });

  it("edits a Fuobe Cinema take on LTX-2.3 video-to-video: the take's scene with the change, the take held, its sound kept", async () => {
    const plan = edit(take(), { brief: "Muted 1970s Kodachrome" });
    expect(plan.model.id).toBe(CINEMA_MODEL);
    const req = plan.steps[0].request;
    expect(req).toMatchObject({ modelId: CINEMA_MODEL, engine: "cloud", op: "v2v", inputs: { video: "/api/files/take.mp4" } });
    // The endpoint renders a scene, not an instruction: the take's own scene with the change, and what stays.
    expect(req.prompt).toBe(`Project brief: Muted 1970s Kodachrome. ${editPrompt("make it snow", "A lighthouse keeper climbs the stairs at dusk")}`);
    expect(req.prompt).toMatch(/A lighthouse keeper climbs the stairs at dusk\. The same shot with one change: make it snow\. Everything else stays as it is/);
    expect(editPrompt("make it snow")).toBe("The same shot with one change: make it snow. Everything else stays as it is: the same people, place, framing, camera move, light and sound.");
    expect(req.params).toMatchObject({ duration: 10, resolution: "720p", aspectRatio: "16:9", generateAudio: true, extra: { video_strength: CINEMA_EDIT_STRENGTH, audio_strength: 1 } });
    expect(req.params!.extra!.match_video_length).toBeUndefined();
    expect(CINEMA_EDIT_STRENGTH).toBeGreaterThan(0.01);
    // Priced on the take's own length and size (10 s at 720p 16:9 = 241 frames), not a flat 5 s.
    expect(plan.costUsd).toBeCloseTo(videoMp(1280, 704, 241) * 0.001605, 3);
    expect(edit(take({ seconds: 4, resolution: "480p", aspectRatio: "9:16" })).costUsd).toBeCloseTo(videoMp(480, 864, 97) * 0.001605, 3);
    // What fal receives: the take, the strengths, the frames from the clip's own length (its header), prompt expansion off.
    const { url, body } = await submit(view("cloud"), fal("v2v"), { ...req.params, prompt: req.prompt, video: "https://x/take.mp4", sourceDuration: 10 });
    expect(url).toMatch(/\/fal-ai\/ltx-2\.3-22b\/video-to-video$/);
    expect(body).toMatchObject({ video_url: "https://x/take.mp4", video_strength: CINEMA_EDIT_STRENGTH, audio_strength: 1, num_frames: 241, enable_prompt_expansion: false, generate_audio: true });
    expect(body.video_size).toBeUndefined();
  });

  it("edits the first 20 s of a longer take (481 frames), and says so; unknown lengths are priced as 5 s", async () => {
    const plan = edit(take({ seconds: 30.04 }));
    const req = plan.steps[0].request;
    expect(req.params).toMatchObject({ duration: CINEMA_MAX_SECONDS, extra: { match_video_length: false } });
    expect(plan.notes).toContain("Fuobe Cinema edits up to 20s of a take (481 frames), so this edit is the take's first 20s");
    expect(plan.costUsd).toBeCloseTo(videoMp(1280, 704, 481) * 0.001605, 3);
    const { body } = await submit(view("cloud"), fal("v2v"), { ...req.params, prompt: req.prompt, video: "https://x/take.mp4", sourceDuration: 30.04 });
    expect(body).toMatchObject({ match_video_length: false, num_frames: 481 });
    // A 20 s take (481 frames = 20.04 s) is whole.
    expect(edit(take({ seconds: 20.04 })).steps[0].request.params!.extra!.match_video_length).toBeUndefined();
    // Length unknown: the default 5 s; the clip's header still sets the frames fal makes.
    const unknown = edit(take({ seconds: undefined }));
    expect(unknown.steps[0].request.params!.duration).toBe(5);
    // Reference pictures and clips aren't used by this edit, and say so.
    const refs = edit(take(), { images: ["/api/files/a.png"], videos: ["/api/files/r.mp4"] });
    expect(refs.steps[0].request.inputs).toEqual({ video: "/api/files/take.mp4" });
    expect(refs.notes.join(" ")).toMatch(/reference images aren't used/);
  });

  it("the editor follows the take's model: a partner take goes to Kling O3 whatever the menu says", () => {
    // A Seedance take, the menu back on Fuobe Cinema: Kling O3, named after the take's model.
    const partner = edit(take({ modelId: "seedance-2-5" }));
    expect(partner.model.id).toBe("kling-o3");
    expect(partner.notes).toContain("Takes made on Seedance 2.5 are edited with Kling O3 Omni");
    expect(partner.steps[0].request.prompt).toBe("make it snow");
    // A Fuobe Cinema take with Kling 3.0 still picked: LTX-2.3.
    expect(edit(take(), { modelId: "kling-3" }).model.id).toBe(CINEMA_MODEL);
    // A Fuobe DoP take (a camera LoRA move) or an open-engine take: LTX-2.3 too.
    expect(edit(take({ modelId: "fuobe-dop" })).model.id).toBe(CINEMA_MODEL);
    // Without the take's model (an older take): the menu's pick decides.
    expect(edit(take({ modelId: undefined }), { modelId: "veo-3-1" }).model.id).toBe("kling-o3");
    expect(edit(take({ modelId: undefined })).model.id).toBe(CINEMA_MODEL);
  });

  it("an extend or a prequel longer than 20 s says it is 20 s on Fuobe Cinema in the cloud", () => {
    const run = (action: "extend-forward" | "extend-backward", duration: number, engine: "cloud" | "open" = "cloud") =>
      planCinema({ engine, mode: "video", action, prompt: "", settings: {}, duration, source: take() }, { cloudAllowed: true });
    const fwd = run("extend-forward", 30);
    expect(fwd.steps[0].request.params!.duration).toBe(20);
    expect(fwd.notes).toContain("Fuobe Cinema extends by up to 20s at a time, so this one is 20s — run it again for more");
    const back = run("extend-backward", 25);
    expect(back.steps[0].request.params).toMatchObject({ duration: 20, extra: { extend_direction: "backward" } });
    expect(back.notes).toContain("Fuobe Cinema makes a prequel of up to 20s at a time, so this one is 20s — run it again for more");
    // Up to 20 s: no note; on the GPU the extend graphs set their own lengths.
    expect(run("extend-forward", 20).notes.join(" ")).not.toMatch(/at a time/);
    expect(run("extend-forward", 30, "open").notes.join(" ")).not.toMatch(/at a time/);
  });

  it("a cloud move whose Wan LoRA downloads from civitai runs on its words without a civitai key", () => {
    const civitai = CAMERA_MOVES.filter((m) => {
      const r = cinemaMoveRoute(m.slug, "cloud", true);
      return r.via === "lora" && r.loras.some((l) => !l.hostedUrl && needsToken(l.url));
    }).map((m) => m.slug);
    expect(civitai).toEqual(expect.arrayContaining(["handheld", "tracking"]));
    for (const slug of civitai) {
      expect(cinemaMoveRoute(slug, "cloud", true, { civitai: false }), slug).toEqual({ via: "prompt", key: true });
      expect(cinemaMoveRoute(slug, "cloud", false, { civitai: false }), slug).toMatchObject({ via: "prompt", frame: false, key: true });
      expect(cinemaMoveRoute(slug, "cloud", true, { civitai: true }).via, slug).toBe("lora");
    }
    // Moves whose LoRA is hosted elsewhere, and LTX-2.3's camera LoRAs, don't need the key.
    for (const m of CAMERA_MOVES.filter((x) => !civitai.includes(x.slug))) expect(cinemaMoveRoute(m.slug, "cloud", true, { civitai: false }), m.slug).toEqual(cinemaMoveRoute(m.slug, "cloud", true));
    // The plan: Fuobe Cinema keeps the take, the move goes into the words, the note says what would drive it.
    const input = { engine: "cloud" as const, mode: "video" as const, action: "generate" as const, prompt: "a chase down a market street", moves: ["handheld"], settings: {}, images: ["/api/files/a.png"], duration: 5 };
    const without = planCinema(input, { cloudAllowed: true, civitai: false });
    expect(without.model.id).toBe(CINEMA_MODEL);
    expect(without.steps[0].request.loras).toBeUndefined();
    expect(without.notes).toContain("Handheld is written into the prompt — its camera LoRA downloads from civitai, which needs your free API key (Settings → LoRAs)");
    const withKey = planCinema(input, { cloudAllowed: true, civitai: true });
    expect(withKey.model.id).toBe("fuobe-dop");
    expect(withKey.steps[0].request.loras?.length).toBeGreaterThan(0);
    // The GPU fetches through the user's own ComfyUI: unchanged.
    expect(planCinema({ ...input, engine: "open" }, { cloudAllowed: true, civitai: false }).steps[0].request.loras?.length).toBeGreaterThan(0);
  });

  it("open Soul Cast runs the sheet graph with the Realistic look's LoRAs chained after Z-Image Turbo's loader", async () => {
    const plan = planCinema({ engine: "open", mode: "image", action: "cast", prompt: "", settings: {}, cast: { genre: "Western", gender: "Female", age: 35 } }, { cloudAllowed: true });
    const req = plan.steps[0].request;
    expect(req.modelId).toBe("oss-zimage-soul-cast");
    const { manifest, workflow } = await prepareWorkflow(
      "soul-cast-sheet-zimage",
      { ...req.params, prompt: req.prompt, loras: req.loras, seed: 3 },
      { generationId: "g", op: "t2i", upload: async (_d: Buffer, _t: string, name: string) => `up_${name}`, media: (() => undefined) as never, serverRam: async () => undefined },
    );
    expect(manifest.id).toBe("soul-cast-sheet-zimage");
    const chain = Object.values(workflow as ComfyWorkflow)
      .filter((n) => n.class_type === "LoraLoaderModelOnly")
      .map((n) => [n.inputs.lora_name, n.inputs.strength_model]);
    expect(chain).toEqual(req.loras!.map((l) => [l.file, l.strength]));
    // Its outputs: the sheet, then the four views as their own pictures.
    expect(Object.values(workflow as ComfyWorkflow).filter((n) => n.class_type === "SaveImage").length).toBe(2);
  });

  it("a variant picked before its grade was applied resolves to the finished picture", () => {
    const gens = [{ outputs: [{ url: "/api/files/finished.png", kind: "image" as const, meta: { finished: true, original: "/api/files/raw.png" } }, { url: "/api/files/other.png", kind: "image" as const }] }];
    expect(finishedUrl(gens, "/api/files/raw.png")).toBe("/api/files/finished.png");
    expect(finishedUrl(gens, "/api/files/finished.png")).toBe("/api/files/finished.png");
    expect(finishedUrl(gens, "/api/files/other.png")).toBe("/api/files/other.png");
    expect(finishedUrl(gens, "/api/files/gone.png")).toBe("/api/files/gone.png");
  });
});

describe("the cinema evaluation suite measures what Cinema sends", () => {
  // The Director behind each case (scripts/eval/cases/cinema.json carries only the compiled words and camera_lora).
  const DIRECTOR: Record<string, { prompt: string; settings: DirectorSettings; moves: string[] }> = {
    "cinema/director-noir": {
      prompt: "A detective lights a match in the rain under a flickering streetlight",
      settings: { genre: "noir", era: "1980s", camera: "35mm-film", lens: "anamorphic", focal: "50mm", lighting: { kind: "preset", slug: "window" }, palette: { kind: "preset", slug: "neon-rain-at-midnight" } },
      moves: [],
    },
    "cinema/director-epic": {
      prompt: "A lone rider crosses a vast salt flat at sunrise, dust trailing behind the horse",
      settings: { genre: "epic", era: "2020s", camera: "modern", lens: "clean-sharp", focal: "24mm", aperture: "f11-deep-focus", lighting: { kind: "preset", slug: "contre-jour" } },
      moves: [],
    },
    "cinema/director-comedy": {
      prompt: "Two old friends argue over the last slice of cake at a crowded birthday party",
      settings: { genre: "comedy", era: "1960s", camera: "8mm-film", lens: "warm-vintage", tempo: "calm", lighting: { kind: "preset", slug: "practicals" }, palette: { kind: "preset", slug: "bubblegum-boulevard" } },
      moves: [],
    },
    "cinema/move-dolly-in": { prompt: "A violinist plays alone on an empty theatre stage, a single spotlight above her", settings: {}, moves: ["dolly-in"] },
    "cinema/move-truck-left": { prompt: "A night market street lined with food stalls, steam rising, people browsing", settings: {}, moves: ["truck-left"] },
    "cinema/move-crane-up": { prompt: "A small fishing village on a rocky coast at dawn, boats tied in the harbour", settings: {}, moves: ["crane-up"] },
    "cinema/move-static": { prompt: "A cat sleeps on a sunlit windowsill while rain streaks the glass", settings: {}, moves: ["static-shot"] },
  };

  it("each Director case is the prompt (and camera LoRA) Cinema compiles on both engines", () => {
    const suite = JSON.parse(fs.readFileSync(path.join(__dirname, "../scripts/eval/cases/cinema.json"), "utf8")) as {
      original: string;
      targets: Record<string, { models: string[] }>;
      cases: { id: string; prompts?: { text: string }[]; extra?: Record<string, unknown>; engines?: string[] }[];
    };
    expect(suite.original).toBe(CINEMA_MODEL);
    expect(suite.targets.cloud.models[0]).toBe(CINEMA_MODEL);
    expect(suite.targets.open.models[0]).toBe(CINEMA_MODEL);
    for (const [id, d] of Object.entries(DIRECTOR)) {
      const kase = suite.cases.find((c) => c.id === id)!;
      expect(kase, id).toBeDefined();
      for (const engine of (kase.engines ?? ["open", "cloud"]).filter((e) => e !== "demo") as ("open" | "cloud")[]) {
        const plan = planCinema({ engine, mode: "video", action: "generate", prompt: d.prompt, settings: d.settings, moves: d.moves, duration: 5, aspectRatio: "16:9" }, { cloudAllowed: true });
        const req = plan.steps[0].request;
        expect(kase.prompts![0].text, `${id} on ${engine}`).toBe(req.prompt);
        expect(kase.extra ?? {}, `${id} on ${engine}`).toEqual(req.params?.extra ?? {});
      }
    }
  });
});

