import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runnerByHand, tick } from "./helpers/app-process";
import { apiAs, loadRoutes, type ComputerRoutes } from "./helpers/computer-tab";
import { FAKE_PNG } from "./helpers/fake-local-comfy";
import { plainFailure, RunWatch, type RunLike } from "./helpers/run-watch";
import { FREE_RUNS_POLICY, startStandInBilling, type StandInBilling } from "./helpers/standin-billing";
import { tempDir } from "./helpers/temp-dir";

/**
 * Recovery checks on the worker's side: the worker program itself (bin/lib/worker/run.mjs) runs accounts' jobs on its own
 * stand-in ComfyUI (tests/helpers/fake-local-comfy.ts, a process the worker starts), against the studio's real routes
 * and a stand-in billing service. Each check asks the same three things as tests/recovery-server.test.ts: the output
 * arrives exactly once, every look shows only "In line", "Working" and the result, and nothing is charged twice.
 *
 * They need the worker program's recovery parts (results kept on its disk until the studio has them, its ComfyUI
 * restarted when it stops or hangs, retries with backoff, staying awake, model folders looked at again, and studio jobs
 * before local ComfyUI work), and skip until those are in this tree.
 *
 * Each job's graph is the stand-in's own (a sampler and the run's save node, with the run's file prefix), so the
 * worker's node and model checks pass without model files; everything else about the job is the studio's.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const WORKER = path.join(ROOT, "bin/lib/worker");
const PROGRAM = ["hold.mjs", "turns.mjs", "local-work.mjs", "retry.mjs", "awake.mjs"].every((f) => fs.existsSync(path.join(WORKER, f)));

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const dir = tempDir("fuobe-recovery-worker-");
process.env.FUOBE_DATA_DIR = dir;
const DEAD = "http://127.0.0.1:7";
process.env.COMFYUI_URL = DEAD;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
for (const k of ["FUOBE_PASSWORD", "FUOBE_HOSTED_FREE", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN", "FUOBE_MODERATION_URL", "FUOBE_POOL_MEDIA_INPUTS"]) delete process.env[k];
globalThis.__fuobeTestDiskFree = 1e13;

const FAKE = path.join(ROOT, "tests/helpers/fake-local-comfy.ts");
/** The address the worker program is told the studio is at: its calls there go to the studio's route handlers. */
const SITE = "http://127.0.0.1:9";
const HOST = "localhost:3000";
const SITE_HEADERS = { host: HOST, "sec-fetch-site": "same-origin", origin: `http://${HOST}` };
const MIN = 60_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const realFetch = globalThis.fetch;
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const IMAGE = { feature: "image", modelId: "oss-z-image-turbo", prompt: "a lighthouse at dusk" };
const ALLOWED = new Set(["LoadImage", "KSampler", "SaveImage"]);

/** The worker program's modules, loaded once it is in this tree (any: they are plain JavaScript). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const load = (rel: string): Promise<Any> => import(/* @vite-ignore */ pathToFileURL(path.join(ROOT, rel)).href);

let studio: {
  db: typeof import("@/server/db").db;
  getGeneration: (id: string) => RunLike | null;
  pool: typeof import("@/server/computer/pool");
  outbox: typeof import("@/server/billing-outbox");
  generations: typeof import("@/app/api/generations/route");
  one: typeof import("@/app/api/generations/[id]/route");
  lanes: () => string[];
  workflows: () => string[];
};
let program: { runWorker: Any; rules: Any; parseCounters: Any; ComputerRunner: unknown };
let routes: ComputerRoutes;
let svc: StandInBilling;
let a1 = "";
let b1 = "";

