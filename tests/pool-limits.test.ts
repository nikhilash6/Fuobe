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
  pool.workerBeat(workerRow(), pool.cleanBeat({ device: `wkr-${worker.id}`, protocol: 1, version: "1", local: { paused: false, why: null, until: null }, gpu: {}, inventoryHash: null, running: [], stopped: [] }));
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
      expect(third.body.error).toBe(limits.POOL_LIMIT_WORDS.hourly);
    } finally {
      Object.assign(billing.OPEN_POLICY.limits, was);
    }
    expect(poolRuns(a.id)).toBe(2);
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
    expect(third.body.error).toBe(limits.POOL_LIMIT_WORDS.address);
    expect((await post({ ...IMAGE, ...SHOWN }, b.cookie, { "x-forwarded-for": "198.51.100.4" })).status).toBe(201);
    const kept = db().prepare("SELECT addr FROM pool_admissions WHERE addr IS NOT NULL").all() as { addr: string }[];
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((r) => /^[0-9a-f]{32}$/.test(r.addr) && !r.addr.includes("203"))).toBe(true);
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
    // Named, it is a refusal (the person asked for that place).
    const named = await post({ ...IMAGE, place: "pool", ...SHOWN }, a.cookie);
    expect(named.status).toBe(403);
    expect(named.body.code).toBe("not-offered");
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
    expect(r.body.code).toBe("not-offered");
    expect(hostedRun.kindAllowed({ kinds: { image: false } }, "video")).toBe(true);
    expect(hostedRun.kindAllowed({}, "model3d")).toBe(true);
  });

  it("3D isn't offered on this install's GPUs yet, even with kinds.model3d on: an account with no GPU of its own is asked to connect one", async () => {
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
    expect(r.body.code).toBe("own-gpu-tool");
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
    await until(() => r.body.items!.every((g) => taskOf(g.id)));
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
    expect(r.body.code).toBe("not-offered");
    expect(poolRuns(a.id)).toBe(0);
    expect(fake.holds.size).toBe(holds);
    // Its price check says the same: not here.
    expect((await preview(film, a.cookie)).body.place).toBeUndefined();
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
