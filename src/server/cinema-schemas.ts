import "server-only";
import { z } from "zod";
import { BLOCKOUT } from "@/lib/blockout";
import { DISTANCE, MAX_KEYS } from "@/lib/camera-path";
import { APERTURE, LENS } from "@/lib/scene3d";
import { CinemaError } from "./cinema";
import { connectRefusal } from "./connect-refusal";
import { ConnectComfyError } from "./generations";
import { TurnaroundSchema } from "./turnaround";

/** Request bodies of /api/cinema/** (zod drops unknown keys). */

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const FileRef = z.string().startsWith("/api/files/").max(500);
const Slug = z.string().max(80).nullable().optional();

export const DirectorSchema = z.object({
  genre: Slug,
  era: Slug,
  tempo: Slug,
  camera: Slug,
  lens: Slug,
  focal: Slug,
  aperture: Slug,
  palette: z
    .union([z.object({ kind: z.literal("preset"), slug: z.string().max(80) }), z.object({ kind: z.literal("custom"), name: z.string().max(60), hex: z.array(Hex).min(1).max(12) })])
    .nullable()
    .optional(),
  paletteLock: z.boolean().optional(),
  lighting: z
    .union([
      z.object({ kind: z.literal("preset"), slug: z.string().max(80) }),
      z.object({
        kind: z.literal("custom"),
        lights: z.array(z.object({ direction: z.string().max(40), color: Hex, brightness: z.number().int().min(0).max(100), diffuse: z.number().int().min(0).max(100) })).min(1).max(2),
      }),
    ])
    .nullable()
    .optional(),
  emotions: z.record(z.string().max(60), z.object({ family: z.string().max(30), step: z.number().int().min(0).max(2) })).optional(),
});

export const ProjectCreate = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(140).nullable().optional(),
  cover: FileRef.nullable().optional(),
  costCapUsd: z.number().min(0).max(100_000).nullable().optional(),
});

export const ProjectPatch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(140).nullable().optional(),
  cover: FileRef.nullable().optional(),
  costCapUsd: z.number().min(0).max(100_000).nullable().optional(),
  director: DirectorSchema.optional(),
  palettes: z.array(z.object({ name: z.string().max(60), hex: z.array(Hex).min(1).max(12) })).max(60).optional(),
  brief: z.object({ title: z.string().max(120).optional(), body: z.string().max(20_000).optional() }).optional(),
  pinned: z.boolean().optional(),
});

export const FolderCreate = z.object({
  name: z.string().trim().min(1).max(60),
  parentId: z.string().max(40).nullable().optional(),
  color: Hex.nullable().optional(),
});

export const FolderPatch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  parentId: z.string().max(40).nullable().optional(),
  color: Hex.nullable().optional(),
  pinned: z.boolean().optional(),
  position: z.number().int().min(0).max(100_000).optional(),
});

const Ids = z.array(z.string().max(40)).min(1).max(500);
export const ItemsPatch = z.object({ ids: Ids, folderId: z.string().max(40).nullable().optional(), favorite: z.boolean().optional() });
export const ItemsDelete = z.object({ ids: Ids, deleteGenerations: z.boolean().optional() });
export const TilesPut = z.object({ tiles: z.array(z.object({ url: FileRef, row: z.number().int().min(0).max(15), col: z.number().int().min(0).max(15) })).max(16) });

const Shot = z.object({ prompt: z.string().max(2000), duration: z.number().min(1).max(30) });

const Words = z.string().trim().max(BLOCKOUT.maxBeatWords);

/** A blockout to film (src/lib/catalog/cinema.ts BlockoutRun; Assist's blockout_film takes the same). */
export const BlockoutSchema = z.object({
  video: FileRef,
  depth: FileRef.optional(),
  firstFrame: FileRef.optional(),
  seconds: z.number().min(BLOCKOUT.minSeconds).max(BLOCKOUT.maxSeconds),
  beats: z
    .array(z.object({ id: z.string().max(40).optional(), start: z.number().min(0).max(BLOCKOUT.maxSeconds), end: z.number().min(0).max(BLOCKOUT.maxSeconds).optional(), label: z.string().trim().max(80), words: Words.default("") }))
    .max(BLOCKOUT.maxMarkers)
    .default([]),
  refs: z
    .array(z.object({ url: FileRef, role: z.enum(["interior", "exterior", "location", "character", "prop", "style"]), name: z.string().trim().max(60).optional() }))
    .max(BLOCKOUT.maxRefs)
    .default([]),
  style: Words.optional(),
  constraints: Words.optional(),
  sounds: z.array(z.string().trim().max(120)).max(12).optional(),
  avoid: z.array(z.string().trim().max(120)).max(16).optional(),
});

