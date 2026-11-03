import "server-only";
import { z } from "zod";
import { MIXED } from "@/lib/catalog/mixed-media";
import { SHORTS } from "@/lib/catalog/shorts";
import { ORIGINAL_SOUNDS, SOUND_LOWER_MAX_DB, SOUND_LOWER_MIN_DB, type OriginalSound } from "@/lib/av/original-sound";
import { connectRefusal } from "./connect-refusal";
import { ShortsError } from "./shorts";

/** Request bodies for /api/shorts/** and /api/mixed-media/** (zod), and the shared error answer. */

const fileUrl = z.string().startsWith("/api/files/").max(500);
const seconds = z.number().finite().min(0).max(3600);
/** A client nonce for one submit: a repeated id gets the first answer instead of a second paid run (see once()). */
const requestId = z.string().trim().min(8).max(64).optional();

/** Original sound: what of the clip's sound a studio puts back (src/lib/av/original-sound.ts). */
export const SoundChoiceSchema = z.object({
  sound: z.enum(ORIGINAL_SOUNDS.map((o) => o.id) as [OriginalSound, ...OriginalSound[]]),
  musicDb: z.number().finite().min(SOUND_LOWER_MIN_DB).max(SOUND_LOWER_MAX_DB).optional(),
});

const source = z.object({
  url: fileUrl,
  name: z.string().max(200).optional(),
  duration: z.number().finite().positive().max(3600).optional(),
  fps: z.number().finite().positive().max(240).optional(),
  width: z.number().int().positive().max(20000).optional(),
  height: z.number().int().positive().max(20000).optional(),
});

export const ShortsBodySchema = z.object({
  engine: z.enum(["cloud", "open"]),
  presetId: z.string().min(1).max(80),
  source,
  range: z.object({ start: seconds, end: seconds }),
  aspectRatio: z.enum(["9:16", "16:9"]).default("9:16"),
  language: z.string().max(40).default("auto"),
  modelId: z.string().max(80).optional(),
  sound: SoundChoiceSchema.optional(),
  requestId,
});

/** The estimate is asked for before the upload finishes: any URL stands in. */
export const ShortsEstimateSchema = ShortsBodySchema.extend({ source: source.extend({ url: z.string().max(500).default("/api/files/placeholder.mp4") }) });

export const PresetBodySchema = z.object({
  name: z.string().trim().max(60).optional(),
  description: z.string().trim().max(300).optional(),
  references: z.array(fileUrl).min(1).max(SHORTS.maxReferences),
});

export const PresetPatchSchema = PresetBodySchema.partial();

export const MixedBodySchema = z.object({
  engine: z.enum(["cloud", "open"]),
  presetId: z.string().min(1).max(80),
  values: z.record(z.string(), z.string().max(200)).optional(),
  source,
  range: z.object({ start: seconds, end: seconds }),
  fps: z.number().finite().min(MIXED.manualFps.min).max(MIXED.manualFps.max).default(MIXED.defaultFps),
  resolution: z.enum(MIXED.resolutions).default("1K"),
  modelId: z.string().max(80).optional(),
  /** "frames" (frame by frame, the default), "smooth" (the Original's first frame, then Wan 2.2 Fun VACE by depth) or, in the cloud, "fast" (one video-to-video pass). */
  mode: z.enum(["frames", "smooth", "fast"]).optional(),
  anchor: fileUrl.optional(),
  frameUrl: fileUrl.optional(),
  seed: z.number().int().min(0).max(2 ** 48).optional(),
  sound: SoundChoiceSchema.optional(),
  requestId,
});

/** Bodies of the session actions that only carry a nonce (stitch again, regenerate a segment). */
export const NonceSchema = z.object({ requestId }).default({});

/** Stitch again: a nonce, and optionally a new Original sound choice (kept for the stitches after it). */
export const StitchSchema = z.object({ requestId, sound: SoundChoiceSchema.optional() }).default({});

export const MixedEstimateSchema = MixedBodySchema.extend({ source: source.extend({ url: z.string().max(500).default("/api/files/placeholder.mp4") }) });

/** A user-facing error answer: ShortsError keeps its status; anything else from the planner is a 422. */
export function errorResponse(e: unknown): Response {
  if (e instanceof ShortsError) return Response.json({ error: e.message }, { status: e.status });
  return Response.json({ error: (e as Error).message || "Something went wrong" }, { status: 422 });
}

/** Parse a JSON body with a schema; a bad one is a 400 with `message`. */
export async function body<S extends z.ZodType>(request: Request, schema: S, message: string): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new ShortsError(message, 400);
  return parsed.data;
}

/** Parse an optional JSON body (none, or an empty one, is `{}`). */
export async function optionalBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  const text = await request.text().catch(() => "");
  let raw: unknown = {};
  try {
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new ShortsError("That request body isn't JSON", 400);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ShortsError("Bad request", 400);
  return parsed.data;
}

declare global {
  var __fuobeShortsRequests: Map<string, { at: number; result: Promise<unknown> }> | undefined;
}
const requests = () => (globalThis.__fuobeShortsRequests ??= new Map());
const REQUEST_TTL = 10 * 60_000;

/**
 * Run `fn` once per client request id: a repeat of the same id (a double click that got through, a
 * retried POST) gets the first call's answer — the same session or render — instead of starting a
 * second paid run. A call that failed can be tried again with the same id. Without an id, it just runs.
 */
export function once<T>(scope: string, id: string | undefined, fn: () => Promise<T> | T): Promise<T> {
  if (!id) return Promise.resolve().then(fn);
  const map = requests();
  const now = Date.now();
  for (const [k, v] of map) if (now - v.at > REQUEST_TTL) map.delete(k);
  const key = `${scope}:${id}`;
  const hit = map.get(key);
  if (hit) return hit.result as Promise<T>;
  const result = Promise.resolve().then(fn);
  map.set(key, { at: now, result });
  result.catch(() => map.delete(key));
  return result;
}

/** Run a route body, answering errors as `{ error }`. */
export async function handle(fn: () => Promise<Response> | Response, request?: Request): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    // A run nothing connected can make: the connect card in the owner's browser (src/server/connect-refusal.ts).
    return (request && connectRefusal(e, request)) || errorResponse(e);
  }
}
