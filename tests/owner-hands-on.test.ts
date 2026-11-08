import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/**
 * The owner's runs on the install's workers: a hands-on run (no `source`) waits, counts and makes room as a person's
 * run does in every mode; a run a script tagged (batch, drill, example, test) stays the owner's own job, after people's
 * runs; a run the owner sent next asks local work to make room too.
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 60_000 });

const dir = tempDir("fuobe-owner-hands-on-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:7";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_HOSTED_RUNS;
delete process.env.FUOBE_BILLING_URL;
globalThis.__fuobeTestDiskFree = 1e13;

const auth = await import("@/server/auth");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const tasks = await import("@/server/computer/tasks");
const pool = await import("@/server/computer/pool");
const qc = await import("@/server/computer/queue-controls");
const { liveQueue } = await import("@/server/computer/queue-live");
const { catalogVersion } = await import("@/server/computer/catalog-version");
const qs = await import("@/server/queue-settings");
const { loadManifest } = await import("@/server/providers/comfyui");
const { loadIndex } = await import("@/server/gpu/index-file");
const { allLanes } = await import("@/lib/lanes");
const { SiteTurns } = await import("../bin/lib/worker/turns.mjs");
const { siteOf } = await import("../bin/lib/worker/run.mjs");

const MIN = 60_000;
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
type WorkerRow = import("@/server/computer/workers").WorkerRow;
type TaskRow = import("@/server/computer/tasks").TaskRow;

let alice = "";

beforeAll(() => {
  auth.setPassword("install password");
  alice = auth.createAccount("hands-on-a@example.com", "long enough").id;
});
beforeEach(() => {
  resetRates();
  qs.saveQueueSettings(qs.QUEUE_DEFAULTS);
  setSetting("comfyWhere", "workers");
  db().prepare("DELETE FROM relay_workers").run();
  db().prepare("DELETE FROM queue_overrides").run();
  db().prepare("DELETE FROM settings WHERE key = 'queue.modes'").run();
  globalThis.__fuobeQueueModes = undefined;
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state != 'canceled'").run();
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
});

function worker(name: string) {
  const w = pool.addWorker(name);
  const lanes = allLanes(loadIndex(), sha);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: Object.fromEntries(lanes.map((l) => [l.lane, { delayMs: 0 }])), claimAfterMs: 0 });
  db()
    .prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ?, catalog_version = ?, protocol = 3, seen_at = ?, paused_local = 0 WHERE id = ?")
    .run(JSON.stringify({ lanes: lanes.map((l) => l.lane), workflows: loadManifest().workflows.map((x) => x.id) }), JSON.stringify({ vramBytes: 96 * 2 ** 30 }), catalogVersion(), Date.now(), w.id);
  return w;
}
const row = (w: { id: string }) => db().prepare("SELECT * FROM relay_workers WHERE id = ?").get(w.id) as WorkerRow;
const beat = (w: { id: string }, extra: Record<string, unknown> = {}, now = Date.now()) =>
  pool.workerBeat(row(w), pool.cleanBeat({ device: `wkr-${w.id}`, protocol: 3, version: "1", local: { paused: false, why: null, until: null }, gpu: {}, inventoryHash: null, running: [], stopped: [], catalogVersion: catalogVersion(), ...extra }), now);
const claim = (w: { id: string }, now = Date.now()) => pool.workerClaim(row(w), [], now);
const done = (id: string) => db().prepare("UPDATE relay_tasks SET state = 'done', finished_at = ? WHERE id = ?").run(Date.now(), id);
const taskRow = (id: string) => db().prepare("SELECT * FROM relay_tasks WHERE id = ?").get(id) as TaskRow;

let gens = 0;
/**
 * A run in line, made `agoMs` ago: a person's (`account`), or the owner's with the class its source gives it
 * (pool.ts ownerRunClass): hands-on (no source) or tagged (`source`).
 */
function job(o: { account?: string; source?: "batch" | "drill" | "example" | "test" | "api" | "hands-on"; agoMs?: number; batch?: string; noTask?: boolean } = {}) {
  const gid = `oh-gen-${++gens}`;
  const at = Date.now() - (o.agoMs ?? 0);
  db()
    .prepare("INSERT INTO generations (id, batch_id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, ?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'queued', ?, '[]', ?, ?)")
    .run(gid, o.batch ?? null, JSON.stringify(o.account ? { account: o.account, place: "pool" } : o.source ? { source: o.source } : {}), at, at);
  if (o.noTask) return { id: "", gid };
  const cls = o.account ? "free" : pool.ownerRunClass(gid);
  const t = tasks.createTask({
    principal: o.account ? `acct:${o.account}` : "owner",
    generationId: gid,
    graph: { "1": { class_type: "SaveImage", inputs: { filename_prefix: "x" } } },
    pool: { pools: ["pool"], account: o.account, class: cls, rankAt: at, lane: allLanes(loadIndex(), sha)[0].lane, needs: { workflowId: loadManifest().workflows[0].id, files: [], packs: [], minVramBytes: 0 } },
  });
  db().prepare("UPDATE relay_tasks SET created_at = ? WHERE id = ?").run(at, t.id);
  return { id: t.id, gid };
}

