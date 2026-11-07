/**
 * The worker program end to end (bin/lib/worker/run.mjs), against the studio's real routes and its own stand-in
 * ComfyUI (tests/helpers/fake-local-comfy.ts, started and stopped by the worker as a process of its own, behind the
 * worker's guard). Never a real ComfyUI, never a GPU.
 *
 * - Its ComfyUI is killed at 50%: the output arrives.
 * - The worker stops after the render and before the upload (or before the studio heard it finished): the output
 *   arrives after the next start, and its ComfyUI got exactly one prompt. Paused here, it still sends kept results.
 * - Its ComfyUI hangs: the job is given back within the stall limit, and then runs to the end.
 * - A job the studio took back mid-run stops in its ComfyUI at once.
 * - A ComfyUI that stops answering is stopped and started again; one that answers without its guard is not used.
 * - A request to its ComfyUI with another Host or without the key is refused.
 * - A clip is made again by ffmpeg before its ComfyUI sees it; without ffmpeg, the job goes back to the line.
 * - A model file that turns up later is reported within one look at its folders.
 * - A token with a lifetime: the worker saves the next token from a beat answer in worker.json and uses it, and the old
 *   token stops.
 * - Its PC sleeps mid-run and the studio takes the job back: the next beat says how long it slept, the attempt is taken
 *   back, and the output arrives once.
 * - A model folder that isn't there yet (a drive still locked after a restart): the worker waits for it, says so, and
 *   sends no list of files meanwhile; once the folder is there, the waiting job is taken within one look.
 * - New worker code installed mid-job: it takes no new job, finishes the one it has, and ends to start again on it.
 * - A node pack whose folder is there but whose nodes its ComfyUI didn't load is said in its list, with the missing
 *   classes, and kept for its next start.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runWorker } from "../bin/lib/worker/run.mjs";
import { Hold } from "../bin/lib/worker/hold.mjs";
import { STAMP_FILE } from "../bin/lib/worker/stamp.mjs";
import { CodeWatch, UPDATE_READY_FILE } from "../bin/lib/worker/update.mjs";
import { inputRules, readCatalog } from "../scripts/lib/worker-catalog.mjs";
import { FAKE_PNG } from "./helpers/fake-local-comfy";
import { apiAs, loadRoutes, type ComputerRoutes } from "./helpers/computer-tab";
import { tempDir } from "./helpers/temp-dir";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 120_000 });

const dir = tempDir("fuobe-worker-recovery-");
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
const ALLOWED = new Set(["LoadImage", "KSampler", "SaveImage", "LoadVideo", "VHS_VideoCombine"]);
const hasFfmpeg = spawnSync("ffmpeg", ["-hide_banner", "-version"]).status === 0;
const realFetch = globalThis.fetch;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let routes: ComputerRoutes;
beforeAll(async () => {
  routes = await loadRoutes();
  setSetting("comfyWhere", "workers");
});
afterAll(() => {
  globalThis.__fuobeTestDiskFree = undefined;
});
beforeEach(() => {
  resetRates();
  db().prepare("DELETE FROM relay_workers").run();
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
});

type W = { id: string; token: string };
const state = (id: string) => db().prepare("SELECT * FROM relay_tasks WHERE id = ?").get(id) as import("@/server/computer/tasks").TaskRow;

/** A worker the owner added and resumed, all day, for the "small" lane, with one workflow it can run. */
function addWorker(): W {
  const w = pool.addWorker(`pc-${Math.random().toString(36).slice(2, 8)}`);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: { small: { delayMs: 0 } } });
  db().prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ? WHERE id = ?").run(JSON.stringify({ lanes: ["small"], workflows: ["wf-test"] }), JSON.stringify({ vramBytes: 24 * 2 ** 30 }), w.id);
  return w;
}

let gens = 0;
/** A job for the workers that loads one input (a picture, or a clip) and saves a picture (or what `save` says). */
function addTask(o: { clip?: Buffer; save?: { class_type: string; inputs: Record<string, unknown> } } = {}): { id: string; input: string } {
  const gid = `recovery-gen-${++gens}`;
  const now = Date.now();
  db()
    .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'queued', '{}', '[]', ?, ?)")
    .run(gid, now, now);
  const input = o.clip ? tasks.stageInput("owner", o.clip, "video/mp4", "clip.mp4") : tasks.stageInput("owner", FAKE_PNG, "image/png", "in.png");
  const loader = o.clip ? { class_type: "LoadVideo", inputs: { file: input } } : { class_type: "LoadImage", inputs: { image: input } };
  const t = tasks.createTask({
    principal: "owner",
    generationId: gid,
    graph: { "1": loader, "3": { class_type: "KSampler", inputs: { seed: 1, steps: 4 } }, "9": o.save ?? { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "fuobe/worker-test" } } },
    pool: { pools: ["pool"], rankAt: now, lane: "small", needs: { workflowId: "wf-test", files: [], packs: [], minVramBytes: 0 } },
  });
  return { id: t.id, input };
}

interface Studio {
  calls: string[];
  reports: { at: number; body: Record<string, unknown> }[];
  inventories: Record<string, unknown>[];
  intercept: ((p: string, init: RequestInit) => Promise<Response | undefined> | Response | undefined) | null;
  /** Next tokens the studio gave the worker in its beat answers (the worker may use them from then on). */
  tokens: string[];
}

