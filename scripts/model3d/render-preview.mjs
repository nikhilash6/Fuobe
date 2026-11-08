#!/usr/bin/env node
// The preview of a 3D result, made once when the run finishes: a turntable clip (one full turn that loops with no
// seam) and a still from its first frame, each on a light and a dark studio backdrop (the site's two themes). Drawn on
// the CPU by scripts/model3d/preview3d-core.mjs: no browser and no GPU, so it runs on a worker's CPU slot or a server
// with only Node, sharp and ffmpeg.
//
//   node scripts/model3d/render-preview.mjs --in model.glb|splat.spz|splat.ply --out-dir dir [options]
//
// Options (defaults in brackets):
//   --format auto          glb | spz | ply (auto: from the file's name)
//   --y-down               the splat is in the 3DGS frame (y down; ComfyUI's): stood upright first
//   --front-yaw 0          degrees from +z toward +x where the subject's front is: the first frame faces it
//   --cutoff 0             splats: leave out Gaussians fainter than this (haze)
//   --frames 120 --fps 24  one turn = 120 frames = 5 s
//   --size 720             the clip and the stills are size x size
//   --ffmpeg <exe>         default: $FFMPEG_PATH, else ffmpeg on the PATH
//   --no-webm              skip the AV1 .webm copies (they are made only when this ffmpeg has an AV1 encoder)
//
// Writes poster-light.webp, poster-dark.webp, turntable-light.mp4, turntable-dark.mp4 and, when it can,
// turntable-light.webm and turntable-dark.webm. Prints "frame i/N" after each frame, then one JSON line:
// { kind, frames, fps, seconds, size, webm, triangles?, splats?, ms }. Exit code 3: a model this can't draw (a
// compressed glTF, an unknown splat) or no ffmpeg; the caller keeps the result without a preview.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import zlib from "node:zlib";
import sharp from "sharp";
import { backdrop, drawMesh, drawSplat, frameCylinder, meshCylinder, meshOf, over, prepareSplat, readGlb, readHdr, readPly, readSpz, studioLight, Unsupported } from "./preview3d-core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: a } = parseArgs({
  options: {
    in: { type: "string" },
    "out-dir": { type: "string" },
    format: { type: "string", default: "auto" },
    "y-down": { type: "boolean", default: false },
    "front-yaw": { type: "string", default: "0" },
    cutoff: { type: "string", default: "0" },
    frames: { type: "string", default: "120" },
    fps: { type: "string", default: "24" },
    size: { type: "string", default: "720" },
    ffmpeg: { type: "string" },
    "no-webm": { type: "boolean", default: false },
  },
});
if (!a.in || !a["out-dir"]) {
  console.error("usage: render-preview.mjs --in model.glb --out-dir dir [options]");
  process.exit(2);
}
const unavailable = (msg) => {
  console.error(msg);
  process.exit(3);
};
// Run by a parent that may go away (the worker, the server): stop when its end of stdin closes.
if (process.env.FUOBE_PARENT_PIPE === "1") {
  process.stdin.on("end", () => process.exit(1));
  process.stdin.on("error", () => process.exit(1));
  process.stdin.resume();
  process.stdin.unref?.();
}
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => process.exit(1));

const SIZE = Math.max(64, Math.min(1440, Math.round(Number(a.size)) || 720));
const FRAMES = Math.max(2, Math.min(480, Math.round(Number(a.frames)) || 120));
const FPS = Math.max(1, Math.min(60, Math.round(Number(a.fps)) || 24));
const ffmpeg = a.ffmpeg || process.env.FFMPEG_PATH || "ffmpeg";
const out = a["out-dir"];
fs.mkdirSync(out, { recursive: true });
const t0 = Date.now();

function run(cmd, args, { input, collect } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: [input ? "pipe" : "ignore", collect ? "pipe" : "ignore", "pipe"], windowsHide: true });
    let err = "";
    let stdout = "";
    p.stderr.on("data", (d) => (err = (err + d).slice(-4000)));
    if (collect) p.stdout.on("data", (d) => (stdout += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`${path.basename(cmd)} exited ${code}: ${err.trim().split("\n").slice(-2).join(" | ")}`))));
    if (input) input(p.stdin);
  });
}

let encoders = "";
try {
  encoders = await run(ffmpeg, ["-hide_banner", "-encoders"], { collect: true });
} catch {
  unavailable("ffmpeg not found (set FFMPEG_PATH)");
}
if (!/\blibx264\b/.test(encoders)) unavailable("this ffmpeg has no H.264 encoder");
const av1 = a["no-webm"] ? null : /\blibsvtav1\b/.test(encoders) ? "libsvtav1" : null;

const format = a.format !== "auto" ? a.format : (/\.(\w+)$/.exec(a.in)?.[1] ?? "").toLowerCase();
const raw = fs.readFileSync(a.in);

