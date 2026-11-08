import crypto from "node:crypto";
import Database from "better-sqlite3";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/**
 * The workers' line keeps its own rules, whoever a job belongs to: a worker holds one job at a time; a job still sending
 * its files long after the claim goes back in line; a job back in line keeps its place, and its wait limit is over once
 * a worker took it; the beat says how many people's jobs a worker may take now. The workers' log keeps which worker ran
 * which job, and a run's report to the billing service carries the time the workers measured.
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-worker-queue-");
process.env.FUOBE_DATA_DIR = dir;
// Nothing answers here: no test may reach a real ComfyUI on this machine.
process.env.COMFYUI_URL = "http://127.0.0.1:7";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_HOSTED_RUNS;
delete process.env.FUOBE_BILLING_URL;

const auth = await import("@/server/auth");
const { db } = await import("@/server/db");
const { setSetting } = await import("@/server/settings");
const tasks = await import("@/server/computer/tasks");
const pool = await import("@/server/computer/pool");
const { queueReports } = await import("@/server/billing-outbox");
const { loadManifest } = await import("@/server/providers/comfyui");
const { loadIndex } = await import("@/server/gpu/index-file");
const { allLanes } = await import("@/lib/lanes");

const HOST = "localhost:3000";
const MIN = 60_000;
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

let accountId = "";
let cookie = "";

beforeAll(() => {
  auth.setPassword("install password");
  accountId = auth.createAccount("queue@example.com", "long enough").id;
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(accountId).value}`;
});
beforeEach(() => {
  setSetting("comfyWhere", "workers");
  db().prepare("DELETE FROM relay_workers").run();
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
});

/** A worker the owner added and resumed, allowed every lane, able to run every workflow. */
function standInWorker(name = "stand-in") {
  const w = pool.addWorker(name);
  const lanes = allLanes(loadIndex(), sha);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: Object.fromEntries(lanes.map((l) => [l.lane, { delayMs: 0 }])), claimAfterMs: 0 });
  db()
    .prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ? WHERE id = ?")
    .run(JSON.stringify({ lanes: lanes.map((l) => l.lane), workflows: loadManifest().workflows.map((x) => x.id) }), JSON.stringify({ vramBytes: 96 * 2 ** 30 }), w.id);
  return w;
}

/** An account's job made straight in the line (no run route). */
let gens = 0;
function accountTask(o: { rankAt?: number; notAfter?: number } = {}) {
  const gid = `queue-gen-${++gens}`;
  const now = Date.now();
  db()
    .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'queued', ?, '[]', ?, ?)")
    .run(gid, JSON.stringify({ account: accountId, place: "pool" }), now, now);
  const t = tasks.createTask({
    principal: `acct:${accountId}`,
    generationId: gid,
    graph: { "1": { class_type: "SaveImage", inputs: { filename_prefix: "x" } } },
    pool: { pools: ["pool"], account: accountId, rankAt: o.rankAt ?? now, lane: allLanes(loadIndex(), sha)[0]?.lane ?? "small", needs: { workflowId: loadManifest().workflows[0].id, files: [], packs: [], minVramBytes: 0 }, notAfter: o.notAfter },
  });
  return { id: t.id, generationId: gid };
}

type WorkerRow = import("@/server/computer/workers").WorkerRow;
const workerRow = (w: { id: string }) => db().prepare("SELECT * FROM relay_workers WHERE id = ?").get(w.id) as WorkerRow;
const rowOf = (id: string) => db().prepare("SELECT * FROM relay_tasks WHERE id = ?").get(id) as import("@/server/computer/tasks").TaskRow;
const beatAs = (w: { id: string }, now = Date.now(), local: { paused: boolean; why: string | null } = { paused: false, why: null }, running: { task: string }[] = []) =>
  pool.workerBeat(workerRow(w), pool.cleanBeat({ device: `wkr-${w.id}`, protocol: 2, version: "1", local: { ...local, until: null }, gpu: {}, inventoryHash: null, running, stopped: [] }), now);
const claimAs = (w: { id: string }, running: string[] = [], now = Date.now()) => pool.workerClaim(workerRow(w), running, now);

