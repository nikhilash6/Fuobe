#!/usr/bin/env node
/**
 * Larger copies of preset covers, for boxes wider than the 512 px clip and still (a starter card, a preset header, a
 * 2x or 3x screen): the clip, its poster and its peak frame at more widths, made from the render the published cover
 * was cut from rather than enlarged from the 512 px copy.
 *
 * Input: a masters folder with a folder per preset id holding clip.mp4 (the render) and, as pnpm eval:covers reads
 * it, an optional meta.json (`{"length": "full"}`). The clip is cut and looped as the published one (coverLoop in
 * scripts/eval/lib/covers.mjs), so every copy has the same frames at the same times.
 *
 * Output, for each width W in CLIP_WIDTHS up to the render's own width:
 *   public/previews/presets/hd/<W>/<id>.mp4          H.264 High, BT.709 tags, its index at the front
 *   public/previews/presets/hd/<W>/<id>.avif, .jpg   the poster: the clip's first frame (or the frame it rests on)
 *   public/previews/presets/hd/<W>/peak/<id>.avif, .jpg   the peak frame (preset-peaks.generated.ts), when it has one
 * and AVIF copies of both stills at SMALL_PX (hd/320/), so a small tile on a browser that takes AVIF stays small.
 *   src/lib/preset-hd.generated.ts                   { "<id>": { w: [<widths>], v: "<version>" } }
 * The stills are decoded from the encoded clip the way a browser shows it, so the swap from still to clip can't be seen.
 *
 * Check: before anything is written, each poster and peak is compared with the published 512 px one (the mean
 * difference of 128x96 grey copies, at most MATCH): a copy that doesn't show what the card shows fails the run.
 *
 * A render no wider than 512 px has nothing to add: the run lists it as needing a new render and goes on.
 *
 * Run: node scripts/gen-preset-hd.mjs --masters <dir> <id> …   make these
 *      node scripts/gen-preset-hd.mjs -<id> …                  take these out, with their files
 *      node scripts/gen-preset-hd.mjs --versions               hash only
 *      --dry-run makes and checks, and writes nothing.
 * Needs ffmpeg on PATH (or FUOBE_FFMPEG).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { CLIP_FPS, contentVersion, coverLoop } from "./eval/lib/covers.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRESETS = path.join(ROOT, "public", "previews", "presets");
const OUT_DIR = path.join(PRESETS, "hd");
const OUT_TS = path.join(ROOT, "src", "lib", "preset-hd.generated.ts");
const PEAKS_TS = path.join(ROOT, "src", "lib", "preset-peaks.generated.ts");
/** The copies' widths (4:3): a 440 px card on a 2x screen takes 1024, a phone's half-width tile 640. */
const CLIP_WIDTHS = [640, 1024];
/** The small AVIF stills' width, as the JPEG thumbs' (thumbOf). */
const SMALL_PX = 320;
/** The published copies' width: a render no wider has nothing to add. */
const PUBLISHED_PX = 512;
/** CRF per width: the larger copy is seen larger, so it keeps more. */
const CRF = { 640: 24, 1024: 23 };
const AVIF_QUALITY = 62;
const JPEG_QUALITY = 82;
/** How far (of 255) a copy may differ from the published still, on average: another frame is 10 and more. */
const MATCH = 6;
/** The colours every clip is tagged with (libx264 takes them as its own options): its stills are decoded the same way. */
const BT709 = ["-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709", "-color_range", "tv"];

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const mastersAt = argv.indexOf("--masters");
const MASTERS = mastersAt >= 0 ? argv[mastersAt + 1] : undefined;
const named = argv.filter((a, i) => !a.startsWith("--") && (mastersAt < 0 || i !== mastersAt + 1));

const tool = (name, args, input) => {
  const r = spawnSync(process.env[name === "ffmpeg" ? "FUOBE_FFMPEG" : "FUOBE_FFPROBE"] ?? name, args, { input, maxBuffer: 1 << 30 });
  if (r.error?.code === "ENOENT") throw new Error(`gen-preset-hd needs ${name} on PATH`);
  if (r.status !== 0) throw new Error(`${name} failed: ${String(r.stderr).trim().split("\n").at(-1)}`);
  return r.stdout;
};

const readTs = (file) => {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, "utf8");
  return JSON.parse(text.slice(text.indexOf("= {") + 2, text.lastIndexOf("}") + 1));
};

const rel = (w, id, ext, peak = false) => path.join(OUT_DIR, String(w), ...(peak ? ["peak"] : []), `${id}.${ext}`);

/** Every file an entry has, in a fixed order (its version is theirs). */
function filesOf(id, entry, hasPeak) {
  const out = [];
  for (const w of entry.w) out.push(rel(w, id, "mp4"), rel(w, id, "avif"), rel(w, id, "jpg"), ...(hasPeak ? [rel(w, id, "avif", true), rel(w, id, "jpg", true)] : []));
  out.push(rel(SMALL_PX, id, "avif"), ...(hasPeak ? [rel(SMALL_PX, id, "avif", true)] : []));
  return out;
}

/** The render's width. */
const widthOf = (file) => Number(String(tool("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", file])).trim());

/** Frame `n` of an encoded clip as a PNG, decoded as a browser shows it (BT.709, limited range). */
const frameOf = (file, n) =>
  tool("ffmpeg", ["-v", "error", "-i", file, "-vf", `select=eq(n\\,${n}),scale=in_color_matrix=bt709:in_range=tv:flags=accurate_rnd+full_chroma_int+lanczos,format=rgb24`, "-frames:v", "1", "-c:v", "png", "-f", "image2pipe", "-"]);

