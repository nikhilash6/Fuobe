// Checks on the catalog that the worker build and the tests share (docs/adding-a-model.md). Pure: they read a catalog
// object (scripts/lib/worker-catalog.mjs readCatalog) and the built rules, never the disk.
import { loaderInput, MODEL_EXT, pathNamed, pathProblem, TEXT_NAME, valueProblem } from "../../bin/lib/worker/rules.mjs";
import { filePins, REQUIRED_RULES } from "./worker-catalog.mjs";

const nodesOf = (graph) => Object.values(graph ?? {}).filter((n) => n && typeof n === "object" && typeof n.class_type === "string");

/** A path or a download id: no spaces, and a slash. */
const slashPath = (s) => !/\s/.test(s) && /[\\/]/.test(s);
/** A model file's name: no spaces, and a model file's extension. */
const modelName = (s) => !/\s/.test(s) && MODEL_EXT.test(s);
/** Path shapes inside words: a drive path, a share, a rooted path with two parts, a home path, a ".." step. */
const PATH_IN_WORDS = [/^\s*[A-Za-z]:[\\/]/, /^\s*[\\/]{2}[^\\/\s]/, /^\s*\/[^\s/]+\//, /^\s*~[\\/]/, /(^|[\\/])\.\.([\\/]|$)/, /(^|\s)\.\.[\\/]/];

/** The keys and strings inside a value written as JSON (a node's settings), read on their own. Null for other text. */
function jsonParts(v) {
  if (!/^\s*[[{]/.test(v)) return null;
  let parsed;
  try {
    parsed = JSON.parse(v);
  } catch {
    return null;
  }
  const out = [];
  const walk = (x) => {
    if (typeof x === "string") out.push(x);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") {
      for (const [k, y] of Object.entries(x)) {
        out.push(k);
        walk(y);
      }
    }
  };
  walk(parsed);
  return out;
}

/**
 * Every node input in the catalog's graphs whose written value names a path, a download or code, read on its own and
 * not through the rules builder: a loader's input file, a text value of an input named for a file or a folder, a value
 * with a slash and no spaces (a path, or an "org/name" download id), a model file's name, a value the worker's second
 * layer refuses, words that take a path's shape ("C:\…", "\\host", "/etc/…", "~/…", ".."), and in a value written as
 * JSON, a key or a string that is a slash path, a model file or one of those shapes; and the inputs that must always
 * have a rule (REQUIRED_RULES). Inputs that take free text (prompts, captions, expressions) are left out: they keep any
 * text. An input the studio fills per run (the manifest binds it) is read only for a slash path, a model file and a
 * name that says path: its catalog value is a default, and any other value ("16:9", "00:00:05") is the run's own.
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
  const bound = boundInputs(catalog);
  for (const g of Object.values(catalog.graphs ?? {})) {
    for (const n of nodesOf(g)) {
      for (const [input, v] of Object.entries(n.inputs ?? {})) {
        if (Array.isArray(v)) continue; // a link: the rules builder stops on a link into an input that has a rule
        const cls = n.class_type;
        if (required.has(`${cls}\u0000${input}`)) add(cls, input, "required");
        if (loaderInput(cls, input)) add(cls, input, "input file");
        if (typeof v !== "string" || TEXT_NAME.test(input)) continue;
        if (pathNamed(input)) add(cls, input, "named for a path");
        if (slashPath(v)) add(cls, input, "a path or a download");
        if (modelName(v)) add(cls, input, "a model file");
        if (bound.has(`${cls}\u0000${input}`)) continue;
        if (!/\s/.test(v) && valueProblem(v)) add(cls, input, "refused as a path");
        const parts = jsonParts(v);
        if (parts) {
          if (parts.some((s) => slashPath(s) || modelName(s) || PATH_IN_WORDS.some((r) => r.test(s)))) add(cls, input, "a path in its JSON");
        } else if (/\s/.test(v) && PATH_IN_WORDS.some((r) => r.test(v))) add(cls, input, "a path in its words");
      }
    }
  }
  return [...out.values()].sort((a, b) => a.cls.localeCompare(b.cls) || a.input.localeCompare(b.input));
}

/** The inputs the manifest binds ("Class\0input"): the studio fills them per run. */
function boundInputs(catalog) {
  const out = new Set();
  for (const w of catalog.manifest?.workflows ?? []) {
    const g = catalog.graphs?.[w.file];
    if (!g) continue;
    for (const targets of Object.values(w.bindings ?? {})) {
      for (const t of targets ?? []) {
        const n = g[t.node];
        if (n && typeof n.class_type === "string") out.add(`${n.class_type}\u0000${t.input}`);
      }
    }
  }
  return out;
}

/** The path, download and code inputs of the catalog that `rules` gives no rule ("Class.input (why)"). */
export function unruledPathInputs(catalog, rules) {
  return pathInputs(catalog)
    .filter((p) => !rules.inputs?.[p.cls]?.[p.input])
    .map((p) => `${p.cls}.${p.input} (${p.why.join(", ")})`);
}

/** An input's type in the nodes' definitions (object_info.subset.json): "STRING", "INT", "COMBO"…, or null. */
function inputType(subset, cls, input) {
  const def = subset?.[cls]?.input;
  const spec = def?.required?.[input] ?? def?.optional?.[input];
  if (!Array.isArray(spec)) return null;
  return Array.isArray(spec[0]) ? "COMBO" : typeof spec[0] === "string" ? spec[0] : null;
}

/**
 * Inputs the studio fills per run (the manifest binds them) with text that isn't a prompt, and that `rules` gives no
 * rule: typed STRING in the nodes' definitions (`subset`, object_info.subset.json), or holding text in the catalog when
 * the definitions don't name the input. A person's text reaches each one, so each must be a setting that its node never
 * reads as a file (FREE_TEXT_INPUTS in scripts/lib/worker-catalog.mjs), or get a rule. Prompts (TEXT_NAME) keep any
 * text and aren't listed.
 * @returns {string[]} "Class.input", sorted
 */
export function perRunTextInputs(catalog, subset, rules) {
  const out = new Set();
  for (const w of catalog.manifest?.workflows ?? []) {
    const g = catalog.graphs?.[w.file];
    if (!g) continue;
    for (const targets of Object.values(w.bindings ?? {})) {
      for (const t of targets ?? []) {
        const n = g[t.node];
        if (!n || typeof n.class_type !== "string" || TEXT_NAME.test(t.input) || rules.inputs?.[n.class_type]?.[t.input]) continue;
        const type = inputType(subset, n.class_type, t.input);
        if (type === "STRING" || (type === null && typeof n.inputs?.[t.input] === "string")) out.add(`${n.class_type}.${t.input}`);
      }
    }
  }
  return [...out].sort();
}

/** Manifest bindings whose model file the run picks (a LoRA, an upscaler): no file of the catalog, so no pin. */
const RUN_PICKED = /^(lora|loraHigh|loraLow|upscaleModel)$/;

/** A path's last part ("a/b/c.pth" → "c.pth"). */
const baseName = (p) => p.split(/[\\/]/).pop();

/**
 * The model files the catalog names that have no SHA-256 pin: every file of the requirement index (required and
 * optional), and every model file a graph names that the index doesn't hold, unless the run picks it (a LoRA or an
 * upscaler the manifest binds) or first-run-files.json pins it for that workflow (a file a node fetches on its first
 * run, matched by its exact file name). A name that only appears in the workflow's autoDownloads text still counts.
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
    const listed = catalog.firstRun?.workflows?.[w.id];
    const firstRun = new Set((Array.isArray(listed) ? listed : []).filter((f) => typeof f?.path === "string").map((f) => baseName(f.path)));
    for (const [nodeId, n] of Object.entries(g)) {
      if (!n || typeof n.class_type !== "string") continue;
      for (const [input, v] of Object.entries(n.inputs ?? {})) {
        const rule = rules.inputs?.[n.class_type]?.[input];
        if (rule?.kind !== "model-file" || typeof v !== "string" || !v) continue;
        if (picked.has(`${nodeId}\u0000${input}`) || firstRun.has(baseName(v))) continue;
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

/** File names that hold code a program runs or loads (a node pack's own files, a script, a library). */
const CODE_EXT = /\.(py|pyc|pyo|pyd|pyw|pyz|so|dylib|dll|exe|com|scr|msi|bat|cmd|ps1|psm1|vbs|sh|js|mjs|cjs|jar|whl|egg)$/i;

/**
 * A data folder for a first-run file: a model folder (models/<…>/<file>), or a folder inside a node pack
 * (custom_nodes/<pack>/<folder>/<…>/<file>). Never the pack's own top level, and never anywhere else in ComfyUI.
 */
const dataPlace = (parts) => (parts[0] === "models" && parts.length >= 2) || (parts[0] === "custom_nodes" && parts.length >= 4);

/** Hugging Face's hosts: huggingface.co, hf.co and every host under them. */
const hfHost = (host) => ["huggingface.co", "hf.co"].some((h) => host === h || host.endsWith(`.${h}`));

/** What is wrong with one pinned first-run file ({ path, url, sizeBytes, sha256 }), or null. */
export function firstRunFileProblem(f) {
  if (!f || typeof f !== "object" || Array.isArray(f)) return "each file is an object: { path, url, sizeBytes, sha256 }";
  const name = typeof f.path === "string" ? f.path : JSON.stringify(f.path);
  if (typeof f.path !== "string" || !PLAIN_PATH.test(f.path) || f.path.includes("..")) return `${name}: the path must be a plain relative path under the ComfyUI folder`;
  const parts = f.path.split("/");
  // Windows reads "x." as "x", and a device name (CON, NUL, COM1…) as the device, in any folder.
  if (parts.some((p) => p.endsWith(".")) || pathProblem(f.path)) return `${name}: the path names a Windows device or ends a name with "."`;
  if (!dataPlace(parts)) return `${name}: the path must be in a model folder (models/…) or in a folder inside a node pack (custom_nodes/<pack>/<folder>/…)`;
  if (CODE_EXT.test(f.path)) return `${name}: a first-run file is data, never code (.py, .dll, .exe, .js…)`;
  let url = null;
  try {
    url = typeof f.url === "string" && !/\s/.test(f.url) ? new URL(f.url) : null;
  } catch {}
  if (!url || url.protocol !== "https:" || !url.hostname || url.username || url.password || url.pathname.length < 2) return `${name}: the url must be an https link`;
  if (hfHost(url.hostname) && !/\/resolve\/[0-9a-f]{40}\//.test(url.pathname)) return `${name}: a Hugging Face url must name a commit (resolve/<40 hex>/)`;
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
 * Save nodes that write the run's graph into every file they save, whatever ComfyUI's --disable-metadata says: core
 * ComfyUI's SVG save node puts it in a <metadata> element.
 */
export const ALWAYS_WRITE_METADATA = new Set(["SaveSVGNode"]);

/**
 * The catalog workflows whose graphs save a result with its metadata (the prompt, the machine's local time): a save
 * node that always writes it (ALWAYS_WRITE_METADATA), or one whose save_metadata isn't false, in a format that writes
 * it (`formats`, from metadataFormats; every format when not known). An input left out takes the node's default, which
 * keeps the metadata.
 * @param {{ graphs: Record<string, object>, manifest: { workflows?: { id: string, file: string }[] } }} catalog
 * @param {Set<string> | null} [formats]
 * @returns {string[]} workflow ids
 */
export function metadataKept(catalog, formats = null) {
  const keeps = (n) => {
    if (ALWAYS_WRITE_METADATA.has(n.class_type)) return true;
    if (n.class_type !== "VHS_VideoCombine" && !("save_metadata" in (n.inputs ?? {}))) return false;
    if (n.inputs?.save_metadata === false) return false;
    const format = n.inputs?.format;
    return !formats || typeof format !== "string" || formats.has(format);
  };
  return (catalog.manifest.workflows ?? []).filter((w) => nodesOf(catalog.graphs[w.file]).some(keeps)).map((w) => w.id).sort();
}
