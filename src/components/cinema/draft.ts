import { DEFAULT_ASPECT, DURATION, type CinemaAction, type CinemaGenerateInput, type CinemaMode, type DirectorSettings, type GridSize, type GridType } from "@/lib/catalog/cinema";
import type { Engine, MediaKind } from "@/lib/catalog/types";
import { takesExact, type ExactOrbit } from "@/lib/exact-orbit";

/** The prompt bar's state (lifted into the workspace so the AI Director and tiles can fill it). */

/** A new move list: the Exact numbers belong to the first move, so a different first move starts from its own defaults. */
export function withMoves(d: Pick<CinemaDraft, "moves">, moves: string[]): Pick<CinemaDraft, "moves" | "exact"> | Pick<CinemaDraft, "moves"> {
  return moves[0] === d.moves[0] ? { moves } : { moves, exact: null };
}

export interface RefItem {
  id: string;
  /** /api/files URL once uploaded ("" while uploading). */
  ref: string;
  preview: string;
  kind: MediaKind;
  name?: string;
  uploading?: boolean;
  /** Seconds, for video/audio (measured in the browser). */
  duration?: number;
}

export type BarAction = Extract<CinemaAction, "generate" | "extend-forward" | "extend-backward" | "edit">;

export interface TakeSource {
  generationId: string;
  url: string;
  kind: "image" | "video";
  label: string;
  /** What is known about the take (TakeFacts): its model, scene, size and, once the browser has read it, its length. */
  modelId?: string;
  prompt?: string;
  seconds?: number;
  resolution?: string;
  aspectRatio?: string;
}

export interface CinemaDraft {
  mode: CinemaMode;
  imageTool: "still" | "grid";
  prompt: string;
  moves: string[];
  /** The first move as an exact orbit: its numbers while the Exact switch is on. */
  exact?: ExactOrbit | null;
  refs: RefItem[];
  /** Model picked per mode and engine ("video:cloud" → "kling-3"). */
  models: Partial<Record<`${CinemaMode}:${Engine}`, string>>;
  duration: number;
  resolution: Record<CinemaMode, string>;
  aspect: Record<CinemaMode, string>;
  batch: number;
  audio: boolean;
  multiShot: { mode: "off" | "auto" | "manual"; shots: { prompt: string; duration: number }[] };
  grid: { size: GridSize; type: GridType };
  action: BarAction;
  source: TakeSource | null;
}

export const initialDraft = (): CinemaDraft => ({
  mode: "video",
  imageTool: "still",
  prompt: "",
  moves: [],
  refs: [],
  models: {},
  duration: DURATION.default,
  resolution: { video: "720p", image: "1K" },
  aspect: { video: DEFAULT_ASPECT, image: DEFAULT_ASPECT },
  batch: 1,
  audio: true,
  multiShot: { mode: "off", shots: [] },
  grid: { size: "2x2", type: "freeform" },
  action: "generate",
  source: null,
});

/** The selected take as the planner reads it: its file, and the facts the browser has about it. */
function takeFacts(t: TakeSource, firstFrame?: string): NonNullable<CinemaGenerateInput["source"]> {
  return {
    url: t.url,
    kind: t.kind,
    ...(firstFrame ? { firstFrame } : {}),
    ...(t.modelId ? { modelId: t.modelId } : {}),
    ...(t.prompt?.trim() ? { prompt: t.prompt.trim().slice(0, 4000) } : {}),
    ...(t.seconds !== undefined && Number.isFinite(t.seconds) && t.seconds > 0 ? { seconds: Math.round(t.seconds * 100) / 100 } : {}),
    ...(t.resolution ? { resolution: t.resolution } : {}),
    ...(t.aspectRatio ? { aspectRatio: t.aspectRatio } : {}),
  };
}

/** The request body for /generate (and the input planCinema prices live). */
export function draftToInput(d: CinemaDraft, engine: Engine, settings: DirectorSettings, firstFrame?: string): Omit<CinemaGenerateInput, "brief"> {
  const ready = d.refs.filter((r) => r.ref && !r.uploading);
  const action = d.mode === "image" ? (d.imageTool === "grid" ? "grid" : "generate") : d.source?.kind === "video" ? d.action : "generate";
  return {
    engine,
    mode: d.mode,
    action,
    modelId: d.models[`${d.mode}:${engine}`],
    prompt: d.prompt,
    moves: d.mode === "video" ? d.moves : undefined,
    ...(d.mode === "video" && d.exact && takesExact(d.moves[0]) && { exact: d.exact }),
    settings,
    images: ready.filter((r) => r.kind === "image").map((r) => r.ref),
    videos: ready.filter((r) => r.kind === "video").map((r) => r.ref),
    audios: ready.filter((r) => r.kind === "audio").map((r) => r.ref),
    duration: d.duration,
    resolution: d.resolution[d.mode],
    aspectRatio: d.aspect[d.mode],
    batch: d.batch,
    audio: d.audio,
    multiShot: d.mode === "video" && d.multiShot.mode !== "off" ? d.multiShot : undefined,
    source: d.source && action !== "generate" && action !== "grid" ? takeFacts(d.source, firstFrame) : undefined,
    grid: action === "grid" ? d.grid : undefined,
  };
}

/**
 * How many of the Director's Panel groups are set (film setup, camera, palette, lighting, emotions),
 * for the phone's folded "Director" chip. Tempo counts in video mode only, as the panel shows it.
 */
export function directorPicks(s: DirectorSettings, mode: CinemaMode): number {
  const film = !!(s.genre || s.era || (mode === "video" && s.tempo));
  const camera = !!(s.camera || s.lens || s.focal || s.aperture);
  const emotions = Object.keys(s.emotions ?? {}).length > 0;
  return [film, camera, !!s.palette, !!s.lighting, emotions].filter(Boolean).length;
}
