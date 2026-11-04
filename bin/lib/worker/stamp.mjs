// The build stamp of the worker's shared parts (docs/gpu-workers.md, "Install and update"). scripts/build-worker.mjs
// writes it into dist/build-stamp.json: one SHA-256 over every file the parts are built from. The worker starts only when
// its checkout gives the same stamp, so parts built from another checkout (an update whose build didn't run, or a build
// that wrote somewhere else) are never used with this code: not an older node allowlist, input rules or file pins.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** The file the build writes the stamp into, in dist/. */
export const STAMP_FILE = "build-stamp.json";

/** The code that turns the catalog into the worker's parts. */
const BUILD_CODE = ["scripts/build-worker.mjs", "scripts/lib/worker-build.mjs", "scripts/lib/worker-catalog.mjs", "scripts/lib/catalog-checks.mjs", "bin/lib/worker/rules.mjs", "bin/lib/worker/stamp.mjs"];

/** Every source file of the studio's graph builders and job runner (src/lib and src/server, .ts and .tsx). */
export function builderSources(root) {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
  return [...walk(path.join(root, "src/lib")), ...walk(path.join(root, "src/server"))];
}

/**
 * Every file the parts are built from, as [its name in the stamp, its path]: the studio's sources (the job runner, and
 * the graph builders the node allowlist reads), the build's own code, and every .json of the catalog's folder.
 */
export function stampFiles(root, catalogDir = path.join(root, "workflows/comfyui")) {
  const rel = (f) => path.relative(root, f).split(path.sep).join("/");
  const files = [...builderSources(root).map((f) => [rel(f), f]), ...BUILD_CODE.map((f) => [f, path.join(root, f)])];
  for (const f of fs.readdirSync(catalogDir).filter((x) => x.endsWith(".json"))) files.push([`workflows/comfyui/${f}`, path.join(catalogDir, f)]);
  return files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The stamp: a SHA-256 over each file's name and SHA-256 (a missing file counts as missing), as they are on disk. */
export function buildStamp(root, catalogDir) {
  const all = crypto.createHash("sha256");
  for (const [name, file] of stampFiles(root, catalogDir)) {
    let sum = "missing";
    if (fs.existsSync(file)) sum = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    all.update(`${name}\u0000${sum}\n`);
  }
  return all.digest("hex");
}

/** Why the parts in `dist` can't be used with the checkout at `root`: "unbuilt" (no stamp), "stale", or null. */
export function distProblem(root, dist) {
  let built = null;
  try {
    built = JSON.parse(fs.readFileSync(path.join(dist, STAMP_FILE), "utf8"))?.stamp ?? null;
  } catch {}
  if (typeof built !== "string") return "unbuilt";
  try {
    return built === buildStamp(root) ? null : "stale";
  } catch {
    return "stale";
  }
}