/** fetch for the worker: the studio's routes for SITE, its own ComfyUI for the rest. */
function router(w: W, s: Studio) {
  const api = apiAs(routes, null);
  return async (url: string, init: RequestInit = {}) => {
    if (!String(url).startsWith(SITE)) return realFetch(url, init);
    const u = new URL(url);
    const p = u.pathname + u.search;
    const mine = await s.intercept?.(p, init);
    if (mine) return mine;
    s.calls.push(`${init.method ?? "GET"} ${u.pathname}`);
    if (p.endsWith("/report")) s.reports.push({ at: Date.now(), body: JSON.parse(String(init.body)) });
    // The inventory is written down, not saved: the worker keeps the lanes the test gave it.
    if (p === "/api/gpu/computer/inventory") {
      s.inventories.push(JSON.parse(String(init.body)));
      return Response.json({ ok: true, lanes: ["small"], workflows: ["wf-test"], missing: [] });
    }
    expect([w.token, ...s.tokens].map((t) => `Bearer ${t}`)).toContain(new Headers(init.headers).get("authorization"));
    const res = await api(p, init);
    if (p === "/api/gpu/computer/beat" && res.ok) {
      const next = ((await res.clone().json()) as { worker?: { token?: { value: string } } }).worker?.token?.value;
      if (next) s.tokens.push(next);
    }
    return res;
  };
}

const running: { ctrl: AbortController; done: Promise<unknown> }[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) {
    r.ctrl.abort();
    await r.done.catch(() => {});
  }
});

interface Pc {
  home: string;
  workDir: string;
  comfyDir: string;
  countFile: string;
  /** Each prompt its ComfyUI got, as a line of JSON. */
  graphFile: string;
  logs: string[];
  /** When each log line was written. */
  logAt: number[];
  awake: boolean[];
}

function pc(): Pc {
  const base = tempDir("fuobe-worker-pc-");
  const p = { home: path.join(base, "home"), workDir: path.join(base, "work"), comfyDir: path.join(base, "comfy"), countFile: path.join(base, "prompts.txt"), graphFile: path.join(base, "graphs.jsonl"), logs: [], logAt: [], awake: [] };
  for (const d of [p.home, p.workDir, p.comfyDir]) fs.mkdirSync(d, { recursive: true });
  return p;
}

/** Start `fuobe worker run` in this process (its ComfyUI a stand-in process of its own). */
function start(
  w: W,
  s: Studio,
  p: Pc,
  o: { steps?: number; stepMs?: number; failNext?: string; stallMin?: number; hungMin?: number; ffmpeg?: string | null; rescanMs?: number; modelsCheckMs?: number; modelDirs?: string[]; requirements?: unknown; pins?: Record<string, string>; command?: string[]; readGpu?: () => Promise<unknown>; gpuEveryMs?: number; port?: number; now?: () => number; sleep?: (ms: number) => Promise<void>; env?: Record<string, string | undefined>; codeWatch?: unknown } = {},
) {
  const ctrl = new AbortController();
  const cfg = {
    site: SITE,
    token: w.token,
    comfyDir: p.comfyDir,
    workDir: p.workDir,
    modelDirs: o.modelDirs ?? [],
    comfyCommand: o.command ?? [
      process.execPath, "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", FAKE, "--port", "{port}", "--cors", "off",
      "--steps", String(o.steps ?? 4), "--step-ms", String(o.stepMs ?? 40), "--worker-guard", "1", "--count-file", p.countFile, "--graph-file", p.graphFile,
      ...(o.failNext ? ["--fail-next", o.failNext] : []),
    ],
    comfyGuard: true,
    stallMin: o.stallMin ?? 10,
    hungMin: o.hungMin ?? 3,
    ffmpeg: o.ffmpeg ?? null,
    ...(o.port && { port: o.port }),
  };
  const done = runWorker(cfg, {
    fetch: router(w, s),
    home: p.home,
    signal: ctrl.signal,
    requirements: o.requirements ?? { folders: [], files: {}, packs: {}, workflows: {} },
    ComputerRunner,
    rules: RULES,
    pins: o.pins ?? {},
    allowed: ALLOWED,
    readGpu: o.readGpu ?? (async () => null),
    ...(o.gpuEveryMs && { gpuEveryMs: o.gpuEveryMs }),
    ...(o.ffmpeg === undefined || o.ffmpeg === null ? { ffmpegVersion: async () => null } : {}),
    awake: { set: (on: boolean) => void (p.awake.at(-1) !== on && p.awake.push(on)) },
    sleep: o.sleep ?? ((ms: number) => sleep(Math.min(ms, 50))),
    ...(o.now && { now: o.now }),
    log: (line: string) => {
      p.logs.push(line);
      p.logAt.push(Date.now());
    },
    ...(o.rescanMs && { rescanMs: o.rescanMs }),
    ...(o.modelsCheckMs && { modelsCheckMs: o.modelsCheckMs }),
    ...(o.env && { env: o.env }),
    ...(o.codeWatch ? { codeWatch: o.codeWatch } : {}),
  });
  const r = { ctrl, done };
  running.push(r);
  return r;
}

const studio = (): Studio => ({ calls: [], reports: [], inventories: [], intercept: null, tokens: [] });

async function until<T>(fn: () => T | Promise<T>, ms = 60_000, every = 100): Promise<Exclude<T, false | null | undefined | 0 | "">> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as Exclude<T, false | null | undefined | 0 | "">;
    if (Date.now() > end) throw new Error(`Timed out after ${ms} ms`);
    await sleep(every);
  }
}

/** Its ComfyUI now: the pid and port the worker wrote down for this start. */
const comfyOf = (p: Pc) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(p.workDir, "comfyui.pid"), "utf8")) as { pid: number; port: number };
  } catch {
    return null;
  }
};
const fakeStats = async (port: number) => (await realFetch(`http://127.0.0.1:${port}/__fake/stats`)).json() as Promise<{ posts: number; running: string | null; step: number | null }>;
const prompts = (p: Pc) => (fs.existsSync(p.countFile) ? fs.readFileSync(p.countFile, "utf8").trim().split("\n").filter(Boolean).length : 0);
const ended = (id: string) => until(() => ["done", "failed", "canceled"].includes(state(id).state) && state(id), 90_000);

