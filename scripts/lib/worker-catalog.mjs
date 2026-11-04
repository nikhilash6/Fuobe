// What the worker program learns from the studio's catalog at build time (scripts/build-worker.mjs writes it into
// bin/lib/worker/dist/). Pure apart from reading the catalog's files, so the tests derive the same rules in memory.
//
//   - allowedNodes: every node type the catalog's workflows and the graph builders use.
//   - inputRules: a rule for each node input that could name a file, a folder, a download or code, taken from the
//     catalog's own values. The worker refuses a value outside its rule, and a link from another node into it.
//   - filePins: the SHA-256 of every model file the catalog names, from requirements.json and model-pins.json.
import fs from "node:fs";
import path from "node:path";
import { loaderInput, MODEL_EXT, pathNamed, TEXT_NAME, valueProblem } from "../../bin/lib/worker/rules.mjs";

const SKIP = new Set(["requirements.json", "manifest.json", "model-pins.json"]);

/** The catalog: its workflow graphs by file name, its manifest, its requirement index and its model pins. */
export function readCatalog(root) {
  const dir = path.join(root, "workflows/comfyui");
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const graphs = {};
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith(".json") || SKIP.has(f)) continue;
    try {
      graphs[f] = read(f);
    } catch {}
  }
  const pinsFile = path.join(dir, "model-pins.json");
  return { graphs, manifest: read("manifest.json"), requirements: read("requirements.json"), pins: fs.existsSync(pinsFile) ? read("model-pins.json") : {} };
}

const nodesOf = (graph) => Object.entries(graph ?? {}).filter(([, n]) => n && typeof n === "object" && typeof n.class_type === "string");

/** Every source file of the graph builders (they add nodes of their own: LoRA loaders, joins, overlays…). */
function builderSources(root) {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
  return [...walk(path.join(root, "src/lib")), ...walk(path.join(root, "src/server"))];
}

/** The node allowlist: the catalog's node types, the ones the graph builders add, and the LoRA loaders. */
export function allowedNodeList(root, catalog = readCatalog(root)) {
  const nodes = new Set();
  for (const wf of Object.values(catalog.requirements.workflows ?? {})) {
    for (const c of wf.core ?? []) nodes.add(c);
    for (const cs of Object.values(wf.packs ?? {})) for (const c of cs) nodes.add(c);
  }
  for (const g of Object.values(catalog.graphs)) for (const [, n] of nodesOf(g)) nodes.add(n.class_type);
  for (const file of builderSources(root)) for (const m of fs.readFileSync(file, "utf8").matchAll(/class_type: "([^"]+)"/g)) nodes.add(m[1]);
  for (const extra of ["LoraLoader", "LoraLoaderModelOnly"]) nodes.add(extra);
  return [...nodes].sort();
}

// ---------------------------------------------------------------------------
// Input rules (their kinds, and how the worker reads them: bin/lib/worker/rules.mjs)

/** Manifest bindings that name a file the job sends, and the ones that name a model file. */
const MEDIA_BINDING = /^(image\d*|endImage|mask|prevMask|paletteImage|video\d*|historyVideo|audio\d*|splatFile|fadeCurve)$/;
const MODEL_BINDING = /^(checkpoint|unet|vae|lora|loraHigh|loraLow|upscaleModel)$/;

/** Inputs held to the catalog's values whatever their name: a format string, and whether a node writes a file. */
const ALWAYS_PINNED = { StringFormat: ["f_string"], AILab_Qwen3ASRSubtitle: ["output_format"] };

const isLink = (v) => Array.isArray(v);
/** A path or a download id ("org/name"): no spaces, and a slash. */
const looksLikePath = (v) => typeof v === "string" && !/\s/.test(v) && /[\\/]/.test(v);

/** Sort key for values of mixed types (so the built file is stable). */
const valueKey = (v) => `${typeof v}:${JSON.stringify(v)}`;

/**
 * The rules, from the catalog alone: { inputs: { class: { input: rule } }, text: { class: [input] }, closed: { class:
 * [input] } }. "text": inputs that take free text or a value the studio fills per run (the second layer skips them).
 * "closed": classes with an input pinned for naming a file or holding code; each takes only the inputs listed.
 */
