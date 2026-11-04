/**
 * The shared runner (src/lib/computer-runner.ts) with a worker's hooks, against the studio's real routes and a stand-in
 * ComfyUI on this computer: results kept on disk until the studio has them (a stop before the upload never runs a job
 * twice), a job that stalls or runs past its run limit given back to the line, one retry after running out of memory,
 * a job its ComfyUI stopped on twice failed in plain words, inputs read from the studio once, and a job the worker can't
 * take given back. A browser tab's runner (no hooks) reports exactly as before.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HeldResults, WorkerHooks } from "@/lib/computer-runner";
import type { ClaimedTask, TaskInput } from "@/lib/relay";
import { Hold } from "../bin/lib/worker/hold.mjs";
import { FAKE_PNG, startLocalComfy, type LocalComfy } from "./helpers/fake-local-comfy";
import { apiAs, loadRoutes, sha256, SITE, type ComputerRoutes } from "./helpers/computer-tab";
import { tempDir } from "./helpers/temp-dir";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 60_000 });

const dir = tempDir("fuobe-worker-runner-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
delete process.env.FUOBE_PASSWORD;
globalThis.__fuobeTestDiskFree = 1e13;

const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const tasks = await import("@/server/computer/tasks");
const pool = await import("@/server/computer/pool");
const workers = await import("@/server/computer/workers");
const { ComputerRunner } = await import("@/lib/computer-runner");
const { tabFailureWords } = await import("@/lib/relay");

let fake: LocalComfy;
let routes: ComputerRoutes;
const realFetch = globalThis.fetch;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

beforeAll(async () => {
  fake = await startLocalComfy({ cors: "off", steps: 4, stepMs: 20, latencyMs: 10 });
  routes = await loadRoutes();
  setSetting("comfyWhere", "workers");
});
afterAll(async () => {
  globalThis.__fuobeTestDiskFree = undefined;
  await fake.close();
});
beforeEach(() => {
  resetRates();
  fake.restart({ failNext: undefined, loseNext: 0, steps: 4, stepMs: 20, outputs: ["image"] });
  db().prepare("DELETE FROM relay_workers").run();
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
});

type W = { id: string; token: string };
const row = (w: W) => workers.getWorker(w.id)!;
const state = (id: string) => db().prepare("SELECT * FROM relay_tasks WHERE id = ?").get(id) as import("@/server/computer/tasks").TaskRow;

function worker(): W {
  const w = pool.addWorker(`w-${Math.random().toString(36).slice(2, 8)}`);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: { small: { delayMs: 0 } } });
  db().prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ? WHERE id = ?").run(JSON.stringify({ lanes: ["small"], workflows: ["wf-test"] }), JSON.stringify({ vramBytes: 24 * 2 ** 30 }), w.id);
  beat(w);
  return w;
}

function beat(w: W) {
  pool.workerBeat(row(w), pool.cleanBeat({ device: `wkr-${w.id}`, protocol: 2, version: "1.0.0", local: { paused: false, why: null, until: null }, gpu: {}, inventoryHash: null, running: [], stopped: [] }));
}

let gens = 0;
/** A job for the workers: a picture it loads, a sampler, and a picture it saves. */
function task(): string {
  const gid = `runner-gen-${++gens}`;
  const now = Date.now();
  db()
    .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'queued', '{}', '[]', ?, ?)")
    .run(gid, now, now);
  const input = tasks.stageInput("owner", FAKE_PNG, "image/png", "in.png");
  const t = tasks.createTask({
    principal: "owner",
    generationId: gid,
    graph: {
      "1": { class_type: "LoadImage", inputs: { image: input } },
      "3": { class_type: "KSampler", inputs: { seed: 1, steps: 4 } },
      "9": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "fuobe/worker-test" } },
    },
    pool: { pools: ["pool"], rankAt: now, lane: "small", needs: { workflowId: "wf-test", files: [], packs: [], minVramBytes: 0 } },
  });
  return t.id;
}

