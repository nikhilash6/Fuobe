import "server-only";
import crypto from "node:crypto";
import { ANY_ANGLE, type FrontView } from "@/lib/catalog/any-angle";

export { NO_SUBJECT_MESSAGE } from "@/lib/catalog/any-angle";
import { measureFront, type Picture, type SweepFrame } from "@/lib/any-angle-front";
import type { GenerationRequest, OutputFile } from "@/lib/catalog/types";
import { db } from "./db";
import { readRef } from "./storage";

/**
 * Any Angle on the server (src/lib/catalog/any-angle.ts): the 3D view of a photo is built once per photo and person
 * (A8), and when it is done its front view is measured on the turntable it rendered.
 *
 * - The view's key is the photo's sha256 with what makes the view (the build's version, the cut-out, the seeds). The 3D
 *   build's request carries it (params.extra.viewKey); POST /api/generations answers a second build of the same photo
 *   for the same owner or account with the first one (still running, or done), whatever the photo's file is called.
 * - When the build succeeds, measureView reads its sweep (the turntable at 192 px, colour and coverage) and the cut-out,
 *   finds the camera that sees the 3D copy as the photo does (src/lib/any-angle-front.ts), and the splat's output keeps
 *   it as meta.front, with the photo's size (meta.size): every angle's camera starts from there.
 */

/** What changes the 3D view besides the photo: a view built another way is built again. */
const VIEW_RECIPE = `v${ANY_ANGLE.version}:cut:s${ANY_ANGLE.buildSeed}`;

export const viewKeyOf = (photo: Buffer): string => `${crypto.createHash("sha256").update(photo).digest("hex")}:${VIEW_RECIPE}`;

/** The key of the photo a build request names (its first image), or null when it can't be read. */
export async function requestViewKey(req: Pick<GenerationRequest, "inputs">): Promise<string | null> {
  const photo = req.inputs?.images?.[0];
  if (!photo) return null;
  try {
    return viewKeyOf((await readRef(photo)).data);
  } catch {
    return null;
  }
}

/**
 * The 3D view already built (or building) from this key for this owner (account undefined) or account: the newest one
 * that hasn't failed, been canceled or been deleted. Its id; the route reads it as the caller's generation.
 */
export function findView(key: string, account: string | undefined): string | null {
  const who = account ? "json_extract(g.request_json, '$.account') = ?" : "json_extract(g.request_json, '$.account') IS NULL";
  const rows = db()
    .prepare(
      `SELECT g.id FROM generations g LEFT JOIN generation_trash t ON t.generation_id = g.id
       WHERE g.model_id = ? AND g.status IN ('queued', 'running', 'succeeded') AND t.generation_id IS NULL
         AND json_extract(g.request_json, '$.params.extra.viewKey') = ? AND ${who}
       ORDER BY g.created_at DESC LIMIT 1`,
    )
    .all(ANY_ANGLE.buildModel, key, ...(account ? [account] : [])) as { id: string }[];
  return rows[0]?.id ?? null;
}

type Sharp = typeof import("sharp").default;

/** A still (PNG, JPEG…) as RGB or one channel: at most `size.max` px on its long side, or exactly `size`. */
async function still(sharp: Sharp, data: Buffer, channels: 1 | 3, size: { max: number } | { width: number; height: number }): Promise<Picture> {
  let s = sharp(data).rotate();
  s = "max" in size ? s.resize({ width: size.max, height: size.max, fit: "inside", withoutEnlargement: true }) : s.resize({ width: size.width, height: size.height, fit: "fill" });
  s = channels === 1 ? s.removeAlpha().greyscale() : s.removeAlpha().toColourspace("srgb");
  const { data: px, info } = await s.raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, channels: info.channels === 1 ? 1 : 3, data: px };
}

/** The photo (RGB, at most 512 px) and its cut-out at the same size: what the turntable is compared with. */
export async function photoPictures(photo: Buffer, matte: Buffer): Promise<{ rgb: Picture; mask: Picture }> {
  const sharp = (await import("sharp")).default;
  const rgb = await still(sharp, photo, 3, { max: 512 });
  return { rgb, mask: await still(sharp, matte, 1, { width: rgb.width, height: rgb.height }) };
}

