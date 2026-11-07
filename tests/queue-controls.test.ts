import crypto from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { tempDir } from "./helpers/temp-dir";

/**
 * The owner's controls over who the GPUs serve first (src/server/computer/queue-controls.ts): the pool's mode and a
 * worker's own (people first, people only, our work first, balanced), with their ends; a run sent next, pinned to a
 * worker or held; a person boosted or held; what the beat answer and the queue view say; the admin routes, their
 * scope and the admin log.
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 60_000 });

const dir = tempDir("fuobe-queue-controls-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:7";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_HOSTED_RUNS;
delete process.env.FUOBE_BILLING_URL;
globalThis.__fuobeTestDiskFree = 1e13;

const auth = await import("@/server/auth");
const admin = await import("@/server/admin-tokens");
const modeRoute = await import("@/app/api/admin/queue/mode/route");
const overridesRoute = await import("@/app/api/admin/queue/overrides/route");
const overrideRoute = await import("@/app/api/admin/queue/overrides/[id]/route");
const cancelRoute = await import("@/app/api/admin/queue/cancel/route");
const queueRoute = await import("@/app/api/admin/queue/route");
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

const MIN = 60_000;
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
type WorkerRow = import("@/server/computer/workers").WorkerRow;
type TaskRow = import("@/server/computer/tasks").TaskRow;

let alice = "";
let bob = "";

beforeAll(() => {
  auth.setPassword("install password");
  alice = auth.createAccount("controls-a@example.com", "long enough").id;
  bob = auth.createAccount("controls-b@example.com", "long enough").id;
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
const taskRow = (id: string) => db().prepare("SELECT * FROM relay_tasks WHERE id = ?").get(id) as TaskRow;
const done = (id: string) => db().prepare("UPDATE relay_tasks SET state = 'done', finished_at = ? WHERE id = ?").run(Date.now(), id);

let gens = 0;
/** A task in line: a person's (`account`) or the owner's, made `agoMs` ago; returns its task and run ids. */
function job(o: { account?: string; class?: "paid" | "free" | "owner"; agoMs?: number } = {}) {
  const gid = `ctl-gen-${++gens}`;
  const at = Date.now() - (o.agoMs ?? 0);
  db()
    .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'queued', ?, '[]', ?, ?)")
    .run(gid, JSON.stringify(o.account ? { account: o.account, place: "pool" } : {}), at, at);
  const t = tasks.createTask({
    principal: o.account ? `acct:${o.account}` : "owner",
    generationId: gid,
    graph: { "1": { class_type: "SaveImage", inputs: { filename_prefix: "x" } } },
    pool: { pools: ["pool"], account: o.account, class: o.class, rankAt: at, lane: allLanes(loadIndex(), sha)[0].lane, needs: { workflowId: loadManifest().workflows[0].id, files: [], packs: [], minVramBytes: 0 } },
  });
  db().prepare("UPDATE relay_tasks SET created_at = ? WHERE id = ?").run(at, t.id);
  return { id: t.id, gid };
}

/** Every waiting task this worker takes, one by one, each finished at once. */
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

const setMode = (body: Record<string, unknown>, now = Date.now()) => {
  const c = qc.checkModeChange(body, "owner", now);
  if ("error" in c) throw new Error(c.error);
  return qc.applyModeChange(c, now);
};
const override = (body: Record<string, unknown>, now = Date.now()) => {
  const o = qc.checkOverride(body, now);
  if ("error" in o) throw new Error(o.error);
  const r = qc.addOverride(o, "owner", now);
  if ("error" in r) throw new Error(r.error);
  return r.override;
};

