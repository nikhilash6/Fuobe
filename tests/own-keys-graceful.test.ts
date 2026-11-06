import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeFal, startFakeReplicate, type CloudRequest, type FakeCloud } from "./helpers/fake-cloud";
import { tempDir } from "./helpers/temp-dir";
import { TINY_PNG } from "./helpers/fake-comfy-runner";

/**
 * An account's run on its own fal.ai or Replicate key that has a problem: a busy or down provider is waited out (the tile
 * says so); a key refused, credit gone, a model gone or an input refused fails at once in plain words, the provider's own
 * words in the details line, with what helps (Replace key, Add credit, Run with your other key). A refusal while polling
 * fails the run at once, not half an hour later. The owner's runs keep the provider's words. Stand-ins only.
 */
const dir = tempDir("fuobe-own-keys-graceful-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ENGINE_MODE;
globalThis.__fuobeTestDiskFree = 1e13;

const auth = await import("@/server/auth");
const keys = await import("@/server/account-keys");
const generationsRoute = await import("@/app/api/generations/route");
const uploadsRoute = await import("@/app/api/uploads/route");
const gens = await import("@/server/generations");
const { db } = await import("@/server/db");
const { setSetting } = await import("@/server/settings");
const { resetRates } = await import("@/server/rate");
const { getModel, getPreset } = await import("@/lib/catalog");
const { cloudVersionKey } = await import("@/lib/your-keys");
const { BILLING_URL } = await import("@/lib/diagnose");
const { onCloudKey } = await import("@/lib/before-run");
const keysRoute = await import("@/app/api/account/keys/[provider]/route");
const { KEY_CHECK } = await import("@/server/your-keys");
const { visitorStatus } = await import("@/server/account-gpu");

const keyRequest = (cookie: string, provider: string, body: unknown) => {
  const text = JSON.stringify(body);
  return new Request(`http://localhost:3000/api/account/keys/${provider}`, { method: "PUT", headers: { cookie, host: "localhost:3000", "content-type": "application/json", "content-length": String(text.length) }, body: text });
};

let fal: FakeCloud;
let rep: FakeCloud;
let A = "";
let D = "";
const cookies: Record<string, string> = {};

beforeAll(async () => {
  fal = await startFakeFal();
  rep = await startFakeReplicate();
  globalThis.__fuobeTestFalUrl = fal.url;
  globalThis.__fuobeTestReplicateUrl = rep.url;
  for (const k of ["owner-fal", "acct-fal-A"]) fal.keys[k] = "good";
  fal.keys["acct-fal-broke"] = "broke";
  rep.keys["acct-rep-A"] = "good";
  rep.keys["acct-rep-D"] = "good";
  setSetting("falKey", "owner-fal");
  auth.setPassword("install password");
  A = auth.createAccount("keys-graceful-a@example.com", "long enough").id;
  D = auth.createAccount("keys-graceful-d@example.com", "long enough").id;
  keys.saveAccountKey(A, "fal", "acct-fal-A");
  keys.saveAccountKey(A, "replicate", "acct-rep-A");
  keys.saveAccountKey(D, "replicate", "acct-rep-D");
  cookies.A = `${auth.SESSION_COOKIE}=${auth.createSession(A).value}`;
  cookies.D = `${auth.SESSION_COOKIE}=${auth.createSession(D).value}`;
  cookies.owner = `${auth.SESSION_COOKIE}=${auth.createSession().value}`;
});
afterAll(async () => {
  globalThis.__fuobeTestFalUrl = undefined;
  globalThis.__fuobeTestReplicateUrl = undefined;
  globalThis.__fuobeTestDiskFree = undefined;
  gens.SELF_HEAL.scale = 1;
  await fal.close();
  await rep.close();
});
beforeEach(async () => {
  resetRates();
  gens.SELF_HEAL.scale = 0.01;
  globalThis.__fuobePollHeals?.clear();
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
  await new Promise((r) => setTimeout(r, 100));
  for (const f of [fal, rep]) {
    f.log.length = 0;
    f.pollsToFinish = 2;
    f.script = null;
    f.hang = null;
    f.canceled.length = 0;
  }
  keys.saveAccountKey(A, "fal", "acct-fal-A");
});

const run = async (cookie: string, body: Record<string, unknown>) => {
  const text = JSON.stringify({ feature: "image", prompt: "a quiet harbour at dawn", ...body });
  const r = await generationsRoute.POST(new Request("http://localhost:3000/api/generations", { method: "POST", headers: { cookie, host: "localhost:3000", "content-type": "application/json", "content-length": String(text.length) }, body: text }));
  const json = await r.json();
  if (r.status !== 201) throw new Error(`${r.status}: ${JSON.stringify(json)}`);
  return json.items[0] as { id: string; provider: string };
};
async function settle(id: string, ms = 15_000, seen: string[] = []) {
  const end = Date.now() + ms;
  for (;;) {
    await globalThis.__fuobeRunner?.tick();
    const g = gens.getGeneration(id, { includeDeleted: true })!;
    if (g.message && seen.at(-1) !== g.message) seen.push(g.message);
    if (!["queued", "running"].includes(g.status) || Date.now() > end) return g;
    await new Promise((r) => setTimeout(r, 15));
  }
}
/** A submit to a model (not a file's upload). */
const isSubmit = (r: CloudRequest) => r.method === "POST" && !r.path.startsWith("/storage/") && !r.path.startsWith("/upload/");
const isStatus = (r: CloudRequest) => r.method === "GET" && /\/requests\/[^/]+\/status/.test(r.path);
const kinds = (g: { trouble?: { actions: { kind: string }[] } }) => (g.trouble?.actions ?? []).map((a) => a.kind);
/** A tenth of a second of silence as a WAV (a voice sample). */
function tinyWav(): Buffer {
  const data = Buffer.alloc(1600 * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16_000, 24);
  h.writeUInt32LE(32_000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

describe("an account's run on its own key waits out a busy or down provider", () => {
  it("fal.ai busy at submit (429): the tile says so, it tries again by itself, and runs", async () => {
    let busy = 0;
    fal.script = (r) => (isSubmit(r) && busy++ < 2 ? { status: 429, body: { detail: "Too many requests" }, headers: { "Retry-After": "1" } } : null);
    const g = await run(cookies.A, { modelId: "nano-banana-pro", engine: "cloud" });
    const seen: string[] = [];
    const done = await settle(g.id, 15_000, seen);
    expect(done.status, done.error ?? "").toBe("succeeded");
    expect(seen).toContain("fal.ai is busy, trying again in a moment");
    expect(fal.log.filter(isSubmit)).toHaveLength(3);
  });

  it("an outage while polling that lasts past the old 10-minute end is still waited out (the job is paid), and collected", async () => {
    gens.SELF_HEAL.scale = 0.001; // the old end, 10 minutes: 0.6 s
    let until = Infinity;
    fal.script = (r) => (isStatus(r) && Date.now() < until ? { status: 503, body: { detail: "Service unavailable" } } : null);
    const g = await run(cookies.A, { modelId: "nano-banana-pro", engine: "cloud" });
    until = Date.now() + 1500;
    const done = await settle(g.id, 15_000);
    expect(done.status, done.error ?? "").toBe("succeeded");
    expect(fal.canceled).toEqual([]);
  });

  it("fal.ai down while polling: the tile says it waits, and the run is collected once it answers", async () => {
    let down = 0;
    fal.script = (r) => (isStatus(r) && down++ < 4 ? { status: 503, body: { detail: "Service unavailable" } } : null);
    const g = await run(cookies.A, { modelId: "nano-banana-pro", engine: "cloud" });
    const seen: string[] = [];
    const done = await settle(g.id, 15_000, seen);
    expect(done.status, done.error ?? "").toBe("succeeded");
    expect(seen).toContain("Waiting for fal.ai to answer");
  });

  it("a status call that hangs is given up in time and asked again, and the run is collected", async () => {
    const { FAL_CALL_MS } = await import("@/server/providers/fal");
    FAL_CALL_MS.short = 200;
    try {
      let hung = 0;
      fal.hang = (r) => isStatus(r) && hung++ < 2;
      const started = Date.now();
      const g = await run(cookies.A, { modelId: "nano-banana-pro", engine: "cloud" });
      const done = await settle(g.id);
      expect(done.status, done.error ?? "").toBe("succeeded");
      expect(hung).toBeGreaterThan(2);
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      FAL_CALL_MS.short = 20_000;
    }
  });

  it("a voice it cloned for the run (a billed step) is used again when the run tries again, never cloned twice", async () => {
    const wav = tinyWav();
    const up = await uploadsRoute.POST(
      new Request("http://localhost:3000/api/uploads", { method: "POST", headers: { cookie: cookies.A, host: "localhost:3000", "content-type": "audio/wav", "x-file-name": "sample.wav", "content-length": String(wav.length) }, body: new Uint8Array(wav) }),
    );
    expect(up.status, await up.clone().text()).toBe(201);
    const voice = ((await up.json()) as { url: string }).url;
    const isTts = (r: CloudRequest) => isSubmit(r) && /\/text-to-speech\//.test(r.path);
    let busy = 0;
    fal.script = (r) => (isTts(r) && busy++ < 1 ? { status: 429, body: { detail: "Too many requests" } } : null);
    const g = await run(cookies.A, { feature: "audio", modelId: "qwen-3-tts", engine: "cloud", op: "tts", prompt: "Welcome aboard.", inputs: { voiceAudio: voice } });
    await settle(g.id);
    expect(fal.log.filter((r) => isSubmit(r) && /\/clone-voice\//.test(r.path))).toHaveLength(1);
    const tts = fal.log.filter(isTts);
    expect(tts).toHaveLength(2);
    expect(JSON.parse(tts[1].body)).toMatchObject({ speaker_voice_embedding_file_url: expect.stringMatching(/voice-fal-\d+\.safetensors$/) });
  });

  it("runs waiting while fal.ai is busy count among the runs at once: a provider that is down gathers no more", async () => {
    gens.SELF_HEAL.scale = 0.1;
    fal.script = (r) => (isSubmit(r) ? { status: 429, body: { detail: "Too many requests" }, headers: { "Retry-After": "5" } } : null);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await run(cookies.A, { modelId: "nano-banana-pro", engine: "cloud" })).id);
    for (let i = 0; i < 500 && ids.some((id) => !gens.getGeneration(id)?.waiting); i++) await new Promise((r) => setTimeout(r, 10));
    expect(ids.every((id) => gens.getGeneration(id)?.waiting)).toBe(true);
    await expect(run(cookies.A, { modelId: "nano-banana-pro", engine: "cloud" })).rejects.toThrow(/^429: .*You have 4 runs going/);
    for (const id of ids) await gens.cancelGeneration(id);
  });

  it("a waiting step of a longer run doesn't offer Run with your other key, and moving it alone is refused", async () => {
    gens.SELF_HEAL.scale = 0.1;
    fal.script = (r) => (isSubmit(r) ? { status: 429, body: { detail: "Too many requests" }, headers: { "Retry-After": "1" } } : null);
    const g = await run(cookies.A, { modelId: "nano-banana-pro", engine: "cloud" });
    for (let i = 0; i < 500 && !gens.getGeneration(g.id)?.waiting; i++) await new Promise((r) => setTimeout(r, 10));
    const offered = () => (gens.getGeneration(g.id)?.waiting?.actions ?? []).map((a) => a.kind);
    // On its own, the run offers its other key.
    expect(offered()).toContain("run-with-key");
    // A later step waits for its result (as a relight's clip waits for its still).
    const [later] = gens.asAccount(A, () => gens.createGenerations({ feature: "image", modelId: "nano-banana-pro", engine: "cloud", prompt: "the same harbour at night" }, { dependsOn: g.id }));
    expect(offered()).not.toContain("run-with-key");
    expect(offered()).toContain("retry");
    // Its next try doesn't offer it either.
    const heal = () => (JSON.parse(String(db().prepare("SELECT external_meta_json FROM generations WHERE id = ?").pluck().get(g.id))) as { heal: { tries: number; trouble: { actions: { kind: string }[] } } }).heal;
    const tries = heal().tries;
    for (let i = 0; i < 1000 && heal().tries === tries; i++) await new Promise((r) => setTimeout(r, 10));
    expect(heal().tries).toBeGreaterThan(tries);
    expect(heal().trouble.actions.map((a) => a.kind)).not.toContain("run-with-key");
    // Pressed anyway (a tile drawn before): refused in plain words, and both steps go on as they were.
    const text = JSON.stringify({ feature: "image", modelId: "nano-banana-pro", engine: "cloud", prompt: "a quiet harbour at dawn", replaces: g.id });
    const r = await generationsRoute.POST(new Request("http://localhost:3000/api/generations", { method: "POST", headers: { cookie: cookies.A, host: "localhost:3000", "content-type": "application/json", "content-length": String(text.length) }, body: text }));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: gens.CHAINED_RUN, code: "chained-run" });
    expect(gens.getGeneration(g.id)?.status).toBe("queued");
    expect(gens.getGeneration(later.id)?.status).toBe("queued");
    for (const id of [g.id, later.id]) await gens.cancelGeneration(id);
  });

  it("a job of a batch whose other job a later step waits for doesn't offer it either, and a press on it is refused", async () => {
    gens.SELF_HEAL.scale = 0.1;
    // On Replicate, Nano Banana Pro makes one picture a job: two outputs, two jobs of one batch.
    rep.script = (r) => (isSubmit(r) ? { status: 429, body: { detail: "Too many requests" }, headers: { "Retry-After": "1" } } : null);
    const post = async (body: Record<string, unknown>) => {
      const text = JSON.stringify({ feature: "image", modelId: "nano-banana-pro", engine: "cloud", prompt: "a quiet harbour at dawn", ...body });
      return generationsRoute.POST(new Request("http://localhost:3000/api/generations", { method: "POST", headers: { cookie: cookies.A, host: "localhost:3000", "content-type": "application/json", "content-length": String(text.length) }, body: text }));
    };
    const made = await post({ prefer: "replicate", params: { numOutputs: 2 } });
    expect(made.status, await made.clone().text()).toBe(201);
    const jobs = ((await made.json()) as { items: { id: string; provider: string }[] }).items;
    expect(jobs.map((j) => j.provider)).toEqual(["replicate", "replicate"]);
    const [one, two] = jobs.map((j) => j.id);
    for (let i = 0; i < 500 && !(gens.getGeneration(one)?.waiting && gens.getGeneration(two)?.waiting); i++) await new Promise((r) => setTimeout(r, 10));
    const offered = (id: string) => (gens.getGeneration(id)?.waiting?.actions ?? []).map((a) => a.kind);
    // On their own, both jobs offer the other key.
    expect(offered(two)).toContain("run-with-key");
    // A later step waits for the batch's first job only (as a pipeline's next step waits for its step's first job).
    const [later] = gens.asAccount(A, () => gens.createGenerations({ feature: "image", modelId: "nano-banana-pro", engine: "cloud", prompt: "the same harbour at night" }, { dependsOn: one }));
    // The press would stop the whole batch, the job the later step waits for with it: neither tile offers it.
    expect(offered(one)).not.toContain("run-with-key");
    expect(offered(two)).not.toContain("run-with-key");
    const r = await post({ replaces: two });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: gens.CHAINED_RUN, code: "chained-run" });
    for (const id of [one, two, later.id]) expect(gens.getGeneration(id)?.status).toBe("queued");
    for (const id of [one, two, later.id]) await gens.cancelGeneration(id);
  });

  it("a 502 at submit may have started a job already: never sent twice", async () => {
    fal.script = (r) => (isSubmit(r) ? { status: 502, body: "<!DOCTYPE html><html><head><title>502 Bad gateway</title></head></html>" } : null);
    const g = await run(cookies.A, { modelId: "nano-banana-pro", engine: "cloud" });
    const done = await settle(g.id);
    expect(done.status).toBe("failed");
    expect(done.error).toBe("fal.ai is having trouble right now. Press Retry in a few minutes.");
    expect(done.trouble?.details).toBe("fal.ai answered 502 · 502 Bad gateway");
    expect(fal.log.filter(isSubmit)).toHaveLength(1);
  });
});

