/**
 * Studio jobs first, end to end (bin/lib/worker/run.mjs): the worker against the studio's real routes, its own
 * stand-in ComfyUI (tests/helpers/fake-local-comfy.ts, a process it starts behind its guard), a fake port table, fake
 * GPU counters and a fake lock file. Never a real ComfyUI, PowerShell, typeperf or nvidia-smi.
 *
 * - Only local ComfyUI work holds the GPU: the worker writes siteWaiting, keeps the job in line (not a pause), and
 *   claims within 5 s of the answer; a minute after the last job it lets go and writes 0.
 * - A game holds the GPU: the busy pause, and no turn is asked for.
 * - The studio doesn't say what the worker can take: local ComfyUI work pauses it, as before.
 * - The counters fail: a lock that names ComfyUI work leads to a turn.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
const workerRow = (w: W) => db().prepare("SELECT * FROM relay_workers WHERE id = ?").get(w.id) as { local_why: string | null; paused_local: number; local_until: number | null };

function addWorker(): W {
  const w = pool.addWorker(`pc-${Math.random().toString(36).slice(2, 8)}`);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: { small: { delayMs: 0 } } });
  db().prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ? WHERE id = ?").run(JSON.stringify({ lanes: ["small"], workflows: ["wf-test"] }), JSON.stringify({ vramBytes: 24 * 2 ** 30 }), w.id);
  return w;
}

let gens = 0;
function addTask(): string {
  const gid = `turns-gen-${++gens}`;
  const now = Date.now();
  db()
    .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'queued', '{}', '[]', ?, ?)")
    .run(gid, now, now);
  const input = tasks.stageInput("owner", FAKE_PNG, "image/png", "in.png");
  return tasks.createTask({
    principal: "owner",
    generationId: gid,
    graph: { "1": { class_type: "LoadImage", inputs: { image: input } }, "3": { class_type: "KSampler", inputs: { seed: 1, steps: 4 } }, "9": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "fuobe/worker-test" } } },
    pool: { pools: ["pool"], rankAt: now, lane: "small", needs: { workflowId: "wf-test", files: [], packs: [], minVramBytes: 0 } },
  }).id;
}

/**
 * fetch for the worker: the studio's routes for SITE, its own ComfyUI for the rest. With `claimable`, the beat's answer
 * carries claimableNow (the jobs waiting for this worker's pool), as a studio that supports turns sends it.
 */
function router(w: W, o: { claimable: boolean }) {
  // The test may switch the count on later (the same object).
  const api = apiAs(routes, null);
  return async (url: string, init: RequestInit = {}) => {
    if (!String(url).startsWith(SITE)) return realFetch(url, init);
    const u = new URL(url);
    const p = u.pathname + u.search;
    if (p === "/api/gpu/computer/inventory") return Response.json({ ok: true, lanes: ["small"], workflows: ["wf-test"], missing: [] });
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${w.token}`);
    const res = await api(p, init);
    if (p !== "/api/gpu/computer/beat" || !o.claimable || !res.ok) return res;
    const body = await res.json();
    const n = (db().prepare("SELECT COUNT(*) AS n FROM relay_tasks WHERE state = 'waiting' AND INSTR(',' || pools || ',', ',pool,') > 0").get() as { n: number }).n;
    return Response.json({ ...body, claimableNow: n });
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
 * 500 MB (the baseline says 600), and the worker's own ComfyUI 1000 MB once it runs. `counters: false`: they can't be read.
 */
function fakeGpu(p: Pc, o: { workMb?: number; gameMb?: number; counters?: boolean }) {
  const own = () => comfyOf(p);
  const procs = () => [
    { pid: WORK_PID, mb: o.workMb ?? 0 },
    { pid: GAME_PID, mb: o.gameMb ?? 0 },
    { pid: 77, mb: 500 },
    ...(own() ? [{ pid: own()!.pid, mb: 1000 }] : []),
  ];
  return {
    readGpu: async () => ({ usedMb: procs().reduce((n, c) => n + c.mb, 0), tempC: 50, apps: [] }),
    readCounters: async () => {
      if (o.counters === false) return null;
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

function start(w: W, p: Pc, gpu: ReturnType<typeof fakeGpu>, o: { claimable?: boolean; lockOwners?: string[]; studio?: { claimable: boolean } } = {}) {
  const ctrl = new AbortController();
  const cfg = {
    site: SITE,
    token: w.token,
    comfyDir: p.comfyDir,
    workDir: p.workDir,
    modelDirs: [],
    comfyCommand: [process.execPath, "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", FAKE, "--port", "{port}", "--cors", "off", "--steps", "4", "--step-ms", "40", "--worker-guard", "1"],
    comfyGuard: true,
    ffmpeg: null,
    yieldFolder: p.turns,
    desktopBaselineMb: 600,
    gpuLockFile: p.lock,
    gpuLockComfyOwners: o.lockOwners ?? [],
  };
  const done = runWorker(cfg, {
    fetch: router(w, o.studio ?? { claimable: o.claimable ?? true }),
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
    gpuEveryMs: 200,
    turnGraceMs: 1500,
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
    const studio = { claimable: false };
    start(w, p, fakeGpu(p, { workMb: 9000 }), { studio });
    await until(() => workerRow(w).local_why?.startsWith("gpu-busy"));
    expect(workerRow(w).local_why).toBe("gpu-busy:ComfyUI on port 8188");
    expect(site(p)?.siteWaiting ?? 0).toBe(0);
    // The studio starts to send the count: the pause ends with no cool-down, and a turn is asked for.
    studio.claimable = true;
    await until(() => workerRow(w).local_why === "waiting-for-yield");
    expect(site(p)?.siteWaiting).toBe(1);
    expect(p.logs.some((l) => /no longer keeps it paused/.test(l))).toBe(true);
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
