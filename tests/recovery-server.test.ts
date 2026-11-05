import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runnerByHand, startAppProcess, tick, type AppProcess } from "./helpers/app-process";
import { apiAs, loadRoutes, type ComputerRoutes } from "./helpers/computer-tab";
import { plainFailure, RunWatch, type RunLike } from "./helpers/run-watch";
import { startFakeModeration } from "./helpers/fake-billing";
import { FREE_RUNS_POLICY, startStandInBilling, type StandInBilling } from "./helpers/standin-billing";
import { startStandInComfy, type StandInComfy } from "./helpers/standin-comfy";
import { tempDir } from "./helpers/temp-dir";
import { workerDriver, type WorkerDriver } from "./helpers/worker-driver";

/**
 * Recovery checks for accounts' runs on this install's GPUs, on the studio's side: a stand-in ComfyUI, the worker's
 * runner on the real worker routes with a worker token, and a stand-in billing service that makes every run free (rate
 * limits only). Each check asks the same three things of the run:
 *
 * - its output arrives exactly once (one result in the run, one file kept, one prompt where nothing went wrong);
 * - every look at it shows only "In line" with its place, "Working", then the result: a recovery shows "In line" again
 *   with its place kept, and never an error or a word about the machines. The looks are a refresh, the account's
 *   session and a second session on another device (each through the sign-in proxy, as a browser asks), its list, and
 *   with two app processes the other one too. Each look must find the run, and another account must be refused it;
 * - nothing is charged twice (one hold, one report).
 *
 * Where the studio can't do something yet, the check is of what it does today, named for it, so that it fails the day
 * the studio learns it: then it becomes a check of the new behaviour. The worker's own scenarios are in
 * tests/recovery-worker.test.ts.
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 90_000, hookTimeout: 180_000 });

const dir = tempDir("fuobe-recovery-");
process.env.FUOBE_DATA_DIR = dir;
// Nothing answers here: no test may reach a real ComfyUI.
const DEAD = "http://127.0.0.1:7";
process.env.COMFYUI_URL = DEAD;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
for (const k of ["FUOBE_PASSWORD", "FUOBE_HOSTED_RUNS", "FUOBE_HOSTED_FREE", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN", "FUOBE_MODERATION_URL", "FUOBE_POOL_MEDIA_INPUTS", "FUOBE_POOL_WAIT_MIN"]) delete process.env[k];
globalThis.__fuobeTestDiskFree = 1e13;

// The server's own fetch: anything but the stand-ins answers 599 at once (no real network).
const realFetch = globalThis.fetch;
let allowed: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (allowed.some((a) => url.startsWith(a))) return realFetch(input, init);
  return new Response("not reachable in this test", { status: 599 });
}) as typeof fetch;

const auth = await import("@/server/auth");
const generationsRoute = await import("@/app/api/generations/route");
const oneRoute = await import("@/app/api/generations/[id]/route");
const previewRoute = await import("@/app/api/generations/[id]/preview/route");
const { proxy } = await import("@/proxy");
const { NextRequest } = await import("next/server");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const { cancelGeneration, createGenerations, getGeneration, ensureRunner, QUIET_MS, updateLive } = await import("@/server/generations");
const { runOnPool } = await import("@/server/hosted");
const { stampOf, withRunStamp } = await import("@/server/run-stamp");
const pool = await import("@/server/computer/pool");
const { catalogVersion } = await import("@/server/computer/catalog-version");
const tasks = await import("@/server/computer/tasks");
const billing = await import("@/server/billing");
const outbox = await import("@/server/billing-outbox");
const outputChecks = await import("@/server/output-checks");
const qs = await import("@/server/queue-settings");
const { comfyProvider, loadManifest } = await import("@/server/providers/comfyui");
const { loadIndex } = await import("@/server/gpu/index-file");
const { allLanes } = await import("@/lib/lanes");
const { getModel } = await import("@/lib/catalog");
const { POOL_WORDS } = await import("@/lib/relay");
const { ACCOUNT_MESSAGES } = await import("@/server/account-files");

type TaskRow = import("@/server/computer/tasks").TaskRow;

const HOST = "localhost:3000";
const SITE_HEADERS = { host: HOST, "sec-fetch-site": "same-origin", origin: `http://${HOST}` };
const MIN = 60_000;
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const IMAGE = { feature: "image", modelId: "oss-z-image-turbo", prompt: "a lighthouse at dusk" };
const imageLane = () => pool.poolLane(getModel(IMAGE.modelId)!.routes.find((r) => r.provider === "comfyui")!.endpoint);

let comfy: StandInComfy;
let svc: StandInBilling;
let routes: ComputerRoutes;
let A = "";
let B = "";
/** Two sessions of account A (two devices), and one of account B. */
let a1 = "";
let a2 = "";
let b1 = "";
const drivers: WorkerDriver[] = [];

function settings() {
  setSetting("comfyWhere", "workers");
  setSetting("comfyUrl", "");
  setSetting("engineMode", "open");
  setSetting("demoMode", "off");
}

beforeAll(async () => {
  comfy = await startStandInComfy({ steps: 4, stepMs: 20 });
  svc = await startStandInBilling();
  allowed = [comfy.url];
  routes = await loadRoutes();
  auth.setPassword("install password");
  const session = (id: string) => `${auth.SESSION_COOKIE}=${auth.createSession(id).value}`;
  A = auth.createAccount("recovery-a@example.com", "long enough").id;
  B = auth.createAccount("recovery-b@example.com", "long enough").id;
  a1 = session(A);
  a2 = session(A);
  b1 = session(B);
  settings();
  ensureRunner();
  runnerByHand();
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  globalThis.__fuobeTestDiskFree = undefined;
  for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_HOSTED_FREE", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN"]) delete process.env[k];
  await comfy.close();
  await svc.close();
});
beforeEach(async () => {
  resetRates();
  billing.resetBillingCache();
  qs.saveQueueSettings(qs.QUEUE_DEFAULTS);
  process.env.FUOBE_HOSTED_RUNS = "1";
  process.env.FUOBE_BILLING_URL = svc.address;
  process.env.FUOBE_BILLING_TOKEN = svc.token;
  delete process.env.FUOBE_HOSTED_FREE;
  Object.assign(svc, { priced: false, slowMs: 0, slowPath: null, reserveStatus: null, gather: null, maxWaitMs: 20 * MIN, holdLifeMs: 105 * MIN, readTiming: true, policy: JSON.parse(JSON.stringify(FREE_RUNS_POLICY)) });
  await svc.start();
  await comfy.start();
  comfy.inner.restart({ stall: false, failNext: undefined, loseNext: 0, steps: 4, stepMs: 20, previewPicture: undefined });
  settings();
  db().prepare("DELETE FROM relay_workers").run();
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
  db().prepare("DELETE FROM pool_admissions").run();
});
afterEach(() => {
  vi.useRealTimers();
  for (const d of drivers.splice(0)) d.stop();
});

// ---------------------------------------------------------------------------
// The studio's side

/**
 * A worker the owner added and resumed, allowed every lane (or `lanes`), able to run every workflow, and connected (its
 * worker program beat a moment ago: `connected` false, never).
 */
function standInWorker(name = "stand-in", o: { paused?: boolean; lanes?: string[]; connected?: boolean } = {}) {
  const w = pool.addWorker(name);
  const lanes = o.lanes ?? allLanes(loadIndex(), sha).map((l) => l.lane);
  pool.patchWorker(w.id, { paused: !!o.paused, hours: { always: true }, allow: Object.fromEntries(lanes.map((l) => [l, { delayMs: 0 }])), claimAfterMs: 0 });
  // Connected once: it said its build (one that takes this studio's job tickets).
  db()
    .prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ?, catalog_version = ?, protocol = 3 WHERE id = ?")
    .run(JSON.stringify({ lanes, workflows: loadManifest().workflows.map((x) => x.id) }), JSON.stringify({ vramBytes: 96 * 2 ** 30 }), catalogVersion(), w.id);
  if (o.connected !== false) db().prepare("UPDATE relay_workers SET seen_at = ?, paused_local = 0 WHERE id = ?").run(Date.now(), w.id);
  return w;
}

/** The worker program for this worker's token, against the stand-in ComfyUI. */
function driver(w: { token: string }): WorkerDriver {
  const d = workerDriver({ routes, token: w.token, comfy });
  drivers.push(d);
  return d;
}

const request = (url: string, o: { method?: string; body?: unknown; cookie?: string } = {}) => {
  const text = o.body === undefined ? undefined : JSON.stringify(o.body);
  const headers: Record<string, string> = { ...SITE_HEADERS, cookie: o.cookie ?? a1, ...(text && { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }) };
  return new Request(`http://${HOST}${url}`, { method: o.method ?? (text ? "POST" : "GET"), headers, body: text });
};

/** Press Run (POST /api/generations) as a session. */
async function run(body: Record<string, unknown>, cookie = a1) {
  const r = await generationsRoute.POST(request("/api/generations", { body, cookie }));
  return { status: r.status, headers: r.headers, body: (await r.json()) as { items?: { id: string }[]; code?: string; error?: string } };
}

/** The price check before Run. */
async function priceCheck(body: Record<string, unknown>, cookie = a1) {
  const r = await generationsRoute.POST(request("/api/generations?preview=1", { body, cookie }));
  return { status: r.status, body: (await r.json()) as { place?: string; quote?: { allowed: boolean; text: string; code?: string; etaS?: number | null }; error?: string; code?: string } };
}

/** A GET as a browser sends it: the sign-in proxy (src/proxy.ts) first, then the route when the proxy passes it on. */
async function browserGet(url: string, cookie: string, route: (req: Request) => Promise<Response>): Promise<Response> {
  const headers = { ...SITE_HEADERS, cookie };
  const p = await proxy(new NextRequest(`http://${HOST}${url}`, { headers }));
  if (p.headers.get("x-middleware-next") !== "1") return p;
  return route(new Request(`http://${HOST}${url}`, { headers }));
}

/** GET /api/generations/<id> as a session's browser asks it: the answer's status, and the run when it was there. */
async function sessionGet(cookie: string, id: string): Promise<{ status: number; run: RunLike | null }> {
  const r = await browserGet(`/api/generations/${id}`, cookie, (req) => oneRoute.GET(req, { params: Promise.resolve({ id }) } as never));
  return { status: r.status, run: r.ok ? ((await r.json()) as RunLike) : null };
}

/** A small JPEG as a worker sends its preview picture (base64): its bytes start as a JPEG's, then `n` and filler. */
const jpegBase64 = (n: number, size = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`preview ${n} `), Buffer.alloc(size, n % 251)]).toString("base64");

/** GET a run's preview picture as a session's browser asks it: the response. */
const previewGet = (cookie: string, url: string) => {
  const id = /^\/api\/generations\/([^/]+)\/preview/.exec(url)![1];
  return browserGet(url, cookie, (req) => previewRoute.GET(req, { params: Promise.resolve({ id }) } as never));
};

/** The picture's first bytes (hex) as the session gets it, or its status when it gets none. */
async function previewOf(cookie: string, url: string): Promise<string> {
  const r = await previewGet(cookie, url);
  return r.ok ? Buffer.from(await r.arrayBuffer()).subarray(0, 12).toString("hex") : String(r.status);
}

/** A run as a session reads it (an answer that isn't OK throws: a person would see an error). */
const sessionRead = (cookie: string) => async (id: string) => {
  const { status, run } = await sessionGet(cookie, id);
  if (!run) throw new Error(`GET /api/generations/${id} answered ${status}`);
  return run;
};

