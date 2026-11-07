#!/usr/bin/env node
/**
 * Fuobe FX's cover pairs: for each FX item (src/lib/fx-tools.ts), a before and an after still with the same framing and
 * size, so a divider drawn over them lines up pixel for pixel. Made from an example's own input and the real output of
 * that tool (or, for a mode that borrows an app's cover, that app's before/after masters).
 *
 * Output, per item id, in public/previews/fx/<id>/:
 *   before.480.webp, after.480.webp      480x360 (40 KB at most each), and the same as .avif
 *   before.960.webp, after.960.webp      960x720 for 2x screens, and the same as .avif
 *   kind "matte":   the after is the cut-out on transparency (WebP and AVIF with alpha)
 *   kind "depth":   the after is the depth pass
 *   kind "loupe":   also before.loupe.webp and after.loupe.webp (240x240, and .loupe2x.webp at 480x480): the same 1:1
 *                   detail of the after at its own resolution, and of the before enlarged to it
 *   kind "strip":   also strip.webp: 6 frames of the real output clip side by side (each 480x360), in time order
 *   kind "reframe": also wide.480.webp / wide.960.webp, the before as a 16:9 still, and `rect`, the 9:16 crop's box in
 *                   it (fractions x, y, w, h), centred on `focus`
 * and src/lib/fx-pairs.generated.ts: { "<id>": { v, kind, rect? } }, v the content version every URL ends in (?v=).
 *
 * A sources file lists the pairs (it names files on the machine that makes them, so it stays outside the repository):
 *   [{ "id": "video-tools-depth", "kind": "depth", "before": { "from": "<clip or still>", "at": 2.5 },
 *      "after": { "from": "<clip or still>", "at": 2.5 }, "focus": [0.5, 0.4], "loupe": [x, y], "strip": { "from": "<clip>" },
 *      "rect": [x, y, w, h] }]
 * "from" is a path, or a public path ("/examples/…"); "at" is seconds into a clip ("last" for its last frame); "focus"
 * is where the 4:3 crop centres (fractions, default the middle). Both stills take the same crop.
 *
 * Run: node scripts/gen-fx-pairs.mjs --sources <file>   (re)makes the listed ids, keeps the others
 *      node scripts/gen-fx-pairs.mjs -<id> …           takes these out, with their files
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const OUT = path.join(PUBLIC, "previews", "fx");
const MANIFEST = path.join(ROOT, "src", "lib", "fx-pairs.generated.ts");
const SIZES = [
  { tag: "480", w: 480, h: 360, maxBytes: 40_000 },
  { tag: "960", w: 960, h: 720, maxBytes: 140_000 },
];
const KINDS = ["pair", "matte", "depth", "loupe", "strip", "reframe"];

const fromPath = (p) => (p.startsWith("/") && !/^\/[a-z]:/i.test(p) && fs.existsSync(path.join(PUBLIC, p)) ? path.join(PUBLIC, p) : p);
const isClip = (p) => /\.(mp4|webm|mov|mkv)$/i.test(p);

/** A frame of a clip (RGBA, so a cut-out keeps its alpha) or a still, as a PNG buffer. */
function frame(src, at = 0) {
  const file = fromPath(src);
  if (!fs.existsSync(file)) throw new Error(`${src}: no such file`);
  if (!isClip(file)) return fs.readFileSync(file);
  const out = path.join(os.tmpdir(), `fuobe-fx-pair-${process.pid}-${Date.now()}.png`);
  const seek = at === "last" ? ["-sseof", "-0.08"] : ["-ss", String(at)];
  // A VP9 clip with alpha decodes its alpha only with libvpx.
  const dec = /\.webm$/i.test(file) ? ["-c:v", "libvpx-vp9"] : [];
  execFileSync("ffmpeg", ["-v", "error", "-y", ...seek, ...dec, "-i", file, "-frames:v", "1", "-pix_fmt", "rgba", out]);
  const data = fs.readFileSync(out);
  fs.rmSync(out, { force: true });
  return data;
}

/** The 4:3 box (in the image's pixels) both stills take: as large as fits, centred on `focus`. */
async function box4x3(buf, focus = [0.5, 0.5]) {
  const { width: W, height: H } = await sharp(buf).metadata();
  let w = W;
  let h = Math.round((W * 3) / 4);
  if (h > H) {
    h = H;
    w = Math.round((H * 4) / 3);
  }
  const left = Math.min(W - w, Math.max(0, Math.round(focus[0] * W - w / 2)));
  const top = Math.min(H - h, Math.max(0, Math.round(focus[1] * H - h / 2)));
  return { left, top, width: w, height: h, W, H };
}

