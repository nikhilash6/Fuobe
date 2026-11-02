import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Package nm10-hosted-catchup: fal's H3 Max lip sync, relight, insert and five looks, H3 Max Turbo, Vidu Q4, Meshy retexture and
 * Tripo P2, and Replicate's H3 Lite and HighSpeed. Payloads are checked against the stored schemas (docs/research/new-models-10.json
 * endpointRecords, read 2026-11-02 with scripts/fetch-hosted-schemas.py --catchup); prices against the price lines stored with
 * them. No paid call is made: pure functions and demo mode only.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-hosted-catchup-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const { getModel, getPreset, MODELS } = await import("@/lib/catalog");
const { buildPayload, extractOutputs } = await import("@/lib/catalog/payload");
const { estimateCost, hostedInputProblem, planGeneration, routesFor } = await import("@/lib/catalog/plan");
const { clipWindowProblem, insertHandles, insertRangeProblem, INSERT_RANGE, portraitShapeProblem, voiceWindowProblem } = await import("@/lib/catalog/clip-windows");
const { clipBlocker } = await import("@/lib/composer");
const { LIGHT_PRESETS, lightPreset, SPHERE_SIZE, spherePixels } = await import("@/lib/relight-sphere");
const { MODELS_3D, RETEXTURE_MODELS, retextureRequest } = await import("@/lib/av/model3d");
const { paidApiLicence } = await import("@/lib/licences");
const { mockProvider } = await import("@/server/providers/mock");
type Req = import("@/lib/catalog/types").GenerationRequest;
type Route = import("@/lib/catalog/types").ModelRoute;

type Spec = { type?: string; values?: unknown[]; maxItems?: number; minimum?: number; maximum?: number; maxLength?: number; required?: boolean; default?: unknown };
type Endpoint = { provider: string; endpoint: string; status: string; inputs: Record<string, Spec>; keyFields: Record<string, string>; price: string; licence: string };
const research = (JSON.parse(fs.readFileSync("docs/research/new-models-10.json", "utf8")) as { endpointRecords: Endpoint[] }).endpointRecords;
const schemaOf = (r: Route) => research.find((e) => e.provider === r.provider && e.endpoint === r.endpoint)!;

const IDS = [
  "minimax-h3-max-lipsync",
  "minimax-h3-max-relight",
  "minimax-h3-max-insert",
  "minimax-h3-max-look-pixel",
  "minimax-h3-max-look-hand-drawn",
  "minimax-h3-max-look-low-poly",
  "minimax-h3-max-look-retro-toon",
  "minimax-h3-max-look-vhs",
  "minimax-h3-max-turbo",
  "minimax-h3-max-turbo-refs",
  "minimax-h3-max-turbo-extend",
  "minimax-h3-lite",
  "minimax-h3-highspeed",
  "vidu-q4",
  "meshy-7-retexture",
  "meshy-6-retexture",
  "tripo-p2",
];

/** Every field the payload sends is one the stored schema has, with a value its enum and limits allow; every required one goes. */
function checkAgainstSchema(r: Route, payload: Record<string, unknown>) {
  const { inputs } = schemaOf(r);
  for (const [k, v] of Object.entries(payload)) {
    const spec = inputs[k];
    expect(spec, `${r.endpoint} has no ${k}`).toBeDefined();
    if (spec.values) expect(spec.values, `${r.endpoint} ${k}`).toContain(v);
    if (spec.type === "integer") expect(Number.isInteger(v), `${k} is whole`).toBe(true);
    if (typeof v === "number" && spec.minimum !== undefined) expect(v, `${r.endpoint} ${k}`).toBeGreaterThanOrEqual(spec.minimum);
    if (typeof v === "number" && spec.maximum !== undefined) expect(v, `${r.endpoint} ${k}`).toBeLessThanOrEqual(spec.maximum);
    if (typeof v === "string" && spec.maxLength !== undefined) expect(v.length).toBeLessThanOrEqual(spec.maxLength);
    if (Array.isArray(v) && spec.maxItems !== undefined) expect(v.length, `${k} items`).toBeLessThanOrEqual(spec.maxItems);
  }
  for (const [k, spec] of Object.entries(inputs)) if (spec.required) expect(payload[k], `${r.endpoint} requires ${k}`).toBeDefined();
}