describe("one job at a time", () => {
  it("a stolen worker token holds at most one task; one stuck sending its files goes back in line", () => {
    const w = standInWorker();
    const a = accountTask({ rankAt: Date.now() - 2 * MIN });
    const b = accountTask({ rankAt: Date.now() - MIN });
    beatAs(w);
    expect(claimAs(w)?.id).toBe(a.id);
    // Asking again while it holds one: nothing new, whether or not it says it is running it.
    expect(claimAs(w, [a.id])).toBeNull();
    expect(claimAs(w, [])?.id).toBe(a.id);
    expect(rowOf(b.id).state).toBe("waiting");
    // Still sending its files 15 minutes after the claim: back in line (a lost attempt), and b goes next.
    const later = Date.now() + pool.SENDING_MS + MIN;
    db().prepare("UPDATE relay_workers SET seen_at = ? WHERE id = ?").run(later, w.id);
    pool.sweepPool(later);
    expect(rowOf(a.id).state).toBe("waiting");
    expect(rowOf(a.id).requeues).toBe(1);
  });

  it("a worker that asks again for its own task never winds the sending clock back", () => {
    const w = standInWorker();
    const a = accountTask();
    const t0 = Date.now();
    beatAs(w, t0);
    expect(claimAs(w, [], t0)?.id).toBe(a.id);
    const first = rowOf(a.id).claimed_at;
    // Lost track of it a minute on: the same task, with its first claim's time.
    beatAs(w, t0 + MIN);
    expect(claimAs(w, [], t0 + MIN)?.id).toBe(a.id);
    expect(rowOf(a.id).claimed_at).toBe(first);
    // Still sending its files 15 minutes after that first claim, from a worker that beats on: back in line.
    const late = t0 + pool.SENDING_MS + MIN;
    db().prepare("UPDATE relay_workers SET seen_at = ? WHERE id = ?").run(late, w.id);
    pool.sweepPool(late);
    expect(rowOf(a.id).state).toBe("waiting");
    expect(rowOf(a.id).requeues).toBe(1);
  });

  it("a job its ComfyUI lost while it ran sends again with a fresh sending clock", () => {
    const w = standInWorker();
    const a = accountTask();
    const t0 = Date.now();
    beatAs(w, t0);
    expect(claimAs(w, [], t0)?.id).toBe(a.id);
    tasks.setTask(a.id, { state: "running", sent_at: t0 + MIN, attempts: 1 });
    // Twenty minutes in, its ComfyUI restarted and lost the job: the worker sends it again.
    const gone = t0 + 20 * MIN;
    tasks.report(rowOf(a.id), { event: "gone" }, () => ({ error: "unused" }), gone);
    expect(rowOf(a.id).state).toBe("sending");
    db().prepare("UPDATE relay_workers SET seen_at = ? WHERE id = ?").run(gone + MIN, w.id);
    pool.sweepPool(gone + MIN);
    expect(rowOf(a.id).state).toBe("sending");
    expect(rowOf(a.id).requeues).toBe(0);
  });

  it("a requeue decided on an earlier read of a job changes nothing once its worker has taken it again with a new lease", () => {
    const w = standInWorker();
    const a = accountTask();
    beatAs(w);
    expect(claimAs(w)?.id).toBe(a.id);
    // What another app process read of the job a moment ago, as its sweep found the worker silent.
    const before = rowOf(a.id);
    // Meanwhile the worker came back and asked again: the same job, with a new lease.
    beatAs(w);
    expect(claimAs(w, [])?.id).toBe(a.id);
    const now = rowOf(a.id);
    expect(now.lease_hash).not.toBe(before.lease_hash);
    // The requeue from that earlier read lands late: the job stays with its worker, its lease works, no attempt counted.
    expect(pool.backInLine(before, { blame: true })).toBe(false);
    expect(rowOf(a.id)).toMatchObject({ state: now.state, worker_id: w.id, lease_hash: now.lease_hash, requeues: 0 });
  });

  it("the sweep reads and changes the line in one step with the write lock, so another process's claim never lands in between", () => {
    const w = standInWorker();
    accountTask();
    beatAs(w);
    // Another app process on the same database holds the write lock.
    const other = new Database(db().name);
    const wait = db().pragma("busy_timeout", { simple: true }) as number;
    other.exec("BEGIN IMMEDIATE");
    db().pragma("busy_timeout = 20");
    try {
      // The sweep waits for the lock before it reads anything (here, past its short wait: busy), never reading the line
      // while the other process may still change it.
      expect(() => pool.sweepPool()).toThrow(/busy|locked/i);
    } finally {
      other.exec("ROLLBACK");
      other.close();
      db().pragma(`busy_timeout = ${wait}`);
    }
    expect(() => pool.sweepPool()).not.toThrow();
  });
});

