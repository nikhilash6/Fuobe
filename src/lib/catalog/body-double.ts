import type { GenerationRequest } from "./types";

/**
 * Body Double: every person's 3D body from a photo or a clip (InstantHMR on ComfyUI), or live from a camera in the
 * browser (src/components/body-double/live). The photo and clip runs return the body drawn over the input, a skinned GLB
 * (animated for a clip) and a SCAIL pose render.
 */
export const BODY_DOUBLE = {
  appId: "app-body-double",
  feature: "app:app-body-double",
  photoModel: "oss-body-double",
  clipModel: "oss-body-double-video",
  photoOp: "body-capture",
  clipOp: "body-capture-video",
  photoGraph: "body-double-photo-instanthmr",
  clipGraph: "body-double-clip-instanthmr",
  /** The longest clip a run takes, in seconds (the graph reads 24 fps, up to 360 frames). */
  maxClipSeconds: 15,
} as const;

/**
 * Each sample file's content version (the first 8 hex digits of its SHA-256), sent as ?v= so a replaced file reaches every
 * browser and cache at once. tests/body-double.test.ts checks them against the files.
 */
export const BODY_DOUBLE_SAMPLE_VERSIONS: Readonly<Record<string, string>> = {
  "photo-before.jpg": "56ca09c2",
  "photo-after.jpg": "294e3e56",
  "clip-demo.mp4": "b31f9dbb",
  "clip-demo.jpg": "ebb0e3da",
  "live-demo.mp4": "cf4d5064",
  "live-demo.jpg": "659e563b",
  "sample-dance.mp4": "227afd20",
  "sample-runway.mp4": "037d4010",
  "looks/clay.jpg": "888d7861",
  "looks/ghost.jpg": "384abfcf",
  "looks/holo.jpg": "0b529b89",
  "looks/skeleton.jpg": "acad3f42",
  "looks/thermal.jpg": "77c5d4cb",
  "looks/xray.jpg": "46012531",
};

/** A Body Double sample's URL, with its version. */
export const bodyDoubleSample = (file: string): string => {
  const v = BODY_DOUBLE_SAMPLE_VERSIONS[file];
  return v ? `/samples/body-double/${file}?v=${v}` : `/samples/body-double/${file}`;
};

/** Finished examples shown on the app's page, each made the way a run makes it: a group photo before and after, a motion capture, and a Live session recorded in the browser. */
export const BODY_DOUBLE_DEMOS = {
  photo: { before: bodyDoubleSample("photo-before.jpg"), after: bodyDoubleSample("photo-after.jpg") },
  clip: { video: bodyDoubleSample("clip-demo.mp4"), poster: bodyDoubleSample("clip-demo.jpg") },
  live: { video: bodyDoubleSample("live-demo.mp4"), poster: bodyDoubleSample("live-demo.jpg") },
} as const;

export type BodyLookId = "holo" | "clay" | "thermal" | "ghost" | "xray" | "skeleton";

export type BodyLook = {
  value: BodyLookId;
  label: string;
  hint: string;
  /** The graph's look (params.extra.look): how the double is drawn over each person's whole outline. */
  extra: { look: BodyLookId };
};

/** The looks, the default first. Each covers the whole person, clothes and hair included, from the picture's own geometry. */
export const BODY_LOOKS: readonly BodyLook[] = [
  { value: "holo", label: "Holo", hint: "An iridescent sculpt of each person", extra: { look: "holo" } },
  { value: "clay", label: "Clay", hint: "A matte sculpture, clothes and hair included", extra: { look: "clay" } },
  { value: "thermal", label: "Thermal", hint: "A heat camera: warmest where they face you", extra: { look: "thermal" } },
  { value: "ghost", label: "Ghost", hint: "A see-through double over the picture", extra: { look: "ghost" } },
  { value: "xray", label: "X-ray", hint: "Cyan glass with glowing outlines", extra: { look: "xray" } },
  { value: "skeleton", label: "Skeleton", hint: "The 3D skeleton over the picture", extra: { look: "skeleton" } },
];

export const bodyLook = (value: unknown): BodyLook => BODY_LOOKS.find((l) => l.value === value) ?? BODY_LOOKS[0];

/** A photo or a clip, in the look picked. */
export function bodyDoubleRequest(o: { kind: "image" | "video"; ref: string; look?: BodyLookId }): GenerationRequest {
  const look = bodyLook(o.look);
  const clip = o.kind === "video";
  return {
    feature: BODY_DOUBLE.feature,
    presetId: BODY_DOUBLE.appId,
    modelId: clip ? BODY_DOUBLE.clipModel : BODY_DOUBLE.photoModel,
    op: clip ? BODY_DOUBLE.clipOp : BODY_DOUBLE.photoOp,
    engine: "open",
    inputs: clip ? { video: o.ref } : { images: [o.ref] },
    presetOptions: { look: look.value },
    params: { extra: { ...look.extra } },
  };
}
