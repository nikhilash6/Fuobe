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
//   - runtime-files.json: the files a run may add beyond its workflow's own (src/lib/runtime-files.ts: every LoRA
//     library entry with a pinned size and SHA-256). A worker verifies and reports them as it does the catalog's files;
//   - compose/: the graph composer (src/lib/ticket-compose.ts and every file it imports: bin/lib/worker/composer-files.mjs),
//     transpiled the same way, so the worker composes a job ticket's graph with the studio's own code;
//   - catalog-version.json: the catalog version those files and the catalog give. A worker takes a ticket only for it;
//   - build-stamp.json: one SHA-256 over every file the parts are built from (bin/lib/worker/stamp.mjs). A worker
//     starts only when its checkout gives the same stamp.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { builtName, catalogVersion, composerFiles, resolveSpec } from "../../bin/lib/worker/composer-files.mjs";
import { buildStamp, STAMP_FILE } from "../../bin/lib/worker/stamp.mjs";
import { unruledPathInputs } from "./catalog-checks.mjs";
import { allowedNodeList, filePins, inputRules, missingRules, readCatalog } from "./worker-catalog.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SOURCES = ["computer-runner", "comfy-guard", "comfy-ws", "fetch-within", "local-comfy", "relay", "lanes", "worker-hours", "finish-ticket", "camera-path", "path-splat", "scene3d"];

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

const TRANSPILE = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false, isolatedModules: true };

/** The LoRA library a run's run-time files come from (data only: it imports nothing but types). */
export const LORA_LIBRARY_FILE = "src/lib/catalog/lora-library.generated.ts";

/**
 * The run-time files a worker verifies (src/lib/runtime-files.ts runtimeFiles, which the tests hold this to): each LoRA
 * library entry with a pinned SHA-256 and size, once by name, sorted. The library is read by transpiling its file and
 * running it alone (it imports types only), so nothing else of the studio runs here.
 */
export function runtimeFilePins(root = ROOT) {
  const src = fs.readFileSync(path.join(root, LORA_LIBRARY_FILE), "utf8");
  const { outputText } = ts.transpileModule(src, { compilerOptions: { ...TRANSPILE, module: ts.ModuleKind.CommonJS }, fileName: path.basename(LORA_LIBRARY_FILE) });
  const mod = { exports: {} };
  const require = (name) => {
    throw new Error(`${LORA_LIBRARY_FILE} imports ${name}: it may hold data only`);
  };
  vm.runInNewContext(outputText, { module: mod, exports: mod.exports, require }, { filename: LORA_LIBRARY_FILE });
  const library = mod.exports.LORA_LIBRARY;
  if (!Array.isArray(library)) throw new Error(`${LORA_LIBRARY_FILE} has no LORA_LIBRARY`);
  const out = new Map();
  for (const e of library) {
    if (!e?.file || out.has(e.file) || typeof e.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(e.sha256) || !Number.isInteger(e.sizeBytes) || e.sizeBytes <= 0) continue;
    out.set(e.file, { folder: "loras", file: e.file, sizeBytes: e.sizeBytes, sha256: e.sha256 });
  }
  return [...out.values()].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/**
 * The graph composer as plain .mjs files under compose/ (src/lib/x.ts → compose/lib/x.mjs; a .json it imports →
 * compose/….json.mjs, with the data as its default export), each import pointed at the built file. Node's own modules
 * stay; a package is refused (composer-files.mjs).
 */
export function composerParts(root = ROOT) {
  const files = {};
  for (const rel of composerFiles(root)) {
    const out = `compose/${builtName(rel)}`;
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    const head = `// Built from ${rel} by scripts/build-worker.mjs. Don't edit.\n`;
    if (rel.endsWith(".json")) {
      files[out] = `${head}const data = ${JSON.stringify(JSON.parse(src))};\nexport default data;\n`;
      continue;
    }
    const { outputText } = ts.transpileModule(src, { compilerOptions: TRANSPILE, fileName: path.basename(rel) });
    // Each module name the transpiled file imports (TypeScript finds them: imports, re-exports, import()), from the last.
    const named = ts.preProcessFile(outputText, true, true).importedFiles.sort((a, b) => b.pos - a.pos);
    let js = outputText;
    for (const f of named) {
      const r = resolveSpec(root, rel, f.fileName);
      if (r === "node:") continue;
      if (r === null) throw new Error(`${rel} imports the package ${f.fileName}: the composer may import only its own files and Node's`);
      let to = path.posix.relative(path.posix.dirname(out), `compose/${builtName(r)}`);
      if (!to.startsWith(".")) to = `./${to}`;
      const at = js.indexOf(f.fileName, f.pos);
      if (at < 0 || at > f.end) throw new Error(`Couldn't place the import of ${f.fileName} in ${rel}`);
      js = js.slice(0, at) + to + js.slice(at + f.fileName.length);
    }
    files[out] = head + js;
  }
  return files;
}

/**
 * Each built file's text: the transpiled modules, the composer, the three catalog files, the catalog version and the
 * stamp. Nothing is written.
 */
export function workerFiles({ root = ROOT, catalogDir } = {}) {
  const catalog = readCatalog(root, catalogDir);
  const { nodes, rules, pins } = workerParts(catalog, root);
  const files = {};
  for (const name of SOURCES) {
    const src = fs.readFileSync(path.join(root, "src/lib", `${name}.ts`), "utf8");
    const { outputText } = ts.transpileModule(src, { compilerOptions: TRANSPILE, fileName: `${name}.ts` });
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
  const runtime = runtimeFilePins(root);
  files["runtime-files.json"] = json({ files: runtime });
  const composer = composerParts(root);
  Object.assign(files, composer);
  files["catalog-version.json"] = json({ version: catalogVersion(root, catalogDir) });
  files[STAMP_FILE] = json({ stamp: buildStamp(root, catalogDir) });
  const ruled = Object.values(rules.inputs).reduce((n, r) => n + Object.keys(r).length, 0);
  return { files, summary: `worker: ${SOURCES.length} modules, ${Object.keys(composer).length} composer files, ${nodes.length} allowed node types, ${ruled} input rules, ${Object.keys(pins).length} file hashes, ${runtime.length} run-time files` };
}