function raw(port: number, p: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("a worker keeps its jobs going", () => {
  it("a second worker on the same worker folder refuses to start, and leaves the first one's ComfyUI, folders and job alone", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const { id } = addTask();
    start(w, s, p, { steps: 40, stepMs: 150 });
    const comfy = await until(async () => {
      const c = comfyOf(p);
      return c && ((await fakeStats(c.port).catch(() => null))?.step ?? 0) >= 2 ? c : null;
    });
    // Files of the first one's job in its folders now.
    fs.writeFileSync(path.join(p.workDir, "input", "in-use.png"), FAKE_PNG);
    fs.writeFileSync(path.join(p.workDir, "temp", "in-use.txt"), "the first worker's");
    const logs = p.logs.length;
    // The same worker.json run again (by hand, while the scheduled one runs).
    const second = start(w, s, p);
    await expect(second.done).rejects.toThrow(/Another worker is running on this worker folder/);
    // Nothing of the first one's was touched: its ComfyUI runs, its folders and its job are as they were.
    expect(comfyOf(p)).toEqual(comfy);
    expect(() => process.kill(comfy.pid, 0)).not.toThrow();
    expect(fs.existsSync(path.join(p.workDir, "input", "in-use.png"))).toBe(true);
    expect(fs.existsSync(path.join(p.workDir, "temp", "in-use.txt"))).toBe(true);
    expect(p.logs.slice(logs).some((l) => /Stopped a ComfyUI|Starting its own ComfyUI/.test(l))).toBe(false);
    const t = await ended(id);
    expect(t.state).toBe("done");
    expect(prompts(p)).toBe(1);
    expect(fs.existsSync(path.join(p.workDir, "crashes.json")) ? Object.keys(JSON.parse(fs.readFileSync(path.join(p.workDir, "crashes.json"), "utf8"))) : []).toEqual([]);
    // Once the first one has stopped, a worker on that folder starts as usual.
    running[0].ctrl.abort();
    await running[0].done;
    const third = start(w, s, p);
    await until(() => p.logs.slice(logs).some((l) => /Starting its own ComfyUI/.test(l)));
    third.ctrl.abort();
    expect(await third.done).toBe("aborted");
  });

  it("its ComfyUI is killed at 50%: the output arrives (and its guard refuses another Host and a missing key)", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const { id } = addTask();
    start(w, s, p, { steps: 10, stepMs: 150 });
    const comfy = await until(async () => {
      const c = comfyOf(p);
      return c && ((await fakeStats(c.port).catch(() => null))?.step ?? 0) >= 5 ? c : null;
    });
    // Its own ComfyUI: refused without the key, and to a page that named itself 127.0.0.1 (DNS rebinding).
    expect(await raw(comfy.port, "/system_stats", { Host: `127.0.0.1:${comfy.port}` })).toBe(403);
    expect(await raw(comfy.port, "/prompt", { Host: `rebound.example:${comfy.port}` })).toBe(403);
    process.kill(comfy.pid, "SIGKILL");
    const t = await ended(id);
    expect(t.state).toBe("done");
    expect(fs.readFileSync(tasks.outputFile(id, 0)).equals(FAKE_PNG)).toBe(true);
    // Sent again once, from its own copy of the input: the studio sent the input once.
    expect(prompts(p)).toBe(2);
    expect(s.calls.filter((c) => c.includes("/inputs/"))).toHaveLength(1);
    expect(p.logs.some((l) => /ComfyUI stopped/.test(l))).toBe(true);
    expect(p.awake).toContain(true);
  });

  it("stopped after the render and before the upload: the next start uploads it, and its ComfyUI got exactly one prompt", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const { id } = addTask();
    const first = start(w, s, p);
    s.intercept = (q, init) => {
      if (!q.includes("/outputs/") || init.method !== "PUT") return undefined;
      first.ctrl.abort();
      return new Response("stopping", { status: 503 });
    };
    expect(await first.done).toBe("aborted");
    expect(state(id).state).toBe("collecting");
    expect(new Hold(path.join(p.workDir, "hold")).ids()).toEqual([id]);
    // Nothing else of the job stayed on this PC, and its ComfyUI stopped with it; the PC may sleep again.
    expect(["input", "output", "temp"].flatMap((d) => fs.readdirSync(path.join(p.workDir, d)))).toEqual([]);
    expect(comfyOf(p)).toBeNull();
    expect(p.awake.at(-1)).toBe(false);
    // The next start sends the kept results before it starts its ComfyUI (which can take minutes on a real PC).
    let uploadAt = 0;
    s.intercept = (q, init) => {
      if (q.includes("/outputs/") && init.method === "PUT") uploadAt ||= Date.now();
      return undefined;
    };
    const before = p.logs.length;
    start(w, s, p);
    const t = await ended(id);
    expect(t.state).toBe("done");
    expect(fs.readFileSync(tasks.outputFile(id, 0)).equals(FAKE_PNG)).toBe(true);
    expect(prompts(p)).toBe(1);
    expect(new Hold(path.join(p.workDir, "hold")).ids()).toEqual([]);
    const startedAt = await until(() => p.logs.slice(before).some((l) => /Starting its own ComfyUI/.test(l)) && p.logAt[p.logs.findIndex((l, i) => i >= before && /Starting its own ComfyUI/.test(l))]);
    expect(uploadAt).toBeGreaterThan(0);
    expect(uploadAt).toBeLessThanOrEqual(startedAt);
  });

  it("stopped before the studio heard it finished: the next start, paused here, sends the kept results without its ComfyUI", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const { id } = addTask();
    const first = start(w, s, p);
    s.intercept = (q, init) => {
      if (!q.endsWith("/report") || JSON.parse(String(init.body)).event !== "finished") return undefined;
      first.ctrl.abort();
      return new Response("stopping", { status: 503 });
    };
    await first.done;
    expect(state(id).state).toBe("running");
    s.intercept = null;
    // Paused here: it starts no ComfyUI, but its kept results need none.
    fs.writeFileSync(path.join(p.home, "control.json"), JSON.stringify({ paused: true }));
    start(w, s, p);
    const t = await ended(id);
    expect(t.state).toBe("done");
    expect(fs.readFileSync(tasks.outputFile(id, 0)).equals(FAKE_PNG)).toBe(true);
    expect(prompts(p)).toBe(1);
    expect(comfyOf(p)).toBeNull();
    expect(tasks.execOf(t)?.ms).toBeTypeOf("number");
  });

  it("stopped after keeping its results, restarted under a pause-now (the shortcut's pause): the output arrives, with one prompt", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const { id } = addTask();
    const first = start(w, s, p);
    s.intercept = (q, init) => {
      if (!q.endsWith("/report") || JSON.parse(String(init.body)).event !== "finished") return undefined;
      first.ctrl.abort();
      return new Response("stopping", { status: 503 });
    };
    await first.done;
    expect(state(id).state).toBe("running");
    expect(new Hold(path.join(p.workDir, "hold")).ids()).toEqual([id]);
    s.intercept = null;
    // Another program now listens on a port the worker.json pins: nothing at all may reach it.
    const hits: string[] = [];
    const other = http.createServer((q, res) => {
      hits.push(`${q.method} ${q.url}`);
      res.end("{}");
    });
    await new Promise<void>((r) => other.listen(0, "127.0.0.1", () => r()));
    try {
      // Paused now, as the pause shortcut does: the studio sends a paused worker's jobs back, but not one whose results
      // it keeps; those go up with no ComfyUI.
      fs.writeFileSync(path.join(p.home, "control.json"), JSON.stringify({ paused: true, now: true }));
      start(w, s, p, { port: (other.address() as { port: number }).port });
      const t = await ended(id);
      expect(t.state).toBe("done");
      expect(fs.readFileSync(tasks.outputFile(id, 0)).equals(FAKE_PNG)).toBe(true);
      expect(prompts(p)).toBe(1);
      expect(comfyOf(p)).toBeNull();
      expect(hits).toEqual([]);
      expect(new Hold(path.join(p.workDir, "hold")).ids()).toEqual([]);
    } finally {
      other.close();
    }
  });

  it("its ComfyUI hangs: the job is given back within the stall limit, then runs to the end", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const { id } = addTask();
    const stallMs = 3_000;
    start(w, s, p, { failNext: "never", stallMin: stallMs / 60_000 });
    await until(() => prompts(p) >= 1);
    const sentAt = Date.now();
    const back = await until(() => s.reports.find((r) => r.body.event === "give-back"));
    expect(back.body).toEqual({ event: "give-back", why: "stalled" });
    expect(back.at - sentAt).toBeLessThan(stallMs + 10_000);
    const t = await ended(id);
    expect(t).toMatchObject({ state: "done", requeues: 1 });
    expect(prompts(p)).toBe(2);
  });

  it("a job taken from it mid-run (its lease no longer works): its prompt stops at once, and the job runs again", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const { id } = addTask();
    start(w, s, p, { steps: 30, stepMs: 200 });
    const comfy = await until(async () => {
      const c = comfyOf(p);
      return c && ((await fakeStats(c.port).catch(() => null))?.step ?? 0) >= 3 ? c : null;
    });
    // The studio puts the job back in line (as when it lost touch with the worker): its next report gets 409.
    pool.backInLine(state(id), { blame: false });
    const stopped = await until(async () => {
      const st = await fakeStats(comfy.port);
      return st.running === null || (st.step !== null && st.step < 3) ? st : null;
    }, 10_000);
    expect(stopped).toBeTruthy();
    const t = await ended(id);
    expect(t.state).toBe("done");
    expect(prompts(p)).toBe(2);
  });

  it("its ComfyUI stops answering: the worker stops it and starts it again", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const hung = path.join(p.comfyDir, "hung.mjs");
    // Answers as a guarded ComfyUI for a few seconds, then never again (hung).
    fs.writeFileSync(
      hung,
      `import http from "node:http"; import crypto from "node:crypto";
const key = process.env.FUOBE_WORKER_GUARD_KEY; const port = Number(process.argv[2]); const until = Date.now() + 3000;
http.createServer((q, s) => {
  if (Date.now() > until) return;
  if (q.headers.host !== "127.0.0.1:" + port) { s.writeHead(403); return s.end(); }
  if (q.url.startsWith("/fuobe-worker/hello") && !q.headers["x-fuobe-worker-key"]) {
    s.writeHead(200, { "content-type": "application/json" });
    return s.end(JSON.stringify({ proof: crypto.createHmac("sha256", key).update(String(q.headers["x-fuobe-worker-challenge"])).digest("hex"), pid: process.pid }));
  }
  if (q.headers["x-fuobe-worker-key"] !== key) { s.writeHead(403); return s.end(); }
  s.writeHead(200, { "content-type": "application/json" }); s.end(JSON.stringify({ system: {}, devices: [] }));
}).listen(port, "127.0.0.1");`,
    );
    // A real GPU reading every 200 ms, so the main loop also asks its ComfyUI for its own memory each time: a ComfyUI
    // that takes the connection and never answers must not hold the loop (and its beats) up.
    const t0 = Date.now();
    start(w, s, p, { command: [process.execPath, hung, "{port}"], hungMin: 0.05, readGpu: async () => ({ usedMb: 500, tempC: 40, apps: [] }), gpuEveryMs: 200 });
    await until(() => p.logs.some((l) => /stopped answering/.test(l)), 60_000);
    expect(Date.now() - t0).toBeLessThan(30_000);
    const beats = s.calls.filter((c) => c.endsWith("/beat")).length;
    await sleep(12_000);
    expect(s.calls.filter((c) => c.endsWith("/beat")).length).toBeGreaterThan(beats);
    await until(() => p.logs.filter((l) => /Starting its own ComfyUI/.test(l)).length >= 2, 30_000);
  });

  it("its ComfyUI takes a long time to start: the worker goes on beating meanwhile", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const slow = path.join(p.comfyDir, "slow.mjs");
    // Proves itself at once, but answers "not ready" (503) for 14 seconds, as a ComfyUI that loads many node packs does.
    fs.writeFileSync(
      slow,
      `import http from "node:http"; import crypto from "node:crypto";
const key = process.env.FUOBE_WORKER_GUARD_KEY; const port = Number(process.argv[2]); const readyAt = Date.now() + 14000;
http.createServer((q, s) => {
  if (q.headers.host !== "127.0.0.1:" + port) { s.writeHead(403); return s.end(); }
  if (q.url.startsWith("/fuobe-worker/hello") && !q.headers["x-fuobe-worker-key"]) {
    s.writeHead(200, { "content-type": "application/json" });
    return s.end(JSON.stringify({ proof: crypto.createHmac("sha256", key).update(String(q.headers["x-fuobe-worker-challenge"])).digest("hex"), pid: process.pid }));
  }
  if (q.headers["x-fuobe-worker-key"] !== key) { s.writeHead(403); return s.end(); }
  if (Date.now() < readyAt) { s.writeHead(503); return s.end(); }
  s.writeHead(200, { "content-type": "application/json" }); s.end(JSON.stringify({ system: {}, devices: [] }));
}).listen(port, "127.0.0.1");`,
    );
    const beatsAt: number[] = [];
    s.intercept = (q) => {
      if (q === "/api/gpu/computer/beat") beatsAt.push(Date.now());
      return undefined;
    };
    start(w, s, p, { command: [process.execPath, slow, "{port}"] });
    const at = (re: RegExp) => until(() => p.logs.some((l) => re.test(l)) && p.logAt[p.logs.findIndex((l) => re.test(l))], 60_000);
    const startedAt = await at(/Starting its own ComfyUI/);
    const readyAt = await at(/^Ready$/);
    expect(readyAt - startedAt).toBeGreaterThan(10_000);
    // Beats went on while it started (one every 10 s with no job).
    expect(beatsAt.filter((b) => b > startedAt && b < readyAt).length).toBeGreaterThanOrEqual(1);
  });

  it("a ComfyUI that answers without its guard is stopped and not started again for an hour", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const open = path.join(p.comfyDir, "open.mjs");
    // Proves itself with the key, but answers every request without it: the guard isn't there.
    fs.writeFileSync(
      open,
      `import http from "node:http"; import crypto from "node:crypto"; const key = process.env.FUOBE_WORKER_GUARD_KEY;
http.createServer((q, s) => { s.writeHead(200, { "content-type": "application/json" });
  s.end(JSON.stringify(q.url.startsWith("/fuobe-worker/hello") ? { proof: crypto.createHmac("sha256", key).update(String(q.headers["x-fuobe-worker-challenge"])).digest("hex"), pid: process.pid } : { system: {}, devices: [] })); }).listen(Number(process.argv[2]), "127.0.0.1");`,
    );
    start(w, s, p, { command: [process.execPath, open, "{port}"] });
    await until(() => p.logs.some((l) => /without the worker's guard/.test(l)), 60_000);
    await sleep(3_000);
    expect(p.logs.filter((l) => /Starting its own ComfyUI/.test(l))).toHaveLength(1);
    expect(comfyOf(p)).toBeNull();
    expect(p.logs.some((l) => /comfy-crashes/.test(l))).toBe(true);
  });

  it("dropped connections (a deploy, a proxy): no job is said to stop, a lone missed beat says nothing, and the job runs", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const dropped = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    const api = apiAs(routes, null);
    let lost: string | null = null;
    let beats = 0;
    s.intercept = async (q, init) => {
      // The studio gives out the job on its first claim, and the answer is lost on the way; its second beat doesn't
      // get through either.
      if (q === "/api/gpu/computer/claim" && !lost) {
        const res = await api(q, init);
        if (res.status !== 200) return res;
        lost = ((await res.json()) as { task: { id: string } }).task.id;
        throw dropped();
      }
      if (q === "/api/gpu/computer/beat" && ++beats === 2) throw dropped();
      return undefined;
    };
    const { id } = addTask();
    start(w, s, p);
    const t = await ended(id);
    expect(lost).toBe(id);
    expect(t.state).toBe("done");
    expect(fs.readFileSync(tasks.outputFile(id, 0)).equals(FAKE_PNG)).toBe(true);
    // The claim sent again got the same job, and it ran once.
    expect(prompts(p)).toBe(1);
    await until(() => beats >= 3, 60_000);
    expect(p.logs.filter((l) => /job stopped|Can't reach the studio|can't ask the studio|trying again/.test(l))).toEqual([]);
  });

  it("a studio it can't reach for longer: said once with the network's reason, and once when it answers again", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    let down = true;
    s.intercept = (q) => {
      if (down && q === "/api/gpu/computer/beat") throw Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_SOCKET" } });
      return undefined;
    };
    start(w, s, p);
    await until(() => p.logs.some((l) => /Can't reach the studio/.test(l)), 60_000);
    down = false;
    await until(() => p.logs.some((l) => /The studio answers again/.test(l)), 60_000);
    expect(p.logs.filter((l) => /Can't reach the studio|answers again/.test(l))).toEqual(["Can't reach the studio: fetch failed (UND_ERR_SOCKET)", "The studio answers again."]);
  });

  it("stops when the studio no longer knows its token, and says so", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const r = start(w, s, p);
    await until(() => s.calls.some((c) => c.endsWith("/beat")));
    pool.patchWorker(w.id, { revoke: true });
    expect(await r.done).toBe("signed-out");
  });

  it("refuses a studio address that isn't https (this PC itself aside)", async () => {
    const p = pc();
    await expect(runWorker({ site: "http://studio.example", token: "t", workDir: p.workDir, comfyDir: p.comfyDir }, { home: p.home })).rejects.toThrow(/https/);
  });
});

