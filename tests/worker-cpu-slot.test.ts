/**
 * The CPU slot in the worker program (bin/lib/worker/run.mjs) against the studio's real routes, with the worker's own
 * stand-in ComfyUIs (processes of its own, behind the worker's guard). Never a real ComfyUI, never a GPU.
 *
 * - A CPU task runs on the CPU slot while a GPU job runs.
 * - A 3D model whose GLB names an outside file is refused on the worker, and its run keeps the model as it is.
 * - A 3D model's finish comes back with its web GLB, its turntable and its poster, stored on the run.
 * - An account's picture with EXIF reaches its ComfyUI made again from its pixels, with no EXIF.
 * - A live preview reaches the studio as a small JPEG; one over 64 KB is dropped.
 * - With a worker that finishes 3D models, an account's Image to 3D run on this install's GPUs is taken.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { finishers } from "../bin/lib/worker/finish.mjs";
import { previewArgs, previewShrinker, PREVIEW_MAX_BYTES } from "../bin/lib/worker/preview.mjs";
import { workerFiles } from "../scripts/lib/worker-build.mjs";
import { runWorker } from "../bin/lib/worker/run.mjs";
import { inputRules, readCatalog } from "../scripts/lib/worker-catalog.mjs";
import { FAKE_MP4, FAKE_PNG } from "./helpers/fake-local-comfy";
import { apiAs, loadRoutes, type ComputerRoutes } from "./helpers/computer-tab";
import { tempDir } from "./helpers/temp-dir";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 120_000 });

const dir = tempDir("fuobe-worker-cpu-slot-");
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
const { catalogVersion } = await import("@/server/computer/catalog-version");
const { comfyProvider } = await import("@/server/providers/comfyui");
const hosted = await import("@/server/hosted");
const { saveFile, getAsset, absolutePath } = await import("@/server/storage");
const { runAsTenant } = await import("@/server/tenant");
const { asAccount, createGenerations } = await import("@/server/generations");
const { withRunStamp } = await import("@/server/run-stamp");
const { getModel } = await import("@/lib/catalog");
const { allLanes } = await import("@/lib/lanes");
const { loadIndex } = await import("@/server/gpu/index-file");
const { ComputerRunner } = await import("@/lib/computer-runner");
const composer = await import("@/lib/ticket-compose");

const ROOT = path.resolve(__dirname, "..");
const FAKE = path.join(ROOT, "tests/helpers/fake-local-comfy.ts");
const SITE = "http://127.0.0.1:9";
const RULES = inputRules(readCatalog(ROOT));
const ALLOWED = new Set(["LoadImage", "ImageInvert", "SaveImage", "KSampler"]);
const VERSION = catalogVersion()!;
const realFetch = globalThis.fetch;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
/** Workflows the requirements index marks as light CPU work (the self-test only inverts a picture), and one that uses the GPU. */
const CPU_WORKFLOW = "video-trim";
const GPU_WORKFLOW = "bg-remove-rmbg";

let routes: ComputerRoutes;
let accountId = "";
beforeAll(async () => {
  routes = await loadRoutes();
  setSetting("comfyWhere", "workers");
  auth.setPassword("install password");
  accountId = auth.createAccount("cpu-slot-worker@example.com", "long enough").id;
});
afterAll(() => {
  globalThis.__fuobeTestDiskFree = undefined;
});
beforeEach(() => {
  resetRates();
  db().prepare("DELETE FROM relay_workers").run();
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
});

type W = { id: string; token: string };
type TaskRow = import("@/server/computer/tasks").TaskRow;
const row = (id: string) => db().prepare("SELECT * FROM relay_tasks WHERE id = ?").get(id) as TaskRow;
const LANE = pool.poolLane("selftest-image");

