"use client";

import { avcCodec, encodeMp4, encodeVp8, pathVideoType, recordWithMediaRecorder, vp8Supported } from "@/components/cinema/video-encode";
import { listTravel, type DisplayList } from "@/lib/motion/display";
import type { Measure } from "@/lib/motion/layout";
import type { Recipe } from "@/lib/motion/recipe";
import type { LogoInfo, Scene, ScenePlan } from "@/lib/motion/scene";
import { exportBitrate, exportSize } from "@/lib/motion/sizes";
import { frameCount } from "@/lib/motion/time";
import { drawDisplayList, type Sources } from "./draw";

/**
 * A Kinetic Motion clip rendered in the browser, frame-exact: frame i is the scene at t = i / fps, drawn at the export
 * size with motion blur (several moments inside the shutter, blended; never across a cut, and a held frame is drawn
 * once), then encoded with WebCodecs: H.264 into MP4, else VP8 into WebM where the caller allows it, else the real-time
 * recorder where it allows that. The result is a file to save to Fuobe (save.ts), never a download.
 */

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const SHORTEN_MESSAGE = "Shorten the words to fit, then render again.";
export const NO_ENCODER_MESSAGE = "This browser can't make this video. Try Chrome or Edge.";

export interface RenderOptions {
  sources: Sources;
  logo: LogoInfo | null;
  measure: Measure;
  signal?: AbortSignal;
  /** After each frame: how many are done, of how many, and the frame just drawn. */
  onProgress?: (done: number, total: number, frame: AnyCanvas) => void;
  /** The containers allowed, best first (default MP4, then WebM). */
  formats?: ("mp4" | "webm")[];
  /** Allow the real-time recorder when WebCodecs can't (it may drop a frame). */
  recorder?: boolean;
}

export interface RenderResult {
  blob: Blob;
  type: string;
  frames: number;
  /** A PNG of the frame everything rests on. */
  poster: Blob;
  width: number;
  height: number;
  encoder: "webcodecs" | "recorder";
}

function canvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  return Object.assign(document.createElement("canvas"), { width: w, height: h });
}

const ctx2d = (c: AnyCanvas) => c.getContext("2d", { alpha: false }) as Ctx;

