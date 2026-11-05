import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeBilling, type FakeBilling } from "./helpers/fake-billing";
import { startLocalComfy, type LocalComfy } from "./helpers/fake-local-comfy";
import { apiAs, loadRoutes, sha256, type ComputerRoutes } from "./helpers/computer-tab";
import { tempDir } from "./helpers/temp-dir";
import { composeOnWorker, graphOfTask } from "./helpers/ticket-worker";

/**
 * Account runs on this install's GPUs go through the workers' line: each job of an account's run is a task for the
 * workers that belongs to the account, never a request to a ComfyUI address. The account sees only "In line", "Working"
 * and its result; an account's own session can never take or read such a task; a task back in line keeps its place and
 * shows "In line" again; and with hosted runs off nothing changes. (The line's own rules for every job, one job per
 * worker among them: tests/worker-queue.test.ts.)
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 60_000 });

const dir = tempDir("fuobe-pool-account-runs-");
process.env.FUOBE_DATA_DIR = dir;
// Nothing answers here: no test may reach a real ComfyUI on this machine. (Not port 9: the tests point local AI
// helpers there.)
const DEAD = "http://127.0.0.1:7";
process.env.COMFYUI_URL = DEAD;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_HOSTED_RUNS;
delete process.env.FUOBE_HOSTED_FREE;
delete process.env.FUOBE_BILLING_URL;
delete process.env.FUOBE_MODERATION_URL;
globalThis.__fuobeTestDiskFree = 1e13;

// The server's own fetch: recorded. Anything but the stand-ins answers 599 at once (no real network).
const realFetch = globalThis.fetch;
const fetched: string[] = [];
let allowed: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  fetched.push(url);
  if (allowed.some((a) => url.startsWith(a))) return realFetch(input, init);
  return new Response("not reachable in this test", { status: 599 });
}) as typeof fetch;

const auth = await import("@/server/auth");
const generationsRoute = await import("@/app/api/generations/route");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const { getGeneration, toGeneration } = await import("@/server/generations");
const tasks = await import("@/server/computer/tasks");
const pool = await import("@/server/computer/pool");
const hosted = await import("@/server/hosted");
const billing = await import("@/server/billing");
const { listAccountRuns } = await import("@/server/account-admin");
const { loadManifest, withoutSaveMetadata, planRelayOutputs, onComputer, OWN_OUTPUT_LIMITS } = await import("@/server/providers/comfyui");
const { accountTotalBytes, accountUsage, diskFloorBytes } = await import("@/server/account-files");
const { loadIndex } = await import("@/server/gpu/index-file");
const { allLanes } = await import("@/lib/lanes");
const { getModel } = await import("@/lib/catalog");
const { ComputerRunner } = await import("@/lib/computer-runner");
const { POOL_WORDS } = await import("@/lib/relay");
const { ACCOUNT_MESSAGES } = await import("@/server/account-files");
const { catalogVersion } = await import("@/server/computer/catalog-version");

const HOST = "localhost:3000";
const SITE_HEADERS = { host: HOST, "sec-fetch-site": "same-origin", origin: `http://${HOST}` };
const MIN = 60_000;
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

let comfy: LocalComfy;
let routes: ComputerRoutes;
let fake: FakeBilling;
let accountId = "";
let cookie = "";
let computerAccount = "";
let computerCookie = "";

beforeAll(async () => {
  comfy = await startLocalComfy({ cors: "*", steps: 2, stepMs: 10, latencyMs: 10 });
  allowed = [comfy.url];
  routes = await loadRoutes();
  fake = await startFakeBilling();
  allowed.push(fake.url);
  auth.setPassword("install password");
  accountId = auth.createAccount("pool-runs@example.com", "long enough").id;
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(accountId).value}`;
  // An account whose own GPU is "this computer": its session reaches the computer routes as acct:<id>.
  computerAccount = auth.createAccount("own-computer@example.com", "long enough").id;
  auth.setAccountGpu(computerAccount, { mode: "computer" });
  computerCookie = `${auth.SESSION_COOKIE}=${auth.createSession(computerAccount).value}`;
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  globalThis.__fuobeTestDiskFree = undefined;
  for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_HOSTED_FREE", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN"]) delete process.env[k];
  await comfy.close();
  await fake.close();
});
beforeEach(() => {
  resetRates();
  billing.resetBillingCache();
  process.env.FUOBE_HOSTED_RUNS = "1";
  process.env.FUOBE_HOSTED_FREE = "1";
  delete process.env.FUOBE_BILLING_URL;
  process.env.COMFYUI_URL = DEAD;
  setSetting("comfyWhere", "workers");
  setSetting("comfyUrl", "");
  setSetting("engineMode", "open");
  setSetting("demoMode", "off");
  db().prepare("DELETE FROM relay_workers").run();
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
  fetched.length = 0;
});

/** A worker the owner added and resumed, allowed every lane, able to run every workflow. */
function standInWorker(name = "stand-in", o: { paused?: boolean } = {}) {
  const w = pool.addWorker(name);
  const lanes = allLanes(loadIndex(), sha);
  pool.patchWorker(w.id, { paused: !!o.paused, hours: { always: true }, allow: Object.fromEntries(lanes.map((l) => [l.lane, { delayMs: 0 }])), claimAfterMs: 0 });
  db()
    .prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ?, catalog_version = ? WHERE id = ?")
    .run(JSON.stringify({ lanes: lanes.map((l) => l.lane), workflows: loadManifest().workflows.map((x) => x.id) }), JSON.stringify({ vramBytes: 96 * 2 ** 30 }), catalogVersion(), w.id);
  return w;
}

/**
 * The worker program's side, as `fuobe worker run` drives it: the shared runner with the worker's token, its own
 * ComfyUI, and its composer for job tickets.
 */