/** A run as the session's list shows it (GET /api/generations, page by page), or null when the list hasn't got it. */
const listRead = (cookie: string) => async (id: string) => {
  let before = "";
  for (let page = 0; page < 20; page++) {
    const r = await browserGet(`/api/generations?limit=50${before && `&before=${before}`}`, cookie, (req) => generationsRoute.GET(req));
    if (!r.ok) throw new Error(`GET /api/generations answered ${r.status}`);
    const items = ((await r.json()) as { items: (RunLike & { id: string; createdAt: number })[] }).items;
    const g = items.find((x) => x.id === id);
    if (g) return g;
    if (items.length < 50) return null;
    const last = items[items.length - 1];
    before = `${last.createdAt}:${last.id}`;
  }
  return null;
};

/**
 * Every place the run's account looks from: a refresh, its session, a second session on another device, and its list.
 * Another account's session and list must never show it.
 */
function watchOf(id: string, extra: Record<string, () => Promise<RunLike | null>> = {}) {
  return new RunWatch(
    {
      refresh: () => getGeneration(id) as RunLike | null,
      session: () => sessionRead(a1)(id),
      "second session": () => sessionRead(a2)(id),
      list: () => listRead(a1)(id),
      ...extra,
    },
    {
      "another account": async () => (await sessionGet(b1, id)).status,
      "another account's list": async () => ((await listRead(b1)(id)) ? 200 : 404),
    },
  );
}

const taskOf = (generationId: string) => db().prepare("SELECT * FROM relay_tasks WHERE generation_id = ? ORDER BY created_at DESC").get(generationId) as TaskRow | undefined;
const assetsOf = (generationId: string) => (db().prepare("SELECT COUNT(*) AS n FROM assets WHERE generation_id = ?").get(generationId) as { n: number }).n;
const holdOf = (generationId: string) => (db().prepare("SELECT json_extract(request_json, '$.hold') AS hold FROM generations WHERE id = ?").get(generationId) as { hold: string | null }).hold;
/** Runs account A has made. */
const made = () => (db().prepare("SELECT COUNT(*) AS n FROM generations WHERE json_extract(request_json, '$.account') = ?").get(A) as { n: number }).n;
const done = (g: { status: string } | null | undefined) => !!g && g.status !== "queued" && g.status !== "running";

/** Turn the runner until `fn` says yes (or the tries run out: the last answer). */
async function until<T>(fn: () => T | Promise<T>, tries = 300): Promise<T> {
  let v = await fn();
  for (let i = 0; i < tries && !v; i++) {
    await tick();
    await sleep(20);
    v = await fn();
  }
  return v;
}

/** The run once it has ended (the runner turning until then). */
const ended = (id: string) => until(() => (done(getGeneration(id)) ? (getGeneration(id) as RunLike) : null));

/** Press Run and wait for the run's task in the workers' line. */
async function pressRun(body: Record<string, unknown> = IMAGE, cookie = a1) {
  const r = await run(body, cookie);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const id = r.body.items![0].id;
  const t = await until(() => taskOf(id));
  expect(t, "its task in the workers' line").toBeDefined();
  return { id, task: t! };
}

/**
 * The worker takes jobs and runs them until there is none (or it stops). Every beat answer must let it take jobs
 * (unless the test paused it here): a worker the studio refuses fails here, never as a run that waits.
 */
async function workAll(d: WorkerDriver, max = 10) {
  for (let i = 0; i < max; i++) {
    const a = await d.beat();
    if (a && !d.pausedHere) expect(a.runner, `the studio lets the worker take jobs: ${JSON.stringify(a.worker)}`).toBe(true);
    const r = await d.runOne();
    if (r !== true) return r;
  }
  return true;
}

/** The billing service's reports for a run, once the outbox has sent them. */
async function reportsOf(id: string, want = 1) {
  for (let i = 0; i < 100 && svc.reportsFor(id).length < want; i++) {
    await outbox.sweepBilling();
    await sleep(10);
  }
  return svc.reportsFor(id);
}

/**
 * The three checks: the run ended with its result, exactly once; every look showed only the allowed states; and it was
 * charged once (one hold, one settle).
 */
async function expectOnce(id: string, watch: RunWatch, o: { outputs?: number; prompts?: number; place?: number } = {}) {
  const g = await ended(id);
  await watch.look();
  expect(watch.problems({ place: o.place }), JSON.stringify(watch.path())).toEqual([]);
  expect(g?.status, g?.error ?? "").toBe("succeeded");
  expect(g!.outputs!.length).toBe(o.outputs ?? 1);
  expect(assetsOf(id), "files kept for the run").toBe(g!.outputs!.length);
  if (o.prompts !== undefined) expect(comfy.postsOf(taskOf(id)!.prompt_id), "prompts its ComfyUI got").toBe(o.prompts);
  const hold = holdOf(id);
  expect(hold, "the run's hold").toBeTruthy();
  expect(svc.holds.has(hold!)).toBe(true);
  const reports = await reportsOf(id);
  expect(reports).toEqual([{ holdId: hold, kind: "settle", status: "succeeded" }]);
  expect(svc.late).toEqual([]);
  return g!;
}

/** A free run that ended without its result: in plain words, refunded once. */
async function expectFreeFailure(id: string) {
  const g = await ended(id);
  expect(plainFailure(g!, { charged: false }), JSON.stringify(g)).toEqual([]);
  expect(await reportsOf(id)).toEqual([{ holdId: holdOf(id), kind: "refund", status: "failed" }]);
  return g!;
}

// ---------------------------------------------------------------------------

describe("an account's run reaches the workers", () => {
  it("with no ComfyUI address, it becomes the account's task, a stand-in worker renders it, and it shows only In line, Working and the result", async () => {
    const w = standInWorker();
    // Every run free: the price says only "Free".
    const q = await priceCheck(IMAGE);
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    expect(q.body.place).toBe("pool");
    expect(q.body.quote).toMatchObject({ allowed: true, text: "Free" });

    const { id, task } = await pressRun();
    expect(task.principal).toBe(`acct:${A}`);
    expect(task.pools).toBe("pool");
    const watch = watchOf(id);
    await watch.look();
    expect(watch.seen.length).toBe(4);
    expect(watch.seen.every((s) => s.status === "queued" && s.place === 1)).toBe(true);

    const d = driver(w);
    d.onStep(async () => {
      await tick();
      await watch.look();
    });
    expect((await d.beat())?.claimableNow).toBe(1);
    expect(await workAll(d)).toBe(false);
    await expectOnce(id, watch, { prompts: 1, place: 1 });
    expect(watch.path("session")).toEqual(["queued", "running", "succeeded"]);
    expect(watch.path("second session")).toEqual(["queued", "running", "succeeded"]);
    // The worker's ComfyUI got its prompt from the worker, under the task's own prompt id.
    expect(comfy.log().filter((e) => e.prompt?.prompt_id === task.prompt_id).map((e) => e.prompt?.client_id)).toEqual([expect.stringMatching(/^worker-/)]);
    expect(svc.holdsOf(A).filter((h) => h.reports.has(id))).toHaveLength(1);
  });
});

/**
 * Time passes on the studio's clock (Date only: everything else runs as it does), a minute at a time: each minute the
 * workers beat, the runner turns, and the run is looked at.
 */
async function pass(ms: number, ds: WorkerDriver[], watch?: RunWatch, every = MIN) {
  for (let t = 0; t < ms; t += every) {
    vi.setSystemTime(Date.now() + every);
    for (const d of ds) await d.beat();
    await tick();
    await watch?.look();
  }
}
const clock = () => vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });

/** The worker steps aside for another program at its first report that the job runs (its next beat says so). */
function stepAsideWhenRunning(d: WorkerDriver, watch: RunWatch, why = "gpu-busy:game.exe", before?: () => Promise<void>) {
  let stepped = false;
  d.onStep(async (step) => {
    await tick();
    await watch.look();
    if (step !== "running" || stepped) return;
    stepped = true;
    await before?.();
    d.pause(why);
    await d.beat();
  });
  return () => stepped;
}

/** The worker runs on, and every step is looked at. */
function lookAtEveryStep(d: WorkerDriver, watch: RunWatch) {
  d.onStep(async () => {
    await tick();
    await watch.look();
  });
}

describe("a worker that stops and starts again", () => {
  it("stopped right after the studio heard its job finished, and started again with its ComfyUI still up, it sends the result: one prompt, one output", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id);
    const first = driver(w);
    lookAtEveryStep(first, watch);
    first.stopAfter("finished");
    await first.beat();
    expect(await first.runOne()).toBe("stopped");
    expect(first.dead).toBe(true);
    expect(taskOf(id)!.state).toBe("collecting");
    // The same worker, started again: its job is still its own, and it sends what its ComfyUI made.
    const again = driver(w);
    lookAtEveryStep(again, watch);
    expect(await workAll(again)).toBe(false);
    await expectOnce(id, watch, { prompts: 1, place: 1 });
  });

  it("stopped right after its claim, its job waits for it: when it starts again within two minutes it runs it", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id);
    const first = driver(w);
    first.stopAfter("claim");
    await first.beat();
    expect(await first.runOne()).toBe("stopped");
    await tick();
    await watch.look();
    const again = driver(w);
    lookAtEveryStep(again, watch);
    expect(await workAll(again)).toBe(false);
    await expectOnce(id, watch, { prompts: 1, place: 1 });
  });

  it("a busy studio (429) while it sends the result is waited out: one output", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id);
    const d = driver(w);
    lookAtEveryStep(d, watch);
    d.answer("part", 429, 5);
    expect(await workAll(d)).toBe(false);
    expect(d.calls.filter((c) => c.startsWith("part")).length).toBeGreaterThan(5);
    await expectOnce(id, watch, { prompts: 1, place: 1 });
  });
});

describe("a refresh, a second session and the list see the same run", () => {
  it("in line behind another account's run, then working, then its result: every look shows the same state, place and step", async () => {
    const w = standInWorker();
    const theirs = await pressRun(IMAGE, b1);
    const { id } = await pressRun();
    const watch = watchOf(id);
    expect((await watch.look()).map((s) => [s.status, s.place])).toEqual(Array(4).fill(["queued", 2]));
    comfy.inner.opts.steps = 10;
    comfy.inner.opts.stepMs = 200;
    const d = driver(w);
    const together: (number | null)[][] = [];
    d.onStep(async (step) => {
      await tick();
      const now = await watch.look();
      if (step === "running" && now.every((s) => s.status === "running")) together.push(now.map((s) => s.progress));
    });
    expect(await workAll(d)).toBe(false);
    expect(getGeneration(theirs.id)?.status).toBe("succeeded");
    // It waited behind the other run, then it was first in line.
    const places = watch.seen.filter((s) => s.status === "queued").map((s) => s.place);
    expect(places).toContain(2);
    expect(places).toContain(1);
    // While it ran, every look at one moment shows the same step (within one).
    expect(together.length).toBeGreaterThan(0);
    for (const at of together) expect(Math.max(...at.map((p) => p ?? 0)) - Math.min(...at.map((p) => p ?? 0))).toBeLessThanOrEqual(1 / 10 + 1e-9);
    expect(together.some((at) => at.every((p) => (p ?? 0) > 0))).toBe(true);
    await expectOnce(id, watch, { prompts: 1, place: 2 });
  });
});