describe("the worker's timeline", () => {
  it("its log lines reach the studio masked, each in one beat; its job's handoffs and stages are rows in order", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const beats: { lines: { at: number; level: string; line: string }[] }[] = [];
    s.intercept = (path, init) => {
      if (path === "/api/gpu/computer/beat") beats.push({ lines: (JSON.parse(String(init.body)) as { log?: { at: number; level: string; line: string }[] }).log ?? [] });
      return undefined;
    };
    const { id } = addTask();
    start(w, s, p, { steps: 4, stepMs: 100 });
    expect((await ended(id)).state).toBe("done");
    await until(() => p.logs.some((l) => l.includes(`Job ${id} done`)));
    await until(() => beats.some((b) => b.lines.some((l) => l.line.includes(`Job ${id} done`))));
    // Each line went in one beat only (each beat got a 2xx), oldest first, never more than 40 a beat.
    const sent = beats.flatMap((b) => b.lines);
    expect(beats.every((b) => b.lines.length <= 40)).toBe(true);
    expect(new Set(sent.map((l) => `${l.at} ${l.line}`)).size).toBe(sent.length);
    const rows = db().prepare("SELECT kind, event, words, task_id FROM worker_events WHERE worker_id = ? ORDER BY id").all(w.id) as { kind: string; event: string; words: string; task_id: string | null }[];
    const logs = rows.filter((r) => r.kind === "log").map((r) => r.words);
    expect(logs).toContain(`Job ${id} done.`);
    // No folder of this PC leaves it.
    for (const folder of [p.workDir, p.comfyDir, p.home]) expect(JSON.stringify({ sent, logs })).not.toContain(folder.replace(/\\/g, "\\\\"));
    expect(rows.filter((r) => r.kind === "job" && r.task_id === id).map((r) => r.event)).toEqual(["claimed", "finished", "done"]);
    const stages = rows.filter((r) => r.kind === "stage" && r.task_id === id).map((r) => r.event);
    expect(stages[0]).toBe("sending");
    expect(stages.at(-1)).toBe("saving");
    // Started on its ComfyUI: loading its model (taken cold) until a step reports, then running.
    expect(stages.slice(1, -1).filter((x) => x === "loading" || x === "running").length).toBeGreaterThan(0);
    expect(stages).toContain("queued");
  });
});