describe("Not billed", () => {
  it("isn't said of a run cut off while it was being sent (fal.ai may have the job)", async () => {
    const g = await run(cookies.A, { modelId: "nano-banana-pro", engine: "cloud" });
    await settle(g.id);
    const stopped = (error: string, meta: object) =>
      db().prepare("UPDATE generations SET status = 'failed', external_id = NULL, error = ?, external_meta_json = ? WHERE id = ?").run(error, JSON.stringify(meta), g.id);
    // Refused before fal.ai took it: nothing was billed.
    stopped("fal.ai didn't accept your key. Check it in Settings → Your keys.", {});
    expect(gens.getGeneration(g.id)!.notBilled).toBe(true);
    // Its server was cut off in the middle of the send.
    stopped("This run was interrupted while it was being sent. Press Retry.", { heal: { since: 1, deadline: 2, firstSeen: {}, tries: 1, next: 0, index: 0, sending: Date.now() } });
    expect(gens.getGeneration(g.id)!.notBilled).toBeUndefined();
    stopped("fal.ai is having trouble right now. Press Retry in a few minutes.", { heal: { since: 1, deadline: 2, firstSeen: {}, tries: 1, next: 0, index: 0, sending: Date.now() } });
    expect(gens.getGeneration(g.id)!.notBilled).toBeUndefined();
  });

  it("is said of a run fal.ai turned down at its next try after a wait (a refused key): it never had the job", async () => {
    let tries = 0;
    fal.script = (r) =>
      isSubmit(r) ? (tries++ === 0 ? { status: 429, body: { detail: "Too many requests" }, headers: { "Retry-After": "1" } } : { status: 401, body: { detail: "Invalid credentials" } }) : null;
    const g = await run(cookies.A, { modelId: "nano-banana-pro", engine: "cloud" });
    const done = await settle(g.id);
    expect(done.status).toBe("failed");
    expect(done.error).toBe("fal.ai didn't accept your key. Check it in Settings → Your keys.");
    expect(tries).toBe(2);
    expect(done.notBilled).toBe(true);
    const meta = JSON.parse(String(db().prepare("SELECT external_meta_json FROM generations WHERE id = ?").pluck().get(g.id))) as { heal?: { sending?: number } };
    expect(meta.heal?.sending).toBeUndefined();
  });

  it("isn't said when the next try after a wait may have reached fal.ai (a 502)", async () => {
    let tries = 0;
    fal.script = (r) =>
      isSubmit(r)
        ? tries++ === 0
          ? { status: 429, body: { detail: "Too many requests" }, headers: { "Retry-After": "1" } }
          : { status: 502, body: "<!DOCTYPE html><html><head><title>502 Bad gateway</title></head></html>" }
        : null;
    const g = await run(cookies.A, { modelId: "nano-banana-pro", engine: "cloud" });
    const done = await settle(g.id);
    expect(done.status).toBe("failed");
    expect(tries).toBe(2);
    expect(done.notBilled).toBeUndefined();
  });
});

