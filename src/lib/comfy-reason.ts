/**
 * ComfyUI's own reason a job failed, as one short line for the owner: why its /prompt refused the job (the answer's
 * `error` and `node_errors`: a node type that isn't installed, a required input missing, a model file not in the list…)
 * or why it stopped while it ran (its `execution_error`: the node, the exception and the last frames of its traceback).
 *
 *   "ComfyUI refused the job: node InstantHMRPredict (id 12) isn't installed"
 *   "ComfyUI refused the job: model file detection/instanthmr_medium.safetensors not in the list (model_name of InstantHMRLoader, id 12)"
 *   "CUDA out of memory in KSampler (node 7)"
 *
 * The line keeps model file names and node names. It never keeps a folder (a path becomes its file's name), an address,
 * a key or a token, or the run's own words (a prompt): every text value of the job's graph that `o.graph` names is taken
 * out. It is at most REASON_MAX characters.
 *
 * Pure: the worker program (scripts/lib/worker-build.mjs) and the server share it.
 */
import { cleanEngineText } from "./engine-error";

/** The longest reason kept. */
export const REASON_MAX = 600;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : undefined);

/** A file name a model loader takes: a name (with its subfolders, never a drive or a root) and an extension. */
const MODEL_FILE = /^(?![\\/])(?![A-Za-z]:)[\w .+()[\]-]+(?:[\\/][\w .+()[\]-]+)*\.[A-Za-z0-9]{2,12}$/;
/** A short value safe to name as it is: one word, no space (an option of a list, a number). */
const WORD = /^[\w.+:-]{1,64}$/;

/** The longest run of word characters that can pass for a key: long, and mixed. */
const LONG_RUN = /[A-Za-z0-9+/=_-]{32,}/g;
const KEY_PATTERNS: [RegExp, string][] = [
  [/\b(?:hf|ghp|gho|ghu|ghs|ghr|github_pat|glpat|xox[abprs]|fuobe|rpa|r8)_[A-Za-z0-9_-]{8,}/g, "[key]"],
  [/\bsk-[A-Za-z0-9_-]{12,}/g, "[key]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [key]"],
  [/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, "[key]"],
  [/([?&](?:token|key|api_key|apikey|access_token|sig|signature|auth|secret)=)[^&\s"']+/gi, "$1[key]"],
  [/\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd|authorization)["']?\s*[=:]\s*["']?)[^\s"',;&)]+/gi, "$1[key]"],
];

/** A run of characters that looks like a key or a token (not a file's name, not words joined by underscores). */
function keyLike(run: string, next: string): boolean {
  if (next === ".") return false;
  if ((run.match(/[_-]/g) ?? []).length >= 3) return false;
  if (/^[a-f0-9]+$/i.test(run)) return true;
  return /[a-z]/.test(run) && /[A-Z]/.test(run) && /\d/.test(run);
}

/** Text without keys and tokens. */
export function withoutKeys(s: string): string {
  let out = s;
  for (const [re, to] of KEY_PATTERNS) out = out.replace(re, to);
  return out.replace(LONG_RUN, (m, at: number, all: string) => (keyLike(m, all[at + m.length] ?? "") ? "[key]" : m));
}

/**
 * The run's own words in its graph: each text value with a space in it (a prompt, a caption, a name typed in), longest
 * first. A value without a space is an option or a number, and a file name is a file name: the reason may name those.
 */
export function graphTexts(graph: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 12 || found.size > 400) return;
    if (typeof v === "string") {
      const t = v.trim();
      if (t.length >= 4 && /\s/.test(t) && !MODEL_FILE.test(t)) found.add(t);
      return;
    }
    if (Array.isArray(v)) for (const x of v) walk(x, depth + 1);
    else if (v && typeof v === "object") for (const x of Object.values(v as Obj)) walk(x, depth + 1);
  };
  walk(graph, 0);
  return [...found].sort((a, b) => b.length - a.length);
}