/** The same region of an image of another size (an upscale's before is smaller than its after). */
const scaleBox = (b, W, H) => ({ left: Math.round((b.left * W) / b.W), top: Math.round((b.top * H) / b.H), width: Math.round((b.width * W) / b.W), height: Math.round((b.height * H) / b.H) });

async function fitting(make, qualities, maxBytes) {
  let out;
  for (const q of qualities) {
    out = await make(q);
    if (out.length <= maxBytes) return out;
  }
  return out;
}

async function encode(img, size, alpha) {
  const webp = await fitting((q) => img.clone().webp({ quality: q, alphaQuality: 90, effort: 6 }).toBuffer(), [82, 76, 70, 64, 58, 52], size.maxBytes);
  const avif = await fitting((q) => img.clone().avif({ quality: q, effort: 6 }).toBuffer(), [60, 54, 48, 42], size.maxBytes);
  if (webp.length > size.maxBytes) throw new Error(`a ${size.tag} still is ${webp.length} bytes, over ${size.maxBytes}`);
  return { webp, avif, alpha };
}

async function still(buf, region, size, { alpha = false } = {}) {
  let img = sharp(buf).extract(region).resize(size.w, size.h, { fit: "fill", kernel: "lanczos3" });
  img = alpha ? img.ensureAlpha() : img.removeAlpha().toColorspace("srgb");
  return encode(img, size, alpha);
}