describe("a job its worker's ComfyUI loses", () => {
  const plan = () => ({ error: "unused" });
  /** The worker sends the job to its ComfyUI, which starts it. */
  const sendAndRun = (id: string) => {
    tasks.report(rowOf(id), { event: "sent", promptId: crypto.randomUUID() }, plan);
    tasks.report(rowOf(id), { event: "running", value: 1, max: 4 }, plan);
  };
  const lose = (id: string) => tasks.report(rowOf(id), { event: "gone" }, plan);

  it("after a pause put it back in line, one loss on the next claim sends it again, and no attempt is used", () => {
    const w = standInWorker();
    const a = accountTask();
    beatAs(w);
    expect(claimAs(w)?.id).toBe(a.id);
    sendAndRun(a.id);
    // The worker pauses at once: the job goes back in line at no cost.
    beatAs(w, Date.now(), { paused: true, why: "here-now" }, [{ task: a.id }]);
    expect(rowOf(a.id).state).toBe("waiting");
    beatAs(w);
    expect(claimAs(w)?.id).toBe(a.id);
    sendAndRun(a.id);
    // Its ComfyUI restarts once: the worker sends it again on this claim.
    expect(lose(a.id).state).toBe("sending");
    expect(rowOf(a.id).requeues).toBe(0);
  });

  it("lost by a worker that went quiet, then once by another worker's ComfyUI: it sends again there", () => {
    const first = standInWorker("first");
    const a = accountTask();
    beatAs(first);
    expect(claimAs(first)?.id).toBe(a.id);
    sendAndRun(a.id);
    db().prepare("UPDATE relay_workers SET seen_at = ? WHERE id = ?").run(Date.now() - 3 * MIN, first.id);
    pool.sweepPool();
    expect(rowOf(a.id).state).toBe("waiting");
    expect(rowOf(a.id).requeues).toBe(1);
    const second = standInWorker("second");
    beatAs(second);
    expect(claimAs(second)?.id).toBe(a.id);
    sendAndRun(a.id);
    expect(lose(a.id).state).toBe("sending");
    expect(rowOf(a.id).requeues).toBe(1);
  });

  it("lost twice on one claim: back in line with its place as one attempt, and the third such attempt fails it", () => {
    const w = standInWorker();
    const a = accountTask({ rankAt: Date.now() - 5 * MIN });
    const rank = rowOf(a.id).rank_at;
    for (let i = 1; i <= pool.MAX_ATTEMPTS; i++) {
      beatAs(w);
      expect(claimAs(w)?.id).toBe(a.id);
      sendAndRun(a.id);
      expect(lose(a.id).state).toBe("sending");
      sendAndRun(a.id);
      const answer = lose(a.id);
      if (i < pool.MAX_ATTEMPTS) {
        expect(answer.state).toBe("waiting");
        expect(rowOf(a.id).requeues).toBe(i);
        expect(rowOf(a.id).rank_at).toBe(rank);
      }
    }
    expect(rowOf(a.id).state).toBe("failed");
    expect(rowOf(a.id).error).not.toBe("lost");
  });
});

describe("back in line", () => {
  it("a requeue keeps the job's place (rank_at), and once a worker took it, its wait limit is over", () => {
    const w = standInWorker();
    const first = accountTask({ rankAt: Date.now() - 5 * MIN, notAfter: Date.now() + MIN });
    const later = accountTask({ rankAt: Date.now() });
    const rank = rowOf(first.id).rank_at;
    beatAs(w);
    expect(claimAs(w)?.id).toBe(first.id);
    // The worker pauses at once (another program on the GPU): the job goes back in line at no cost.
    beatAs(w, Date.now(), { paused: true, why: "gpu-busy:game.exe" }, [{ task: first.id }]);
    const back = rowOf(first.id);
    expect(back.state).toBe("waiting");
    expect(back.rank_at).toBe(rank);
    expect(back.requeues).toBe(0);
    // First in line again, ahead of the later job, and past its wait limit it still waits.
    expect(pool.queueOfGeneration(first.generationId)?.place).toBe(1);
    expect(pool.queueOfGeneration(later.generationId)?.place).toBe(2);
    pool.sweepPool(Date.now() + 10 * MIN);
    expect(rowOf(first.id).state).toBe("waiting");
    // A job no worker has taken yet still fails at its wait limit, not charged.
    const never = accountTask({ notAfter: Date.now() + MIN });
    pool.sweepPool(Date.now() + 2 * MIN);
    expect(rowOf(never.id).state).toBe("failed");
  });
});

