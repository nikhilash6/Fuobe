import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { inventoryHash as workerHash, loadedPacks, packsAsSeen } from "../bin/lib/worker/inventory.mjs";
import { tempDir } from "./helpers/temp-dir";

/**
 * A node pack whose folder is on a worker's PC but whose nodes its ComfyUI didn't load (an import that failed: the
 * NVIDIA RTX Video nodes without their Python package). The worker reads /object_info after its ComfyUI starts and says,
 * per pack, which of the catalog's classes are missing; the studio then never sends it a workflow that needs one, and
 * the owner sees why on the Workers page. A worker that doesn't say counts by its folders, as before.
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-worker-loaded-nodes-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
delete process.env.FUOBE_PASSWORD;

const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const pool = await import("@/server/computer/pool");
const workers = await import("@/server/computer/workers");
const { lanesFor, needsOf, laneOf, unloadedNodes } = await import("@/lib/lanes");
const { loadIndex } = await import("@/server/gpu/index-file");
const { unloadedLine } = await import("@/components/workers-admin");

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const RTX = "ComfyUI_Nvidia_VFX_Nodes";
const RTX_WORKFLOWS = ["fps-rtx-framegen", "sdr-to-hdr-rtx", "upscale-video-rtx"];
const GB = 2 ** 30;

/** Everything the index names for these workflows: their files (verified) and every pack they need (by folder). */
function inventoryFor(ids: string[]) {
  const index = loadIndex();
  const needs = ids.map((id) => needsOf(index, id)!);
  const files = [...new Map(needs.flatMap((n) => n.files).map((f) => [`${f.folder}/${f.name}`, { ...f, sha256: f.sha256 ?? "0".repeat(64) }])).values()];
  const nodePacks = [...new Set(needs.flatMap((n) => n.packs))].sort().map((name) => ({ name, commit: null as string | null }));
  return { files, nodePacks, media: ["image", "video", "audio"] as ("image" | "video" | "audio")[] };
}

describe("the worker reads what its ComfyUI loaded", () => {
  const index = { packs: { [RTX]: { classes: ["RTXTrueHDR", "RTXVideoFrameGeneration", "RTXVideoSuperResolution"] }, "ComfyUI-VideoHelperSuite": { classes: ["VHS_LoadVideo", "VHS_VideoCombine"] } } };
  const packs = [
    { name: RTX, folder: RTX, commit: "38d790ded00650681fa3645362efe28c8560cf40" },
    { name: "ComfyUI-VideoHelperSuite", folder: "comfyui-videohelpersuite", commit: null },
  ];

  it("lists, per pack it has, the catalog's classes /object_info leaves out (all of them for a pack that failed to import)", () => {
    const info = { VHS_LoadVideo: {}, VHS_VideoCombine: {}, KSampler: {} };
    expect(loadedPacks(packs, index, info)).toEqual({
      [RTX]: { commit: packs[0].commit, missing: ["RTXTrueHDR", "RTXVideoFrameGeneration", "RTXVideoSuperResolution"] },
      "ComfyUI-VideoHelperSuite": { commit: null, missing: [] },
    });
    expect(loadedPacks(packs, index, { ...info, RTXTrueHDR: {}, RTXVideoFrameGeneration: {}, RTXVideoSuperResolution: {} })[RTX].missing).toEqual([]);
  });

  it("sends a reading only for the commit it was made at; before any reading a pack goes as it always did", () => {
    const loaded = loadedPacks(packs, index, { VHS_LoadVideo: {}, VHS_VideoCombine: {} });
    expect(packsAsSeen(packs, {})).toEqual([
      { name: RTX, commit: packs[0].commit },
      { name: "ComfyUI-VideoHelperSuite", commit: null },
    ]);
    expect(packsAsSeen(packs, loaded)[0]).toEqual({ name: RTX, commit: packs[0].commit, missingClasses: ["RTXTrueHDR", "RTXVideoFrameGeneration", "RTXVideoSuperResolution"] });
    expect(packsAsSeen(packs, loaded)[1]).toEqual({ name: "ComfyUI-VideoHelperSuite", commit: null, missingClasses: [] });
    // The pack moved to another commit since: its old reading doesn't count until its ComfyUI starts again.
    expect(packsAsSeen([{ ...packs[0], commit: "f".repeat(40) }], loaded)[0]).toEqual({ name: RTX, commit: "f".repeat(40) });
  });

  it("hashes as the studio does; with nothing missing, the hash is an older worker's", async () => {
    const { inventoryHash } = await import("@/server/computer/pool");
    const base = { files: [{ folder: "loras", name: "a.safetensors", size: 7, sha256: null }], nodePacks: [{ name: RTX, commit: null }] };
    const broken = { ...base, nodePacks: [{ name: RTX, commit: null, missingClasses: ["RTXVideoSuperResolution", "RTXTrueHDR"] }] };
    const fine = { ...base, nodePacks: [{ name: RTX, commit: null, missingClasses: [] }] };
    expect(workerHash(broken)).toBe(inventoryHash(broken));
    expect(workerHash(broken)).not.toBe(workerHash(base));
    expect(workerHash(fine)).toBe(workerHash(base));
    expect(inventoryHash(fine)).toBe(inventoryHash(base));
  });
});

