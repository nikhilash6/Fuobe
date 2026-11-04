// Checks on the catalog that the worker build and the tests share (docs/adding-a-model.md). Pure: they read a catalog
// object (scripts/lib/worker-catalog.mjs readCatalog) and the built rules, never the disk.
import { loaderInput, MODEL_EXT, pathNamed, TEXT_NAME, valueProblem } from "../../bin/lib/worker/rules.mjs";
import { filePins, REQUIRED_RULES } from "./worker-catalog.mjs";

const nodesOf = (graph) => Object.values(graph ?? {}).filter((n) => n && typeof n === "object" && typeof n.class_type === "string");

/**
 * Every node input in the catalog's graphs whose written value names a path, a download or code, read on its own and
 * not through the rules builder: a loader's input file, a text value of an input named for a file or a folder, a value
 * with a slash and no spaces (a path, or an "org/name" download id), a model file's name, a value the worker's second
 * layer refuses, and the inputs that must always have a rule (REQUIRED_RULES). Inputs that take free text (prompts,
 * captions, expressions) are left out: they keep any text.
 * @returns {{ cls: string, input: string, why: string[] }[]} sorted by class and input
 */
export function pathInputs(catalog) {
  const out = new Map();
  const add = (cls, input, why) => {
    const key = `${cls}\u0000${input}`;
    const p = out.get(key) ?? { cls, input, why: [] };
    if (!p.why.includes(why)) p.why.push(why);
    out.set(key, p);
  };
  const required = new Set(REQUIRED_RULES.map(([cls, input]) => `${cls}\u0000${input}`));
  for (const g of Object.values(catalog.graphs ?? {})) {
    for (const n of nodesOf(g)) {
      for (const [input, v] of Object.entries(n.inputs ?? {})) {
        if (Array.isArray(v)) continue; // a link: the rules builder refuses links into these inputs itself
        const cls = n.class_type;
        if (required.has(`${cls}\u0000${input}`)) add(cls, input, "required");
        if (loaderInput(cls, input)) add(cls, input, "input file");
        if (typeof v !== "string" || TEXT_NAME.test(input)) continue;
        if (pathNamed(input)) add(cls, input, "named for a path");
        if (!/\s/.test(v) && /[\\/]/.test(v)) add(cls, input, "a path or a download");
        if (!/\s/.test(v) && MODEL_EXT.test(v)) add(cls, input, "a model file");
        if (!/\s/.test(v) && valueProblem(v)) add(cls, input, "refused as a path");
      }
    }
  }
  return [...out.values()].sort((a, b) => a.cls.localeCompare(b.cls) || a.input.localeCompare(b.input));
}

/** The path, download and code inputs of the catalog that `rules` gives no rule ("Class.input (why)"). */
export function unruledPathInputs(catalog, rules) {
  return pathInputs(catalog)
    .filter((p) => !rules.inputs?.[p.cls]?.[p.input])
    .map((p) => `${p.cls}.${p.input} (${p.why.join(", ")})`);
}

/** Manifest bindings whose model file the run picks (a LoRA, an upscaler): no file of the catalog, so no pin. */
const RUN_PICKED = /^(lora|loraHigh|loraLow|upscaleModel)$/;

/**
 * The model files the catalog names that have no SHA-256 pin: every file of the requirement index (required and
 * optional), and every model file a graph names that the index doesn't hold, unless the run picks it (a LoRA or an
 * upscaler the manifest binds) or a node fetches it on its first run (named in the workflow's autoDownloads, pinned in
 * first-run-files.json instead).
 * @returns {Record<string, string[]>} "folder/file" (the bare name for a file the index doesn't know) → workflow ids
 */
export function unpinnedModelFiles(catalog, rules) {
  const pins = filePins(catalog);
  const out = new Map();
  const add = (key, id) => out.set(key, new Set([...(out.get(key) ?? []), id]));
  for (const [id, wf] of Object.entries(catalog.requirements.workflows ?? {})) {
    for (const key of [...(wf.files ?? []), ...(wf.optional ?? [])]) if (!pins[key]) add(key, id);
  }
  const known = Object.values(catalog.requirements.files ?? {});
  for (const w of catalog.manifest.workflows ?? []) {
    const g = catalog.graphs[w.file];
    if (!g) continue;
    const picked = new Set(Object.entries(w.bindings ?? {}).filter(([b]) => RUN_PICKED.test(b)).flatMap(([, targets]) => targets.map((t) => `${t.node}\u0000${t.input}`)));
    const firstRun = (w.autoDownloads ?? []).join("\n");
    for (const [nodeId, n] of Object.entries(g)) {
      if (!n || typeof n.class_type !== "string") continue;
      for (const [input, v] of Object.entries(n.inputs ?? {})) {
        const rule = rules.inputs?.[n.class_type]?.[input];
        if (rule?.kind !== "model-file" || typeof v !== "string" || !v) continue;
        if (picked.has(`${nodeId}\u0000${input}`) || firstRun.includes(v)) continue;
        const f = known.find((x) => x.file === v && (!rule.folders?.length || rule.folders.includes(x.folder)));
        if (!f) add(v, w.id);
        else if (!pins[`${f.folder}/${f.file}`]) add(`${f.folder}/${f.file}`, w.id);
      }
    }
  }
  return Object.fromEntries([...out].sort(([a], [b]) => a.localeCompare(b)).map(([k, ids]) => [k, [...ids].sort()]));
}