describe("the beat", () => {
  it("says how many people's tasks this worker may claim now (never the owner's own)", () => {
    const w = standInWorker();
    accountTask();
    accountTask();
    const owner = accountTask();
    db().prepare("UPDATE relay_tasks SET principal = 'owner', account = NULL, class = 'owner' WHERE id = ?").run(owner.id);
    expect(beatAs(w).claimableNow).toBe(2);
    pool.patchWorker(w.id, { paused: true });
    expect(beatAs(w).claimableNow).toBe(0);
  });

  it("says apart how many of the owner's own tasks this worker may claim now, by the same rules", () => {
    const w = standInWorker();
    accountTask();
    const owner = accountTask();
    const other = accountTask();
    db().prepare("UPDATE relay_tasks SET principal = 'owner', account = NULL, class = 'owner' WHERE id IN (?, ?)").run(owner.id, other.id);
    expect(beatAs(w)).toMatchObject({ claimableNow: 1, ownerWaitingNow: 2 });
    // One it can't run (another pool) doesn't count.
    db().prepare("UPDATE relay_tasks SET pools = 'elsewhere' WHERE id = ?").run(other.id);
    expect(beatAs(w).ownerWaitingNow).toBe(1);
    pool.patchWorker(w.id, { paused: true });
    expect(beatAs(w)).toMatchObject({ claimableNow: 0, ownerWaitingNow: 0 });
  });
});

describe("the workers' measured run reaches the billing service", () => {
  it("settle carries the time the worker's ComfyUI spent on the run and its GPU's name", () => {
    const now = Date.now();
    const t = accountTask();
    db().prepare("UPDATE generations SET status = 'succeeded', completed_at = ?, request_json = ? WHERE id = ?").run(now, JSON.stringify({ account: accountId, place: "pool", hold: `hold-${t.id}` }), t.generationId);
    tasks.logWorkerJob("finished", { id: t.id, generation_id: t.generationId, principal: `acct:${accountId}`, lane: "small" }, "w-1", now, { execMs: 12_345, device: "Test GPU 24GB" });
    queueReports(now);
    const row = db().prepare("SELECT payload_json FROM billing_outbox WHERE key = ?").get(t.generationId) as { payload_json: string };
    const report = JSON.parse(row.payload_json) as { gpuMs: number; device: string };
    expect(report.gpuMs).toBe(12_345);
    expect(report.device).toBe("Test GPU 24GB");
  });

  it("a job that went back in line after its result was made counts once: the attempt whose result was kept", () => {
    const now = Date.now();
    const t = accountTask();
    db().prepare("UPDATE generations SET status = 'succeeded', completed_at = ?, request_json = ? WHERE id = ?").run(now, JSON.stringify({ account: accountId, place: "pool", hold: `hold-${t.id}` }), t.generationId);
    const row = { id: t.id, generation_id: t.generationId, principal: `acct:${accountId}` as const, lane: "small" };
    tasks.logWorkerJob("finished", row, "w-1", now - 5 * MIN, { execMs: 50_000, device: "Test GPU A" });
    tasks.logWorkerJob("requeued", row, "w-1", now - 4 * MIN);
    tasks.logWorkerJob("finished", row, "w-2", now - MIN, { execMs: 40_000, device: "Test GPU B" });
    // A second job of the same run adds its own time.
    tasks.logWorkerJob("finished", { ...row, id: "second-job-0001x" }, "w-2", now, { execMs: 2_000, device: "Test GPU B" });
    queueReports(now);
    const report = JSON.parse((db().prepare("SELECT payload_json FROM billing_outbox WHERE key = ?").get(t.generationId) as { payload_json: string }).payload_json) as { gpuMs: number; device: string };
    expect(report.gpuMs).toBe(42_000);
    expect(report.device).toBe("Test GPU B");
  });

  it("a run whose jobs never finished on a worker reports no time, never its time in line", () => {
    const now = Date.now();
    const t = accountTask();
    db().prepare("UPDATE generations SET status = 'failed', error = 'x', completed_at = ?, request_json = ? WHERE id = ?").run(now, JSON.stringify({ account: accountId, place: "pool", hold: `hold-${t.id}` }), t.generationId);
    // It waited in line for 40 minutes: its start and end are far apart, and no worker measured anything.
    db().prepare("INSERT OR REPLACE INTO generation_runs (id, submitted_at, started_at) VALUES (?, ?, ?)").run(t.generationId, now - 40 * MIN, now - 40 * MIN);
    tasks.logWorkerJob("claimed", { id: t.id, generation_id: t.generationId, principal: `acct:${accountId}`, lane: "small" }, "w-1", now - 5 * MIN);
    queueReports(now);
    const report = JSON.parse((db().prepare("SELECT payload_json FROM billing_outbox WHERE key = ?").get(t.generationId) as { payload_json: string }).payload_json) as { gpuMs: number | null; device: string | null };
    expect(report.gpuMs).toBeNull();
    expect(report.device).toBeNull();
  });
});

