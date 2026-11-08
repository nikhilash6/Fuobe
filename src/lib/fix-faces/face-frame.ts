/**
 * Fix Faces' face photo when the person adds none: the clip's clearest face, found in the browser. A few moments of the
 * clip are looked at with Google's MediaPipe face detector (Apache-2.0, the task library Body Double Live already
 * loads), and the frame whose face is sure, large and sharp wins. The face and some of the head and shoulders around
 * it are cut out as the photo the redraw follows.
 *
 * The scoring is plain arithmetic (tested in tests/fix-faces.test.ts); the detector and the frames need a browser.
 */

const TASKS_VERSION = "0.10.21";
const TASKS_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}`;
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

/** How many moments of the clip are looked at. */
export const FACE_FRAME_SAMPLES = 16;
/** A face at least this share of the frame height counts as fully large; larger faces earn no more. */
const FULL_SIZE = 0.25;

/** A face in a frame, in the frame's pixels. */
export type FaceBox = { x: number; y: number; width: number; height: number; score: number };

/**
 * Sharpness of a grey image: the variance of its Laplacian (4-neighbour). Blur and smear lower it; detail raises it.
 * `grey` is row-major, `width` x `height`, values 0-255.
 */
export function sharpness(grey: ArrayLike<number>, width: number, height: number): number {
  let n = 0, sum = 0, sq = 0;
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const l = grey[i - 1] + grey[i + 1] + grey[i - width] + grey[i + width] - 4 * grey[i];
      sum += l;
      sq += l * l;
      n++;
    }
  if (!n) return 0;
  const mean = sum / n;
  return sq / n - mean * mean;
}

/**
 * How good a face is as the redraw's photo: sure (the detector's score), large (up to FULL_SIZE of the frame height)
 * and sharp. A face cut off by the frame's edge scores half.
 */
export function faceScore(face: FaceBox, frameWidth: number, frameHeight: number, faceSharpness: number): number {
  const size = Math.min(1, face.height / frameHeight / FULL_SIZE);
  const inside = face.x > 1 && face.y > 1 && face.x + face.width < frameWidth - 1 && face.y + face.height < frameHeight - 1;
  return face.score * size * Math.sqrt(Math.max(0, faceSharpness)) * (inside ? 1 : 0.5);
}

/** The photo's box around a face: the head with some hair and neck, square, kept inside the frame. */
export function photoBox(face: FaceBox, frameWidth: number, frameHeight: number): { x: number; y: number; size: number } {
  const size = Math.min(frameWidth, frameHeight, Math.round(Math.max(face.width, face.height) * 2.4));
  const cx = face.x + face.width / 2;
  const cy = face.y + face.height * 0.55;
  const x = Math.round(Math.min(Math.max(0, cx - size / 2), frameWidth - size));
  const y = Math.round(Math.min(Math.max(0, cy - size / 2), frameHeight - size));
  return { x, y, size };
}

/** The moments to look at: spread over the clip, away from its very first and last frames. */
export function sampleTimes(duration: number, count = FACE_FRAME_SAMPLES): number[] {
  if (!(duration > 0)) return [0];
  const margin = Math.min(0.25, duration * 0.05);
  const span = Math.max(0, duration - 2 * margin);
  return Array.from({ length: count }, (_, i) => Math.round((margin + (span * (i + 0.5)) / count) * 1000) / 1000);
}

// The slice of the task library this file uses.
type Detection = { boundingBox?: { originX: number; originY: number; width: number; height: number }; categories?: { score: number }[] };
type Detector = { detect(image: HTMLCanvasElement): { detections: Detection[] }; close(): void };
type Tasks = {
  FilesetResolver: { forVisionTasks(base: string): Promise<unknown> };
  FaceDetector: { createFromOptions(fileset: unknown, options: Record<string, unknown>): Promise<Detector> };
};

async function createDetector(): Promise<Detector> {
  const tasks = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${TASKS_BASE}/vision_bundle.mjs`)) as Tasks;
  const fileset = await tasks.FilesetResolver.forVisionTasks(`${TASKS_BASE}/wasm`);
  const make = (delegate: "GPU" | "CPU") =>
    tasks.FaceDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "IMAGE", minDetectionConfidence: 0.5 });
  try {
    return await make("GPU");
  } catch {
    return make("CPU");
  }
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", fail);
      resolve();
    };
    const fail = () => {
      video.removeEventListener("seeked", done);
      reject(new Error("The clip can't be read here"));
    };
    video.addEventListener("seeked", done);
    video.addEventListener("error", fail);
    video.currentTime = t;
  });
}