describe("modes", () => {
  it("people first (the default): people's runs before the owner's own; the beat says so, with local work making room", () => {
    const w = worker("w1");
    const owner = job({ agoMs: 60 * MIN });
    const a = job({ account: alice, agoMs: 10 * MIN });
    const answer = beat(w);
    expect(answer.worker.queue).toEqual({ mode: "people-first", localWork: "yield", until: null });
    expect(served(w)).toEqual([a.id, owner.id]);
  });

  it("our work first: the owner's own jobs first, with a person's place counting them; local work keeps the GPU while it runs", () => {
    const w = worker("w1");
    const a = job({ account: alice, agoMs: 30 * MIN });
    const owner = job({ agoMs: 1 * MIN });
    setMode({ mode: "ours-first", forMin: 30 });
    expect(pool.placeInLine(taskRow(a.id)).place).toBe(2);
    // Local work on its PC runs: people's runs ask it for no room; once it is idle they do.
    expect(beat(w, { localWork: { state: "running", why: null, waiting: 12, running: true, at: Date.now() } }).claimableNow).toBe(0);
    expect(beat(w, { localWork: { state: "idle", why: "no-work", waiting: 0, running: false, at: Date.now() } }).claimableNow).toBe(1);
    const answer = beat(w);
    expect(answer.worker.queue).toMatchObject({ mode: "ours-first", localWork: "run" });
    expect(answer.worker.queue!.until).toBeGreaterThan(Date.now() + 29 * MIN);
    expect(served(w)).toEqual([owner.id, a.id]);
  });

  it("people only: the owner's own jobs are never taken and their count is 0; local work pauses; they are listed with no place", () => {
    const w = worker("w1");
    const owner = job({ agoMs: 60 * MIN });
    const a = job({ account: alice, agoMs: 1 * MIN });
    setMode({ mode: "people-only", forMin: null });
    const answer = beat(w);
    expect(answer.worker.queue).toEqual({ mode: "people-only", localWork: "pause", until: null });
    expect(answer.ownerWaitingNow).toBe(0);
    expect(answer.claimableNow).toBe(1);
    expect(served(w)).toEqual([a.id]);
    const q = liveQueue().queued;
    expect(q).toEqual([expect.objectContaining({ task: owner.id, rank: null, code: "paused", why: "Waits: People only", person: null })]);
    // Back to normal: the owner's job goes.
    setMode({ mode: null });
    expect(served(w)).toEqual([owner.id]);
  });

  it("balanced: free runs and the owner's own jobs in one line by when they came; paid runs first", () => {
    const w = worker("w1");
    const owner = job({ agoMs: 30 * MIN });
    const a = job({ account: alice, agoMs: 20 * MIN });
    const paid = job({ account: bob, class: "paid", agoMs: 1 * MIN });
    setMode({ mode: "balanced", forMin: 60 });
    expect(served(w)).toEqual([paid.id, owner.id, a.id]);
  });

  it("a worker's own mode wins over its pool's; back to normal follows the pool again", () => {
    const w1 = worker("w1");
    const w2 = worker("w2");
    setMode({ mode: "people-only", forMin: 60 });
    setMode({ worker: w2.id, mode: "ours-first", forMin: 30 });
    expect(beat(w1).worker.queue!.mode).toBe("people-only");
    expect(beat(w2).worker.queue!.mode).toBe("ours-first");
    expect(pool.workerView(row(w2)).mode).toMatchObject({ mode: "ours-first", from: "worker", by: "owner" });
    setMode({ worker: w2.id, mode: null });
    expect(pool.workerView(row(w2)).mode).toMatchObject({ mode: "people-only", from: "pool" });
  });

  it("a mode ends at its time: people first again, and the admin log says so (system)", () => {
    const w = worker("w1");
    const now = Date.now();
    setMode({ mode: "ours-first", forMin: 1 }, now);
    setMode({ worker: w.id, mode: "people-only", forMin: 1 }, now);
    expect(qc.poolMode("pool", now + 30_000).mode).toBe("ours-first");
    const later = now + 2 * MIN;
    expect(qc.poolMode("pool", later).mode).toBe("people-first");
    beat(w, {}, later);
    expect(qc.poolModes(later + 5000)).toEqual({});
    expect(row(w).mode_json).toBeNull();
    const ends = db().prepare("SELECT actor, target, detail_json FROM admin_audit WHERE action = 'queue.mode.end' ORDER BY id").all() as { actor: string; target: string; detail_json: string }[];
    expect(ends.map((e) => [e.actor, e.target])).toEqual([
      ["system", "pool:pool"],
      ["system", `worker:${w.id}`],
    ]);
  });

  it("checks a change: known modes, 1 minute to a week, a pool or a worker", () => {
    expect(qc.checkModeChange({ mode: "everything" }, "owner")).toEqual({ error: expect.stringMatching(/^mode is one of/) });
    expect(qc.checkModeChange({ mode: "ours-first", forMin: 0 }, "owner")).toEqual({ error: expect.stringMatching(/^forMin is 1 to 10080/) });
    expect(qc.checkModeChange({ mode: "ours-first", forMin: 10081 }, "owner")).toHaveProperty("error");
    expect(qc.checkModeChange({ mode: "ours-first", pool: "pool", worker: "x" }, "owner")).toHaveProperty("error");
    expect(qc.checkModeChange({ mode: null, forMin: 5 }, "owner")).toHaveProperty("error");
    expect(qc.checkModeChange({ mode: "ours-first", extra: 1 }, "owner")).toEqual({ error: "Unknown field: extra" });
    // People first with no end on a pool is the default: stored as none.
    expect(qc.checkModeChange({ mode: "people-first" }, "owner")).toEqual({ scope: "pool", pool: "pool", setting: null });
  });
});

