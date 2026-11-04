/**
 * A stand-in for an install's external billing service (docs/billing-hook.md), for the recovery tests. It keeps its
 * holds and reports across a stop and a start, as a service with its own database would, and it can be:
 *
 * - stopped and started again (nothing answers while it is stopped: the connection is refused);
 * - made slow (`slowMs` before every answer), or made to hold its answers to one call until a number of them have come
 *   in (`gather`: two servers that both send a report are both seen, however their timing falls);
 * - reached over HTTP on a random high port, or over a Unix socket (a named pipe on Windows).
 *
 * By default every run is free: the quote says "Free" with an amount of 0, and a reserve sets nothing aside. `priced`
 * gives runs a price (`price` per run). A reserve must name its request (`requestId`, else 400), and a repeated
 * reserve with the same request id is the same hold. A hold is kept until its deadline (`closeBy`: the run's wait limit plus `holdLifeMs`); a report after it is
 * refused and counted as late.
 */
import fs from "node:fs";
import http from "node:http";
import type net from "node:net";
import os from "node:os";
import path from "node:path";

export interface StandInCall {
  method: string;
  path: string;
  body: unknown;
  at: number;
}

export interface StandInHold {
  id: string;
  requestId: string;
  account: string;
  amount: number;
  createdAt: number;
  closeBy: number;
  released: boolean;
  /** Every report for each run row, in order ("succeeded", "failed", …), with what it carried. */
  reports: Map<string, { kind: "settle" | "refund"; status: string; gpuMs: unknown; device: unknown; at: number }[]>;
}

export interface StandInBilling {
  /** FUOBE_BILLING_URL for this service: http://127.0.0.1:<port> or unix:<path>. */
  address: string;
  token: string;
  calls: StandInCall[];
  holds: Map<string, StandInHold>;
  /** Reports that came after their hold's deadline (refused). */
  late: { holdId: string; generationId: string }[];
  /** Runs have a price: each costs `price`. Off (the default): every run is free. */
  priced: boolean;
  price: number;
  /** The policy every account and guest gets. */
  policy: Record<string, unknown>;
  /** The longest a run may wait before its first start (the reserve's maxWaitMs). */
  maxWaitMs: number;
  /** How long a hold lasts after its run's wait limit. */
  holdLifeMs: number;
  /** Wait this long before every answer. */
  slowMs: number;
  /**
   * Hold every call to `path` until `count` of them have come in, or `maxMs` has passed since the first: then answer
   * them all. Null: answer each at once.
   */
  gather: { path: string; count: number; maxMs: number } | null;
  /** Is it answering? */
  up: () => boolean;
  stop: () => Promise<void>;
  start: () => Promise<void>;
  /** Stop now, and start again after `ms`. */
  downFor: (ms: number) => Promise<void>;
  callsOf: (p: string) => StandInCall[];
  /** Holds made for this account. */
  holdsOf: (account: string) => StandInHold[];
  /** Every report sent for one run row, across holds. */
  reportsFor: (generationId: string) => { holdId: string; kind: "settle" | "refund"; status: string }[];
  close: () => Promise<void>;
}

/** Runs on this install's GPUs open to every account, for every kind of run and file, within rate limits. */
export const FREE_RUNS_POLICY = {
  hosted: true,
  pool: {},
  uploads: { image: true, video: true, audio: true },
  limits: { activeRuns: 2, waiting: 2, runsPerHour: 20, outputsPerRun: 4, maxMegapixels: 0, maxSeconds: 0, keepDays: 0, spaceBytes: 0 },
  ttlS: 60,
};

const readBody = (req: http.IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });

let socketN = 0;

/** A socket path for this process: a named pipe on Windows, a file in a temp folder elsewhere. */
function socketPath(): string {
  const name = `fuobe-standin-billing-${process.pid}-${++socketN}-${Math.random().toString(36).slice(2, 8)}`;
  if (process.platform === "win32") return `\\\\.\\pipe\\${name}`;
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-billing-")), "billing.sock");
}

