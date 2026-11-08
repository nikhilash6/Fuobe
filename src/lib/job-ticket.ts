/**
 * Job tickets (docs/gpu-workers.md, "Job tickets"): what a worker gets for a run of an account on this install's GPUs in
 * place of a graph. A ticket names a catalog workflow, the catalog version it was made for, the run's typed settings, its
 * input files (slot, name, kind, SHA-256 and header facts), how many results it makes and how big it is. The worker
 * composes the graph itself from its own copy of the catalog (src/lib/comfy-compose.ts, built into the worker), so a
 * server can never hand it a graph of its own making. The owner's own jobs and a person's own GPU keep full graphs.
 *
 * Both sides check a ticket the same way (ticketProblem): the studio when it makes one, the worker before it composes.
 * Settings are typed: enums, ranges and lists; a person's words go only to the prompt fields, and no text names a path.
 * Files are named only through their slots.
 *
 * The PC's ceiling (worker.json `ceiling`, set at `fuobe worker setup`): the most a worker may ever run. The studio and
 * its panel only narrow inside it, and a worker never claims a job outside it (ceilingProblem).
 *
 * Pure: the server, the worker program and the tests share it.
 */
import { INPUT_NAME } from "./relay";

export const TICKET_VERSION = 1;

/** The kinds of file a ticket's input may be. */
export const TICKET_INPUT_KINDS = ["image", "video", "audio", "model3d", "file"] as const;
export type TicketInputKind = (typeof TICKET_INPUT_KINDS)[number];

/** What the studio read from an input's header (the composer sizes clips and checks times by it). */
export interface TicketFacts {
  container?: string;
  duration?: number;
  videoDuration?: number;
  width?: number;
  height?: number;
  fps?: number;
  frames?: number;
  hasVideo?: boolean;
  hasAudio?: boolean;
  channels?: number;
}

/**
 * One input file. `slot` says where it goes: images.<i>, endImage, mask, video, videos.<i>, audio, audio2, voiceAudio,
 * voiceAudio2, audios.<i>, model3d, extra.<key> (a setting that names a file), or made.<i> (a file the composer makes
 * itself, such as a fade curve or a palette swatch: the worker makes it again and never reads the studio's copy).
 */
export interface TicketInput {
  slot: string;
  name: string;
  kind: TicketInputKind;
  sha256: string;
  facts?: TicketFacts;
}

/** How big a job is: the largest picture (megapixels), the longest clip (seconds) and the results asked for. */
export interface TicketSize {
  megapixels: number;
  seconds: number;
  outputs: number;
}

export interface JobTicket {
  v: typeof TICKET_VERSION;
  /** The catalog workflow (or its template, such as video-concat-{n}) the run asked for. */
  workflowId: string;
  /** The catalog version it was made for (catalogVersion: the worker's build has its own). */
  catalogVersion: string;
  /** The operation (t2i, i2v, trim…): the composer shapes the graph by it. */
  op: string;
  /** The run's settings, typed (TICKET_SETTINGS). No file names: those are the inputs. */
  settings: Record<string, unknown>;
  inputs: TicketInput[];
  /** How many results the job makes, and of what kind. */
  outputs: { count: number; kind: string };
  size: TicketSize;
  /** The route puts the run's one LoRA in the graph's own LoRA slot (comfy-compose.ts ComposeContext.loraSlot). */
  loraSlot?: boolean;
  /**
   * The SHA-256 of the graph this ticket composes to (graphFingerprint, src/lib/ticket-compose.ts), set by the studio. A
   * worker built from another catalog runs the ticket when its own composer makes the same graph from it.
   */
  graphSha?: string;
  /** Set at the claim: how long the job may run, and go without progress. */
  runLimitMs?: number;
  stallMs?: number;
}

/** Why a ticket can't be used: an older or newer catalog ("update-worker"), or settings outside their rules. */
export type TicketRefusal = { reason: "update-worker" | "bad-ticket"; detail: string };

