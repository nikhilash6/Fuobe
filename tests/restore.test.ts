import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARTEFACTS,
  meanChroma,
  MONOCHROME_CHROMA,
  restoreHref,
  cloudPieceFrames,
  cloudShape,
  framesCovered,
  offlineRestorePrompt,
  parsePromptAnswer,
  planRestore,
  refineCanvas,
  RESTORE,
  restoreCanvas,
  restoreNegative,
  restoreProblem,
  restorePrompt,
  restoreTitle,
  restoreWindows,
  tileGrid,
} from "@/lib/catalog/restore";
import { restoreGraph, restoreGraphLoras, restoreJob } from "@/lib/restore-graph";
import { THEN_UPSCALE, UPSCALE_FIRST_STEPS } from "@/lib/catalog/upscale-first";
import { VIDEO_UPSCALE_STUDIO } from "@/lib/studios";
import type { ComfyWorkflow } from "@/lib/comfy";
import { getModel, getPreset } from "@/lib/catalog";
import { withChainInputs } from "@/server/generations";
import { onEngine } from "@/lib/catalog/engines";
import { estimateCost, planGeneration } from "@/lib/catalog/plan";
import { convertEngine, defaultModelForNode, describeNode, inputPorts, nodeEngine, outputType, paletteItems, type CanvasGraph, type CanvasNode } from "@/lib/catalog/canvas";

const research = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/research/fuobe-originals-recipes-5.json"), "utf8"));
const record = research.studios.find((s: { id: string }) => s.id === "archive-restore").original;

describe("Restore & colourise: the working canvas (the card's sizes)", () => {
  it("4:3 scans go to 1440x1088 and 16:9 to 1920x1088, multiples of 32, never stretched to another shape", () => {
    expect(restoreCanvas(640, 480)).toEqual({ width: 1440, height: 1088 });
    expect(restoreCanvas(720, 544)).toEqual({ width: 1440, height: 1088 });
    expect(restoreCanvas(720, 576)).toEqual({ width: 1440, height: 1152 }); // PAL 5:4: its own shape, not 4:3's
    expect(restoreCanvas(1920, 1080)).toEqual({ width: 1920, height: 1088 });
    expect(restoreCanvas(1280, 720)).toEqual({ width: 1920, height: 1088 });
    expect(restoreCanvas()).toEqual({ width: 1440, height: 1088 });
  });

  it("odd shapes keep their own: portrait mirrored, 3:2 on the narrow canvas, 2.39:1 on the wide one, 4:1 never under a tile", () => {
    expect(restoreCanvas(480, 640)).toEqual({ width: 1088, height: 1440 });
    expect(restoreCanvas(1080, 1920)).toEqual({ width: 1088, height: 1920 });
    expect(restoreCanvas(1500, 1000)).toEqual({ width: 1440, height: 960 });
    expect(restoreCanvas(1920, 804)).toEqual({ width: 1920, height: 800 });
    expect(restoreCanvas(500, 500)).toEqual({ width: 1440, height: 1440 });
    expect(restoreCanvas(2000, 500)).toEqual({ width: 2176, height: 544 });
    for (const [w, h] of [[352, 240], [768, 576], [1440, 1080], [3840, 1600], [637, 479]]) {
      const c = restoreCanvas(w, h);
      expect(c.width % 32, `${w}x${h}`).toBe(0);
      expect(c.height % 32, `${w}x${h}`).toBe(0);
      expect(Math.abs(Math.log(c.width / c.height) - Math.log(w / h)), `${w}x${h} keeps its shape`).toBeLessThan(0.035);
    }
  });

  it("tiles: 1440x1088 is the card's 2x3 grid of 960x544 tiles at 50%; stage 2 is twice the canvas with 1024x576 tiles", () => {
    expect(tileGrid({ width: 1440, height: 1088 })).toEqual({ columns: 2, rows: 3, tiles: 6 });
    expect(tileGrid({ width: 1920, height: 1088 })).toEqual({ columns: 3, rows: 3, tiles: 9 });
    expect(tileGrid({ width: 960, height: 544 })).toEqual({ columns: 1, rows: 1, tiles: 1 });
    expect(refineCanvas({ width: 1440, height: 1088 })).toEqual({ width: 2880, height: 2176 });
    expect(tileGrid(refineCanvas({ width: 1440, height: 1088 }), RESTORE.refineTile)).toEqual({ columns: 5, rows: 7, tiles: 35 });
  });

  it("holds the card's numbers the research records", () => {
    expect(record.open.tiles).toMatchObject({ width: RESTORE.tile.width, height: RESTORE.tile.height, overlap: RESTORE.overlap });
    expect(record.open.sigmas).toEqual(RESTORE.sigmas);
    expect(record.open.windows).toMatchObject({ frames: RESTORE.window, prefix: RESTORE.prefix });
    expect(record.open.stage2.tiles).toMatchObject(RESTORE.refineTile);
    expect(record.open.stage2.lora).toBe(RESTORE.loras.refine.file);
    expect(record.cloud.endpoint).toBe("fal-ai/ltx-2.3-22b/reference-video-to-video/lora");
  });
});

