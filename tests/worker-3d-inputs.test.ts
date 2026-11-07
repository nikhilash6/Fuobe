import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as workerModel from "../bin/lib/worker/model-file.mjs";
import type { TaskRow } from "@/server/computer/tasks";
import { tempDir } from "./helpers/temp-dir";

/**
 * 3D files a job sends to the shared GPU workers: Any Angle's angles read the splat its 3D build made (and Hi3D's refine
 * the GLB of the step before it). The studio checks each by its bytes and makes a splat again before a worker gets it,
 * the worker checks it again before its ComfyUI reads it, and the place gate offers these GPUs only for a run whose
 * every step's files they take, so nothing visible ends at a step they can't run.
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 60_000 });

const dir = tempDir("fuobe-worker-3d-inputs-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:7";
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
const tasks = await import("@/server/computer/tasks");
const billing = await import("@/server/billing");
const hosted = await import("@/server/hosted");
const { poolQuote } = await import("@/server/hosted-run");
const { forWorkers, loadManifest } = await import("@/server/providers/comfyui");
const { loadIndex } = await import("@/server/gpu/index-file");
const { allLanes } = await import("@/lib/lanes");
const { catalogVersion } = await import("@/server/computer/catalog-version");
const { chainFileKinds } = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");
const { spzPoints } = await import("@/server/model-input");
const { ANY_ANGLE, shotExtra } = await import("@/lib/catalog/any-angle");
const { TINY_PNG } = await import("./helpers/fake-comfy-runner");

const HOST = "localhost:3000";
const SITE_HEADERS = { host: HOST, "sec-fetch-site": "same-origin", origin: `http://${HOST}` };
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** TripoSplat's own splat as the open graph saves it (scripts/comfy/fixtures/test.spz: 64 points, version 2). */
const SPLAT = fs.readFileSync(path.join(process.cwd(), "scripts/comfy/fixtures/test.spz"));
const RAW = zlib.gunzipSync(SPLAT);

/** The same points in a gzip that carries a file name and a comment. */
function dressedSplat(): Buffer {
  const g = zlib.gzipSync(RAW);
  const head = Buffer.from(g.subarray(0, 10));
  head[3] = 0x18;
  return Buffer.concat([head, Buffer.from("C:\\Users\\someone\\secret.spz\0"), Buffer.from("a note\0"), g.subarray(10)]);
}

/** A binary glTF 2 with one buffer: inside the file, or at `uri`. */
function glb(uri?: string, o: { tail?: Buffer } = {}): Buffer {
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, buffers: [{ byteLength: 4, ...(uri && { uri }) }] }).padEnd(64, " "));
  const bin = Buffer.alloc(4);
  const chunk = (type: number, data: Buffer) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  const body = Buffer.concat([chunk(0x4e4f534a, json), chunk(0x004e4942, bin), o.tail ?? Buffer.alloc(0)]);
  const head = Buffer.alloc(12);
  head.write("glTF", 0, "latin1");
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([head, body]);
}

const PLY = Buffer.from("ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float x\nend_header\n\0\0\0\0");

