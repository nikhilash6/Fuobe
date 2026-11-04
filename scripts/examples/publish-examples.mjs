#!/usr/bin/env node
/**
 * Publishes the files the pages' examples show and load (src/lib/examples/plan.json), then writes their manifest
 * (src/lib/examples/media.generated.ts): every file a run may read ("in") and every display copy ("show"), with its type,
 * size, hash, version (?v=) and size in pixels. CPU only (sharp, and ffmpeg for a clip's frame).
 *
 *   node scripts/examples/publish-examples.mjs                      # the manifest, from plan.json and public/
 *   node scripts/examples/publish-examples.mjs --sources <file>     # make the web copies first
 *
 * A sources file lists the copies to make: [{ "to": "/examples/<slug>/<n>/in-image.jpg", "from": "<a file>", "op": "…" }]
 *   still-in    a picture a run reads: JPEG q86 (less for a busy picture, to stay under 300 KB), sRGB, no metadata,
 *               1280 px on its long side at most (never enlarged), plus its inset copy (<name>.384.webp, 40 KB at most)
 *   frame-in    the same from a clip's first frame ("at": "last" for its last)
 *   mask-in     a painted area: a black-and-white PNG, as it is
 *   still-out   a picture shown as an output: JPEG q84, 960 px at most, plus its poster (<name>.512.webp)
 *   clip-show   a before → after loop shown as an output (a Genjutsu mode's example): "before" (the clip that went in)
 *               and "after" (the result) baked into one muted H.264 mp4, 1024×768, 24 fps, 1.2 MB at most, as "layout":
 *               "inset" (the result fills the frame, the clip plays in a rounded window bottom-left) or "wipe" (the clip
 *               for 1 s, then a thin line sweeps left to right over 1.4 s and leaves the result). Plus its first frame
 *               (<name>.poster.webp, 1024 px, so the loop starts with no jump) and the result near its end
 *               (<name>.peak.webp, 512 px: where a card rests, and what reduced motion shows)
 * A published file is never replaced or removed (a run may name it): a copy whose file exists with other bytes stops
 * the script. A new version gets a new path. A file a run reads sits under /examples/ or /samples/ only: a still from
 * elsewhere in public/ (a preset's before/after, which its own script rewrites) is copied in first.
 *
 * A clip's card rests on its peak frame: scripts/examples/cut-example-peaks.mjs cuts the ones the covers lack (a row's
 * `rest`), and this lists them too.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC = path.join(ROOT, "public");
const PLAN = path.join(ROOT, "src/lib/examples/plan.json");
const MANIFEST = path.join(ROOT, "src/lib/examples/media.generated.ts");

const TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", m4a: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav", glb: "model/gltf-binary" };
const typeOf = (p) => TYPES[p.split(".").pop().toLowerCase()] ?? "application/octet-stream";
const abs = (pub) => path.join(PUBLIC, pub.replace(/^\//, ""));
const withExt = (pub, ext) => pub.replace(/\.[^./]+$/, ext);

function args() {
  const a = process.argv.slice(2);
  const i = a.indexOf("--sources");
  return { sources: i >= 0 ? a[i + 1] : undefined, dry: a.includes("--dry-run") };
}

/** Write a copy, unless the same bytes are already published; other bytes at that path stop the script. */
function put(pub, data, dry) {
  const file = abs(pub);
  if (fs.existsSync(file)) {
    if (Buffer.compare(fs.readFileSync(file), data) === 0) return "same";
    throw new Error(`${pub} is published with other bytes: a published example file is never replaced (give the new one a new path)`);
  }
  if (dry) return "new";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return "new";
}

function frameOf(video, at) {
  const out = path.join(os.tmpdir(), `fuobe-example-frame-${process.pid}-${Date.now()}.png`);
  const seek = at === "last" ? ["-sseof", "-0.08"] : [];
  execFileSync("ffmpeg", ["-v", "error", "-y", ...seek, "-i", video, "-frames:v", "1", out]);
  const data = fs.readFileSync(out);
  fs.rmSync(out, { force: true });
  return data;
}