/** A worker the owner added and resumed, all day, allowed every lane, able to run every workflow. */
function addWorker(): W {
  const w = pool.addWorker(`pc-${Math.random().toString(36).slice(2, 8)}`);
  const lanes = allLanes(loadIndex(), sha);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: Object.fromEntries(lanes.map((l) => [l.lane, { delayMs: 0 }])), claimAfterMs: 0 });
  const workflows = (JSON.parse(fs.readFileSync(path.join(ROOT, "workflows/comfyui/manifest.json"), "utf8")) as { workflows: { id: string }[] }).workflows.map((x) => x.id);
  db().prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ? WHERE id = ?").run(JSON.stringify({ lanes: lanes.map((l) => l.lane), workflows }), JSON.stringify({ vramBytes: 24 * 2 ** 30 }), w.id);
  return w;
}

let gens = 0;
function generation(account: string | null, op = "edit") {
  const gid = `cpu-slot-worker-gen-${++gens}`;
  const now = Date.now();
  db()
    .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'oss-selftest-image', 'open', 'comfyui', ?, 'image', 'running', ?, '[]', ?, ?)")
    .run(gid, op, JSON.stringify(account ? { account, place: "pool" } : {}), now, now);
  return gid;
}

/** The owner's own job of this workflow on the workers: a whole graph that inverts a picture. */
function ownerTask(workflowId: string, o: { preview?: boolean } = {}) {
  const gid = generation(null);
  const picture = tasks.stageInput("owner", FAKE_PNG, "image/png", "in.png");
  const graph = { "1": { class_type: "LoadImage", inputs: { image: picture } }, "3": { class_type: "KSampler", inputs: { seed: 1, steps: 4 } }, "9": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "fuobe/cpu-slot" } } };
  const t = tasks.createTask({ principal: "owner", generationId: gid, graph, workflowId, ...(o.preview && { preview: true }), pool: pool.poolFields(workflowId, { class: "owner" }) });
  return { id: t.id, gid };
}

/** A one-triangle GLB; `image` adds a picture (and a texture that uses it) with that URI. */
function glb(image?: string): Buffer {
  const bin = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => bin.writeFloatLE(v, i * 4));
  const json: Record<string, unknown> = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, ...(image && { material: 0 }) }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    ...(image && { images: [{ uri: image, mimeType: "image/png" }], textures: [{ source: 0 }], materials: [{ emissiveTexture: { index: 0 }, emissiveFactor: [1, 1, 1] }] }),
  };
  let j = Buffer.from(JSON.stringify(json));
  j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + j.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(j.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, j, bh, bin]);
}

/** A stand-in for the turntable render (no browser here): it writes a clip and a poster, and says its frames. */
function standInTurntable(): string {
  const file = path.join(tempDir("fuobe-cpu-slot-turntable-"), "turntable.mjs");
  fs.writeFileSync(
    file,
    `import fs from "node:fs";
const arg = (n) => process.argv[process.argv.indexOf("--" + n) + 1];
if (!fs.existsSync(arg("glb"))) process.exit(1);
for (let i = 1; i <= 4; i++) console.log("frame " + i + "/4");
fs.writeFileSync(arg("out"), Buffer.from(${JSON.stringify(FAKE_MP4.toString("hex"))}, "hex"));
fs.writeFileSync(arg("poster"), Buffer.from("RIFF0000WEBPVP8 poster"));
console.log(JSON.stringify({ frames: 4, fps: 24 }));
`,
  );
  return file;
}

// ---------------------------------------------------------------------------
// The worker program

interface Studio {
  reports: (Record<string, unknown> & { task: string })[];
  claims: { slot?: string }[];
}
const studio = (): Studio => ({ reports: [], claims: [] });

