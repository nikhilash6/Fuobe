import "server-only";

/*
 * Chat Completions streams from hosted providers, read into one answer. Assist streams every hosted
 * call so a long think never meets a gateway timeout (Meta answers 504 to a long call that isn't
 * streamed; DeepSeek closes one whose inference hasn't started in 10 minutes), but it only uses the
 * finished reply, so the pieces are joined here. The shapes are the providers' documented ones:
 * comment lines (`: OPENROUTER PROCESSING`, `: keep-alive`), tool arguments in pieces joined by
 * index, Gemini's signature in a chunk of its own, Mistral's content chunks, usage in three places,
 * errors inside a 200 stream, and MiniMax's base_resp.
 */

export interface StreamedCall {
  id: string;
  name: string;
  /** The arguments as the model wrote them (JSON text). */
  arguments: string;
  /** Gemini's thought signature (tool_calls[i].extra_content), sent back exactly as received. */
  extra?: unknown;
}

export interface StreamUsage {
  input?: number;
  output?: number;
  cached?: number;
  reasoning?: number;
}

export interface StreamResult {
  text: string;
  /** The reply's reasoning, under the field it came in (it goes back under the same one). */
  reasoning: { field: "reasoning_content" | "reasoning" | "thinking"; text: string } | null;
  /** OpenRouter's reasoning_details, joined by index. */
  details?: Record<string, unknown>[];
  toolCalls: StreamedCall[];
  finish: string | null;
  usage: StreamUsage | null;
  model?: string;
}

/** A failure the provider reported inside the stream (or went quiet). `status` is the HTTP status it means. */
export class StreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string | number,
    readonly idle = false,
  ) {
    super(message);
  }
}

/** MiniMax answers some errors with HTTP 200 and a status code in base_resp. */
const MINIMAX_STATUS: Record<number, number> = { 1002: 429, 1004: 401, 1008: 402, 2013: 400, 1039: 429 };