function greyOf(ctx: CanvasRenderingContext2D, box: { x: number; y: number; width: number; height: number }): { grey: Uint8ClampedArray; width: number; height: number } {
  const w = Math.max(3, Math.round(box.width)), h = Math.max(3, Math.round(box.height));
  const rgba = ctx.getImageData(Math.round(box.x), Math.round(box.y), w, h).data;
  const grey = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) grey[i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
  return { grey, width: w, height: h };
}

/** The faces in the canvas: the whole frame, then (for a wide frame) zoomed tiles of its upper part, where small faces are. */
function facesIn(detector: Detector, frame: HTMLCanvasElement): FaceBox[] {
  const read = (d: Detection, ox = 0, oy = 0, k = 1): FaceBox | null =>
    d.boundingBox ? { x: ox + d.boundingBox.originX / k, y: oy + d.boundingBox.originY / k, width: d.boundingBox.width / k, height: d.boundingBox.height / k, score: d.categories?.[0]?.score ?? 0 } : null;
  const found = detector.detect(frame).detections.map((d) => read(d)).filter((f): f is FaceBox => !!f);
  if (found.length) return found;
  // Small faces (a full figure on a runway) are under the short-range model's size: look again at 2x, in tiles.
  const tile = document.createElement("canvas");
  const tw = Math.round(frame.width / 2), th = Math.round(frame.height / 2);
  tile.width = tw * 2;
  tile.height = th * 2;
  const tctx = tile.getContext("2d")!;
  for (const [ox, oy] of [[0, 0], [tw / 2, 0], [tw, 0], [tw / 2, th / 2]] as const) {
    tctx.drawImage(frame, ox, oy, tw, th, 0, 0, tile.width, tile.height);
    for (const d of detector.detect(tile).detections) {
      const f = read(d, ox, oy, 2);
      if (f) found.push(f);
    }
  }
  return found;
}

export type FaceFrame = { photo: Blob; time: number; face: FaceBox };

/**
 * The clip's clearest face as a JPEG photo, or null when no moment shows a face. `src` is the clip's URL (an object URL
 * of the person's file works). Runs in the page; nothing leaves the browser.
 */
export async function pickFaceFrame(src: string, onProgress?: (done: number, total: number) => void): Promise<FaceFrame | null> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.src = src;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("The clip can't be read here"));
  });
  const W = video.videoWidth, H = video.videoHeight;
  const frame = document.createElement("canvas");
  frame.width = W;
  frame.height = H;
  const ctx = frame.getContext("2d", { willReadFrequently: true })!;
  const detector = await createDetector();
  let best: { score: number; time: number; face: FaceBox } | null = null;
  const times = sampleTimes(video.duration);
  try {
    for (const [i, t] of times.entries()) {
      await seek(video, t);
      ctx.drawImage(video, 0, 0, W, H);
      for (const face of facesIn(detector, frame)) {
        const g = greyOf(ctx, face);
        const score = faceScore(face, W, H, sharpness(g.grey, g.width, g.height));
        if (!best || score > best.score) best = { score, time: t, face };
      }
      onProgress?.(i + 1, times.length);
    }
    if (!best) return null;
    await seek(video, best.time);
    ctx.drawImage(video, 0, 0, W, H);
    const box = photoBox(best.face, W, H);
    const out = document.createElement("canvas");
    out.width = out.height = Math.min(1024, box.size);
    out.getContext("2d")!.drawImage(frame, box.x, box.y, box.size, box.size, 0, 0, out.width, out.height);
    const photo = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/jpeg", 0.92));
    return photo ? { photo, time: best.time, face: best.face } : null;
  } finally {
    detector.close();
    video.removeAttribute("src");
    video.load();
  }
}