describe("new worker code", () => {
  /** A watch on a checkout of its own (its parts taken as whole) and the PC's home folder, looked at every turn. */
  function watch(p: Pc) {
    const root = tempDir("fuobe-worker-update-root-");
    fs.mkdirSync(path.join(root, ".git"), { recursive: true });
    fs.writeFileSync(path.join(root, ".git/HEAD"), `${"a".repeat(40)}
`);
    const dist = tempDir("fuobe-worker-update-dist-");
    fs.writeFileSync(path.join(dist, STAMP_FILE), JSON.stringify({ stamp: "s1" }));
    return new CodeWatch({ root, dist, home: p.home, everyMs: 0, problem: () => null });
  }
  const installed = (p: Pc) => fs.writeFileSync(path.join(p.home, UPDATE_READY_FILE), JSON.stringify({ commit: "b".repeat(40) }));
  const LINE = "New worker code is installed: restarting after this job.";

  it("installed mid-job: no new job, the job in hand finishes, then the worker ends to start again", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const { id } = addTask();
    const r = start(w, s, p, { steps: 20, stepMs: 150, codeWatch: watch(p) });
    await until(async () => {
      const c = comfyOf(p);
      return c && ((await fakeStats(c.port).catch(() => null))?.step ?? 0) >= 2;
    });
    const next = addTask();
    installed(p);
    expect(await r.done).toBe("update");
    // Never mid-job: the job ran to the end, once, and the next one stays in line for another start.
    expect(state(id).state).toBe("done");
    expect(prompts(p)).toBe(1);
    expect(state(next.id).state).toBe("waiting");
    expect(p.logs.filter((l) => l === LINE)).toHaveLength(1);
    expect(p.logs.indexOf(LINE)).toBeLessThan(p.logs.indexOf(`Job ${id} done.`));
    expect(JSON.parse(fs.readFileSync(path.join(p.home, "status.json"), "utf8")).state).toBe("Finishing its job, then restarting on new code");
  });

  it("installed while it waits for work: it ends at once, with its ComfyUI stopped", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const r = start(w, s, p, { codeWatch: watch(p) });
    const comfy = await until(() => p.logs.includes("Ready") && comfyOf(p));
    installed(p);
    expect(await r.done).toBe("update");
    expect(p.logs).toContain(LINE);
    expect(() => process.kill(comfy.pid, 0)).toThrow();
  });
});