describe("a run's preview picture while it works", () => {
  it("the Working tile gets the worker's latest picture, for the run's own account only and never kept by a cache; it goes when the run ends", async () => {
    const w = standInWorker();
    const { id, task } = await pressRun();
    const watch = watchOf(id);
    comfy.inner.opts.steps = 6;
    comfy.inner.opts.stepMs = 100;
    const d = driver(w);
    let n = 0;
    d.previews(() => jpegBase64(++n));
    const seen: { session?: string; list?: string; picture: string; headers: Record<string, string | null>; other: number; guest: number }[] = [];
    d.onStep(async (step) => {
      await tick();
      await watch.look();
      if (step !== "running" || seen.length) return;
      const g = (await sessionRead(a1)(id)) as RunLike & { preview?: string };
      if (!g.preview) return;
      const listed = (await listRead(a1)(id)) as (RunLike & { preview?: string }) | null;
      const r = await previewGet(a2, g.preview);
      seen.push({
        session: g.preview,
        list: listed?.preview,
        picture: Buffer.from(await r.arrayBuffer()).subarray(0, 3).toString("hex"),
        headers: { type: r.headers.get("content-type"), cache: r.headers.get("cache-control"), sniff: r.headers.get("x-content-type-options") },
        other: (await previewGet(b1, g.preview)).status,
        guest: (await previewGet("", g.preview)).status,
      });
    });
    await workAll(d);
    expect(seen).toHaveLength(1);
    const [s] = seen;
    expect(s.session).toMatch(new RegExp(`^/api/generations/${id}/preview\\?at=\\d+$`));
    expect(s.list, "the list carries it too").toBe(s.session);
    expect(s.picture).toBe("ffd8ff");
    expect(s.headers).toEqual({ type: "image/jpeg", cache: "private, no-store", sniff: "nosniff" });
    expect(s.other, "another account").toBe(403);
    expect(s.guest, "a guest").toBe(401);
    // Ended: no picture is left, and its address answers nothing.
    const g = (await expectOnce(id, watch, { prompts: 1, place: 1 })) as RunLike & { preview?: string };
    expect(g.preview).toBeUndefined();
    expect((await previewGet(a1, s.session!)).status).toBe(404);
    expect(taskOf(id)!.preview_at).toBeNull();
    expect(tasks.runPreview(id)).toBeNull();
    expect(fs.existsSync(path.join(tasks.relayDir(), "tasks", task.id, "preview.jpg"))).toBe(false);
  });

  it("back in line, the run shows no picture of the attempt before", async () => {
    clock();
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id);
    comfy.inner.opts.steps = 6;
    comfy.inner.opts.stepMs = 100;
    const d = driver(w);
    d.previews(() => jpegBase64(1));
    let had = "";
    d.onStep(async (step) => {
      await tick();
      await watch.look();
      if (step !== "running" || had) return;
      had = ((await sessionRead(a1)(id)) as RunLike & { preview?: string }).preview ?? "";
      if (!had) return;
      d.pause("gpu-busy:game.exe");
      await d.beat();
    });
    await workAll(d);
    expect(had).toMatch(/\/preview\?at=/);
    await tick();
    const g = (await sessionRead(a1)(id)) as RunLike & { preview?: string };
    expect(g).toMatchObject({ status: "queued", queue: { place: 1 } });
    expect(g.preview).toBeUndefined();
    expect((await previewGet(a1, had)).status).toBe(404);
    d.pause(null);
    d.previews(null);
    lookAtEveryStep(d, watch);
    await workAll(d);
    await expectOnce(id, watch, { place: 1 });
  });

  it("a picture that isn't a JPEG, is over 64 KB or comes within 2 s of the last is dropped; a person's own computer keeps none", async () => {
    standInWorker();
    const { id, task } = await pressRun();
    db().prepare("UPDATE relay_tasks SET state = 'running', lease_hash = 'this-attempt' WHERE id = ?").run(task.id);
    const now = Date.now();
    const t = { ...taskOf(id)!, preview_at: null };
    expect(tasks.notePreview(t, Buffer.from("not a picture").toString("base64"), now)).toBe(false);
    expect(tasks.notePreview(t, jpegBase64(1, 70 * 1024), now)).toBe(false);
    expect(tasks.notePreview(t, "%%%", now)).toBe(false);
    expect(tasks.notePreview({ ...t, pools: null }, jpegBase64(1), now)).toBe(false);
    expect(tasks.notePreview({ ...t, preview: 0 }, jpegBase64(1), now)).toBe(false);
    expect(tasks.notePreview({ ...t, preview_at: now - 1000 }, jpegBase64(1), now)).toBe(false);
    expect(tasks.notePreview({ ...t, preview_at: now - 2000 }, jpegBase64(1), now)).toBe(true);
    tasks.dropProgress(t.id);
  });

  it("a step or a picture that comes after another app process sent the task back in line, or gave it to another attempt, leaves nothing behind", async () => {
    standInWorker();
    const { id, task } = await pressRun();
    const folder = path.join(tasks.relayDir(), "tasks", task.id);
    const left = () => (fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => f.startsWith("preview")) : []);
    db().prepare("UPDATE relay_tasks SET state = 'running', lease_hash = 'first-attempt' WHERE id = ?").run(task.id);
    const late = { ...taskOf(id)! };
    const now = Date.now();
    // The other process sent it back in line meanwhile.
    db().prepare("UPDATE relay_tasks SET state = 'waiting', lease_hash = NULL WHERE id = ?").run(task.id);
    tasks.noteProgress(task.id, { value: 3, max: 4 }, now, late.lease_hash);
    expect(tasks.notePreview(late, jpegBase64(1), now)).toBe(false);
    expect(taskOf(id)).toMatchObject({ progress_json: null, preview_at: null });
    expect(left()).toEqual([]);
    // Another worker took it again (a new lease): the first attempt's late report still leaves nothing.
    db().prepare("UPDATE relay_tasks SET state = 'running', lease_hash = 'second-attempt' WHERE id = ?").run(task.id);
    tasks.noteProgress(task.id, { value: 3, max: 4 }, now, late.lease_hash);
    expect(tasks.notePreview(late, jpegBase64(1), now)).toBe(false);
    expect(taskOf(id)).toMatchObject({ progress_json: null, preview_at: null });
    expect(left()).toEqual([]);
    // The attempt that holds it now is kept.
    tasks.noteProgress(task.id, { value: 1, max: 4 }, now, "second-attempt");
    expect(tasks.notePreview({ ...taskOf(id)! }, jpegBase64(2), now)).toBe(true);
    expect(tasks.taskProgress(taskOf(id)!)).toMatchObject({ value: 1, max: 4 });
    expect(left()).toEqual(["preview.jpg"]);
    // Ended: both go.
    tasks.endTask(task.id, "canceled");
    expect(left()).toEqual([]);
  });

  it("a task a worker claims again shows nothing of the attempt before it until the new one reports", async () => {
    const w = standInWorker();
    const { id, task } = await pressRun();
    const file = path.join(tasks.relayDir(), "tasks", task.id, "preview.jpg");
    db()
      .prepare("UPDATE relay_tasks SET state = 'waiting', lease_hash = NULL, worker_id = NULL, progress_json = ?, preview_at = ? WHERE id = ?")
      .run(JSON.stringify({ value: 3, max: 4, at: Date.now() }), Date.now(), task.id);
    // Left from an attempt before (a process that stopped part way never dropped it).
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(jpegBase64(1), "base64"));
    const d = driver(w);
    let atClaim: { progress_json: string | null; preview_at: number | null; file: boolean } | null = null;
    d.onStep((step) => {
      if (step === "claim" && !atClaim) atClaim = { ...taskOf(id)!, file: fs.existsSync(file) };
    });
    await workAll(d);
    expect(atClaim).toMatchObject({ preview_at: null, file: false });
    // Only the new attempt's own mark (getting ready: its worker said no model was loaded), no step of the attempt before.
    const fresh = JSON.parse(atClaim!.progress_json ?? "{}") as Record<string, unknown>;
    expect(Object.keys(fresh).filter((k) => k !== "at" && k !== "cold")).toEqual([]);
    expect((await ended(id))?.status).toBe("succeeded");
  });

  it("a worker's preview pictures reach the Working tile: the latest shows, and the studio keeps at most one every 2 s", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id);
    comfy.inner.opts.steps = 8;
    comfy.inner.opts.stepMs = 600;
    // The worker sends a picture with every progress report here (the worker program's own sender, which makes
    // ComfyUI's pictures small JPEGs and sends one every 2 s at most, is checked in worker-cpu-slot.test.ts).
    const d = driver(w);
    let n = 0;
    d.previews(() => jpegBase64(++n));
    const kept: number[] = [];
    const shown: string[] = [];
    d.onStep(async (step) => {
      await tick();
      await watch.look();
      if (step !== "running") return;
      const at = taskOf(id)?.preview_at ?? null;
      if (at !== null && at !== kept.at(-1)) kept.push(at);
      const g = (await sessionRead(a1)(id)) as RunLike & { preview?: string };
      if (g.preview) shown.push(Buffer.from(await (await previewGet(a1, g.preview)).arrayBuffer()).subarray(4, 12).toString("latin1"));
    });
    await workAll(d);
    expect(kept.length, "pictures kept").toBeGreaterThanOrEqual(2);
    for (let i = 1; i < kept.length; i++) expect(kept[i] - kept[i - 1]).toBeGreaterThanOrEqual(1500);
    expect(shown.length).toBeGreaterThan(0);
    for (const s of shown) expect(s).toBe("preview ");
    await expectOnce(id, watch, { prompts: 1, place: 1 });
  });

  it("a run whose outputs the moderation service sees first shows no preview while it works: no address, and the picture's address answers nothing", async () => {
    const mod = await startFakeModeration();
    process.env.FUOBE_MODERATION_URL = mod.url;
    // An answer with no checkOutputs field: its outputs are checked first.
    mod.run = { allowed: true };
    try {
      const w = standInWorker();
      const { id, task } = await pressRun();
      expect(taskOf(id)!.preview, "its ComfyUI is asked for no previews").toBe(0);
      comfy.inner.opts.steps = 6;
      comfy.inner.opts.stepMs = 300;
      comfy.inner.opts.previewPicture = (step) => ({ type: "image/jpeg", data: Buffer.from(jpegBase64(step), "base64") });
      const d = driver(w);
      // A worker that sends a picture anyway.
      d.previews(() => jpegBase64(1));
      const looks: { preview?: string; route: number }[] = [];
      d.onStep(async (step) => {
        if (step !== "running") return;
        const g = (await sessionRead(a1)(id)) as RunLike & { preview?: string };
        looks.push({ preview: g.preview, route: (await previewGet(a1, `/api/generations/${id}/preview?at=1`)).status });
      });
      await workAll(d);
      expect(looks.length).toBeGreaterThan(0);
      expect(looks.every((l) => l.preview === undefined && l.route === 404), JSON.stringify(looks)).toBe(true);
      expect(taskOf(id)!.preview_at).toBeNull();
      expect(fs.existsSync(path.join(tasks.relayDir(), "tasks", task.id, "preview.jpg"))).toBe(false);
      // Its result shows once the check passes.
      await until(async () => (await tick(), getGeneration(id)?.status === "succeeded"));
    } finally {
      delete process.env.FUOBE_MODERATION_URL;
      await mod.close();
    }
  });

  it("a worker's report with a picture over 64 KB is taken without the picture, and the run goes on", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id);
    const d = driver(w);
    d.previews(() => jpegBase64(1, 66 * 1024));
    const previews: (string | undefined)[] = [];
    d.onStep(async (step) => {
      await tick();
      await watch.look();
      if (step === "running") previews.push(((await sessionRead(a1)(id)) as RunLike & { preview?: string }).preview);
    });
    await workAll(d);
    expect(d.steps).toContain("running");
    expect(previews.length).toBeGreaterThan(0);
    expect(previews.every((p) => p === undefined)).toBe(true);
    await expectOnce(id, watch, { prompts: 1, place: 1 });
  });

  it("a picture the studio can't keep (its file is open elsewhere, or the disk is full) never fails the worker's report: the run goes on and its output arrives", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id);
    const d = driver(w);
    let n = 0;
    d.previews(() => jpegBase64(++n));
    const realRename = fs.renameSync.bind(fs);
    const spy = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to).endsWith("preview.jpg")) throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
      return realRename(from, to);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // What the task's folder holds while it runs: no picture kept, and nothing half-written left beside it.
    const left: string[][] = [];
    d.onStep(async (step) => {
      await tick();
      await watch.look();
      const dir = path.dirname(tasks.outputFile(taskOf(id)!.id, 0));
      if (step === "running" && fs.existsSync(dir)) left.push(fs.readdirSync(dir).filter((f) => f.startsWith("preview")));
    });
    try {
      await workAll(d);
      expect(d.steps).toContain("running");
      expect(spy.mock.calls.some(([, to]) => String(to).endsWith("preview.jpg")), "a picture was sent and couldn't be kept").toBe(true);
      expect(left.length).toBeGreaterThan(0);
      expect(left.flat()).toEqual([]);
    } finally {
      spy.mockRestore();
      warn.mockRestore();
    }
    await expectOnce(id, watch, { prompts: 1, place: 1 });
  });
});

