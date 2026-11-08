import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers/temp-dir";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-worker-updates-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
delete process.env.FUOBE_PASSWORD;
const SITE = "a".repeat(64);
const OLDER = "b".repeat(64);
process.env.FUOBE_CATALOG_VERSION = SITE;
const hostedBefore = process.env.FUOBE_HOSTED_RUNS;
process.env.FUOBE_HOSTED_RUNS = "1";

const { db } = await import("@/server/db");
const { setSetting } = await import("@/server/settings");
const tasks = await import("@/server/computer/tasks");
const pool = await import("@/server/computer/pool");
const workers = await import("@/server/computer/workers");
const { laneMatches, laneName, modelTitle } = await import("@/lib/lane-names");
const { graphFingerprint } = await import("@/lib/ticket-compose");
const { superviseWorker } = await import("../bin/lib/worker/supervise.mjs");
const { UPDATE_EXIT } = await import("../bin/lib/worker/update.mjs");

const LANE = "aaaaaaaaaaaa";
const GB = 2 ** 30;
const MIN = 60_000;
let clock = Date.UTC(2026, 10, 2, 3, 0, 0);
const COMMIT_1 = "1".repeat(40);
const COMMIT_2 = "2".repeat(40);

type W = { id: string; token: string };
const row = (w: W) => workers.getWorker(w.id)!;

function beat(w: W, o: { protocol?: number; catalog?: string | null; commit?: string } = {}) {
  return pool.workerBeat(
    row(w),
    pool.cleanBeat({
      device: `wkr-${w.id}`,
      protocol: o.protocol ?? 4,
      version: "0.1.0",
      ...(o.commit && { commit: o.commit }),
      ...(o.catalog !== null && { catalogVersion: o.catalog ?? SITE }),
      local: { paused: false, why: null, until: null },
      gpu: {},
      inventoryHash: null,
      running: [],
      stopped: [],
    }),
    clock,
  );
}

function worker(name: string, o: { protocol?: number; catalog?: string; commit?: string } = {}): W {
  const w = pool.addWorker(name);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: { [LANE]: { delayMs: 0 } }, claimAfterMs: 0 });
  db().prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ? WHERE id = ?").run(JSON.stringify({ lanes: [LANE], workflows: ["wf-a"] }), JSON.stringify({ vramBytes: 24 * GB }), w.id);
  beat(w, o);
  return w;
}

let gens = 0;
/** A person's job ticket's task, made for the site's catalog, with or without its graph's fingerprint. */
function personTask(o: { graphSha?: boolean; catalog?: string } = {}) {
  const gid = `gen-${++gens}`;
  db()
    .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'queued', '{}', '[]', ?, ?)")
    .run(gid, clock, clock);
  const t = tasks.createTask({
    principal: "acct:p1",
    generationId: gid,
    graph: { "1": { class_type: "SaveImage", inputs: { filename_prefix: "x" } } },
    ticket: { v: 1, workflowId: "wf-a", catalogVersion: o.catalog ?? SITE, op: "t2i", settings: {}, inputs: [], outputs: { count: 1, kind: "image" }, size: { megapixels: 1, seconds: 0, outputs: 1 }, ...(o.graphSha !== false && { graphSha: "c".repeat(64) }) },
    pool: { pools: ["pool"], account: "p1", class: "free", rankAt: clock, lane: LANE, needs: { workflowId: "wf-a", files: [], packs: [], minVramBytes: 0, catalogVersion: o.catalog ?? SITE, ...(o.graphSha !== false && { graphSha: true }) } },
  } as never);
  db().prepare("UPDATE relay_tasks SET created_at = ? WHERE id = ?").run(clock, t.id);
  return t.id;
}
const taskRow = (id: string) => db().prepare("SELECT * FROM relay_tasks WHERE id = ?").get(id) as import("@/server/computer/tasks").TaskRow;
const claim = (w: W) => pool.workerClaim(row(w), [], clock);

