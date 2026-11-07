// The worker's recent log lines for the studio (docs/gpu-workers.md, "The protocol"): a ring of at most 200 masked lines,
// sent as the beat's `log` (40 at most per beat) and dropped once a beat that carried them got a 2xx answer. A studio
// that ignores the field still answers 2xx, so the lines go just the same. Nothing here throws, waits or grows past its
// cap: a line it can't take is skipped.

/** The ring's caps: lines kept, lines per beat, characters per line. */
export const LOG_RING = { keep: 200, perBeat: 40, lineChars: 300 };

const MODEL_FILE = /\.(safetensors|sft|ckpt|pt|pth|bin|gguf|onnx|pkl)$/i;
const MODEL_NAME = /[\w.-]+\.(safetensors|sft|ckpt|pt|pth|bin|gguf|onnx|pkl)\b/gi;
const fileWord = (p) => {
  const base = p.split(/[\\/]/).filter(Boolean).pop() ?? "";
  return MODEL_FILE.test(base) ? base : "[file]";
};
const LONG_TOKEN = /[A-Za-z0-9_-]{32,}/g;
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()[\]\u0000]+/gi;
const KEY_RE = /\b(token|api[_-]?key|key|secret|password|passwd|pwd|authorization|auth|cookie|session)(\s*[:=]\s*)(?!Bearer\b)("[^"]*"|'[^']*'|[^\s"',;]+)/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const WIN_PATH = /(?:\b[A-Za-z]:|\\\\[^\\\s\u0000]+)[\\/](?:[^\\/:*?"<>|\u0000\r\n]*[^\\/:*?"<>|\u0000\s][\\/])*[^\\/:*?"<>|()\s\u0000]*/g;
const POSIX_PATH = /(^|[\s("'=,[])(~?\/(?:[^/\s"'<>()\u0000]+\/)*[^/\s"'<>()\u0000]+)/g;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;

function cleanUrl(u) {
  try {
    const x = new URL(u);
    return `${x.protocol}//${x.host}${x.pathname.replace(LONG_TOKEN, "[hidden]")}${x.search || x.hash ? "?[hidden]" : ""}`;
  } catch {
    return "[url]";
  }
}

/**
 * A log line as it may leave this PC: no tokens, keys or bearer strings, no emails, no full file paths (a model file
 * keeps its base name, anything else is "[file]"), URLs without their query, long quoted text hidden, one line of at
 * most `max` characters. The studio masks the same way again (src/server/computer/worker-events.ts maskLogLine).
 */
export function maskLine(raw, max = LOG_RING.lineChars) {
  if (typeof raw !== "string") return "";
  let s = raw.slice(0, 2000).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/[\x00-\x1f\x7f]/g, " ");
  // What is already safe (a cleaned URL, a file's word, a model file's name) waits aside, so later rules leave it.
  const kept = [];
  const keep = (v) => `\u0000${kept.push(v) - 1}\u0000`;
  s = s.replace(URL_RE, (u) => keep(cleanUrl(u)));
  s = s.replace(/\bBearer\s+[^\s"',;]+/gi, "Bearer [hidden]");
  s = s.replace(KEY_RE, "$1$2[hidden]");
  s = s.replace(EMAIL_RE, "[email]");
  s = s.replace(WIN_PATH, (p) => keep(fileWord(p)));
  s = s.replace(POSIX_PATH, (_m, pre, p) => pre + keep(fileWord(p)));
  s = s.replace(MODEL_NAME, (m) => keep(m));
  s = s.replace(JWT, "[hidden]");
  s = s.replace(LONG_TOKEN, "[hidden]");
  s = s.replace(/"[^"]{60,}"/g, '"[text]"');
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i) => kept[Number(i)] ?? "[hidden]");
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** A line's level from its words (the worker's log has none of its own). */
export function levelOf(line) {
  if (/\b(error|failed|crash(ed)?|exception)\b/i.test(line)) return "error";
  if (/\b(couldn't|can't|cannot|isn't|aren't|won't|didn't|refused|stopped|lost|timed out|pausing|no working)\b/i.test(line)) return "warn";
  return "info";
}

export class LogRing {
  /** `o`: { keep, perBeat, lineChars, now }. */
  constructor(o = {}) {
    this.keep = o.keep ?? LOG_RING.keep;
    this.perBeat = o.perBeat ?? LOG_RING.perBeat;
    this.lineChars = o.lineChars ?? LOG_RING.lineChars;
    this.now = o.now ?? Date.now;
    this.lines = [];
    this.seq = 0;
    // The last line the beat in flight carries (0: none in flight).
    this.sentSeq = 0;
  }

  /** Keep a line (masked first). Never throws. */
  add(raw, level) {
    try {
      const line = maskLine(String(raw ?? ""), this.lineChars);
      if (!line) return;
      this.lines.push({ seq: ++this.seq, at: Number(this.now()) || Date.now(), level: level === "warn" || level === "error" || level === "info" ? level : levelOf(line), line });
      if (this.lines.length > this.keep) this.lines.splice(0, this.lines.length - this.keep);
    } catch {}
  }

  /** The lines for the next beat, oldest first (at most perBeat), remembered as in flight. Never throws. */
  take() {
    try {
      const out = this.lines.slice(0, this.perBeat);
      this.sentSeq = out.length ? out[out.length - 1].seq : 0;
      return out.map(({ at, level, line }) => ({ at, level, line }));
    } catch {
      return [];
    }
  }

  /** The beat that carried the lines in flight got a 2xx: they go. Lines added since stay. Never throws. */
  ack() {
    try {
      if (!this.sentSeq) return;
      const sent = this.sentSeq;
      this.lines = this.lines.filter((l) => l.seq > sent);
      this.sentSeq = 0;
    } catch {}
  }

  get size() {
    return this.lines.length;
  }
}