export const GenerateBody = z.object({
  folderId: z.string().max(40).nullable().optional(),
  input: z.object({
    engine: z.enum(["cloud", "open"]),
    mode: z.enum(["video", "image"]),
    action: z.enum(["generate", "extend-forward", "extend-backward", "edit", "grid", "cast", "location", "location-view", "scene", "recompose", "path", "turnaround", "blockout"]).default("generate"),
    modelId: z.string().max(80).optional(),
    prompt: z.string().max(60_000).default(""),
    moves: z.array(z.string().max(40)).max(12).optional(),
    settings: DirectorSchema.optional(),
    images: z.array(FileRef).max(30).optional(),
    videos: z.array(FileRef).max(10).optional(),
    audios: z.array(FileRef).max(10).optional(),
    duration: z.number().min(1).max(30).optional(),
    resolution: z.string().max(10).optional(),
    aspectRatio: z.string().max(10).optional(),
    batch: z.number().int().min(1).max(4).optional(),
    audio: z.boolean().optional(),
    multiShot: z.object({ mode: z.enum(["off", "auto", "manual"]), shots: z.array(Shot).max(12).optional() }).optional(),
    source: z
      .object({
        url: FileRef,
        kind: z.enum(["image", "video"]),
        firstFrame: FileRef.optional(),
        // What the browser knows about the take (its model picks the editor; its scene, length and size shape an edit).
        modelId: z.string().max(80).optional(),
        prompt: z.string().max(4000).optional(),
        seconds: z.number().positive().max(600).optional(),
        resolution: z.string().max(10).optional(),
        aspectRatio: z.string().max(10).optional(),
      })
      .optional(),
    grid: z.object({ size: z.enum(["2x2", "3x3", "4x4"]), type: z.enum(["freeform", "zooms", "shots", "next_shots", "prev_shots"]) }).optional(),
    cast: z.record(z.string().max(40), z.union([z.string().max(300), z.number(), z.array(z.string().max(60)).max(10)])).optional(),
    view: z.string().max(20).optional(),
    capture: z
      .object({
        url: FileRef,
        lens: z.number().min(LENS.min).max(LENS.max),
        aperture: z.number().min(APERTURE.min).max(APERTURE.max),
        pose: z.object({ horizontal: z.number().min(0).max(360), vertical: z.number().min(-30).max(90), zoom: z.number().min(0).max(10) }),
      })
      .optional(),
    // Fly path (N7-5): the keyframes, the length, the open engine's render along the path and the move it started from.
    path: z
      .object({
        keys: z
          .array(
            z.object({
              t: z.number().min(0).max(1),
              azimuth: z.number().min(-360 * 32).max(360 * 32),
              elevation: z.number().min(-90).max(90),
              distance: z.number().min(DISTANCE.min).max(DISTANCE.max),
              truck: z.number().min(-4).max(4).optional(),
            }),
          )
          .min(1)
          .max(MAX_KEYS),
        duration: z.number().min(1).max(15).optional(),
        render: FileRef.optional(),
        preset: z.string().max(40).optional(),
      })
      .optional(),
    // Turnaround (N7-6): the Soul Cast result's pictures by side, the route and length (the engine is the run's).
    turnaround: TurnaroundSchema.omit({ engine: true, realPerson: true, consent: true }).optional(),
    // Blockout to film: the grey box (its depth and first frame when the builder made them), beats, references, words.
    blockout: BlockoutSchema.optional(),
  }),
});

export const DirectorAsk = z.object({ text: z.string().trim().min(1).max(8000) });

/** Parse a JSON body or answer 400 with `message`. */
export async function body<S extends z.ZodType>(request: Request, schema: S, message: string): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new CinemaError(message, 400);
  return parsed.data;
}

/** Turn thrown errors into the API's `{ error }` responses. */
export async function handle(fn: () => Promise<Response> | Response, request?: Request): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CinemaError) return Response.json({ error: e.message }, { status: e.status });
    // A run nothing connected can make: the connect card in the owner's browser (src/server/connect-refusal.ts).
    if (e instanceof ConnectComfyError) return (request && connectRefusal(e, request)) || Response.json({ error: e.message }, { status: 422 });
    console.error("[cinema]", e);
    return Response.json({ error: (e as Error).message || "Something went wrong" }, { status: 500 });
  }
}
