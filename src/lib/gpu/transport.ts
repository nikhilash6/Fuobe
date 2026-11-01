/**
 * How the pre-flight talks to a ComfyUI: from Fuobe's server (a tunnel address, through fetchPublic) or from
 * the visitor's own tab (127.0.0.1, browser-direct). The probe (gather.ts) doesn't care which. Every request
 * has a total deadline and a byte cap counted while the body streams in (SPEC review 6c).
 */

export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export type TransportErrorKind = "timeout" | "too-big" | "unreachable" | "encoding" | "refused";

export class TransportError extends Error {
  constructor(
    readonly kind: TransportErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface TransportResponse {
  status: number;
  header(name: string): string | null;
  /** The body as chunks, cut off (TransportError "too-big") past the byte cap. Read once. */
  chunks(): AsyncIterable<Uint8Array>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
  /** Drop the body unread (and stop the deadline timer). */
  discard(): void;
}

export interface RequestOptions {
  /** A JSON body (sent as application/json). A POST without one sends no body and no Content-Type (the Manager's CSRF rule). */
  json?: unknown;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface ComfyTransport {
  via: "server" | "browser";
  request(method: "GET" | "POST", path: string, o?: RequestOptions): Promise<TransportResponse>;
}

/** Things fetch() returns that the wrapper needs (a web Response). */
interface FetchedLike {
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
}

/**
 * Wrap a fetch() Response: the body streams through a byte cap, and `finish` runs once the body is read,
 * fails or is dropped (it clears the request's deadline timer).
 */
export function wrapResponse(res: FetchedLike, o: { maxBytes: number; finish: () => void; aborted: () => TransportError | null }): TransportResponse {
  let used = false;
  async function* chunks(): AsyncIterable<Uint8Array> {
    if (used) throw new Error("The body was already read");
    used = true;
    const reader = res.body?.getReader();
    if (!reader) return o.finish();
    let size = 0;
    try {
      while (true) {
        let step: ReadableStreamReadResult<Uint8Array>;
        try {
          step = await reader.read();
        } catch (e) {
          throw o.aborted() ?? new TransportError("unreachable", `The answer stopped: ${(e as Error).message}`);
        }
        if (step.done) break;
        size += step.value.byteLength;
        if (size > o.maxBytes) throw new TransportError("too-big", `The answer is over ${Math.round(o.maxBytes / 1024 / 1024)} MB`);
        yield step.value;
      }
    } finally {
      o.finish();
      reader.cancel().catch(() => {});
    }
  }
  const text = async () => {
    const decoder = new TextDecoder();
    let out = "";
    for await (const c of chunks()) out += decoder.decode(c, { stream: true });
    return out + decoder.decode();
  };
  return {
    status: res.status,
    header: (name) => res.headers.get(name),
    chunks,
    text,
    discard: () => {
      if (used) return;
      used = true;
      o.finish();
      res.body?.cancel().catch(() => {});
    },
    json: async <T,>() => {
      const t = await text();
      try {
        return JSON.parse(t) as T;
      } catch {
        throw new TransportError("encoding", /^\s*</.test(t) ? "The answer is a web page, not ComfyUI's JSON" : "The answer isn't JSON");
      }
    },
  };
}

/**
 * A transport over a fetch function: a total deadline per request (an AbortSignal, which also stops a server
 * that sends one byte at a time), the byte cap, and no compressed bodies unless the fetch decodes them itself.
 */
export function fetchTransport(
  via: "server" | "browser",
  base: string,
  doFetch: (url: string, init: RequestInit) => Promise<FetchedLike>,
  o: { headers?: Record<string, string>; defaultTimeoutMs?: number; decodes?: boolean } = {},
): ComfyTransport {
  const root = base.replace(/\/+$/, "");
  return {
    via,
    async request(method, path, ro = {}) {
      const ctrl = new AbortController();
      const timeoutMs = ro.timeoutMs ?? o.defaultTimeoutMs ?? 10_000;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, timeoutMs);
      const finish = () => clearTimeout(timer);
      const aborted = () => (timedOut ? new TransportError("timeout", `No answer within ${Math.round(timeoutMs / 1000)} s`) : null);
      const headers: Record<string, string> = { Accept: "application/json", ...(o.headers ?? {}) };
      // Only a fetch that decodes (the browser's, undici's) may be offered compressed bodies.
      if (!o.decodes) headers["Accept-Encoding"] = "identity";
      let body: string | undefined;
      if (method === "POST" && ro.json !== undefined) {
        body = JSON.stringify(ro.json);
        headers["Content-Type"] = "application/json";
      }
      let res: FetchedLike;
      try {
        res = await doFetch(`${root}${path}`, { method, headers, body, signal: ctrl.signal, redirect: "manual", cache: "no-store", credentials: "omit" } as RequestInit);
      } catch (e) {
        finish();
        throw aborted() ?? (e instanceof TransportError ? e : new TransportError("unreachable", (e as Error).message || "No answer"));
      }
      const enc = (res.headers.get("content-encoding") ?? "identity").toLowerCase();
      if (!o.decodes && enc !== "identity" && enc !== "") {
        finish();
        res.body?.cancel().catch(() => {});
        throw new TransportError("encoding", `The answer is compressed (${enc}), which the check doesn't read`);
      }
      return wrapResponse(res, { maxBytes: ro.maxBytes ?? DEFAULT_MAX_BYTES, finish, aborted });
    },
  };
}
