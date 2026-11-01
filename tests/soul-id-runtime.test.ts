import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onEngine } from "@/lib/catalog/engines";
import { getModel } from "@/lib/catalog";
import { identityFor, identityKey, SOUL_ID_COPY } from "@/lib/catalog/training";

// fal's storage upload goes through its client: the dataset zip and a LoRA sent to fal land here instead.
const uploads = vi.hoisted(() => [] as { data: Buffer; type: string; name?: string }[]);
vi.mock("@/server/providers/fal", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/providers/fal")>();
  return {
    ...real,
    falProvider: {
      ...real.falProvider,
      prepareFile: async (data: Buffer, type: string, name?: string) => {
        uploads.push({ data, type, name });
        return `https://fal.test/upload/${uploads.length}/${name ?? "file"}`;
      },
    },
  };
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-soul-id-"));
process.env.FUOBE_DATA_DIR = dir;
const { db } = await import("@/server/db");
const { createElement, getElement, updateElement } = await import("@/server/elements");
const { startTraining, pollTrainings, listTrainings, trainingKit, attachLora, trainedCopiesSettled, retiredTraining } = await import("@/server/training");
const { ensureLorasOnComfy, prepareCloudLoras, listLoraCopies, TRAINED_DIR } = await import("@/server/loras");
const { setSetting } = await import("@/server/settings");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A fake network: answers by URL prefix, records every call and its body, never touches the internet. */
interface Call {
  url: string;
  method: string;
  body?: string;
}
let calls: Call[] = [];
let routes: Record<string, (c: Call) => Response> = {};
const realFetch = globalThis.fetch;
beforeEach(() => {
  calls = [];
  routes = {};
  uploads.length = 0;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined };
    calls.push(call);
    const hit = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => call.url.startsWith(k));
    return hit ? routes[hit](call) : new Response(JSON.stringify({ detail: "not here" }), { status: 404 });
  }) as typeof fetch;
  setSetting("falKey", "test-key");
  setSetting("aiToolkitUrl", "http://aitk.test");
  setSetting("comfyLorasDir", "");
  setSetting("engineMode", "both");
  setSetting("demoMode", "auto");
});
afterEach(async () => {
  // LoRA copies still downloading in the background finish on the fake network.
  await trainedCopiesSettled();
  globalThis.fetch = realFetch;
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
// A 1×1 PNG as a data URI: readRef reads it like an uploaded file.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const photos = (n: number) => Array.from({ length: n }, () => PNG);

function character(n = 6, kind: "character" | "style" = "character") {
  return createElement({ name: `Maya ${Math.random().toString(36).slice(2, 6)}`, kind, references: photos(n) });
}

const wait = async (until: () => boolean) => {
  for (let i = 0; i < 100 && !until(); i++) await new Promise((r) => setTimeout(r, 10));
};

describe("starting a Soul ID training", () => {
  it("needs the person's consent for a character, not for a style", () => {
    const el = character();
    expect(() => startTraining(el.id, "fal-z-image")).toThrow(SOUL_ID_COPY.needsConsent);
    const style = character(6, "style");
    setSetting("falKey", "");
    setSetting("demoMode", "on");
    expect(startTraining(style.id, "fal-z-image-style").status).toBe("running");
  });

  it("refuses too few photos, the wrong kind of training and a Higgsfield target", () => {
    const few = character(3);
    expect(() => startTraining(few.id, "fal-z-image", { consent: true })).toThrow(/at least 5 photos/);
    // FLUX's portrait trainer crops to a face: a place doesn't train on it.
    const room = createElement({ name: "Loft", kind: "location", references: photos(6) });
    expect(() => startTraining(room.id, "fal-flux1-portrait")).toThrow(/for characters only/);
    const el = character();
    expect(() => startTraining(el.id, "fal-z-image-style", { consent: true })).toThrow(/for styles/);
    expect(() => startTraining(el.id, "soul-id-v2", { consent: true })).toThrow(/Unknown training target/);
  });

  it("holds the engine mode: a cloud training on an open-only install never starts, not even as a demo", () => {
    setSetting("engineMode", "open");
    const el = character();
    expect(() => startTraining(el.id, "fal-z-image", { consent: true })).toThrow(/open source only/);
    // A GPU training whose LoRA only cloud models run (FLUX.2 [klein] 4B) is refused there too.
    expect(() => startTraining(el.id, "aitk-flux2-klein-4b", { consent: true })).toThrow(/FLUX.2 \[klein\] 4B runs only in the cloud/);
  });

  it("sends fal a zip of 001.png + 001.txt pairs with the trainer's fields, priced first", async () => {
    routes["https://queue.fal.run/fal-ai/z-image-turbo-trainer-v2"] = () => json({ request_id: "req-1", status_url: "https://queue.fal.run/test/s/1", response_url: "https://queue.fal.run/test/r/1" });
    const el = character(6);
    const t = startTraining(el.id, "fal-z-image", { consent: true });
    await wait(() => listTrainings(el.id)[0].status === "running");
    const sent = calls.find((c) => c.url.includes("z-image-turbo-trainer-v2"))!;
    const body = JSON.parse(sent.body!);
    expect(body).toEqual({ image_data_url: "https://fal.test/upload/1/dataset.zip", steps: 2000, default_caption: `photo of ${t.trigger}`, learning_rate: 0.0005 });
    // The dataset: one caption per photo, named as fal's trainers read them.
    const zipFile = path.join(dir, "dataset.zip");
    fs.writeFileSync(zipFile, uploads[0].data);
    const names = execFileSync("python3", ["-I", "-c", "import sys,zipfile;print(' '.join(sorted(zipfile.ZipFile(sys.argv[1]).namelist())))", zipFile]).toString().trim().split(" ");
    expect(names).toEqual(["001.png", "001.txt", "002.png", "002.txt", "003.png", "003.txt", "004.png", "004.txt", "005.png", "005.txt", "006.png", "006.txt"]);
    expect(listTrainings(el.id)[0]).toMatchObject({ status: "running", costUsd: 1.7, family: "z-image-turbo", photos: 6 });
    db().prepare("UPDATE trainings SET status = 'failed' WHERE id = ?").run(t.id);
  });

  it("trains on a non-commercial base too (licences are information): FLUX's portrait trainer gets images_data_url and the trigger", async () => {
    routes["https://queue.fal.run/fal-ai/flux-lora-portrait-trainer"] = () => json({ request_id: "req-f", status_url: "https://queue.fal.run/test/s/f", response_url: "https://queue.fal.run/test/r/f" });
    const el = character(6);
    const t = startTraining(el.id, "fal-flux1-portrait", { consent: true });
    await wait(() => listTrainings(el.id)[0].status === "running");
    const body = JSON.parse(calls.find((c) => c.url.includes("flux-lora-portrait-trainer"))!.body!);
    expect(body).toEqual({ images_data_url: expect.stringMatching(/dataset\.zip$/), steps: 2500, trigger_phrase: t.trigger });
    expect(listTrainings(el.id)[0]).toMatchObject({ costUsd: 6, family: "flux1-dev" });
    db().prepare("UPDATE trainings SET status = 'failed' WHERE id = ?").run(t.id);
  });
});

describe("a finished training", () => {
  function running(o: { target: string; provider: string; externalId: string; meta?: Record<string, unknown>; age?: number }) {
    const el = character();
    updateElement(el.id, { status: "training" });
    const id = `t${Math.random().toString(36).slice(2, 10)}`;
    const at = Date.now() - (o.age ?? 0);
    db()
      .prepare(
        `INSERT INTO trainings (id, element_id, target, provider, status, external_id, meta_json, trigger_word, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'running', ?, ?, 'mayafz', ?, ?)`,
      )
      .run(id, el.id, o.target, o.provider, o.externalId, JSON.stringify(o.meta ?? {}), at, at);
    return { id, el };
  }

  it("keeps fal's LoRA (diffusers_lora_file) on the element for the whole family, with Fuobe's own copy", async () => {
    const LORA = Buffer.from("safetensors-bytes".repeat(100));
    routes["https://queue.fal.run/test/s/2"] = () => json({ status: "COMPLETED" });
    routes["https://queue.fal.run/test/r/2"] = () => json({ diffusers_lora_file: { url: "https://v3.fal.media/files/maya.safetensors" } });
    routes["https://v3.fal.media/files/maya.safetensors"] = (c) => (c.method === "HEAD" ? new Response(null, { status: 200 }) : new Response(LORA, { headers: { "content-length": String(LORA.length) } }));
    const { id, el } = running({ target: "fal-z-image", provider: "fal", externalId: "req-2", meta: { statusUrl: "https://queue.fal.run/test/s/2", responseUrl: "https://queue.fal.run/test/r/2", family: "z-image-turbo" } });
    await pollTrainings();
    expect(listTrainings(el.id).find((t) => t.id === id)).toMatchObject({ status: "succeeded", message: null });
    await trainedCopiesSettled();
    const after = getElement(el.id)!;
    expect(after.status).toBe("ready");
    const l = after.loras[0];
    expect(l).toMatchObject({ engine: "cloud", modelId: "fuobe-soul", family: "z-image-turbo", target: "fal-z-image", url: "https://v3.fal.media/files/maya.safetensors", own: true, trigger: "mayafz" });
    expect(l.file).toMatch(/^fuobe\/maya_[a-z0-9]+-t[a-z0-9]{5}\.safetensors$/);
    expect(fs.readFileSync(path.join(TRAINED_DIR, l.file))).toEqual(LORA);
    // Both engines and every model of the family use it; fal's URL serves the cloud while it lives.
    expect(identityFor(after.loras, onEngine(getModel("fuobe-soul-cinema")!, "open"))).toBe(l);
    expect(listLoraCopies().find((c) => c.file === l.file && c.target === "fal")?.hostedUrl).toBe("https://v3.fal.media/files/maya.safetensors");

    // A retrain on the same family replaces it; Fuobe Soul HD's LoRA would sit beside it.
    updateElement(el.id, { loras: [...after.loras, { engine: "cloud", modelId: "fuobe-soul-hd", family: "qwen-image-2512", file: "fuobe/hd.safetensors", url: "https://x/hd", trigger: "t" }] });
    routes["https://queue.fal.run/test/s/3"] = () => json({ status: "COMPLETED" });
    routes["https://queue.fal.run/test/r/3"] = () => json({ diffusers_lora_file: { url: "https://v3.fal.media/files/maya.safetensors" } });
    db()
      .prepare(`INSERT INTO trainings (id, element_id, target, provider, status, external_id, meta_json, trigger_word, created_at, updated_at) VALUES ('t2xyz', ?, 'fal-z-image', 'fal', 'running', 'r3', ?, 'mayafz', ?, ?)`)
      .run(el.id, JSON.stringify({ statusUrl: "https://queue.fal.run/test/s/3", responseUrl: "https://queue.fal.run/test/r/3" }), Date.now(), Date.now());
    await pollTrainings();
    expect(getElement(el.id)!.loras.map((x) => x.family)).toEqual(["qwen-image-2512", "z-image-turbo"]);
  });

  it("finishes a fal training without waiting for Fuobe's copy of the LoRA, which follows in the background", async () => {
    const LORA = Buffer.from("big-lora".repeat(64));
    let release = () => {};
    routes["https://queue.fal.run/test/s/bg"] = () => json({ status: "COMPLETED" });
    routes["https://queue.fal.run/test/r/bg"] = () => json({ diffusers_lora_file: { url: "https://v3.fal.media/files/bg.safetensors" } });
    // The download hangs until released: the runner's poll must not wait on it.
    routes["https://v3.fal.media/files/bg.safetensors"] = (c) =>
      c.method === "HEAD" ? new Response(null, { status: 200 }) : (new Promise<Response>((resolve) => (release = () => resolve(new Response(LORA, { headers: { "content-length": String(LORA.length) } })))) as unknown as Response);
    const { id, el } = running({ target: "fal-flux2-dev", provider: "fal", externalId: "req-bg", meta: { statusUrl: "https://queue.fal.run/test/s/bg", responseUrl: "https://queue.fal.run/test/r/bg", family: "flux2-dev" } });
    await pollTrainings();
    expect(listTrainings(el.id).find((t) => t.id === id)).toMatchObject({ status: "succeeded" });
    expect(getElement(el.id)!.status).toBe("ready");
    const before = getElement(el.id)!.loras[0];
    expect(before).toMatchObject({ family: "flux2-dev", url: "https://v3.fal.media/files/bg.safetensors" });
    expect(before.own).toBeUndefined();
    // It already runs on both engines from fal's URL; the next poll doesn't start a second copy.
    expect(identityFor([before], getModel("oss-flux2-dev")!)).toBe(before);
    await pollTrainings();
    await wait(() => calls.some((c) => c.url === "https://v3.fal.media/files/bg.safetensors" && c.method === "GET"));
    release();
    await trainedCopiesSettled();
    const after = getElement(el.id)!.loras[0];
    expect(after).toMatchObject({ own: true, url: before.url });
    expect(fs.readFileSync(path.join(TRAINED_DIR, after.file))).toEqual(LORA);
    expect(calls.filter((c) => c.url === "https://v3.fal.media/files/bg.safetensors" && c.method === "GET")).toHaveLength(1);
  });

  it("starts again a LoRA copy a restart cut off, and says so when it can't be kept", async () => {
    const el = character();
    const file = "fuobe/restart-abc123.safetensors";
    updateElement(el.id, { loras: [{ engine: "cloud", modelId: "fuobe-soul", family: "z-image-turbo", file, url: "https://v3.fal.media/files/restart.safetensors", trigger: "t" }] });
    const insert = (id: string) =>
      db()
        .prepare(`INSERT INTO trainings (id, element_id, target, provider, status, external_id, meta_json, trigger_word, created_at, updated_at) VALUES (?, ?, 'fal-z-image', 'fal', 'succeeded', 'r', ?, 't', ?, ?)`)
        .run(id, el.id, JSON.stringify({ file, keep: "pending" }), Date.now(), Date.now());
    insert("trestart1");
    routes["https://v3.fal.media/files/restart.safetensors"] = () => new Response(Buffer.from("restart"), { headers: { "content-length": "7" } });
    await pollTrainings();
    await trainedCopiesSettled();
    expect(getElement(el.id)!.loras[0].own).toBe(true);
    expect(JSON.parse((db().prepare("SELECT meta_json FROM trainings WHERE id = 'trestart1'").get() as { meta_json: string }).meta_json).keep).toBe("kept");
    // fal's copy gone: the training says the GPU fetches it from fal, and it isn't tried again.
    updateElement(el.id, { loras: [{ engine: "cloud", modelId: "fuobe-soul", family: "z-image-turbo", file: "fuobe/gone-abc123.safetensors", url: "https://v3.fal.media/files/gone.safetensors", trigger: "t" }] });
    db()
      .prepare(`INSERT INTO trainings (id, element_id, target, provider, status, external_id, meta_json, trigger_word, created_at, updated_at) VALUES ('trestart2', ?, 'fal-z-image', 'fal', 'succeeded', 'r', ?, 't', ?, ?)`)
      .run(el.id, JSON.stringify({ file: "fuobe/gone-abc123.safetensors", keep: "pending" }), Date.now(), Date.now());
    await pollTrainings();
    await trainedCopiesSettled();
    expect(listTrainings(el.id).find((t) => t.id === "trestart2")?.message).toMatch(/couldn't keep a copy/);
    const tries = calls.filter((c) => c.url.includes("gone.safetensors")).length;
    await pollTrainings();
    await trainedCopiesSettled();
    expect(calls.filter((c) => c.url.includes("gone.safetensors"))).toHaveLength(tries);
  });

  it("reads Krea 2's LoRA from lora_file and records it for Krea 2's hosted LoRA model", async () => {
    routes["https://queue.fal.run/test/s/k"] = () => json({ status: "COMPLETED" });
    routes["https://queue.fal.run/test/r/k"] = () => json({ lora_file: { url: "https://v3.fal.media/files/krea.safetensors" }, config_file: { url: "https://v3.fal.media/files/c.json" } });
    routes["https://v3.fal.media/files/krea.safetensors"] = () => new Response(Buffer.from("krea"), { headers: { "content-length": "4" } });
    const { el } = running({ target: "fal-krea-2", provider: "fal", externalId: "req-k", meta: { statusUrl: "https://queue.fal.run/test/s/k", responseUrl: "https://queue.fal.run/test/r/k", family: "krea-2" } });
    await pollTrainings();
    const l = getElement(el.id)!.loras[0];
    expect(l).toMatchObject({ family: "krea-2", modelId: "krea-2-turbo-lora-cloud", url: "https://v3.fal.media/files/krea.safetensors" });
    expect(identityFor([l], getModel("krea-2-turbo-lora-cloud")!)).toBe(l);
    expect(identityFor([l], onEngine(getModel("fuobe-soul")!, "cloud"))).toBeUndefined();
  });

  it("copies an AI-Toolkit LoRA into ComfyUI's folder and keeps Fuobe's copy, so the cloud can use it too", async () => {
    const out = path.join(dir, "aitk-out", "maya_000002000.safetensors");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, "gpu-lora");
    const comfy = fs.mkdtempSync(path.join(dir, "comfy-loras-"));
    setSetting("comfyLorasDir", comfy);
    routes["http://aitk.test/api/jobs?id=job-9"] = () => json({ job: { status: "completed" } });
    routes["http://aitk.test/api/jobs/job-9/files"] = () => json({ files: [{ path: out }] });
    const { el } = running({ target: "aitk-z-image", provider: "ai-toolkit", externalId: "job-9" });
    await pollTrainings();
    const l = getElement(el.id)!.loras[0];
    expect(l).toMatchObject({ engine: "open", family: "z-image-turbo", own: true });
    expect(l.url).toBeUndefined();
    expect(fs.readFileSync(path.join(comfy, l.file), "utf8")).toBe("gpu-lora");
    expect(fs.readFileSync(path.join(TRAINED_DIR, l.file), "utf8")).toBe("gpu-lora");
    expect(identityFor([l], onEngine(getModel("fuobe-soul")!, "cloud"))).toBe(l);

    // A cloud run sends Fuobe's copy once, then reuses it.
    const ref = { file: l.file, strength: 1, trigger: l.trigger, own: true as const };
    const sent = await prepareCloudLoras([ref], "fal", async (data, name) => `https://fal.test/sent/${name}/${data.length}`);
    expect(sent?.[0].hostedUrl).toBe(`https://fal.test/sent/${path.basename(l.file)}/8`);
    const again = await prepareCloudLoras([ref], "fal", async () => {
      throw new Error("sent twice");
    });
    expect(again?.[0].hostedUrl).toBe(sent?.[0].hostedUrl);
  });

  it("puts a cloud-trained LoRA into ComfyUI's folder from Fuobe's copy, without a download", async () => {
    const file = "fuobe/copyme-abc123.safetensors";
    fs.mkdirSync(path.join(TRAINED_DIR, "fuobe"), { recursive: true });
    fs.writeFileSync(path.join(TRAINED_DIR, file), "trained");
    const comfy = fs.mkdtempSync(path.join(dir, "comfy-"));
    setSetting("comfyLorasDir", comfy);
    await ensureLorasOnComfy([{ file, url: "https://v3.fal.media/files/copyme.safetensors", own: true }], []);
    expect(fs.readFileSync(path.join(comfy, file), "utf8")).toBe("trained");
    expect(calls.filter((c) => c.url.includes("v3.fal.media"))).toEqual([]);
    // One only ComfyUI had, gone from this machine: the run says to train again.
    await expect(ensureLorasOnComfy([{ file: "fuobe/gone.safetensors", own: true }], [])).rejects.toThrow(/train the element again/);
  });

  it("finishes a demo training with a stand-in no run uses", async () => {
    const { id, el } = running({ target: "fal-z-image", provider: "demo", externalId: "demo", age: 9_000 });
    await pollTrainings();
    expect(listTrainings(el.id).find((t) => t.id === id)).toMatchObject({ status: "succeeded", message: expect.stringMatching(/Demo: no LoRA was trained/) });
    const l = getElement(el.id)!.loras[0];
    expect(l.demo).toBe(true);
    expect(identityFor([l], onEngine(getModel("fuobe-soul")!, "cloud"))).toBeUndefined();
  });

  it("never lets a demo retrain replace a real Soul ID of the family", async () => {
    // GPU trained for real; no fal key, demo mode auto: the cloud card's Retrain runs as a demo.
    setSetting("falKey", "");
    const { el } = running({ target: "fal-z-image", provider: "demo", externalId: "demo", age: 9_000 });
    const real = { engine: "open" as const, modelId: "fuobe-soul", family: "z-image-turbo" as const, target: "aitk-z-image", file: "fuobe/real-abc123.safetensors", trigger: "mayafz", own: true as const, trainedAt: 1 };
    updateElement(el.id, { loras: [real] });
    await pollTrainings();
    expect(getElement(el.id)!.loras).toEqual([real]);
    expect(listTrainings(el.id)[0].message).toMatch(/Fuobe Soul and Soul Cinema Soul ID you trained before stays/);
    expect(identityFor(getElement(el.id)!.loras, onEngine(getModel("fuobe-soul")!, "open"))).toEqual(real);
    // The same through the API's own path: a demo started now, finished later.
    const t = startTraining(el.id, "fal-z-image", { consent: true });
    expect(t.provider).toBe("demo");
    db().prepare("UPDATE trainings SET created_at = ? WHERE id = ?").run(Date.now() - 9_000, t.id);
    await pollTrainings();
    expect(getElement(el.id)!.loras).toEqual([real]);
  });

  it("puts nothing on the element when a remote AI-Toolkit trains a family that runs only in the cloud, and says how to bring the file", async () => {
    routes["http://aitk.test/api/jobs?id=job-k4"] = () => json({ job: { status: "completed" } });
    routes["http://aitk.test/api/jobs/job-k4/files"] = () => json({ files: [{ path: "/elsewhere/output/maya_000002000.safetensors" }] });
    const { id, el } = running({ target: "aitk-flux2-klein-4b", provider: "ai-toolkit", externalId: "job-k4" });
    await pollTrainings();
    expect(getElement(el.id)!.loras).toEqual([]);
    expect(listTrainings(el.id).find((t) => t.id === id)).toMatchObject({ status: "succeeded", message: expect.stringMatching(/FLUX\.2 \[klein\] 4B runs only in the cloud, so Fuobe needs the file/) });
    // A family with a GPU model still gets the LoRA, to copy into ComfyUI by hand.
    routes["http://aitk.test/api/jobs?id=job-z"] = () => json({ job: { status: "completed" } });
    routes["http://aitk.test/api/jobs/job-z/files"] = () => json({ files: [{ path: "/elsewhere/output/maya_z.safetensors" }] });
    const z = running({ target: "aitk-z-image", provider: "ai-toolkit", externalId: "job-z" });
    await pollTrainings();
    expect(getElement(z.el.id)!.loras[0]).toMatchObject({ engine: "open", family: "z-image-turbo" });
    expect(listTrainings(z.el.id)[0].message).toMatch(/^Copy \/elsewhere\/output\/maya_z\.safetensors to ComfyUI/);
  });

  it("retires a training on an older Soul ID target that was still running, saying what replaced it", async () => {
    const { id, el } = running({ target: "soul-id-v2", provider: "retired", externalId: "old-ref" });
    await pollTrainings();
    expect(retiredTraining("soul-id-v2")).toMatch(/was retired: train the character again for Fuobe Soul on the same photos/);
    expect(listTrainings(el.id).find((t) => t.id === id)).toMatchObject({ status: "failed", error: retiredTraining("soul-id-v2") });
    expect(getElement(el.id)!.status).toBe("ready");
  });
});

describe("training anywhere", () => {
  it("packs the kit with 001.png + 001.txt and an AI-Toolkit config", async () => {
    const el = character(5);
    const kit = await trainingKit(el.id);
    const file = path.join(dir, kit.name);
    fs.writeFileSync(file, kit.data);
    const names = execFileSync("python3", ["-I", "-c", "import sys,zipfile;print(' '.join(sorted(zipfile.ZipFile(sys.argv[1]).namelist())))", file]).toString().trim().split(" ");
    expect(names).toContain("dataset/001.png");
    expect(names).toContain("dataset/005.txt");
    expect(names).toContain("README.md");
    // Another base: FLUX.1 [dev]'s config, and its licence in the README.
    const flux = await trainingKit(el.id, "flux1-dev");
    expect(flux.name).toMatch(/-flux1-dev-training-kit\.zip$/);
    const fluxFile = path.join(dir, flux.name);
    fs.writeFileSync(fluxFile, flux.data);
    const read = (name: string) => execFileSync("python3", ["-I", "-c", "import sys,zipfile;print(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode())", fluxFile, name]).toString();
    const yaml = names.find((n) => n.endsWith(".yaml"))!;
    expect(JSON.parse(read(yaml)).config.process[0].model).toMatchObject({ arch: "flux", name_or_path: "black-forest-labs/FLUX.1-dev" });
    expect(read("README.md")).toMatch(/FLUX\.1 \[dev\] Non-Commercial License · non-commercial weights/);
  });

  it("attaches a LoRA trained elsewhere for the family, keeping a copy when ComfyUI's folder is here", async () => {
    const comfy = fs.mkdtempSync(path.join(dir, "comfy-attach-"));
    fs.mkdirSync(path.join(comfy, "mine"), { recursive: true });
    fs.writeFileSync(path.join(comfy, "mine/maya.safetensors"), "mine");
    setSetting("comfyLorasDir", comfy);
    const el = character();
    await attachLora(el.id, { file: "mine/maya.safetensors", trigger: "mayafz" });
    expect(getElement(el.id)!.loras[0]).toMatchObject({ engine: "open", modelId: "fuobe-soul", family: "z-image-turbo", own: true });
    await expect(attachLora(el.id, { file: "../x.safetensors", trigger: "" })).rejects.toThrow(/file name/);
    // A FLUX.1 [dev] LoRA sits beside it and runs on FLUX.1 [dev] and Krea [dev] on the GPU, and in the cloud from Fuobe's copy.
    await attachLora(el.id, { file: "mine/maya.safetensors", trigger: "mayafz", family: "flux1-dev" });
    const flux = getElement(el.id)!.loras.find((l) => l.family === "flux1-dev")!;
    expect(flux).toMatchObject({ modelId: "oss-flux1-dev", own: true });
    expect(identityFor([flux], getModel("oss-flux1-krea")!)).toBe(flux);
    expect(identityFor([flux], getModel("flux-1-dev-lora-cloud")!)).toBe(flux);
    // Removing the FLUX one in the Train dialog keeps the Z-Image one with the same file.
    const route = await import("@/app/api/elements/[id]/route");
    const res = await route.PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ removeIdentities: [identityKey(flux)] }) }),
      { params: Promise.resolve({ id: el.id }) } as Parameters<typeof route.PATCH>[1],
    );
    expect(res.status).toBe(200);
    expect(getElement(el.id)!.loras.map((l) => l.family)).toEqual(["z-image-turbo"]);
    // A cloud-only family needs the file here to send it: a name alone can't run anywhere.
    await expect(attachLora(el.id, { file: "mine/elsewhere.safetensors", trigger: "t", family: "flux2-klein-4b" })).rejects.toThrow(/runs only in the cloud, so Fuobe needs the file/);
    await attachLora(el.id, { file: "mine/maya.safetensors", trigger: "t", family: "flux2-klein-4b" });
    expect(getElement(el.id)!.loras.find((l) => l.family === "flux2-klein-4b")).toMatchObject({ own: true, modelId: "flux-2-klein-4b-cloud" });
  });
});
