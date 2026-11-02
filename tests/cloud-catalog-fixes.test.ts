/**
 * Round-3 review fixes for the cloud catalog: planning the new operations (prompts, inputs, try-on),
 * reference clips for reference-to-video (Cinema Studio, Seedance), API defaults, spoken languages,
 * control lists, and a research-driven check that every input an API requires can be filled.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { getModel, getPreset, MODELS } from "@/lib/catalog";
import { buildPayload, languageValue } from "@/lib/catalog/payload";
import { planGeneration } from "@/lib/catalog/plan";
import type { FieldMap, GenerationRequest, ModelRoute, Operation } from "@/lib/catalog/types";

type Spec = { required?: boolean };
type Endpoint = { provider: string; endpoint: string; inputs?: Record<string, Spec> };
const research = ["paid-model-apis.json", "paid-model-apis-2.json", "paid-model-apis-3.json"].flatMap(
  (f) => (JSON.parse(fs.readFileSync(`docs/research/${f}`, "utf8")) as { endpoints: Endpoint[] }).endpoints,
);
const byId = new Map<string, Endpoint>();
for (const e of research) byId.set(`${e.provider}:${e.endpoint}`, { ...byId.get(`${e.provider}:${e.endpoint}`), ...e });

/** Every top-level provider field a FieldMap can write: canonical keys, fixed fields and defaults. */
function sentFields(map: FieldMap): Set<string> {
  const out: string[] = [];
  for (const [k, v] of Object.entries(map)) {
    if (k === "fixed" || k === "defaults") out.push(...Object.keys(v as object));
    else if (k === "seedRange" || k === "maskFormat") continue;
    else if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") for (const f of ["key", "background", "shotType", "flag"]) if (typeof (v as Record<string, unknown>)[f] === "string") out.push((v as Record<string, string>)[f]);
  }
  // A map without a prompt key sends the prompt as "prompt".
  if (map.prompt === undefined) out.push("prompt");
  return new Set(out.map((f) => f.split(".")[0]));
}

const route = (id: string, op?: Operation, provider = "fal"): ModelRoute => {
  const r = getModel(id)?.routes.find((x) => (!op || x.op === op) && x.provider === provider);
  if (!r) throw new Error(`${id} has no ${provider} ${op} route`);
  return r;
};

