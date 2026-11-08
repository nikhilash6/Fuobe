import type { OutputFile } from "@/lib/catalog/types";
import { isIdol, splatFormatOf } from "./model3d";

/**
 * Looking around a Gaussian splat (idol-4). The page draws .spz / .ply / .ksplat / .splat with Spark (a three.js
 * splat renderer, loaded only when a splat opens: src/components/model3d/splat-engine.ts); a GLB keeps
 * @google/model-viewer. What decides between them, the haze cut-off a result starts with, and when the orbit
 * video stays instead (no WebGL2, reduced motion, a file too big for the device). Pure, so tests can check it.
 */

/** Which viewer draws a 3D output: the splat viewer, @google/model-viewer for a GLB, or none. */
export type Model3dViewer = "splat" | "glb";

export function viewerFor(o: Pick<OutputFile, "url" | "meta" | "kind"> | undefined): Model3dViewer | undefined {
  if (!o || o.kind !== "model3d") return undefined;
  return splatFormatOf(o) ? "splat" : "glb";
}

/**
 * The opacity a result's viewer hides Gaussians under, to start with. Idol 3D emits about half its Gaussians under
 * 0.05 (ComfyUI-Idol's README; docs/research/idol-9.md §2.4), so its results start at 0.05. TripoSplat's haze isn't
 * documented, so it starts at 0 (everything drawn) until the splat A/B (idol-3) says otherwise.
 */
export const IDOL_HAZE_CUTOFF = 0.05;
export function hazeCutoffFor(modelId: string | null | undefined): number {
  return isIdol(modelId) ? IDOL_HAZE_CUTOFF : 0;
}

/** The slider's range: 0 (draw every Gaussian) to 0.3 (only the solid ones), in steps of 0.01. */
export const HAZE_MAX = 0.3;
export const HAZE_STEP = 0.01;

/** The backgrounds behind the splat. */
export type SplatBackground = "light" | "dark" | "grey";
export const SPLAT_BACKGROUNDS: { id: SplatBackground; label: string; color: string }[] = [
  { id: "light", label: "Light", color: "#f4f4f5" },
  { id: "grey", label: "Grey", color: "#808080" },
  { id: "dark", label: "Dark", color: "#111113" },
];
export const backgroundColor = (id: SplatBackground) => SPLAT_BACKGROUNDS.find((b) => b.id === id)!.color;

/**
 * The biggest file the viewer opens: a 1,048,576-Gaussian .ply is about 71 MB (68 bytes each), an .spz about a
 * tenth. A phone (coarse pointer) stops at 48 MB, about a 700,000-Gaussian .ply; a computer at 160 MB.
 */
export const SPLAT_MAX_BYTES = { coarse: 48 * 1024 * 1024, fine: 160 * 1024 * 1024 } as const;
export const splatTooBig = (bytes: number | undefined, coarse: boolean) => bytes !== undefined && bytes > (coarse ? SPLAT_MAX_BYTES.coarse : SPLAT_MAX_BYTES.fine);

/** Why the orbit video (or picture) stays instead of the viewer, or null when the viewer can open. */
export type SplatFallback = "no-webgl2" | "too-big" | "reduced-motion";
export function splatFallback(o: { webgl2: boolean; bytes?: number; coarse: boolean; reducedMotion: boolean; asked?: boolean }): SplatFallback | null {
  if (!o.webgl2) return "no-webgl2";
  if (splatTooBig(o.bytes, o.coarse)) return "too-big";
  // Reduced motion: nothing opens by itself; "Look around" (asked) still opens it.
  if (o.reducedMotion && !o.asked) return "reduced-motion";
  return null;
}

/** What the page says for each fallback. */
export const FALLBACK_TEXT: Record<SplatFallback, string> = {
  "no-webgl2": "This browser can't draw 3D splats. Download the file to look around it in a splat viewer.",
  "too-big": "This splat is too big to open on this device. Download it to look around it in a splat viewer.",
  "reduced-motion": "",
};

/** The file name a still is saved under: the model's name, then "still". */
export const stillFileName = (name: string) => `${name.replace(/[^\w .-]+/g, "").trim() || "splat"} still.png`;

/** How a splat file stands: whether it is stored y-down, and the yaw (degrees, from +z towards +x) its front faces. */
export interface SplatPose {
  yDown: boolean;
  frontYaw: number;
}

