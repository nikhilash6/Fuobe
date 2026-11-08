/**
 * Finishing jobs (docs/gpu-workers.md, "The CPU slot"): CPU work that follows a run on this install's GPUs and runs on
 * the worker that has a CPU slot, never on the studio's server. Two kinds:
 *
 * - "model3d": an image-to-3D model's finish. The worker checks the GLB (a self-contained binary glTF only: no buffer or
 *   picture that names another file), writes the web GLB, and renders a turntable clip and its poster.
 * - "path": a camera path drawn through a still and its depth picture (the guide of a camera move), as an MP4.
 * - "preview3d": the preview of any finished 3D result (a GLB mesh or a Gaussian splat): a turntable clip that loops and
 *   a still from its first frame, each on a light and a dark studio backdrop, drawn on the CPU with no browser
 *   (scripts/model3d/render-preview.mjs).
 *
 * A finish ticket names its kind, its typed settings and its input files (slot, name, SHA-256). The worker runs it with
 * its own code (bin/lib/worker/finish.mjs) and sends back only the files its kind makes (FINISH_FILES). Both sides check
 * a ticket the same way (finishProblem).
 *
 * Pure: the server, the worker program and the tests share it.
 */
import { INPUT_NAME } from "./relay";

export const FINISH_VERSION = 1;

export const FINISH_KINDS = ["model3d", "path", "preview3d"] as const;
export type FinishKind = (typeof FINISH_KINDS)[number];

/** The 3D files a preview is drawn from. */
export const PREVIEW_FORMATS = ["glb", "spz", "ply"] as const;
export type PreviewFormat = (typeof PREVIEW_FORMATS)[number];

/** The materials the GLB finish knows (scripts/model3d/finish-glb.mjs --material). */
export const FINISH_MATERIALS = ["auto", "matte", "metal", "mixed"] as const;

/** One key of a camera path (src/lib/camera-path.ts CameraKey). */
export interface FinishPathKey {
  t: number;
  azimuth: number;
  elevation: number;
  distance: number;
  truck?: number;
}

export interface FinishTicket {
  v: typeof FINISH_VERSION;
  kind: FinishKind;
  /** model3d: { material, turntable }; path: { keys, frames, fps }; preview3d: { format, yDown, frontYaw, cutoff }. */
  settings: Record<string, unknown>;
  /** model3d and preview3d: one "model" (the raw GLB, or the splat); path: a "photo" and its "depth" picture. */
  inputs: { slot: string; name: string; sha256: string }[];
}

/** The input slots each kind takes, in order. */
export const FINISH_SLOTS: Record<FinishKind, readonly string[]> = { model3d: ["model"], path: ["photo", "depth"], preview3d: ["model"] };

/**
 * The files each kind may send back, by role: their kind on the server and the most each may weigh. The worker names
 * its results by these roles; any other file is never asked for.
 */
export const FINISH_FILES: Record<FinishKind, Record<string, { kind: "model3d" | "video" | "image"; maxBytes: number }>> = {
  model3d: {
    web: { kind: "model3d", maxBytes: 300 * 2 ** 20 },
    turntable: { kind: "video", maxBytes: 256 * 2 ** 20 },
    poster: { kind: "image", maxBytes: 16 * 2 ** 20 },
  },
  path: { path: { kind: "video", maxBytes: 512 * 2 ** 20 } },
  preview3d: {
    posterLight: { kind: "image", maxBytes: 4 * 2 ** 20 },
    posterDark: { kind: "image", maxBytes: 4 * 2 ** 20 },
    clipLight: { kind: "video", maxBytes: 32 * 2 ** 20 },
    clipDark: { kind: "video", maxBytes: 32 * 2 ** 20 },
    webmLight: { kind: "video", maxBytes: 32 * 2 ** 20 },
    webmDark: { kind: "video", maxBytes: 32 * 2 ** 20 },
  },
};

/** A preview's files by role, as scripts/model3d/render-preview.mjs names them in its folder. */
export const PREVIEW_FILES: Record<string, { file: string; contentType: string }> = {
  posterLight: { file: "poster-light.webp", contentType: "image/webp" },
  posterDark: { file: "poster-dark.webp", contentType: "image/webp" },
  clipLight: { file: "turntable-light.mp4", contentType: "video/mp4" },
  clipDark: { file: "turntable-dark.mp4", contentType: "video/mp4" },
  webmLight: { file: "turntable-light.webm", contentType: "video/webm" },
  webmDark: { file: "turntable-dark.webm", contentType: "video/webm" },
};

/** The largest 3D file a preview is drawn from: a bigger one keeps its other stills (the photo it was made from). */
export const PREVIEW_MAX_BYTES = 200 * 2 ** 20;

/** A path's frames and frame rate: at most this many, and this fast. */
export const PATH_LIMITS = { maxFrames: 241, maxFps: 60, maxKeys: 64 };

/**
 * The longest a finish runs on a worker whose claim names no run limit. The studio's claim names one: its lane's run
 * ceiling (queue-settings.ts, the owner's to set).
 */