describe("the studio's lanes from a worker's packs", () => {
  it("a workflow whose pack's nodes didn't load isn't the worker's to run; its other workflows are", () => {
    const index = loadIndex();
    const inv = inventoryFor(RTX_WORKFLOWS);
    // No reading (an older worker, or before its ComfyUI started): its folders count, as before.
    for (const id of RTX_WORKFLOWS) expect(lanesFor(index, inv, sha).workflows, id).toContain(id);
    // Read, and every node there.
    const fine = { ...inv, nodePacks: inv.nodePacks.map((p) => ({ ...p, missingClasses: [] as string[] })) };
    for (const id of RTX_WORKFLOWS) expect(lanesFor(index, fine, sha).workflows, id).toContain(id);
    // The RTX pack's import failed: none of its three workflows.
    const failed = { ...inv, nodePacks: inv.nodePacks.map((p) => (p.name === RTX ? { ...p, missingClasses: ["RTXTrueHDR", "RTXVideoFrameGeneration", "RTXVideoSuperResolution"] } : p)) };
    const r = lanesFor(index, failed, sha);
    for (const id of RTX_WORKFLOWS) expect(r.workflows, id).not.toContain(id);
    expect(r.missing.flatMap((m) => m.files)).toEqual(expect.arrayContaining([`node:${RTX}/RTXTrueHDR`, `node:${RTX}/RTXVideoFrameGeneration`, `node:${RTX}/RTXVideoSuperResolution`]));
    // Only HDR's node missing: the frame generation and the upscale still run there.
    const partly = { ...inv, nodePacks: inv.nodePacks.map((p) => (p.name === RTX ? { ...p, missingClasses: ["RTXTrueHDR"] } : p)) };
    const w = lanesFor(index, partly, sha).workflows;
    expect(w).not.toContain("sdr-to-hdr-rtx");
    expect(w).toEqual(expect.arrayContaining(["fps-rtx-framegen", "upscale-video-rtx"]));
    expect(laneOf(index, "sdr-to-hdr-rtx", sha)).toBeTruthy();
  });

  it("names the classes a workflow needs that didn't load, by pack", () => {
    const packs = new Map([[RTX, { name: RTX, commit: null, missingClasses: ["RTXTrueHDR"] }]]);
    expect(unloadedNodes({ packs: { [RTX]: ["RTXTrueHDR"], "ComfyUI-VideoHelperSuite": ["VHS_LoadVideo"] } }, packs)).toEqual([`${RTX}/RTXTrueHDR`]);
    expect(unloadedNodes({ packs: { [RTX]: ["RTXVideoSuperResolution"] } }, packs)).toEqual([]);
  });
});