function workerRunner(token: string) {
  const api = apiAs(routes, null, { authorization: `Bearer ${token}` });
  return new ComputerRunner(
    {
      api,
      local: (url, init) => realFetch(url, init),
      socket: (url) => new WebSocket(url) as never,
      sha256,
      origin: "http://localhost:3000",
      sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 50))),
      compose: (t) => composeOnWorker(t),
      beatExtra: () => ({ protocol: 3, version: "test", local: { paused: false, why: null, until: null }, gpu: { otherApps: [], tempC: null }, inventoryHash: null, warmLane: null, catalogVersion: catalogVersion() }),
    },
    { device: "worker", port: comfy.port, clientId: "worker-test" },
  );
}

const request = (url: string, o: { method?: string; body?: unknown; cookie?: string | null; headers?: Record<string, string> } = {}) => {
  const text = o.body === undefined ? undefined : JSON.stringify(o.body);
  const headers: Record<string, string> = { ...SITE_HEADERS, ...(o.cookie !== null && { cookie: o.cookie ?? cookie }), ...(text && { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }), ...o.headers };
  return new Request(`http://${HOST}${url}`, { method: o.method ?? (text ? "POST" : "GET"), headers, body: text });
};
const run = async (body: Record<string, unknown>, c = cookie) => {
  const r = await generationsRoute.POST(request("/api/generations", { body, cookie: c }));
  return { status: r.status, body: (await r.json()) as { items?: { id: string }[]; code?: string; error?: string } };
};
const tick = () => globalThis.__fuobeRunner?.tick();
const taskOf = (generationId: string) => db().prepare("SELECT * FROM relay_tasks WHERE generation_id = ? ORDER BY created_at DESC").get(generationId) as import("@/server/computer/tasks").TaskRow | undefined;
const rowOf = (id: string) => db().prepare("SELECT * FROM relay_tasks WHERE id = ?").get(id) as import("@/server/computer/tasks").TaskRow;
async function until<T>(fn: () => T | Promise<T>, tries = 200, everyMs = 25): Promise<T> {
  let v = await fn();
  for (let i = 0; i < tries && !v; i++) {
    await tick();
    await new Promise((r) => setTimeout(r, everyMs));
    v = await fn();
  }
  return v;
}
/** Requests to a ComfyUI address the server made itself (the stand-in worker's own ComfyUI is the worker's, not the server's). */
const serverComfyCalls = () => fetched.filter((u) => u.startsWith(`${DEAD}/`) || /:818[89]\b|:819[01]\b/.test(u) || /\/(prompt|upload\/image|system_stats|history|view|queue|object_info)\b/.test(u));

/** An account's task made straight in the line (no run route), for the queue's own rules. */
let gens = 0;
function accountTask(o: { lane?: string; account?: string; rankAt?: number; notAfter?: number; workflow?: string } = {}) {
  const gid = `pool-gen-${++gens}`;
  const now = Date.now();
  db()
    .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'queued', ?, '[]', ?, ?)")
    .run(gid, JSON.stringify({ account: o.account ?? accountId, place: "pool" }), now, now);
  const lanes = allLanes(loadIndex(), sha);
  const t = tasks.createTask({
    principal: `acct:${o.account ?? accountId}`,
    generationId: gid,
    graph: { "1": { class_type: "SaveImage", inputs: { filename_prefix: "x" } } },
    pool: { pools: ["pool"], account: o.account ?? accountId, rankAt: o.rankAt ?? now, lane: o.lane ?? lanes[0]?.lane ?? "small", needs: { workflowId: o.workflow ?? loadManifest().workflows[0].id, files: [], packs: [], minVramBytes: 0 }, notAfter: o.notAfter },
  });
  return { id: t.id, generationId: gid };
}

type WorkerRow = import("@/server/computer/workers").WorkerRow;
const workerRow = (w: { id: string }) => db().prepare("SELECT * FROM relay_workers WHERE id = ?").get(w.id) as WorkerRow;
const beatAs = (w: { id: string }, now = Date.now()) =>
  pool.workerBeat(workerRow(w), pool.cleanBeat({ device: `wkr-${w.id}`, protocol: 3, version: "1", local: { paused: false, why: null, until: null }, gpu: {}, inventoryHash: null, running: [], stopped: [], catalogVersion: catalogVersion() }), now);
const claimAs = (w: { id: string }, running: string[] = [], now = Date.now()) => pool.workerClaim(workerRow(w), running, now);