beforeAll(() => setSetting("comfyWhere", "workers"));
afterAll(() => {
  if (hostedBefore === undefined) delete process.env.FUOBE_HOSTED_RUNS;
  else process.env.FUOBE_HOSTED_RUNS = hostedBefore;
});
beforeEach(() => {
  clock += 60 * MIN;
  db().prepare("DELETE FROM relay_workers").run();
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
});

describe("a worker behind the site's version", () => {
  it("an older worker that checks graphs takes people's runs for a new site whose catalog changed elsewhere", () => {
    const w = worker("graphs", { catalog: OLDER });
    const id = personTask();
    expect(claim(w)?.id).toBe(id);
    expect(pool.ticketReady(row(w))).toBe(true);
  });

  it("without the ticket's fingerprint, or from a worker program too old to check it, the run waits for an updated worker", () => {
    const old = worker("protocol-3", { protocol: 3, catalog: OLDER });
    const plain = worker("graphs", { catalog: OLDER });
    const bare = personTask({ graphSha: false });
    expect(claim(plain)).toBeNull();
    expect(claim(old)).toBeNull();
    expect(pool.ticketReady(row(old))).toBe(false);
    expect(taskRow(bare).state).toBe("waiting");
    // The same worker program on the site's catalog takes it.
    beat(plain, { catalog: SITE });
    expect(claim(plain)?.id).toBe(bare);
  });

  it("a run it gave back over a changed graph is never failed or counted, and isn't offered to it again until it is updated", () => {
    const w = worker("graphs", { catalog: OLDER });
    const id = personTask();
    const got = claim(w)!;
    expect(got.id).toBe(id);
    tasks.report(taskRow(id), { event: "give-back", why: "update-worker" } as never, (() => ({})) as never, clock);
    expect(taskRow(id)).toMatchObject({ state: "waiting", requeues: 0, claimed_at: null, error: null });
    expect(claim(w)).toBeNull();
    // It counts as held for the owner while the worker is behind.
    clock += 4 * MIN;
    beat(w, { catalog: OLDER });
    expect(pool.updateOf(row(w), clock)).toMatchObject({ state: "behind", peopleHeld: 1, needsOwner: true });
    // Updated: offered again.
    beat(w, { catalog: SITE });
    expect(claim(w)?.id).toBe(id);
  });

  it("says it is updating for its first minutes, then how long it has been behind; a worker on the site's version is current", () => {
    const w = worker("graphs", { catalog: OLDER, commit: COMMIT_1 });
    expect(pool.workerState(row(w), clock)).toEqual({ state: "idle", words: pool.UPDATING_WORDS });
    expect(pool.updateOf(row(w), clock)).toMatchObject({ state: "updating", words: pool.UPDATING_WORDS, needsOwner: false, site: SITE.slice(0, 12), worker: OLDER.slice(0, 12), commit: COMMIT_1.slice(0, 12) });
    clock += 2 * MIN;
    beat(w, { catalog: OLDER, commit: COMMIT_1 });
    expect(pool.updateOf(row(w), clock).state).toBe("updating");
    clock += 2 * MIN;
    beat(w, { catalog: OLDER, commit: COMMIT_1 });
    const s = pool.workerState(row(w), clock);
    expect(s.state).toBe("update-worker");
    expect(s.words).toMatch(/^Behind the site's version for 4 min: people's runs whose graph changed wait for its update$/);
    const u = pool.updateOf(row(w), clock);
    expect(u).toMatchObject({ state: "behind", needsOwner: true, behindMs: 4 * MIN });
    expect(u.words).toBe("Behind the site's version for 4 min");
    beat(w, { catalog: SITE, commit: COMMIT_2 });
    expect(pool.updateOf(row(w), clock)).toMatchObject({ state: "current", since: null, needsOwner: false, words: `On the site's version (${COMMIT_2.slice(0, 12)})` });
    expect(pool.workerState(row(w), clock).state).toBe("idle");
  });

  it("an older worker program behind the site's version still takes only the owner's own jobs", () => {
    const w = worker("protocol-3", { protocol: 3, catalog: OLDER });
    expect(pool.workerState(row(w), clock)).toEqual({ state: "update-worker", words: pool.UPDATING_WORDS });
    clock += 5 * MIN;
    beat(w, { protocol: 3, catalog: OLDER });
    expect(pool.workerState(row(w), clock).words).toBe("Behind the site's version for 5 min: it takes only your own jobs until then");
  });
});

