import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/**
 * Run-time files on this install's GPUs (docs/gpu-workers.md "Run-time files"): a Soul look's, Soul Cinema's or a DoP
 * motion's LoRAs are files beyond the workflow's own. A worker refuses a graph that names a file it hasn't verified, so
 * these GPUs are offered for such a run only when a worker that may run its workflow verified every one of them. Until
 * then the price check and the run say the visitor's own GPU runs it (never a refusal at the worker, never the LoRAs
 * dropped), the preset cards say so too, and a task goes only to a worker that has the files.
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 60_000 });

const dir = tempDir("fuobe-pool-runtime-files-");
process.env.FUOBE_DATA_DIR = dir;
// Nothing answers here: no test may reach a real ComfyUI on this machine.
const DEAD = "http://127.0.0.1:7";
process.env.COMFYUI_URL = DEAD;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_HOSTED_RUNS;
delete process.env.FUOBE_HOSTED_FREE;
delete process.env.FUOBE_BILLING_URL;
delete process.env.FUOBE_MODERATION_URL;
globalThis.__fuobeTestDiskFree = 1e13;

const realFetch = globalThis.fetch;
globalThis.fetch = (async () => new Response("not reachable in this test", { status: 599 })) as typeof fetch;

const auth = await import("@/server/auth");
const generationsRoute = await import("@/app/api/generations/route");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const pool = await import("@/server/computer/pool");
const billing = await import("@/server/billing");
const hosted = await import("@/server/hosted");
const { decidePlace, poolQuote } = await import("@/server/hosted-run");
const { loadManifest, noWorkerForFiles } = await import("@/server/providers/comfyui");
const { loadIndex } = await import("@/server/gpu/index-file");
const { allLanes, needsOf } = await import("@/lib/lanes");
const { catalogVersion } = await import("@/server/computer/catalog-version");
const { runtimeNeeds } = await import("@/lib/runtime-files");
const { soulRecipe } = await import("@/lib/catalog/soul");
const { getModel, getPreset, PRESETS } = await import("@/lib/catalog");
const { presetRoutes } = await import("@/lib/catalog/preset-recipe-routes");
const { poolOwnPresets } = await import("@/server/pool-own-setup");
const { previewGeneration } = await import("@/server/generations");

const HOST = "localhost:3000";
const SITE_HEADERS = { host: HOST, "sec-fetch-site": "same-origin", origin: `http://${HOST}` };
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** A Soul run in the default photo look: Shakker-Labs AWPortrait-Z and the Lenovo phone-realism LoRA, both pinned. */
const LOOK = "v1-general";
const soulRun = { feature: "image", modelId: "fuobe-soul", engine: "open", presetId: LOOK, prompt: "a portrait by a window", params: { aspectRatio: "3:4" } } as const;
const lookFiles = soulRecipe("soul", "x", { look: LOOK }).loras.map((l) => l.file);

let account: NonNullable<ReturnType<typeof auth.accountById>>;
let cookie = "";

beforeAll(() => {
  auth.setPassword("install password");
  const id = auth.createAccount("runtime-files@example.com", "long enough").id;
  account = auth.accountById(id)!;
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(id).value}`;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  globalThis.__fuobeTestDiskFree = undefined;
  for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_HOSTED_FREE"]) delete process.env[k];
});
beforeEach(() => {
  resetRates();
  billing.resetBillingCache();
  process.env.FUOBE_HOSTED_RUNS = "1";
  process.env.FUOBE_HOSTED_FREE = "1";
  setSetting("comfyWhere", "workers");
  setSetting("comfyUrl", "");
  setSetting("engineMode", "open");
  setSetting("demoMode", "off");
  db().prepare("DELETE FROM relay_workers").run();
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
});

/**
 * A worker the owner added and resumed, allowed every lane, able to run every workflow, that verified the workflows'
 * files and the given run-time files (by name), as its inventory said.
 */
function standInWorker(name: string, runtime: readonly string[] = []) {
  const w = pool.addWorker(name);
  const index = loadIndex();
  const lanes = allLanes(index, sha);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: Object.fromEntries(lanes.map((l) => [l.lane, { delayMs: 0 }])), claimAfterMs: 0 });
  db()
    .prepare("UPDATE relay_workers SET facts_json = ?, catalog_version = ?, protocol = 3, seen_at = ?, paused_local = 0 WHERE id = ?")
    .run(JSON.stringify({ vramBytes: 96 * 2 ** 30 }), catalogVersion(), Date.now(), w.id);
  // Its list of files, as PUT /api/gpu/computer/inventory takes it: every workflow's own files, and the run-time ones.
  const own = Object.values(index.files).map((f) => ({ folder: f.folder, name: f.file, size: f.sizeBytes, sha256: f.sha256 ?? null }));
  const extra = runtimeNeeds(runtime, index).files;
  const packs = Object.keys(index.packs ?? {}).map((name) => ({ name, commit: null }));
  pool.saveInventory(row(w.id), { files: [...own, ...extra], nodePacks: packs, media: ["image", "video", "audio"] });
  // Every workflow, whatever this test's catalog copy says of their packs.
  db()
    .prepare("UPDATE relay_workers SET lanes_json = ? WHERE id = ?")
    .run(JSON.stringify({ lanes: lanes.map((l) => l.lane), workflows: loadManifest().workflows.map((x) => x.id) }), w.id);
  return w;
}
const row = (id: string) => db().prepare("SELECT * FROM relay_workers WHERE id = ?").get(id) as import("@/server/computer/workers").WorkerRow;

const press = async (body: Record<string, unknown>) => {
  const text = JSON.stringify(body);
  const r = await generationsRoute.POST(
    new Request(`http://${HOST}/api/generations`, { method: "POST", headers: { ...SITE_HEADERS, cookie, "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }, body: text }),
  );
  return { status: r.status, body: (await r.json()) as Record<string, unknown> & { items?: { id: string }[]; code?: string; error?: string } };
};
const taskOf = (generationId: string) => db().prepare("SELECT * FROM relay_tasks WHERE generation_id = ? ORDER BY created_at DESC").get(generationId) as import("@/server/computer/tasks").TaskRow | undefined;

