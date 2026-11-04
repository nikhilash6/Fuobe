import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
const billing = await import("@/server/billing");
const hostedRun = await import("@/server/hosted-run");
const limits = await import("@/server/pool-limits");
const { visitorStatus } = await import("@/server/account-gpu");
const { loadManifest } = await import("@/server/providers/comfyui");
const { loadIndex } = await import("@/server/gpu/index-file");
const { allLanes } = await import("@/lib/lanes");
const { PLACE_ASK_HEADER } = await import("@/lib/guest-access");

const HOST = "localhost:3000";
const SITE_HEADERS = { host: HOST, "sec-fetch-site": "same-origin", origin: `http://${HOST}` };
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const IMAGE = { feature: "image", modelId: "oss-z-image-turbo", prompt: "a lighthouse" };

let fake: FakeBilling;
let n = 0;

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

/** Runs on this install's GPUs an account has made. */
const poolRuns = (id: string) =>
  (db().prepare("SELECT COUNT(DISTINCT COALESCE(batch_id, id)) AS n FROM generations WHERE json_extract(request_json, '$.account') = ? AND json_extract(request_json, '$.place') = 'pool'").get(id) as { n: number }).n;
const ownRuns = (id: string) =>
  (db().prepare("SELECT COUNT(*) AS n FROM generations WHERE json_extract(request_json, '$.account') = ? AND json_extract(request_json, '$.place') IS NULL").get(id) as { n: number }).n;

function standInWorker() {
  const w = pool.addWorker(`stand-in-${++n}`);
  const lanes = allLanes(loadIndex(), sha);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: Object.fromEntries(lanes.map((l) => [l.lane, { delayMs: 0 }])), claimAfterMs: 0 });
  db()
    .prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ? WHERE id = ?")
    .run(JSON.stringify({ lanes: lanes.map((l) => l.lane), workflows: loadManifest().workflows.map((x) => x.id) }), JSON.stringify({ vramBytes: 96 * 2 ** 30 }), w.id);
  return w;
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
  standInWorker();
});

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

  it("runs on the account's own GPU never count against the policy, and keep the studio's own limit of 4", async () => {
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
    // The studio's own 4 counts every run, as before.
    const fifth = await post(IMAGE, a.cookie);
    expect(fifth.status).toBe(429);
  });

  it("with a free install (no billing service) the policy's limits apply to runs there too", async () => {
    const a = account();
    const p = await billing.policy(a.id);
    expect(p).toBe(billing.OPEN_POLICY);
    for (let i = 0; i < 4; i++) expect((await post(IMAGE, a.cookie)).status).toBe(201);
    const over = await post(IMAGE, a.cookie);
    expect(over.status).toBe(429);
    expect(poolRuns(a.id)).toBe(4);
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
    // Once it has started, the next one may wait.
    const id = (db().prepare("SELECT id FROM generations WHERE json_extract(request_json, '$.account') = ?").get(a.id) as { id: string }).id;
    db().prepare("INSERT OR REPLACE INTO generation_runs (id, submitted_at, started_at) VALUES (?, ?, ?)").run(id, Date.now(), Date.now());
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
    expect(third.body.error).toBe(limits.POOL_LIMIT_WORDS.address);
    expect((await post({ ...IMAGE, ...SHOWN }, b.cookie, { "x-forwarded-for": "198.51.100.4" })).status).toBe(201);
    const kept = db().prepare("SELECT addr FROM pool_admissions WHERE addr IS NOT NULL").all() as { addr: string }[];
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((r) => /^[0-9a-f]{32}$/.test(r.addr) && !r.addr.includes("203"))).toBe(true);
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

  it("a kind the policy leaves out is not offered here", async () => {
    withBilling({ kinds: { image: false }, limits: { activeRuns: 0, waiting: 0, runsPerHour: 0 } });
    const a = account();
    const r = await post({ ...IMAGE, ...SHOWN }, a.cookie);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("not-offered");
    expect(hostedRun.kindAllowed({ kinds: { image: false } }, "video")).toBe(true);
    expect(hostedRun.kindAllowed({}, "model3d")).toBe(true);
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
    // A film of two shots: its two clips priced together with one hold; the join costs nothing.
    const film = await post({ feature: "video", modelId: "oss-wan22-14b-fast", prompt: "x", params: { aspectRatio: "16:9", shots: [{ prompt: "wide shot", duration: 3 }, { prompt: "close-up", duration: 3 }] }, ...SHOWN }, a.cookie);
    expect(film.status, JSON.stringify(film.body)).toBe(201);
    const reserves = fake.calls_of("/v1/reserve");
    const filmRun = (reserves.at(-1)!.body as { run: { steps?: { model: string; jobs: number }[] } }).run;
    expect(filmRun.steps?.find((s) => s.model === "oss-wan22-14b-fast")?.jobs).toBe(2);
    expect(filmRun.steps?.every((s) => s.model === "oss-wan22-14b-fast"), JSON.stringify(filmRun.steps)).toBe(true);
    expect(poolRuns(a.id)).toBe(2);
  });

  it("every step must be one the policy allows: a later step's model it leaves out stops the run before anything is made", () => {
    const steps = (models: [string, string][]) => models.map(([modelId, provider], i) => ({ id: `s${i}`, modelId, op: "t2i", provider, kind: "image", presetId: null, waits: i > 0 }));
    const p = { ...billing.OPEN_POLICY, pool: { deny: ["oss-qwen-image-edit"] } };
    expect(hostedRun.stepsProblem(p, steps([["oss-z-image-turbo", "comfyui"]]))).toBeNull();
    expect(hostedRun.stepsProblem(p, steps([["oss-z-image-turbo", "comfyui"], ["oss-qwen-image-edit", "comfyui"]]))).not.toBeNull();
    // A cloud step can't run here; a text step costs nothing and is always allowed.
    expect(hostedRun.stepsProblem(billing.OPEN_POLICY, steps([["oss-z-image-turbo", "comfyui"], ["fal-flux", "fal"]]))).not.toBeNull();
    expect(hostedRun.stepsProblem({ ...billing.OPEN_POLICY, pool: { allow: ["oss-z-image-turbo"] } }, steps([["oss-z-image-turbo", "comfyui"], ["some-llm", "llm"]]))).toBeNull();
    expect(hostedRun.pricedSteps(steps([["oss-z-image-turbo", "comfyui"], ["oss-z-image-turbo", "comfyui"], ["some-llm", "llm"]]))).toEqual([expect.objectContaining({ model: "oss-z-image-turbo", jobs: 2 })]);
  });
});