const IMG = "https://example.com/a.png";
const CLIP = "https://example.com/a.mp4";
const VOICE = "https://example.com/a.mp3";
const GLB = "https://example.com/a.glb";

/** Plan a request as the server does and build the payload its route sends. */
function payloadFor(modelId: string, req: Partial<Req> = {}) {
  const plan = planGeneration({ feature: "video", modelId, prompt: "A lighthouse keeper climbs the stairs", ...req } as Req, getModel, getPreset);
  const r = routesFor(plan.model, plan.op)[0];
  const payload = buildPayload(r.map!, {
    ...plan.params,
    prompt: plan.prompt,
    images: req.inputs?.images,
    endImage: req.inputs?.endImage,
    video: req.inputs?.video,
    videos: req.inputs?.videos,
    audio: req.inputs?.audio,
    audios: req.inputs?.audios,
    model3d: req.inputs?.model3d,
  } as never);
  checkAgainstSchema(r, payload);
  return { plan, route: r, payload };
}

describe("research: every catch-up endpoint read at its source", () => {
  it("is stored with its schema, price and licence, and live", () => {
    for (const id of IDS) {
      const m = getModel(id)!;
      expect(m, id).toBeTruthy();
      expect(m.engine).toBe("cloud");
      for (const r of m.routes) {
        const e = schemaOf(r);
        expect(e, `${id} ${r.endpoint}`).toBeTruthy();
        expect(e.status).toBe("active");
        expect(e.price).toMatch(/\$/);
        expect(e.licence).toBe("proprietary paid API");
      }
    }
  });

  it("records Vidu Q4 as fal exposes it: no text-to-video route, 12 reference pictures and 3 voice clips", () => {
    const vidu = getModel("vidu-q4")!;
    expect(vidu.routes.map((r) => r.op)).toEqual(["i2v", "ref2v"]);
    expect(vidu.options.maxImages).toBe(12);
    expect(vidu.options.maxAudios).toBe(3);
    expect(research.some((e) => e.endpoint === "fal-ai/vidu/q4/text-to-video")).toBe(false);
  });

  it("shows each as a proprietary paid API in Settings → Models & licences, switched on", () => {
    for (const id of IDS) {
      const m = getModel(id)!;
      expect(paidApiLicence(m.vendor, m.routes).class, id).toBe("paid-api");
      expect(MODELS.some((x) => x.id === id && !x.hidden), id).toBe(true);
    }
  });
});