describe("runs and people", () => {
  it("run next goes ahead of every class, paid runs too; it ends once its run ends", () => {
    const w = worker("w1");
    const paid = job({ account: bob, class: "paid", agoMs: 30 * MIN });
    const owner = job({ agoMs: 1 * MIN });
    const o = override({ kind: "run", generationId: owner.gid, action: "next" });
    expect(pool.placeInLine(taskRow(paid.id)).place).toBe(2);
    expect(liveQueue().queued.map((q) => [q.task, q.rank, q.code])).toEqual([
      [owner.id, 1, "next"],
      [paid.id, 2, "class"],
    ]);
    expect(served(w)).toEqual([owner.id, paid.id]);
    db().prepare("UPDATE generations SET status = 'succeeded' WHERE id = ?").run(owner.gid);
    qc.sweepControls();
    expect(qc.liveOverrides().map((x) => x.id)).not.toContain(o.id);
    expect(qc.recentOverrides(1)[0]).toMatchObject({ id: o.id, endWhy: "run-ended", endedBy: "system" });
  });

  it("pinned to a worker: only that worker takes it, first", () => {
    const w1 = worker("w1");
    const w2 = worker("w2");
    const a = job({ account: alice, agoMs: 30 * MIN });
    const owner = job({ agoMs: 1 * MIN });
    override({ kind: "run", generationId: owner.gid, action: "next", worker: w2.id });
    expect(served(w1)).toEqual([a.id]);
    expect(served(w2)).toEqual([owner.id]);
  });

  it("a held run keeps its place, isn't taken or counted, shows as held, and goes once released", () => {
    const w = worker("w1");
    const a = job({ account: alice, agoMs: 30 * MIN });
    const b = job({ account: bob, agoMs: 1 * MIN });
    const o = override({ kind: "run", generationId: a.gid, action: "hold", forMin: 60 });
    expect(beat(w).claimableNow).toBe(1);
    expect(pool.placeInLine(taskRow(b.id)).place).toBe(1);
    expect(liveQueue().queued.find((q) => q.task === a.id)).toMatchObject({ rank: null, code: "held", why: "Held by the owner", override: { id: o.id, by: "owner" } });
    expect(served(w)).toEqual([b.id]);
    expect(qc.endOverride(o.id, "owner", "released")).toMatchObject({ endWhy: "released" });
    expect(served(w)).toEqual([a.id]);
  });

  it("a boosted person's runs go first until the boost ends; a held person's wait", () => {
    const w = worker("w1");
    const a1 = job({ account: alice, agoMs: 30 * MIN });
    const b1 = job({ account: bob, agoMs: 20 * MIN });
    const b2 = job({ account: bob, agoMs: 10 * MIN });
    const now = Date.now();
    override({ kind: "person", person: qc.personKey(bob), action: "boost", forMin: 30 }, now);
    expect(liveQueue().queued.slice(0, 2).map((q) => [q.task, q.code, q.why])).toEqual([
      [b1.id, "boost", "Boosted: this person's runs first"],
      [b2.id, "boost", "Boosted: this person's runs first"],
    ]);
    expect(served(w)).toEqual([b1.id, b2.id, a1.id]);
    const a2 = job({ account: alice });
    const c = job({ account: bob });
    override({ kind: "person", account: alice, action: "hold" });
    expect(served(w)).toEqual([c.id]);
    expect(taskRow(a2.id).state).toBe("waiting");
  });

  it("our work first: a boosted person's run still asks local work for room", () => {
    const w = worker("w1");
    job({ account: alice });
    job({ account: bob });
    setMode({ mode: "ours-first", forMin: 30 });
    override({ kind: "person", account: bob, action: "boost", forMin: 30 });
    expect(beat(w, { localWork: { state: "running", why: null, waiting: 3, running: true, at: Date.now() } }).claimableNow).toBe(1);
  });

  it("a boost ends at its time", () => {
    const w = worker("w1");
    const a = job({ account: alice, agoMs: 30 * MIN });
    const b = job({ account: bob, agoMs: 1 * MIN });
    const now = Date.now();
    const o = override({ kind: "person", account: bob, action: "boost", forMin: 1 }, now - 2 * MIN);
    qc.sweepControls(now);
    expect(qc.recentOverrides(1)[0]).toMatchObject({ id: o.id, endWhy: "expired" });
    expect(served(w)).toEqual([a.id, b.id]);
  });

  it("checks a change", () => {
    expect(qc.checkOverride({ kind: "person", account: alice, action: "boost" })).toEqual({ error: expect.stringMatching(/^forMin/) });
    expect(qc.checkOverride({ kind: "run", generationId: "x", action: "boost" })).toHaveProperty("error");
    expect(qc.checkOverride({ kind: "run", generationId: "x", action: "hold", worker: "w" })).toEqual({ error: "Only Run next is pinned to a worker" });
    expect(qc.checkOverride({ kind: "person", account: alice, person: "p-000000000000", action: "hold" })).toHaveProperty("error");
    expect(qc.checkOverride({ kind: "thing" })).toEqual({ error: "kind is run or person" });
    // Run next lasts at most a day.
    const now = Date.now();
    expect(qc.checkOverride({ kind: "run", generationId: "x", action: "next", forMin: 5000 }, now)).toMatchObject({ until: now + 24 * 60 * MIN });
  });
});