export async function startStandInBilling(o: { socket?: boolean; token?: string } = {}): Promise<StandInBilling> {
  const token = o.token ?? "standin-billing-token";
  const sock = o.socket ? socketPath() : null;
  let port = 0;
  let server: http.Server | null = null;
  let n = 0;

  const f = {
    token,
    calls: [] as StandInCall[],
    holds: new Map<string, StandInHold>(),
    late: [] as { holdId: string; generationId: string }[],
    priced: false,
    price: 3,
    policy: JSON.parse(JSON.stringify(FREE_RUNS_POLICY)) as Record<string, unknown>,
    maxWaitMs: 20 * 60_000,
    holdLifeMs: 2 * 3_600_000,
    slowMs: 0,
    gather: null as StandInBilling["gather"],
  };

  let waiting: (() => void)[] = [];
  let gatherTimer: NodeJS.Timeout | undefined;
  const releaseAll = () => {
    clearTimeout(gatherTimer);
    gatherTimer = undefined;
    const go = waiting;
    waiting = [];
    for (const r of go) r();
  };
  const gathered = (g: NonNullable<StandInBilling["gather"]>) =>
    new Promise<void>((resolve) => {
      waiting.push(resolve);
      if (waiting.length >= g.count) return releaseAll();
      gatherTimer ??= setTimeout(releaseAll, g.maxMs);
    });

  const quote = () => (f.priced ? { allowed: true, amount: f.price, priceVersion: "p1", text: `${f.price} units` } : { allowed: true, amount: 0, priceVersion: "free", text: "Free" });

  const answer = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const raw = await readBody(req);
    let body: Record<string, unknown> = {};
    try {
      body = raw.length ? (JSON.parse(raw.toString("utf8")) as Record<string, unknown>) : {};
    } catch {}
    const url = req.url ?? "/";
    f.calls.push({ method: req.method ?? "GET", path: url, body, at: Date.now() });
    if (f.slowMs) await new Promise((r) => setTimeout(r, f.slowMs));
    const g = f.gather;
    if (g && url.split("?")[0] === g.path) await gathered(g);
    const json = (status: number, v: unknown) => {
      if (res.destroyed) return;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(v));
    };
    if (req.headers.authorization !== `Bearer ${token}`) return json(401, { error: "unknown caller" });
    const p = url.split("?")[0];
    const now = Date.now();
    if (p === "/v1/health") return json(200, { ok: true });
    if (p === "/v1/policy") return json(200, f.policy);
    if (p === "/v1/quote") return json(200, quote());
    if (p === "/v1/reserve") {
      // Every reserve names its request (one per press of Run): a repeat with the same id is the same hold.
      const requestId = typeof body.requestId === "string" ? body.requestId : "";
      if (!requestId) return json(400, { error: "requestId is required" });
      const account = String((body.account as { id?: unknown } | undefined)?.id ?? "");
      const same = [...f.holds.values()].find((h) => h.requestId === requestId);
      const ok = (h: StandInHold) => json(200, { ok: true, holdId: h.id, amount: h.amount, boostMs: 0, maxWaitMs: f.maxWaitMs, class: "free", text: f.priced ? `${h.amount} units` : "Free" });
      if (same) return ok(same);
      const shown = (body.shown ?? {}) as { amount?: number };
      const q = quote();
      if (q.amount > Number(shown.amount ?? 0)) return json(200, { ok: false, code: "price-changed", text: `It now costs ${q.amount}.`, quote: q });
      const h: StandInHold = { id: `hold_${++n}`, requestId, account, amount: q.amount, createdAt: now, closeBy: now + f.maxWaitMs + f.holdLifeMs, released: false, reports: new Map() };
      f.holds.set(h.id, h);
      return ok(h);
    }
    if (p === "/v1/settle" || p === "/v1/refund") {
      const h = f.holds.get(String(body.holdId));
      if (!h) return json(404, { error: "no such hold" });
      const generationId = String(body.generationId);
      if (now > h.closeBy) {
        f.late.push({ holdId: h.id, generationId });
        return json(409, { ok: false, error: "the hold has closed" });
      }
      const list = h.reports.get(generationId) ?? [];
      list.push({ kind: p === "/v1/settle" ? "settle" : "refund", status: String(body.status), gpuMs: body.gpuMs, device: body.device, at: now });
      h.reports.set(generationId, list);
      return json(200, p === "/v1/settle" ? { ok: true, charged: h.amount } : { ok: true, text: "Not charged" });
    }
    if (p === "/v1/release") {
      const h = f.holds.get(String(body.holdId));
      if (h) h.released = true;
      return json(200, { ok: true });
    }
    if (p === "/v1/balance") return json(200, f.priced ? { amount: 20, chip: "20 units", text: "20 units left", detail: [] } : { amount: 0, chip: "Free", text: "Free", detail: [] });
    if (p === "/v1/account-event") return json(200, { ok: true });
    if (p === "/v1/interest") return json(200, { ok: true, text: "Noted." });
    json(404, { error: "not found" });
  };

  const listen = () =>
    new Promise<void>((resolve, reject) => {
      const s = http.createServer((req, res) => void answer(req, res));
      s.once("error", reject);
      const done = () => {
        if (!sock) port = (s.address() as net.AddressInfo).port;
        server = s;
        resolve();
      };
      if (sock) {
        if (process.platform !== "win32") fs.rmSync(sock, { force: true });
        s.listen(sock, done);
      } else s.listen(port, "127.0.0.1", done);
    });

  // A start that downFor() set for later. stop(), start() and close() cancel it, so it never undoes a later stop or
  // listens again after the tests have closed the service.
  let comeBack: NodeJS.Timeout | undefined;
  const cancelComeBack = () => {
    clearTimeout(comeBack);
    comeBack = undefined;
  };

  const stop = () =>
    new Promise<void>((resolve) => {
      cancelComeBack();
      const s = server;
      server = null;
      if (!s) return resolve();
      s.closeAllConnections?.();
      s.close(() => resolve());
    });

  await listen();
  const start = async () => {
    cancelComeBack();
    if (!server) await listen();
  };

  // (A start after a stop listens on the same port or socket, so the address never changes.)
  const service: StandInBilling = Object.assign(f, {
    address: sock ? `unix:${sock}` : `http://127.0.0.1:${port}`,
    up: () => server !== null,
    stop,
    start,
    downFor: async (ms: number) => {
      await stop();
      comeBack = setTimeout(() => {
        comeBack = undefined;
        void start().catch(() => {});
      }, ms);
    },
    callsOf: (p: string) => f.calls.filter((c) => c.path.split("?")[0] === p),
    holdsOf: (account: string) => [...f.holds.values()].filter((h) => h.account === account),
    reportsFor: (generationId: string) =>
      [...f.holds.values()].flatMap((h) => (h.reports.get(generationId) ?? []).map((r) => ({ holdId: h.id, kind: r.kind, status: r.status }))),
    close: stop,
  }) as StandInBilling;
  return service;
}
