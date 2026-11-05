import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import {
  clampFps,
  cleanValues,
  colorName,
  defaultValues,
  denoiseFor,
  FRAME_LIMITS,
  FRAME_SEED,
  frameChunks,
  frameEditParams,
  frameJoinSize,
  frameResolution,
  frameSampling,
  fpsChoices,
  framesCost,
  getMixedPreset,
  MIXED,
  MIXED_FRAME_MODELS,
  MIXED_MODELS,
  MIXED_PRESETS,
  MIXED_TOOLS,
  mixedFrames,
  mixedLook,
  mixedPrompts,
  mixedRangeProblem,
  nearestResolution,
  planMixed,
  planMixedFrames,
  planMixedPreview,
  settingWords,
  type MixedPlanInput,
} from "@/lib/catalog/mixed-media";
import { FX } from "@/lib/preset-cards";

const sketch = getMixedPreset("mixed-sketch")!;
const windows = getMixedPreset("mixed-windows")!;

const input = (over: Partial<MixedPlanInput> = {}): MixedPlanInput => ({
  engine: "open",
  title: "Sketch · skate",
  preset: sketch,
  values: defaultValues(sketch),
  source: { url: "/api/files/uploads/skate.mp4", duration: 12, hasAudio: true },
  range: { start: 2, end: 7 },
  fps: 8,
  resolution: "1K",
  modelId: "oss-mixed-media",
  ...over,
});

