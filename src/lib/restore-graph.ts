/**
 * Restore & colourise on your GPU (package archive-restore): what one run of the video-restore-ltx25-tiled graph does,
 * from the request (src/lib/catalog/restore.ts plans the windows), and the graph's optional branches taken out when a run
 * doesn't use them: the prefix hand-off (the first window), the reference picture, deinterlacing. Pure: the ComfyUI
 * provider calls it, the tests check it.
 */
import { cloneWorkflow, dropUnused, type ComfyWorkflow } from "./comfy";
import { loraEntry, loraRef } from "./catalog/loras";
import { RESTORE, refineCanvas, restoreCanvas, sourceFrames } from "./catalog/restore";
import type { LoraRef } from "./catalog/types";

export type RestoreStage = "restore" | "refine";

/** What the clip's header says (the provider's media facts). */
export interface ClipFacts {
  width?: number;
  height?: number;
  fps?: number;
  frames?: number;
  duration?: number;
}

export interface RestoreJob {
  /** Values for the graph's bindings (beside prompt, negativePrompt, seed, video, video2, image). */
  values: Record<string, string | number | boolean>;
  /** The branches this run keeps. */
  prefix: boolean;
  reference: boolean;
  deinterlace: boolean;
  stage: RestoreStage;
}

const int = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Math.round(Number(v)) : undefined);
const r32 = (n: number) => Math.max(32, Math.round(n / 32) * 32);

/** The extra keys a restore run reads (the provider takes them out of params.extra once used). */
export const RESTORE_EXTRA_KEYS = ["stage", "windowStart", "windowFrames", "prefixFrames", "prefixFrom", "canvasWidth", "canvasHeight", "deinterlace"] as const;

/**
 * One run of the graph:
 * - a window of the restore pipeline (params.extra.windowStart / windowFrames / canvas…, set by planRestore), with the
 *   window before's output as videos[0] for the prefix;
 * - or a whole clip on its own (Canvas, the API, Assist): up to 97 frames in one pass, longer clips with the sampler's own
 *   97-frame streaming windows (the card's other long-clip path), up to RESTORE.singleFrames.
 * Stage "refine" is the Detail Refine pass: its LoRA, 1024x576 tiles, a canvas twice the clip's.
 * Throws a sentence the user can act on.
 */
