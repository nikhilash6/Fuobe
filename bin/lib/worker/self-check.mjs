// The worker's self-check of its face detector (docs/gpu-workers.md). Fix faces and the other face jobs find faces with
// H3-FaceRefine's YOLO detector. If that detector gives wrong boxes in a running ComfyUI, its face jobs finish and
// change nothing. So the worker runs the detector on one fixed photo (its face is about 168 px tall): after each start
// of its ComfyUI, and before each job that detects faces. It takes about a second. A reading outside FACE_RANGE starts
// its ComfyUI again, then checks once more; a second failure gives the job back to the line, and the worker pauses
// itself ("self-check") for an hour.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The fixed photo: one face, about 168 px tall in the detector's boxes. */
export const SELF_CHECK_PHOTO = path.join(here, "self-check-face.jpg");
/** The photo's name in its ComfyUI's input folder. */
export const SELF_CHECK_INPUT = "fuobe-self-check.jpg";
/** The face heights (px) that pass. */
export const FACE_RANGE = { min: 150, max: 190 };
/** The pack whose detector it checks, by its folder name. */
export const FACE_PACK = "ComfyUI-H3-FaceRefine";
/** The nodes that run that detector: a job with one of them is a face job. */
export const FACE_NODES = new Set(["H3FaceTrackCrop", "H3FaceSelect"]);
/** The detector, as the Fix faces graph names it. */
export const FACE_DETECTOR = "bbox\\face_yolov8m.pt";
/** How long one check may take, at most. */
export const SELF_CHECK_MS = 60_000;

/** Does this graph detect faces with the checked detector? */
export function detectsFaces(graph) {
  return Object.values(graph ?? {}).some((n) => FACE_NODES.has(n?.class_type));
}

/**
 * The check's graph: the photo, the detector's tracking node on it, and its report as text. `n` changes with each check:
 * fallback_head_frac only matters with a body detector (none here), and a new value makes ComfyUI run the detector
 * again, not answer from its cache of the last check.
 */
export function selfCheckGraph(n = 0) {
  return {
    "1": { class_type: "LoadImage", inputs: { image: SELF_CHECK_INPUT } },
    "2": {
      class_type: "H3FaceTrackCrop",
      inputs: {
        images: ["1", 0],
        detector: FACE_DETECTOR,
        confidence: 0.35,
        fallback_detector: "none",
        fallback_head_frac: 0.5 + (Math.abs(Math.trunc(n)) % 1000) / 100_000,
        crop_factor: 2.5,
        canvas_width: 512,
        canvas_height: 512,
        canvas_mode: "manual",
        smooth_window: 21,
        size_smooth_window: 51,
        smooth_method: "gaussian",
        size_mode: "per_frame",
        identity_track: false,
        identity_threshold: 0.28,
        select: "largest_face",
      },
    },
    "3": { class_type: "PreviewAny", inputs: { source: ["2", 3] } },
  };
}

/** The face heights in the tracking node's report ("face height  min=168px  mean=168px  max=168px"), or null. */
export function faceHeight(report) {
  const m = /face height\s+min=(-?\d+(?:\.\d+)?)px\s+mean=(-?\d+(?:\.\d+)?)px\s+max=(-?\d+(?:\.\d+)?)px/.exec(String(report ?? ""));
  return m ? { min: Number(m[1]), mean: Number(m[2]), max: Number(m[3]) } : null;
}

/** Does this reading pass? Every frame's height (one frame here) has to be inside FACE_RANGE. */
export const facePasses = (h) => !!h && h.min >= FACE_RANGE.min && h.max <= FACE_RANGE.max;

/**
 * One check on its ComfyUI. `fetchFn(url, init)`: a request to its own ComfyUI (its key goes with it); `base`: its
 * address. Returns { ok, height (px, the mean; null when there was no reading), why (when not ok) }:
 * "upload", "refused", "failed", "timeout", "no-report", "height".
 */
export async function runSelfCheck(fetchFn, base, o = {}) {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const photo = o.photo ?? fs.readFileSync(SELF_CHECK_PHOTO);
  const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const form = new FormData();
  form.append("image", new Blob([photo], { type: "image/jpeg" }), SELF_CHECK_INPUT);
  form.append("overwrite", "true");
  form.append("type", "input");
  const up = await fetchFn(`${base}/upload/image`, { method: "POST", body: form }).catch(() => null);
  if (!up?.ok) return { ok: false, height: null, why: "upload" };
  const sent = await fetchFn(`${base}/prompt`, json({ prompt: selfCheckGraph(o.n ?? 0), client_id: o.clientId ?? "fuobe-self-check" })).catch(() => null);
  const id = sent?.ok ? (await sent.json().catch(() => ({})))?.prompt_id : null;
  if (typeof id !== "string" || !id) return { ok: false, height: null, why: "refused" };
  const until = now() + (o.timeoutMs ?? SELF_CHECK_MS);
  let entry = null;
  while (now() < until) {
    const r = await fetchFn(`${base}/history/${encodeURIComponent(id)}`).catch(() => null);
    const h = r?.ok ? await r.json().catch(() => null) : null;
    if (h?.[id]) {
      entry = h[id];
      break;
    }
    await sleep(o.pollMs ?? 250);
  }
  // Nothing of the check stays in its history.
  await fetchFn(`${base}/history`, json({ delete: [id] })).catch(() => null);
  if (!entry) {
    await fetchFn(`${base}/interrupt`, json({ prompt_id: id })).catch(() => null);
    return { ok: false, height: null, why: "timeout" };
  }
  if (entry.status?.status_str === "error") return { ok: false, height: null, why: "failed" };
  const text = entry.outputs?.["3"]?.text;
  const h = faceHeight(Array.isArray(text) ? text.join("\n") : text);
  if (!h) return { ok: false, height: null, why: "no-report" };
  return facePasses(h) ? { ok: true, height: h.mean } : { ok: false, height: h.mean, why: "height" };
}
