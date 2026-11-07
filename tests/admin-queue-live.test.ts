/**
 * The owner's queue view of what the workers do now (GET /api/admin/queue, src/server/computer/queue-live.ts): the jobs
 * they run, the jobs and the line they hold back and why (the worker's beat `holding`), the later steps of chains that
 * wait for their earlier steps, and the text helper's line. The earlier fields (`held`, `lanes`) stay as they were.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { tempDir } from "./helpers/temp-dir";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-admin-queue-live-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
delete process.env.FUOBE_PASSWORD;

const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const admin = await import("@/server/admin-tokens");
const tasks = await import("@/server/computer/tasks");
const pool = await import("@/server/computer/pool");
const workers = await import("@/server/computer/workers");
const { liveQueue, NEXT_LIMIT } = await import("@/server/computer/queue-live");
const queueRoute = await import("@/app/api/admin/queue/route");

const LANE = "aaaaaaaaaaaa";
const MIN = 60_000;
let clock = Date.now();

type W = { id: string; token: string };
const row = (w: W) => workers.getWorker(w.id)!;

function worker(name: string): W {
  const w = pool.addWorker(name);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: { [LANE]: { delayMs: 0 } }, claimAfterMs: 0 });
  db().prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ? WHERE id = ?").run(JSON.stringify({ lanes: [LANE], workflows: ["wf-a"] }), JSON.stringify({ vramBytes: 24 * 2 ** 30 }), w.id);
  beat(w);
  return w;
}

function beat(w: W, o: { holding?: unknown; local?: { paused?: boolean; why?: string | null }; running?: { task: string; value?: number; max?: number }[] } = {}) {
  return pool.workerBeat(
    row(w),
    pool.cleanBeat({
      device: `wkr-${w.id}`,
      protocol: 2,
      version: "1.0.0",
      local: { paused: o.local?.paused ?? false, why: o.local?.why ?? null, until: null },
      gpu: {},
      inventoryHash: null,
      running: o.running ?? [],
      stopped: [],
      ...(o.holding !== undefined && { holding: o.holding }),
    }),
    clock,
  );
}

let gens = 0;
function gen(o: { status?: string; message?: string | null; account?: string; dependsOn?: string | string[]; model?: string; createdAt?: number } = {}): string {
  const id = `live-gen-${++gens}`;
  db()
    .prepare(
      "INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, message, request_json, outputs_json, created_at, updated_at, depends_on) VALUES (?, 'image', ?, 'open', 'comfyui', 't2i', 'image', ?, ?, ?, '[]', ?, ?, ?)",
    )
    .run(id, o.model ?? "m-test", o.status ?? "queued", o.message ?? null, JSON.stringify(o.account ? { account: o.account } : {}), o.createdAt ?? clock, clock, o.dependsOn === undefined ? null : Array.isArray(o.dependsOn) ? JSON.stringify(o.dependsOn) : o.dependsOn);
  return id;
}

function task(o: { account?: string; message?: string | null } = {}): { id: string; gid: string } {
  const gid = gen({ account: o.account, message: o.message });
  const t = tasks.createTask({
    principal: "owner",
    generationId: gid,
    graph: { "1": { class_type: "SaveImage", inputs: { filename_prefix: "x" } } },
    pool: { pools: ["pool"], account: o.account, rankAt: clock, lane: LANE, needs: { workflowId: "wf-a", files: [], packs: [], minVramBytes: 0 } },
  });
  return { id: t.id, gid };
}

const claim = (w: W) => pool.workerClaim(row(w), [], clock)!;
const setState = (id: string, set: Record<string, unknown>) => {
  const keys = Object.keys(set);
  db().prepare(`UPDATE relay_tasks SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`).run({ ...set, id });
};

beforeAll(() => setSetting("comfyWhere", "workers"));
beforeEach(() => {
  resetRates();
  clock += 60 * MIN;
  db().prepare("DELETE FROM relay_workers").run();
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued','running')").run();
  db().prepare("DELETE FROM helper_jobs").run();
});

describe("the beat's holding", () => {
  it("is kept as the worker says it, with a short reason, and cleared by a beat without it", () => {
    const w = worker("keeps");
    beat(w, { holding: { why: "local-work", since: clock - 5 * MIN } });
    expect(JSON.parse(row(w).holding_json!)).toEqual({ why: "local-work", since: clock - 5 * MIN });
    // A "since" later than the studio's clock is the studio's now.
    beat(w, { holding: { why: "starting-comfy", since: clock + 10 * MIN, task: "t-1" } });
    expect(JSON.parse(row(w).holding_json!)).toEqual({ why: "starting-comfy", since: clock, task: "t-1" });
    beat(w);
    expect(row(w).holding_json).toBeNull();
  });

  it("drops what isn't a short reason with a time", () => {
    expect(pool.cleanHolding({ why: "Local Work!", since: 1 })).toBeNull();
    expect(pool.cleanHolding({ why: "local-work" })).toBeNull();
    expect(pool.cleanHolding({ why: "x".repeat(49), since: 1 })).toBeNull();
    expect(pool.cleanHolding("local-work")).toBeNull();
    expect(pool.cleanHolding({ why: "local-work", since: 5, task: "../x" })).toEqual({ why: "local-work", since: 5 });
  });
});

describe("what the workers do now", () => {
  it("a job on its way to the worker's ComfyUI is held; once it reports steps it runs, with its step and progress", () => {
    const w = worker("runs");
    const { id, gid } = task({ account: "acct-1", message: "Making your picture · step 36 of 48" });
    claim(w);
    expect(liveQueue(clock).holding).toEqual([expect.objectContaining({ worker: "runs", task: id, generationId: gid, code: "sending", why: "Sending its files to the worker", principal: "user", since: clock })]);
    expect(liveQueue(clock).running).toEqual([]);

    setState(id, { state: "running", started_at: clock + 1000 });
    clock += 2000;
    beat(w, { running: [{ task: id, value: 36, max: 48 }] });
    const live = liveQueue(clock);
    expect(live.holding).toEqual([]);
    expect(live.running).toEqual([
      expect.objectContaining({ task: id, generationId: gid, model: "m-test", op: "t2i", worker: "runs", slot: "gpu", step: "Making your picture · step 36 of 48", progress: { value: 36, max: 48 }, startedAt: clock - 1000, principal: "user", lane: LANE }),
    ]);
  });

  it("a job taken cold runs as \"Loading the model\"; its results being saved as \"Saving the results\"; the owner's own is the owner's", () => {
    const w = worker("cold");
    const { id } = task();
    claim(w);
    setState(id, { state: "running", started_at: clock, progress_json: JSON.stringify({ cold: true, at: clock }) });
    expect(liveQueue(clock).running).toEqual([expect.objectContaining({ task: id, step: "Loading the model", progress: null, principal: "owner" })]);
    setState(id, { state: "collecting", progress_json: null });
    expect(liveQueue(clock).running).toEqual([expect.objectContaining({ task: id, step: "Saving the results" })]);
  });

  it("the worker's own reason for a job it took wins, and a worker gone quiet holds its job", () => {
    const w = worker("says");
    const { id } = task();
    claim(w);
    setState(id, { state: "queued", sent_at: clock });
    beat(w, { holding: { why: "updating", since: clock - MIN, task: id } });
    expect(liveQueue(clock).holding).toEqual([expect.objectContaining({ task: id, code: "updating", why: "Restarting on new worker code after its job", since: clock - MIN })]);
    beat(w);
    expect(liveQueue(clock).holding).toEqual([expect.objectContaining({ task: id, code: "queued", why: "In its worker's ComfyUI queue" })]);
    expect(liveQueue(clock + 3 * MIN).holding).toEqual([expect.objectContaining({ task: id, code: "quiet", why: "No word from its worker for 3 min", since: clock })]);
  });

  it("a worker that holds back the line's work: its reason, since when and how many jobs it could take", () => {
    const w = worker("holds");
    task();
    task({ account: "acct-2" });
    beat(w, { holding: { why: "local-work", since: clock - 12 * MIN } });
    expect(liveQueue(clock).holding).toEqual([{ worker: "holds", task: null, generationId: null, model: null, op: null, principal: null, why: "Waiting for local ComfyUI work to finish", code: "local-work", since: clock - 12 * MIN, waiting: 2 }]);
    // An unknown reason from a newer worker reads plainly.
    beat(w, { holding: { why: "something-new", since: clock } });
    expect(liveQueue(clock).holding[0]).toMatchObject({ why: "Not starting yet", code: "something-new" });
  });

  it("a worker paused here with work it could take shows its own state; one with nothing to take, nothing", () => {
    const w = worker("paused-here");
    beat(w, { local: { paused: true, why: "gpu-busy:game.exe" } });
    expect(liveQueue(clock).holding).toEqual([]);
    task({ account: "acct-3" });
    beat(w, { local: { paused: true, why: "gpu-busy:game.exe" } });
    expect(liveQueue(clock).holding).toEqual([expect.objectContaining({ worker: "paused-here", task: null, code: "gpu-busy", why: "Your GPU is busy (game.exe)", since: null, waiting: 1 })]);
  });

  it("the later steps of chains, with what they wait for", () => {
    const first = gen({ status: "running", message: "Making your picture · step 3 of 8", model: "m-first" });
    const second = gen({ status: "succeeded", model: "m-second" });
    db().prepare("UPDATE generations SET completed_at = ? WHERE id = ?").run(clock - MIN, second);
    const step = gen({ dependsOn: [first, second], account: "acct-4", model: "m-step", createdAt: clock - 4 * MIN });
    const live = liveQueue(clock);
    expect(live.nextTotal).toBe(1);
    expect(live.next).toEqual([
      {
        generationId: step,
        model: "m-step",
        op: "t2i",
        principal: "user",
        since: clock - 4 * MIN,
        waitsFor: [
          { generationId: first, model: "m-first", op: "t2i", status: "running", step: "Making your picture · step 3 of 8", endedAt: null },
          { generationId: second, model: "m-second", op: "t2i", status: "succeeded", step: null, endedAt: clock - MIN },
        ],
      },
    ]);
    for (let i = 0; i < NEXT_LIMIT + 2; i++) gen({ dependsOn: first });
    expect(liveQueue(clock).next).toHaveLength(NEXT_LIMIT);
    expect(liveQueue(clock).nextTotal).toBe(NEXT_LIMIT + 3);
  });

  it("the jobs waiting in line, in the order the workers serve them, with their place, why, and when their run was made", () => {
    const a = task({ account: "acct-5" });
    const b = task();
    db().prepare("UPDATE relay_tasks SET rank_at = ? WHERE id = ?").run(clock - 9 * MIN, b.id);
    // People first: the account's run ahead of the owner's own, although the owner's came first.
    expect(liveQueue(clock).queued).toEqual([
      { task: a.id, generationId: a.gid, model: "m-test", op: "t2i", lane: LANE, laneLabel: expect.any(String), principal: "user", createdAt: clock, inLineAt: clock, rank: 1, why: "People first", code: "class", override: null, person: expect.stringMatching(/^p-[0-9a-f]{12}$/), guest: false },
      { task: b.id, generationId: b.gid, model: "m-test", op: "t2i", lane: LANE, laneLabel: expect.any(String), principal: "owner", createdAt: clock, inLineAt: clock - 9 * MIN, rank: 2, why: "Our work: after people's runs", code: "class", override: null, person: null, guest: false },
    ]);
    // A worker takes the account's run first (people's runs go before the owner's own): the owner's stays in line.
    const w = worker("takes");
    claim(w);
    expect(liveQueue(clock).queued.map((q) => q.task)).toEqual([b.id]);
    expect(liveQueue(clock).holding).toEqual([expect.objectContaining({ task: a.id, createdAt: clock })]);
  });

  it("the text helper's line: waiting, running and the oldest", () => {
    const add = db().prepare("INSERT INTO helper_jobs (id, who, task, system, user, max_tokens, state, created_at) VALUES (?, 'owner', 'enhance', '', '', 10, ?, ?)");
    add.run("h1", "waiting", clock - 2 * MIN);
    add.run("h2", "waiting", clock - MIN);
    add.run("h3", "running", clock - 5 * MIN);
    add.run("h4", "done", clock - 9 * MIN);
    expect(liveQueue(clock).text).toEqual({ waiting: 2, running: 1, oldestAt: clock - 2 * MIN });
  });
});

describe("GET /api/admin/queue", () => {
  it("keeps its fields and adds what the workers do now; never a prompt or an account's id", async () => {
    // The route reads the real clock (a task is claimable once its time has come: the claim is a moment after it).
    clock = Date.now() + 2000;
    const w = worker("route");
    const { id } = task({ account: "acct-secret" });
    claim(w);
    const { token } = admin.createAdminToken({ name: "queue reader", scopes: ["queue:read"], expiresInDays: null });
    const res = await queueRoute.GET(new NextRequest("http://localhost:3000/api/admin/queue", { headers: { authorization: `Bearer ${token}` } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["controls", "held", "holding", "lanes", "next", "nextTotal", "now", "queued", "running", "text"]);
    expect(body.held).toMatchObject({ mine: 0, oldestAt: null });
    expect(body.holding).toEqual([expect.objectContaining({ task: id, principal: "user" })]);
    expect(JSON.stringify(body)).not.toContain("acct-secret");
  });
});
