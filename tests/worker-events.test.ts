import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LogRing, maskLine } from "../bin/lib/worker/log-ring.mjs";
import { tempDir } from "./helpers/temp-dir";

/**
 * Each worker's timeline (worker_events) and its admin route: a row for each change of state, handoff, stage, claim
 * answer, admin action and version, never one per beat; the worker's own log lines from its beat, masked on both sides;
 * pages by id; old rows pruned. Every write is best-effort.
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-worker-events-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:7";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_HOSTED_RUNS;

const auth = await import("@/server/auth");
const { db, RELAY_TABLES } = await import("@/server/db");
const { setSetting } = await import("@/server/settings");
const tasks = await import("@/server/computer/tasks");
const pool = await import("@/server/computer/pool");
const events = await import("@/server/computer/worker-events");
const eventsRoute = await import("@/app/api/admin/workers/events/route");
const { createAdminToken } = await import("@/server/admin-tokens");
const { RELAY_TIMES } = await import("@/lib/relay");

const HOST = "localhost:3000";
const MIN = 60_000;
const LANE = "aaaaaaaaaaaa";
let clock = Date.now();

type W = { id: string; token: string };
type WorkerRow = import("@/server/computer/workers").WorkerRow;
const workerRow = (w: { id: string }) => db().prepare("SELECT * FROM relay_workers WHERE id = ?").get(w.id) as WorkerRow;
const taskRow = (id: string) => db().prepare("SELECT * FROM relay_tasks WHERE id = ?").get(id) as import("@/server/computer/tasks").TaskRow;

function worker(name: string): W {
  const w = pool.addWorker(name);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: { [LANE]: { delayMs: 0 } }, claimAfterMs: 0 }, clock);
  db().prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ? WHERE id = ?").run(JSON.stringify({ lanes: [LANE], workflows: ["wf-a"] }), JSON.stringify({ vramBytes: 24 * 2 ** 30 }), w.id);
  return w;
}

function beat(w: W, o: { now?: number; local?: { paused: boolean; why: string | null }; running?: { task: string; value?: number; max?: number }[]; version?: string; log?: unknown } = {}) {
  return pool.workerBeat(
    workerRow(w),
    pool.cleanBeat({ device: `wkr-${w.id}`, protocol: 2, version: o.version ?? "1.0.0", local: { ...(o.local ?? { paused: false, why: null }), until: null }, gpu: {}, inventoryHash: null, running: o.running ?? [], stopped: [], ...(o.log !== undefined && { log: o.log }) }),
    o.now ?? clock,
  );
}
const claim = (w: W, running: string[] = [], now = clock) => pool.workerClaim(workerRow(w), running, now);

let gens = 0;
function task(o: { lane?: string } = {}) {
  const gid = `ev-gen-${++gens}`;
  db()
    .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'queued', '{}', '[]', ?, ?)")
    .run(gid, clock, clock);
  const t = tasks.createTask({
    principal: "owner",
    generationId: gid,
    graph: { "1": { class_type: "SaveImage", inputs: { filename_prefix: "x" } } },
    pool: { pools: ["pool"], rankAt: clock - MIN, lane: o.lane ?? LANE, needs: { workflowId: "wf-a", files: [], packs: [], minVramBytes: 0 } },
  });
  db().prepare("UPDATE relay_tasks SET created_at = ? WHERE id = ?").run(clock - MIN, t.id);
  return { id: t.id, generationId: gid };
}

type Ev = { id: number; at: number; kind: string; event: string; words: string | null; task_id: string | null; worker_id: string | null; state: string | null; detail_json: string | null };
const rowsOf = (w: { id: string }, kind?: string) =>
  db()
    .prepare(`SELECT * FROM worker_events WHERE worker_id = ? ${kind ? "AND kind = ?" : ""} ORDER BY id`)
    .all(...(kind ? [w.id, kind] : [w.id])) as Ev[];
const detail = (e: Ev) => JSON.parse(e.detail_json ?? "{}") as Record<string, unknown>;

beforeAll(() => {
  auth.setPassword("install password");
});
beforeEach(() => {
  setSetting("comfyWhere", "workers");
  clock += 60 * MIN;
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
  db().prepare("UPDATE relay_workers SET revoked_at = 1 WHERE revoked_at IS NULL").run();
});

describe("state and version rows", () => {
  it("a state row only when its state changes, never once per beat", () => {
    const w = worker("steady");
    for (let i = 0; i < 5; i++) beat(w, { now: clock + i * 5000 });
    expect(rowsOf(w, "state").map((e) => e.event)).toEqual(["idle"]);
    expect(detail(rowsOf(w, "state")[0])).toMatchObject({ from: "new" });
    beat(w, { now: clock + 30_000, local: { paused: true, why: "gpu-busy:blender.exe" } });
    beat(w, { now: clock + 35_000, local: { paused: true, why: "gpu-busy:blender.exe" } });
    beat(w, { now: clock + 40_000 });
    const s = rowsOf(w, "state");
    expect(s.map((e) => e.event)).toEqual(["idle", "gpu-busy", "idle"]);
    expect(s[1].words).toBe("Your GPU is busy (blender.exe)");
    expect(detail(s[2])).toMatchObject({ from: "gpu-busy" });
  });

  it("silent past the limit: one offline row, then back with a row from offline", () => {
    const w = worker("quiet");
    beat(w);
    const later = clock + RELAY_TIMES.poolSilentMs + MIN;
    pool.noteSilentWorkers(later);
    pool.noteSilentWorkers(later + 5000);
    pool.sweepPool(later + 6000);
    const off = rowsOf(w, "state").filter((e) => e.event === "offline");
    expect(off).toHaveLength(1);
    expect(off[0].at).toBe(clock + RELAY_TIMES.poolSilentMs);
    expect(detail(off[0])).toMatchObject({ from: "idle", seenAt: clock });
    beat(w, { now: later + 10_000 });
    expect(rowsOf(w, "state").map((e) => e.event)).toEqual(["idle", "offline", "idle"]);
  });

  it("a version row when its worker program's version changes", () => {
    const w = worker("updated");
    beat(w, { version: "1.0.0" });
    beat(w, { version: "1.0.0", now: clock + 5000 });
    beat(w, { version: "1.1.0", now: clock + 10_000 });
    const v = rowsOf(w, "version");
    expect(v).toHaveLength(1);
    expect(detail(v[0])).toEqual({ from: "1.0.0", to: "1.1.0" });
  });
});

describe("looking rows", () => {
  it("only when the answer to its claims changes; asked_at and asked_words at every claim", () => {
    const w = worker("looker");
    beat(w);
    expect(claim(w)).toBeNull();
    expect(claim(w, [], clock + 1000)).toBeNull();
    expect(workerRow(w).asked_at).toBe(clock + 1000);
    expect(workerRow(w).asked_words).toBe("Asked for work: nothing waiting");
    // Waiting work in another lane: still "nothing", and no new row.
    task({ lane: "bbbbbbbbbbbb" });
    expect(claim(w, [], clock + 2000)).toBeNull();
    expect(workerRow(w).asked_words).toBe("Asked for work: 1 waiting, none it can run now");
    const a = task();
    expect(claim(w, [], clock + 3000)?.id).toBe(a.id);
    // Holding a job: no answer to note.
    expect(claim(w, [a.id], clock + 4000)).toBeNull();
    tasks.endTask(a.id, "canceled", { error: "Stopped" });
    expect(claim(w, [], clock + 5000)).toBeNull();
    pool.patchWorker(w.id, { paused: true }, clock + 6000);
    beat(w, { now: clock + 6000 });
    expect(claim(w, [], clock + 7000)).toBeNull();
    expect(claim(w, [], clock + 8000)).toBeNull();
    const l = rowsOf(w, "looking");
    expect(l.map((e) => e.event)).toEqual(["nothing", "found", "nothing", "blocked"]);
    expect(l[3].words).toBe("Asked for work: not taking work (paused on the website)");
    expect(pool.listWorkers(clock + 8000).find((x) => x.id === w.id)?.asked).toEqual({ at: clock + 8000, words: l[3].words });
  });
});

describe("job and stage rows", () => {
  const plan = () => ({ wanted: [{ n: 0, filename: "x.png", subfolder: "", type: "output" as const, kind: "image" as const, maxBytes: 1e6 }], outputs: [], budget: 1 });

  it("job rows mirror worker_jobs, in words; stage rows only when the stage changes", () => {
    const w = worker("runner");
    beat(w);
    const a = task();
    const c = claim(w)!;
    expect(c.id).toBe(a.id);
    const rep = (e: Parameters<typeof tasks.report>[1], now: number) => tasks.report(taskRow(a.id), e, plan, now);
    rep({ event: "sent", promptId: "11111111-2222-3333-4444-555555555555" }, clock + 1000);
    rep({ event: "queued", position: 2 }, clock + 1500);
    rep({ event: "running" } as never, clock + 2000);
    rep({ event: "running", value: 1, max: 20 } as never, clock + 3000);
    rep({ event: "running", value: 2, max: 20 } as never, clock + 4000);
    beat(w, { now: clock + 5000, running: [{ task: a.id, value: 3, max: 20 }] });
    rep({ event: "finished", entry: { outputs: {} } } as never, clock + 6000);
    tasks.endTask(a.id, "done");
    const stages = rowsOf(w, "stage").filter((e) => e.task_id === a.id);
    // Taken cold (no lane warm): loading until its first step, then running.
    expect(stages.map((e) => e.event)).toEqual(["sending", "queued", "loading", "running", "saving"]);
    const jobs = rowsOf(w, "job").filter((e) => e.task_id === a.id);
    const log = db().prepare("SELECT event FROM worker_jobs WHERE task_id = ? ORDER BY id").all(a.id) as { event: string }[];
    expect(jobs.map((e) => e.event)).toEqual(log.map((x) => x.event));
    expect(jobs.map((e) => e.event)).toEqual(["claimed", "finished", "done"]);
    expect(jobs[0].words).toMatch(/^Took a .+ run$/);
    expect(jobs[2].words).toMatch(/^Delivered after \d+/);
  });

  it("a job sent back says why and how many tries; claimed again, it starts at sending", () => {
    const w = worker("lost");
    beat(w);
    const a = task();
    expect(claim(w)?.id).toBe(a.id);
    const later = clock + RELAY_TIMES.poolSilentMs + MIN;
    pool.sweepPool(later);
    beat(w, { now: later + 1000 });
    expect(claim(w, [], later + 1000)?.id).toBe(a.id);
    const jobs = rowsOf(w, "job").filter((e) => e.task_id === a.id);
    expect(jobs.map((e) => e.event)).toEqual(["claimed", "requeued", "claimed"]);
    expect(jobs[1].words).toBe("Sent back in line: went silent");
    expect(detail(jobs[1])).toMatchObject({ why: "went silent", tries: 1 });
    expect(rowsOf(w, "stage").filter((e) => e.task_id === a.id).map((e) => e.event)).toEqual(["sending", "sending"]);
  });

  it("the worker view lists each job it holds, the stage, and its last event", () => {
    const w = worker("viewed");
    beat(w);
    const a = task();
    claim(w);
    const v = pool.listWorkers(clock).find((x) => x.id === w.id)!;
    expect(v.jobs).toHaveLength(1);
    expect(v.jobs[0]).toMatchObject({ taskId: a.id, generationId: a.generationId, slot: "gpu", lane: LANE, stage: "sending", state: "sending", owners: "owner", feature: "image", modelName: "m" });
    expect(v.current?.taskId).toBe(a.id);
    expect(v.lastEvent?.kind).toBe("stage");
    expect(JSON.stringify(v.jobs)).not.toContain("SaveImage");
  });
});

describe("admin rows", () => {
  it("each admin action with who did it; an edit names its keys, never their values", () => {
    const w = worker("managed");
    beat(w);
    pool.patchWorker(w.id, { pauseNow: true }, clock + 1000, "panel token");
    pool.patchWorker(w.id, { paused: false, hours: { always: true } }, clock + 2000);
    pool.patchWorker(w.id, { drain: true }, clock + 3000);
    const a = rowsOf(w, "admin").filter((e) => e.at >= clock + 1000);
    expect(a.map((e) => e.event)).toEqual(["pause-now", "resume", "edit", "drain"]);
    expect(detail(a[0])).toEqual({ by: "panel token" });
    expect(detail(a[2])).toEqual({ by: "owner", keys: ["hours"] });
    expect(a[2].detail_json).not.toContain("always");
    // The state it leads to, at once.
    expect(rowsOf(w, "state").filter((e) => e.at >= clock + 1000).map((e) => e.event)).toEqual(["paused", "idle", "paused"]);
  });
});

describe("log lines in the beat", () => {
  it("kept as log rows, masked again here, at most 40 a beat, never later than now", () => {
    const w = worker("talker");
    beat(w);
    const lines = Array.from({ length: 50 }, (_, i) => ({ at: clock - 1000 + i, level: i === 0 ? "error" : "info", line: `line ${i}` }));
    lines[1].line = "Saved its next token fuobe_wkr_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123 in C:\\Users\\me\\worker.json";
    lines[2] = { at: clock + 10 * MIN, level: "loud", line: "Bearer abc.def from someone@example.com at https://studio.example/api?key=1" };
    beat(w, { now: clock + 1000, log: lines });
    const l = rowsOf(w, "log");
    expect(l).toHaveLength(40);
    expect(l[0]).toMatchObject({ event: "error", words: "line 0", at: clock - 1000 });
    expect(l[1].words).toBe("Saved its next token [hidden] in [file]");
    expect(l[2]).toMatchObject({ event: "info", at: clock + 1000, words: "Bearer [hidden] from [email] at https://studio.example/api?[hidden]" });
  });

  it("a beat without log, or with a log that isn't a list of lines, works as before", () => {
    const w = worker("quiet-log");
    expect(beat(w).runner).toBe(true);
    expect(beat(w, { log: "not a list", now: clock + 1000 }).runner).toBe(true);
    expect(beat(w, { log: [null, 3, { line: 7 }, { line: "" }], now: clock + 2000 }).runner).toBe(true);
    expect(rowsOf(w, "log")).toHaveLength(0);
  });

  it("the worker and the site mask a line the same way", () => {
    const samples = [
      "No working ffmpeg at C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe: it takes pictures only.",
      "Loaded D:\\models\\checkpoints\\flux2-dev-fp8.safetensors and /home/me/models/wan2.2_i2v.gguf",
      "ComfyUI didn't start: spawn /usr/bin/python3 ENOENT (see ~/fuobe/comfyui.log)",
      "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.e30.abc token=s3cret api_key: 'k-123' password=\"p w\"",
      "Reach https://user:pw@studio.example/api/gpu/computer/beat?x=1#y and http://10.0.0.2:8188/prompt",
      "mail owner@studio.example about \\\\nas\\share\\models\\vae.pt",
      `prompt "${"a long prompt about a person on a beach at sunset, ".repeat(2)}" sent`,
      "a\u0007b\u001b[31mred\u001b[0m\tc\nd",
      "word ".repeat(100),
      "Loading Wan2_1-I2V-14B-480P_fp8_e4m3fn_scaled_KJ.safetensors with prompt id 11111111-2222-3333-4444-555555555555",
      "Job AbCdEfGhIjKlMnOp done.",
    ];
    for (const s of samples) expect(maskLine(s)).toBe(events.maskLogLine(s));
    expect(events.maskLogLine(samples[0])).toBe("No working ffmpeg at [file]: it takes pictures only.");
    expect(events.maskLogLine(samples[1])).toBe("Loaded flux2-dev-fp8.safetensors and wan2.2_i2v.gguf");
    expect(events.maskLogLine(samples[2])).toBe("ComfyUI didn't start: spawn [file] ENOENT (see [file])");
    expect(events.maskLogLine(samples[3])).toBe("Authorization: Bearer [hidden] token=[hidden] api_key: [hidden] password=[hidden]");
    expect(events.maskLogLine(samples[4])).toBe("Reach https://studio.example/api/gpu/computer/beat?[hidden] and http://10.0.0.2:8188/prompt");
    expect(events.maskLogLine(samples[5])).toBe("mail [email] about vae.pt");
    expect(events.maskLogLine(samples[6])).toBe('prompt "[text]" sent');
    expect(events.maskLogLine(samples[7])).toBe("a bred c d");
    expect(events.maskLogLine(samples[8])).toHaveLength(300);
    expect(events.maskLogLine(samples[9])).toBe("Loading Wan2_1-I2V-14B-480P_fp8_e4m3fn_scaled_KJ.safetensors with prompt id [hidden]");
    expect(events.maskLogLine(samples[10])).toBe("Job AbCdEfGhIjKlMnOp done.");
  });
});

describe("the worker's log ring", () => {
  it("sends at most 40 lines a beat, drops them only after a 2xx, and keeps the lines that came since", () => {
    let t = 1000;
    const ring = new LogRing({ now: () => t++ });
    for (let i = 0; i < 50; i++) ring.add(`line ${i}`);
    const first = ring.take();
    expect(first).toHaveLength(40);
    expect(first[0]).toEqual({ at: 1000, level: "info", line: "line 0" });
    // That beat failed (no ack): the same lines go again.
    expect(ring.take().map((l) => l.line)).toEqual(first.map((l) => l.line));
    ring.add("Job x failed.");
    ring.ack();
    expect(ring.size).toBe(11);
    const next = ring.take();
    expect(next.map((l) => l.line)).toEqual([...Array.from({ length: 10 }, (_, i) => `line ${40 + i}`), "Job x failed."]);
    expect(next.at(-1)?.level).toBe("error");
    ring.ack();
    expect(ring.take()).toEqual([]);
    // An ack with nothing in flight changes nothing.
    ring.add("one more");
    ring.ack();
    expect(ring.size).toBe(1);
  });

  it("never holds more than 200 lines, masks each one, and never throws", () => {
    const ring = new LogRing();
    for (let i = 0; i < 1000; i++) ring.add(`line ${i} at C:\\secret\\folder\\file.txt`);
    expect(ring.size).toBe(200);
    expect(ring.take()[0].line).toBe("line 800 at [file]");
    const odd = { toString: () => { throw new Error("no"); } };
    expect(() => ring.add(odd)).not.toThrow();
    expect(() => ring.add(undefined)).not.toThrow();
    expect(() => ring.add(Symbol("s") as never)).not.toThrow();
    const broken = new LogRing({ now: () => { throw new Error("clock"); } });
    expect(() => broken.add("x")).not.toThrow();
    expect(() => broken.take()).not.toThrow();
    expect(() => broken.ack()).not.toThrow();
  });
});

describe("GET /api/admin/workers/events", () => {
  const get = (qs: string, headers: Record<string, string>) => eventsRoute.GET(new Request(`http://${HOST}/api/admin/workers/events${qs}`, { headers: { host: HOST, ...headers } }));
  let owner = "";
  beforeAll(() => {
    owner = `${auth.SESSION_COOKIE}=${auth.createSession().value}`;
  });
  type Page = { items: { id: number; kind: string; event: string; workerId: string; generationId: string | null; laneLabel: string | null; detail: unknown }[]; next: string | null; latest: number };

  it("pages newest first by worker, kinds, run, before and after", async () => {
    const w = worker("paged");
    const other = worker("other");
    beat(w);
    beat(other);
    const a = task();
    claim(w);
    beat(w, { now: clock + 1000, log: [{ at: clock, level: "info", line: "hello" }] });
    const all = (await (await get(`?worker=${w.id}`, { cookie: owner })).json()) as Page;
    expect(all.items.length).toBeGreaterThan(3);
    expect(all.items.every((e) => e.workerId === w.id)).toBe(true);
    expect(all.items.map((e) => e.id)).toEqual([...all.items.map((e) => e.id)].sort((x, y) => y - x));
    expect(all.next).toBeNull();
    expect(all.latest).toBeGreaterThanOrEqual(all.items[0].id);
    const jobs = (await (await get(`?worker=${w.id}&kinds=job,stage`, { cookie: owner })).json()) as Page;
    expect(new Set(jobs.items.map((e) => e.kind))).toEqual(new Set(["job", "stage"]));
    expect(jobs.items.find((e) => e.kind === "job")?.laneLabel).toBeTruthy();
    const byRun = (await (await get(`?generation=${a.generationId}`, { cookie: owner })).json()) as Page;
    expect(byRun.items.length).toBeGreaterThan(0);
    expect(byRun.items.every((e) => e.generationId === a.generationId)).toBe(true);
    // Pages of 2, back to the start.
    const seen: number[] = [];
    let before = "";
    for (;;) {
      const p = (await (await get(`?worker=${w.id}&limit=2${before}`, { cookie: owner })).json()) as Page;
      seen.push(...p.items.map((e) => e.id));
      if (!p.next) break;
      before = `&before=${p.next}`;
    }
    expect(seen).toEqual(all.items.map((e) => e.id));
    // Live: only the rows after the latest one seen.
    const latest = all.latest;
    const none = (await (await get(`?after=${latest}`, { cookie: owner })).json()) as Page;
    expect(none.items).toEqual([]);
    beat(w, { now: clock + 2000, log: [{ at: clock + 2000, level: "warn", line: "news" }] });
    const fresh = (await (await get(`?after=${latest}&kinds=log`, { cookie: owner })).json()) as Page;
    expect(fresh.items.map((e) => e.event)).toEqual(["warn"]);
  });

  it("for the owner or a token that may read the workers; bad queries are 400", async () => {
    expect((await get("", { cookie: owner })).status).toBe(200);
    expect((await get("", {})).status).toBeGreaterThanOrEqual(401);
    const reader = createAdminToken({ name: "events reader", scopes: ["workers:read"] });
    expect((await get("?limit=1", { authorization: `Bearer ${reader.token}` })).status).toBe(200);
    const other = createAdminToken({ name: "queue only", scopes: ["queue:read"] });
    expect((await get("", { authorization: `Bearer ${other.token}` })).status).toBe(403);
    for (const qs of ["?limit=0", "?limit=501", "?kinds=state,nope", "?before=x", "?after=-1", "?worker=a%20b", "?generation=%2F"]) expect((await get(qs, { cookie: owner })).status).toBe(400);
    expect((await get("", { cookie: owner })).headers.get("cache-control")).toBe("no-store");
  });
});

describe("retention and best-effort writes", () => {
  it("log lines go after 7 days, other rows after 30", () => {
    const now = clock;
    const add = (kind: "log" | "state", ageDays: number) => events.logWorkerEvent({ kind, event: kind === "log" ? "info" : "idle", workerId: "w-prune", words: `${kind} ${ageDays}`, at: now - ageDays * 24 * 60 * MIN }, now);
    add("log", 8);
    add("log", 6);
    add("state", 31);
    add("state", 8);
    events.pruneWorkerEvents(now);
    const left = (db().prepare("SELECT words FROM worker_events WHERE worker_id = 'w-prune' ORDER BY id").all() as { words: string }[]).map((r) => r.words);
    expect(left).toEqual(["log 6", "state 8"]);
  });

  it("a timeline that can't be written never fails a beat, a claim, a report or an admin change", () => {
    const w = worker("sturdy");
    db().exec("DROP TABLE worker_events");
    try {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(beat(w, { log: [{ at: clock, level: "info", line: "x" }] }).runner).toBe(true);
      const a = task();
      expect(claim(w)?.id).toBe(a.id);
      tasks.report(taskRow(a.id), { event: "sent", promptId: "11111111-2222-3333-4444-555555555555" }, () => ({ error: "x" }), clock);
      expect(pool.patchWorker(w.id, { drain: true }, clock).view?.drain).toBe(true);
      expect(pool.listWorkers(clock).find((x) => x.id === w.id)?.lastEvent).toBeNull();
      warn.mockRestore();
    } finally {
      db().exec(RELAY_TABLES);
    }
  });
});
