import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runnerByHand, startAppProcess, tick, type AppProcess } from "./helpers/app-process";
import { apiAs, loadRoutes, type ComputerRoutes } from "./helpers/computer-tab";
import { plainFailure, RunWatch, type RunLike } from "./helpers/run-watch";
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
 * - every look at it (a refresh, a second session, the list) shows only "In line" with its place, "Working", then the
 *   result: a recovery shows "In line" again with its place kept, and never an error or a word about the machines;
 * - nothing is charged twice (one hold, one report).
 *
 * A check that fails because the studio can't do it yet is kept as `it.fails`, named with its scenario and the reason.
 * The worker's own scenarios are in tests/recovery-worker.test.ts.
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
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const { getGeneration, ensureRunner } = await import("@/server/generations");
const pool = await import("@/server/computer/pool");
const billing = await import("@/server/billing");
const outbox = await import("@/server/billing-outbox");
const qs = await import("@/server/queue-settings");
const { loadManifest } = await import("@/server/providers/comfyui");
const { loadIndex } = await import("@/server/gpu/index-file");
const { allLanes } = await import("@/lib/lanes");
const { getModel } = await import("@/lib/catalog");
const { POOL_WORDS } = await import("@/lib/relay");

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
  Object.assign(svc, { priced: false, slowMs: 0, gather: null, maxWaitMs: 20 * MIN, holdLifeMs: 105 * MIN, policy: JSON.parse(JSON.stringify(FREE_RUNS_POLICY)) });
  await svc.start();
  await comfy.start();
  comfy.inner.restart({ stall: false, failNext: undefined, loseNext: 0, steps: 4, stepMs: 20 });
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

/** A worker the owner added and resumed, allowed every lane (or `lanes`), able to run every workflow. */
function standInWorker(name = "stand-in", o: { paused?: boolean; lanes?: string[] } = {}) {
  const w = pool.addWorker(name);
  const lanes = o.lanes ?? allLanes(loadIndex(), sha).map((l) => l.lane);
  pool.patchWorker(w.id, { paused: !!o.paused, hours: { always: true }, allow: Object.fromEntries(lanes.map((l) => [l, { delayMs: 0 }])), claimAfterMs: 0 });
  db()
    .prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ? WHERE id = ?")
    .run(JSON.stringify({ lanes, workflows: loadManifest().workflows.map((x) => x.id) }), JSON.stringify({ vramBytes: 96 * 2 ** 30 }), w.id);
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
  return { status: r.status, body: (await r.json()) as { items?: { id: string }[]; code?: string; error?: string } };
}

/** The price check before Run. */
async function priceCheck(body: Record<string, unknown>, cookie = a1) {
  const r = await generationsRoute.POST(request("/api/generations?preview=1", { body, cookie }));
  return { status: r.status, body: (await r.json()) as { place?: string; quote?: { allowed: boolean; text: string; code?: string; etaS?: number | null }; error?: string; code?: string } };
}

/** A run as a session reads it (GET /api/generations/<id>). */
const sessionRead = (cookie: string) => async (id: string) => {
  const r = await oneRoute.GET(request(`/api/generations/${id}`, { cookie }), { params: Promise.resolve({ id }) } as never);
  return r.ok ? ((await r.json()) as RunLike) : null;
};

/** A run as the session's list shows it (GET /api/generations). */
const listRead = (cookie: string) => async (id: string) => {
  const r = await generationsRoute.GET(request("/api/generations?limit=50", { cookie }));
  return ((await r.json()) as { items: (RunLike & { id: string })[] }).items.find((g) => g.id === id) ?? null;
};

/** Every place the run's account looks from: a refresh, its session, a second session on another device, and its list. */
function watchOf(id: string, extra: Record<string, () => Promise<RunLike | null>> = {}) {
  return new RunWatch({
    refresh: () => getGeneration(id) as RunLike | null,
    session: () => sessionRead(a1)(id),
    "second session": () => sessionRead(a2)(id),
    list: () => listRead(a1)(id),
    ...extra,
  });
}

const taskOf = (generationId: string) => db().prepare("SELECT * FROM relay_tasks WHERE generation_id = ? ORDER BY created_at DESC").get(generationId) as TaskRow | undefined;
const assetsOf = (generationId: string) => (db().prepare("SELECT COUNT(*) AS n FROM assets WHERE generation_id = ?").get(generationId) as { n: number }).n;
const holdOf = (generationId: string) => (db().prepare("SELECT json_extract(request_json, '$.hold') AS hold FROM generations WHERE id = ?").get(generationId) as { hold: string | null }).hold;
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

