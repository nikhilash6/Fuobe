"use client";

import { muxWebm, type WebmFrame } from "./webm";

/**
 * Record a turntable video of a <model-viewer> in the browser: one full turn of the model on its turntable
 * (the lights stay put, as on the server's render), on the same studio backdrop. For models whose result came
 * without a turntable (cloud 3D models, or a server without Chromium / ffmpeg).
 *
 * Frame by frame, like the server: the model turns to each of TURN_FRAMES angles, renders, and the frame is
 * taken with viewer.toBlob() (model-viewer draws it from whichever canvas is on screen; its own canvases can be
 * hidden) and drawn over the backdrop on a canvas of ours. Then:
 * - with WebCodecs (VideoEncoder), each frame is encoded at its own timestamp (i / TURNTABLE_FPS s) and muxed to
 *   WebM here (webm.ts): exactly 4 s at 24 fps however long each frame took to render;
 * - without it, the frames are collected first and then played into MediaRecorder at 24 fps.
 */

/** Frames per second of the recording. */
export const TURNTABLE_FPS = 24;
/** Frames in one full turn (96 at 24 fps = 4 s, 3.75 degrees a frame). */
export const TURN_FRAMES = 96;
/** The recording's longest side, in pixels (the viewer's size at its pixel ratio, up to this). */
const MAX_SIDE = 1280;

/** The turntable angle (radians) of frame `i`. */
export const turnAngle = (i: number, frames = TURN_FRAMES) => (2 * Math.PI * (i % frames)) / frames;

/** The WebCodecs VP9 / VP8 encoder settings this browser takes for a w×h recording, or null. */
async function encoderConfig(width: number, height: number): Promise<{ config: VideoEncoderConfig; codec: "V_VP9" | "V_VP8" } | null> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
  for (const [codec, id] of [
    ["vp09.00.10.08", "V_VP9"],
    ["vp8", "V_VP8"],
  ] as const) {
    const config: VideoEncoderConfig = { codec, width, height, bitrate: 8_000_000, framerate: TURNTABLE_FPS, latencyMode: "quality" };
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) return { config, codec: id };
    } catch {}
  }
  return null;
}

/** The WebM type MediaRecorder can record, or null. */
function mediaRecorderType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

