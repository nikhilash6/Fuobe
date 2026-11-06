/**
 * The CPU slot on the workers' line (src/server/computer/pool.ts) and the finishing jobs (src/server/computer/finish.ts,
 * src/lib/finish-ticket.ts): a worker may hold one GPU job and one CPU task at once, each claimed for its own slot; light
 * CPU work goes to a CPU slot when the worker has one, and to its GPU's slot as before when it hasn't; a finishing job
 * goes only to a CPU slot that runs its kind; the line counts each slot apart; another program on the GPU stops only
 * the GPU's job. Then the live previews a worker sends with its progress: a JPEG of at most 64 KB is kept, anything
 * else is dropped. Never a real ComfyUI, never a GPU.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { apiAs, loadRoutes, type ComputerRoutes } from "./helpers/computer-tab";
import { tempDir } from "./helpers/temp-dir";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-cpu-slot-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:7";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_HOSTED_RUNS;
globalThis.__fuobeTestDiskFree = 1e13;

const auth = await import("@/server/auth");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const tasks = await import("@/server/computer/tasks");
const pool = await import("@/server/computer/pool");
const finish = await import("@/server/computer/finish");
const { onComputer } = await import("@/server/providers/comfyui");
const { allLanes } = await import("@/lib/lanes");
const { loadIndex } = await import("@/server/gpu/index-file");
const { finishProblem } = await import("@/lib/finish-ticket");
const { previewOf, PREVIEW_LIMITS } = await import("@/lib/relay");
const { previewForReport } = await import("@/lib/computer-runner");
const { exifOrientation, orientedImageSize } = await import("@/lib/image-size");
const { catalogVersion } = await import("@/server/computer/catalog-version");

const ROOT = path.resolve(__dirname, "..");
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
/** A workflow the requirements index marks as light CPU work, and one that uses the GPU. */
const CPU_WORKFLOW = "video-trim";
const GPU_WORKFLOW = "bg-remove-rmbg";

let routes: ComputerRoutes;
let accountId = "";
beforeAll(async () => {
  routes = await loadRoutes();
  setSetting("comfyWhere", "workers");
  auth.setPassword("install password");
  accountId = auth.createAccount("cpu-slot@example.com", "long enough").id;
});
beforeEach(() => {
  resetRates();
  db().prepare("DELETE FROM relay_workers").run();
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
});

type W = { id: string; token: string };
type TaskRow = import("@/server/computer/tasks").TaskRow;
const row = (id: string) => db().prepare("SELECT * FROM relay_tasks WHERE id = ?").get(id) as TaskRow;
const workerRow = (w: { id: string }) => db().prepare("SELECT * FROM relay_workers WHERE id = ?").get(w.id) as import("@/server/computer/workers").WorkerRow;

/** A worker the owner added and resumed, all day, allowed every lane, able to run every workflow. */
function addWorker(): W {
  const w = pool.addWorker(`pc-${Math.random().toString(36).slice(2, 8)}`);
  const lanes = allLanes(loadIndex(), sha);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: Object.fromEntries(lanes.map((l) => [l.lane, { delayMs: 0 }])), claimAfterMs: 0 });
  const workflows = (JSON.parse(fs.readFileSync(path.join(ROOT, "workflows/comfyui/manifest.json"), "utf8")) as { workflows: { id: string }[] }).workflows.map((x) => x.id);
  db().prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ? WHERE id = ?").run(JSON.stringify({ lanes: lanes.map((l) => l.lane), workflows }), JSON.stringify({ vramBytes: 24 * 2 ** 30 }), w.id);
  return w;
}

/** A worker's beat as the program sends it (built for this studio's catalog), with its CPU slot (null: none) and what each slot runs. */
const beat = (w: W, o: { cpuSlot?: { finishes: string[] } | null; local?: { paused: boolean; why: string | null }; running?: string[]; cpuRunning?: string[]; catalogVersion?: string | null; protocol?: number } = {}) =>
  pool.workerBeat(
    workerRow(w),
    pool.cleanBeat({
      device: `wkr-${w.id}`,
      protocol: o.protocol ?? 3,
      version: "1",
      catalogVersion: o.catalogVersion === undefined ? catalogVersion() : o.catalogVersion,
      local: { ...(o.local ?? { paused: false, why: null }), until: null },
      gpu: {},
      inventoryHash: null,
      running: (o.running ?? []).map((task) => ({ task })),
      stopped: [],
      ...(o.cpuSlot !== undefined && { cpuSlot: o.cpuSlot }),
      cpuRunning: (o.cpuRunning ?? []).map((task) => ({ task })),
    }),
  );
/** A slot's claim; `running`: the tasks the worker says it works on (any other it holds comes back to it). */
const claim = (w: W, slot: "gpu" | "cpu" = "gpu", running: string[] = []) => pool.workerClaim(workerRow(w), running, Date.now(), slot);

let gens = 0;
function generation(account: string | null, op = "edit") {
  const gid = `cpu-slot-gen-${++gens}`;
  const now = Date.now();
  db()
    .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'oss-selftest-image', 'open', 'comfyui', ?, 'image', 'running', ?, '[]', ?, ?)")
    .run(gid, op, JSON.stringify(account ? { account, place: "pool" } : {}), now, now);
  return gid;
}

/** The owner's own job of this workflow on the workers (a whole graph, in the owner's class), each a second after the last in line. */
let ranks = 0;
function ownerTask(workflowId: string, o: { preview?: boolean; checkOutputs?: boolean } = {}) {
  const gid = generation(null);
  const graph = { "1": { class_type: "LoadImage", inputs: { image: "x.png" } }, "9": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "fuobe/cpu-slot" } } };
  const id = tasks.createTask({ principal: "owner", generationId: gid, graph, workflowId, ...(o.preview && { preview: true }), ...(o.checkOutputs && { extra: { checkOutputs: true } }), pool: pool.poolFields(workflowId, { class: "owner" }) }).id;
  db().prepare("UPDATE relay_tasks SET rank_at = ? WHERE id = ?").run(Date.now() - 3_600_000 + ++ranks * 1000, id);
  return id;
}

/** An account's run of this workflow on the workers. */
function accountTask(workflowId: string) {
  const gid = generation(accountId);
  const graph = { "9": { class_type: "SaveImage", inputs: { filename_prefix: "fuobe/cpu-slot" } } };
  return tasks.createTask({ principal: `acct:${accountId}`, generationId: gid, graph, workflowId, pool: pool.poolFields(workflowId, { account: accountId }) }).id;
}

/** An account's 3D finish, queued as the studio queues it after the run's GPU job. */
function modelFinish(glb = Buffer.from("glTF fake model bytes")) {
  const gid = generation(accountId, "image-to-3d");
  return finish.queueFinish({ kind: "model3d", generationId: gid, account: accountId, inputs: [{ slot: "model", data: glb, contentType: "model/gltf-binary", name: "model.glb" }], settings: { material: "auto", turntable: true } });
}

