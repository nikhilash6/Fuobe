import crypto from "node:crypto";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers/temp-dir";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-workers-pool-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
delete process.env.FUOBE_PASSWORD;

const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const tasks = await import("@/server/computer/tasks");
const pool = await import("@/server/computer/pool");
const workers = await import("@/server/computer/workers");
const { principalOf } = await import("@/server/computer/http");
const beatRoute = await import("@/app/api/gpu/computer/beat/route");
const claimRoute = await import("@/app/api/gpu/computer/claim/route");
const reportRoute = await import("@/app/api/gpu/computer/tasks/[id]/report/route");
const { comfyProvider, forWorkers } = await import("@/server/providers/comfyui");
const { hoursAt, parseHours } = await import("@/lib/worker-hours");
const lanesModule = await import("@/lib/lanes");
const { lanesFor, needsOf, laneOf } = lanesModule;
const { loadIndex } = await import("@/server/gpu/index-file");
const { QUEUE_DEFAULTS, queueSettings, runCeilingMs, saveQueueSettings } = await import("@/server/queue-settings");

const LANE_A = "aaaaaaaaaaaa";
const LANE_B = "bbbbbbbbbbbb";
const GB = 2 ** 30;
const MIN = 60_000;
let clock = Date.UTC(2026, 10, 2, 3, 0, 0); // a Monday, 03:00 UTC

type W = { id: string; token: string };

/** A worker that is ready in every way (paused nowhere, all day, the given lanes and workflows), unless told otherwise. */
function worker(name: string, o: { lanes?: string[]; workflows?: string[]; vram?: number; hours?: unknown; claimAfterMs?: number; pausedServer?: boolean } = {}): W {
  const w = pool.addWorker(name);
  const lanes = o.lanes ?? [LANE_A];
  pool.patchWorker(w.id, { paused: !!o.pausedServer, hours: o.hours === undefined ? { always: true } : o.hours, allow: Object.fromEntries(lanes.map((l) => [l, { delayMs: 0 }])), claimAfterMs: o.claimAfterMs ?? 0 });
  db()
    .prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ? WHERE id = ?")
    .run(JSON.stringify({ lanes, workflows: o.workflows ?? ["wf-a", "wf-b"] }), JSON.stringify({ vramBytes: o.vram ?? 24 * GB }), w.id);
  beat(w);
  return w;
}

const row = (w: W) => workers.getWorker(w.id)!;

function beat(w: W, local: { paused?: boolean; why?: string | null } = {}, running: string[] = []) {
  return pool.workerBeat(
    row(w),
    pool.cleanBeat({ device: `wkr-${w.id}`, protocol: 2, version: "1.0.0", local: { paused: local.paused ?? false, why: local.why ?? null, until: null }, gpu: {}, inventoryHash: null, running: running.map((task) => ({ task })), stopped: [] }),
    clock,
  );
}

const claim = (w: W, running: string[] = []) => pool.workerClaim(row(w), running, clock);

