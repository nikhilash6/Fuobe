import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { placeOf } from "@/lib/place-name";
import { startFakeBilling, FAKE_POLICY, type FakeBilling } from "./helpers/fake-billing";
import { tempDir } from "./helpers/temp-dir";

/**
 * Limits on runs on this install's GPUs: the policy's runs at once, runs waiting, runs an hour and runs from one address
 * an hour count those runs only, together with making the run's rows (requests that arrive together never pass them
 * together); runs on an account's own GPU keep the studio's own limits. Also where a run goes: the policy's default
 * place, an own GPU that doesn't answer (asked, never moved), the kinds a policy allows, a guest's policy, every step of
 * a chain checked and priced once, and the real size of a picture in its price facts.
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 60_000 });

const dir = tempDir("fuobe-pool-limits-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:7";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_HOSTED_RUNS;
delete process.env.FUOBE_HOSTED_FREE;
delete process.env.FUOBE_BILLING_URL;
delete process.env.FUOBE_MODERATION_URL;
delete process.env.FUOBE_TRUST_PROXY;
globalThis.__fuobeTestDiskFree = 1e13;

const realFetch = globalThis.fetch;
let allowed: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (allowed.some((a) => url.startsWith(a))) return realFetch(input, init);
  return new Response("not reachable in this test", { status: 599 });
}) as typeof fetch;

const auth = await import("@/server/auth");
const generationsRoute = await import("@/app/api/generations/route");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const tasks = await import("@/server/computer/tasks");
const pool = await import("@/server/computer/pool");
const { catalogVersion } = await import("@/server/computer/catalog-version");
const billing = await import("@/server/billing");
const hostedRun = await import("@/server/hosted-run");
const limits = await import("@/server/pool-limits");
const { visitorStatus } = await import("@/server/account-gpu");
const { loadManifest } = await import("@/server/providers/comfyui");
const { loadIndex } = await import("@/server/gpu/index-file");
const { allLanes } = await import("@/lib/lanes");
const { getModel } = await import("@/lib/catalog");
const { CONNECT_GPU_HEADER, PLACE_ASK_HEADER } = await import("@/lib/guest-access");
const hosted = await import("@/server/hosted");
const { getGeneration } = await import("@/server/generations");
const { ACCOUNT_MESSAGES } = await import("@/server/account-files");

const HOST = "localhost:3000";
const SITE_HEADERS = { host: HOST, "sec-fetch-site": "same-origin", origin: `http://${HOST}` };
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const IMAGE = { feature: "image", modelId: "oss-z-image-turbo", prompt: "a lighthouse" };

let fake: FakeBilling;
let n = 0;
/** The stand-in worker of the test that runs. */
let worker: { id: string };

/** A new account and its cookie (each test gets its own, so counts never carry over). */
function account(o: { gpu?: "online" | "offline" } = {}) {
  const a = auth.createAccount(`limits-${++n}@example.com`, "long enough");
  if (o.gpu) {
    auth.setAccountGpu(a.id, { mode: "computer" });
    if (o.gpu === "online") tasks.beat(`acct:${a.id}`, { device: `device-${n}`, takeover: true, facts: { vramBytes: 24 * 2 ** 30 } });
  }
  return { id: a.id, cookie: `${auth.SESSION_COOKIE}=${auth.createSession(a.id).value}` };
}

const post = async (body: Record<string, unknown>, cookie: string, headers: Record<string, string> = {}) => {
  const text = JSON.stringify(body);
  const r = await generationsRoute.POST(
    new Request(`http://${HOST}/api/generations`, { method: "POST", headers: { ...SITE_HEADERS, cookie, "content-type": "application/json", "content-length": String(Buffer.byteLength(text)), ...headers }, body: text }),
  );
  return { status: r.status, headers: r.headers, body: (await r.json()) as { items?: { id: string; place?: string }[]; code?: string; error?: string } };
};

/** Wait (up to 5 s) until `ok` holds: work the route left running in the background has landed. */
async function waitFor(ok: () => boolean): Promise<void> {
  const end = Date.now() + 5000;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Runs on this install's GPUs an account has made. */
const poolRuns = (id: string) =>
  (db().prepare("SELECT COUNT(DISTINCT COALESCE(batch_id, id)) AS n FROM generations WHERE json_extract(request_json, '$.account') = ? AND json_extract(request_json, '$.place') = 'pool'").get(id) as { n: number }).n;
const ownRuns = (id: string) =>
  (db().prepare("SELECT COUNT(*) AS n FROM generations WHERE json_extract(request_json, '$.account') = ? AND json_extract(request_json, '$.place') IS NULL").get(id) as { n: number }).n;

/** A worker as the owner adds it, connected once: it said its build (one that takes this studio's job tickets). */
function standInWorker() {
  const w = pool.addWorker(`stand-in-${++n}`);
  const lanes = allLanes(loadIndex(), sha);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: Object.fromEntries(lanes.map((l) => [l.lane, { delayMs: 0 }])), claimAfterMs: 0 });
  db()
    .prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ?, catalog_version = ?, protocol = 3 WHERE id = ?")
    .run(JSON.stringify({ lanes: lanes.map((l) => l.lane), workflows: loadManifest().workflows.map((x) => x.id) }), JSON.stringify({ vramBytes: 96 * 2 ** 30 }), catalogVersion(), w.id);
  // Connected: its worker program beat a moment ago.
  db().prepare("UPDATE relay_workers SET seen_at = ?, paused_local = 0 WHERE id = ?").run(Date.now(), w.id);
  return w;
}

/** A worker's beat, as its program sends it, built for this catalog version. */
function beatWith(w: { id: string }, version: string | null) {
  const row = db().prepare("SELECT * FROM relay_workers WHERE id = ?").get(w.id) as import("@/server/computer/workers").WorkerRow;
  pool.workerBeat(row, pool.cleanBeat({ device: `wkr-${w.id}`, protocol: 3, version: "1", local: { paused: false, why: null, until: null }, gpu: {}, inventoryHash: null, running: [], stopped: [], catalogVersion: version }));
}

const withBilling = (policy: Record<string, unknown> = {}) => {
  process.env.FUOBE_BILLING_URL = fake.url;
  process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
  fake.policy = { ...FAKE_POLICY, ...policy, limits: { ...FAKE_POLICY.limits, outputsPerRun: 4, ...((policy.limits as object) ?? {}) }, ttlS: 0 };
  billing.resetBillingCache();
};

beforeAll(async () => {
  fake = await startFakeBilling();
  allowed = [fake.url];
  auth.setPassword("install password");
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  globalThis.__fuobeTestDiskFree = undefined;
  for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_HOSTED_FREE", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN", "FUOBE_TRUST_PROXY"]) delete process.env[k];
  await fake.close();
});
beforeEach(() => {
  resetRates();
  billing.resetBillingCache();
  process.env.FUOBE_HOSTED_RUNS = "1";
  process.env.FUOBE_HOSTED_FREE = "1";
  delete process.env.FUOBE_BILLING_URL;
  delete process.env.FUOBE_BILLING_TOKEN;
  delete process.env.FUOBE_TRUST_PROXY;
  fake.policy = { ...FAKE_POLICY };
  fake.guestPolicy = null;
  fake.price = { amount: 7, version: "v7" };
  setSetting("comfyWhere", "workers");
  setSetting("comfyUrl", "");
  setSetting("engineMode", "open");
  setSetting("demoMode", "off");
  db().prepare("DELETE FROM relay_workers").run();
  // Nothing of an earlier test waits in line.
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
  worker = standInWorker();
});