describe("Mixed Media presets", () => {
  it("has the parity studio's 33 presets, each with its own settings and an intensity", () => {
    expect(MIXED_PRESETS).toHaveLength(33);
    expect(new Set(MIXED_PRESETS.map((p) => p.id)).size).toBe(33);
    for (const p of MIXED_PRESETS) {
      expect(p.description.length).toBeGreaterThan(8);
      expect(FX).toContain(p.fx);
      expect(p.settings.at(-1)!.key).toBe("intensity");
      expect(new Set(p.settings.map((s) => s.key)).size).toBe(p.settings.length);
      // Every placeholder has a setting and every setting but intensity is used.
      const used = [...p.look.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      expect(used.sort()).toEqual(p.settings.filter((s) => s.key !== "intensity").map((s) => s.key).sort());
      expect(mixedLook(p, defaultValues(p))).not.toMatch(/[{}]/);
    }
  });

  it("uses real models", () => {
    for (const id of [...MIXED_MODELS.cloud, ...MIXED_MODELS.open, ...MIXED_FRAME_MODELS, ...Object.values(MIXED_TOOLS.cloud), ...Object.values(MIXED_TOOLS.open)]) expect(getModel(id), id).toBeDefined();
    // Per frame redraws each frame with an image editor; the helpers are fal's FFmpeg tools.
    for (const id of MIXED_FRAME_MODELS) expect(getModel(id)!.routes.some((r) => r.op === "edit")).toBe(true);
    expect(getModel("nano-banana-2-1")!.routes.find((r) => r.op === "edit")!.map).toMatchObject({ seed: "seed", aspectRatio: "aspect_ratio", resolution: "resolution" });
    expect(getModel("nano-banana-2-1")!.options.resolutions).toEqual(expect.arrayContaining([...MIXED.resolutions]));
    // Nano Banana 2.1 is the partner frame editor (it takes a seed, so every frame starts from the same one).
    expect(MIXED_FRAME_MODELS).toEqual(["fuobe-mixed-media", "nano-banana-2-1", "seedream-5-flash"]);
    expect(MIXED_TOOLS.cloud.preview).toBe("nano-banana-2-1");
    expect(getModel("seedream-5-flash")!.pricing?.usd).toBe(0.027);
  });

  it("cleans saved settings: bad colours and unknown options go back to the default, words are kept", () => {
    const v = cleanValues(sketch, { ink: "#ABCDEF", paper: "nope", intensity: "bold", stray: "x" });
    expect(v).toEqual({ ink: "#abcdef", paper: "white-paper", intensity: "bold" });
    expect(cleanValues(sketch, { ink: "text:the blue of old ballpoint pens", paper: "text:a page torn from a diary" })).toMatchObject({
      ink: "text:the blue of old ballpoint pens",
      paper: "text:a page torn from a diary",
    });
    expect(cleanValues(sketch, { ink: "red" }).ink).toBe("#1d1d1f");
    expect(cleanValues(windows, { title: "  a very long window title that goes on and on and on  " }).title).toHaveLength(40);
  });

  it("names colours in words for the prompt", () => {
    expect(colorName("#ff0000")).toBe("bright red");
    expect(colorName("#1d1d1f")).toBe("black");
    expect(colorName("#ffffff")).toBe("white");
    expect(colorName("#2a6f97")).toBe("deep sky blue");
    expect(colorName("#7cff00")).toBe("bright lime");
    expect(colorName("#8b4513")).toBe("brown");
    expect(colorName("#ffc0cb")).toBe("pale pink");
    expect(settingWords(sketch.settings[0], "#00e5ff")).toBe("bright cyan (#00E5FF)");
  });

  it("fills the look with the settings", () => {
    expect(mixedLook(sketch, { ink: "#c1121f", paper: "notebook-grid", intensity: "balanced" })).toBe(
      "hand-drawn textured linework in deep red (#C1121F) ink on a squared notebook page, cross-hatching and loose construction lines",
    );
    expect(mixedLook(windows, { title: "dream.exe", color: "text:sunset orange", intensity: "bold" })).toMatch(/title bars reading “dream\.exe”.*accents in sunset orange, pushed all the way, fully stylised$/);
    const p = mixedPrompts(sketch, defaultValues(sketch));
    expect(p.video).toMatch(/^Restyle this video as hand-drawn textured linework.*change only the look\.$/);
    expect(p.frame).toMatch(/^Hand-drawn textured linework/);
    expect(p.still).toMatch(/^Redraw this image as/);
    expect(denoiseFor({ intensity: "subtle" })).toBe(0.55);
    expect(denoiseFor({})).toBe(0.7);
  });
});

describe("Mixed Media frames and cost", () => {
  it("counts output frames as floor(seconds × fps)", () => {
    expect(mixedFrames(10, 8)).toBe(80);
    expect(mixedFrames(10, 24)).toBe(240);
    expect(mixedFrames(3.33, 12)).toBe(39);
    expect(mixedFrames(0.3, 4)).toBe(1);
  });

  it("prices per frame, double at 4K", () => {
    expect(framesCost(160, 0.02)).toBe(3.2);
    expect(framesCost(160, 0.02, "4K")).toBe(6.4);
    expect(framesCost(80, 0)).toBe(0);
  });

  it("never samples faster than the clip", () => {
    expect(fpsChoices(10).map((c) => [c.fps, c.disabled])).toEqual([
      [4, false],
      [8, false],
      [10, false],
      [12, true],
      [24, true],
    ]);
    expect(fpsChoices(undefined).every((c) => !c.disabled)).toBe(true);
    expect(clampFps(24, 10)).toBe(10);
    expect(clampFps(24, 29.97)).toBe(24);
    expect(clampFps(30)).toBe(24);
    expect(clampFps(2)).toBe(4);
    expect(clampFps(15.4, 30)).toBe(15);
    expect(MIXED.defaultFps).toBe(8);
  });

  it("checks the selection", () => {
    expect(mixedRangeProblem({ start: 0, end: 0.5 })).toBe("Select at least 1 second");
    expect(mixedRangeProblem({ start: 0, end: 11 })).toBe("Select up to 10 seconds");
    expect(mixedRangeProblem({ start: 0, end: 5 }, 12, 3)).toBe("Video must be at least 4 FPS");
    expect(mixedRangeProblem({ start: 2, end: 12 }, 12, 30)).toBe(null);
  });

  it("asks cloud models for their closest resolution", () => {
    expect(nearestResolution(["720p", "1080p"], "4K")).toBe("1080p");
    expect(nearestResolution(["360p", "720p", "1080p", "4k"], "4K")).toBe("4k");
    expect(nearestResolution(["360p", "720p", "1080p", "4k"], "1K")).toBe("720p");
    expect(nearestResolution(["auto", "480p", "720p"], "2K")).toBe("720p");
    expect(nearestResolution(undefined, "2K")).toBeUndefined();
  });
});

describe("Mixed Media pipeline shape", () => {
  it("open: one per-frame job on the selection at the chosen frame rate", () => {
    const plan = planMixed(input({ values: { ...defaultValues(sketch), intensity: "bold" } }));
    expect(plan.final).toBe("render");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].request).toMatchObject({
      feature: "mixed-media",
      title: "Sketch · skate",
      modelId: "oss-mixed-media",
      op: "v2v",
      inputs: { video: "/api/files/uploads/skate.mp4" },
      params: { startTime: 2, endTime: 7, fps: 8, aspectRatio: "auto", resolution: "1K", extra: { denoise: 0.82 } },
    });
  });

  it("cloud Fast: cut → restyle (anchored on the preview) → the cut's own sound", () => {
    const plan = planMixed(input({ engine: "cloud", mode: "fast", modelId: "ltx-2-3-restyle", anchor: "/api/files/outputs/still.png", extra: { preprocessor: "canny" } }));
    const by = Object.fromEntries(plan.steps.map((s) => [s.key, s]));
    expect(Object.keys(by)).toEqual(["cut", "render", "final"]);
    expect(by.cut.request).toMatchObject({ feature: "mixed-media-step", modelId: "trim-video", op: "trim", params: { startTime: 2, endTime: 7 } });
    expect(by.render).toMatchObject({
      after: ["cut"],
      chain: [{ slot: "video" }],
      request: { feature: "mixed-media-step", modelId: "ltx-2-3-restyle", inputs: { images: ["/api/files/outputs/still.png"] }, params: { generateAudio: false, extra: { preprocessor: "canny" } } },
    });
    expect(by.final).toMatchObject({ after: ["render", "cut"], chain: [{ slot: "video" }, { slot: "audio" }], request: { feature: "mixed-media", modelId: "merge-audio-video", op: "mux" } });
    const silent = planMixed(input({ engine: "cloud", mode: "fast", modelId: "lucy-edit-pro", source: { url: "/api/files/x.mp4", hasAudio: false } }));
    expect(silent.final).toBe("render");
    expect(silent.steps[1].request).toMatchObject({ feature: "mixed-media", title: "Sketch · skate" });
    expect(silent.steps[1].request.inputs).toBeUndefined();
  });

  it("preview: one frame (open: the per-frame model; cloud: an edit of the grabbed frame)", () => {
    const open = planMixedPreview(input());
    expect(open.request).toMatchObject({ feature: "mixed-media-preview", modelId: "oss-mixed-media", params: { startTime: 2, fps: 8, extra: { frames: 1 } } });
    const cloud = planMixedPreview({ ...input({ engine: "cloud", mode: "fast", modelId: "ltx-2-3-restyle" }), frameUrl: "/api/files/uploads/frame.png" });
    expect(cloud.request).toMatchObject({ modelId: "nano-banana-2-1", op: "edit", inputs: { images: ["/api/files/uploads/frame.png"] } });
    expect(cloud.request.prompt).toMatch(/^Redraw this image as hand-drawn/);
  });
});

