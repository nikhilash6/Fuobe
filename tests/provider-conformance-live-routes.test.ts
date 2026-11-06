import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getModel, getPreset, MODELS } from "@/lib/catalog";
import { clipFileProblem, clipFpsProblem, clipSizeProblem, clipWindowProblem, sourceSeconds, voiceWindowProblem } from "@/lib/catalog/clip-windows";
import { isHostedUntested } from "@/lib/catalog/hosted-untested";
import { buildPayload, extractOutputs, noOutputsError } from "@/lib/catalog/payload";
import { hostedInputProblem, imageLimit, planGeneration, sourceLengthProblem } from "@/lib/catalog/plan";
import { falTrainingInput } from "@/lib/catalog/training";
import type { GenerationRequest, GenInput, ModelDef, ModelRoute } from "@/lib/catalog/types";

/**
 * The hosted routes Fuobe runs on fal.ai and Replicate, checked against the input schemas the providers publish
 * (tests/fixtures/provider-schemas/{fal,replicate}/live-routes.json, read from fal's per-endpoint queue OpenAPI and each
 * Replicate model's API page by scripts/refresh-live-route-schemas.mjs; GET of public pages only, nothing is run or paid
 * for). Every value the composer offers for a route is built into the request the route sends (buildPayload, as
 * src/server/providers/{fal,replicate}.ts submit do) and checked against the endpoint's schema: an enum value, a number
 * outside its limits or a prompt over its maxLength is refused by the provider after the run is queued.
 *
 * Routes listed in src/lib/catalog/hosted-untested.ts are checked by their own suite. After a refresh shows a provider
 * changed a schema, run the generator (scripts/gen-cloud-models.py) and this suite.
 */
type Schema = {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  nullable?: boolean;
  anyOf?: Schema[];
  oneOf?: Schema[];
  allOf?: Schema[];
  additionalProperties?: boolean | Schema;
  description?: string;
};
type Saved = Record<string, { input: Schema; source: string; version?: string }>;
const DIR = path.join(__dirname, "fixtures/provider-schemas");
const load = (p: string): Saved => (JSON.parse(fs.readFileSync(path.join(DIR, p, "live-routes.json"), "utf8")) as { endpoints: Saved }).endpoints;
const SCHEMAS = { fal: load("fal"), replicate: load("replicate") };

/** The schema a route's request is checked against (a pinned Replicate version, else the model's latest). */
function schemaOf(r: ModelRoute): Schema | undefined {
  if (r.provider !== "fal" && r.provider !== "replicate") return undefined;
  const saved = SCHEMAS[r.provider];
  return (saved[r.endpoint] ?? saved[r.endpoint.split(":")[0]])?.input;
}

