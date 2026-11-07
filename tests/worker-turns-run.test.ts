/**
 * Studio jobs first, end to end (bin/lib/worker/run.mjs): the worker against the studio's real routes, its own
 * stand-in ComfyUI (tests/helpers/fake-local-comfy.ts, a process it starts behind its guard), a fake port table, fake
 * GPU counters and a fake lock file. Never a real ComfyUI, PowerShell, typeperf or nvidia-smi.
 *
 * - Only local ComfyUI work holds the GPU: the worker writes siteWaiting, keeps the job in line (not a pause), and
 *   claims within 5 s of the answer; a minute after the last job it lets go and writes 0.
 * - A game holds the GPU: the busy pause, and no turn is asked for.
 * - The studio doesn't say what the worker can take: local ComfyUI work pauses it, as before.
 * - Me first: the pause shortcut during a turn writes siteWaiting 0, and the job keeps its place.
 * - Only the owner's own job waits: no turn. Local ComfyUI work that runs a job is left alone; once it runs nothing, it
 *   is asked to free its memory (its /queue read, then its /free) and the worker takes the job.
 * - The counters fail: a lock that names ComfyUI work leads to a turn.
 * - Its own job: memory the counters can't place (they fail under load) is no other program; a game that stays pauses it
 *   after the grace time, one that leaves within it keeps the job.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { worker } from "../bin/lib/worker/index.mjs";
import { runWorker } from "../bin/lib/worker/run.mjs";
import { inputRules, readCatalog } from "../scripts/lib/worker-catalog.mjs";
import { FAKE_PNG } from "./helpers/fake-local-comfy";
import { apiAs, loadRoutes, type ComputerRoutes } from "./helpers/computer-tab";
import { tempDir } from "./helpers/temp-dir";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 120_000 });

const dir = tempDir("fuobe-worker-turns-run-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
delete process.env.FUOBE_PASSWORD;
globalThis.__fuobeTestDiskFree = 1e13;

const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const tasks = await import("@/server/computer/tasks");
const pool = await import("@/server/computer/pool");
const { catalogVersion } = await import("@/server/computer/catalog-version");
const { ComputerRunner } = await import("@/lib/computer-runner");

const ROOT = path.resolve(__dirname, "..");
const FAKE = path.join(ROOT, "tests/helpers/fake-local-comfy.ts");
const SITE = "http://127.0.0.1:9";
const RULES = inputRules(readCatalog(ROOT));
const ALLOWED = new Set(["LoadImage", "KSampler", "SaveImage"]);
const realFetch = globalThis.fetch;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let routes: ComputerRoutes;
beforeAll(async () => {
  routes = await loadRoutes();
  setSetting("comfyWhere", "workers");
});
beforeEach(() => {
  resetRates();
  db().prepare("DELETE FROM relay_workers").run();
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
});

type W = { id: string; token: string };
const task = (id: string) => db().prepare("SELECT * FROM relay_tasks WHERE id = ?").get(id) as import("@/server/computer/tasks").TaskRow;
const workerRow = (w: W) => db().prepare("SELECT * FROM relay_workers WHERE id = ?").get(w.id) as { local_why: string | null; paused_local: number; local_until: number | null; holding_json: string | null };
/** Why the worker holds the line's work back, as its last beat said (the owner's queue view shows it). */
const holdingWhy = (w: W) => (JSON.parse(workerRow(w).holding_json ?? "null") as { why: string } | null)?.why ?? null;

function addWorker(): W {
  const w = pool.addWorker(`pc-${Math.random().toString(36).slice(2, 8)}`);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: { small: { delayMs: 0 } } });
  db().prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ? WHERE id = ?").run(JSON.stringify({ lanes: ["small"], workflows: ["wf-test"] }), JSON.stringify({ vramBytes: 24 * 2 ** 30 }), w.id);
  return w;
}

/** A person's job comes as a job ticket: the worker's composer here gives its graph, by the run's id. */
const ticketGraphs = new Map<string, Record<string, unknown>>();
const composer = {
  workerFactsFrom: () => ({}),
  composeTicket: async (job: { generationId: string }) => ({ ok: true, graph: ticketGraphs.get(job.generationId), workflowId: "wf-test", size: { megapixels: 0, seconds: 0, outputs: 1 }, made: [] }),
};

