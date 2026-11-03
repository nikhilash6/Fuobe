"use client";

import { muxMp4 } from "@/lib/mp4";
import { muxWebM, type EncodedFrame } from "@/lib/webm";

/**
 * Frame-exact video from frames drawn in the browser (Cinema's fly path render, N7-5, and the blockout builder): WebCodecs
 * VP8 into WebM (what ComfyUI reads), WebCodecs H.264 into MP4 (what the cloud models read: Seedance 2.5 takes MP4 or
 * MOV), and MediaRecorder as the fallback where WebCodecs can't, which may drop a frame.
 */

/** The type MediaRecorder records a path in when WebCodecs can't: MP4 (H.264) where it writes it, else WebM. Null: none. */
export function pathVideoType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

const VP8 = (width: number, height: number, fps: number): VideoEncoderConfig => ({ codec: "vp8", width, height, bitrate: 8_000_000, framerate: fps });

/** WebCodecs can encode VP8 at this size here. */
export async function vp8Supported(width: number, height: number, fps: number): Promise<boolean> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return false;
  try {
    return !!(await VideoEncoder.isConfigSupported(VP8(width, height, fps))).supported;
  } catch {
    return false;
  }
}

/**
 * `count` frames of two streams (`draw(i)` gives frame i of each, or a promise of them: a frame may wait for a splat's sort) encoded with WebCodecs and written as two WebM files:
 * every frame kept, frame i at i / fps, a keyframe each second.
 */
export async function encodeVp8(count: number, width: number, height: number, fps: number, outputs: number, draw: (i: number) => ImageData[] | Promise<ImageData[]>): Promise<Uint8Array[]> {
  const chunks: EncodedFrame[][] = Array.from({ length: outputs }, () => []);
  let failure: unknown;
  const encoders = chunks.map((_, k) => {
    const e = new VideoEncoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        chunks[k].push({ data, key: chunk.type === "key" });
      },
      error: (err) => (failure = err),
    });
    e.configure(VP8(width, height, fps));
    return e;
  });
  try {
    const step = 1e6 / fps;
    for (let i = 0; i < count; i++) {
      const images = await draw(i);
      images.forEach((img, k) => {
        const f = new VideoFrame(img.data, { format: "RGBA", codedWidth: width, codedHeight: height, timestamp: Math.round(i * step), duration: Math.round(step) });
        encoders[k].encode(f, { keyFrame: i % Math.max(1, Math.round(fps)) === 0 });
        f.close();
      });
      if (failure) throw failure;
      // Let the encoders and the page breathe (the progress label repaints).
      while (encoders.some((e) => e.encodeQueueSize > 4)) await new Promise((r) => setTimeout(r, 5));
      if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
    }
    await Promise.all(encoders.map((e) => e.flush()));
    if (failure) throw failure;
  } finally {
    encoders.forEach((e) => e.state !== "closed" && e.close());
  }
  if (chunks.some((c) => c.length !== count)) throw new Error(`The path render lost frames (${chunks[0].length} of ${count})`);
  const track = { codec: "V_VP8" as const, width, height, fps };
  return chunks.map((c) => muxWebM(track, c));
}

/** The fallback: a canvas per stream recorded with MediaRecorder, each frame handed over 1/fps apart. */
export async function recordWithMediaRecorder(type: string, count: number, width: number, height: number, fps: number, outputs: number, draw: (i: number) => ImageData[] | Promise<ImageData[]>): Promise<Blob[]> {
  const canvases = Array.from({ length: outputs }, () => Object.assign(document.createElement("canvas"), { width, height }));
  const ctxs = canvases.map((c) => c.getContext("2d")!);
  const streams = canvases.map((c) => c.captureStream(0));
  const tracks = streams.map((s) => s.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void });
  const recorders = streams.map((s) => new MediaRecorder(s, { mimeType: type, videoBitsPerSecond: 8_000_000 }));
  const chunks: Blob[][] = recorders.map(() => []);
  const stopped = recorders.map((r, i) => {
    r.ondataavailable = (e) => e.data.size && chunks[i].push(e.data);
    return new Promise<void>((resolve) => (r.onstop = () => resolve()));
  });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const step = 1000 / Math.max(1, fps);
  try {
    recorders.forEach((r) => r.start());
    await wait(step);
    const t0 = performance.now();
    for (let i = 0; i < count; i++) {
      (await draw(i)).forEach((img, k) => ctxs[k].putImageData(img, 0, 0));
      tracks.forEach((t) => t.requestFrame?.());
      await wait(Math.max(0, t0 + (i + 1) * step - performance.now()));
    }
    await wait(step);
  } finally {
    recorders.forEach((r) => r.state !== "inactive" && r.stop());
    await Promise.all(stopped);
    streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  }
  const base = type.split(";")[0];
  return chunks.map((c) => new Blob(c, { type: base }));
}