describe("Restore & colourise: windows and the 17-frame hand-off", () => {
  it("a short clip is one 8n+1 window; the frames past the last whole window (fewer than 8) are left out", () => {
    expect(restoreWindows(8)).toEqual([]);
    expect(restoreWindows(9)).toEqual([{ index: 0, start: 0, frames: 9, prefix: 0, keep: 9 }]);
    expect(restoreWindows(50)).toEqual([{ index: 0, start: 0, frames: 49, prefix: 0, keep: 49 }]);
    expect(restoreWindows(97)).toEqual([{ index: 0, start: 0, frames: 97, prefix: 0, keep: 97 }]);
    expect(framesCovered(restoreWindows(103))).toBe(97);
  });

  it("each next window starts 17 frames back, on the window before's last 17 restored frames, and adds up to 80", () => {
    const w = restoreWindows(545); // the card's measured 545-frame clip
    expect(w.map((x) => [x.start, x.frames, x.prefix, x.keep])).toEqual([
      [0, 97, 0, 97],
      [80, 97, 17, 80],
      [160, 97, 17, 80],
      [240, 97, 17, 80],
      [320, 97, 17, 80],
      [400, 97, 17, 80],
      [480, 65, 17, 48],
    ]);
    expect(framesCovered(w)).toBe(545);
    for (const [i, x] of w.entries()) {
      expect((x.frames - 1) % 8, `window ${i} is 8n+1`).toBe(0);
      expect(x.frames).toBeLessThanOrEqual(97);
      if (i === 0) continue;
      const prev = w[i - 1];
      // The prefix is the window before's own last 17 frames: its saved output (its kept frames) less 17.
      expect(x.start).toBe(prev.start + prev.frames - 17);
      expect(x.prefixFrom).toBe(prev.keep - 17);
    }
  });

  it("a tail of a few frames gets a short window of 17 + 8n, and covers all but fewer than 8 frames", () => {
    for (const n of [98, 105, 113, 200, 333, 1000, 2880]) {
      const w = restoreWindows(n);
      expect(n - framesCovered(w), `${n} frames`).toBeLessThan(8);
      expect(framesCovered(w), `${n} frames`).toBeGreaterThan(n - 8);
    }
    expect(restoreWindows(105).map((x) => x.frames)).toEqual([97, 25]);
  });

  it("cloud pieces are 8n+1 frames of at most 97, as even as possible", () => {
    expect(cloudPieceFrames(97)).toEqual([97]);
    expect(cloudPieceFrames(98)).toEqual([49, 49]);
    expect(cloudPieceFrames(240)).toEqual([81, 81, 73]);
    for (const n of [9, 120, 721]) for (const f of cloudPieceFrames(n)) expect((f - 1) % 8).toBe(0);
  });
});

