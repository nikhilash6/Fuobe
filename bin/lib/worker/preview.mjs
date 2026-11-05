// Live previews for the studio (docs/gpu-workers.md, "Live previews"). Its ComfyUI sends the latest preview of a job as
// a PNG or a JPEG. The studio keeps only a JPEG of at most 64 KB, so a PNG or a bigger JPEG is made again by ffmpeg:
// at most 512 pixels on its long side, as a JPEG, in a process of its own at low priority for at most 10 seconds. It
// reads the picture only as a local PNG or JPEG file. When that can't make one small enough, nothing is sent.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The most a preview the studio keeps may weigh (src/lib/relay.ts PREVIEW_LIMITS.maxBytes). */
export const PREVIEW_MAX_BYTES = 64 * 1024;
/** The long side of a preview made again. */
export const PREVIEW_SIDE = 512;

/** ffmpeg's arguments for one preview: a local PNG or JPEG in, one JPEG of at most PREVIEW_SIDE pixels out. */
export function previewArgs(src, dst, quality = 6) {
  const fit = `scale='min(${PREVIEW_SIDE},iw)':'min(${PREVIEW_SIDE},ih)':force_original_aspect_ratio=decrease`;
  return ["-hide_banner", "-loglevel", "error", "-nostdin", "-protocol_whitelist", "file", "-format_whitelist", "png_pipe,jpeg_pipe,image2", "-i", src, "-frames:v", "1", "-vf", fit, "-map_metadata", "-1", "-q:v", String(quality), "-f", "mjpeg", "-y", dst];
}

function run(ffmpeg, args, { spawnFn = spawn, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn(ffmpeg, args, { stdio: ["ignore", "ignore", "ignore"], windowsHide: true });
    } catch {
      return resolve(false);
    }
    try {
      if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {}
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.once("error", () => (clearTimeout(timer), resolve(false)));
    child.once("exit", (code) => (clearTimeout(timer), resolve(code === 0)));
  });
}

/**
 * The function the runner calls for a preview it can't send as it is (computer-runner.ts WorkerHooks.shrinkPreview):
 * a small JPEG Blob, or null. `dir`: a folder of its own, emptied after each try. Without ffmpeg: always null.
 */
export function previewShrinker({ ffmpeg, dir, spawnFn = spawn }) {
  return async (blob) => {
    if (!ffmpeg || !blob || blob.size === 0 || blob.size > 16 * 2 ** 20) return null;
    const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    const png = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
    const jpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    if (!png && !jpeg) return null;
    fs.mkdirSync(dir, { recursive: true });
    const id = crypto.randomBytes(6).toString("hex");
    const src = path.join(dir, `${id}.${png ? "png" : "jpg"}`);
    const dst = path.join(dir, `${id}-small.jpg`);
    try {
      fs.writeFileSync(src, Buffer.from(await blob.arrayBuffer()), { mode: 0o600 });
      // A busy picture may need a lower quality to fit.
      for (const q of [6, 14]) {
        if (!(await run(ffmpeg, previewArgs(src, dst, q), { spawnFn }))) return null;
        const out = fs.readFileSync(dst);
        if (out.length > 0 && out.length <= PREVIEW_MAX_BYTES) return new Blob([out], { type: "image/jpeg" });
      }
      return null;
    } catch {
      return null;
    } finally {
      fs.rmSync(src, { force: true });
      fs.rmSync(dst, { force: true });
    }
  };
}