function served(w: { id: string }): string[] {
  const out: string[] = [];
  for (;;) {
    beat(w);
    const t = claim(w);
    if (!t) return out;
    out.push(t.id);
    done(t.id);
  }
}

const setMode = (mode: string) => {
  const c = qc.checkModeChange({ mode }, "owner");
  if ("error" in c) throw new Error(c.error);
  qc.applyModeChange(c);
};
const sendNext = (gid: string) => {
  const o = qc.checkOverride({ kind: "run", generationId: gid, action: "next" });
  if ("error" in o) throw new Error(o.error);
  const r = qc.addOverride(o, "owner");
  if ("error" in r) throw new Error(r.error);
};
const localRunning = { localWork: { state: "running", why: null, waiting: 3, running: true, at: Date.now() } };

describe("the owner's run's class", () => {
  it("is a person's (free) with no source, and the owner's with a script's source or a tagged step of the same press", () => {
    expect(pool.ownerRunClass(job({ noTask: true }).gid)).toBe("free");
    expect(pool.ownerRunClass(job({ source: "hands-on", noTask: true }).gid)).toBe("free");
    for (const source of ["batch", "drill", "example", "test", "api"] as const) expect(pool.ownerRunClass(job({ source, noTask: true }).gid)).toBe("owner");
    // A chain's first frame carries no source of its own: its press's tagged step decides.
    const first = job({ batch: "press-1", noTask: true });
    job({ batch: "press-1", source: "batch", noTask: true });
    expect(pool.ownerRunClass(first.gid)).toBe("owner");
    const other = job({ batch: "press-2", noTask: true });
    expect(pool.ownerRunClass(other.gid)).toBe("free");
    expect(pool.ownerRunClass("no-such-run")).toBe("free");
  });

  it("a hands-on run is the owner's hands-on run; the worker still gets it as the owner's graph job", () => {
    const w = worker("w1");
    const mine = job();
    expect(pool.ownerHandsOn(taskRow(mine.id))).toBe(true);
    expect(pool.ownerHandsOn(taskRow(job({ source: "batch" }).id))).toBe(false);
    expect(pool.ownerHandsOn(taskRow(job({ account: alice }).id))).toBe(false);
    beat(w);
    const c = claim(w);
    expect(c?.id).toBe(mine.id);
    expect(c?.class).toBe("owner");
    expect(c?.graph).toBeDefined();
  });
});

describe("the line in each mode", () => {
  it("people first: a hands-on run with people's runs by when it came; a tagged run after both", () => {
    const w = worker("w1");
    const batch = job({ source: "batch", agoMs: 60 * MIN });
    const mine = job({ agoMs: 20 * MIN });
    const a = job({ account: alice, agoMs: 10 * MIN });
    expect(served(w)).toEqual([mine.id, a.id, batch.id]);
  });

  it("people only: a hands-on run is taken; a tagged run waits", () => {
    setMode("people-only");
    const w = worker("w1");
    const batch = job({ source: "test", agoMs: 60 * MIN });
    const mine = job({ agoMs: 5 * MIN });
    expect(served(w)).toEqual([mine.id]);
    expect(liveQueue().queued.find((q) => q.task === batch.id)).toMatchObject({ code: "paused", why: "Waits: People only" });
  });

  it("our work first: a tagged run first, a hands-on run with people's runs after it", () => {
    setMode("ours-first");
    const w = worker("w1");
    const a = job({ account: alice, agoMs: 30 * MIN });
    const mine = job({ agoMs: 20 * MIN });
    const batch = job({ source: "example", agoMs: 5 * MIN });
    expect(served(w)).toEqual([batch.id, a.id, mine.id]);
  });

  it("balanced: free runs, hands-on runs and tagged runs by when they came", () => {
    setMode("balanced");
    const w = worker("w1");
    const batch = job({ source: "drill", agoMs: 30 * MIN });
    const mine = job({ agoMs: 20 * MIN });
    const a = job({ account: alice, agoMs: 10 * MIN });
    expect(served(w)).toEqual([batch.id, mine.id, a.id]);
  });
});