/** The highest quality, from a list, whose file fits the size: a busy picture gets a little more compression. */
async function fitting(make, qualities, maxBytes) {
  let out;
  for (const q of qualities) {
    out = await make(q);
    if (out.length <= maxBytes) return out;
  }
  return out;
}
const stillIn = (src, max = 1280) =>
  fitting((q) => sharp(src).rotate().resize({ width: max, height: max, fit: "inside", withoutEnlargement: true }).toColorspace("srgb").jpeg({ quality: q, mozjpeg: true }).toBuffer(), [86, 82, 78, 74], 300_000);
const inset = (src) => fitting((q) => sharp(src).resize({ width: 384, height: 384, fit: "inside", withoutEnlargement: true }).webp({ quality: q }).toBuffer(), [78, 70, 62], 40_000);
const poster = (src) => sharp(src).resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();

async function make(job, dry) {
  const { to, from, op } = job;
  if (!/^\/examples\/[a-z0-9-]+\/\d+\/[a-z0-9-]+\.(jpg|png|webp|mp4|m4a)$/.test(to)) throw new Error(`${to}: an example file goes at /examples/<slug>/<n>/<name>.<ext>`);
  if (op === "still-in" || op === "frame-in") {
    const source = op === "frame-in" ? frameOf(from, job.at) : fs.readFileSync(from);
    const jpg = await stillIn(source, job.max);
    return [put(to, jpg, dry), put(withExt(to, ".384.webp"), await inset(jpg), dry)];
  }
  if (op === "mask-in") return [put(to, await sharp(fs.readFileSync(from)).greyscale().png({ compressionLevel: 9 }).toBuffer(), dry)];
  if (op === "still-out") {
    const jpg = await sharp(fs.readFileSync(from)).resize({ width: 960, height: 960, fit: "inside", withoutEnlargement: true }).toColorspace("srgb").jpeg({ quality: 84, mozjpeg: true }).toBuffer();
    return [put(to, jpg, dry), put(withExt(to, ".512.webp"), await poster(jpg), dry)];
  }
  if (op === "clip-show") return clipShow(job, dry);
  throw new Error(`${to}: unknown op ${op}`);
}

const SHOW = { w: 1024, h: 768, fps: 24, maxBytes: 1_200_000 };

/** A clip's frame count and length (ffprobe). */
function probe(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", file]).toString().trim();
  return Number(out);
}