/**
 * A reason as it may be kept: the run's own words out (each of `o.graph`'s texts, and each of their lines), keys and
 * tokens out, then paths as file names, addresses and run ids out, one line, at most `max` characters.
 */
export function reasonText(raw: string, o: { graph?: unknown; max?: number } = {}): string {
  let s = raw;
  for (const t of graphTexts(o.graph)) {
    s = s.split(t).join("[text]");
    // ComfyUI may say a long text in part: each of its lines on its own, and its first 40 characters.
    for (const line of t.split(/\r?\n/).map((l) => l.trim())) if (line.length >= 12) s = s.split(line).join("[text]");
    if (t.length > 40) s = s.split(t.slice(0, 40)).join("[text]");
  }
  return cleanEngineText(withoutKeys(s), o.max ?? REASON_MAX);
}

/** "KSampler id 7", "id 7", "KSampler". */
const nodeName = (cls: string | undefined, id: string | undefined) => [cls, id && `id ${id}`].filter(Boolean).join(" ");

/** One of a node's validation errors, in a few words. */
function validationLine(e: Obj, cls: string | undefined, id: string | undefined): string | null {
  const type = text(e.type) ?? "";
  const info = obj(e.extra_info);
  const input = text(info?.input_name);
  const got = text(info?.received_value);
  const where = nodeName(cls, id);
  const inNode = (s: string) => (where ? `${s} (${where})` : s);
  switch (type) {
    case "value_not_in_list": {
      if (got && MODEL_FILE.test(got)) {
        const at = [input && cls ? `${input} of ${cls}` : (input ?? cls), id && `id ${id}`].filter(Boolean).join(", ");
        return `model file ${got} not in the list${at ? ` (${at})` : ""}`;
      }
      return inNode(`value ${got && WORD.test(got) ? `${got} ` : ""}${input ? `for ${input} ` : ""}not in the list`);
    }
    case "required_input_missing": {
      const name = input ?? text(e.details);
      return inNode(name ? `required input ${name} missing` : "a required input is missing");
    }
    case "value_smaller_than_min":
    case "value_bigger_than_max":
      return inNode(`${text(e.message) ?? type}${input ? ` for ${input}` : ""}`);
    default: {
      const message = text(e.message) ?? type;
      const details = text(e.details);
      if (!message && !details) return null;
      return inNode([message, details && details !== input ? details : input].filter(Boolean).join(": "));
    }
  }
}

/** The /prompt answer's error, without node errors, in a few words. */
function topLine(error: Obj): string | null {
  const type = text(error.type);
  const info = obj(error.extra_info);
  if (type === "missing_node_type") {
    const cls = text(info?.class_type);
    const id = text(info?.node_id) ?? /#(\w+)/.exec(text(error.details) ?? "")?.[1];
    return cls ? `node ${cls}${id ? ` (id ${id})` : ""} isn't installed` : (text(error.message) ?? "a node isn't installed");
  }
  const message = text(error.message);
  if (type === "prompt_outputs_failed_validation") return message ?? "the job failed validation";
  const details = text(error.details);
  return [message ?? type, details].filter(Boolean).join(": ") || null;
}

/**
 * Why ComfyUI's /prompt refused a job, from its answer (`{ error, node_errors }`), or null when the answer says nothing.
 * Each node's errors come first (at most three, then how many more), else the answer's own error.
 */
export function refusalReason(body: unknown, o: { graph?: unknown; max?: number } = {}): string | null {
  const b = obj(body);
  if (!b) return null;
  const lines: string[] = [];
  const graph = obj(o.graph);
  for (const [id, raw] of Object.entries(obj(b.node_errors) ?? {})) {
    const ne = obj(raw);
    const cls = text(ne?.class_type) ?? text(obj(graph?.[id])?.class_type);
    for (const e of Array.isArray(ne?.errors) ? ne.errors : []) {
      const line = obj(e) ? validationLine(obj(e)!, cls, id) : null;
      if (line && !lines.includes(line)) lines.push(line);
    }
  }
  const error = obj(b.error);
  if (!lines.length && error) {
    const line = topLine(error);
    if (line) lines.push(line);
  }
  if (!lines.length) {
    const said = text(b.error);
    if (!said) return null;
    lines.push(said);
  }
  const shown = lines.slice(0, 3).join("; ") + (lines.length > 3 ? ` (+${lines.length - 3} more)` : "");
  return reasonText(`ComfyUI refused the job: ${shown}`, o) || null;
}

