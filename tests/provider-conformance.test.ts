/**
 * The hosted routes no live call has passed yet (src/lib/catalog/hosted-untested.ts) checked against the providers' own
 * API schemas, kept in tests/fixtures/provider-schemas/ by scripts/refresh-provider-schemas.mjs (public GETs only):
 *
 * - Each route's request, for every setting the studio offers it (shape, size, length, the model's own controls, sound,
 *   seed, negative words, references up to the model's limits), is built by the real planner and payload builder (as
 *   fal.ts and replicate.ts submit it) and validated with ajv against the endpoint's input schema.
 * - Each endpoint's answer, made from its output schema (its examples, else a value of each field's type), is read by
 *   the real result parser: it gives the files the run makes, of the kind the run makes, and nothing else.
 *
 * A provider that changes an endpoint shows up as a fixture diff when the schemas are refreshed, and here as the request
 * or answer that no longer fits.
 */
import fs from "node:fs";
import path from "node:path";
import Ajv, { type ValidateFunction } from "ajv";
import { describe, expect, it } from "vitest";
import { getModel, getPreset, MODELS } from "@/lib/catalog";
import { HOSTED_UNTESTED_ENDPOINTS, isHostedUntested } from "@/lib/catalog/hosted-untested";
import { loraEndpointFor, routeLoraField } from "@/lib/catalog/loras";
import { buildPayload, extractOutputs } from "@/lib/catalog/payload";
import { planGeneration, routesFor } from "@/lib/catalog/plan";
import { operationOutput, type GenerationRequest, type GenInput, type GenParams, type ModelDef, type ModelRoute, type Operation } from "@/lib/catalog/types";

const DIR = path.join(__dirname, "fixtures/provider-schemas");
const INDEX = JSON.parse(fs.readFileSync(path.join(DIR, "index.json"), "utf8")) as { fal: string[]; replicate: string[] };
const fileFor = (provider: string, endpoint: string) => path.join(DIR, provider, `${endpoint.replaceAll("/", "__")}.json`);

/** The parts of a JSON schema (OpenAPI 3) read here. */
interface Schema {
  $ref?: string;
  examples?: unknown[];
  example?: unknown;
  anyOf?: Schema[];
  oneOf?: Schema[];
  allOf?: Schema[];
  default?: unknown;
  enum?: unknown[];
  type?: string | string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  title?: string;
  format?: string;
  minimum?: number;
}
type Body = { content?: Record<string, { schema?: Schema }> };
type Doc = {
  paths?: Record<string, Record<string, { requestBody?: Body; responses?: Record<string, Body> }>>;
  components?: { schemas?: Record<string, Schema> };
};
const docs = new Map<string, Doc>();
function doc(provider: "fal" | "replicate", endpoint: string): Doc {
  const key = `${provider}:${endpoint}`;
  if (!docs.has(key)) {
    const raw = JSON.parse(fs.readFileSync(fileFor(provider, endpoint), "utf8"));
    docs.set(key, provider === "fal" ? raw : raw.openapi_schema);
  }
  return docs.get(key)!;
}

const refName = (s: Schema | undefined): string | undefined => (typeof s?.$ref === "string" ? s.$ref.split("/").pop() : undefined);

/** The endpoint's input and output schema names (fal: the queue submit body and result; Replicate: Input and Output). */
function schemaNames(provider: "fal" | "replicate", endpoint: string): { input: string; output: string } {
  if (provider === "replicate") return { input: "Input", output: "Output" };
  const d = doc(provider, endpoint);
  const submit = d.paths?.[`/${endpoint}`]?.post;
  const result = d.paths?.[`/${endpoint}/requests/{request_id}`]?.get;
  const input = refName(submit?.requestBody?.content?.["application/json"]?.schema);
  const output = refName(result?.responses?.["200"]?.content?.["application/json"]?.schema);
  if (!input || !output) throw new Error(`${endpoint}: no input or output schema in its fixture`);
  return { input, output };
}