/** The rounded window's alpha (white inside) and its frame (white at 85 %), as PNGs for ffmpeg. */
async function insetMasks(dir, w, h, r, border) {
  const mask = path.join(dir, "mask.png");
  const frame = path.join(dir, "frame.png");
  const svg = (W, H, R, fill) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="black" fill-opacity="0"/><rect width="${W}" height="${H}" rx="${R}" ry="${R}" fill="${fill}"/></svg>`);
  await sharp({ create: { width: w, height: h, channels: 3, background: "#000" } }).composite([{ input: svg(w, h, r, "#fff") }]).greyscale().png().toFile(mask);
  await sharp(svg(w + 2 * border, h + 2 * border, r + border, "rgba(255,255,255,0.85)")).png().toFile(frame);
  return { mask, frame };
}

/** The before → after loop, encoded until it fits; then its poster and its resting still. */
async function clipShow(job, dry) {
  const { to, before, after, layout } = job;
  if (layout !== "inset" && layout !== "wipe") throw new Error(`${to}: clip-show takes layout "inset" or "wipe"`);
  const frames = Math.min(probe(before), probe(after));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-example-show-"));
  const { w, h, fps } = SHOW;
  const norm = (i, W, H) => `[${i}:v]fps=${fps},scale=${W}:${H}:flags=lanczos,setsar=1,format=yuv420p,trim=end_frame=${frames},setpts=PTS-STARTPTS`;
  let inputs;
  let graph;
  if (layout === "inset") {
    // The source at 30 %, 24 px from the bottom-left corners, 12 px round, a 2 px white frame.
    const iw = 308;
    const ih = 230;
    const b = 2;
    const x = 24;
    const y = h - 24 - ih;
    const { mask, frame } = await insetMasks(dir, iw, ih, 12, b);
    inputs = ["-i", after, "-i", before, "-loop", "1", "-i", mask, "-loop", "1", "-i", frame];
    graph = [
      `${norm(0, w, h)}[A]`,
      `${norm(1, iw, ih)}[B]`,
      `[2:v]format=gray,scale=${iw}:${ih}[M]`,
      `[B][M]alphamerge[BM]`,
      `[A][3:v]overlay=${x - b}:${y - b}:shortest=1[A1]`,
      `[A1][BM]overlay=${x}:${y}:shortest=1,format=yuv420p[out]`,
    ].join(";");
  } else {
    // 0–1 s the source; 1–2.4 s a line sweeps (ease in-out) and leaves the result on its left; then the result.
    const p = "clip((t-1)/1.4\,0\,1)";
    const X = `(${w}*if(lt(${p}\,0.5)\,2*${p}*${p}\,1-pow(-2*${p}+2\,2)/2))`;
    const d = (frames / fps).toFixed(4);
    inputs = ["-i", before, "-i", after];
    graph = [
      `${norm(0, w, h)}[A]`,
      `${norm(1, w, h)}[B]`,
      `color=black:s=${w}x${h}:r=${fps}:d=${d}[m0]`,
      `color=white:s=${w}x${h}:r=${fps}:d=${d}[m1]`,
      `[m0][m1]overlay=x='${X}-${w}':y=0:eval=frame,format=gray[M]`,
      `[B][M]alphamerge[BM]`,
      `[A][BM]overlay=0:0:shortest=1[W]`,
      `color=black@0.25:s=8x${h}:r=${fps}:d=${d}[S]`,
      `color=white:s=2x${h}:r=${fps}:d=${d}[L]`,
      `[W][S]overlay=x='${X}-4':y=0:eval=frame:enable='between(t\,1\,2.4)'[W1]`,
      `[W1][L]overlay=x='${X}-1':y=0:eval=frame:enable='between(t\,1\,2.4)',format=yuv420p[out]`,
    ].join(";");
  }
  const mp4 = path.join(dir, "show.mp4");
  let data;
  for (const crf of [24, 26, 28, 30, 32]) {
    execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", graph, "-map", "[out]", "-frames:v", String(frames), "-an", "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", String(crf), "-pix_fmt", "yuv420p", "-r", String(fps), "-movflags", "+faststart", "-map_metadata", "-1", "-threads", "1", mp4]);
    data = fs.readFileSync(mp4);
    if (data.length <= SHOW.maxBytes) break;
  }
  if (data.length > SHOW.maxBytes) throw new Error(`${to}: the loop is ${data.length} bytes, over ${SHOW.maxBytes}`);
  const first = frameOf(mp4);
  const posterWebp = await fitting((q) => sharp(first).webp({ quality: q }).toBuffer(), [78, 70, 62, 54], 90_000);
  const peakPng = path.join(dir, "peak.png");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", ((frames / fps) - 0.45).toFixed(3), "-i", mp4, "-frames:v", "1", peakPng]);
  const peakWebp = await fitting((q) => sharp(fs.readFileSync(peakPng)).resize({ width: 512 }).webp({ quality: q }).toBuffer(), [78, 70, 62], 40_000);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${to}: ${frames} frames, ${(data.length / 1e6).toFixed(2)} MB`);
  return [put(to, data, dry), put(withExt(to, ".poster.webp"), posterWebp, dry), put(withExt(to, ".peak.webp"), peakWebp, dry)];
}

/** An input's inset copy, where there is one. */
function thumbFor(pub) {
  const own = withExt(pub, ".384.webp");
  return own !== pub && fs.existsSync(abs(own)) ? own : undefined;
}

