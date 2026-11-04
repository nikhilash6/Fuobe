// What the worker program learns from the studio's catalog at build time (scripts/build-worker.mjs writes it into
// bin/lib/worker/dist/). Pure apart from reading the catalog's files, so the tests derive the same rules in memory.
//
//   - allowedNodes: every node type the catalog's workflows and the graph builders use.
//   - inputRules: a rule for each node input that could name a file, a folder, a download or code, taken from the
//     catalog's own values. The worker refuses a value outside its rule, and a link from another node into it, so the
//     build stops when the catalog links into an input that has a rule.
//   - filePins: the SHA-256 of every model file the catalog names, from requirements.json and model-pins.json.
import fs from "node:fs";
import path from "node:path";
import { jsonStrings, loaderInput, MODEL_EXT, pathNamed, TEXT_NAME, textPathProblem, valueProblem } from "../../bin/lib/worker/rules.mjs";
import { builderSources } from "../../bin/lib/worker/stamp.mjs";

const SKIP = new Set(["requirements.json", "manifest.json", "model-pins.json", "first-run-files.json"]);

/**
 * The catalog: its workflow graphs by file name, its manifest, its requirement index, its model pins and its pinned
 * first-run files. `dir` is the library folder (workflows/comfyui under the root unless given).
 */
export function readCatalog(root, dir = path.join(root, "workflows/comfyui")) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const graphs = {};
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith(".json") || SKIP.has(f)) continue;
    try {
      graphs[f] = read(f);
    } catch {}
  }
  const pinsFile = path.join(dir, "model-pins.json");
  const firstRunFile = path.join(dir, "first-run-files.json");
  return {
    graphs,
    manifest: read("manifest.json"),
    requirements: read("requirements.json"),
    pins: fs.existsSync(pinsFile) ? read("model-pins.json") : {},
    firstRun: fs.existsSync(firstRunFile) ? read("first-run-files.json") : { workflows: {} },
  };
}

const nodesOf = (graph) => Object.entries(graph ?? {}).filter(([, n]) => n && typeof n === "object" && typeof n.class_type === "string");

/**
 * The node allowlist: the catalog's node types, the ones the graph builders add (builderSources: they add nodes of
 * their own, such as LoRA loaders, joins and overlays), and the LoRA loaders.
 */
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

/** A name with a file's extension (".json", ".engine", ".safetensors"…). */
const FILE_EXT = /\.[A-Za-z0-9_]{1,12}$/;