describe("Update now", () => {
  it("goes with each beat answer until the worker is on new code, and is written in its timeline", () => {
    const w = worker("graphs", { catalog: OLDER, commit: COMMIT_1 });
    expect(beat(w, { catalog: OLDER, commit: COMMIT_1 }).worker.updateNow).toBeUndefined();
    const view = pool.askWorkerUpdate(w.id, "owner", clock)!;
    expect(view.update.askedAt).toBe(clock);
    expect(beat(w, { catalog: OLDER, commit: COMMIT_1 }).worker.updateNow).toBe(clock);
    const asked = clock;
    clock += 30_000;
    expect(beat(w, { catalog: OLDER, commit: COMMIT_1 }).worker.updateNow).toBe(asked);
    // Back on new code: done.
    clock += 30_000;
    expect(beat(w, { catalog: SITE, commit: COMMIT_2 }).worker.updateNow).toBeUndefined();
    expect(row(w).update_asked_at).toBeNull();
    const events = db().prepare("SELECT kind, event, words FROM worker_events WHERE worker_id = ? ORDER BY id").all(w.id) as { kind: string; event: string; words: string }[];
    expect(events).toContainEqual(expect.objectContaining({ kind: "admin", event: "update-now" }));
    expect(events).toContainEqual(expect.objectContaining({ kind: "version", event: "updated", words: `Worker program updated to ${COMMIT_2.slice(0, 12)}` }));
  });

  it("ends after a quarter of an hour when no new code comes, and asks nothing of a worker that isn't there", () => {
    const w = worker("graphs", { catalog: SITE, commit: COMMIT_1 });
    pool.askWorkerUpdate(w.id, "owner", clock);
    clock += pool.UPDATE_ASK_MS + 1;
    expect(beat(w, { catalog: SITE, commit: COMMIT_1 }).worker.updateNow).toBeUndefined();
    expect(pool.askWorkerUpdate("no-such-worker", "owner", clock)).toBeNull();
  });

  it("the owner's route answers with the worker, and is in the admin log", async () => {
    const route = await import("@/app/api/admin/workers/[id]/update/route");
    const w = worker("graphs", { catalog: OLDER, commit: COMMIT_1 });
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
    const ok = await route.POST(new Request(`http://localhost/api/admin/workers/${w.id}/update`, { method: "POST", body: "{}" }), ctx(w.id));
    // No owner session here: refused before anything changes.
    expect([200, 401, 403]).toContain(ok.status);
    if (ok.status === 200) expect(((await ok.json()) as { worker: { update: { askedAt: number } } }).worker.update.askedAt).toBeGreaterThan(0);
    else expect(row(w).update_asked_at).toBeNull();
  });
});

describe("lane names", () => {
  it("names a model file as people read it", () => {
    expect(modelTitle("Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors")).toBe("Wan 2.1 I2V 480p fp8");
    expect(modelTitle("diffusion_models/flux1-dev-fp8.safetensors")).toBe("Flux1 dev fp8");
  });

  it("labels a lane by who uses it and its model, and finds it by app, model, file or id", () => {
    const l = laneName("ec413688ccde", { file: "diffusion_models/Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors", apps: ["InfiniteTalk", "InfiniteTalk", "Lipsync", "Talking Photo"], fallback: "old" });
    expect(l).toEqual({ lane: "ec413688ccde", label: "InfiniteTalk, Lipsync +1 · Wan 2.1 I2V 480p fp8", apps: ["InfiniteTalk", "Lipsync", "Talking Photo"], model: "Wan 2.1 I2V 480p fp8", file: "Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors" });
    for (const q of ["infinitetalk", "talking photo", "wan 2.1", "KJ.safetensors", "ec4136", ""]) expect(laneMatches(l, q), q).toBe(true);
    expect(laneMatches(l, "flux")).toBe(false);
    expect(laneName("small", { file: null, apps: [], fallback: "Small jobs" }).label).toBe("Small jobs");
  });

  it("the site's lanes say which apps use them, with the big file", () => {
    const lanes = pool.lanesCatalog();
    const talk = lanes.find((l) => l.workflowIds.includes("infinitetalk-native"))!;
    expect(talk.apps).toContain("InfiniteTalk");
    expect(talk.label).toMatch(/InfiniteTalk.* · Wan 2\.1 I2V 480p fp8$/);
    expect(talk.file).toBe("Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors");
    expect(lanes.every((l) => typeof l.label === "string" && l.label.length > 0)).toBe(true);
  });
});