describe("payloads match the stored schemas", () => {
  it("H3 Max lip sync: a portrait and a voice, no words", () => {
    const { plan, payload } = payloadFor("minimax-h3-max-lipsync", { prompt: "", inputs: { images: [IMG], audio: VOICE } });
    expect(plan.op).toBe("avatar");
    expect(payload).toMatchObject({ image_url: IMG, audio_url: VOICE, resolution: "768P" });
    expect(payload.prompt).toBeUndefined();
  });

  it("H3 Max relight: the clip, the sphere as its reference, the clip's own shape", () => {
    const { plan, payload } = payloadFor("minimax-h3-max-relight", { prompt: "", inputs: { video: CLIP, images: [IMG] } });
    expect(plan.op).toBe("relight-video");
    expect(payload).toMatchObject({ video_url: CLIP, reference_image_url: IMG, aspect_ratio: "adaptive", resolution: "768P" });
  });

  it("H3 Max insert: the range goes as start_time and resume_time, the moment's length as duration", () => {
    const { plan, payload } = payloadFor("minimax-h3-max-insert", {
      prompt: "",
      inputs: { video: CLIP, images: [IMG] },
      params: { startTime: 3.5, endTime: 6, duration: 8, sourceDuration: 12 },
    });
    expect(plan.op).toBe("insert-moment");
    expect(payload).toMatchObject({ video_url: CLIP, start_time: 3.5, resume_time: 6, duration: 8, reference_image_urls: [IMG] });
    expect(payload.prompt).toBeUndefined();
  });

  it("H3 Max looks: words or a first frame; VHS takes its tape wear", () => {
    expect(payloadFor("minimax-h3-max-look-pixel").payload).toMatchObject({ aspect_ratio: "16:9", duration: 5 });
    const vhs = payloadFor("minimax-h3-max-look-vhs", { inputs: { images: [IMG] }, params: { extra: { damage_level: "heavy" } } });
    expect(vhs.plan.op).toBe("i2v");
    expect(vhs.payload).toMatchObject({ image_url: IMG, damage_level: "heavy" });
  });

  it("H3 Max Turbo: text, frames, references and extend each send their own fields, prompt expansion as fal's default", () => {
    expect(payloadFor("minimax-h3-max-turbo").payload).toMatchObject({ prompt_expansion_mode: "balanced", resolution: "768P", aspect_ratio: "16:9" });
    const flf = payloadFor("minimax-h3-max-turbo", { inputs: { images: [IMG], endImage: IMG } });
    expect(flf.plan.op).toBe("flf2v");
    expect(flf.payload).toMatchObject({ image_url: IMG, end_image_url: IMG });
    const refs = payloadFor("minimax-h3-max-turbo-refs", { inputs: { images: [IMG, IMG], videos: [CLIP], audios: [VOICE] } });
    expect(refs.payload).toMatchObject({ reference_image_urls: [IMG, IMG], reference_video_urls: [CLIP], reference_audio_urls: [VOICE] });
    // The extend keeps the clip's shape: no aspect ratio goes (fal's "auto").
    const ext = payloadFor("minimax-h3-max-turbo-extend", { inputs: { video: CLIP } });
    expect(ext.plan.op).toBe("extend");
    expect(ext.payload.aspect_ratio).toBeUndefined();
  });

  it("Replicate's H3 Lite and HighSpeed: a start frame is never also a reference picture", () => {
    const lite = payloadFor("minimax-h3-lite", { inputs: { images: [IMG] } });
    expect(lite.payload).toMatchObject({ first_frame_image: IMG, ratio: "16:9", resolution: "768P" });
    expect(lite.payload.reference_image_urls).toBeUndefined();
    const fast = payloadFor("minimax-h3-highspeed", { inputs: { images: [IMG] } });
    expect(fast.payload).toMatchObject({ first_frame_image: IMG, ratio: "adaptive" });
    const refs = payloadFor("minimax-h3-highspeed", { inputs: { images: [IMG, IMG] } });
    expect(refs.plan.op).toBe("ref2v");
    expect(refs.payload).toMatchObject({ reference_image_urls: [IMG, IMG] });
    expect(refs.payload.first_frame_image).toBeUndefined();
  });

  it("Vidu Q4: a start frame, or references with voices, at a resolution its routes take", () => {
    expect(payloadFor("vidu-q4", { inputs: { images: [IMG] }, params: { resolution: "4K" } }).payload).toMatchObject({ image_url: IMG, resolution: "4K" });
    const refs = payloadFor("vidu-q4", { inputs: { images: [IMG, IMG], audios: [VOICE] } });
    expect(refs.plan.op).toBe("ref2v");
    expect(refs.payload).toMatchObject({ reference_image_urls: [IMG, IMG], reference_audio_urls: [VOICE], aspect_ratio: "16:9" });
  });

  it("Meshy retexture: the model, the words or the style picture, PBR on", () => {
    const req = retextureRequest({ glb: GLB, prompt: "weathered bronze", style: IMG, size: "4k" });
    const { plan, payload } = payloadFor(req.modelId, req);
    expect(plan.op).toBe("retexture-3d");
    expect(payload).toMatchObject({ model_url: GLB, text_style_prompt: "weathered bronze", image_style_url: IMG, texture_resolution: "4k", enable_pbr: true });
    expect(retextureRequest({ glb: GLB, prompt: "x".repeat(900) }).prompt).toHaveLength(600);
    expect(RETEXTURE_MODELS.map((m) => m.id)).toEqual(["meshy-7-retexture", "meshy-6-retexture"]);
  });

  it("Tripo P2: one photo, offered in Image to 3D", () => {
    expect(payloadFor("tripo-p2", { prompt: "", inputs: { images: [IMG] }, params: { extra: { texture_quality: "detailed" } } }).payload).toMatchObject({
      image_url: IMG,
      texture_quality: "detailed",
      // fal: "The fast quality requires v3.5-20260815"; the newest version goes with every quality.
      texture_version: "v3.5-20260815",
    });
    expect(payloadFor("tripo-p2", { prompt: "", inputs: { images: [IMG] }, params: { extra: { texture_quality: "fast" } } }).payload).toMatchObject({ texture_quality: "fast", texture_version: "v3.5-20260815" });
    expect(MODELS_3D.image.cloud.some((m) => m.id === "tripo-p2")).toBe(true);
  });
});

