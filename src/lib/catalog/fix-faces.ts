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