/** The studio's routes as a worker calls them, every report written down, with a hook to answer a call itself. */
function studio(w: W) {
  const api = apiAs(routes, null, { authorization: `Bearer ${w.token}` });
  const reports: Record<string, unknown>[] = [];
  const reads: string[] = [];
  let intercept: ((p: string, init: RequestInit) => Promise<Response | undefined> | Response | undefined) | null = null;
  const call = async (p: string, init: RequestInit = {}) => {
    const mine = await intercept?.(p, init);
    if (mine) return mine;
    if (p.endsWith("/report")) reports.push(JSON.parse(String(init.body)));
    if (p.includes("/inputs/")) reads.push(p);
    return api(p, init);
  };
  return { call, reports, reads, set: (fn: typeof intercept) => (intercept = fn) };
}

const hooks = (o: Partial<WorkerHooks> = {}): WorkerHooks => ({
  hold: new Hold(tempDir("fuobe-worker-hold-")) as unknown as WorkerHooks["hold"],
  input: (_t: ClaimedTask, _i: TaskInput, read: () => Promise<ArrayBuffer | string>) => read() as never,
  stallMs: 60_000,
  free: async () => {},
  crashes: () => 0,
  stuck: async () => {},
  claimed: () => {},
  ...o,
});

function runner(s: ReturnType<typeof studio>, worker?: WorkerHooks, now?: () => number) {
  return new ComputerRunner(
    { api: s.call, local: (url, init) => realFetch(url, init), socket: (url) => new WebSocket(url) as never, sha256, origin: SITE, sleep: (ms) => sleep(Math.min(ms, 30)), ...(worker && { worker }), ...(now && { now }) },
    { device: "worker", port: fake.port, clientId: "client-worker-01" },
  );
}

/** A clock on which each real millisecond is `x` of the runner's (600: a real second is ten minutes). */
function fastClock(x: number) {
  const start = Date.now();
  return () => start + (Date.now() - start) * x;
}

