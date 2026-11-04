/**
 * A stand-in ComfyUI for the recovery tests: tests/helpers/fake-local-comfy.ts (/prompt, /history, /view, /queue,
 * /interrupt, /system_stats and the progress socket), behind a small front of its own on a random high port that adds
 * /free and the ways a real one goes wrong:
 *
 * - crash(): the process dies. Nothing answers on its port, and its queue, history and sockets are gone (its input
 *   folder stays). start() brings it back on the same port, empty.
 * - hang(): the next prompt starts and never moves.
 * - stall(): nothing starts; prompts wait in its queue.
 * - fail("missing_node" | "missing_model"): the next prompt is refused.
 * - outOfMemory(): the next prompt runs out of graphics memory at its end.
 * - lose(n): the next n prompts are taken and then gone (a restart while they waited).
 *
 * Ports come from the system's free high ports, never ComfyUI's own (8188 to 8191).
 */
import http from "node:http";
import net from "node:net";
import { startLocalComfy, type LocalComfy, type LocalComfyLog, type LocalComfyOptions } from "./fake-local-comfy";

export interface StandInComfy {
  url: string;
  port: number;
  /** The ComfyUI behind the front (its options, history and inputs). */
  inner: LocalComfy;
  /** Every request, in order: the inner ComfyUI's log, plus the front's own /free calls. */
  log: () => LocalComfyLog[];
  /** The bodies of POST /free, in order. */
  frees: unknown[];
  /** Prompts posted since it started (a crash doesn't reset the count). */
  posts: () => number;
  /** Prompts posted with this prompt id. */
  postsOf: (promptId: string) => number;
  /** Is it answering? */
  up: () => boolean;
  crash: () => Promise<void>;
  start: () => Promise<void>;
  hang: () => void;
  stall: (on?: boolean) => void;
  fail: (kind: "missing_node" | "missing_model") => void;
  outOfMemory: () => void;
  lose: (n?: number) => void;
  close: () => Promise<void>;
}

/** Ports ComfyUI uses on a real machine: a stand-in never takes them. */
const COMFY_PORTS = new Set([8188, 8189, 8190, 8191]);

/** A free port from the system's high range (never one of ComfyUI's own). */
export async function freeHighPort(): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const port = await new Promise<number>((resolve, reject) => {
      const s = net.createServer();
      s.once("error", reject);
      s.listen(0, "127.0.0.1", () => {
        const a = s.address() as net.AddressInfo;
        s.close(() => resolve(a.port));
      });
    });
    if (port >= 1024 && !COMFY_PORTS.has(port)) return port;
  }
  throw new Error("No free high port");
}

/** Start a stand-in. Options are the inner ComfyUI's (tests/helpers/fake-local-comfy.ts); `cors` defaults to "*". */
export async function startStandInComfy(o: Partial<LocalComfyOptions> = {}): Promise<StandInComfy> {
  const inner = await startLocalComfy({ cors: "*", steps: 4, stepMs: 10, latencyMs: 10, ...o }, await freeHighPort());
  const frontLog: LocalComfyLog[] = [];
  const frees: unknown[] = [];
  let server: http.Server | null = null;
  let port = 0;
  /** Progress sockets passed through (a server's close() waits for them, so a crash ends them itself). */
  const upgraded = new Set<net.Socket>();

  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://stand-in");
    if (url.pathname === "/free" || url.pathname === "/api/free") {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        let body: unknown = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        } catch {}
        frontLog.push({ method: req.method ?? "GET", path: url.pathname, at: Date.now(), body });
        if (req.method !== "POST") return void res.writeHead(405, { connection: "close" }).end();
        frees.push(body);
        res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*", connection: "close" });
        res.end("{}");
      });
      return;
    }
    // Everything else is ComfyUI's own: passed through as it came. No connection is kept open after an answer, so a
    // client never reuses one a crash ended.
    const up = http.request({ host: "127.0.0.1", port: inner.port, method: req.method, path: req.url, headers: req.headers }, (answer) => {
      res.writeHead(answer.statusCode ?? 502, { ...answer.headers, connection: "close" });
      answer.pipe(res);
    });
    up.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  };

  const upgrade = (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    upgraded.add(socket);
    socket.on("close", () => upgraded.delete(socket));
    const to = net.connect(inner.port, "127.0.0.1", () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries(req.headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => `${k}: ${x}`) : [`${k}: ${v}`])), "", ""];
      to.write(lines.join("\r\n"));
      if (head.length) to.write(head);
      socket.pipe(to).pipe(socket);
    });
    const drop = () => {
      socket.destroy();
      to.destroy();
    };
    to.on("error", drop);
    socket.on("error", drop);
    socket.on("close", () => to.destroy());
    to.on("close", () => socket.destroy());
  };

  const listen = () =>
    new Promise<void>((resolve, reject) => {
      const s = http.createServer(handler);
      s.on("upgrade", upgrade);
      s.once("error", reject);
      s.listen(port, "127.0.0.1", () => {
        port = (s.address() as net.AddressInfo).port;
        server = s;
        resolve();
      });
    });

  const shut = () =>
    new Promise<void>((resolve) => {
      const s = server;
      server = null;
      if (!s) return resolve();
      for (const u of upgraded) u.destroy();
      upgraded.clear();
      s.closeAllConnections?.();
      s.close(() => resolve());
    });

  port = await freeHighPort();
  await listen();

  const fake: StandInComfy = {
    get url() {
      return `http://127.0.0.1:${port}`;
    },
    get port() {
      return port;
    },
    inner,
    log: () => [...inner.log, ...frontLog].sort((a, b) => (a.at ?? 0) - (b.at ?? 0)),
    frees,
    posts: () => inner.posts(),
    postsOf: (promptId) => inner.log.filter((e) => e.prompt?.prompt_id === promptId).length,
    up: () => server !== null,
    crash: async () => {
      await shut();
      // Its memory goes with it: the queue, the history and the sockets (the log of what it was asked stays).
      inner.restart();
    },
    start: async () => {
      if (server) return;
      await listen();
    },
    hang: () => {
      inner.opts.failNext = "never";
    },
    stall: (on = true) => {
      inner.opts.stall = on;
    },
    fail: (kind) => {
      inner.opts.failNext = kind;
    },
    outOfMemory: () => {
      inner.opts.failNext = "oom";
    },
    lose: (n = 1) => {
      inner.opts.loseNext = (inner.opts.loseNext ?? 0) + n;
    },
    close: async () => {
      await shut();
      await inner.close();
    },
  };
  return fake;
}