describe("the CPU slot on the line", () => {
  it("light CPU work is marked for a CPU slot; a job that uses the GPU is not", () => {
    expect(pool.cpuWorkflow(CPU_WORKFLOW)).toBe(true);
    expect(pool.cpuWorkflow(GPU_WORKFLOW)).toBe(false);
    expect(row(ownerTask(CPU_WORKFLOW)).slot).toBe("cpu");
    expect(row(ownerTask(GPU_WORKFLOW)).slot).toBeNull();
  });

  it("a worker with a CPU slot holds one GPU job and one CPU task at once, each claimed for its own slot", () => {
    const w = addWorker();
    beat(w, { cpuSlot: { finishes: [] } });
    const cpu = ownerTask(CPU_WORKFLOW);
    const gpu = ownerTask(GPU_WORKFLOW);
    // The GPU's slot leaves the CPU task (older in line) to the CPU slot.
    expect(claim(w)?.id).toBe(gpu);
    const c = claim(w, "cpu");
    expect(c?.id).toBe(cpu);
    expect(c?.slot).toBe("cpu");
    // Light CPU work has its lane's run limit in either slot, as on the GPU's.
    expect(c?.runLimitMs).toBe(pool.runLimitMs(null, row(cpu).lane));
    // One at a time in each slot.
    expect(claim(w, "gpu", [gpu])).toBeNull();
    expect(claim(w, "cpu", [cpu])).toBeNull();
    expect(row(gpu).device).toBe(`wkr-${w.id}`);
    expect(row(cpu).device).toBe(`wkr-${w.id}-cpu`);
    // Both stay alive by the worker's beats.
    beat(w, { cpuSlot: { finishes: [] }, running: [gpu], cpuRunning: [cpu] });
    expect(row(cpu).device_seen_at).toBeGreaterThan(0);
  });

  it("a worker with no CPU slot takes light CPU work in its GPU's slot, as before, and claims nothing for a CPU slot", () => {
    const w = addWorker();
    beat(w);
    const cpu = ownerTask(CPU_WORKFLOW);
    ownerTask(GPU_WORKFLOW);
    expect(claim(w, "cpu")).toBeNull();
    expect(claim(w)?.id).toBe(cpu);
  });

  it("a finishing job goes only to a CPU slot that runs its kind, and carries its ticket in place of a graph", () => {
    const plain = addWorker();
    beat(plain, { cpuSlot: { finishes: [] } });
    expect(finish.workersFinish("model3d")).toBe(false);
    const id = modelFinish();
    expect(claim(plain)).toBeNull();
    expect(claim(plain, "cpu")).toBeNull();
    const w = addWorker();
    beat(w, { cpuSlot: { finishes: ["model3d", "path", "something-else"] } });
    expect(JSON.parse(workerRow(w).cpu_slot_json!)).toEqual({ finishes: ["model3d", "path"] });
    expect(finish.workersFinish("model3d")).toBe(true);
    expect(claim(w)).toBeNull();
    const c = claim(w, "cpu")!;
    expect(c.id).toBe(id);
    expect(c.graph).toBeUndefined();
    expect(c.ticket).toBeUndefined();
    expect(c.finish).toMatchObject({ kind: "model3d", settings: { material: "auto", turntable: true }, inputs: [{ slot: "model" }] });
    expect(finishProblem(c.finish, { inputs: c.inputs })).toBeNull();
  });

  it("the line counts each slot apart: CPU tasks never stand ahead of a GPU job on a worker with a CPU slot", () => {
    const w = addWorker();
    beat(w, { cpuSlot: { finishes: [] } });
    ownerTask(CPU_WORKFLOW);
    const cpu2 = ownerTask(CPU_WORKFLOW);
    const gpu = ownerTask(GPU_WORKFLOW);
    expect(pool.placeInLine(row(gpu)).place).toBe(1);
    expect(pool.placeInLine(row(cpu2)).place).toBe(2);
    // With no CPU slot, the same worker serves them all in one line, as before.
    beat(w, { cpuSlot: null });
    expect(pool.placeInLine(row(gpu)).place).toBe(3);
  });

  it("another program on the GPU stops only the GPU's job; the CPU slot's task goes on", () => {
    const w = addWorker();
    beat(w, { cpuSlot: { finishes: [] } });
    const cpu = ownerTask(CPU_WORKFLOW);
    const gpu = ownerTask(GPU_WORKFLOW);
    claim(w);
    claim(w, "cpu");
    beat(w, { cpuSlot: { finishes: [] }, local: { paused: true, why: "gpu-busy:game.exe" }, running: [gpu], cpuRunning: [cpu] });
    expect(row(gpu).state).toBe("waiting");
    expect(row(cpu).state).toBe("sending");
    // A stop-now by hand stops both.
    beat(w, { cpuSlot: { finishes: [] }, local: { paused: true, why: "here-now" }, cpuRunning: [cpu] });
    expect(row(cpu).state).toBe("waiting");
  });

  it("people's tasks a worker may claim now count only its GPU's work", () => {
    const w = addWorker();
    accountTask(CPU_WORKFLOW);
    beat(w);
    expect(pool.claimableNow(workerRow(w))).toBe(1);
    beat(w, { cpuSlot: { finishes: [] } });
    expect(pool.claimableNow(workerRow(w))).toBe(0);
  });
});

describe("finishing jobs", () => {
  it("a finish ticket is checked the same way on both sides", () => {
    const name = "fuobe_abcdefgh1234.png";
    const good = { v: 1, kind: "path", settings: { keys: [{ t: 0, azimuth: 0, elevation: 0, distance: 1 }, { t: 1, azimuth: 30, elevation: 5, distance: 0.8, truck: 0.1 }], frames: 81, fps: 16 }, inputs: [{ slot: "photo", name, sha256: "a".repeat(64) }, { slot: "depth", name: "fuobe_abcdefgh5678.png", sha256: "b".repeat(64) }] };
    expect(finishProblem(good)).toBeNull();
    expect(finishProblem({ ...good, inputs: [...good.inputs].reverse() })).not.toBeNull();
    expect(finishProblem({ ...good, settings: { ...good.settings, frames: 100_000 } })).not.toBeNull();
    expect(finishProblem({ ...good, settings: { ...good.settings, keys: [{ t: 0, azimuth: 0, elevation: 0, distance: 1, path: "../x" }] } })).not.toBeNull();
    expect(finishProblem({ ...good, inputs: [{ ...good.inputs[0], name: "../../secret.png" }, good.inputs[1]] })).not.toBeNull();
    expect(finishProblem({ ...good, extra: 1 })).not.toBeNull();
    // Its inputs must be the files the job sends.
    expect(finishProblem(good, { inputs: [{ name, sha256: "a".repeat(64) }] })).not.toBeNull();
    expect(finishProblem({ v: 1, kind: "model3d", settings: { material: "chrome", turntable: true }, inputs: [{ slot: "model", name, sha256: "a".repeat(64) }] })).not.toBeNull();
  });

  it("a path's keys go in the ticket as the path render reads them, each inside its range", () => {
    const keys = finish.pathKeys([
      { t: 1, azimuth: 99_999, elevation: 200, distance: 50, truck: 500 },
      { t: 0.5, azimuth: 30, elevation: 5, distance: 0.01 },
    ]);
    expect(keys[0]).toEqual({ t: 0, azimuth: 0, elevation: 0, distance: 1 });
    expect(keys.map((k) => k.t)).toEqual([0, 0.5, 1]);
    expect(keys[2]).toEqual({ t: 1, azimuth: 3600, elevation: 90, distance: 4, truck: 20 });
    const name = "fuobe_abcdefgh1234.png";
    const ticket = { v: 1, kind: "path", settings: { keys, frames: 81, fps: 16 }, inputs: [{ slot: "photo", name, sha256: "a".repeat(64) }, { slot: "depth", name, sha256: "b".repeat(64) }] };
    expect(finishProblem(ticket)).toBeNull();
  });

  it("only the files its kind makes are asked for, each within its limit", () => {
    const id = modelFinish();
    const t = row(id);
    const entry = {
      status: { status_str: "success" },
      outputs: {
        finish: {
          results: [
            { filename: "web.glb", subfolder: "", type: "output", role: "web" },
            { filename: "turntable.mp4", subfolder: "", type: "output", role: "turntable" },
            { filename: "secret.txt", subfolder: "", type: "output", role: "notes" },
            { filename: "../x.glb", subfolder: "", type: "output", role: "poster" },
            { filename: "again.glb", subfolder: "", type: "output", role: "web" },
          ],
          stats: [{ material: "matte", triangles: 1200, bytesIn: 900, bytesOut: 300 }],
        },
      },
    };
    const plan = onComputer(t.principal, () => finish.planFinish(t, [entry]));
    expect("wanted" in plan && plan.wanted.map((w) => [w.filename, w.kind])).toEqual([
      ["web.glb", "model3d"],
      ["turntable.mp4", "video"],
    ]);
    expect("outputs" in plan && plan.outputs[0]).toMatchObject({ files: [{ role: "web", n: 0 }, { role: "turntable", n: 1 }], stats: { material: "matte", triangles: 1200 } });
    expect(onComputer(t.principal, () => finish.planFinish(t, [{ status: { status_str: "success" }, outputs: {} }]))).toHaveProperty("error");
  });
});

