#!/usr/bin/env node
// Builds the worker program's shared parts (docs/gpu-workers.md) into bin/lib/worker/dist/:
//   - the job runner the browser uses (src/lib/computer-runner.ts and its helpers), transpiled to plain .mjs with the
//     typescript dev dependency, relative imports rewritten to .mjs;
//   - allowed-nodes.json: every node type the studio's workflows and graph builders use, frozen into the worker. The
//     studio can't add to it; a worker refuses a graph with any other node.
// `pnpm build` runs it first. No new dependency.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "bin/lib/worker/dist");
const SOURCES = ["computer-runner", "comfy-guard", "comfy-ws", "fetch-within", "local-comfy", "relay", "lanes", "worker-hours"];

fs.mkdirSync(out, { recursive: true });
for (const name of SOURCES) {
  const src = fs.readFileSync(path.join(root, "src/lib", `${name}.ts`), "utf8");
  const { outputText } = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false, isolatedModules: true }, fileName: `${name}.ts` });
  const js = outputText.replace(/from "\.\/([\w-]+)"/g, (m, dep) => {
    if (!SOURCES.includes(dep)) throw new Error(`${name}.ts imports ./${dep}, which the worker build doesn't include`);
    return `from "./${dep}.mjs"`;
  });
  if (/from "(@\/|\.\.\/)/.test(js)) throw new Error(`${name}.ts imports something outside src/lib's worker files`);
  fs.writeFileSync(path.join(out, `${name}.mjs`), `// Built from src/lib/${name}.ts by scripts/build-worker.mjs. Don't edit.\n${js}`);
}

// The node allowlist.
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
const list = [...nodes].sort();
fs.writeFileSync(path.join(out, "allowed-nodes.json"), `${JSON.stringify({ built: "scripts/build-worker.mjs", nodes: list }, null, 1)}\n`);
console.log(`worker: ${SOURCES.length} modules, ${list.length} allowed node types -> ${path.relative(root, out)}`);
