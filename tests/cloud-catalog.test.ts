import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { getModel, getPreset, MODELS, modelsFor } from "@/lib/catalog";
import { buildPayload } from "@/lib/catalog/payload";
import { planGeneration } from "@/lib/catalog/plan";
import { OPERATION_OUTPUT, type FieldMap, type ModelRoute, type Operation } from "@/lib/catalog/types";

type Endpoint = { provider: string; endpoint: string; inputs?: Record<string, unknown>; verified?: boolean };
const research = ["paid-model-apis.json", "paid-model-apis-2.json", "paid-model-apis-3.json", "paid-model-apis-4.json"].flatMap(
  (f) => (JSON.parse(fs.readFileSync(`docs/research/${f}`, "utf8")) as { endpoints: Endpoint[] }).endpoints,
);
const byId = new Map<string, Endpoint>();
for (const e of research) byId.set(`${e.provider}:${e.endpoint}`, { ...byId.get(`${e.provider}:${e.endpoint}`), ...e });
// Research #7 (MOSS-Image on fal and its /lora twin): endpointRecords in the shape of part 4's endpoints.
// Research #10 (FLUX 3 Image Klein on fal, its /lora twins and Klein Base's LoRA routes): the same shape.
for (const f of ["new-models-7.json", "new-models-10.json"]) {
  for (const e of (JSON.parse(fs.readFileSync(`docs/research/${f}`, "utf8")) as { endpointRecords: Endpoint[] }).endpointRecords) {
    byId.set(`${e.provider}:${e.endpoint}`, { ...byId.get(`${e.provider}:${e.endpoint}`), ...e });
  }
}
// Originals (O1): the hosted open-weight endpoints that take LoRAs, and the plain endpoints of the same models.
const originals = JSON.parse(fs.readFileSync("docs/research/fuobe-originals-recipes-5.json", "utf8")) as {
  hostedLoraEndpoints: (Endpoint & { id: string })[];
  hostedBaseEndpoints: Endpoint[];
  /** Partner routes read for build plan O7 (Happy Horse 1.1 on fal). */
  partnerEndpoints?: Endpoint[];
};
for (const e of originals.hostedLoraEndpoints) if (e.inputs) byId.set(`${e.provider}:${e.id}`, { ...e, endpoint: e.id, verified: true });
for (const e of [...originals.hostedBaseEndpoints, ...(originals.partnerEndpoints ?? [])]) byId.set(`${e.provider}:${e.endpoint}`, e);
/** A Replicate model run by version ("owner/name:<version>") is researched under its name. */
const researched = (r: ModelRoute, endpoint = r.endpoint) => byId.get(`${r.provider}:${endpoint}`) ?? byId.get(`${r.provider}:${endpoint.split(":")[0]}`);

/** Every provider field a FieldMap names (top-level part of dotted paths). */
function fieldsOf(map: FieldMap): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(map)) {
    if (k === "fixed" || k === "defaults" || k === "seedRange" || k === "maskFormat" || k === "loras") continue;
    if (k === "size") {
      const z = map.size!;
      out.push(...[z.key, z.width, z.height].filter((f): f is string => !!f));
      continue;
    }
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      // Round 4: a Ken Burns zoom's factor and focal point, an overlay's position, and their nested enum keys.
      for (const f of ["key", "background", "shotType", "flag", "factor", "x", "y"]) if (typeof o[f] === "string") out.push(o[f] as string);
      for (const f of ["direction", "easing"]) if (o[f] && typeof (o[f] as { key?: unknown }).key === "string") out.push((o[f] as { key: string }).key);
    }
  }
  return [...out, ...Object.keys(map.fixed ?? {}), ...Object.keys(map.defaults ?? {})].map((f) => f.split(".")[0].replace("[]", ""));
}