/** An output's poster, where there is one. */
function posterFor(pub) {
  // A clip-show loop's first frame.
  const first = withExt(pub, ".poster.webp");
  if (first !== pub && fs.existsSync(abs(first))) return first;
  const ba = /^\/previews\/presets\/ba\/960\/(.+)$/.exec(pub);
  if (ba) return `/previews/presets/ba/512/${ba[1]}`;
  const own = withExt(pub, ".512.webp");
  return own !== pub && fs.existsSync(abs(own)) ? own : undefined;
}

async function entry(pub, role) {
  const file = abs(pub);
  if (!fs.existsSync(file)) throw new Error(`${pub} is named in plan.json but isn't in public/`);
  const data = fs.readFileSync(file);
  const sha256 = crypto.createHash("sha256").update(data).digest("hex");
  const type = typeOf(pub);
  const e = { role, type, bytes: data.length, sha256, v: sha256.slice(0, 8) };
  if (type.startsWith("image/")) {
    const m = await sharp(data).metadata();
    Object.assign(e, { w: m.width, h: m.height });
  }
  return e;
}

function readManifest() {
  if (!fs.existsSync(MANIFEST)) return {};
  const text = fs.readFileSync(MANIFEST, "utf8");
  const m = /EXAMPLE_MEDIA: Record<string, ExampleMediaFile> = (\{[\s\S]*\});\s*$/.exec(text);
  return m ? JSON.parse(m[1]) : {};
}

async function writeManifest(dry) {
  const plan = JSON.parse(fs.readFileSync(PLAN, "utf8"));
  // Files listed before stay listed: a run that named one can still be reused.
  const media = readManifest();
  const add = async (pub, role) => {
    const e = await entry(pub, role);
    const was = media[pub];
    if (was && was.sha256 !== e.sha256) throw new Error(`${pub} changed since it was published: a published example file is never replaced`);
    // A file a run may read stays one.
    media[pub] = { ...e, role: was?.role === "in" ? "in" : role };
    return media[pub];
  };
  for (const row of plan) {
    for (const pub of Object.values(row.inputs ?? {})) {
      // A file a run reads is Fuobe's own copy, which nothing else rewrites (example-files.ts reads only these folders).
      if (!/^\/(examples|samples)\//.test(pub)) throw new Error(`${row.id}: ${pub} is outside /examples/ and /samples/: publish a copy (--sources, still-in)`);
      const e = await add(pub, "in");
      const t = thumbFor(pub);
      if (t) e.thumb = `${t}?v=${(await add(t, media[t]?.role ?? "show")).v}`;
    }
    if (row.output.startsWith("/")) {
      const e = await add(row.output, media[row.output]?.role ?? "show");
      const p = posterFor(row.output);
      if (p) e.poster = `${p}?v=${(await add(p, media[p]?.role ?? "show")).v}`;
    }
    // The still a clip's card rests on (cut-example-peaks.mjs).
    if (row.rest) await add(row.rest.src, media[row.rest.src]?.role ?? "show");
  }
  const sorted = Object.fromEntries(Object.keys(media).sort().map((k) => [k, media[k]]));
  const head = fs.readFileSync(MANIFEST, "utf8").split("export const EXAMPLE_MEDIA")[0];
  const text = `${head}export const EXAMPLE_MEDIA: Record<string, ExampleMediaFile> = ${JSON.stringify(sorted, null, 1)};\n`;
  if (!dry) fs.writeFileSync(MANIFEST, text);
  const bytes = Object.values(sorted).reduce((n, e) => n + e.bytes, 0);
  console.log(`${Object.keys(sorted).length} files in the manifest (${(bytes / 1e6).toFixed(1)} MB, some shared with the preset covers)`);
}

async function main() {
  const { sources, dry } = args();
  if (sources) {
    const jobs = JSON.parse(fs.readFileSync(sources, "utf8"));
    let made = 0;
    for (const job of jobs) {
      const r = await make(job, dry);
      made += r.filter((x) => x === "new").length;
    }
    console.log(`${made} new files from ${jobs.length} copies`);
  }
  await writeManifest(dry);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
