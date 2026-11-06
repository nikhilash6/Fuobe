import "server-only";
import sharp from "sharp";
import { STILL_LIMITS, stillPlan, stillProblem, type StillFormat } from "@/lib/catalog/still-limits";
import { imageSize } from "@/lib/image-size";

/**
 * A still fitted to the limits its endpoint documents (src/lib/catalog/still-limits.ts) before it's uploaded: a copy at
 * a size, in a format and without alpha the endpoint takes. One it can't take even then is refused in Fuobe's words, so
 * the run fails before it's queued and paid for. Anything that isn't a picture, a picture whose size can't be read, and
 * an endpoint with no stated limits pass through as they are.
 */
type StillFile = { data: Buffer; contentType: string; name: string };

const formatOf = (contentType: string): StillFormat =>
  /png/i.test(contentType) ? "png" : /jpe?g/i.test(contentType) ? "jpeg" : /webp/i.test(contentType) ? "webp" : /gif/i.test(contentType) ? "gif" : /svg/i.test(contentType) ? "svg" : "other";

export async function fitStill(endpoint: string, f: StillFile): Promise<StillFile> {
  if (!STILL_LIMITS[endpoint] || !/^image\//i.test(f.contentType)) return f;
  const size = imageSize(f.data);
  if (!size) return f;
  const plan = stillPlan(endpoint, { ...size, bytes: f.data.length, format: formatOf(f.contentType) });
  let out = f;
  if (plan) {
    let img = sharp(f.data);
    if (plan.resize) img = img.resize(plan.resize.width, plan.resize.height, { fit: "fill" });
    // (A copy of a GIF or SVG, which sharp can't write, is a PNG.)
    const own = formatOf(f.contentType);
    const to = plan.toFormat ?? (own === "jpeg" || own === "webp" ? own : "png");
    // A JPEG has no alpha: a cut-out is set on white, as a picture without alpha is, never on black.
    if (plan.flatten || to === "jpeg") img = img.flatten({ background: "#ffffff" });
    img = to === "png" ? img.png() : to === "webp" ? img.webp({ quality: 92 }) : img.jpeg({ quality: 92 });
    out = { data: await img.toBuffer(), contentType: `image/${to}`, name: `${f.name.replace(/\.[^.]+$/, "")}.${to === "jpeg" ? "jpg" : to}` };
  }
  const now = imageSize(out.data);
  const problem = now ? stillProblem(endpoint, { ...now, bytes: out.data.length, format: formatOf(out.contentType) }) : null;
  if (problem) throw new Error(problem);
  return out;
}
