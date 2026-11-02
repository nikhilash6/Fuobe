"use client";

import { alignFit, WORK, type AlignResult } from "@/lib/relight/align";
import type { AlignReply, AlignRequest } from "./align.worker";
import type { Pic } from "./relight-renderer";

/**
 * Lines a relit picture up with its photo in a Web Worker (src/lib/relight/align.ts). A browser without module
 * workers runs the same maths on the main thread (well under a second).
 */

let worker: Worker | null = null;
let broken = false;
let seq = 0;
const waiting = new Map<number, (r: AlignResult | null) => void>();

function getWorker(): Worker | null {
  if (worker || broken) return worker;
  if (typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("./align.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<AlignReply>) => {
      waiting.get(e.data.id)?.(e.data.result);
      waiting.delete(e.data.id);
    };
    worker.onerror = () => {
      for (const done of waiting.values()) done(null);
      waiting.clear();
      worker?.terminate();
      worker = null;
      broken = true;
    };
    return worker;
  } catch {
    broken = true;
    return null;
  }
}

/** A picture's luma at size × size (each axis resampled on its own), 0..1. */
function lumaMap(p: Pic, size: number): Float32Array {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(p, 0, 0, size, size);
  const d = ctx.getImageData(0, 0, size, size).data;
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
  return out;
}

export async function alignPictures(photo: Pic, relit: Pic): Promise<AlignResult | null> {
  const a = lumaMap(photo, WORK);
  const b = lumaMap(relit, WORK);
  const w = getWorker();
  if (!w) return alignFit(a, b, WORK);
  const id = ++seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      resolve(alignFit(a, b, WORK));
    }, 4000);
    waiting.set(id, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    const pa = a.slice();
    const pb = b.slice();
    w.postMessage({ id, photo: pa, relit: pb, size: WORK } satisfies AlignRequest, [pa.buffer, pb.buffer]);
  });
}