export function restoreJob(o: { extra: Record<string, unknown>; clip?: ClipFacts; fps?: number; prefixVideo?: string; reference?: string }): RestoreJob {
  const { extra, clip } = o;
  const stage: RestoreStage = extra.stage === "refine" ? "refine" : "restore";
  const fps = o.fps && o.fps > 0 ? o.fps : clip?.fps && clip.fps > 0 ? clip.fps : undefined;
  if (!fps) throw new Error("Couldn't read the clip's frame rate, so it can't be restored frame for frame. Re-save it as MP4 and try again");
  const planned = int(extra.windowFrames);
  let frames: number;
  let start = 0;
  let streaming = false;
  if (planned !== undefined) {
    if (planned < RESTORE.minFrames || planned > RESTORE.window || (planned - 1) % 8) throw new Error(`A restore window is 9 to 97 frames, 8n+1 (got ${planned})`);
    frames = planned;
    start = Math.max(0, int(extra.windowStart) ?? 0);
  } else {
    const total = sourceFrames({ frames: clip?.frames, duration: clip?.duration, fps });
    if (!total) throw new Error("Couldn't read how long the clip is. Re-save it as MP4 and try again");
    if (total > RESTORE.singleFrames) {
      throw new Error(
        `One pass restores up to ${Math.floor(RESTORE.singleFrames / fps)} s of this clip (${RESTORE.singleFrames} frames). Use Video tools → Restore & colourise: it runs longer clips in 97-frame windows that hand their colour on`,
      );
    }
    if (total < RESTORE.minFrames) throw new Error("The clip is too short to restore: it needs at least 9 frames");
    frames = 8 * Math.floor((total - 1) / 8) + 1;
    streaming = frames > RESTORE.window;
  }
  const reference = !!o.reference;
  if (reference && streaming) throw new Error("A reference picture works on one window (up to 4 s) at a time. Use Video tools → Restore & colourise for longer clips: it gives the picture to every window");
  // The canvas: the plan's, else the card's for the clip (stage 1) or twice the clip (stage 2: the clip is the restored one).
  let width = int(extra.canvasWidth);
  let height = int(extra.canvasHeight);
  if (!width || !height) {
    if (stage === "refine") {
      if (!clip?.width || !clip.height) throw new Error("Couldn't read the clip's size for the detail pass");
      ({ width, height } = refineCanvas({ width: r32(clip.width), height: r32(clip.height) }));
    } else ({ width, height } = restoreCanvas(clip?.width, clip?.height));
  }
  if (width % 32 || height % 32 || width > 3840 || height > 3840) throw new Error(`The canvas must be multiples of 32 up to 3840 px (got ${width}x${height})`);
  const deinterlace = stage === "restore" && extra.deinterlace === true;
  if (deinterlace && (!clip?.width || !clip.height)) throw new Error("Couldn't read the clip's size to deinterlace it");
  const prefixFrames = int(extra.prefixFrames) ?? 0;
  const prefix = prefixFrames > 0;
  if (prefix && prefixFrames !== RESTORE.prefix) throw new Error(`The hand-off prefix is ${RESTORE.prefix} frames`);
  if (prefix && !o.prefixVideo) throw new Error("This window continues from the one before, which hasn't finished");
  if (!prefix && o.prefixVideo && planned !== undefined) throw new Error("A first window takes no prefix");
  const prefixFrom = int(extra.prefixFrom);
  if (prefix && (prefixFrom === undefined || prefixFrom < 0)) throw new Error("The hand-off needs where the prefix starts in the window before");
  const tile = stage === "refine" ? RESTORE.refineTile : RESTORE.tile;
  const values: RestoreJob["values"] = {
    fps: Math.round(fps * 1000) / 1000,
    windowStart: start,
    windowFrames: frames,
    canvasWidth: width,
    canvasHeight: height,
    prefixFrames: prefix ? prefixFrames : 0,
    lora: stage === "refine" ? RESTORE.loras.refine.file : RESTORE.loras.restore.file,
    loraStrength: 1,
    tileWidth: tile.width,
    tileHeight: tile.height,
    streaming,
    tileFrames: streaming ? RESTORE.window : 0,
    cfg: 1,
  };
  if (prefix) values.prefixFrom = prefixFrom!;
  if (deinterlace) Object.assign(values, { fieldWidth: clip!.width!, fieldHeight: Math.max(2, Math.round(clip!.height! / 2)) });
  return { values, prefix, reference, deinterlace, stage };
}

/** Take a guide node out: whatever read its (positive, negative, latent) reads what it was given. */
function unguide(wf: ComfyWorkflow, id: string): void {
  const g = wf[id];
  if (!g) return;
  const by = [g.inputs.positive, g.inputs.negative, g.inputs.latent];
  for (const n of Object.values(wf)) {
    for (const [k, v] of Object.entries(n.inputs)) {
      if (Array.isArray(v) && v[0] === id && typeof v[1] === "number" && by[v[1]] !== undefined) n.inputs[k] = by[v[1]] as typeof v;
    }
  }
  delete wf[id];
}

/** The graph as this run uses it: the prefix, the reference and the deinterlace branches out when not used. */
export function restoreGraph(wf: ComfyWorkflow, job: Pick<RestoreJob, "prefix" | "reference" | "deinterlace">, outputs: string[]): ComfyWorkflow {
  const out = cloneWorkflow(wf);
  if (!job.prefix) unguide(out, "prefix");
  if (!job.reference) unguide(out, "reference_guide");
  if (!job.deinterlace && out.field) {
    const src = out.field.inputs.image;
    for (const n of Object.values(out)) for (const [k, v] of Object.entries(n.inputs)) if (Array.isArray(v) && v[0] === "field") n.inputs[k] = src;
    delete out.field;
  }
  return dropUnused(out, outputs);
}

/** The LoRA files the graph loads itself (so a run downloads the ones ComfyUI lacks first): Restore, or Detail Refine for stage 2. */
export function restoreGraphLoras(endpoint: string, extra: Record<string, unknown> | undefined): LoraRef[] {
  if (endpoint !== RESTORE.workflow) return [];
  const e = loraEntry(extra?.stage === "refine" ? RESTORE.loras.refine.key : RESTORE.loras.restore.key);
  return e ? [loraRef(e)] : [];
}
