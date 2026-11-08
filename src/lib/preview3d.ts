import type { OutputFile } from "@/lib/catalog/types";
import type { PreviewFormat } from "@/lib/finish-ticket";

/**
 * A 3D result's preview (src/server/model3d-preview.ts), as its model output keeps it in meta.preview3d: a still and a
 * turntable clip (one turn that loops), each on a light and a dark studio backdrop, so tiles never load the 3D file.
 */
export interface Preview3d {
  state: "queued" | "drawing" | "done" | "failed";
  /** When it last changed. */
  at: number;
  tries?: number;
  /** queued / drawing: on a worker's CPU slot (its job's step) or on this server. */
  where?: "worker" | "here";
  step?: number;
  /** failed: a word for the server's own retries. */
  why?: string;
  poster?: { light: string; dark: string };
  clip?: { light: string; dark: string };
  /** AV1 copies of the clips, when the encoder had them. */
  webm?: { light: string; dark: string };
  seconds?: number;
  /** The files it kept (removed with the run). */
  assets?: string[];
}

export type ReadyPreview3d = Preview3d & {
  state: "done";
  poster: { light: string; dark: string };
  clip: { light: string; dark: string };
};

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const pair = (v: unknown): v is { light: string; dark: string } =>
  !!v && typeof v === "object" && str((v as { light?: unknown }).light) && str((v as { dark?: unknown }).dark);

/** A model output's finished preview, or null (none yet, or one that couldn't be made). */
export function preview3dOf(o: Pick<OutputFile, "kind" | "meta"> | undefined): ReadyPreview3d | null {
  const p = o?.kind === "model3d" ? (o.meta?.preview3d as Preview3d | undefined) : undefined;
  if (!p || p.state !== "done" || !pair(p.poster) || !pair(p.clip)) return null;
  return {
    ...p,
    state: "done",
    poster: p.poster,
    clip: p.clip,
    ...(pair(p.webm) ? { webm: p.webm } : { webm: undefined }),
  };
}

/** Whether a model output's preview is still being made (a tile shows its other stills meanwhile). */
export function preview3dComing(o: Pick<OutputFile, "kind" | "meta"> | undefined): boolean {
  const p = o?.kind === "model3d" ? (o.meta?.preview3d as Preview3d | undefined) : undefined;
  return p?.state === "queued" || p?.state === "drawing";
}

/** The 3D file a preview can be drawn from: a binary glTF, or a Gaussian splat as .spz or .ply; null for any other. */
export function previewFormatOf(o: Pick<OutputFile, "url" | "kind" | "contentType" | "meta">): PreviewFormat | null {
  if (o.kind !== "model3d") return null;
  const declared = typeof o.meta?.format === "string" ? o.meta.format.toLowerCase() : "";
  const ext = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(o.url.split("/").pop() ?? "")?.[1]?.toLowerCase() ?? "";
  const ct = (o.contentType ?? "").toLowerCase();
  if (declared === "spz" || ext === "spz" || ct.includes("spz")) return "spz";
  if (declared === "ply" || ext === "ply") return "ply";
  if (ct === "model/gltf-binary" || ext === "glb" || declared === "glb") return "glb";
  return null;
}
