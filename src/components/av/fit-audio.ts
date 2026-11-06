"use client";

import { FIT_READ_MAX_SECONDS, FIT_SOURCE_MAX_BYTES, mp3Name } from "@/lib/av/fit-upload";
import { MP3_BLOCK, Mp3Stream } from "@/lib/av/mp3-encode";
import { probeBlob, probeUrl } from "@/lib/media-probe";
import type { Mp3In, Mp3Out } from "./mp3.worker";

/**
 * The browser half of the fitting step (src/lib/av/fit-upload.ts): a file's length from its header, and a sound (any file
 * the browser plays, or a video's sound) as an MP3, all of it or a part. Decoded with Web Audio at 44.1 kHz and encoded
 * with LAME in a Web Worker a block at a time (on the main thread where a worker can't start), so a phone holds the decoded
 * sound once and a block. Nothing is sent anywhere while it runs.
 */

const RATE = 44100;
/** Blocks of about 10 s go to the worker one at a time. */
const SEND = MP3_BLOCK * 12;

const unreadable = () => new Error("We couldn't read the sound in this file here. Save it as an MP3 and add it again");

function stopIfAsked(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

/** The length a media element reads from the file's header (anything the browser plays), or undefined. */
function elementSeconds(src: string, video: boolean): Promise<number | undefined> {
  return new Promise((resolve) => {
    const el = document.createElement(video ? "video" : "audio");
    const done = (s?: number) => {
      clearTimeout(timer);
      el.removeAttribute("src");
      el.load();
      resolve(s && Number.isFinite(s) && s > 0 ? s : undefined);
    };
    const timer = setTimeout(() => done(), 15_000);
    el.preload = "metadata";
    el.muted = true;
    el.onloadedmetadata = () => done(el.duration);
    el.onerror = () => done();
    el.src = src;
  });
}

/** A file's length in seconds from its header only (never the whole file): our own reader first, then the browser's. */
export async function readSeconds(src: Blob | string, video = false): Promise<number | undefined> {
  const info = await (typeof src === "string" ? probeUrl(src) : probeBlob(src)).catch(() => null);
  if (info?.duration && info.duration > 0) return info.duration;
  if (typeof document === "undefined") return undefined;
  if (typeof src === "string") return elementSeconds(src, video);
  const url = URL.createObjectURL(src);
  try {
    return await elementSeconds(url, video || src.type.startsWith("video/"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decode(data: ArrayBuffer): Promise<AudioBuffer> {
  const Ctx: typeof OfflineAudioContext | undefined =
    typeof OfflineAudioContext !== "undefined" ? OfflineAudioContext : (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Ctx) throw unreadable();
  const ctx = new Ctx(2, 1, RATE);
  try {
    // The callback form too: older Safari returns no promise.
    return await new Promise<AudioBuffer>((resolve, reject) => {
      const p = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
      p?.then(resolve, reject);
    });
  } catch {
    throw unreadable();
  }
}

/** The encoder: a worker when one starts, else the main thread (yielding between blocks). */
interface Encoder {
  push(block: Float32Array[]): Promise<void>;
  end(): Promise<Uint8Array[]>;
  close(): void;
}

async function workerEncoder(channels: number, kbps: number): Promise<Encoder | null> {
  if (typeof Worker === "undefined") return null;
  let w: Worker;
  try {
    w = new Worker(new URL("./mp3.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
  let waiting: { resolve: (m: Mp3Out) => void; reject: (e: Error) => void } | null = null;
  let broken: Error | null = null;
  const next = () =>
    new Promise<Mp3Out>((resolve, reject) => {
      if (broken) return reject(broken);
      waiting = { resolve, reject };
    });
  w.onmessage = (e: MessageEvent<Mp3Out>) => {
    const m = e.data;
    const at = waiting;
    waiting = null;
    if (m.type === "error") at?.reject(new Error("We couldn't convert the sound here. Save it as an MP3 and add it again"));
    else at?.resolve(m);
  };
  w.onerror = () => {
    broken = new Error("We couldn't convert the sound here. Save it as an MP3 and add it again");
    waiting?.reject(broken);
    waiting = null;
  };
  try {
    // Loaded (in 10 s at most): else the main thread does it.
    const ready = await Promise.race([next(), new Promise<null>((r) => setTimeout(() => r(null), 10_000))]);
    if (ready?.type !== "ready") throw new Error("worker");
  } catch {
    w.terminate();
    return null;
  }
  const send = (m: Mp3In, transfer: Transferable[] = []) => w.postMessage(m, transfer);
  send({ type: "start", channels, sampleRate: RATE, kbps });
  return {
    async push(block) {
      const answer = next();
      send({ type: "block", block }, block.map((b) => b.buffer as ArrayBuffer));
      await answer;
    },
    async end() {
      const answer = next();
      send({ type: "end" });
      const m = await answer;
      if (m.type !== "done") throw unreadable();
      return m.parts;
    },
    close: () => w.terminate(),
  };
}

function mainEncoder(channels: number, kbps: number): Encoder {
  const s = new Mp3Stream(channels, RATE, kbps);
  return {
    async push(block) {
      s.push(block);
      await new Promise((r) => setTimeout(r, 0));
    },
    end: async () => s.end(),
    close: () => {},
  };
}

/**
 * The sound as an MP3 at `kbps`, named after the original: all of it, or `from` to `to` seconds. Throws in plain words
 * when the browser can't read the file. The caller has checked the caps (planAudioFit), checked again here.
 */
export async function toMp3(src: Blob, opts: { kbps: number; name?: string; from?: number; to?: number; signal?: AbortSignal }): Promise<File> {
  if (src.size > FIT_SOURCE_MAX_BYTES) throw new Error(`The largest file this takes is ${Math.round(FIT_SOURCE_MAX_BYTES / 1024 / 1024)} MB. Use a shorter clip`);
  const audio = await decode(await src.arrayBuffer());
  stopIfAsked(opts.signal);
  if (audio.duration > FIT_READ_MAX_SECONDS + 1) throw new Error("This file is too long to cut here: use a shorter clip");
  const a = Math.max(0, Math.round((opts.from ?? 0) * audio.sampleRate));
  const b = Math.min(audio.length, opts.to ? Math.round(opts.to * audio.sampleRate) : audio.length);
  if (b <= a) throw unreadable();
  const n = Math.min(2, audio.numberOfChannels);
  const enc = (await workerEncoder(n, opts.kbps)) ?? mainEncoder(n, opts.kbps);
  try {
    for (let at = a; at < b; at += SEND) {
      stopIfAsked(opts.signal);
      const end = Math.min(b, at + SEND);
      // A copy of this block only: the worker takes it over.
      await enc.push(Array.from({ length: n }, (_, c) => audio.getChannelData(c).slice(at, end)));
    }
    const parts = await enc.end();
    return new File(parts as BlobPart[], mp3Name(opts.name), { type: "audio/mpeg" });
  } finally {
    enc.close();
  }
}