/** Claim the next job as a worker's runner does, and run it (or `edit` it first). */
async function claimAndRun(r: InstanceType<typeof ComputerRunner>, s: ReturnType<typeof studio>, edit?: (t: ClaimedTask) => ClaimedTask) {
  if (!edit) return r.claimAndRun();
  const res = await s.call("/api/gpu/computer/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device: "worker", running: [] }) });
  const { task: t } = (await res.json()) as { task: ClaimedTask };
  await r.run(edit(t));
}

const saved = (id: string) => fs.readFileSync(tasks.outputFile(id, 0));

describe("a worker's runner", () => {
  it("runs a job to the end and reports its ComfyUI's execution time and its GPU's name", async () => {
    const w = worker();
    const id = task();
    const s = studio(w);
    await runner(s, hooks()).claimAndRun();
    expect(state(id).state).toBe("done");
    expect(saved(id).equals(FAKE_PNG)).toBe(true);
    const finished = s.reports.find((x) => x.event === "finished")!;
    expect(finished.execMs).toBeTypeOf("number");
    expect(finished.device).toMatch(/\S/);
    expect(String(finished.device)).not.toMatch(/^cuda:|cudaMallocAsync/);
    expect(tasks.execOf(state(id))).toEqual({ ms: finished.execMs, device: finished.device });
  });

  it("a browser tab's runner (no worker hooks) reports as it always did", async () => {
    const w = worker();
    const id = task();
    const s = studio(w);
    await runner(s).claimAndRun();
    expect(state(id).state).toBe("done");
    const finished = s.reports.find((x) => x.event === "finished")!;
    expect(Object.keys(finished).sort()).toEqual(["entry", "event"]);
  });

  it("out of memory: frees its ComfyUI's memory and sends the job once more, and the studio never hears of the first try", async () => {
    const w = worker();
    const id = task();
    const s = studio(w);
    let freed = 0;
    const before = fake.posts();
    fake.opts.failNext = "oom";
    await runner(s, hooks({ free: async () => void freed++ })).claimAndRun();
    expect(state(id).state).toBe("done");
    expect(fake.posts() - before).toBe(2);
    expect(freed).toBe(1);
    expect(s.reports.filter((x) => x.event === "finished")).toHaveLength(1);
    expect(s.reports.some((x) => x.event === "failed")).toBe(false);
    // A second time it ran out: the run fails, as ComfyUI said.
    const id2 = task();
    fake.opts.failNext = "oom";
    const r2 = runner(s, hooks({ free: async () => void (fake.opts.failNext = "oom") }));
    await r2.claimAndRun();
    expect(state(id2).state).toBe("failed");
  });

  it("a job that stalls goes back to the line within the stall limit, with its prompt taken off ComfyUI", async () => {
    const w = worker();
    const id = task();
    const s = studio(w);
    fake.opts.failNext = "never";
    const t0 = Date.now();
    // The PC's own stall limit (600 ms here) wins over the claim's.
    await runner(s, hooks({ stallLocalMs: 600 })).claimAndRun();
    const took = Date.now() - t0;
    expect(state(id)).toMatchObject({ state: "waiting", requeues: 1, worker_id: null });
    expect(s.reports.at(-1)).toEqual({ event: "give-back", why: "stalled" });
    expect(took).toBeLessThan(600 + 5_000);
    const q = (await (await realFetch(`${fake.url}/queue`)).json()) as { queue_running: unknown[]; queue_pending: unknown[] };
    expect([...q.queue_running, ...q.queue_pending]).toEqual([]);
    // Back in line, it runs to the end the next time.
    beat(w);
    await runner(s, hooks()).claimAndRun();
    expect(state(id).state).toBe("done");
  });

  it("the stall limit comes with the claim (the studio's), over the worker's own default", async () => {
    const w = worker();
    const id = task();
    const s = studio(w);
    fake.opts.failNext = "never";
    let given: number | undefined;
    // The worker's default is an hour; the claim's limit is the one obeyed (2 minutes here: a real 200 ms on this clock).
    await claimAndRun(runner(s, hooks({ stallMs: 60 * 60_000 }), fastClock(600)), s, (t) => ((given = t.stallMs), { ...t, stallMs: 2 * 60_000 }));
    expect(given).toBe(pool.STALL_MS);
    expect(state(id)).toMatchObject({ state: "waiting", requeues: 1 });
    expect(s.reports.at(-1)).toEqual({ event: "give-back", why: "stalled" });
  });

  it("a job past its run limit goes back to the line", async () => {
    const w = worker();
    const id = task();
    const s = studio(w);
    // About 20 minutes of running on the runner's clock, with an 11-minute limit.
    fake.opts.steps = 40;
    fake.opts.stepMs = 50;
    await claimAndRun(runner(s, hooks({ stallLocalMs: 60 * 60_000 }), fastClock(600)), s, (t) => ({ ...t, runLimitMs: 11 * 60_000 }));
    expect(state(id)).toMatchObject({ state: "waiting", requeues: 1 });
    expect(s.reports.at(-1)).toEqual({ event: "give-back", why: "run-limit" });
  });

  it("a worker with no times for the lane runs a 20-minute first job to the end (the claim's limit is the run ceiling)", async () => {
    const w = worker();
    const id = task();
    const s = studio(w);
    // About 20 minutes on the runner's clock (a cold model load and a long render), with the limit the studio gives.
    fake.opts.steps = 40;
    fake.opts.stepMs = 50;
    let limit: number | undefined;
    const clock = fastClock(600);
    const t0 = clock();
    await claimAndRun(runner(s, hooks({ stallLocalMs: 60 * 60_000 }), clock), s, (t) => ((limit = t.runLimitMs), t));
    expect(clock() - t0).toBeGreaterThan(19 * 60_000);
    expect(limit).toBe(pool.RUN_CEILING_MS);
    expect(state(id).state).toBe("done");
    expect(s.reports.some((x) => x.event === "give-back")).toBe(false);
  });

  it("an older studio's 5-minute limit for a lane with no times isn't obeyed: the job runs to the end", async () => {
    const w = worker();
    const id = task();
    const s = studio(w);
    fake.opts.steps = 40;
    fake.opts.stepMs = 15;
    await claimAndRun(runner(s, hooks({ stallLocalMs: 60 * 60_000 }), fastClock(600)), s, (t) => ({ ...t, runLimitMs: 5 * 60_000 }));
    expect(state(id).state).toBe("done");
    expect(s.reports.some((x) => x.event === "give-back")).toBe(false);
  });

  it("the run limit counts from when its ComfyUI starts the job, not while the job waits in ComfyUI's queue", async () => {
    const w = worker();
    const id = task();
    const s = studio(w);
    // Another prompt holds its ComfyUI for about 10 minutes first; the job itself then runs about 3, under an 11-minute limit.
    fake.opts.steps = 20;
    fake.opts.stepMs = 15;
    fake.foreign(1_000);
    await claimAndRun(runner(s, hooks({ stallLocalMs: 60 * 60_000 }), fastClock(600)), s, (t) => ({ ...t, runLimitMs: 11 * 60_000 }));
    expect(state(id).state).toBe("done");
    expect(s.reports.some((x) => x.event === "give-back")).toBe(false);
  });

  it("after running out of memory, only the retry's own time is reported", async () => {
    const w = worker();
    const id = task();
    const s = studio(w);
    fake.opts.failNext = "oom";
    // The first try (which runs out of memory) takes as long as the retry would; only the retry's time counts.
    fake.opts.steps = 10;
    fake.opts.stepMs = 30;
    await runner(s, hooks()).claimAndRun();
    expect(state(id).state).toBe("done");
    const finished = s.reports.find((x) => x.event === "finished")!;
    const entry = finished.entry as { status?: { messages?: [string, { timestamp?: number }][] } };
    const stamps = (entry.status?.messages ?? []).map(([, d]) => d.timestamp).filter((x): x is number => typeof x === "number");
    expect(finished.execMs).toBe(Math.max(...stamps) - Math.min(...stamps));
  });

  it("a job its ComfyUI stopped on twice fails in plain words; the worker goes on", async () => {
    const w = worker();
    const id = task();
    const s = studio(w);
    fake.opts.steps = 20;
    fake.opts.stepMs = 40;
    const r = runner(s, hooks({ crashes: () => 2 }));
    const run = r.claimAndRun();
    // ComfyUI restarts mid-job (it loses its queue and history).
    for (let i = 0; i < 100 && !fake.log.some((l) => l.path === "/prompt"); i++) await sleep(20);
    await sleep(200);
    fake.restart();
    await run;
    expect(state(id)).toMatchObject({ state: "failed", error: "tab:input-crashed" });
    expect(tabFailureWords("input-crashed")).not.toMatch(/ComfyUI|GPU|worker/i);
    // The next job runs.
    const id2 = task();
    fake.opts.steps = 4;
    fake.opts.stepMs = 20;
    await runner(s, hooks()).claimAndRun();
    expect(state(id2).state).toBe("done");
  });

  it("reads each input from the studio once a job, even when the job is sent again", async () => {
    const w = worker();
    const id = task();
    const s = studio(w);
    const cache = new Map<string, ArrayBuffer>();
    let reads = 0;
    fake.opts.loseNext = 1;
    const input: WorkerHooks["input"] = async (_t, i, read) => {
      const kept = cache.get(i.sha256);
      if (kept) return kept;
      reads++;
      const got = await read();
      if (typeof got !== "string") cache.set(i.sha256, got);
      return got;
    };
    await runner(s, hooks({ input })).claimAndRun();
    expect(state(id).state).toBe("done");
    expect(s.reports.some((x) => x.event === "gone")).toBe(true);
    expect(reads).toBe(1);
    expect(s.reads).toHaveLength(1);
  });

  it("a studio that won't send an input again (429) fails the job instead of looping", async () => {
    const w = worker();
    const id = task();
    const s = studio(w);
    s.set((p) => (p.includes("/inputs/") ? Response.json({ error: "That file was sent enough times." }, { status: 429 }) : undefined));
    await runner(s, hooks()).claimAndRun();
    expect(state(id)).toMatchObject({ state: "failed", error: "tab:input-changed" });
  });

  it("an input it can't take (a clip, with no way to make it again) gives the job back", async () => {
    const w = worker();
    const id = task();
    const s = studio(w);
    await runner(s, hooks({ input: async () => "give-back" })).claimAndRun();
    expect(state(id)).toMatchObject({ state: "waiting", requeues: 1 });
    expect(s.reports.at(-1)).toEqual({ event: "give-back", why: "media" });
  });
});

describe("results kept until the studio has them", () => {
  it("a stop before the upload: the next start uploads the kept results, and ComfyUI got exactly one prompt", async () => {
    const w = worker();
    const id = task();
    const s = studio(w);
    const holdDir = tempDir("fuobe-worker-hold-");
    const before = fake.posts();
    // The worker stops as it starts the upload.
    const first = runner(s, hooks({ hold: new Hold(holdDir) as never }));
    s.set((p, init) => {
      if (!p.includes("/outputs/") || init.method !== "PUT") return undefined;
      first.stop();
      throw new TypeError("fetch failed");
    });
    await first.claimAndRun();
    expect(state(id).state).toBe("collecting");
    expect(new Hold(holdDir).ids()).toEqual([id]);
    // Its ComfyUI starts again (no history, no files), and so does the worker.
    fake.restart();
    s.set(null);
    let claimed: string | null | undefined;
    await runner(s, hooks({ hold: new Hold(holdDir) as never, claimed: (t) => void (claimed = t?.id ?? null) })).claimAndRun();
    expect(claimed).toBe(id);
    expect(state(id).state).toBe("done");
    expect(saved(id).equals(FAKE_PNG)).toBe(true);
    expect(fake.posts() - before).toBe(1);
  });

  it("a stop before the studio heard it finished: the kept results are reported and uploaded, never run again", async () => {
    const w = worker();
    const id = task();
    const s = studio(w);
    const holdDir = tempDir("fuobe-worker-hold-");
    const before = fake.posts();
    s.set((p, init) => {
      if (p.endsWith("/report") && JSON.parse(String(init.body)).event === "finished") throw new TypeError("fetch failed");
      return undefined;
    });
    await expect(runner(s, hooks({ hold: new Hold(holdDir) as never })).claimAndRun()).rejects.toThrow();
    expect(state(id).state).toBe("running");
    fake.restart();
    s.set(null);
    await runner(s, hooks({ hold: new Hold(holdDir) as never })).claimAndRun();
    expect(state(id).state).toBe("done");
    expect(saved(id).equals(FAKE_PNG)).toBe(true);
    expect(fake.posts() - before).toBe(1);
    const held = s.reports.filter((x) => x.event === "finished");
    expect(held).toHaveLength(1);
    expect(held[0].execMs).toBeTypeOf("number");
  });

  it("kept results go up without its ComfyUI; any other job claimed meanwhile goes straight back to the line", async () => {
    const w = worker();
    const s = studio(w);
    const holdDir = tempDir("fuobe-worker-hold-");
    // Nothing kept: a claim for kept results only lets a fresh job go at once.
    const id = task();
    let seen: (string | null)[] = [];
    const r = runner(s, hooks({ hold: new Hold(holdDir) as never, claimed: (t) => void seen.push(t?.id ?? null) }));
    expect(await r.claimAndRun({ onlyHeld: true })).toBe(false);
    expect(seen).toEqual([id]);
    expect(state(id)).toMatchObject({ state: "waiting", worker_id: null, device: null, requeues: 0 });
    // No job at all: the claim says so (null).
    db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE id = ?").run(id);
    seen = [];
    expect(await r.claimAndRun({ onlyHeld: true })).toBe(false);
    expect(seen).toEqual([null]);
  });

  it("keeps every file its entries name, under no path but its own, and nothing that looks whole when a copy fails", async () => {
    const holdDir = tempDir("fuobe-worker-hold-");
    const hold = new Hold(holdDir);
    const t = { id: "BBBBBBBBBBBBBBBB", promptId: "00000000-0000-4000-8000-000000000001" } as ClaimedTask;
    const entry = {
      prompt: [1, t.promptId, { secret: "someone's prompt" }],
      status: { status_str: "success", completed: true },
      outputs: {
        "9": {
          images: [
            { filename: "a_00001_.png", subfolder: "fuobe", type: "output" },
            { filename: "../escape.png", subfolder: "", type: "output" },
            { filename: "b.png", subfolder: "../..", type: "output" },
            { filename: "c.png", subfolder: "", type: "input" },
          ],
        },
      },
    };
    const asked: string[] = [];
    await hold.keep(t, { kind: "finished", entries: [entry] } as HeldResults, async (f: { filename: string; subfolder: string; type: string }) => {
      asked.push(`${f.type}/${f.subfolder}/${f.filename}`);
      return new Response(FAKE_PNG);
    });
    expect(asked).toEqual(["output/fuobe/a_00001_.png"]);
    const got = await hold.get(t);
    expect(got?.entries[0].prompt).toEqual([1, t.promptId]);
    const blob = await hold.file(t, { filename: "a_00001_.png", subfolder: "fuobe", type: "output" });
    expect(Buffer.from(await blob!.arrayBuffer()).equals(FAKE_PNG)).toBe(true);
    // Another prompt for the same task (sent again from the start): not these results.
    expect(await hold.get({ ...t, promptId: "00000000-0000-4000-8000-000000000002" })).toBeNull();
    // A copy that fails halfway keeps nothing.
    await expect(hold.keep(t, { kind: "finished", entries: [entry] } as HeldResults, async () => null)).rejects.toThrow();
    expect(hold.has(t.id)).toBe(false);
    expect(fs.readdirSync(holdDir)).toEqual([]);
    expect(() => hold.folder("../x")).toThrow();
    expect(path.basename(hold.folder(t.id))).toBe(t.id);
  });

  it("lets go of kept results the studio never took after a day, and of a half-made copy that old", async () => {
    const holdDir = tempDir("fuobe-worker-hold-");
    const hold = new Hold(holdDir);
    const t = { id: "CCCCCCCCCCCCCCCC", promptId: "00000000-0000-4000-8000-000000000003" } as ClaimedTask;
    await hold.keep(t, { kind: "finished", entries: [{ status: { status_str: "success", completed: true }, outputs: {} }] } as HeldResults, async () => new Response(FAKE_PNG));
    fs.mkdirSync(path.join(holdDir, "DDDDDDDDDDDDDDDD"));
    const day = 24 * 3_600_000;
    expect(hold.expire(Date.now(), day)).toEqual([]);
    expect(hold.ids()).toEqual([t.id]);
    expect(hold.expire(Date.now() + day + 60_000, day).sort()).toEqual(["CCCCCCCCCCCCCCCC", "DDDDDDDDDDDDDDDD"]);
    expect(fs.readdirSync(holdDir)).toEqual([]);
  });

  it("a claim with nothing for it says so with whether it was for kept results only, and the kept results stay", async () => {
    const w = worker();
    const s = studio(w);
    const holdDir = tempDir("fuobe-worker-hold-");
    const hold = new Hold(holdDir);
    const kept = { id: "EEEEEEEEEEEEEEEE", promptId: "00000000-0000-4000-8000-000000000004" } as ClaimedTask;
    await hold.keep(kept, { kind: "finished", entries: [{ status: { status_str: "success", completed: true }, outputs: {} }] } as HeldResults, async () => new Response(FAKE_PNG));
    const seen: [string | null, boolean][] = [];
    const r = runner(s, hooks({ hold: hold as never, claimed: (t, o) => void seen.push([t?.id ?? null, o.onlyHeld]) }));
    expect(await r.claimAndRun({ onlyHeld: true })).toBe(false);
    expect(seen).toEqual([[null, true]]);
    expect(hold.ids()).toEqual([kept.id]);
  });
});