describe("prices follow fal's and Replicate's pages", () => {
  const cost = (id: string, params: Record<string, unknown>, op?: string, now?: number) =>
    estimateCost(getModel(id)!, params as never, 1, op as never, false, now ?? Date.UTC(2026, 10, 20));

  it("H3 Max lip sync: per second of the voice, 1.2× over 15 s (fal: 30 s at 768P costs $2.88)", () => {
    expect(cost("minimax-h3-max-lipsync", { sourceDuration: 5 }, "avatar")).toBe(0.4);
    expect(cost("minimax-h3-max-lipsync", { sourceDuration: 15 }, "avatar")).toBe(1.2);
    expect(cost("minimax-h3-max-lipsync", { sourceDuration: 30 }, "avatar")).toBe(2.88);
    expect(cost("minimax-h3-max-lipsync", { sourceDuration: 60, resolution: "2K" }, "avatar")).toBe(23.04);
  });

  it("H3 Max relight: on the clip's length; insert: on the new moment alone", () => {
    expect(cost("minimax-h3-max-relight", { sourceDuration: 8 }, "relight-video")).toBe(0.64);
    expect(cost("minimax-h3-max-relight", { sourceDuration: 8, resolution: "480P" }, "relight-video")).toBe(0.4);
    expect(cost("minimax-h3-max-insert", { duration: 8, sourceDuration: 40 }, "insert-moment")).toBe(0.48);
    expect(cost("minimax-h3-max-insert", { duration: 5, resolution: "480p" }, "insert-moment")).toBe(0.25);
  });

  it("H3 Max Turbo: fal's November rate until 2026-11-15, then the list rate; references at H3 Max's rates", () => {
    expect(cost("minimax-h3-max-turbo", { duration: 5 }, "t2v", Date.UTC(2026, 10, 2))).toBe(0.14);
    expect(cost("minimax-h3-max-turbo", { duration: 5 }, "t2v", Date.UTC(2026, 10, 16))).toBe(0.2);
    expect(cost("minimax-h3-max-turbo", { duration: 10, resolution: "1080P" }, "i2v", Date.UTC(2026, 10, 16))).toBe(0.8);
    expect(cost("minimax-h3-max-turbo-refs", { duration: 5 }, "ref2v")).toBe(0.4);
    expect(cost("minimax-h3-max-turbo-extend", { duration: 5, resolution: "2K" }, "extend")).toBe(0.8);
  });

  it("H3 looks, Lite, HighSpeed and Vidu Q4 per second", () => {
    expect(cost("minimax-h3-max-look-vhs", { duration: 15 }, "t2v")).toBe(1.2);
    expect(cost("minimax-h3-lite", { duration: 5, resolution: "480P" }, "t2v")).toBe(0.125);
    expect(cost("minimax-h3-highspeed", { duration: 10 }, "t2v")).toBe(0.6);
    expect(cost("vidu-q4", { duration: 5 }, "i2v")).toBe(0.333);
    expect(cost("vidu-q4", { duration: 5, resolution: "540p" }, "i2v")).toBe(0.158);
  });

  it("3D: Meshy retexture $0.30 ($0.45 at 8K), Tripo P2 $1.10-1.30 by texture quality", () => {
    expect(cost("meshy-7-retexture", {})).toBe(0.3);
    expect(cost("meshy-6-retexture", { extra: { texture_resolution: "8k" } })).toBe(0.45);
    expect(cost("tripo-p2", {})).toBe(1.1);
    expect(cost("tripo-p2", { extra: { texture_quality: "detailed" } })).toBe(1.2);
    expect(cost("tripo-p2", { extra: { texture_quality: "extreme" } })).toBe(1.3);
  });
});