/** The models this round added (research part 3), with the operation each is for. */
const ROUND3: Record<string, Operation> = {
  "seedream-5-layers": "layers",
  "seedream-5-flash-layers": "layers",
  "qwen-image-layered-cloud": "layers",
  "ideogram-3-text-layers": "text-layers",
  "ideogram-remove-bg": "bg-remove",
  "bria-extract-object": "edit",
  "recraft-vectorize": "vectorize",
  image2svg: "vectorize",
  "recraft-4-1-pro": "t2i",
  "recraft-4-style": "edit",
  "recraft-4-style-pro": "edit",
  "ideogram-3": "t2i",
  "krea-2-style": "edit",
  "flux-redux-ultra": "edit",
  "flux-redux-pro": "edit",
  "instant-character": "edit",
  "qwen-multiple-angles": "edit",
  "fashn-tryon": "edit",
  "google-try-on": "edit",
  "leffa-tryon": "edit",
  "bria-product-shot": "edit",
  "product-photography": "edit",
  "bria-background-replace": "edit",
  "happy-horse-video-edit": "v2v",
  "lucy-edit-pro": "v2v",
  "runway-aleph-2": "v2v",
  "kling-o3-4k-edit": "v2v",
  "grok-imagine-video-edit": "v2v",
  "ltx-2-3-restyle": "v2v",
  "trim-video": "trim",
  "merge-audio-video": "mux",
  "auto-subtitle": "captions",
  "veed-subtitles": "captions",
  "scribe-v2": "transcribe",
  wizper: "transcribe",
  whisper: "transcribe",
  demucs: "separate-audio",
  "mirelo-sfx-2": "sfx",
  "sonilo-sfx": "sfx",
  "stable-audio-3-sfx": "sfx",
  "stable-audio-2-5": "sfx",
  "cassette-sfx": "sfx",
  "seed-audio": "sfx",
  "mirelo-sfx-2-video": "v2a",
  "sonilo-music": "music",
  "lyria-3": "music",
  "lyria-3-pro": "music",
  "minimax-music-2-5": "music",
  "stable-audio-3-music": "music",
  "mureka-song": "music",
  "hunyuan-3d-3-1-pro": "image-to-3d",
  "hunyuan-3d-3-1-rapid": "image-to-3d",
  "trellis-2": "image-to-3d",
  "tripo-h3-1": "image-to-3d",
  "meshy-7-1": "image-to-3d",
  "inworld-tts": "tts",
  "minimax-speech-2-8": "tts",
};

const route = (id: string, op?: Operation, provider = "fal"): ModelRoute => {
  const m = getModel(id);
  if (!m) throw new Error(`no model ${id}`);
  const r = m.routes.find((x) => (!op || x.op === op) && x.provider === provider);
  if (!r) throw new Error(`${id} has no ${provider} ${op} route`);
  return r;
};