describe("Restore & colourise: the words", () => {
  it("the card's prompt: what happens, place, period, light, materials, clothing, natural colour", () => {
    expect(
      restorePrompt({ subject: "a steam locomotive arriving at a small rural railway station", period: "1896", light: "overcast daylight", materials: "wooden station buildings", clothing: "passengers in period coats and hats" }),
    ).toBe("a steam locomotive arriving at a small rural railway station in 1896, overcast daylight, wooden station buildings, passengers in period coats and hats, natural colour");
    expect(restorePrompt({ subject: "a family meal", place: "a living room", period: "1950s" })).toBe("a family meal in a living room in 1950s, natural colour");
    expect(restorePrompt({})).toBe("the scene as it was filmed, natural colour");
  });

  it("the negative: modern things first, then the card's artefacts, each once", () => {
    const n = restoreNegative(["modern vehicles", "Logos", "logos", " signage "]);
    expect(n).toBe(["modern vehicles", "logos", "signage", ...ARTEFACTS].join(", "));
    expect(restoreNegative()).toContain("shipping containers");
  });

  it("the offline writer fills the template from a hint, with a year it finds", () => {
    const o = offlineRestorePrompt("A tram on a city street in the 1930s");
    expect(o.prompt).toMatch(/^A tram on a city street in 1930s, natural daylight, .*natural colour, sharp photographic detail, natural grain$/);
    expect(o.negative).toContain("blocky compression");
    expect(offlineRestorePrompt().prompt).toMatch(/^the scene as it was filmed, natural daylight/);
  });

  it("reads an LLM's two lines; a prompt without its ending gets natural colour, a missing one is null", () => {
    const a = parsePromptAnswer("PROMPT: a crowd at a seaside pier in the 1920s, bright summer sun, striped bathing costumes\nNEGATIVE: Cars, mobile phones, plastic chairs");
    expect(a?.prompt).toBe("a crowd at a seaside pier in the 1920s, bright summer sun, striped bathing costumes, natural colour");
    expect(a?.negative.startsWith("cars, mobile phones, plastic chairs, blocky compression")).toBe(true);
    expect(parsePromptAnswer("**PROMPT:** a horse-drawn cart on a cobbled lane, natural colour")?.negative).toContain("modern cars");
    expect(parsePromptAnswer("I can't see the frames.")).toBeNull();
    expect(restoreTitle("a horse-drawn cart on a cobbled lane in 1910, overcast, natural colour", "reel_04.mov")).toBe("Restored · A horse-drawn cart on a cobbled · reel_04");
  });
});

describe("Restore & colourise: what may run", () => {
  const src = { duration: 10, fps: 24 };
  it("refuses a clip it can't read, a clip over two minutes, a 4K pass in the cloud and an unknown cloud tier", () => {
    expect(restoreProblem({ engine: "open", source: {} })).toMatch(/Reading the clip/);
    expect(restoreProblem({ engine: "open", source: { duration: 130, fps: 24 } })).toMatch(/up to 2 minutes/);
    expect(restoreProblem({ engine: "cloud", source: src, refine: true })).toMatch(/runs on your GPU/);
    expect(restoreProblem({ engine: "cloud", source: src, resolution: "4K" })).toMatch(/720p or 1080p/);
    expect(restoreProblem({ engine: "open", source: src, refine: true })).toBeNull();
    expect(restoreProblem({ engine: "open", source: { duration: 0.2, fps: 24 } })).toMatch(/too short/);
  });
});

