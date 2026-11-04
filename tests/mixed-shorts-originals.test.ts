import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { GenInput, ModelDef, ModelRoute } from "@/lib/catalog/types";
import { tempDir } from "./helpers/temp-dir";

// Fuobe Mixed Media and Fuobe Shorts (build plan O9): Higgsfield's Mixed Media and Shorts as Originals on both engines.
// Frames are floor(seconds × fps) and priced per frame; the cloud fans the Original's frame route out over every frame
// (no lanes: one seed, the look's LoRA) and splits clips above 200 frames; Smooth and Shorts run the Wan 2.2 Fun VACE
// pass from a restyled first frame; the fal payloads come from the research's FieldMaps; DoP's 32 Mixed Media effects
// draw their still on the Original first.
const dir = tempDir("fuobe-o9-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9"; // nothing listens here: open runs fall back to the demo

const { setSetting } = await import("@/server/settings");
const { createGenerations, getGeneration, previewChained, previewGeneration } = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");
const { estimateMixed } = await import("@/server/mixed-media");
const { estimateShorts } = await import("@/server/shorts");
const { createPipeline } = await import("@/server/chains");
const { db } = await import("@/server/db");
const { falProvider } = await import("@/server/providers/fal");
const { EFFECTS, getModel, getPreset } = await import("@/lib/catalog");
const { onEngine } = await import("@/lib/catalog/engines");
const { estimateCost } = await import("@/lib/catalog/plan");
const { prestepCost } = await import("@/lib/composer");
const mm = await import("@/lib/catalog/mixed-media");
const { mixedLoras } = await import("@/lib/catalog/mixed-media-looks");
const sh = await import("@/lib/catalog/shorts");
const { maxRefsFor, modelInfos, reframes, resolutionFor } = await import("@/lib/catalog/shorts-models");
const { MIXED_MEDIA_LOOK_LORAS, LORA_LIBRARY } = await import("@/lib/catalog/lora-library.generated");

beforeAll(() => setSetting("demoMode", "auto"));

const view = (id: string, engine: "open" | "cloud") => onEngine(getModel(id)!, engine);
const noir = mm.getMixedPreset("mixed-noir")!;
const sketch = mm.getMixedPreset("mixed-sketch")!;
const research = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/research/fuobe-originals-recipes-5.json"), "utf8"));
const mixedRecord = research.studios.find((s: { id: string }) => s.id === "mixed-media").original;
const shortsRecord = research.studios.find((s: { id: string }) => s.id === "shorts").original;

const input = (over: Partial<Parameters<typeof mm.planMixed>[0]> = {}): Parameters<typeof mm.planMixed>[0] => ({
  engine: "cloud",
  title: "Noir · street",
  preset: noir,
  values: mm.defaultValues(noir),
  source: { url: "/api/files/uploads/street.mp4", duration: 12, hasAudio: true },
  range: { start: 0, end: 10 },
  fps: 24,
  resolution: "1K",
  modelId: mm.MIXED_ORIGINAL,
  mode: "frames",
  sourceFps: 24,
  sourceSize: { width: 1920, height: 1080 },
  // The server hands the planner the look's LoRAs a run can reach (src/server/mixed-media.ts).
  loras: mixedLoras("mixed-noir"),
  ...over,
});

/** Submit through the fal adapter and return the URL and JSON body it posted. */
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

describe("Fuobe Mixed Media and Fuobe Shorts in the catalog", () => {
  it("are Originals on both engines: ComfyUI graphs on your GPU, hosted open weights on fal", () => {
    const mmModel = getModel("fuobe-mixed-media")!;
    expect(mmModel.engines).toEqual(["open", "cloud"]);
    expect(view("fuobe-mixed-media", "open").routes.map((r) => [r.op, r.endpoint])).toEqual([
      ["v2v", "mixed-media-zimage-frames"],
      ["edit", "z-image-turbo-i2i"],
    ]);
    expect(view("fuobe-mixed-media", "cloud").routes.map((r) => [r.op, r.endpoint])).toEqual([["edit", mixedRecord.cloud.frame]]);
    expect(view("fuobe-mixed-media", "cloud").pricing).toMatchObject({ unit: "megapixel", usd: 0.01 });
    expect(mmModel.licence).toMatchObject({ licence: "Apache-2.0", commercial: true });
    const shorts = getModel("fuobe-shorts")!;
    expect(shorts.engines).toEqual(["open", "cloud"]);
    expect(view("fuobe-shorts", "open").routes.map((r) => r.endpoint)).toEqual(["video-restyle-wan22-fun-vace"]);
    expect(view("fuobe-shorts", "cloud").routes.map((r) => r.endpoint)).toEqual([shortsRecord.cloud.restyle]);
    // The cut is cropped to 9:16 / 16:9 first: fal's aspect_ratio is never asked for.
    expect(view("fuobe-shorts", "cloud").routes[0].map?.aspectRatio).toBeUndefined();
    expect(view("fuobe-shorts", "cloud").routes[0].map?.defaults).toEqual(shortsRecord.cloud.defaults);
    // The weights' licence is the model's own data on both Originals (information for Settings → Models & licences).
    expect(view("fuobe-shorts", "cloud").licence).toEqual(shortsRecord.licence);
    expect(shortsRecord.licence).toMatchObject({ licence: "Apache-2.0", commercial: true });
  });

  it("are the studios' defaults, with the partners kept as choices", () => {
    expect(mm.MIXED_FRAME_MODELS[0]).toBe("fuobe-mixed-media");
    expect(mm.MIXED_FRAME_MODELS).toContain("nano-banana-2-1");
    expect(mm.MIXED_MODELS.open).toEqual(["fuobe-mixed-media"]);
    expect(mm.MIXED_MODELS.cloud).toContain("gemini-omni-flash");
    expect(sh.SHORTS_MODELS.cloud[0]).toBe("fuobe-shorts");
    expect(sh.SHORTS_MODELS.cloud).toContain("gemini-omni-flash");
    expect(sh.SHORTS_MODELS.open).toEqual(["fuobe-shorts"]);
    // As each runs per engine: free on your GPU, priced in the cloud; refs go to the first frame's edit on both.
    const [open] = modelInfos(["fuobe-shorts"], "open");
    const [cloud] = modelInfos(["fuobe-shorts"], "cloud");
    expect(open).toMatchObject({ engine: "open", price: "Free · your GPU", refs: 2, reframes: true });
    expect(cloud).toMatchObject({ engine: "cloud", price: "$0.19 / s at 30 fps", refs: 2, reframes: false });
    expect([maxRefsFor("fuobe-shorts", "cloud"), reframes("fuobe-shorts", "cloud"), resolutionFor("fuobe-shorts", "cloud"), resolutionFor("fuobe-shorts", "open")]).toEqual([2, false, "720p", undefined]);
    expect(modelInfos(["fuobe-mixed-media"], "cloud")[0].price).toBe("$0.01 / MP");
  });

  it("gives 14 of the 33 looks a Z-Image LoRA from the library, from the research", () => {
    expect(Object.keys(MIXED_MEDIA_LOOK_LORAS).sort()).toEqual(Object.keys(mixedRecord.looks).sort());
    expect(Object.keys(MIXED_MEDIA_LOOK_LORAS)).toHaveLength(14);
    for (const [id, loras] of Object.entries(MIXED_MEDIA_LOOK_LORAS)) {
      expect(mm.getMixedPreset(id), id).toBeDefined();
      for (const l of loras) expect(LORA_LIBRARY.find((e) => e.key === l.key)?.base, `${id} ${l.key}`).toBe("z-image-turbo");
    }
    expect(mixedLoras("mixed-noir").map((l) => [l.file, l.strength])).toEqual([["darkroom-noir.safetensors", 0.8]]);
    expect(mixedLoras("mixed-toxic")).toEqual([]);
    // A look with a LoRA leads with its trigger words.
    expect(mm.withTrigger("Noir.", mixedLoras("mixed-noir"))).toBe("drkrm style, Noir.");
  });
});

describe("Fuobe Mixed Media frames and cost", () => {
  it("counts frames as floor(seconds × fps): up to 10 s × 24 fps = 240", () => {
    expect(mm.mixedFrames(10, 24)).toBe(240);
    expect(mm.mixedFrames(3.33, 8)).toBe(26);
    expect(mm.mixedRangeProblem({ start: 0, end: 10.2 })).toBe("Select up to 10 seconds");
    expect(mm.clampFps(30)).toBe(24);
  });

  it("draws each frame at about 1 (1K) or 4 (2K) megapixels in the clip's shape, priced per megapixel", () => {
    expect(mm.originalFrameSize({ width: 1920, height: 1080 }, "1K")).toEqual({ width: 1360, height: 768 });
    expect(mm.originalFrameSize({ width: 1080, height: 1920 }, "2K")).toEqual({ width: 1536, height: 2736 });
    // 4K is drawn at 2K (Z-Image Turbo's range); an unknown size keeps the frame's own (fal's "auto").
    expect(mm.originalFrameSize({ width: 1920, height: 1080 }, "4K")).toEqual(mm.originalFrameSize({ width: 1920, height: 1080 }, "2K"));
    expect(mm.originalFrameSize(undefined, "1K")).toBeUndefined();
    const cloud = view("fuobe-mixed-media", "cloud");
    const one = estimateCost(cloud, mm.originalFrameParams(mm.defaultValues(noir), "1K", 1, { width: 1920, height: 1080 }), 1, "edit");
    expect(one).toBeCloseTo(0.01, 3);
    const two = estimateCost(cloud, mm.originalFrameParams(mm.defaultValues(noir), "2K", 1, { width: 1920, height: 1080 }), 1, "edit");
    expect(two).toBeCloseTo(0.04, 2);
    // 240 frames at 1K: about $2.40 before the few cents of cutting and rebuilding the clip.
    expect(mm.framesCost(240, one!)).toBeCloseTo(2.39, 1);
  });

  it("fans the frame route out over every frame on the cloud: cut → frames → one controlled draw each → clips of 200 → joined → sound", () => {
    const { steps, final } = mm.planMixed(input());
    const frames = steps.filter((s) => s.request.feature === mm.MIXED_FRAME_FEATURE);
    expect(frames).toHaveLength(240);
    expect(steps.filter((s) => s.request.op === "extract-frames").map((s) => s.request.params?.extra?.max_frames)).toEqual([240]);
    // No lanes: each frame waits for the extraction alone and takes its own frame (one seed keeps them alike).
    for (const [i, f] of frames.entries()) {
      expect(f.after).toEqual(["frames1"]);
      expect(f.chain).toEqual([{ slot: "images", index: i, of: 240, position: "first" }]);
    }
    expect(frames[17].request).toMatchObject({
      engine: "cloud",
      modelId: "fuobe-mixed-media",
      op: "edit",
      params: { seed: mm.FRAME_SEED, numOutputs: 1, extra: { control_scale: 0.75, image_size: { width: 1360, height: 768 } } },
    });
    expect(frames[17].request.prompt).toMatch(/^drkrm style, Cinematic film noir/);
    expect(frames[17].request.loras?.map((l) => l.file)).toEqual(["darkroom-noir.safetensors"]);
    // Split above 200: 200 + 40 frames, joined at the clip's shape, then the cut's own sound.
    const clips = steps.filter((s) => s.request.op === "images-to-video");
    expect(clips.map((c) => c.after?.length)).toEqual([200, 40]);
    expect(steps.find((s) => s.key === "film")!.after).toEqual(["clip1", "clip2"]);
    expect(final).toBe("final");
    // 199 frames are one clip; 201 are two.
    expect(mm.planMixed(input({ range: { start: 0, end: 199 / 24 } })).steps.filter((s) => s.request.op === "images-to-video")).toHaveLength(1);
    expect(mm.planMixed(input({ range: { start: 0, end: 201 / 24 + 0.001 } })).steps.filter((s) => s.request.op === "images-to-video")).toHaveLength(2);
    // Bold holds the outlines loosest; the server's reachable LoRAs replace the look's own.
    const bold = mm.planMixed(input({ values: { ...mm.defaultValues(noir), intensity: "bold" }, loras: [] })).steps.find((s) => s.key === "f0")!;
    expect(bold.request.params?.extra).toMatchObject({ control_scale: 0.6 });
    expect(bold.request.loras).toBeUndefined();
    expect(bold.request.prompt).not.toMatch(/drkrm/);
  });

  it("creates the fan-out as one pipeline: every frame waits for the extraction, the clips gather them in order", () => {
    const plan = mm.planMixed(input({ range: { start: 0, end: 1 }, fps: 8, sourceFps: 24 }));
    const p = createPipeline(plan.steps);
    const deps = (id: string) => {
      const v = (db().prepare("SELECT depends_on FROM generations WHERE id = ?").get(id) as { depends_on: string | null }).depends_on;
      return !v ? [] : v.startsWith("[") ? (JSON.parse(v) as string[]) : [v];
    };
    expect(p.items).toHaveLength(1 + 1 + 8 + 1 + 1);
    const extract = p.byKey.frames1.id;
    for (let i = 0; i < 8; i++) expect(deps(p.byKey[`f${i}`].id)).toEqual([extract]);
    expect(deps(p.byKey.clip1.id)).toEqual(Array.from({ length: 8 }, (_, i) => p.byKey[`f${i}`].id));
    // Priced before it runs: each frame's draw is previewed with its chain filled by placeholders.
    const f0 = plan.steps.find((s) => s.key === "f0")!;
    expect(previewChained({ ...f0.request, chain: f0.chain }, 1)).toMatchObject({ engine: "cloud", demo: true });
  });

  it("runs on your GPU as one per-frame job with the look's LoRA and one seed", () => {
    const { steps } = mm.planMixed(input({ engine: "open", mode: "frames" }));
    expect(steps).toHaveLength(1);
    expect(steps[0].request).toMatchObject({
      engine: "open",
      modelId: "fuobe-mixed-media",
      op: "v2v",
      params: { startTime: 0, endTime: 10, fps: 24, seed: mm.FRAME_SEED, extra: { frames: 240, denoise: 0.7 } },
    });
    expect(steps[0].request.loras?.map((l) => l.file)).toEqual(["darkroom-noir.safetensors"]);
    // The open preview is the same graph on one frame, with the same look, LoRA and seed.
    const preview = mm.planMixedPreview(input({ engine: "open", mode: "frames" }));
    expect(preview.request).toMatchObject({ engine: "open", modelId: "fuobe-mixed-media", params: { seed: mm.FRAME_SEED, extra: { frames: 1 } } });
    // The cloud preview is the frame route on the grabbed frame, as frame 1 is drawn.
    const cloudPreview = mm.planMixedPreview({ ...input(), frameUrl: "/api/files/f.jpg" });
    expect(cloudPreview.request).toMatchObject({ engine: "cloud", modelId: "fuobe-mixed-media", op: "edit", inputs: { images: ["/api/files/f.jpg"] }, params: { seed: mm.FRAME_SEED } });
  });
});

describe("Smooth: the first frame in the look, then Wan 2.2 Fun VACE by depth", () => {
  it("cloud: pieces of up to 240 frames at the clip's rate, each from its own first frame, joined, the sound put back", () => {
    const { steps, final } = mm.planMixed(input({ mode: "smooth", sourceFps: 30 }));
    // 10 s at 30 fps: 300 frames, so two 5 s pieces.
    expect(steps.filter((s) => s.request.op === "v2v")).toHaveLength(2);
    const frame0 = steps.find((s) => s.key === "frame0")!;
    expect(frame0.request).toMatchObject({ engine: "cloud", modelId: "fuobe-mixed-media", op: "edit", params: { seed: mm.FRAME_SEED, extra: { control_scale: 0.75 } } });
    expect(frame0.request.inputs).toBeUndefined();
    expect(frame0.after).toEqual(["still0"]);
    const look0 = steps.find((s) => s.key === "look0")!;
    expect(look0.request).toMatchObject({ engine: "cloud", modelId: "fuobe-shorts", op: "v2v", feature: mm.MIXED_STEP_FEATURE, params: { resolution: "720p", sourceDuration: 5, duration: 9.375 } });
    expect(look0.after).toEqual(["cut0", "frame0"]);
    expect(steps.find((s) => s.key === final)!.request).toMatchObject({ feature: mm.MIXED_FEATURE, modelId: "merge-audio-video", title: "Noir · street" });
    // In the clip's own shape: nothing cropped.
    expect(steps.some((s) => s.request.op === "reframe")).toBe(false);
  });

  it("cloud: the preview is the render's first frame, drawn the same way (look, LoRA, seed and size), even after a 4K pick", () => {
    for (const resolution of ["1K", "2K", "4K"] as const) {
      const { steps } = mm.planMixed(input({ mode: "smooth", resolution }));
      const frame0 = steps.find((s) => s.key === "frame0")!.request;
      const preview = mm.planMixedPreview({ ...input({ mode: "smooth", resolution }), frameUrl: "/api/files/f.jpg" }).request;
      expect(preview).toMatchObject({ engine: "cloud", modelId: "fuobe-mixed-media", op: "edit", inputs: { images: ["/api/files/f.jpg"] } });
      expect([preview.prompt, preview.loras, preview.params]).toEqual([frame0.prompt, frame0.loras, frame0.params]);
    }
  });

  it("open: 81-frame segments at 16 fps, the first frame drawn by the Original on your GPU, Fun VACE, joined, the sound", () => {
    const { steps, final } = mm.planMixed(input({ engine: "open", mode: "smooth" }));
    const cuts = steps.filter((s) => s.request.modelId === "oss-segment");
    expect(cuts.length).toBe(sh.planOpenSegments({ start: 0, end: 10 }).length);
    const frame0 = steps.find((s) => s.key === "frame0")!;
    expect(frame0.request).toMatchObject({ engine: "open", modelId: "fuobe-mixed-media", op: "edit", params: { extra: { strength: 0.7, megapixels: 1 } } });
    expect(frame0.chain).toEqual([{ slot: "images", position: "first" }]);
    expect(steps.find((s) => s.key === "look0")!.request).toMatchObject({ engine: "open", modelId: "fuobe-shorts", op: "v2v" });
    expect(steps.find((s) => s.key === final)!.request).toMatchObject({ feature: mm.MIXED_FEATURE, modelId: "oss-mux" });
  });
});

describe("Fuobe Shorts: segment → Qwen edit of frame 0 → Wan Fun VACE depth → merge → mux", () => {
  const shortsInput = (over: Partial<Parameters<typeof sh.planShorts>[0]> = {}): Parameters<typeof sh.planShorts>[0] => ({
    engine: "cloud",
    title: "Claymation · beach",
    source: { url: "/api/files/uploads/beach.mp4", duration: 40, hasAudio: true, width: 1080, height: 1920, fps: 30 },
    range: { start: 0, end: 20 },
    look: sh.lookFromPreset(sh.getShortsPreset("shorts-claymation")!),
    aspectRatio: "9:16",
    language: "auto",
    modelId: "fuobe-shorts",
    maxRefs: 2,
    resolution: "720p",
    ...over,
  });

  it("cuts frame-limited segments (240 frames as fal works them, at most 10 s) and bills frames ÷ 16", () => {
    expect(sh.originalSegmentSeconds(30)).toBe(8);
    expect(sh.originalSegmentSeconds(24)).toBe(10);
    expect(sh.originalSegmentSeconds(16)).toBe(10);
    expect(sh.originalSegmentSeconds(60)).toBe(8);
    expect(sh.originalSegmentSeconds()).toBe(8);
    expect(sh.vaceDownsample(30)).toBe(0);
    expect(sh.vaceDownsample(60)).toBe(1);
    expect(sh.vaceDownsample(120)).toBe(3);
    expect(sh.originalBilledSeconds(8, 30)).toBe(15);
    expect(sh.originalBilledSeconds(6, 16)).toBe(6);
    expect(sh.planSegments({ start: 0, end: 20 }, "cloud", { modelId: "fuobe-shorts", fps: 30 }).map((s) => s.end - s.start)).toEqual([20 / 3, 20 / 3, 20 / 3].map((x) => expect.closeTo(x, 2)));
    // Partners keep ≤10 s segments.
    expect(sh.planSegments({ start: 0, end: 20 }, "cloud", { modelId: "gemini-omni-flash", fps: 30 })).toHaveLength(2);
  });

  it("plans the hosted-open route per segment: cut → crop → first frame → Qwen edit with references → Fun VACE", () => {
    const refs = ["/api/files/r1.png", "/api/files/r2.png", "/api/files/r3.png"];
    const input = shortsInput({ look: { ...sh.lookFromPreset(sh.getShortsPreset("shorts-claymation")!), references: refs }, source: { ...shortsInput().source, width: 1920, height: 1080 } });
    const plan = sh.planShorts(input);
    expect(plan.takes[0]).toEqual({ cut: "cut0", fit: "fit0", still: "still0", frame: "frame0", look: "look0" });
    const by = Object.fromEntries(plan.steps.map((s) => [s.key, s]));
    expect(by.still0.request).toMatchObject({ modelId: "extract-frame", op: "frame", params: { extra: { frame_type: "first" } } });
    expect(by.still0.after).toEqual(["fit0"]);
    expect(by.frame0.request).toMatchObject({ modelId: "qwen-image-edit-2511-cloud", op: "edit", inputs: { images: refs.slice(0, 2) } });
    expect(by.frame0.request.prompt).toMatch(/images 2 and 3/);
    expect(by.look0.request).toMatchObject({ engine: "cloud", modelId: "fuobe-shorts", op: "v2v", params: { resolution: "720p", sourceDuration: expect.closeTo(20 / 3, 2), duration: expect.closeTo(12.5, 2) } });
    expect(by.look0.after).toEqual(["fit0", "frame0"]);
    expect(by.look0.chain).toEqual([{ slot: "video" }, { slot: "images", position: "first" }]);
    // Joined with fal's merge-videos, then the original sound from the upload.
    expect(by.join.request.modelId).toBe("join-clips");
    expect(plan.final).toBe("final");
    // A 60 fps clip is worked at 30 fps and brought back.
    const fast = sh.planShorts(shortsInput({ source: { ...shortsInput().source, fps: 60 } }));
    expect(fast.steps.find((s) => s.key === "look0")!.request.params?.extra).toEqual({ temporal_downsample_factor: 1 });
  });

  it("sends fal what the research reads: first_frame_url, match_input_*, no aspect ratio, 720p", async () => {
    setSetting("falKey", "test-key");
    try {
      const m = view("fuobe-shorts", "cloud");
      const route = m.routes[0];
      const { url, body } = await submit(m, route, { prompt: "Claymation.", video: "https://x/cut.mp4", images: ["https://x/frame.png"], resolution: "720p", seed: 7, extra: { temporal_downsample_factor: 1 } });
      expect(url).toContain("fal-ai/wan-22-vace-fun-a14b/depth");
      expect(body).toMatchObject({ video_url: "https://x/cut.mp4", first_frame_url: "https://x/frame.png", match_input_num_frames: true, match_input_frames_per_second: true, resolution: "720p", seed: 7, temporal_downsample_factor: 1 });
      expect(body.aspect_ratio).toBeUndefined();
      // fal derives the depth from the RGB cut itself (preprocess, else video_url is read as a depth-map video), and the
      // restyled frame goes only as the first frame: no VACE subject reference copy of it.
      expect(body.preprocess).toBe(true);
      expect(body.ref_image_urls).toBeUndefined();
      expect(route.map?.fixed).toEqual(shortsRecord.cloud.fixed);
      // Genjutsu's restyle runs the same endpoint, so it derives the depth too.
      const restyle = view("fuobe-genjutsu-restyle", "cloud");
      const r = await submit(restyle, restyle.routes[0], { prompt: "Anime.", video: "https://x/cut.mp4", images: ["https://x/frame.png"], resolution: "720p" });
      expect(r.body).toMatchObject({ video_url: "https://x/cut.mp4", first_frame_url: "https://x/frame.png", preprocess: true });
      const frame = view("fuobe-mixed-media", "cloud");
      const sent = await submit(frame, frame.routes[0], {
        prompt: "drkrm style, Noir.",
        images: ["https://x/f0.jpg"],
        seed: 424242,
        numOutputs: 1,
        loras: mixedLoras("mixed-noir"),
        extra: { control_scale: 0.75, image_size: { width: 1360, height: 768 } },
      });
      expect(sent.url).toContain("fal-ai/z-image/turbo/controlnet/lora");
      expect(sent.body).toMatchObject({
        prompt: "drkrm style, Noir.",
        image_url: "https://x/f0.jpg",
        preprocess: "canny",
        output_format: "jpeg",
        enable_prompt_expansion: false,
        num_inference_steps: 8,
        seed: 424242,
        num_images: 1,
        control_scale: 0.75,
        image_size: { width: 1360, height: 768 },
      });
      expect(sent.body.loras).toEqual([{ path: expect.stringContaining("darkroom-noir.safetensors"), scale: 0.8 }]);
    } finally {
      setSetting("falKey", "");
    }
  });
});

describe("DoP's Mixed Media effects run on Fuobe Mixed Media", () => {
  const mixedEffects = EFFECTS.filter((p) => p.parity?.includes("Fuobe Mixed Media"));

  it("draws the still in the studio's look first (both engines), then Fuobe DoP animates it", () => {
    expect(mixedEffects).toHaveLength(32);
    for (const p of mixedEffects) {
      expect(p.prestep?.open).toMatchObject({ modelId: "fuobe-mixed-media", op: "edit" });
      expect(p.prestep?.cloud).toMatchObject({ modelId: "fuobe-mixed-media", op: "edit" });
      expect(p.open?.modelId).toBe("fuobe-dop");
      expect(p.cloud?.modelId).toBe("fuobe-dop");
    }
    const two = getPreset("effect-two-color")!;
    expect(two.prestep?.cloud.labels).toEqual({ step: "Start frame as Two color", clip: "Two color clip" });
    expect(getPreset("effect-noir")!.prestep?.cloud.loras?.map((l) => l.file)).toEqual(["darkroom-noir.safetensors"]);
    expect(getPreset("effect-noir")!.parity).toMatch(/^Fuobe Mixed Media draws your still as Noir first, then Fuobe DoP animates it/);
    // About a cent for the still in the cloud, free on your GPU.
    expect(prestepCost(two, "fuobe-dop", "cloud")).toBeCloseTo(0.01, 3);
    expect(prestepCost(two, "fuobe-dop", "open")).toBe(0);
  });

  it("runs the step on the engine the clip runs on, labelled, then the clip from its picture", () => {
    const req = { feature: "effect", modelId: "fuobe-dop", presetId: "effect-sketch", prompt: "a skater", inputs: { images: ["/api/files/uploads/a.png"] } };
    for (const engine of ["open", "cloud"] as const) {
      const [clip, still] = createGenerations({ ...req, engine });
      expect(still).toMatchObject({ modelId: "fuobe-mixed-media", engine, op: "edit" });
      expect(still.request.step?.label).toBe("Start frame as Sketch");
      expect(still.request.loras?.map((l) => l.file)).toEqual(mixedLoras("mixed-sketch").map((l) => l.file));
      expect(still.request.params?.seed).toBe(mm.FRAME_SEED);
      expect(clip).toMatchObject({ modelId: "fuobe-dop", engine });
      expect(clip.request.step?.label).toBe("Sketch clip");
      expect(clip.request.chain).toEqual([{ slot: "images", position: "first" }]);
    }
    expect(sketch.id).toBe("mixed-sketch");
  });
});

/** A PNG's first bytes: enough for its size (src/lib/image-size.ts), as a big photo's upload would start. */
function pngHeader(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b[24] = 8;
  b[25] = 2;
  return b;
}

/** What a step handed its provider (the demo provider records the input it was given). */
async function handedOver(id: string): Promise<Record<string, unknown>> {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    const row = db().prepare("SELECT provider_input_json, status, error FROM generations WHERE id = ?").get(id) as { provider_input_json: string | null; status: string; error: string | null };
    if (row.provider_input_json) return JSON.parse(row.provider_input_json);
    if (row.status === "failed") throw new Error(row.error ?? "failed");
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`${getGeneration(id)?.status}: nothing handed over`);
}