describe("a worker that says its RTX nodes didn't load", () => {
  beforeEach(() => {
    resetRates();
    db().prepare("DELETE FROM relay_workers").run();
    setSetting("comfyWhere", "workers");
  });

  const put = async (w: { token: string }, body: unknown) => {
    const { PUT } = await import("@/app/api/gpu/computer/inventory/route");
    const res = await PUT(new Request("http://localhost:3000/api/gpu/computer/inventory", { method: "PUT", headers: { host: "localhost:3000", authorization: `Bearer ${w.token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
    return { status: res.status, body: (await res.json()) as { workflows?: string[] } };
  };
  const beatWith = (w: { id: string }, inventoryHash: string | null) =>
    pool.workerBeat(workers.getWorker(w.id)!, pool.cleanBeat({ device: `wkr-${w.id}`, protocol: 2, version: "1.0.0", local: { paused: false, why: null, until: null }, gpu: {}, inventoryHash, running: [], stopped: [] }), Date.now());

  it("isn't offered its workflows, isn't asked for its list again, and the owner sees why", async () => {
    const index = loadIndex();
    const w = pool.addWorker("rtx-pc");
    const lanes = [...new Set(RTX_WORKFLOWS.map((id) => laneOf(index, id, sha)!))];
    pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: Object.fromEntries(lanes.map((l) => [l, { delayMs: 0 }])), claimAfterMs: 0 });
    db().prepare("UPDATE relay_workers SET facts_json = ? WHERE id = ?").run(JSON.stringify({ vramBytes: 32 * GB, device: "NVIDIA GeForce RTX 5090" }), w.id);
    const inv = inventoryFor(RTX_WORKFLOWS);

    // Before its ComfyUI said anything: the folder counts (an older worker's way).
    expect((await put(w, inv)).body.workflows).toEqual(expect.arrayContaining(RTX_WORKFLOWS));
    for (const id of RTX_WORKFLOWS) expect(pool.workersCanRun(id), id).toBe(true);
    expect(pool.workerView(workers.getWorker(w.id)!).unloaded).toEqual([]);

    // After its start: the RTX pack didn't load.
    const failed = { ...inv, nodePacks: inv.nodePacks.map((p) => ({ ...p, missingClasses: p.name === RTX ? ["RTXTrueHDR", "RTXVideoFrameGeneration", "RTXVideoSuperResolution"] : [] })) };
    expect(beatWith(w, workerHash(failed)).worker.sendInventory).toBe(true);
    const r = await put(w, failed);
    expect(r.status).toBe(200);
    for (const id of RTX_WORKFLOWS) {
      expect(r.body.workflows, id).not.toContain(id);
      expect(pool.workersCanRun(id), id).toBe(false);
    }
    // The studio's hash of what it kept is the worker's: no list asked for again on every beat.
    expect(beatWith(w, workerHash(failed)).worker.sendInventory).toBe(false);
    const view = pool.workerView(workers.getWorker(w.id)!);
    expect(view.unloaded).toEqual([{ pack: RTX, classes: ["RTXTrueHDR", "RTXVideoFrameGeneration", "RTXVideoSuperResolution"], workflows: RTX_WORKFLOWS }]);
    const line = unloadedLine(view.unloaded[0]);
    expect(line).toContain(`${RTX} didn't load in this PC's ComfyUI`);
    expect(line).toContain("The 3 workflows that need it aren't sent here: fps-rtx-framegen, sdr-to-hdr-rtx, upscale-video-rtx.");

    // Fixed on the PC (its package installed, ComfyUI started again): offered again.
    const fixed = { ...inv, nodePacks: inv.nodePacks.map((p) => ({ ...p, missingClasses: [] as string[] })) };
    expect((await put(w, fixed)).body.workflows).toEqual(expect.arrayContaining(RTX_WORKFLOWS));
    for (const id of RTX_WORKFLOWS) expect(pool.workersCanRun(id), id).toBe(true);
    expect(pool.workerView(workers.getWorker(w.id)!).unloaded).toEqual([]);
  });

  it("keeps only class names it can read, and never more than it was sent", async () => {
    const w = pool.addWorker("odd-pc");
    const inv = inventoryFor(["sdr-to-hdr-rtx"]);
    const odd = { ...inv, nodePacks: inv.nodePacks.map((p) => (p.name === RTX ? { ...p, missingClasses: ["RTXTrueHDR", 7, "", "x".repeat(200)] } : p)) };
    expect((await put(w, odd)).status).toBe(200);
    const kept = JSON.parse(workers.getWorker(w.id)!.inventory_json ?? "{}") as { nodePacks: { name: string; missingClasses?: string[] }[] };
    expect(kept.nodePacks.find((p) => p.name === RTX)?.missingClasses).toEqual(["RTXTrueHDR"]);
  });
});