/** "nodes.py:1234 sample": a traceback frame, by its file's name. */
function frameOf(line: string): string | null {
  const m = /File "([^"]+)", line (\d+)(?:, in ([\w<>.]+))?/.exec(line);
  if (!m) return null;
  const file = m[1].split(/[\\/]/).pop() ?? m[1];
  return `${file}:${m[2]}${m[3] ? ` ${m[3]}` : ""}`;
}

/** The last frames of a traceback (a list of strings, or one string), newest last. */
function lastFrames(tb: unknown, n = 2): string[] {
  const all = (Array.isArray(tb) ? tb : typeof tb === "string" ? [tb] : [])
    .filter((x): x is string => typeof x === "string")
    .flatMap((x) => x.split(/\r?\n/))
    .map(frameOf)
    .filter((x): x is string => !!x);
  return all.slice(-n);
}

const OUT_OF_MEMORY = /out of memory|OutOfMemoryError|Allocation on device|not enough memory|MemoryError/i;

/**
 * Why a job stopped while ComfyUI ran it: its execution error (the data of a history entry's "execution_error" message,
 * or of the websocket's), or an "execution_interrupted" one. Null when there is none.
 */
export function executionReason(data: unknown, o: { graph?: unknown; max?: number; interrupted?: boolean } = {}): string | null {
  const d = obj(data);
  if (!d) return null;
  const id = text(d.node_id);
  const cls = text(d.node_type) ?? (id ? text(obj(obj(o.graph)?.[id])?.class_type) : undefined);
  const where = cls ? ` in ${cls}${id ? ` (node ${id})` : ""}` : id ? ` in node ${id}` : "";
  if (o.interrupted) return reasonText(`ComfyUI stopped the job (interrupted)${where}`, o);
  const type = text(d.exception_type);
  const shortType = type?.split(".").pop();
  const message = (text(d.exception_message) ?? "").split(/\r?\n/).find((l) => l.trim()) ?? "";
  if (OUT_OF_MEMORY.test(`${type ?? ""} ${message}`)) {
    const cuda = /cuda|torch/i.test(`${type ?? ""} ${message}`);
    return reasonText(`${cuda ? "CUDA out of memory" : "Out of memory"}${where}`, o);
  }
  const frames = lastFrames(d.traceback);
  const head = `${shortType ?? "Error"}${where}`;
  const line = `${head}${message ? `: ${message.trim()}` : ""}${frames.length ? ` (at ${frames.join(" < ")})` : ""}`;
  return reasonText(line, o) || null;
}

/**
 * Why a finished history entry (or a meta-batch's passes) ended in an error: its execution error, else its interrupt,
 * else that its status says error. Null for an entry that finished well.
 */
export function entryReason(entries: unknown, o: { graph?: unknown; max?: number } = {}): string | null {
  for (const raw of Array.isArray(entries) ? entries : [entries]) {
    const status = obj(obj(raw)?.status);
    const messages = Array.isArray(status?.messages) ? status.messages : [];
    const msg = (name: string) => messages.find((m): m is [string, unknown] => Array.isArray(m) && m[0] === name)?.[1];
    const error = msg("execution_error");
    if (error) return executionReason(error, o);
    const interrupted = msg("execution_interrupted");
    if (interrupted) return executionReason(interrupted, { ...o, interrupted: true });
    if (status?.status_str === "error") return "ComfyUI ended the job with an error";
  }
  return null;
}