type Req = Omit<GenerationRequest, "feature">;
const plan = (req: Req) => planGeneration({ feature: "x", ...req }, getModel, getPreset);
const planError = (req: Req) => {
  try {
    plan(req);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

describe("research-driven route checks", () => {
  it("every input an API requires can be filled: by a canonical field, a fixed value or a default", () => {
    const bad: string[] = [];
    for (const m of MODELS) {
      for (const r of m.routes) {
        if (r.provider !== "fal" && r.provider !== "replicate") continue;
        // A chained route sends nothing itself: its steps run on the model's own routes (Fuobe Animation's clip per gap).
        if (r.chained) continue;
        const e = byId.get(`${r.provider}:${r.endpoint}`);
        if (!e) continue;
        const map = r.map ?? {};
        const inputs = e.inputs ?? {};
        const sent = sentFields(map);
        if (map.prompt === undefined && !("prompt" in inputs)) bad.push(`${m.id} ${r.op}: sends "prompt", which ${r.endpoint} doesn't take`);
        for (const [k, spec] of Object.entries(inputs)) if (spec?.required && !sent.has(k)) bad.push(`${m.id} ${r.op}: ${r.endpoint} requires ${k}`);
        // A required second image (a try-on garment) is only sent when two images are attached: planning must ask for both.
        if (map.image2 && inputs[map.image2]?.required && (m.options.minImages ?? 0) < 2) bad.push(`${m.id}: needs minImages 2 for ${map.image2}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("planning the new operations", () => {
  it("never asks for a prompt a model throws away", () => {
    expect(plan({ modelId: "scribe-v2", op: "transcribe", inputs: { audio: "/a.mp3" } }).op).toBe("transcribe");
    expect(plan({ modelId: "hunyuan-3d-3-1-pro", inputs: { images: ["/a.png"] } }).op).toBe("image-to-3d");
    expect(plan({ modelId: "fashn-tryon", inputs: { images: ["/p.png", "/g.png"] } }).op).toBe("edit");
    expect(plan({ modelId: "product-photography", inputs: { images: ["/p.png"] } }).op).toBe("edit");
    expect(plan({ modelId: "ideogram-3-text-layers", inputs: { images: ["/a.png"] } }).op).toBe("text-layers");
    expect(plan({ modelId: "recraft-vectorize", inputs: { images: ["/a.png"] } }).op).toBe("vectorize");
    for (const id of ["fashn-tryon", "scribe-v2", "hunyuan-3d-3-1-pro", "demucs", "auto-subtitle", "trim-video"]) expect(getModel(id)!.options.promptless, id).toBe(true);
    // Models that read a prompt still ask for one.
    expect(planError({ modelId: "bria-extract-object", inputs: { images: ["/a.png"] } })).toBe("Write a prompt first");
    expect(getModel("nano-banana-pro")!.options.promptless).toBeUndefined();
  });

  it("asks for the input each new operation works from before anything reaches the provider", () => {
    expect(planError({ modelId: "scribe-v2", op: "transcribe" })).toBe("Add the audio or video to transcribe");
    expect(plan({ modelId: "scribe-v2", op: "transcribe", inputs: { video: "/v.mp4" } }).op).toBe("transcribe");
    expect(planError({ modelId: "hunyuan-3d-3-1-pro", op: "image-to-3d", prompt: "x" })).toBe("Add a product or object photo");
    expect(planError({ modelId: "ideogram-3-text-layers", op: "text-layers" })).toBe("Add the image to lift the text from");
    expect(planError({ modelId: "recraft-vectorize", op: "vectorize" })).toBe("Add the image to turn into an SVG");
    expect(planError({ modelId: "trim-video", op: "trim", params: { startTime: 1, endTime: 2 } })).toBe("Add the video to trim");
    expect(planError({ modelId: "merge-audio-video", op: "mux", inputs: { video: "/v.mp4" } })).toBe("Add a video and the soundtrack to put on it");
    expect(planError({ modelId: "demucs", op: "separate-audio" })).toBe("Add the audio or video to split");
    // Demucs reads audio only: a video alone is turned away, saying what it needs.
    expect(planError({ modelId: "demucs", op: "separate-audio", inputs: { video: "/v.mp4" } })).toBe("Demucs stem split works from audio — add one");
    expect(plan({ modelId: "demucs", op: "separate-audio", inputs: { audio: "/a.mp3" } }).op).toBe("separate-audio");
  });

  it("try-on needs the person and the garment", () => {
    for (const id of ["fashn-tryon", "google-try-on", "leffa-tryon"]) {
      expect(getModel(id)!.options).toMatchObject({ minImages: 2, imageLabels: ["person photo", "garment"] });
      expect(planError({ modelId: id, inputs: { images: ["/p.png"] } }), id).toBe("Add the person photo and the garment");
    }
    // The product shot's scene image is optional.
    expect(getModel("bria-product-shot")!.options.minImages).toBeUndefined();
    expect(plan({ modelId: "bria-product-shot", prompt: "on marble", inputs: { images: ["/p.png"] } }).op).toBe("edit");
  });

  it("Recraft Styles run only with references (no text-to-image route that can't work)", () => {
    for (const id of ["recraft-4-style", "recraft-4-style-pro"]) {
      expect(getModel(id)!.routes.map((r) => r.op), id).toEqual(["edit"]);
      expect(planError({ modelId: id, prompt: "a fox" }), id).toBe("Add an image to edit");
    }
  });
});

describe("reference clips (Seedance 2.5, Wan 3.0)", () => {
  it("sends reference videos and audio as the API's clip lists", () => {
    const refs = { prompt: "@Video1 dances to @Audio1", images: ["face.png"], videos: ["moves.mp4", "cam.mp4"], audios: ["song.mp3"] };
    const clips = { video_urls: ["moves.mp4", "cam.mp4"], audio_urls: ["song.mp3"] };
    expect(buildPayload(route("seedance-2-5", "ref2v").map!, refs)).toMatchObject({ image_urls: ["face.png"], ...clips });
    expect(buildPayload(route("wan-3", "ref2v").map!, refs)).toMatchObject({ reference_video_urls: ["moves.mp4", "cam.mp4"], reference_audio_urls: ["song.mp3"] });
    // The fal extend route sends the clip it continues as its one-item list.
    expect(buildPayload(route("seedance-2-5", "extend").map!, { prompt: "p", video: "take.mp4", audios: ["a.mp3"] })).toMatchObject({ video_urls: ["take.mp4"], audio_urls: ["a.mp3"], task: "extension" });
    // Text-to-video routes never carry clips.
    expect(buildPayload(route("seedance-2-5", "t2v").map!, refs)).not.toHaveProperty("video_urls");
  });

  it("says how many clips each model takes", () => {
    expect(getModel("seedance-2-5")!.options).toMatchObject({ maxVideos: 10, maxAudios: 10 });
    expect(getModel("wan-3")!.options).toMatchObject({ maxVideos: 5, maxAudios: 5 });
    expect(getModel("seedance-2-0")!.options).toMatchObject({ maxVideos: 3, maxAudios: 3 });
    expect(getModel("kling-3")!.options.maxVideos).toBeUndefined();
  });

  it("plans clips as reference-to-video, and turns them away where they can't go", () => {
    expect(plan({ modelId: "seedance-2-5", prompt: "x", inputs: { videos: ["/v.mp4"] } }).op).toBe("ref2v");
    expect(plan({ modelId: "seedance-2-5", prompt: "x", inputs: { audios: ["/a.mp3"] } }).op).toBe("ref2v");
    expect(plan({ modelId: "seedance-2-5", prompt: "x", inputs: { images: ["/a.png"], videos: ["/v.mp4"] } }).op).toBe("ref2v");
    // One image and no clips is still a start frame.
    expect(plan({ modelId: "seedance-2-5", prompt: "x", inputs: { images: ["/a.png"] } }).op).toBe("i2v");
    expect(planError({ modelId: "kling-o3", op: "ref2v", prompt: "x", inputs: { videos: ["/v.mp4"] } })).toBe("Kling O3 Omni works from reference images — add one");
    expect(planError({ modelId: "seedance-2-5", op: "ref2v", prompt: "x" })).toBe("Add reference images");
  });
});

describe("defaults the APIs would get wrong", () => {
  it("sends API defaults unless the request says otherwise", () => {
    // Wizper detects the language instead of assuming English; a picked language wins.
    expect(buildPayload(route("wizper").map!, { audio: "a.mp3" })).toEqual({ audio_url: "a.mp3", language: null });
    expect(buildPayload(route("wizper").map!, { audio: "a.mp3", sourceLanguage: "es" })).toEqual({ audio_url: "a.mp3", language: "es" });
    expect(buildPayload(route("wizper").map!, { audio: "a.mp3", sourceLanguage: "Klingon" })).toEqual({ audio_url: "a.mp3", language: null });
    // Mirelo for video covers the whole clip (the API clamps to its length), unless a duration is asked for.
    expect(buildPayload(route("mirelo-sfx-2-video").map!, { video: "v.mp4" })).toMatchObject({ duration: 600 });
    expect(buildPayload(route("mirelo-sfx-2-video").map!, { video: "v.mp4", duration: 8 })).toMatchObject({ duration: 8 });
    // Leffa: tops unless the Garment control says otherwise, and the control shows it.
    expect(buildPayload(route("leffa-tryon").map!, { images: ["p.png", "d.png"] })).toMatchObject({ garment_type: "upper_body" });
    expect(buildPayload(route("leffa-tryon").map!, { images: ["p.png", "d.png"], extra: { garment_type: "dresses" } })).toMatchObject({ garment_type: "dresses" });
    expect(getModel("leffa-tryon")!.options.controls).toEqual([{ param: "garment_type", label: "Garment", values: ["upper_body", "lower_body", "dresses"], default: "upper_body" }]);
    // Required fields with a documented default, and one with none (Kling follows the driving video).
    expect(buildPayload(route("minimax-h3-max", "t2v").map!, { prompt: "p" })).toMatchObject({ prompt_expansion_mode: "balanced" });
    expect(buildPayload(route("kling-motion-control").map!, { images: ["c.png"], video: "d.mp4" })).toMatchObject({ character_orientation: "video" });
  });

  it("matches the spoken language to each API's own list", () => {
    const veed = route("veed-subtitles").map!;
    expect(buildPayload(veed, { video: "v.mp4", sourceLanguage: "es" })).toMatchObject({ language: "es-ES" });
    expect(buildPayload(veed, { video: "v.mp4", sourceLanguage: "en" })).toMatchObject({ language: "en-US" });
    expect(buildPayload(veed, { video: "v.mp4", sourceLanguage: "es-MX" })).toMatchObject({ language: "es-MX" });
    expect(buildPayload(veed, { video: "v.mp4", sourceLanguage: "ko" })).toMatchObject({ language: "ko-KR" });
    expect(buildPayload(veed, { video: "v.mp4", sourceLanguage: "German (de)" })).toMatchObject({ language: "de-DE" });
    expect(buildPayload(veed, { video: "v.mp4" })).not.toHaveProperty("language");
    expect(languageValue(["en", "es"], "auto")).toBeUndefined();
    // Free-text language fields get ISO codes.
    expect(buildPayload(route("scribe-v2").map!, { audio: "a.mp3", sourceLanguage: "pt-BR" })).toMatchObject({ language_code: "pt" });
    expect(buildPayload(route("auto-subtitle").map!, { video: "v.mp4", sourceLanguage: "Spanish (es)" })).toMatchObject({ language: "es" });
    for (const id of ["auto-subtitle", "veed-subtitles", "scribe-v2", "wizper", "whisper"]) expect(getModel(id)!.options.sourceLanguages, id).toContain("es");
  });

  it("asks each API for what Fuobe can use", () => {
    expect(buildPayload(route("sonilo-sfx").map!, { prompt: "rain" })).toMatchObject({ audio_format: "mp3" });
    expect(buildPayload(route("minimax-music-2-5").map!, { prompt: "lofi" })).toEqual({ prompt: "lofi", lyrics_optimizer: true });
    expect(buildPayload(route("whisper").map!, { audio: "a.mp3" })).toMatchObject({ chunk_level: "word" });
    // Mureka 9.5 runs on its own route (nm10-music3): no Version, and a past run's Version isn't sent.
    expect(route("mureka-song").endpoint).toBe("mureka/v9.5/generate/song");
    expect(getModel("mureka-song")!.options.controls).toBeUndefined();
    expect(buildPayload(route("mureka-song").map!, { prompt: "pop", extra: { model: "mureka-8" } })).toEqual({ prompt: "pop" });
    expect(getModel("seedream-5-flash-layers")!.pricing).toMatchObject({ unit: "request", usd: 0.135 });
    expect(getModel("veed-subtitles")!.pricing?.note).toMatch(/dynamic styles .* 2x/);
  });

  it("controls don't repeat the composer's own Auto", () => {
    for (const m of MODELS) {
      for (const c of m.options.controls ?? []) {
        expect(c.values.some((v) => String(v).toLowerCase() === "auto"), `${m.id} ${c.param}`).toBe(false);
        if (String(c.default).toLowerCase() === "none") expect(c.values, `${m.id} ${c.param}`).not.toContain("none");
      }
    }
    expect(getModel("fashn-tryon")!.options.controls!.find((c) => c.param === "category")).toEqual({ param: "category", label: "Garment", values: ["tops", "bottoms", "one-pieces"] });
  });
});