/** The H.264 profiles tried in order (baseline 3.1 holds 1280 × 720 at 30 fps; main and high 4.0 more). */
const AVC_CODECS = ["avc1.42001f", "avc1.4d0028", "avc1.640028"];
const AVC = (codec: string, width: number, height: number, fps: number): VideoEncoderConfig => ({ codec, width, height, bitrate: 8_000_000, framerate: fps, avc: { format: "avc" } });

/** The H.264 profile WebCodecs encodes at this size here, or null (Chromium without proprietary codecs, Firefox). */
export async function avcCodec(width: number, height: number, fps: number): Promise<string | null> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
  for (const c of AVC_CODECS) {
    try {
      if ((await VideoEncoder.isConfigSupported(AVC(c, width, height, fps))).supported) return c;
    } catch {}
  }
  return null;
}

/** `count` frames (`draw(i)` gives frame i) encoded with WebCodecs H.264 and written as one MP4: every frame kept. */
export async function encodeMp4(codec: string, count: number, width: number, height: number, fps: number, draw: (i: number) => ImageData | Promise<ImageData>): Promise<Uint8Array> {
  const frames: EncodedFrame[] = [];
  let avcC: Uint8Array | null = null;
  let failure: unknown;
  const e = new VideoEncoder({
    output: (chunk, meta) => {
      const d = meta?.decoderConfig?.description;
      if (d && !avcC) avcC = d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array((d as ArrayBufferView).buffer.slice((d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteOffset + (d as ArrayBufferView).byteLength));
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      frames.push({ data, key: chunk.type === "key" });
    },
    error: (err) => (failure = err),
  });
  e.configure(AVC(codec, width, height, fps));
  try {
    const step = 1e6 / fps;
    for (let i = 0; i < count; i++) {
      const img = await draw(i);
      const f = new VideoFrame(img.data, { format: "RGBA", codedWidth: width, codedHeight: height, timestamp: Math.round(i * step), duration: Math.round(step) });
      e.encode(f, { keyFrame: i % Math.max(1, Math.round(fps)) === 0 });
      f.close();
      if (failure) throw failure;
      while (e.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
      if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
    }
    await e.flush();
    if (failure) throw failure;
  } finally {
    if (e.state !== "closed") e.close();
  }
  if (frames.length !== count) throw new Error(`The render lost frames (${frames.length} of ${count})`);
  if (!avcC) throw new Error("The H.264 encoder gave no decoder description");
  return muxMp4({ width, height, fps, avcC }, frames);
}

/**
 * One stream of `count` frames as the best video this browser makes: MP4 (H.264) when `preferMp4` and WebCodecs can,
 * else WebM (VP8), else MediaRecorder's own type. Frame-exact except on the MediaRecorder fallback.
 */
export async function encodeFrames(count: number, width: number, height: number, fps: number, draw: (i: number) => ImageData | Promise<ImageData>, preferMp4 = false): Promise<{ blob: Blob; type: string; exact: boolean }> {
  const avc = preferMp4 ? await avcCodec(width, height, fps) : null;
  if (avc) return { blob: new Blob([(await encodeMp4(avc, count, width, height, fps, draw)) as BlobPart], { type: "video/mp4" }), type: "video/mp4", exact: true };
  if (await vp8Supported(width, height, fps)) {
    const [a] = await encodeVp8(count, width, height, fps, 1, async (i) => [await draw(i)]);
    return { blob: new Blob([a as BlobPart], { type: "video/webm" }), type: "video/webm", exact: true };
  }
  const type = pathVideoType();
  if (!type) throw new Error("This browser can't record video — try Chrome or Edge, or upload a render from your 3D app");
  const [b] = await recordWithMediaRecorder(type, count, width, height, fps, 1, async (i) => [await draw(i)]);
  return { blob: b, type: type.split(";")[0], exact: false };
}