describe("the owner's own job on the workers", () => {
  it("with hosted runs off, it shows no preview picture, as before: its worker is never asked for one, and one sent anyway is dropped", async () => {
    delete process.env.FUOBE_HOSTED_RUNS;
    delete process.env.FUOBE_BILLING_URL;
    try {
      const w = standInWorker();
      const owner = `${auth.SESSION_COOKIE}=${auth.createSession().value}`;
      const { id } = await pressRun(IMAGE, owner);
      expect(taskOf(id)!.principal).toBe("owner");
      comfy.inner.opts.steps = 6;
      comfy.inner.opts.stepMs = 100;
      const d = driver(w);
      let n = 0;
      d.previews(() => jpegBase64(++n));
      const asked: number[] = [];
      const shown: (string | undefined)[] = [];
      d.onStep(async (step) => {
        await tick();
        if (step !== "running") return;
        asked.push(tasks.showsPreview(taskOf(id)!) ? 1 : 0);
        shown.push(((await sessionRead(owner)(id)) as RunLike & { preview?: string }).preview);
      });
      await workAll(d);
      expect(shown.length).toBeGreaterThan(0);
      expect(asked.every((x) => x === 0), "the claim asks for no picture").toBe(true);
      expect(shown.every((p) => p === undefined), "no picture shows").toBe(true);
      expect(taskOf(id)!.preview_at).toBeNull();
      await until(() => getGeneration(id)?.status === "succeeded");
    } finally {
      process.env.FUOBE_HOSTED_RUNS = "1";
    }
  });

  it("waiting, it carries its place in their line in the list as after a refresh", async () => {
    const w = standInWorker();
    const owner = `${auth.SESSION_COOKIE}=${auth.createSession().value}`;
    const theirs = await pressRun(IMAGE, b1);
    const { id } = await pressRun(IMAGE, owner);
    expect(taskOf(id)!.principal).toBe("owner");
    const one = (await sessionRead(owner)(id)) as RunLike & { queue?: { place: number } };
    const listed = (await listRead(owner)(id)) as (RunLike & { queue?: { place: number } }) | null;
    // People's runs go first: the owner's job is second.
    expect(one.queue?.place).toBe(2);
    expect(listed?.queue).toEqual(one.queue);
    const d = driver(w);
    lookAtEveryStep(d, watchOf(theirs.id));
    await workAll(d);
    expect((await ended(id))?.status).toBe("succeeded");
  });
});

describe("a press of Run sent twice (a network drop at submit)", () => {
  it("makes one run and one hold: the resend gets the run the first send made", async () => {
    const w = standInWorker();
    const holds = svc.holds.size;
    const rows = made();
    const press = { ...IMAGE, requestId: `press-${crypto.randomUUID()}` };
    const first = await run(press);
    // The answer never reached the page: it sends the same press again.
    const again = await run(press);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    const id = first.body.items![0].id;
    expect(again.body.items!.map((g) => g.id)).toEqual(first.body.items!.map((g) => g.id));
    expect(made() - rows, "runs made").toBe(1);
    expect(svc.holds.size - holds, "holds made").toBe(1);
    // The reserve names the press, as the account's own (never the page's id as it is).
    const ids = svc.callsOf("/v1/reserve").slice(-1).map((c) => (c.body as { requestId?: string }).requestId);
    expect(ids[0]).toMatch(/^r_[0-9a-f]{32}$/);
    expect(ids).not.toContain(press.requestId);
    // Another account's press under the same page id is its own press.
    const theirs = await run(press, b1);
    expect(theirs.status, JSON.stringify(theirs.body)).toBe(201);
    expect(theirs.body.items![0].id).not.toBe(id);
    expect(svc.holds.size - holds, "holds made").toBe(2);
    const d = driver(w);
    const watch = watchOf(id);
    lookAtEveryStep(d, watch);
    await workAll(d);
    await expectOnce(id, watch, { prompts: 1, place: 1 });
  });

  it("a resend that comes while the first send still waits for the billing service makes no second run or hold", async () => {
    standInWorker();
    expect((await priceCheck(IMAGE)).body.quote?.allowed).toBe(true);
    const holds = svc.holds.size;
    const rows = made();
    const press = { ...IMAGE, requestId: `press-${crypto.randomUUID()}` };
    await svc.downFor(3000);
    const first = run(press);
    await sleep(1000);
    // A proxy cut the first request short: the page sends the press again.
    const again = run(press);
    const [a, b] = await Promise.all([first, again]);
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(b.body.items!.map((g) => g.id)).toEqual(a.body.items!.map((g) => g.id));
    expect(made() - rows, "runs made").toBe(1);
    expect(svc.holds.size - holds, "holds made").toBe(1);
  });

  it("a send that stops waiting for the billing service after a resend of the same press made its run leaves that run's hold alone", async () => {
    const w = standInWorker();
    expect((await priceCheck(IMAGE)).body.quote?.allowed).toBe(true);
    const rows = made();
    const was = { ...billing.RESERVE_RETRY };
    // One try for the first send, then its whole wait is over.
    Object.assign(billing.RESERVE_RETRY, { forMs: 3000, firstMs: 200 });
    const press = { ...IMAGE, requestId: `press-${crypto.randomUUID()}` };
    try {
      // The service answers the first send's reserve only after the app stopped waiting for it.
      Object.assign(svc, { slowMs: 2500, slowPath: "/v1/reserve" });
      const reserves = svc.callsOf("/v1/reserve").length;
      const first = run(press);
      for (let i = 0; i < 200 && svc.callsOf("/v1/reserve").length === reserves; i++) await sleep(10);
      expect(svc.callsOf("/v1/reserve").length, "the first send's reserve reached the service").toBe(reserves + 1);
      // The page sends the press again, and the service answers that one at once: it makes the run.
      Object.assign(svc, { slowMs: 0, slowPath: null });
      const again = await run(press);
      expect(again.status, JSON.stringify(again.body)).toBe(201);
      const id = again.body.items![0].id;
      // Only then does the first send stop waiting.
      expect((await first).status).toBe(503);
      expect(made() - rows, "runs made").toBe(1);
      const hold = svc.holds.get(holdOf(id)!)!;
      const requestId = hold.requestId;
      expect(db().prepare("SELECT COUNT(*) AS n FROM billing_outbox WHERE key = ?").get(`release:request:${requestId}`)).toEqual({ n: 0 });
      await outbox.drainOutbox(Date.now() + outbox.REQUEST_RELEASE_AFTER_MS + 1000);
      expect(hold.released, "the run's hold stays open").toBe(false);
      expect(svc.callsOf("/v1/release").some((c) => (c.body as { requestId?: string }).requestId === requestId)).toBe(false);
      // The run finishes and settles against its own hold.
      const watch = watchOf(id);
      const d = driver(w);
      lookAtEveryStep(d, watch);
      await workAll(d);
      await expectOnce(id, watch, { place: 1 });
      expect(hold.released).toBe(false);
    } finally {
      Object.assign(billing.RESERVE_RETRY, was);
    }
  });

  it("a press refused by the limits after its hold was made gives the hold back, and a resend of it is a new try with a hold of its own, never a run against that hold", async () => {
    standInWorker();
    (svc.policy as { limits: { activeRuns: number } }).limits.activeRuns = 1;
    billing.resetBillingCache();
    expect((await priceCheck(IMAGE)).body.quote?.allowed).toBe(true);
    const rows = made();
    const press = { ...IMAGE, requestId: `press-${crypto.randomUUID()}` };
    // The first press's reserve is slow; meanwhile another press makes a run, so the first is over the limit once
    // its hold is made.
    Object.assign(svc, { slowMs: 800, slowPath: "/v1/reserve" });
    const reserves = svc.callsOf("/v1/reserve").length;
    const first = run(press);
    for (let i = 0; i < 200 && svc.callsOf("/v1/reserve").length === reserves; i++) await sleep(10);
    Object.assign(svc, { slowMs: 0, slowPath: null });
    const other = await run({ ...IMAGE, requestId: `press-${crypto.randomUUID()}` });
    expect(other.status, JSON.stringify(other.body)).toBe(201);
    const a = await first;
    expect(a.status, JSON.stringify(a.body)).toBe(429);
    expect(made() - rows, "runs made").toBe(1);
    const reserve = svc.callsOf("/v1/reserve").find((c, i) => i >= reserves && (c.body as { requestId?: string }).requestId !== undefined);
    const requestId = (reserve!.body as { requestId: string }).requestId;
    const hold = [...svc.holds.values()].find((h) => h.requestId === requestId)!;
    for (let i = 0; i < 100 && !hold.released; i++) {
      await outbox.sweepBilling();
      await sleep(10);
    }
    expect(hold.released, "the refused press's hold goes back").toBe(true);
    // The other run ends, so the limit lets the press through now; its answer was lost, and the page sends it again.
    db().prepare("UPDATE generations SET status = 'canceled' WHERE id = ?").run(other.body.items![0].id);
    const before = svc.callsOf("/v1/reserve").length;
    const again = await run(press);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    const tried = svc.callsOf("/v1/reserve").slice(before).map((c) => (c.body as { requestId?: string }).requestId);
    expect(tried.length, "one new reserve").toBe(1);
    expect(tried[0], "under a request id of its own").not.toBe(requestId);
    const runId = again.body.items![0].id;
    expect(svc.holds.get(holdOf(runId)!)?.requestId).toBe(tried[0]);
    expect(hold.released, "the first try's hold stays given back").toBe(true);
    expect(made() - rows, "runs made").toBe(2);
    // Sent once more: the run it made, with no new reserve.
    const third = await run(press);
    expect(third.body.items!.map((g) => g.id)).toEqual([runId]);
    expect(svc.callsOf("/v1/reserve").length).toBe(before + 1);
  });

  it("with hosted runs off, a press id changes nothing: each request makes its run, as before", async () => {
    delete process.env.FUOBE_HOSTED_RUNS;
    delete process.env.FUOBE_BILLING_URL;
    try {
      standInWorker();
      const press = { ...IMAGE, requestId: `press-${crypto.randomUUID()}` };
      const owner = `${auth.SESSION_COOKIE}=${auth.createSession().value}`;
      const first = await run(press, owner);
      const again = await run(press, owner);
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      expect(again.status, JSON.stringify(again.body)).toBe(201);
      expect(again.body.items![0].id).not.toBe(first.body.items![0].id);
      expect((db().prepare("SELECT COUNT(*) AS n FROM run_requests WHERE request_id = ?").get(press.requestId) as { n: number }).n).toBe(0);
    } finally {
      process.env.FUOBE_HOSTED_RUNS = "1";
    }
  });
});

