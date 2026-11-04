import http from "node:http";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listenOnFreePort, startFakeBilling, type FakeBilling } from "./helpers/fake-billing";
import { startFakeComfy, type FakeComfy } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

// The billing hook (docs/billing-hook.md) and hosted runs, against a stand-in billing service and a stand-in ComfyUI
// as this install's GPUs. Numbers are arbitrary ("7 units").
const dir = tempDir("fuobe-billing-hook-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ALLOW_PRIVATE_URLS;
delete process.env.FUOBE_HOSTED_RUNS;
delete process.env.FUOBE_BILLING_URL;
delete process.env.FUOBE_MODERATION_URL;
globalThis.__fuobeTestDiskFree = 1e13;

// This install's ComfyUI: a stand-in on a free high port.
const probe = http.createServer();
const comfyPort = await listenOnFreePort(probe);
await new Promise<void>((r) => probe.close(() => r()));
const comfy: FakeComfy = await startFakeComfy({ output: "image", delayMs: 0 }, comfyPort);
process.env.COMFYUI_URL = comfy.url;

const auth = await import("@/server/auth");
const generationsRoute = await import("@/app/api/generations/route");
const { visitorStatus } = await import("@/server/account-gpu");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const billing = await import("@/server/billing");
const outbox = await import("@/server/billing-outbox");
const { hookTarget } = await import("@/server/hook-client");

let fake: FakeBilling;
let a = "";
let cookie = "";
let withGpu = "";
let gpuCookie = "";
beforeAll(async () => {
  fake = await startFakeBilling();
  globalThis.__fuobeTestGpuPort = comfy.port;
  auth.setPassword("install password");
  a = auth.createAccount("billing@example.com", "long enough").id;
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(a).value}`;
  withGpu = auth.createAccount("own-gpu@example.com", "long enough").id;
  auth.setAccountGpu(withGpu, { mode: "link", url: comfy.url } as never);
  gpuCookie = `${auth.SESSION_COOKIE}=${auth.createSession(withGpu).value}`;
});
afterAll(async () => {
  globalThis.__fuobeTestGpuPort = undefined;
  globalThis.__fuobeTestDiskFree = undefined;
  delete process.env.FUOBE_HOSTED_RUNS;
  delete process.env.FUOBE_BILLING_URL;
  delete process.env.FUOBE_BILLING_TOKEN;
  await fake.close();
  await comfy.close();
});

const on = () => {
  process.env.FUOBE_HOSTED_RUNS = "1";
  process.env.FUOBE_BILLING_URL = fake.url;
  process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
};
beforeEach(() => {
  resetRates();
  billing.resetBillingCache();
  fake.calls.length = 0;
  fake.down = false;
  fake.refuse = null;
  fake.price = { amount: 7, version: "v7" };
  on();
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
});

const post = (body: unknown, c = cookie, query = "") => {
  const text = JSON.stringify(body);
  return generationsRoute.POST(
    new Request(`http://localhost:3000/api/generations${query}`, { method: "POST", headers: { cookie: c, host: "localhost:3000", "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }, body: text }),
  );
};
const run = (extra: Record<string, unknown> = {}) => ({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a lighthouse at dusk", ...extra });
const holdOf = (id: string) => (db().prepare("SELECT json_extract(request_json, '$.hold') AS h FROM generations WHERE id = ?").get(id) as { h: string | null }).h;
const statusOf = (id: string) => (db().prepare("SELECT status, error FROM generations WHERE id = ?").get(id) as { status: string; error: string | null });

async function until(fn: () => boolean, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("the billing hook with no service set", () => {
  it("makes no call and prices a run as before; an account with no GPU is refused as today", async () => {
    delete process.env.FUOBE_BILLING_URL;
    delete process.env.FUOBE_HOSTED_RUNS;
    const p = await post(run(), cookie, "?preview=1");
    expect(p.status).toBe(200);
    const body = (await p.json()) as Record<string, unknown>;
    expect(body.quote).toBeUndefined();
    expect(body.place).toBeUndefined();
    const r = await post(run());
    expect(r.status).toBe(403);
    expect(((await r.json()) as { code: string }).code).toBe("connect-gpu");
    expect(fake.calls).toEqual([]);
    expect(await billing.policy(a)).toBe(billing.OPEN_POLICY);
    expect(await billing.reserve({ requestId: "r", account: billing.accountFacts({ id: a, email: "x@example.com", createdAt: 1 }), run: {} as never, queue: null, shown: { amount: 0, priceVersion: "" } })).toBeNull();
  });

  it("with hosted runs on and no billing service, they stay closed unless they are free for everyone", async () => {
    delete process.env.FUOBE_BILLING_URL;
    const closed = await post(run());
    expect(closed.status).toBe(403);
    expect(((await closed.json()) as { code: string }).code).toBe("connect-gpu");
    expect(fake.calls).toEqual([]);
  });

  it("with hosted runs on, no billing service and FUOBE_HOSTED_FREE=1, a run on this install's GPUs is free, with no hold", async () => {
    delete process.env.FUOBE_BILLING_URL;
    process.env.FUOBE_HOSTED_FREE = "1";
    try {
      const r = await post(run());
      expect(r.status).toBe(201);
      const { items } = (await r.json()) as { items: { id: string; place?: string }[] };
      expect(items[0].place).toBe("pool");
      expect(holdOf(items[0].id)).toBeNull();
      await until(() => statusOf(items[0].id).status !== "queued" && statusOf(items[0].id).status !== "running");
      expect(statusOf(items[0].id).status).toBe("succeeded");
      expect(fake.calls).toEqual([]);
    } finally {
      delete process.env.FUOBE_HOSTED_FREE;
    }
  });
});

describe("the billing hook with a service", () => {
  it("shows the quote's words before Run", async () => {
    const p = await post(run(), cookie, "?preview=1");
    const body = (await p.json()) as { place: string; quote: { text: string; amount: number; priceVersion: string } };
    expect(body.place).toBe("pool");
    expect(body.quote).toMatchObject({ text: "7 units", amount: 7, priceVersion: "v7" });
    expect(fake.calls_of("/v1/quote")).toHaveLength(1);
    // A guest sees the price too.
    const g = await generationsRoute.POST(new Request("http://localhost:3000/api/generations?preview=1", { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify(run()) }));
    expect(((await g.json()) as { quote: { text: string } }).quote.text).toBe("7 units");
  });

  it("reserves before the rows are made, and every row of the run carries the hold; the browser never sees it", async () => {
    const r = await post({ ...run({ params: { numOutputs: 2 } }), shown: { amount: 7, priceVersion: "v7" } });
    expect(r.status).toBe(201);
    const { items } = (await r.json()) as { items: { id: string; request: Record<string, unknown> }[] };
    expect(items.length).toBe(2);
    const reserve = fake.calls_of("/v1/reserve");
    expect(reserve).toHaveLength(1);
    const hold = [...fake.holds.keys()].at(-1)!;
    for (const g of items) {
      expect(holdOf(g.id)).toBe(hold);
      expect(g.request.hold).toBeUndefined();
    }
    const sent = reserve[0].body as { run: { place: string; model: string; jobs: number }; shown: { amount: number }; account: { id: string } };
    expect(sent.run).toMatchObject({ place: "pool", model: "oss-z-image-turbo" });
    expect(sent.shown.amount).toBe(7);
    expect(sent.account.id).toBe(a);
    // Both rows settle, each once, with rows = 2.
    await until(() => items.every((g) => fake.reportCount(hold, g.id) === 1));
    const settles = fake.calls_of("/v1/settle").filter((c) => (c.body as { holdId: string }).holdId === hold);
    expect(settles.map((c) => (c.body as { rows: number }).rows)).toEqual([2, 2]);
    expect(items.every((g) => statusOf(g.id).status === "succeeded")).toBe(true);
  });

  it("prices and sets aside only what runs: the service's outputs-per-run limit applies before the quote and the reserve", async () => {
    const p = await post(run({ params: { numOutputs: 4 } }), cookie, "?preview=1");
    expect(((await p.json()) as { outputs: number }).outputs).toBe(2);
    expect((fake.calls_of("/v1/quote").at(-1)!.body as { run: { jobs: number } }).run.jobs).toBe(2);
    const r = await post({ ...run({ params: { numOutputs: 4 } }), shown: { amount: 7, priceVersion: "v7" } });
    expect(r.status).toBe(201);
    expect(((await r.json()) as { items: unknown[] }).items).toHaveLength(2);
    expect((fake.calls_of("/v1/reserve").at(-1)!.body as { run: { jobs: number } }).run.jobs).toBe(2);
  });

  it("never takes the hold, the account or the place's stamp from the client", async () => {
    const other = auth.createAccount("other@example.com", "long enough").id;
    const r = await post({ ...run(), hold: "h_evil", account: other, charge: "free", checkOutputs: false, waitMs: 1, shown: { amount: 7, priceVersion: "v7" } });
    expect(r.status).toBe(201);
    const { items } = (await r.json()) as { items: { id: string }[] };
    const stored = JSON.parse((db().prepare("SELECT request_json FROM generations WHERE id = ?").get(items[0].id) as { request_json: string }).request_json) as Record<string, unknown>;
    expect(stored.hold).not.toBe("h_evil");
    expect(fake.holds.has(stored.hold as string)).toBe(true);
    expect(stored.account).toBe(a);
    expect(stored.charge).toBe("7 units");
    expect(stored.waitMs).toBe(700_000);
  });

  it("a higher price at reserve: 409 with the new price, and nothing is made", async () => {
    fake.price = { amount: 9, version: "v9" };
    const before = (db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n;
    const r = await post({ ...run(), shown: { amount: 7, priceVersion: "v7" } });
    expect(r.status).toBe(409);
    expect(r.headers.get("x-fuobe-billing")).toBe("price-changed");
    const body = (await r.json()) as { error: string; code: string; quote: { text: string } };
    expect(body.code).toBe("price-changed");
    expect(body.quote.text).toBe("9 units");
    expect((db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n).toBe(before);
  });

  it("maps each refusal to its status and header", async () => {
    const cases: [string, number][] = [
      ["top-up", 402],
      ["limit", 429],
      ["busy", 503],
      ["not-offered", 403],
      ["closed", 403],
    ];
    for (const [code, status] of cases) {
      resetRates();
      fake.refuse = { code, text: `refused: ${code}` };
      const r = await post({ ...run(), shown: { amount: 7, priceVersion: "v7" } });
      expect(r.status).toBe(status);
      expect(r.headers.get("x-fuobe-billing")).toBe(code);
      expect(((await r.json()) as { error: string }).error).toBe(`refused: ${code}`);
    }
  });

  it("service down: runs on this install's GPUs are refused in plain words with no word of a pause, and a run on the account's own GPU still goes", async () => {
    fake.down = "error";
    const r = await post({ ...run(), shown: { amount: 7, priceVersion: "v7" } });
    expect(r.status).toBe(503);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe(billing.BILLING_WAIT.run);
    expect(body.error).not.toMatch(/paus/i);
    expect(JSON.stringify(body)).not.toContain(String(fake.port));
    const p = await post(run(), cookie, "?preview=1");
    expect(((await p.json()) as { quote: unknown }).quote).toMatchObject({ allowed: false, code: "paused", text: billing.BILLING_WAIT.quote });
    // Its own GPU online: its own GPU is the place, and the billing service is never asked.
    fake.calls.length = 0;
    const own = await post(run(), gpuCookie);
    expect(own.status).toBe(201);
    const { items } = (await own.json()) as { items: { id: string; place?: string }[] };
    expect(items[0].place).toBeUndefined();
    expect(holdOf(items[0].id)).toBeNull();
    expect(fake.calls.filter((c) => c.path.startsWith("/v1/reserve") || c.path.startsWith("/v1/quote"))).toEqual([]);
  });

  it("an account with its own GPU online can still ask for this install's GPUs", async () => {
    const r = await post({ ...run(), place: "pool", shown: { amount: 7, priceVersion: "v7" } }, gpuCookie);
    expect(r.status).toBe(201);
    const { items } = (await r.json()) as { items: { id: string; place?: string }[] };
    expect(items[0].place).toBe("pool");
    expect(holdOf(items[0].id)).not.toBeNull();
  });

  it("the status shows the balance and that hosted runs are open", async () => {
    const body = await visitorStatus(auth.accountById(a)!);
    expect(body.viewer.hosted).toBe(true);
    expect(body.viewer.balance?.chip).toBe("70 units");
  });
});

describe("the outbox", () => {
  const insertRow = (status: string, hold: string, opts: { error?: string } = {}) => {
    const id = `t${Math.random().toString(36).slice(2, 12)}`;
    const now = Date.now();
    db()
      .prepare(
        "INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, error, favorite, created_at, updated_at, completed_at) VALUES (?, 'image', 'oss-z-image-turbo', 'open', 'comfyui', 't2i', 'image', ?, ?, '[]', ?, 0, ?, ?, ?)",
      )
      .run(id, status, JSON.stringify({ feature: "image", modelId: "oss-z-image-turbo", account: a, place: "pool", hold }), opts.error ?? null, now, now, status === "running" ? null : now);
    return id;
  };
  const newHold = () => {
    const id = `h_t${Math.random().toString(36).slice(2, 8)}`;
    fake.holds.set(id, { amount: 7, requestId: id, reports: new Map(), released: false });
    return id;
  };

  it("a restart between a row's success and its report: exactly one report per row", async () => {
    const hold = newHold();
    const g = insertRow("succeeded", hold);
    // Nothing was written before the "crash"; the sweep finds it from what is stored, however often it runs.
    outbox.queueReports();
    outbox.queueReports();
    await outbox.drainOutbox();
    await outbox.drainOutbox();
    await outbox.sweepBilling();
    expect(fake.reportCount(hold, g)).toBe(1);
    expect((db().prepare("SELECT COUNT(*) AS n FROM billing_outbox WHERE key = ?").get(g) as { n: number }).n).toBe(1);
  });

  it("a failed row is refunded within one sweep", async () => {
    const hold = newHold();
    const g = insertRow("failed", hold, { error: "The GPU stopped" });
    await outbox.sweepBilling();
    expect(fake.holds.get(hold)!.reports.get(g)).toBe("failed");
    const refund = fake.calls_of("/v1/refund").find((c) => (c.body as { generationId: string }).generationId === g)!.body as { rows: number; reason: string };
    expect(refund).toMatchObject({ rows: 1, reason: "The GPU stopped" });
  });

  it("waits until every row of a hold is finished, then reports each with the row count", async () => {
    const hold = newHold();
    const one = insertRow("succeeded", hold);
    const two = insertRow("running", hold);
    outbox.queueReports();
    expect((db().prepare("SELECT COUNT(*) AS n FROM billing_outbox WHERE hold_id = ?").get(hold) as { n: number }).n).toBe(0);
    db().prepare("UPDATE generations SET status = 'canceled', completed_at = ? WHERE id = ?").run(Date.now(), two);
    await outbox.sweepBilling();
    expect(fake.holds.get(hold)!.reports.get(one)).toBe("succeeded");
    expect(fake.holds.get(hold)!.reports.get(two)).toBe("canceled");
  });

  it("keeps reports while the service is down and sends them when it is back", async () => {
    const hold = newHold();
    const g = insertRow("failed", hold);
    fake.down = "error";
    await outbox.sweepBilling();
    const row = db().prepare("SELECT tries, next_at, done_at FROM billing_outbox WHERE key = ?").get(g) as { tries: number; next_at: number; done_at: number | null };
    expect(row.tries).toBe(1);
    expect(row.done_at).toBeNull();
    expect(row.next_at).toBeGreaterThan(Date.now() + 5_000);
    fake.down = false;
    // Not before its time, then sent.
    expect(await outbox.drainOutbox()).toBe(0);
    expect(await outbox.drainOutbox(Date.now() + 11_000)).toBeGreaterThanOrEqual(1);
    expect(fake.reportCount(hold, g)).toBe(1);
  });

  it("a release goes out once", async () => {
    const hold = newHold();
    outbox.queueRelease(hold);
    outbox.queueRelease(hold);
    await until(() => fake.holds.get(hold)!.released);
    expect(fake.calls_of("/v1/release").filter((c) => (c.body as { holdId: string }).holdId === hold)).toHaveLength(1);
  });
});

describe("account events", () => {
  it("a deleted account is reported to the service", async () => {
    const { removeAccount } = await import("@/server/account-sweep");
    const gone = auth.createAccount("leaving@example.com", "long enough").id;
    await removeAccount(gone);
    await until(() => fake.calls_of("/v1/account-event").some((c) => (c.body as { event: string; account: { id: string } }).account.id === gone));
    const ev = fake.calls_of("/v1/account-event").find((c) => (c.body as { account: { id: string } }).account.id === gone)!.body as { event: string; account: { email: string } };
    expect(ev).toMatchObject({ event: "deleted", account: { email: "leaving@example.com" } });
  });
});

describe("the transport", () => {
  it("reads https, http and unix: addresses, and nothing else", () => {
    expect(hookTarget("https://billing.example.com/base")).toMatchObject({ kind: "url" });
    expect(hookTarget("unix:/path/to/billing.sock")).toEqual({ kind: "socket", path: "/path/to/billing.sock" });
    expect(hookTarget("unix:///path/to/billing.sock")).toEqual({ kind: "socket", path: "/path/to/billing.sock" });
    expect(hookTarget("ftp://billing.example.com")).toBeNull();
    expect(hookTarget("")).toBeNull();
  });

  it("talks to a service on a local socket", async () => {
    const sock = process.platform === "win32" ? `\\\\.\\pipe\\fuobe-billing-test-${process.pid}` : path.join(dir, "billing.sock");
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ...JSON.parse(JSON.stringify(fake.policy)), links: [{ label: "Help", url: "https://example.com/help" }], seen: req.headers.authorization }));
    });
    await new Promise<void>((r) => server.listen(sock, r));
    try {
      process.env.FUOBE_BILLING_URL = `unix:${sock}`;
      billing.resetBillingCache();
      const p = (await billing.policy(a)) as unknown as { links: unknown[]; seen: string };
      expect(p.links).toHaveLength(1);
      expect(p.seen).toBe("Bearer test-billing-token");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("gives up on a service that doesn't answer within the call's time", async () => {
    fake.down = "hang";
    const t = Date.now();
    const q = await billing.quote(null, {} as never, null);
    expect(q.code).toBe("paused");
    expect(Date.now() - t).toBeLessThan(billing.BILLING_TIMEOUTS.quote + 1500);
  });
});