describe("live previews from a worker", () => {
  const jpeg = (bytes: number) => {
    const b = Buffer.alloc(bytes, 7);
    b[0] = 0xff;
    b[1] = 0xd8;
    b[2] = 0xff;
    return b;
  };

  it("a worker sends a JPEG of at most 64 KB, at most one every 2 s", async () => {
    const small = new Blob([jpeg(20_000)], { type: "image/jpeg" });
    expect(await previewForReport(small, -Infinity, 10_000)).toBe(jpeg(20_000).toString("base64"));
    expect(await previewForReport(small, 9_000, 10_000)).toBeUndefined();
    expect(await previewForReport(new Blob([jpeg(PREVIEW_LIMITS.maxBytes + 1)], { type: "image/jpeg" }), -Infinity, 10_000)).toBeUndefined();
    expect(await previewForReport(new Blob([Buffer.from("89504e470d0a1a0a", "hex")], { type: "image/png" }), -Infinity, 10_000)).toBeUndefined();
  });

  it("the studio keeps a preview up to 64 KB and drops a larger one, keeping the progress", async () => {
    // A preview picture shows only with hosted runs on (without them, a run shows what it showed before).
    process.env.FUOBE_HOSTED_RUNS = "1";
    onTestFinished(() => {
      delete process.env.FUOBE_HOSTED_RUNS;
    });
    expect(previewOf(jpeg(PREVIEW_LIMITS.maxBytes).toString("base64"))).toBeDefined();
    expect(previewOf(jpeg(PREVIEW_LIMITS.maxBytes + 1).toString("base64"))).toBeUndefined();
    expect(previewOf(Buffer.from("89504e470d0a1a0a", "hex").toString("base64"))).toBeUndefined();
    expect(previewOf("not base64!")).toBeUndefined();
    // Through the report route, as a worker sends it.
    const w = addWorker();
    beat(w);
    const id = ownerTask(GPU_WORKFLOW, { preview: true });
    const c = claim(w)!;
    expect(c.reportPreview).toBe(true);
    const api = apiAs(routes, null, { authorization: `Bearer ${w.token}` });
    const report = (body: Record<string, unknown>) => api(`/api/gpu/computer/tasks/${id}/report`, { method: "POST", headers: { "Content-Type": "application/json", "X-Fuobe-Lease": c.lease }, body: JSON.stringify(body) });
    expect((await report({ event: "sent", promptId: c.promptId })).status).toBe(200);
    // Just over 64 KB: the report is kept, its preview dropped.
    const big = jpeg(PREVIEW_LIMITS.maxBytes + 1024).toString("base64");
    expect((await report({ event: "running", value: 2, max: 8, preview: big })).status).toBe(200);
    expect(tasks.taskProgress(tasks.taskById(id)!)).toMatchObject({ value: 2, max: 8 });
    expect(keptPreview(id)).toBeNull();
    const ok = jpeg(30 * 1024);
    expect((await report({ event: "running", value: 3, max: 8, preview: ok.toString("base64") })).status).toBe(200);
    expect(keptPreview(id)?.equals(ok)).toBe(true);
    expect(tasks.taskProgress(tasks.taskById(id)!)).toMatchObject({ value: 3, max: 8 });
    // A beat never brings a preview.
    beat(w, { running: [id] });
    expect(keptPreview(id)?.equals(ok)).toBe(true);
    // A progress report with no preview stays a few KB; one with a preview, under about 91 KB in all (a 64 KB JPEG as
    // base64 and a few KB more).
    expect((await report({ event: "running", value: 4, max: 8, node: "x".repeat(20 * 1024) })).status).toBe(413);
    expect((await report({ event: "running", value: 5, max: 8, preview: jpeg(70 * 1024).toString("base64") })).status).toBe(413);
    expect((await report({ event: "running", value: 5, max: 8, preview: ok.toString("base64"), node: "x".repeat(8 * 1024) })).status).toBe(200);
    expect((await report({ event: "running", value: 6, max: 8, preview: jpeg(PREVIEW_LIMITS.maxBytes).toString("base64"), node: "x".repeat(8 * 1024) })).status).toBe(413);
  });
});

/** A run's preview picture as the studio keeps it (a file in its task's folder), or null. */
function keptPreview(id: string): Buffer | null {
  const t = tasks.taskById(id);
  const p = t?.preview_at ? tasks.runPreview(t.generation_id) : null;
  return p ? fs.readFileSync(p.path) : null;
}

describe("which runs show live previews", () => {
  it("a run whose results are checked first, a finishing job and a run with no previews never ask the worker for one", () => {
    const w = addWorker();
    beat(w, { cpuSlot: { finishes: ["model3d"] } });
    const checked = ownerTask(GPU_WORKFLOW, { preview: true, checkOutputs: true });
    const first = claim(w)!;
    expect(first.id).toBe(checked);
    expect(first.reportPreview).toBeUndefined();
    expect(tasks.showsPreview(row(checked))).toBe(false);
    tasks.endTask(checked, "canceled");
    const plain = ownerTask(GPU_WORKFLOW);
    expect(claim(w)?.reportPreview).toBeUndefined();
    tasks.endTask(plain, "canceled");
    const fin = modelFinish();
    const c = claim(w, "cpu")!;
    expect(c.id).toBe(fin);
    expect(c.reportPreview).toBeUndefined();
  });
});