const tick = () => globalThis.__fuobeRunner?.tick();
async function until<T>(fn: () => T | Promise<T>, tries = 200, everyMs = 25): Promise<T> {
  let v = await fn();
  for (let i = 0; i < tries && !v; i++) {
    await tick();
    await new Promise((r) => setTimeout(r, everyMs));
    v = await fn();
  }
  return v;
}
const taskOf = (generationId: string) => db().prepare("SELECT * FROM relay_tasks WHERE generation_id = ? ORDER BY created_at DESC").get(generationId) as { id: string; state: string } | undefined;
const workerRow = () => db().prepare("SELECT * FROM relay_workers WHERE id = ?").get(worker.id) as import("@/server/computer/workers").WorkerRow;
/** The stand-in worker takes the next task in line, as the worker program does. */
function workerTakes() {
  pool.workerBeat(workerRow(), pool.cleanBeat({ device: `wkr-${worker.id}`, protocol: 3, version: "1", local: { paused: false, why: null, until: null }, gpu: {}, inventoryHash: null, running: [], stopped: [], catalogVersion: catalogVersion() }));
  return pool.workerClaim(workerRow(), [], Date.now());
}
const started = (generationId: string) => !!(db().prepare("SELECT started_at FROM generation_runs WHERE id = ?").get(generationId) as { started_at: number | null } | undefined)?.started_at;
const preview = async (body: Record<string, unknown>, cookie: string) => {
  const text = JSON.stringify(body);
  const r = await generationsRoute.POST(new Request(`http://${HOST}/api/generations?preview=1`, { method: "POST", headers: { ...SITE_HEADERS, cookie, "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }, body: text }));
  return { status: r.status, body: (await r.json()) as { place?: string; quote?: { amount: number } } };
};

const SHOWN = { shown: { amount: 7, priceVersion: "v7" } };

describe("runs at once on this install's GPUs", () => {
  it("10 requests sent together against a limit of 2 make exactly 2 runs, and every other hold goes back", async () => {
    withBilling({ limits: { activeRuns: 2, waiting: 0, runsPerHour: 0 } });
    const a = account();
    const before = fake.holds.size;
    const answers = await Promise.all(Array.from({ length: 10 }, () => post({ ...IMAGE, ...SHOWN }, a.cookie)));
    const made = answers.filter((r) => r.status === 201);
    expect(made.length, JSON.stringify(answers.map((r) => [r.status, r.body.error]))).toBe(2);
    expect(poolRuns(a.id)).toBe(2);
    for (const r of answers.filter((x) => x.status !== 201)) {
      expect(r.status).toBe(429);
      expect(r.body.code).toBe("active-runs");
      expect(r.body.error).toBe(limits.POOL_LIMIT_WORDS.active(2));
    }
    // Each request that got a hold and made nothing gives it back (an outbox release).
    const holds = fake.holds.size - before;
    const releases = (db().prepare("SELECT COUNT(*) AS n FROM billing_outbox WHERE kind = 'release'").get() as { n: number }).n;
    expect(holds - 2).toBe(releases);
  });

  it("the count and the rows are one transaction: a second count inside it sees the first run", () => {
    const a = account();
    const p = { limits: { activeRuns: 1, waiting: 0, runsPerHour: 0, outputsPerRun: 0, maxMegapixels: 0, maxSeconds: 0, keepDays: 0, spaceBytes: 0 } };
    const insert = () =>
      db()
        .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'queued', ?, '[]', ?, ?)")
        .run(`tx-${++n}`, JSON.stringify({ account: a.id, place: "pool" }), Date.now(), Date.now());
    const first = limits.admitRun({ accountId: a.id, pool: { policy: p, addr: null } }, insert);
    expect(first.ok).toBe(true);
    const second = limits.admitRun({ accountId: a.id, pool: { policy: p, addr: null } }, insert);
    expect(second.ok).toBe(false);
    // A refusal thrown inside keeps nothing it wrote.
    const p2 = { ...p, limits: { ...p.limits, activeRuns: 5 } };
    const r = limits.admitRun({ accountId: a.id, pool: { policy: p2, addr: null } }, () => {
      insert();
      throw new limits.AdmitRefused({ status: 403, error: "no", code: "not-offered" });
    });
    expect(r.ok).toBe(false);
    expect(poolRuns(a.id)).toBe(1);
  });

  it("a run not made is noted in the same transaction: a limit, a refusal from inside, or an error, which is thrown again", () => {
    const a = account();
    const p = { limits: { activeRuns: 1, waiting: 0, runsPerHour: 0, outputsPerRun: 0, maxMegapixels: 0, maxSeconds: 0, keepDays: 0, spaceBytes: 0 } };
    const insert = () =>
      db()
        .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'queued', ?, '[]', ?, ?)")
        .run(`tx-${++n}`, JSON.stringify({ account: a.id, place: "pool" }), Date.now(), Date.now());
    const noted: string[] = [];
    const note = (why: { error: string } | Error) => {
      noted.push(why instanceof Error ? `error: ${why.message}` : why.error);
      db().prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(`test.noted.${a.id}.${noted.length}`, "1");
    };
    const kept = () => (db().prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE ?").get(`test.noted.${a.id}.%`) as { n: number }).n;
    // A refusal from inside: nothing make wrote is kept, the note is.
    const r = limits.admitRun({ accountId: a.id, pool: { policy: p, addr: null }, refused: note }, () => {
      insert();
      throw new limits.AdmitRefused({ status: 403, error: "no", code: "not-offered" });
    });
    expect(r.ok).toBe(false);
    expect(poolRuns(a.id)).toBe(0);
    // An error: thrown again once the note is kept.
    expect(() =>
      limits.admitRun({ accountId: a.id, pool: { policy: p, addr: null }, refused: note }, () => {
        insert();
        throw new Error("rows failed");
      }),
    ).toThrow("rows failed");
    expect(poolRuns(a.id)).toBe(0);
    // A limit.
    expect(limits.admitRun({ accountId: a.id, pool: { policy: p, addr: null }, refused: note }, insert).ok).toBe(true);
    expect(limits.admitRun({ accountId: a.id, pool: { policy: p, addr: null }, refused: note }, insert).ok).toBe(false);
    expect(poolRuns(a.id)).toBe(1);
    expect(noted).toEqual(["no", "error: rows failed", limits.POOL_LIMIT_WORDS.active(1)]);
    expect(kept()).toBe(3);
  });

  it("runs on the account's own GPU never count against the policy, and keep the studio's own limit of 4 (counting runs there only)", async () => {
    withBilling({ limits: { activeRuns: 1, waiting: 0, runsPerHour: 0 } });
    const a = account({ gpu: "online" });
    for (let i = 0; i < 3; i++) {
      const r = await post(IMAGE, a.cookie);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.items![0].place).toBeUndefined();
    }
    expect(ownRuns(a.id)).toBe(3);
    // One on this install's GPUs still fits its policy's 1.
    const pooled = await post({ ...IMAGE, place: "pool", ...SHOWN }, a.cookie);
    expect(pooled.status, JSON.stringify(pooled.body)).toBe(201);
    expect(poolRuns(a.id)).toBe(1);
    // The studio's own 4 counts the runs on its own GPU or key only while hosted runs are on: a fourth there is made,
    // a fifth is refused in today's words.
    const fourth = await post(IMAGE, a.cookie);
    expect(fourth.status, JSON.stringify(fourth.body)).toBe(201);
    expect(limits.ownActiveRuns(a.id)).toBe(4);
    expect(limits.accountActiveRuns(a.id)).toBe(5);
    const fifth = await post(IMAGE, a.cookie);
    expect(fifth.status).toBe(429);
    expect(fifth.body.error).toBe(ACCOUNT_MESSAGES.activeRuns);
  });

  it("a press of Run is kept only for a run on this install's GPUs: on the account's own GPU each send makes its run, as before", async () => {
    withBilling({ limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    const a = account({ gpu: "online" });
    const kept = () => (db().prepare("SELECT COUNT(*) AS n FROM run_requests WHERE account = ?").get(a.id) as { n: number }).n;
    const own = { ...IMAGE, requestId: `own-${crypto.randomUUID()}` };
    const first = await post(own, a.cookie);
    const again = await post(own, a.cookie);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(first.body.items![0].place).toBeUndefined();
    expect(again.body.items![0].id).not.toBe(first.body.items![0].id);
    expect(kept()).toBe(0);
    // The same account's press on this install's GPUs is made once, however often it is sent.
    const pool = { ...IMAGE, place: "pool", ...SHOWN, requestId: `pool-${crypto.randomUUID()}` };
    const one = await post(pool, a.cookie);
    const two = await post(pool, a.cookie);
    expect(one.status, JSON.stringify(one.body)).toBe(201);
    expect(two.body.items!.map((g) => g.id)).toEqual(one.body.items!.map((g) => g.id));
    expect(kept()).toBe(1);
  });

  it("with a free install (no billing service) the policy's limits apply to runs there too", async () => {
    const a = account();
    const p = await billing.policy(a.id);
    expect(p).toBe(billing.OPEN_POLICY);
    // Lower than the studio's own limits, so only the policy's own count can stop these runs.
    const was = { ...billing.OPEN_POLICY.limits };
    try {
      billing.OPEN_POLICY.limits.activeRuns = 1;
      expect((await post(IMAGE, a.cookie)).status).toBe(201);
      const second = await post(IMAGE, a.cookie);
      expect(second.status).toBe(429);
      expect(second.body.error).toBe(limits.POOL_LIMIT_WORDS.active(1));
      expect(second.body.error).not.toBe(ACCOUNT_MESSAGES.activeRuns);
      billing.OPEN_POLICY.limits.activeRuns = 0;
      billing.OPEN_POLICY.limits.runsPerHour = 2;
      expect((await post(IMAGE, a.cookie)).status).toBe(201);
      const third = await post(IMAGE, a.cookie);
      expect(third.status).toBe(429);
      expect(third.body.code).toBe("limit");
      expect(third.body.error).toMatch(/^Lots of people are creating on Fuobe right now, so free runs are shared out — yours refresh in about \d+ min\.$/);
      expect(third.body).toMatchObject({ limit: "free-hour", refreshAt: expect.any(Number) });
    } finally {
      Object.assign(billing.OPEN_POLICY.limits, was);
    }
    expect(poolRuns(a.id)).toBe(2);
  });
});

describe("light work on this install's GPUs (joins, trims, a Ken Burns move)", () => {
  /** An account's picture, uploaded as its own. */
  async function picture(cookie: string) {
    const { TINY_PNG } = await import("./helpers/fake-comfy-runner");
    const uploadsRoute = await import("@/app/api/uploads/route");
    const up = await uploadsRoute.POST(
      new Request(`http://${HOST}/api/uploads`, { method: "POST", headers: { ...SITE_HEADERS, cookie, "content-type": "image/png", "x-file-name": "still.png", "content-length": String(TINY_PNG.length) }, body: new Uint8Array(TINY_PNG) }),
    );
    expect(up.status).toBe(201);
    return ((await up.json()) as { url: string }).url;
  }
  const kenBurns = (url: string) => ({ feature: "video", modelId: "oss-ken-burns", op: "still-motion", inputs: { images: [url] }, params: { duration: 4 } });

  it("is free and never counted: no price asked, nothing set aside, and the policy's limits count only GPU runs", async () => {
    withBilling({ limits: { activeRuns: 1, waiting: 0, runsPerHour: 1 } });
    const a = account();
    const url = await picture(a.cookie);
    expect(hostedRun.lightRun(hostedRun.poolSteps(a.id, kenBurns(url) as never))).toBe(true);
    expect(hostedRun.lightRun(hostedRun.poolSteps(a.id, IMAGE as never))).toBe(false);
    // RTX Video's nodes run on the card, model file or not: GPU work, priced and counted.
    const step = (modelId: string, op: string) => ({ id: "s0", modelId, op, provider: "comfyui", kind: "video", presetId: null, waits: false });
    const rtx = getModel("oss-rtx-video-upscale")!.routes.find((x) => x.provider === "comfyui")!;
    expect(hostedRun.lightRun([step("oss-rtx-video-upscale", rtx.op)])).toBe(false);
    expect(hostedRun.pricedSteps([step("oss-rtx-video-upscale", rtx.op)])).toHaveLength(1);
    expect(hostedRun.pricedSteps([step("oss-ken-burns", "still-motion")])).toEqual([]);
    // The price check before Run: free, with its place in line, and the billing service isn't asked.
    const quotes = fake.calls_of("/v1/quote").length;
    const check = (await preview(kenBurns(url), a.cookie)).body as { place?: string; quote?: { allowed: boolean; amount: number; text: string } };
    expect(check.place).toBe("pool");
    expect(check.quote).toMatchObject({ allowed: true, amount: 0, text: "" });
    expect(fake.calls_of("/v1/quote").length).toBe(quotes);
    // Two of them go in line together, with no hold, past a limit of one run at once and one an hour.
    const holds = fake.holds.size;
    const reserves = fake.calls_of("/v1/reserve").length;
    for (let i = 0; i < 2; i++) {
      const r = await post(kenBurns(url), a.cookie);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.items![0].place).toBe("pool");
      // What the page gets back never says so.
      expect((r.body.items![0] as { request?: Record<string, unknown> }).request?.light).toBeUndefined();
    }
    expect(fake.calls_of("/v1/reserve").length).toBe(reserves);
    expect(fake.holds.size).toBe(holds);
    expect(limits.poolRunCounts(a.id)).toEqual({ active: 0, waiting: 0 });
    // A GPU run still has its place: they took none of its limits.
    const gpu = await post({ ...IMAGE, ...SHOWN }, a.cookie);
    expect(gpu.status, JSON.stringify(gpu.body)).toBe(201);
    expect(limits.poolRunCounts(a.id)).toEqual({ active: 1, waiting: 1 });
    // And the next GPU run meets them.
    const over = await post({ ...IMAGE, ...SHOWN }, a.cookie);
    expect(over.status).toBe(429);
  });
});

describe("runs waiting, runs an hour, runs from one address", () => {
  it("a run that hasn't started counts as waiting", async () => {
    withBilling({ limits: { activeRuns: 5, waiting: 1, runsPerHour: 0 } });
    const a = account();
    expect((await post({ ...IMAGE, ...SHOWN }, a.cookie)).status).toBe(201);
    const second = await post({ ...IMAGE, ...SHOWN }, a.cookie);
    expect(second.status).toBe(429);
    expect(second.body.error).toBe(limits.POOL_LIMIT_WORDS.waiting(1));
    // Once a worker has taken it (its run has started), the next one may wait.
    const id = (db().prepare("SELECT id FROM generations WHERE json_extract(request_json, '$.account') = ?").get(a.id) as { id: string }).id;
    const t = await until(() => taskOf(id));
    expect(workerTakes()?.id).toBe(t!.id);
    expect(await until(() => started(id))).toBe(true);
    expect((await post({ ...IMAGE, ...SHOWN }, a.cookie)).status).toBe(201);
  });

  it("runs an hour are counted in the database, one per press of Run, with a time to try again", async () => {
    withBilling({ limits: { activeRuns: 0, waiting: 0, runsPerHour: 2 } });
    const a = account();
    expect((await post({ ...IMAGE, ...SHOWN }, a.cookie)).status).toBe(201);
    expect((await post({ ...IMAGE, ...SHOWN }, a.cookie)).status).toBe(201);
    const third = await post({ ...IMAGE, ...SHOWN }, a.cookie);
    expect(third.status).toBe(429);
    expect(third.body.code).toBe("limit");
    expect(Number(third.headers.get("retry-after"))).toBeGreaterThan(3000);
    expect((db().prepare("SELECT COUNT(*) AS n FROM pool_admissions WHERE account = ?").get(a.id) as { n: number }).n).toBe(2);
    // A restart (new in-memory counts) changes nothing.
    resetRates();
    expect((await post({ ...IMAGE, ...SHOWN }, a.cookie)).status).toBe(429);
  });

  it("runs from one client address an hour, across accounts, only behind a trusted proxy, kept as a hash", async () => {
    withBilling({ limits: { activeRuns: 0, waiting: 0, runsPerHour: 0, addressRunsPerHour: 2 } });
    const from = { "x-forwarded-for": "203.0.113.9" };
    const a = account();
    const b = account();
    // No trusted proxy: clients can't be told apart, so no address count.
    expect((await post({ ...IMAGE, ...SHOWN }, a.cookie, from)).status).toBe(201);
    process.env.FUOBE_TRUST_PROXY = "1";
    expect((await post({ ...IMAGE, ...SHOWN }, a.cookie, from)).status).toBe(201);
    expect((await post({ ...IMAGE, ...SHOWN }, b.cookie, from)).status).toBe(201);
    const third = await post({ ...IMAGE, ...SHOWN }, b.cookie, from);
    expect(third.status).toBe(429);
    expect(third.body.error).toMatch(/^Lots of people on your network are creating right now, so free runs are shared out — yours refresh in about \d+ min\.$/);
    expect((await post({ ...IMAGE, ...SHOWN }, b.cookie, { "x-forwarded-for": "198.51.100.4" })).status).toBe(201);
    const kept = db().prepare("SELECT addr FROM pool_admissions WHERE addr IS NOT NULL").all() as { addr: string }[];
    expect(kept.length).toBeGreaterThan(0);
    // A salted hash, never the address itself (a hash's hex digits may hold "203" by chance: the address never).
    expect(kept.every((r) => /^[0-9a-f]{32}$/.test(r.addr) && !r.addr.includes("203.0.113.9"))).toBe(true);
  });

  it("a run's address hash goes two hours on, even when no other run comes", async () => {
    withBilling({ limits: { activeRuns: 0, waiting: 0, runsPerHour: 0, addressRunsPerHour: 5 } });
    process.env.FUOBE_TRUST_PROXY = "1";
    const a = account();
    expect((await post({ ...IMAGE, ...SHOWN }, a.cookie, { "x-forwarded-for": "203.0.113.77" })).status).toBe(201);
    const kept = () => (db().prepare("SELECT COUNT(*) AS n FROM pool_admissions WHERE account = ?").get(a.id) as { n: number }).n;
    expect(kept()).toBe(1);
    // Two hours and a minute pass with no other run here; the runner turns as it always does.
    db().prepare("UPDATE pool_admissions SET at = ? WHERE account = ?").run(Date.now() - 121 * 60_000, a.id);
    globalThis.__fuobePoolAdmissionsPruned = 0;
    await tick();
    expect(kept()).toBe(0);
    expect((db().prepare("SELECT COUNT(*) AS n FROM pool_admissions WHERE at < ?").get(Date.now() - 120 * 60_000) as { n: number }).n).toBe(0);
  });
});

describe("where a run goes", () => {
  it("the policy's default place: this install's GPUs first, even with the account's own GPU online; a named place wins", async () => {
    withBilling({ prefer: "pool", limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    const a = account({ gpu: "online" });
    const r = await post({ ...IMAGE, ...SHOWN }, a.cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.items![0].place).toBe("pool");
    // The request a page gets back (and sends again on Retry) never says where it ran.
    expect((r.body.items![0] as { request?: Record<string, unknown> }).request?.place).toBeUndefined();
    const own = await post({ ...IMAGE, place: "own" }, a.cookie);
    expect(own.status).toBe(201);
    expect(own.body.items![0].place).toBeUndefined();
    // Without it, the own GPU first as before.
    withBilling({ limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    const again = await post(IMAGE, a.cookie);
    expect(again.body.items![0].place).toBeUndefined();
    // The status tells the pages.
    const status = await visitorStatus(auth.accountById(a.id)!);
    expect(status.viewer.prefer).toBeUndefined();
    withBilling({ prefer: "pool" });
    expect((await visitorStatus(auth.accountById(a.id)!)).viewer.prefer).toBe("pool");
  });

  it("with this install's GPUs first, a run that names no place and that they don't take runs on the account's own GPU", async () => {
    withBilling({ prefer: "pool", pool: { deny: ["oss-z-image-turbo"] }, limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    const a = account({ gpu: "online" });
    const r = await post(IMAGE, a.cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.items![0].place).toBeUndefined();
    // Named, it is its label, which opens the setup that runs it (the person asked for that place).
    const named = await post({ ...IMAGE, place: "pool", ...SHOWN }, a.cookie);
    expect(named.status).toBe(403);
    expect(named.body.code).toBe("connect-gpu");
  });

  it("with this install's GPUs first, the price check of a run that names no place answers for where it really goes", async () => {
    withBilling({ prefer: "pool", pool: { deny: ["oss-z-image-turbo"] }, limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    const a = account({ gpu: "online" });
    const LORA = { loras: [{ file: "x.safetensors", url: "https://huggingface.co/x/x.safetensors" }] };
    type Check = { place?: string; quote?: { allowed: boolean; code?: string } };
    // A model they keep off: no pool place and no quote (Run stays on, and it runs on its own GPU).
    const kept = (await preview(IMAGE, a.cookie)).body as Check;
    expect(kept.place).toBeUndefined();
    expect(kept.quote).toBeUndefined();
    // Named there, it is refused before Run, as the run would be.
    const named = (await preview({ ...IMAGE, place: "pool" }, a.cookie)).body as Check;
    expect(named.place).toBe("pool");
    expect(named.quote).toMatchObject({ allowed: false, code: "not-offered" });
    // One they take, named none: this install's GPUs, with its price; with LoRAs, its own GPU again.
    withBilling({ prefer: "pool", limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    const taken = (await preview(IMAGE, a.cookie)).body as Check;
    expect(taken.place).toBe("pool");
    expect(taken.quote).toMatchObject({ allowed: true });
    const lora = (await preview({ ...IMAGE, ...LORA }, a.cookie)).body as Check;
    expect(lora.place).toBeUndefined();
    expect(lora.quote).toBeUndefined();
  });

  it("A17: with this install's GPUs first, a run keeps waiting for them while every one is away, behind an update, or the service is quiet: never moved to the account's own GPU", async () => {
    withBilling({ prefer: "pool", limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    const a = account({ gpu: "online" });
    const acct = auth.accountById(a.id)!;
    const req = { ...IMAGE, account: a.id } as never;
    // Every worker here paused: taken on this install's GPUs; the line says it starts when one is free, and is long enough
    // to offer the account's own GPU for that run (the composer's "Run it now on your GPU").
    pool.patchWorker(worker.id, { paused: true });
    expect((await hostedRun.decidePlace(acct, req, undefined)).kind).toBe("pool");
    const away = await hostedRun.poolQuote(acct, req, undefined);
    expect(away?.quote.allowed).toBe(true);
    expect(away?.line).toMatchObject({ unknown: true, long: true });
    const r = await post({ ...IMAGE, ...SHOWN }, a.cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.items![0].place).toBe("pool");
    expect(ownRuns(a.id)).toBe(0);
    pool.patchWorker(worker.id, { paused: false });
    beatWith(worker, catalogVersion());
    // A short line offers nothing.
    expect((await hostedRun.poolQuote(acct, req, undefined))?.line.long).toBeUndefined();
    // Behind a catalog update: the same.
    beatWith(worker, "e".repeat(64));
    expect((await hostedRun.decidePlace(acct, req, undefined)).kind).toBe("pool");
    expect((await hostedRun.poolQuote(acct, req, undefined))?.line).toMatchObject({ unknown: true });
    beatWith(worker, catalogVersion());
    // The service goes quiet for longer than its last answer stands: never sent to the own GPU. Under a policy without
    // runs that wait (`held`) it is refused as before; with them it is held for the service (pool-holds.test.ts, A3 cold).
    fake.down = "error";
    try {
      const kept = globalThis.__fuobeBillingPolicies!.get(a.id)!;
      kept.at = 0;
      kept.goodAt = Date.now() - billing.POLICY_KEEP_MS - 1000;
      const quiet = await hostedRun.decidePlace(acct, req, undefined);
      expect(quiet.kind).toBe("refuse");
      expect(quiet.kind === "refuse" && quiet.refusal.body.code).toBe("paused");
      expect((await hostedRun.decideToolPlace(acct, [{ request: req }], undefined)).kind).toBe("refuse");
    } finally {
      fake.down = false;
    }
    // A policy that puts the account's own GPU first keeps today's way while the service is quiet: its own GPU.
    withBilling({ limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    const b = account({ gpu: "online" });
    const bAcct = auth.accountById(b.id)!;
    await hostedRun.poolQuote(bAcct, { ...IMAGE, account: b.id } as never, undefined);
    fake.down = "error";
    try {
      const kept = globalThis.__fuobeBillingPolicies!.get(b.id)!;
      kept.at = 0;
      kept.goodAt = Date.now() - billing.POLICY_KEEP_MS - 1000;
      expect((await hostedRun.decidePlace(bAcct, { ...IMAGE, account: b.id } as never, undefined)).kind).toBe("own");
    } finally {
      fake.down = false;
    }
  });

  it("an own GPU that doesn't answer: a run that named no place is asked about, never moved and charged", async () => {
    withBilling({ limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    const a = account({ gpu: "offline" });
    const holds = fake.holds.size;
    const r = await post({ ...IMAGE, ...SHOWN }, a.cookie);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("own-gpu-offline");
    expect(r.headers.get(PLACE_ASK_HEADER)).toBe("1");
    expect(fake.holds.size).toBe(holds);
    expect(poolRuns(a.id)).toBe(0);
    // Asked for this install's GPUs, it runs there.
    const yes = await post({ ...IMAGE, place: "pool", ...SHOWN }, a.cookie);
    expect(yes.status, JSON.stringify(yes.body)).toBe(201);
    expect(poolRuns(a.id)).toBe(1);
  });

  it("an own GPU that doesn't answer: a run this install's GPUs wouldn't take goes to that GPU, as before, never asked about", async () => {
    const a = account({ gpu: "offline" });
    const own = (r: Awaited<ReturnType<typeof post>>, why: string) => {
      expect(r.body.code, why).not.toBe("own-gpu-offline");
      expect(r.headers.get(PLACE_ASK_HEADER), why).toBeNull();
      expect(r.status, `${why}: ${JSON.stringify(r.body)}`).toBe(201);
      expect(r.body.items![0].place, why).toBeUndefined();
      // Stopped, so the studio's own limit of runs at once leaves room for the next.
      db().prepare("UPDATE generations SET status = 'canceled' WHERE json_extract(request_json, '$.account') = ? AND status IN ('queued', 'running')").run(a.id);
    };
    const holds = fake.holds.size;
    // Closed to the account.
    withBilling({ hosted: false, limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    own(await post(IMAGE, a.cookie), "hosted runs closed");
    // A model the policy doesn't offer there.
    withBilling({ pool: { allow: ["oss-qwen-image-21-turbo"] }, limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    own(await post(IMAGE, a.cookie), "a model not offered");
    // A kind the policy leaves out.
    withBilling({ kinds: { image: false }, limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    own(await post(IMAGE, a.cookie), "a kind left out");
    // Extra LoRAs.
    withBilling({ limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    const lora = await post({ ...IMAGE, loras: [{ file: "a-look.safetensors", strength: 0.8 }] }, a.cookie);
    expect(lora.body.code).not.toBe("own-gpu-offline");
    expect(lora.status, JSON.stringify(lora.body)).not.toBe(403);
    // The billing service not answering (and no earlier answer kept).
    billing.resetBillingCache();
    fake.down = "error";
    try {
      own(await post(IMAGE, a.cookie), "the service down");
    } finally {
      fake.down = false;
    }
    expect(poolRuns(a.id)).toBe(0);
    expect(fake.holds.size).toBe(holds);
    expect(ownRuns(a.id)).toBeGreaterThanOrEqual(3);
  });

  it("asked for this install's GPUs by name while they are closed to the account: said so, never run on its own GPU", async () => {
    withBilling({ hosted: false, limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    const a = account({ gpu: "online" });
    const r = await post({ ...IMAGE, place: "pool", ...SHOWN }, a.cookie);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("not-offered");
    expect(ownRuns(a.id) + poolRuns(a.id)).toBe(0);
  });

  it("an own GPU that answers: its run never waits for the billing service once its policy is known", async () => {
    withBilling({ limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    fake.policy = { ...fake.policy, ttlS: 60 };
    const a = account({ gpu: "online" });
    await billing.policy(a.id);
    const asked = () => fake.calls_of("/v1/policy").length;
    const before = asked();
    const r = await post(IMAGE, a.cookie);
    expect(r.status).toBe(201);
    expect(r.body.items![0].place).toBeUndefined();
    expect(asked()).toBe(before);
    // A service that doesn't answer is waited for once, then not again for a while.
    billing.resetBillingCache();
    fake.down = "hang";
    try {
      const t0 = Date.now();
      expect((await post(IMAGE, a.cookie)).status).toBe(201);
      expect(Date.now() - t0).toBeLessThan(billing.BILLING_TIMEOUTS.policy + 1500);
      const after = asked();
      const t1 = Date.now();
      expect((await post(IMAGE, a.cookie)).status).toBe(201);
      expect(Date.now() - t1).toBeLessThan(billing.BILLING_TIMEOUTS.policy);
      expect(asked()).toBe(after);
    } finally {
      fake.down = false;
    }
  });

  it("a kind the policy leaves out is not offered here", async () => {
    withBilling({ kinds: { image: false }, limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    const a = account();
    const r = await post({ ...IMAGE, ...SHOWN }, a.cookie);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("connect-gpu");
    expect(hostedRun.kindAllowed({ kinds: { image: false } }, "video")).toBe(true);
    expect(hostedRun.kindAllowed({}, "model3d")).toBe(true);
  });

  it("3D no worker finishes, even with kinds.model3d on: an account with no GPU of its own reads its label, and the answer opens Connect your GPU", async () => {
    withBilling({ kinds: { model3d: true }, limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    const a = account();
    const uploadsRoute = await import("@/app/api/uploads/route");
    const { TINY_PNG } = await import("./helpers/fake-comfy-runner");
    const up = await uploadsRoute.POST(
      new Request(`http://${HOST}/api/uploads`, { method: "POST", headers: { ...SITE_HEADERS, cookie: a.cookie, "content-type": "image/png", "x-file-name": "photo.png", "content-length": String(TINY_PNG.length) }, body: new Uint8Array(TINY_PNG) }),
    );
    expect(up.status).toBe(201);
    const { url } = (await up.json()) as { url: string };
    const holds = fake.holds.size;
    const r = await post({ feature: "image-to-3d", modelId: "oss-pixal3d", op: "image-to-3d", inputs: { images: [url] }, ...SHOWN }, a.cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.code).toBe("connect-gpu");
    expect(r.body.error).toMatch(/^Self-hosted$/);
    expect(r.headers.get(CONNECT_GPU_HEADER)).toBe("1");
    expect(poolRuns(a.id)).toBe(0);
    expect(fake.holds.size).toBe(holds);
  });

  it("a guest's policy that gets no answer isn't asked for again on every page for a while", async () => {
    withBilling();
    fake.down = "error";
    try {
      const before = fake.calls_of("/v1/policy").length;
      expect((await visitorStatus(null)).viewer.hosted).toBeUndefined();
      expect((await visitorStatus(null)).viewer.hosted).toBeUndefined();
      expect(fake.calls_of("/v1/policy").length).toBe(before + 1);
      expect(billing.cachedPolicy(null)).toBeNull();
    } finally {
      fake.down = false;
    }
    billing.resetBillingCache();
    expect((await visitorStatus(null)).viewer.hosted).toBe(true);
  });

  it("a guest is told what the billing service's policy for guests says", async () => {
    withBilling();
    fake.guestPolicy = { ...FAKE_POLICY, hosted: false, ttlS: 0 };
    expect((await visitorStatus(null)).viewer.hosted).toBeUndefined();
    expect(fake.calls_of("/v1/policy").at(-1)!.path).toBe("/v1/policy");
    fake.guestPolicy = { ...FAKE_POLICY, hosted: true, ttlS: 0 };
    billing.resetBillingCache();
    expect((await visitorStatus(null)).viewer.hosted).toBe(true);
    // No billing service: as any account.
    delete process.env.FUOBE_BILLING_URL;
    expect((await visitorStatus(null)).viewer.hosted).toBe(true);
  });
  it("a run refused there only for its LoRAs says so, and runs there without them", async () => {
    withBilling({ prefer: "pool", limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    const a = account();
    const LORA = { loras: [{ file: "x.safetensors", url: "https://huggingface.co/x/x.safetensors" }] };
    type Check = { place?: string; quote?: { allowed: boolean; withoutLoras?: true } };
    const refused = (await preview({ ...IMAGE, ...LORA, place: "pool" }, a.cookie)).body as Check;
    expect(refused.quote).toMatchObject({ allowed: false, withoutLoras: true });
    const without = (await preview({ ...IMAGE, ...LORA, place: "pool", lorasOff: true }, a.cookie)).body as Check;
    expect(without.quote).toMatchObject({ allowed: true });
    expect(without.quote?.withoutLoras).toBeUndefined();
  });

  it("offer_after_s 0 turns the wait offer off: an unknown wait is not long, and a known one never is", async () => {
    expect(billing.policyOfferAfterS({ limits: { offerAfterS: 0 } } as never)).toBe(Infinity);
    expect(billing.policyOfferAfterS({ limits: { offerAfterS: 1200 } } as never)).toBe(1200);
    expect(billing.policyOfferAfterS({ limits: {} } as never)).toBe(billing.POOL_OFFER_AFTER_S);
    withBilling({ prefer: "pool", limits: { activeRuns: 0, waiting: 0, runsPerHour: 0, offerAfterS: 0 } });
    const a = account({ gpu: "online" });
    const req = { ...IMAGE, account: a.id } as never;
    pool.patchWorker(worker.id, { paused: true });
    try {
      const away = await hostedRun.poolQuote(auth.accountById(a.id)!, req, undefined);
      expect(away?.line).toMatchObject({ unknown: true });
      expect(away?.line.long).toBeUndefined();
    } finally {
      pool.patchWorker(worker.id, { paused: false });
      beatWith(worker, catalogVersion());
    }
    withBilling({ prefer: "pool", limits: { activeRuns: 0, waiting: 0, runsPerHour: 0, offerAfterS: 1200 } });
    pool.patchWorker(worker.id, { paused: true });
    try {
      expect((await hostedRun.poolQuote(auth.accountById(a.id)!, req, undefined))?.line.long).toBe(true);
    } finally {
      pool.patchWorker(worker.id, { paused: false });
      beatWith(worker, catalogVersion());
    }
  });
});

describe("a run's price facts", () => {
  it("send the real size of a picture, and every step of a chain once", async () => {
    withBilling({ limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    const a = account();
    const r = await post({ ...IMAGE, params: { aspectRatio: "16:9", resolution: "1K" }, ...SHOWN }, a.cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const run = (fake.calls_of("/v1/reserve").at(-1)!.body as { run: { megapixels: number | null; steps?: { model: string; jobs: number }[] } }).run;
    expect(run.megapixels).toBeGreaterThan(0.9);
    expect(run.megapixels).toBeLessThan(1.2);
    expect(run.steps).toEqual([expect.objectContaining({ model: "oss-z-image-turbo", jobs: 1 })]);
    // A film of two shots: its two clips priced together with one hold; the join costs nothing. (The join reads the
    // clips, so the workers must take clips: until they do, the film is said before Run as the visitor's own GPU.)
    const filmReq = { feature: "video", modelId: "oss-wan22-14b-fast", prompt: "x", params: { aspectRatio: "16:9", shots: [{ prompt: "wide shot", duration: 3 }, { prompt: "close-up", duration: 3 }] }, ...SHOWN };
    const prior = process.env.FUOBE_POOL_MEDIA_INPUTS;
    let film: Awaited<ReturnType<typeof post>>;
    try {
      process.env.FUOBE_POOL_MEDIA_INPUTS = "image";
      const off = await post(filmReq, a.cookie);
      expect(off.status, JSON.stringify(off.body)).toBe(403);
      expect(off.body).toMatchObject({ error: "This file runs self-hosted" });
      process.env.FUOBE_POOL_MEDIA_INPUTS = "image,video";
      film = await post(filmReq, a.cookie);
    } finally {
      if (prior === undefined) delete process.env.FUOBE_POOL_MEDIA_INPUTS;
      else process.env.FUOBE_POOL_MEDIA_INPUTS = prior;
    }
    expect(film.status, JSON.stringify(film.body)).toBe(201);
    const reserves = fake.calls_of("/v1/reserve");
    const filmRun = (reserves.at(-1)!.body as { run: { steps?: { model: string; jobs: number }[] } }).run;
    expect(filmRun.steps?.find((s) => s.model === "oss-wan22-14b-fast")?.jobs).toBe(2);
    expect(filmRun.steps?.every((s) => s.model === "oss-wan22-14b-fast"), JSON.stringify(filmRun.steps)).toBe(true);
    expect(poolRuns(a.id)).toBe(2);
  });

  it("send the size a run really makes: an upscale of a large picture its upscaled size, never a size the request names that its workflow doesn't use", async () => {
    withBilling({ limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    const a = account();
    const sharp = (await import("sharp")).default;
    const big = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#468" } })
      .png()
      .toBuffer();
    const uploadsRoute = await import("@/app/api/uploads/route");
    const up = await uploadsRoute.POST(
      new Request(`http://${HOST}/api/uploads`, { method: "POST", headers: { ...SITE_HEADERS, cookie: a.cookie, "content-type": "image/png", "x-file-name": "big.png", "content-length": String(big.length) }, body: new Uint8Array(big) }),
    );
    expect(up.status).toBe(201);
    const { url } = (await up.json()) as { url: string };
    // SeedVR2's 4x, held to its 4096 px limit (2.04x): 4080 × 3060, whatever size the request names.
    const upscale = { feature: "image", modelId: "oss-seedvr2-image", op: "upscale-image", inputs: { images: [url] }, params: { extra: { width: 64, height: 64 } }, ...SHOWN };
    const r = await post(upscale, a.cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const run = (fake.calls_of("/v1/reserve").at(-1)!.body as { run: { model: string; megapixels: number | null } }).run;
    expect(run).toMatchObject({ model: "oss-seedvr2-image", megapixels: 12.48 });
    // ESRGAN's model makes it 4 times as large: 8000 × 6000.
    expect(hosted.requestMegapixels({ ...upscale, modelId: "oss-upscale-image" } as never, "image", "oss-upscale-image", "upscale-image-esrgan")).toBe(48);
    // A workflow that binds its canvas makes the canvas the request names (a layout's), on its grid.
    const endpoint = getModel(IMAGE.modelId)!.routes.find((x) => x.provider === "comfyui")!.endpoint;
    expect(hosted.requestMegapixels({ ...IMAGE, params: { extra: { width: 1280, height: 720 } } } as never, "image", IMAGE.modelId, endpoint)).toBe(0.92);
  });

  it("a price check reads the size of the viewer's own files only: another account's file, or a guest's look at one, says nothing of it", async () => {
    withBilling({ limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    const a = account();
    const b = account();
    const sharp = (await import("sharp")).default;
    const big = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#864" } })
      .png()
      .toBuffer();
    const uploadsRoute = await import("@/app/api/uploads/route");
    const up = await uploadsRoute.POST(
      new Request(`http://${HOST}/api/uploads`, { method: "POST", headers: { ...SITE_HEADERS, cookie: a.cookie, "content-type": "image/png", "x-file-name": "mine.png", "content-length": String(big.length) }, body: new Uint8Array(big) }),
    );
    expect(up.status).toBe(201);
    const { url } = (await up.json()) as { url: string };
    const upscale = { feature: "image", modelId: "oss-seedvr2-image", op: "upscale-image", inputs: { images: [url] } };
    const quoted = () => (fake.calls_of("/v1/quote").at(-1)!.body as { run: { megapixels: number | null } }).run.megapixels;
    // Its owner's price check: the size its run makes.
    await preview(upscale, a.cookie);
    expect(quoted()).toBe(12.48);
    // Another account's, and a guest's: as if there were no such file.
    const before = fake.calls_of("/v1/quote").length;
    await preview(upscale, b.cookie);
    expect(fake.calls_of("/v1/quote").length).toBe(before + 1);
    expect(quoted()).toBeNull();
    await preview(upscale, "");
    expect(fake.calls_of("/v1/quote").length).toBe(before + 2);
    expect(quoted()).toBeNull();
  });

  it("under the policy's cap on outputs, the price check and the run plan, price and make the same run", async () => {
    withBilling({ limits: { activeRuns: 0, waiting: 0, runsPerHour: 0, outputsPerRun: 1 } });
    const a = account();
    const asked = { ...IMAGE, params: { numOutputs: 4 } };
    const q = await preview(asked, a.cookie);
    expect(q.body.place).toBe("pool");
    const quoted = (fake.calls_of("/v1/quote").at(-1)!.body as { run: { jobs: number; steps?: { jobs: number }[] } }).run;
    const r = await post({ ...asked, ...SHOWN }, a.cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const reserved = (fake.calls_of("/v1/reserve").at(-1)!.body as { run: { jobs: number; steps?: { jobs: number }[] } }).run;
    expect(quoted.jobs).toBe(1);
    expect(reserved.jobs).toBe(1);
    expect(reserved.steps).toEqual(quoted.steps);
    expect(reserved.steps?.[0].jobs).toBe(1);
    expect(r.body.items).toHaveLength(1);
    expect((r.body as { notes?: string[] }).notes).toContain(ACCOUNT_MESSAGES.outputsCapped);
  });

  it("the account's runs in the line facts count one per press of Run, however many jobs", async () => {
    withBilling({ limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    const a = account();
    const r = await post({ ...IMAGE, params: { numOutputs: 3 }, ...SHOWN }, a.cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.items!.length).toBeGreaterThan(1);
    await waitFor(() => r.body.items!.every((g) => !!taskOf(g.id)));
    expect(hosted.queueFacts(a.id, "z-image-turbo-t2i").mine).toEqual({ waiting: 1, running: 0 });
    expect((await post({ ...IMAGE, ...SHOWN }, a.cookie)).status).toBe(201);
    const sent = (fake.calls_of("/v1/reserve").at(-1)!.body as { queue: { mine: { waiting: number } } }).queue;
    expect(sent.mine.waiting).toBe(1);
  });

  it("a run whose hold set nothing aside never says it wasn't charged", async () => {
    withBilling({ limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    const a = account();
    const stopped = async () => {
      const r = await post({ ...IMAGE, ...SHOWN }, a.cookie);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const id = r.body.items![0].id;
      db().prepare("UPDATE generations SET status = 'canceled', completed_at = ? WHERE id = ?").run(Date.now(), id);
      return getGeneration(id)!;
    };
    expect((await stopped()).notCharged).toBe(true);
    fake.price = { amount: 0, version: "v0" };
    const free = await stopped();
    expect(free.place).toBe("pool");
    expect(free.notCharged).toBeUndefined();
  });

  it("a chain whose join no worker takes is refused before anything is made", async () => {
    withBilling({ limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    const a = account();
    const film = { feature: "video", modelId: "oss-wan22-14b-fast", prompt: "x", params: { aspectRatio: "16:9", shots: [{ prompt: "wide shot", duration: 3 }, { prompt: "close-up", duration: 3 }] }, ...SHOWN };
    // Every lane but the joins'.
    const joins = new Set(hosted.workflowPicks("video-concat-{n}").map((id) => pool.poolLane(id)));
    expect(joins.size).toBeGreaterThan(0);
    const lanes = allLanes(loadIndex(), sha).map((l) => l.lane);
    expect(lanes.some((l) => !joins.has(l))).toBe(true);
    pool.patchWorker(worker.id, { allow: Object.fromEntries(lanes.filter((l) => !joins.has(l)).map((l) => [l, { delayMs: 0 }])) });
    const holds = fake.holds.size;
    const r = await post(film, a.cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.code).toBe("connect-gpu");
    expect(poolRuns(a.id)).toBe(0);
    expect(fake.holds.size).toBe(holds);
    // Its price check says the same before Run: not offered here, so Run stays off.
    const check = (await preview(film, a.cookie)).body as { quote?: { allowed: boolean; code?: string } };
    expect(check.quote).toMatchObject({ allowed: false, code: "not-offered" });
  });

  it("every step must be one the policy allows: a later step's model it leaves out stops the run before anything is made", () => {
    const steps = (models: [string, string][]) => models.map(([modelId, provider], i) => ({ id: `s${i}`, modelId, op: "t2i", provider, kind: "image", presetId: null, waits: i > 0 }));
    const p = { ...billing.OPEN_POLICY, pool: { deny: ["oss-qwen-image-edit"] } };
    expect(hostedRun.stepsProblem(p, steps([["oss-z-image-turbo", "comfyui"]]))).toBeNull();
    expect(hostedRun.stepsProblem(p, steps([["oss-z-image-turbo", "comfyui"], ["oss-qwen-image-edit", "comfyui"]]))).not.toBeNull();
    // A cloud step can't run here, and neither can one made in the browser: the run is refused before Run, never part
    // way through. (A text step runs on the install's AI helper: hosted-tool-runs.test.ts.)
    expect(hostedRun.stepsProblem(billing.OPEN_POLICY, steps([["oss-z-image-turbo", "comfyui"], ["fal-flux", "fal"]]))).not.toBeNull();
    for (const provider of ["local", "mock"]) {
      expect(hostedRun.stepsProblem({ ...billing.OPEN_POLICY, pool: { allow: ["oss-z-image-turbo"] } }, steps([["oss-z-image-turbo", "comfyui"], ["some-step", provider]])), provider).toBe(hosted.hostedWords(placeOf(null)).notOffered);
    }
    expect(hostedRun.pricedSteps(steps([["oss-z-image-turbo", "comfyui"], ["oss-z-image-turbo", "comfyui"]]))).toEqual([expect.objectContaining({ model: "oss-z-image-turbo", jobs: 2 })]);
  });
});

describe("the price check before Run and the run itself", async () => {
  const { PLACEHOLDER } = await import("@/lib/composer");
  const { hostedGuestWords, hostedWords } = await import("@/server/hosted");
  const HOSTED_GUEST_WORDS = hostedGuestWords();
  const HOSTED_WORDS = hostedWords(placeOf(null));
  /** A Fuobe DoP effect: its start frame is made first on another model, then animated. */
  const EFFECT = { feature: "video", presetId: "effect-acid", modelId: "fuobe-dop", op: "i2v", prompt: "a dancer", inputs: { images: [PLACEHOLDER.image] } };
  const LORAS = { ...IMAGE, loras: [{ file: "x.safetensors", url: "https://huggingface.co/x/x.safetensors" }] };
  const THREE_D = { feature: "3d", modelId: "oss-pixal3d", op: "image-to-3d", prompt: "", inputs: { images: [PLACEHOLDER.image] } };
  const NO_LIMITS = { activeRuns: 0, waiting: 0, runsPerHour: 0 };

  it("agree on every case: what the run would be refused for, the price check refuses before Run, in the same words", async () => {
    const cases: { name: string; req: Record<string, unknown>; policy?: Record<string, unknown>; refused?: string }[] = [
      { name: "taken", req: IMAGE },
      { name: "a chain, every step taken", req: EFFECT },
      { name: "a model the policy denies", req: IMAGE, policy: { pool: { deny: ["oss-z-image-turbo"] } }, refused: HOSTED_WORDS.notOffered },
      { name: "a kind the policy keeps off", req: IMAGE, policy: { kinds: { image: false } }, refused: HOSTED_WORDS.notOffered },
      { name: "extra LoRAs", req: LORAS, refused: HOSTED_WORDS.loras },
      { name: "a kind of file the policy keeps off", req: EFFECT, policy: { uploads: { image: false, video: false, audio: false } }, refused: HOSTED_WORDS.inputs },
      { name: "a chain whose later step the policy denies", req: EFFECT, policy: { pool: { deny: ["fuobe-mixed-media"] } }, refused: HOSTED_WORDS.notOffered },
      { name: "a 3D model", req: THREE_D, refused: "3d" },
    ];
    const a = account();
    const acct = auth.accountById(a.id)!;
    for (const c of cases) {
      withBilling({ limits: NO_LIMITS, ...(c.policy ?? {}) });
      const req = { ...c.req, account: a.id } as never;
      const run = await hostedRun.decidePlace(acct, req, undefined);
      const check = await hostedRun.poolQuote(acct, req, undefined);
      if (!c.refused) {
        expect(run.kind, c.name).toBe("pool");
        expect(check?.quote.allowed, c.name).toBe(true);
        continue;
      }
      expect(run.kind, c.name).toBe("refuse");
      const words = c.refused === "3d" ? expect.stringMatching(/^Self-hosted$/) : c.refused;
      expect(run.kind === "refuse" && run.refusal.body.error, c.name).toEqual(words);
      expect(check?.quote, c.name).toMatchObject({ allowed: false, text: words, ownSetup: { need: "gpu" } });
    }
  });

  it("a size bigger than every GPU here makes is its label before Run, the press opens Connect your GPU, and an own GPU runs it at once", async () => {
    withBilling({ limits: NO_LIMITS });
    const a = account();
    const acct = auth.accountById(a.id)!;
    const req = { ...IMAGE, account: a.id } as never;
    expect((await hostedRun.decidePlace(acct, req, undefined)).kind).toBe("pool");
    // The only GPU here makes pictures up to a tenth of a megapixel (its PC's ceiling).
    db().prepare("UPDATE relay_workers SET ceiling_json = ? WHERE id = ?").run(JSON.stringify({ maxMegapixels: 0.1 }), worker.id);
    try {
      const check = await hostedRun.poolQuote(acct, req, undefined);
      expect(check?.quote).toMatchObject({ allowed: false, code: "not-offered", text: HOSTED_WORDS.size, ownSetup: { need: "gpu" } });
      expect((check?.quote as { sub?: string }).sub).toBe("Up to 0.1 megapixels on our GPUs. Pick a smaller size, or run it on your own GPU.");
      const run = await hostedRun.decidePlace(acct, req, undefined);
      expect(run.kind).toBe("refuse");
      if (run.kind === "refuse") {
        expect(run.refusal.body).toMatchObject({ code: "connect-gpu", error: "This size runs self-hosted", ownSetup: { need: "gpu" } });
        expect(run.refusal.headers[CONNECT_GPU_HEADER]).toBe("1");
      }
      // Pressed anyway: nothing is held or made.
      const holds = fake.holds.size;
      const r = await post({ ...IMAGE, place: "pool", ...SHOWN }, a.cookie);
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.code).toBe("connect-gpu");
      expect(poolRuns(a.id)).toBe(0);
      expect(fake.holds.size).toBe(holds);
      // An account whose own GPU answers: the run goes there on the first press, no question.
      const g = account({ gpu: "online" });
      expect((await hostedRun.decidePlace(auth.accountById(g.id)!, { ...IMAGE, account: g.id } as never, undefined)).kind).toBe("own");
      // A size within the ceiling runs here again.
      db().prepare("UPDATE relay_workers SET ceiling_json = ? WHERE id = ?").run(JSON.stringify({ maxMegapixels: 64 }), worker.id);
      expect((await hostedRun.decidePlace(acct, req, undefined)).kind).toBe("pool");
    } finally {
      db().prepare("UPDATE relay_workers SET ceiling_json = NULL WHERE id = ?").run(worker.id);
    }
  });

  it("a 3D model runs here only while a worker's CPU slot finishes it, and then as the policy's kinds say; a splat or a scene never does", async () => {
    const a = account();
    const acct = auth.accountById(a.id)!;
    withBilling({ limits: NO_LIMITS });
    const req = { ...THREE_D, account: a.id } as never;
    const refused = async (r: Record<string, unknown>) => {
      const run = await hostedRun.decidePlace(acct, { ...r, account: a.id } as never, undefined);
      return run.kind === "refuse" ? run.refusal.body.error : run.kind;
    };
    expect(await refused(THREE_D)).toMatch(/^Self-hosted$/);
    // A worker whose CPU slot runs the 3D finish: the model's GLB is checked, made for the web and given its turntable there.
    db().prepare("UPDATE relay_workers SET cpu_slot_json = ? WHERE id = ?").run(JSON.stringify({ finishes: ["model3d"] }), worker.id);
    try {
      expect((await hostedRun.decidePlace(acct, req, undefined)).kind).toBe("pool");
      expect((await hostedRun.poolQuote(acct, req, undefined))?.quote.allowed).toBe(true);
      // The policy's kinds still say.
      withBilling({ limits: NO_LIMITS, kinds: { model3d: false } });
      expect(await refused(THREE_D)).toBe(HOSTED_WORDS.notOffered);
      withBilling({ limits: NO_LIMITS });
      // A splat or a scene gets no finish there: it stays on a visitor's own setup.
      expect(await refused({ ...THREE_D, modelId: "oss-triposplat", op: "splat" })).toMatch(/^Self-hosted$/);
      expect(await refused({ ...THREE_D, modelId: "oss-scene-moge", op: "scene-3d" })).toMatch(/^Self-hosted$/);
    } finally {
      db().prepare("UPDATE relay_workers SET cpu_slot_json = NULL WHERE id = ?").run(worker.id);
    }
    // No CPU slot that finishes it any more: refused again, before Run and at the run alike.
    expect(await refused(THREE_D)).toMatch(/^Self-hosted$/);
    expect((await hostedRun.poolQuote(acct, req, undefined))?.quote).toMatchObject({ allowed: false, text: expect.stringMatching(/^Self-hosted$/), ownSetup: { need: "gpu" } });
  });

  it("while every worker that could run it is built from the catalog before the studio's update, the run is taken and waits in line until one is updated; Run stays on", async () => {
    const a = account();
    const acct = auth.accountById(a.id)!;
    withBilling({ limits: NO_LIMITS });
    const req = { ...IMAGE, account: a.id } as never;
    const endpoint = getModel(IMAGE.modelId)!.routes!.find((r) => r.provider === "comfyui")!.endpoint;
    beatWith(worker, catalogVersion());
    expect((await hostedRun.decidePlace(acct, req, undefined)).kind).toBe("pool");
    expect(hosted.queueFacts(a.id, endpoint).workersOnline).toBe(1);
    // The studio was updated; its only worker not yet.
    beatWith(worker, "e".repeat(64));
    const run = await hostedRun.decidePlace(acct, req, undefined);
    expect(run.kind).toBe("pool");
    // The price check lets it run, and says it starts when a GPU is free (for a guest too).
    const q = await hostedRun.poolQuote(acct, req, undefined);
    expect(q?.quote.allowed).toBe(true);
    expect(q?.line).toMatchObject({ unknown: true, long: true });
    expect((await hostedRun.poolQuote(null, IMAGE as never, undefined))?.line).toMatchObject({ unknown: true });
    // Its place in line and the workers there count only a worker that takes the run now.
    expect(hosted.queueFacts(a.id, endpoint).workersOnline).toBe(0);
    // The owner's own jobs still go to it: a worker built from another catalog takes those.
    expect(pool.workersCanRun(endpoint)).toBe(true);
    // Updated: Run is on again.
    beatWith(worker, catalogVersion());
    expect((await hostedRun.poolQuote(acct, req, undefined))?.quote.allowed).toBe(true);
    expect(hosted.queueFacts(a.id, endpoint).workersOnline).toBe(1);
  });

  it("a chain whose later step only away workers could run is told it starts soon, though a worker for its first step is on", async () => {
    const endpointOf = (id: string) => getModel(id)!.routes.find((r) => r.provider === "comfyui")!.endpoint;
    const first = endpointOf("oss-z-image-turbo");
    const later = endpointOf("oss-rtx-video-upscale");
    const laterLane = pool.poolLane(later);
    expect(pool.poolLane(first)).not.toBe(laterLane);
    const lanes = allLanes(loadIndex(), sha).map((l) => l.lane);
    // The worker that is on may run every lane but the later step's; the only one that may run that lane is away.
    pool.patchWorker(worker.id, { allow: Object.fromEntries(lanes.filter((l) => l !== laterLane).map((l) => [l, { delayMs: 0 }])) });
    const away = standInWorker();
    pool.patchWorker(away.id, { allow: { [laterLane]: { delayMs: 0 } } });
    db().prepare("UPDATE relay_workers SET paused_local = 1, local_why = 'gpu-busy:game.exe' WHERE id = ?").run(away.id);
    const chain = [
      { id: "s0", modelId: "oss-z-image-turbo", op: "t2i", provider: "comfyui", kind: "image", presetId: null, waits: false },
      { id: "s1", modelId: "oss-rtx-video-upscale", op: "upscale-video", provider: "comfyui", kind: "video", presetId: null, waits: true },
    ];
    const planned = { route: { endpoint: first } };
    expect(hostedRun.runAway(planned as never, [chain[0]])).toBe(false);
    expect(hostedRun.runAway(planned as never, chain)).toBe(true);
    // A step that isn't on this install's GPUs (a cloud step) is not looked at.
    expect(hostedRun.runAway(planned as never, [chain[0], { ...chain[1], provider: "fal" }])).toBe(false);
    // The away worker is back: the chain may be made.
    db().prepare("UPDATE relay_workers SET paused_local = 0, local_why = NULL WHERE id = ?").run(away.id);
    expect(hostedRun.runAway(planned as never, chain)).toBe(false);
  });

  it("a guest's price check plans every step of a chain too, and says the same labels as an account's", async () => {
    withBilling({ limits: NO_LIMITS });
    expect((await hostedRun.poolQuote(null, EFFECT as never, undefined))?.quote.allowed).toBe(true);
    // A later step this install's GPUs don't take: refused before Run, never only once the run starts after sign-up.
    withBilling({ limits: NO_LIMITS, pool: { deny: ["fuobe-mixed-media"] } });
    expect((await hostedRun.poolQuote(null, EFFECT as never, undefined))?.quote).toMatchObject({ allowed: false, code: "not-offered", text: HOSTED_GUEST_WORDS.notOffered });
    withBilling({ limits: NO_LIMITS, pool: { deny: ["oss-z-image-turbo"] } });
    const denied = await hostedRun.poolQuote(null, IMAGE as never, undefined);
    expect(denied?.quote).toMatchObject({ allowed: false, text: HOSTED_GUEST_WORDS.notOffered, ownSetup: { need: "gpu" } });
    expect(denied?.quote.text).toBe(HOSTED_WORDS.notOffered);
    withBilling({ limits: NO_LIMITS });
    expect((await hostedRun.poolQuote(null, LORAS as never, undefined))?.quote.text).toBe(HOSTED_GUEST_WORDS.loras);
    // Planned as nobody's: nothing of the plan is kept.
    expect((db().prepare("SELECT COUNT(*) AS n FROM generations WHERE json_extract(request_json, '$.account') = 'guest:plan'").get() as { n: number }).n).toBe(0);
  });

  it("a model that needs an NVIDIA RTX card: the install's own card check applies to its own ComfyUI, never to the workers", async () => {
    const { writeSnapshot } = await import("@/server/gpu/snapshots");
    const at = Date.now();
    writeSnapshot({ kind: "install", key: "install", via: "server" }, {
      v: 1, via: "server", checkedAt: at, tookMs: 5, reachable: true,
      devices: [{ name: "cpu", type: "cpu", index: 0, vramTotal: 0, vramFree: 0 }],
      manager: { api: "none" }, nodes: { have: [], missing: [], total: 1, readAt: at, how: "object_info" },
      combos: {}, packs: {}, models: {}, loras: {}, fingerprint: "x", errors: [],
    } as never);
    expect(hostedRun.poolCardRefuses("oss-rtx-video-upscale")).toBe(false);
    setSetting("comfyWhere", "");
    expect(hostedRun.poolCardRefuses("oss-rtx-video-upscale")).toBe(true);
    expect(hostedRun.poolCardRefuses("oss-z-image-turbo")).toBe(false);
    // A chain's later step too, before Run, in the same words (an upscale on the card after a clip, say).
    const chain = [
      { id: "s0", modelId: "oss-z-image-turbo", op: "t2i", provider: "comfyui", kind: "image", presetId: null, waits: false },
      { id: "s1", modelId: "oss-rtx-video-upscale", op: "upscale-video", provider: "comfyui", kind: "video", presetId: null, waits: true },
    ];
    expect(hostedRun.stepsProblem(billing.OPEN_POLICY, chain)).toBe(HOSTED_WORDS.rtxCard);
    setSetting("comfyWhere", "workers");
    expect(hostedRun.stepsProblem(billing.OPEN_POLICY, chain)).not.toBe(HOSTED_WORDS.rtxCard);
    // A guest reads the same label as an account (Run opens the sign-up for it), with no Settings named.
    expect(hostedRun.gateWords("rtxCard", true, placeOf(null))).toBe(HOSTED_GUEST_WORDS.rtxCard);
    expect(hostedRun.gateWords("rtxCard", true, placeOf(null))).toBe("Self-hosted · RTX GPU");
    expect(hostedRun.gateWords("rtxCard", true, placeOf(null))).not.toMatch(/Settings/);
    expect(hostedRun.gateWords("rtxCard", false, placeOf(null))).toBe(HOSTED_WORDS.rtxCard);
  });

  it("asks for the client's address only when the policy counts runs per address, and keeps its salt without writing again", async () => {
    const salted = () => !!db().prepare("SELECT 1 FROM settings WHERE key = 'pool.addressSalt'").get();
    const from = "203.0.113.20";
    const preview = async (cookie: string) => {
      const text = JSON.stringify(IMAGE);
      const r = await generationsRoute.POST(
        new Request(`http://${HOST}/api/generations?preview=1`, {
          method: "POST",
          headers: { ...SITE_HEADERS, cookie, "content-type": "application/json", "content-length": String(Buffer.byteLength(text)), "x-forwarded-for": from },
          body: text,
        }),
      );
      return (await r.json()) as { quote?: { allowed: boolean } };
    };
    db().prepare("DELETE FROM settings WHERE key = 'pool.addressSalt'").run();
    globalThis.__fuobeAddressSalt = undefined;
    process.env.FUOBE_TRUST_PROXY = "1";
    const a = account();
    // Hosted runs off: nothing of it at all.
    delete process.env.FUOBE_HOSTED_RUNS;
    await preview(a.cookie);
    expect(salted()).toBe(false);
    process.env.FUOBE_HOSTED_RUNS = "1";
    // No count per address in the policy: the address isn't read.
    withBilling({ limits: NO_LIMITS });
    expect((await preview(a.cookie)).quote?.allowed).toBe(true);
    expect(salted()).toBe(false);
    // Counted per address: read, under a salt made once.
    withBilling({ limits: { ...NO_LIMITS, addressRunsPerHour: 5 } });
    expect((await preview(a.cookie)).quote?.allowed).toBe(true);
    expect(salted()).toBe(true);
    const ask = () => limits.clientAddress(new Request("http://x/", { headers: { "x-forwarded-for": from } }));
    const first = ask();
    // Kept in memory after that: the settings row isn't written (nor read) for each check.
    db().prepare("DELETE FROM settings WHERE key = 'pool.addressSalt'").run();
    expect(ask()).toBe(first);
    expect(salted()).toBe(false);
  });
});

describe("a run on this install's GPUs that can't finish", async () => {
  const { getGeneration } = await import("@/server/generations");
  const { POOL_WORDS } = await import("@/lib/relay");
  const { SITE_HIDDEN_WORDS } = await import("@/server/output-checks");
  const fail = (id: string, error: string) => db().prepare("UPDATE generations SET status = 'failed', error = ?, completed_at = ? WHERE id = ?").run(error, Date.now(), id);
  const hide = (id: string) => {
    fail(id, SITE_HIDDEN_WORDS);
    db().prepare("INSERT INTO output_checks (asset_id, generation_id, state, asked_at, tries, next_at) VALUES (?, ?, 'hidden', ?, 0, ?)").run(`asset-${id}`, id, Date.now(), Date.now());
  };
  const FREE = { shown: { amount: 0, priceVersion: "v0" } };

  it("says Not charged only when its hold set an amount aside", async () => {
    withBilling({ limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    fake.price = { amount: 0, version: "v0" };
    const a = account();
    const free = await post({ ...IMAGE, ...FREE }, a.cookie);
    expect(free.status, JSON.stringify(free.body)).toBe(201);
    const freeId = free.body.items![0].id;
    fail(freeId, "the worker stopped");
    const g = getGeneration(freeId)!;
    expect(g.place).toBe("pool");
    expect(g.notCharged).toBeUndefined();
    expect(g.error).toBe(POOL_WORDS.failed);
    // Removed by the output checks: their sentence, without the charge.
    const hidden = await post({ ...IMAGE, ...FREE }, a.cookie);
    const hiddenId = hidden.body.items![0].id;
    hide(hiddenId);
    expect(getGeneration(hiddenId)!.error).toBe("This result didn't pass the safety check, so it was removed.");
    expect(getGeneration(hiddenId)!.notCharged).toBeUndefined();
    // Something set aside: it says so.
    fake.price = { amount: 7, version: "v7" };
    const paid = await post({ ...IMAGE, ...SHOWN }, a.cookie);
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    const paidId = paid.body.items![0].id;
    hide(paidId);
    expect(getGeneration(paidId)).toMatchObject({ notCharged: true, error: SITE_HIDDEN_WORDS });
    // That the hold set something aside stays the server's: never sent with the request.
    expect("charged" in getGeneration(paidId)!.request).toBe(false);
    expect((JSON.parse((db().prepare("SELECT request_json FROM generations WHERE id = ?").get(paidId) as { request_json: string }).request_json) as { charged?: boolean }).charged).toBe(true);
  });
});
