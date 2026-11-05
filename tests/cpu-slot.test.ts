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
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
const { finishProblem, FINISH_RUN_MS } = await import("@/lib/finish-ticket");
const { previewOf, PREVIEW_LIMITS } = await import("@/lib/relay");
const { previewForReport } = await import("@/lib/computer-runner");
const { exifOrientation, orientedImageSize } = await import("@/lib/image-size");

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

/** A worker's beat as the program sends it, with its CPU slot (null: none) and what each slot runs. */
const beat = (w: W, o: { cpuSlot?: { finishes: string[] } | null; local?: { paused: boolean; why: string | null }; running?: string[]; cpuRunning?: string[] } = {}) =>
  pool.workerBeat(
    workerRow(w),
    pool.cleanBeat({
      device: `wkr-${w.id}`,
      protocol: 3,
      version: "1",
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
    expect(c?.runLimitMs).toBeLessThanOrEqual(FINISH_RUN_MS);
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
    const big = jpeg(70 * 1024).toString("base64");
    expect((await report({ event: "running", value: 2, max: 8, preview: big })).status).toBe(200);
    expect(tasks.taskProgress(id)).toMatchObject({ value: 2, max: 8 });
    expect(tasks.taskPreview(id)).toBeNull();
    const ok = jpeg(30 * 1024);
    expect((await report({ event: "running", value: 3, max: 8, preview: ok.toString("base64") })).status).toBe(200);
    expect(tasks.taskPreview(id)?.jpeg.equals(ok)).toBe(true);
    expect(tasks.taskProgress(id)).toMatchObject({ value: 3, max: 8 });
    // A beat never brings a preview.
    beat(w, { running: [id] });
    expect(tasks.taskPreview(id)?.jpeg.equals(ok)).toBe(true);
    // A progress report with no preview stays a few KB.
    expect((await report({ event: "running", value: 4, max: 8, node: "x".repeat(20 * 1024) })).status).toBe(413);
  });
});

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