describe("a run that adds files at run time, on this install's GPUs", () => {
  it("knows the look's LoRAs as the run's files beyond its workflow's own", () => {
    expect(lookFiles).toEqual(expect.arrayContaining(["AWPortrait-Z.safetensors"]));
    const p = previewGeneration(soulRun);
    expect(p.route.provider).toBe("comfyui");
    const r = runtimeNeeds(lookFiles, loadIndex(), p.route.endpoint);
    expect(r.unknown).toEqual([]);
    expect(r.files.map((f) => f.name).sort()).toEqual([...lookFiles].sort());
    expect(r.files.every((f) => f.folder === "loras" && f.size > 0 && /^[0-9a-f]{64}$/.test(f.sha256 ?? ""))).toBe(true);
  });

  it("no worker verified them: the price check says the visitor's own GPU runs it, with its plain reason, and the run opens that setup", async () => {
    standInWorker("no-loras");
    const endpoint = previewGeneration(soulRun).route.endpoint;
    // The workflow itself runs there: only the look's files keep it off.
    expect(hosted.poolTakes(endpoint)).toBe(true);
    expect(hosted.poolHasFiles(endpoint, lookFiles)).toBe(false);
    const q = await poolQuote(account, soulRun, undefined);
    expect(q?.quote).toMatchObject({ allowed: false, code: "not-offered", text: "This style runs on your own GPU", sub: "Connect your GPU to use this style, or pick another one." });
    expect((q!.quote as { ownSetup?: unknown }).ownSetup).toMatchObject({ need: "gpu" });
    // The press: never a run that a worker would refuse, never the LoRAs left out; Connect your GPU instead.
    const d = await decidePlace(account, soulRun, undefined);
    expect(d.kind).toBe("refuse");
    const refusal = (d as { refusal: { body: Record<string, unknown> } }).refusal;
    expect(refusal.body).toMatchObject({ error: "This style runs on your own GPU", code: "connect-gpu" });
    const r = await press(soulRun);
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: "This style runs on your own GPU", code: "connect-gpu" });
    expect(db().prepare("SELECT COUNT(*) AS n FROM relay_tasks WHERE state = 'waiting'").get()).toEqual({ n: 0 });
  });

  it("a worker that verified every one: offered there, and the task goes only to a worker with those files", async () => {
    const without = standInWorker("no-loras");
    standInWorker("with-loras", lookFiles);
    const endpoint = previewGeneration(soulRun).route.endpoint;
    expect(hosted.poolHasFiles(endpoint, lookFiles)).toBe(true);
    // Half of them is not enough.
    expect(hosted.poolHasFiles(endpoint, [...lookFiles, "someone-else-trained.safetensors"])).toBe(false);
    const q = await poolQuote(account, soulRun, undefined);
    expect(q?.quote.allowed, JSON.stringify(q?.quote)).toBe(true);
    const r = await press(soulRun);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.items![0].id;
    let t: ReturnType<typeof taskOf>;
    for (let i = 0; i < 200 && !(t = taskOf(id)); i++) {
      await globalThis.__fuobeRunner?.tick();
      await new Promise((res) => setTimeout(res, 20));
    }
    expect(t!, "the run's task").toBeDefined();
    const needs = JSON.parse(t!.needs_json ?? "{}") as { runtime?: { name: string }[] };
    expect(needs.runtime?.map((f) => f.name).sort()).toEqual([...lookFiles].sort());
    // The worker without them never takes it; the one with them does.
    expect(pool.workerClaim(row(without.id), [])).toBeNull();
    const withRow = db().prepare("SELECT * FROM relay_workers WHERE name = 'with-loras'").get() as import("@/server/computer/workers").WorkerRow;
    expect(pool.workerClaim(withRow, [])?.id).toBe(t!.id);
  });

  it("a file no worker can verify (no pin) keeps it off, and the owner's error names the files", () => {
    standInWorker("with-loras", lookFiles);
    const endpoint = previewGeneration(soulRun).route.endpoint;
    expect(hosted.poolHasFiles(endpoint, ["my-trained-face.safetensors"])).toBe(false);
    expect(noWorkerForFiles(["AWPortrait-Z.safetensors"])).toContain("AWPortrait-Z.safetensors");
    expect(noWorkerForFiles(["a.safetensors", "b.safetensors"])).toMatch(/^No worker has these files yet: a\.safetensors, b\.safetensors\./);
  });

  it("an inventory keeps the library's pinned files and nothing else beyond the index", () => {
    const w = standInWorker("lists");
    const index = loadIndex();
    const own = Object.values(index.files)
      .slice(0, 3)
      .map((f) => ({ folder: f.folder, name: f.file, size: f.sizeBytes, sha256: f.sha256 ?? null }));
    const look = runtimeNeeds(lookFiles, index).files;
    pool.saveInventory(row(w.id), { files: [...own, ...look, { folder: "loras", name: "not-in-the-library.safetensors", size: 10, sha256: "0".repeat(64) }], nodePacks: [] });
    const kept = pool.inventoryOf(row(w.id)).files.map((f) => `${f.folder}/${f.name}`);
    expect(kept).toEqual(expect.arrayContaining(look.map((f) => `loras/${f.name}`)));
    expect(kept).not.toContain("loras/not-in-the-library.safetensors");
    expect(kept).toHaveLength(own.length + look.length);
  });

  it("a preset card whose LoRAs no worker verified says the visitor's own GPU before the press; with them it doesn't", () => {
    // A DoP motion or effect on its own model: a route of the preset that adds pinned LoRAs.
    const pinned = (r: ReturnType<typeof presetRoutes>[number]) => !r.end && (r.loras?.length ?? 0) > 0 && r.loras!.every((l) => runtimeNeeds([l.file], loadIndex()).unknown.length === 0);
    const preset = PRESETS.find((p) => presetRoutes(p, "open", (id) => !!getModel(id)).some(pinned))!;
    expect(preset, "a preset whose open route adds pinned LoRAs").toBeDefined();
    const route = presetRoutes(preset, "open", (id) => !!getModel(id)).find(pinned)!;
    const step = { modelId: route.modelId, op: route.op, loras: route.loras!.map((l) => l.file) };
    const endpoint = getModel(route.modelId)!.routes.find((x) => x.provider === "comfyui" && x.op === route.op)!.endpoint;
    standInWorker("no-loras");
    expect(hosted.poolTakes(endpoint)).toBe(true);
    expect(poolOwnPresets([{ id: preset.id, steps: [step] }], hosted.poolTakes, hosted.poolHasFiles)[preset.id]).toMatchObject({ need: "gpu" });
    // Without the files check (as before), the card would say these GPUs run it.
    expect(poolOwnPresets([{ id: preset.id, steps: [step] }], hosted.poolTakes)[preset.id]).toBeUndefined();
    standInWorker("with-loras", step.loras);
    expect(poolOwnPresets([{ id: preset.id, steps: [step] }], hosted.poolTakes, hosted.poolHasFiles)[preset.id]).toBeUndefined();
    expect(getPreset(preset.id)).toBeDefined();
  });

  it("a workflow's own LoRA is its lane's to say, not a run-time file", () => {
    const index = loadIndex();
    const [id, wf] = Object.entries(index.workflows).find(([, w]) => w.files.some((k) => k.startsWith("loras/")))!;
    const own = wf.files.find((k) => k.startsWith("loras/"))!.slice("loras/".length);
    expect(runtimeNeeds([own], index, id)).toEqual({ files: [], unknown: [] });
    expect(needsOf(index, id)!.files.some((f) => f.folder === "loras" && f.name === own)).toBe(true);
  });
});
