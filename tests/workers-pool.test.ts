import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-workers-pool-"));
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
const { forWorkers } = await import("@/server/providers/comfyui");
const { hoursAt, parseHours } = await import("@/lib/worker-hours");
const { lanesFor, needsOf, laneOf } = await import("@/lib/lanes");
const { loadIndex } = await import("@/server/gpu/index-file");

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
    pool.cleanBeat({ device: `wkr-${w.id}`, protocol: 1, version: "1.0.0", local: { paused: local.paused ?? false, why: local.why ?? null, until: null }, gpu: {}, inventoryHash: null, running: running.map((task) => ({ task })), stopped: [] }),
    clock,
  );
}

const claim = (w: W, running: string[] = []) => pool.workerClaim(row(w), running, clock);

let gens = 0;
function task(o: { lane?: string; workflow?: string; minVram?: number; rankAgoMs?: number; estMs?: number; notAfter?: number } = {}) {
  const gid = `gen-${++gens}`;
  db()
    .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'queued', '{}', '[]', ?, ?)")
    .run(gid, clock, clock);
  const created = clock - (o.rankAgoMs ?? 0);
  const t = tasks.createTask({
    principal: "owner",
    generationId: gid,
    graph: { "1": { class_type: "SaveImage", inputs: { filename_prefix: "x" } } },
    pool: { pools: ["pool"], rankAt: created, lane: o.lane ?? LANE_A, needs: { workflowId: o.workflow ?? "wf-a", files: [], packs: [], minVramBytes: o.minVram ?? 0 }, estMs: o.estMs, notAfter: o.notAfter },
  });
  db().prepare("UPDATE relay_tasks SET created_at = ? WHERE id = ?").run(created, t.id);
  return t.id;
}
/** "HH:MM" in UTC, some minutes from the test's clock. */
const at = (minutes: number) => new Date(clock + minutes * MIN).toISOString().slice(11, 16);
const everyDay = (from: string, to: string) => ({ tz: "UTC", days: Object.fromEntries(["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [d, [[from, to]]])) });

const state = (id: string) => db().prepare("SELECT * FROM relay_tasks WHERE id = ?").get(id) as import("@/server/computer/tasks").TaskRow;

beforeAll(() => setSetting("comfyWhere", "workers"));
afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});
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
    const a = pool.workerBeat(row({ id: w.id, token: w.token }), pool.cleanBeat({ device: "x", protocol: 1, version: "1", local: { paused: true, why: "here" } }), clock);
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
  it("sticky lanes: the warm lane goes first until another lane's best task passes switch_after_ms", () => {
    const w = worker("sticky", { lanes: [LANE_A, LANE_B] });
    db().prepare("UPDATE relay_workers SET warm_lane = ?, switch_after_ms = ? WHERE id = ?").run(LANE_A, 30 * MIN, w.id);
    const b = task({ lane: LANE_B, rankAgoMs: 10 * MIN });
    const a = task({ lane: LANE_A, rankAgoMs: 1 * MIN });
    expect(claim(w)?.id).toBe(a);
    db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE id = ?").run(a);
    const a2 = task({ lane: LANE_A, rankAgoMs: 0 });
    db().prepare("UPDATE relay_tasks SET rank_at = ? WHERE id = ?").run(clock - 31 * MIN, b);
    expect(claim(w)?.id).toBe(b);
    expect(state(a2).state).toBe("waiting");
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

  it("the owner's tasks go by rank_at, not by arrival", () => {
    const w = worker("rank");
    const later = task({ rankAgoMs: 0 });
    const boosted = task({ rankAgoMs: pool.OWNER_BOOST_MS });
    expect(claim(w)?.id).toBe(boosted);
    expect(state(later).state).toBe("waiting");
  });
});

describe("routes", () => {
  it("three workers that beat every 5 seconds are not rate-limited (check 14)", async () => {
    clock = Date.now();
    const ws = [worker("r1"), worker("r2"), worker("r3")];
    let ok = 0;
    for (let i = 0; i < 12; i++) {
      for (const w of ws) {
        const res = await beatRoute.POST(new Request("http://localhost:3000/api/gpu/computer/beat", { method: "POST", headers: { host: "localhost:3000", authorization: `Bearer ${w.token}`, "content-type": "application/json" }, body: JSON.stringify({ device: "x", protocol: 1, version: "1", local: { paused: false } }) }));
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
    expect(t.runLimitMs).toBe(5 * MIN);
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