describe("DoP's Mixed Media stills, as the run reaches and prices them", () => {
  it("leaves a civitai look LoRA out without the civitai key, and says so: the still runs on the look's words", () => {
    setSetting("falKey", "test-key");
    try {
      const step = getPreset("effect-paper")!.prestep!.cloud;
      expect(step.loras?.map((l) => l.file)).toEqual(["civitai-2959128-paperdiorama.safetensors"]);
      expect(step.prompt).toMatch(/^layered paper diorama, cut paper art, /);
      const ask = { feature: "effect", engine: "cloud" as const, modelId: step.modelId, op: step.op, prompt: step.prompt, loras: step.loras, params: step.params, inputs: { images: ["/api/files/uploads/a.png"] } };
      const p = previewGeneration(ask);
      expect(p).toMatchObject({ demo: false, engine: "cloud" });
      expect(p.loras.applied).toEqual([]);
      expect(p.loras.dropped).toEqual([{ file: "civitai-2959128-paperdiorama.safetensors", reason: expect.stringMatching(/civitai key/) }]);
      expect(p.notes?.join(" ")).toMatch(/V67 Layered paper diorama downloads from civitai, which needs your free API key \(Settings → LoRAs\), so this run leaves it out/);
      // Its trigger words go with it; the look's own words stay.
      expect(p.prompt).not.toMatch(/layered paper diorama/);
      expect(p.prompt).toBe(step.prompt.replace(/^layered paper diorama, cut paper art, /, ""));
      // With the key it rides along, trigger and all.
      setSetting("civitaiKey", "a-key");
      const keyed = previewGeneration(ask);
      expect(keyed.loras.applied.map((l) => l.file)).toEqual(["civitai-2959128-paperdiorama.safetensors"]);
      expect(keyed.prompt).toBe(step.prompt);
    } finally {
      setSetting("falKey", "");
      setSetting("civitaiKey", "");
    }
  });

  it("draws the still at about 1 megapixel in the picture's shape on fal, as it's priced (not a 12-megapixel upload's own size)", async () => {
    const photo = saveFile({ data: pngHeader(4000, 3000), contentType: "image/png", name: "big.png", source: "upload" }).url;
    const [, still] = createGenerations({ feature: "effect", modelId: "fuobe-dop", presetId: "effect-noir", engine: "cloud", prompt: "a skater", inputs: { images: [photo] } });
    expect(still).toMatchObject({ modelId: "fuobe-mixed-media", engine: "cloud", op: "edit" });
    const sent = await handedOver(still.id);
    const size = mm.originalFrameSize({ width: 4000, height: 3000 }, "1K")!;
    expect(size).toEqual({ width: 1184, height: 880 });
    expect(sent.extra).toEqual({ control_scale: 0.75, image_size: size });
    // About 1 megapixel: the cent the composer shows before running.
    expect(estimateCost(view("fuobe-mixed-media", "cloud"), { extra: { image_size: size } }, 1, "edit")).toBeCloseTo(0.01, 3);
    expect(prestepCost(getPreset("effect-noir")!, "fuobe-dop", "cloud")).toBeCloseTo(0.01, 3);
  });
});