export function inputRules(catalog) {
  const pairs = new Map();
  const pair = (cls, input) => {
    const key = `${cls}\u0000${input}`;
    let p = pairs.get(key);
    if (!p) pairs.set(key, (p = { cls, input, literals: new Map(), links: 0, bindings: new Set(), defaults: new Map(), folders: new Set() }));
    return p;
  };
  // Every value the catalog's graphs write, and every link.
  for (const g of Object.values(catalog.graphs)) {
    for (const [, n] of nodesOf(g)) {
      for (const [input, v] of Object.entries(n.inputs ?? {})) {
        const p = pair(n.class_type, input);
        if (isLink(v)) p.links++;
        else p.literals.set(valueKey(v), v);
      }
    }
  }
  // What the manifest binds: which inputs the studio fills per run, and with what (and their defaults).
  for (const w of catalog.manifest.workflows ?? []) {
    const g = catalog.graphs[w.file];
    if (!g) continue;
    for (const [b, targets] of Object.entries(w.bindings ?? {})) {
      for (const t of targets) {
        const n = g[t.node];
        if (!n || typeof n.class_type !== "string") continue;
        const p = pair(n.class_type, t.input);
        p.bindings.add(b);
        const d = w.defaults?.[b];
        if (d !== undefined && d !== null && typeof d !== "object") p.defaults.set(valueKey(d), d);
      }
    }
  }
  // Which model folders each loader input reads.
  for (const f of Object.values(catalog.requirements.files ?? {})) {
    for (const [cls, input] of f.loaders ?? []) pair(cls, input).folders.add(f.folder);
  }

  const inputs = {};
  const text = {};
  const closed = new Set();
  const set = (p, rule) => ((inputs[p.cls] ??= {})[p.input] = rule);
  const pinned = (p, extra = []) => {
    const values = [...new Map([...p.literals, ...extra.map((v) => [valueKey(v), v])]).values()].sort((a, b) => valueKey(a).localeCompare(valueKey(b)));
    return values.length === 1 ? { kind: "literal", value: values[0] } : { kind: "enum", values };
  };
  const addText = (p) => (text[p.cls] ??= []).push(p.input);
  const pin = (p, close) => {
    if (p.links) throw new Error(`${p.cls}.${p.input} names a file, a download or code, and the catalog links into it: give it a literal value`);
    set(p, pinned(p, [...p.defaults.values()]));
    if (close) closed.add(p.cls);
  };

  for (const p of pairs.values()) {
    const b = [...p.bindings];
    const lits = [...p.literals.values()];
    const strings = lits.filter((v) => typeof v === "string");
    // Named for a file or folder (a number or a switch never names one: path_precision is a precision).
    const named = pathNamed(p.input) && !(lits.length && !strings.length);
    // A file this job sent.
    if (loaderInput(p.cls, p.input) || b.some((x) => MEDIA_BINDING.test(x))) set(p, { kind: "input-file" });
    // A save name the studio makes.
    else if (p.input === "filename_prefix" || b.includes("filenamePrefix")) set(p, { kind: "output-name" });
    // A model file, by its name in a model folder.
    else if (!named && !strings.some(looksLikePath) && (p.folders.size || b.some((x) => MODEL_BINDING.test(x)) || strings.some((v) => MODEL_EXT.test(v) && !/\s/.test(v)))) {
      set(p, { kind: "model-file", folders: [...p.folders].sort() });
    }
    // Code, or an input named for a file or folder: the catalog's values only, and the class takes only the catalog's inputs.
    else if (ALWAYS_PINNED[p.cls]?.includes(p.input) || named) pin(p, true);
    // Prompts, captions, lyrics, expressions.
    else if (TEXT_NAME.test(p.input)) addText(p);
    // A value that is a path, a download (an org/name id) or anything else the second layer refuses: pinned. (A value
    // the studio fills per run is pinned only when it looks like a path or an id.)
    else if (b.length ? strings.some(looksLikePath) : strings.some((v) => looksLikePath(v) || (!/\s/.test(v) && valueProblem(v)))) pin(p, false);
    // Filled per run (a size, a seed, a language, a setting), or written as prose in the catalog.
    else if (b.length || strings.some((v) => /\s/.test(v))) addText(p);
  }

  // A closed class takes only the inputs the catalog gives it. Every other input the catalog writes as a literal is
  // held to the catalog's values too (they set what such a node reads, writes or keeps), unless the studio fills it
  // per run; a number to the catalog's range.
  const known = {};
  for (const p of pairs.values()) {
    if (!closed.has(p.cls)) continue;
    (known[p.cls] ??= []).push(p.input);
    if (inputs[p.cls]?.[p.input] || p.links || p.bindings.size) continue;
    const lits = [...p.literals.values()];
    if (!lits.length) continue;
    if (lits.every((v) => typeof v === "number")) {
      set(p, { kind: "range", min: Math.min(...lits), max: Math.max(...lits), integer: lits.every(Number.isInteger) });
    } else set(p, pinned(p));
    if (text[p.cls]) text[p.cls] = text[p.cls].filter((i) => i !== p.input);
  }

  const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  const lists = (o) => sortObj(Object.fromEntries(Object.entries(o).map(([c, l]) => [c, [...new Set(l)].sort()])));
  return {
    inputs: sortObj(Object.fromEntries(Object.entries(inputs).map(([c, r]) => [c, sortObj(r)]))),
    text: lists(text),
    closed: lists(known),
  };
}

