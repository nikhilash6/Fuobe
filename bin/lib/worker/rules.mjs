// The worker's input rules (docs/gpu-workers.md): what each node input may hold. scripts/build-worker.mjs derives a
// rule for every input that could name a file, a folder, a download or code from the studio's catalog, and writes them
// to dist/input-rules.json. The studio can't change them: a studio taken over can't make this worker read or write
// files, fetch anything, or run new code through a node it allows.
//
// A rule is one of:
//   { kind: "literal", value }               the catalog's one value
//   { kind: "enum", values }                 one of the catalog's values
//   { kind: "range", min, max, integer }     a number from min to max
//   { kind: "input-file" }                   a file this job sent, under the name the studio gave it
//   { kind: "output-name" }                  a save name the studio makes: plain name parts, no path
//   { kind: "model-file", folders, plain? }  a model file this worker verified (in one of those model folders), or
//                                            one of the catalog's own values that name no file ("plain")
// Every ruled input takes a value written in the graph, never a link from another node.

/** Input names that name a file, a folder or an address. */
export const PATH_WORDS = new Set(["path", "paths", "file", "files", "filename", "filenames", "filepath", "pathname", "fname", "dir", "dirs", "directory", "folder", "folders", "subfolder", "url", "urls", "uri", "location"]);

/** The words of an input name: output_path → output, path; videoPath → video, path. */
export const nameWords = (name) =>
  String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Is this input named for a file, a folder or an address? */
export const pathNamed = (name) => nameWords(name).some((w) => PATH_WORDS.has(w));

/** Loader classes whose input names a file in the input folder (as the shared runner's graphProblem sees them). */
export const loaderInput = (cls, input) => (cls === "AUSBOSS_NODES_ImageCropRotatePad" && input === "image") || (/^(Load|VHS_Load)/.test(cls) && /image|video|audio|file|path|directory/i.test(input));

/**
 * Inputs that take free text (prompts, lyrics, captions, expressions, and the prompts that a text encoder takes for
 * each of its encoders: clip_l, clip_g, t5xxl): the path check doesn't read them.
 */
export const TEXT_NAME = /^(text|texts|prompt|prompts|positive|negative|caption|captions|lyrics|tags|style|instruct|instruction|hints|string|string_[a-z]|value|expression|clip_l|clip_g|t5xxl)$|^(.+_)?(prompt|text|description|caption|instruction)$|^values\.[a-z0-9_]+$/i;

/** File names that hold weights (or pickled code). */
export const MODEL_EXT = /\.(safetensors|gguf|ckpt|pt|pt2|pth|bin|sft|onnx|pkl|pickle)$/i;

/** A save name the studio makes: name parts of letters, digits, "_", "-" and ".", joined by "/"; no "..". */
const OUTPUT_NAME = /^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}(\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}){0,7}$/;

const DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i;

/** A link from another node's output: ["node id", output index]. */
export const isLink = (v) => Array.isArray(v);

/**
 * The second layer: a value written into an input that has no rule and doesn't take free text. "unsafe-path", or null.
 *
 * A name (no spaces) is refused with a ":" (a drive, a scheme, a stream), "%" or "~" (some nodes expand them), or "..".
 * Any value is refused that starts like a path (a leading "/", "\" or "~", or a drive such as "C:"), holds an address
 * ("://"), a drive path ("C:\" after a space), an encoded or variable part ("%2e", "%TEMP%"), a ".." step, a NUL, or a
 * Windows device name (CON, NUL, COM1…) as any part of a path. Words with spaces (a plan's roles, say) are read only
 * for those path shapes, so "Scene 2: 50% faster" stays as it is.
 */
