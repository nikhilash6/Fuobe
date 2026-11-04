import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { startFakeBilling, type FakeBilling } from "./helpers/fake-billing";
import { tempDir } from "./helpers/temp-dir";

/**
 * The order of the line on this install's GPUs and its install-wide settings: people's paid runs, then their free runs,
 * then the owner's own jobs, each class in the order its jobs came; fair share and the pick allowance; the run ceiling
 * per lane on both clocks; the owner's own wait limit; and GET and PATCH /api/admin/queue/settings.
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 60_000 });

const dir = tempDir("fuobe-pool-line-order-");
process.env.FUOBE_DATA_DIR = dir;
const DEAD = "http://127.0.0.1:7";
process.env.COMFYUI_URL = DEAD;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_HOSTED_RUNS;
delete process.env.FUOBE_HOSTED_FREE;
delete process.env.FUOBE_BILLING_URL;
delete process.env.FUOBE_MODERATION_URL;
globalThis.__fuobeTestDiskFree = 1e13;

const realFetch = globalThis.fetch;
let allowed: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (allowed.some((a) => url.startsWith(a))) return realFetch(input, init);
  return new Response("not reachable in this test", { status: 599 });
}) as typeof fetch;

const auth = await import("@/server/auth");
const admin = await import("@/server/admin-tokens");
const generationsRoute = await import("@/app/api/generations/route");
const settingsRoute = await import("@/app/api/admin/queue/settings/route");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const { getGeneration } = await import("@/server/generations");
const tasks = await import("@/server/computer/tasks");
const pool = await import("@/server/computer/pool");
const billing = await import("@/server/billing");
const qs = await import("@/server/queue-settings");
const { loadManifest, comfyProvider, onComputer, NO_WORKER_FOR_LANE } = await import("@/server/providers/comfyui");
const { loadIndex } = await import("@/server/gpu/index-file");
const { allLanes } = await import("@/lib/lanes");
const { POOL_WORDS } = await import("@/lib/relay");

const HOST = "localhost:3000";
const SITE_HEADERS = { host: HOST, "sec-fetch-site": "same-origin", origin: `http://${HOST}` };
const MIN = 60_000;
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

let fake: FakeBilling;
let accountId = "";
let cookie = "";
let other = "";

beforeAll(async () => {
  fake = await startFakeBilling();
  allowed = [fake.url];
  auth.setPassword("install password");
  accountId = auth.createAccount("line-order@example.com", "long enough").id;
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(accountId).value}`;
  other = auth.createAccount("line-order-2@example.com", "long enough").id;
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  globalThis.__fuobeTestDiskFree = undefined;
  for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_HOSTED_FREE", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN"]) delete process.env[k];
  await fake.close();
});
beforeEach(() => {
  resetRates();
  billing.resetBillingCache();
  qs.saveQueueSettings(qs.QUEUE_DEFAULTS);
  process.env.FUOBE_HOSTED_RUNS = "1";
  process.env.FUOBE_HOSTED_FREE = "1";
  delete process.env.FUOBE_BILLING_URL;
  delete process.env.FUOBE_BILLING_TOKEN;
  fake.reserveExtra = {};
  fake.policy = { ...fake.policy, limits: { activeRuns: 7, waiting: 7, runsPerHour: 70, outputsPerRun: 2, maxMegapixels: 7, maxSeconds: 7, keepDays: 7, spaceBytes: 7_000_000 } };
  setSetting("comfyWhere", "workers");
  setSetting("comfyUrl", "");
  setSetting("engineMode", "open");
  setSetting("demoMode", "off");
  db().prepare("DELETE FROM relay_workers").run();
  // (Finished ones too: fair share counts the runs a worker finished while others waited.)
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state != 'canceled'").run();
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
});

function standInWorker(name = "stand-in") {
  const w = pool.addWorker(name);
  const lanes = allLanes(loadIndex(), sha);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: Object.fromEntries(lanes.map((l) => [l.lane, { delayMs: 0 }])), claimAfterMs: 0 });
  db()
    .prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ? WHERE id = ?")
    .run(JSON.stringify({ lanes: lanes.map((l) => l.lane), workflows: loadManifest().workflows.map((x) => x.id) }), JSON.stringify({ vramBytes: 96 * 2 ** 30 }), w.id);
  // Connected: its worker program beat a moment ago.
  db().prepare("UPDATE relay_workers SET seen_at = ?, protocol = ?, paused_local = 0 WHERE id = ?").run(Date.now(), pool.MIN_PROTOCOL, w.id);
  return w;
}
type WorkerRow = import("@/server/computer/workers").WorkerRow;
const workerRow = (w: { id: string }) => db().prepare("SELECT * FROM relay_workers WHERE id = ?").get(w.id) as WorkerRow;
const beatAs = (w: { id: string }, now = Date.now()) =>
  pool.workerBeat(workerRow(w), pool.cleanBeat({ device: `wkr-${w.id}`, protocol: 2, version: "1", local: { paused: false, why: null, until: null }, gpu: {}, inventoryHash: null, running: [], stopped: [] }), now);
const claimAs = (w: { id: string }, now = Date.now()) => pool.workerClaim(workerRow(w), [], now);
const rowOf = (id: string) => db().prepare("SELECT * FROM relay_tasks WHERE id = ?").get(id) as import("@/server/computer/tasks").TaskRow;
const taskOf = (generationId: string) => db().prepare("SELECT * FROM relay_tasks WHERE generation_id = ? ORDER BY created_at DESC").get(generationId) as import("@/server/computer/tasks").TaskRow | undefined;
const done = (id: string) => db().prepare("UPDATE relay_tasks SET state = 'done', finished_at = ? WHERE id = ?").run(Date.now(), id);

let gens = 0;
/** A task in the line: a person's (with `account`) or the owner's, in a class, made `agoMs` ago. */
function lineTask(o: { account?: string; class?: "paid" | "free" | "owner"; agoMs?: number; lane?: string } = {}) {
  const gid = `line-gen-${++gens}`;
  const at = Date.now() - (o.agoMs ?? 0);
  db()
    .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'queued', ?, '[]', ?, ?)")
    .run(gid, JSON.stringify(o.account ? { account: o.account, place: "pool" } : {}), at, at);
  const lane = o.lane ?? allLanes(loadIndex(), sha)[0].lane;
  const t = tasks.createTask({
    principal: o.account ? `acct:${o.account}` : "owner",
    generationId: gid,
    graph: { "1": { class_type: "SaveImage", inputs: { filename_prefix: "x" } } },
    pool: { pools: ["pool"], account: o.account, class: o.class, rankAt: at, lane, needs: { workflowId: loadManifest().workflows[0].id, files: [], packs: [], minVramBytes: 0 } },
  });
  db().prepare("UPDATE relay_tasks SET created_at = ? WHERE id = ?").run(at, t.id);
  return t.id;
}