describe("hosted limits are checked before a paid call, in Fuobe's words", () => {
  it("a prompt over the API's limit", () => {
    const vidu = getModel("vidu-q4")!;
    expect(hostedInputProblem(vidu, "i2v", "x".repeat(5000), {}, {})).toBeNull();
    expect(hostedInputProblem(vidu, "i2v", "x".repeat(5001), {}, {})).toBe("Vidu Q4 takes up to 5,000 characters of prompt, and this one has 5,001: shorten it");
    expect(() => planGeneration({ feature: "video", modelId: "vidu-q4", prompt: "x".repeat(6000), inputs: { images: [IMG] } } as Req, getModel, getPreset)).toThrow(/5,000 characters/);
  });

  it("a relight with no light, a retexture with neither words nor a style picture", () => {
    expect(() => planGeneration({ feature: "video-tools", modelId: "minimax-h3-max-relight", prompt: "", inputs: { video: CLIP } } as Req, getModel, getPreset)).toThrow(
      "Pick a light: MiniMax H3 Max Relight matches the light on a sphere you choose",
    );
    expect(() => planGeneration(retextureRequest({ glb: GLB }), getModel, getPreset)).toThrow("Describe the new look, or add a style picture");
  });

  it("insert-video's range: start 1.625 s or later, the resume 2.625 s or later and after it, both within 60 s and the clip", () => {
    expect(insertRangeProblem(undefined, 5)).toMatch(/Mark where/);
    expect(insertRangeProblem(1.5, 5)).toMatch(/1.625 s into the clip/);
    expect(insertRangeProblem(4, 4)).toMatch(/after the new moment starts/);
    expect(insertRangeProblem(4, 61)).toMatch(/first 60 s/);
    expect(insertRangeProblem(4, 9, 8)).toMatch(/The clip is 8 s long/);
    expect(insertRangeProblem(INSERT_RANGE.minStart, 2, 8)).toBe("The clip can pick up again 2.625 s in at the earliest: move the second handle right");
    expect(insertRangeProblem(INSERT_RANGE.minStart, INSERT_RANGE.minResume, 8)).toBeNull();
    expect(() => planGeneration({ feature: "video-edit", modelId: "minimax-h3-max-insert", prompt: "", inputs: { video: CLIP } } as Req, getModel, getPreset)).toThrow(/Mark where/);
  });

  it("clip and voice windows: relight up to 15 s, lip sync 5 s to 15 min, a portrait 0.4-2.5 wide", () => {
    const relight = getModel("minimax-h3-max-relight")!;
    expect(clipWindowProblem(relight, 20)).toBe("MiniMax H3 Max Relight takes 2.4–15 s clips, and this one is 20 s: trim it first");
    expect(clipWindowProblem(relight, 10)).toBeNull();
    expect(clipBlocker("relight-video", { duration: 20 }, {}, relight, undefined)).toMatch(/2.4–15 s clips/);
    expect(clipWindowProblem(getModel("minimax-h3-max-turbo-extend")!, 61)).toMatch(/1.625–60 s clips/);
    const lip = getModel("minimax-h3-max-lipsync")!;
    expect(voiceWindowProblem(lip, 3)).toMatch(/at least 5 s of audio/);
    expect(voiceWindowProblem(lip, 16 * 60)).toBe("MiniMax H3 Max Lip Sync · up to 15 min takes up to 15 minutes of audio, and this is 16 min 0 s: trim it first");
    expect(voiceWindowProblem(lip, 600)).toBeNull();
    expect(portraitShapeProblem(lip, 1000, 3000)).toMatch(/0.4:1 \(tall\)/);
    expect(portraitShapeProblem(lip, 1080, 1920)).toBeNull();
  });

  it("an inserted moment takes a clip of any length past 2.625 s: only the two points keep to its first minute", () => {
    const insert = getModel("minimax-h3-max-insert")!;
    expect(clipWindowProblem(insert, 90)).toBeNull();
    expect(clipBlocker("insert-moment", { duration: 90 }, {}, insert, undefined)).toBeNull();
    expect(clipWindowProblem(insert, 2)).toMatch(/at least 2.625 s|2.625/);
    expect(insertRangeProblem(10, 12, 90)).toBeNull();
  });

  it("reference lists past what the endpoint takes, Turbo's 12 references in all, and Vidu Q4's mp3 voices", () => {
    const plan = (modelId: string, inputs: Req["inputs"]) => () => planGeneration({ feature: "video", modelId, prompt: "Image 1 walks", inputs } as Req, getModel, getPreset);
    const n = (k: number, u: string) => Array.from({ length: k }, () => u);
    expect(plan("minimax-h3-max-insert", { video: CLIP, images: n(10, IMG) })).toThrow("MiniMax H3 Max Insert a moment takes up to 9 pictures as references, and this run has 10: remove 1");
    expect(plan("minimax-h3-max-insert", { video: CLIP, videos: n(4, CLIP) })).toThrow(/up to 3 clips as references/);
    expect(plan("minimax-h3-max-turbo-refs", { videos: n(4, CLIP) })).toThrow(/up to 3 clips/);
    expect(plan("minimax-h3-lite", { images: [IMG, IMG], audios: n(4, VOICE) })).toThrow("MiniMax H3 Lite takes up to 3 sound clips as references, and this run has 4: remove 1");
    expect(plan("vidu-q4", { images: n(13, IMG) })).toThrow(/up to 12 pictures/);
    expect(plan("minimax-h3-max-turbo-refs", { images: n(9, IMG), videos: n(3, CLIP), audios: n(3, VOICE) })).toThrow(
      "MiniMax H3 Max Turbo · references takes up to 12 references in all — pictures, clips and sound together — and this run has 15: remove 3",
    );
    expect(plan("minimax-h3-max-turbo-refs", { images: n(6, IMG), videos: n(3, CLIP), audios: n(3, VOICE) })).not.toThrow();
    expect(plan("vidu-q4", { images: [IMG, IMG], audios: ["https://example.com/voice.wav"] })).toThrow("Vidu Q4 takes MP3 voice clips only: convert the others to MP3 first");
    expect(plan("vidu-q4", { images: [IMG, IMG], audios: [VOICE, "data:audio/mpeg;base64,AAAA"] })).not.toThrow();
    // A start frame is never counted as a reference.
    expect(plan("vidu-q4", { images: [IMG] })).not.toThrow();
  });

  it("the longest whole-second length each API takes is offered (Vidu Q4 16 s, H3 Max insert 13 s)", () => {
    expect(getModel("vidu-q4")!.options.durations?.at(-1)).toBe(16);
    expect(getModel("minimax-h3-max-insert")!.options.durations?.at(-1)).toBe(13);
  });
});

