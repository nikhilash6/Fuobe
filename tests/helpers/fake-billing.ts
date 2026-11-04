/**
 * Stand-ins for an install's optional external services in tests: a billing service (docs/billing-hook.md) and a
 * moderation service (docs/moderation-hook.md). Each records every call and answers with arbitrary numbers ("7 units").
 * They listen on 127.0.0.1, on the first free port from 3360 to 3369.
 */
import http from "node:http";

export interface Recorded {
  method: string;
  path: string;
  body: unknown;
  headers: http.IncomingHttpHeaders;
  bytes?: Buffer;
}

/** Listen on the first free port from 3360 to 3369. */
export async function listenInRange(server: http.Server): Promise<number> {
  for (let port = 3360; port <= 3369; port++) {
    const ok = await new Promise<boolean>((resolve) => {
      const onError = () => {
        server.off("listening", onListening);
        resolve(false);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve(true);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });
    if (ok) return port;
  }
  throw new Error("No free port from 3360 to 3369");
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

export interface FakeBilling {
  url: string;
  port: number;
  calls: Recorded[];
  /** What the service charges a run, and the price version. */
  price: { amount: number; version: string };
  /** Holds, by id: amount, and the reports each got (by generation id). */
  holds: Map<string, { amount: number; requestId: string; reports: Map<string, string>; released: boolean }>;
  /** Answer every call with HTTP 503 (the service "down"), or never answer. */
  down: false | "error" | "hang";
  /** Refuse reserves with this code (and words). */
  refuse: null | { code: string; text: string };
  /** The policy every account gets. */
  policy: Record<string, unknown>;
  /** The policy a guest gets (GET /v1/policy with no account); null: the same as an account. */
  guestPolicy: Record<string, unknown> | null;
  /** Extra fields of every reserve answer that sets a price aside (a class, say). */
  reserveExtra: Record<string, unknown>;
  /** The quote every price check gets instead of the allowed one (a refusal: busy, a limit…); null: allowed. */
  quoteAnswer: Record<string, unknown> | null;
  /** How many times each (hold, generation) pair was reported. */
  reportCount: (holdId: string, generationId: string) => number;
  calls_of: (path: string) => Recorded[];
  close: () => Promise<void>;
}

export const FAKE_POLICY = {
  hosted: true,
  pool: {},
  uploads: { image: true, video: false, audio: false },
  limits: { activeRuns: 7, waiting: 7, runsPerHour: 70, outputsPerRun: 2, maxMegapixels: 7, maxSeconds: 7, keepDays: 7, spaceBytes: 7_000_000 },
  ttlS: 0,
};

export async function startFakeBilling(): Promise<FakeBilling> {
  let holdN = 0;
  const reportCounts = new Map<string, number>();
  const f: Omit<FakeBilling, "url" | "port" | "close"> = {
    calls: [],
    price: { amount: 7, version: "v7" },
    holds: new Map(),
    down: false,
    refuse: null,
    policy: { ...FAKE_POLICY },
    guestPolicy: null,
    reserveExtra: {},
    quoteAnswer: null,
    reportCount: (h, g) => reportCounts.get(`${h} ${g}`) ?? 0,
    calls_of: (p) => f.calls.filter((c) => c.path.split("?")[0] === p),
  };
  const quote = () => ({ allowed: true, amount: f.price.amount, priceVersion: f.price.version, text: `${f.price.amount} units`, sub: "from your test balance", etaS: 7 });
  const server = http.createServer(async (req, res) => {
    const raw = await readBody(req);
    let body: unknown = null;
    try {
      body = raw.length ? JSON.parse(raw.toString("utf8")) : null;
    } catch {}
    const path = req.url ?? "/";
    f.calls.push({ method: req.method ?? "GET", path, body, headers: req.headers });
    if (f.down === "hang") return;
    const json = (status: number, v: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(v));
    };
    if (f.down === "error") return json(503, { error: "down" });
    if (req.headers.authorization !== "Bearer test-billing-token") return json(401, { error: "who are you" });
    const p = path.split("?")[0];
    const b = (body ?? {}) as Record<string, unknown>;
    if (p === "/v1/health") return json(200, { ok: true, version: "test" });
    if (p === "/v1/policy") return json(200, !new URLSearchParams(path.split("?")[1] ?? "").get("account") && f.guestPolicy ? f.guestPolicy : f.policy);
    if (p === "/v1/quote") return json(200, f.quoteAnswer ?? quote());
    if (p === "/v1/reserve") {
      const requestId = String(b.requestId);
      const again = [...f.holds.entries()].find(([, h]) => h.requestId === requestId);
      if (again) return json(200, { ok: true, holdId: again[0], amount: again[1].amount, boostMs: 7000, maxWaitMs: 700_000, text: `${again[1].amount} units`, ...f.reserveExtra });
      if (f.refuse) return json(200, { ok: false, code: f.refuse.code, text: f.refuse.text });
      const shown = b.shown as { amount: number; priceVersion: string };
      if (f.price.amount > shown.amount) return json(200, { ok: false, code: "price-changed", text: `The price is now ${f.price.amount} units.`, quote: quote() });
      const id = `h_${++holdN}`;
      f.holds.set(id, { amount: f.price.amount, requestId, reports: new Map(), released: false });
      return json(200, { ok: true, holdId: id, amount: f.price.amount, boostMs: 7000, maxWaitMs: 700_000, text: `${f.price.amount} units`, ...f.reserveExtra });
    }
    if (p === "/v1/settle" || p === "/v1/refund") {
      const h = f.holds.get(String(b.holdId));
      if (!h) return json(404, { error: "no such hold" });
      const key = `${b.holdId} ${b.generationId}`;
      reportCounts.set(key, (reportCounts.get(key) ?? 0) + 1);
      h.reports.set(String(b.generationId), String(b.status));
      return json(200, p === "/v1/settle" ? { ok: true, charged: h.amount } : { ok: true, text: "Not charged" });
    }
    if (p === "/v1/release") {
      const h = f.holds.get(String(b.holdId));
      if (h) h.released = true;
      return json(200, { ok: true });
    }
    if (p === "/v1/balance") return json(200, { amount: 70, chip: "70 units", text: "70 units left", refillAt: null, detail: [{ label: "Today", text: "70 units" }] });
    if (p === "/v1/account-event") return json(200, { ok: true });
    if (p === "/v1/interest") return json(200, { ok: true, text: "Thanks, noted." });
    json(404, { error: "not found" });
  });
  const port = await listenInRange(server);
  return Object.assign(f, {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections?.();
        server.close(() => done());
      }),
  }) as FakeBilling;
}

