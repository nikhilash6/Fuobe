// Run by finish.mjs in a process of its own: node path-child.mjs <photo> <depth> <settings.json> <out.mp4> <ffmpeg> <dist>.
// The camera path of a finishing job (src/lib/finish-ticket.ts, "path"), drawn as the studio's own path render does
// (src/server/path-render.ts): the still and its depth picture become a point cloud (src/lib/scene3d.ts, built into
// <dist>), drawn along the path's keys frame by frame (src/lib/camera-path.ts, src/lib/path-splat.ts), and encoded to an
// H.264 MP4 by ffmpeg. Prints "frame i/N" as it goes. Exit 0 when it wrote the clip.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
// sharp comes from the worker's checkout (pnpm install): the CLI package itself imports only Node's own modules.
const sharp = (await import(pathToFileURL(createRequire(import.meta.url).resolve("sharp")).href)).default;

const [photoFile, depthFile, settingsFile, out, ffmpeg, dist] = process.argv.slice(2);
if (process.env.FUOBE_PARENT_PIPE === "1") {
  process.stdin.on("end", () => process.exit(1));
  process.stdin.on("error", () => process.exit(1));
  process.stdin.resume();
  process.stdin.unref?.();
}
const load = (name) => import(pathToFileURL(path.join(dist, name)).href);
const { framePoses, renderSize } = await load("camera-path.mjs");
const { splatFrame } = await load("path-splat.mjs");
const { LENS, buildPointCloud, lensFov } = await load("scene3d.mjs");

/** At most this many points (as the studio's own render). */
const MAX_POINTS = 300_000;
const LIMIT = { failOn: "error", limitInputPixels: 64 * 2 ** 20 };

async function pixels(data, size) {
  const { data: raw, info } = await sharp(data, LIMIT).rotate().removeAlpha().ensureAlpha().resize(size.width, size.height, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: raw };
}

try {
  const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  const photoData = fs.readFileSync(photoFile);
  const meta = await sharp(photoData, LIMIT).metadata();
  const aspect = (meta.autoOrient?.width ?? meta.width ?? 1) / (meta.autoOrient?.height ?? meta.height ?? 1);
  const size = renderSize(aspect);
  const photo = await pixels(photoData, size);
  const depth = await pixels(fs.readFileSync(depthFile), size);
  const hFov = lensFov(LENS.default, aspect).h;
  const cloud = buildPointCloud(photo, depth, { hFov, maxPoints: MAX_POINTS });
  const poses = framePoses(settings.keys, settings.frames, cloud.depth, hFov, size);
  const count = poses.poses.length;
  const args = ["-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${size.width}x${size.height}`, "-r", String(settings.fps), "-i", "pipe:0"];
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-f", "mp4", "-y", out);
  const child = spawn(ffmpeg, args, { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
  const done = new Promise((resolve) => {
    child.once("error", () => resolve(1));
    child.once("close", (code) => resolve(code));
  });
  child.stdin.on("error", () => {});
  for (let i = 0; i < count; i++) {
    const frame = splatFrame(cloud, poses.poses[i], poses.intrinsic, size.width, size.height);
    if (!child.stdin.write(frame)) await new Promise((r) => child.stdin.once("drain", r));
    console.log(`frame ${i + 1}/${count}`);
  }
  child.stdin.end();
  process.exit((await done) === 0 && fs.existsSync(out) ? 0 : 1);
} catch (e) {
  console.error(String(e?.message ?? e).slice(0, 200));
  process.exit(1);
}