describe("a talking portrait's shape, read from the file before the run", () => {
  /** A PNG header of the given size (enough for imageSize). */
  const png = (w: number, h: number) => {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8);
    b.write("IHDR", 12, "ascii");
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    b[24] = 8;
    b[25] = 6;
    return b;
  };
  it("H3 Max lip sync refuses a picture too tall or too wide, and takes a phone portrait", async () => {
    const { saveFile } = await import("@/server/storage");
    const { previewGeneration } = await import("@/server/generations");
    const run = (w: number, h: number) => () =>
      previewGeneration({ feature: "lipsync", modelId: "minimax-h3-max-lipsync", engine: "cloud", prompt: "", inputs: { images: [saveFile({ data: png(w, h), contentType: "image/png", source: "upload" }).id], audio: VOICE } } as Req);
    expect(run(400, 1200)).toThrow("MiniMax H3 Max Lip Sync · up to 15 min takes pictures from 0.4:1 (tall) to 2.5:1 (wide), and this one is 400×1200: crop it first");
    expect(run(3000, 1000)).toThrow(/2.5:1 \(wide\)/);
    // (Past the shape it goes on to need a fal key here: no shape refusal.)
    expect(run(1080, 1920)).not.toThrow(/crop it first/);
  });
});

describe("the canvas", () => {
  it("leaves out what it can't feed: a 3D model to retexture, the two points of an inserted moment, a light picked on a sphere", async () => {
    const { modelChoices, nodeOps } = await import("@/lib/catalog/canvas");
    const ids = (kind: string) => modelChoices({ type: "model", data: { mediaKind: kind } } as never).map((m) => m.id);
    expect(ids("model3d")).not.toContain("meshy-7-retexture");
    expect(ids("model3d")).not.toContain("meshy-6-retexture");
    expect(ids("model3d")).toContain("tripo-p2");
    expect(ids("video")).not.toContain("minimax-h3-max-insert");
    expect(ids("video")).not.toContain("minimax-h3-max-relight");
    expect(ids("video")).toContain("minimax-h3-max-turbo");
    expect(nodeOps({ type: "model", data: {} } as never, getModel("meshy-7-retexture")!)).toEqual([]);
  });
});

