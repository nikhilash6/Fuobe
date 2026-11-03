"use client";

import { avcCodec, encodeMp4, encodeVp8, pathVideoType, recordWithMediaRecorder, vp8Supported } from "@/components/cinema/video-encode";
import { listTravel, videoNodeOf, type DisplayList } from "@/lib/motion/display";
import type { Measure } from "@/lib/motion/layout";
import type { Recipe } from "@/lib/motion/recipe";
import type { LogoInfo, Outline, Scene, ScenePlan } from "@/lib/motion/scene";
import { exportBitrate, exportSize } from "@/lib/motion/sizes";
import { frameCount } from "@/lib/motion/time";
import { applyFinish, drawDisplayList, type Sources } from "./draw";

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
  images?: Record<string, { w: number; h: number }>;
  outlines?: Record<string, Outline | null>;
  measure: Measure;
  signal?: AbortSignal;
  /** After each frame: how many are done, of how many, and the frame just drawn. */
  onProgress?: (done: number, total: number, frame: AnyCanvas) => void;
  /** The containers allowed, best first (default MP4, then WebM). */
  formats?: ("mp4" | "webm")[];
  /** Allow the real-time recorder when WebCodecs can't (it may drop a frame). */
  recorder?: boolean;
  /** The person's clips by key, with their size and length (Kinetic's video layer). */
  clips?: Record<string, { w: number; h: number; duration: number }>;
  /** Puts every clip on the picture a frame shows, before the frame is drawn (exact seeks). */
  prepare?: (list: DisplayList) => Promise<void>;
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
  const at = plan.evaluate(t);
  if (o.samples <= 1 || (plan.still(t - half) && plan.still(t))) {
    drawDisplayList(tc, at, sources);
    return;
  }
  drawBlurred(plan, t, at, tc, scratch, sources, o);
  // The grade and grain once per output frame, after the blur (never blended across moments).
  if (at.finish) applyFinish(tc, at.finish);
}

function drawBlurred(plan: ScenePlan, t: number, at: DisplayList, tc: Ctx, scratch: AnyCanvas, sources: Sources, o: { fps: number; samples: number; shutter: number; duration: number }): void {
  const plain = { finish: false };
  // As many moments as this frame's motion needs, measured across the open shutter.
  const ends = shutterSamples(t, o.fps, 2, o.shutter, o.duration, plan.cuts);
  const first = plan.evaluate(ends[0].t);
  const travel = listTravel(first, plan.evaluate(ends[1].t)) * (tc.canvas.width / first.w);
  const samples = blurSamples(travel, o.samples);
  if (samples <= 1) {
    drawDisplayList(tc, at, sources, plain);
    return;
  }
  const sc = ctx2d(scratch);
  let total = 0;
  for (const s of shutterSamples(t, o.fps, samples, o.shutter, o.duration, plan.cuts)) {
    const list: DisplayList = plan.evaluate(s.t);
    total += s.w;
    if (total === s.w) {
      drawDisplayList(tc, list, sources, plain);
      continue;
    }
    drawDisplayList(sc, list, sources, plain);
    tc.save();
    tc.setTransform(1, 0, 0, 1, 0, 0);
    tc.globalCompositeOperation = "source-over";
    tc.globalAlpha = s.w / total;
    tc.drawImage(scratch, 0, 0);
    tc.restore();
  }
}

/** The plan a render draws (its typed words checked first). */
function planFor(scene: Scene, recipe: Recipe, o: Pick<RenderOptions, "measure" | "logo" | "images" | "outlines" | "clips">): ScenePlan {
  const plan = scene.plan({ recipe, measure: o.measure, logo: o.logo, images: o.images, outlines: o.outlines, clips: o.clips });
  if (plan.overflow.length) throw new Error(SHORTEN_MESSAGE);
  return plan;
}

/** Puts the clips on the picture frame `t` shows (when its list has one) before it is drawn. */
async function prepared(plan: ScenePlan, t: number, o: Pick<RenderOptions, "prepare">): Promise<void> {
  if (!o.prepare) return;
  const list = plan.evaluate(t);
  if (videoNodeOf(list)) await o.prepare(list);
}

/** The export's pixels, with even sides (H.264 wants them). */
function evenSize(recipe: Recipe): { W: number; H: number } {
  const { w, h } = exportSize(recipe.size);
  return { W: w - (w % 2), H: h - (h % 2) };
}

const stopped = () => new DOMException("The render was stopped", "AbortError");