describe("local work on the PC", () => {
  it("the beat keeps it (codes and counts only) while fresh; the worker's view shows it", () => {
    const w = worker("w1");
    const now = Date.now();
    beat(w, { localWork: { state: "paused", why: "people-only", waiting: 77, running: false, at: now + 5 * MIN, name: "secret job" } }, now);
    expect(JSON.parse(row(w).local_work_json!)).toEqual({ state: "paused", why: "people-only", waiting: 77, running: false, at: now });
    expect(pool.workerView(row(w), now).localWork).toMatchObject({ state: "paused", waiting: 77 });
    expect(pool.workerView(row(w), now + 3 * MIN).localWork).toBeNull();
    expect(pool.cleanLocalWork({ state: "exploding", at: now })).toBeNull();
    expect(pool.cleanLocalWork({ state: "idle", why: "Not A Code!", at: now })).toMatchObject({ why: null });
  });
});

describe("the admin routes", () => {
  const post = (route: { POST: (r: Request) => Promise<Response> }, path: string, body: unknown, token?: string) =>
    route.POST(new NextRequest(`http://localhost:3000${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) } }));

  it("need queue:control; a reader can't change anything; every change is in the admin log", async () => {
    const reader = admin.createAdminToken({ name: "reader", scopes: ["queue:read"], expiresInDays: null }).token;
    const controller = admin.createAdminToken({ name: "controller", scopes: ["queue:read", "queue:control"], expiresInDays: null }).token;
    expect((await post(modeRoute, "/api/admin/queue/mode", { mode: "people-only" }, reader)).status).toBe(403);
    const bad = await post(modeRoute, "/api/admin/queue/mode", { mode: "nobody" }, controller);
    expect(bad.status).toBe(400);
    const ok = await post(modeRoute, "/api/admin/queue/mode", { mode: "ours-first", forMin: 30 }, controller);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ mode: { mode: "ours-first", from: "pool", by: "controller" }, before: { mode: "people-first" } });
    const missing = await post(modeRoute, "/api/admin/queue/mode", { worker: "nope", mode: "people-only" }, controller);
    expect(missing.status).toBe(404);
    const log = db().prepare("SELECT token_name, target, status FROM admin_audit WHERE action = 'queue.mode' ORDER BY id").all();
    expect(log).toEqual([
      { token_name: "controller", target: null, status: 400 },
      { token_name: "controller", target: "pool:pool", status: 200 },
      { token_name: "controller", target: "worker:nope", status: 404 },
    ]);
  });

  it("overrides: add by a person's key, list, release; the answers name no account", async () => {
    const controller = admin.createAdminToken({ name: "controller2", scopes: ["queue:read", "queue:control"], expiresInDays: null }).token;
    job({ account: alice });
    const none = await post(overridesRoute, "/api/admin/queue/overrides", { kind: "person", person: "p-000000000000", action: "hold" }, controller);
    expect(none.status).toBe(404);
    const made = await post(overridesRoute, "/api/admin/queue/overrides", { kind: "person", person: qc.personKey(alice), action: "boost", forMin: 15 }, controller);
    expect(made.status).toBe(201);
    const body = (await made.json()) as { override: { id: string; person: string; by: string } };
    expect(body.override).toMatchObject({ person: qc.personKey(alice), by: "controller2", action: "boost" });
    expect(JSON.stringify(body)).not.toContain(alice);
    const list = await overridesRoute.GET(new NextRequest("http://localhost:3000/api/admin/queue/overrides", { headers: { authorization: `Bearer ${controller}` } }));
    expect(((await list.json()) as { live: { id: string }[] }).live.map((o) => o.id)).toEqual([body.override.id]);
    const del = (id: string) =>
      overrideRoute.DELETE(new NextRequest(`http://localhost:3000/api/admin/queue/overrides/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${controller}` } }), { params: Promise.resolve({ id }) } as never);
    expect((await del(body.override.id)).status).toBe(200);
    expect((await del(body.override.id)).status).toBe(404);
    expect(db().prepare("SELECT action, status FROM admin_audit WHERE action LIKE 'queue.override%' AND actor != 'system' ORDER BY id").all()).toEqual([
      { action: "queue.override", status: 404 },
      { action: "queue.override", status: 201 },
      { action: "queue.override.end", status: 200 },
      { action: "queue.override.end", status: 404 },
    ]);
  });

  it("cancel: a waiting run ends canceled; one that ended is 409; none is 404", async () => {
    const controller = admin.createAdminToken({ name: "controller3", scopes: ["queue:control"], expiresInDays: null }).token;
    const a = job({ account: alice });
    expect((await post(cancelRoute, "/api/admin/queue/cancel", { generationId: "nope" }, controller)).status).toBe(404);
    const r = await post(cancelRoute, "/api/admin/queue/cancel", { generationId: a.gid }, controller);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ generationId: a.gid, status: "canceled" });
    expect((await post(cancelRoute, "/api/admin/queue/cancel", { generationId: a.gid }, controller)).status).toBe(409);
  });

  it("GET /api/admin/queue shows the controls: each pool's mode, each worker's, the overrides, and why each run stands where it does", async () => {
    const w = worker("w1");
    job({ account: alice });
    setMode({ worker: w.id, mode: "people-only", forMin: 20 });
    const reader = admin.createAdminToken({ name: "reader2", scopes: ["queue:read"], expiresInDays: null }).token;
    const res = await queueRoute.GET(new NextRequest("http://localhost:3000/api/admin/queue", { headers: { authorization: `Bearer ${reader}` } }));
    const body = (await res.json()) as { controls: { pools: Record<string, { mode: string }>; workers: { name: string; mode: { mode: string; from: string } }[]; modes: unknown[] }; queued: { why: string; person: string }[] };
    expect(body.controls.pools.pool.mode).toBe("people-first");
    expect(body.controls.workers).toEqual([expect.objectContaining({ name: "w1", mode: expect.objectContaining({ mode: "people-only", from: "worker" }) })]);
    expect(body.controls.modes).toHaveLength(4);
    expect(body.queued[0]).toMatchObject({ why: "People first", person: qc.personKey(alice) });
    expect(JSON.stringify(body)).not.toContain(alice);
  });
});
