/**
 * The providers' own API schemas kept in tests/fixtures/provider-schemas/ (scripts/refresh-provider-schemas.mjs, public GETs
 * only), read for the conformance tests: an endpoint's input and output schema, an ajv validator for each, a documented
 * answer made from the output schema, and the body fal.ts or replicate.ts sends for a planned run.
 */
import fs from "node:fs";
import path from "node:path";
import Ajv, { type ValidateFunction } from "ajv";
import { loraEndpointFor, routeLoraField } from "@/lib/catalog/loras";
import { buildPayload } from "@/lib/catalog/payload";
import type { planGeneration } from "@/lib/catalog/plan";
import type { GenerationRequest, GenInput, GenParams, ModelRoute } from "@/lib/catalog/types";

export const SCHEMA_DIR = path.join(__dirname, "../fixtures/provider-schemas");
export const SCHEMA_INDEX = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, "index.json"), "utf8")) as { fal: string[]; replicate: string[] };
export const schemaFile = (provider: string, endpoint: string) => path.join(SCHEMA_DIR, provider, `${endpoint.replaceAll("/", "__")}.json`);

export type Provider = "fal" | "replicate";

/** The parts of a JSON schema (OpenAPI 3) read here. */
export interface Schema {
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
  maximum?: number;
  maxItems?: number;
  maxLength?: number;
  additionalProperties?: boolean | Schema;
}
type Body = { content?: Record<string, { schema?: Schema }> };
export type Doc = {
  paths?: Record<string, Record<string, { requestBody?: Body; responses?: Record<string, Body> }>>;
  components?: { schemas?: Record<string, Schema> };
};

const docs = new Map<string, Doc>();
/** An endpoint's OpenAPI document (fal's queue OpenAPI; Replicate's version openapi_schema). */
export function schemaDoc(provider: Provider, endpoint: string): Doc {
  const key = `${provider}:${endpoint}`;
  if (!docs.has(key)) {
    const raw = JSON.parse(fs.readFileSync(schemaFile(provider, endpoint), "utf8"));
    docs.set(key, provider === "fal" ? raw : raw.openapi_schema);
  }
  return docs.get(key)!;
}

export const refName = (s: Schema | undefined): string | undefined => (typeof s?.$ref === "string" ? s.$ref.split("/").pop() : undefined);

/** The endpoint's input and output schema names (fal: the queue submit body and result; Replicate: Input and Output). */
export function schemaNames(provider: Provider, endpoint: string): { input: string; output: string } {
  if (provider === "replicate") return { input: "Input", output: "Output" };
  const d = schemaDoc(provider, endpoint);
  const submit = d.paths?.[`/${endpoint}`]?.post;
  const result = d.paths?.[`/${endpoint}/requests/{request_id}`]?.get;
  const input = refName(submit?.requestBody?.content?.["application/json"]?.schema);
  const output = refName(result?.responses?.["200"]?.content?.["application/json"]?.schema);
  if (!input || !output) throw new Error(`${endpoint}: no input or output schema in its fixture`);
  return { input, output };
}

/** The endpoint's input schema, as written. */
export function inputSchema(provider: Provider, endpoint: string): Schema {
  return schemaDoc(provider, endpoint).components!.schemas![schemaNames(provider, endpoint).input];
}

// OpenAPI keywords ajv doesn't know (x-*, examples, nullable) are left to it as annotations; "uri" and other formats are
// not checked (a run's files are URLs the provider fetches).
const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false, validateSchema: false });
const validators = new Map<string, ValidateFunction>();
export function schemaValidator(provider: Provider, endpoint: string, name: string): ValidateFunction {
  const id = `${provider}:${endpoint}`;
  const key = `${id}#${name}`;
  if (!validators.has(key)) {
    if (!ajv.getSchema(id)) ajv.addSchema({ $id: id, components: schemaDoc(provider, endpoint).components }, id);
    validators.set(key, ajv.compile({ $ref: `${id}#/components/schemas/${name}` }));
  }
  return validators.get(key)!;
}