/** The turntable's frames (an animated WebP) with their silhouettes (its coverage pass, when there is one). */
export async function sweepFrames(colour: Buffer, coverage?: Buffer | null): Promise<SweepFrame[]> {
  const sharp = (await import("sharp")).default;
  const turns = await frames(sharp, colour);
  const covers = coverage ? await frames(sharp, coverage) : [];
  return turns.map((f, k) => ({ rgb: f, mask: silhouette(f, covers[k]) }));
}

/** Every frame of an animated WebP, as RGB. */
async function frames(sharp: Sharp, data: Buffer): Promise<Picture[]> {
  const { data: px, info } = await sharp(data, { animated: true }).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const h = info.pageHeight ?? info.height;
  const n = Math.max(1, Math.round(info.height / h));
  const size = info.width * h * info.channels;
  const out: Picture[] = [];
  for (let k = 0; k < n; k++) {
    const rgb = new Uint8Array(info.width * h * 3);
    const at = k * size;
    for (let i = 0; i < info.width * h; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = px[at + i * info.channels + Math.min(c, info.channels - 1)];
    out.push({ width: info.width, height: h, channels: 3, data: rgb });
  }
  return out;
}

/**
 * A frame's silhouette: the coverage RenderSplat gave, else (a coverage pass that came back empty or full) the pixels
 * that differ from the turntable's dark background.
 */
function silhouette(rgb: Picture, coverage: Picture | undefined): Picture {
  const n = rgb.width * rgb.height;
  const m = new Uint8Array(n);
  let on = 0;
  if (coverage && coverage.width === rgb.width && coverage.height === rgb.height) {
    for (let i = 0; i < n; i++) {
      m[i] = coverage.data[i * 3] > 127 ? 255 : 0;
      if (m[i]) on++;
    }
    if (on > n * 0.002 && on < n * 0.98) return { width: rgb.width, height: rgb.height, channels: 1, data: m };
  }
  for (let i = 0; i < n; i++) m[i] = Math.max(rgb.data[i * 3], rgb.data[i * 3 + 1], rgb.data[i * 3 + 2]) > 28 ? 255 : 0;
  return { width: rgb.width, height: rgb.height, channels: 1, data: m };
}

const byRole = (outputs: OutputFile[], role: string) => outputs.find((o) => o.meta?.role === role);

/** The photo's size and its front view, from a finished build's outputs; null when they can't be read or compared. */
export async function measureView(photo: string, outputs: OutputFile[]): Promise<{ front: FrontView; size: { width: number; height: number } } | null> {
  const sweep = byRole(outputs, "sweep");
  const cover = byRole(outputs, "sweep-mask");
  const matte = byRole(outputs, "matte");
  if (!sweep || !matte) return null;
  const sharp = (await import("sharp")).default;
  const [src, cut, colour, coverage] = await Promise.all([readRef(photo), readRef(matte.url), readRef(sweep.url), cover ? readRef(cover.url) : null]);
  const meta = await sharp(src.data).rotate().metadata();
  const flip = (meta.orientation ?? 1) >= 5;
  const size = { width: (flip ? meta.height : meta.width) ?? 0, height: (flip ? meta.width : meta.height) ?? 0 };
  if (!size.width || !size.height) return null;
  // The photo at the turntable's scale (the measure crops both to the subject first, so only the shape matters).
  const front = measureFront(await photoPictures(src.data, cut.data), await sweepFrames(colour.data, coverage?.data));
  return front ? { front, size } : null;
}

/**
 * After a build's outputs are stored: its splat output with the measured front view and the photo's size (meta.front,
 * meta.size). Null when nothing could be measured (the build fails, saying so).
 */
export async function withFrontView(request: Pick<GenerationRequest, "inputs">, outputs: OutputFile[]): Promise<OutputFile[] | null> {
  const photo = request.inputs?.images?.[0];
  const splat = byRole(outputs, "splat");
  if (!photo || !splat) return null;
  const view = await measureView(photo, outputs).catch((e) => {
    console.warn(`[fuobe] any-angle: couldn't measure the front view: ${(e as Error).message}`);
    return null;
  });
  if (!view) return null;
  return outputs.map((o) => (o === splat ? { ...o, meta: { ...o.meta, front: view.front, size: view.size } } : o));
}
