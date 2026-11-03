#!/usr/bin/env node
// Builds the worker program's shared parts (docs/gpu-workers.md) into bin/lib/worker/dist/:
//   - the job runner the browser uses (src/lib/computer-runner.ts and its helpers), transpiled to plain .mjs with the
//     typescript dev dependency, relative imports rewritten to .mjs;
//   - allowed-nodes.json: every node type the studio's workflows and graph builders use, frozen into the worker. The
//     studio can't add to it; a worker refuses a graph with any other node;
//   - input-rules.json: a rule for each node input that could name a file, a folder, a download or code, from the
//     catalog's own values (scripts/lib/worker-catalog.mjs). A worker refuses a value outside its rule, and a link
//     into it.
// `pnpm build` runs it first. No new dependency.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { allowedNodeList, inputRules, missingRules, readCatalog } from "./lib/worker-catalog.mjs";

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

const catalog = readCatalog(root);
const write = (name, data) => fs.writeFileSync(path.join(out, name), `${JSON.stringify({ built: "scripts/build-worker.mjs", ...data }, null, 1)}\n`);
const nodes = allowedNodeList(root, catalog);
write("allowed-nodes.json", { nodes });
const rules = inputRules(catalog);
const missing = missingRules(rules, nodes);
if (missing.length) throw new Error(`These allowed inputs have no rule: ${missing.join(", ")}. Give each a literal value in the catalog.`);
write("input-rules.json", rules);
const ruled = Object.values(rules.inputs).reduce((n, r) => n + Object.keys(r).length, 0);
console.log(`worker: ${SOURCES.length} modules, ${nodes.length} allowed node types, ${ruled} input rules -> ${path.relative(root, out)}`);
