/**
 * An engine's own error text (ComfyUI, a node's exception, ffmpeg's output, a provider's answer) made fit to keep and
 * to show. Two parts:
 *
 * - `cleanEngineText`: the technical detail with the machine taken out. Absolute paths become the file's base name (a
 *   folder becomes "[folder]"), internal addresses become "[address]", run ids are left out, and tool banners (ffmpeg's
 *   version, copyright, build and configuration lines, its stream listing), stack traces and long dumps are dropped.
 *   What is left is one line, cut short. The owner reads it; a person running on their own GPU may read it too.
 * - `plainEngineFailure`: what a person sees when a run on our GPUs fails: one plain sentence for each kind of failure,
 *   never the engine's own words.
 *
 * Pure, with no imports: the server and the worker program (scripts/lib/worker-build.mjs) share it. The worker takes its
 * own folders out of every report with `withoutLocalPaths` before it sends anything.
 */

/** Unix folders an absolute path starts with on a server, a container or a worker. */
const UNIX_ROOTS =
  "home|root|var|tmp|opt|usr|srv|mnt|media|etc|workspace|workspaces|app|apps|data|run|proc|Users|Volumes|private|nix|snap|content|kaggle|lib|lib64|bin|sbin|dev|sys|boot|storage|models|comfyui|ComfyUI|fuobe|scratch|cache|output|input";

/** A character a path's segment may hold (no space, no quote, no separator). */
const SEG = String.raw`[^\s\\/"'<>|:*?,;()\[\]{}]`;

/** A Windows path: a drive or a UNC share, its folders (a folder may hold a few spaces), and its last part. */
const WINDOWS_PATH = new RegExp(
  String.raw`(?<![\w])(?:[A-Za-z]:[\\/]|\\\\${SEG}+\\${SEG}+\\?)(?:${SEG}+(?: ${SEG}+){0,3}\\|${SEG}+/)*${SEG}*`,
  "g",
);
/** A file:// link. */
const FILE_URL = /\bfile:\/\/\/?[^\s"'<>]+/gi;
/** A Unix path under one of the usual roots, or under the home folder (~/…). */
const UNIX_PATH = new RegExp(String.raw`(?<![\w.~:/\\-])(?:/(?:${UNIX_ROOTS})|~)(?:/${SEG}*)+`, "g");

/** The last part of a path: a file's name, or "[folder]" for a folder. */
function baseOf(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  return /\.[A-Za-z0-9]{1,12}$/.test(last) && !/^[A-Za-z]:$/.test(last) ? last : "[folder]";
}

/** Each absolute path in a text as its base name (a sentence's last full stop stays where it was). */
export function withoutLocalPaths(text: string): string {
  const swap = (m: string) => {
    const tail = /[.]+$/.exec(m)?.[0] ?? "";
    const path = tail ? m.slice(0, -tail.length) : m;
    return path ? baseOf(path) + tail : m;
  };
  return text.replace(FILE_URL, swap).replace(WINDOWS_PATH, swap).replace(UNIX_PATH, swap);
}

/**
 * Paths inside the given folders (this server's own) as their base names, other paths as they are: a person's own GPU
 * keeps its own folders in its details line, never the server's.
 */
export function withoutFolders(text: string, folders: readonly string[]): string {
  let out = text;
  for (const f of folders) {
    const root = f.replace(/[\\/]+$/, "");
    // Never a drive or the whole disk ("/", "C:").
    if (root.replace(/^[A-Za-z]:/, "").split(/[\\/]/).filter(Boolean).length < 1) continue;
    const either = root
      .split(/[\\/]+/)
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(String.raw`[\\/]+`);
    const re = new RegExp(String.raw`${either}(?:[\\/]+${SEG}+)*[\\/]*`, "gi");
    out = out.replace(re, (m) => baseOf(m.replace(/[.]+$/, "")) + (/[.]+$/.exec(m)?.[0] ?? ""));
  }
  return out;
}

/** A loopback or private address (with its port, and the rest of its link). */
const PRIVATE_HOST = String.raw`(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[::1?\]|host\.docker\.internal)`;
const INTERNAL_URL = new RegExp(String.raw`\b(?:https?|wss?):\/\/${PRIVATE_HOST}(?::\d{1,5})?[^\s"'<>]*`, "gi");
const INTERNAL_HOST = new RegExp(String.raw`(?<![\w.])${PRIVATE_HOST}(?::\d{1,5})?(?![\w.])`, "gi");
/** Any IPv4 address with a port. */
const IP_PORT = /(?<![\w.])\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}(?![\w.])/g;