/** Renders the whole clip (see the file's comment). Throws SHORTEN_MESSAGE when a typed field doesn't fit. */
export async function renderClip(scene: Scene, recipe: Recipe, o: RenderOptions): Promise<RenderResult> {
  const plan = planFor(scene, recipe, o);
  const { W, H } = evenSize(recipe);
  const n = frameCount(recipe.duration, recipe.fps);
  const bitrate = recipe.export.bitrate ?? exportBitrate(recipe.size, recipe.duration, { fps: recipe.fps, quality: recipe.export.quality });
  const target = canvas(W, H);
  const scratch = canvas(W, H);
  const opts = { fps: recipe.fps, samples: recipe.export.blurSamples, shutter: recipe.export.shutter, duration: recipe.duration };
  const frame = async (i: number) => {
    if (o.signal?.aborted) throw stopped();
    await prepared(plan, i / recipe.fps, o);
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
      const [bytes] = await encodeVp8(n, W, H, recipe.fps, 1, async (i) => [await frame(i)], { bitrate, signal: o.signal });
      blob = new Blob([bytes as BlobPart], { type: "video/webm" });
      type = "video/webm";
      break;
    }
  }
  if (!blob && o.recorder) {
    const rec = pathVideoType();
    if (rec) {
      // The real-time recorder draws in step with its own clock (it never waits for a seek).
      const [b] = await recordWithMediaRecorder(rec, n, W, H, recipe.fps, 1, (i) => {
        drawFrame(plan, i / recipe.fps, target, scratch, o.sources, opts);
        o.onProgress?.(i + 1, n, target);
        return [ctx2d(target).getImageData(0, 0, W, H)];
      });
      blob = b;
      type = rec.split(";")[0];
      encoder = "recorder";
    }
  }
  if (!blob) throw new Error(NO_ENCODER_MESSAGE);
  if (o.signal?.aborted) throw stopped();
  await prepared(plan, plan.rest, o);
  drawDisplayList(ctx2d(target), plan.evaluate(plan.rest), o.sources);
  const poster = await toPng(target);
  return { blob, type, frames: n, poster, width: W, height: H, encoder };
}

export interface PictureResult {
  blob: Blob;
  width: number;
  height: number;
}

const blurOf = (recipe: Recipe) => ({ fps: recipe.fps, samples: recipe.export.blurSamples, shutter: recipe.export.shutter, duration: recipe.duration });

/** One moment at the export size, with motion blur and the finish: a Frame PNG. */
export async function renderFrame(scene: Scene, recipe: Recipe, t: number, o: RenderOptions): Promise<PictureResult> {
  const plan = planFor(scene, recipe, o);
  const { W, H } = evenSize(recipe);
  const target = canvas(W, H);
  const at = Math.min(plan.rest, Math.max(0, t));
  await prepared(plan, at, o);
  drawFrame(plan, at, target, canvas(W, H), o.sources, blurOf(recipe));
  return { blob: await toPng(target), width: W, height: H };
}

/** The times a contact sheet shows: 9 frames at i / 8 of the way to the last frame. */
export const sheetTimes = (rest: number): number[] => Array.from({ length: 9 }, (_, i) => (i / 8) * rest);

/** A 3 × 3 contact sheet at the export size (each frame a third of it, no gutters), with blur and the finish. */
export async function renderSheet(scene: Scene, recipe: Recipe, o: RenderOptions): Promise<PictureResult> {
  const plan = planFor(scene, recipe, o);
  const { W, H } = evenSize(recipe);
  const cw = Math.floor(W / 3);
  const ch = Math.floor(H / 3);
  const sheet = canvas(W, H);
  const sc = ctx2d(sheet);
  sc.fillStyle = "#000";
  sc.fillRect(0, 0, W, H);
  const cell = canvas(cw, ch);
  const scratch = canvas(cw, ch);
  const times = sheetTimes(plan.rest);
  for (let i = 0; i < times.length; i++) {
    if (o.signal?.aborted) throw stopped();
    await prepared(plan, times[i], o);
    drawFrame(plan, times[i], cell, scratch, o.sources, blurOf(recipe));
    sc.drawImage(cell, (i % 3) * cw, Math.floor(i / 3) * ch);
    o.onProgress?.(i + 1, times.length, sheet);
  }
  return { blob: await toPng(sheet), width: W, height: H };
}

/** A version's picture: the rest frame, `long` pixels on its long side. */
export async function renderRest(scene: Scene, recipe: Recipe, o: RenderOptions, long = 540): Promise<PictureResult> {
  const plan = planFor(scene, recipe, o);
  const k = long / Math.max(plan.design.w, plan.design.h);
  const w = Math.max(2, Math.round(plan.design.w * k));
  const h = Math.max(2, Math.round(plan.design.h * k));
  const target = canvas(w, h);
  await prepared(plan, plan.rest, o);
  drawDisplayList(ctx2d(target), plan.evaluate(plan.rest), o.sources);
  return { blob: await toPng(target), width: w, height: h };
}

/** Whether this browser can encode an MP4 of this size (the cloud end card needs one). */
export const canMakeMp4 = (w: number, h: number, fps: number) => avcCodec(w - (w % 2), h - (h % 2), fps).then((c) => !!c);