describe("Restore & colourise: the pipeline", () => {
  const source = { url: "/api/files/reel.mp4", duration: 545 / 24, fps: 24, width: 640, height: 480, hasAudio: true, frames: 545 };
  const words = { prompt: "a station in 1896, natural colour", negative: restoreNegative() };

  it("GPU: windows chained by their prefix, joined packet by packet, the sound put back; each window names its frames", () => {
    const plan = planRestore({ engine: "open", title: "Restored", source, ...words, deinterlace: true, seed: 7 });
    expect(plan.pieces).toBe(7);
    expect(plan.canvas).toEqual({ width: 1440, height: 1088 });
    expect(plan.dropped).toBe(0);
    const keys = plan.steps.map((s) => s.key);
    expect(keys).toEqual(["restore0", "restore1", "restore2", "restore3", "restore4", "restore5", "restore6", "join", "final"]);
    const w1 = plan.steps[1];
    expect(w1.after).toEqual(["restore0"]);
    expect(w1.chain).toEqual([{ slot: "videos", position: "first" }]);
    expect(w1.request).toMatchObject({ modelId: "fuobe-restore", engine: "open", op: "restore-video", inputs: { video: source.url }, negativePrompt: words.negative });
    expect(w1.request.params?.extra).toEqual({ stage: "restore", windowStart: 80, windowFrames: 97, prefixFrames: 17, prefixFrom: 80, canvasWidth: 1440, canvasHeight: 1088, deinterlace: true });
    expect(plan.steps[0].after).toBeUndefined();
    expect(plan.steps[0].request.params?.extra).toMatchObject({ windowStart: 0, windowFrames: 97, prefixFrames: 0 });
    const join = plan.steps.find((s) => s.key === "join")!;
    expect(join.request.modelId).toBe("oss-join-encoded");
    expect(join.after).toHaveLength(7);
    const final = plan.steps.find((s) => s.key === "final")!;
    expect(final.request).toMatchObject({ modelId: "oss-mux", op: "mux", inputs: { audio: source.url }, feature: "restore", title: "Restored" });
    expect(plan.final).toBe("final");
    // Only the finished video is a result; windows and joins are steps.
    expect(plan.steps.filter((s) => s.request.feature === "restore").map((s) => s.key)).toEqual(["final"]);
  });

  it("GPU, Restore to 4K: the joined clip again in 97-frame windows with the Detail Refine pass at twice the canvas", () => {
    const plan = planRestore({ engine: "open", title: "Restored", source: { ...source, hasAudio: false }, ...words, refine: true });
    expect(plan.refined).toEqual({ width: 2880, height: 2176 });
    const refines = plan.steps.filter((s) => s.key.startsWith("refine"));
    expect(refines.map((s) => s.request.params?.extra?.windowFrames)).toEqual([97, 89, 89, 89, 89, 89, 89].slice(0, refines.length));
    for (const r of refines) {
      expect(r.after).toEqual(["join"]);
      expect(r.chain).toEqual([{ slot: "video" }]);
      expect(r.request.params?.extra).toMatchObject({ stage: "refine", prefixFrames: 0, canvasWidth: 2880, canvasHeight: 2176 });
    }
    expect(plan.final).toBe("join4k");
    expect(plan.steps.find((s) => s.key === "join4k")!.request).toMatchObject({ modelId: "oss-join-encoded", feature: "restore" });
    expect(545 - plan.dropped).toBe(refines.reduce((n, r) => n + Number(r.request.params?.extra?.windowFrames), 0));
  });

  it("cloud: frame-exact pieces, each after the first starting from the last restored frame, joined, the sound cut to the picture", () => {
    const plan = planRestore({ engine: "cloud", title: "Restored", source: { ...source, frames: 240, duration: 10 }, ...words, resolution: "1080p" });
    expect(plan.canvas).toEqual({ width: 1440, height: 1088 });
    expect(plan.pieces).toBe(3);
    const r1 = plan.steps.find((s) => s.key === "restore1")!;
    expect(r1.after).toEqual(["cut1", "hand1"]);
    expect(r1.chain).toEqual([{ slot: "video" }, { slot: "images" }]);
    expect(r1.request.params).toMatchObject({ aspectRatio: "4:3", resolution: "1080p", fps: 24 });
    expect(plan.steps.find((s) => s.key === "hand1")!).toMatchObject({ after: ["restore0"], request: { modelId: "extract-frame", op: "frame" } });
    expect(plan.steps.find((s) => s.key === "join")!.request.modelId).toBe("join-clips");
    // 81 + 81 + 73 = 235 of 240 frames: the sound is the first 235 / 24 s.
    expect(plan.dropped).toBe(5);
    const cut = plan.steps.find((s) => s.key === "sound")!.request.params!;
    expect(cut.startTime).toBe(0);
    expect(cut.endTime).toBeCloseTo(235 / 24, 5);
    expect(plan.steps.find((s) => s.key === "final")!.request.modelId).toBe("merge-audio-video");
  });

  it("cloud: the reference picture is the first piece's first frame (fal's image_url); later pieces start from the hand-off", () => {
    const ref = "/api/files/ref.png";
    const plan = planRestore({ engine: "cloud", title: "Restored", source: { ...source, frames: 240, duration: 10 }, ...words, reference: ref });
    const r0 = plan.steps.find((s) => s.key === "restore0")!;
    expect(r0.request.inputs).toEqual({ images: [ref] });
    // The cut piece arrives through the chain, beside the picture.
    expect(withChainInputs({ ...r0.request, chain: r0.chain }, ["/api/files/cut0.mp4"]).inputs).toEqual({ images: [ref], video: "/api/files/cut0.mp4" });
    for (const k of ["restore1", "restore2"]) expect(plan.steps.find((s) => s.key === k)!.request.inputs, k).toBeUndefined();
    // A clip of one whole piece: the clip and the picture together.
    const whole = planRestore({ engine: "cloud", title: "R", source: { url: "/api/files/a.mp4", duration: 97 / 24, frames: 97, fps: 24, width: 1280, height: 720, hasAudio: false }, ...words, reference: ref });
    expect(whole.steps[0].request.inputs).toEqual({ video: "/api/files/a.mp4", images: [ref] });
    // Without one, nothing is added.
    const none = planRestore({ engine: "cloud", title: "Restored", source: { ...source, frames: 240, duration: 10 }, ...words });
    expect(none.steps.find((s) => s.key === "restore0")!.request.inputs).toBeUndefined();
  });

  it("cloud: a clip of one whole piece runs as it is; its shape picks the tier's size", () => {
    const plan = planRestore({ engine: "cloud", title: "R", source: { url: "/api/files/a.mp4", duration: 97 / 24, frames: 97, fps: 24, width: 1280, height: 720, hasAudio: false }, ...words });
    expect(plan.steps.map((s) => s.key)).toEqual(["restore0"]);
    expect(plan.steps[0].request).toMatchObject({ inputs: { video: "/api/files/a.mp4" }, params: { aspectRatio: "16:9", resolution: "720p" }, feature: "restore" });
    expect(plan.canvas).toEqual({ width: 1280, height: 704 });
    expect(cloudShape(720, 576)).toBe("4:3");
  });

  it("Then upscale (Upscale → Restore archive footage first): the restored clip goes to the engine's upscaler, which is the result", () => {
    for (const [engine, model] of [
      ["open", "oss-seedvr2"],
      ["cloud", "topaz-video"],
    ] as const) {
      const plan = planRestore({ engine, title: "Restored", source, ...words, upscale: true });
      expect(plan.final, engine).toBe("upscale");
      const up = plan.steps[plan.steps.length - 1];
      expect(up, engine).toMatchObject({ key: "upscale", after: ["final"], chain: [{ slot: "video" }] });
      expect(up.request, engine).toMatchObject({ modelId: model, engine, op: "upscale-video", feature: "restore", title: "Restored", params: { resolution: "2160p" } });
      // The restored clip with its sound is now a step: one finished video per run.
      expect(plan.steps.filter((s) => s.request.feature === "restore").map((s) => s.key), engine).toEqual(["upscale"]);
      expect(plan.steps.find((s) => s.key === "final")!.request.title, engine).toBeUndefined();
    }
    expect(restoreProblem({ engine: "open", source: { duration: 4, fps: 24 }, refine: true, upscale: true })).toMatch(/Restore to 4K already doubles the size/);
    expect(restoreProblem({ engine: "open", source: { duration: 4, fps: 24 }, upscale: true })).toBeNull();
    // Upscale → Video lists it among its first steps, opening Restore with the upscale on.
    expect(VIDEO_UPSCALE_STUDIO.firstSteps).toEqual(UPSCALE_FIRST_STEPS);
    expect(UPSCALE_FIRST_STEPS.find((f) => f.id === "restore")).toMatchObject({ label: "Restore archive footage first", href: `/video-tools/restore?then=${THEN_UPSCALE}` });
  });

  it("prices a cloud piece per megapixel of video on the LoRA endpoint; free on the GPU", () => {
    const m = getModel("fuobe-restore")!;
    const cloud = onEngine(m, "cloud");
    // 97 frames at 1024x768: 76.3 MP → 77 MP at $0.001805.
    expect(estimateCost(cloud, { aspectRatio: "4:3", resolution: "720p", fps: 24, duration: 97 / 24, sourceDuration: 97 / 24 }, 1, "restore-video", true)).toBeCloseTo(77 * 0.001805, 3);
    expect(estimateCost(onEngine(m, "open"), { sourceDuration: 4 }, 1, "restore-video")).toBe(0);
  });
});