describe("the worker's site turn", () => {
  it("a hands-on run counts in claimableNow (so siteWaiting asks local work for room); a tagged run only in ownerWaitingNow", () => {
    const w = worker("w1");
    job({ source: "batch", agoMs: 5 * MIN });
    let answer = beat(w);
    expect(answer.claimableNow).toBe(0);
    expect(answer.ownerWaitingNow).toBe(1);
    job({ agoMs: MIN });
    answer = beat(w);
    expect(answer.claimableNow).toBe(1);
    expect(answer.ownerWaitingNow).toBe(1);
    expect(pool.updateOf(row(w)).peopleWaiting).toBe(1);

    // The worker's turn: its site.json says a studio job waits, and local work that holds the GPU is asked for room.
    const folder = path.join(dir, "turns-folder");
    fs.mkdirSync(folder, { recursive: true });
    const turns = new SiteTurns({ folder, stateFile: path.join(dir, "turns-state.json") });
    const t = Date.now();
    const s = siteOf(answer);
    const turn = turns.step(t, { may: true, claimable: s.claimable, busy: false, workHolds: true, workThere: true, serverInterrupt: false, unsure: false });
    expect(turn.siteWaiting).toBeGreaterThanOrEqual(1);
    expect(turn.waitForYield).toBe(true);
  });

  it("a tagged run alone asks for no turn", () => {
    const w = worker("w1");
    job({ source: "batch" });
    const s = siteOf(beat(w));
    const folder = path.join(dir, "turns-folder-2");
    fs.mkdirSync(folder, { recursive: true });
    const turns = new SiteTurns({ folder, stateFile: path.join(dir, "turns-state-2.json") });
    expect(turns.step(Date.now(), { may: true, claimable: s.claimable, busy: false, workHolds: true, workThere: true, serverInterrupt: false, unsure: false }).siteWaiting).toBe(0);
  });

  it("our work first while local work runs: a hands-on run asks for no room, as a person's run", () => {
    setMode("ours-first");
    const w = worker("w1");
    job();
    expect(beat(w, localRunning).claimableNow).toBe(0);
  });

  it("a hands-on run makes a tagged job on the GPU go back in line, as a person's run does", () => {
    const w = worker("w1");
    const batch = job({ source: "batch", agoMs: 10 * MIN });
    beat(w);
    expect(claim(w)?.id).toBe(batch.id);
    const mine = job();
    const answer = beat(w);
    expect(answer.stops.map((s) => s.task)).toEqual([batch.id]);
    expect(claim(w)?.id).toBe(mine.id);
  });

  it("a hands-on run is never sent back for a person's run", () => {
    const w = worker("w1");
    const mine = job({ agoMs: 10 * MIN });
    beat(w);
    expect(claim(w)?.id).toBe(mine.id);
    job({ account: alice });
    expect(beat(w).stops).toEqual([]);
  });
});

describe("Run next", () => {
  it("a tagged run sent next counts as a person's for the turn (local work makes room) and says so on the Queue page", () => {
    const w = worker("w1");
    const batch = job({ source: "batch", agoMs: 5 * MIN });
    expect(beat(w).claimableNow).toBe(0);
    sendNext(batch.gid);
    const answer = beat(w);
    expect(answer.claimableNow).toBe(1);
    expect(answer.ownerWaitingNow).toBe(0);
    // In our work first too, while local work runs.
    setMode("ours-first");
    expect(beat(w, localRunning).claimableNow).toBe(1);
    const q = liveQueue().queued.find((x) => x.task === batch.id);
    expect(q).toMatchObject({ rank: 1, code: "next", why: "Run next: starts as soon as the GPU is free and local work makes room" });
  });
});

describe("the Queue page", () => {
  it("says \"Your run\" of a hands-on run, flags it, and keeps the tagged run's words", () => {
    worker("w1");
    const mine = job({ agoMs: 5 * MIN });
    const batch = job({ source: "batch", agoMs: 10 * MIN });
    const a = job({ account: alice, agoMs: MIN });
    const q = liveQueue().queued;
    expect(q.map((x) => x.task)).toEqual([mine.id, a.id, batch.id]);
    expect(q[0]).toMatchObject({ principal: "owner", why: "Your run", handsOn: true, person: null });
    expect(q[1]).toMatchObject({ principal: "user", why: "People first" });
    expect(q[1]).not.toHaveProperty("handsOn");
    expect(q[2]).toMatchObject({ principal: "owner", why: "Our work: after people's runs" });
    expect(q[2]).not.toHaveProperty("handsOn");
  });
});
