#!/usr/bin/env node
// Builds the worker program's shared parts (docs/gpu-workers.md) into bin/lib/worker/dist/: the job runner the browser
// uses, the node allowlist, the input rules and the file pins (scripts/lib/worker-build.mjs says what each holds).
// `pnpm build` runs it first. No new dependency. The build stops, and writes nothing, when an input that must have a
// rule has none (docs/adding-a-model.md).
//
//   node scripts/build-worker.mjs                    # into bin/lib/worker/dist/
//   node scripts/build-worker.mjs --out <dir>        # into another folder (the tests compare two builds)
//   node scripts/build-worker.mjs --catalog <dir>    # from another copy of workflows/comfyui
//
// It always builds when run, however it is reached (a linked folder included): the tests import the parts from
// scripts/lib/worker-build.mjs, never this file.
import fs from "node:fs";
import path from "node:path";
import { STAMP_FILE } from "../bin/lib/worker/stamp.mjs";
import { ROOT, workerFiles } from "./lib/worker-build.mjs";

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    if (i < 0) return undefined;
    if (!argv[i + 1]) throw new Error(`${name} needs a folder`);
    return path.resolve(argv[i + 1]);
  };
  const out = arg("--out") ?? path.join(ROOT, "bin/lib/worker/dist");
  const { files, summary } = workerFiles({ catalogDir: arg("--catalog") });
  fs.mkdirSync(out, { recursive: true });
  // The stamp goes first and comes back last, so parts left half written never pass for a whole build.
  fs.rmSync(path.join(out, STAMP_FILE), { force: true });
  // The composer's folder is made again whole: a file it no longer has never stays.
  fs.rmSync(path.join(out, "compose"), { recursive: true, force: true });
  for (const [name, text] of Object.entries(files)) {
    if (name === STAMP_FILE) continue;
    fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true });
    fs.writeFileSync(path.join(out, name), text);
  }
  fs.writeFileSync(path.join(out, STAMP_FILE), files[STAMP_FILE]);
  console.log(`${summary} -> ${path.relative(ROOT, out) || out}`);
}

try {
  main(process.argv.slice(2));
} catch (e) {
  console.error(e.message ?? e);
  process.exit(1);
}