describe("results carry no metadata", () => {
  it("every clip save node goes to its ComfyUI told to write no metadata; the rest of the graph as the studio sent it", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const save = { class_type: "VHS_VideoCombine", inputs: { images: ["1", 0], frame_rate: 8, loop_count: 0, filename_prefix: "fuobe/worker-test", format: "video/h264-mp4", pingpong: false, save_output: true, save_metadata: true } };
    const { id, input } = addTask({ save });
    start(w, s, p);
    const t = await ended(id);
    expect(t.state).toBe("done");
    const graphs = fs.readFileSync(p.graphFile, "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l));
    expect(graphs).toHaveLength(1);
    expect(graphs[0]).toEqual({
      "1": { class_type: "LoadImage", inputs: { image: input } },
      "3": { class_type: "KSampler", inputs: { seed: 1, steps: 4 } },
      "9": { ...save, inputs: { ...save.inputs, save_metadata: false } },
    });
  });
});

describe("clips and sound", () => {
  const clip = (dirName: string) => {
    const out = path.join(tempDir(dirName), "clip.mp4");
    const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=64x48:rate=10:duration=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-metadata", "title=private-note", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out]);
    if (r.status !== 0) throw new Error(String(r.stderr));
    return fs.readFileSync(out);
  };

  it.runIf(hasFfmpeg)("a clip is made again by ffmpeg before its ComfyUI sees it", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const original = clip("fuobe-worker-clip-");
    expect(original.includes("private-note")).toBe(true);
    const { id, input } = addTask({ clip: original });
    start(w, s, p, { ffmpeg: "ffmpeg" });
    await until(() => s.inventories.length > 0);
    expect(s.inventories[0].media).toEqual(["image", "video", "audio"]);
    const t = await ended(id);
    expect(t.state).toBe("done");
    const comfy = comfyOf(p)!;
    const sent = Buffer.from(await (await realFetch(`http://127.0.0.1:${comfy.port}/__fake/input?name=${input}`)).arrayBuffer());
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.equals(original)).toBe(false);
    expect(sent.subarray(4, 8).toString("latin1")).toBe("ftyp");
    expect(sent.includes("private-note")).toBe(false);
    // Its copies of people's files went with the job (the worker clears them just after its last report).
    expect(await until(() => !fs.existsSync(path.join(p.workDir, "cache")), 10_000)).toBe(true);
  });

  it("without ffmpeg it takes pictures only, and gives a job with a clip back to the line", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const { id } = addTask({ clip: Buffer.concat([Buffer.from("000000186674797069736f6d0000020069736f6d69736f32", "hex"), Buffer.alloc(64, 1)]) });
    start(w, s, p, { ffmpeg: null });
    const back = await until(() => s.reports.find((r) => r.body.event === "give-back"));
    expect(back.body).toEqual({ event: "give-back", why: "media" });
    expect(s.inventories[0].media).toEqual(["image"]);
    expect(prompts(p)).toBe(0);
    await until(() => state(id).requeues >= 1 && state(id));
  });
});