describe("a splat for the shared GPUs (Any Angle's angles)", () => {
  it("the owner's job sends its splat, made again: the same points in a fresh gzip", async () => {
    const out = await forWorkers(dressedSplat(), "model/x-spz", "view.spz");
    expect(out.contentType).toBe("model/x-spz");
    expect(out.name).toBe("view.spz");
    expect(zlib.gunzipSync(out.data).equals(RAW)).toBe(true);
    // Nothing of the file it came in: no name, no comment.
    expect(out.data[3]).toBe(0);
    expect(out.data.includes(Buffer.from("secret"))).toBe(false);
    // Bytes after the stream: not a splat.
    await expect(forWorkers(Buffer.concat([SPLAT, Buffer.from("anything after it")]), "model/x-spz", "v.spz")).rejects.toThrow(/don't take/);
  });

  it("an account's run sends its splat the same way", async () => {
    const out = await forWorkers(SPLAT, "model/x-spz", "fuobe_x.spz", { onWorker: true });
    expect(spzPoints(out.data)?.equals(RAW)).toBe(true);
  });

  it("anything that only looks like one is refused: another gzip, too few or too many points' bytes, a page", async () => {
    const short = zlib.gzipSync(RAW.subarray(0, RAW.length - 1));
    const long = zlib.gzipSync(Buffer.concat([RAW, Buffer.alloc(1)]));
    const other = zlib.gzipSync(Buffer.from("<html><script>alert(1)</script></html>"));
    const many = Buffer.from(RAW);
    many.writeUInt32LE(2 ** 30, 8);
    for (const [what, data] of [["short", short], ["long", long], ["other", other], ["points", zlib.gzipSync(many)], ["page", Buffer.from("<html></html>")]] as const) {
      await expect(forWorkers(data, "model/x-spz", "v.spz"), what).rejects.toThrow(/don't take this kind of file/);
      await expect(forWorkers(data, "model/x-spz", "v.spz", { onWorker: true }), what).rejects.toThrow(/don't take this kind of file/);
    }
  });
});

describe("other 3D files for the shared GPUs", () => {
  it("a GLB: whole, and an account's with nothing outside it; the owner's may point elsewhere as its results may", async () => {
    expect((await forWorkers(glb(), "model/gltf-binary", "m.glb", { onWorker: true })).data.equals(glb())).toBe(true);
    await expect(forWorkers(glb("../secret.bin"), "model/gltf-binary", "m.glb", { onWorker: true })).rejects.toThrow(/don't take/);
    expect((await forWorkers(glb("../secret.bin"), "model/gltf-binary", "m.glb")).contentType).toBe("model/gltf-binary");
    // More bytes after its last chunk, or a header that says another length: not a GLB, for anyone.
    await expect(forWorkers(glb(undefined, { tail: Buffer.from("xyz") }), "model/gltf-binary", "m.glb")).rejects.toThrow(/don't take/);
    const lying = glb();
    lying.writeUInt32LE(lying.length + 4, 8);
    await expect(forWorkers(lying, "model/gltf-binary", "m.glb")).rejects.toThrow(/don't take/);
  });

  it("a .ply only from the owner's own jobs, as with results", async () => {
    expect((await forWorkers(PLY, "model/ply", "s.ply")).data.equals(PLY)).toBe(true);
    await expect(forWorkers(PLY, "model/ply", "s.ply", { onWorker: true })).rejects.toThrow(/don't take/);
    await expect(forWorkers(Buffer.from("not a ply"), "model/ply", "s.ply")).rejects.toThrow(/don't take/);
  });

  it("other kinds of file stay off the workers", async () => {
    await expect(forWorkers(Buffer.from("{}"), "application/json", "a.json")).rejects.toThrow(/don't take this kind of file/);
    await expect(forWorkers(Buffer.from("PK"), "application/zip", "a.zip")).rejects.toThrow(/don't take this kind of file/);
  });
});

describe("the worker checks 3D files again before its ComfyUI reads them", () => {
  it("knows them by type or name", () => {
    expect(workerModel.modelFormat({ contentType: "model/x-spz", name: "fuobe_a.spz" })).toBe("spz");
    expect(workerModel.modelFormat({ contentType: "", name: "fuobe_a.glb" })).toBe("glb");
    expect(workerModel.modelFormat({ contentType: "image/png", name: "fuobe_a.png" })).toBeNull();
  });

  it("makes a splat again, and refuses one whose points don't add up", () => {
    const again = workerModel.modelAgain("spz", dressedSplat(), true);
    expect(zlib.gunzipSync(again!).equals(RAW)).toBe(true);
    expect(again!.includes(Buffer.from("secret"))).toBe(false);
    expect(workerModel.modelAgain("spz", zlib.gzipSync(RAW.subarray(0, 100)), true)).toBeNull();
    expect(workerModel.modelAgain("spz", Buffer.from("plain text"), false)).toBeNull();
  });

  it("an account's GLB has nothing outside it, and its job never sends a .ply; the owner's may", () => {
    expect(workerModel.modelAgain("glb", glb(), true)?.equals(glb())).toBe(true);
    expect(workerModel.modelAgain("glb", glb("file:///etc/passwd"), true)).toBeNull();
    expect(workerModel.modelAgain("glb", glb("file:///etc/passwd"), false)).not.toBeNull();
    expect(workerModel.modelAgain("glb", glb(undefined, { tail: Buffer.from("x") }), false)).toBeNull();
    expect(workerModel.modelAgain("ply", PLY, true)).toBeNull();
    expect(workerModel.modelAgain("ply", PLY, false)?.equals(PLY)).toBe(true);
  });
});

describe("the place gate and the files each step reads", () => {
  let account: NonNullable<ReturnType<typeof auth.accountById>>;
  let cookie = "";

  beforeAll(() => {
    auth.setPassword("install password");
    const id = auth.createAccount("three-d@example.com", "long enough").id;
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

  /** A worker the owner resumed, allowed every lane, with every catalog file, running the given workflows (all unless said). */
  function standInWorker(name: string, workflows?: string[]) {
    const w = pool.addWorker(name);
    const index = loadIndex();
    const lanes = allLanes(index, sha);
    pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: Object.fromEntries(lanes.map((l) => [l.lane, { delayMs: 0 }])), claimAfterMs: 0 });
    db()
      .prepare("UPDATE relay_workers SET facts_json = ?, catalog_version = ?, protocol = 3, seen_at = ?, paused_local = 0 WHERE id = ?")
      .run(JSON.stringify({ vramBytes: 96 * 2 ** 30 }), catalogVersion(), Date.now(), w.id);
    const own = Object.values(index.files).map((f) => ({ folder: f.folder, name: f.file, size: f.sizeBytes, sha256: f.sha256 ?? null }));
    const packs = Object.keys(index.packs ?? {}).map((n) => ({ name: n, commit: null }));
    const row = db().prepare("SELECT * FROM relay_workers WHERE id = ?").get(w.id) as import("@/server/computer/workers").WorkerRow;
    pool.saveInventory(row, { files: own, nodePacks: packs, media: ["image", "video", "audio"] });
    db()
      .prepare("UPDATE relay_workers SET lanes_json = ? WHERE id = ?")
      .run(JSON.stringify({ lanes: lanes.map((l) => l.lane), workflows: workflows ?? loadManifest().workflows.map((x) => x.id) }), w.id);
    return w;
  }

  const press = async (body: Record<string, unknown>) => {
    const text = JSON.stringify(body);
    const r = await generationsRoute.POST(
      new Request(`http://${HOST}/api/generations`, { method: "POST", headers: { ...SITE_HEADERS, cookie, "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }, body: text }),
    );
    return { status: r.status, body: (await r.json()) as Record<string, unknown> & { items?: { id: string }[]; error?: string } };
  };

  const mine = (data: Buffer, contentType: string, name: string) => saveFile({ data, contentType, name, source: "upload", accountId: account.id }).url;

  const angle = (photo: string, splat: string) => ({
    feature: ANY_ANGLE.feature,
    modelId: ANY_ANGLE.shotModel,
    op: "edit",
    engine: "open",
    prompt: "Left 30°",
    inputs: { images: [photo] },
    params: { seed: 46, extra: shotExtra({ yaw: 95, pitch: 10, distance: 2, fov: 33, target: [0, 0, 0] }, { width: 512, height: 512 }, splat) },
  });

  it("an account's angle goes in line for the workers with its splat made again (it used to fail at the upload)", async () => {
    standInWorker("all");
    const req = angle(mine(TINY_PNG, "image/png", "me.png"), mine(SPLAT, "model/x-spz", "view.spz"));
    const q = await poolQuote(account, req as never, undefined);
    expect(q?.quote.allowed, JSON.stringify(q?.quote)).toBe(true);
    const r = await press(req);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.items![0].id;
    let t: TaskRow | undefined;
    for (let i = 0; i < 200 && !t; i++) {
      await globalThis.__fuobeRunner?.tick();
      t = db().prepare("SELECT * FROM relay_tasks WHERE generation_id = ?").get(id) as TaskRow | undefined;
      if (!t) await new Promise((res) => setTimeout(res, 20));
    }
    const row = db().prepare("SELECT status, error FROM generations WHERE id = ?").get(id) as { status: string; error: string | null };
    expect(row.error ?? "").not.toMatch(/don't take/);
    expect(t, "the angle's task").toBeDefined();
    const inputs = tasks.inputsOf(t!.id);
    const splat = inputs.find((i) => i.content_type === "model/x-spz");
    expect(splat, JSON.stringify(inputs)).toBeDefined();
    expect(spzPoints(fs.readFileSync(path.join(tasks.relayDir(), "in", splat!.name)))?.equals(RAW)).toBe(true);
  });

  it("a file the workers don't take, named in the run's settings, is said before Run as the visitor's own GPU", async () => {
    standInWorker("all");
    const req = angle(mine(TINY_PNG, "image/png", "me.png"), mine(Buffer.from("{}"), "application/json", "view.json"));
    expect(hosted.requestFileKinds(req as never).sort()).toEqual(["file", "image"]);
    const q = await poolQuote(account, req as never, undefined);
    expect(q?.quote).toMatchObject({ allowed: false, text: "This file runs on your own GPU" });
  });

  it("a later step's files count too: a 3D model handed on is taken, a clip only where the workers take clips", () => {
    expect(chainFileKinds({ chain: [{ slot: "model3d" }, { slot: "images" }] } as never, 2).sort()).toEqual(["image", "model3d"]);
    expect(chainFileKinds({ chain: [{ slot: "prompt" }] } as never, 1)).toEqual([]);
    expect(chainFileKinds({} as never, 1)).toEqual(["image"]);
    expect(hosted.poolTakesKind("model3d")).toBe(true);
    expect(hosted.poolTakesKind("file")).toBe(false);
    const before = process.env.FUOBE_POOL_MEDIA_INPUTS;
    try {
      process.env.FUOBE_POOL_MEDIA_INPUTS = "image";
      expect(hosted.poolTakesKind("video")).toBe(false);
      process.env.FUOBE_POOL_MEDIA_INPUTS = "image,video";
      expect(hosted.poolTakesKind("video")).toBe(true);
    } finally {
      if (before === undefined) delete process.env.FUOBE_POOL_MEDIA_INPUTS;
      else process.env.FUOBE_POOL_MEDIA_INPUTS = before;
    }
  });

  it("Any Angle's 3D view is offered on these GPUs only where its angles run too", async () => {
    const build = { feature: ANY_ANGLE.stepFeature, modelId: ANY_ANGLE.buildModel, op: "splat", engine: "open", inputs: { images: [mine(TINY_PNG, "image/png", "p.png")] } };
    standInWorker("no-angles", loadManifest().workflows.map((x) => x.id).filter((x) => x !== ANY_ANGLE.shotGraph));
    expect(hosted.poolTakes(ANY_ANGLE.buildGraph)).toBe(true);
    expect(hosted.poolTakes(ANY_ANGLE.shotGraph)).toBe(false);
    const off = await poolQuote(account, build as never, undefined);
    expect(off?.quote.allowed, JSON.stringify(off?.quote)).toBe(false);
    standInWorker("all");
    const on = await poolQuote(account, build as never, undefined);
    expect(on?.quote.allowed, JSON.stringify(on?.quote)).toBe(true);
  });
});