describe("the workers' log", () => {
  it("only grows", () => {
    const t = accountTask();
    tasks.logWorkerJob("claimed", { id: t.id, generation_id: t.generationId, principal: `acct:${accountId}`, lane: null }, "w-2");
    expect(() => db().prepare("UPDATE worker_jobs SET event = 'done' WHERE task_id = ?").run(t.id)).toThrow(/only grows/);
    expect(() => db().prepare("DELETE FROM worker_jobs WHERE task_id = ?").run(t.id)).toThrow(/kept a year/);
  });

  it("keeps a claim, a requeue and how the job ended, by worker", () => {
    const w = standInWorker("logged");
    const a = accountTask();
    beatAs(w);
    expect(claimAs(w)?.id).toBe(a.id);
    beatAs(w, Date.now(), { paused: true, why: "here-now" }, [{ task: a.id }]);
    pool.patchWorker(w.id, { paused: false });
    beatAs(w);
    expect(claimAs(w)?.id).toBe(a.id);
    tasks.endTask(a.id, "canceled", { error: "Stopped" });
    const log = db().prepare("SELECT event, worker_id, worker_name, principal FROM worker_jobs WHERE task_id = ? ORDER BY id").all(a.id) as { event: string; worker_id: string; worker_name: string; principal: string }[];
    expect(log.map((x) => x.event)).toEqual(["claimed", "requeued", "claimed", "canceled"]);
    expect(log.every((x) => x.worker_id === w.id && x.worker_name === "logged" && x.principal === `acct:${accountId}`)).toBe(true);
  });

  it("lists who took which job, newest first, for the owner or a token that may read the workers", async () => {
    const jobsRoute = await import("@/app/api/admin/workers/jobs/route");
    const { createAdminToken } = await import("@/server/admin-tokens");
    const t = accountTask();
    tasks.logWorkerJob("claimed", { id: t.id, generation_id: t.generationId, principal: `acct:${accountId}`, lane: "small" }, "w-log-1");
    tasks.logWorkerJob("finished", { id: t.id, generation_id: t.generationId, principal: `acct:${accountId}`, lane: "small" }, "w-log-1", Date.now(), { execMs: 4321, device: "Test GPU" });
    const get = (qs: string, headers: Record<string, string>) => jobsRoute.GET(new Request(`http://${HOST}/api/admin/workers/jobs${qs}`, { headers: { host: HOST, ...headers } }));
    const owner = `${auth.SESSION_COOKIE}=${auth.createSession().value}`;
    const res = await get(`?generation=${t.generationId}`, { cookie: owner });
    expect(res.status).toBe(200);
    const page = (await res.json()) as { items: { event: string; workerId: string; execMs: number | null; device: string | null }[]; next: string | null };
    expect(page.items.map((x) => x.event)).toEqual(["finished", "claimed"]);
    expect(page.items[0]).toMatchObject({ workerId: "w-log-1", execMs: 4321, device: "Test GPU" });
    expect(JSON.stringify(page)).not.toContain("example.com");
    // An account's session, or a token that may not read the workers: no.
    expect((await get("", { cookie })).status).toBeGreaterThanOrEqual(401);
    const reader = createAdminToken({ name: "workers reader", scopes: ["workers:read"] });
    expect((await get("?limit=1", { authorization: `Bearer ${reader.token}` })).status).toBe(200);
    const other = createAdminToken({ name: "queue reader", scopes: ["queue:read"] });
    expect((await get("", { authorization: `Bearer ${other.token}` })).status).toBe(403);
    expect((await get("?limit=0", { cookie: owner })).status).toBe(400);
  });
});