/** Whether this browser can record a turntable (WebCodecs or MediaRecorder). */
export function recordableType(): string | null {
  if (typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined") return "video/webm";
  return mediaRecorderType();
}

type ViewerElement = HTMLElement & { resetTurntableRotation?: (theta?: number) => void; toBlob?: (o?: { mimeType?: string }) => Promise<Blob> };

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const even = (n: number) => Math.max(2, 2 * Math.floor(n / 2));

/** The studio sweep the server's turntable is rendered on (scripts/model3d/render-turntable.mjs), on a 2D canvas. */
export function paintBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const r = w * (1250 / 2048);
  ctx.save();
  ctx.translate(w / 2, h * (700 / 1536));
  ctx.scale(1, 1 / 1.25);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  // The server's falloff is t = d^1.6 from #F3ECE3 to #D8CBBB; five stops follow it closely.
  for (const d of [0, 0.25, 0.5, 0.75, 1]) {
    const t = d ** 1.6;
    g.addColorStop(d, `rgb(${Math.round(243 - 27 * t)} ${Math.round(236 - 33 * t)} ${Math.round(227 - 40 * t)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(-w, -h * 2, w * 2, h * 4);
  ctx.restore();
}

export async function recordTurntable(viewer: ViewerElement, o: { onProgress?: (p: number) => void; signal?: AbortSignal } = {}): Promise<Blob> {
  if (!recordableType()) throw new Error("This browser can't record video — download the .glb instead");
  const { resetTurntableRotation, toBlob } = viewer;
  if (!resetTurntableRotation || !toBlob) throw new Error("The 3D viewer isn't ready yet");
  const turn = (theta: number) => resetTurntableRotation.call(viewer, theta);
  const stopped = () => {
    if (o.signal?.aborted) throw new Error("Stopped");
  };
  // Drive the turntable ourselves: auto-rotate off, one turn in fixed steps.
  const auto = viewer.hasAttribute("auto-rotate");
  viewer.removeAttribute("auto-rotate");
  try {
    /** Frame i on the backdrop, on our canvas (sized from the first frame). */
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    const grab = async (i: number) => {
      turn(turnAngle(i));
      // The new angle renders on the next frame; one more for the contact shadow.
      for (let k = 0; k < 3; k++) await nextFrame();
      const bitmap = await createImageBitmap(await toBlob.call(viewer, { mimeType: "image/png" }));
      try {
        if (!canvas) {
          const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
          canvas = document.createElement("canvas");
          canvas.width = even(bitmap.width * scale);
          canvas.height = even(bitmap.height * scale);
          ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("This browser can't record video — download the .glb instead");
        }
        paintBackdrop(ctx!, canvas.width, canvas.height);
        ctx!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      } finally {
        bitmap.close();
      }
      return canvas;
    };

    // Size the recording from the first frame, then pick the encoder.
    const first = await grab(0);
    stopped();
    const enc = await encoderConfig(first.width, first.height);
    if (enc) return await withWebCodecs(first, grab, enc, o, stopped);
    // WebCodecs without VP9 / VP8 (Safari encodes H.264 only) and no WebM MediaRecorder either.
    if (!mediaRecorderType()) throw new Error("This browser can't record video — download the .glb instead");
    return await withMediaRecorder(first, grab, o, stopped);
  } finally {
    turn(0);
    if (auto) viewer.setAttribute("auto-rotate", "");
  }
}

/** Encode each frame at its own timestamp: the clip's timing never depends on how fast the frames rendered. */
async function withWebCodecs(
  canvas: HTMLCanvasElement,
  grab: (i: number) => Promise<HTMLCanvasElement>,
  enc: { config: VideoEncoderConfig; codec: "V_VP9" | "V_VP8" },
  o: { onProgress?: (p: number) => void },
  stopped: () => void,
): Promise<Blob> {
  const frames: WebmFrame[] = [];
  let failure: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      frames.push({ data, timestamp: chunk.timestamp, key: chunk.type === "key" });
    },
    error: (e) => (failure = e instanceof Error ? e : new Error(String(e))),
  });
  encoder.configure(enc.config);
  const us = 1e6 / TURNTABLE_FPS;
  try {
    for (let i = 0; i < TURN_FRAMES; i++) {
      if (failure) throw failure;
      stopped();
      const c = i === 0 ? canvas : await grab(i);
      const frame = new VideoFrame(c, { timestamp: Math.round(i * us), duration: Math.round(us) });
      encoder.encode(frame, { keyFrame: i % TURNTABLE_FPS === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4) await sleep(5);
      o.onProgress?.((i + 1) / TURN_FRAMES);
    }
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
  if (frames.length < TURN_FRAMES) throw new Error("The recording came out empty — download the .glb instead");
  frames.sort((a, b) => a.timestamp - b.timestamp);
  return muxWebm({ codec: enc.codec, width: canvas.width, height: canvas.height, fps: TURNTABLE_FPS, frames });
}

/**
 * Without WebCodecs: collect the frames first (PNG blobs), then play them into MediaRecorder at the frame rate.
 * Drawing a decoded frame is quick, so the playback keeps time where rendering couldn't.
 */
async function withMediaRecorder(canvas: HTMLCanvasElement, grab: (i: number) => Promise<HTMLCanvasElement>, o: { onProgress?: (p: number) => void }, stopped: () => void): Promise<Blob> {
  const type = mediaRecorderType()!;
  const shot = (c: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("The 3D viewer isn't ready yet"))), "image/png"));
  const stills: Blob[] = [await shot(canvas)];
  for (let i = 1; i < TURN_FRAMES; i++) {
    stopped();
    stills.push(await shot(await grab(i)));
    o.onProgress?.((0.8 * (i + 1)) / TURN_FRAMES);
  }
  const ctx = canvas.getContext("2d")!;
  // Frame rate 0: a frame is captured only when requested.
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
  const step = 1000 / TURNTABLE_FPS;
  let next = createImageBitmap(stills[0]);
  rec.start(250);
  const t0 = performance.now();
  try {
    // One more than the frames: the last request only closes the last frame's duration.
    for (let i = 0; i <= TURN_FRAMES; i++) {
      stopped();
      const bitmap = i < TURN_FRAMES ? await next : null;
      if (i + 1 < TURN_FRAMES) next = createImageBitmap(stills[i + 1]);
      const wait = t0 + i * step - performance.now();
      if (wait > 0) await sleep(wait);
      if (bitmap) {
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
      }
      track.requestFrame?.();
      o.onProgress?.(0.8 + (0.2 * Math.min(i, TURN_FRAMES)) / TURN_FRAMES);
    }
  } finally {
    rec.stop();
    await done;
    stream.getTracks().forEach((t) => t.stop());
  }
  const blob = new Blob(chunks, { type: "video/webm" });
  if (!blob.size) throw new Error("The recording came out empty — download the .glb instead");
  return blob;
}