/** Every waiting task, claimed one by one by a worker that finishes each at once: the order the line serves them. */
function served(w: { id: string }): string[] {
  const out: string[] = [];
  for (;;) {
    beatAs(w);
    const t = claimAs(w);
    if (!t) return out;
    out.push(t.id);
    done(t.id);
  }
}

describe("classes", () => {
  it("the owner's own job waits behind every person's run, even ones sent long after it", () => {
    const w = standInWorker();
    const owner = lineTask({ agoMs: 60 * MIN });
    const a = lineTask({ account: accountId, agoMs: 10 * MIN });
    const b = lineTask({ account: other, agoMs: 5 * MIN });
    const c = lineTask({ account: accountId, agoMs: 0 });
    expect(rowOf(owner).class).toBe("owner");
    expect(rowOf(a).class).toBe("free");
    // Its place counts every person's run ahead of it.
    expect(pool.placeInLine(rowOf(owner)).place).toBe(4);
    expect(served(w)).toEqual([a, b, c, owner]);
  });

  it("paid runs go before free ones, and each class goes in the order its runs came", () => {
    const w = standInWorker();
    const free1 = lineTask({ account: accountId, agoMs: 30 * MIN });
    const paid1 = lineTask({ account: other, class: "paid", agoMs: 20 * MIN });
    const free2 = lineTask({ account: other, agoMs: 10 * MIN });
    const paid2 = lineTask({ account: accountId, class: "paid", agoMs: 0 });
    expect(pool.placeInLine(rowOf(free1)).place).toBe(3);
    expect(served(w)).toEqual([paid1, paid2, free1, free2]);
  });

  it("a task from before classes reads as the owner's with no account and as a person's free run with one", () => {
    const w = standInWorker();
    const old = lineTask({ agoMs: 20 * MIN });
    const person = lineTask({ account: accountId, agoMs: 10 * MIN });
    db().prepare("UPDATE relay_tasks SET class = NULL WHERE id IN (?, ?)").run(old, person);
    expect(served(w)).toEqual([person, old]);
  });

  it("only people's runs count as runs this worker may take now", () => {
    const w = standInWorker();
    lineTask({ agoMs: 1 * MIN });
    lineTask({ account: accountId });
    expect(beatAs(w).claimableNow).toBe(1);
  });

  it("the owner's ComfyUI job on the workers is the owner's class, with no wait limit unless the owner sets one", async () => {
    standInWorker();
    const route = { provider: "comfyui", endpoint: loadManifest().workflows[0].id, op: "t2i" } as never;
    const submit = (gid: string) => onComputer("owner", () => comfyProvider.submit({ route, input: { prompt: "a lighthouse" } as never, generationId: gid } as never));
    const first = rowOf(String(((await submit("owner-gen-1")).meta as { relay: string }).relay));
    expect(first.class).toBe("owner");
    expect(first.account).toBeNull();
    expect(first.not_after).toBeNull();
    qs.saveQueueSettings({ ...qs.queueSettings(), ownerWaitLimitS: 3600 });
    const second = rowOf(String(((await submit("owner-gen-2")).meta as { relay: string }).relay));
    expect(second.not_after! - second.created_at).toBeGreaterThanOrEqual(3600_000 - 1000);
    expect(second.not_after! - second.created_at).toBeLessThanOrEqual(3600_000 + 1000);
  });

  it("the owner's job that no worker is allowed to run is refused at once, never left waiting", async () => {
    const w = standInWorker();
    const workflow = loadManifest().workflows[0].id;
    const lane = pool.poolLane(workflow);
    const route = { provider: "comfyui", endpoint: workflow, op: "t2i" } as never;
    const submit = (gid: string) => onComputer("owner", () => comfyProvider.submit({ route, input: { prompt: "a lighthouse" } as never, generationId: gid } as never));
    const others = Object.fromEntries(allLanes(loadIndex(), sha).filter((l) => l.lane !== lane).map((l) => [l.lane, { delayMs: 0 }]));
    pool.patchWorker(w.id, { allow: others });
    const before = (db().prepare("SELECT COUNT(*) AS n FROM relay_tasks").get() as { n: number }).n;
    await expect(submit("owner-gen-refused")).rejects.toThrow(NO_WORKER_FOR_LANE);
    expect((db().prepare("SELECT COUNT(*) AS n FROM relay_tasks").get() as { n: number }).n).toBe(before);
    // Allowed the lane again (paused or not), it goes in line.
    pool.patchWorker(w.id, { allow: { ...others, [lane]: { delayMs: 0 } }, paused: true });
    const t = rowOf(String(((await submit("owner-gen-allowed")).meta as { relay: string }).relay));
    expect(t.state).toBe("waiting");
  });
});