export const errorsOf = (fn: ValidateFunction) =>
  (fn.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}${e.params && "allowedValues" in e.params ? ` ${JSON.stringify(e.params.allowedValues)}` : ""}`);

/**
 * What's wrong with a request body for the endpoint, in words; [] when it fits. Besides the schema itself, every top-level
 * key must be one of its fields: most fal schemas don't forbid others, and fal ignores them without a word, so a misspelled
 * or unknown field would otherwise go unnoticed.
 */
export function bodyProblems(provider: Provider, endpoint: string, body: Record<string, unknown>): string[] {
  const fn = schemaValidator(provider, endpoint, schemaNames(provider, endpoint).input);
  const out = fn(body) ? [] : errorsOf(fn);
  const props = Object.keys(inputSchema(provider, endpoint).properties ?? {});
  for (const k of Object.keys(body)) if (!props.includes(k)) out.push(`/${k} is not a field of ${endpoint}`);
  return out;
}

// ---------------------------------------------------------------------------
// The runs the studio sends

export const IMG = "https://v3b.fal.media/files/in/start.png";
export const END = "https://v3b.fal.media/files/in/end.png";
export const CLIP = "https://v3b.fal.media/files/in/clip.mp4";
export const VOICE = "https://v3b.fal.media/files/in/voice.mp3";
export const SONG = "https://v3b.fal.media/files/in/song.mp3";
export const GLB = "https://v3b.fal.media/files/in/model.glb";
export const PROMPT = "A dancer in a silver coat turns slowly under warm stage light, the camera drifting closer";

export type Inputs = NonNullable<GenerationRequest["inputs"]>;
export interface Variant {
  label: string;
  inputs: Inputs;
  params: GenParams;
  prompt?: string;
  negativePrompt?: string;
}

/**
 * The body fal.ts or replicate.ts would send for this route (their submit: LoRA field, LoRA endpoint, a song uploaded first),
 * and the upload's own body when a song goes through Mureka's files/upload first.
 */
export function routeRequest(route: ModelRoute, input: GenInput): { endpoint: string; body: Record<string, unknown>; upload?: { endpoint: string; body: Record<string, unknown> } } {
  const map = { ...route.map, loras: routeLoraField(route) };
  const body = buildPayload(map, input);
  const song = map.songSource;
  let upload: { endpoint: string; body: Record<string, unknown> } | undefined;
  if (song && body[song.songId] === undefined) {
    // fal.ts uploadSong: { file_url, purpose } to the upload endpoint, then the id it answers in the tool's upload field.
    upload = { endpoint: song.upload.endpoint, body: { file_url: input.audio, purpose: song.upload.purpose } };
    body[song.uploadId] = "mureka-upload-id";
  }
  return { endpoint: loraEndpointFor({ ...route, map }, input.loras).split(":")[0], body, ...(upload && { upload }) };
}

/** The input the server hands the adapter (generations.ts handOver), files already uploaded. */
export function handOverInput(plan: ReturnType<typeof planGeneration>, v: Pick<Variant, "inputs" | "negativePrompt">): GenInput {
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

// ---------------------------------------------------------------------------
// Answers made from the output schemas

/** Replicate's example prediction's output (the model page's own), else one made from the Output schema. */
export function replicateAnswer(model: string, d: Doc): unknown {
  const raw = JSON.parse(fs.readFileSync(schemaFile("replicate", model), "utf8"));
  return raw.example_prediction?.output ?? exampleOf(d.components?.schemas?.Output, d);
}

/** The endpoint's documented answer: Replicate's example prediction, else a value made from its output schema. */
export function documentedAnswer(provider: Provider, endpoint: string): unknown {
  const d = schemaDoc(provider, endpoint);
  return provider === "replicate" ? replicateAnswer(endpoint, d) : exampleOf(d.components?.schemas?.[schemaNames(provider, endpoint).output], d);
}

const EXT: Record<string, string> = { image: "png", video: "mp4", audio: "mp3", model3d: "glb" };
const MIME: Record<string, string> = { image: "image/png", video: "video/mp4", audio: "audio/mpeg", model3d: "model/gltf-binary" };

/**
 * A value for a schema: its own example where it has one, else one of its type. Every optional field is filled too (a
 * still fal may send beside the video is part of the answer), flags are false, and a file with no example gets a URL with
 * the extension its title or field name suggests.
 */
export function exampleOf(schema: Schema | undefined, d: Doc, key = "", depth = 0): unknown {
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