export async function toPng(c: AnyCanvas): Promise<Blob> {
  if ("convertToBlob" in c) return c.convertToBlob({ type: "image/png" });
  return new Promise((resolve, reject) => (c as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't save the frame"))), "image/png"));
}

/** The moments blended into frame `t` (sub-frame times and weights), kept on t's side of every cut. */
export function shutterSamples(t: number, fps: number, samples: number, shutter: number, duration: number, cuts: number[]): { t: number; w: number }[] {
  if (samples <= 1 || shutter <= 0) return [{ t, w: 1 }];
  const open = shutter / 360 / fps;
  const out: { t: number; w: number }[] = [];
  for (let j = 0; j < samples; j++) {
    const u = j / (samples - 1);
    let s = t + (u - 0.5) * open;
    for (const c of cuts) {
      if (t < c && s >= c) s = c - 1e-6;
      if (t >= c && s < c) s = c;
    }
    s = Math.min(duration, Math.max(0, s));
    out.push({ t: s, w: 1 - Math.abs(2 * u - 1) * 0.75 });
  }
  return out;
}

/** The most motion-blur samples a frame takes (a very fast edge). */
export const MAX_BLUR_SAMPLES = 48;

/**
 * How many moments to blend into a frame whose fastest edge travels `travel` export pixels while the shutter is open:
 * one for a frame that barely moves, else enough that neighbouring moments sit about 2.5 px apart (never fewer than
 * the recipe asks for, never more than MAX_BLUR_SAMPLES), so a fast edge reads as a smooth smear, not steps.
 */
export function blurSamples(travel: number, base: number): number {
  if (base <= 1 || travel < 1) return 1;
  return Math.max(base, Math.min(MAX_BLUR_SAMPLES, Math.ceil(travel / 2.5) + 1));
}

/** Draws frame `t` of `plan` onto `target`, blending the shutter's moments through `scratch`. */
export function drawFrame(plan: ScenePlan, t: number, target: AnyCanvas, scratch: AnyCanvas, sources: Sources, o: { fps: number; samples: number; shutter: number; duration: number }): void {
  const tc = ctx2d(target);
  const half = o.shutter / 360 / o.fps / 2;
  if (o.samples <= 1 || (plan.still(t - half) && plan.still(t))) {
    drawDisplayList(tc, plan.evaluate(t), sources);
    return;
  }
  // As many moments as this frame's motion needs, measured across the open shutter.
  const ends = shutterSamples(t, o.fps, 2, o.shutter, o.duration, plan.cuts);
  const first = plan.evaluate(ends[0].t);
  const travel = listTravel(first, plan.evaluate(ends[1].t)) * (target.width / first.w);
  const samples = blurSamples(travel, o.samples);
  if (samples <= 1) {
    drawDisplayList(tc, plan.evaluate(t), sources);
    return;
  }
  const sc = ctx2d(scratch);
  let total = 0;
  for (const s of shutterSamples(t, o.fps, samples, o.shutter, o.duration, plan.cuts)) {
    const list: DisplayList = plan.evaluate(s.t);
    total += s.w;
    if (total === s.w) {
      drawDisplayList(tc, list, sources);
      continue;
    }
    drawDisplayList(sc, list, sources);
    tc.save();
    tc.setTransform(1, 0, 0, 1, 0, 0);
    tc.globalCompositeOperation = "source-over";
    tc.globalAlpha = s.w / total;
    tc.drawImage(scratch, 0, 0);
    tc.restore();
  }
}

/** Renders the whole clip (see the file's comment). Throws SHORTEN_MESSAGE when a typed field doesn't fit. */
export async function renderClip(scene: Scene, recipe: Recipe, o: RenderOptions): Promise<RenderResult> {
  const plan = scene.plan({ recipe, measure: o.measure, logo: o.logo });
  if (plan.overflow.length) throw new Error(SHORTEN_MESSAGE);
  const { w, h } = exportSize(recipe.size);
  // H.264 wants even sides.
  const W = w - (w % 2);
  const H = h - (h % 2);
  const n = frameCount(recipe.duration, recipe.fps);
  const bitrate = recipe.export.bitrate ?? exportBitrate(recipe.size, recipe.duration);
  const target = canvas(W, H);
  const scratch = canvas(W, H);
  const opts = { fps: recipe.fps, samples: recipe.export.blurSamples, shutter: recipe.export.shutter, duration: recipe.duration };
  const frame = (i: number) => {
    drawFrame(plan, i / recipe.fps, target, scratch, o.sources, opts);
    o.onProgress?.(i + 1, n, target);
    return target;
  };
  const formats = o.formats ?? ["mp4", "webm"];
  let blob: Blob | null = null;
  let type = "";
  let encoder: RenderResult["encoder"] = "webcodecs";
  for (const f of formats) {
    if (f === "mp4") {
      const codec = await avcCodec(W, H, recipe.fps, bitrate);
      if (!codec) continue;
      const bytes = await encodeMp4(codec, n, W, H, recipe.fps, frame, { bitrate, signal: o.signal });
      blob = new Blob([bytes as BlobPart], { type: "video/mp4" });
      type = "video/mp4";
      break;
    }
    if (f === "webm" && (await vp8Supported(W, H, recipe.fps))) {
      const [bytes] = await encodeVp8(n, W, H, recipe.fps, 1, (i) => [frame(i)], { bitrate, signal: o.signal });
      blob = new Blob([bytes as BlobPart], { type: "video/webm" });
      type = "video/webm";
      break;
    }
  }
  if (!blob && o.recorder) {
    const rec = pathVideoType();
    if (rec) {
      const [b] = await recordWithMediaRecorder(rec, n, W, H, recipe.fps, 1, (i) => {
        const c = frame(i);
        return [ctx2d(c).getImageData(0, 0, W, H)];
      });
      blob = b;
      type = rec.split(";")[0];
      encoder = "recorder";
    }
  }
  if (!blob) throw new Error(NO_ENCODER_MESSAGE);
  if (o.signal?.aborted) throw new DOMException("The render was stopped", "AbortError");
  drawDisplayList(ctx2d(target), plan.evaluate(plan.rest), o.sources);
  const poster = await toPng(target);
  return { blob, type, frames: n, poster, width: W, height: H, encoder };
}

/** Whether this browser can encode an MP4 of this size (the cloud end card needs one). */
export const canMakeMp4 = (w: number, h: number, fps: number) => avcCodec(w - (w % 2), h - (h % 2), fps).then((c) => !!c);