describe("Fuobe Restore in the catalog", () => {
  it("an Original on both engines: the GPU graph and fal's LTX-2.3 reference video to video with the Restore LoRA", () => {
    const m = getModel("fuobe-restore")!;
    expect(m.engines).toEqual(["open", "cloud"]);
    expect(m.routes.map((r) => [r.op, r.provider, r.endpoint])).toEqual([
      ["restore-video", "comfyui", RESTORE.workflow],
      ["restore-video", "fal", "fal-ai/ltx-2.3-22b/reference-video-to-video/lora"],
    ]);
    const fal = m.routes[1].map!;
    expect(fal.video).toBe("video_url");
    expect(fal.image).toBe("image_url");
    expect(fal.fixed).toMatchObject({ ic_lora_type: "none", preprocessor: "none", generate_audio: false, enable_prompt_expansion: false });
    expect(fal.loras).toMatchObject({ shape: "items", key: "loras", required: true });
    // The GPU graph loads its LoRA itself; the cloud carries it as a LoRA (Fuobe's mirror of the gated file).
    expect(onEngine(m, "open").options.loras).toBeUndefined();
    expect(onEngine(m, "cloud").options.loras?.map((l) => l.file)).toEqual([RESTORE.loras.restore.file]);
  });

  it("plans a single run from its clip alone (the words are optional) and says what to add without one", () => {
    const m = getModel("fuobe-restore")!;
    const open = (id: string) => (id === m.id ? onEngine(m, "open") : getModel(id));
    const p = planGeneration({ feature: "restore", modelId: m.id, inputs: { video: "/api/files/a.mp4" } }, open, getPreset);
    expect(p.op).toBe("restore-video");
    expect(p.prompt).toMatch(/natural colour/);
    expect(() => planGeneration({ feature: "restore", modelId: m.id, prompt: "x" }, open, getPreset)).toThrow(/archive clip to restore/);
  });
});

