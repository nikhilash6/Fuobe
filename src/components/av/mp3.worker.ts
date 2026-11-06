/**
 * MP3 encoding off the main thread (src/components/av/fit-audio.ts). The page sends "start", then one block of channels at a
 * time (each answered with "next", so only a block is in flight), then "end" for the file. Nothing leaves the browser.
 */
import { Mp3Stream } from "@/lib/av/mp3-encode";

export type Mp3In = { type: "start"; channels: number; sampleRate: number; kbps: number } | { type: "block"; block: Float32Array[] } | { type: "end" };
export type Mp3Out = { type: "ready" } | { type: "next" } | { type: "done"; parts: Uint8Array[] } | { type: "error"; message: string };

const post = (m: Mp3Out, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);
let stream: Mp3Stream | null = null;

self.onmessage = (e: MessageEvent<Mp3In>) => {
  try {
    const m = e.data;
    if (m.type === "start") stream = new Mp3Stream(m.channels, m.sampleRate, m.kbps);
    else if (m.type === "block") {
      stream!.push(m.block);
      post({ type: "next" });
    } else {
      const parts = stream!.end();
      stream = null;
      post({ type: "done", parts }, parts.map((p) => p.buffer as ArrayBuffer));
    }
  } catch (err) {
    post({ type: "error", message: (err as Error)?.message ?? String(err) });
  }
};

// Loaded and listening: the page starts sending.
post({ type: "ready" });