// OpenAPI keywords ajv doesn't know (x-*, examples, nullable) are left to it as annotations; "uri" and other formats are
// not checked (a run's files are URLs the provider fetches).
const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false, validateSchema: false });
const validators = new Map<string, ValidateFunction>();
function validator(provider: "fal" | "replicate", endpoint: string, name: string): ValidateFunction {
  const id = `${provider}:${endpoint}`;
  const key = `${id}#${name}`;
  if (!validators.has(key)) {
    if (!ajv.getSchema(id)) ajv.addSchema({ $id: id, components: doc(provider, endpoint).components }, id);
    validators.set(key, ajv.compile({ $ref: `${id}#/components/schemas/${name}` }));
  }
  return validators.get(key)!;
}

// ---------------------------------------------------------------------------
// The runs the studio can send each route.

const IMG = "https://v3b.fal.media/files/in/start.png";
const END = "https://v3b.fal.media/files/in/end.png";
const CLIP = "https://v3b.fal.media/files/in/clip.mp4";
const VOICE = "https://v3b.fal.media/files/in/voice.mp3";
const SONG = "https://v3b.fal.media/files/in/song.mp3";
const GLB = "https://v3b.fal.media/files/in/model.glb";
const PROMPT = "A dancer in a silver coat turns slowly under warm stage light, the camera drifting closer";

type Inputs = NonNullable<GenerationRequest["inputs"]>;
interface Variant {
  label: string;
  inputs: Inputs;
  params: GenParams;
  prompt?: string;
  negativePrompt?: string;
}

/** What each operation's run carries (a clip's length, a song's), as the studio sends it. */
function baseRun(model: ModelDef, op: Operation): Omit<Variant, "label"> {
  const o = model.options;
  const words = model.options.promptless ? undefined : PROMPT;
  switch (op) {
    case "i2v":
      return { inputs: { images: [IMG] }, params: {}, prompt: words };
    case "flf2v":
      return { inputs: { images: [IMG], endImage: END }, params: {}, prompt: words };
    case "ref2v":
      return { inputs: { images: [IMG] }, params: {}, prompt: words };
    case "avatar":
      return { inputs: { images: [IMG], audio: VOICE }, params: { sourceDuration: 12 }, prompt: words };
    case "relight-video":
      // The light is a sphere picture the studio picks.
      return { inputs: { video: CLIP, images: o.lightSphere ? ["https://v3b.fal.media/files/in/sphere.png"] : undefined }, params: { sourceDuration: 8, sourceSize: { width: 1280, height: 720 } } };
    case "insert-moment":
      // The new moment goes between the marks.
      return { inputs: { video: CLIP }, params: { sourceDuration: 8, sourceSize: { width: 1280, height: 720 }, startTime: 2, endTime: 5 }, prompt: PROMPT };
    case "extend":
    case "bg-remove-video":
    case "upscale-video": {
      // A clip within the model's own window (Kandinsky VSR takes up to 5 s).
      const seconds = Math.min(8, o.maxSourceSeconds ?? 8);
      return { inputs: { video: CLIP }, params: { sourceDuration: seconds, sourceSize: { width: 1280, height: 720 } }, prompt: o.promptless ? undefined : PROMPT };
    }
    case "song-extend":
    case "song-remix":
    case "song-stems":
      return { inputs: { audio: SONG }, params: { sourceDuration: 120, extra: o.lyrics?.required ? { lyrics: "[Verse]\nCity lights are calling me home" } : undefined }, prompt: op === "song-stems" ? undefined : "Warm synth-pop, female vocal" };
    case "music":
      return { inputs: {}, params: {}, prompt: "Warm synth-pop with a driving bass line" };
    case "enhance-voice":
      return { inputs: { audio: VOICE }, params: { sourceDuration: 12 } };
    case "bg-remove":
    case "splat":
    case "image-to-3d":
      return { inputs: { images: [IMG] }, params: {}, prompt: op === "bg-remove" && o.guided ? "the person" : undefined };
    case "retexture-3d":
      return { inputs: { model3d: GLB }, params: {}, prompt: "Weathered bronze with green patina" };
    default:
      return { inputs: {}, params: {}, prompt: words };
  }
}