/** Mean difference (of 255) between two pictures' 128x96 grey copies. */
async function gap(a, b) {
  const grey = (x) => sharp(x).resize(128, 96, { fit: "fill" }).greyscale().raw().toBuffer();
  const [p, q] = await Promise.all([grey(a), grey(b)]);
  let sum = 0;
  for (let i = 0; i < p.length; i++) sum += Math.abs(p[i] - q[i]);
  return sum / p.length;
}

function readMeta(folder) {
  try {
    return JSON.parse(fs.readFileSync(path.join(folder, "meta.json"), "utf8")) ?? {};
  } catch {
    return {};
  }
}

const hd = readTs(OUT_TS);
const peaks = readTs(PEAKS_TS);
const reRender = [];

async function make(id) {
  if (!MASTERS) throw new Error(`${id}: copies are made from the renders: run with --masters <dir>`);
  const folder = path.join(MASTERS, id);
  const src = path.join(folder, "clip.mp4");
  if (!fs.existsSync(src)) throw new Error(`${id}: no ${src}`);
  const own = widthOf(src);
  if (own <= PUBLISHED_PX) {
    reRender.push(`${id} (its render is ${own} px wide)`);
    return;
  }
  const widths = [...new Set(CLIP_WIDTHS.map((w) => Math.min(w, own)))].filter((w) => w > PUBLISHED_PX);
  const meta = readMeta(folder);
  const opts = meta.length === "full" ? { length: "full" } : {};
  const peak = peaks[id];
  const published = { poster: path.join(PRESETS, `${id}.jpg`), peak: path.join(PRESETS, "peak", `${id}.jpg`) };
  const made = new Map();
  let largest;
  for (const w of widths) {
    const { looped, rest, stream } = coverLoop(src, opts, `scale=${w}:-2:flags=lanczos`);
    const tmp = path.join(os.tmpdir(), `gen-preset-hd-${process.pid}-${w}.mp4`);
    try {
      tool("ffmpeg", ["-v", "error", "-y", "-f", "yuv4mpegpipe", "-i", "-", "-an", "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-tune", "film", "-crf", String(CRF[w] ?? 23), "-g", String(2 * CLIP_FPS), "-pix_fmt", "yuv420p", ...BT709, "-map_metadata", "-1", "-movflags", "+faststart", tmp], stream(looped));
      made.set(rel(w, id, "mp4"), fs.readFileSync(tmp));
      const stills = [{ kind: "poster", n: rest ?? 0 }, ...(peak ? [{ kind: "peak", n: Math.round(peak.at * CLIP_FPS - 0.5) }] : [])];
      for (const s of stills) {
        const png = frameOf(tmp, s.n);
        const d = await gap(png, published[s.kind]);
        console.log(`${id} ${w} ${s.kind} (frame ${s.n}): differs ${d.toFixed(2)} from the published one`);
        if (d > MATCH) throw new Error(`${id}: its ${w} px ${s.kind} differs ${d.toFixed(2)} (> ${MATCH}) from the published one: check the render`);
        const peakSide = s.kind === "peak";
        made.set(rel(w, id, "avif", peakSide), await sharp(png).avif({ quality: AVIF_QUALITY, effort: 6 }).toBuffer());
        made.set(rel(w, id, "jpg", peakSide), await sharp(png).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer());
        if (w === widths.at(-1)) largest = { ...(largest ?? {}), [s.kind]: png };
      }
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  for (const [kind, png] of Object.entries(largest)) made.set(rel(SMALL_PX, id, "avif", kind === "peak"), await sharp(png).resize(SMALL_PX).avif({ quality: AVIF_QUALITY, effort: 6 }).toBuffer());
  for (const [file, buf] of made) {
    console.log(`  ${path.relative(PRESETS, file).split(path.sep).join("/")}  ${(buf.length / 1024).toFixed(1)} KB`);
    if (DRY) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
  }
  if (!DRY) hd[id] = { w: widths };
}

for (const arg of named) {
  if (arg.startsWith("-")) {
    const id = arg.slice(1);
    if (hd[id] && !DRY) for (const f of filesOf(id, hd[id], true)) fs.rmSync(f, { force: true });
    delete hd[id];
    console.log(`${id}: taken out`);
    continue;
  }
  await make(arg);
}
if (reRender.length) console.log(`needs a new render (nothing larger than ${PUBLISHED_PX} px): ${reRender.join(", ")}`);

if (!DRY) {
  const sorted = Object.entries(hd)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, e]) => {
      const files = filesOf(id, e, Boolean(peaks[id]));
      const missing = files.filter((f) => !fs.existsSync(f));
      if (missing.length) throw new Error(`${id}: ${missing.length} of its copies are missing (${path.relative(ROOT, missing[0])}): make it again, or take it out with -${id}`);
      return [id, { w: e.w, v: contentVersion(files) }];
    });
  fs.writeFileSync(
    OUT_TS,
    `/**
 * Larger copies of preset covers (public/previews/presets/hd/<w>/): the clip, its poster and its peak frame at each
 * width in \`w\` (H.264; AVIF and JPEG stills), and AVIF stills at 320 px. \`v\` is the content version every copy's URL
 * ends in (?v=), so copies made again get new URLs. Read through src/lib/preset-hd.ts. Generated by
 * scripts/gen-preset-hd.mjs: run it again rather than editing.
 */
export const PRESET_HD: Record<string, { w: number[]; v: string }> = {
${sorted.map(([id, e]) => `  ${JSON.stringify(id)}: { "w": ${JSON.stringify(e.w)}, "v": ${JSON.stringify(e.v)} }`).join(",\n")}
};
`,
  );
  console.log(`wrote ${sorted.length} entries`);
}
