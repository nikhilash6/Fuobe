import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { getModel, getPreset, MODELS, modelsFor } from "@/lib/catalog";
import { CLOUD_MODELS } from "@/lib/catalog/cloud-models.generated";
import { buildPayload, fitValue, keyframesValue, pointsValue } from "@/lib/catalog/payload";
import { estimateCost, inferOperation, planGeneration, pricingAt, promptOptional } from "@/lib/catalog/plan";
import { OPERATION_LABELS, OPERATION_OUTPUT, type GenerationRequest, type ModelRoute, type Operation } from "@/lib/catalog/types";

type Endpoint = { provider: string; endpoint: string; status?: string; verified?: boolean; inputs?: Record<string, { values?: unknown[] }> };
const research4 = (JSON.parse(fs.readFileSync("docs/research/paid-model-apis-4.json", "utf8")) as { endpoints: Endpoint[] }).endpoints;
const byId = new Map(research4.map((e) => [`${e.provider}:${e.endpoint}`, e]));

/** The models round 4 added (research part 4), with the operation each is for. */
const ROUND4: Record<string, Operation> = {
  "bria-video-erase": "remove-object",
  "bria-video-erase-points": "remove-object",
  "bria-video-erase-mask": "remove-object",
  "void-video-inpainting": "remove-object",
  "ltx-2-3-clean-plate": "remove-object",
  "wan-22-vace-inpaint": "remove-object",
  "sam-3-1-video-mask": "bg-remove-video",
  "p-video-replace": "video-swap",
  "topaz-fps-boost": "interpolate",
  "rife-video-cloud": "interpolate",
  "topaz-sdr-to-hdr": "sdr-to-hdr",
  "ltx-2-3-hdr": "sdr-to-hdr",
  "ken-burns": "still-motion",
  "overlay-image": "overlay",
  "extract-frames": "extract-frames",
  "images-to-video": "images-to-video",
  "join-audio": "audio-join",
  "florence-2-ocr": "ocr",
  triposplat: "splat",
  "sam-3d-objects": "image-to-3d",
  "tripo-h3-1-text": "text-to-3d",
  "meshy-7-1-multi": "image-to-3d",
  "meshy-rigging": "rig-3d",
  "flux-3-max": "keyframes",
  "heygen-video": "ref2v",
  "grok-imagine-video-1-5": "ref2v",
  "grok-imagine-video-1-5-lite": "t2v",
  "pixverse-v6-max": "t2v",
  "p-video-2-pro-reference": "ref2v",
  "creatify-boreal": "t2v",
  "pixelcut-looping-video": "i2v",
  "minimax-h3-max-reframe": "reframe",
  "p-video-2-pro-avatar": "avatar",
  "krea-3": "t2i",
  "grok-imagine-image-2": "edit",
  "bria-fibo-2": "inpaint",
  "ideogram-vector": "vectorize",
  "bria-expand": "outpaint",
  "heygen-voice-turbo": "tts",
  "gemini-3-8-flash-tts": "tts",
};

/** Chain helpers that never show in a picker (SAM 3.1's mask is also Remove background's "keep what you name" on the cloud). */
const HIDDEN = ["bria-video-erase-points", "bria-video-erase-mask", "ken-burns", "overlay-image", "extract-frames", "images-to-video", "join-audio"];

const NEW_OPS: Operation[] = [
  "remove-object", "video-swap", "video-insert", "keyframes", "sdr-to-hdr", "export-video", "ocr", "still-motion", "audio-loop", "audio-join",
  "scene-3d", "splat", "text-to-3d", "rig-3d", "extract-frames", "images-to-video", "overlay",
];