describe("Refused before anything is paid for", () => {
  it("fal's Wan 2.2 Fun VACE takes 17 frames or more, at 5 fps or more (as it works them)", () => {
    expect(sh.originalSegmentProblem(1, 16)).toMatch(/needs at least 17 frames: select at least 1\.1 s of this 16 fps clip/);
    expect(sh.originalSegmentProblem(1.07, 16)).toBeNull();
    expect(sh.originalSegmentProblem(4, 4)).toMatch(/needs a clip of at least 5 fps \(this one is 4 fps\)/);
    // A 60 fps clip is worked at 30 fps: 0.5 s is 15 frames there.
    expect(sh.originalSegmentProblem(0.5, 60)).toMatch(/at least 17 frames/);
    expect(sh.originalSegmentProblem(0.6, 60)).toBeNull();
    // An unknown rate is left to the header read when the render starts.
    expect(sh.originalSegmentProblem(0.2)).toBeNull();
  });

  it("Mixed Media's Smooth in the cloud and Fuobe Shorts in the cloud say so at the estimate; Per frame and your GPU don't need it", async () => {
    const body = (over: Record<string, unknown>) => ({
      engine: "cloud",
      presetId: "mixed-noir",
      values: {},
      source: { url: "/api/files/placeholder.mp4", duration: 12, fps: 12 },
      range: { start: 0, end: 1 },
      fps: 8,
      resolution: "1K",
      mode: "smooth",
      ...over,
    });
    await expect(estimateMixed(body({}) as never)).rejects.toThrow(/needs at least 17 frames: select at least 1\.5 s of this 12 fps clip — or pick Per frame/);
    await expect(estimateMixed(body({ source: { url: "/api/files/placeholder.mp4", duration: 12, fps: 4 }, range: { start: 0, end: 6 }, fps: 4 }) as never)).rejects.toThrow(/at least 5 fps/);
    expect(await estimateMixed(body({ range: { start: 0, end: 2 } }) as never)).toMatchObject({ mode: "smooth" });
    expect(await estimateMixed(body({ mode: "frames" }) as never)).toMatchObject({ mode: "frames", frames: 6 });
    expect(await estimateMixed(body({ engine: "open" }) as never)).toMatchObject({ mode: "smooth" });
    const shorts = (over: Record<string, unknown>) => ({
      engine: "cloud",
      presetId: "shorts-claymation",
      modelId: "fuobe-shorts",
      source: { url: "/api/files/placeholder.mp4", duration: 12, fps: 4 },
      range: { start: 0, end: 6 },
      aspectRatio: "9:16",
      language: "auto",
      ...over,
    });
    await expect(estimateShorts(shorts({}) as never)).rejects.toThrow(/Wan 2\.2 Fun VACE needs a clip of at least 5 fps .* — or pick another model/);
    expect(await estimateShorts(shorts({ source: { url: "/api/files/placeholder.mp4", duration: 12, fps: 24 } }) as never)).toMatchObject({ segments: 1 });
    // A partner model has its own limits.
    expect(await estimateShorts(shorts({ modelId: "gemini-omni-flash" }) as never)).toMatchObject({ segments: 1 });
  });
});