/** Every value of every control (cartesian, small), so each quality picks its own route. */
function controlCombos(model: ModelDef): Record<string, string | number>[] {
  let combos: Record<string, string | number>[] = [{}];
  for (const c of model.options.controls ?? []) combos = combos.flatMap((x) => c.values.map((v) => ({ ...x, [c.param]: v })));
  return combos;
}

/** The settings the studio offers, one at a time off the model's defaults, under each control combination. */
function variants(model: ModelDef, op: Operation): Variant[] {
  const o = model.options;
  const base = baseRun(model, op);
  const out: Variant[] = [];
  for (const extra of controlCombos(model)) {
    const tag = Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(",");
    const add = (label: string, change: Partial<Variant> & { params?: GenParams } = {}) =>
      out.push({
        ...base,
        ...change,
        label: [tag, label].filter(Boolean).join(" "),
        inputs: { ...base.inputs, ...change.inputs },
        params: { ...base.params, ...change.params, extra: { ...base.params.extra, ...extra, ...change.params?.extra } },
      });
    add("defaults");
    for (const a of o.aspectRatios ?? []) add(`aspect ${a}`, { params: { aspectRatio: a } });
    for (const r of o.resolutions ?? []) add(`resolution ${r}`, { params: { resolution: r } });
    for (const d of o.durations ?? []) add(`duration ${d}`, { params: { duration: d } });
    if (o.audio) for (const on of [true, false]) add(`audio ${on}`, { params: { generateAudio: on } });
    if (o.seed) add("seed", { params: { seed: 1234567 } });
    if (o.negativePrompt) add("negative words", { negativePrompt: "blur, flicker" });
    for (const s of o.sliders ?? []) for (const v of [s.min, s.max]) add(`${s.param} ${v}`, { params: { extra: { [s.param]: v } } });
    if (op === "ref2v") {
      const imgs = Math.min(o.maxImages ?? 1, 3);
      const vids = Math.min(o.maxVideos ?? 0, 3);
      const auds = Math.min(o.maxAudios ?? 0, 3);
      if (imgs > 1) add(`${imgs} pictures`, { inputs: { images: Array.from({ length: imgs }, (_, i) => `https://v3b.fal.media/files/in/ref${i}.png`) } });
      if (vids) add(`${vids} clips`, { inputs: { videos: Array.from({ length: vids }, (_, i) => `https://v3b.fal.media/files/in/ref${i}.mp4`) } });
      if (auds) add(`${auds} voices`, { inputs: { audios: Array.from({ length: auds }, (_, i) => `https://v3b.fal.media/files/in/voice${i}.mp3`) } });
    }
    if (op === "extend" && o.maxAudios) add("voices", { inputs: { audios: [VOICE] } });
    if (op === "retexture-3d") add("style picture", { inputs: { images: [IMG] }, prompt: undefined });
  }
  return out;
}

/** The body fal.ts or replicate.ts would send for this route (their submit: LoRA field, LoRA endpoint, a song uploaded first). */
function request(route: ModelRoute, input: GenInput): { endpoint: string; body: Record<string, unknown> } {
  const map = { ...route.map, loras: routeLoraField(route) };
  const body = buildPayload(map, input);
  const song = map.songSource;
  if (song && body[song.songId] === undefined) body[song.uploadId] = "mureka-upload-id";
  return { endpoint: loraEndpointFor({ ...route, map }, input.loras).split(":")[0], body };
}

