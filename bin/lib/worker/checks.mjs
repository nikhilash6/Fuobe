// The worker's own checks of a job before its ComfyUI sees it (docs/gpu-workers.md), and its cleanup after.
//
// 1. Every node type is on the allowlist built into this worker (dist/allowed-nodes.json), plus a file the PC's owner
//    passes with --allow-nodes. The studio can never add to it: a studio taken over can't run new code on this PC.
// 2. Every file the graph reads was sent with the job (the shared runner's graphProblem does this one).
// 3. No string input names a path: an absolute path, a drive letter, a network share, or a ".." step.
// 4. Every model file the graph names is one this worker verified (its inventory).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export function allowedNodes(extraFile) {
  const built = JSON.parse(fs.readFileSync(path.join(here, "dist", "allowed-nodes.json"), "utf8")).nodes;
  const extra = extraFile ? JSON.parse(fs.readFileSync(extraFile, "utf8")) : [];
  return new Set([...built, ...(Array.isArray(extra) ? extra : (extra.nodes ?? []))]);
}

const PATHLIKE = [/^[A-Za-z]:[\\/]/, /^\\\\/, /^\/(?!\/)[^\s]*\//, /(^|[\\/])\.\.([\\/]|$)/, /^~[\\/]/];
const MODEL = /\.(safetensors|gguf|ckpt|pt|pth|bin|sft)$/i;

/** The first problem with a job's graph for this worker, or null. */
export function vetGraph(graph, allowed, verified) {
  for (const node of Object.values(graph ?? {})) {
    if (!node || typeof node.class_type !== "string" || !allowed.has(node.class_type)) return "unknown-node";
  }
  for (const node of Object.values(graph)) {
    for (const v of Object.values(node.inputs ?? {})) {
      if (typeof v !== "string") continue;
      if (PATHLIKE.some((r) => r.test(v))) return "unsafe-path";
    }
  }
  for (const node of Object.values(graph)) {
    for (const v of Object.values(node.inputs ?? {})) {
      if (typeof v !== "string" || !MODEL.test(v)) continue;
      const name = v.replace(/\\/g, "/");
      if (!verified.has(name) && !verified.has(name.split("/").pop())) return "model-unverified";
    }
  }
  return null;
}

/** Delete everything in the worker's own input, output and temp folders (at start: whatever a crash left). */
export function emptyFolders(f) {
  for (const dir of [f.input, f.output, f.temp]) {
    fs.mkdirSync(dir, { recursive: true });
    for (const e of fs.readdirSync(dir)) fs.rmSync(path.join(dir, e), { recursive: true, force: true });
  }
}

/** After a job: its inputs and results leave this PC, its history entry goes, and the temp folder is emptied. */
export async function cleanJob(task, f, comfyBase, fetchFn = fetch) {
  for (const i of task.inputs ?? []) if (/^fuobe_[A-Za-z0-9_-]{8,24}\.[a-z0-9]{1,5}$/.test(i.name)) fs.rmSync(path.join(f.input, i.name), { force: true });
  // Everything in output and temp is this worker's (its own ComfyUI writes only there), and it runs one job at a time.
  for (const dir of [f.output, f.temp]) {
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir)) fs.rmSync(path.join(dir, e), { recursive: true, force: true });
  }
  await fetchFn(`${comfyBase}/history`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: [task.promptId] }) }).catch(() => null);
}
