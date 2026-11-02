/**
 * Lines the relit picture up with the photo off the main thread (src/lib/relight/align.ts): two WORK × WORK grey maps
 * in, the fit out. Nothing leaves the browser.
 */
import { alignFit, type AlignResult } from "@/lib/relight/align";

export interface AlignRequest {
  id: number;
  photo: Float32Array;
  relit: Float32Array;
  size: number;
}

export interface AlignReply {
  id: number;
  result: AlignResult | null;
}

self.onmessage = (e: MessageEvent<AlignRequest>) => {
  const { id, photo, relit, size } = e.data;
  let result: AlignResult | null = null;
  try {
    result = alignFit(photo, relit, size);
  } catch {
    result = null;
  }
  (self as unknown as Worker).postMessage({ id, result } satisfies AlignReply);
};