describe("a reserve the billing service refuses or never answers", () => {
  it("an answer that would be the same on every try (a refused request) is a refusal in plain words at once, not after the whole wait", async () => {
    standInWorker();
    expect((await priceCheck(IMAGE)).body.quote?.allowed).toBe(true);
    const rows = made();
    const reserves = svc.callsOf("/v1/reserve").length;
    svc.reserveStatus = 401;
    const t = Date.now();
    const r = await run(IMAGE);
    expect(r.status, JSON.stringify(r.body)).toBe(503);
    expect(r.body.error).toBe(billing.BILLING_WAIT.run);
    expect(Date.now() - t).toBeLessThan(5000);
    expect(svc.callsOf("/v1/reserve").length - reserves, "tries").toBe(1);
    expect(made()).toBe(rows);
    // Nothing was held there, so nothing is released.
    expect((db().prepare("SELECT COUNT(*) AS n FROM billing_outbox WHERE key LIKE 'release:request:%' AND created_at >= ?").get(t) as { n: number }).n).toBe(0);
  });

  it("a press whose tries got no answer in time is refused within the whole wait, the hold the service made meanwhile goes back, and a resend of it is a new try", async () => {
    standInWorker();
    expect((await priceCheck(IMAGE)).body.quote?.allowed).toBe(true);
    const rows = made();
    const was = { ...billing.RESERVE_RETRY };
    Object.assign(billing.RESERVE_RETRY, { forMs: 3000, firstMs: 200 });
    // The service takes each reserve, but answers only after the app stopped waiting.
    Object.assign(svc, { slowMs: 2500, slowPath: "/v1/reserve" });
    const press = { ...IMAGE, requestId: `press-${crypto.randomUUID()}` };
    try {
      const t = Date.now();
      const r = await run(press);
      expect(r.status, JSON.stringify(r.body)).toBe(503);
      expect(r.body.error).toBe(billing.BILLING_WAIT.run);
      expect(Date.now() - t, "within the whole wait").toBeLessThanOrEqual(3000 + 500);
      expect(made()).toBe(rows);
      await sleep(600);
      const held = [...svc.holds.values()].filter((h) => h.account === A && !h.released && h.createdAt >= t);
      expect(held.length, "the service made a hold the app never heard of").toBe(1);
      // Its release waits a minute (a reserve still on its way is answered first), then goes.
      await outbox.drainOutbox(Date.now() + 1000);
      expect(held[0].released).toBe(false);
      await outbox.drainOutbox(Date.now() + outbox.REQUEST_RELEASE_AFTER_MS + 1000);
      expect(held[0].released, "released by its request id").toBe(true);
      expect(svc.callsOf("/v1/release").some((c) => (c.body as { requestId?: string }).requestId === held[0].requestId)).toBe(true);
      // The page sends the same press again: a new try, under a request id of its own, never the hold that went back.
      Object.assign(svc, { slowMs: 0, slowPath: null });
      const reserves = svc.callsOf("/v1/reserve").length;
      const again = await run(press);
      expect(again.status, JSON.stringify(again.body)).toBe(201);
      const tried = svc.callsOf("/v1/reserve").slice(reserves).map((c) => (c.body as { requestId?: string }).requestId);
      expect(tried.length).toBe(1);
      expect(tried[0]).not.toBe(held[0].requestId);
      expect(svc.holds.get(holdOf(again.body.items![0].id)!)?.requestId).toBe(tried[0]);
      expect(made()).toBe(rows + 1);
    } finally {
      Object.assign(billing.RESERVE_RETRY, was);
    }
  });
});

describe("the worker steps aside for another program", () => {
  it("a game takes the GPU for 40 minutes from minute 15: the run goes back in line in its place, waits past its wait limit, and its output arrives with no error", async () => {
    clock();
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id);
    comfy.inner.opts.steps = 6;
    comfy.inner.opts.stepMs = 100;
    const d = driver(w);
    // Minute 15 of a long render: a game starts, and the worker steps aside at its next beat.
    const stepped = stepAsideWhenRunning(d, watch, "gpu-busy:game.exe", () => pass(15 * MIN, [d], watch));
    await workAll(d);
    expect(stepped()).toBe(true);
    const back = taskOf(id)!;
    expect(back.state).toBe("waiting");
    expect(back.requeues, "a step aside costs no attempt").toBe(0);
    // The game runs for 40 minutes, past the run's 20 minute wait limit. Near its end, another account presses Run: with
    // the only worker stepped aside, its run is taken all the same and waits in line behind this one (the price check
    // lets it run and says it starts when a GPU is free).
    await pass(35 * MIN, [d], watch);
    const check = await priceCheck(IMAGE, b1);
    expect(check.body.quote).toMatchObject({ allowed: true });
    expect((check.body as { line?: unknown }).line).toMatchObject({ unknown: true });
    const theirs = await run(IMAGE, b1);
    expect(theirs.status, JSON.stringify(theirs.body)).toBe(201);
    await pass(5 * MIN, [d], watch);
    expect(getGeneration(id)).toMatchObject({ status: "queued", message: POOL_WORDS.inLine, queue: { place: 1, unknown: true } });
    expect(getGeneration(theirs.body.items![0].id)).toMatchObject({ status: "queued", queue: { place: 2, unknown: true } });
    // The game ends: it runs first, in its place, and settles against the hold it was given at Run.
    const hold = holdOf(id);
    d.pause(null);
    lookAtEveryStep(d, watch);
    await workAll(d);
    await expectOnce(id, watch, { place: 1 });
    expect(svc.reportsFor(id).map((r) => r.holdId)).toEqual([hold]);
  });

  it("with the studio's own wait limit (no billing service), the same: a run a worker took once never fails at the wait limit", async () => {
    clock();
    delete process.env.FUOBE_BILLING_URL;
    process.env.FUOBE_HOSTED_FREE = "1";
    process.env.FUOBE_POOL_WAIT_MIN = "20";
    try {
      const w = standInWorker();
      const { id } = await pressRun();
      const watch = watchOf(id);
      const d = driver(w);
      stepAsideWhenRunning(d, watch, "gpu-busy:blender.exe");
      await workAll(d);
      await pass(40 * MIN, [d], watch);
      expect(getGeneration(id)).toMatchObject({ status: "queued", queue: { place: 1 } });
      d.pause(null);
      lookAtEveryStep(d, watch);
      await workAll(d);
      const g = await ended(id);
      await watch.look();
      expect(watch.problems({ place: 1 })).toEqual([]);
      expect(g?.status).toBe("succeeded");
      expect(g!.outputs).toHaveLength(1);
      expect(assetsOf(id)).toBe(1);
    } finally {
      delete process.env.FUOBE_POOL_WAIT_MIN;
    }
  });

  it("a look at the run that fails while it waits back in line past its wait limit changes nothing: it stays In line in its place, and its output arrives", async () => {
    clock();
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id);
    const d = driver(w);
    stepAsideWhenRunning(d, watch, "gpu-busy:game.exe");
    await workAll(d);
    expect(taskOf(id)!.state).toBe("waiting");
    // The game runs 25 minutes, past the run's 20 minute wait limit.
    await pass(25 * MIN, [d], watch);
    expect(getGeneration(id)?.status).toBe("queued");
    // One look of the runner's fails (a busy database in a deploy's overlap, say).
    const spy = vi.spyOn(comfyProvider, "poll").mockRejectedValueOnce(new Error("database is locked"));
    try {
      await tick();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(getGeneration(id)).toMatchObject({ status: "queued", message: POOL_WORDS.inLine, queue: { place: 1 } });
    expect(taskOf(id)!.state).toBe("waiting");
    // The game ends: it runs, and nothing was lost.
    d.pause(null);
    lookAtEveryStep(d, watch);
    await workAll(d);
    await expectOnce(id, watch, { place: 1 });
  });
});

describe("retries", () => {
  it("its ComfyUI crashes twice, then works: back in line once with its place kept, and the output arrives once", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id);
    const d = driver(w);
    let crashes = 0;
    d.onStep(async (step) => {
      await tick();
      await watch.look();
      // Its ComfyUI crashes twice while running the job (it comes back empty).
      if (step === "running" && crashes < 2) {
        crashes++;
        await comfy.crash();
        await comfy.start();
      }
    });
    await workAll(d);
    expect(crashes).toBe(2);
    expect(d.steps.filter((s) => s === "gone")).toHaveLength(2);
    // The worker's resend took the first loss; the second put it back in line, which counts once.
    expect(taskOf(id)!.requeues).toBe(1);
    await expectOnce(id, watch, { place: 1 });
    expect(watch.path("session")).toContain("queued");
  });
});

describe("a run that can never succeed here", () => {
  /** A worker that may run every lane but the picture model's. */
  const workerWithoutTheModel = () => standInWorker("without-the-model", { lanes: allLanes(loadIndex(), sha).map((l) => l.lane).filter((l) => l !== imageLane()) });

  it("no worker has the model: Run is refused and nothing is made (no run, no task, no hold)", async () => {
    workerWithoutTheModel();
    const rows = made();
    const taskCount = (db().prepare("SELECT COUNT(*) AS n FROM relay_tasks").get() as { n: number }).n;
    const holds = svc.holds.size;
    const r = await run(IMAGE);
    expect(r.status).toBe(403);
    expect(made()).toBe(rows);
    expect((db().prepare("SELECT COUNT(*) AS n FROM relay_tasks").get() as { n: number }).n).toBe(taskCount);
    expect(svc.holds.size).toBe(holds);
  });

  it("its price check says so before Run, so Run is off and no run is made that would wait for nothing", async () => {
    workerWithoutTheModel();
    const rows = made();
    const q = await priceCheck(IMAGE);
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    expect(q.body.place).toBe("pool");
    expect(q.body.quote).toMatchObject({ allowed: false, code: "not-offered" });
    expect(made()).toBe(rows);
  });
});

describe("no worker online", () => {
  it("with every worker paused, the price check lets the run go and says it starts when a GPU is free", async () => {
    standInWorker("paused", { paused: true });
    const q = await priceCheck(IMAGE);
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    expect(q.body.place).toBe("pool");
    expect(q.body.quote).toMatchObject({ allowed: true, text: "Free" });
    expect((q.body as { line?: unknown }).line).toMatchObject({ unknown: true, long: true });
    // A guest is told the same.
    const g = await priceCheck(IMAGE, "");
    expect(g.body.quote).toMatchObject({ allowed: true });
    expect((g.body as { line?: unknown }).line).toMatchObject({ unknown: true });
  });

  it("Run pressed while every worker is away is taken: In line, starts when one is back, and its result arrives", async () => {
    const away = [
      standInWorker("paused here", { connected: true }),
      standInWorker("never connected", { connected: false }),
      standInWorker("silent", {}),
      standInWorker("outside its hours", {}),
    ];
    db().prepare("UPDATE relay_workers SET paused_local = 1, local_why = 'gpu-busy:game.exe' WHERE id = ?").run(away[0].id);
    db().prepare("UPDATE relay_workers SET seen_at = ? WHERE id = ?").run(Date.now() - 3 * MIN, away[2].id);
    pool.patchWorker(away[3].id, { hours: { tz: "UTC", days: {} } });
    const rows = made();
    const holds = svc.holds.size;
    const { id } = await pressRun();
    expect(made()).toBe(rows + 1);
    expect(svc.holds.size).toBe(holds + 1);
    expect(getGeneration(id)).toMatchObject({ status: "queued", message: POOL_WORDS.inLine, queue: { place: 1, unknown: true } });
    // The silent one beats again: the line has an estimate again, and the run is next.
    db().prepare("UPDATE relay_workers SET seen_at = ? WHERE id = ?").run(Date.now(), away[2].id);
    expect((await priceCheck(IMAGE)).body.quote).toMatchObject({ allowed: true, text: "Free" });
    expect((getGeneration(id) as { queue?: { unknown?: boolean } }).queue?.unknown).toBeUndefined();
  });

  it("A1: every worker paused for 40 minutes under a policy that never gives up: the run waits In line, then its result arrives", async () => {
    clock();
    svc.policy = { ...svc.policy, limits: { ...(svc.policy.limits as Record<string, unknown>), giveUpS: 0 } };
    const w = standInWorker();
    const d = driver(w);
    d.pause("here-now");
    await d.beat();
    const { id } = await pressRun();
    const watch = watchOf(id);
    // No wait limit on its task, whatever the reserve answer said.
    expect(taskOf(id)!.not_after).toBeNull();
    expect(getGeneration(id)).toMatchObject({ status: "queued", message: POOL_WORDS.inLine, queue: { place: 1, unknown: true } });
    await pass(40 * MIN, [d], watch);
    expect(getGeneration(id)).toMatchObject({ status: "queued", queue: { place: 1 } });
    d.pause(null);
    lookAtEveryStep(d, watch);
    await workAll(d);
    await expectOnce(id, watch, { place: 1 });
  });

  it("a worker making room for local work first is on: the run goes in line", async () => {
    const w = standInWorker();
    db().prepare("UPDATE relay_workers SET local_why = 'waiting-for-yield' WHERE id = ?").run(w.id);
    expect((await priceCheck(IMAGE)).body.quote).toMatchObject({ allowed: true, text: "Free" });
  });
});