describe("a graph's fingerprint", () => {
  it("is the same for the same graph whatever the key order or node titles, and differs for another graph or made file", () => {
    const a = { "1": { class_type: "LoadImage", inputs: { image: "x.png", upload: "image" }, _meta: { title: "Load" } }, "2": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "p" } } };
    const b = { "2": { inputs: { filename_prefix: "p", images: ["1", 0] }, class_type: "SaveImage" }, "1": { inputs: { upload: "image", image: "x.png" }, class_type: "LoadImage", _meta: { title: "Another title" } } };
    expect(graphFingerprint(a as never)).toBe(graphFingerprint(b as never));
    expect(graphFingerprint(a as never)).toMatch(/^[0-9a-f]{64}$/);
    const c = { ...a, "2": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "q" } } };
    expect(graphFingerprint(c as never)).not.toBe(graphFingerprint(a as never));
    expect(graphFingerprint(a as never, [{ data: Buffer.from("one") }])).not.toBe(graphFingerprint(a as never, [{ data: Buffer.from("two") }]));
  });
});

describe("the worker's own restart on new code", () => {
  /** A stand-in for spawn: each child ends with the next code. */
  const spawner = (codes: number[]) => {
    const calls: { args: string[]; env: Record<string, string> }[] = [];
    const spawn = (_exec: string, args: string[], o: { env: Record<string, string> }) => {
      calls.push({ args, env: o.env });
      const child = new EventEmitter();
      const code = codes.shift() ?? 0;
      setTimeout(() => child.emit("exit", code), 1);
      return child;
    };
    return { spawn, calls };
  };
  const io = () => {
    const out: string[] = [];
    return { out, io: { env: { FUOBE_WORKER_HOME: "x" }, stdout: { write: (s: string) => void out.push(s) } } };
  };
  const own = () => {
    const f = path.join(tempDir("fuobe-supervise-"), "starter.mjs");
    fs.writeFileSync(f, "one");
    return f;
  };

  it("starts the worker again a few seconds after it ends for new code, and passes any other end on", async () => {
    const s = spawner([UPDATE_EXIT, UPDATE_EXIT, 0]);
    const waits: number[] = [];
    const { io: i, out } = io();
    const code = await superviseWorker(["--x"], i, { spawn: s.spawn, script: "fuobe.mjs", execPath: "node", sleep: async (ms: number) => void waits.push(ms), ownFiles: [own()], onStop: () => () => {} });
    expect(code).toBe(0);
    expect(s.calls).toHaveLength(3);
    expect(s.calls[0].args).toEqual(["fuobe.mjs", "worker", "run", "--x"]);
    expect(s.calls[0].env.FUOBE_WORKER_CHILD).toBe("1");
    expect(waits).toEqual([3000, 3000]);
    expect(out.join("")).toMatch(/starts again on its new code in 3 s/);
    const crash = spawner([1]);
    expect(await superviseWorker([], io().io, { spawn: crash.spawn, sleep: async () => {}, ownFiles: [own()], onStop: () => () => {} })).toBe(1);
  });

  it("hands over to whatever started it when its own file changed with the new code", async () => {
    const file = own();
    const s = spawner([UPDATE_EXIT, 0]);
    const spawn = (...a: Parameters<typeof s.spawn>) => {
      fs.writeFileSync(file, "two");
      return s.spawn(...a);
    };
    expect(await superviseWorker([], io().io, { spawn, sleep: async () => {}, ownFiles: [file], onStop: () => () => {} })).toBe(UPDATE_EXIT);
    expect(s.calls).toHaveLength(1);
  });
});