describe("the billing service's class and head start", () => {
  it("an account's run takes the class and head start the reserve answer gives", async () => {
    standInWorker();
    process.env.FUOBE_BILLING_URL = fake.url;
    process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
    fake.policy = { ...fake.policy, hosted: true, ttlS: 0 };
    fake.reserveExtra = { class: "paid", boostMs: 60_000 };
    const before = Date.now();
    const r = await generationsRoute.POST(
      new Request(`http://${HOST}/api/generations`, {
        method: "POST",
        headers: { ...SITE_HEADERS, cookie, "content-type": "application/json" },
        body: JSON.stringify({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a lighthouse", shown: { amount: 7, priceVersion: "v7" } }),
      }),
    );
    const body = (await r.json()) as { items?: { id: string }[] };
    expect(r.status, JSON.stringify(body)).toBe(201);
    const id = body.items![0].id;
    let t = taskOf(id);
    for (let i = 0; i < 100 && !t; i++) {
      await globalThis.__fuobeRunner?.tick();
      await new Promise((res) => setTimeout(res, 20));
      t = taskOf(id);
    }
    expect(t?.class).toBe("paid");
    expect(t!.rank_at!).toBeLessThanOrEqual(t!.created_at - 60_000);
    expect(t!.rank_at!).toBeGreaterThanOrEqual(before - 60_000 - 1000);
    // The stored run carries its class for its later steps, and the browser never sees it.
    const stored = JSON.parse((db().prepare("SELECT request_json FROM generations WHERE id = ?").get(id) as { request_json: string }).request_json) as Record<string, unknown>;
    expect(stored.class).toBe("paid");
    expect(stored.boostMs).toBe(60_000);
    const seen = getGeneration(id) as unknown as { request?: Record<string, unknown> };
    expect(seen.request?.class).toBeUndefined();
    expect(seen.request?.boostMs).toBeUndefined();
  });

  it("a head start never passes a day, and a class it doesn't know is free", () => {
    const f = pool.poolFields(loadManifest().workflows[0].id, { account: accountId, boostMs: 7 * 24 * 60 * MIN }, 1_000_000_000_000);
    expect(f.rankAt).toBe(1_000_000_000_000 - 24 * 60 * MIN);
    expect(f.class).toBe("free");
    expect(pool.poolFields(loadManifest().workflows[0].id, {}, 0).class).toBe("owner");
  });
});

describe("fair share", () => {
  it("off: strict order; on: each account's first run goes before anyone's second, counting runs it has going", () => {
    const w = standInWorker();
    const a1 = lineTask({ account: accountId, agoMs: 30 * MIN });
    const a2 = lineTask({ account: accountId, agoMs: 29 * MIN });
    const a3 = lineTask({ account: accountId, agoMs: 28 * MIN });
    const b1 = lineTask({ account: other, agoMs: 10 * MIN });
    const owner = lineTask({ agoMs: 60 * MIN });
    const strict = pool.lineOrder(db().prepare("SELECT * FROM relay_tasks WHERE state = 'waiting' AND pools IS NOT NULL").all() as never, false).map((t) => t.id);
    expect(strict).toEqual([a1, a2, a3, b1, owner]);
    qs.saveQueueSettings({ ...qs.queueSettings(), fairShare: true });
    expect(pool.placeInLine(rowOf(b1)).place).toBe(2);
    expect(served(w)).toEqual([a1, b1, a2, a3, owner]);
  });
});

describe("the pick allowance", () => {
  it("0 (the default): strict order whatever the worker has loaded; set, a loaded lane goes first while the best one is young", () => {
    const lanes = allLanes(loadIndex(), sha).map((l) => l.lane);
    const w = standInWorker();
    db().prepare("UPDATE relay_workers SET warm_lane = ?, switch_after_ms = ? WHERE id = ?").run(lanes[1], 60 * MIN, w.id);
    const old = lineTask({ account: accountId, agoMs: 5 * MIN, lane: lanes[0] });
    const warm = lineTask({ account: other, agoMs: 1 * MIN, lane: lanes[1] });
    beatAs(w);
    db().prepare("UPDATE relay_workers SET warm_lane = ? WHERE id = ?").run(lanes[1], w.id);
    expect(claimAs(w)?.id).toBe(old);
    done(old);
    const old2 = lineTask({ account: accountId, agoMs: 5 * MIN, lane: lanes[0] });
    qs.saveQueueSettings({ ...qs.queueSettings(), pickAllowanceMs: 10 * MIN });
    db().prepare("UPDATE relay_workers SET warm_lane = ? WHERE id = ?").run(lanes[1], w.id);
    expect(pool.workerClaim(workerRow(w), [])?.id).toBe(warm);
    done(warm);
    // Never across classes: the owner's job in the loaded lane waits behind a person's run in another.
    lineTask({ agoMs: 1 * MIN, lane: lanes[1] });
    db().prepare("UPDATE relay_workers SET warm_lane = ? WHERE id = ?").run(lanes[1], w.id);
    expect(pool.workerClaim(workerRow(w), [])?.id).toBe(old2);
  });
});

describe("the run ceiling", () => {
  it("a workflow's lane is worked out once for the catalog, so the runner reads it at no cost on every poll", () => {
    const lanes = allLanes(loadIndex(), sha);
    for (const l of lanes) for (const id of l.workflows) expect(pool.poolLane(id), id).toBe(l.lane);
    expect(pool.poolLane("no-such-workflow")).toBe("small");
    expect(pool.lanesCatalog().map((l) => l.lane)).toEqual(lanes.map((l) => l.lane));
    // Working the lanes out takes milliseconds each time; a thousand lookups take far less than that many times over.
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) pool.poolLane(lanes[i % lanes.length].workflows[0]);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it("a worker's run limit never passes its lane's ceiling, and with no measured run it is the ceiling", () => {
    const [a, b] = allLanes(loadIndex(), sha).map((l) => l.lane);
    expect(pool.runLimitMs(null, a)).toBe(45 * MIN);
    expect(pool.runLimitMs(60_000, a)).toBe(10 * MIN);
    expect(pool.runLimitMs(20 * MIN, a, 2 * MIN)).toBe(45 * MIN);
    qs.saveQueueSettings({ ...qs.queueSettings(), runCeilingS: { default: 1800, lanes: { [b]: 3600 } } });
    expect(pool.runLimitMs(null, a)).toBe(30 * MIN);
    expect(pool.runLimitMs(null, b)).toBe(60 * MIN);
    expect(pool.runLimitMs(15 * MIN, b, 5 * MIN)).toBe(50 * MIN);
  });

  /** An account's run through the run route, and its task once the runner made it. */
  async function accountRun(prompt: string) {
    const r = await generationsRoute.POST(
      new Request(`http://${HOST}/api/generations`, { method: "POST", headers: { ...SITE_HEADERS, cookie, "content-type": "application/json" }, body: JSON.stringify({ feature: "image", modelId: "oss-z-image-turbo", prompt }) }),
    );
    const body = (await r.json()) as { items?: { id: string }[] };
    expect(r.status, JSON.stringify(body)).toBe(201);
    const id = body.items![0].id;
    let t = taskOf(id);
    for (let i = 0; i < 100 && !t; i++) {
      await globalThis.__fuobeRunner?.tick();
      await new Promise((res) => setTimeout(res, 20));
      t = taskOf(id);
    }
    expect(t).toBeDefined();
    return { id, t: t! };
  }
  const tick = () => globalThis.__fuobeRunner?.tick();
  const claimedAgo = (taskId: string, ms: number) => tasks.setTask(taskId, { claimed_at: Date.now() - ms });
  const startedAgo = (id: string, ms: number) => db().prepare("UPDATE generation_runs SET started_at = ? WHERE id = ?").run(Date.now() - ms, id);

  it("a run longer than 45 minutes in a lane with a 60 minute ceiling goes on; past 60 its worker gives it back, and the run's own clock only backs that up", async () => {
    const w = standInWorker();
    const { id, t } = await accountRun("a long one");
    qs.saveQueueSettings({ ...qs.queueSettings(), runCeilingS: { default: 2700, lanes: { [t.lane!]: 3600 } } });
    beatAs(w);
    const got = claimAs(w)!;
    expect(got.id).toBe(t.id);
    expect(got.runLimitMs).toBe(60 * MIN);
    tasks.setTask(t.id, { state: "running", started_at: Date.now() });
    await tick();
    expect(getGeneration(id)?.status).toBe("running");
    // 50 minutes, then 61, into the attempt: the worker's run limit decides, not the run's clock.
    for (const ago of [50 * MIN, 61 * MIN]) {
      claimedAgo(t.id, ago);
      startedAgo(id, ago);
      beatAs(w);
      await tick();
      expect(getGeneration(id)?.status).toBe("running");
    }
    // An attempt that outlasts every clock of the worker's (its files' sending time, the ceiling twice and the time to
    // send its results) is ended by the run's own clock.
    expect(pool.attemptLimitMs(t.lane)).toBe(pool.SENDING_MS + 2 * 60 * MIN + pool.SAVING_MS);
    claimedAgo(t.id, pool.attemptLimitMs(t.lane) + MIN);
    beatAs(w);
    await tick();
    expect(getGeneration(id)?.status).toBe("failed");
    expect(getGeneration(id)?.error).toBe(POOL_WORDS.failed);
  });

  it("a job a worker gives back and takes again between two polls gets its whole time again", async () => {
    const w = standInWorker();
    const { id, t } = await accountRun("given back and taken again");
    beatAs(w);
    const first = claimAs(w)!;
    expect(first.id).toBe(t.id);
    tasks.report(rowOf(t.id), { event: "sent", promptId: first.promptId }, () => ({ error: "unused" }));
    tasks.report(rowOf(t.id), { event: "running", value: 1, max: 4 }, () => ({ error: "unused" }));
    await tick();
    expect(getGeneration(id)?.status).toBe("running");
    // The first attempt began long ago, past the lane's ceiling (45 minutes).
    claimedAgo(t.id, 70 * MIN);
    startedAgo(id, 70 * MIN);
    // The worker gives it back (it stalled) and takes it again before the next poll.
    tasks.report(rowOf(t.id), { event: "give-back", why: "stalled" }, () => ({ error: "unused" }));
    expect(rowOf(t.id).state).toBe("waiting");
    beatAs(w);
    expect(claimAs(w)?.id).toBe(t.id);
    await tick();
    const g = getGeneration(id)!;
    expect(g.status).toBe("running");
    expect(g.message).toBe(POOL_WORDS.working);
  });

  it("a poll that fails never ends a run in line by the runner's own wait, an account's or the owner's", async () => {
    standInWorker();
    const { id } = await accountRun("a poll that fails");
    // The owner's own job on the workers (no wait limit unless the owner sets one).
    const owner = await generationsRoute.POST(
      new Request(`http://${HOST}/api/generations`, {
        method: "POST",
        headers: { ...SITE_HEADERS, cookie: `${auth.SESSION_COOKIE}=${auth.createSession().value}`, "content-type": "application/json" },
        body: JSON.stringify({ feature: "image", modelId: "oss-z-image-turbo", prompt: "the owner's own" }),
      }),
    );
    const ownerBody = (await owner.json()) as { items?: { id: string }[] };
    expect(owner.status, JSON.stringify(ownerBody)).toBe(201);
    const ownerId = ownerBody.items![0].id;
    for (let i = 0; i < 100 && !taskOf(ownerId); i++) {
      await tick();
      await new Promise((res) => setTimeout(res, 20));
    }
    expect(taskOf(ownerId)?.class).toBe("owner");
    await tick();
    // By the runner's own count, both waited past every wait limit it knows (their tasks keep the real ones), and each
    // poll fails (the database is busy).
    for (const g of [id, ownerId]) db().prepare("UPDATE generation_runs SET submitted_at = ?, started_at = NULL WHERE id = ?").run(Date.now() - 5 * 60 * MIN, g);
    const spy = vi.spyOn(comfyProvider, "poll").mockRejectedValue(new Error("database is locked"));
    try {
      await tick();
      await tick();
      expect(spy).toHaveBeenCalled();
      for (const g of [id, ownerId]) expect(getGeneration(g)?.status, g).toBe("queued");
      expect(getGeneration(id)?.message).toBe(POOL_WORDS.inLine);
    } finally {
      spy.mockRestore();
    }
    await tick();
    for (const g of [id, ownerId]) expect(getGeneration(g)?.status, g).toBe("queued");
  });
});

describe("GET and PATCH /api/admin/queue/settings", () => {
  const req = (o: { method?: string; token?: string; cookie?: string; body?: unknown } = {}) =>
    new NextRequest(`http://${HOST}/api/admin/queue/settings`, {
      method: o.method ?? "GET",
      headers: { host: HOST, ...(o.token && { authorization: `Bearer ${o.token}` }), ...(o.cookie && { cookie: o.cookie }), ...(o.body !== undefined && { "content-type": "application/json" }) },
      ...(o.body !== undefined && { body: JSON.stringify(o.body) }),
    });
  const ownerCookie = () => `${auth.SESSION_COOKIE}=${auth.createSession().value}`;
  const audits = () => db().prepare("SELECT * FROM admin_audit WHERE action = 'queue.settings' ORDER BY id").all() as { actor: string; detail_json: string | null; status: number; token_id: string | null }[];

  it("the defaults are today's: a 45 minute ceiling, no owner wait limit, strict order, and 2 hours back in line inside a hold", async () => {
    const res = await settingsRoute.GET(req({ cookie: ownerCookie() }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ settings: { runCeilingS: { default: 2700, lanes: {} }, ownerWaitLimitS: null, fairShare: false, pickAllowanceMs: 0, pausedBudgetS: 7200 } });
  });

  it("the owner changes them; each change is logged with the values before and after", async () => {
    const lane = allLanes(loadIndex(), sha)[0].lane;
    const res = await settingsRoute.PATCH(req({ method: "PATCH", cookie: ownerCookie(), body: { runCeilingS: { default: 3000, lanes: { [lane]: 3600 } }, ownerWaitLimitS: 86_400, fairShare: true, pausedBudgetS: 3600 } }));
    expect(res.status).toBe(200);
    const want = { runCeilingS: { default: 3000, lanes: { [lane]: 3600 } }, ownerWaitLimitS: 86_400, fairShare: true, pickAllowanceMs: 0, pausedBudgetS: 3600 };
    expect(await res.json()).toEqual({ settings: want });
    expect(qs.queueSettings()).toEqual(want);
    const row = audits().at(-1)!;
    expect(row.actor).toBe("owner");
    expect(row.status).toBe(200);
    expect(JSON.parse(row.detail_json!)).toEqual({ before: qs.QUEUE_DEFAULTS, after: want });
    // A field left out keeps its value; null takes the owner's wait limit away.
    const back = await settingsRoute.PATCH(req({ method: "PATCH", cookie: ownerCookie(), body: { ownerWaitLimitS: null } }));
    expect(((await back.json()) as { settings: unknown }).settings).toEqual({ ...want, ownerWaitLimitS: null });
  });

  it("refuses values out of bounds, unknown settings and unknown lanes, and changes nothing", async () => {
    const before = qs.queueSettings();
    for (const body of [
      { runCeilingS: { default: 10 } },
      { runCeilingS: { default: 3000, lanes: { "not-a-lane": 3000 } } },
      { runCeilingS: { default: 3000, lanes: { small: 999_999 } } },
      { ownerWaitLimitS: -1 },
      { fairShare: "yes" },
      { pickAllowanceMs: 1.5 },
      { pausedBudgetS: -1 },
      { pausedBudgetS: 8 * 24 * 3600 },
      { somethingElse: 1 },
      [1, 2],
      null,
    ]) {
      const res = await settingsRoute.PATCH(req({ method: "PATCH", cookie: ownerCookie(), body }));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(typeof ((await res.json()) as { error: string }).error).toBe("string");
    }
    expect(qs.queueSettings()).toEqual(before);
    expect(audits().at(-1)!.status).toBe(400);
  });

  it("a stored value that isn't valid reads as the defaults", () => {
    db().prepare("INSERT INTO settings (key, value) VALUES ('queue.settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run("{not json");
    globalThis.__fuobeQueueSettings = undefined;
    expect(qs.queueSettings()).toEqual(qs.QUEUE_DEFAULTS);
  });

  it("an admin token reads them with queue:read and changes them with queue:write", async () => {
    const make = (scopes: import("@/server/admin-tokens").Scope[]) => admin.createAdminToken({ name: `t-${Math.random()}`, scopes });
    const reader = make(["queue:read"]);
    const writer = make(["queue:write"]);
    expect((await settingsRoute.GET(req({ token: reader.token }))).status).toBe(200);
    expect((await settingsRoute.GET(req({ token: writer.token }))).status).toBe(403);
    expect((await settingsRoute.PATCH(req({ method: "PATCH", token: reader.token, body: { fairShare: true } }))).status).toBe(403);
    const ok = await settingsRoute.PATCH(req({ method: "PATCH", token: writer.token, body: { pickAllowanceMs: 60_000 } }));
    expect(ok.status).toBe(200);
    expect(audits().at(-1)!.token_id).toBe(writer.info.id);
    // Nobody else.
    expect((await settingsRoute.GET(req())).status).toBe(403);
    expect((await settingsRoute.PATCH(req({ method: "PATCH", cookie, body: { fairShare: true } }))).status).toBe(403);
  });
});