async function make(src) {
  if (!/^[a-z0-9-]+$/.test(src.id)) throw new Error(`${src.id}: an id is an FX item's id`);
  const kind = src.kind ?? "pair";
  if (!KINDS.includes(kind)) throw new Error(`${src.id}: kind ${kind} is not one of ${KINDS.join(", ")}`);
  const before = frame(src.before.from, src.before.at);
  const after = frame(src.after.from, src.after.at ?? src.before.at);
  const a = await sharp(after).metadata();
  const box = await box4x3(after, src.focus);
  const b = await sharp(before).metadata();
  const beforeBox = scaleBox(box, b.width, b.height);
  const files = {};
  for (const size of SIZES) {
    const B = await still(before, beforeBox, size);
    const A = await still(after, box, size, { alpha: kind === "matte" });
    files[`before.${size.tag}.webp`] = B.webp;
    files[`before.${size.tag}.avif`] = B.avif;
    files[`after.${size.tag}.webp`] = A.webp;
    files[`after.${size.tag}.avif`] = A.avif;
  }
  const entry = { kind };
  if (kind === "loupe") {
    // A square of the after at its own resolution (a quarter of its height), and the same square of the before enlarged.
    const s = Math.round(a.height / 4);
    const [fx, fy] = src.loupe ?? [0.5, 0.4];
    const L = { left: Math.min(a.width - s, Math.max(0, Math.round(fx * a.width - s / 2))), top: Math.min(a.height - s, Math.max(0, Math.round(fy * a.height - s / 2))), width: s, height: s };
    const bigBefore = await sharp(before).resize(a.width, a.height, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
    for (const [tag, px] of [["loupe", 240], ["loupe2x", 480]]) {
      const enc = async (buf) => (await fitting((q) => sharp(buf).extract(L).resize(px, px, { kernel: "lanczos3" }).removeAlpha().webp({ quality: q }).toBuffer(), [86, 80, 74, 68], px === 240 ? 30_000 : 90_000));
      files[`before.${tag}.webp`] = await enc(bigBefore);
      files[`after.${tag}.webp`] = await enc(after);
    }
    entry.loupe = [L.left / a.width, L.top / a.height, L.width / a.width, L.height / a.height].map((x) => Math.round(x * 10000) / 10000);
  }
  if (kind === "strip") {
    const clip = fromPath((src.strip ?? src.after).from);
    const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", clip]).toString());
    const tiles = [];
    for (let i = 0; i < 6; i++) {
      const t = ((i + 0.5) * dur) / 6;
      const f = frame(clip, t.toFixed(3));
      const fb = await box4x3(f, src.focus);
      tiles.push({ input: await sharp(f).extract(fb).resize(480, 360, { kernel: "lanczos3" }).removeAlpha().png().toBuffer(), left: i * 480, top: 0 });
    }
    const sheet = sharp({ create: { width: 480 * 6, height: 360, channels: 3, background: "#000" } }).composite(tiles).png();
    const png = await sheet.toBuffer();
    files["strip.webp"] = await fitting((q) => sharp(png).webp({ quality: q, effort: 6 }).toBuffer(), [78, 72, 66, 60, 54], 200_000);
    entry.frames = 6;
  }
  if (kind === "reframe") {
    // The wide still (16:9, the before's middle band) and the tall 9:16 box in it, centred on `focus`'s x.
    const { width: W, height: H } = await sharp(before).metadata();
    const wh = Math.min(H, Math.round((W * 9) / 16));
    const wide = { left: 0, top: Math.round((H - wh) / 2), width: W, height: wh };
    for (const [tag, w, max] of [["480", 480, 40_000], ["960", 960, 140_000]]) {
      const h = Math.round((w * 9) / 16);
      files[`wide.${tag}.webp`] = await fitting((q) => sharp(before).extract(wide).resize(w, h, { fit: "fill", kernel: "lanczos3" }).removeAlpha().webp({ quality: q }).toBuffer(), [82, 76, 70, 64], max);
    }
    const rw = (wh * 9) / 16 / W;
    const cx = (src.focus ?? [0.5])[0];
    const rx = Math.min(1 - rw, Math.max(0, cx - rw / 2));
    entry.rect = [rx, 0, rw, 1].map((x) => Math.round(x * 10000) / 10000);
  }
  return { entry, files };
}

function readManifest() {
  if (!fs.existsSync(MANIFEST)) return {};
  const m = /FX_PAIRS: Record<string, FxPair> = (\{[\s\S]*\});\s*$/.exec(fs.readFileSync(MANIFEST, "utf8"));
  return m ? JSON.parse(m[1]) : {};
}

function writeManifest(pairs) {
  const sorted = Object.fromEntries(Object.keys(pairs).sort().map((k) => [k, pairs[k]]));
  const head = `/**
 * Fuobe FX's cover pairs, by FX item id (src/lib/fx-tools.ts): public/previews/fx/<id>/before.480.webp and after.480.webp
 * (480x360, the same framing, so a divider lines up), the same at 960x720 (.960.webp), and each as .avif. "matte": the
 * after is a cut-out with alpha. "depth": the after is the depth pass. "loupe": also before.loupe.webp / after.loupe.webp
 * (240x240; .loupe2x.webp 480x480), a 1:1 detail of the after and the before enlarged to it, at \`loupe\` (fractions
 * x, y, w, h of the frame). "strip": also strip.webp, 6 frames of the output clip side by side, 480x360 each.
 * "reframe": also wide.480.webp / wide.960.webp (the before at 16:9), and \`rect\` is the 9:16 crop's box in it (fractions). Every URL ends in ?v=<v>. Generated by
 * scripts/gen-fx-pairs.mjs: run it again rather than editing.
 */
export interface FxPair {
  v: string;
  kind: "pair" | "matte" | "depth" | "loupe" | "strip" | "reframe";
  loupe?: [number, number, number, number];
  frames?: number;
  rect?: [number, number, number, number];
}

/** An FX item's pair file, versioned: fxPairSrc("video-tools-depth", "after.480.webp"). */
export const fxPairSrc = (id: string, file: string): string | undefined => (FX_PAIRS[id] ? \`/previews/fx/\${id}/\${file}?v=\${FX_PAIRS[id].v}\` : undefined);

`;
  fs.writeFileSync(MANIFEST, `${head}export const FX_PAIRS: Record<string, FxPair> = ${JSON.stringify(sorted, null, 1)};\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const pairs = readManifest();
  for (const a of args.filter((x) => /^-[a-z0-9]/.test(x) && !x.startsWith("--"))) {
    const id = a.slice(1);
    fs.rmSync(path.join(OUT, id), { recursive: true, force: true });
    delete pairs[id];
  }
  const i = args.indexOf("--sources");
  if (i >= 0) {
    for (const src of JSON.parse(fs.readFileSync(args[i + 1], "utf8"))) {
      const { entry, files } = await make(src);
      const dir = path.join(OUT, src.id);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const hash = crypto.createHash("sha256");
      for (const name of Object.keys(files).sort()) {
        fs.writeFileSync(path.join(dir, name), files[name]);
        hash.update(name).update(files[name]);
      }
      pairs[src.id] = { v: hash.digest("hex").slice(0, 8), ...entry };
      const kb = Object.entries(files).filter(([n]) => n.endsWith(".480.webp")).map(([n, d]) => `${n} ${(d.length / 1000).toFixed(0)} KB`);
      console.log(`${src.id} (${entry.kind}): ${kb.join(", ")}`);
    }
  }
  writeManifest(pairs);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
