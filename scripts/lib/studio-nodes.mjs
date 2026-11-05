// Every node type the studio's workflows and graph builders use. Fuobe Connect (scripts/connect-nodes.mjs) freezes this
// list into what it ships, and the worker program's build makes the same list from its catalog copy
// (scripts/lib/worker-catalog.mjs allowedNodeList): a graph with any other node is refused on the person's computer, and
// the studio can't add to the list.
import fs from "node:fs";
import path from "node:path";

export function studioNodes(root) {
  const index = JSON.parse(fs.readFileSync(path.join(root, "workflows/comfyui/requirements.json"), "utf8"));
  const nodes = new Set();
  for (const wf of Object.values(index.workflows)) {
    for (const c of wf.core) nodes.add(c);
    for (const cs of Object.values(wf.packs)) for (const c of cs) nodes.add(c);
  }
  for (const f of fs.readdirSync(path.join(root, "workflows/comfyui"))) {
    if (!f.endsWith(".json") || f === "requirements.json" || f === "manifest.json") continue;
    try {
      const g = JSON.parse(fs.readFileSync(path.join(root, "workflows/comfyui", f), "utf8"));
      for (const n of Object.values(g)) if (n && typeof n === "object" && typeof n.class_type === "string") nodes.add(n.class_type);
    } catch {}
  }
  // What the graph builders add on their own (LoRA loaders, video joins, overlays…).
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
  for (const file of [...walk(path.join(root, "src/lib")), ...walk(path.join(root, "src/server"))]) {
    for (const m of fs.readFileSync(file, "utf8").matchAll(/class_type: "([^"]+)"/g)) nodes.add(m[1]);
  }
  for (const extra of ["LoraLoader", "LoraLoaderModelOnly"]) nodes.add(extra);
  return [...nodes].sort();
}