/** A path, a download id or a model file's name: no spaces, and a slash or a model file's extension. */
const namesFile = (v) => looksLikePath(v) || (typeof v === "string" && !/\s/.test(v) && MODEL_EXT.test(v));

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
  // Which model folders each loader input reads, and the files the index names under a subfolder of one ("Kandinsky-…/
  // transformer/…" in diffusion_models): a loader reads such a name as a model file, never as a path of its own.
  const subfolderFiles = new Map();
  for (const f of Object.values(catalog.requirements.files ?? {})) {
    for (const [cls, input] of f.loaders ?? []) {
      const p = pair(cls, input);
      p.folders.add(f.folder);
      if (/[\\/]/.test(f.file)) (subfolderFiles.get(p) ?? subfolderFiles.set(p, new Set()).get(p)).add(f.file);
    }
  }
  /** A value that looks like a path and isn't a model file the index names under one of this input's folders. */
  const pathOf = (p) => (v) => looksLikePath(v) && !subfolderFiles.get(p)?.has(v);

  const inputs = {};
  const text = {};
  const closed = new Set();
  // A worker refuses a link into any input that has a rule, so a catalog graph that links into one could never run on
  // a worker: the build stops instead.
  const set = (p, rule) => {
    if (p.links) throw new Error(`${p.cls}.${p.input} names a file, a download or code, and the catalog links into it: give it a literal value`);
    (inputs[p.cls] ??= {})[p.input] = rule;
  };
  const pinned = (p, extra = []) => {
    const values = [...new Map([...p.literals, ...extra.map((v) => [valueKey(v), v])]).values()].sort((a, b) => valueKey(a).localeCompare(valueKey(b)));
    return values.length === 1 ? { kind: "literal", value: values[0] } : { kind: "enum", values };
  };
  const addText = (p) => (text[p.cls] ??= []).push(p.input);
  const pin = (p, close) => {
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
    else if (!named && !strings.some(pathOf(p)) && (p.folders.size || b.some((x) => MODEL_BINDING.test(x)) || strings.some((v) => MODEL_EXT.test(v) && !/\s/.test(v)))) {
      // The worker takes only a file it verified, or one of these catalog values that name no file ("None", say).
      const plain = [...new Set(strings.filter((v) => v !== "" && !FILE_EXT.test(v)))].sort();
      set(p, { kind: "model-file", folders: [...p.folders].sort(), ...(plain.length && { plain }) });
    }
    // Code, or an input named for a file or folder: the catalog's values only, and the class takes only the catalog's inputs.
    else if (ALWAYS_PINNED[p.cls]?.includes(p.input) || named) pin(p, true);
    // Prompts, captions, lyrics, expressions.
    else if (TEXT_NAME.test(p.input)) addText(p);
    // A value that is a path, a download (an org/name id) or anything else the second layer refuses, or text (JSON
    // settings, say) that the worker's check of free text refuses or that holds a path or a model file: pinned. (A value
    // the studio fills per run is pinned only when it looks like a path or an id.)
    else if (b.length ? strings.some(looksLikePath) : strings.some((v) => looksLikePath(v) || (!/\s/.test(v) && valueProblem(v)) || textPathProblem(v) || jsonStrings(v).some(namesFile))) pin(p, false);
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
 * Inputs the studio fills per run with text that isn't a prompt, and that have no rule ("Class.input"). Each is a
 * setting that its node reads as text or as a choice, never as a file: touches, boxes and points written as JSON,
 * numbers written as text, a colour, a size, a profile. A person's text reaches them, and the worker refuses any value
 * that takes a path's shape (rules.mjs textPathProblem). tests/adding-a-model.test.ts (perRunTextInputs) fails when the
 * catalog fills another such input per run: add it here only when its node never reads it as a path, or give it a
 * rule. It also fails when an input here is no longer filled per run.
 */
export const FREE_TEXT_INPUTS = [
  "AUSBOSS_NODES_MaskByTouch.touches",
  "Add Subtitles To Frames.font_color",
  "H3CharacterSwapPrepareVideo.resolution",
  "H3CharacterSwapSelectSubject.selection",
  "H3CharacterSwapWindowPlan.history_frames",
  "H3CharacterSwapWindowPlan.window_frames",
  "H3RelayReviewWindows.window_controls",
  "IdolPreprocessImage.mode",
  "ManualSigmas.sigmas",
  "NomasWorldPrompt.scene",
  "OpenH3RegenPrepareDraft.size",
  "OpenH3RegenUpscale.resolution",
  "QWMDetect.boxes_json",
  "RTXTrueHDR.output_colorspace",
  "RTXVideoFrameGeneration.mode",
  "RTXVideoSuperResolution.quality",
  "SAM3_Detect.negative_coords",
  "SAM3_Detect.positive_coords",
  "VHS_VideoCombine.profile",
];

/**
 * Model files the catalog names that have no SHA-256 pin yet: the one list of them. A file of the requirement index is
 * "folder/file". A file that only a graph names is its bare name: a node fetches it on its first run, and
 * first-run-files.json doesn't pin it yet. A worker never reports such a file, so no worker runs a workflow that needs
 * one. The index files here sit in a repository that asks a signed-in account to accept its licence before their hashes
 * can be read (`node scripts/comfy/build-requirements.mjs --refresh-pins` with HF_TOKEN). The list may only shrink: tests/adding-a-model.test.ts fails when a file has no pin and
 * isn't here, and when a file here gets one; tests/worker-input-rules.test.ts fails when a file that a workflow for
 * workers needs has no pin and isn't here.
 */
export const UNPINNED_FILES = [
  "loras/ltx-2.5-22b-ic-lora-refine-details-1.0.safetensors",
  "loras/ltx-2.5-22b-ic-lora-restore-1.0.safetensors",
  "rife49.pth",
  "video_depth_anything_vitl.pth",
  "video_depth_anything_vits.pth",
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