// The subject, ready to draw, and how to draw one frame of it.
let draw;
let view;
let stats = {};
try {
  if (format === "glb") {
    const glb = readGlb(raw);
    // Pictures decoded once, at most 1024 px a side (plenty for a 720 px frame), checked from their headers first.
    const pictures = await Promise.all(
      glb.images.map(async (img) => {
        if (!img || !/^image\/(png|jpeg|webp)$/.test(img.mime || "image/png")) return null;
        try {
          const meta = await sharp(img.bytes, { limitInputPixels: 64 * 2 ** 20 }).metadata();
          if (!meta.width || !meta.height) return null;
          const { data, info } = await sharp(img.bytes, { limitInputPixels: 64 * 2 ** 20 }).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          return { width: info.width, height: info.height, data };
        } catch {
          return null;
        }
      }),
    );
    const mesh = meshOf(glb, pictures);
    const light = studioLight(readHdr(fs.readFileSync(path.join(here, "studio_small_08-1k.hdr"))));
    const cyl = meshCylinder(mesh);
    view = { cyl, frame: frameCylinder(cyl) };
    const yaw = (Number(a["front-yaw"]) * Math.PI) / 180 || 0;
    draw = (angle) => drawMesh(mesh, light, view, angle - yaw, { size: SIZE });
    stats = { triangles: mesh.triangles };
  } else if (format === "spz" || format === "ply") {
    const s = format === "spz" ? readSpz(raw, zlib.gunzipSync) : readPly(raw);
    const sp = prepareSplat(s, { yDown: a["y-down"], cutoff: Number(a.cutoff) || 0, frontYaw: Number(a["front-yaw"]) || 0 });
    if (sp.n < 16) throw new Unsupported("the splat is empty");
    view = { cyl: sp.cyl, frame: frameCylinder(sp.cyl) };
    draw = (angle) => drawSplat(sp, view, angle, { size: SIZE });
    stats = { splats: sp.n };
  } else throw new Unsupported(`no preview for .${format}`);
} catch (e) {
  if (e instanceof Unsupported) unavailable(e.message);
  throw e;
}

const plates = { light: backdrop(SIZE, "light"), dark: backdrop(SIZE, "dark") };
const tones = ["light", "dark"];
// One encoder per clip, each fed the same frames.
const outputs = [];
for (const tone of tones) {
  outputs.push({ tone, file: path.join(out, `turntable-${tone}.mp4`), args: ["-c:v", "libx264", "-preset", "slow", "-crf", "25", "-g", String(FRAMES), "-pix_fmt", "yuv420p", "-movflags", "+faststart"] });
  if (av1) outputs.push({ tone, file: path.join(out, `turntable-${tone}.webm`), args: ["-c:v", av1, "-preset", "8", "-crf", "40", "-g", String(FRAMES), "-pix_fmt", "yuv420p"] });
}
const encoders$ = outputs.map((o) => {
  let feed;
  const fed = new Promise((r) => (feed = r));
  const done = run(
    ffmpeg,
    [
      "-hide_banner", "-v", "error", "-y",
      "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${SIZE}x${SIZE}`, "-framerate", String(FPS), "-i", "-",
      "-frames:v", String(FRAMES), ...o.args,
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", "-an", o.file,
    ],
    { input: (stdin) => feed(stdin) },
  );
  return { ...o, fed, done };
});
const pipes = await Promise.all(encoders$.map((e) => e.fed));
for (const p of pipes) p.on("error", () => {});
const write = (stdin, buf) => (stdin.write(buf) ? Promise.resolve() : new Promise((r) => stdin.once("drain", r)));

let first;
for (let i = 0; i < FRAMES; i++) {
  const rgba = draw((2 * Math.PI * i) / FRAMES);
  if (i === 0) first = rgba;
  const frames = { light: over(rgba, plates.light), dark: over(rgba, plates.dark) };
  await Promise.all(encoders$.map((e, k) => write(pipes[k], frames[e.tone])));
  console.log(`frame ${i + 1}/${FRAMES}`);
}
for (const p of pipes) p.end();
const ended = await Promise.allSettled(encoders$.map((e) => e.done));
for (const [k, r] of ended.entries()) {
  if (r.status === "rejected") {
    // A .webm that didn't encode is left out; an .mp4 that didn't is a failure.
    if (encoders$[k].file.endsWith(".mp4")) throw r.reason;
    fs.rmSync(encoders$[k].file, { force: true });
  }
}
for (const tone of tones) {
  await sharp(Buffer.from(over(first, plates[tone])), { raw: { width: SIZE, height: SIZE, channels: 3 } }).webp({ quality: 86 }).toFile(path.join(out, `poster-${tone}.webp`));
}
const webm = tones.every((tone) => fs.existsSync(path.join(out, `turntable-${tone}.webm`)));
console.log(JSON.stringify({ kind: format === "glb" ? "mesh" : "splat", frames: FRAMES, fps: FPS, seconds: FRAMES / FPS, size: SIZE, webm, ...stats, ms: Date.now() - t0 }));
