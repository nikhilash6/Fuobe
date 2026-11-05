import "server-only";
import http from "node:http";
import https from "node:https";

/**
 * The transport for an install's optional external services (the billing hook, billing.ts; the moderation hook,
 * moderation.ts): JSON over HTTPS, HTTP, or a Unix socket on this machine (`unix:/path/to/service.sock`).
 *
 * Every call sends `Authorization: Bearer <token>` and waits at most `timeoutMs`. An answer is read up to 1 MB. A
 * transport error, a timeout, a non-JSON answer or an HTTP status outside 2xx is a HookDown error: its message is
 * for the server's log only. A browser is told only that runs are paused (the service's address never reaches it).
 */

export class HookDown extends Error {
  constructor(
    readonly hook: string,
    detail: string,
    /**
     * What went wrong, as far as it is known: the HTTP status it answered, no answer in time, or no connection at all
     * (`refused`: nothing was sent, so the service did nothing).
     */
    readonly why: { status?: number; timedOut?: boolean; refused?: boolean } = {},
  ) {
    super(`${hook}: ${detail}`);
  }
}

/** Where a service is: an http(s) base URL, or a Unix socket path. */
export type HookTarget = { kind: "url"; base: URL } | { kind: "socket"; path: string };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
function isLoopback(hostname: string): boolean {
  if (LOOPBACK_HOSTS.has(hostname)) return true;
  // 127.0.0.0/8
  const parts = hostname.split(".");
  return parts.length === 4 && parts[0] === "127" && parts.every((p) => /^\d{1,3}$/.test(p));
}

/** Parse a hook address. `unix:/path.sock` (or `unix:///path.sock`) is a socket; anything else must be an http(s) URL. */
export function hookTarget(raw: string): HookTarget | null {
  const v = raw.trim();
  if (!v) return null;
  if (v.startsWith("unix:")) {
    const p = v.slice("unix:".length).replace(/^\/\/(?=\/)/, "");
    return p ? { kind: "socket", path: p } : null;
  }
  try {
    const base = new URL(v);
    if (base.protocol !== "http:" && base.protocol !== "https:") return null;
    if (base.protocol === "http:" && !isLoopback(base.hostname)) {
      console.warn(
        `[hook] WARNING: ${v} is plain HTTP on a non-loopback address. ` +
          `Bearer tokens and payloads will travel unencrypted. Use https: or a unix: socket.`,
      );
    }
    return { kind: "url", base };
  } catch {
    return null;
  }
}

export interface HookCall {
  hook: string;
  target: HookTarget;
  token?: string;
  method: "GET" | "POST";
  /** The path under the service's base, with any query: "/v1/quote". */
  path: string;
  /** JSON (an object), or raw bytes with `contentType`. */
  body?: unknown;
  bytes?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
  timeoutMs: number;
}

const MAX_ANSWER = 1024 * 1024;

/** One call to a service. Resolves with the parsed JSON answer; rejects with HookDown. */
export function hookCall<T>(c: HookCall): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const payload = c.bytes ?? (c.body === undefined ? undefined : Buffer.from(JSON.stringify(c.body)));
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(c.token && { Authorization: `Bearer ${c.token}` }),
      ...(payload && { "Content-Type": c.contentType ?? "application/json", "Content-Length": String(payload.length) }),
      ...c.headers,
    };
    let opts: http.RequestOptions;
    let lib: typeof http | typeof https = http;
    if (c.target.kind === "socket") {
      opts = { socketPath: c.target.path, path: c.path, method: c.method, headers: { Host: "localhost", ...headers } };
    } else {
      const base = c.target.base;
      const prefix = base.pathname.replace(/\/+$/, "");
      lib = base.protocol === "https:" ? https : http;
      opts = { protocol: base.protocol, hostname: base.hostname, port: base.port || undefined, path: `${prefix}${c.path}`, method: c.method, headers };
    }
    let settled = false;
    // The whole call, connection to last byte, within timeoutMs.
    const timer = setTimeout(() => {
      fail(`no answer in ${c.timeoutMs} ms from ${c.method} ${c.path}`, { timedOut: true });
      req.destroy();
    }, c.timeoutMs);
    const fail = (detail: string, why: HookDown["why"] = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new HookDown(c.hook, detail, why));
    };
    const req = lib.request(opts, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (d: Buffer) => {
        size += d.length;
        if (size > MAX_ANSWER) {
          req.destroy();
          fail("the answer was over 1 MB");
          return;
        }
        chunks.push(d);
      });
      res.on("end", () => {
        if (settled) return;
        const status = res.statusCode ?? 0;
        if (status < 200 || status > 299) return fail(`HTTP ${status} from ${c.method} ${c.path}`, { status });
        try {
          const text = Buffer.concat(chunks).toString("utf8");
          const value = (text ? JSON.parse(text) : {}) as T;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        } catch {
          fail(`an answer that isn't JSON from ${c.method} ${c.path}`);
        }
      });
      res.on("error", (e) => fail(e.message));
    });
    // No connection (refused, no such socket): nothing reached the service.
    req.on("error", (e: NodeJS.ErrnoException) => fail(e.message, e.code === "ECONNREFUSED" || e.code === "ENOENT" ? { refused: true } : {}));
    if (payload) req.write(payload);
    req.end();
  });
}