export function pathProblem(v) {
  if (typeof v !== "string" || v === "") return null;
  if (/\0/.test(v) || /^[\\/~]/.test(v) || /^[A-Za-z]:/.test(v) || v.includes("://")) return "unsafe-path";
  if (/(^|\s)[A-Za-z]:[\\/]/.test(v) || /%[0-9A-Fa-f]{2}|%[A-Za-z_][A-Za-z0-9_]*%/.test(v) || /(^|[\\/])\.\.([\\/]|$)/.test(v)) return "unsafe-path";
  if (!/\s/.test(v) && (/[:%~]/.test(v) || v.includes(".."))) return "unsafe-path";
  if (v.split(/[\\/]/).some((part) => DEVICE.test(part.replace(/[. ]+$/, "")))) return "unsafe-path";
  return null;
}

/** The second layer on a value: a JSON object or list written as text (a node's settings) is read part by part. */
export function valueProblem(v) {
  if (typeof v === "string" && /^\s*[[{]/.test(v)) {
    try {
      const parsed = JSON.parse(v);
      if (parsed && typeof parsed === "object") {
        for (const s of strings(parsed)) if (pathProblem(s)) return "unsafe-path";
        return null;
      }
    } catch {}
  }
  return pathProblem(v);
}

/** A ".." step in a path. */
const DOT_DOT = /(^|[\\/])\.\.([\\/]|$)/;
/** A variable some nodes expand ("%TEMP%", "$HOME", "${HOME}"). */
const VARIABLE = /%[A-Za-z_][A-Za-z0-9_]*%|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/;
/**
 * Path shapes that words with spaces never take: a drive path, a share, a rooted path with two parts, a home path, a
 * ".." step (at the start of a word too).
 */
const PATH_IN_WORDS = [/^[A-Za-z]:[\\/]/, /^[\\/]{2}[^\\/\s]/, /^\/[^\s/]+\//, /^~[\\/]/, DOT_DOT, /(^|\s)\.\.[\\/]/];

/** One string of free text, read for path shapes: true when it names a path. */
function pathShape(s) {
  if (/\0/.test(s)) return true;
  const t = s.trim();
  if (!/\s/.test(t)) return /^[\\/~]/.test(t) || /^[A-Za-z]:/.test(t) || t.includes("://") || DOT_DOT.test(t) || VARIABLE.test(t);
  return PATH_IN_WORDS.some((r) => r.test(t));
}

/** A JSON object or list written as text: its keys and its strings, every one. None for anything else. */
export function jsonStrings(v) {
  if (typeof v !== "string" || !/^\s*[[{]/.test(v)) return [];
  try {
    const parsed = JSON.parse(v);
    if (!parsed || typeof parsed !== "object") return [];
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
  } catch {
    return [];
  }
}

/**
 * Free text that isn't a prompt (a node's settings written as text, or a value the studio fills per run: a size, a
 * language, a plan written as JSON): "unsafe-path" when it, or any key or string of a JSON value it holds, names a path.
 * A value with no spaces is refused when it starts with "/", "\" or "~", starts with a drive ("C:"), holds an address
 * ("://"), takes a ".." step, or holds a variable ("%TEMP%", "$HOME"). Words with spaces are refused only for a drive
 * path ("C:\"), a share ("\\host"), a rooted path with two parts ("/etc/x"), a home path ("~/x") and a ".." step, so
 * "16:9", "50% faster" and "auto (1088 -> 1080)" stay as they are.
 */
export function textPathProblem(v) {
  for (const s of strings(v)) {
    if (pathShape(s) || jsonStrings(s).some(pathShape)) return "unsafe-path";
  }
  return null;
}

const same = (a, b) => a === b || (typeof a === "object" && a !== null && typeof b === "object" && b !== null && JSON.stringify(a) === JSON.stringify(b));

/** Every string inside a value (a list or an object of settings), for the second layer. */
function* strings(v) {
  if (typeof v === "string") yield v;
  else if (Array.isArray(v)) for (const x of v) yield* strings(x);
  else if (v && typeof v === "object") for (const x of Object.values(v)) yield* strings(x);
}

/** The verified model files by name: name → the folders it was verified in. Takes {folder, name} or "folder/name". */
export function verifiedIndex(verified) {
  const byName = new Map();
  const add = (folder, name) => {
    const key = String(name).replace(/\\/g, "/");
    if (!byName.has(key)) byName.set(key, new Set());
    byName.get(key).add(folder);
  };
  for (const v of verified ?? []) {
    if (v && typeof v === "object") add(v.folder, v.name);
    else if (typeof v === "string") {
      const i = v.indexOf("/");
      if (i > 0) add(v.slice(0, i), v.slice(i + 1));
      else add("*", v);
    }
  }
  return byName;
}

/** Is this model name verified (in one of these folders, or in any when none are known)? The exact name, never its base name. */
function modelVerified(v, folders, byName) {
  const there = byName.get(v.replace(/\\/g, "/"));
  if (!there) return false;
  return !folders?.length || there.has("*") || folders.some((f) => there.has(f));
}

/** Does a value keep to its rule? "unsafe-path", "model-unverified", or null. */
export function ruleProblem(rule, v, ctx) {
  if (isLink(v)) return "unsafe-path";
  switch (rule.kind) {
    case "literal":
      return same(v, rule.value) ? null : "unsafe-path";
    case "enum":
      return rule.values.some((x) => same(v, x)) ? null : "unsafe-path";
    case "range":
      return typeof v === "number" && Number.isFinite(v) && v >= rule.min && v <= rule.max && (!rule.integer || Number.isInteger(v)) ? null : "unsafe-path";
    case "input-file": {
      const sent = (x) => typeof x === "string" && ctx.staged.includes(x.replace(/ \[input\]$/, ""));
      // Any Angle's saved 3D view: each picture a file this job sent, or empty; the camera only numbers.
      if (v && typeof v === "object") {
        return Object.entries(v).every(([k, x]) => (k === "camera_info" ? [...strings(x)].length === 0 : x === "" || x === null || sent(x))) ? null : "unsafe-path";
      }
      return sent(v) ? null : "unsafe-path";
    }
    case "output-name":
      return typeof v === "string" && OUTPUT_NAME.test(v) ? null : "unsafe-path";
    case "model-file":
      // A file this worker verified, whatever its name ends with (a loader may take any extension). Only the catalog's
      // own values that name no file ("plain": "None", say) need no file.
      if (typeof v !== "string" || pathProblem(v)) return "unsafe-path";
      if (Array.isArray(rule.plain) && rule.plain.includes(v)) return null;
      return modelVerified(v, rule.folders, ctx.byName) ? null : "model-unverified";
    default:
      return "unsafe-path";
  }
}

/** The rule for an input: the built one, or the ones every worker knows (loaders' files, save names). */
export function ruleFor(rules, cls, input) {
  const built = rules?.inputs?.[cls]?.[input];
  if (built) return built;
  if (loaderInput(cls, input)) return { kind: "input-file" };
  if (input === "filename_prefix") return { kind: "output-name" };
  return null;
}

/**
 * The first problem with one input, or null. `ctx`: { rules, staged, byName }.
 * In order: its rule; a closed class's unknown input; a prompt (any text); other free text (path shapes only); an
 * unknown input named for a file; the second layer and the model check on everything else.
 */
export function inputProblem(cls, input, v, ctx) {
  const rule = ruleFor(ctx.rules, cls, input);
  if (rule) return ruleProblem(rule, v, ctx);
  const closed = ctx.rules?.closed?.[cls];
  if (closed && !closed.includes(input)) return "unsafe-path";
  if (TEXT_NAME.test(input)) return null;
  if (ctx.rules?.text?.[cls]?.includes(input)) return textPathProblem(v);
  if (pathNamed(input) && (isLink(v) || (v !== "" && [...strings(v)].some((s) => s !== "")))) return "unsafe-path";
  if (isLink(v) && v.length === 2 && typeof v[0] === "string") return null;
  let worst = null;
  for (const s of strings(v)) {
    if (valueProblem(s)) return "unsafe-path";
    if (MODEL_EXT.test(s) && !modelVerified(s, null, ctx.byName)) worst = "model-unverified";
  }
  return worst;
}