export const FINISH_RUN_MS = 20 * 60_000;

const SHA = /^[0-9a-f]{64}$/;
const finite = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

/**
 * Why a finish ticket can't be used, or null. `inputs`: the files the task sends (name and SHA-256): every input the
 * ticket names must be one of them, by name and SHA-256.
 */
export function finishProblem(t: unknown, o: { inputs?: { name: string; sha256: string }[] } = {}): string | null {
  if (!t || typeof t !== "object" || Array.isArray(t)) return "not a finish ticket";
  const k = t as Record<string, unknown>;
  if (Object.keys(k).some((x) => !["v", "kind", "settings", "inputs"].includes(x))) return "a finish ticket has an unknown field";
  if (k.v !== FINISH_VERSION) return "another version of finish ticket";
  if (!(FINISH_KINDS as readonly string[]).includes(String(k.kind))) return "no such finish";
  const kind = k.kind as FinishKind;
  const s = k.settings;
  if (!s || typeof s !== "object" || Array.isArray(s)) return "settings missing";
  const set = s as Record<string, unknown>;
  if (kind === "model3d") {
    if (Object.keys(set).some((x) => x !== "material" && x !== "turntable")) return "a setting isn't one";
    if (!(FINISH_MATERIALS as readonly string[]).includes(String(set.material))) return "material isn't one";
    if (typeof set.turntable !== "boolean") return "turntable isn't a yes or no";
  } else if (kind === "preview3d") {
    if (Object.keys(set).some((x) => !["format", "yDown", "frontYaw", "cutoff"].includes(x))) return "a setting isn't one";
    if (!(PREVIEW_FORMATS as readonly string[]).includes(String(set.format))) return "format isn't one";
    if (typeof set.yDown !== "boolean") return "yDown isn't a yes or no";
    if (!Number.isInteger(set.frontYaw) || !finite(set.frontYaw, -360, 360)) return "frontYaw out of range";
    if (!finite(set.cutoff, 0, 0.5)) return "cutoff out of range";
  } else {
    if (Object.keys(set).some((x) => !["keys", "frames", "fps"].includes(x))) return "a setting isn't one";
    if (!Number.isInteger(set.frames) || !finite(set.frames, 2, PATH_LIMITS.maxFrames)) return "frames out of range";
    if (!Number.isInteger(set.fps) || !finite(set.fps, 1, PATH_LIMITS.maxFps)) return "fps out of range";
    const keys = set.keys;
    if (!Array.isArray(keys) || keys.length > PATH_LIMITS.maxKeys) return "keys out of range";
    for (const key of keys) {
      if (!key || typeof key !== "object" || Array.isArray(key)) return "a key isn't one";
      const x = key as Record<string, unknown>;
      if (Object.keys(x).some((f) => !["t", "azimuth", "elevation", "distance", "truck"].includes(f))) return "a key has an unknown field";
      if (!finite(x.t, 0, 1) || !finite(x.azimuth, -3600, 3600) || !finite(x.elevation, -90, 90) || !finite(x.distance, 0.05, 20)) return "a key is out of range";
      if (x.truck !== undefined && !finite(x.truck, -20, 20)) return "a key is out of range";
    }
  }
  const inputs = k.inputs;
  const slots = FINISH_SLOTS[kind];
  if (!Array.isArray(inputs) || inputs.length !== slots.length) return "inputs don't fit the finish";
  for (const [i, raw] of inputs.entries()) {
    if (!raw || typeof raw !== "object") return "an input isn't one";
    const x = raw as Record<string, unknown>;
    if (Object.keys(x).some((f) => !["slot", "name", "sha256"].includes(f))) return "an input has an unknown field";
    if (x.slot !== slots[i]) return "an input is in the wrong slot";
    if (typeof x.name !== "string" || !INPUT_NAME.test(x.name)) return "an input's name isn't one";
    if (typeof x.sha256 !== "string" || !SHA.test(x.sha256)) return "an input has no SHA-256";
    if (o.inputs && !o.inputs.some((y) => y.name === x.name && y.sha256 === x.sha256)) return "an input isn't one the job sends";
  }
  return null;
}

/** A finished finish job's result file, as the worker names it in its report (role: one of FINISH_FILES for its kind). */
export interface FinishResult {
  filename: string;
  subfolder: string;
  type: "output";
  role: string;
}

/** What a model finish measured (scripts/model3d/finish-glb.mjs's JSON line), as far as each is a number or a word. */
export interface FinishStats {
  material?: string;
  triangles?: number;
  bytesIn?: number;
  bytesOut?: number;
}

/**
 * The finish's own history entry, as the worker reports it in place of ComfyUI's: its results by role, the model's
 * stats, and the turntable's state ("done", or "skipped: …" when the worker has no browser or ffmpeg for it).
 */
export function finishEntry(results: FinishResult[], extra: { stats?: FinishStats; turntable?: string } = {}) {
  return { status: { status_str: "success", completed: true }, outputs: { finish: { results, ...(extra.stats && { stats: [extra.stats] }), ...(extra.turntable && { turntable: [extra.turntable] }) } } };
}