describe("one job per worker", () => {
  it("a second claim while the worker holds a job gets nothing new, and a job left sending goes back in line in its place", async () => {
    clock();
    const w = standInWorker();
    const mine = await pressRun();
    const theirs = await pressRun(IMAGE, b1);
    const watch = watchOf(mine.id);
    const d = driver(w);
    await d.beat();
    const api = apiAs(routes, null, { authorization: `Bearer ${w.token}` });
    const claim = async (running: string[]) => {
      const r = await api("/api/gpu/computer/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device: "worker", running }) });
      return r.status === 200 ? ((await r.json()) as { task: { id: string } }).task.id : r.status;
    };
    expect(await claim([])).toBe(mine.task.id);
    // It holds that one: a second claim gets nothing new, whatever it says it runs.
    expect(await claim([mine.task.id])).toBe(204);
    expect(await claim([])).toBe(mine.task.id);
    expect(taskOf(theirs.id)!.state).toBe("waiting");
    await tick();
    await watch.look();
    // It never sends the job to its ComfyUI: 15 minutes after the claim the job goes back in line, still first.
    await pass(16 * MIN, [d], watch);
    expect(taskOf(mine.id)!.state).toBe("waiting");
    expect(getGeneration(mine.id)).toMatchObject({ status: "queued", message: POOL_WORDS.inLine, queue: { place: 1 } });
    expect(getGeneration(theirs.id)?.queue?.place).toBe(2);
    // Then both run, in that order.
    lookAtEveryStep(d, watch);
    await workAll(d);
    await expectOnce(mine.id, watch, { place: 1 });
    expect(getGeneration(theirs.id)?.status).toBe("succeeded");
  });
});

describe("the billing service down or restarting", () => {
  it("a run that finishes while the service is down settles once when it is back, and its account sees no error", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id);
    // Down from the moment the run was set aside until after it finished.
    await svc.stop();
    const d = driver(w);
    lookAtEveryStep(d, watch);
    await workAll(d);
    await until(() => done(getGeneration(id)));
    await outbox.sweepBilling();
    expect(svc.reportsFor(id)).toEqual([]);
    await watch.look();
    await svc.start();
    // The outbox's next try.
    await outbox.drainOutbox(Date.now() + 10 * MIN);
    await expectOnce(id, watch, { prompts: 1, place: 1 });
  });

  it("Run pressed while the service restarts waits for it: the run is made once, with one hold, and finishes", async () => {
    const w = standInWorker();
    // The account's policy is known from its price check.
    expect((await priceCheck(IMAGE)).body.quote?.allowed).toBe(true);
    const rows = made();
    const holds = svc.holds.size;
    const reserves = svc.callsOf("/v1/reserve").length;
    await svc.downFor(10_000);
    const t = Date.now();
    const r = await run(IMAGE);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(Date.now() - t, "it waited for the service").toBeGreaterThanOrEqual(9_000);
    expect(made() - rows).toBe(1);
    expect(svc.holds.size - holds).toBe(1);
    // Every try was the same press: one request id.
    const ids = new Set(svc.callsOf("/v1/reserve").slice(reserves).map((c) => (c.body as { requestId?: string }).requestId));
    expect(ids.size).toBe(1);
    const id = r.body.items![0].id;
    const watch = watchOf(id);
    const d = driver(w);
    lookAtEveryStep(d, watch);
    await workAll(d);
    await expectOnce(id, watch, { prompts: 1, place: 1 });
  });

  it("a service that stays down past the wait: Run says to try again in a moment, in plain words, and nothing is made", async () => {
    standInWorker();
    expect((await priceCheck(IMAGE)).body.quote?.allowed).toBe(true);
    const rows = made();
    const was = { ...billing.RESERVE_RETRY };
    Object.assign(billing.RESERVE_RETRY, { forMs: 1500, firstMs: 200 });
    try {
      await svc.stop();
      const r = await run(IMAGE);
      expect(r.status, JSON.stringify(r.body)).toBe(503);
      expect(r.body.error).toBe(billing.BILLING_WAIT.run);
      expect(r.body.error).not.toMatch(/paus|error|service|GPU|worker/i);
      expect(made()).toBe(rows);
    } finally {
      Object.assign(billing.RESERVE_RETRY, was);
      await svc.start();
    }
  });

  it("down for 30 s while one account presses Run and another's run settles: both finish, each settles once, and no error shows", async () => {
    const w = standInWorker();
    expect((await priceCheck(IMAGE)).body.quote?.allowed).toBe(true);
    const theirs = await pressRun(IMAGE, b1);
    await svc.downFor(30_000);
    // Account A presses Run during the outage; meanwhile the worker renders B's run, which finishes and can't settle yet.
    const press = run(IMAGE);
    const d = driver(w);
    d.onStep(() => tick());
    await d.beat();
    expect(await d.runOne()).toBe(true);
    await until(() => done(getGeneration(theirs.id)));
    expect(getGeneration(theirs.id)?.status).toBe("succeeded");
    await outbox.sweepBilling();
    expect(svc.reportsFor(theirs.id)).toEqual([]);
    const r = await press;
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.items![0].id;
    const watch = watchOf(id);
    lookAtEveryStep(d, watch);
    await workAll(d);
    // The outbox's next try reaches the service again.
    await outbox.drainOutbox(Date.now() + 10 * MIN);
    await expectOnce(id, watch, { prompts: 1, place: 1 });
    expect(await reportsOf(theirs.id)).toEqual([{ holdId: holdOf(theirs.id), kind: "settle", status: "succeeded" }]);
    expect(svc.late).toEqual([]);
  });

  it("the last policy it gave stands for 10 minutes while it doesn't answer, then runs wait for it", async () => {
    clock();
    expect(await billing.policy(A)).toBeTruthy();
    await svc.stop();
    try {
      vi.setSystemTime(Date.now() + 9 * MIN);
      expect(await billing.policy(A), "9 minutes on").toBeTruthy();
      vi.setSystemTime(Date.now() + 2 * MIN);
      expect(await billing.policy(A), "11 minutes on").toBeNull();
    } finally {
      await svc.start();
    }
    vi.setSystemTime(Date.now() + MIN);
    expect(await billing.policy(A), "answered again").toBeTruthy();
  });
});

describe("the run ceiling per lane", () => {
  it("a run longer than 45 minutes in a lane whose ceiling is 60 minutes finishes", async () => {
    clock();
    qs.saveQueueSettings({ ...qs.queueSettings(), runCeilingS: { default: 2700, lanes: { [imageLane()]: 3600 } } });
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id);
    const d = driver(w);
    let long = false;
    d.onStep(async (step) => {
      await tick();
      await watch.look();
      if (step === "running" && !long) {
        long = true;
        await pass(50 * MIN, [d], watch);
      }
    });
    await workAll(d);
    expect(long).toBe(true);
    await expectOnce(id, watch, { prompts: 1, place: 1 });
  });

  it("its hold asks to stay open for the lane's run ceiling and the time back in line: a long run that went back in line still settles against its own hold", async () => {
    clock();
    // A 3 hour lane, and an hour back in line covered. The service's own fixed rule (2 hours after the wait limit) would
    // close the hold before this run ends.
    qs.saveQueueSettings({ ...qs.queueSettings(), runCeilingS: { default: 2700, lanes: { [imageLane()]: 3 * 3600 } }, pausedBudgetS: 3600 });
    const w = standInWorker();
    const { id } = await pressRun();
    const reserve = svc.callsOf("/v1/reserve").at(-1)!.body as { timing?: { runMs: number; pausedMs: number } };
    const attempt = pool.SENDING_MS + 2 * 3 * 3_600_000 + pool.SAVING_MS;
    expect(reserve.timing).toEqual({ runMs: pool.MAX_ATTEMPTS * attempt, pausedMs: 3_600_000 });
    const hold = svc.holds.get(holdOf(id)!)!;
    expect(hold.closeBy - hold.createdAt).toBe(svc.maxWaitMs + pool.MAX_ATTEMPTS * attempt + 3_600_000);
    const watch = watchOf(id);
    comfy.inner.opts.steps = 6;
    comfy.inner.opts.stepMs = 100;
    const d = driver(w);
    // A game takes the GPU 10 minutes in, for 40 minutes: the run goes back in line in its place.
    const stepped = stepAsideWhenRunning(d, watch, "gpu-busy:game.exe", () => pass(10 * MIN, [d], watch));
    await workAll(d);
    expect(stepped()).toBe(true);
    await pass(40 * MIN, [d], watch);
    expect(getGeneration(id)).toMatchObject({ status: "queued", message: POOL_WORDS.inLine, queue: { place: 1 } });
    // Back, it runs for two and a half hours.
    d.pause(null);
    let long = false;
    d.onStep(async (step) => {
      await tick();
      await watch.look();
      if (step === "running" && !long) {
        long = true;
        await pass(150 * MIN, [d], watch);
      }
    });
    await workAll(d);
    expect(long).toBe(true);
    await expectOnce(id, watch, { place: 1 });
    expect(Date.now()).toBeGreaterThan(hold.createdAt + svc.maxWaitMs + svc.holdLifeMs);
    expect(svc.reportsFor(id)).toEqual([{ holdId: hold.id, kind: "settle", status: "succeeded" }]);
    expect(svc.late).toEqual([]);
  });

  it("a run past its lane's ceiling is stopped by its worker and put back in line once, with its place kept; past it again, it ends in plain words", async () => {
    clock();
    qs.saveQueueSettings({ ...qs.queueSettings(), runCeilingS: { default: 2700, lanes: { [imageLane()]: 600 } } });
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id);
    const d = driver(w);
    const after: string[] = [];
    let actedThisClaim = false;
    d.onStep(async (step) => {
      await tick();
      await watch.look();
      if (step === "claim") actedThisClaim = false;
      if (step !== "running" || actedThisClaim) return;
      actedThisClaim = true;
      // The attempt runs past the 10 minute ceiling: the studio leaves it to its worker's run limit.
      await pass(11 * MIN, [d], watch);
      after.push(getGeneration(id)!.status);
      // The worker's run limit stops it and gives it back, as the worker program does.
      tasks.report(taskOf(id)!, { event: "give-back", why: "run-limit" }, () => ({ error: "unused" }));
      await tick();
      await watch.look();
    });
    await workAll(d);
    expect(after).toEqual(["running", "running"]);
    expect(watch.path("session")).toEqual(["queued", "running", "queued", "running", "failed"]);
    // Until it truly can't finish: only In line, with its place kept, and Working.
    expect(watch.problems({ place: 1 }).filter((p) => !p.includes('"status":"failed"'))).toEqual([]);
    await expectFreeFailure(id);
  });

  it("each attempt has the lane's ceiling to itself: 7 minutes into a 10 minute ceiling its ComfyUI loses the job, the worker sends it again, and the output arrives once", async () => {
    clock();
    qs.saveQueueSettings({ ...qs.queueSettings(), runCeilingS: { default: 2700, lanes: { [imageLane()]: 600 } } });
    const w = standInWorker();
    const { id, task } = await pressRun();
    const watch = watchOf(id);
    const d = driver(w);
    let crashed = false;
    let resent = false;
    d.onStep(async (step) => {
      await tick();
      await watch.look();
      if (step !== "running") return;
      if (!crashed) {
        // The first attempt runs 7 minutes, then its ComfyUI restarts and loses the job.
        crashed = true;
        await pass(7 * MIN, [d], watch);
        await comfy.crash();
        await comfy.start();
      } else if (!resent && d.steps.includes("gone")) {
        // The worker sent it again: 4 minutes into this attempt (11 since the first began), it is still working.
        resent = true;
        await pass(4 * MIN, [d], watch);
        expect(getGeneration(id)).toMatchObject({ status: "running", message: POOL_WORDS.working });
      }
    });
    await workAll(d);
    expect(crashed && resent).toBe(true);
    await expectOnce(id, watch, { place: 1 });
    // Its ComfyUI got the job twice (once per attempt), under the task's one prompt id.
    expect(comfy.postsOf(task.prompt_id)).toBe(2);
  });
});