/** A run's ids: a UUID (ComfyUI's prompt id), and "prompt_id: …"/"node_id: …" pairs. */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ID_PAIR = /\b(?:prompt|node|client)[_ ]id['"]?\s*[:=]\s*['"]?[\w-]+['"]?,?/gi;

/** A line of ffmpeg's (or ffprobe's) banner. */
const BANNER_LINE =
  /^\s*(?:(?:ffmpeg|ffprobe|ffplay) version\b|Copyright \(c\)|built with\b|configuration:|lib(?:avutil|avcodec|avformat|avdevice|avfilter|swscale|swresample|postproc)\s+\d)/i;
/** Where a banner starts inside a line ("…from clip.mp4: ffmpeg version 7.1 …"). */
const BANNER_START = /\b(?:ffmpeg|ffprobe|ffplay) version \S+/i;
/** After a banner, the lines that say what went wrong (the stream listing and the rest are left out). */
const TOOL_PROBLEM = /error|invalid|does not contain|matches no streams|no such file|not found|failed|unsupported|could not|cannot|unable|unknown|corrupt|truncated|moov atom|no (?:audio|video)?\s*stream|permission denied|out of memory/i;
/** Where a tool's output on one line splits into its own lines: its listing's headings, and a sentence's end. */
const TOOL_PIECES = /(?=\b(?:Input|Output) #\d)|(?=\bStream #\d)|(?=\bStream map(?:ping)?\b)|(?=\bMetadata:)|(?=\bDuration:)|(?=\bSide data:)|(?<=[.!])\s+(?=[A-Z])/;
/** Banner pieces left on one line (a text whose line breaks were lost). */
const BANNER_BITS = [
  /\b(?:ffmpeg|ffprobe|ffplay) version \S+/gi,
  /Copyright \(c\) \d{4}(?:-\d{4})? the FFmpeg developers/gi,
  /\bbuilt with (?:gcc|clang|Apple clang|Microsoft|MSVC|mingw)[^:]*?(?=\s+configuration:|\s+lib(?:av|sw|post)\w*\s+\d|$)/gi,
  /\bconfiguration:(?:\s+--\S+)+/gi,
  /\blib(?:avutil|avcodec|avformat|avdevice|avfilter|swscale|swresample|postproc)\s+\d+\.\s*\d+\.\s*\d+\s*\/\s*\d+\.\s*\d+\.\s*\d+/gi,
];

/** A stack trace's lines: Python's and JavaScript's. */
const TRACE_HEAD = /^\s*Traceback \(most recent call last\):?\s*$/;
const TRACE_FRAME = /^\s*(?:File "[^"]*", line \d+|at (?:async )?[\w.$<>[\]]*\s*\(?(?:file:|node:|[\w./\\-]+:\d+)|at \S+:\d+:\d+)/;
const TRACE_MARK = /^\s*[\^~]+\s*$/;
/** Trace pieces left on one line. */
const TRACE_BITS = [/Traceback \(most recent call last\):?/g, /File "[^"]*", line \d+(?:, in [\w<>.]+)?/g, /\bat (?:async )?[\w.$<>]+ \([^)]*:\d+:\d+\)/g, /\bat (?:file|node):\S+:\d+:\d+/g];

/** How much of the technical detail is kept. */
export const ENGINE_DETAIL_MAX = 600;

/** The lines of an engine's text worth keeping: a tool's banner and listing, and stack traces, left out; paths as base names. */
function keptLines(text: string): string[] {
  // Line by line first: a banner starts a tool's own output, and only its problem lines are kept after it.
  const lines: string[] = [];
  let inTool = false;
  let afterFrame = false;
  for (let line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const at = line.search(BANNER_START);
    if (at > 0) {
      const before = line.slice(0, at);
      if (before.trim()) lines.push(withoutLocalPaths(before));
      line = line.slice(at);
    }
    if (at >= 0) inTool = true;
    if (TRACE_HEAD.test(line) || TRACE_MARK.test(line)) continue;
    if (TRACE_FRAME.test(line)) {
      afterFrame = true;
      continue;
    }
    // The code line Python prints under each frame (indented).
    if (afterFrame && /^\s{2,}\S/.test(line)) {
      afterFrame = false;
      continue;
    }
    afterFrame = false;
    // Banner pieces (also on one line, when a text's line breaks were lost), then what is left of a banner line.
    for (const bit of [...BANNER_BITS, ...TRACE_BITS]) line = line.replace(bit, " ");
    if (!line.trim() || BANNER_LINE.test(line)) continue;
    if (inTool) {
      // Only the tool's problem lines: its listing (inputs, metadata, streams) goes, also when it is on one line.
      line = line
        .split(TOOL_PIECES)
        .filter((piece) => TOOL_PROBLEM.test(piece))
        .join(" ")
        // "[aac @ 0x55d…] Error …": the decoder's tag goes.
        .replace(/\[[\w-]+ @ 0x[0-9a-f]+\]\s*/gi, "");
    }
    line = withoutLocalPaths(line);
    if (line.trim()) lines.push(line);
  }
  return lines;
}

/** What a cut leaves behind: an empty pair of quotes, a space before a colon, a colon next to a colon, a dangling colon. */
const tidy = (line: string) =>
  line
    .replace(/[ \t]+/g, " ")
    .replace(/''|""|\(\s*\)|\[\s*\]/g, "")
    .replace(/ {2,}/g, " ")
    .replace(/ +([:,.])/g, "$1")
    .replace(/:(?: *:)+/g, ":")
    .replace(/[\s:,;-]+$/, "")
    .trim();

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…` : text);

/**
 * An engine's error text, fit to keep: paths as base names, internal addresses and run ids out, banners, stack traces
 * and stream listings dropped, one line, at most `max` characters.
 */
export function cleanEngineText(raw: unknown, max = ENGINE_DETAIL_MAX): string {
  const text = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
  if (!text.trim()) return "";
  const one = keptLines(text)
    .join(" ")
    .replace(INTERNAL_URL, "[address]")
    .replace(INTERNAL_HOST, "[address]")
    .replace(IP_PORT, "[address]")
    .replace(ID_PAIR, " ")
    .replace(UUID, "")
    .replace(/\s+/g, " ");
  return cut(tidy(one), max);
}

/** Signs of a machine's own words in a text: a path, a tool's banner, a stack trace. */
const SUSPECT = [new RegExp(WINDOWS_PATH.source), new RegExp(UNIX_PATH.source), /\bfile:\/\//i, BANNER_START, /Traceback \(most recent call last\)|File "[^"]*", line \d+|\bat \S+:\d+:\d+/];

/** How long a run's stored error may be. */
export const STORED_ERROR_MAX = 2000;

/**
 * A run's error as it is stored (every failure goes through it, src/server/generations.ts): a text with a path, a tool's
 * banner or a stack trace is cleaned as cleanEngineText cleans it, keeping its lines; any other text stays as it is.
 * Both are cut to `max` characters.
 */
export function storedErrorText(raw: string, max = STORED_ERROR_MAX): string {
  if (!SUSPECT.some((re) => re.test(raw))) return cut(raw, max);
  return cut(keptLines(raw).map(tidy).filter(Boolean).join("\n"), max);
}

// ---------------------------------------------------------------------------
// What a person sees when a run on our GPUs fails

/** The kinds of failure a run on our GPUs is told apart by. */
export type EngineFailureKind = "no-sound" | "unreadable-input" | "out-of-memory" | "timeout" | "missing-on-gpu" | "gpu-stopped" | "long-wait" | "unknown";

/**
 * What each kind says to the person who ran it (an account, a guest, or the owner on our GPUs): friendly, plain, and
 * what to do next, never a dead end. No place name (the install names its GPUs itself), no machinery (not even "GPU"),
 * no "busy", no "Press Retry" or "try again later" (tests/hosted-words.test.ts, tests/pool-account-runs.test.ts). The
 * tile's own Retry and "Try a similar model" are beside it. `unknown` is POOL_WORDS.failed (src/lib/relay.ts).
 */
export const ENGINE_WORDS: Record<EngineFailureKind, string> = {
  "no-sound": "This clip has no sound for this run to use — try a clip with sound.",
  "unreadable-input": "We couldn't read this file — try another one (MP4 or MOV works best for clips).",
  "out-of-memory": "That one was too big to make in one go — try a smaller size or a shorter clip.",
  timeout: "That one took longer than expected — try a shorter clip or a smaller size.",
  "missing-on-gpu": "That one didn't come out right — try again in a few minutes, or try a similar model.",
  "gpu-stopped": "That one didn't finish — try again, or try a similar model.",
  "long-wait": "This one didn't start in time — try again, or try a similar model.",
  unknown: "That one didn't come out right — try again, or try a similar model.",
};

const KINDS: [EngineFailureKind, RegExp][] = [
  ["long-wait", /were busy|didn't start in time|waited (?:over|too long)|took too long to start/i],
  ["out-of-memory", /out of memory|OutOfMemoryError|allocation on device|CUDA error: out of memory|not enough memory|MemoryError/i],
  ["no-sound", /no audio stream|has no (?:audio|sound)|failed to extract audio|does not contain any (?:audio )?stream|stream map '[^']*:a[^']*' matches no streams|matches no streams|no sound to work with|without (?:audio|sound)/i],
  [
    "unreadable-input",
    /invalid data found|moov atom not found|cannot identify image file|could not (?:open|read|decode|load) (?:the )?(?:file|video|image|audio|clip|input)|failed to (?:open|read|decode|load) (?:the )?(?:file|video|image|audio|clip|input)|corrupt|truncated|unsupported (?:file|format|codec|image)|no frames exist|failed to slice video|failed to trim video|couldn't be read|unreadable|end of file|EOFError|decoding error|not a valid (?:image|video|audio)/i,
  ],
  ["missing-on-gpu", /missing_node_type|node pack|is not installed|not in list|value not in list|missing model|model file|couldn't find (?:the )?model|no such node|unknown node|needs one add-on|refused it|prompt outputs failed validation|couldn't start (?:it|this run)/i],
  ["timeout", /timed? ?out|took too long|deadline|didn't answer in time/i],
  ["gpu-stopped", /interrupted|restarted|lost this run|stopped answering|stopped before|stopped while|connection (?:reset|refused|closed)|ECONNRESET|ECONNREFUSED|socket hang up|isn't running|went away|no longer has|kept stopping/i],
];

/** Which kind of failure a run's error text is (its fix code first, when it has one). */
export function engineFailureKind(raw: unknown, fixCode?: string): EngineFailureKind {
  if (fixCode === "comfy_missing_node" || fixCode === "comfy_missing_model") return "missing-on-gpu";
  const text = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
  for (const [kind, re] of KINDS) if (re.test(text)) return kind;
  return "unknown";
}

/**
 * A failed run on our GPUs: the plain sentence the person sees, its kind, and the technical detail for the owner only
 * (cleaned as cleanEngineText cleans it; none when there is nothing beyond the sentence).
 */
export function plainEngineFailure(raw: unknown, fixCode?: string): { kind: EngineFailureKind; words: string; detail?: string } {
  const kind = engineFailureKind(raw, fixCode);
  const words = ENGINE_WORDS[kind];
  const detail = cleanEngineText(raw);
  return { kind, words, ...(detail && detail !== words && { detail }) };
}

/** Is this one of the plain sentences above. */
export const isEngineWords = (text: string | null | undefined): boolean => !!text && (Object.values(ENGINE_WORDS) as string[]).includes(text);