let gens = 0;
/** A person's run for the workers, or (`owner`) one of the owner's own, which no turn is asked for. */
function addTask(o: { owner?: boolean } = {}): string {
  const gid = `turns-gen-${++gens}`;
  const now = Date.now();
  db()
    .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'queued', '{}', '[]', ?, ?)")
    .run(gid, now, now);
  const input = tasks.stageInput("owner", FAKE_PNG, "image/png", "in.png");
  const graph = { "1": { class_type: "LoadImage", inputs: { image: input } }, "3": { class_type: "KSampler", inputs: { seed: 1, steps: 4 } }, "9": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "fuobe/worker-test" } } };
  ticketGraphs.set(gid, graph);
  return tasks.createTask({
    principal: "owner",
    generationId: gid,
    graph,
    // (Made for this studio's catalog: an older one would be made again before a claim, and this one composes nothing.)
    ...(!o.owner && { ticket: { catalogVersion: catalogVersion(), inputs: [{ slot: "images.0", name: input }] } as never }),
    // A person's run (an account's): the studio counts it in the beat's claimableNow.
    pool: { pools: ["pool"], ...(!o.owner && { account: "turns-account" }), rankAt: now, lane: "small", needs: { workflowId: "wf-test", files: [], packs: [], minVramBytes: 0 } },
  }).id;
}

/**
 * fetch for the worker: the studio's real routes for SITE (the beat's claimableNow is the studio's own), its own
 * ComfyUI for the rest. With `older`, the beat's answer has no claimableNow, as from a studio that doesn't say.
 */