describe("round-3 cloud models", () => {
  it("every new model resolves, is cloud, and runs its operation", () => {
    for (const [id, op] of Object.entries(ROUND3)) {
      const m = getModel(id);
      expect(m, id).toBeDefined();
      expect(m!.engine, id).toBe("cloud");
      expect(m!.routes.some((r) => r.op === op), `${id} ${op}`).toBe(true);
      // The model's kind is what its main operation outputs (pickers filter on it).
      expect(m!.kind, id).toBe(OPERATION_OUTPUT[op] === "text" ? "text" : op === "v2a" ? "video" : OPERATION_OUTPUT[op]);
    }
  });

  it("routes every fal / Replicate model only to researched, verified endpoints with fields the schema has", () => {
    const routes = MODELS.flatMap((m) => m.routes.filter((r) => r.provider === "fal" || r.provider === "replicate").map((r) => ({ m, r })));
    const bad: string[] = [];
    for (const { m, r } of routes) {
      if (r.endpoint.startsWith("chain:")) continue;
      const e = researched(r);
      if (!e) {
        bad.push(`${m.id}: ${r.provider}:${r.endpoint} not in research`);
        continue;
      }
      if (ROUND3[m.id] && !e.verified) bad.push(`${m.id}: ${r.endpoint} unverified`);
      const inputs = Object.keys(e.inputs ?? {});
      for (const f of fieldsOf(r.map ?? {})) if (!inputs.includes(f)) bad.push(`${m.id}: ${r.endpoint} has no field ${f}`);
      // A run with LoRAs sends the same payload to the LoRA endpoint, plus its LoRA fields.
      if (r.loraEndpoint || r.map?.loras) {
        const le = researched(r, r.loraEndpoint ?? r.endpoint);
        if (!le) {
          bad.push(`${m.id}: LoRA endpoint ${r.loraEndpoint} not in research`);
          continue;
        }
        const loraInputs = Object.keys(le.inputs ?? {});
        const l = r.map?.loras;
        const loraFields = !l ? [] : l.shape === "items" ? [l.key] : l.shape === "arrays" ? [l.weights, l.scales] : l.shape === "single" ? [l.weights, l.scale] : [l.high.weights, l.high.scale, l.low.weights, l.low.scale];
        if (!l) bad.push(`${m.id}: ${r.endpoint} has a LoRA endpoint but no LoRA field`);
        for (const f of [...fieldsOf(r.map ?? {}), ...loraFields]) if (!loraInputs.includes(f)) bad.push(`${m.id}: ${r.loraEndpoint ?? r.endpoint} has no field ${f}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("hides utility-only steps and keeps sliders and controls inside the API's limits", () => {
    expect(getModel("trim-video")!.hidden).toBe(true);
    expect(getModel("merge-audio-video")!.hidden).toBe(true);
    for (const id of Object.keys(ROUND3).filter((x) => !["trim-video", "merge-audio-video"].includes(x))) expect(getModel(id)!.hidden, id).toBeFalsy();
    for (const m of MODELS) {
      for (const s of m.options.sliders ?? []) {
        expect(s.min, `${m.id} ${s.param}`).toBeLessThan(s.max);
        expect(s.default >= s.min && s.default <= s.max, `${m.id} ${s.param} default`).toBe(true);
      }
      for (const c of m.options.controls ?? []) expect(c.values.length, `${m.id} ${c.param}`).toBeGreaterThan(0);
    }
  });

  it("puts the new models in the right pickers, defaults first", () => {
    const ids = (kind: Parameters<typeof modelsFor>[0]["kind"], ops: Operation[]) => modelsFor({ kind, ops, engine: "cloud" }).map((m) => m.id);
    expect(ids("audio", ["sfx"]).slice(0, 2)).toEqual(["mirelo-sfx-2", "sonilo-sfx"]);
    expect(ids("audio", ["sfx"])).toContain("elevenlabs-sfx");
    expect(ids("audio", ["music"])[0]).toBe("sonilo-music");
    expect(ids("audio", ["music"])).toEqual(expect.arrayContaining(["elevenlabs-music", "lyria-3", "lyria-3-pro", "minimax-music-2-5", "stable-audio-3-music", "mureka-song", "stable-audio-2-5"]));
    expect(ids("audio", ["tts"])).toEqual(expect.arrayContaining(["inworld-tts", "minimax-speech-2-8", "seed-audio"]));
    expect(ids("video", ["v2a"])).toContain("mirelo-sfx-2-video");
    expect(ids("video", ["v2v"])).toEqual(expect.arrayContaining(["happy-horse-video-edit", "lucy-edit-pro", "runway-aleph-2", "kling-o3-4k-edit", "grok-imagine-video-edit", "ltx-2-3-restyle", "kling-o3", "wan-2-7"]));
    expect(ids("image", ["t2i", "edit"])).toEqual(expect.arrayContaining(["recraft-4-1-pro", "ideogram-3", "krea-2-style", "fashn-tryon", "qwen-multiple-angles"]));
    expect(ids("image", ["layers"])[0]).toBe("seedream-5-layers");
    expect(ids("image", ["vectorize"])[0]).toBe("recraft-vectorize");
    expect(ids("model3d", ["image-to-3d"])[0]).toBe("hunyuan-3d-3-1-pro");
    expect(ids("text", ["transcribe"])[0]).toBe("scribe-v2");
    expect(ids("video", ["captions"])[0]).toBe("auto-subtitle");
    expect(ids("audio", ["separate-audio"])).toEqual(["demucs", "elevenlabs-voice-isolation"]);
    // Utility steps never show up in a picker.
    expect(modelsFor({ ops: ["trim", "mux"] }).filter((m) => m.engine === "cloud")).toEqual([]);
  });

  it("chips: defaults are marked top, Pro/4K/fast where the research says so", () => {
    for (const id of ["seedream-5-layers", "mirelo-sfx-2", "sonilo-music", "hunyuan-3d-3-1-pro", "fashn-tryon", "scribe-v2", "auto-subtitle", "recraft-vectorize"]) {
      expect(getModel(id)!.badges, id).toContain("top");
    }
    expect(getModel("kling-o3-4k-edit")!.badges).toContain("4k");
    expect(getModel("recraft-4-1-pro")!.badges).toContain("pro");
    expect(getModel("hunyuan-3d-3-1-rapid")!.badges).toContain("fast");
  });

  it("plans requests for the new operations", () => {
    const plan = (req: Parameters<typeof planGeneration>[0]) => planGeneration(req, getModel, getPreset);
    expect(plan({ feature: "x", modelId: "fashn-tryon", prompt: "try it on", inputs: { images: ["/p.png", "/g.png"] } }).op).toBe("edit");
    expect(plan({ feature: "x", modelId: "seedream-5-layers", op: "layers", prompt: "split", inputs: { images: ["/a.png"] } }).op).toBe("layers");
    expect(plan({ feature: "x", modelId: "ideogram-3", prompt: "poster", params: { palette: ["#ff0000"] } }).params.palette).toEqual(["#ff0000"]);
    expect(plan({ feature: "x", modelId: "trellis-2", op: "image-to-3d", prompt: "x", inputs: { images: ["/a.png"] } }).params.resolution).toBe("1024");
  });
});

describe("round-3 payloads", () => {
  it("sends a palette in each API's own shape", () => {
    const palette = ["#FF0000", "00ff80", "#123456"];
    expect(buildPayload(route("recraft-4-1").map!, { prompt: "p", palette, extra: { background_color: "#ffffff" } })).toMatchObject({
      colors: [{ r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 128 }, { r: 18, g: 52, b: 86 }],
      background_color: { r: 255, g: 255, b: 255 },
    });
    // The [{rgb: [r, g, b]}] shape some APIs take.
    expect(buildPayload({ palette: { key: "colors", format: "rgb-array", background: "background_color" } }, { prompt: "p", palette, extra: { background_color: "#000000" } })).toMatchObject({
      colors: [{ rgb: [255, 0, 0] }, { rgb: [0, 255, 128] }, { rgb: [18, 52, 86] }],
      background_color: { rgb: [0, 0, 0] },
    });
    expect(buildPayload(route("ideogram-3", "t2i").map!, { prompt: "p", palette }).color_palette).toEqual({
      members: [
        { rgb: { r: 255, g: 0, b: 0 }, color_weight: 1 },
        { rgb: { r: 0, g: 255, b: 128 }, color_weight: 0.65 },
        { rgb: { r: 18, g: 52, b: 86 }, color_weight: 0.3 },
      ],
    });
    expect(buildPayload({ palette: { key: "colors", format: "hex" } }, { palette: ["ff0000", "#00FF80", "nope"] }).colors).toEqual(["#FF0000", "#00FF80"]);
    // No palette, no field; an object background the caller already shaped is left alone.
    expect(buildPayload(route("recraft-4-1").map!, { prompt: "p", extra: { background_color: { r: 1, g: 2, b: 3 } } })).toEqual({
      prompt: "p",
      background_color: { r: 1, g: 2, b: 3 },
    });
  });

  it("maps trims, offsets and frame rates in seconds or milliseconds", () => {
    expect(buildPayload(route("trim-video").map!, { video: "v.mp4", startTime: 2.5, endTime: 9, duration: 5 })).toEqual({ video_url: "v.mp4", start_time: 2.5, end_time: 9 });
    expect(buildPayload(route("merge-audio-video").map!, { video: "v.mp4", audio: "a.mp3", startTime: 1 })).toEqual({ video_url: "v.mp4", audio_url: "a.mp3", start_offset: 1 });
    expect(buildPayload({ startTime: { key: "start_ms", type: "number", multiplier: 1000 }, endTime: { key: "end", type: "string", suffix: "s" }, fps: "fps" }, { startTime: 1.5, endTime: 4, fps: 24 })).toEqual({
      start_ms: 1500,
      end: "4s",
      fps: 24,
    });
  });

  it("sends the second image, style ids, layer counts and source languages", () => {
    expect(buildPayload(route("fashn-tryon").map!, { prompt: "ignored", images: ["person.png", "shirt.png"], extra: { category: "tops" } })).toEqual({
      model_image: "person.png",
      garment_image: "shirt.png",
      category: "tops",
    });
    expect(buildPayload(route("leffa-tryon").map!, { images: ["p.png"] })).toEqual({ human_image_url: "p.png", garment_type: "upper_body" });
    expect(buildPayload(route("bria-product-shot").map!, { prompt: "on a marble counter", images: ["bottle.png", "scene.png"] })).toEqual({
      scene_description: "on a marble counter",
      image_url: "bottle.png",
      ref_image_url: "scene.png",
    });
    expect(buildPayload(route("recraft-4-style", "edit").map!, { prompt: "a fox", images: ["a.png", "b.png"], aspectRatio: "16:9" })).toEqual({
      prompt: "a fox",
      image_urls: ["a.png", "b.png"],
      image_size: "landscape_16_9",
    });
    expect(buildPayload(route("recraft-4-style", "edit").map!, { prompt: "a fox", images: ["a.png"], styleId: "st-123" })).toMatchObject({ style_id: "st-123" });
    expect(buildPayload(route("qwen-image-layered-cloud").map!, { prompt: "a poster", images: ["a.png"], numLayers: 6 })).toEqual({ prompt: "a poster", image_url: "a.png", num_layers: 6 });
    expect(buildPayload(route("qwen-image-layered-cloud", "layers", "replicate").map!, { prompt: "a poster", images: ["a.png"], numLayers: 6 })).toEqual({
      description: "a poster",
      image: "a.png",
      num_layers: 6,
    });
    expect(buildPayload(route("scribe-v2").map!, { prompt: "x", video: "clip.mp4", sourceLanguage: "fr" })).toEqual({ audio_url: "clip.mp4", language_code: "fr" });
    expect(buildPayload(route("auto-subtitle").map!, { video: "v.mp4", sourceLanguage: "es", extra: { words_per_subtitle: 2 } })).toEqual({ video_url: "v.mp4", language: "es", words_per_subtitle: 2 });
  });

  it("uses each model's own field names for voices, angles, resolutions and fixed switches", () => {
    expect(buildPayload(route("minimax-speech-2-8").map!, { prompt: "Hi", voice: "Calm_Woman", extra: { "voice_setting.speed": 1.2 } })).toEqual({
      prompt: "Hi",
      voice_setting: { voice_id: "Calm_Woman", speed: 1.2 },
      output_format: "url",
    });
    expect(buildPayload(route("inworld-tts").map!, { prompt: "Hi", voice: "Loretta (en)" })).toEqual({ text: "Hi", voice: "Loretta (en)" });
    expect(buildPayload(route("qwen-multiple-angles").map!, { prompt: "", images: ["a.png"], extra: { horizontal_angle: 90, zoom: 2 } })).toEqual({
      additional_prompt: "",
      image_urls: ["a.png"],
      horizontal_angle: 90,
      zoom: 2,
    });
    expect(buildPayload(route("trellis-2").map!, { images: ["a.png"], resolution: "1536" })).toEqual({ image_url: "a.png", resolution: 1536 });
    expect(buildPayload(route("lucy-edit-pro").map!, { prompt: "make it snow", video: "v.mp4" })).toEqual({ prompt: "make it snow", video_url: "v.mp4", sync_mode: false });
    expect(buildPayload(route("demucs").map!, { audio: "song.mp3" })).toEqual({ audio_url: "song.mp3", model: "htdemucs" });
    // Ideogram's remix doesn't send the picture being remixed as its own style reference.
    expect(buildPayload(route("ideogram-3", "edit").map!, { prompt: "p", images: ["a.png"] })).toEqual({ prompt: "p", image_url: "a.png" });
    expect(route("ideogram-3", "inpaint").map).toMatchObject({ mask: "mask_url", maskFormat: "black" });
  });
});
