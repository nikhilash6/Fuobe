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
  /** The graph's look: SAM3DBody_Render's style, mesh shader and opacity over the picture (params.extra). */
  extra: { renderStyle: "mesh" | "scail"; shader: "normals" | "default" | "rainbow" | "depth"; opacity: number };
};

/** The looks, the default first. Holo is the surface normals, so the body reads as a sculpted, iridescent shell. */
export const BODY_LOOKS: readonly BodyLook[] = [
  { value: "holo", label: "Holo", hint: "An iridescent body shell", extra: { renderStyle: "mesh", shader: "normals", opacity: 0.92 } },
  { value: "clay", label: "Clay", hint: "A matte sculpt, like a fitting mannequin", extra: { renderStyle: "mesh", shader: "default", opacity: 1 } },
  { value: "thermal", label: "Thermal", hint: "A heat-map gradient from head to toe", extra: { renderStyle: "mesh", shader: "rainbow", opacity: 0.9 } },
  { value: "ghost", label: "Ghost", hint: "A see-through body over the picture", extra: { renderStyle: "mesh", shader: "default", opacity: 0.5 } },
  { value: "xray", label: "X-ray", hint: "Depth shading, near is bright", extra: { renderStyle: "mesh", shader: "depth", opacity: 0.95 } },
  { value: "skeleton", label: "Skeleton", hint: "The SCAIL skeleton over the picture", extra: { renderStyle: "scail", shader: "normals", opacity: 1 } },
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