const route = (id: string, op?: Operation, provider = "fal"): ModelRoute => {
  const m = getModel(id);
  if (!m) throw new Error(`no model ${id}`);
  const r = m.routes.find((x) => (!op || x.op === op) && x.provider === provider);
  if (!r) throw new Error(`${id} has no ${provider} ${op} route`);
  return r;
};
const map = (id: string, op?: Operation, provider = "fal") => route(id, op, provider).map!;
const plan = (req: Omit<GenerationRequest, "feature">) => planGeneration({ feature: "x", ...req }, getModel, getPreset);
const fails = (req: Omit<GenerationRequest, "feature">) => {
  try {
    plan(req);
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};

describe("round-4 operations", () => {
  it("every new operation has a label and an output kind", () => {
    for (const op of NEW_OPS) {
      expect(OPERATION_LABELS[op], op).toBeTruthy();
      expect(OPERATION_OUTPUT[op], op).toBeTruthy();
    }
    expect(OPERATION_OUTPUT.ocr).toBe("text");
    expect(OPERATION_OUTPUT.splat).toBe("model3d");
    expect(OPERATION_OUTPUT["scene-3d"]).toBe("model3d");
    expect(OPERATION_OUTPUT["extract-frames"]).toBe("image");
    expect(OPERATION_OUTPUT["audio-loop"]).toBe("audio");
    expect(OPERATION_OUTPUT.overlay).toBe("image");
  });
});

describe("round-4 cloud models", () => {
  it("every new model resolves, is cloud, of its operation's kind, on active researched endpoints", () => {
    for (const [id, op] of Object.entries(ROUND4)) {
      const m = getModel(id);
      expect(m, id).toBeDefined();
      expect(m!.engine, id).toBe("cloud");
      expect(m!.routes.some((r) => r.op === op), `${id} ${op}`).toBe(true);
      // SAM 3.1's mask video is a video; every other model's kind is what its operation makes.
      expect(m!.kind, id).toBe(OPERATION_OUTPUT[op]);
      for (const r of m!.routes.filter((x) => x.provider === "fal" || x.provider === "replicate")) {
        const e = byId.get(`${r.provider}:${r.endpoint}`);
        if (!e) continue; // parts 1-3 (Kling O3 edit, extract-nth-frame): cloud-catalog.test.ts checks those
        expect(["active", "unlisted"], `${id} ${r.endpoint} ${e.status}`).toContain(e.status);
      }
    }
  });

  it("leaves Kling 4.0 out until its API opens", () => {
    const routes = MODELS.flatMap((m) => m.routes);
    expect(routes.filter((r) => r.endpoint.startsWith("kling/v4/"))).toEqual([]);
    expect(research4.filter((e) => e.endpoint.startsWith("kling/v4/")).every((e) => e.status === "playground-only")).toBe(true);
    expect(fs.readFileSync("scripts/gen-cloud-models.py", "utf8")).toMatch(/TODO\(kling-4\)/);
  });

  it("hides chain helpers and shows the new models in their studios' pickers", () => {
    for (const id of HIDDEN) expect(getModel(id)!.hidden, id).toBe(true);
    for (const id of Object.keys(ROUND4).filter((x) => !HIDDEN.includes(x))) expect(getModel(id)!.hidden, id).toBeFalsy();
    const ids = (kind: Parameters<typeof modelsFor>[0]["kind"], ops: Operation[]) => modelsFor({ kind, ops, engine: "cloud" }).map((m) => m.id);
    // Video studio (t2v / i2v / flf2v / ref2v), lipsync & avatars, reframe, motion transfer.
    expect(ids("video", ["t2v", "i2v", "flf2v", "ref2v"])).toEqual(
      expect.arrayContaining(["flux-3-max", "heygen-video", "grok-imagine-video-1-5", "grok-imagine-video-1-5-lite", "pixverse-v6-max", "p-video-2-pro-reference", "creatify-boreal", "pixelcut-looping-video"]),
    );
    expect(ids("video", ["t2v", "i2v", "flf2v", "ref2v"])).not.toEqual(expect.arrayContaining(["wan-22-vace-inpaint"]));
    expect(ids("video", ["avatar", "lipsync"])).toContain("p-video-2-pro-avatar");
    expect(ids("video", ["reframe"])).toContain("minimax-h3-max-reframe");
    expect(ids("video", ["motion-transfer"])).toContain("fuobe-genjutsu-motion-lite");
    // Image studio (t2i), Edit (edit), Inpaint, Vectorize, Audio (tts).
    expect(ids("image", ["t2i"])).toEqual(expect.arrayContaining(["krea-3", "grok-imagine-image-2", "bria-fibo-2", "ideogram-vector"]));
    expect(ids("image", ["edit"])).toEqual(expect.arrayContaining(["krea-3", "grok-imagine-image-2", "bria-fibo-2"]));
    expect(ids("image", ["inpaint"])).toContain("bria-fibo-2");
    expect(ids("image", ["vectorize"])[0]).toBe("recraft-vectorize");
    expect(ids("audio", ["tts"])).toEqual(expect.arrayContaining(["heygen-voice-turbo", "gemini-3-8-flash-tts"]));
    // The round-4 tools by operation (their studios come with the feature packages).
    expect(ids("video", ["remove-object"])).toEqual(expect.arrayContaining(["kling-o3", "kling-o3-4k-edit", "bria-video-erase", "void-video-inpainting", "ltx-2-3-clean-plate", "wan-22-vace-inpaint"]));
    expect(ids("video", ["video-swap"])).toEqual(expect.arrayContaining(["kling-o3", "wan-22-vace-inpaint", "p-video-replace", "fuobe-genjutsu-swap-lite", "fuobe-genjutsu-swap"]));
    expect(ids("video", ["video-insert"])).toEqual(expect.arrayContaining(["kling-o3", "wan-22-vace-inpaint"]));
    expect(ids("video", ["interpolate"])).toEqual(["topaz-fps-boost", "rife-video-cloud"]);
    expect(ids("video", ["sdr-to-hdr"])).toEqual(["topaz-sdr-to-hdr", "ltx-2-3-hdr"]);
    expect(ids("text", ["ocr"])).toEqual(["florence-2-ocr"]);
    expect(ids("model3d", ["splat"])).toEqual(["triposplat"]);
    expect(ids("model3d", ["text-to-3d"])).toEqual(["tripo-h3-1-text"]);
    expect(ids("model3d", ["rig-3d"])).toEqual(["meshy-rigging"]);
    expect(ids("video", ["keyframes"])).toEqual(["flux-3-max"]);
  });

  it("runs the Grok models on fal alone, and Genjutsu Lite as the Original's Lite tier", () => {
    for (const [id, ops] of [
      ["grok-imagine-video-1-5", ["t2v", "i2v", "ref2v"]],
      ["grok-imagine-image-2", ["t2i", "edit"]],
    ] as const) {
      const m = getModel(id)!;
      for (const op of ops) expect(m.routes.some((r) => r.op === op && r.provider === "fal"), `${id} fal ${op}`).toBe(true);
      expect(m.routes.every((r) => r.provider === "fal")).toBe(true);
    }
    expect(MODELS.filter((m) => m.id === "grok-imagine-video-1-5")).toHaveLength(1);
    expect(getModel("genjutsu-lite-object-swap")).toBeUndefined();
    expect(getModel("fuobe-genjutsu-swap-lite")!.engines).toEqual(["open", "cloud"]);
    expect(route("kling-o3", "remove-object", "fal").endpoint).toMatch(/kling-video\/o3/);
  });

  it("prices FLUX 3 Max at its launch rate until 2026-11-07, then at the list price", () => {
    const raw = CLOUD_MODELS.find((m) => m.id === "flux-3-max")!.pricing!;
    expect(raw).toMatchObject({ unit: "second", usd: 0.17, byResolution: { "720p": 0.17, "1080p": 0.29 }, promo: { until: "2026-11-07", usd: 0.0425 } });
    expect(pricingAt(raw, Date.parse("2026-10-22T12:00:00Z"))).toMatchObject({ usd: 0.0425, byResolution: { "720p": 0.0425, "1080p": 0.0725 } });
    expect(pricingAt(raw, Date.parse("2026-11-07T23:00:00Z")).usd).toBe(0.0425);
    const after = pricingAt(raw, Date.parse("2026-11-08T00:00:01Z"));
    expect(after).toMatchObject({ usd: 0.17, byResolution: { "720p": 0.17, "1080p": 0.29 } });
    expect(after.promo).toBeUndefined();
    // The catalog keeps both prices (no clock read when it loads or is copied); estimateCost picks the one of `now`.
    const live = getModel("flux-3-max")!;
    expect(live.pricing).toEqual(raw);
    expect(estimateCost(live, { duration: 10, resolution: "1080p" }, 1, undefined, false, Date.parse("2026-10-22T00:00:00Z"))).toBe(0.725);
    expect(estimateCost(live, { duration: 10, resolution: "1080p" }, 1, undefined, false, Date.parse("2026-11-08T00:00:01Z"))).toBe(2.9);
    expect(estimateCost({ ...live, pricing: after }, { duration: 10, resolution: "1080p" })).toBe(2.9);
  });

  it("reads the new research slots: points, keyframes, formats, zoom, overlay, retiming, frames, loops and rigging", () => {
    expect(map("bria-video-erase-points").points).toEqual({ key: "keypoints", format: "bria" });
    expect(map("sam-3-1-video-mask").points).toEqual({ key: "point_prompts", format: "sam" });
    expect(map("flux-3-max", "keyframes").keyframes).toEqual({ key: "keyframes", image: "image_url", frame: "frame_index", fps: 24 });
    expect(getModel("flux-3-max")!.options.maxImages).toBe(10);
    expect(map("topaz-sdr-to-hdr").format).toEqual({ key: "output_format", values: { h265_10bit: "mp4", prores_422_hq: "prores" } });
    expect(getModel("topaz-sdr-to-hdr")!.options.formats).toEqual(["h265_10bit", "prores_422_hq"]);
    expect(getModel("ltx-2-3-hdr")!.options.formats).toEqual(["exr"]);
    expect(map("ken-burns").zoom).toMatchObject({ factor: "zoom_factor", max: 2, direction: { key: "zoom_direction", in: "in", out: "out" }, x: "zoom_x", y: "zoom_y", percent: true });
    expect(map("overlay-image")).toMatchObject({ image: "background_image_url", image2: "overlay_image_url", position: { x: "x_percent", y: "y_percent", percent: true }, scale: { key: "scale_percent", multiplier: 100 } });
    expect(map("topaz-fps-boost")).toMatchObject({ targetFps: "target_fps", slowdown: "slowdown_factor", defaults: { H264_output: true } });
    expect(map("rife-video-cloud").targetFps).toBeUndefined();
    expect(map("images-to-video").frames).toEqual({ key: "images", url: "url", frames: "frames" });
    expect(map("join-audio", "audio-loop").loop).toEqual({ key: "audio_urls", max: 5 });
    expect(map("join-audio", "audio-join").audios).toBe("audio_urls");
    expect(map("meshy-rigging")).toMatchObject({ model3d: "model_url", animation: { key: "animation_action_id", flag: "enable_animation" } });
    expect(map("extract-frames")).toMatchObject({ frameInterval: "frame_interval", defaults: { max_frames: 500 } });
    expect(map("depth-anything-video-cloud").colormap).toBe("colormap");
  });
});

describe("round-4 payloads", () => {
  it("sends clicked points in each API's own shape", () => {
    const points = [
      { x: 100.4, y: 220.6 },
      { x: 40, y: 50, label: "negative" as const },
    ];
    expect(pointsValue("bria", points)).toEqual(["{'x':100, 'y':221, 'type':'positive'}", "{'x':40, 'y':50, 'type':'negative'}"]);
    expect(buildPayload(map("bria-video-erase-points"), { video: "v.mp4", points })).toEqual({
      video_url: "v.mp4",
      keypoints: ["{'x':100, 'y':221, 'type':'positive'}", "{'x':40, 'y':50, 'type':'negative'}"],
    });
    expect(buildPayload(map("sam-3-1-video-mask"), { prompt: "", video: "v.mp4", points })).toEqual({
      prompt: "",
      video_url: "v.mp4",
      point_prompts: [
        { x: 100, y: 221, label: 1 },
        { x: 40, y: 50, label: 0 },
      ],
      apply_mask: false,
    });
    // SAM 3D Objects: words and clicks together; its prompt is always sent (the API's default is "car").
    expect(buildPayload(map("sam-3d-objects"), { prompt: "chair, lamp", images: ["room.png"], points: [{ x: 10, y: 20 }] })).toEqual({
      prompt: "chair, lamp",
      image_url: "room.png",
      point_prompts: [{ x: 10, y: 20, label: 1 }],
      export_textured_glb: true,
    });
  });

  it("pins keyframes to frame indexes at the API's frame rate", () => {
    const kf = map("flux-3-max", "keyframes").keyframes!;
    expect(buildPayload(map("flux-3-max", "keyframes"), { prompt: "p", images: ["a.png", "b.png", "c.png"], keyframeTimes: [0, 2.5, 5], duration: 5 })).toMatchObject({
      prompt: "p",
      duration: 5,
      keyframes: [
        { image_url: "a.png", frame_index: 0 },
        { image_url: "b.png", frame_index: 60 },
        { image_url: "c.png", frame_index: 120 },
      ],
    });
    // No times: spread over the clip, last on its final frame (at most duration × 24).
    expect(keyframesValue(kf, ["a", "b", "c"], undefined, 10).map((k) => k.frame_index)).toEqual([0, 120, 240]);
    // Times past the end are held at the end; equal frames are nudged apart (the API wants them unique).
    expect(keyframesValue(kf, ["a", "b", "c"], [0, 0.01, 9], 5).map((k) => k.frame_index)).toEqual([0, 1, 120]);
    // Nudged apart at the very end, they step back: the last stays on the final frame (at most duration × 24).
    expect(keyframesValue(kf, ["a", "b"], [4.99, 5], 5).map((k) => k.frame_index)).toEqual([119, 120]);
    expect(keyframesValue(kf, ["a", "b", "c"], [4.9, 4.95, 5], 5).map((k) => k.frame_index)).toEqual([118, 119, 120]);
    expect(keyframesValue(kf, ["a"], undefined, 5)).toEqual([{ image_url: "a", frame_index: 0 }]);
    // The keyframes route takes no start or end image fields.
    expect(map("flux-3-max", "keyframes").image).toBeUndefined();
  });

  it("writes params.format as each API's own value and leaves out what it can't write", () => {
    expect(buildPayload(map("topaz-sdr-to-hdr"), { video: "v.mp4", format: "h265_10bit" })).toEqual({ video_url: "v.mp4", output_format: "mp4" });
    expect(buildPayload(map("topaz-sdr-to-hdr"), { video: "v.mp4", format: "prores_422_hq" })).toEqual({ video_url: "v.mp4", output_format: "prores" });
    expect(buildPayload(map("topaz-sdr-to-hdr"), { video: "v.mp4", format: "ffv1" })).toEqual({ video_url: "v.mp4" });
  });

  it("sends crossfades in seconds and loops a clip by repeating it", () => {
    expect(buildPayload({ prompt: false, audios: "audio_urls", crossfade: "crossfade" }, { audios: ["a.wav", "b.wav"], crossfade: 0.75 })).toEqual({ audio_urls: ["a.wav", "b.wav"], crossfade: 0.75 });
    // fal's merge-audios has no crossfade field: hard joins.
    expect(buildPayload(map("join-audio", "audio-join"), { audios: ["a.wav", "b.wav", "c.wav"], crossfade: 1 })).toEqual({ audio_urls: ["a.wav", "b.wav", "c.wav"] });
    const loop = map("join-audio", "audio-loop");
    expect(buildPayload(loop, { audio: "bed.mp3", duration: 30, sourceDuration: 8 }).audio_urls).toEqual(["bed.mp3", "bed.mp3", "bed.mp3", "bed.mp3"]);
    expect(buildPayload(loop, { audio: "bed.mp3", duration: 5, sourceDuration: 8 }).audio_urls).toHaveLength(2);
    expect(buildPayload(loop, { audio: "bed.mp3", duration: 600, sourceDuration: 8 }).audio_urls).toHaveLength(5);
    expect(buildPayload(loop, { audio: "bed.mp3" }).audio_urls).toHaveLength(5);
  });

  it("turns a Ken Burns move into one zoom toward a focal point", () => {
    const m = map("ken-burns");
    expect(buildPayload(m, { images: ["s.png"], duration: 6, fps: 30, zoomFrom: 1, zoomTo: 1.15, panTo: { x: 0.4, y: 0.45 }, easing: "ease-in-out" })).toEqual({
      image_url: "s.png",
      duration: 6,
      frames_per_second: 30,
      zoom_factor: 1.15,
      zoom_direction: "in",
      zoom_x: 40,
      zoom_y: 45,
      easing: "ease_in_out",
    });
    // Zooming out looks from the start point. fal's zoompan always starts or ends on the whole picture: the
    // zoomed-in end is exact (at most 2x) and the other end is the whole still.
    expect(buildPayload(m, { images: ["s.png"], zoomFrom: 1.5, zoomTo: 1.2, panFrom: { x: 0.1, y: 0.9 }, panTo: { x: 0.5, y: 0.5 }, easing: "linear" })).toEqual({
      image_url: "s.png",
      zoom_factor: 1.5,
      zoom_direction: "out",
      zoom_x: 10,
      zoom_y: 90,
      easing: "linear",
    });
    expect(buildPayload(m, { images: ["s.png"], zoomFrom: 1.2, zoomTo: 1.5 })).toMatchObject({ zoom_factor: 1.5, zoom_direction: "in" });
    // A hold tighter than the whole picture ends on that framing (the cloud move can't start there).
    expect(buildPayload(m, { images: ["s.png"], zoomFrom: 1.5, zoomTo: 1.5 })).toMatchObject({ zoom_factor: 1.5 });
    expect(buildPayload(m, { images: ["s.png"], zoomTo: 3 }).zoom_factor).toBe(2);
    // A static hold for an end card, and nothing said about the move: the API's own defaults.
    expect(buildPayload(m, { images: ["s.png"], zoomFrom: 1, zoomTo: 1 })).toMatchObject({ zoom_factor: 1, zoom_direction: "in" });
    expect(buildPayload(m, { images: ["s.png"], duration: 3 })).toEqual({ image_url: "s.png", duration: 3 });
  });

  it("places an overlay and retimes a clip", () => {
    expect(buildPayload(map("overlay-image"), { images: ["card.png", "logo.png"], position: { x: 0.5, y: 0.82 }, scale: 0.6 })).toEqual({
      background_image_url: "card.png",
      overlay_image_url: "logo.png",
      x_percent: 50,
      y_percent: 82,
      scale_percent: 60,
    });
    expect(buildPayload(map("topaz-fps-boost"), { video: "v.mp4", targetFps: 120, slowdown: 4 })).toEqual({ H264_output: true, video_url: "v.mp4", target_fps: 120, slowdown_factor: 4 });
    expect(buildPayload(map("rife-video-cloud"), { video: "v.mp4", targetFps: 60 })).toEqual({ video_url: "v.mp4" });
    expect(buildPayload(map("extract-frames"), { video: "v.mp4", frameInterval: 2 })).toEqual({ max_frames: 500, video_url: "v.mp4", frame_interval: 2 });
    expect(buildPayload(map("images-to-video"), { images: ["1.png", "2.png"], fps: 12 })).toEqual({
      fps: 12,
      images: [
        { url: "1.png", frames: 1 },
        { url: "2.png", frames: 1 },
      ],
    });
    expect(buildPayload(map("depth-anything-video-cloud"), { video: "v.mp4", colormap: "turbo" })).toMatchObject({ colormap: "turbo", model: "VDA-Base" });
    expect(buildPayload(map("depth-anything-video-cloud"), { video: "v.mp4" })).toMatchObject({ colormap: "grayscale" });
  });

  it("rigs a model with an animation preset, and builds 3D from words", () => {
    expect(buildPayload(map("meshy-rigging"), { model3d: "char.glb", animation: 12 })).toEqual({ model_url: "char.glb", animation_action_id: 12, enable_animation: true });
    expect(buildPayload(map("meshy-rigging"), { model3d: "char.glb", animation: "30" })).toMatchObject({ animation_action_id: 30 });
    expect(buildPayload(map("meshy-rigging"), { model3d: "char.glb" })).toEqual({ model_url: "char.glb" });
    expect(buildPayload(map("tripo-h3-1-text"), { prompt: "a brass lantern", seed: 7 })).toEqual({ prompt: "a brass lantern", model_seed: 7 });
  });

  it("erases with words, masks or a background description", () => {
    expect(buildPayload(map("bria-video-erase"), { prompt: "the man in the red jacket", video: "v.mp4" })).toEqual({ prompt: "the man in the red jacket", video_url: "v.mp4" });
    // VOID: Fuobe's words name what to remove (mask_prompt); its own prompt is the scene afterwards.
    const voidOut = buildPayload(map("void-video-inpainting"), { prompt: "the coffee cup", video: "v.mp4" });
    expect(voidOut).toMatchObject({ mask_prompt: "the coffee cup", video_url: "v.mp4" });
    expect(String(voidOut.prompt)).toMatch(/background continues/);
    expect(buildPayload(map("void-video-inpainting"), { prompt: "the cup", video: "v.mp4", extra: { prompt: "an empty table" } }).prompt).toBe("an empty table");
    // VACE: a painted first-frame mask is tracked through the clip; the erase route says what fills it.
    const erase = buildPayload(map("wan-22-vace-inpaint", "remove-object"), { prompt: "ignored", video: "v.mp4", mask: "m.png", images: ["x.png"] });
    expect(erase).toMatchObject({ video_url: "v.mp4", mask_image_url: "m.png", match_input_num_frames: true });
    expect(erase.ref_image_urls).toBeUndefined();
    expect(String(erase.prompt)).toMatch(/nothing there/);
    expect(buildPayload(map("wan-22-vace-inpaint", "video-swap"), { prompt: "a red vintage car", video: "v.mp4", mask: "m.png", images: ["car.png"] })).toEqual({
      match_input_num_frames: true,
      match_input_frames_per_second: true,
      prompt: "a red vintage car",
      video_url: "v.mp4",
      mask_image_url: "m.png",
      ref_image_urls: ["car.png"],
    });
    expect(buildPayload(map("bria-video-erase-mask", "remove-object", "replicate"), { video: "v.mp4", mask: "mask.mp4" })).toEqual({ video_url: "v.mp4", mask_url: "mask.mp4", auto_trim: true });
    // Its instruction is optional: an empty one is left out, not sent as "".
    expect(buildPayload(map("p-video-replace", "video-swap", "replicate"), { prompt: "", video: "v.mp4", images: ["me.png"] })).toEqual({ video: "v.mp4", images: ["me.png"] });
    expect(buildPayload(map("p-video-replace", "video-swap", "replicate"), { prompt: "Swap the man", video: "v.mp4", images: ["me.png"] })).toMatchObject({ instruction_prompt: "Swap the man" });
  });
});

describe("round-4 planning", () => {
  const video = "/v.mp4";
  it("infers each new operation from what is attached", () => {
    const op = (id: string, inputs: GenerationRequest["inputs"], params?: GenerationRequest["params"]) => inferOperation(getModel(id)!, { inputs, params });
    expect(op("wan-22-vace-inpaint", { video, images: ["/r.png"] })).toBe("video-swap");
    expect(op("wan-22-vace-inpaint", { video, mask: "/m.png" })).toBe("remove-object");
    expect(op("bria-video-erase", { video })).toBe("remove-object");
    expect(op("fuobe-genjutsu-swap-lite", { video, images: ["/r.png"] })).toBe("video-swap");
    expect(op("fuobe-genjutsu-motion-lite", { video, images: ["/r.png"] })).toBe("motion-transfer");
    // A general video editor keeps plain edits unless the studio asks for the tool.
    expect(op("kling-o3", { video })).toBe("v2v");
    expect(op("flux-3-max", { images: ["/a.png", "/b.png", "/c.png"] })).toBe("keyframes");
    expect(op("flux-3-max", { images: ["/a.png"], endImage: "/z.png" })).toBe("flf2v");
    expect(op("flux-3-max", { images: ["/a.png"] })).toBe("i2v");
    expect(op("flux-3-max", {})).toBe("t2v");
    // A model with references takes several stills as references, unless they come with times.
    expect(op("heygen-video", { images: ["/a.png", "/b.png"] })).toBe("ref2v");
    expect(op("topaz-sdr-to-hdr", { video })).toBe("sdr-to-hdr");
    expect(op("topaz-fps-boost", { video })).toBe("interpolate");
    expect(op("ken-burns", { images: ["/s.png"] })).toBe("still-motion");
    expect(op("images-to-video", { images: ["/1.png", "/2.png"] })).toBe("images-to-video");
    expect(op("overlay-image", { images: ["/1.png", "/2.png"] })).toBe("overlay");
    expect(op("extract-frames", { video })).toBe("extract-frames");
    expect(op("florence-2-ocr", { images: ["/a.png"] })).toBe("ocr");
    expect(op("join-audio", { audios: ["/a.wav", "/b.wav"] })).toBe("audio-join");
    expect(op("join-audio", { audio: "/a.wav" })).toBe("audio-loop");
    expect(op("triposplat", { images: ["/a.png"] })).toBe("splat");
    expect(op("tripo-h3-1-text", {})).toBe("text-to-3d");
    expect(op("meshy-7-1-multi", { images: ["/a.png", "/b.png"] })).toBe("image-to-3d");
    expect(op("meshy-rigging", { model3d: "/m.glb" })).toBe("rig-3d");
  });

  it("asks for each operation's inputs", () => {
    expect(fails({ modelId: "bria-video-erase", prompt: "the cup" })).toBe("Add the video to remove something from");
    expect(fails({ modelId: "p-video-replace", op: "video-swap", inputs: { video } })).toBe("Add the video and a picture of what goes in");
    expect(fails({ modelId: "wan-22-vace-inpaint", op: "video-insert", prompt: "a lamp", inputs: { video, mask: "/m.png" } })).toBe("Add the video and a picture of what to add");
    expect(fails({ modelId: "topaz-sdr-to-hdr" })).toBe("Add the video to convert");
    expect(fails({ modelId: "florence-2-ocr" })).toBe("Add the image to read");
    expect(fails({ modelId: "ken-burns" })).toBe("Add the still to move over");
    expect(fails({ modelId: "join-audio", op: "audio-join", inputs: { audios: ["/a.wav"] } })).toBe("Add at least two audio clips to join");
    expect(fails({ modelId: "join-audio", op: "audio-loop" })).toBe("Add the audio to loop");
    expect(fails({ modelId: "triposplat" })).toBe("Add a photo of the subject");
    expect(fails({ modelId: "meshy-rigging" })).toBe("Add the 3D model to rig");
    expect(fails({ modelId: "extract-frames" })).toBe("Add the video to take frames from");
    expect(fails({ modelId: "images-to-video" })).toBe("Add the images, in order");
    expect(fails({ modelId: "overlay-image", inputs: { images: ["/card.png"] } })).toBe("Add the picture and the overlay to put on it");
    expect(fails({ modelId: "flux-3-max", op: "keyframes", prompt: "p" })).toBe("Add the keyframes, in order");
    // Promptless tools run on their inputs alone.
    const runs: [string, GenerationRequest["inputs"]][] = [
      ["topaz-sdr-to-hdr", { video }],
      ["topaz-fps-boost", { video }],
      ["florence-2-ocr", { images: ["/a.png"] }],
      ["ken-burns", { images: ["/a.png"] }],
      ["overlay-image", { images: ["/a.png", "/b.png"] }],
      ["extract-frames", { video }],
      ["join-audio", { audios: ["/a.wav", "/b.wav"] }],
      ["triposplat", { images: ["/a.png"] }],
      ["meshy-rigging", { model3d: "/m.glb" }],
    ];
    for (const [modelId, inputs] of runs) expect(fails({ modelId, inputs }), modelId).toBeNull();
  });

  it("removes what is named, painted or clicked", () => {
    expect(fails({ modelId: "bria-video-erase", inputs: { video } })).toBe("Say what to remove, e.g. “the coffee cup in her hand”");
    expect(plan({ modelId: "bria-video-erase", prompt: "the cup", inputs: { video } }).op).toBe("remove-object");
    expect(fails({ modelId: "bria-video-erase-points", inputs: { video } })).toBe("Click what to remove on the first frame");
    expect(plan({ modelId: "bria-video-erase-points", inputs: { video }, params: { points: [{ x: 1, y: 2 }] } }).op).toBe("remove-object");
    expect(fails({ modelId: "wan-22-vace-inpaint", op: "remove-object", inputs: { video } })).toBe("Paint the area to change on the first frame");
    expect(plan({ modelId: "wan-22-vace-inpaint", op: "remove-object", inputs: { video, mask: "/m.png" } }).op).toBe("remove-object");
    // Kling O3 erases from words only: a mask can't stand in for them.
    expect(fails({ modelId: "kling-o3", op: "remove-object", inputs: { video, mask: "/m.png" } })).toBe("Say what to remove, e.g. “the coffee cup in her hand”");
    expect(plan({ modelId: "kling-o3", op: "remove-object", prompt: "Remove the coffee cup, keep everything else the same", inputs: { video } }).op).toBe("remove-object");
    // On the client (no field maps) a mask or points are enough to try.
    const full = getModel("bria-video-erase")!;
    const slim = { ...full, routes: full.routes.map((r) => ({ op: r.op, provider: r.provider, endpoint: r.endpoint })) };
    expect(planGeneration({ feature: "x", modelId: slim.id, inputs: { video, mask: "/m.png" } }, () => slim, getPreset).op).toBe("remove-object");
  });

  it("lets a swap run without words where the API does, and asks for words where it doesn't", () => {
    expect(promptOptional(getModel("p-video-replace")!, "video-swap")).toBe(true);
    expect(getModel("p-video-replace")!.options.promptless).toBeFalsy();
    expect(fails({ modelId: "kling-o3", op: "video-swap", inputs: { video, images: ["/r.png"] } })).toBe("Write a prompt first");
    expect(fails({ modelId: "sam-3d-objects", inputs: { images: ["/room.png"] } })).toBe("Name the objects to rebuild, e.g. “chair, lamp”");
    expect(plan({ modelId: "pixelcut-looping-video", inputs: { images: ["/bottle.png"] } }).op).toBe("i2v");
    expect(plan({ modelId: "bria-expand", inputs: { images: ["/a.png"] }, params: { aspectRatio: "16:9" } }).op).toBe("outpaint");
  });

  it("checks keyframe times", () => {
    const imgs = ["/a.png", "/b.png", "/c.png"];
    expect(plan({ modelId: "flux-3-max", prompt: "p", inputs: { images: imgs }, params: { keyframeTimes: [0, 2, 5] } }).op).toBe("keyframes");
    expect(fails({ modelId: "flux-3-max", prompt: "p", inputs: { images: imgs }, params: { keyframeTimes: [0, 2] } })).toBe("Give each of the 3 keyframes a time");
    expect(fails({ modelId: "flux-3-max", prompt: "p", inputs: { images: imgs }, params: { keyframeTimes: [0, 3, 2] } })).toBe("Keyframe times start at 0 or later and go up");
    expect(fails({ modelId: "flux-3-max", prompt: "p", inputs: { images: imgs }, params: { keyframeTimes: [0, 2, 8] } })).toBe("The last keyframe is at 8s — make the clip at least that long");
    expect(plan({ modelId: "flux-3-max", prompt: "p", inputs: { images: imgs }, params: { keyframeTimes: [0, 2, 8], duration: 8 } }).params.duration).toBe(8);
    const eleven = Array.from({ length: 11 }, (_, i) => `/${i}.png`);
    expect(fails({ modelId: "flux-3-max", op: "keyframes", prompt: "p", inputs: { images: eleven } })).toBe("FLUX 3 Max takes up to 10 keyframes");
  });
});

describe("round-4 review fixes", () => {
  it("fits aspect ratios and resolutions to what each route takes", () => {
    expect(fitValue(["480p", "720p"], "1080p", "tier")).toBe("720p");
    expect(fitValue(["720p", "1080p"], "480p", "tier")).toBe("720p");
    expect(fitValue(["1k", "2k"], "2K", "tier")).toBe("2k");
    expect(fitValue(["1:1", "2:1", "16:9"], "20:9", "ratio")).toBe("2:1");
    expect(fitValue(["1:1", "16:9"], "auto", "ratio")).toBeUndefined();
    expect(fitValue(["auto", "16:9"], "auto", "ratio")).toBe("auto");
    expect(fitValue(["480p"], "very_low", "tier")).toBeUndefined();
  });

  it("sends Grok Imagine on fal only values each route's API lists", () => {
    const bad: string[] = [];
    for (const id of ["grok-imagine-video-1-5", "grok-imagine-image-2"]) {
      const m = getModel(id)!;
      for (const r of m.routes) {
        const enumOf = (field: string): unknown[] | undefined => byId.get(`${r.provider}:${r.endpoint}`)?.inputs?.[field]?.values;
        const images = r.op === "ref2v" || r.op === "edit" ? ["a.png", "b.png"] : r.op === "i2v" ? ["a.png"] : [];
        for (const aspectRatio of m.options.aspectRatios ?? []) {
          const sent = buildPayload(r.map!, { prompt: "p", images, aspectRatio }).aspect_ratio;
          if (sent !== undefined && !enumOf("aspect_ratio")?.includes(sent)) bad.push(`${id} ${r.provider} ${r.op} aspect ${aspectRatio} → ${String(sent)}`);
        }
        for (const resolution of m.options.resolutions ?? []) {
          const sent = buildPayload(r.map!, { prompt: "p", images, resolution }).resolution;
          if (sent !== undefined && !enumOf("resolution")?.includes(sent)) bad.push(`${id} ${r.provider} ${r.op} resolution ${resolution} → ${String(sent)}`);
        }
      }
    }
    expect(bad).toEqual([]);
    // fal's reference-to-video stops at 720p; text-to-video makes 1080p.
    expect(buildPayload(map("grok-imagine-video-1-5", "ref2v"), { prompt: "p", images: ["a.png", "b.png"], resolution: "1080p" })).toMatchObject({ reference_image_urls: ["a.png", "b.png"], resolution: "720p" });
    expect(buildPayload(map("grok-imagine-video-1-5", "t2v"), { prompt: "p", resolution: "1080p" }).resolution).toBe("1080p");
    // fal's text-to-image has no "auto" (its edit does).
    expect(buildPayload(map("grok-imagine-image-2", "t2i"), { prompt: "p", aspectRatio: "auto" })).toEqual({ prompt: "p" });
    expect(buildPayload(map("grok-imagine-image-2", "edit"), { prompt: "p", images: ["a.png"], aspectRatio: "auto" }).aspect_ratio).toBe("auto");
    // fal's edit route takes 5 references, and the model offers no more.
    expect(getModel("grok-imagine-image-2")!.options.maxImages).toBe(5);
    expect(map("grok-imagine-image-2", "edit").maxImages).toBe(5);
  });

  it("asks frame-count routes for as many frames as the clip has", () => {
    expect(buildPayload(map("ltx-2-3-clean-plate"), { video: "v.mp4", sourceDuration: 10, resolution: "480p" })).toMatchObject({ num_frames: 240, resolution: "480p" });
    expect(buildPayload(map("ltx-2-3-hdr"), { video: "v.mp4", duration: 4, fps: 30 })).toMatchObject({ num_frames: 120, frames_per_second: 30 });
    // VOID's window tops out at 197 frames (about 8 s): longer clips are split by the caller.
    expect(buildPayload(map("void-video-inpainting"), { prompt: "the cup", video: "v.mp4", sourceDuration: 12 }).num_frames).toBe(197);
    expect(buildPayload(map("void-video-inpainting"), { prompt: "the cup", video: "v.mp4", sourceDuration: 5 }).num_frames).toBe(120);
    // Unknown length: the API's own default.
    expect(buildPayload(map("ltx-2-3-clean-plate"), { video: "v.mp4" }).num_frames).toBeUndefined();
    // VACE matches the input's frame count itself.
    expect(map("wan-22-vace-inpaint", "remove-object").numFrames).toBeUndefined();
    expect(route("ltx-2-3-clean-plate").note).toMatch(/480p up to about 15 s/);
  });

  it("keeps the numbers it fills inside each API's limits", () => {
    expect(buildPayload(map("topaz-fps-boost"), { video: "v.mp4", targetFps: 200, slowdown: 2.5 })).toMatchObject({ target_fps: 120, slowdown_factor: 3 });
    expect(buildPayload(map("topaz-fps-boost"), { video: "v.mp4", targetFps: 8 }).target_fps).toBe(16);
    expect(buildPayload(map("overlay-image"), { images: ["card.png", "logo.png"], scale: 0.1, position: { x: 1.2, y: -0.1 } })).toMatchObject({ scale_percent: 25, x_percent: 100, y_percent: 0 });
    expect(buildPayload(map("extract-frames"), { video: "v.mp4", frameInterval: 10_000 }).frame_interval).toBe(300);
    expect(buildPayload(map("ken-burns"), { images: ["s.png"], duration: 45, fps: 12 })).toMatchObject({ duration: 30, frames_per_second: 24 });
    expect(buildPayload(map("meshy-rigging"), { model3d: "char.glb", animation: 900 }).animation_action_id).toBe(696);
    expect(() => buildPayload(map("meshy-rigging"), { model3d: "char.glb", animation: "walk" })).toThrow("Pick the animation by its preset number (0–696)");
    // params.extra is sent as given.
    expect(buildPayload(map("topaz-fps-boost"), { video: "v.mp4", extra: { target_fps: 200 } }).target_fps).toBe(200);
  });

  it("joins at most as many audio clips as the API takes", () => {
    const six = Array.from({ length: 6 }, (_, i) => `/${i}.wav`);
    expect(fails({ modelId: "join-audio", op: "audio-join", inputs: { audios: six } })).toBe("Join audio joins up to 5 clips at a time — join the rest in a second step");
    expect(fails({ modelId: "join-audio", op: "audio-join", inputs: { audios: six.slice(0, 5) } })).toBeNull();
  });

  it("gives Bria Expand a target shape and leaves an empty prompt out", () => {
    const p = plan({ modelId: "bria-expand", inputs: { images: ["/a.png"] } });
    expect(p).toMatchObject({ op: "outpaint", params: { aspectRatio: "16:9" } });
    expect(buildPayload(map("bria-expand"), { prompt: "", images: ["a.png"], aspectRatio: p.params.aspectRatio })).toEqual({ image_url: "a.png", aspect_ratio: "16:9" });
    expect(buildPayload(map("bria-expand"), { prompt: "more beach", images: ["a.png"], aspectRatio: "9:16" })).toEqual({ prompt: "more beach", image_url: "a.png", aspect_ratio: "9:16" });
  });

  it("sends a model-wide control only to the routes that have its field", () => {
    expect(buildPayload(map("ideogram-vector", "vectorize"), { images: ["a.png"], extra: { quality: "high", mode: "simple" } })).toEqual({ image_url: "a.png", mode: "simple" });
    expect(buildPayload(map("ideogram-vector", "t2i"), { prompt: "a fox", extra: { quality: "high" } })).toMatchObject({ quality: "high" });
  });

  it("credits the makers, not the host", () => {
    expect(getModel("void-video-inpainting")!.vendor).toBe("Netflix");
    expect(getModel("rife-video-cloud")!.vendor).toBe("Open source");
    expect(getModel("bria-fibo-2")!.tagline).toMatch(/^Structured prompts; Bria says/);
    expect(getModel("wan-22-vace-inpaint")!.pricing!.note).toMatch(/frames ÷ 16/);
  });
});