describe("what waiting can't fix fails at once, in plain words, with what helps", () => {
  it("a model gone (404): pick another, the provider's words in the details, not billed", async () => {
    fal.script = (r) => (isSubmit(r) ? { status: 404, body: { detail: "Application 'fal-ai/nano-banana-pro' not found" } } : null);
    const g = await run(cookies.A, { modelId: "nano-banana-pro", engine: "cloud" });
    const done = await settle(g.id);
    expect(done.status).toBe("failed");
    expect(done.error).toBe("This model isn't available on fal.ai right now. Pick another model.");
    expect(done.trouble?.details).toBe("fal.ai answered 404 · Application 'fal-ai/nano-banana-pro' not found");
    expect(kinds(done)).toContain("pick-model");
    expect(done.notBilled).toBe(true);
    expect(fal.log.filter(isSubmit)).toHaveLength(1);
  });

  it("an input refused (422): says which input, in its words", async () => {
    fal.script = (r) => (isSubmit(r) ? { status: 422, body: { detail: [{ loc: ["body", "prompt"], msg: "String should have at most 5000 characters" }] } } : null);
    const g = await run(cookies.A, { modelId: "nano-banana-pro", engine: "cloud" });
    const done = await settle(g.id);
    expect(done.error).toBe("fal.ai couldn't use these words. Change it, then run again.");
    expect(done.trouble?.details).toMatch(/^fal\.ai answered 422 · body\.prompt: String should have/);
  });

  it("credit gone: Add credit on fal.ai links to its billing page", async () => {
    keys.saveAccountKey(A, "fal", "acct-fal-broke");
    const g = await run(cookies.A, { modelId: "nano-banana-pro", engine: "cloud" });
    const done = await settle(g.id);
    expect(done.error).toBe("Your fal.ai balance has run out. Top it up on fal.ai, then run again.");
    expect(done.trouble?.actions[0]).toEqual({ kind: "add-credit", label: "Add credit on fal.ai", target: BILLING_URL.fal });
    expect(fal.log.filter(isSubmit)).toHaveLength(1);
    // Settings → Your keys says Add credit (not Ready), and the status tells the composer before the next run.
    expect(keys.accountKeyInfo(A).fal?.balanceEmptyAt).toBeGreaterThan(0);
    expect((await visitorStatus(auth.accountById(A)!)).viewer).toMatchObject({ emptyKeys: ["fal"] });
    // Topped up: a run the provider takes clears it.
    fal.keys["acct-fal-broke"] = "good";
    try {
      expect((await settle((await run(cookies.A, { modelId: "nano-banana-pro", engine: "cloud" })).id)).status).toBe("succeeded");
      expect(keys.accountKeyInfo(A).fal?.balanceEmptyAt).toBeUndefined();
    } finally {
      fal.keys["acct-fal-broke"] = "broke";
    }
  });

  it("a key refused while polling fails the run at once (not after half an hour), and stops the job", async () => {
    fal.pollsToFinish = Infinity;
    fal.script = (r) => (isStatus(r) ? { status: 401, body: { detail: "Unauthorized" } } : null);
    const g = await run(cookies.A, { modelId: "nano-banana-pro", engine: "cloud" });
    const started = Date.now();
    const done = await settle(g.id);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(done.status).toBe("failed");
    expect(done.error).toBe("fal.ai didn't accept your key. Check it in Settings → Your keys.");
    expect(done.trouble?.actions[0]).toMatchObject({ kind: "key-settings", label: "Replace key", target: "/settings#your-keys" });
    // Its other key runs this model too.
    expect(done.trouble?.actions).toContainEqual({ kind: "run-with-key", label: "Run with your Replicate key", target: "replicate" });
    expect(fal.log.filter(isStatus)).toHaveLength(1);
  });

  it("a model the key may not run (403 that isn't about the key) says so, and the key stays good", async () => {
    fal.script = (r) => (isSubmit(r) ? { status: 403, body: { detail: "You do not have permission to access this application" } } : null);
    const g = await run(cookies.A, { modelId: "nano-banana-pro", engine: "cloud" });
    const done = await settle(g.id);
    expect(done.error).toBe("Your fal.ai account can't run this model yet. Pick another model, or turn it on in your fal.ai account.");
    expect(done.trouble?.details).toBe("fal.ai answered 403 · You do not have permission to access this application");
    expect(kinds(done)).toEqual(["pick-model", "run-with-key"]);
    expect(keys.accountKeyInfo(A).fal?.rejectedAt).toBeUndefined();
  });

  it("a key refused at submit: Replace key first, the provider's words (never the key) in details", async () => {
    fal.script = (r) => (isSubmit(r) ? { status: 401, body: { detail: "Invalid credentials: Key acct-fal-A" } } : null);
    const g = await run(cookies.A, { modelId: "nano-banana-pro", engine: "cloud" });
    const done = await settle(g.id);
    expect(done.error).toBe("fal.ai didn't accept your key. Check it in Settings → Your keys.");
    expect(done.trouble?.details).toBe("fal.ai answered 401 · Invalid credentials: Key ••••");
    expect(JSON.stringify(done)).not.toContain("acct-fal-A");
    expect(kinds(done)[0]).toBe("key-settings");
  });

  it("a job that failed at the provider: plain words, its own words in details", async () => {
    fal.script = (r) => (isStatus(r) ? { status: 200, body: { status: "COMPLETED", error: "Internal error: worker crashed" } } : null);
    const g = await run(cookies.A, { modelId: "nano-banana-pro", engine: "cloud" });
    const done = await settle(g.id);
    expect(done.error).toBe("fal.ai couldn't finish this one. Press Retry, or try different words or another picture.");
    expect(done.trouble?.details).toBe("Internal error: worker crashed");
  });
});