/** Inputs that must have a rule whenever their node is allowed: each writes or reads a file, or formats with code. */
export const REQUIRED_RULES = [
  ["AILab_Qwen3ASRSubtitle", "output_path"],
  ["AILab_Qwen3ASRSubtitle", "output_format"],
  ["MiniMaxH3SourceTimeline", "video_path"],
  ["MiniMaxH3SourceTimeline", "audio_path"],
  ["WanVideoImageToVideoMultiTalk", "output_path"],
  ["StringFormat", "f_string"],
];

/** The required inputs of allowed nodes that have no rule ("Class.input"); the build stops on any. */
export function missingRules(rules, allowed) {
  return REQUIRED_RULES.filter(([cls, input]) => allowed.includes(cls) && !rules.inputs[cls]?.[input]).map(([cls, input]) => `${cls}.${input}`);
}

/**
 * Model files that workflows for workers need and that have no SHA-256 pin yet ("folder/file"). A worker never reports
 * such a file, so no worker runs a workflow that needs one. A file here sits in a repository that asks a signed-in
 * account to accept its licence before its hash can be read (`node scripts/comfy/build-requirements.mjs --refresh-pins`
 * with HF_TOKEN). The list may only shrink: a test fails when a new file has no pin, and when a file here gets one.
 */
export const UNPINNED_FILES = [
  "loras/ltx-2.5-22b-ic-lora-restore-1.0.safetensors",
];

/** The files that workflows for workers (not isolated) need and that have no pin: "folder/file" → the workflows. */
export function unpinnedFiles(catalog) {
  const pins = filePins(catalog);
  const out = {};
  for (const [id, wf] of Object.entries(catalog.requirements.workflows ?? {})) {
    if (wf.isolated) continue;
    for (const k of wf.files ?? []) {
      const f = catalog.requirements.files?.[k];
      if (!f) continue;
      const key = `${f.folder}/${f.file}`;
      if (!pins[key]) (out[key] ??= []).push(id);
    }
  }
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k].sort()]));
}

/** The SHA-256 of every model file the catalog names ("folder/file" → hex), from its index or its model pins. */
export function filePins(catalog) {
  const pins = catalog.pins ?? {};
  const out = {};
  for (const f of Object.values(catalog.requirements.files ?? {})) {
    const sha = f.sha256 ?? pins[f.url]?.sha256 ?? pins[f.pinnedUrl]?.sha256;
    if (typeof sha === "string" && /^[0-9a-f]{64}$/.test(sha)) out[`${f.folder}/${f.file}`] = sha;
  }
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
}