// ---------------------------------------------------------------------------
// Words and paths

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
/** File names a setting may never carry (models, media, code and data files). */
const FILE_EXT = /\.(safetensors|gguf|ckpt|pt|pt2|pth|bin|sft|onnx|pkl|pickle|engine|png|jpe?g|webp|gif|bmp|tiff?|exr|mp4|mov|m4v|webm|mkv|avi|wav|mp3|flac|m4a|ogg|opus|aac|glb|gltf|ply|obj|fbx|splat|json|ya?ml|toml|py|pyc|sh|bat|cmd|ps1|exe|dll|so|txt|csv|srt|vtt|zip|tar|gz|7z|npz|npy)$/i;
/** A drive, a share, a home or a file address inside text, or a ".." step. */
const PATH_IN_TEXT = /(^|[\s"'(=,;[{])([A-Za-z]:[\\/]|\\\\[^\s\\]|~[\\/]|file:)|(^|[\\/\s"'(])\.\.[\\/]|[\\/]\.\.($|[\s"')])/i;
/** A path as a whole value: rooted, a drive, a share, a home folder, or a ".." step. */
const PATH_SHAPE = /^([\\/]|[A-Za-z]:|~|\\\\)|(^|[\\/])\.\.([\\/]|$)/;

/**
 * A person's words (prompts, lyrics, captions): any text, but never a path. A value with no space that has the shape of
 * a path, and text that holds a drive, a share, a home folder, a file address or a ".." step, are refused.
 */
export function textProblem(s: unknown, max = 20_000): string | null {
  if (typeof s !== "string") return "not text";
  if (s.length > max) return "too long";
  if (CONTROL.test(s)) return "a control character";
  if (!/\s/.test(s.trim()) && PATH_SHAPE.test(s.trim())) return "a path";
  if (PATH_IN_TEXT.test(s)) return "a path";
  return null;
}

/**
 * A setting written as words (a quality, a language, a colour, a choice): textProblem's rules, and no slash or backslash
 * in a value without spaces, no file name, no address, no encoded or variable part.
 */