describe("the server's disk is low when the result comes", () => {
  it("the run ends in the one plain sentence, never words about uploads or a pause", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const d = driver(w);
    d.onStep(async (step) => {
      await tick();
      // While it renders, the server's disk drops below the free space it keeps.
      if (step === "running") globalThis.__fuobeTestDiskFree = 1;
    });
    try {
      await workAll(d);
      const g = await ended(id);
      expect(g?.status).toBe("failed");
    } finally {
      globalThis.__fuobeTestDiskFree = 1e13;
    }
    const g = await expectFreeFailure(id);
    expect(g.error).not.toBe(ACCOUNT_MESSAGES.diskLow);
    expect(db().prepare("SELECT error FROM generations WHERE id = ?").get(id)).toEqual({ error: ACCOUNT_MESSAGES.diskLow });
  });
});

describe("a deploy while results are being sent", () => {
  it("a burst of 503s while the result is sent ends the run today: the worker gives up after 3 failed parts in a row", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const d = driver(w);
    d.onStep(() => tick());
    // The studio answers 503 to the next 6 parts of its result, as a deploy's proxy does for a few seconds.
    d.answer("part", 503, 6);
    await workAll(d);
    expect(d.calls.filter((c) => c.startsWith("part")).length).toBeGreaterThanOrEqual(3);
    await expectFreeFailure(id);
  });
});