describe("the owner's runs keep the provider's own words", () => {
  it("a 404 on the owner's key reads as before", async () => {
    fal.script = (r) => (isSubmit(r) ? { status: 404, body: { detail: "Application not found" } } : null);
    const g = await run(cookies.owner, { modelId: "nano-banana-pro", engine: "cloud" });
    const done = await settle(g.id);
    expect(done.status).toBe("failed");
    expect(done.error).toBe("fal 404: Application not found");
    expect(done.trouble).toBeUndefined();
  });
});

describe("Run with your key: the cloud version of a tool on the account's GPU", () => {
  it("FPV Drone on MiniMax H3's open model runs on fal.ai's MiniMax H3; a Replicate-only account has none", () => {
    const preset = getPreset("motion-fpv-drone")!;
    const open = getModel("oss-minimax-h3");
    expect(gens.cloudTwin({ presetId: preset.id, modelId: "oss-minimax-h3" }, A)).toEqual({ modelId: "minimax-h3", provider: "fal", op: "i2v" });
    expect(gens.cloudTwin({ presetId: preset.id, modelId: "oss-minimax-h3" }, D)).toBeNull();
    // The composer's check before Run reads the same.
    const has = (id: string) => !!getModel(id);
    expect(cloudVersionKey(preset as never, open, ["fal", "replicate"], has, getModel)).toBe("fal");
    expect(cloudVersionKey(preset as never, open, ["replicate"], has, getModel)).toBeNull();
    // A Fuobe Original on both engines: the same model on the cloud.
    expect(gens.cloudTwin({ modelId: "fuobe-soul" }, D)).toEqual({ modelId: "fuobe-soul", provider: "replicate" });
    expect(cloudVersionKey(undefined, getModel("fuobe-soul"), ["replicate"], has, getModel)).toBe("replicate");
  });

  it("Run with your Replicate key runs on Replicate, never back on fal.ai; without that key it asks for one", async () => {
    const asked = { feature: "image" as const, prompt: "a quiet harbour at dawn", modelId: "nano-banana-pro", engine: "cloud" as const };
    const before = fal.log.filter(isSubmit).length;
    const g = await run(cookies.A, onCloudKey(asked, { target: "replicate" }) as unknown as Record<string, unknown>);
    expect(g.provider).toBe("replicate");
    expect((await settle(g.id)).status).toBe("succeeded");
    expect(fal.log.filter(isSubmit)).toHaveLength(before);
    // An account with only a Replicate token asked to run on fal.ai: Add your key, never a silent other route.
    await expect(run(cookies.D, onCloudKey(asked, { target: "fal" }) as unknown as Record<string, unknown>)).rejects.toThrow(/^403: .*add-key/);
  });

  it("a key the provider refused isn't offered for Run with your key; Check again clears it once the provider takes it", async () => {
    const fpv = { presetId: "motion-fpv-drone", modelId: "oss-minimax-h3" };
    keys.markKeyRejected(A, "fal", "acct-fal-A");
    expect(gens.cloudTwin(fpv, A)).toBeNull();
    const again = await keysRoute.PUT(keyRequest(cookies.A, "fal", { recheck: true }), { params: Promise.resolve({ provider: "fal" }) });
    expect(again.status).toBe(200);
    expect(keys.accountKeyInfo(A).fal?.rejectedAt).toBeUndefined();
    expect(gens.cloudTwin(fpv, A)).toEqual({ modelId: "minimax-h3", provider: "fal", op: "i2v" });
  });

  it("the key check asks again by itself while the provider is busy, and says so plainly when it stays busy", async () => {
    KEY_CHECK.waitsMs = [10, 10];
    try {
      let busy = 0;
      fal.script = (r) => (/requests\/0{8}-/.test(r.path) && busy++ < 2 ? { status: 503, body: { detail: "Service unavailable" } } : null);
      const ok = await keysRoute.PUT(keyRequest(cookies.A, "fal", { key: "acct-fal-A" }), { params: Promise.resolve({ provider: "fal" }) });
      expect(ok.status).toBe(200);
      expect(busy).toBe(3);
      fal.script = (r) => (/requests\/0{8}-/.test(r.path) ? { status: 503, body: { detail: "Service unavailable" } } : null);
      const down = await keysRoute.PUT(keyRequest(cookies.A, "fal", { key: "acct-fal-A" }), { params: Promise.resolve({ provider: "fal" }) });
      expect(down.status).toBe(503);
      expect(await down.json()).toEqual({ error: "fal.ai is busy right now, so we couldn't check your key. Try again in a minute.", details: "fal.ai answered 503" });
    } finally {
      KEY_CHECK.waitsMs = [1_000, 3_000];
    }
  });

  it("the failed tile's Run with your fal.ai key asks for a run the studio takes, on that key", async () => {
    const up = await uploadsRoute.POST(
      new Request("http://localhost:3000/api/uploads", { method: "POST", headers: { cookie: cookies.A, host: "localhost:3000", "content-type": "image/png", "x-file-name": "me.png", "content-length": String(TINY_PNG.length) }, body: TINY_PNG }),
    );
    expect(up.status).toBe(201);
    const pic = ((await up.json()) as { url: string }).url;
    const open = { feature: "video" as const, modelId: "oss-minimax-h3", presetId: "motion-fpv-drone", op: "i2v" as const, prompt: "", inputs: { images: [pic] } };
    const twin = gens.cloudTwin(open, A)!;
    const g = await run(cookies.A, onCloudKey(open, twin) as unknown as Record<string, unknown>);
    expect(g.provider).toBe("fal");
    expect((await settle(g.id)).status).toBe("succeeded");
  });
});
