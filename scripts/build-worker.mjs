#!/usr/bin/env node
// Builds the worker program's shared parts (docs/gpu-workers.md) into bin/lib/worker/dist/:
//   - the job runner the browser uses (src/lib/computer-runner.ts and its helpers), transpiled to plain .mjs with the
//     typescript dev dependency, relative imports rewritten to .mjs;
//   - allowed-nodes.json: every node type the studio's workflows and graph builders use, frozen into the worker. The
//     studio can't add to it; a worker refuses a graph with any other node;
//   - input-rules.json: a rule for each node input that could name a file, a folder, a download or code, from the
//     catalog's own values (scripts/lib/worker-catalog.mjs). A worker refuses a value outside its rule, and a link
//     into it;
//   - file-pins.json: the SHA-256 of every model file the catalog names. A worker reports a file only when its own
//     hash matches.
// `pnpm build` runs it first. No new dependency. The build stops, and writes nothing, when an input that must have a
// rule has none (docs/adding-a-model.md).
//
//   node scripts/build-worker.mjs                    # into bin/lib/worker/dist/
//   node scripts/build-worker.mjs --out <dir>        # into another folder (the tests compare two builds)
//   node scripts/build-worker.mjs --catalog <dir>    # from another copy of workflows/comfyui
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { unruledPathInputs } from "./lib/catalog-checks.mjs";
import { allowedNodeList, filePins, inputRules, missingRules, readCatalog } from "./lib/worker-catalog.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCES = ["computer-runner", "comfy-guard", "comfy-ws", "fetch-within", "local-comfy", "relay", "lanes", "worker-hours"];

/**
 * What the worker learns from the catalog: its node allowlist, its input rules and its file pins. Throws when an input
 * that must have a rule has none: one of the inputs that write or read a file or format with code (missingRules), or
 * any input whose catalog value names a path, a download or code (unruledPathInputs).
 */
export function workerParts(catalog, root = ROOT) {
  const nodes = allowedNodeList(root, catalog);
  const rules = inputRules(catalog);
  const missing = [...missingRules(rules, nodes), ...unruledPathInputs(catalog, rules)];
  if (missing.length) throw new Error(`These allowed inputs have no rule: ${missing.join(", ")}. Give each a literal value in the catalog.`);
  return { nodes, rules, pins: filePins(catalog) };
}

/** Each built file's text: the transpiled modules and the three catalog files. Nothing is written. */
export function workerFiles({ root = ROOT, catalogDir } = {}) {
  const catalog = readCatalog(root, catalogDir);
  const { nodes, rules, pins } = workerParts(catalog, root);
  const files = {};
  for (const name of SOURCES) {
    const src = fs.readFileSync(path.join(root, "src/lib", `${name}.ts`), "utf8");
    const { outputText } = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false, isolatedModules: true }, fileName: `${name}.ts` });
    const js = outputText.replace(/from "\.\/([\w-]+)"/g, (m, dep) => {
      if (!SOURCES.includes(dep)) throw new Error(`${name}.ts imports ./${dep}, which the worker build doesn't include`);
      return `from "./${dep}.mjs"`;
    });
    if (/from "(@\/|\.\.\/)/.test(js)) throw new Error(`${name}.ts imports something outside src/lib's worker files`);
    files[`${name}.mjs`] = `// Built from src/lib/${name}.ts by scripts/build-worker.mjs. Don't edit.\n${js}`;
  }
  const json = (data) => `${JSON.stringify({ built: "scripts/build-worker.mjs", ...data }, null, 1)}\n`;
  files["allowed-nodes.json"] = json({ nodes });
  files["input-rules.json"] = json(rules);
  files["file-pins.json"] = json({ files: pins });
  const ruled = Object.values(rules.inputs).reduce((n, r) => n + Object.keys(r).length, 0);
  return { files, summary: `worker: ${SOURCES.length} modules, ${nodes.length} allowed node types, ${ruled} input rules, ${Object.keys(pins).length} file hashes` };
}

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
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(out, name), text);
  console.log(`${summary} -> ${path.relative(ROOT, out) || out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message ?? e);
    process.exit(1);
  }
}
