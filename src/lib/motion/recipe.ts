/**
 * A recipe: everything a Kinetic Motion clip is made from, as JSON (pure). The scene, the seed, the size and rate, the
 * typed words, the brand, the person's own files, the scene's control values and the export settings. It is saved
 * with the result (params.extra.motion), so the same clip can be made again.
 *
 * Kinetic's editor adds optional fields (motion feel and pace, a finish, an extra camera, the ground light, retimed
 * motion groups, parameter tracks and a clip under the words). A recipe without them is the scene exactly as designed,
 * and `v` stays 1.
 */

import { z } from "zod";
import { CURVES, type CurveName } from "./ease";
import { rng } from "./random";
import { customSizeProblem } from "./sizes";

/** A recipe is at most this big as JSON. */
export const RECIPE_MAX_BYTES = 64 * 1024;

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** A picture the clip is made from: the person's own stored file, or one of Fuobe's own sample pictures. */
const File = z
  .string()
  .max(500)
  .refine((u) => (u.startsWith("/api/files/") || u.startsWith("/previews/")) && !u.includes(".."), "A stored file or a sample picture");

/** A clip the words go over: only the person's own stored file. */
const Clip = z
  .string()
  .max(500)
  .refine((u) => u.startsWith("/api/files/") && !u.includes(".."), "A stored file");

/** The motion feels a recipe can take (ease.ts CURVE_SETS). */
export const CURVE_SET_IDS = ["smooth", "snappy", "springy", "steady"] as const;
export type CurveSetId = (typeof CURVE_SET_IDS)[number];

/** The extra camera moves (every one comes home on the last frame). */
export const CAMERA_MOVES = ["scene", "locked", "push", "drift", "rise"] as const;
export type CameraMoveId = (typeof CAMERA_MOVES)[number];

/** The numbers a parameter track can animate, with their limits (camera x and y: a share of the frame's width; roll: degrees). */
export const TRACK_LIMITS = {
  "camera.zoom": [0.8, 1.25],
  "camera.x": [-0.1, 0.1],
  "camera.y": [-0.1, 0.1],
  "camera.roll": [-10, 10],
  "finish.contrast": [-0.5, 0.5],
  "finish.saturation": [-1, 1],
  "finish.grain": [0, 0.1],
  "clip.dim": [0, 0.8],
} as const satisfies Record<string, readonly [number, number]>;
export type TrackId = keyof typeof TRACK_LIMITS;
export const TRACK_IDS = Object.keys(TRACK_LIMITS) as TrackId[];

const CURVE_NAMES = Object.keys(CURVES) as [CurveName, ...CurveName[]];

/** Whether warp keys run from [0, 0] to [1, 1] with u rising and p never falling. */
export function validWarpKeys(k: readonly (readonly [number, number])[]): boolean {
  if (k.length < 2) return false;
  const a = k[0];
  const b = k[k.length - 1];
  return a[0] === 0 && a[1] === 0 && b[0] === 1 && b[1] === 1 && k.every((x, i) => i === 0 || (x[0] > k[i - 1][0] && x[1] >= k[i - 1][1]));
}

/** A motion group's timing: its warp keys [u, p] and its rate. */
export const GroupTimingSchema = z.object({
  keys: z
    .array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]))
    .min(2)
    .max(8)
    .refine(validWarpKeys, "Keys from [0, 0] to [1, 1], rising"),
  rate: z.number().min(0.5).max(2),
});
export type GroupTiming = z.infer<typeof GroupTimingSchema>;

export const TrackSchema = z.object({
  keys: z
    .array(z.object({ t: z.number().min(0).max(60), v: z.number().finite(), ease: z.enum(CURVE_NAMES).optional() }))
    .min(1)
    .max(16)
    .refine((k) => k.every((x, i) => i === 0 || x.t > k[i - 1].t), "Keys in time order"),
  rate: z.number().min(0.5).max(2),
});
export type Track = z.infer<typeof TrackSchema>;

const GroupId = z.string().regex(/^[a-z0-9-]+$/).max(32);
const TrackIdSchema = z.enum(TRACK_IDS as [TrackId, ...TrackId[]]);

