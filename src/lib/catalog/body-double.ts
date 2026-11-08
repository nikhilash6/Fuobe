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
