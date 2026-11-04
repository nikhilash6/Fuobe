// The worker program's shared parts, as scripts/build-worker.mjs writes them into bin/lib/worker/dist/ (that script is
// only the command line; the tests import the parts from here):
//   - the job runner the browser uses (src/lib/computer-runner.ts and its helpers), transpiled to plain .mjs with the
//     typescript dev dependency, relative imports rewritten to .mjs;
//   - allowed-nodes.json: every node type the studio's workflows and graph builders use, frozen into the worker. The
//     studio can't add to it; a worker refuses a graph with any other node;
//   - input-rules.json: a rule for each node input that could name a file, a folder, a download or code, from the
//     catalog's own values (scripts/lib/worker-catalog.mjs). A worker refuses a value outside its rule, and a link
//     into it;
//   - file-pins.json: the SHA-256 of every model file the catalog names. A worker reports a file only when its own
//     hash matches;
//   - build-stamp.json: one SHA-256 over every file the parts are built from (bin/lib/worker/stamp.mjs). A worker
//     starts only when its checkout gives the same stamp.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { buildStamp, STAMP_FILE } from "../../bin/lib/worker/stamp.mjs";
import { unruledPathInputs } from "./catalog-checks.mjs";
import { allowedNodeList, filePins, inputRules, missingRules, readCatalog } from "./worker-catalog.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SOURCES = ["computer-runner", "comfy-guard", "comfy-ws", "fetch-within", "local-comfy", "relay", "lanes", "worker-hours"];

/**
 * What the worker learns from the catalog: its node allowlist, its input rules and its file pins. Throws when an input
 * that must have a rule has none: one of the inputs that write or read a file or format with code (missingRules), or
 * any input whose catalog value names a path, a download or code (unruledPathInputs). inputRules itself throws when
 * the catalog links another node into an input that has a rule.
 */
export function workerParts(catalog, root = ROOT) {
  const nodes = allowedNodeList(root, catalog);
  const rules = inputRules(catalog);
  const missing = [...missingRules(rules, nodes), ...unruledPathInputs(catalog, rules)];
  if (missing.length) throw new Error(`These allowed inputs have no rule: ${missing.join(", ")}. Give each a literal value in the catalog.`);
  return { nodes, rules, pins: filePins(catalog) };
}

/** Each built file's text: the transpiled modules, the three catalog files and the stamp. Nothing is written. */
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
  files[STAMP_FILE] = json({ stamp: buildStamp(root, catalogDir) });
  const ruled = Object.values(rules.inputs).reduce((n, r) => n + Object.keys(r).length, 0);
  return { files, summary: `worker: ${SOURCES.length} modules, ${nodes.length} allowed node types, ${ruled} input rules, ${Object.keys(pins).length} file hashes` };
}
