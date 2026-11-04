// The worker's own checks of a job before its ComfyUI sees it (docs/gpu-workers.md), and its cleanup after.
//
// 1. Every node type is on the allowlist built into this worker (dist/allowed-nodes.json), plus a file the PC's owner
//    passes with --allow-nodes. The studio can never add to it: a studio taken over can't run new code on this PC.
// 2. Every file the graph reads was sent with the job (the shared runner's graphProblem, and the input-file rule).
// 3. Every input keeps to its rule (dist/input-rules.json, see rules.mjs), and no link from another node reaches an
//    input that has one. Inputs with no rule that don't take free text hold no path (the second layer).
// 4. Every model file the graph names is one this worker verified (its inventory), by its exact name.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inputProblem, verifiedIndex } from "./rules.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export function allowedNodes(extraFile) {
  const built = JSON.parse(fs.readFileSync(path.join(here, "dist", "allowed-nodes.json"), "utf8")).nodes;
  const extra = extraFile ? JSON.parse(fs.readFileSync(extraFile, "utf8")) : [];
  return new Set([...built, ...(Array.isArray(extra) ? extra : (extra.nodes ?? []))]);
}

/** The input rules built into this worker. Throws when they aren't built: the worker never runs without them. */
export function inputRules(file = path.join(here, "dist", "input-rules.json")) {
  const r = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!r || typeof r.inputs !== "object") throw new Error("The worker's input rules are unreadable. Run: node scripts/build-worker.mjs");
  return r;
}

/**
 * The first problem with a job's graph for this worker, or null: { reason, node, cls, input }. The reason is
 * "unknown-node", "unsafe-path" (an input outside its rule, a link into a ruled input, or a path) or "model-unverified".
 * `o`: { rules, staged } (the built rules, and the names of the files this job sent).
 */
export function graphCheck(graph, allowed, verified, o = {}) {
  for (const [id, node] of Object.entries(graph ?? {})) {
    if (!node || typeof node.class_type !== "string" || !allowed.has(node.class_type)) return { reason: "unknown-node", node: id, cls: typeof node?.class_type === "string" ? node.class_type : null, input: null };
  }
  const ctx = { rules: o.rules ?? null, staged: o.staged ?? [], byName: verifiedIndex(verified) };
  let unverified = null;
  for (const [id, node] of Object.entries(graph)) {
    const inputs = node.inputs && typeof node.inputs === "object" ? node.inputs : {};
    for (const [input, v] of Object.entries(inputs)) {
      const reason = inputProblem(node.class_type, input, v, ctx);
      if (reason === "unsafe-path") return { reason, node: id, cls: node.class_type, input };
      if (reason && !unverified) unverified = { reason, node: id, cls: node.class_type, input };
    }
  }
  return unverified;
}

/** The first problem with a job's graph for this worker (its reason), or null. */
export function vetGraph(graph, allowed, verified, o = {}) {
  return graphCheck(graph, allowed, verified, o)?.reason ?? null;
}

/** Delete everything in the worker's own input, output and temp folders (at start: whatever a crash left). */
export function emptyFolders(f) {
  for (const dir of [f.input, f.output, f.temp]) {
    fs.mkdirSync(dir, { recursive: true });
    for (const e of fs.readdirSync(dir)) fs.rmSync(path.join(dir, e), { recursive: true, force: true });
  }
}

/**
 * After a job, however it ended: nothing of it stays in its ComfyUI (the queue emptied, a running prompt stopped, the
 * whole history cleared, a meta-batch's passes included), and its inputs and results leave this PC. Everything in these
 * folders is this worker's (its own ComfyUI writes only there), and it runs one job at a time.
 */
export async function cleanJob(f, comfyBase, fetchFn = fetch) {
  const post = (p, body) => fetchFn(`${comfyBase}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  await post("/queue", { clear: true });
  await post("/interrupt", {});
  await post("/history", { clear: true });
  for (const dir of [f.input, f.output, f.temp]) {
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir)) fs.rmSync(path.join(dir, e), { recursive: true, force: true });
  }
}