function router(w: W, o: { older: boolean }) {
  // The test may switch `older` off later (the same object).
  const api = apiAs(routes, null);
  return async (url: string, init: RequestInit = {}) => {
    if (!String(url).startsWith(SITE)) return realFetch(url, init);
    const u = new URL(url);
    const p = u.pathname + u.search;
    if (p === "/api/gpu/computer/inventory") return Response.json({ ok: true, lanes: ["small"], workflows: ["wf-test"], missing: [] });
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${w.token}`);
    const res = await api(p, init);
    if (p !== "/api/gpu/computer/beat" || !o.older || !res.ok) return res;
    const body = (await res.json()) as Record<string, unknown>;
    delete body.claimableNow;
    return Response.json(body);
  };
}

interface Pc {
  home: string;
  workDir: string;
  comfyDir: string;
  turns: string;
  lock: string;
  logs: string[];
}

function pc(): Pc {
  const base = tempDir("fuobe-worker-pc-");
  const p = { home: path.join(base, "home"), workDir: path.join(base, "work"), comfyDir: path.join(base, "comfy"), turns: path.join(base, "turns"), lock: path.join(base, "gpu.lock"), logs: [] };
  for (const d of [p.home, p.workDir, p.comfyDir, p.turns]) fs.mkdirSync(d, { recursive: true });
  return p;
}

/** Its own ComfyUI now: the pid and port the worker wrote down for this start. */
const comfyOf = (p: Pc) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(p.workDir, "comfyui.pid"), "utf8")) as { pid: number; port: number };
  } catch {
    return null;
  }
};

const MB = 2 ** 20;
const LUID = "luid_0x00000000_0x0000D1B5_phys_0";
const WORK_PID = 4242;
const GAME_PID = 5555;

/**
 * The PC's GPU as the fakes show it: local ComfyUI work on 8188 holding `workMb`, a game holding `gameMb`, the desktop
 * 500 MB (the baseline says 600), and the worker's own ComfyUI `ownMb` (1000 MB) once it runs; its own /system_stats
 * gives no torch number. `counters: false` (or a function that says false): they can't be read.
 */
function fakeGpu(p: Pc, o: { workMb?: number; gameMb?: number; ownMb?: () => number; counters?: boolean | (() => boolean) }) {
  const own = () => comfyOf(p);
  const procs = () => [
    { pid: WORK_PID, mb: o.workMb ?? 0 },
    { pid: GAME_PID, mb: o.gameMb ?? 0 },
    { pid: 77, mb: 500 },
    ...(own() ? [{ pid: own()!.pid, mb: o.ownMb?.() ?? 1000 }] : []),
  ];
  return {
    readGpu: async () => ({ usedMb: procs().reduce((n, c) => n + c.mb, 0), tempC: 50, apps: [] }),
    readCounters: async () => {
      if ((typeof o.counters === "function" ? o.counters() : o.counters) === false) return null;
      const rows = procs();
      const text = [
        `"(PDH-CSV 4.0)",${rows.map((r) => `"\\\\PC\\GPU Process Memory(pid_${r.pid}_${LUID})\\Dedicated Usage"`).join(",")}`,
        `"11/04/2026 09:00:00.000",${rows.map((r) => `"${r.mb * MB}"`).join(",")}`,
      ].join("\r\n");
      const { parseCounters } = await import("../bin/lib/worker/local-work.mjs");
      return parseCounters(text);
    },
    readListeners: async () => ({
      listeners: [{ port: 8188, pid: WORK_PID }, ...(own() ? [{ port: own()!.port, pid: own()!.pid }] : [])],
      names: { [WORK_PID]: "python", [GAME_PID]: "game", "77": "dwm", ...(own() ? { [own()!.pid]: "node" } : {}) },
    }),
  };
}

const running: { ctrl: AbortController; done: Promise<unknown> }[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) {
    r.ctrl.abort();
    await r.done.catch(() => {});
  }
});

/**
 * Local ComfyUI work as the worker reaches it (deps.localFetch, never a real port): its /queue says whether it runs a
 * job (`busy`), its /free empties its memory (`onFree`). Every request is noted.
 */
function fakeLocal(o: { busy: boolean; onFree?: () => void }) {
  const calls: string[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    calls.push(`${init.method ?? "GET"} ${u.host}${u.pathname}`);
    if (u.pathname === "/queue" && (init.method ?? "GET") === "GET") return Response.json({ queue_running: o.busy ? [[1, "local-job", {}, {}, []]] : [], queue_pending: [] });
    if (u.pathname === "/free" && init.method === "POST") {
      expect(JSON.parse(String(init.body))).toEqual({ unload_models: true, free_memory: true });
      o.onFree?.();
      return new Response(null, { status: 200 });
    }
    return new Response("not here", { status: 404 });
  };
  return { o, calls, fetch };
}

function start(w: W, p: Pc, gpu: ReturnType<typeof fakeGpu>, o: { lockOwners?: string[]; studio?: { older: boolean }; local?: ReturnType<typeof fakeLocal>; stepMs?: number; gpuGraceMs?: number } = {}) {
  const ctrl = new AbortController();
  const cfg = {
    site: SITE,
    token: w.token,
    comfyDir: p.comfyDir,
    workDir: p.workDir,
    modelDirs: [],
    comfyCommand: [process.execPath, "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", FAKE, "--port", "{port}", "--cors", "off", "--steps", "4", "--step-ms", String(o.stepMs ?? 40), "--worker-guard", "1"],
    comfyGuard: true,
    ffmpeg: null,
    yieldFolder: p.turns,
    desktopBaselineMb: 600,
    gpuLockFile: p.lock,
    gpuLockComfyOwners: o.lockOwners ?? [],
  };
  const done = runWorker(cfg, {
    fetch: router(w, o.studio ?? { older: false }),
    home: p.home,
    signal: ctrl.signal,
    requirements: { folders: [], files: {}, packs: {}, workflows: {} },
    ComputerRunner,
    rules: RULES,
    pins: {},
    allowed: ALLOWED,
    ffmpegVersion: async () => null,
    awake: { set: () => {} },
    sleep: (ms: number) => sleep(Math.min(ms, 50)),
    log: (line: string) => void p.logs.push(line),
    composer,
    catalogVersion: "a".repeat(64),
    gpuEveryMs: 200,
    turnGraceMs: 1500,
    ...(o.gpuGraceMs !== undefined && { gpuGraceMs: o.gpuGraceMs }),
    // Local ComfyUI work is never a real port here: busy unless the test says otherwise.
    localFetch: (o.local ?? fakeLocal({ busy: true })).fetch,
    ...gpu,
  });
  const r = { ctrl, done };
  running.push(r);
  return r;
}

async function until<T>(fn: () => T | Promise<T>, ms = 60_000, every = 50): Promise<Exclude<T, false | null | undefined | 0 | "">> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as Exclude<T, false | null | undefined | 0 | "">;
    if (Date.now() > end) throw new Error(`Timed out after ${ms} ms`);
    await sleep(every);
  }
}

const site = (p: Pc) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(p.turns, "site.json"), "utf8")) as { siteWaiting: number; oldestWaitS: number; interrupt: boolean; at: number };
  } catch {
    return null;
  }
};
const comfyAnswers = async (p: Pc) => {
  const c = comfyOf(p);
  return !!c && (await realFetch(`http://127.0.0.1:${c.port}/__fake/stats`).then((r) => r.ok).catch(() => false));
};

describe("studio jobs first", () => {
  it("only local ComfyUI work holds the GPU: it asks for a turn, keeps the job in line, and claims within 5 s of the answer", async () => {
    const w = addWorker();
    const p = pc();
    const id = addTask();
    start(w, p, fakeGpu(p, { workMb: 9000 }));
    const asked = await until(() => (site(p)?.siteWaiting ?? 0) >= 1 && site(p));
    expect(asked).toMatchObject({ siteWaiting: 1, interrupt: false });
    expect(Math.abs(asked.at - Date.now())).toBeLessThan(10_000);
    // Waiting for its turn is not a pause: the studio keeps the job in its place.
    await until(() => workerRow(w).local_why === "waiting-for-yield");
    expect(workerRow(w).paused_local).toBe(0);
    await until(() => comfyAnswers(p));
    // Its beat says why the job waits on it.
    await until(() => holdingWhy(w) === "waiting-for-yield");
    await sleep(1500);
    expect(task(id).state).toBe("waiting");
    expect(task(id).worker_id).toBeNull();
    expect(p.logs.some((l) => /Another program/.test(l))).toBe(false);
    // The answer: it claims at once, with no cool-down.
    const at = Date.now();
    fs.writeFileSync(path.join(p.turns, "yielded.json"), JSON.stringify({ state: "yielded", at }));
    await until(() => task(id).state !== "waiting", 5000);
    expect(Date.now() - at).toBeLessThan(5000);
    expect((await until(() => ["done", "failed"].includes(task(id).state) && task(id), 60_000)).state).toBe("done");
    // No job for the grace time (shortened here): it lets go of its memory and writes 0.
    await until(() => site(p)?.siteWaiting === 0, 20_000);
    expect(p.logs.some((l) => /lets go of its memory/.test(l))).toBe(true);
    expect(workerRow(w).local_why).toBeNull();
    // Nothing waits for it: it holds nothing back.
    expect(holdingWhy(w)).toBeNull();
  });

  it("a game holds the GPU: the busy pause, and no turn is asked for", async () => {
    const w = addWorker();
    const p = pc();
    const id = addTask();
    start(w, p, fakeGpu(p, { workMb: 9000, gameMb: 6000 }));
    let most = 0;
    await until(() => {
      most = Math.max(most, site(p)?.siteWaiting ?? 0);
      return workerRow(w).local_why?.startsWith("gpu-busy");
    });
    expect(workerRow(w).local_why).toBe("gpu-busy:game");
    expect(workerRow(w).paused_local).toBe(1);
    for (let i = 0; i < 20; i++) {
      most = Math.max(most, site(p)?.siteWaiting ?? 0);
      await sleep(50);
    }
    expect(most).toBe(0);
    expect(site(p)?.siteWaiting).toBe(0);
    expect(task(id).state).toBe("waiting");
    expect(p.logs.some((l) => /make room/.test(l))).toBe(false);
    expect(p.logs.some((l) => /Another program is using the GPU \(game\)/.test(l))).toBe(true);
  });

  it("the studio doesn't say what it can take: local ComfyUI work pauses it, as before, until the studio says", async () => {
    const w = addWorker();
    const p = pc();
    addTask();
    const studio = { older: true };
    start(w, p, fakeGpu(p, { workMb: 9000 }), { studio });
    await until(() => workerRow(w).local_why?.startsWith("gpu-busy"));
    expect(workerRow(w).local_why).toBe("gpu-busy:ComfyUI on port 8188");
    expect(site(p)?.siteWaiting ?? 0).toBe(0);
    // The studio starts to send the count: the pause ends with no cool-down, and a turn is asked for.
    studio.older = false;
    await until(() => workerRow(w).local_why === "waiting-for-yield");
    expect(site(p)?.siteWaiting).toBe(1);
    expect(p.logs.some((l) => /no longer keeps it paused/.test(l))).toBe(true);
  });

  it("only the owner's own job waits: the studio counts none, so no turn is asked for and local ComfyUI work that runs a job goes on", async () => {
    const w = addWorker();
    const p = pc();
    const id = addTask({ owner: true });
    const local = fakeLocal({ busy: true });
    start(w, p, fakeGpu(p, { workMb: 9000 }), { local });
    // The studio's real beat says 0 (not "unknown"): turns work, local ComfyUI work is no other program, and no
    // turn begins for the owner's own job.
    await until(() => comfyAnswers(p));
    await sleep(2_000);
    expect(site(p)?.siteWaiting ?? 0).toBe(0);
    expect(workerRow(w).paused_local).toBe(0);
    expect(workerRow(w).local_why).toBeNull();
    expect(task(id).state).toBe("waiting");
    expect(p.logs.some((l) => /make room|Another program/.test(l))).toBe(false);
    // It only looked at the local work's queue: never asked it to free anything while it works.
    expect(local.calls.length).toBeGreaterThan(0);
    expect(new Set(local.calls)).toEqual(new Set(["GET 127.0.0.1:8188/queue"]));
    expect(p.logs.some((l) => /owner's job waits for local ComfyUI work to finish/.test(l))).toBe(true);
    // The studio hears why: the owner's queue view shows the worker holding the job back, and since when.
    await until(() => holdingWhy(w) === "local-work");
    const { liveQueue } = await import("@/server/computer/queue-live");
    expect(liveQueue().holding).toEqual([expect.objectContaining({ task: null, code: "local-work", why: "Waiting for local ComfyUI work to finish", waiting: 1 })]);
    expect(liveQueue().holding[0].since).toBeLessThanOrEqual(Date.now());
  });

  it("only the owner's own job waits and local ComfyUI work runs nothing: it is asked to free its memory, and the job runs", async () => {
    const w = addWorker();
    const p = pc();
    const id = addTask({ owner: true });
    const gpu = { workMb: 9000 };
    const local = fakeLocal({ busy: true, onFree: () => (gpu.workMb = 400) });
    start(w, p, fakeGpu(p, gpu), { local });
    await until(() => comfyAnswers(p));
    await sleep(1500);
    expect(task(id).state).toBe("waiting");
    // Its local job ends; the models stay loaded.
    local.o.busy = false;
    await until(() => task(id).state !== "waiting", 30_000);
    expect(local.calls).toContain("POST 127.0.0.1:8188/free");
    expect(local.calls.every((c) => c === "GET 127.0.0.1:8188/queue" || c === "POST 127.0.0.1:8188/free")).toBe(true);
    expect(p.logs.some((l) => /runs nothing and keeps its models loaded/.test(l))).toBe(true);
    expect((await until(() => ["done", "failed"].includes(task(id).state) && task(id), 60_000)).state).toBe("done");
    // It never asked for room, and never paused; a minute after the job (shortened here) it writes 0 again.
    expect(p.logs.some((l) => /make room|Another program/.test(l))).toBe(false);
    await until(() => site(p)?.siteWaiting === 0, 20_000);
  });

  it("me first: the pause shortcut during a turn writes siteWaiting 0 and keeps the job in line; a resume asks again", async () => {
    const w = addWorker();
    const p = pc();
    const id = addTask();
    start(w, p, fakeGpu(p, { workMb: 9000 }));
    await until(() => workerRow(w).local_why === "waiting-for-yield");
    expect(site(p)?.siteWaiting).toBe(1);
    const io = { env: { FUOBE_WORKER_HOME: p.home }, home: p.home, stdout: { write: () => {} }, stderr: { write: () => {} }, ask: async () => "2" };
    expect(await worker(["pause", "--choose"], io)).toBe(0);
    await until(() => workerRow(w).local_why === "here-now");
    await until(() => site(p)?.siteWaiting === 0);
    expect(workerRow(w).local_until).toBeGreaterThan(Date.now() + 3_500_000);
    // An answer that comes now starts nothing: the pause by hand wins.
    fs.writeFileSync(path.join(p.turns, "yielded.json"), JSON.stringify({ state: "yielded", at: Date.now() }));
    await sleep(1500);
    expect(task(id).state).toBe("waiting");
    expect(site(p)?.siteWaiting).toBe(0);
    expect(await worker(["resume"], io)).toBe(0);
    await until(() => (site(p)?.siteWaiting ?? 0) >= 1);
  });

  it("the counters fail: a lock that names ComfyUI work leads to a turn, any other owner to the busy pause", async () => {
    const w = addWorker();
    const p = pc();
    addTask();
    fs.mkdirSync(p.lock);
    fs.writeFileSync(path.join(p.lock, "owner.txt"), "render-queue batch-7 2026-11-04T09:00:00Z pid 4242\n");
    start(w, p, fakeGpu(p, { workMb: 9000, counters: false }), { lockOwners: ["render-queue"] });
    await until(() => workerRow(w).local_why === "waiting-for-yield");
    expect(site(p)?.siteWaiting).toBe(1);
    // Someone else takes the lock: another program.
    fs.writeFileSync(path.join(p.lock, "owner.txt"), "someone-else 2026-11-04T09:00:00Z\n");
    await until(() => workerRow(w).local_why?.startsWith("gpu-busy"));
    await until(() => site(p)?.siteWaiting === 0);
  });
});

describe("its own job and the busy pause", () => {
  const inJob = (id: string) => ["sending", "queued", "running", "collecting"].includes(task(id)?.state ?? "");
  const ended = (id: string, p: Pc) => ["done", "failed"].includes(task(id).state) || p.logs.some((l) => /Another program/.test(l));

  it("its job loads 20 GB that torch doesn't report and the counters fail under the load: no pause, the job finishes", async () => {
    const w = addWorker();
    const p = pc();
    let id = "";
    let loaded = false;
    let failedReads = 0;
    const gpu = fakeGpu(p, {
      // The weights stay loaded after the job, as ComfyUI keeps them.
      ownMb: () => ((loaded ||= !!id && inJob(id)) ? 20_000 : 1000),
      counters: () => {
        const ok = !id || !inJob(id);
        if (!ok) failedReads++;
        return ok;
      },
    });
    id = addTask();
    start(w, p, gpu, { stepMs: 500 });
    await until(() => ended(id, p), 60_000);
    expect(p.logs.filter((l) => /Another program|Stopping its own ComfyUI/.test(l))).toEqual([]);
    expect(failedReads).toBeGreaterThanOrEqual(3);
    expect(task(id).state).toBe("done");
    await sleep(1000);
    expect(p.logs.some((l) => /Another program/.test(l))).toBe(false);
  });

  it("a game that comes mid-job and stays pauses it after the grace time, and its ComfyUI stops", async () => {
    const w = addWorker();
    const p = pc();
    const gpu: { gameMb: number } = { gameMb: 0 };
    const id = addTask();
    start(w, p, fakeGpu(p, gpu), { stepMs: 3000, gpuGraceMs: 1000 });
    await until(() => task(id).state === "running");
    const at = Date.now();
    gpu.gameMb = 6000;
    await until(() => p.logs.some((l) => /Another program is using the GPU \(game\): pausing/.test(l)), 30_000);
    expect(Date.now() - at).toBeGreaterThanOrEqual(1000);
    expect(task(id).state).not.toBe("done");
    await until(() => p.logs.some((l) => /Stopping its own ComfyUI \(paused\)/.test(l)));
    expect(workerRow(w).local_why).toBe("gpu-busy:game");
  });

  it("a game that leaves within the grace time keeps the job", async () => {
    const w = addWorker();
    const p = pc();
    const gpu: { gameMb: number } = { gameMb: 0 };
    const id = addTask();
    start(w, p, fakeGpu(p, gpu), { stepMs: 1500, gpuGraceMs: 4000 });
    await until(() => task(id).state === "running");
    gpu.gameMb = 6000;
    await sleep(700);
    gpu.gameMb = 0;
    await until(() => ended(id, p), 60_000);
    expect(p.logs.filter((l) => /Another program|Stopping its own ComfyUI/.test(l))).toEqual([]);
    expect(task(id).state).toBe("done");
  });
});