/**
 * How a run's splat stands. ComfyUI's graphs (Idol 3D, TripoSplat: the core TripoSplat decoder, then SplatToFile3D)
 * save the 3DGS frame as it is, y down and z forward (comfy_extras/nodes_gaussian_splat.py, `_camera_basis`), so in
 * three.js (y up) the subject stands on its head. The viewer turns such a file half a turn about x, (x, y, z) to
 * (x, -y, -z), which stands it upright; the decoder then has the subject's front facing +x (yaw 90: the Idol pack's
 * preview camera, and FRONT_YAW for meshes made from the same splats), so the camera starts there. Cloud `.ply`
 * files and the demo splats (scripts/gen-demo-splat.mjs) are y-up with their front to +z, and open as they are.
 */
export function splatPose(g: { provider?: string | null } | null | undefined, file?: { url?: string; meta?: Record<string, unknown> }): SplatPose {
  const demo = file?.meta?.demo === true || !!file?.url?.startsWith("sample:");
  return g?.provider === "comfyui" && !demo ? { yDown: true, frontYaw: 90 } : { yDown: false, frontYaw: 0 };
}

export type Vec3 = [number, number, number];
export interface SplatBounds {
  min: Vec3;
  max: Vec3;
}

/**
 * The subject's box from the Gaussians' centres (x, y, z triples): on each axis, from the `trim` to the 1 - `trim`
 * quantile of the ones at least `minOpacity` opaque (all of them where too few are), so faint haze and a few
 * stray floaters don't shrink the subject in the frame or move the point it turns around. Null for no Gaussians.
 */
export function subjectBounds(centers: ArrayLike<number>, opacities: ArrayLike<number>, { minOpacity = 0.1, trim = 0.005 } = {}): SplatBounds | null {
  const n = Math.min(Math.floor(centers.length / 3), opacities.length);
  if (!n) return null;
  let keep: number[] = [];
  for (let i = 0; i < n; i++) if (opacities[i] >= minOpacity) keep.push(i);
  if (keep.length < Math.max(8, n * 0.02)) keep = Array.from({ length: n }, (_, i) => i);
  const min: Vec3 = [0, 0, 0];
  const max: Vec3 = [0, 0, 0];
  const values = new Float64Array(keep.length);
  for (let axis = 0; axis < 3; axis++) {
    keep.forEach((i, k) => (values[k] = centers[i * 3 + axis]));
    values.sort();
    const at = (q: number) => values[Math.min(values.length - 1, Math.max(0, Math.round(q * (values.length - 1))))];
    min[axis] = at(trim);
    max[axis] = at(1 - trim);
  }
  return { min, max };
}

/** The home view's elevation: a little above straight on, so the subject reads upright with a hint of its top. */
export const HOME_ELEVATION_DEG = 6;

/**
 * Where the viewer's camera starts (and Reset view returns): in front of the subject (at `frontYaw` degrees from +z
 * towards +x), a little above, at the distance where it fills `fill` of the frame both ways (`aspect` is the frame's
 * width / height, `fovDeg` the camera's vertical field of view, `room` the share of the frame's height it may take:
 * under 1 where the controls bar covers the stage's foot). Its turning point is the box's centre.
 */
export function homeView(
  b: SplatBounds,
  fovDeg: number,
  aspect: number,
  { frontYaw = 0, fill = 0.9, room = 1 }: { frontYaw?: number; fill?: number; room?: number } = {},
): { target: Vec3; position: Vec3; distance: number; size: number } {
  const size: Vec3 = [0, 1, 2].map((k) => Math.max(b.max[k] - b.min[k], 1e-3)) as Vec3;
  const target = [0, 1, 2].map((k) => (b.min[k] + b.max[k]) / 2) as Vec3;
  const yaw = (frontYaw * Math.PI) / 180;
  const [c, s] = [Math.abs(Math.cos(yaw)), Math.abs(Math.sin(yaw))];
  // The box as the camera sees it: its width across the view and its depth along it.
  const width = c * size[0] + s * size[2];
  const depth = s * size[0] + c * size[2];
  const tanV = Math.tan(((fovDeg / 2) * Math.PI) / 180);
  const tanH = tanV * (aspect > 0 && Number.isFinite(aspect) ? aspect : 1);
  const distance = Math.max(size[1] / 2 / (tanV * Math.min(Math.max(room, 0.1), 1)), width / 2 / tanH) / fill + depth / 2;
  const e = (HOME_ELEVATION_DEG * Math.PI) / 180;
  const flat = distance * Math.cos(e);
  const position: Vec3 = [target[0] + flat * Math.sin(yaw), target[1] + distance * Math.sin(e), target[2] + flat * Math.cos(yaw)];
  return { target, position, distance, size: Math.max(...size) };
}

/** Two taps (or clicks) within this many ms and px of each other: a double tap, which resets the view. */
export const DOUBLE_TAP = { ms: 320, px: 24, tapMs: 260, tapPx: 10 } as const;