describe("pictures as they show", () => {
  it("a JPEG stored on its side is sized upright, as the worker makes it again", async () => {
    const sharp = (await import("sharp")).default;
    const sideways = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#3c3" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExif({ IFD0: { Artist: "someone" } })
      .toBuffer();
    expect(exifOrientation(sideways)).toBe(6);
    expect(orientedImageSize(sideways)).toEqual({ width: 20, height: 40 });
    const plain = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#3c3" } }).jpeg().toBuffer();
    expect(exifOrientation(plain)).toBeNull();
    expect(orientedImageSize(plain)).toEqual({ width: 40, height: 20 });
  });
});

// ---------------------------------------------------------------------------
// Each slot's own line, its limits and its claims

/** A finishing job made straight in the line (no files), ahead of everything made after it. */
function bareFinish(rankAt: number) {
  const gid = generation(accountId, "image-to-3d");
  return tasks.createTask({
    principal: `acct:${accountId}`,
    generationId: gid,
    graph: {},
    finish: { v: 1, kind: "model3d", settings: { material: "auto", turntable: false }, inputs: [] },
    workflowId: "finish-model3d",
    pool: { pools: ["pool"], account: accountId, class: "free", rankAt, lane: "small", needs: { workflowId: "finish-model3d", files: [], packs: [], minVramBytes: 0 }, slot: "cpu" },
  }).id;
}