/** A path under the ComfyUI folder: plain name parts joined by "/", no "..", no drive, no leading slash. */
const PLAIN_PATH = /^[\w@+-][\w.@+-]*(\/[\w@+-][\w.@+-]*)*$/;

/** What is wrong with one pinned first-run file ({ path, url, sizeBytes, sha256 }), or null. */
export function firstRunFileProblem(f) {
  if (!f || typeof f !== "object" || Array.isArray(f)) return "each file is an object: { path, url, sizeBytes, sha256 }";
  const name = typeof f.path === "string" ? f.path : JSON.stringify(f.path);
  if (typeof f.path !== "string" || !PLAIN_PATH.test(f.path)) return `${name}: the path must be a plain relative path under the ComfyUI folder`;
  if (typeof f.url !== "string" || !/^https:\/\/[^\s/]+\/\S+$/.test(f.url)) return `${name}: the url must be an https link`;
  if (/^https:\/\/huggingface\.co\//.test(f.url) && !/\/resolve\/[0-9a-f]{40}\//.test(f.url)) return `${name}: a Hugging Face url must name a commit (resolve/<40 hex>/)`;
  if (!Number.isInteger(f.sizeBytes) || f.sizeBytes <= 0) return `${name}: sizeBytes must be the file's exact size`;
  if (typeof f.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(f.sha256)) return `${name}: sha256 must be 64 lower-case hex digits`;
  return null;
}

/**
 * Every workflow whose nodes fetch files on their first run (autoDownloads) lists those files with their pins in
 * first-run-files.json, unless it is on `gaps` (the workflows not pinned yet, a list that may only shrink).
 * @returns {string[]} the problems, or none
 */
export function firstRunProblems(manifest, firstRunFiles, gaps = []) {
  const problems = [];
  const byId = new Map((manifest.workflows ?? []).map((w) => [w.id, w]));
  const downloads = (id) => (byId.get(id)?.autoDownloads ?? []).length > 0;
  const listed = firstRunFiles?.workflows ?? {};
  for (const w of manifest.workflows ?? []) {
    if (!downloads(w.id)) continue;
    const has = Array.isArray(listed[w.id]) && listed[w.id].length > 0;
    if (gaps.includes(w.id)) {
      if (has) problems.push(`${w.id}: its first-run files are pinned now; take it off the list of gaps`);
    } else if (!has) problems.push(`${w.id}: a node fetches files on its first run (autoDownloads) and first-run-files.json pins none`);
  }
  for (const id of gaps) if (!downloads(id)) problems.push(`${id}: on the list of gaps, but it fetches nothing on its first run`);
  for (const [id, files] of Object.entries(listed)) {
    if (!downloads(id)) problems.push(`${id}: first-run-files.json lists it, but the manifest names no first-run download for it`);
    if (!Array.isArray(files)) {
      problems.push(`${id}: a list of files`);
      continue;
    }
    for (const f of files) {
      const p = firstRunFileProblem(f);
      if (p) problems.push(`${id}: ${p}`);
    }
  }
  return problems;
}

/**
 * VideoHelperSuite's save node formats that write metadata into a clip, from the node's definition in
 * object_info.subset.json: the formats whose options include save_metadata (its default is on). Null: not known.
 */
export function metadataFormats(subset) {
  const formats = subset?.VHS_VideoCombine?.input?.required?.format?.[1]?.formats;
  if (!formats || typeof formats !== "object") return null;
  return new Set(Object.entries(formats).filter(([, options]) => JSON.stringify(options).includes('"save_metadata"')).map(([f]) => f));
}

/**
 * The catalog workflows whose graphs save a clip with its metadata (the prompt, the machine's local time): a save node
 * whose save_metadata isn't false, in a format that writes it (`formats`, from metadataFormats; every format when not
 * known). An input left out takes the node's default, which keeps the metadata.
 * @param {{ graphs: Record<string, object>, manifest: { workflows?: { id: string, file: string }[] } }} catalog
 * @param {Set<string> | null} [formats]
 * @returns {string[]} workflow ids
 */
export function metadataKept(catalog, formats = null) {
  const keeps = (n) => {
    if (n.class_type !== "VHS_VideoCombine" && !("save_metadata" in (n.inputs ?? {}))) return false;
    if (n.inputs?.save_metadata === false) return false;
    const format = n.inputs?.format;
    return !formats || typeof format !== "string" || formats.has(format);
  };
  return (catalog.manifest.workflows ?? []).filter((w) => nodesOf(catalog.graphs[w.file]).some(keeps)).map((w) => w.id).sort();
}