describe("its model folders", () => {
  it("a model file that turns up after the start is reported within one look", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const models = tempDir("fuobe-worker-models-");
    const sha = crypto.createHash("sha256").update("hello").digest("hex");
    const requirements = { folders: ["loras"], files: { late: { folder: "loras", file: "late.safetensors", sizeBytes: 5 } }, packs: {}, workflows: {} };
    start(w, s, p, { modelDirs: [models], requirements, pins: { "loras/late.safetensors": sha }, rescanMs: 1_000 });
    await until(() => s.inventories.length > 0);
    expect(s.inventories[0].files).toEqual([]);
    fs.mkdirSync(path.join(models, "loras"));
    fs.writeFileSync(path.join(models, "loras", "late.safetensors"), "hello");
    const seen = await until(() => s.inventories.find((i) => (i.files as unknown[]).length > 0), 60_000);
    expect(seen.files).toEqual([{ folder: "loras", name: "late.safetensors", size: 5, sha256: sha }]);
  });

  it("a model folder that isn't there yet: it waits for it with its lanes kept, then takes the waiting job within one look", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const drive = path.join(tempDir("fuobe-worker-drive-"), "models");
    const { id } = addTask();
    start(w, s, p, { modelDirs: [drive], modelsCheckMs: 300 });
    const workerRow = () => db().prepare("SELECT paused_local, local_why, state FROM relay_workers WHERE id = ?").get(w.id) as { paused_local: number; local_why: string | null; state: string };
    await until(() => workerRow().local_why === "models-not-ready");
    expect(workerRow()).toMatchObject({ paused_local: 1, state: "models-not-ready" });
    expect(p.logs.some((l) => /A model folder isn't there yet/.test(l))).toBe(true);
    // A few beats later: still waiting, its job still in line, and no list of files that lacks the folder's.
    await sleep(1_500);
    expect(state(id).state).toBe("waiting");
    expect(s.inventories).toEqual([]);
    expect(prompts(p)).toBe(0);
    // The drive is unlocked: within one look its files are read again, and the job runs.
    fs.mkdirSync(drive, { recursive: true });
    const done = await ended(id);
    expect(done.state).toBe("done");
    expect(s.inventories.length).toBeGreaterThan(0);
    expect(p.logs.some((l) => /model folders are all there/.test(l))).toBe(true);
  });

  it("its PC sleeps mid-run and the studio takes the job back: no attempt counted, and the output arrives once", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const beats: Record<string, unknown>[] = [];
    s.intercept = (q, init) => {
      if (q === "/api/gpu/computer/beat") beats.push(JSON.parse(String(init.body)));
      return undefined;
    };
    // The worker's clock: the PC's. A sleep moves it on by 5 minutes at the end of one of the worker's one-second waits.
    let offset = 0;
    let sleepNext = 0;
    const { id } = addTask();
    start(w, s, p, {
      steps: 40,
      stepMs: 100,
      now: () => Date.now() + offset,
      sleep: async (ms) => {
        await sleep(Math.min(ms, 50));
        if (ms === 1000 && sleepNext) {
          offset += sleepNext;
          sleepNext = 0;
        }
      },
    });
    await until(async () => {
      const c = comfyOf(p);
      return c && ((await fakeStats(c.port).catch(() => null))?.step ?? 0) >= 2;
    });
    // The PC sleeps: the studio hears nothing for 3 minutes and takes the job back, blamed on the worker.
    db().prepare("UPDATE relay_workers SET seen_at = ? WHERE id = ?").run(Date.now() - 3 * 60_000, w.id);
    pool.sweepPool(Date.now());
    expect(state(id)).toMatchObject({ state: "waiting", requeues: 1 });
    // It wakes: its loop sees the time jump, and its next beat says how long it slept.
    await until(async () => {
      if (p.logs.some((l) => /The PC slept for about 5 min/.test(l))) return true;
      if (!sleepNext) sleepNext = 5 * 60_000;
      await sleep(300);
      return false;
    }, 30_000);
    await until(() => beats.some((b) => typeof b.slept === "number" && (b.slept as number) >= 5 * 60_000));
    const done = await ended(id);
    expect(done.state).toBe("done");
    // The attempt lost to the sleep was taken back: no blame on the worker.
    expect(done.requeues).toBe(0);
    expect(done.tried_json).toBeNull();
    // Once heard, the sleep isn't said again.
    const last = beats.at(-1)!;
    expect(last.slept).toBeUndefined();
  });

  it("a token with a lifetime: it saves the next one in worker.json, uses it, and the old one stops", async () => {
    process.env.FUOBE_WORKER_TOKEN_DAYS = "2";
    try {
      const w = addWorker();
      const s = studio();
      const p = pc();
      // Half its life is gone: its next beat answer gives it the next token.
      db().prepare("UPDATE relay_workers SET expires_at = ? WHERE id = ?").run(Date.now() + 60 * 60_000, w.id);
      start(w, s, p);
      const saved = await until(() => {
        try {
          const t = (JSON.parse(fs.readFileSync(path.join(p.home, "worker.json"), "utf8")) as { token?: string }).token;
          return t && t !== w.token ? t : null;
        } catch {
          return null;
        }
      });
      expect(s.tokens).toContain(saved);
      // It uses the new one: the studio switches to it, and the old one no longer works.
      const hash = crypto.createHash("sha256").update(saved).digest("hex");
      await until(() => (db().prepare("SELECT token_hash FROM relay_workers WHERE id = ?").get(w.id) as { token_hash: string }).token_hash === hash);
      const workersModule = await import("@/server/computer/workers");
      expect(workersModule.workerFromAuth("Bearer " + w.token)).toBeNull();
      expect(workersModule.workerFromAuth("Bearer " + saved)?.id).toBe(w.id);
      // And it goes on working with it.
      const { id } = addTask();
      expect((await ended(id)).state).toBe("done");
      expect(p.logs.some((l) => /Saved its next token/.test(l))).toBe(true);
    } finally {
      delete process.env.FUOBE_WORKER_TOKEN_DAYS;
    }
  });

  it("a token from FUOBE_WORKER_TOKEN: it never takes a next one or writes a token to a file, and says when its token ends", async () => {
    process.env.FUOBE_WORKER_TOKEN_DAYS = "2";
    try {
      const w = addWorker();
      const s = studio();
      const p = pc();
      const beats: Record<string, unknown>[] = [];
      s.intercept = (q, init) => {
        if (q === "/api/gpu/computer/beat") beats.push(JSON.parse(String(init.body)));
        return undefined;
      };
      // Half its life is gone: a worker that saves tokens would be given the next one now.
      const ends = Date.now() + 60 * 60_000;
      db().prepare("UPDATE relay_workers SET expires_at = ? WHERE id = ?").run(ends, w.id);
      start(w, s, p, { env: { FUOBE_WORKER_TOKEN: w.token } });
      const { id } = addTask();
      expect((await ended(id)).state).toBe("done");
      await until(() => beats.length >= 3);
      // It never says it saves tokens, so the studio offers none, and its token stays the one it has.
      expect(beats.every((b) => b.canRotateToken === false)).toBe(true);
      expect(s.tokens).toEqual([]);
      expect(fs.existsSync(path.join(p.home, "worker.json"))).toBe(false);
      const row = db().prepare("SELECT token_hash, next_token_hash FROM relay_workers WHERE id = ?").get(w.id) as { token_hash: string; next_token_hash: string | null };
      expect(row.token_hash).toBe(crypto.createHash("sha256").update(w.token).digest("hex"));
      expect(row.next_token_hash).toBeNull();
      // It says when its token ends, once, so it is replaced in the environment in time.
      const said = await until(() => {
        const lines = p.logs.filter((l) => /FUOBE_WORKER_TOKEN/.test(l));
        return lines.length ? lines : null;
      });
      expect(said).toHaveLength(1);
      expect(said[0]).toContain(new Date(ends).toISOString().slice(0, 10));
    } finally {
      delete process.env.FUOBE_WORKER_TOKEN_DAYS;
    }
  });
});