/** The input the server hands the adapter (generations.ts handOver), files already uploaded. */
function genInput(plan: ReturnType<typeof planGeneration>, v: Variant): GenInput {
  // A song extended at its end (or, before its start, at 0) unless the run says where, as handOver sets it.
  const extendAt = plan.op === "song-extend" && plan.params.startTime === undefined ? (plan.params.extra?.extend_type === "head" ? 0 : plan.params.sourceDuration) : undefined;
  return {
    ...plan.params,
    ...(extendAt !== undefined && { startTime: extendAt }),
    prompt: plan.prompt || undefined,
    negativePrompt: v.negativePrompt,
    images: v.inputs.images ?? [],
    endImage: v.inputs.endImage,
    video: v.inputs.video,
    audio: v.inputs.audio,
    videos: v.inputs.videos ?? [],
    audios: v.inputs.audios ?? [],
    model3d: v.inputs.model3d,
    loras: plan.loras,
  };
}

const errorsOf = (fn: ValidateFunction) => (fn.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}${e.params && "allowedValues" in e.params ? ` ${JSON.stringify(e.params.allowedValues)}` : ""}`);

// ---------------------------------------------------------------------------
// The routes.

const untested: { model: ModelDef; op: Operation; route: ModelRoute }[] = MODELS.flatMap((model) =>
  model.routes.filter((r) => isHostedUntested(model.id, r)).map((route) => ({ model, op: route.op, route })),
);

describe("provider conformance: the untested hosted routes", () => {
  it("keeps a schema for every untested endpoint and every endpoint they switch to", () => {
    const kept = new Set([...INDEX.fal.map((e) => `fal:${e}`), ...INDEX.replicate.map((e) => `replicate:${e}`)]);
    const needed = new Set<string>();
    for (const { route } of untested) {
      needed.add(`${route.provider}:${route.endpoint.split(":")[0]}`);
      if (route.loraEndpoint) needed.add(`${route.provider}:${route.loraEndpoint.split(":")[0]}`);
      if (route.map?.songSource) needed.add(`fal:${route.map.songSource.upload.endpoint}`);
    }
    for (const e of HOSTED_UNTESTED_ENDPOINTS) expect([...needed].some((n) => n.endsWith(`:${e}`)), `${e} is listed but no route uses it`).toBe(true);
    expect([...needed].filter((n) => !kept.has(n))).toEqual([]);
    for (const k of kept) expect(fs.existsSync(fileFor(k.split(":")[0], k.slice(k.indexOf(":") + 1))), k).toBe(true);
  });

  for (const { model, op, route } of untested) {
    const provider = route.provider as "fal" | "replicate";
    const name = `${model.id} ${op} → ${provider} ${route.endpoint}`;
    // A chained route is never sent itself: its steps go to the routes it names (Fuobe Animation's film: one
    // start-and-end-frame run per gap on the flf2v route, checked below, then a join).
    if (route.chained) continue;

    it(`${name}: every request the studio sends fits the input schema`, () => {
      const problems: string[] = [];
      let checked = 0;
      for (const v of variants(model, op)) {
        const req: GenerationRequest = { feature: model.kind, modelId: model.id, op, prompt: v.prompt, negativePrompt: v.negativePrompt, inputs: v.inputs, params: v.params };
        let plan: ReturnType<typeof planGeneration>;
        try {
          plan = planGeneration(req, getModel, getPreset);
        } catch (e) {
          problems.push(`${v.label}: refused before sending (${(e as Error).message})`);
          continue;
        }
        // The variant's route (a quality control picks Kandinsky's Pro or Lite endpoint): only this one is checked here.
        if (!routesFor(model, plan.op, plan.params).includes(route)) continue;
        const { endpoint, body } = request(route, genInput(plan, v));
        const fn = validator(provider, endpoint, schemaNames(provider, endpoint).input);
        checked++;
        if (!fn(body)) problems.push(`${v.label} → ${endpoint} ${JSON.stringify(body)}: ${errorsOf(fn).join("; ")}`);
      }
      expect(problems, problems.join("\n")).toEqual([]);
      expect(checked).toBeGreaterThan(0);
    });

    it(`${name}: its documented answer reads as the run's result`, () => {
      const names = schemaNames(provider, route.endpoint.split(":")[0]);
      const d = doc(provider, route.endpoint.split(":")[0]);
      const answer = provider === "replicate" ? replicateAnswer(route.endpoint.split(":")[0], d) : exampleOf(d.components?.schemas?.[names.output], d);
      // Stems come back as one zip (Mureka's zip_url), which fal.ts unpacks into one result per stem.
      if (op === "song-stems") return expect(typeof (answer as { zip_url?: unknown })?.zip_url).toBe("string");
      const outs = extractOutputs(answer, op);
      const want = operationOutput(op, model.kind);
      expect(outs.length, JSON.stringify(answer)).toBeGreaterThan(0);
      expect(outs.map((o) => `${o.kind} ${o.url}`), JSON.stringify(answer)).toEqual(outs.map((o) => `${want} ${o.url}`));
    });
  }
});