describe("Mixed Media per frame on the cloud", () => {
  const frames = (over: Partial<MixedPlanInput> = {}) =>
    input({ engine: "cloud", modelId: "nano-banana-2-1", sourceFps: 24, range: { start: 2, end: 7 }, fps: 8, ...over });

  it("takes every Nth frame of the clip, the N closest to the rate asked for", () => {
    expect(frameSampling(5, 8, 24)).toEqual({ interval: 3, fps: 8, frames: 40 });
    // 30 FPS has no whole step to 8: every 4th frame, 7.5 FPS (fewer frames on a tie).
    expect(frameSampling(10, 8, 30)).toEqual({ interval: 4, fps: 7.5, frames: 75 });
    expect(frameSampling(10, 12, 30)).toEqual({ interval: 3, fps: 10, frames: 100 });
    // 24 from 25 or 30: every frame.
    expect(frameSampling(10, 24, 25)).toEqual({ interval: 1, fps: 25, frames: 250 });
    expect(frameSampling(10, 24, 30).interval).toBe(1);
    expect(frameSampling(4, 4, 29.97)).toEqual({ interval: 7, fps: 4.281, frames: 17 });
    expect(frameSampling(2, 4, 240).interval).toBe(60);
  });

  it("splits frames into the extractor's 500 and the assembler's 200", () => {
    expect(frameChunks(240, FRAME_LIMITS.perClip)).toEqual([
      { from: 0, count: 200 },
      { from: 200, count: 40 },
    ]);
    expect(frameChunks(1100, FRAME_LIMITS.perExtract)).toEqual([
      { from: 0, count: 500 },
      { from: 500, count: 500 },
      { from: 1000, count: 100 },
    ]);
    expect(frameChunks(40, 200)).toEqual([{ from: 0, count: 40 }]);
  });

  it("asks each editor for the frame's own shape, with a fixed seed where it takes one", () => {
    // JPEG back: every frame is downloaded and sent on twice (a 4K PNG is ten times the bytes).
    expect(frameEditParams("nano-banana-2-1", "2K", 9)).toEqual({ aspectRatio: "auto", resolution: "2K", seed: 9, extra: { output_format: "jpeg" } });
    expect(frameEditParams("seedream-5-flash", "1K", 9)).toEqual({ extra: { image_size: "auto_1K" } });
    expect(frameEditParams("seedream-5-flash", "4K", 9)).toEqual({ extra: { image_size: "auto_2K" } });
  });

  it("is the cloud default: cut → frames → one edit per frame → frames to video → the cut's sound", () => {
    const plan = planMixed(frames());
    expect(plan).toEqual(planMixedFrames(frames()));
    expect(plan.final).toBe("final");
    const keys = plan.steps.map((s) => s.key);
    expect(keys).toEqual(["cut", "frames1", ...Array.from({ length: 40 }, (_, i) => `f${i}`), "clip1", "final"]);
    const by = Object.fromEntries(plan.steps.map((s) => [s.key, s]));
    expect(by.cut.request).toMatchObject({ feature: "mixed-media-step", modelId: "trim-video", op: "trim", params: { startTime: 2, endTime: 7 } });
    expect(by.frames1).toMatchObject({ after: ["cut"], chain: [{ slot: "video" }], request: { modelId: "extract-frames", op: "extract-frames", params: { frameInterval: 3, extra: { max_frames: 40, output_format: "jpg", quality: 95 } } } });
    // Frame 0 alone; then each frame with the one styled before it (lanes of 12: frame 12 looks at frame 0).
    // Each knows how many frames were planned (a list far short of it fails before anything is paid).
    expect(by.f0.chain).toEqual([{ slot: "images", index: 0, of: 40, position: "first" }]);
    expect(by.f0).toMatchObject({ after: ["frames1"] });
    expect(by.f0.request).toMatchObject({ feature: "mixed-media-frame-step", modelId: "nano-banana-2-1", op: "edit", params: { aspectRatio: "auto", resolution: "1K", seed: FRAME_SEED, numOutputs: 1 } });
    expect(by.f0.request.prompt).toMatch(/^Redraw this image as hand-drawn/);
    expect(by.f1).toMatchObject({ after: ["frames1", "f0"], chain: [{ slot: "images", index: 1, position: "first" }, { slot: "images" }] });
    expect(by.f1.request.prompt).toMatch(/^Redraw the first image as .*The second image is an earlier frame of the same clip already redrawn/);
    expect(by.f12.after).toEqual(["frames1", "f0"]);
    expect(by.f13.after).toEqual(["frames1", "f12"]);
    expect(by.f39.request.step).toMatchObject({ label: "Frame 40 of 40" });
    expect(by.clip1).toMatchObject({ after: keys.filter((k) => /^f\d/.test(k)), request: { modelId: "images-to-video", op: "images-to-video", params: { fps: 8 } } });
    expect(by.clip1.chain).toHaveLength(40);
    expect(by.final).toMatchObject({ after: ["clip1", "cut"], chain: [{ slot: "video" }, { slot: "audio" }], request: { feature: "mixed-media", title: "Sketch · skate", modelId: "merge-audio-video", op: "mux" } });
    // The frame edits and the clip only feed what comes after: dropped while waiting once that can't be made.
    expect(plan.steps.filter((s) => s.request.dropWhenUnused).map((s) => s.key)).toEqual([...keys.filter((k) => /^f\d/.test(k)), "clip1"]);
    expect(by.final.request.dropWhenUnused).toBeUndefined();
    // Every step knows its place.
    expect(plan.steps.map((s) => s.request.step?.index)).toEqual(plan.steps.map((_, i) => i));
    expect(new Set(plan.steps.map((s) => s.request.step?.of))).toEqual(new Set([plan.steps.length]));
  });

  it("starts every lane from the approved preview when there is one", () => {
    const plan = planMixed(frames({ anchor: "/api/files/outputs/preview.png", seed: 5 }));
    const by = Object.fromEntries(plan.steps.map((s) => [s.key, s]));
    for (const k of ["f0", "f12", "f24", "f36"]) {
      expect(by[k]).toMatchObject({ after: ["frames1"], request: { inputs: { images: ["/api/files/outputs/preview.png"] }, params: { seed: 5 } } });
      expect(by[k].request.prompt).toMatch(/^Redraw the first image/);
    }
    expect(by.f1.request.inputs).toBeUndefined();
  });

  it("makes clips of up to 200 frames and joins them; a silent clip ends on the picture", () => {
    const plan = planMixed(frames({ range: { start: 0, end: 10 }, fps: 24, source: { url: "/api/files/x.mp4", hasAudio: false } }));
    const by = Object.fromEntries(plan.steps.map((s) => [s.key, s]));
    expect(plan.steps.filter((s) => s.request.op === "edit")).toHaveLength(240);
    expect(by.clip1.after).toHaveLength(200);
    expect(by.clip2.after).toEqual(Array.from({ length: 40 }, (_, i) => `f${200 + i}`));
    expect(by.film).toMatchObject({ after: ["clip1", "clip2"], chain: [{ slot: "videos" }, { slot: "videos" }], request: { feature: "mixed-media", title: "Sketch · skate", modelId: "join-clips", op: "concat" } });
    expect(plan.final).toBe("film");
    expect(by.final).toBeUndefined();
    // The result itself is never dropped; the clips are.
    expect([by.clip1.request.dropWhenUnused, by.clip2.request.dropWhenUnused, by.film.request.dropWhenUnused]).toEqual([true, true, undefined]);
  });

  it("joins clips of more than 200 frames at merge-videos' 2048 px, and draws 4K frames at 2K then", () => {
    expect(frameJoinSize({ width: 3840, height: 2160 })).toEqual({ width: 2048, height: 1152 });
    expect(frameJoinSize({ width: 1080, height: 1920 })).toEqual({ width: 1152, height: 2048 });
    // A very wide clip keeps its short side at merge-videos' 512.
    expect(frameJoinSize({ width: 4000, height: 500 })).toEqual({ width: 2048, height: 512 });
    expect(frameJoinSize({})).toBeUndefined();
    expect(frameResolution(240, "4K")).toBe("2K");
    expect(frameResolution(240, "2K")).toBe("2K");
    expect(frameResolution(200, "4K")).toBe("4K");

    const long = frames({ range: { start: 0, end: 10 }, fps: 24, resolution: "4K", sourceSize: { width: 1920, height: 1080 } });
    const by = Object.fromEntries(planMixed(long).steps.map((s) => [s.key, s]));
    expect(by.film.request.params).toEqual({ extra: { resolution: { width: 2048, height: 1152 } } });
    expect(by.f0.request.params).toMatchObject({ resolution: "2K" });
    expect(planMixedPreview({ ...long, frameUrl: "/api/files/uploads/frame.png" }).request.params).toMatchObject({ resolution: "2K" });
    // One clip: 4K as asked, nothing to join.
    const short = Object.fromEntries(planMixed(frames({ resolution: "4K", sourceSize: { width: 1920, height: 1080 } })).steps.map((s) => [s.key, s]));
    expect(short.f0.request.params).toMatchObject({ resolution: "4K" });
    expect(short.film).toBeUndefined();
  });

  it("cuts a run of more than 500 frames into windows for the extractor", () => {
    // 25 s at 24 FPS from a 24 FPS clip: 600 frames, two windows of 500 and 100.
    const plan = planMixedFrames(frames({ range: { start: 1, end: 26 }, fps: 24 }));
    const by = Object.fromEntries(plan.steps.map((s) => [s.key, s]));
    expect(by.cut1.request.params).toEqual({ startTime: 1, endTime: 21.833 });
    expect(by.cut2.request.params).toEqual({ startTime: 21.833, endTime: 26 });
    expect(by.frames2).toMatchObject({ after: ["cut2"], request: { params: { frameInterval: 1, extra: { max_frames: 100 } } } });
    // Frame 503 is the 4th of the second window.
    expect(by.f503).toMatchObject({ after: ["frames2", "f502"], chain: [{ slot: "images", index: 3, of: 100, position: "first" }, { slot: "images" }] });
    expect(by.f499.chain?.[0]).toMatchObject({ index: 499, of: 500 });
    expect(by.final.after).toEqual(["film", "cut"]);
  });

  it("uses Seedream 5.0 Flash at auto size, and needs the clip's frame rate", () => {
    const plan = planMixed(frames({ modelId: "seedream-5-flash", resolution: "2K" }));
    expect(plan.steps.find((s) => s.key === "f3")!.request).toMatchObject({ modelId: "seedream-5-flash", params: { extra: { image_size: "auto_2K" }, numOutputs: 1 } });
    expect(() => planMixed(frames({ sourceFps: undefined }))).toThrow(/Couldn't read this clip's frame rate — pick Fast/);
  });

  it("previews with the frame editor itself, so the approved frame is what the render starts from", () => {
    const p = planMixedPreview({ ...frames({ modelId: "seedream-5-flash" }), frameUrl: "/api/files/uploads/frame.png" });
    expect(p.request).toMatchObject({ modelId: "seedream-5-flash", op: "edit", inputs: { images: ["/api/files/uploads/frame.png"] }, params: { extra: { image_size: "auto_1K" } } });
  });
});
