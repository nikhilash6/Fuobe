/**
 * Body Double Live off the main thread: camera frames in (ImageBitmap), each person's body out, ready to draw
 * (positions and normals in three.js space). InstantHMR runs here on WebGPU or WebAssembly (src/lib/body-double/hmr.ts),
 * so the page keeps drawing the camera at its own frame rate. Nothing leaves the browser.
 */
import { createHmr, type DrawBody, type Hmr, toDrawBody } from "@/lib/body-double/hmr";

export type LiveRequest =
  | { type: "start" }
  | { type: "frame"; bitmap: ImageBitmap; width: number; height: number; at: number }
  | { type: "reset" };

export type LiveReply =
  | { type: "progress"; share: number }
  | { type: "ready"; faces: Uint32Array; engine: Hmr["engine"] }
  | { type: "body"; body: DrawBody; focal: number; width: number; height: number; at: number; ms: number }
  | { type: "skip"; at: number }
  | { type: "error"; message: string };

const post = (r: LiveReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(r, transfer);

let hmr: Hmr | null = null;
let starting: Promise<void> | null = null;

self.onmessage = async (e: MessageEvent<LiveRequest>) => {
  const m = e.data;
  if (m.type === "start") {
    starting ??= createHmr((share) => post({ type: "progress", share }))
      .then((h) => {
        hmr = h;
        // A copy: the worker keeps its own faces for the normals.
        post({ type: "ready", faces: h.faces.slice(), engine: h.engine });
      })
      .catch((err: unknown) => {
        starting = null;
        post({ type: "error", message: err instanceof Error ? err.message : "Live didn't start" });
      });
    return;
  }
  if (m.type === "reset") {
    hmr?.resetTrack();
    return;
  }
  if (!hmr) {
    m.bitmap.close();
    post({ type: "skip", at: m.at });
    return;
  }
  const t0 = performance.now();
  try {
    const res = await hmr.step(m.bitmap, m.width, m.height, m.at / 1000);
    const body = toDrawBody(res.verts, res.cam, hmr.faces);
    post({ type: "body", body, focal: res.f, width: m.width, height: m.height, at: m.at, ms: performance.now() - t0 }, [body.positions.buffer, body.normals.buffer]);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : "Live stopped" });
  } finally {
    m.bitmap.close();
  }
};
