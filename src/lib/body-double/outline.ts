/**
 * Body Double Live's full outline: each person's whole silhouette, clothes and hair included, from Google's MediaPipe
 * person segmenter (Apache-2.0), so the double covers what the 3D body alone doesn't (a coat, wide trousers, long hair).
 * The task library loads from its pinned CDN build when Live starts, and runs on the GPU (WebGL) where it can.
 * Worker-safe: no DOM.
 */

const TASKS_VERSION = "0.10.21";
const TASKS_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}`;
/** Background, hair, body skin, face skin, clothes, other: a person is everything but the background. */
const MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite";
/** The mask's width; its height keeps the frame's shape. */
export const OUTLINE_WIDTH = 256;

export type Outline = { data: Uint8Array; width: number; height: number };

/**
 * The person's tight box in a frame W x H wide, from the outline (the pixels over half sure), or null when there is
 * barely anyone: Live's body crop follows it, so a fast move or a new person never loses the body.
 */
export function outlineBox(o: Outline, W: number, H: number): number[] | null {
  let x1 = o.width, y1 = o.height, x2 = -1, y2 = -1, n = 0;
  for (let y = 0; y < o.height; y++)
    for (let x = 0; x < o.width; x++)
      if (o.data[y * o.width + x] > 128) {
        n++;
        if (x < x1) x1 = x;
        if (x > x2) x2 = x;
        if (y < y1) y1 = y;
        if (y > y2) y2 = y;
      }
  if (n < o.width * o.height * 0.01) return null;
  const sx = W / o.width, sy = H / o.height;
  return [x1 * sx, y1 * sy, (x2 + 1) * sx, (y2 + 1) * sy];
}

// The slice of the task library this file uses.
type MpMask = { getAsFloat32Array(): Float32Array; close(): void };
type Segmenter = {
  segmentForVideo(image: ImageBitmap, timestamp: number): { confidenceMasks?: MpMask[]; close(): void };
  close(): void;
};
type Tasks = {
  FilesetResolver: { forVisionTasks(base: string): Promise<unknown> };
  ImageSegmenter: { createFromOptions(fileset: unknown, options: Record<string, unknown>): Promise<Segmenter> };
};

export type OutlineFinder = { find(frame: ImageBitmap, width: number, height: number, at: number): Promise<Outline | null>; close(): void };

export async function createOutlineFinder(): Promise<OutlineFinder> {
  const tasks = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${TASKS_BASE}/vision_bundle.mjs`)) as Tasks;
  const fileset = await tasks.FilesetResolver.forVisionTasks(`${TASKS_BASE}/wasm`);
  const make = (delegate: "GPU" | "CPU") =>
    tasks.ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: "VIDEO",
      outputConfidenceMasks: true,
      outputCategoryMask: false,
      ...(delegate === "GPU" && typeof OffscreenCanvas !== "undefined" && { canvas: new OffscreenCanvas(1, 1) }),
    });
  let seg: Segmenter;
  try {
    seg = await make("GPU");
  } catch {
    seg = await make("CPU");
  }
  let last = -1;
  return {
    async find(frame, width, height, at) {
      const h = Math.max(2, Math.round((OUTLINE_WIDTH * height) / width));
      const small = await createImageBitmap(frame, { resizeWidth: OUTLINE_WIDTH, resizeHeight: h, resizeQuality: "medium" });
      try {
        // The task wants timestamps that only go up.
        const t = Math.max(last + 1, Math.round(at));
        last = t;
        const res = seg.segmentForVideo(small, t);
        const bg = res.confidenceMasks?.[0];
        if (!bg) {
          res.close();
          return null;
        }
        const f = bg.getAsFloat32Array();
        const data = new Uint8Array(f.length);
        for (let i = 0; i < f.length; i++) data[i] = Math.round((1 - f[i]) * 255);
        res.close();
        return { data, width: OUTLINE_WIDTH, height: h };
      } finally {
        small.close();
      }
    },
    close: () => seg.close(),
  };
}