export function wordProblem(s: unknown, max = 4000): string | null {
  const p = textProblem(s, max);
  if (p) return p;
  const v = (s as string).trim();
  if (!/\s/.test(v) && /[\\/]/.test(v)) return "a path";
  if (!/\s/.test(v) && FILE_EXT.test(v)) return "a file name";
  if (/:\/\/|%[0-9a-f]{2}|%[A-Za-z_][\w]*%|\$\{|\$[A-Z_]{2,}/i.test(v)) return "an address or a variable";
  return null;
}

// ---------------------------------------------------------------------------
// Settings

type Check = (v: unknown) => string | null;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num =
  (min: number, max: number, int = false): Check =>
  (v) =>
    !finite(v) ? "not a number" : v < min || v > max ? `outside ${min}-${max}` : int && !Number.isInteger(v) ? "not a whole number" : null;
const bool: Check = (v) => (typeof v === "boolean" ? null : "not true or false");
const oneOf =
  (...values: readonly string[]): Check =>
  (v) =>
    typeof v === "string" && values.includes(v) ? null : `not one of ${values.join(", ")}`;
const token =
  (re = /^[\w .:+#()%-]{0,80}$/): Check =>
  (v) =>
    typeof v !== "string" ? "not text" : !re.test(v) ? "not an allowed value" : wordProblem(v);
const text =
  (max = 20_000): Check =>
  (v) =>
    textProblem(v, max);
const either =
  (...checks: Check[]): Check =>
  (v) => {
    const problems = checks.map((c) => c(v));
    return problems.includes(null) ? null : problems[0];
  };
const list =
  (item: Check, max: number): Check =>
  (v) => {
    if (!Array.isArray(v)) return "not a list";
    if (v.length > max) return `more than ${max}`;
    for (const [i, x] of v.entries()) {
      const p = item(x);
      if (p) return `[${i}] ${p}`;
    }
    return null;
  };
const shape =
  (fields: Record<string, Check>, required: string[] = []): Check =>
  (v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return "not a group of settings";
    for (const k of required) if (!(k in v)) return `${k} missing`;
    for (const [k, x] of Object.entries(v)) {
      if (x === undefined) continue;
      const c = fields[k];
      if (!c) return `${k} isn't a known setting`;
      const p = c(x);
      if (p) return `${k} ${p}`;
    }
    return null;
  };

const KEY = /^[A-Za-z_][\w-]{0,63}$/;
/** The longest words one setting in params.extra may hold (a window review's controls are the longest). */
const EXTRA_TEXT_MAX = 131_072;

/**
 * Any other setting (params.extra and what it holds): numbers, true or false, lists and groups of them, and words
 * (wordProblem). At most 8 deep, 1024 items in a list and 128 keys in a group.
 */
export function plainProblem(v: unknown, depth = 0): string | null {
  if (v === null || typeof v === "boolean") return null;
  if (typeof v === "number") return Number.isFinite(v) && Math.abs(v) <= 1e12 ? null : "a number out of range";
  if (typeof v === "string") return wordProblem(v, EXTRA_TEXT_MAX);
  if (depth >= 8) return "too deep";
  if (Array.isArray(v)) {
    if (v.length > 1024) return "a list too long";
    for (const [i, x] of v.entries()) {
      const p = plainProblem(x, depth + 1);
      if (p) return `[${i}] ${p}`;
    }
    return null;
  }
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length > 128) return "too many keys";
    for (const [k, x] of entries) {
      if (!KEY.test(k)) return "a key that isn't a plain name";
      const p = plainProblem(x, depth + 1);
      if (p) return `${k} ${p}`;
    }
    return null;
  }
  return "not a setting";
}

const point = shape({ x: num(-1e5, 1e5), y: num(-1e5, 1e5), label: oneOf("positive", "negative") }, ["x", "y"]);
const cameraKey = shape({ t: num(0, 1), azimuth: num(-1e5, 1e5), elevation: num(-360, 360), distance: num(0, 100), truck: num(-100, 100), pedestal: num(-100, 100), roll: num(-360, 360), fov: num(0, 360) }, ["t"]);
/** A LoRA by its file name in the loras folder (subfolders allowed, never a path out), and how it's mixed. */
const LORA_FILE = /^(?!.*(^|\/)\.\.?(\/|$))[\w .()+-]+(\/[\w .()+-]+)*\.safetensors$/;
const lora = shape(
  {
    file: (v) => (typeof v === "string" && LORA_FILE.test(v) && v.length <= 256 ? null : "not a LoRA file name"),
    strength: num(-10, 10),
    trigger: text(400),
    target: oneOf("high", "low", "both"),
  },
  ["file"],
);

/**
 * The settings a ticket may carry, by their GenInput name (src/lib/catalog/types.ts), each with its rule. A person's
 * words go only in prompt, negativePrompt, voiceDescription, voiceTranscript, dialogue and shots (and their words inside
 * params.extra); everything else is a number, a choice or a list of them.
 */
export const TICKET_SETTINGS: Record<string, Check> = {
  prompt: text(),
  negativePrompt: text(4000),
  aspectRatio: token(/^(auto|\d{1,3}:\d{1,3})$/),
  resolution: token(/^[\w.]{1,16}$/),
  duration: num(0, 3600),
  numOutputs: num(1, 16, true),
  seed: num(0, Number.MAX_SAFE_INTEGER, true),
  generateAudio: bool,
  enhancePrompt: bool,
  voice: token(),
  voiceDescription: text(2000),
  voiceTranscript: text(4000),
  dialogue: list(shape({ text: text(4000), voice: oneOf("A", "B") }, ["text"]), 200),
  targetLanguage: token(),
  sourceLanguage: token(),
  shots: list(shape({ prompt: text(4000), duration: num(0, 600) }), 64),
  elements: list(shape({ images: list(num(0, 64, true), 16), video: num(0, 64, true) }), 16),
  clipSeconds: num(0, 600),
  drawnRefs: num(0, 64, true),
  multiShot: oneOf("auto"),
  draft: bool,
  draftId: token(/^[\w-]{1,64}$/),
  startTime: num(0, 86_400),
  endTime: num(0, 86_400),
  fps: num(0, 1000),
  palette: list(token(/^#?[0-9A-Za-z]{1,16}$/), 64),
  styleId: token(/^[\w.:-]{1,80}$/),
  numLayers: num(1, 64, true),
  points: list(point, 256),
  keyframeTimes: list(num(0, 86_400), 64),
  format: token(/^[\w-]{1,32}$/),
  zoomFrom: num(0, 100),
  zoomTo: num(0, 100),
  panFrom: shape({ x: num(-10, 10), y: num(-10, 10) }, ["x", "y"]),
  panTo: shape({ x: num(-10, 10), y: num(-10, 10) }, ["x", "y"]),
  position: shape({ x: num(-10, 10), y: num(-10, 10) }, ["x", "y"]),
  easing: oneOf("linear", "ease-in-out"),
  crossfade: num(0, 600),
  sourceDuration: num(0, 86_400),
  sourceFps: num(0, 1000),
  sourceSize: shape({ width: num(0, 65_536), height: num(0, 65_536) }, ["width", "height"]),
  frameInterval: num(0, 10_000),
  targetFps: num(0, 1000),
  slowdown: num(0, 64),
  colormap: token(/^[\w-]{1,32}$/),
  sideBySide: bool,
  matteOutput: oneOf("cutout", "matte", "foreground"),
  scale: num(0, 64),
  animation: either(token(), num(-1e6, 1e6)),
  cameraPath: list(cameraKey, 256),
  loras: list(lora, 16),
  extra: (v) => (v && typeof v === "object" && !Array.isArray(v) ? plainProblem(v) : "not a group of settings"),
};

/** Settings that name a file: a ticket names those only through its inputs. */
export const FILE_SETTINGS = ["images", "endImage", "mask", "video", "videos", "audio", "audio2", "voiceAudio", "voiceAudio2", "audios", "model3d"] as const;

/** Where an input may go. */
const SLOT = /^(images\.\d{1,2}|endImage|mask|video|videos\.\d{1,2}|audio|audio2|voiceAudio|voiceAudio2|audios\.\d{1,3}|model3d|extra\.[A-Za-z][A-Za-z0-9_]{0,63}|made\.\d{1,2})$/;
const SHA = /^[0-9a-f]{64}$/;
const FACTS = shape({
  container: token(/^[\w-]{1,16}$/),
  duration: num(0, 86_400),
  videoDuration: num(0, 86_400),
  width: num(0, 65_536),
  height: num(0, 65_536),
  fps: num(0, 1000),
  frames: num(0, 1e8),
  hasVideo: bool,
  hasAudio: bool,
  channels: num(0, 64),
});
/** A workflow's id as the catalog names it (a template's {n} too). */
export const WORKFLOW_ID = /^[a-z0-9][a-z0-9._-]{0,95}(\{n\}[a-z0-9._-]{0,32})?$/i;
const OP = /^[a-z0-9][a-z0-9-]{0,47}$/;
const OUTPUT_KINDS = ["image", "video", "audio", "text", "model3d", "frame", "file"];

/**
 * Why a ticket can't be used, or null. `o.catalogVersion`: the reader's own (another one is "update-worker"); `o.known`:
 * whether the catalog has a workflow; `o.inputs`: the files the task sends (each input must be one of them, with the
 * same SHA-256; a made file's copy is never read, so only its name counts).
 */
export function ticketProblem(
  t: unknown,
  o: { catalogVersion?: string; known?: (id: string) => boolean; inputs?: { name: string; sha256: string }[]; otherCatalog?: boolean } = {},
): TicketRefusal | null {
  const bad = (detail: string): TicketRefusal => ({ reason: "bad-ticket", detail });
  if (!t || typeof t !== "object" || Array.isArray(t)) return bad("not a ticket");
  const k = t as Partial<JobTicket> & Record<string, unknown>;
  for (const key of Object.keys(k)) if (!["v", "workflowId", "catalogVersion", "op", "settings", "inputs", "outputs", "size", "loraSlot", "graphSha", "runLimitMs", "stallMs"].includes(key)) return bad(`${key} isn't part of a ticket`);
  if (k.v !== TICKET_VERSION) return { reason: "update-worker", detail: "another ticket version" };
  if (typeof k.catalogVersion !== "string" || !SHA.test(k.catalogVersion)) return bad("no catalog version");
  if (k.graphSha !== undefined && (typeof k.graphSha !== "string" || !SHA.test(k.graphSha))) return bad("graphSha isn't a SHA-256");
  // Another catalog: only a reader that checks the composed graph itself (o.otherCatalog: composeTicket) goes on, and
  // only with the ticket's graph SHA-256 to check it against.
  if (o.catalogVersion !== undefined && k.catalogVersion !== o.catalogVersion && !(o.otherCatalog && k.graphSha)) return { reason: "update-worker", detail: "another catalog version" };
  if (typeof k.workflowId !== "string" || !WORKFLOW_ID.test(k.workflowId)) return bad("not a workflow id");
  if (o.known && !o.known(k.workflowId)) return bad("an unknown workflow");
  if (typeof k.op !== "string" || !OP.test(k.op)) return bad("not an operation");
  if (k.loraSlot !== undefined && typeof k.loraSlot !== "boolean") return bad("loraSlot isn't true or false");
  for (const f of ["runLimitMs", "stallMs"] as const) if (k[f] !== undefined && num(0, 7 * 86_400_000, true)(k[f])) return bad(`${f} out of range`);
  const out = k.outputs as { count?: unknown; kind?: unknown } | undefined;
  if (!out || num(1, 256, true)(out.count) || typeof out.kind !== "string" || !OUTPUT_KINDS.includes(out.kind) || Object.keys(out).some((x) => x !== "count" && x !== "kind")) return bad("outputs out of range");
  const size = k.size as Partial<TicketSize> | undefined;
  const sizeProblem = shape({ megapixels: num(0, 10_000), seconds: num(0, 86_400), outputs: num(0, 256, true) }, ["megapixels", "seconds", "outputs"])(size);
  if (sizeProblem) return bad(`size ${sizeProblem}`);
  // Settings.
  const settings = k.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return bad("no settings");
  for (const [key, v] of Object.entries(settings)) {
    if (v === undefined) continue;
    if ((FILE_SETTINGS as readonly string[]).includes(key)) return bad(`${key} names a file outside the inputs`);
    const check = TICKET_SETTINGS[key];
    if (!check) return bad(`${key} isn't a setting a ticket carries`);
    const p = check(v);
    if (p) return bad(`${key}: ${p}`);
  }
  // Inputs.
  if (!Array.isArray(k.inputs) || k.inputs.length > 64) return bad("inputs out of range");
  const names = new Set<string>();
  const slots = new Set<string>();
  const extraFiles = new Set<string>();
  for (const i of k.inputs as unknown[]) {
    const x = i as Partial<TicketInput> & Record<string, unknown>;
    if (!x || typeof x !== "object") return bad("an input isn't one");
    if (Object.keys(x).some((f) => !["slot", "name", "kind", "sha256", "facts"].includes(f))) return bad("an input has an unknown field");
    if (typeof x.slot !== "string" || !SLOT.test(x.slot)) return bad("an input's slot isn't one");
    if (typeof x.name !== "string" || !INPUT_NAME.test(x.name)) return bad("an input's name isn't one the studio makes");
    if (typeof x.sha256 !== "string" || !SHA.test(x.sha256)) return bad("an input has no SHA-256");
    if (!(TICKET_INPUT_KINDS as readonly string[]).includes(String(x.kind))) return bad("an input's kind isn't one");
    if (x.facts !== undefined && FACTS(x.facts)) return bad(`an input's facts: ${FACTS(x.facts)}`);
    if (slots.has(x.slot)) return bad("two inputs in one slot");
    slots.add(x.slot);
    names.add(x.name);
    if (x.slot.startsWith("extra.")) extraFiles.add(x.slot.slice(6));
    if (o.inputs) {
      const sent = o.inputs.find((s) => s.name === x.name);
      if (!sent || (!x.slot.startsWith("made.") && sent.sha256 !== x.sha256)) return bad("an input isn't one the job sends");
    }
  }
  // Lists of files have no gaps (images.0, images.1…).
  for (const list of ["images", "videos", "audios", "made"]) {
    const n = [...slots].filter((s) => s.startsWith(`${list}.`)).map((s) => Number(s.slice(list.length + 1)));
    if (n.some((x, _i, all) => x >= all.length)) return bad(`${list} has a gap`);
  }
  // A setting in params.extra names a file only through its slot.
  const extra = (settings as { extra?: Record<string, unknown> }).extra ?? {};
  for (const key of extraFiles) if (key in extra) return bad(`extra.${key} is both a setting and a file`);
  return null;
}

// ---------------------------------------------------------------------------
// The PC's ceiling

/**
 * What a worker's PC may ever run (worker.json `ceiling`): the lanes and workflows (absent: all), the largest picture in
 * megapixels, the longest clip in seconds and the most results per run (absent or 0: no limit of its own).
 */
export interface Ceiling {
  lanes?: string[];
  workflows?: string[];
  maxMegapixels?: number;
  maxSeconds?: number;
  maxOutputs?: number;
}

const LANE = /^([0-9a-f]{12}|small)$/;

/** A ceiling as it may be kept: known fields, capped; anything else is left out (no limit). */
export function cleanCeiling(raw: unknown): Ceiling {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const ids = (v: unknown, re: RegExp) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && re.test(x)))].slice(0, 2000).sort() : undefined);
  const cap = (v: unknown) => (finite(v) && v > 0 ? Math.min(v, 1e6) : undefined);
  const c: Ceiling = {};
  const lanes = ids(o.lanes, LANE);
  const workflows = ids(o.workflows, WORKFLOW_ID);
  if (lanes) c.lanes = lanes;
  if (workflows) c.workflows = workflows;
  for (const k of ["maxMegapixels", "maxSeconds", "maxOutputs"] as const) {
    const v = cap(o[k]);
    if (v !== undefined) c[k] = k === "maxOutputs" ? Math.floor(v) : v;
  }
  return c;
}