describe.skipIf(!PROGRAM)("the worker program's recovery (accounts' runs, end to end)", () => {
  beforeAll(async () => {
    const auth = await import("@/server/auth");
    const { db } = await import("@/server/db");
    const { setSetting } = await import("@/server/settings");
    const { getGeneration, ensureRunner } = await import("@/server/generations");
    const { loadManifest } = await import("@/server/providers/comfyui");
    const { loadIndex } = await import("@/server/gpu/index-file");
    const { allLanes } = await import("@/lib/lanes");
    studio = {
      db,
      getGeneration: (id) => getGeneration(id) as RunLike | null,
      pool: await import("@/server/computer/pool"),
      outbox: await import("@/server/billing-outbox"),
      generations: await import("@/app/api/generations/route"),
      one: await import("@/app/api/generations/[id]/route"),
      lanes: () => allLanes(loadIndex(), sha).map((l) => l.lane),
      workflows: () => loadManifest().workflows.map((x) => x.id),
    };
    const { runWorker } = await load("bin/lib/worker/run.mjs");
    const { inputRules, readCatalog } = await load("scripts/lib/worker-catalog.mjs");
    const { parseCounters } = await load("bin/lib/worker/local-work.mjs");
    program = { runWorker, rules: inputRules(readCatalog(ROOT)), parseCounters, ComputerRunner: (await import("@/lib/computer-runner")).ComputerRunner };
    routes = await loadRoutes();
    svc = await startStandInBilling();
    auth.setPassword("install password");
    const session = (id: string) => `${auth.SESSION_COOKIE}=${auth.createSession(id).value}`;
    a1 = session(auth.createAccount("worker-a@example.com", "long enough").id);
    b1 = session(auth.createAccount("worker-b@example.com", "long enough").id);
    setSetting("comfyWhere", "workers");
    setSetting("comfyUrl", "");
    setSetting("engineMode", "open");
    ensureRunner();
    runnerByHand();
  });
  afterAll(async () => {
    globalThis.__fuobeTestDiskFree = undefined;
    await svc?.close();
  });
  beforeEach(async () => {
    const { resetRates } = await import("@/server/rate");
    const billing = await import("@/server/billing");
    resetRates();
    billing.resetBillingCache();
    process.env.FUOBE_HOSTED_RUNS = "1";
    process.env.FUOBE_BILLING_URL = svc.address;
    process.env.FUOBE_BILLING_TOKEN = svc.token;
    Object.assign(svc, { priced: false, slowMs: 0, gather: null, policy: JSON.parse(JSON.stringify(FREE_RUNS_POLICY)) });
    await svc.start();
    const d = studio.db();
    d.prepare("DELETE FROM relay_workers").run();
    d.prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
    d.prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
    d.prepare("DELETE FROM pool_admissions").run();
  });
  afterEach(async () => {
    vi.useRealTimers();
    for (const r of running.splice(0)) {
      r.ctrl.abort();
      await r.done.catch(() => {});
    }
  });

  // -------------------------------------------------------------------------
  // The studio

  type W = { id: string; token: string };
  function addWorker(): W {
    const w = studio.pool.addWorker(`pc-${Math.random().toString(36).slice(2, 8)}`);
    const lanes = studio.lanes();
    studio.pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: Object.fromEntries(lanes.map((l) => [l, { delayMs: 0 }])), claimAfterMs: 0 });
    studio.db().prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ? WHERE id = ?").run(JSON.stringify({ lanes, workflows: studio.workflows() }), JSON.stringify({ vramBytes: 32 * 2 ** 30 }), w.id);
    return w;
  }

  const request = (url: string, cookie: string, body?: unknown) => {
    const text = body === undefined ? undefined : JSON.stringify(body);
    return new Request(`http://${HOST}${url}`, { method: text ? "POST" : "GET", headers: { ...SITE_HEADERS, cookie, ...(text && { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }) }, body: text });
  };
  const taskOf = (id: string) => studio.db().prepare("SELECT * FROM relay_tasks WHERE generation_id = ? ORDER BY created_at DESC").get(id) as import("@/server/computer/tasks").TaskRow | undefined;
  const done = (g: RunLike | null) => !!g && g.status !== "queued" && g.status !== "running";

  /** Press Run as an account; its job's graph becomes the stand-in's (the run's save node and file prefix kept). */
  async function pressRun(cookie = a1, o: { input?: boolean } = {}) {
    const r = await studio.generations.POST(request("/api/generations", cookie, IMAGE));
    const body = (await r.json()) as { items?: { id: string }[] };
    expect(r.status, JSON.stringify(body)).toBe(201);
    const id = body.items![0].id;
    let t = taskOf(id);
    for (let i = 0; i < 200 && !t; i++) {
      await sleep(20);
      t = taskOf(id);
    }
    const graph = JSON.parse(t!.graph_json!) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    const save = Object.entries(graph).find(([, n]) => n.class_type === "SaveImage")!;
    let input: string | null = null;
    if (o.input) {
      const tasks = await import("@/server/computer/tasks");
      input = tasks.stageInput(t!.principal, FAKE_PNG, "image/png", "in.png");
      studio.db().prepare("UPDATE relay_inputs SET task_id = ?, n = 0 WHERE name = ?").run(t!.id, input);
    }
    const own = {
      ...(input && { "1": { class_type: "LoadImage", inputs: { image: input } } }),
      "3": { class_type: "KSampler", inputs: { seed: 1, steps: 4 } },
      [save[0]]: { class_type: "SaveImage", inputs: { images: ["3", 0], filename_prefix: save[1].inputs.filename_prefix } },
    };
    const needs = { ...(JSON.parse(t!.needs_json ?? "{}") as object), files: [], packs: [], minVramBytes: 0 };
    studio.db().prepare("UPDATE relay_tasks SET graph_json = ?, needs_json = ? WHERE id = ?").run(JSON.stringify(own), JSON.stringify(needs), t!.id);
    return { id, task: t! };
  }

  /** Every place the account looks from. */
  const watchOf = (id: string, cookie = a1) =>
    new RunWatch({
      refresh: () => studio.getGeneration(id),
      session: async () => {
        const r = await studio.one.GET(request(`/api/generations/${id}`, cookie), { params: Promise.resolve({ id }) } as never);
        return r.ok ? ((await r.json()) as RunLike) : null;
      },
    });

  /** Look at the run until it ends (the runner turning by hand), then the three checks. */
  async function expectOnce(id: string, watch: RunWatch, o: { prompts?: () => number; promptsWanted?: number; place?: number } = {}) {
    let g = studio.getGeneration(id);
    for (let i = 0; i < 3000 && !done(g); i++) {
      await tick();
      await watch.look();
      await sleep(50);
      g = studio.getGeneration(id);
    }
    await watch.look();
    expect(watch.problems({ place: o.place ?? 1 }), JSON.stringify(watch.path())).toEqual([]);
    expect(g?.status, g?.error ?? "").toBe("succeeded");
    expect(g!.outputs).toHaveLength(1);
    if (o.prompts && o.promptsWanted !== undefined) expect(o.prompts()).toBe(o.promptsWanted);
    for (let i = 0; i < 100 && svc.reportsFor(id).length < 1; i++) {
      await studio.outbox.sweepBilling();
      await sleep(10);
    }
    expect(svc.reportsFor(id).map((r) => r.kind)).toEqual(["settle"]);
  }

  // -------------------------------------------------------------------------
  // The worker program

  interface Pc {
    home: string;
    workDir: string;
    comfyDir: string;
    turns: string;
    lock: string;
    countFile: string;
    logs: string[];
  }
  function pc(): Pc {
    const base = tempDir("fuobe-recovery-pc-");
    const p = { home: path.join(base, "home"), workDir: path.join(base, "work"), comfyDir: path.join(base, "comfy"), turns: path.join(base, "turns"), lock: path.join(base, "gpu.lock"), countFile: path.join(base, "prompts.txt"), logs: [] };
    for (const d of [p.home, p.workDir, p.comfyDir, p.turns]) fs.mkdirSync(d, { recursive: true });
    return p;
  }
  const comfyOf = (p: Pc) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(p.workDir, "comfyui.pid"), "utf8")) as { pid: number; port: number };
    } catch {
      return null;
    }
  };
  const stats = async (p: Pc) => {
    const c = comfyOf(p);
    return c ? ((await realFetch(`http://127.0.0.1:${c.port}/__fake/stats`).then((r) => r.json()).catch(() => null)) as { posts: number; running: string | null; step: number | null } | null) : null;
  };
  const prompts = (p: Pc) => (fs.existsSync(p.countFile) ? fs.readFileSync(p.countFile, "utf8").trim().split("\n").filter(Boolean).length : 0);
  async function until<T>(fn: () => T | Promise<T>, ms = 60_000): Promise<NonNullable<T>> {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v as NonNullable<T>;
      if (Date.now() > end) throw new Error(`Timed out after ${ms} ms`);
      await tick();
      await sleep(50);
    }
  }

  const running: { ctrl: AbortController; done: Promise<unknown> }[] = [];
  /** A test steps between the worker and the studio, or its ComfyUI (return a Response to answer in the studio's place). */
  type Intercept = (url: string, init: RequestInit) => Response | undefined | Promise<Response | undefined>;

  /** Start `fuobe worker run` for this worker, its ComfyUI a stand-in process of its own. */
  function start(w: W, p: Pc, o: { steps?: number; stepMs?: number; failNext?: string; stallMin?: number; modelDirs?: string[]; pins?: Record<string, string>; rescanMs?: number; intercept?: Intercept; gpu?: Record<string, unknown>; awake?: boolean[] } = {}) {
    const ctrl = new AbortController();
    const api = apiAs(routes, null);
    const fetchFn = async (url: string, init: RequestInit = {}) => {
      const mine = await o.intercept?.(String(url), init);
      if (mine) return mine;
      if (!String(url).startsWith(SITE)) return realFetch(url, init);
      const u = new URL(url);
      // Its inventory is noted, not saved: the worker keeps the lanes the test gave it (no model files here).
      if (u.pathname === "/api/gpu/computer/inventory") return Response.json({ ok: true, lanes: studio.lanes(), workflows: studio.workflows(), missing: [] });
      return api(u.pathname + u.search, init);
    };
    const cfg = {
      site: SITE,
      token: w.token,
      comfyDir: p.comfyDir,
      workDir: p.workDir,
      modelDirs: o.modelDirs ?? [],
      comfyCommand: [
        process.execPath, "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", FAKE, "--port", "{port}", "--cors", "off",
        "--steps", String(o.steps ?? 4), "--step-ms", String(o.stepMs ?? 40), "--worker-guard", "1", "--count-file", p.countFile,
        ...(o.failNext ? ["--fail-next", o.failNext] : []),
      ],
      comfyGuard: true,
      stallMin: o.stallMin ?? 10,
      hungMin: 3,
      ffmpeg: null,
      yieldFolder: p.turns,
      desktopBaselineMb: 600,
      gpuLockFile: p.lock,
      gpuLockComfyOwners: [],
    };
    const r = {
      ctrl,
      done: program.runWorker(cfg, {
        fetch: fetchFn,
        home: p.home,
        signal: ctrl.signal,
        requirements: { folders: [], files: {}, packs: {}, workflows: {} },
        ComputerRunner: program.ComputerRunner,
        rules: program.rules,
        pins: o.pins ?? {},
        allowed: ALLOWED,
        ffmpegVersion: async () => null,
        awake: { set: (on: boolean) => void o.awake?.push(on) },
        readGpu: async () => null,
        sleep: (ms: number) => sleep(Math.min(ms, 50)),
        log: (line: string) => void p.logs.push(line),
        ...(o.rescanMs && { rescanMs: o.rescanMs }),
        ...o.gpu,
      }) as Promise<unknown>,
    };
    running.push(r);
    return r;
  }

  // -------------------------------------------------------------------------

  it("REL-3: its ComfyUI killed at 50%: the output arrives", async () => {
    const w = addWorker();
    const p = pc();
    const { id } = await pressRun();
    const watch = watchOf(id);
    start(w, p, { steps: 10, stepMs: 150 });
    await until(async () => ((await stats(p))?.step ?? 0) >= 5);
    process.kill(comfyOf(p)!.pid, "SIGKILL");
    await expectOnce(id, watch);
  });

  it("REL-3: its ComfyUI hangs: the job goes back in line within the stall limit, keeps its place, and the output arrives", async () => {
    const w = addWorker();
    const p = pc();
    const { id } = await pressRun();
    const watch = watchOf(id);
    start(w, p, { failNext: "never", stallMin: 0.05 });
    await expectOnce(id, watch);
    expect(prompts(p)).toBeGreaterThanOrEqual(2);
  });

  it("REL-3: its ComfyUI runs out of memory: it frees memory, tries once more, and the output arrives", async () => {
    const w = addWorker();
    const p = pc();
    const { id } = await pressRun();
    const watch = watchOf(id);
    start(w, p, { failNext: "oom" });
    await expectOnce(id, watch, { prompts: () => prompts(p), promptsWanted: 2 });
  });

  it("REL-4: the worker killed mid-render and started again: the output arrives once", async () => {
    const w = addWorker();
    const p = pc();
    const { id } = await pressRun();
    const watch = watchOf(id);
    const first = start(w, p, { steps: 10, stepMs: 150 });
    await until(async () => ((await stats(p))?.step ?? 0) >= 3);
    first.ctrl.abort();
    await first.done.catch(() => {});
    start(w, p);
    await expectOnce(id, watch);
  });

  it("REL-5: the worker stopped after its render and before the upload: the output arrives, from exactly one prompt", async () => {
    const w = addWorker();
    const p = pc();
    const { id } = await pressRun();
    const watch = watchOf(id);
    const first = start(w, p, {
      intercept: (url, init) => {
        if (!url.includes("/outputs/") || init.method !== "PUT") return undefined;
        first.ctrl.abort();
        return new Response("stopping", { status: 503 });
      },
    });
    await first.done.catch(() => {});
    expect(taskOf(id)!.state).toBe("collecting");
    start(w, p);
    await expectOnce(id, watch, { prompts: () => prompts(p), promptsWanted: 1 });
  });

  it("REL-14: its ComfyUI refuses the job's input 7 times: the studio sends the input once, and the output arrives", async () => {
    const w = addWorker();
    const p = pc();
    const { id } = await pressRun(a1, { input: true });
    const watch = watchOf(id);
    let refused = 0;
    let fetched = 0;
    start(w, p, {
      intercept: (url) => {
        if (url.includes("/inputs/")) fetched++;
        if (url.includes("/upload/image") && refused < 7) {
          refused++;
          return new Response("busy", { status: 500 });
        }
        return undefined;
      },
    });
    await expectOnce(id, watch);
    expect(refused).toBe(7);
    expect(fetched).toBe(1);
  });

  it("REL-15: a job whose input crashes its ComfyUI fails in plain words, not charged, and the next account's run finishes", async () => {
    const w = addWorker();
    const p = pc();
    const bad = await pressRun(a1);
    const next = await pressRun(b1);
    const watch = watchOf(next.id, b1);
    start(w, p, { steps: 10, stepMs: 100 });
    // Every time its ComfyUI runs the bad job, it dies.
    const badPrompt = bad.task.prompt_id;
    const killer = setInterval(async () => {
      const s = await stats(p);
      if (s?.running === badPrompt) process.kill(comfyOf(p)!.pid, "SIGKILL");
    }, 50);
    try {
      await until(() => done(studio.getGeneration(bad.id)), 120_000);
      expect(plainFailure(studio.getGeneration(bad.id)!, { held: true })).toEqual([]);
      await expectOnce(next.id, watch, { place: 2 });
      expect(svc.reportsFor(bad.id).map((r) => r.kind)).toEqual(["refund"]);
    } finally {
      clearInterval(killer);
    }
  });

  it("REL-18: the PC sleeps for 5 minutes mid-run, then wakes: the output arrives once, and the job lost no attempt", async () => {
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    const w = addWorker();
    const p = pc();
    const { id } = await pressRun();
    const watch = watchOf(id);
    const awake: boolean[] = [];
    let asleep = false;
    let wake: () => void = () => {};
    const woken = new Promise<void>((r) => (wake = r));
    start(w, p, { steps: 10, stepMs: 150, awake, intercept: async () => (asleep ? (await woken, undefined) : undefined) });
    await until(async () => ((await stats(p))?.step ?? 0) >= 3);
    expect(awake).toContain(true);
    // Asleep: nothing of the worker answers for 5 minutes on the studio's clock.
    asleep = true;
    for (let m = 0; m < 5; m++) {
      vi.setSystemTime(Date.now() + MIN);
      await tick();
      await watch.look();
    }
    asleep = false;
    wake();
    await expectOnce(id, watch);
    expect(taskOf(id)!.requeues).toBe(0);
  });

  it("REL-19: a model folder missing at start and added a minute later: the waiting job is taken within one look at the folders", async () => {
    const w = addWorker();
    const p = pc();
    const models = path.join(p.home, "models");
    const bytes = "stand-in model!!";
    const file = { folder: "checkpoints", name: "stand-in.safetensors", size: bytes.length, sha256: sha(bytes) };
    const { id, task } = await pressRun();
    studio.db().prepare("UPDATE relay_tasks SET needs_json = ? WHERE id = ?").run(JSON.stringify({ ...(JSON.parse(task.needs_json ?? "{}") as object), files: [file] }), task.id);
    const watch = watchOf(id);
    start(w, p, { modelDirs: [models], pins: { [file.name]: file.sha256 }, rescanMs: 500 });
    await sleep(1500);
    expect(taskOf(id)!.state).toBe("waiting");
    fs.mkdirSync(path.join(models, file.folder), { recursive: true });
    fs.writeFileSync(path.join(models, file.folder, file.name), bytes);
    await until(() => taskOf(id)!.state !== "waiting", 5000);
    await expectOnce(id, watch);
  });

  describe("users first: accounts' jobs before local ComfyUI work", () => {
    const MB = 2 ** 20;
    const LUID = "luid_0x00000000_0x0000D1B5_phys_0";
    /** The PC's GPU as fakes show it: local ComfyUI work on 8188, maybe a game, the desktop, and the worker's own ComfyUI. */
    const fakeGpu = (p: Pc, o: { workMb: number; gameMb?: number }) => {
      const procs = () => [{ pid: 4242, mb: o.workMb }, { pid: 5555, mb: o.gameMb ?? 0 }, { pid: 77, mb: 500 }, ...(comfyOf(p) ? [{ pid: comfyOf(p)!.pid, mb: 1000 }] : [])];
      return {
        gpuEveryMs: 200,
        turnGraceMs: 1500,
        readGpu: async () => ({ usedMb: procs().reduce((n, c) => n + c.mb, 0), tempC: 50, apps: [] }),
        readCounters: async () =>
          program.parseCounters(
            [`"(PDH-CSV 4.0)",${procs().map((r) => `"\\\\PC\\GPU Process Memory(pid_${r.pid}_${LUID})\\Dedicated Usage"`).join(",")}`, `"11/04/2026 09:00:00.000",${procs().map((r) => `"${r.mb * MB}"`).join(",")}`].join("\r\n"),
          ),
        readListeners: async () => ({
          listeners: [{ port: 8188, pid: 4242 }, ...(comfyOf(p) ? [{ port: comfyOf(p)!.port, pid: comfyOf(p)!.pid }] : [])],
          names: { 4242: "python", 5555: "game", 77: "dwm", ...(comfyOf(p) ? { [comfyOf(p)!.pid]: "node" } : {}) },
        }),
      };
    };
    const site = (p: Pc) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(p.turns, "site.json"), "utf8")) as { siteWaiting: number };
      } catch {
        return null;
      }
    };

    it("only local ComfyUI work holds the GPU: the worker asks for a turn, the job stays In line in its place, and once the turn is given it is taken within 5 s and its output arrives", async () => {
      const w = addWorker();
      const p = pc();
      const { id } = await pressRun();
      const watch = watchOf(id);
      start(w, p, { gpu: fakeGpu(p, { workMb: 9000 }) });
      await until(() => (site(p)?.siteWaiting ?? 0) >= 1);
      await tick();
      await watch.look();
      expect(taskOf(id)!.state).toBe("waiting");
      // The PC's own side gives the turn.
      const at = Date.now();
      fs.writeFileSync(path.join(p.turns, "yielded.json"), JSON.stringify({ state: "yielded", at }));
      await until(() => taskOf(id)!.state !== "waiting", 5000);
      expect(Date.now() - at).toBeLessThan(5000);
      await expectOnce(id, watch);
    });

    it("a game holds the GPU: the worker takes the busy pause, asks for no turn, and the job stays In line in its place", async () => {
      const w = addWorker();
      const p = pc();
      const { id } = await pressRun();
      const watch = watchOf(id);
      start(w, p, { gpu: fakeGpu(p, { workMb: 9000, gameMb: 6000 }) });
      await until(() => (studio.db().prepare("SELECT local_why FROM relay_workers WHERE id = ?").get(w.id) as { local_why: string | null }).local_why?.startsWith("gpu-busy"));
      expect(site(p)?.siteWaiting ?? 0).toBe(0);
      await tick();
      await watch.look();
      expect(taskOf(id)!.state).toBe("waiting");
      expect(watch.problems({ place: 1 })).toEqual([]);
    });
  });
});