describe("each slot's own line", () => {
  it("a long line of CPU work ahead never hides a GPU job from a worker's GPU slot, nor from the count of people's jobs it may take", () => {
    const w = addWorker();
    beat(w, { cpuSlot: { finishes: [] } });
    // More light CPU tasks than a slot looks at, every one ahead of the GPU job in line.
    for (let i = 0; i < 205; i++) accountTask(CPU_WORKFLOW);
    const gpu = accountTask(GPU_WORKFLOW);
    expect(pool.claimableNow(workerRow(w))).toBe(1);
    expect(claim(w)?.id).toBe(gpu);
    for (const t of db().prepare("SELECT id FROM relay_tasks WHERE state = 'waiting'").all() as { id: string }[]) tasks.endTask(t.id, "canceled");
    // A worker with no CPU slot: as many finishing jobs ahead, which only a CPU slot takes.
    const plain = addWorker();
    beat(plain);
    for (let i = 0; i < 205; i++) bareFinish(Date.now() - 3_600_000 + i);
    const next = accountTask(GPU_WORKFLOW);
    expect(pool.claimableNow(workerRow(plain))).toBe(1);
    expect(claim(plain)?.id).toBe(next);
  });

  it("light CPU work has its lane's run limits in a CPU slot too, and a finishing job its lane's run ceiling, which the owner sets", async () => {
    const { saveQueueSettings, QUEUE_DEFAULTS } = await import("@/server/queue-settings");
    const w = addWorker();
    beat(w, { cpuSlot: { finishes: ["model3d"] } });
    const fin = modelFinish();
    expect(claim(w, "cpu")).toMatchObject({ id: fin, runLimitMs: 2700 * 1000 });
    tasks.endTask(fin, "canceled");
    saveQueueSettings({ ...QUEUE_DEFAULTS, runCeilingS: { default: 2700, lanes: { small: 3600 } } });
    try {
      const later = modelFinish();
      expect(claim(w, "cpu")).toMatchObject({ id: later, runLimitMs: 3600 * 1000 });
      tasks.endTask(later, "canceled");
      // Light CPU work given back once for running past its limit gets its lane's whole ceiling next, as on the GPU's slot.
      const cpu = ownerTask(CPU_WORKFLOW);
      expect(claim(w, "cpu")?.id).toBe(cpu);
      tasks.report(row(cpu), { event: "give-back", why: "run-limit" }, () => ({ error: "unused" }));
      expect(claim(w, "cpu")).toMatchObject({ id: cpu, runLimitMs: pool.runLimitMs(null, row(cpu).lane) });
    } finally {
      saveQueueSettings(QUEUE_DEFAULTS);
    }
  });

  it("each slot of a worker claims on its own count: two idle slots asking once a second are never turned away", async () => {
    const w = addWorker();
    beat(w, { cpuSlot: { finishes: [] } });
    const api = apiAs(routes, null, { authorization: `Bearer ${w.token}` });
    const ask = (slot?: "cpu") => api("/api/gpu/computer/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device: "worker", running: [], ...(slot && { slot }) }) });
    for (let i = 0; i < 60; i++) {
      expect((await ask()).status).toBe(204);
      expect((await ask("cpu")).status).toBe(204);
    }
    // Each slot's own limit still holds.
    expect((await ask()).status).toBe(429);
    expect((await ask("cpu")).status).toBe(429);
  });

  it("after a claim that found nothing, a worker's slot asks again only a few seconds on, sooner while a person's job waits for it", async () => {
    const { claimDue, CLAIM_GAP_MS, IDLE_CLAIM_MS } = await import("../bin/lib/worker/run.mjs");
    expect(IDLE_CLAIM_MS).toBeGreaterThanOrEqual(2000);
    // Before any claim, and after a job: at once.
    expect(claimDue(1000, -Infinity)).toBe(true);
    const missed = 1000;
    expect(claimDue(missed + IDLE_CLAIM_MS - 1, missed)).toBe(false);
    expect(claimDue(missed + IDLE_CLAIM_MS, missed)).toBe(true);
    // A person's job waits: sooner, yet never once a second while the beat keeps saying so.
    expect(CLAIM_GAP_MS).toBeGreaterThan(1000);
    expect(claimDue(missed + 1000, missed, 1)).toBe(false);
    expect(claimDue(missed + CLAIM_GAP_MS, missed, 1)).toBe(true);
    // A loop that ticks every second, with two idle slots and a beat that always says a job waits: well under the
    // studio's 60 claims a minute for each slot.
    let gpu = -Infinity;
    let cpu = -Infinity;
    const claims = { gpu: 0, cpu: 0 };
    for (let t = 0; t < 60_000; t += 1000) {
      if (claimDue(t, gpu, 1)) {
        claims.gpu++;
        gpu = t;
      }
      if (claimDue(t, cpu)) {
        claims.cpu++;
        cpu = t;
      }
    }
    expect(claims.gpu).toBeLessThanOrEqual(40);
    expect(claims.cpu).toBeLessThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------
// Finishing jobs: once, with their run, and for no longer than its wait

/** A small PNG (1 by 1, whole and well formed). */
const smallPng = (): Buffer =>
  Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8ffffff7f0009fb03fd2a86e38a0000000049454e44ae426082", "hex");

/** An account's camera path step, queued as the studio queues it (its photo and depth staged as the account's). */
function pathFinish(photo = smallPng()) {
  const gid = generation(accountId, "image-to-video");
  const keys = finish.pathKeys([
    { t: 0, azimuth: 0, elevation: 0, distance: 1 },
    { t: 1, azimuth: 20, elevation: 4, distance: 0.8 },
  ]);
  const id = finish.queueFinish({
    kind: "path",
    generationId: gid,
    account: accountId,
    step: 0,
    inputs: [
      { slot: "photo", data: photo, contentType: photo[0] === 0xff ? "image/jpeg" : "image/png", name: "photo" },
      { slot: "depth", data: smallPng(), contentType: "image/png", name: "depth.png" },
    ],
    settings: { keys, frames: 9, fps: 16 },
  });
  return { id, gid };
}

describe("finishing jobs and their run", () => {
  it("a chain step's camera path waits at its run's place and in its class, from the run's first job", () => {
    const first = generation(accountId, "image-to-video");
    const rankAt = Date.now() - 20 * 60_000;
    tasks.createTask({
      principal: `acct:${accountId}`,
      generationId: first,
      graph: {},
      workflowId: GPU_WORKFLOW,
      pool: { pools: ["pool"], account: accountId, class: "paid", rankAt, lane: pool.poolLane(GPU_WORKFLOW), needs: { workflowId: GPU_WORKFLOW, files: [], packs: [], minVramBytes: 0 } },
    });
    // The step its path is drawn for waits on the first step, and has no job of its own yet. One press of Run made both:
    // they share its batch and its class.
    const step = generation(accountId, "image-to-video");
    db().prepare("UPDATE generations SET depends_on = ? WHERE id = ?").run(first, step);
    db().prepare("UPDATE generations SET batch_id = 'path-run', request_json = json_set(request_json, '$.class', 'paid') WHERE id IN (?, ?)").run(first, step);
    const id = finish.queueFinish({
      kind: "path",
      generationId: step,
      account: accountId,
      step: 0,
      inputs: [
        { slot: "photo", data: smallPng(), contentType: "image/png", name: "photo.png" },
        { slot: "depth", data: smallPng(), contentType: "image/png", name: "depth.png" },
      ],
      settings: { keys: finish.pathKeys([{ t: 0, azimuth: 0, elevation: 0, distance: 1 }, { t: 1, azimuth: 20, elevation: 4, distance: 0.8 }]), frames: 9, fps: 16 },
    });
    expect(row(id)).toMatchObject({ class: "paid", rank_at: rankAt, slot: "cpu" });
  });

  it("a camera-path step of an account's run on the workers is queued for a CPU slot even with none about, and never drawn here", async () => {
    const generations = await import("@/server/generations");
    const { saveFile } = await import("@/server/storage");
    const { runnerByHand, tick } = await import("./helpers/app-process");
    // A worker with no CPU slot: no worker draws camera paths right now.
    const w = addWorker();
    beat(w, { cpuSlot: null });
    expect(finish.workersFinish("path")).toBe(false);
    const still = saveFile({ data: smallPng(), contentType: "image/png", name: "still.png", source: "upload", accountId });
    const depth = saveFile({ data: smallPng(), contentType: "image/png", name: "depth.png", source: "derived", accountId });
    // The run's scene step is done (its depth picture); its next step films along the path drawn through it.
    const scene = generation(accountId, "scene");
    db().prepare("UPDATE generations SET status = 'succeeded', outputs_json = ?, completed_at = ? WHERE id = ?").run(JSON.stringify([{ url: depth.url, kind: "image" }]), Date.now(), scene);
    const step = `cpu-slot-path-step-${++gens}`;
    const now = Date.now();
    const request = {
      feature: "canvas",
      modelId: "oss-uni3c-path",
      op: "camera-path",
      prompt: "The camera flies around the subject",
      inputs: { images: [still.url] },
      chain: [{ slot: "video", render: "path" }],
      params: { numOutputs: 1, cameraPath: [{ t: 0, azimuth: 0, elevation: 0, distance: 1 }, { t: 1, azimuth: 30, elevation: 4, distance: 0.9 }] },
      account: accountId,
      place: "pool",
    };
    db()
      .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at, depends_on) VALUES (?, 'canvas', 'oss-uni3c-path', 'open', 'comfyui', 'camera-path', 'video', 'queued', ?, '[]', ?, ?, ?)")
      .run(step, JSON.stringify(request), now, now, scene);
    generations.ensureRunner();
    runnerByHand();
    await tick();
    const t = finish.finishTask(step, "path");
    expect(t, "its camera path, queued on the workers").toMatchObject({ slot: "cpu", state: "waiting", account: accountId });
    const g = generations.getGeneration(step)!;
    expect(g.status).toBe("queued");
    expect(g.message).not.toBe("Rendering the camera path");
    // Turned again, it still waits for a CPU slot: the same job, and nothing drawn on this server.
    await tick();
    expect(finish.finishTask(step, "path")!.id).toBe(t!.id);
    expect(db().prepare("SELECT COUNT(*) FROM assets WHERE generation_id = ? AND name = 'path-render.mp4'").pluck().get(step)).toBe(0);
    await generations.cancelGeneration(step);
  });

  it("are queued once for a run (and step), however often they are asked", () => {
    const gid = generation(accountId, "image-to-3d");
    const queue = () => finish.queueFinish({ kind: "model3d", generationId: gid, account: accountId, inputs: [{ slot: "model", data: Buffer.from("glTF fake model bytes"), contentType: "model/gltf-binary", name: "model.glb" }], settings: { material: "auto", turntable: true } });
    const a = queue();
    expect(queue()).toBe(a);
    expect(db().prepare("SELECT COUNT(*) FROM relay_tasks WHERE generation_id = ?").pluck().get(gid)).toBe(1);
    // One that was stopped makes room for another.
    tasks.endTask(a, "canceled");
    expect(queue()).not.toBe(a);
  });

  it("a canceled run's finish and a deleted run's camera path end at once, with their files, and no CPU slot gets them", async () => {
    const generations = await import("@/server/generations");
    const w = addWorker();
    beat(w, { cpuSlot: { finishes: ["model3d", "path"] } });
    // A 3D finish waiting in line; its run is canceled.
    const fin = modelFinish();
    const gid = row(fin).generation_id;
    db().prepare("UPDATE generations SET external_meta_json = ? WHERE id = ?").run(JSON.stringify({ finishing: true }), gid);
    expect(tasks.inputsOf(fin)).toHaveLength(1);
    await generations.cancelGeneration(gid);
    expect(row(fin).state).toBe("canceled");
    expect(tasks.inputsOf(fin)).toHaveLength(0);
    expect(claim(w, "cpu")).toBeNull();
    // A camera path a CPU slot already runs; its run is deleted. The CPU slot hears the stop in its next report.
    const path = pathFinish();
    const c = claim(w, "cpu")!;
    expect(c.id).toBe(path.id);
    tasks.report(row(path.id), { event: "sent", promptId: c.promptId }, () => ({ error: "unused" }));
    generations.deleteGeneration(path.gid);
    expect(row(path.id).state).toBe("canceled");
    expect(tasks.inputsOf(path.id)).toHaveLength(0);
    expect(tasks.report(row(path.id), { event: "running", value: 5, max: 100 }, () => ({ error: "unused" }))).toMatchObject({ stop: true });
    expect(claim(w, "cpu", [path.id])).toBeNull();
  });

  it("wait for a CPU slot as long as their run may wait in line; a 3D model whose finish never came keeps its raw GLB", async () => {
    const { saveFile } = await import("@/server/storage");
    // Its run's own wait, else this install's.
    const fin = modelFinish();
    expect(row(fin).not_after).toBeGreaterThan(Date.now() + pool.poolWaitMs() - 60_000);
    const gid = generation(accountId, "image-to-3d");
    db().prepare("UPDATE generations SET request_json = ? WHERE id = ?").run(JSON.stringify({ account: accountId, place: "pool", waitMs: 120_000 }), gid);
    const raw = saveFile({ data: Buffer.from("glTF raw model"), contentType: "model/gltf-binary", name: "model.glb", source: "generation", generationId: gid, accountId });
    const outputs = [{ url: raw.url, kind: "model3d" as const, contentType: "model/gltf-binary", assetId: raw.id }];
    let finished: import("@/lib/catalog/types").OutputFile[] | null = null;
    finish.startWorkerModelFinish(gid, outputs, { op: "image-to-3d", provider: "comfyui", account: accountId, done: (o) => void (finished = o) });
    const t = finish.finishTask(gid, "model3d")!;
    expect(t.not_after).toBeGreaterThan(Date.now() + 60_000);
    expect(t.not_after).toBeLessThanOrEqual(Date.now() + 120_000);
    // While it waits, the run's place in line is the finish's.
    expect(pool.queueOfGeneration(gid)?.place).toBeGreaterThanOrEqual(1);
    // No CPU slot took it in time: it ends, and the run keeps its model as it is.
    db().prepare("UPDATE relay_tasks SET not_after = ? WHERE id = ?").run(Date.now() - 1, t.id);
    pool.sweepPool();
    expect(row(t.id).state).toBe("failed");
    const deadline = Date.now() + 10_000;
    while (!finished && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    const kept = finished as unknown as import("@/lib/catalog/types").OutputFile[];
    expect(kept[0]).toMatchObject({ assetId: raw.id, meta: { finish: { error: expect.stringContaining("kept as it is") } } });
    finish.stopWorkerFinish(gid);
  });

  it("a run stamped to wait as long as it takes (0): its finishing job has no wait limit either", async () => {
    const { saveFile } = await import("@/server/storage");
    const gid = generation(accountId, "image-to-3d");
    db().prepare("UPDATE generations SET request_json = ? WHERE id = ?").run(JSON.stringify({ account: accountId, place: "pool", waitMs: 0 }), gid);
    const raw = saveFile({ data: Buffer.from("glTF raw model"), contentType: "model/gltf-binary", name: "model.glb", source: "generation", generationId: gid, accountId });
    const outputs = [{ url: raw.url, kind: "model3d" as const, contentType: "model/gltf-binary", assetId: raw.id }];
    finish.startWorkerModelFinish(gid, outputs, { op: "image-to-3d", provider: "comfyui", account: accountId, done: () => {} });
    const t = finish.finishTask(gid, "model3d")!;
    expect(t.not_after).toBeNull();
    finish.stopWorkerFinish(gid);
  });

  it("count only a CPU slot heard from lately, on a worker built for this studio's catalog", () => {
    const w = addWorker();
    beat(w, { cpuSlot: { finishes: ["model3d"] }, catalogVersion: "e".repeat(64) });
    expect(finish.workersFinish("model3d")).toBe(false);
    beat(w, { cpuSlot: { finishes: ["model3d"] }, protocol: 2 });
    expect(finish.workersFinish("model3d")).toBe(false);
    beat(w, { cpuSlot: { finishes: ["model3d"] } });
    expect(finish.workersFinish("model3d")).toBe(true);
    expect(finish.workersFinish("path")).toBe(false);
    db().prepare("UPDATE relay_workers SET seen_at = ? WHERE id = ?").run(Date.now() - 11 * 60_000, w.id);
    expect(finish.workersFinish("model3d")).toBe(false);
  });
});

describe("CPU work is never metered as GPU time", () => {
  it("a 3D run's settle carries its GPU job's time only, never its finish's, and a lane's typical run leaves finishes out", async () => {
    const { queueReports } = await import("@/server/billing-outbox");
    const w = addWorker();
    beat(w, { cpuSlot: { finishes: ["model3d"] } });
    const gid = generation(accountId, "image-to-3d");
    const graph = { "9": { class_type: "SaveImage", inputs: { filename_prefix: "fuobe/cpu-slot" } } };
    const gpu = tasks.createTask({ principal: `acct:${accountId}`, generationId: gid, graph, workflowId: GPU_WORKFLOW, pool: pool.poolFields(GPU_WORKFLOW, { account: accountId }) }).id;
    const done = () => ({ wanted: [], outputs: [], budget: 0 });
    const g = claim(w)!;
    expect(g.id).toBe(gpu);
    tasks.report(row(gpu), { event: "sent", promptId: g.promptId }, done);
    tasks.report(row(gpu), { event: "finished", entry: { status: { status_str: "success" }, outputs: {} }, execMs: 1000, device: "Test GPU" }, done);
    const fin = finish.queueFinish({ kind: "model3d", generationId: gid, account: accountId, inputs: [{ slot: "model", data: Buffer.from("glTF fake model bytes"), contentType: "model/gltf-binary", name: "model.glb" }], settings: { material: "auto", turntable: true } });
    const c = claim(w, "cpu")!;
    expect(c.id).toBe(fin);
    tasks.report(row(fin), { event: "sent", promptId: c.promptId }, done);
    tasks.report(row(fin), { event: "finished", entry: { status: { status_str: "success" }, outputs: {} }, execMs: 30_000, device: "cpu" }, done);
    expect(row(fin).state).toBe("done");
    expect(db().prepare("SELECT exec_ms, device FROM worker_jobs WHERE task_id = ? AND event = 'finished'").get(fin)).toEqual({ exec_ms: null, device: null });
    const now = Date.now();
    db().prepare("UPDATE generations SET status = 'succeeded', completed_at = ?, request_json = ? WHERE id = ?").run(now, JSON.stringify({ account: accountId, place: "pool", hold: `hold-${gid}` }), gid);
    queueReports(now);
    const report = JSON.parse(db().prepare("SELECT payload_json FROM billing_outbox WHERE key = ?").pluck().get(gid) as string) as { gpuMs: number; device: string };
    expect(report).toMatchObject({ gpuMs: 1000, device: "Test GPU" });
    expect(pool.typicalPoolMs("small")).not.toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// Pictures sent to the workers

describe("an account's pictures leave for a worker without what they carry besides their pixels", () => {
  /** A PNG with a text chunk (after its header). */
  async function pngWithText(text: string) {
    const zlib = await import("node:zlib");
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#123" } }).png().toBuffer();
    const data = Buffer.from(`Comment\0${text}`, "latin1");
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write("tEXt", 4, "latin1");
    data.copy(chunk, 8);
    chunk.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from("tEXt", "latin1"), data])), 8 + data.length);
    return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
  }

  it("a JPEG keeps only its orientation, a PNG loses its text and a WebP its EXIF, each still the same picture", async () => {
    const { pictureWithoutMetadata } = await import("@/server/media-clean");
    const sharp = (await import("sharp")).default;
    const jpeg = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#c33" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExif({ IFD0: { Artist: "someone private", Copyright: "a home address" } })
      .toBuffer();
    const clean = pictureWithoutMetadata(jpeg)!;
    expect(clean.length).toBe(jpeg.length);
    expect(clean.includes(Buffer.from("someone private"))).toBe(false);
    expect(clean.includes(Buffer.from("a home address"))).toBe(false);
    expect(exifOrientation(clean)).toBe(6);
    expect(orientedImageSize(clean)).toEqual({ width: 20, height: 40 });
    const meta = await sharp(clean).metadata();
    expect(meta.orientation).toBe(6);
    expect([meta.width, meta.height]).toEqual([40, 20]);
    // Upright already: nothing of its EXIF stays.
    const upright = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#c33" } }).jpeg().withExif({ IFD0: { Artist: "someone private" } }).toBuffer();
    const plain = pictureWithoutMetadata(upright)!;
    expect(plain.includes(Buffer.from("someone private"))).toBe(false);
    expect((await sharp(plain).metadata()).exif).toBeUndefined();
    const png = await pngWithText("a private note");
    expect((await sharp(png).metadata()).width).toBe(8);
    const cleanPng = pictureWithoutMetadata(png)!;
    expect(cleanPng.includes(Buffer.from("a private note"))).toBe(false);
    expect((await sharp(cleanPng).metadata()).width).toBe(8);
    const webp = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#123" } }).webp().withExif({ IFD0: { Artist: "someone private" } }).toBuffer();
    const cleanWebp = pictureWithoutMetadata(webp)!;
    expect(cleanWebp.includes(Buffer.from("someone private"))).toBe(false);
    expect((await sharp(cleanWebp).metadata()).width).toBe(8);
    // Not a picture it can read where such things live: refused.
    expect(pictureWithoutMetadata(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x00]))).toBeNull();
  });

  it("an account's run on the workers stages its picture that way, sized as it shows; its own GPU gets it as it came, sized by its pixels", async () => {
    const { comfyProvider, mediaInfoFor } = await import("@/server/providers/comfyui");
    const hosted = await import("@/server/hosted");
    const sharp = (await import("sharp")).default;
    const sideways = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#3c3" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExif({ IFD0: { Artist: "someone private" } })
      .toBuffer();
    const route = { provider: "comfyui", endpoint: "selftest-image", op: "edit" } as never;
    const pooled = await hosted.runOnPool(accountId, async () => {
      const name = (await comfyProvider.prepareFile!(sideways, "image/jpeg", "me.jpg", route))!;
      return { name, info: mediaInfoFor(name) };
    });
    const staged = fs.readFileSync(path.join(dir, "relay", "in", pooled.name));
    expect(staged.length).toBe(sideways.length);
    expect(staged.includes(Buffer.from("someone private"))).toBe(false);
    expect(exifOrientation(staged)).toBe(6);
    expect(pooled.info).toMatchObject({ width: 20, height: 40 });
    // The account's own GPU gets the file as it came, sized by its pixels, as before.
    const own = await onComputer(`acct:${accountId}`, async () => {
      const name = (await comfyProvider.prepareFile!(sideways, "image/jpeg", "me.jpg", route))!;
      return { name, info: mediaInfoFor(name) };
    });
    expect(fs.readFileSync(path.join(dir, "relay", "in", own.name)).equals(sideways)).toBe(true);
    expect(own.info).toMatchObject({ width: 40, height: 20 });
  });

  it("a camera path's photo goes to the worker the same way", async () => {
    const sharp = (await import("sharp")).default;
    const photo = await sharp({ create: { width: 16, height: 12, channels: 3, background: "#36c" } }).jpeg().withExif({ IFD0: { Artist: "someone private" } }).toBuffer();
    const { id } = pathFinish(photo);
    const staged = tasks.inputsOf(id).map((i) => fs.readFileSync(path.join(dir, "relay", "in", i.name)));
    expect(staged).toHaveLength(2);
    expect(staged.some((b) => b.includes(Buffer.from("someone private")))).toBe(false);
    expect(staged[0].length).toBe(photo.length);
  });

  it("a camera path's photo with a second picture and a motion photo's clip after it goes as the first picture only", async () => {
    const sharp = (await import("sharp")).default;
    const photo = await sharp({ create: { width: 16, height: 12, channels: 3, background: "#36c" } }).jpeg().toBuffer();
    const second = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).jpeg().withExif({ IFD0: { Artist: "GPS 48.85837 N" } }).toBuffer();
    const clip = Buffer.from("....ftypmp42 MOTION PHOTO VIDEO AND SOUND", "latin1");
    const { id } = pathFinish(Buffer.concat([photo, second, clip]));
    const staged = tasks.inputsOf(id).map((i) => fs.readFileSync(path.join(dir, "relay", "in", i.name)));
    expect(staged[0].equals(photo)).toBe(true);
    expect(staged.some((b) => b.includes(Buffer.from("GPS 48.85837")) || b.includes(Buffer.from("MOTION PHOTO")))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A finish's results are stored once, and a 3D model waits for its check

/** The smallest binary glTF with every part inside it. */
function tinyGlb(): Buffer {
  let j = Buffer.from(JSON.stringify({ asset: { version: "2.0" } }));
  j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + j.length, 8);
  header.writeUInt32LE(j.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, j]);
}

/** A finishing job a worker finished: its one result file back, as `role`. */
function finishedOnWorker(id: string, role: string, data: Buffer, contentType: string) {
  const file = tasks.outputFile(id, 0);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  db()
    .prepare("UPDATE relay_tasks SET state = 'done', result_json = ?, received_json = ?, finished_at = ? WHERE id = ?")
    .run(JSON.stringify([{ files: [{ role, n: 0 }], stats: {} }]), JSON.stringify([{ n: 0, bytes: data.length, total: data.length, done: true, contentType }]), Date.now(), id);
}

/** Wait for `fn` to give something. */
async function until<T>(fn: () => T, ms = 15_000): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() > end) throw new Error(`Timed out after ${ms} ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("a finish's results are kept once", () => {
  it("a 3D model's web GLB is stored once, however many app processes look at the finished job", async () => {
    const { saveFile } = await import("@/server/storage");
    expect(finish.glbSelfContained(tinyGlb())).toBe(true);
    const gid = generation(accountId, "image-to-3d");
    const raw = saveFile({ data: tinyGlb(), contentType: "model/gltf-binary", name: "model.glb", source: "generation", generationId: gid, accountId });
    const outputs = [{ url: raw.url, kind: "model3d" as const, contentType: "model/gltf-binary", assetId: raw.id }];
    const id = finish.queueFinish({ kind: "model3d", generationId: gid, account: accountId, inputs: [{ slot: "model", data: tinyGlb(), contentType: "model/gltf-binary", name: "model.glb" }], settings: { material: "auto", turntable: false } });
    finishedOnWorker(id, "web", tinyGlb(), "model/gltf-binary");
    const got: import("@/lib/catalog/types").OutputFile[][] = [];
    // Each look as another app process makes it (a deploy's overlap): a watch of its own, the same finished job.
    for (let i = 0; i < 2; i++) finish.startWorkerModelFinish(gid, outputs, { op: "image-to-3d", provider: "comfyui", account: accountId, done: (o) => void got.push(o) });
    expect(got).toHaveLength(2);
    expect(got[1]).toEqual(got[0]);
    expect((got[0][0].meta as { web?: string }).web).toBeTruthy();
    expect(db().prepare("SELECT COUNT(*) FROM assets WHERE generation_id = ? AND name = 'model-web.glb'").pluck().get(gid)).toBe(1);
  });

  it("a camera path's clip is stored once, however many app processes look at the finished job", async () => {
    const { runAsTenant } = await import("@/server/tenant");
    const { saveFile } = await import("@/server/storage");
    const photo = saveFile({ data: smallPng(), contentType: "image/png", name: "still.png", source: "upload", accountId });
    const depth = saveFile({ data: smallPng(), contentType: "image/png", name: "depth.png", source: "derived", accountId });
    const keys = [
      { t: 0, azimuth: 0, elevation: 0, distance: 1 },
      { t: 1, azimuth: 20, elevation: 4, distance: 0.8 },
    ];
    const gid = generation(accountId, "image-to-video");
    const step = () => runAsTenant({ kind: "account", id: accountId }, () => finish.pathOnWorker(gid, 0, { photo: photo.url, depth: depth.url, keys, frames: 9, fps: 16 }));
    expect(await step()).toEqual({ state: "waiting" });
    finishedOnWorker(finish.finishTask(gid, "path")!.id, "path", Buffer.from("....ftypisom path clip"), "video/mp4");
    const [a, b] = await Promise.all([step(), step()]);
    expect(a.state).toBe("done");
    expect(b).toEqual(a);
    expect(await step()).toEqual(a);
    expect(db().prepare("SELECT COUNT(*) FROM assets WHERE generation_id = ? AND name = 'path-render.mp4'").pluck().get(gid)).toBe(1);
  });
});

describe("pictures for a worker that this server can't blank in place", () => {
  /** A GIF with a comment in it. */
  async function gifWithComment(text: string) {
    const sharp = (await import("sharp")).default;
    const gif = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#c63" } }).gif().toBuffer();
    const packed = gif[10];
    const at = 13 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0);
    const data = Buffer.from(text, "latin1");
    return Buffer.concat([gif.subarray(0, at), Buffer.from([0x21, 0xfe, data.length]), data, Buffer.from([0]), gif.subarray(at)]);
  }

  it("are made again from their pixels here, so nothing besides them leaves: a GIF's comment, a camera path's GIF photo", async () => {
    const { comfyProvider, mediaInfoFor } = await import("@/server/providers/comfyui");
    const { pictureWithoutMetadata } = await import("@/server/media-clean");
    const hosted = await import("@/server/hosted");
    const sharp = (await import("sharp")).default;
    const gif = await gifWithComment("a private note");
    expect((await sharp(gif).metadata()).width).toBe(8);
    expect(pictureWithoutMetadata(gif)).toBeNull();
    const route = { provider: "comfyui", endpoint: "selftest-image", op: "edit" } as never;
    const pooled = await hosted.runOnPool(accountId, async () => {
      const name = (await comfyProvider.prepareFile!(gif, "image/gif", "me.gif", route))!;
      return { name, info: mediaInfoFor(name) };
    });
    const staged = fs.readFileSync(path.join(dir, "relay", "in", pooled.name));
    expect(staged.subarray(1, 4).toString()).toBe("PNG");
    expect(staged.includes(Buffer.from("a private note"))).toBe(false);
    expect(pooled.info).toMatchObject({ width: 8, height: 6 });
    // A camera path's photo the same way.
    const { runAsTenant } = await import("@/server/tenant");
    const { saveFile } = await import("@/server/storage");
    const photo = saveFile({ data: gif, contentType: "image/gif", name: "still.gif", source: "upload", accountId });
    const depth = saveFile({ data: smallPng(), contentType: "image/png", name: "depth.png", source: "derived", accountId });
    const gid = generation(accountId, "image-to-video");
    const keys = [
      { t: 0, azimuth: 0, elevation: 0, distance: 1 },
      { t: 1, azimuth: 20, elevation: 4, distance: 0.8 },
    ];
    expect(await runAsTenant({ kind: "account", id: accountId }, () => finish.pathOnWorker(gid, 0, { photo: photo.url, depth: depth.url, keys, frames: 9, fps: 16 }))).toEqual({ state: "waiting" });
    const files = tasks.inputsOf(finish.finishTask(gid, "path")!.id).map((i) => fs.readFileSync(path.join(dir, "relay", "in", i.name)));
    expect(files[0].subarray(1, 4).toString()).toBe("PNG");
    expect(files.some((b) => b.includes(Buffer.from("a private note")))).toBe(false);
  });
});

describe("a 3D model finished on a worker, for a run whose outputs are checked first", () => {
  it("waits for the check, as any run's outputs do, and never shows before it", async () => {
    const generations = await import("@/server/generations");
    const { saveFile } = await import("@/server/storage");
    process.env.FUOBE_MODERATION_URL = "http://127.0.0.1:9/check";
    const gid = `cpu-slot-checked-3d-${++gens}`;
    try {
      const now = Date.now();
      const raw = saveFile({ data: tinyGlb(), contentType: "model/gltf-binary", name: "model.glb", source: "generation", generationId: gid, accountId });
      const outputs = [{ url: raw.url, kind: "model3d", contentType: "model/gltf-binary", assetId: raw.id }];
      // Its GPU job is done and its outputs are stored; the 3D finish comes next.
      db()
        .prepare(
          "INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, external_id, external_meta_json, created_at, updated_at) VALUES (?, 'image-to-3d', 'oss-pixal3d', 'open', 'comfyui', 'image-to-3d', 'model3d', 'running', ?, ?, 'job-1', ?, ?, ?)",
        )
        .run(gid, JSON.stringify({ account: accountId, place: "pool", checkOutputs: true }), JSON.stringify(outputs), JSON.stringify({ finishing: true }), now, now);
      generations.ensureRunner();
      await globalThis.__fuobeRunner?.tick();
      const t = await until(() => finish.finishTask(gid, "model3d"));
      // Its finish comes back (here: no CPU slot took it in time, so the model is kept as it is).
      db().prepare("UPDATE relay_tasks SET not_after = ? WHERE id = ?").run(Date.now() - 1, t.id);
      pool.sweepPool();
      const g = await until(() => {
        const r = db().prepare("SELECT status, stage FROM generations WHERE id = ?").get(gid) as { status: string; stage: string | null };
        return r.stage === "checking" && r;
      });
      expect(g).toMatchObject({ status: "running", stage: "checking" });
      expect(db().prepare("SELECT held FROM assets WHERE id = ?").pluck().get(raw.id)).toBe(1);
    } finally {
      delete process.env.FUOBE_MODERATION_URL;
      finish.stopWorkerFinish(gid);
      const r = globalThis.__fuobeRunner;
      if (r) {
        clearInterval(r.timer);
        if (r.fastTimer) clearInterval(r.fastTimer);
        globalThis.__fuobeRunner = undefined;
      }
    }
  });
});