/** Press Run and wait for the run's task in the workers' line. */
async function pressRun(body: Record<string, unknown> = IMAGE, cookie = a1) {
  const r = await run(body, cookie);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const id = r.body.items![0].id;
  const t = await until(() => taskOf(id));
  expect(t, "its task in the workers' line").toBeDefined();
  return { id, task: t! };
}

/** The worker takes jobs and runs them until there is none (or it stops). */
async function workAll(d: WorkerDriver, max = 10) {
  for (let i = 0; i < max; i++) {
    await d.beat();
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
  const g = await until(() => (done(getGeneration(id)) ? getGeneration(id) : null));
  await watch.look();
  expect(watch.problems({ place: o.place }), JSON.stringify(watch.path())).toEqual([]);
  expect(g?.status, g?.error ?? "").toBe("succeeded");
  expect(g!.outputs.length).toBe(o.outputs ?? 1);
  expect(assetsOf(id), "files kept for the run").toBe(g!.outputs.length);
  if (o.prompts !== undefined) expect(comfy.postsOf(taskOf(id)!.prompt_id), "prompts its ComfyUI got").toBe(o.prompts);
  const hold = holdOf(id);
  expect(hold, "the run's hold").toBeTruthy();
  expect(svc.holds.has(hold!)).toBe(true);
  const reports = await reportsOf(id);
  expect(reports).toEqual([{ holdId: hold, kind: "settle", status: "succeeded" }]);
  expect(svc.late).toEqual([]);
  return g!;
}

// ---------------------------------------------------------------------------

describe("REL-0: an account's run reaches the workers", () => {
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
  it("REL-5 (the studio's side): stopped right after the studio heard its job finished, and started again with its ComfyUI still up, it sends the result: one prompt, one output", async () => {
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

describe("REL-1: a refresh, a second session and the list see the same run", () => {
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

describe("REL-2: a network drop at submit", () => {
  it.fails("REL-2 (not built: the run route reads no request id from the client and makes a new reserve request id for every press, so a resend makes a second run and hold)", async () => {
    standInWorker();
    const holds = svc.holds.size;
    const made = () => (db().prepare("SELECT COUNT(*) AS n FROM generations WHERE json_extract(request_json, '$.account') = ?").get(A) as { n: number }).n;
    const rows = made();
    const press = { ...IMAGE, requestId: `press-${crypto.randomUUID()}` };
    const first = await run(press);
    // The answer never reached the page: it sends the same press again.
    const again = await run(press);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect([200, 201]).toContain(again.status);
    expect(again.body.items?.[0]?.id).toBe(first.body.items![0].id);
    expect(made() - rows, "runs made").toBe(1);
    expect(svc.holds.size - holds, "holds made").toBe(1);
  });
});

describe("REL-6: the worker steps aside for another program", () => {
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
    // The game runs for 40 minutes, past the run's 20 minute wait limit. Near its end, another account's run comes in.
    await pass(35 * MIN, [d], watch);
    const theirs = (await pressRun(IMAGE, b1)).id;
    await pass(5 * MIN, [d], watch);
    expect(getGeneration(id)).toMatchObject({ status: "queued", message: POOL_WORDS.inLine, queue: { place: 1 } });
    expect(getGeneration(theirs)?.queue?.place).toBe(2);
    // The game ends: it runs first, in its place.
    d.pause(null);
    lookAtEveryStep(d, watch);
    await workAll(d);
    await expectOnce(id, watch, { place: 1 });
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
      const g = await until(() => (done(getGeneration(id)) ? getGeneration(id) : null));
      await watch.look();
      expect(watch.problems({ place: 1 })).toEqual([]);
      expect(g?.status).toBe("succeeded");
      expect(g!.outputs).toHaveLength(1);
      expect(assetsOf(id)).toBe(1);
    } finally {
      delete process.env.FUOBE_POOL_WAIT_MIN;
    }
  });
});

describe("REL-8: retries", () => {
  it.fails("REL-8 (not built: a second lost prompt fails the run: the worker's resend allows one, apart from the line's requeues)", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id);
    const d = driver(w);
    let crashes = 0;
    d.onStep(async (step) => {
      await tick();
      await watch.look();
      // Its ComfyUI crashes twice while running the job (it comes back empty), then works.
      if (step === "running" && crashes < 2) {
        crashes++;
        await comfy.crash();
        await comfy.start();
      }
    });
    await workAll(d);
    expect(crashes).toBe(2);
    await expectOnce(id, watch, { place: 1 });
  });
});

describe("REL-9: a run that can never succeed here", () => {
  /** A worker that may run every lane but the picture model's. */
  const workerWithoutTheModel = () => standInWorker("without-the-model", { lanes: allLanes(loadIndex(), sha).map((l) => l.lane).filter((l) => l !== imageLane()) });
  const made = () => (db().prepare("SELECT COUNT(*) AS n FROM generations WHERE json_extract(request_json, '$.account') = ?").get(A) as { n: number }).n;

  it("no worker has the model: Run is refused and nothing is made (no run, no task, no hold)", async () => {
    workerWithoutTheModel();
    const rows = made();
    const tasks = (db().prepare("SELECT COUNT(*) AS n FROM relay_tasks").get() as { n: number }).n;
    const holds = svc.holds.size;
    const r = await run(IMAGE);
    expect(r.status).toBe(403);
    expect(made()).toBe(rows);
    expect((db().prepare("SELECT COUNT(*) AS n FROM relay_tasks").get() as { n: number }).n).toBe(tasks);
    expect(svc.holds.size).toBe(holds);
  });

  it.fails("REL-9 (not built: the price check of a run no worker may take answers as if the account ran it itself, so Run stays on)", async () => {
    workerWithoutTheModel();
    const q = await priceCheck(IMAGE);
    expect(q.body.quote, JSON.stringify(q.body)).toMatchObject({ allowed: false });
  });
});

describe("REL-10: no worker online", () => {
  it.fails("REL-10 (not built: with every worker paused the price check says nothing of the wait, so Run stays on)", async () => {
    standInWorker("paused", { paused: true });
    const q = await priceCheck(IMAGE);
    expect(q.body.quote, JSON.stringify(q.body)).toMatchObject({ allowed: false, code: "busy" });
  });

  it.fails("REL-10 (not built: a run made while every worker is paused fails at its wait limit)", async () => {
    clock();
    standInWorker("paused", { paused: true });
    const holds = svc.holds.size;
    const r = await run(IMAGE);
    // Refused before Run, with nothing made…
    if (r.status !== 201) {
      expect(svc.holds.size).toBe(holds);
      return;
    }
    // …or made, and then it never times out: it waits in line until a worker is back.
    const id = r.body.items![0].id;
    const watch = watchOf(id);
    await pass(25 * MIN, [], watch);
    expect(watch.problems({ place: 1 })).toEqual([]);
  });
});

describe("REL-12: one job per worker", () => {
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

describe("REL-16: the billing service down or restarting", () => {
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

  it.fails("REL-16 (not built: Run pressed while the service is down is refused at once; the reserve isn't tried again while the service comes back)", async () => {
    const w = standInWorker();
    // The account's policy is known from its price check.
    expect((await priceCheck(IMAGE)).body.quote?.allowed).toBe(true);
    await svc.downFor(10_000);
    const r = await run(IMAGE);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.items![0].id;
    const watch = watchOf(id);
    await workAll(driver(w));
    await expectOnce(id, watch, { place: 1 });
  });
});

describe("REL-17: a hold's deadline", () => {
  it("a run paused for 40 minutes, then finished, settles against its own hold", async () => {
    clock();
    const w = standInWorker();
    const { id } = await pressRun();
    const hold = holdOf(id)!;
    const watch = watchOf(id);
    const d = driver(w);
    stepAsideWhenRunning(d, watch);
    await workAll(d);
    await pass(40 * MIN, [d], watch);
    d.pause(null);
    lookAtEveryStep(d, watch);
    await workAll(d);
    await expectOnce(id, watch, { place: 1 });
    expect(svc.reportsFor(id).map((r) => r.holdId)).toEqual([hold]);
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

  it.fails("the run ceiling (not built: past its lane's ceiling a run fails at once; it isn't stopped and put back in line once first)", async () => {
    clock();
    qs.saveQueueSettings({ ...qs.queueSettings(), runCeilingS: { default: 2700, lanes: { [imageLane()]: 600 } } });
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id);
    const d = driver(w);
    const after: string[] = [];
    d.onStep(async (step) => {
      await tick();
      await watch.look();
      if (step === "running" && after.length < 2) {
        // Each attempt runs past the 10 minute ceiling.
        await pass(11 * MIN, [d], watch);
        after.push(getGeneration(id)!.status);
      }
    });
    await workAll(d);
    await until(() => done(getGeneration(id)), 50);
    // The first time it is stopped and goes back in line; the second time the run ends, in plain words, not charged.
    expect(after[0]).toBe("queued");
    expect(plainFailure(getGeneration(id) as RunLike, { held: true })).toEqual([]);
    expect(await reportsOf(id)).toEqual([{ holdId: holdOf(id), kind: "refund", status: "failed" }]);
  });
});

describe("REL-7: a deploy while results are being sent", () => {
  it.fails("REL-7 (not built: the worker gives up on a result after 3 failed parts in a row, so a burst of 503s from a deploy fails the run)", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id);
    const d = driver(w);
    lookAtEveryStep(d, watch);
    // The studio answers 503 to the next 6 parts of its result, as a deploy's proxy does for a few seconds.
    d.answer("part", 503, 6);
    await workAll(d);
    await expectOnce(id, watch, { prompts: 1, place: 1 });
  });
});

describe("two app processes on one database (a deploy's overlap)", () => {
  let app2: AppProcess;
  beforeAll(async () => {
    app2 = await startAppProcess({
      dataDir: dir,
      env: { FUOBE_HOSTED_RUNS: "1", FUOBE_BILLING_URL: svc.address, FUOBE_BILLING_TOKEN: svc.token, COMFYUI_URL: DEAD, FUOBE_PUBLIC_SIGNUP: "1" },
      allow: [comfy.url],
    });
  });
  afterAll(async () => {
    await app2?.stop();
  });

  it("the other process serves the worker and a session: the same run, the same state", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id, { "other process": () => app2.generation(id) as Promise<RunLike | null> });
    const d = driver(w);
    d.via(app2.api);
    lookAtEveryStep(d, watch);
    await workAll(d);
    expect(d.calls.some((c) => c.startsWith("part"))).toBe(true);
    await expectOnce(id, watch, { prompts: 1, place: 1 });
    expect(watch.seen.filter((s) => s.where === "other process").map((s) => s.status)).toContain("succeeded");
  });

  it.fails("REL-1 (not built: a step the worker reports is kept only in the memory of the process that took the report, so the other process's sessions see none)", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id, { "other process": () => app2.generation(id) as Promise<RunLike | null> });
    comfy.inner.opts.steps = 10;
    comfy.inner.opts.stepMs = 200;
    const d = driver(w);
    // The worker's calls reach the other process; this one's runner turns.
    d.via(app2.api);
    const steps: (number | null)[][] = [];
    d.onStep(async (step, _path, report) => {
      if (step !== "running" || Number(report?.value ?? 0) < 2) return;
      await tick();
      steps.push((await watch.look()).map((s) => s.progress));
    });
    await workAll(d);
    expect(steps.length, "looks while it ran").toBeGreaterThan(0);
    for (const at of steps) for (const p of at) expect(p ?? 0, "the step every look shows").toBeGreaterThan(0);
  });

  it.fails("REL-7 (not built: no runner lease or atomic finalize: while one process saves a finished run's result, the other saves it too, and the run ends failed)", async () => {
    const w = standInWorker();
    const { id } = await pressRun();
    const watch = watchOf(id, { "other process": () => app2.generation(id) as Promise<RunLike | null> });
    const d = driver(w);
    // This process's runner turns at every step but the result's parts: the result is saved below.
    d.onStep(async (step) => {
      if (step !== "part") await tick();
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
    pause.release();
    await theirs;
    await expectOnce(id, watch, { prompts: 1, place: 1 });
  });

  it.fails("REL-7 (not built: both processes send a finished run's report when their sweeps meet, so it is reported twice)", async () => {
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
    // Both sweeps at once: the service answers a report only once a second one has come, or after 4 seconds (one
    // sender, as it should be).
    svc.gather = { path: "/v1/settle", count: 2, maxMs: 4000 };
    await Promise.all([outbox.drainOutbox(), app2.sweepBilling()]);
    svc.gather = null;
    await expectOnce(id, watch, { prompts: 1, place: 1 });
  });
});