describe("the insert range control", () => {
  it("opens around the clip's middle on 1/8 s stops, within the clip and 60 s", () => {
    expect(insertHandles(12)).toEqual({ min: 1.625, max: 12, start: 5.5, resume: 6.5 });
    expect(insertHandles(90).max).toBe(60);
    expect(insertHandles(undefined).max).toBe(60);
  });

  it("keeps the handles in order and inside the track", () => {
    expect(insertHandles(10, [0.2, 0.3])).toMatchObject({ start: 1.625, resume: 2.625 });
    expect(insertHandles(10, [2.5, 2.75])).toMatchObject({ start: 2.5, resume: 2.75 });
    expect(insertHandles(10, [9.9, 12])).toMatchObject({ start: 9.875, resume: 10 });
    expect(insertHandles(10, [5, 4])).toMatchObject({ start: 5, resume: 5.125 });
    const h = insertHandles(7.3, [2.06, 6.94]);
    expect(h.start % 0.125).toBe(0);
    expect(insertRangeProblem(h.start, h.resume, 7.3)).toBeNull();
  });
});

describe("the relight sphere", () => {
  it("is a square picture of the size fal reads, for every preset", () => {
    expect(SPHERE_SIZE).toBe(512);
    for (const p of LIGHT_PRESETS) expect(spherePixels(p).length, p.id).toBe(512 * 512 * 4);
    expect(spherePixels(LIGHT_PRESETS[0], 64).length).toBe(64 * 64 * 4);
  });

  it("is lit from the preset's side over a dark ground, in the light's colour", () => {
    const size = 128;
    const px = spherePixels(lightPreset("golden-left")!, size);
    const at = (x: number, y: number) => Array.from(px.slice((y * size + x) * 4, (y * size + x) * 4 + 4));
    const left = at(Math.round(size * 0.22), size / 2);
    const right = at(Math.round(size * 0.78), size / 2);
    expect(left[0]).toBeGreaterThan(right[0] + 60);
    // Warm: more red than blue where it's lit.
    expect(left[0]).toBeGreaterThan(left[2] + 40);
    expect(at(0, 0)).toEqual([at(0, 0)[0], at(0, 0)[0], at(0, 0)[0], 255]);
    expect(at(0, 0)[0]).toBeLessThan(80);
    const fire = spherePixels(lightPreset("campfire")!, size);
    const lum = (b: Uint8ClampedArray, x: number, y: number) => b[(y * size + x) * 4];
    expect(lum(fire, size / 2, Math.round(size * 0.8))).toBeGreaterThan(lum(fire, size / 2, Math.round(size * 0.2)));
  });
});

describe("demo mode", () => {
  it("answers an inserted moment with a clip and a retexture with a model", async () => {
    const run = async (modelId: string, op: string) => {
      const m = getModel(modelId)!;
      const res = await mockProvider.submit({ generationId: `t-${op}`, model: m, route: routesFor(m, op as never)[0], input: { prompt: "x" } as never });
      return (await mockProvider.poll({ externalId: res.externalId, meta: { ...res.meta, startedAt: Date.now() - 600_000 }, route: routesFor(m, op as never)[0], model: m, createdAt: Date.now() - 60_000 })) as {
        outputs?: { kind: string }[];
      };
    };
    expect((await run("minimax-h3-max-insert", "insert-moment")).outputs?.[0].kind).toBe("video");
    expect((await run("meshy-7-retexture", "retexture-3d")).outputs?.[0].kind).toBe("model3d");
  });

  it("reads a retexture's GLB from fal's answer", () => {
    expect(extractOutputs({ model_glb: { url: "https://x/m.glb" }, thumbnail: { url: "https://x/t.png" } }, "retexture-3d")[0]).toMatchObject({ url: "https://x/m.glb", kind: "model3d" });
  });
});