describe("what its ComfyUI loaded", () => {
  it("a pack whose folder is there but whose nodes didn't load is said, with its classes, and kept for the next start", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    for (const f of ["PackGood", "PackBroken"]) fs.mkdirSync(path.join(p.comfyDir, "custom_nodes", f), { recursive: true });
    const requirements = {
      folders: [],
      files: {},
      packs: { PackGood: { repo: "https://github.com/example/PackGood", classes: ["GoodNode"] }, PackBroken: { repo: "https://github.com/example/PackBroken", classes: ["BrokenA", "BrokenB"] } },
      workflows: {},
    };
    // Its ComfyUI lists the good pack's node and the core ones, none of the broken pack's (its import failed).
    const has = path.join(p.home, "has.json");
    fs.writeFileSync(has, JSON.stringify({ folders: [], files: {}, workflows: { x: { core: ["KSampler", "SaveImage"], packs: { PackGood: ["GoodNode"] } } } }));
    const command = [process.execPath, "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", FAKE, "--port", "{port}", "--cors", "off", "--worker-guard", "1", "--has", has];
    const packsOf = (i: Record<string, unknown>) => i.nodePacks as { name: string; commit: string | null; missingClasses?: string[] }[];
    const first = start(w, s, p, { requirements, command });
    const sent = await until(() => s.inventories.find((i) => packsOf(i).some((n) => n.missingClasses)));
    expect(packsOf(sent).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "PackBroken", commit: null, missingClasses: ["BrokenA", "BrokenB"] },
      { name: "PackGood", commit: null, missingClasses: [] },
    ]);
    expect(p.logs.some((l) => /The node pack PackBroken didn't load in its ComfyUI \(BrokenA, BrokenB; see comfyui\.log\)/.test(l))).toBe(true);
    expect(p.logs.some((l) => /PackGood/.test(l))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(p.workDir, "loaded-packs.json"), "utf8"))).toEqual({ PackGood: { commit: null, missing: [] }, PackBroken: { commit: null, missing: ["BrokenA", "BrokenB"] } });
    first.ctrl.abort();
    await first.done;
    // The next start says it from its first list, before its ComfyUI answers again.
    const before = s.inventories.length;
    start(w, s, p, { requirements, command });
    const again = await until(() => s.inventories[before]);
    expect(packsOf(again).find((n) => n.name === "PackBroken")?.missingClasses).toEqual(["BrokenA", "BrokenB"]);
  });
});