/** Why `value` breaks `s`: the JSON Schema keywords providers' validators read (pydantic on fal, Cog on Replicate). */
function problems(value: unknown, s: Schema, at: string, strict: boolean): string[] {
  if (value === null && s.nullable) return [];
  const alts = s.anyOf ?? s.oneOf;
  if (alts) {
    const each = alts.map((a) => problems(value, a, at, strict));
    if (each.some((p) => !p.length)) return [];
    return [`${at}: ${JSON.stringify(value).slice(0, 80)} fits none of its forms (${each.map((p) => p[0]).join(" / ")})`];
  }
  const out: string[] = [];
  for (const a of s.allOf ?? []) out.push(...problems(value, a, at, strict));
  const types = s.type === undefined ? [] : Array.isArray(s.type) ? s.type : [s.type];
  const typeOk = (t: string) =>
    t === "integer"
      ? Number.isInteger(value)
      : t === "number"
        ? typeof value === "number"
        : t === "array"
          ? Array.isArray(value)
          : t === "object"
            ? !!value && typeof value === "object" && !Array.isArray(value)
            : t === "null"
              ? value === null
              : typeof value === t;
  if (types.length && !types.some(typeOk)) return [`${at}: ${JSON.stringify(value).slice(0, 80)} is not ${types.join("|")}`];
  if (s.enum && !s.enum.some((e) => e === value)) out.push(`${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(s.enum)}`);
  if (s.const !== undefined && s.const !== value) out.push(`${at}: ${JSON.stringify(value)} is not ${JSON.stringify(s.const)}`);
  if (typeof value === "number") {
    if (s.minimum !== undefined && value < s.minimum) out.push(`${at}: ${value} < ${s.minimum}`);
    if (s.maximum !== undefined && value > s.maximum) out.push(`${at}: ${value} > ${s.maximum}`);
    if (s.exclusiveMinimum !== undefined && value <= s.exclusiveMinimum) out.push(`${at}: ${value} <= ${s.exclusiveMinimum}`);
    if (s.exclusiveMaximum !== undefined && value >= s.exclusiveMaximum) out.push(`${at}: ${value} >= ${s.exclusiveMaximum}`);
  }
  if (typeof value === "string") {
    if (s.minLength !== undefined && value.length < s.minLength) out.push(`${at}: ${value.length} characters < ${s.minLength}`);
    if (s.maxLength !== undefined && value.length > s.maxLength) out.push(`${at}: ${value.length} characters > ${s.maxLength}`);
  }
  if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems) out.push(`${at}: ${value.length} items < ${s.minItems}`);
    if (s.maxItems !== undefined && value.length > s.maxItems) out.push(`${at}: ${value.length} items > ${s.maxItems}`);
    if (s.items) value.forEach((v, i) => out.push(...problems(v, s.items!, `${at}[${i}]`, strict)));
  }
  if (s.properties && value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (s.properties[k]) out.push(...problems(v, s.properties[k], `${at}.${k}`, strict));
      // Cog refuses an input its schema doesn't list; fal's pydantic models ignore one unless they forbid extras.
      else if (strict || s.additionalProperties === false) out.push(`${at}.${k}: not in the schema`);
    }
  }
  return out;
}

const IMG = "https://example.com/in.png";
const CLIP = "https://example.com/in.mp4";
const SOUND = "https://example.com/in.mp3";

/** The live hosted routes this suite covers: fal.ai and Replicate, outside the untested list. */
const LIVE = MODELS.flatMap((m) =>
  m.routes.filter((r) => (r.provider === "fal" || r.provider === "replicate") && !r.endpoint.startsWith("chain:") && !isHostedUntested(m.id, r)).map((r) => ({ m, r })),
);

/** Every value the composer offers on a route, one setting at a time and each ratio with each size. */
function variants(m: ModelDef, r: ModelRoute): { label: string; input: GenInput }[] {
  const o = m.options;
  const map = r.map ?? {};
  const most = Math.max(1, Math.min(r.maxImages ?? map.maxImages ?? imageLimit(m, r.op) ?? 1, 16));
  const base: GenInput = {
    prompt: "a woman in a red coat on a city street",
    ...((map.images || map.image) && { images: Array.from({ length: map.image && !map.images ? 1 : 1 }, () => IMG) }),
    ...(map.endImage && r.op === "flf2v" && { endImage: `${IMG}?end` }),
    ...(map.video && { video: CLIP }),
    ...(map.audio && { audio: SOUND }),
    ...(map.mask && { mask: `${IMG}?mask` }),
  };
  const out: { label: string; input: GenInput }[] = [{ label: "defaults", input: { ...base, ...(m.defaults as GenInput) } }];
  const ratios = o.aspectRatios ?? [undefined];
  const tiers = o.resolutions ?? [undefined];
  for (const aspectRatio of ratios) for (const resolution of tiers) out.push({ label: `${aspectRatio ?? "-"} ${resolution ?? "-"}`, input: { ...base, aspectRatio, resolution } });
  for (const duration of o.durations ?? []) out.push({ label: `${duration}s`, input: { ...base, ...(m.defaults as GenInput), duration } });
  // The studio's own fixed seed (Math.random() * 1e9) and a batch's seed + index.
  if (o.seed) for (const seed of [0, 42, 999_999_999 + 3]) out.push({ label: `seed ${seed}`, input: { ...base, seed } });
  if (o.negativePrompt) out.push({ label: "negative", input: { ...base, negativePrompt: "blurry" } });
  if (map.images && most > 1) out.push({ label: `images=${most}`, input: { ...base, images: Array.from({ length: most }, (_, i) => `${IMG}?${i}`) } });
  if (map.promptMax) out.push({ label: `prompt of ${map.promptMax}`, input: { ...base, prompt: "a".repeat(map.promptMax) } });
  return out;
}