let gens = 0;
function task(o: { lane?: string; workflow?: string; minVram?: number; rankAgoMs?: number; estMs?: number; notAfter?: number; account?: string } = {}) {
  const gid = `gen-${++gens}`;
  db()
    .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'queued', '{}', '[]', ?, ?)")
    .run(gid, clock, clock);
  const created = clock - (o.rankAgoMs ?? 0);
  const t = tasks.createTask({
    principal: "owner",
    generationId: gid,
    graph: { "1": { class_type: "SaveImage", inputs: { filename_prefix: "x" } } },
    pool: { pools: ["pool"], account: o.account, rankAt: created, lane: o.lane ?? LANE_A, needs: { workflowId: o.workflow ?? "wf-a", files: [], packs: [], minVramBytes: o.minVram ?? 0 }, estMs: o.estMs, notAfter: o.notAfter },
  });
  db().prepare("UPDATE relay_tasks SET created_at = ? WHERE id = ?").run(created, t.id);
  return t.id;
}
/** "HH:MM" in UTC, some minutes from the test's clock. */
const at = (minutes: number) => new Date(clock + minutes * MIN).toISOString().slice(11, 16);
const everyDay = (from: string, to: string) => ({ tz: "UTC", days: Object.fromEntries(["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [d, [[from, to]]])) });

const state = (id: string) => db().prepare("SELECT * FROM relay_tasks WHERE id = ?").get(id) as import("@/server/computer/tasks").TaskRow;

beforeAll(() => setSetting("comfyWhere", "workers"));
beforeEach(() => {
  resetRates();
  clock += 60 * MIN;
  db().prepare("DELETE FROM relay_workers").run();
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
});

describe("who may claim (check 1)", () => {
  it("a new worker is paused in both places and claims nothing", () => {
    const w = pool.addWorker("fresh");
    task();
    const a = pool.workerBeat(row({ id: w.id, token: w.token }), pool.cleanBeat({ device: "x", protocol: 2, version: "1", local: { paused: true, why: "here" } }), clock);
    expect(a.runner).toBe(false);
    expect(a.worker.paused).toBe(true);
    expect(pool.workerClaim(row({ id: w.id, token: w.token }), [], clock)).toBeNull();
    expect(pool.workerState(row({ id: w.id, token: w.token }), clock).words).toBe("Paused here");
  });

  it("unpaused in both places and inside its hours it claims; outside them it doesn't", () => {
    const id = task();
    clock -= clock % (60 * MIN); // on the hour, so the windows below don't cross midnight oddly
    const w = worker("on", { hours: everyDay(at(-60), at(120)) });
    expect(claim(w)?.id).toBe(id);
    const id2 = task();
    const night = worker("night", { hours: everyDay(at(180), at(240)) });
    expect(claim(night)).toBeNull();
    expect(pool.workerState(row(night), clock).words).toBe(`Outside its hours (back at ${at(180)})`);
    expect(state(id2).state).toBe("waiting");
  });

  it("an older worker program takes no task, and the owner sees why", () => {
    const id = task();
    const w = worker("older-program");
    const a = pool.workerBeat(
      row(w),
      pool.cleanBeat({ device: `wkr-${w.id}`, protocol: 1, version: "0.9.0", local: { paused: false, why: null, until: null }, gpu: {}, inventoryHash: null, running: [], stopped: [] }),
      clock,
    );
    expect(a.runner).toBe(false);
    expect(a.worker.minProtocol).toBe(2);
    expect(a.claimableNow).toBe(0);
    expect(claim(w)).toBeNull();
    expect(pool.workerState(row(w), clock)).toEqual({ state: "paused", words: "Takes no jobs until its worker program is updated" });
    expect(state(id).state).toBe("waiting");
    beat(w);
    expect(claim(w)?.id).toBe(id);
  });

  it("paused on the website, or here, or draining: no new task", () => {
    task();
    const w = worker("p", { pausedServer: true });
    expect(claim(w)).toBeNull();
    pool.patchWorker(w.id, { paused: false });
    beat(w, { paused: true, why: "here" });
    expect(claim(w)).toBeNull();
    beat(w);
    pool.patchWorker(w.id, { drain: true });
    expect(claim(w)).toBeNull();
    pool.patchWorker(w.id, { paused: false });
    expect(claim(w)).not.toBeNull();
  });
});

describe("matching (check 2)", () => {
  it("a task never goes to a worker that lacks its files or VRAM", () => {
    const id = task({ workflow: "wf-big", minVram: 16 * GB });
    const small = worker("small", { workflows: ["wf-big"], vram: 8 * GB });
    const nofiles = worker("nofiles", { workflows: ["wf-a"], vram: 32 * GB });
    const otherLane = worker("other", { lanes: [LANE_B], workflows: ["wf-big"], vram: 32 * GB });
    expect(claim(small)).toBeNull();
    expect(claim(nofiles)).toBeNull();
    expect(claim(otherLane)).toBeNull();
    const fits = worker("fits", { workflows: ["wf-big"], vram: 24 * GB });
    expect(claim(fits)?.id).toBe(id);
  });

  it("a lane's delay and claim_after_ms hold a task back that long", () => {
    const id = task();
    const late = worker("late", { claimAfterMs: 2 * MIN });
    expect(claim(late)).toBeNull();
    clock += 2 * MIN + 1000;
    beat(late);
    expect(claim(late)?.id).toBe(id);
  });
});

describe("losing a worker (checks 3, 4, 5)", () => {
  it("a silent worker's task goes to another within 3 minutes, and the old one's late calls get 409", () => {
    const id = task();
    const a = worker("a");
    const got = claim(a)!;
    expect(got.id).toBe(id);
    const b = worker("b");
    clock += 2 * MIN + 30_000;
    beat(b);
    const again = claim(b);
    expect(again?.id).toBe(id);
    expect(state(id).worker_id).toBe(b.id);
    expect(JSON.parse(state(id).tried_json!)).toEqual([a.id]);
    expect(() => tasks.leased("pool:pool", id, got.lease)).toThrow(/Another tab/);
  });

  it("a task only A can run: A comes back and runs it; with a capable B about, B does", () => {
    const id = task({ workflow: "wf-only-a" });
    const a = worker("a", { workflows: ["wf-only-a"] });
    claim(a);
    clock += 3 * MIN;
    beat(a);
    expect(claim(a)?.id).toBe(id);
    const id2 = task({ workflow: "wf-only-a" });
    clock += 3 * MIN;
    beat(a);
    const b = worker("b", { workflows: ["wf-only-a"] });
    // A got id (resume) and id2 is fresh: lose id2 on A first.
    db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE id = ?").run(id);
    expect(claim(a)?.id).toBe(id2);
    clock += 3 * MIN;
    beat(a);
    beat(b);
    expect(claim(a)).toBeNull();
    expect(claim(b)?.id).toBe(id2);
  });

  it("a worker whose PC slept: the job taken back from it meanwhile counts no attempt, and it may take the job again", () => {
    const id = task();
    const a = worker("sleeper");
    const b = worker("awake");
    expect(claim(a)?.id).toBe(id);
    // The PC sleeps for 10 minutes: the studio takes the job back after 2 (blamed: the worker went quiet).
    const asleep = clock;
    clock += 3 * MIN;
    beat(b);
    pool.sweepPool(clock);
    expect(state(id)).toMatchObject({ state: "waiting", requeues: 1 });
    expect(JSON.parse(state(id).tried_json!)).toEqual([a.id]);
    clock = asleep + 10 * MIN;
    // It wakes and says how long it slept: the attempt is taken back, and it is off the tried list.
    const woke = pool.workerBeat(row(a), pool.cleanBeat({ device: `wkr-${a.id}`, protocol: 2, version: "1.0.0", local: { paused: false, why: null, until: null }, gpu: {}, inventoryHash: null, running: [], stopped: [], slept: 10 * MIN }), clock);
    expect(woke.runner).toBe(true);
    expect(state(id)).toMatchObject({ state: "waiting", requeues: 0, tried_json: null });
    // So it takes the job again at once, though another worker is about (no retry rule against it).
    beat(b);
    expect(claim(a)?.id).toBe(id);
    expect(claim(a)!.attempt).toBe(1);
  });

  it("a sleep is forgiven once a job, only for a job lost while it slept, and never for another worker's or another loss", () => {
    const a = worker("sleeps-twice");
    const lose = (id: string) => {
      expect(claim(a)?.id).toBe(id);
      clock += 3 * MIN;
      pool.sweepPool(clock);
    };
    const id = task();
    lose(id);
    expect(pool.forgiveSleep(row(a), 5 * MIN, clock)).toEqual([id]);
    beat(a);
    lose(id);
    // A second sleep on the same job: the attempt stands.
    expect(pool.forgiveSleep(row(a), 5 * MIN, clock)).toEqual([]);
    expect(state(id).requeues).toBe(1);
    // A loss well before the reported sleep began is not the sleep's.
    db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE id = ?").run(id);
    const old = task();
    beat(a);
    lose(old);
    clock += 60 * MIN;
    expect(pool.forgiveSleep(row(a), 5 * MIN, clock)).toEqual([]);
    expect(state(old).requeues).toBe(1);
    // Another worker's sleep, or a job given back (not lost to silence): nothing changes.
    db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE id = ?").run(old);
    const other = worker("other");
    const mine = task();
    beat(a);
    lose(mine);
    expect(pool.forgiveSleep(row(other), 5 * MIN, clock)).toEqual([]);
    db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE id = ?").run(mine);
    const given = task();
    beat(a);
    expect(claim(a)?.id).toBe(given);
    pool.backInLine(state(given), { blame: true });
    expect(pool.forgiveSleep(row(a), 5 * MIN, clock)).toEqual([]);
    expect(state(given).requeues).toBe(1);
  });

  it("the third lost attempt fails the row", () => {
    const id = task();
    for (let i = 0; i < 3; i++) {
      const w = worker(`w${i}`);
      expect(claim(w)?.id).toBe(id);
      clock += 3 * MIN;
      pool.sweepPool(clock);
    }
    expect(state(id).state).toBe("failed");
    expect(state(id).requeues).toBe(3);
  });

  it("a revoked worker's task goes back in line, and its token gets 401", () => {
    const id = task();
    const w = worker("gone");
    claim(w);
    pool.patchWorker(w.id, { revoke: true });
    expect(state(id).state).toBe("waiting");
    const r = principalOf(new Request("http://localhost:3000/api/gpu/computer/beat", { method: "POST", headers: { host: "localhost:3000", authorization: `Bearer ${w.token}` } }));
    expect((r as Response).status).toBe(401);
  });

  it("pause now: the job goes back in line at no cost, and the worker hears the stop", () => {
    const id = task();
    const w = worker("now");
    claim(w);
    tasks.setTask(id, { state: "running", sent_at: clock });
    pool.patchWorker(w.id, { pauseNow: true });
    const a = beat(w, {}, [id]);
    expect(a.worker.pauseNow).toBe(true);
    expect(a.stops.map((s) => s.task)).toEqual([id]);
    expect(state(id).state).toBe("waiting");
    expect(state(id).requeues).toBe(0);
    expect(state(id).tried_json).toBeNull();
  });

  it("a pause now leaves a job whose finished results the worker keeps its own, so it sends them instead of running it again", () => {
    const id = task();
    const w = worker("keeps");
    claim(w);
    tasks.setTask(id, { state: "running", sent_at: clock });
    const a = pool.workerBeat(
      row(w),
      pool.cleanBeat({ device: `wkr-${w.id}`, protocol: 2, version: "1.0.0", local: { paused: true, why: "here-now", until: null }, gpu: {}, inventoryHash: null, running: [], stopped: [], held: [id] }),
      clock,
    );
    expect(a.worker.pauseNow).toBe(true);
    expect(a.stops).toEqual([]);
    expect(state(id)).toMatchObject({ state: "running", worker_id: w.id });
    // Paused, it may take no new job, but its own job comes back to it, for the kept results.
    expect(pool.workerClaim(row(w), [], clock)?.id).toBe(id);
    // The same pause with nothing kept: the job goes back in line.
    const id2 = task();
    const w2 = worker("keeps-nothing");
    claim(w2);
    tasks.setTask(id2, { state: "running", sent_at: clock });
    beat(w2, { paused: true, why: "here-now" }, [id2]);
    expect(state(id2).state).toBe("waiting");
  });

  it("a busy GPU on the worker sends its job back the same way", () => {
    const id = task();
    const w = worker("busy");
    claim(w);
    const a = beat(w, { paused: true, why: "gpu-busy:python.exe" }, [id]);
    expect(a.stops.map((s) => s.task)).toEqual([id]);
    expect(state(id).state).toBe("waiting");
    expect(pool.workerState(row(w), clock).words).toBe("Your GPU is busy (python.exe)");
  });

  it("the automatic resume: the PC's own setting until the owner sets it on the website", () => {
    const w = worker("auto");
    expect(beat(w).worker.autoResume).toBeNull();
    expect(pool.patchWorker(w.id, { autoResume: true }).view?.autoResume).toBe(true);
    expect(beat(w).worker.autoResume).toBe(true);
    pool.patchWorker(w.id, { autoResume: false });
    expect(beat(w).worker.autoResume).toBe(false);
    pool.patchWorker(w.id, { autoResume: null });
    expect(beat(w).worker.autoResume).toBeNull();
    expect(() => pool.patchWorker(w.id, { autoResume: "yes" as unknown as boolean })).toThrow();
  });

  it("a task past its wait limit fails, not charged", () => {
    const id = task({ notAfter: clock + MIN });
    clock += 2 * MIN;
    pool.sweepPool(clock);
    expect(state(id).state).toBe("failed");
    expect(state(id).error).toBe("The GPUs were busy. Not charged.");
  });
});

describe("order (checks 8, 9)", () => {
  it("sticky lanes: the warm lane goes first until another lane's best task passes the pick allowance", () => {
    const w = worker("sticky", { lanes: [LANE_A, LANE_B] });
    db().prepare("UPDATE relay_workers SET warm_lane = ?, switch_after_ms = ? WHERE id = ?").run(LANE_A, 30 * MIN, w.id);
    // The install's pick allowance is 0 by default: strict order, whatever the worker's own setting.
    const first = task({ lane: LANE_B, rankAgoMs: 2 * MIN });
    const warm = task({ lane: LANE_A, rankAgoMs: 1 * MIN });
    expect(claim(w)?.id).toBe(first);
    db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE id IN (?, ?)").run(first, warm);
    saveQueueSettings({ ...queueSettings(), pickAllowanceMs: 60 * MIN });
    const b = task({ lane: LANE_B, rankAgoMs: 10 * MIN });
    const a = task({ lane: LANE_A, rankAgoMs: 1 * MIN });
    expect(claim(w)?.id).toBe(a);
    db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE id = ?").run(a);
    const a2 = task({ lane: LANE_A, rankAgoMs: 0 });
    db().prepare("UPDATE relay_tasks SET rank_at = ? WHERE id = ?").run(clock - 31 * MIN, b);
    expect(claim(w)?.id).toBe(b);
    expect(state(a2).state).toBe("waiting");
    saveQueueSettings(QUEUE_DEFAULTS);
  });

  it("near the end of its hours, a task that would overrun is not claimed", () => {
    clock -= clock % (60 * MIN);
    const w = worker("window", { hours: everyDay(at(-120), at(10)) });
    const long = task({ estMs: 20 * MIN });
    expect(claim(w)).toBeNull();
    const short = task({ estMs: 5 * MIN });
    expect(claim(w)?.id).toBe(short);
    expect(state(long).state).toBe("waiting");
  });

  it("tasks in one class go by rank_at, not by arrival", () => {
    const w = worker("rank");
    const later = task({ rankAgoMs: 0 });
    const boosted = task({ rankAgoMs: 24 * 60 * MIN });
    expect(claim(w)?.id).toBe(boosted);
    expect(state(later).state).toBe("waiting");
  });
});

describe("people's runs this worker may take now (the beat's claimableNow)", () => {
  it("counts people's waiting runs it can run here, never the owner's own, and not runs for other lanes, files or VRAM", () => {
    const w = worker("counts", { lanes: [LANE_A], workflows: ["wf-a"], vram: 12 * GB });
    expect(beat(w).claimableNow).toBe(0);
    task(); // the owner's own
    expect(beat(w).claimableNow).toBe(0);
    task({ account: "acct-1" });
    task({ account: "acct-2" });
    task({ account: "acct-3", lane: LANE_B }); // a lane it isn't allowed
    task({ account: "acct-4", workflow: "wf-z" }); // a workflow it can't run
    task({ account: "acct-5", minVram: 20 * GB }); // more VRAM than it has
    expect(beat(w).claimableNow).toBe(2);
    // Its own pause doesn't change the count (its PC reads it to know whether people's runs wait for it).
    expect(beat(w, { paused: true, why: "gpu-busy:ComfyUI on port 8188" }).claimableNow).toBe(2);
    // Paused on the website, draining or outside its hours: none.
    pool.patchWorker(w.id, { paused: true });
    expect(beat(w).claimableNow).toBe(0);
    pool.patchWorker(w.id, { paused: false, drain: true });
    expect(beat(w).claimableNow).toBe(0);
    pool.patchWorker(w.id, { drain: false, hours: everyDay(at(180), at(240)) });
    expect(beat(w).claimableNow).toBe(0);
  });

  it("goes down as it claims them", () => {
    const w = worker("claims");
    task({ account: "acct-1" });
    task({ account: "acct-2" });
    expect(beat(w).claimableNow).toBe(2);
    expect(claim(w)).not.toBeNull();
    expect(beat(w, {}, []).claimableNow).toBe(1);
  });
});

describe("a worker waiting for local ComfyUI work to make room", () => {
  /** A beat that says the worker waits for its turn (not paused), with the helper's estimate of the start. */
  const waits = (w: W, why: string, until: number | null) =>
    pool.workerBeat(row(w), pool.cleanBeat({ device: `wkr-${w.id}`, protocol: 2, version: "1.0.0", local: { paused: false, why, until }, gpu: {}, inventoryHash: null, running: [], stopped: [] }), clock);

  it("says so in its state and the owner's list, never Ready, and its jobs keep their place", () => {
    const w = worker("waits");
    const id = task({ account: "acct-1" });
    const a = waits(w, "waiting-for-yield", clock + 4 * MIN);
    // Not a pause: it may still claim, and nothing goes back in line.
    expect(a.runner).toBe(true);
    expect(a.worker.pauseNow).toBe(false);
    expect(a.claimableNow).toBe(1);
    expect(pool.workerState(row(w), clock)).toMatchObject({ state: "waiting-for-yield", words: expect.stringMatching(/^Waiting for local ComfyUI work to make room \(starts about \d\d:\d\d\)$/) });
    expect(row(w).state).toBe("waiting-for-yield");
    const view = pool.listWorkers(clock).find((x) => x.id === w.id)!;
    expect(view.state).toBe("waiting-for-yield");
    expect(view.words).not.toBe("Ready");
    expect(state(id).state).toBe("waiting");
    // No estimate yet.
    waits(w, "waiting-for-yield", null);
    expect(pool.workerState(row(w), clock).words).toBe("Waiting for local ComfyUI work to make room");
  });

  it("with no answer after 3 minutes, says that, and a job it runs shows first", () => {
    const w = worker("no-answer");
    waits(w, "waiting-for-yield:no-answer", null);
    expect(pool.workerState(row(w), clock)).toEqual({ state: "waiting-for-yield", words: "Waiting for local ComfyUI work to make room (no answer after 3 minutes)" });
    task({ account: "acct-1" });
    expect(claim(w)).not.toBeNull();
    expect(pool.workerState(row(w), clock)).toEqual({ state: "busy", words: "Running a job" });
    // Its turn came: Ready again.
    waits(w, "", null);
    db().prepare("UPDATE relay_tasks SET state = 'done' WHERE worker_id = ?").run(w.id);
    expect(pool.workerState(row(w), clock)).toEqual({ state: "idle", words: "Ready" });
  });
});

describe("a worker whose model folder isn't there yet (a drive still locked after a restart)", () => {
  const inventoryRoute = () => import("@/app/api/gpu/computer/inventory/route");
  const beatWith = (w: W, local: { paused: boolean; why: string | null }, inventoryHash: string | null) =>
    pool.workerBeat(row(w), pool.cleanBeat({ device: `wkr-${w.id}`, protocol: 2, version: "1.0.0", local: { ...local, until: null }, gpu: {}, inventoryHash, running: [], stopped: [] }), clock);

  it("shows its own state, takes nothing, and keeps its lanes: no list of files is asked for or taken meanwhile", async () => {
    const w = worker("models-later", { lanes: [LANE_A] });
    db().prepare("UPDATE relay_workers SET inventory_hash = 'before' WHERE id = ?").run(w.id);
    const id = task({ account: "acct-1" });
    const a = beatWith(w, { paused: true, why: "models-not-ready" }, "a-shorter-list");
    expect(pool.workerState(row(w), clock)).toEqual({ state: "models-not-ready", words: "Waiting for its model folders" });
    expect(pool.listWorkers(clock).find((x) => x.id === w.id)).toMatchObject({ state: "models-not-ready", words: "Waiting for its model folders", lanes: [LANE_A] });
    expect(a.runner).toBe(false);
    expect(a.worker.sendInventory).toBe(false);
    expect(a.worker.pauseNow).toBe(false);
    expect(claim(w)).toBeNull();
    expect(state(id).state).toBe("waiting");
    // A list sent anyway is refused, and the lanes stay as they were.
    const { PUT } = await inventoryRoute();
    const res = await PUT(new Request("http://localhost:3000/api/gpu/computer/inventory", { method: "PUT", headers: { host: "localhost:3000", authorization: `Bearer ${w.token}`, "content-type": "application/json" }, body: JSON.stringify({ files: [], nodePacks: [] }) }));
    expect(res.status).toBe(409);
    expect(JSON.parse(row(w).lanes_json ?? "{}").lanes).toEqual([LANE_A]);
    // The folder is back: the studio asks for the list again, and the run is taken.
    const back = beatWith(w, { paused: false, why: null }, "the-whole-list");
    expect(back.worker.sendInventory).toBe(true);
    expect(pool.workerState(row(w), clock).state).toBe("idle");
    expect(claim(w)?.id).toBe(id);
  });
});

describe("routes", () => {
  it("the beat's answer carries claimableNow", async () => {
    clock = Date.now();
    const w = worker("beat-route");
    task({ account: "acct-route" });
    const res = await beatRoute.POST(new Request("http://localhost:3000/api/gpu/computer/beat", { method: "POST", headers: { host: "localhost:3000", authorization: `Bearer ${w.token}`, "content-type": "application/json" }, body: JSON.stringify({ device: "x", protocol: 2, version: "1", local: { paused: false } }) }));
    expect(((await res.json()) as { claimableNow?: number }).claimableNow).toBe(1);
  });

  it("three workers that beat every 5 seconds are not rate-limited (check 14)", async () => {
    clock = Date.now();
    const ws = [worker("r1"), worker("r2"), worker("r3")];
    let ok = 0;
    for (let i = 0; i < 12; i++) {
      for (const w of ws) {
        const res = await beatRoute.POST(new Request("http://localhost:3000/api/gpu/computer/beat", { method: "POST", headers: { host: "localhost:3000", authorization: `Bearer ${w.token}`, "content-type": "application/json" }, body: JSON.stringify({ device: "x", protocol: 2, version: "1", local: { paused: false } }) }));
        if (res.status === 200) ok++;
      }
    }
    expect(ok).toBe(36);
  });

  it("a worker claims and reports through the same routes as a browser computer", async () => {
    // The routes keep the real clock.
    clock = Date.now();
    const id = task();
    const w = worker("route");
    const headers = { host: "localhost:3000", authorization: `Bearer ${w.token}`, "content-type": "application/json" };
    const c = await claimRoute.POST(new Request("http://localhost:3000/api/gpu/computer/claim", { method: "POST", headers, body: JSON.stringify({ running: [] }) }));
    const { task: t } = await c.json();
    expect(t.id).toBe(id);
    expect(t.lane).toBe(LANE_A);
    // No times for the lane on this worker yet: the lane's run ceiling (45 minutes unless the owner sets another), so a
    // first long job (a cold model load) can finish.
    expect(t.runLimitMs).toBe(45 * MIN);
    const sent = await reportRoute.POST(new Request(`http://localhost:3000/api/gpu/computer/tasks/${id}/report`, { method: "POST", headers: { ...headers, "x-fuobe-lease": t.lease }, body: JSON.stringify({ event: "sent", promptId: t.promptId }) }), {
      params: Promise.resolve({ id }),
    });
    expect(sent.status).toBe(200);
    expect(state(id).state).toBe("queued");
  });
});

describe("pictures for workers (check 15)", () => {
  it("are made again from their pixels: no EXIF, no GPS", async () => {
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#f00" } })
      .withExif({ IFD0: { Make: "Phone", Model: "X" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "12/1 0/1 0/1" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();
    const out = await forWorkers(jpeg, "image/jpeg", "holiday.jpg");
    expect(out.contentType).toBe("image/png");
    expect(out.name).toBe("holiday.png");
    expect((await sharp(out.data).metadata()).exif).toBeUndefined();
    await expect(forWorkers(Buffer.from("x"), "video/mp4", "a.mp4")).rejects.toThrow(/clips/);
  });
});

describe("hours and lanes", () => {
  it("windows over midnight, the next change, and no hours at all", () => {
    const h = parseHours({ tz: "UTC", days: { mon: [["22:00", "06:00"]] } })!;
    expect(hoursAt(h, Date.UTC(2026, 10, 2, 23, 0)).inside).toBe(true);
    expect(hoursAt(h, Date.UTC(2026, 10, 3, 5, 0)).inside).toBe(true);
    expect(hoursAt(h, Date.UTC(2026, 10, 3, 6, 30)).inside).toBe(false);
    expect(hoursAt(h, Date.UTC(2026, 10, 3, 5, 0)).endsAt).toBe(Date.UTC(2026, 10, 3, 6, 0));
    expect(hoursAt(null, clock).inside).toBe(false);
    expect(hoursAt({ always: true }, clock)).toEqual({ inside: true, endsAt: null, nextChangeAt: null });
    expect(parseHours({ tz: "Not/AZone", days: {} })).toBeNull();
    expect(parseHours({ tz: "UTC", days: { mon: [["25:00", "06:00"]] } })).toBeNull();
    const ist = parseHours({ tz: "Asia/Kolkata", days: { mon: [["01:00", "09:00"]] } })!;
    expect(hoursAt(ist, Date.UTC(2026, 10, 1, 20, 0)).inside).toBe(true); // Monday 01:30 in India
  });

  it("a worker's lanes come from its verified files: a wrong size counts as missing (check 7)", () => {
    const index = loadIndex();
    const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
    const id = Object.keys(index.workflows).find((k) => !index.workflows[k].isolated && index.workflows[k].files.length > 0)!;
    const needs = needsOf(index, id)!;
    const good = { files: needs.files.map((f) => ({ ...f })), nodePacks: needs.packs.map((name) => ({ name, commit: null })) };
    expect(lanesFor(index, good, sha).workflows).toContain(id);
    const bad = { ...good, files: good.files.map((f, i) => (i === 0 ? { ...f, size: f.size + 1 } : f)) };
    expect(lanesFor(index, bad, sha).workflows).not.toContain(id);
    expect(laneOf(index, id, sha)).toMatch(/^([0-9a-f]{12}|small)$/);
  });
});

describe("a worker's own reports: giving a job back, its execution time, the inputs it takes", () => {
  const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

  async function routed(w: W, id: string) {
    const headers = { host: "localhost:3000", authorization: `Bearer ${w.token}`, "content-type": "application/json" };
    const c = await claimRoute.POST(new Request("http://localhost:3000/api/gpu/computer/claim", { method: "POST", headers, body: JSON.stringify({ running: [] }) }));
    const { task: t } = await c.json();
    expect(t.id).toBe(id);
    const say = async (body: Record<string, unknown>) => {
      const r = await reportRoute.POST(new Request(`http://localhost:3000/api/gpu/computer/tasks/${id}/report`, { method: "POST", headers: { ...headers, "x-fuobe-lease": t.lease }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
      return { status: r.status, body: await r.json() };
    };
    return { t, say };
  }

  it("a job given back goes back in line with its place, counts as an attempt, and the third time fails in plain words", async () => {
    clock = Date.now();
    const id = task();
    const rank = state(id).rank_at;
    const w = worker("gives-back");
    for (let i = 1; i <= 3; i++) {
      const { t, say } = await routed(w, id);
      expect(t.attempt).toBe(i);
      expect((await say({ event: "sent", promptId: t.promptId })).status).toBe(200);
      const back = await say({ event: "give-back", why: i === 1 ? "stalled" : i === 2 ? "run-limit" : "media" });
      expect(back.status).toBe(200);
      if (i < 3) {
        expect(back.body.state).toBe("waiting");
        expect(state(id)).toMatchObject({ state: "waiting", requeues: i, rank_at: rank, worker_id: null });
        expect(JSON.parse(state(id).tried_json ?? "[]")).toEqual([w.id]);
      } else {
        expect(back.body.state).toBe("failed");
        expect(state(id).error).toBe(pool.GAVE_BACK_WORDS);
      }
    }
  });

  it("a job given back shows its kept place in line, then the usual words once a worker has it again: never a restart", async () => {
    clock = Date.now();
    const id = task();
    const w = worker("words");
    const poll = async () => (await comfyProvider.poll({ externalId: "11111111-1111-4111-8111-111111111111", meta: { relay: id, workflowId: "none", generationId: state(id).generation_id } } as never)) as { state: string; message?: string };
    const first = await routed(w, id);
    await first.say({ event: "sent", promptId: first.t.promptId });
    await first.say({ event: "give-back", why: "stalled" });
    expect(state(id)).toMatchObject({ state: "waiting", note: "resent" });
    const waiting = await poll();
    expect(waiting).toMatchObject({ state: "queued", message: pool.poolWaitWords(state(id)) });
    expect(waiting.message).not.toMatch(/another GPU|restart/i);
    await routed(w, id);
    const again = await poll();
    expect(state(id).state).toBe("sending");
    expect(again.state).toBe("queued");
    expect(again.message).not.toMatch(/restart|sent it again/i);
  });

  it("a give-back with an unknown reason is refused, and a person's own computer can't give its job back", async () => {
    clock = Date.now();
    const id = task();
    const w = worker("bad-reason");
    const { t, say } = await routed(w, id);
    await say({ event: "sent", promptId: t.promptId });
    expect((await say({ event: "give-back", why: "bored" })).status).toBe(400);
    expect(state(id).state).toBe("queued");
    const own = tasks.createTask({ principal: "owner", generationId: "own-gen", graph: { "1": { class_type: "SaveImage", inputs: { filename_prefix: "x" } } } });
    db().prepare("UPDATE relay_tasks SET state = 'running' WHERE id = ?").run(own.id);
    expect(() => tasks.report(state(own.id), { event: "give-back", why: "stalled" }, () => ({ error: "x" }))).toThrow(/doesn't fit/);
  });

  it("keeps the execution time and the GPU name a worker reports with a finished job", async () => {
    clock = Date.now();
    const id = task();
    const w = worker("exec");
    const { t } = await routed(w, id);
    tasks.report(state(id), { event: "sent", promptId: t.promptId }, () => ({ error: "x" }));
    const entry = { status: { status_str: "success", completed: true }, outputs: {} };
    tasks.report(state(id), { event: "finished", entry, execMs: 12_345.6, device: "  Test GPU  " }, () => ({ wanted: [], outputs: [], budget: 0 }));
    expect(state(id).state).toBe("done");
    expect(tasks.execOf(state(id))).toEqual({ ms: 12_346, device: "Test GPU" });
    // Nothing reported: nothing kept; a nonsense time is not kept either.
    const id2 = task();
    const { t: t2 } = await routed(w, id2);
    tasks.report(state(id2), { event: "sent", promptId: t2.promptId }, () => ({ error: "x" }));
    tasks.report(state(id2), { event: "finished", entry, execMs: -5 }, () => ({ wanted: [], outputs: [], budget: 0 }));
    expect(tasks.execOf(state(id2))).toBeNull();
  });

  it("holds a reported execution time to the time since the job was sent, and to its run ceiling", async () => {
    clock = Date.now();
    const w = worker("exec-caps");
    const entry = { status: { status_str: "success", completed: true }, outputs: {} };
    const finish = async (sentAgoMs: number, execMs: number) => {
      const id = task();
      const { t } = await routed(w, id);
      tasks.report(state(id), { event: "sent", promptId: t.promptId }, () => ({ error: "x" }));
      tasks.setTask(id, { sent_at: Date.now() - sentAgoMs });
      tasks.report(state(id), { event: "finished", entry, execMs }, () => ({ wanted: [], outputs: [], budget: 0 }));
      return tasks.execOf(state(id))!.ms;
    };
    // Sent 2 minutes ago, said to have run 10 hours: about 3 minutes (2, and the minute allowed before "sent").
    const capped = await finish(2 * MIN, 10 * 60 * MIN);
    expect(capped).toBeGreaterThanOrEqual(3 * MIN - 1_000);
    expect(capped).toBeLessThanOrEqual(3 * MIN + 1_000);
    // Sent 3 hours ago, said to have run 2 hours: the run ceiling.
    expect(await finish(180 * MIN, 120 * MIN)).toBe(runCeilingMs(LANE_A));
    // A sound time stays as it was.
    expect(await finish(30 * MIN, 25 * MIN)).toBe(25 * MIN);
  });

  it("each claim carries its lane's run ceiling and stall limit from the queue's settings, and a reported time keeps to that ceiling", async () => {
    clock = Date.now();
    const w = worker("ceilings", { lanes: [LANE_A, LANE_B] });
    const entry = { status: { status_str: "success", completed: true }, outputs: {} };
    try {
      // The default 30 minutes, an hour for lane A.
      saveQueueSettings({ ...queueSettings(), runCeilingS: { default: 1800, lanes: { [LANE_A]: 3600 } } });
      const a = task({ lane: LANE_A });
      const first = await routed(w, a);
      expect(first.t).toMatchObject({ runLimitMs: 60 * MIN, stallMs: pool.STALL_MS });
      await first.say({ event: "sent", promptId: first.t.promptId });
      tasks.setTask(a, { sent_at: Date.now() - 3 * 60 * MIN });
      await first.say({ event: "finished", entry, execMs: 2 * 60 * MIN, device: "Test GPU" });
      // Said to have run 2 hours: the workers' log keeps the lane's hour, and that is what billing settles with.
      expect(tasks.execOf(state(a))).toEqual({ ms: 60 * MIN, device: "Test GPU" });
      const b = task({ lane: LANE_B });
      expect((await routed(w, b)).t).toMatchObject({ runLimitMs: 30 * MIN, stallMs: pool.STALL_MS });
      db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE id = ?").run(b);
      // A lane ceiling under the stall limit: the stall limit is never longer than the ceiling.
      saveQueueSettings({ ...queueSettings(), runCeilingS: { default: 1800, lanes: { [LANE_A]: 300 } } });
      const short = task({ lane: LANE_A });
      expect((await routed(w, short)).t).toMatchObject({ runLimitMs: 5 * MIN, stallMs: 5 * MIN });
    } finally {
      saveQueueSettings(QUEUE_DEFAULTS);
    }
  });

  it("past its run limit: back in line once, with the whole run ceiling for its next try; past it again, it fails at once", async () => {
    clock = Date.now();
    const id = task();
    const w = worker("run-limit");
    db().prepare("UPDATE relay_workers SET bench_json = ? WHERE id = ?").run(JSON.stringify({ [LANE_A]: { medianMs: 2 * MIN, p90Ms: 3 * MIN } }), w.id);
    const first = await routed(w, id);
    expect(first.t.runLimitMs).toBe(10 * MIN);
    expect(first.t.stallMs).toBe(pool.STALL_MS);
    await first.say({ event: "sent", promptId: first.t.promptId });
    expect((await first.say({ event: "give-back", why: "run-limit" })).body.state).toBe("waiting");
    expect(state(id)).toMatchObject({ state: "waiting", requeues: 1 });
    // The lane's times may come from shorter jobs: this one gets the whole ceiling now.
    const second = await routed(w, id);
    expect(second.t.runLimitMs).toBe(runCeilingMs(LANE_A));
    await second.say({ event: "sent", promptId: second.t.promptId });
    const back = await second.say({ event: "give-back", why: "run-limit" });
    expect(back.body.state).toBe("failed");
    expect(state(id)).toMatchObject({ state: "failed", error: pool.GAVE_BACK_WORDS, requeues: 2 });
    // Other reasons still have three tries: a stall after one run-limit goes back in line.
    const id2 = task();
    const third = await routed(w, id2);
    await third.say({ event: "sent", promptId: third.t.promptId });
    await third.say({ event: "give-back", why: "run-limit" });
    const fourth = await routed(w, id2);
    await fourth.say({ event: "sent", promptId: fourth.t.promptId });
    expect((await fourth.say({ event: "give-back", why: "stalled" })).body.state).toBe("waiting");
  });

  it("results kept from an earlier try go up as no new attempt, keep their own time, and add no time to the lane", async () => {
    clock = Date.now();
    const entry = { status: { status_str: "success", completed: true }, outputs: {} };
    // Made 10 minutes ago; it ran, its worker stopped before the studio heard, and it went back in line.
    const id = task({ rankAgoMs: 10 * MIN });
    const w = worker("kept");
    const first = await routed(w, id);
    await first.say({ event: "sent", promptId: first.t.promptId });
    expect(state(id).attempts).toBe(1);
    pool.backInLine(state(id), { blame: true });
    const again = await routed(w, id);
    expect((await again.say({ event: "sent", promptId: again.t.promptId, kept: true })).status).toBe(200);
    expect(state(id).attempts).toBe(1);
    const done = await again.say({ event: "finished", entry, execMs: 4 * MIN, device: "Test GPU <b>", kept: true });
    expect(done.status).toBe(200);
    expect(state(id).state).not.toBe("queued");
    // Its time ran before this "sent": kept as reported (it is under the time since the task was made). The GPU's name
    // keeps only plain characters.
    expect(tasks.execOf(state(id))).toEqual({ ms: 4 * MIN, device: "Test GPU b" });
    expect(JSON.parse(row(w).bench_json ?? "{}")[LANE_A]).toBeUndefined();
    // A job that runs here counts toward the lane's times, and its "sent" is an attempt.
    const id2 = task();
    const run = await routed(w, id2);
    await run.say({ event: "sent", promptId: run.t.promptId });
    expect(state(id2).attempts).toBe(1);
    tasks.setTask(id2, { sent_at: Date.now() - 5_000 });
    await run.say({ event: "finished", entry, execMs: 1_000 });
    expect(JSON.parse(row(w).bench_json ?? "{}")[LANE_A]?.runs).toHaveLength(1);
  });

  it("a worker that can't make clips and sound again gets no workflow that reads them", () => {
    const index = loadIndex();
    const { mediaOf } = lanesModule;
    const reads = Object.keys(index.workflows).filter((k) => !index.workflows[k].isolated && mediaOf(index.workflows[k]).length);
    const pictures = Object.keys(index.workflows).filter((k) => !index.workflows[k].isolated && !mediaOf(index.workflows[k]).length);
    expect(reads.length).toBeGreaterThan(10);
    // A worker that has every file and pack.
    const files = Object.values(index.files).map((f) => ({ folder: f.folder, name: f.file, size: f.sizeBytes, sha256: f.sha256 ?? null }));
    const nodePacks = Object.keys(index.packs).map((name) => ({ name, commit: null }));
    const all = lanesFor(index, { files, nodePacks, media: ["image", "video", "audio"] }, sha).workflows;
    expect(all).toEqual(expect.arrayContaining([...reads, ...pictures]));
    const onlyPictures = lanesFor(index, { files, nodePacks, media: ["image"] }, sha);
    expect(onlyPictures.workflows).toEqual(expect.arrayContaining(pictures));
    for (const id of reads) expect(onlyPictures.workflows).not.toContain(id);
    expect(onlyPictures.missing.some((m) => m.files.includes("input:video"))).toBe(true);
    // A worker from before workers said which inputs they take (no `media`) never re-encodes clips: pictures only.
    expect(lanesFor(index, { files, nodePacks }, sha).workflows).toEqual(onlyPictures.workflows);
  });

  it("a job's run limit: the run ceiling with no times yet, else 3 × the lane's p90 plus its load, 10 minutes to the ceiling", () => {
    expect(pool.runLimitMs(undefined)).toBe(runCeilingMs(LANE_A));
    expect(pool.runLimitMs(null, "small", 200_000)).toBe(45 * MIN);
    expect(pool.runLimitMs(0)).toBe(45 * MIN);
    expect(pool.runLimitMs(30_000)).toBe(10 * MIN);
    expect(pool.runLimitMs(4 * MIN, "small", 3 * MIN)).toBe(15 * MIN);
    expect(pool.runLimitMs(20 * MIN, "small", 5 * MIN)).toBe(45 * MIN);
    // The claim gives the worker's own times for the lane.
    clock = Date.now();
    const id = task();
    const w = worker("timed");
    db().prepare("UPDATE relay_workers SET bench_json = ? WHERE id = ?").run(JSON.stringify({ [LANE_A]: { medianMs: 3 * MIN, p90Ms: 4 * MIN, loadMs: 3 * MIN } }), w.id);
    const t = pool.workerClaim(row(w), [], clock)!;
    expect(t.id).toBe(id);
    expect(t.runLimitMs).toBe(15 * MIN);
  });

  it("an older worker's inventory (no `media`) keeps its hash, so the studio doesn't ask for it at every beat", () => {
    const inv = { files: [{ folder: "loras", name: "a.safetensors", size: 7, sha256: null }], nodePacks: [{ name: "P", commit: null }] };
    const w = worker("older");
    pool.saveInventory(row(w), inv);
    expect(row(w).inventory_hash).toBe(pool.inventoryHash(inv));
    expect(JSON.parse(row(w).inventory_json ?? "{}").media).toBeUndefined();
  });

  it("the inventory's hash covers the kinds of input, and the worker hashes it the same way", async () => {
    const { inventoryHash: workerHash } = await import("../bin/lib/worker/inventory.mjs");
    const inv = { files: [{ folder: "loras", name: "a.safetensors", size: 7, sha256: null }], nodePacks: [{ name: "P", commit: null }] };
    expect(pool.inventoryHash({ ...inv, media: ["image"] })).not.toBe(pool.inventoryHash(inv));
    expect(pool.inventoryHash({ ...inv, media: ["video", "image"] })).toBe(pool.inventoryHash({ ...inv, media: ["image", "video"] }));
    expect(workerHash({ ...inv, media: ["image", "audio"] })).toBe(pool.inventoryHash({ ...inv, media: ["image", "audio"] }));
    const w = worker("media");
    const saved = pool.saveInventory(row(w), { ...inv, media: ["image", "teleport"] });
    expect(saved.lanes).toBeDefined();
    expect(JSON.parse(row(w).inventory_json ?? "{}").media).toEqual(["image"]);
  });
});