type Delta = {
  content?: unknown;
  reasoning_content?: unknown;
  reasoning?: unknown;
  reasoning_details?: unknown;
  tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string }; extra_content?: unknown }[];
};
type Chunk = {
  model?: string;
  choices?: { delta?: Delta; message?: Delta; finish_reason?: string | null }[];
  usage?: Record<string, unknown> | null;
  error?: { message?: string; code?: string | number; status?: number; metadata?: unknown };
  base_resp?: { status_code?: number; status_msg?: string };
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function readUsage(u: Record<string, unknown>): StreamUsage {
  const pd = (u.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const cd = (u.completion_tokens_details ?? {}) as Record<string, unknown>;
  const out: StreamUsage = { input: num(u.prompt_tokens), output: num(u.completion_tokens), cached: num(pd.cached_tokens) ?? num(u.cached_tokens), reasoning: num(cd.reasoning_tokens) ?? num(u.reasoning_tokens) };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as StreamUsage;
}

/** Joins the chunks of one reply. */
class Reply {
  text = "";
  reasoning: StreamResult["reasoning"] = null;
  details: Record<string, unknown>[] = [];
  calls: { id?: string; name?: string; args: string; extra?: unknown }[] = [];
  finish: string | null = null;
  usage: StreamUsage | null = null;
  model?: string;

  constructor(private readonly opts: { errorEnvelope?: "minimax" }) {}

  private think(field: "reasoning_content" | "reasoning" | "thinking", t: string) {
    if (!t) return;
    // The first field a reply uses is the one it goes back under.
    if (!this.reasoning) this.reasoning = { field, text: "" };
    this.reasoning.text += t;
  }

  /** Mistral's content: a string, or chunks of {type:"text"} and {type:"thinking", thinking:[{text}]}. */
  private content(c: unknown) {
    if (typeof c === "string") this.text += c;
    else if (Array.isArray(c)) {
      for (const part of c as { type?: string; text?: string; thinking?: { text?: string }[] | string }[]) {
        if (part?.type === "text" && typeof part.text === "string") this.text += part.text;
        else if (part?.type === "thinking") this.think("thinking", typeof part.thinking === "string" ? part.thinking : (part.thinking ?? []).map((t) => t.text ?? "").join(""));
      }
    }
  }

  private detail(list: unknown) {
    if (!Array.isArray(list)) return;
    for (const d of list as Record<string, unknown>[]) {
      if (!d || typeof d !== "object") continue;
      const same = this.details.find((x) => x.index !== undefined && x.index === d.index && x.type === d.type);
      if (!same) {
        this.details.push({ ...d });
        continue;
      }
      for (const [k, v] of Object.entries(d)) {
        if ((k === "text" || k === "summary") && typeof v === "string") same[k] = `${(same[k] as string | undefined) ?? ""}${v}`;
        else if (v !== undefined && v !== null && k !== "index" && k !== "type") same[k] = v;
      }
    }
  }

  add(j: Chunk) {
    if (this.opts.errorEnvelope === "minimax" && j.base_resp?.status_code) {
      const code = j.base_resp.status_code;
      throw new StreamError(j.base_resp.status_msg || `MiniMax error ${code}`, MINIMAX_STATUS[code] ?? 500, code);
    }
    if (j.error) throw new StreamError(j.error.message || "The provider reported an error", num(j.error.status) ?? (typeof j.error.code === "number" ? j.error.code : undefined), j.error.code);
    if (j.model) this.model = j.model;
    if (j.usage) this.usage = readUsage(j.usage);
    for (const ch of j.choices ?? []) {
      const d = ch.delta ?? ch.message ?? {};
      this.content(d.content);
      if (typeof d.reasoning_content === "string") this.think("reasoning_content", d.reasoning_content);
      if (typeof d.reasoning === "string") this.think("reasoning", d.reasoning);
      this.detail(d.reasoning_details);
      for (const t of d.tool_calls ?? []) {
        // By index; without one, by id (a new id is a new call), else the call being written.
        const known = t.id ? this.calls.findIndex((c) => c?.id === t.id) : -1;
        const at = typeof t.index === "number" ? t.index : known >= 0 ? known : t.id || !this.calls.length ? this.calls.length : this.calls.length - 1;
        const call = (this.calls[at] ??= { args: "" });
        if (t.id && !call.id) call.id = t.id;
        if (t.function?.name && !call.name) call.name = t.function.name;
        if (typeof t.function?.arguments === "string") call.args += t.function.arguments;
        if (t.extra_content !== undefined && call.extra === undefined) call.extra = t.extra_content;
      }
      if (ch.finish_reason) {
        if (ch.finish_reason === "error") throw new StreamError("The provider stopped with an error partway through the reply");
        this.finish = ch.finish_reason;
      }
    }
  }

  result(): StreamResult {
    return {
      text: this.text,
      reasoning: this.reasoning,
      ...(this.details.length && { details: this.details }),
      toolCalls: this.calls.flatMap((c, i) => (c?.name ? [{ id: c.id || `call_${i}`, name: c.name, arguments: c.args, ...(c.extra !== undefined && { extra: c.extra }) }] : [])),
      finish: this.finish,
      usage: this.usage,
      ...(this.model && { model: this.model }),
    };
  }
}

/** The next piece of the body, or a StreamError when nothing (not even a keep-alive) came for `idleMs`. */
async function next(reader: ReadableStreamDefaultReader<Uint8Array>, idleMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StreamError(`Nothing came back for ${Math.round(idleMs / 1000)} s`, undefined, undefined, true)), idleMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a server-sent event stream: `onData` gets each event's data (comment lines and empty events are
 * skipped) and returns "done" to stop early. Throws StreamError when nothing (not even a keep-alive)
 * comes for `idleMs`.
 */
export async function readSse(body: ReadableStream<Uint8Array>, onData: (payload: string) => "done" | void, idleMs = 180_000): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let data: string[] = [];
  let done = false;
  const event = () => {
    const payload = data.join("\n").trim();
    data = [];
    if (payload && onData(payload) === "done") done = true;
  };
  const line = (raw: string) => {
    const l = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!l) return event();
    if (l.startsWith(":")) return;
    if (l.startsWith("data:")) data.push(l.slice(5).replace(/^ /, ""));
  };
  try {
    while (!done) {
      const { value, done: end } = await next(reader, idleMs);
      if (end) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while (!done && (nl = buf.indexOf("\n")) >= 0) {
        line(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    }
    if (!done) {
      buf += decoder.decode();
      if (buf) line(buf);
      event();
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/**
 * Read a Chat Completions stream to its end ([DONE], or the end of the body). Throws StreamError for
 * an error the provider sends inside the stream, and when nothing arrives for `idleMs` (3 minutes).
 */
export async function readChatStream(body: ReadableStream<Uint8Array>, opts: { idleMs?: number; errorEnvelope?: "minimax" } = {}): Promise<StreamResult> {
  const reply = new Reply(opts);
  await readSse(
    body,
    (payload) => {
      if (payload === "[DONE]") return "done";
      let j: Chunk;
      try {
        j = JSON.parse(payload) as Chunk;
      } catch {
        return;
      }
      reply.add(j);
    },
    opts.idleMs,
  );
  return reply.result();
}
