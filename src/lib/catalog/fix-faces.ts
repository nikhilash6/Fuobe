import type { GenerationRequest } from "./types";

/**
 * Fix Faces: a video's soft or smeared faces redrawn sharp, matched to a photo of the person (or the clip's own clearest
 * face, picked in the browser: src/lib/fix-faces/face-frame.ts). It runs Genjutsu's Finish with its Fix faces tool,
 * the same graph and steps (the part fitted, then the faces redrawn and pasted back), and its result is listed with
 * the app's runs.
 */
export const FIX_FACES = {
  appId: "app-fix-faces",
  feature: "app:app-fix-faces",
  model: "oss-h3-fix-faces",
  /** The longest part one run fixes, in seconds: Fix faces' own limit (OPENJUTSU_LIMITS.facesMaxSeconds; tested to match). */
  maxSeconds: 10,
} as const;

export type FixFacesStyle = "mouth" | "photo";

/** The two ways to redraw, the default first (Genjutsu's names). */
export const FIX_FACES_STYLES: readonly { value: FixFacesStyle; label: string; hint: string }[] = [
  { value: "mouth", label: "Follow the mouth", hint: "Lips and expressions keep moving with the clip, so speech and singing stay in sync" },
  { value: "photo", label: "Match the photo", hint: "Each face is drawn fresh from the photo: best for clips without speech" },
];

/** The before and after example: a dance whose faces came out soft, and the same dance fixed. */
export const FIX_FACES_DEMO = {
  video: "/samples/fix-faces/dance-compare.mp4?v=f916176a",
  poster: "/samples/fix-faces/dance-compare.jpg?v=f3a4b3cb",
  /** The example to try: the dance as it was made, its faces soft. */
  clip: "/samples/fix-faces/dance-before.mp4?v=a6fab2f7",
} as const;

export type FixFacesClip = { url: string; name?: string; duration?: number; width?: number; height?: number };

/**
 * Fix Faces with a finished video in, and the picture it was made from as the face when it had one (an H3 video from a
 * start picture: the face the video was meant to have).
 */
export function fixFacesHref(video: string, photo?: string): string {
  const q = encodeURIComponent;
  return `/apps/${FIX_FACES.appId}?video=${q(video)}${photo ? `&photo=${q(photo)}` : ""}`;
}

/** The part of the clip one run fixes: from the start, at most maxSeconds. */
export function fixFacesRange(duration: number | undefined): { start: number; end: number } | undefined {
  if (!duration || !Number.isFinite(duration) || duration <= 0) return undefined;
  return { start: 0, end: Math.round(Math.min(duration, FIX_FACES.maxSeconds) * 1000) / 1000 };
}

/** The body of POST /api/genjutsu for one Fix Faces run. */
export function fixFacesBody(o: { clip: FixFacesClip; photo: string; style: FixFacesStyle; requestId?: string }) {
  const range = fixFacesRange(o.clip.duration);
  return {
    engine: "open" as const,
    mode: "finish" as const,
    modelId: FIX_FACES.model,
    source: {
      url: o.clip.url,
      ...(o.clip.name && { name: o.clip.name.slice(0, 200) }),
      ...(o.clip.duration && { duration: o.clip.duration }),
      ...(o.clip.width && o.clip.height && { width: o.clip.width, height: o.clip.height }),
    },
    ...(range && { range }),
    references: [o.photo],
    finish: { tool: "faces" as const, faceStyle: o.style },
    app: FIX_FACES.appId,
    ...(o.requestId && { requestId: o.requestId }),
  };
}

// ---------------------------------------------------------------------------
// Fix faces after a MiniMax H3 video (an opt-in switch beside Run): the clip, then its faces fixed from its start picture.

/** The switch's flag on the H3 request (params.extra). */
export const FIX_FACES_AFTER_PARAM = "fixFacesAfter";
/** The H3 models it follows: the full model and its fast and flash versions, on your GPU or the site's. */
const H3_MODELS = new Set(["oss-minimax-h3", "oss-minimax-h3-fast", "oss-minimax-h3-flash"]);

/** Whether the switch is offered: an H3 video from a start picture, no longer than one Fix faces run. */
export function fixFacesAfterOffered(modelId: string | undefined, op: string | undefined, seconds: number | undefined, hasStart: boolean): boolean {
  return !!modelId && H3_MODELS.has(modelId) && op === "i2v" && hasStart && !(seconds && seconds > FIX_FACES.maxSeconds);
}

/** Whether a request asks for it, and may have it. */
export function wantsFixFacesAfter(req: Pick<GenerationRequest, "modelId" | "op" | "params" | "inputs">): boolean {
  return req.params?.extra?.[FIX_FACES_AFTER_PARAM] === true && fixFacesAfterOffered(req.modelId, req.op ?? "i2v", req.params?.duration, !!req.inputs?.images?.[0]);
}

/**
 * The step after the clip: Fix faces on it, its start picture as the face, in Genjutsu's default style (Follow the mouth),
 * labelled as the run's second step. `chain` puts the clip in once it is made.
 */
export function fixFacesAfterStep(req: GenerationRequest): GenerationRequest {
  const seed = req.params?.seed;
  return {
    feature: req.feature,
    ...(req.title && { title: req.title }),
    ...(req.batchTitle && { batchTitle: req.batchTitle }),
    ...(req.demo && { demo: true }),
    engine: "open",
    modelId: FIX_FACES.model,
    op: "face-fix-video",
    prompt: "",
    inputs: { images: [req.inputs!.images![0]] },
    params: { extra: { openjutsu: { faceStyle: "mouth", chunkSeconds: 6.5, ...(seed !== undefined && { seed }) } } },
    chain: [{ slot: "video" }],
    step: { label: "Fix faces", index: 1, of: 2 },
  } as GenerationRequest;
}
