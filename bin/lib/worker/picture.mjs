// Pictures for the worker's ComfyUI (docs/gpu-workers.md). Every picture of an account's job ticket, and of a finishing
// job, is made again from its pixels before anything on this PC reads it: turned upright by its EXIF orientation, then
// written as a fresh PNG with nothing else of the file (no EXIF, no GPS, no XMP, no colour profile's text, no comment).
// Only one short-lived process at low priority ever reads the picture as it came (picture-child.mjs, with sharp), with
// a cap on its pixels and a time limit. The studio sends an account's pictures as they came, so this is the only place
// they are decoded.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const PICTURE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "avif", "heic", "heif"]);
const extOf = (name) => (String(name).includes(".") ? String(name).split(".").pop().toLowerCase() : "");

/** Is this input a picture: by its type, else by its name. */
export function isPicture(input) {
  const type = String(input?.contentType ?? "").split(";")[0].trim().toLowerCase();
  if (type) return type.startsWith("image/");
  return PICTURE_EXT.has(extOf(input?.name));
}

/** Can this checkout make pictures again: is sharp installed beside it (pnpm install in the worker's checkout)? */
export function canCleanPictures(resolve = (name) => createRequire(import.meta.url).resolve(name)) {
  try {
    resolve("sharp");
    return true;
  } catch {
    return false;
  }
}

/** The most pixels a picture may have (the studio's own limit for a picture it makes again). */
export const PICTURE_MAX_PIXELS = 64 * 2 ** 20;

/** The environment of the process that reads a picture: where things are, and nothing else of this PC's. */
function childEnv(env = process.env) {
  const out = {};
  for (const k of ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LANG"]) if (env[k] !== undefined) out[k] = env[k];
  return out;
}

/**
 * Make a picture again (`src` as it came, `dst` the new PNG) in its own process at low priority, stopped after
 * `timeoutMs`. True when it made one.
 */
export function cleanPicture({ src, dst, timeoutMs = 2 * 60_000, spawnFn = spawn, node = process.execPath }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn(node, [path.join(here, "picture-child.mjs"), src, dst, String(PICTURE_MAX_PIXELS)], { stdio: ["ignore", "ignore", "ignore"], windowsHide: true, env: childEnv(), cwd: path.dirname(dst) });
    } catch {
      return resolve(false);
    }
    try {
      if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {}
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.once("error", () => (clearTimeout(timer), resolve(false)));
    child.once("exit", (code) => {
      clearTimeout(timer);
      let ok = false;
      try {
        ok = code === 0 && fs.statSync(dst).size > 0;
      } catch {}
      resolve(ok);
    });
  });
}