/** The ceiling lists lanes or workflows (else every one is inside it). */
const listsWork = (c: Ceiling) => c.lanes !== undefined || c.workflows !== undefined;

/** Is this lane or workflow inside the ceiling? */
export function insideCeiling(c: Ceiling | null | undefined, job: { workflowId?: string | null; lane?: string | null }): boolean {
  if (!c || !listsWork(c)) return true;
  return (!!job.lane && !!c.lanes?.includes(job.lane)) || (!!job.workflowId && !!c.workflows?.includes(job.workflowId));
}

/** Why a job is outside a PC's ceiling, or null. A job of unknown size is inside the size limits. */
export function ceilingProblem(c: Ceiling | null | undefined, job: { workflowId?: string | null; lane?: string | null; size?: Partial<TicketSize> | null }): string | null {
  if (!c) return null;
  if (!insideCeiling(c, job)) return "a lane this PC doesn't run";
  const s = job.size ?? {};
  if (c.maxMegapixels && (s.megapixels ?? 0) > c.maxMegapixels + 1e-9) return "a larger picture than this PC makes";
  if (c.maxSeconds && (s.seconds ?? 0) > c.maxSeconds + 1e-9) return "a longer clip than this PC makes";
  if (c.maxOutputs && (s.outputs ?? 0) > c.maxOutputs) return "more results than this PC makes";
  return null;
}

/** The lanes a worker may run: the studio's allowed lanes, narrowed to its PC's ceiling. */
export const lanesInside = (allowed: string[], c: Ceiling | null | undefined): string[] => (c?.lanes !== undefined && c.workflows === undefined ? allowed.filter((l) => c.lanes!.includes(l)) : allowed);