describe("two app processes on one database (a deploy's overlap)", () => {
  let app2: AppProcess;
  const appEnv = () => ({ FUOBE_HOSTED_RUNS: "1", FUOBE_BILLING_URL: svc.address, FUOBE_BILLING_TOKEN: svc.token, COMFYUI_URL: DEAD, FUOBE_PUBLIC_SIGNUP: "1" });
  beforeAll(async () => {
    app2 = await startAppProcess({ dataDir: dir, env: appEnv(), allow: [comfy.url] });
  });
  afterAll(async () => {
    await app2?.stop();
  });

  /** The run as the account's session reads it from the other process. */
  const there = (id: string) => async () => (await app2.generation(id, a1)) as unknown as RunLike;

  /** When the app process that names its turns `token` last said it still runs (none: it exited, or never ran). */
  const seenAt = (token: string) => (db().prepare("SELECT seen_at FROM app_processes WHERE token = ?").get(token) as { seen_at: number } | undefined)?.seen_at;
  /** The app process that holds the turn to save the run's result. */
  const turnOf = (id: string) => (db().prepare("SELECT finish_by FROM generation_runs WHERE id = ?").get(id) as { finish_by: string | null } | undefined)?.finish_by ?? null;
  /** That process is in the middle of saving the run's result: it took the turn, minutes before its turn runs out. */
  const holdTurn = (id: string, token: string) => db().prepare("UPDATE generation_runs SET finish_by = ?, finish_until = ? WHERE id = ?").run(token, Date.now() + 4 * MIN, id);

  /** One more app process on this database, and the name its turns carry. */
  async function anotherApp(): Promise<{ app: AppProcess; token: string }> {
    const tokens = () => (db().prepare("SELECT token FROM app_processes").all() as { token: string }[]).map((r) => r.token);
    const known = new Set(tokens());
    const app = await startAppProcess({ dataDir: dir, env: appEnv(), allow: [comfy.url] });
    const token = tokens().find((t) => !known.has(t));
    if (!token) {
      await app.stop();
      throw new Error("The new app process never said it runs");
    }
    return { app, token };
  }

  it("each app process says its catalog version from its start, before it serves any worker's claim", async () => {
    const version = catalogVersion()!;
    const t0 = Date.now();
    db().prepare("DELETE FROM catalog_processes").run();
    // The other process's beat (every 5 s, from its start) says it again.
    for (let i = 0; i < 100 && !db().prepare("SELECT 1 FROM catalog_processes WHERE version = ?").get(version); i++) await sleep(100);
    const r = db().prepare("SELECT started_at, seen_at FROM catalog_processes WHERE version = ?").get(version) as { started_at: number; seen_at: number } | undefined;
    expect(r, "the catalog version of the app processes").toBeTruthy();
    expect(r!.seen_at).toBeGreaterThanOrEqual(t0);
    expect(r!.started_at).toBeLessThanOrEqual(r!.seen_at);
  });

  it("the other process serves the worker and a session: the same run, the same state", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id, { "other process": there(id) });
    const d = driver(w);
    d.via(app2.api);
    lookAtEveryStep(d, watch);
    await workAll(d);
    expect(d.calls.some((c) => c.startsWith("part"))).toBe(true);
    await expectOnce(id, watch, { prompts: 1, place: 1 });
    expect(watch.seen.filter((s) => s.where === "other process").map((s) => s.status)).toContain("succeeded");
    // The other process refuses the run to another account's session too.
    await expect(app2.generation(id, b1)).rejects.toThrow(/answered 403/);
  });

  it("a chain's next step both processes find ready at once is sent once: one job for it on the workers, run once", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const d = driver(w);
    await workAll(d);
    expect((await ended(id))?.status).toBe("succeeded");
    // The run's next step, made as its run's steps are (as the account, on this install's GPUs, with the run's stamp):
    // its input, the first step's picture, is ready for both processes.
    const first = JSON.parse((db().prepare("SELECT request_json FROM generations WHERE id = ?").get(id) as { request_json: string }).request_json);
    const [step] = runOnPool(A, () => withRunStamp(stampOf(first), () => createGenerations({ feature: "image", modelId: "oss-selftest-image", op: "edit", prompt: "invert it", chainFrom: "first" }, { dependsOn: id })));
    const sent = () => (db().prepare("SELECT external_id FROM generations WHERE id = ?").get(step.id) as { external_id: string | null }).external_id;
    const jobs = () => db().prepare("SELECT id FROM relay_tasks WHERE generation_id = ?").all(step.id).length;
    // Both runners turn at the same moment.
    await Promise.all([tick(), app2.tick()]);
    for (let i = 0; i < 200 && !sent(); i++) await sleep(25);
    expect(sent(), "sent by the first turn of one of them").toBeTruthy();
    // (A second hand-over, were there one, lands in the moments after.)
    await sleep(1500);
    await Promise.all([tick(), app2.tick()]);
    expect(jobs(), "its jobs on the workers").toBe(1);
    await workAll(d);
    expect((await ended(step.id))?.status).toBe("succeeded");
    expect(jobs()).toBe(1);
    const ran = db().prepare("SELECT COUNT(*) AS n FROM worker_jobs WHERE generation_id = ? AND event = 'finished'").get(step.id) as { n: number };
    expect(ran.n, "the workers ran it once").toBe(1);
  });

  it("a step and a preview picture the worker reports to the other process are seen here too: a refresh, both sessions, the list and the other process show the same step", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id, { "other process": there(id) });
    comfy.inner.opts.steps = 10;
    comfy.inner.opts.stepMs = 200;
    const d = driver(w);
    // The worker's calls reach the other process; this one's runner turns.
    d.via(app2.api);
    let n = 0;
    d.previews(() => jpegBase64(++n));
    const steps: (number | null)[][] = [];
    const pictures: (string | null)[] = [];
    d.onStep(async (step, _path, report) => {
      if (step !== "running" || Number(report?.value ?? 0) < 2) return;
      await tick();
      steps.push((await watch.look()).map((s) => s.progress));
      const g = (await sessionRead(a2)(id)) as RunLike & { preview?: string };
      pictures.push(g.preview ? await previewOf(a2, g.preview) : null);
    });
    await workAll(d);
    expect(steps.length, "looks while the worker said it was past step 2").toBeGreaterThan(0);
    for (const at of steps) {
      for (const p of at) expect(p ?? 0, "the step a look shows").toBeGreaterThan(0);
      expect(Math.max(...at.map((p) => p ?? 0)) - Math.min(...at.map((p) => p ?? 0)), "every look at one moment, the same step").toBeLessThanOrEqual(1 / 10 + 1e-9);
    }
    // The second device loads the picture from this process, though the other one took it.
    expect(pictures.some((p) => p && p.startsWith("ffd8ff"))).toBe(true);
    await expectOnce(id, watch, { prompts: 1, place: 1 });
  });

  it("while one process saves a finished run's result, the other leaves it to that process: the result is saved once, and the run settles once", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id, { "other process": there(id) });
    const d = driver(w);
    // This process's runner turns at every step but the result's parts: the result is saved below.
    d.onStep(async (step) => {
      if (step === "part") return;
      await tick();
      await watch.look();
    });
    await d.beat();
    expect(await d.runOne()).toBe(true);
    expect(taskOf(id)!.state).toBe("done");
    expect(getGeneration(id)?.status).toBe("running");
    // The other process starts saving the result, and is in the middle of moving its file when this one's runner turns.
    const pause = await app2.pauseNextSave();
    const theirs = app2.tick();
    await pause.paused;
    await tick();
    // (Only this process is looked at now: the other one waits in the middle of its move until it is released.)
    expect(getGeneration(id)?.status, "this process leaves the run to the one saving it").toBe("running");
    expect(getGeneration(id)?.message).toBe(POOL_WORDS.working);
    pause.release();
    await theirs;
    await expectOnce(id, watch, { prompts: 1, place: 1 });
  });

  it("a process that stopped while it saved a result leaves it to the other once its turn runs out", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id);
    const d = driver(w);
    d.onStep(async (step) => {
      if (step === "part") return;
      await tick();
      await watch.look();
    });
    await d.beat();
    expect(await d.runOne()).toBe(true);
    expect(getGeneration(id)?.status).toBe("running");
    // Another process took the turn and stopped (a deploy ended it) before it saved anything.
    db().prepare("UPDATE generation_runs SET finish_by = 'another-process', finish_until = ? WHERE id = ?").run(Date.now() + 60_000, id);
    await tick();
    expect(getGeneration(id)?.status).toBe("running");
    // Its turn runs out: this process saves the result.
    db().prepare("UPDATE generation_runs SET finish_until = ? WHERE id = ?").run(Date.now() - 1, id);
    await expectOnce(id, watch, { prompts: 1, place: 1 });
  });

  it("an app restarted while it saved a result collects it at once: the app that stopped gave its turn back as it exited", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id);
    const d = driver(w);
    d.onStep(async (step) => {
      if (step === "part") return;
      await tick();
      await watch.look();
    });
    await d.beat();
    expect(await d.runOne()).toBe(true);
    expect(getGeneration(id)?.status).toBe("running");
    // The app before the restart was saving the result (it holds the turn, for minutes yet) when it was told to stop.
    const { app, token } = await anotherApp();
    try {
      holdTurn(id, token);
      for (let i = 0; i < 3; i++) await tick();
      expect(getGeneration(id)?.status, "a turn whose app still runs is left to it").toBe("running");
      expect(updateLive(id, { message: POOL_WORDS.inLine })).toBe(false);
      // While it runs, it says so every few seconds: a turn it has held longer than its quiet limit stays its own.
      const quietSince = seenAt(token)! - QUIET_MS - 1000;
      db().prepare("UPDATE app_processes SET seen_at = ? WHERE token = ?").run(quietSince, token);
      for (let i = 0; i < 150 && seenAt(token)! <= quietSince; i++) await sleep(100);
      expect(seenAt(token), "its next word").toBeGreaterThan(quietSince);
      await tick();
      expect(getGeneration(id)?.status).toBe("running");
      expect(turnOf(id)).toBe(token);
    } finally {
      await app.stop();
    }
    // It exited as an app does when it is told to stop: its turn went with it, and this app saves the result now.
    expect(seenAt(token)).toBeUndefined();
    expect(turnOf(id)).toBeNull();
    await tick();
    expect(getGeneration(id)?.status).toBe("succeeded");
    await expectOnce(id, watch, { prompts: 1, place: 1 });
  });

  it("an app killed while it saved a result leaves it to this one once it has been quiet for 20 s, minutes before its turn runs out", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id);
    const d = driver(w);
    d.onStep(async (step) => {
      if (step === "part") return;
      await tick();
      await watch.look();
    });
    await d.beat();
    expect(await d.runOne()).toBe(true);
    const { app, token } = await anotherApp();
    holdTurn(id, token);
    await app.kill();
    // Killed: nothing of it ran as it ended, so its turn and its last word are still there.
    expect(turnOf(id)).toBe(token);
    await tick();
    expect(getGeneration(id)?.status, "its last word is a moment old: it may only be slow").toBe("running");
    // 20 s with no word from it: it stopped, and this app saves the result, long before its turn would run out.
    clock();
    vi.setSystemTime(Date.now() + QUIET_MS + 1000);
    await tick();
    expect(getGeneration(id)?.status).toBe("succeeded");
    expect(turnOf(id)).not.toBe(token);
    await expectOnce(id, watch, { prompts: 1, place: 1 });
  });

  it("a stop that lands after another process saved the result, while it waited for the workers, leaves the run saved: its file stays, and it settles once", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id, { "other process": there(id) });
    const d = driver(w);
    d.onStep(async (step) => {
      if (step === "part") return;
      await tick();
      await watch.look();
    });
    await d.beat();
    expect(await d.runOne()).toBe(true);
    expect(getGeneration(id)?.status).toBe("running");
    // The stop (a press of Stop in another tab) asks the run's workers to drop it, and waits for their answer.
    let asked!: () => void;
    const reached = new Promise<void>((r) => (asked = r));
    let answer!: () => void;
    const answered = new Promise<void>((r) => (answer = r));
    const realCancel = comfyProvider.cancel!;
    const cancel = vi.spyOn(comfyProvider, "cancel").mockImplementation(async (ctx) => {
      asked();
      await answered;
      return realCancel.call(comfyProvider, ctx);
    });
    try {
      const stopping = cancelGeneration(id);
      await reached;
      // Meanwhile the other process saves the result.
      await app2.tick();
      expect(getGeneration(id)?.status).toBe("succeeded");
      answer();
      await stopping;
    } finally {
      answer();
      cancel.mockRestore();
    }
    // The stop came too late: the run stays saved with its file, and its report is one settle, never a refund.
    expect(getGeneration(id)?.status).toBe("succeeded");
    await expectOnce(id, watch, { prompts: 1, place: 1 });
  });

  it("a run stopped while its result is saved stays stopped, and the file saved for it goes (none is left filling the account's space)", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const d = driver(w);
    // The stop lands while the result is saved: as its file is kept, the run is stopped (a cancel from another tab).
    db().exec(`CREATE TEMP TRIGGER stop_while_saved AFTER INSERT ON assets WHEN NEW.generation_id = '${id}' BEGIN UPDATE generations SET status = 'canceled' WHERE id = '${id}'; END`);
    try {
      await workAll(d);
      await until(() => assetsOf(id) === 0 && getGeneration(id)?.status === "canceled");
      for (let i = 0; i < 5; i++) await tick();
    } finally {
      db().exec("DROP TRIGGER IF EXISTS stop_while_saved");
    }
    expect(getGeneration(id)).toMatchObject({ status: "canceled" });
    expect(assetsOf(id)).toBe(0);
  });

  it("with the moderation service checking outputs, a run stopped while its result is saved is never brought back to wait for its check", async () => {
    const mod = await startFakeModeration();
    process.env.FUOBE_MODERATION_URL = mod.url;
    mod.run = { allowed: true, checkOutputs: true };
    try {
      const w = standInWorker();
      const { id } = await pressRun();
      const d = driver(w);
      db().exec(`CREATE TEMP TRIGGER stop_while_saved AFTER INSERT ON assets WHEN NEW.generation_id = '${id}' BEGIN UPDATE generations SET status = 'canceled' WHERE id = '${id}'; END`);
      try {
        await workAll(d);
        await until(() => assetsOf(id) === 0 && getGeneration(id)?.status === "canceled");
        for (let i = 0; i < 5; i++) await tick();
      } finally {
        db().exec("DROP TRIGGER IF EXISTS stop_while_saved");
      }
      expect(getGeneration(id)).toMatchObject({ status: "canceled" });
      expect((db().prepare("SELECT stage FROM generations WHERE id = ?").get(id) as { stage: string | null }).stage).toBeNull();
      expect((db().prepare("SELECT COUNT(*) AS n FROM output_checks WHERE generation_id = ?").get(id) as { n: number }).n).toBe(0);
      expect(assetsOf(id)).toBe(0);
      expect(mod.calls_of("/v1/check-output")).toEqual([]);
    } finally {
      delete process.env.FUOBE_MODERATION_URL;
      await mod.close();
    }
  });

  it("with the moderation service checking outputs, a process whose turn runs out while it saves a result leaves it to the process that took over: nothing of its own save is held or checked", async () => {
    const mod = await startFakeModeration();
    process.env.FUOBE_MODERATION_URL = mod.url;
    mod.run = { allowed: true, checkOutputs: true };
    try {
      const w = standInWorker();
      const { id } = await pressRun();
      const d = driver(w);
      // As its file is kept, the save here has taken past its turn, and another process took the turn over.
      db().exec(`CREATE TEMP TRIGGER turn_taken AFTER INSERT ON assets WHEN NEW.generation_id = '${id}' BEGIN UPDATE generation_runs SET finish_by = 'another-process', finish_until = ${Date.now() + 10 * MIN} WHERE id = '${id}'; END`);
      try {
        await workAll(d);
        await until(() => taskOf(id)?.state === "done" && assetsOf(id) === 0);
        for (let i = 0; i < 5; i++) await tick();
      } finally {
        db().exec("DROP TRIGGER IF EXISTS turn_taken");
      }
      // Nothing of this process's save is held or checked: its file went.
      expect(getGeneration(id)?.status).toBe("running");
      expect((db().prepare("SELECT stage FROM generations WHERE id = ?").get(id) as { stage: string | null }).stage).toBeNull();
      expect((db().prepare("SELECT COUNT(*) AS n FROM output_checks WHERE generation_id = ?").get(id) as { n: number }).n).toBe(0);
      expect(assetsOf(id)).toBe(0);
      // A slow look here changes nothing while the other process saves it.
      expect(updateLive(id, { status: "failed", error: "Timed out after 45 minutes", completed_at: Date.now() })).toBe(false);
      // The process holding the turn holds its own save for the check (here a result with no file, which succeeds as it is),
      // once: a run already held for its check is never held again.
      db().prepare("UPDATE generations SET stage = 'checking' WHERE id = ?").run(id);
      expect(outputChecks.holdForCheck(id, [], { live: true, turn: "another-process" })).toBe(false);
      db().prepare("UPDATE generations SET stage = NULL WHERE id = ?").run(id);
      expect(outputChecks.holdForCheck(id, [], { live: true, turn: "a-third-process" })).toBe(false);
      expect(outputChecks.holdForCheck(id, [], { live: true, turn: "another-process" })).toBe(true);
      expect(getGeneration(id)?.status).toBe("succeeded");
    } finally {
      delete process.env.FUOBE_MODERATION_URL;
      await mod.close();
    }
  });

  it("a look at a run that comes back after another process saved it, or while another process saves it, changes nothing", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id);
    const d = driver(w);
    lookAtEveryStep(d, watch);
    await workAll(d);
    await expectOnce(id, watch, { prompts: 1, place: 1 });
    const saved = getGeneration(id)!;
    // A slow look from before the save says it still works, or that it failed: the saved run stays as it is.
    expect(updateLive(id, { status: "running", progress: 0.5, message: POOL_WORDS.working })).toBe(false);
    expect(updateLive(id, { status: "failed", error: "Timed out after 45 minutes", completed_at: Date.now() })).toBe(false);
    expect(getGeneration(id)).toMatchObject({ status: "succeeded", outputs: saved.outputs });
    // A run another process is saving now: a look here neither fails it nor moves it back.
    const next = (await pressRun()).id;
    db().prepare("UPDATE generation_runs SET finish_by = 'another-process', finish_until = ? WHERE id = ?").run(Date.now() + 60_000, next);
    expect(updateLive(next, { status: "failed", error: "Timed out after 45 minutes", completed_at: Date.now() })).toBe(false);
    expect(getGeneration(next)?.status).toBe("queued");
    // Its turn runs out (that process stopped): this one may change it again.
    db().prepare("UPDATE generation_runs SET finish_until = ? WHERE id = ?").run(Date.now() - 1, next);
    expect(updateLive(next, { message: POOL_WORDS.inLine })).toBe(true);
    await workAll(d);
    expect((await ended(next))?.status).toBe("succeeded");
  });

  it("both processes' sweeps meet over a finished run's report: one sends it, so the service gets it once", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id);
    const d = driver(w);
    lookAtEveryStep(d, watch);
    // While the run finishes, this process sends no report: its sweep comes below, with the other process's.
    delete process.env.FUOBE_BILLING_URL;
    try {
      await workAll(d);
      await until(() => done(getGeneration(id)));
    } finally {
      process.env.FUOBE_BILLING_URL = svc.address;
    }
    expect(outbox.queueReports()).toBeGreaterThan(0);
    // Both sweeps at once: the service answers a report only once a second one has come, or after 4 seconds.
    svc.gather = { path: "/v1/settle", count: 2, maxMs: 4000 };
    await Promise.all([outbox.drainOutbox(), app2.sweepBilling()]);
    svc.gather = null;
    const g = await ended(id);
    await watch.look();
    expect(watch.problems({ place: 1 })).toEqual([]);
    expect(g?.status).toBe("succeeded");
    const settle = { holdId: holdOf(id), kind: "settle", status: "succeeded" };
    expect(svc.reportsFor(id)).toEqual([settle]);
    expect(svc.callsOf("/v1/settle").filter((c) => (c.body as { generationId?: string }).generationId === id)).toHaveLength(1);
  });
});