describe("Fuobe Mixed Media on your GPU without a LoRA folder", () => {
  type Reach = { ok: boolean; at: number; url: string };
  const g = globalThis as unknown as { __fuobeComfyReach?: Reach };
  const body = { engine: "open", presetId: "mixed-noir", values: {}, source: { url: "/api/files/placeholder.mp4", duration: 12, fps: 24 }, range: { start: 0, end: 2 }, fps: 8, resolution: "1K", mode: "frames" };

  /** A ComfyUI that answers, with these LoRA files. */
  async function withComfy<T>(loras: string[], run: (asked: string[]) => Promise<T>): Promise<T> {
    const real = globalThis.fetch;
    const before = g.__fuobeComfyReach;
    const asked: string[] = [];
    g.__fuobeComfyReach = { ok: true, at: Date.now(), url: "http://127.0.0.1:9" };
    globalThis.fetch = (async (url: string | URL | Request) => {
      asked.push(String(url));
      return String(url).endsWith("/models/loras") ? Response.json(loras) : new Response("{}", { status: 404 });
    }) as typeof fetch;
    try {
      return await run(asked);
    } finally {
      globalThis.fetch = real;
      g.__fuobeComfyReach = before;
    }
  }

  it("runs a look whose LoRA ComfyUI hasn't on its words, and says how to add it, instead of failing once handed over", async () => {
    const est = await withComfy(["other.safetensors"], async (asked) => {
      const e = await estimateMixed(body as never);
      expect(asked.filter((u) => u.endsWith("/models/loras"))).toHaveLength(1);
      return e;
    });
    expect(est.notes.join(" ")).toMatch(/ComfyUI doesn't have frankbarbs DARKROOM Noir yet, and Fuobe downloads LoRAs for it only once Settings → LoRAs has its LoRA folder, so this run leaves it out \(the look runs on its words\)/);
    // ComfyUI has it: it runs with it, nothing said.
    const has = await withComfy(["darkroom-noir.safetensors"], () => estimateMixed(body as never));
    expect(has.notes.join(" ")).not.toMatch(/ComfyUI doesn't have/);
    // A LoRA folder set: Fuobe downloads it into the folder when the run is handed over, so ComfyUI isn't asked.
    setSetting("comfyLorasDir", dir);
    try {
      const folder = await withComfy([], async (asked) => {
        const e = await estimateMixed(body as never);
        expect(asked.filter((u) => u.endsWith("/models/loras"))).toEqual([]);
        return e;
      });
      expect(folder.notes.join(" ")).not.toMatch(/ComfyUI doesn't have/);
    } finally {
      setSetting("comfyLorasDir", "");
    }
  });
});