// ---------------------------------------------------------------------------
// Answers made from the output schemas.

/** Replicate's example prediction's output (the model page's own), else one made from the Output schema. */
function replicateAnswer(model: string, d: Doc): unknown {
  const raw = JSON.parse(fs.readFileSync(fileFor("replicate", model), "utf8"));
  return raw.example_prediction?.output ?? exampleOf(d.components?.schemas?.Output, d);
}

const EXT: Record<string, string> = { image: "png", video: "mp4", audio: "mp3", model3d: "glb" };
const MIME: Record<string, string> = { image: "image/png", video: "video/mp4", audio: "audio/mpeg", model3d: "model/gltf-binary" };

/**
 * A value for a schema: its own example where it has one, else one of its type. Every optional field is filled too (a
 * still fal may send beside the video is part of the answer), flags are false, and a file with no example gets a URL with
 * the extension its title or field name suggests.
 */
function exampleOf(schema: Schema | undefined, d: Doc, key = "", depth = 0): unknown {
  if (!schema || depth > 12) return undefined;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (schema.example !== undefined) return schema.example;
  const ref = refName(schema);
  if (ref) return exampleOf(d.components?.schemas?.[ref], d, key, depth + 1);
  const branch = schema.anyOf ?? schema.oneOf;
  if (branch) return exampleOf(branch.find((b) => b.type !== "null") ?? branch[0], d, key, depth + 1);
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s) => exampleOf(s, d, key, depth + 1)));
  if (schema.default !== undefined && schema.default !== null) return schema.default;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
  if (type === "object" || schema.properties) {
    const props = Object.entries(schema.properties ?? {}).map(([k, s]) => [k, exampleOf(s, d, k, depth + 1)] as const);
    const obj: Record<string, unknown> = Object.fromEntries(props.filter(([, v]) => v !== undefined));
    // A file object with no example of its own (fal's shared File and Image schemas carry a PNG's name and type as their
    // fields' examples): a file of the kind its field name or title says, with a URL, name and type to match.
    if ("url" in (schema.properties ?? {})) {
      const words = `${key} ${schema.title ?? ""}`;
      const kind = /video/i.test(words) ? "video" : /audio|song|stem|vocal|track|voice/i.test(words) ? "audio" : /image|cover|thumb|picture/i.test(words) ? "image" : "model3d";
      obj.url = `https://v3b.fal.media/files/out/${key || "file"}.${EXT[kind]}`;
      if ("file_name" in obj) obj.file_name = `${key || "file"}.${EXT[kind]}`;
      if ("content_type" in obj) obj.content_type = MIME[kind];
    }
    return obj;
  }
  if (type === "array") {
    const item = exampleOf(schema.items, d, key, depth + 1);
    return item === undefined ? [] : [item];
  }
  if (type === "boolean") return false;
  if (type === "integer" || type === "number") return schema.minimum ?? 1;
  if (type === "string") return /url|uri/i.test(key) || schema.format === "uri" ? `https://v3b.fal.media/files/out/${key}.bin` : "text";
  return undefined;
}