describe("live hosted routes match the providers' published input schemas", () => {
  it("has a saved schema for every live fal.ai and Replicate route", () => {
    expect(LIVE.filter(({ r }) => !schemaOf(r)).map(({ m, r }) => `${m.id} ${r.op} ${r.provider}:${r.endpoint}`)).toEqual([]);
  });

  it("builds requests the endpoints take, for every value the composer offers", () => {
    const bad: string[] = [];
    for (const { m, r } of LIVE) {
      const schema = schemaOf(r);
      // A timeline (compose) is built from the editor's tracks, not from the composer's settings.
      if (!schema || r.map?.timeline) continue;
      for (const { label, input } of variants(m, r)) {
        for (const p of problems(buildPayload(r.map ?? {}, input), schema, label, r.provider === "replicate")) bad.push(`${m.id} ${r.op} ${r.endpoint}: ${p}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("refuses a prompt over an endpoint's maxLength before the call (FieldMap.promptMax)", () => {
    const bad: string[] = [];
    for (const { m, r } of LIVE) {
      const key = typeof r.map?.prompt === "string" ? r.map.prompt.split(".")[0] : r.map?.prompt === false ? undefined : "prompt";
      const spec = key ? schemaOf(r)?.properties?.[key] : undefined;
      const most = spec?.maxLength ?? spec?.anyOf?.find((a) => a.maxLength)?.maxLength;
      if (most && !(r.map?.promptMax && r.map.promptMax <= most)) bad.push(`${m.id} ${r.op} ${r.endpoint}: maxLength ${most}, promptMax ${r.map?.promptMax}`);
    }
    expect(bad).toEqual([]);
  });

  it("folds a seed into an endpoint's limits (FieldMap.seedRange)", () => {
    const bad: string[] = [];
    for (const { m, r } of LIVE) {
      const key = typeof r.map?.seed === "string" ? r.map.seed : undefined;
      const spec = key ? schemaOf(r)?.properties?.[key] : undefined;
      const s = spec?.anyOf?.find((a) => a.maximum !== undefined) ?? spec;
      if (s?.maximum !== undefined && s.maximum < 2 ** 53 && !(r.map?.seedRange && r.map.seedRange[1] <= s.maximum)) bad.push(`${m.id} ${r.op} ${r.endpoint}: maximum ${s.maximum}`);
    }
    expect(bad).toEqual([]);
  });
});

const model = (id: string) => getModel(id)!;
const route = (id: string, op: string, provider?: string, endpoint?: string) =>
  model(id).routes.find((r) => r.op === op && (!provider || r.provider === provider) && (!endpoint || r.endpoint.startsWith(endpoint)))!;
const plan = (req: Partial<GenerationRequest> & { modelId: string }) => planGeneration({ feature: "generate", prompt: "a woman in a red coat", ...req } as GenerationRequest, getModel, getPreset);

describe("Replicate routes (spec audit 2026-11-06)", () => {
  it("Nano Banana Pro and Nano Banana leave \"auto\" out on Replicate (its default match_input_image follows the picture)", () => {
    for (const id of ["nano-banana-pro", "nano-banana"]) {
      const p = buildPayload(route(id, "edit", "replicate").map!, { prompt: "x", images: [IMG], aspectRatio: "auto", resolution: "1K" });
      expect(p).not.toHaveProperty("aspect_ratio");
    }
  });

  it("Qwen-Image Layered on Replicate keeps 2-8 layers and sends the seed", () => {
    const r = route("qwen-image-layered-cloud", "layers", "replicate");
    expect(buildPayload(r.map!, { prompt: "x", images: [IMG], numLayers: 10, seed: 42 })).toMatchObject({ num_layers: 8, seed: 42 });
    expect(buildPayload(r.map!, { prompt: "x", images: [IMG], numLayers: 1 })).toMatchObject({ num_layers: 2 });
  });

  it("Veo 3.1 on Replicate: a start frame goes in image only, 4K runs at 1080p and \"auto\" is left out", () => {
    const p = buildPayload(route("veo-3-1", "i2v", "replicate").map!, { prompt: "x", images: [IMG], aspectRatio: "auto", resolution: "4k", duration: 6 });
    expect(p).toMatchObject({ image: IMG, resolution: "1080p", duration: 6 });
    expect(p).not.toHaveProperty("reference_images");
    expect(p).not.toHaveProperty("aspect_ratio");
  });

  it("Wan 2.7 video edit reads one reference picture on both providers, and sends it and the seed", () => {
    for (const provider of ["fal", "replicate"]) {
      const r = route("wan-2-7", "v2v", provider);
      expect(r.maxImages, provider).toBe(1);
      expect(buildPayload(r.map!, { prompt: "x", video: CLIP, images: [IMG], seed: 7 })).toMatchObject({ seed: 7 });
    }
    expect(buildPayload(route("wan-2-7", "v2v", "fal").map!, { prompt: "x", video: CLIP, images: [IMG] })).toMatchObject({ reference_image_url: IMG });
  });

  it("Runway Aleph 2 takes a clip under 16 MB (Replicate's Files API would take the upload)", () => {
    expect(clipFileProblem(model("runway-aleph-2"), "v2v", "video", "video/mp4", 20 * 1024 * 1024)).toMatch(/under 16 MB/);
    expect(clipFileProblem(model("runway-aleph-2"), "v2v", "video", "video/mp4", 8 * 1024 * 1024)).toBeNull();
  });

  it("Stable Audio 2.5 on Replicate sends the seed and whole seconds from 1 to 190", () => {
    const r = route("stable-audio-2-5", "sfx", "replicate");
    expect(buildPayload(r.map!, { prompt: "rain", duration: 12.5, seed: 42 })).toMatchObject({ duration: 13, seed: 42 });
    expect(buildPayload(r.map!, { prompt: "rain", duration: 240 })).toMatchObject({ duration: 190 });
  });

  it("Scribe v2 on Replicate asks for speakers (diarize is false by default there)", () => {
    expect(buildPayload(route("scribe-v2", "transcribe", "replicate").map!, { audio: SOUND })).toMatchObject({ diarize: true });
  });

  it("Kling 2.5 Turbo Pro's start frame goes in start_image (image is deprecated)", () => {
    expect(buildPayload(route("kling-2-5-turbo", "i2v", "replicate").map!, { prompt: "x", images: [IMG] })).toMatchObject({ start_image: IMG });
  });

  it("PixVerse V6 Max refuses a prompt over 2,048 characters with a start image", () => {
    expect(hostedInputProblem(model("pixverse-v6-max"), "i2v", "a".repeat(3000), {}, { inputs: { images: [IMG] } })).toMatch(/2,048/);
  });

  it("P-Video 2 Pro Avatar leaves an empty prompt out, and takes up to 3 minutes of voice", () => {
    expect(buildPayload(route("p-video-2-pro-avatar", "avatar").map!, { prompt: "", images: [IMG], audio: SOUND })).not.toHaveProperty("prompt");
    expect(voiceWindowProblem(model("p-video-2-pro-avatar"), 200)).toMatch(/3 minutes/);
  });

  it("a LoRA trainer's step count goes in its own field (number_of_steps on the video trainers)", () => {
    const t = { id: "wan-22-i2v", trainer: "fal-ai/wan-22-trainer/i2v-a14b", steps: 1000 };
    const body = falTrainingInput(t as never, "https://example.com/data.zip", "a photo");
    expect(body).toMatchObject({ number_of_steps: 1000 });
    expect(body).not.toHaveProperty("steps");
  });

  it.todo("hosted: Replicate Files API uploads stop at 100 MB (replicate.ts prepareFile)");
  it.todo("hosted: owner Replicate runs copy their output again before replicate.delivery deletes it an hour later (generations.ts pollOne)");
  it.todo("hosted: predictions are created with a Cancel-After deadline (replicate.ts submit)");
  it.todo("hosted: a 429 waits the Retry-After Replicate gives (replicate.ts rFetch)");
  it.todo("hosted: data_removed predictions say the result expired (replicate.ts poll)");
  it.todo("hosted: at most 10 MB of data URIs inline per prediction (replicate.ts capInline)");
  it.todo("hosted: a Replicate LoRA copy is reused for 20 hours, not 24 (loras.ts MIRROR_TTL_MS)");
  it.todo("hosted: an own LoRA of 100 MB or more goes to Replicate by its fal.media URL (loras.ts sendOwnLora)");
});

describe("fal.ai routes (spec audit 2026-11-06)", () => {
  it("GPT Image 1.5 sends sizes in pixels, \"auto\" only on edit", () => {
    expect(buildPayload(route("gpt-image-1-5", "t2i").map!, { prompt: "x", aspectRatio: "3:4" })).toMatchObject({ image_size: "1024x1536" });
    expect(buildPayload(route("gpt-image-1-5", "t2i").map!, { prompt: "x", aspectRatio: "auto" })).not.toHaveProperty("image_size");
    expect(buildPayload(route("gpt-image-1-5", "edit").map!, { prompt: "x", images: [IMG], aspectRatio: "auto" })).toMatchObject({ image_size: "auto" });
  });

  it("FLUX.3 offers fal's tiers (no 512sq; 1.5k) and leaves a stored 512sq out", () => {
    expect(model("flux-3").options.resolutions).toEqual(expect.arrayContaining(["768sq", "1k", "1.5k", "2k", "4k"]));
    expect(model("flux-3").options.resolutions).not.toContain("512sq");
    expect(buildPayload(route("flux-3", "t2i").map!, { prompt: "x", resolution: "512sq" })).not.toHaveProperty("resolution");
  });

  it("Ideogram 4.5 text to image makes very_low as low (very_low is the edit's alone)", () => {
    expect(buildPayload(route("ideogram-4-5", "t2i").map!, { prompt: "x", resolution: "very_low" })).toMatchObject({ quality: "low" });
  });

  it("a model offers no more pictures than its edit endpoint documents", () => {
    for (const [id, most] of [["qwen-image-3", 3], ["wan-2-7-image", 4], ["flux-2-klein-4b-cloud", 4], ["qwen-multiple-angles", 1]] as const) {
      expect(imageLimit(model(id), "edit"), id).toBeLessThanOrEqual(most);
    }
  });

  it("GPT Image 2 and 2.5 inpaint masks are sent white-edits, black-keeps; GPT Image 1.5 keeps OpenAI's alpha", () => {
    for (const id of ["gpt-image-2", "gpt-image-2-5"]) if (getModel(id)) expect(route(id, "inpaint").map?.maskFormat, id).toBeUndefined();
    expect(route("gpt-image-1-5", "inpaint").map?.maskFormat).toBe("alpha");
  });

  it("a picture fal's safety check blanked is not a result", () => {
    const answer = { images: [{ url: "https://fal.media/a.png" }, { url: "https://fal.media/b.png" }], has_nsfw_concepts: [true, false] };
    expect(extractOutputs(answer, "t2i").map((o) => o.url)).toEqual(["https://fal.media/b.png"]);
    const blank = { images: [{ url: "https://fal.media/a.png" }], has_nsfw_concepts: [true] };
    expect(extractOutputs(blank, "t2i")).toEqual([]);
    expect(noOutputsError(blank)).toMatch(/safety check/);
  });

  it("Seedance 2.5 from a start frame sends no ratio (the endpoint takes \"auto\" only)", () => {
    for (const op of ["i2v", "flf2v"]) {
      const r = route("seedance-2-5", op);
      expect(buildPayload(r.map!, { prompt: "x", images: [IMG], endImage: `${IMG}?end`, aspectRatio: "16:9" }), op).not.toHaveProperty("aspect_ratio");
    }
  });

  it("Veo 3.1 extend sends 7s at 720p, and reference to video 8s", () => {
    for (const id of ["veo-3-1", "veo-3-1-fast"]) {
      expect(buildPayload(route(id, "extend").map!, { prompt: "x", video: CLIP, duration: 8, resolution: "1080p" }), id).toMatchObject({ duration: "7s", resolution: "720p" });
    }
    expect(buildPayload(route("veo-3-1", "ref2v").map!, { prompt: "x", images: [IMG, IMG], duration: 4 })).toMatchObject({ duration: "8s" });
  });

  it("LTX 2.5 and FLUX.3 Video send lengths as numbers", () => {
    expect(buildPayload(route("ltx-2-5", "t2v").map!, { prompt: "x", duration: 6 })).toMatchObject({ duration: 6 });
    expect(buildPayload(route("flux-3-video", "t2v").map!, { prompt: "x", duration: 6 })).toMatchObject({ duration: 6 });
  });

  it("Wan 2.6 Custom shots reach a length the endpoint takes", () => {
    const p = plan({ modelId: "wan-2-6", op: "t2v", params: { shots: [{ prompt: "a", duration: 2 }, { prompt: "b", duration: 2 }] } } as never);
    expect([5, 10, 15]).toContain(p.params.duration);
  });

  it("a start frame keeps its shape: Veo 3.1 sends \"auto\" when the run picks no other shape", () => {
    const p = plan({ modelId: "veo-3-1", op: "i2v", inputs: { images: [IMG] } } as never);
    expect(p.params.aspectRatio).toBe("auto");
  });

  it("Kling O3 references stay references (no start frame)", () => {
    expect(buildPayload(route("kling-o3", "ref2v").map!, { prompt: "x", images: [IMG, `${IMG}?2`] })).not.toHaveProperty("start_image_url");
  });

  it("H3, H3 Max and Seedance 2.0 references stay within the endpoints' counts (12 files in all; Seedance's sound needs a picture or clip)", () => {
    const refs = (n: number, u: string) => Array.from({ length: n }, (_, k) => `${u}?${k}`);
    const fifteen = { inputs: { images: refs(9, IMG), videos: refs(3, CLIP), audios: refs(3, SOUND) } };
    for (const id of ["minimax-h3", "minimax-h3-max", "seedance-2-0", "seedance-2-0-fast"]) {
      expect(hostedInputProblem(model(id), "ref2v", "x", {}, fifteen)).toMatch(/12 references/);
    }
    expect(hostedInputProblem(model("minimax-h3-max"), "ref2v", "x", {}, { inputs: { images: refs(10, IMG) } })).toMatch(/9 pictures/);
    expect(hostedInputProblem(model("seedance-2-0"), "ref2v", "x", {}, { inputs: { audios: [SOUND] } })).toMatch(/picture or clip/);
    expect(hostedInputProblem(model("seedance-2-0"), "ref2v", "x", {}, { inputs: { images: [IMG], audios: [SOUND] } })).toBeNull();
  });

  it("Luma Ray 3.2 reframe with no words sends its own prompt", () => {
    expect(buildPayload(route("luma-ray-3-2", "reframe").map!, { prompt: "", video: CLIP, aspectRatio: "9:16" }).prompt).toMatch(/\S/);
  });

  it("MMAudio folds the studio's seeds into 0-65535", () => {
    const seed = buildPayload(route("mmaudio-cloud", "v2a").map!, { prompt: "x", video: CLIP, seed: 123_456_789 }).seed as number;
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(65535);
  });

  it("clip windows the endpoints document are kept before the call", () => {
    expect(clipWindowProblem(model("kling-o3"), 16)).not.toBeNull();
    expect(clipWindowProblem(model("luma-ray-3-2"), 11)).not.toBeNull();
    expect(clipWindowProblem(model("h3-max-recast"), 4)).not.toBeNull();
    expect(sourceSeconds("grok-imagine-video-edit").max).toBe(8);
    expect(clipSizeProblem(model("kling-o3"), 854, 480)).not.toBeNull();
    expect(clipFpsProblem(model("kling-o1"), 15)).not.toBeNull();
    expect(clipSizeProblem(model("kling-o1"), 3840, 2160)).not.toBeNull();
    expect(clipWindowProblem(model("heygen-translate"), 600)).not.toBeNull();
    expect(sourceLengthProblem(model("flux-video-upscale"), 30)).not.toBeNull();
  });

  it("OmniHuman's voice length follows its size; OmniHuman 2 takes 4-300 s", () => {
    expect(voiceWindowProblem(model("omnihuman"), 45, "1080p")).not.toBeNull();
    expect(voiceWindowProblem(model("omnihuman"), 45, "720p")).toBeNull();
    expect(voiceWindowProblem(model("omnihuman-2"), 3)).not.toBeNull();
  });

  it("files a clip endpoint refuses are named before the upload", () => {
    expect(clipFileProblem(model("flux-3-video"), "v2v", "video", "video/webm", 1000)).not.toBeNull();
    expect(clipFileProblem(model("omnihuman-2"), "avatar", "audio", "audio/ogg", 1000)).not.toBeNull();
  });

  it("compose's thumbnail and LightX's debug and input videos are not results", () => {
    expect(extractOutputs({ video_url: "https://fal.media/out.mp4", thumbnail_url: "https://fal.media/t.jpg" }, "mux").map((o) => o.kind)).toEqual(["video"]);
    const lightx = { video: { url: "https://fal.media/gen.mp4" }, viz_video: { url: "https://fal.media/viz.mp4" }, input_video: { url: "https://fal.media/in.mp4" } };
    expect(extractOutputs(lightx, "relight-video").map((o) => o.url)).toEqual(["https://fal.media/gen.mp4"]);
    const sam = { video: { url: "https://fal.media/out.mp4" }, boundingbox_frames_zip: { url: "https://fal.media/bb.zip", content_type: "application/zip" } };
    expect(extractOutputs(sam, "bg-remove-video").map((o) => o.url)).toEqual(["https://fal.media/out.mp4"]);
  });

  it("Meshy 7.1 offers the meshes the endpoint takes", () => {
    const values = JSON.stringify(model("meshy-7-1").options);
    expect(values).not.toContain("lowpoly");
    expect(values).toContain("smart-topology-t2");
  });

  it("Lyria 3 on fal.ai reads one picture: more go to Replicate or are refused", () => {
    expect(route("lyria-3", "music", "fal").map?.maxImages).toBe(1);
    expect(route("lyria-3-pro", "music", "fal").map?.maxImages).toBe(1);
  });

  it("an LTX-2.3 LoRA loads on its one transformer", () => {
    const r = model("ltx-2-3-quality-hdr")?.routes.find((x) => x.map?.loras);
    if (!r) return;
    const p = buildPayload(r.map!, { prompt: "x", loras: [{ path: "https://example.com/a.safetensors", scale: 1, expert: "high" } as never] });
    expect(JSON.stringify(p)).not.toContain('"transformer":"high"');
  });

  it.todo("hosted: fal uploads and results expire with Fuobe's retention (fal.ts lifecycle headers)");
  it.todo("hosted: a 404 on a status poll ends the run as gone, not as model-unavailable (diagnose.ts + generations.ts)");
  it.todo("hosted: a fal training given up on is cancelled at fal (training.ts cancel_url)");
  it.todo("hosted: a voice clone that times out is cancelled at fal (fal.ts cloneVoice)");
  it.todo("hosted: pictures outside an endpoint's documented size or format are fitted before upload (fit-still.ts)");
  it.todo("hosted: clip and voice files are checked with clipFileProblem before upload (generations.ts prepVideo/prepVoice)");
});