describe("Restore & colourise: one run of the GPU graph", () => {
  const clip = { width: 640, height: 480, fps: 24, frames: 545, duration: 545 / 24 };
  it("a planned window: its frames, the canvas, the prefix from the window before, the Restore LoRA and 960x544 tiles", () => {
    const j = restoreJob({ extra: { windowStart: 80, windowFrames: 97, prefixFrames: 17, prefixFrom: 80, canvasWidth: 1440, canvasHeight: 1088 }, clip, prefixVideo: "prev.mp4" });
    expect(j).toMatchObject({ prefix: true, reference: false, deinterlace: false, stage: "restore" });
    expect(j.values).toMatchObject({ windowStart: 80, windowFrames: 97, prefixFrames: 17, prefixFrom: 80, canvasWidth: 1440, canvasHeight: 1088, lora: RESTORE.loras.restore.file, tileWidth: 960, tileHeight: 544, streaming: false, tileFrames: 0, fps: 24, cfg: 1 });
  });

  it("a whole clip on its own: one pass up to 97 frames, the sampler's streaming windows past that, up to 481", () => {
    expect(restoreJob({ extra: {}, clip: { ...clip, frames: 60 } }).values).toMatchObject({ windowFrames: 57, streaming: false, tileFrames: 0 });
    expect(restoreJob({ extra: {}, clip: { ...clip, frames: 300 } }).values).toMatchObject({ windowFrames: 297, streaming: true, tileFrames: 97 });
    expect(() => restoreJob({ extra: {}, clip })).toThrow(/Video tools → Restore & colourise/);
    expect(() => restoreJob({ extra: {}, clip: { ...clip, frames: 300 }, reference: "ref.png" })).toThrow(/one window/);
    expect(() => restoreJob({ extra: {}, clip: { width: 640, height: 480 } })).toThrow(/frame rate/);
  });

  it("stage 2: the Detail Refine LoRA, 1024x576 tiles, twice the restored clip; deinterlacing keeps one field", () => {
    const r = restoreJob({ extra: { stage: "refine" }, clip: { width: 1440, height: 1088, fps: 24, frames: 97 } });
    expect(r.values).toMatchObject({ lora: RESTORE.loras.refine.file, tileWidth: 1024, tileHeight: 576, canvasWidth: 2880, canvasHeight: 2176 });
    const d = restoreJob({ extra: { deinterlace: true }, clip: { ...clip, frames: 49 } });
    expect(d.values).toMatchObject({ fieldWidth: 640, fieldHeight: 240 });
    expect(() => restoreJob({ extra: { windowFrames: 96 }, clip })).toThrow(/8n\+1/);
    expect(() => restoreJob({ extra: { windowFrames: 97, prefixFrames: 17, prefixFrom: 80 }, clip })).toThrow(/hasn't finished/);
  });

  it("downloads the LoRA the graph loads: Restore, or Detail Refine for stage 2 (both gated, pinned)", () => {
    expect(restoreGraphLoras(RESTORE.workflow, {}).map((l) => [l.file, l.version])).toEqual([[RESTORE.loras.restore.file, "79245e197a6cd3251e77d178dc380b0e9f2d6563"]]);
    expect(restoreGraphLoras(RESTORE.workflow, { stage: "refine" }).map((l) => l.file)).toEqual([RESTORE.loras.refine.file]);
    expect(restoreGraphLoras("ltx25-i2v", {})).toEqual([]);
  });

  it("takes out the branches a run doesn't use and links around them", () => {
    const wf = JSON.parse(fs.readFileSync(path.join(__dirname, "../workflows/comfyui/video-restore-ltx25-tiled.json"), "utf8")) as ComfyWorkflow;
    const first = restoreGraph(wf, { prefix: false, reference: false, deinterlace: false }, ["save"]);
    for (const gone of ["prefix", "prefix_source", "reference", "reference_fit", "reference_guide", "field"]) expect(first[gone], gone).toBeUndefined();
    expect(first.sample.inputs).toMatchObject({ positive: ["guide", 0], negative: ["guide", 1], latents: ["guide", 2] });
    expect(first.canvas.inputs.image).toEqual(["source", 0]);
    const all = restoreGraph(wf, { prefix: true, reference: true, deinterlace: true }, ["save"]);
    expect(Object.keys(all).sort()).toEqual(Object.keys(wf).sort());
    const prefixOnly = restoreGraph(wf, { prefix: true, reference: false, deinterlace: false }, ["save"]);
    expect(prefixOnly.sample.inputs).toMatchObject({ positive: ["prefix", 0], negative: ["prefix", 1], latents: ["prefix", 2] });
  });
});

describe("Restore & colourise on the canvas", () => {
  const n = (id: string, type: CanvasNode["type"], data: CanvasNode["data"] = {}): CanvasNode => ({ id, type, position: { x: 0, y: 0 }, data });

  it("a Utilities node on both engines: Fuobe Restore by default, the clip, the words and an optional coloured first frame in, a video out", () => {
    const item = paletteItems().find((p) => p.id === "restore")!;
    expect(item).toMatchObject({ type: "restore", label: "Restore & colourise", group: "Utilities" });
    for (const mode of ["open", "cloud"] as const) {
      expect(paletteItems(mode).find((p) => p.id === "restore")!.disabled).toBeUndefined();
      expect(defaultModelForNode({ type: "restore", data: {} }, mode)?.id).toBe(RESTORE.model);
    }
    const node = n("r", "restore", { modelId: RESTORE.model, engine: "cloud" });
    expect(inputPorts(node).map((p) => p.id)).toEqual(["prompt", "images", "video"]);
    expect(outputType({ nodes: [node], edges: [] }, node)).toBe("video");
    expect(nodeEngine(node, getModel(RESTORE.model)!)).toBe("cloud");
  });

  it("runs a clip from the board as one restore-video generation; switching the board's engine keeps the Original", () => {
    const g: CanvasGraph = {
      nodes: [n("clip", "video-input", { url: "/api/files/scan.mp4" }), { ...n("r", "restore", { modelId: RESTORE.model, prompt: "a harbour in the 1930s, natural colour" }), position: { x: 300, y: 0 } }],
      edges: [{ id: "e", source: "clip", sourceHandle: "out", target: "r", targetHandle: "video" }],
    };
    const d = describeNode(g, g.nodes[1]);
    expect(d.error).toBeUndefined();
    expect(d.plan?.op).toBe("restore-video");
    const cloud = convertEngine(g, "cloud");
    expect(cloud.missing).toEqual([]);
    expect(cloud.graph.nodes[1].data).toMatchObject({ modelId: RESTORE.model, engine: "cloud" });
  });
});

describe("Old footage in Shorts and the Explainer", () => {
  const px = (...rgb: [number, number, number][]) => rgb.flatMap(([r, g, b]) => [r, g, b, 255]);
  it("reads black-and-white and sepia frames as monochrome, a colour frame not; the Restore link carries the clip", () => {
    expect(meanChroma(px([10, 10, 10], [200, 200, 200]))).toBe(0);
    // A sepia-toned print stays under the line; a colour street does not.
    expect(meanChroma(px([120, 110, 98], [190, 182, 172]))).toBeLessThan(MONOCHROME_CHROMA);
    expect(meanChroma(px([200, 40, 40], [30, 160, 60]))).toBeGreaterThan(MONOCHROME_CHROMA);
    expect(meanChroma([])).toBe(0);
    expect(restoreHref("/api/files/a b.mp4")).toBe("/video-tools/restore?video=%2Fapi%2Ffiles%2Fa%20b.mp4");
    expect(restoreHref()).toBe("/video-tools/restore");
  });
});