describe("with hosted runs off, nothing changes", () => {
  it("an account with no GPU of its own gets today's answer, and no task is made", async () => {
    delete process.env.FUOBE_HOSTED_RUNS;
    standInWorker();
    expect(hosted.poolReady()).toBe(false);
    const before = (db().prepare("SELECT COUNT(*) AS n FROM relay_tasks").get() as { n: number }).n;
    const r = await run({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a lighthouse" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("connect-gpu");
    expect((db().prepare("SELECT COUNT(*) AS n FROM relay_tasks").get() as { n: number }).n).toBe(before);
    expect(serverComfyCalls()).toEqual([]);
  });

  it("switched on with nothing to answer for the runs (no billing service, no free runs), they stay closed", async () => {
    delete process.env.FUOBE_HOSTED_FREE;
    standInWorker();
    expect(hosted.poolReady()).toBe(false);
    const r = await run({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a lighthouse" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("connect-gpu");
    // A billing service that answers opens them.
    process.env.FUOBE_BILLING_URL = fake.url;
    process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
    expect(hosted.poolReady()).toBe(true);
  });
});

describe("where hosted runs may go", () => {
  it("on the workers: a worker the owner allowed a lane, paused or not; none at all closes them", () => {
    expect(hosted.poolReady()).toBe(false);
    const w = standInWorker("paused one", { paused: true });
    expect(hosted.poolReady()).toBe(true);
    pool.patchWorker(w.id, { revoke: true });
    expect(hosted.poolReady()).toBe(false);
  });

  it("on this install's own ComfyUI server: only an address on this machine", () => {
    setSetting("comfyWhere", "server");
    setSetting("comfyUrl", "http://127.0.0.1:3399");
    expect(hosted.poolReady()).toBe(true);
    for (const url of ["http://10.0.0.5:8188", "https://comfy.example.com", "http://studio:3399"]) {
      setSetting("comfyUrl", url);
      expect(hosted.poolReady(), url).toBe(false);
    }
    setSetting("comfyWhere", "computer");
    setSetting("comfyUrl", "http://127.0.0.1:3399");
    expect(hosted.poolReady()).toBe(false);
  });
});

describe("an account's run on the workers", () => {
  it("with no ComfyUI address the server could reach, it becomes the account's task, and a stand-in worker renders it", async () => {
    const w = standInWorker();
    const r = await run({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a lighthouse at dusk" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.items![0].id;
    const t = await until(() => taskOf(id));
    expect(t).toBeDefined();
    expect(t!.principal).toBe(`acct:${accountId}`);
    expect(t!.pools).toBe("pool");
    expect(t!.account).toBe(accountId);
    // It waits in line, in plain words, with its place.
    await until(() => getGeneration(id)?.message === POOL_WORDS.inLine);
    const waiting = getGeneration(id)!;
    expect(waiting.message).toBe(POOL_WORDS.inLine);
    expect(waiting.queue?.place).toBe(1);
    expect(waiting.place).toBe("pool");

    // The worker takes it through the same routes as every worker, and renders it on its own ComfyUI.
    const worker = workerRunner(w.token);
    const beat = await worker.beat();
    expect(beat?.claimableNow).toBe(1);
    await worker.claimAndRun();
    expect(rowOf(t!.id).state).toBe("done");
    const g = await until(() => {
      const x = getGeneration(id);
      return x && x.status !== "queued" && x.status !== "running" ? x : null;
    });
    expect(g?.status, g?.error ?? "").toBe("succeeded");
    expect(g!.outputs.length).toBeGreaterThan(0);
    // The server never called a ComfyUI address for it.
    expect(serverComfyCalls()).toEqual([]);
    // The workers' log: who took it, and how it ended.
    const log = db().prepare("SELECT event, worker_id, principal FROM worker_jobs WHERE task_id = ? ORDER BY id").all(t!.id) as { event: string; worker_id: string; principal: string }[];
    expect(log.map((x) => x.event)).toEqual(["claimed", "finished", "done"]);
    expect(log.every((x) => x.worker_id === w.id && x.principal === `acct:${accountId}`)).toBe(true);
  });

  it("an account's own session can never claim or read a task for the workers, even one of its own runs", async () => {
    standInWorker();
    const mine = accountTask({ account: computerAccount });
    const api = apiAs(routes, computerCookie);
    // Claim: nothing (a task for the workers is never a computer's own).
    const claim = await api("/api/gpu/computer/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device: "device-own-1", running: [] }) });
    expect(claim.status).toBe(204);
    // A worker takes it; the account then names it with any lease: unknown.
    const w = db().prepare("SELECT * FROM relay_workers LIMIT 1").get() as { id: string };
    beatAs(w);
    const got = claimAs(w)!;
    expect(got.id).toBe(mine.id);
    for (const [path, init] of [
      [`/api/gpu/computer/tasks/${mine.id}/report`, { method: "POST", headers: { "x-fuobe-lease": got.lease, "Content-Type": "application/json" }, body: JSON.stringify({ event: "running", value: 1, max: 2 }) }],
      [`/api/gpu/computer/tasks/${mine.id}/inputs/0`, { headers: { "x-fuobe-lease": got.lease } }],
      [`/api/gpu/computer/tasks/${mine.id}/outputs/0`, { headers: { "x-fuobe-lease": got.lease } }],
      [`/api/gpu/computer/tasks/${mine.id}/release`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lease: got.lease }) }],
    ] as [string, RequestInit][]) {
      const res = await api(path, init);
      expect(res.status, path).toBe(404);
    }
    // A beat that names it (even under the worker's device) touches nothing of it, and hears no stop of it.
    tasks.setTask(mine.id, { stop: 1 });
    const beat = await api("/api/gpu/computer/beat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device: `wkr-${w.id}`, running: [{ task: mine.id, value: 9, max: 9 }], stopped: [mine.id] }) });
    expect(beat.status).toBe(200);
    expect(((await beat.json()) as { stops: unknown[] }).stops).toEqual([]);
    expect(rowOf(mine.id).stop).toBe(1);
    expect(tasks.getTask(`acct:${computerAccount}`, mine.id)).toBeNull();
    // The server's own reads, as the run's account, still find it.
    expect(tasks.ownTask(`acct:${computerAccount}`, mine.id)?.id).toBe(mine.id);
  });

  it("refuses a run that no worker would ever take, before anything is queued", async () => {
    const w = standInWorker();
    pool.patchWorker(w.id, { allow: {} });
    pool.addWorker("lane-less");
    const before = (db().prepare("SELECT COUNT(*) AS n FROM relay_tasks").get() as { n: number }).n;
    const r = await run({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a lighthouse" });
    expect(r.status).toBe(403);
    expect((db().prepare("SELECT COUNT(*) AS n FROM relay_tasks").get() as { n: number }).n).toBe(before);
  });

  it("refuses a run whose lane a worker is allowed but whose files no worker has, before anything is queued", async () => {
    const w = standInWorker();
    const endpoint = getModel("oss-z-image-turbo")!.routes.find((x) => x.provider === "comfyui")!.endpoint;
    const workflows = loadManifest().workflows.map((x) => x.id);
    const lanesNow = JSON.parse(workerRow(w).lanes_json ?? "{}") as { lanes: string[] };
    // Allowed every lane, but its last list of files lacks this workflow's: nothing it could ever run.
    db().prepare("UPDATE relay_workers SET lanes_json = ? WHERE id = ?").run(JSON.stringify({ lanes: [], workflows: workflows.filter((x) => x !== endpoint) }), w.id);
    const before = (db().prepare("SELECT COUNT(*) AS n FROM relay_tasks").get() as { n: number }).n;
    const r = await run({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a lighthouse" });
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.code).toBe("not-offered");
    expect((db().prepare("SELECT COUNT(*) AS n FROM relay_tasks").get() as { n: number }).n).toBe(before);
    // Its files are there again: the run goes in line.
    db().prepare("UPDATE relay_workers SET lanes_json = ? WHERE id = ?").run(JSON.stringify({ ...lanesNow, workflows }), w.id);
    expect((await run({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a lighthouse" })).status).toBe(201);
  });

  it("a file input in params.extra is one the run sent, never a name in the workers' folders", async () => {
    standInWorker();
    const uploadsRoute = await import("@/app/api/uploads/route");
    const { TINY_PNG } = await import("./helpers/fake-comfy-runner");
    const up = await uploadsRoute.POST(
      new Request(`http://${HOST}/api/uploads`, { method: "POST", headers: { ...SITE_HEADERS, cookie, "content-type": "image/png", "x-file-name": "me.png", "content-length": String(TINY_PNG.length) }, body: new Uint8Array(TINY_PNG) }),
    );
    expect(up.status).toBe(201);
    const { url } = (await up.json()) as { url: string };
    // A workflow that loads a picture: the name in params.extra would replace the picture the run sent.
    const r = await run({ feature: "image", modelId: "oss-rmbg", op: "bg-remove", inputs: { images: [url] }, params: { extra: { image: "fuobe_someone_elses.png" } } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const t = await until(() => taskOf(r.body.items![0].id));
    expect(t).toBeDefined();
    // It goes as a job ticket: no graph, and the name the run didn't send isn't in it.
    expect(t!.graph_json).toBeNull();
    expect(t!.ticket_json ?? "").not.toContain("fuobe_someone_elses.png");
    // The picture the worker's graph loads is the one this run sent, kept for its task.
    const graph = await graphOfTask(t!);
    const loaded = Object.values(graph)
      .filter((x) => x.class_type === "LoadImage")
      .map((x) => String(x.inputs.image));
    expect(loaded).toHaveLength(1);
    const staged = db().prepare("SELECT principal, task_id FROM relay_inputs WHERE name = ?").get(loaded[0]) as { principal: string; task_id: string | null } | undefined;
    expect(staged).toEqual({ principal: `acct:${accountId}`, task_id: t!.id });
  });

  it("a graph that names a file the run didn't send is refused before it is queued", async () => {
    const { graphProblem } = await import("@/lib/local-comfy");
    const graph = { "1": { class_type: "LoadImage", inputs: { image: "fuobe_someone_elses.png" } }, "2": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "x" } } };
    expect(graphProblem(graph as never, ["fuobe_mine.png"])).toBeTruthy();
    expect(graphProblem({ ...graph, "1": { class_type: "LoadImage", inputs: { image: "fuobe_mine.png" } } } as never, ["fuobe_mine.png"])).toBeNull();
  });
});

describe("the line", () => {
  it("a requeue keeps the run's place (rank_at), it shows In line again, and its wait limit is over", async () => {
    const w = standInWorker();
    const first = accountTask({ rankAt: Date.now() - 5 * MIN, notAfter: Date.now() + MIN });
    const later = accountTask({ rankAt: Date.now() });
    const rank = rowOf(first.id).rank_at;
    beatAs(w);
    expect(claimAs(w)?.id).toBe(first.id);
    // The worker pauses at once (another program on the GPU): the job goes back in line at no cost.
    pool.workerBeat(
      db().prepare("SELECT * FROM relay_workers WHERE id = ?").get(w.id) as never,
      pool.cleanBeat({ device: `wkr-${w.id}`, protocol: 3, version: "1", local: { paused: true, why: "gpu-busy:game.exe", until: null }, gpu: {}, running: [{ task: first.id }], stopped: [] }),
    );
    const back = rowOf(first.id);
    expect(back.state).toBe("waiting");
    expect(back.rank_at).toBe(rank);
    expect(back.requeues).toBe(0);
    // First in line again, ahead of the later run, and past its wait limit it still waits: a worker took it once.
    expect(pool.queueOfGeneration(first.generationId)?.place).toBe(1);
    expect(pool.queueOfGeneration(later.generationId)?.place).toBe(2);
    pool.sweepPool(Date.now() + 10 * MIN);
    expect(rowOf(first.id).state).toBe("waiting");
    // A run no worker has taken yet still fails at its wait limit, not charged.
    const never = accountTask({ notAfter: Date.now() + MIN });
    pool.sweepPool(Date.now() + 2 * MIN);
    expect(rowOf(never.id).state).toBe("failed");
    // Its row says In line, never a pause or a GPU word.
    const g = toGeneration(db().prepare("SELECT * FROM generations WHERE id = ?").get(first.generationId) as never);
    expect(g.message).toBe(POOL_WORDS.inLine);
  });

  it("back in line after an attempt, it shows In line with no progress from the attempt before", async () => {
    const w = standInWorker();
    const r = await run({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a lighthouse at dusk" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.items![0].id;
    const t = (await until(() => taskOf(id)))!;
    beatAs(w);
    const got = claimAs(w)!;
    expect(got.id).toBe(t.id);
    tasks.report(rowOf(t.id), { event: "sent", promptId: got.promptId }, () => ({ error: "unused" }));
    tasks.report(rowOf(t.id), { event: "running", value: 3, max: 4 }, () => ({ error: "unused" }));
    const working = await until(() => {
      const g = getGeneration(id);
      return g?.status === "running" && (g.progress ?? 0) > 0 ? g : null;
    });
    expect(working?.message).toBe(POOL_WORDS.working);
    // The worker pauses at once (its owner pressed the pause): the run goes back in line.
    pool.workerBeat(
      db().prepare("SELECT * FROM relay_workers WHERE id = ?").get(w.id) as never,
      pool.cleanBeat({ device: `wkr-${w.id}`, protocol: 3, version: "1", local: { paused: true, why: "here-now", until: null }, gpu: {}, running: [{ task: t.id }], stopped: [] }),
    );
    const back = await until(() => {
      const g = getGeneration(id);
      return g?.status === "queued" ? g : null;
    });
    expect(back?.message).toBe(POOL_WORDS.inLine);
    expect(back?.progress).toBeNull();
    expect((db().prepare("SELECT progress FROM generations WHERE id = ?").get(id) as { progress: number | null }).progress).toBeNull();
    // A row in line never shows a progress it kept from before.
    db().prepare("UPDATE generations SET progress = 0.6 WHERE id = ?").run(id);
    expect(getGeneration(id)?.progress).toBeNull();
  });

  it("place and wait count every task ahead in the order the workers serve them, whatever its lane", () => {
    const w = standInWorker();
    const lanes = allLanes(loadIndex(), sha).map((l) => l.lane);
    expect(lanes.length).toBeGreaterThan(1);
    const now = Date.now();
    accountTask({ lane: lanes[0], rankAt: now - 3 * MIN });
    accountTask({ lane: lanes[1], rankAt: now - 2 * MIN });
    const mine = accountTask({ lane: lanes[0], rankAt: now - MIN });
    beatAs(w);
    const place = pool.queueOfGeneration(mine.generationId);
    expect(place?.place).toBe(3);
    expect(place?.etaSeconds).toBeGreaterThan(0);
    // The billing service's line facts read the same line.
    const facts = hosted.queueFacts(accountId, loadManifest().workflows[0].id);
    expect(facts.ahead).toBe(3);
    expect(facts.workersOnline).toBe(1);
    expect(facts.mine.waiting).toBe(3);
  });

});

describe("what an account reads about its run", () => {
  it("a failed run on this install's GPUs shows one plain sentence and no Fix it; the owner reads the reason", () => {
    const now = Date.now();
    const id = `plain-${now}`;
    db()
      .prepare(
        "INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, error, fix_json, created_at, updated_at) VALUES (?, 'image', 'oss-z-image-turbo', 'open', 'comfyui', 't2i', 'image', 'failed', ?, '[]', ?, ?, ?, ?)",
      )
      .run(id, JSON.stringify({ account: accountId, place: "pool", feature: "image", modelId: "oss-z-image-turbo" }), "Can't reach ComfyUI at http://10.0.0.5:8188 (C:\\Users\\x\\ComfyUI)", JSON.stringify({ code: "comfy_missing_node", items: [] }), now, now);
    const g = getGeneration(id)!;
    expect(g.error).toBe(POOL_WORDS.failed);
    expect(g.fix).toBeUndefined();
    const owner = listAccountRuns({ account: accountId }).items.find((x) => x.id === id);
    expect(owner?.detail).toContain("Can't reach ComfyUI");
    // Fuobe's own words about the account's side stay as they are.
    db().prepare("UPDATE generations SET error = ? WHERE id = ?").run("Your files have reached 3 GB. Delete some runs to make room.", id);
    expect(getGeneration(id)!.error).toBe("Your files have reached 3 GB. Delete some runs to make room.");
    for (const words of [ACCOUNT_MESSAGES.imageTooBig, ACCOUNT_MESSAGES.wrongType, ACCOUNT_MESSAGES.uploadsFull]) {
      db().prepare("UPDATE generations SET error = ? WHERE id = ?").run(words, id);
      expect(getGeneration(id)!.error).toBe(words);
    }
    // Words about the server's own state (its disk, how busy it is) are not the account's to act on: one plain sentence.
    for (const words of [ACCOUNT_MESSAGES.diskLow, ACCOUNT_MESSAGES.finishBusy, ACCOUNT_MESSAGES.finishRate, ACCOUNT_MESSAGES.uploadsBusy]) {
      db().prepare("UPDATE generations SET error = ? WHERE id = ?").run(words, id);
      expect(getGeneration(id)!.error, words).toBe(POOL_WORDS.failed);
    }
  });

  it("its output check is part of Working, and a stopped run says Not charged only when its hold set something aside", () => {
    const now = Date.now();
    const insert = (id: string, status: string, request: Record<string, unknown>, stage: string | null = null) =>
      db()
        .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, stage, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', ?, ?, ?, '[]', ?, ?)")
        .run(id, status, stage, JSON.stringify({ account: accountId, ...request }), now, now);
    insert(`check-pool-${now}`, "running", { place: "pool" }, "checking");
    insert(`check-own-${now}`, "running", {}, "checking");
    const pooled = getGeneration(`check-pool-${now}`)!;
    expect(pooled.stage).toBeUndefined();
    expect(pooled.message).toBe(POOL_WORDS.working);
    // On the account's own GPU, as before.
    expect(getGeneration(`check-own-${now}`)!.stage).toBe("checking");
    insert(`charged-${now}`, "canceled", { place: "pool", hold: "h_1", charged: true });
    insert(`free-${now}`, "failed", { place: "pool", hold: "h_2" });
    expect(getGeneration(`charged-${now}`)!.notCharged).toBe(true);
    expect(getGeneration(`free-${now}`)!.notCharged).toBeUndefined();
    // Neither field ever reaches the page's copy of the request.
    expect("charged" in getGeneration(`charged-${now}`)!.request).toBe(false);
  });

  it("while it goes, only In line or Working, whatever the technical words were", () => {
    const now = Date.now();
    const id = `words-${now}`;
    db()
      .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, message, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'running', ?, '[]', ?, ?, ?)")
      .run(id, JSON.stringify({ account: accountId, place: "pool" }), "In ComfyUI's queue · 2 ahead", now, now);
    expect(getGeneration(id)!.message).toBe(POOL_WORDS.working);
    db().prepare("UPDATE generations SET status = 'queued', message = 'Back in line for another GPU' WHERE id = ?").run(id);
    expect(getGeneration(id)!.message).toBe(POOL_WORDS.inLine);
  });
});

describe("an account's run that a worker can't finish", () => {
  /** Words that must never reach an account's run on this install's GPUs. */
  const JARGON = /ComfyUI|GPU|worker|lane|Press Retry|refused|stopped answering|busy|restart/i;
  const MIN_ = 60_000;

  /** An account's run through the run route, waiting for the workers. */
  async function accountRun() {
    const r = await run({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a lighthouse at dusk" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.items![0].id;
    const t = await until(() => taskOf(id));
    expect(t).toBeDefined();
    return { id, taskId: t!.id };
  }
  /** The worker program's own calls (its token), as `fuobe worker run` makes them. */
  function workerApi(token: string) {
    const api = apiAs(routes, null, { authorization: `Bearer ${token}` });
    const json = { "content-type": "application/json" };
    return {
      claim: async () => ((await (await api("/api/gpu/computer/claim", { method: "POST", headers: json, body: JSON.stringify({ device: "worker", running: [] }) })).json()) as { task: { id: string; lease: string; promptId: string } | null }).task,
      report: (t: { id: string; lease: string }, body: Record<string, unknown>) => api(`/api/gpu/computer/tasks/${t.id}/report`, { method: "POST", headers: { ...json, "x-fuobe-lease": t.lease }, body: JSON.stringify(body) }),
    };
  }
  /** The run once it ended, as the account reads it. */
  const ended = async (id: string) =>
    (await until(() => {
      const g = getGeneration(id);
      return g && g.status !== "queued" && g.status !== "running" ? g : null;
    }, 400))!;

  const cases: [string, (w: ReturnType<typeof workerApi>, taskId: string) => Promise<void>][] = [
    [
      "given back three times (it stalled)",
      async (w) => {
        for (let i = 0; i < 3; i++) {
          const t = (await w.claim())!;
          await w.report(t, { event: "sent", promptId: t.promptId });
          await w.report(t, { event: "give-back", why: "stalled" });
        }
      },
    ],
    [
      "past its run limit twice",
      async (w) => {
        for (let i = 0; i < 2; i++) {
          const t = (await w.claim())!;
          await w.report(t, { event: "sent", promptId: t.promptId });
          await w.report(t, { event: "give-back", why: "run-limit" });
        }
      },
    ],
    [
      "its ComfyUI stopped twice on it",
      async (w) => {
        const t = (await w.claim())!;
        await w.report(t, { event: "sent", promptId: t.promptId });
        await w.report(t, { event: "failed", reason: "input-crashed" });
      },
    ],
    [
      "a file the worker refused",
      async (w) => {
        const t = (await w.claim())!;
        await w.report(t, { event: "failed", reason: "model-unverified" });
      },
    ],
    [
      "lost three times by workers that went quiet",
      async (w, taskId) => {
        for (let i = 0; i < 3; i++) {
          expect(await w.claim()).not.toBeNull();
          db().prepare("UPDATE relay_workers SET seen_at = ? WHERE kind = 'pool'").run(Date.now() - 3 * MIN_);
          pool.sweepPool(Date.now());
          expect(rowOf(taskId).requeues).toBe(i + 1);
          for (const x of db().prepare("SELECT id FROM relay_workers WHERE kind = 'pool'").all() as { id: string }[]) beatAs(x);
          // The retry rule: the same worker may take it again (no other worker is about).
        }
      },
    ],
  ];

  for (const [name, end] of cases) {
    it(`${name}: one plain sentence for the account, the reason for the owner`, async () => {
      const w = standInWorker();
      beatAs(w);
      const { id, taskId } = await accountRun();
      await end(workerApi(w.token), taskId);
      expect(rowOf(taskId).state).toBe("failed");
      const g = await ended(id);
      expect(g.status).toBe("failed");
      expect(g.error).toBe(POOL_WORDS.failed);
      expect(g.message ?? "").not.toMatch(JARGON);
      expect(g.fix).toBeUndefined();
      // The owner reads what happened.
      const owner = listAccountRuns({ account: accountId }).items.find((x) => x.id === id);
      expect(owner?.detail).toBeTruthy();
      expect(owner?.detail).not.toBe(POOL_WORDS.failed);
    });
  }
});

describe("graphs and results for the workers", () => {
  it("every VideoHelperSuite save node saves no metadata", () => {
    const wf = withoutSaveMetadata({
      "1": { class_type: "VHS_VideoCombine", inputs: { save_metadata: true, filename_prefix: "x" } },
      "2": { class_type: "VHS_VideoCombine", inputs: {} },
      "3": { class_type: "SaveImage", inputs: {} },
      "4": { class_type: "VHS_SaveImageSequence", inputs: { save_metadata: true } },
      "5": { class_type: "VHS_LoadVideo", inputs: { video: "x.mp4" } },
      "6": { class_type: "SomeOtherSave", inputs: { save_metadata: true } },
    } as never) as unknown as Record<string, { inputs: Record<string, unknown> }>;
    expect(wf["1"].inputs.save_metadata).toBe(false);
    expect(wf["2"].inputs.save_metadata).toBe(false);
    expect(wf["3"].inputs.save_metadata).toBeUndefined();
    expect(wf["4"].inputs.save_metadata).toBe(false);
    expect(wf["5"].inputs).toEqual({ video: "x.mp4" });
    expect(wf["6"].inputs.save_metadata).toBe(true);
  });

  it("an account's clip run on the workers is queued with no metadata in its clip saves", async () => {
    standInWorker();
    const { comfyProvider } = await import("@/server/providers/comfyui");
    const { TINY_MP4 } = await import("./helpers/fake-comfy-runner");
    const prior = process.env.FUOBE_POOL_MEDIA_INPUTS;
    process.env.FUOBE_POOL_MEDIA_INPUTS = "image,video";
    try {
      const route = { provider: "comfyui", endpoint: "interpolate-rife-vfi", op: "interpolate" } as never;
      const sent = await hosted.runOnPool(accountId, async () => {
        const video = (await comfyProvider.prepareFile!(TINY_MP4, "video/mp4", "clip.mp4", route))!;
        return comfyProvider.submit({ route, input: { video, extra: { multiplier: 2 } } as never, generationId: `vhs-${Date.now()}` } as never);
      });
      const t = rowOf(String((sent.meta as { relay: string }).relay));
      expect(t.principal).toBe(`acct:${accountId}`);
      expect(t.pools).toBe("pool");
      const graph = await graphOfTask(t);
      const saves = Object.values(graph).filter((n) => n.class_type === "VHS_VideoCombine");
      expect(saves.length).toBeGreaterThan(0);
      for (const node of saves) expect(node.inputs.save_metadata).toBe(false);
      expect(serverComfyCalls()).toEqual([]);
    } finally {
      if (prior === undefined) delete process.env.FUOBE_POOL_MEDIA_INPUTS;
      else process.env.FUOBE_POOL_MEDIA_INPUTS = prior;
    }
  });

  it("an owner's job on the workers keeps no more results than its workflow makes, and nothing past the disk's free floor", () => {
    const entry = { status: { status_str: "success", completed: true }, outputs: { "9": { images: Array.from({ length: 40 }, (_, i) => ({ filename: `x_${i}.png`, subfolder: "", type: "output" })) } } };
    const t = { id: "owner-task-0001x", workflow_id: loadManifest().workflows.find((x) => x.outputs.length === 1)!.id, meta_batch: 0, prefix: null, extra_json: JSON.stringify({ outputs: 1 }), pools: "pool" };
    const plan = onComputer("owner", () => planRelayOutputs(t, [entry], false));
    expect("wanted" in plan && plan.wanted.length).toBe(16);
    // The owner's own computer keeps every result, as before.
    const own = onComputer("owner", () => planRelayOutputs({ ...t, pools: null }, [entry], false));
    expect("wanted" in own && own.wanted.length).toBe(40);
    globalThis.__fuobeTestDiskFree = 1;
    try {
      const full = onComputer("owner", () => planRelayOutputs(t, [entry], false));
      expect("error" in full && full.error).toMatch(/no room/);
      // The owner's own computer keeps its results whatever the disk has free, as before.
      const ownLow = onComputer("owner", () => planRelayOutputs({ ...t, pools: null }, [entry], false));
      expect("wanted" in ownLow && ownLow.wanted.length).toBe(40);
    } finally {
      globalThis.__fuobeTestDiskFree = 1e13;
    }
  });

  it("an account's result from its own GPU has the room its files have, as before; on the workers, never past the disk's free floor", () => {
    const entry = { status: { status_str: "success", completed: true }, outputs: { "9": { images: [{ filename: "x_0.png", subfolder: "", type: "output" }] } } };
    const t = { id: "acct-task-00001x", workflow_id: loadManifest().workflows.find((x) => x.outputs.length === 1)!.id, meta_batch: 0, prefix: null, extra_json: JSON.stringify({ outputs: 1 }), pools: null };
    // The disk has a megabyte more than the free space it keeps.
    globalThis.__fuobeTestDiskFree = diskFloorBytes() + 2 ** 20;
    try {
      const own = onComputer(`acct:${accountId}`, () => planRelayOutputs(t, [entry], false));
      const room = Math.min(OWN_OUTPUT_LIMITS.maxBytes, accountTotalBytes(accountId) - accountUsage(accountId).total);
      expect(room).toBeGreaterThan(2 ** 20);
      expect("wanted" in own && own.wanted.map((w) => w.maxBytes)).toEqual([room]);
      const pooled = onComputer(`acct:${accountId}`, () => planRelayOutputs({ ...t, pools: "pool" }, [entry], false));
      expect("wanted" in pooled && pooled.wanted.map((w) => w.maxBytes)).toEqual([2 ** 20]);
      // Right at the floor: its own GPU's result still has its room (never told its files are full).
      globalThis.__fuobeTestDiskFree = diskFloorBytes();
      const atFloor = onComputer(`acct:${accountId}`, () => planRelayOutputs(t, [entry], false));
      expect("wanted" in atFloor && atFloor.wanted.length).toBe(1);
    } finally {
      globalThis.__fuobeTestDiskFree = 1e13;
    }
  });
});

describe("nothing of a run on the workers goes to a ComfyUI address", () => {
  it("an account's picture is kept for its task as it came (the worker makes it again from its pixels), and never decoded here", async () => {
    const sharp = (await import("sharp")).default;
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#c33" } })
      .jpeg()
      .withExif({ IFD0: { Copyright: "private note", Artist: "someone" } })
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();
    const { comfyProvider, mediaInfoFor } = await import("@/server/providers/comfyui");
    const staged = await hosted.runOnPool(accountId, () => comfyProvider.prepareFile!(jpeg, "image/jpeg", "me.jpg"));
    const row = db().prepare("SELECT principal, content_type FROM relay_inputs WHERE name = ?").get(staged) as { principal: string; content_type: string };
    expect(row).toEqual({ principal: `acct:${accountId}`, content_type: "image/jpeg" });
    const fs = await import("node:fs");
    const path = await import("node:path");
    expect(fs.readFileSync(path.join(dir, "relay", "in", staged)).equals(jpeg)).toBe(true);
    // Its size as it shows (turned by its orientation), as the worker's upright copy has it.
    expect(hosted.runOnPool(accountId, () => mediaInfoFor(staged))).toMatchObject({ width: 8, height: 8 });
    // Something that isn't a picture is never kept as one.
    await expect(hosted.runOnPool(accountId, () => comfyProvider.prepareFile!(Buffer.from("not a picture"), "image/jpeg", "x.jpg"))).rejects.toThrow();
    expect(serverComfyCalls()).toEqual([]);
  });

  it("a run on the workers with no account behind it never sends a file or a prompt", async () => {
    const { comfyProvider } = await import("@/server/providers/comfyui");
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    await expect(hosted.runOnPool(null, () => comfyProvider.prepareFile!(png, "image/png", "x.png"))).rejects.toThrow();
    const route = { provider: "comfyui", endpoint: loadManifest().workflows[0].id, op: "t2i" } as never;
    await expect(hosted.runOnPool(null, () => comfyProvider.submit({ route, input: { prompt: "a lighthouse" } as never, generationId: "guest-run-0001" } as never))).rejects.toThrow();
    expect(serverComfyCalls()).toEqual([]);
  });

  it("a run sent to this install's own ComfyUI before Settings moved to the workers is still followed there", async () => {
    const { comfyProvider } = await import("@/server/providers/comfyui");
    setSetting("comfyUrl", DEAD);
    // (It answers nothing here: the poll says so, and never goes round in circles.)
    await hosted
      .runOnPool(accountId, () => comfyProvider.poll({ externalId: crypto.randomUUID(), meta: { workflowId: loadManifest().workflows[0].id, generationId: "moved-0001" }, model: undefined } as never))
      .catch((e: Error) => expect(e.message).not.toMatch(/call stack/i));
    // Asked of the address it was sent to, not of the workers' line.
    expect(fetched.some((u) => u.startsWith(`${DEAD}/`))).toBe(true);
  });
});

describe("what a run on the workers is shaped by", () => {
  it("the workers' facts (the least VRAM and RAM of those allowed its lane), never the account's own computer's", async () => {
    const big = standInWorker("big");
    const small = standInWorker("small");
    const facts = (w: { id: string }, f: Record<string, unknown>) => db().prepare("UPDATE relay_workers SET facts_json = ? WHERE id = ?").run(JSON.stringify(f), w.id);
    facts(big, { vramBytes: 96 * 2 ** 30, ramBytes: 128 * 2 ** 30, device: "cuda:0 Test GPU" });
    facts(small, { vramBytes: 24 * 2 ** 30, ramBytes: 64 * 2 ** 30, device: "cuda:0 Other GPU" });
    expect(pool.poolFacts(null)).toEqual({ vramBytes: 24 * 2 ** 30, ramBytes: 64 * 2 ** 30, device: "cuda:0 Test GPU" });
    // A lane only the big one is allowed: its facts alone.
    const lane = allLanes(loadIndex(), sha)[0].lane;
    pool.patchWorker(small.id, { allow: {} });
    expect(pool.poolFacts(lane).vramBytes).toBe(96 * 2 ** 30);
    // Workers that name different kinds of device: none is assumed.
    pool.patchWorker(small.id, { allow: { [lane]: { delayMs: 0 } } });
    facts(small, { vramBytes: 24 * 2 ** 30, device: "mps" });
    expect(pool.poolFacts(null).device).toBeUndefined();
    facts(small, { vramBytes: 24 * 2 ** 30, ramBytes: 64 * 2 ** 30, device: "cuda:0 Other GPU" });

    // The account's own computer said something else: a run on the workers never reads it; a run on that computer does.
    tasks.beat(`acct:${computerAccount}`, { device: "device-own-facts", takeover: true, facts: { ramBytes: 2 ** 30, vramBytes: 2 ** 30, device: "mps" } });
    const { comfyRam, comfyDevice } = await import("@/server/providers/comfyui");
    expect(hosted.runOnPool(computerAccount, () => comfyRam())).toBe(64 * 2 ** 30);
    expect(await hosted.runOnPool(computerAccount, () => comfyDevice())).toBe("cuda");
    expect(onComputer(`acct:${computerAccount}`, () => comfyRam())).toBe(2 ** 30);
    expect(await onComputer(`acct:${computerAccount}`, () => comfyDevice())).toBe("mps");
    expect(serverComfyCalls()).toEqual([]);
  });
});

describe("files for runs on the workers", () => {
  it("an account may add only the kinds of file the workers take, whatever the policy allows", async () => {
    const uploadsRoute = await import("@/app/api/uploads/route");
    const { TINY_MP4, TINY_PNG } = await import("./helpers/fake-comfy-runner");
    standInWorker();
    process.env.FUOBE_BILLING_URL = fake.url;
    process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
    const before = fake.policy;
    fake.policy = { ...before, hosted: true, uploads: { image: true, video: true, audio: true }, ttlS: 0 };
    const prior = process.env.FUOBE_POOL_MEDIA_INPUTS;
    delete process.env.FUOBE_POOL_MEDIA_INPUTS;
    try {
      const up = (bytes: Buffer, type: string, name: string) =>
        uploadsRoute.POST(new Request(`http://${HOST}/api/uploads`, { method: "POST", headers: { ...SITE_HEADERS, cookie, "content-type": type, "x-file-name": name, "content-length": String(bytes.length) }, body: new Uint8Array(bytes) }));
      expect((await up(TINY_PNG, "image/png", "me.png")).status).toBe(201);
      expect((await up(TINY_MP4, "video/mp4", "me.mp4")).status).toBe(403);
      // The workers take clips too: so may the account.
      process.env.FUOBE_POOL_MEDIA_INPUTS = "image,video";
      expect((await up(TINY_MP4, "video/mp4", "me.mp4")).status).toBe(201);
    } finally {
      fake.policy = before;
      if (prior === undefined) delete process.env.FUOBE_POOL_MEDIA_INPUTS;
      else process.env.FUOBE_POOL_MEDIA_INPUTS = prior;
      delete process.env.FUOBE_BILLING_URL;
      delete process.env.FUOBE_BILLING_TOKEN;
    }
  });
});