/** fetch for the worker: the studio's routes for SITE, its own ComfyUIs for the rest. */
function router(w: W, s: Studio) {
  const api = apiAs(routes, null);
  return async (url: string, init: RequestInit = {}) => {
    if (!String(url).startsWith(SITE)) return realFetch(url, init);
    const u = new URL(url);
    const p = u.pathname + u.search;
    if (p === "/api/gpu/computer/inventory") return Response.json({ ok: true, lanes: [LANE], workflows: ["selftest-image"], missing: [] });
    if (typeof init.body === "string" && init.body.startsWith("{")) {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      const m = /^\/api\/gpu\/computer\/tasks\/([^/]+)\/report$/.exec(u.pathname);
      if (m) s.reports.push({ ...body, task: m[1] });
      if (u.pathname === "/api/gpu/computer/claim") s.claims.push(body as { slot?: string });
    }
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${w.token}`);
    return api(p, init);
  };
}

interface Pc {
  home: string;
  workDir: string;
  comfyDir: string;
  uploadDir: string;
  logs: string[];
}
function pc(): Pc {
  const base = tempDir("fuobe-cpu-slot-pc-");
  const p = { home: path.join(base, "home"), workDir: path.join(base, "work"), comfyDir: path.join(base, "comfy"), uploadDir: path.join(base, "uploads"), logs: [] as string[] };
  for (const d of [p.home, p.workDir, p.comfyDir]) fs.mkdirSync(d, { recursive: true });
  return p;
}

const running: { ctrl: AbortController; done: Promise<unknown> }[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) {
    r.ctrl.abort();
    await r.done.catch(() => {});
  }
});

const standIn = (o: { steps: number; stepMs: number; uploadDir?: string }) => [
  process.execPath,
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
  FAKE,
  "--port",
  "{port}",
  "--cors",
  "off",
  "--steps",
  String(o.steps),
  "--step-ms",
  String(o.stepMs),
  "--worker-guard",
  "1",
  ...(o.uploadDir ? ["--upload-dir", o.uploadDir] : []),
];

/** Start `fuobe worker run` in this process with a CPU slot (`cpuSlot`), its ComfyUIs stand-in processes of their own. */
function start(w: W, s: Studio, p: Pc, o: { gpu?: { steps: number; stepMs: number }; cpu?: { steps: number; stepMs: number }; cpuSlot?: boolean; finishers?: unknown; shrinkPreview?: (b: Blob) => Promise<Blob | null> } = {}) {
  const ctrl = new AbortController();
  const cfg = {
    site: SITE,
    token: w.token,
    comfyDir: p.comfyDir,
    workDir: p.workDir,
    modelDirs: [],
    comfyCommand: standIn({ ...(o.gpu ?? { steps: 3, stepMs: 30 }), uploadDir: p.uploadDir }),
    cpuComfyCommand: standIn({ ...(o.cpu ?? { steps: 2, stepMs: 20 }), uploadDir: p.uploadDir }),
    comfyGuard: true,
    stallMin: 10,
    ffmpeg: null,
    cpuSlot: o.cpuSlot !== false,
  };
  const done = runWorker(cfg, {
    fetch: router(w, s),
    home: p.home,
    signal: ctrl.signal,
    requirements: { folders: [], files: {}, packs: {}, workflows: {} },
    ComputerRunner,
    rules: RULES,
    pins: {},
    allowed: ALLOWED,
    readGpu: async () => null,
    readGpuGen: async () => "8.9",
    ffmpegVersion: async () => null,
    awake: { set: () => {} },
    sleep: (ms: number) => sleep(Math.min(ms, 50)),
    log: (line: string) => void p.logs.push(line),
    composer,
    catalogVersion: VERSION,
    allLanes,
    ...(o.finishers !== undefined && { finishers: o.finishers }),
    ...(o.shrinkPreview && { shrinkPreview: o.shrinkPreview }),
  });
  const r = { ctrl, done };
  running.push(r);
  return r;
}

async function until<T>(fn: () => T | Promise<T>, ms = 60_000, every = 100): Promise<Exclude<T, false | null | undefined | 0 | "">> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as Exclude<T, false | null | undefined | 0 | "">;
    if (Date.now() > end) throw new Error(`Timed out after ${ms} ms`);
    await sleep(every);
  }
}
const ENDED = ["done", "failed", "canceled"];
const ended = (id: string) => until(() => ENDED.includes(row(id).state) && row(id), 90_000);

describe("the worker program's CPU slot", () => {
  it("runs a CPU task while its GPU's job runs, each claimed for its own slot", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const gpu = ownerTask(GPU_WORKFLOW);
    const cpu = ownerTask(CPU_WORKFLOW);
    expect(row(cpu.id).slot).toBe("cpu");
    expect(row(gpu.id).slot).toBeNull();
    // A slow GPU job (about 4 s) and a quick CPU task.
    start(w, s, p, { gpu: { steps: 40, stepMs: 100 } });
    const cpuDone = await ended(cpu.id);
    expect(cpuDone.state, cpuDone.error ?? "").toBe("done");
    // The GPU's job was still going when the CPU task ended.
    expect(["sending", "queued", "running", "collecting"]).toContain(row(gpu.id).state);
    expect(cpuDone.device).toBe(`wkr-${w.id}-cpu`);
    const gpuDone = await ended(gpu.id);
    expect(gpuDone.state, gpuDone.error ?? "").toBe("done");
    expect(gpuDone.device).toBe(`wkr-${w.id}`);
    expect(fs.readFileSync(tasks.outputFile(cpu.id, 0)).length).toBeGreaterThan(0);
    expect(s.claims.some((c) => c.slot === "cpu")).toBe(true);
    // The studio heard its CPU slot in its beat.
    expect(JSON.parse(db().prepare("SELECT cpu_slot_json FROM relay_workers WHERE id = ?").pluck().get(w.id) as string)).toHaveProperty("finishes");
  });

  it("without a CPU slot, it takes light CPU work in its GPU's slot, as before", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const cpu = ownerTask(CPU_WORKFLOW);
    start(w, s, p, { cpuSlot: false });
    const t = await ended(cpu.id);
    expect(t.state, t.error ?? "").toBe("done");
    expect(t.device).toBe(`wkr-${w.id}`);
    expect(s.claims.some((c) => c.slot === "cpu")).toBe(false);
  });
});

describe("the 3D finish on the worker", () => {
  it("refuses a GLB that names an outside file, and never reads it; the run keeps its model as it is", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const gid = generation(accountId, "image-to-3d");
    const raw = saveFile({ data: glb("../secret-marker.png"), contentType: "model/gltf-binary", name: "model.glb", source: "generation", generationId: gid });
    const outputs = [{ url: raw.url, kind: "model3d" as const, contentType: "model/gltf-binary", assetId: raw.id }];
    let finished: unknown[] | null = null;
    finish.startWorkerModelFinish(gid, outputs, { op: "image-to-3d", provider: "comfyui", account: accountId, done: (o) => void (finished = o) });
    const id = finish.finishTask(gid, "model3d")!.id;
    start(w, s, p);
    const t = await ended(id);
    expect(t.state).toBe("failed");
    expect(t.error).toBe("tab:unsafe-model");
    expect(s.reports).toContainEqual(expect.objectContaining({ task: id, event: "failed", reason: "unsafe-model" }));
    const kept = await until(() => finished, 30_000);
    expect(kept).toHaveLength(1);
    expect((kept[0] as { meta: { finish: { error: string }; web?: string } }).meta.finish.error).toMatch(/self-contained/);
    expect((kept[0] as { meta: { web?: string } }).meta.web).toBeUndefined();
    // Nothing of the job stays in the CPU slot's folder.
    expect(fs.existsSync(path.join(p.workDir, "cpu", "finish"))).toBe(false);
  });

  it("sends back the web GLB with its turntable and poster, and the run stores them", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const gid = generation(accountId, "image-to-3d");
    const raw = saveFile({ data: glb(), contentType: "model/gltf-binary", name: "model.glb", source: "generation", generationId: gid });
    const outputs = [{ url: raw.url, kind: "model3d" as const, contentType: "model/gltf-binary", assetId: raw.id }];
    let finished: import("@/lib/catalog/types").OutputFile[] | null = null;
    finish.startWorkerModelFinish(gid, outputs, { op: "image-to-3d", provider: "comfyui", account: accountId, done: (o) => void (finished = o) });
    const id = finish.finishTask(gid, "model3d")!.id;
    const made = finishers({ workDir: path.join(p.workDir, "cpu"), ffmpeg: null, scripts: { turntable: standInTurntable() } });
    expect(made.kinds).toContain("model3d");
    start(w, s, p, { finishers: made });
    const t = await ended(id);
    expect(t.state, t.error ?? "").toBe("done");
    const got = await until(() => finished, 30_000);
    const mesh = got.find((o) => o.kind === "model3d")!;
    const meta = mesh.meta as { web: string; poster: string; finish: { turntable: string; webAsset: string; triangles: number } };
    expect(meta.finish.turntable).toBe("done");
    expect(meta.finish.triangles).toBe(1);
    expect(meta.web).toBeTruthy();
    expect(meta.poster).toBeTruthy();
    // The web GLB is a binary glTF the worker wrote; the turntable is the clip it rendered.
    const web = getAsset(meta.finish.webAsset)!;
    expect(fs.readFileSync(absolutePath(web.relPath)).subarray(0, 4).toString()).toBe("glTF");
    const clip = got.find((o) => o.kind === "video" && o.meta?.role === "turntable")!;
    expect(fs.readFileSync(absolutePath(getAsset(clip.assetId!)!.relPath)).equals(FAKE_MP4)).toBe(true);
    // Stored as the account's files.
    expect(db().prepare("SELECT account_id FROM assets WHERE id = ?").pluck().get(clip.assetId)).toBe(accountId);
  });

  it("a turntable that didn't come back leaves the account's words on the model, never the worker's", async () => {
    const { ACCOUNT_TURNTABLE } = await import("@/server/model3d-finish");
    const w = addWorker();
    const s = studio();
    const p = pc();
    const gid = generation(accountId, "image-to-3d");
    const raw = saveFile({ data: glb(), contentType: "model/gltf-binary", name: "model.glb", source: "generation", generationId: gid });
    const outputs = [{ url: raw.url, kind: "model3d" as const, contentType: "model/gltf-binary", assetId: raw.id }];
    let finished: import("@/lib/catalog/types").OutputFile[] | null = null;
    finish.startWorkerModelFinish(gid, outputs, { op: "image-to-3d", provider: "comfyui", account: accountId, done: (o) => void (finished = o) });
    const id = finish.finishTask(gid, "model3d")!.id;
    // A turntable render that fails, naming things of its PC.
    const failing = path.join(tempDir("fuobe-cpu-slot-turntable-"), "turntable.mjs");
    fs.writeFileSync(failing, 'console.error("no browser at C:/Users/someone-private/browsers/chrome.exe"); process.exit(1);');
    start(w, s, p, { finishers: finishers({ workDir: path.join(p.workDir, "cpu"), ffmpeg: null, scripts: { turntable: failing } }) });
    const t = await ended(id);
    expect(t.state, t.error ?? "").toBe("done");
    const got = await until(() => finished, 30_000);
    const mesh = got.find((o) => o.kind === "model3d")!;
    const meta = mesh.meta as { web?: string; finish: { turntable: string } };
    expect(meta.web).toBeTruthy();
    expect(meta.finish.turntable).toBe(ACCOUNT_TURNTABLE);
    expect(JSON.stringify(got)).not.toMatch(/someone-private|chrome|browsers/);
  });

  it("a finish its run no longer wants stops on the worker while it runs: the run was deleted", async () => {
    const { deleteGeneration } = await import("@/server/generations");
    const w = addWorker();
    const s = studio();
    const p = pc();
    const gid = generation(accountId, "image-to-3d");
    const raw = saveFile({ data: glb(), contentType: "model/gltf-binary", name: "model.glb", source: "generation", generationId: gid });
    const outputs = [{ url: raw.url, kind: "model3d" as const, contentType: "model/gltf-binary", assetId: raw.id }];
    finish.startWorkerModelFinish(gid, outputs, { op: "image-to-3d", provider: "comfyui", account: accountId, done: () => {} });
    const id = finish.finishTask(gid, "model3d")!.id;
    // A finish that goes on until it is told to stop, saying how far it got now and then.
    let started = false;
    let stopped = false;
    const slow = {
      kinds: ["model3d"],
      finish: async (_t: unknown, _inputs: unknown, o: { signal: AbortSignal; progress: (f: number) => void }) => {
        started = true;
        for (let i = 0; i < 600 && !o.signal.aborted; i++) {
          o.progress(i / 600);
          await sleep(100);
        }
        stopped = o.signal.aborted;
        return { refused: "finish-failed" };
      },
    };
    start(w, s, p, { finishers: slow });
    await until(() => started, 30_000);
    expect(row(id).state).toBe("running");
    deleteGeneration(gid);
    expect(row(id).state).toBe("canceled");
    // Its next progress report hears the stop, and the finish's processes are stopped at once.
    await until(() => stopped, 15_000);
    await sleep(500);
    expect(s.reports.filter((r) => r.task === id && ["finished", "failed"].includes(String(r.event)))).toEqual([]);
  });

  it("the studio keeps an account's 3D model from the workers only as a binary glTF with every part inside it", async () => {
    const { outputType } = await import("@/server/computer/http");
    const want = { n: 0, filename: "m.glb", subfolder: "", type: "output" as const, kind: "model3d" as const, maxBytes: 1e6 };
    expect(finish.glbSelfContained(glb())).toBe(true);
    expect(finish.glbSelfContained(glb(`data:image/png;base64,${FAKE_PNG.toString("base64")}`))).toBe(true);
    for (const uri of ["../secret.png", "file:///etc/passwd", "https://example.com/x.png", "C:\\x.png"]) expect(finish.glbSelfContained(glb(uri)), uri).toBe(false);
    const ply = Buffer.from("ply\nformat ascii 1.0\n");
    expect(finish.glbSelfContained(ply)).toBe(false);
    const file = path.join(tempDir("fuobe-cpu-slot-glb-"), "m.glb");
    fs.writeFileSync(file, glb("../secret.png"));
    expect(finish.glbFileSelfContained(file)).toBe(false);
    fs.writeFileSync(file, glb());
    expect(finish.glbFileSelfContained(file)).toBe(true);
    // An account's run: a glTF only when its 3D finish runs on a worker, and never a PLY.
    expect(() => outputType(glb(), want, false)).toThrow(/3D model/);
    expect(outputType(glb(), want, false, { glb: true })).toBe("model/gltf-binary");
    expect(() => outputType(ply, want, false, { glb: true })).toThrow(/3D model/);
    expect(outputType(ply, want, true)).toBe("model/ply");
  });

  it("with a worker that finishes 3D models, an account's Image to 3D run on this install's GPUs is taken", () => {
    const photo = saveFile({ data: FAKE_PNG, contentType: "image/png", source: "upload", accountId }).url;
    const request = { feature: "image-to-3d", modelId: "oss-pixal3d", op: "image-to-3d", prompt: "", inputs: { images: [photo] }, engine: "open" } as Parameters<typeof createGenerations>[0];
    const onPool = () => asAccount(accountId, () => withRunStamp({ place: "pool" }, () => createGenerations(request)));
    expect(onPool).toThrow();
    const w = addWorker();
    pool.workerBeat(
      db().prepare("SELECT * FROM relay_workers WHERE id = ?").get(w.id) as never,
      pool.cleanBeat({ device: `wkr-${w.id}`, protocol: 3, version: "1", local: { paused: false, why: null, until: null }, gpu: {}, inventoryHash: null, running: [], stopped: [], catalogVersion: VERSION, cpuSlot: { finishes: ["model3d"] } }),
    );
    const made = onPool();
    expect(made[0].kind).toBe("model3d");
    expect(JSON.parse(db().prepare("SELECT request_json FROM generations WHERE id = ?").pluck().get(made[0].id) as string).place).toBe("pool");
  });
});

describe("camera paths on the worker", () => {
  /** The worker's built parts the path render reads (camera-path, path-splat and scene3d), in a folder of their own. */
  function builtParts(): string {
    const out = tempDir("fuobe-cpu-slot-dist-");
    const files = workerFiles().files as unknown as Record<string, string>;
    for (const f of ["camera-path.mjs", "path-splat.mjs", "scene3d.mjs"]) fs.writeFileSync(path.join(out, f), files[f]);
    return out;
  }

  it.runIf(hasFfmpeg)("draws a step's camera path on the worker's CPU slot, and the run keeps the clip once", async () => {
    const sharp = (await import("sharp")).default;
    const photo = saveFile({ data: await sharp({ create: { width: 64, height: 48, channels: 3, background: "#36c" } }).png().toBuffer(), contentType: "image/png", name: "still.png", source: "upload", accountId });
    const depth = saveFile({ data: await sharp({ create: { width: 64, height: 48, channels: 3, background: "#808080" } }).png().toBuffer(), contentType: "image/png", name: "depth.png", source: "derived", accountId });
    const gid = generation(accountId, "image-to-video");
    const keys = [
      { t: 0, azimuth: 0, elevation: 0, distance: 1 },
      { t: 1, azimuth: 20, elevation: 4, distance: 0.8 },
    ];
    const step = () => runAsTenant({ kind: "account", id: accountId }, () => finish.pathOnWorker(gid, 0, { photo: photo.url, depth: depth.url, keys, frames: 9, fps: 16 }));
    expect(await step()).toEqual({ state: "waiting" });
    // Asked again before it is done: the same job, still waiting.
    expect(await step()).toEqual({ state: "waiting" });
    const id = finish.finishTask(gid, "path")!.id;
    expect(db().prepare("SELECT COUNT(*) FROM relay_tasks WHERE generation_id = ?").pluck().get(gid)).toBe(1);
    const w = addWorker();
    const s = studio();
    const p = pc();
    const made = finishers({ workDir: path.join(p.workDir, "cpu"), ffmpeg: "ffmpeg", distDir: builtParts() });
    expect(made.kinds).toContain("path");
    start(w, s, p, { finishers: made });
    const t = await ended(id);
    expect(t.state, t.error ?? "").toBe("done");
    const got = await step();
    expect(got.state).toBe("done");
    const url = (got as { url: string }).url;
    const clip = (db().prepare("SELECT id FROM assets WHERE generation_id = ? AND name = 'path-render.mp4'").all(gid) as { id: string }[]).map((r) => getAsset(r.id)!);
    expect(clip).toHaveLength(1);
    expect(clip[0].url).toBe(url);
    expect(fs.readFileSync(absolutePath(clip[0].relPath)).subarray(4, 8).toString()).toBe("ftyp");
    // Kept once: asked again, the same clip.
    expect(await step()).toEqual({ state: "done", url });
    expect(db().prepare("SELECT COUNT(*) FROM assets WHERE generation_id = ? AND name = 'path-render.mp4'").pluck().get(gid)).toBe(1);
  });
});

describe("an account's pictures on the worker", () => {
  it("a picture with EXIF reaches its ComfyUI made again from its pixels, with no EXIF", async () => {
    const sharp = (await import("sharp")).default;
    const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#c33" } })
      .jpeg()
      .withExif({ IFD0: { Copyright: "private note", Artist: "someone" } })
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();
    const w = addWorker();
    const s = studio();
    const p = pc();
    const gid = generation(accountId);
    const route = { provider: "comfyui", endpoint: "selftest-image", op: "edit" } as never;
    const { picture, sent } = await hosted.runOnPool(accountId, async () => {
      const name = (await comfyProvider.prepareFile!(jpeg, "image/jpeg", "me.jpg", route))!;
      return { picture: name, sent: await comfyProvider.submit({ route, input: { images: [name], seed: 5 }, generationId: gid, model: getModel("oss-selftest-image") } as never) };
    });
    const id = String((sent.meta as { relay: string }).relay);
    // The studio keeps it undecoded, its EXIF blanked.
    const kept = fs.readFileSync(path.join(dir, "relay", "in", picture));
    expect(kept.length).toBe(jpeg.length);
    expect(kept.includes(Buffer.from("private note"))).toBe(false);
    start(w, s, p);
    const t = await ended(id);
    expect(t.state, t.error ?? "").toBe("done");
    const reached = fs.readFileSync(path.join(p.uploadDir, picture));
    const meta = await sharp(reached).metadata();
    expect(meta.format).toBe("png");
    expect(meta.exif).toBeUndefined();
    expect([meta.width, meta.height]).toEqual([64, 48]);
    expect(reached.includes(Buffer.from("private note"))).toBe(false);
  });
});

describe("live previews from the worker", () => {
  const jpeg = (bytes: number) => {
    const b = Buffer.alloc(bytes, 7);
    b[0] = 0xff;
    b[1] = 0xd8;
    b[2] = 0xff;
    return b;
  };
  const previews = (s: Studio, id: string) => s.reports.filter((r) => r.task === id && r.event === "running" && typeof r.preview === "string");

  it("sends its ComfyUI's preview as a small JPEG, at most one every 2 s, and the studio keeps it", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const t = ownerTask(GPU_WORKFLOW, { preview: true });
    const small = jpeg(20_000);
    const asked: string[] = [];
    // Its ComfyUI's previews are PNGs: the worker makes each one again as a JPEG.
    start(w, s, p, { gpu: { steps: 12, stepMs: 400 }, shrinkPreview: async (b) => (asked.push(b.type), new Blob([small], { type: "image/jpeg" })) });
    const got = await until(() => tasks.taskPreview(t.id), 30_000);
    expect(got.jpeg.equals(small)).toBe(true);
    expect(asked[0]).toBe("image/png");
    expect((await ended(t.id)).state).toBe("done");
    const sent = previews(s, t.id);
    expect(sent.length).toBeGreaterThan(0);
    // At most one every 2 s: a 5 s job sends at most 3.
    expect(sent.length).toBeLessThanOrEqual(3);
  });

  it("drops a preview over 64 KB, keeping the progress", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const t = ownerTask(GPU_WORKFLOW, { preview: true });
    start(w, s, p, { gpu: { steps: 8, stepMs: 400 }, shrinkPreview: async () => new Blob([jpeg(70 * 1024)], { type: "image/jpeg" }) });
    expect((await ended(t.id)).state).toBe("done");
    expect(previews(s, t.id)).toEqual([]);
    expect(s.reports.some((r) => r.task === t.id && r.event === "running")).toBe(true);
    expect(tasks.taskPreview(t.id)).toBeNull();
  });

  it("sends none for a run that doesn't ask for previews", async () => {
    const w = addWorker();
    const s = studio();
    const p = pc();
    const t = ownerTask(GPU_WORKFLOW);
    let asked = 0;
    start(w, s, p, { gpu: { steps: 8, stepMs: 300 }, shrinkPreview: async () => (asked++, new Blob([jpeg(1000)], { type: "image/jpeg" })) });
    expect((await ended(t.id)).state).toBe("done");
    expect(previews(s, t.id)).toEqual([]);
    expect(asked).toBe(0);
  });

  it.runIf(hasFfmpeg)("ffmpeg makes a PNG preview again as a JPEG under 64 KB, and nothing of it stays", async () => {
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 1024, height: 768, channels: 3, background: "#a5c" } }).png().toBuffer();
    const dir2 = tempDir("fuobe-cpu-slot-preview-");
    const shrink = previewShrinker({ ffmpeg: "ffmpeg", dir: dir2 });
    const out = (await shrink(new Blob([png], { type: "image/png" })))!;
    expect(out.type).toBe("image/jpeg");
    expect(out.size).toBeLessThanOrEqual(PREVIEW_MAX_BYTES);
    const meta = await sharp(Buffer.from(await out.arrayBuffer())).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(512);
    expect(fs.readdirSync(dir2)).toEqual([]);
    // Not a picture: nothing.
    expect(await shrink(new Blob([Buffer.from("<html>")], { type: "image/png" }))).toBeNull();
    expect(await previewShrinker({ ffmpeg: null, dir: dir2 })(new Blob([png]))).toBeNull();
  });

  it("ffmpeg makes a preview again only from a local PNG or JPEG, at most 512 pixels, with no metadata", () => {
    const a = previewArgs("in.png", "out.jpg");
    expect(a.slice(a.indexOf("-protocol_whitelist"), a.indexOf("-protocol_whitelist") + 2)).toEqual(["-protocol_whitelist", "file"]);
    expect(a[a.indexOf("-vf") + 1]).toMatch(/min\(512,iw\).*min\(512,ih\)/);
    expect(a).toEqual(expect.arrayContaining(["-map_metadata", "-1", "-frames:v", "1"]));
    expect(a[a.length - 1]).toBe("out.jpg");
  });
});