export interface FakeModeration {
  url: string;
  port: number;
  calls: Recorded[];
  /** The check-run answer. */
  run: Record<string, unknown>;
  /** The check-output answer. */
  output: Record<string, unknown>;
  down: boolean;
  calls_of: (path: string) => Recorded[];
  close: () => Promise<void>;
}

export async function startFakeModeration(): Promise<FakeModeration> {
  const f: Omit<FakeModeration, "url" | "port" | "close"> = {
    calls: [],
    run: { allowed: true, checkOutputs: false },
    output: { decision: "show" },
    down: false,
    calls_of: (p) => f.calls.filter((c) => c.path.split("?")[0] === p),
  };
  const server = http.createServer(async (req, res) => {
    const raw = await readBody(req);
    const path = req.url ?? "/";
    let body: unknown = null;
    if ((req.headers["content-type"] ?? "").startsWith("application/json")) {
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {}
    }
    f.calls.push({ method: req.method ?? "GET", path, body, headers: req.headers, bytes: raw });
    const json = (status: number, v: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(v));
    };
    if (f.down) return json(503, { error: "down" });
    const p = path.split("?")[0];
    if (p === "/v1/check-run") return json(200, f.run);
    if (p === "/v1/check-output") return json(200, f.output);
    if (p === "/v1/report") return json(200, { ok: true, hidden: false, text: "Report received." });
    json(404, { error: "not found" });
  });
  const port = await listenInRange(server);
  return Object.assign(f, {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections?.();
        server.close(() => done());
      }),
  }) as FakeModeration;
}