export const RecipeSchema = z.object({
  v: z.literal(1),
  scene: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/).max(80),
  seed: z.number().int().min(0).max(2 ** 31 - 1),
  /** A preset, or a custom size held to the export sheet's rule (even sides of 256 to 2160, at most 2.4 million pixels). */
  size: z.union([
    z.enum(["9:16", "1:1", "16:9", "4:5"]),
    z.object({ w: z.number().int(), h: z.number().int() }).refine((s) => customSizeProblem(s.w, s.h) === null, { message: "The size" }),
  ]),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]),
  duration: z.number().min(0.5).max(60),
  /** The typed words, by field (headline, sub, cta, website, badge…), exactly as typed. */
  fields: z.record(z.string().max(40), z.string().max(600)),
  brand: z.object({
    name: z.string().max(120),
    colors: z.array(Hex).max(8),
    fonts: z.object({ heading: z.string().max(80).optional(), body: z.string().max(80).optional() }),
    /** The logo's address (a stored file, or the kit's own link). */
    logo: z.string().max(500).optional(),
  }),
  media: z.object({ product: File.optional(), images: z.array(File).max(4).optional() }).optional(),
  controls: z.record(z.string().max(40), z.union([z.string().max(80), z.number(), z.boolean()])).optional(),
  export: z.object({
    format: z.enum(["mp4", "webm"]),
    bitrate: z.number().int().min(500_000).max(40_000_000).optional(),
    blurSamples: z.number().int().min(1).max(32),
    shutter: z.number().min(0).max(360),
    /** How it was encoded: frame-exact WebCodecs, or the real-time recorder (may drop a frame). */
    encoder: z.enum(["webcodecs", "recorder"]).optional(),
    /** High: x1.6 the bitrate, always under the size cap. */
    quality: z.enum(["standard", "high"]).optional(),
  }),
  /** The motion's feel (a curve set) and its pace (over the Easy Pace choice; above 1 is calmer). */
  motion: z.object({ curves: z.enum(CURVE_SET_IDS).optional(), pace: z.number().min(0.7).max(1.4).optional() }).optional(),
  /** A grade and grain over the finished frame. */
  finish: z
    .object({ contrast: z.number().min(-0.5).max(0.5).optional(), saturation: z.number().min(-1).max(1).optional(), grain: z.number().min(0).max(0.1).optional(), grainSize: z.number().min(1).max(3).optional() })
    .optional(),
  /** An extra camera on top of the scene's own. */
  camera: z.object({ move: z.enum(CAMERA_MOVES).optional(), amount: z.number().min(0).max(2).optional(), breath: z.number().min(0).max(2).optional() }).optional(),
  look: z.object({ light: z.boolean().optional() }).optional(),
  /** Motion groups retimed: a warp and a rate per group. */
  groups: z
    .record(GroupId, GroupTimingSchema)
    .refine((g) => Object.keys(g).length <= 12, "At most 12 groups")
    .optional(),
  /** Parameter tracks on the numbers the scene wrappers own. */
  tracks: z
    .partialRecord(TrackIdSchema, TrackSchema)
    .superRefine((tr, ctx) => {
      for (const [id, t] of Object.entries(tr) as [TrackId, Track | undefined][]) {
        if (!t) continue;
        const [lo, hi] = TRACK_LIMITS[id];
        if (t.keys.some((k) => k.v < lo - 1e-9 || k.v > hi + 1e-9)) ctx.addIssue({ code: "custom", path: [id], message: "A value out of range" });
      }
    })
    .optional(),
  /** Layers under the scene: the person's own clip. */
  layers: z
    .object({
      video: z.object({ src: Clip, from: z.number().min(0).max(600), fit: z.enum(["cover", "contain"]), dim: z.number().min(0).max(0.8), scrim: z.enum(["none", "bottom", "top", "full"]) }).optional(),
    })
    .optional(),
});

export type Recipe = z.infer<typeof RecipeSchema>;
export type VideoLayer = NonNullable<NonNullable<Recipe["layers"]>["video"]>;

export const DEFAULT_EXPORT: Recipe["export"] = { format: "mp4", blurSamples: 8, shutter: 180 };

/** What a scene takes, for normalizeRecipe to drop the rest (kinetic-catalog.ts gives it per scene). */
export interface RecipeScope {
  /** Whether the scene takes a clip under its words. */
  clip: boolean;
  /** Its motion group ids (camera groups included). */
  groups: readonly string[];
}

/**
 * A recipe checked and held to its scene's length limits; throws on a bad one. With a scope it also drops what the scene
 * doesn't take (a clip, unknown group ids, the clip's dim track without a clip), never failing for them, so an old
 * saved recipe still opens after a scene changes.
 */
export function normalizeRecipe(input: unknown, limits?: { min: number; max: number }, scope?: RecipeScope): Recipe {
  const r = RecipeSchema.parse(input);
  if (JSON.stringify(r).length > RECIPE_MAX_BYTES) throw new Error("This recipe is too big");
  const duration = limits ? Math.min(limits.max, Math.max(limits.min, r.duration)) : r.duration;
  const out: Recipe = { ...r, duration };
  if (!scope) return out;
  if (out.layers?.video && !scope.clip) {
    const rest = { ...out.layers };
    delete rest.video;
    if (Object.keys(rest).length) out.layers = rest;
    else delete out.layers;
  }
  if (out.groups) {
    const keep = Object.entries(out.groups).filter(([id]) => scope.groups.includes(id));
    if (keep.length) out.groups = Object.fromEntries(keep);
    else delete out.groups;
  }
  if (out.tracks?.["clip.dim"] && !out.layers?.video) {
    const rest = { ...out.tracks };
    delete rest["clip.dim"];
    if (Object.keys(rest).length) out.tracks = rest;
    else delete out.tracks;
  }
  return out;
}

/** JSON with keys in a fixed order, so equal recipes write the same text. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** A short key for one look (equal recipes, equal keys): the page saves a look once per visit by it. */
export function recipeKey(r: Recipe | Record<string, unknown>): string {
  const text = stableJson(r);
  const a = rng(0x51f15e, text);
  const b = rng(0x2c1b3c6d, text);
  return `${Math.floor(a * 2 ** 32).toString(16).padStart(8, "0")}${Math.floor(b * 2 ** 32).toString(16).padStart(8, "0")}`;
}
