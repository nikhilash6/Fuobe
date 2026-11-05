import fs from "node:fs";
import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listenOnFreePort, startFakeBilling, FAKE_POLICY, type FakeBilling } from "./helpers/fake-billing";
import { startFakeComfy, type FakeComfy } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

/*
 * Where an account's runs go, as it picked (hosted runs): this install's GPUs, its own GPU, or its key. PUT
 * /api/account/run-on keeps the pick for the account, on the server (every device); the status sends it to that
 * account only; every run and price check that names no place follows it in one order (a place the run names, then the
 * pick, then the policy); it goes when the place it names goes (the GPU forgotten, the key removed) and with the
 * account. While hosted runs are off the route doesn't exist and nothing reads the table.
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

process.env.FUOBE_DATA_DIR = tempDir("fuobe-run-on-");
process.env.FUOBE_PUBLIC_SIGNUP = "1";
for (const k of ["FUOBE_PASSWORD", "FUOBE_HOSTED_RUNS", "FUOBE_HOSTED_FREE", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN", "FUOBE_MODERATION_URL", "FUOBE_PLACE_NAME"]) delete process.env[k];
globalThis.__fuobeTestDiskFree = 1e13;

const probe = http.createServer();
const comfyPort = await listenOnFreePort(probe);
await new Promise<void>((r) => probe.close(() => r()));
const comfy: FakeComfy = await startFakeComfy({ output: "image", delayMs: 0 }, comfyPort);
process.env.COMFYUI_URL = comfy.url;

const auth = await import("@/server/auth");
const route = await import("@/app/api/account/run-on/route");
const gpuRoute = await import("@/app/api/account/gpu/route");
const keyRoute = await import("@/app/api/account/keys/[provider]/route");
const billing = await import("@/server/billing");
const keys = await import("@/server/account-keys");
const runOn = await import("@/server/run-on");
const { visitorStatus, noteGpuState } = await import("@/server/account-gpu");
const { decidePlace, poolMayTake, poolQuote } = await import("@/server/hosted-run");
const { onAccountDeleted } = await import("@/server/account-files");
const { removeAccount } = await import("@/server/account-sweep");
const { db } = await import("@/server/db");
const { accountMayChange, accountOwnRead } = await import("@/lib/guest-access");

const GPU_URL = "https://my-gpu.example.com";
const req = { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox in the snow" };

let fake: FakeBilling;
const ids: Record<string, string> = {};
const cookies: Record<string, string> = {};
beforeAll(async () => {
  fake = await startFakeBilling();
  auth.setPassword("install password");
  for (const name of ["ana", "ben", "cy"]) {
    ids[name] = auth.createAccount(`${name}@example.com`, "long enough").id;
    cookies[name] = `${auth.SESSION_COOKIE}=${auth.createSession(ids[name]).value}`;
  }
  // The registration src/instrumentation.ts makes at start.
  onAccountDeleted(runOn.clearRunOn);
});
afterAll(async () => {
  globalThis.__fuobeTestDiskFree = undefined;
  for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_HOSTED_FREE", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN"]) delete process.env[k];
  await fake.close();
  await comfy.close();
});
beforeEach(() => {
  for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_HOSTED_FREE", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN"]) delete process.env[k];
  billing.resetBillingCache();
  fake.policy = { ...FAKE_POLICY };
  for (const id of Object.values(ids)) {
    runOn.clearRunOn(id);
    if (auth.accountById(id)) auth.setAccountGpu(id, null);
  }
});

const hostedOn = (prefer?: "pool") => {
  process.env.FUOBE_HOSTED_RUNS = "1";
  if (prefer) {
    process.env.FUOBE_BILLING_URL = fake.url;
    process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
    fake.policy = { ...FAKE_POLICY, prefer };
  } else process.env.FUOBE_HOSTED_FREE = "1";
};

const call = (method: "GET" | "PUT", who: string, body?: unknown) => {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const r = new Request("http://localhost:3000/api/account/run-on", { method, headers: { cookie: cookies[who], host: "localhost:3000", "content-type": "application/json" }, body: text });
  return method === "GET" ? route.GET(r) : route.PUT(r);
};
const read = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> });

/** An account's GPU at a web address, said to answer (or not) without calling it. */
const gpuOf = (who: string, online = true) => {
  auth.setAccountGpu(ids[who], { url: GPU_URL });
  noteGpuState(ids[who], GPU_URL, online, { info: { device: "cuda:0 NVIDIA GeForce RTX 4090" } });
};

describe("hosted runs off (every self-hosted install by default)", () => {
  it("the route doesn't exist and the status says nothing of a pick", async () => {
    expect((await call("PUT", "ana", { runOn: "site" })).status).toBe(404);
    expect((await call("GET", "ana")).status).toBe(404);
    runOn.setRunOn(ids.ana, { runOn: "site" });
    gpuOf("ana");
    const s = await visitorStatus(auth.accountById(ids.ana)!);
    expect(JSON.stringify(s.viewer)).not.toMatch(/runOn|runKey|ranOwn/);
  });
  it("no run reads it: a run goes where it went before", async () => {
    runOn.setRunOn(ids.ana, { runOn: "site" });
    gpuOf("ana");
    expect((await decidePlace(auth.accountById(ids.ana)!, req, undefined)).kind).toBe("own");
    expect(poolMayTake(auth.accountById(ids.ana)!, undefined)).toBe(false);
  });
});

describe("the route (hosted runs on)", () => {
  beforeEach(() => hostedOn());

  it("is an account's own: listed for accounts by its exact path", () => {
    expect(accountMayChange("PUT", "/api/account/run-on", "")).toBe(true);
    expect(accountMayChange("POST", "/api/account/run-on", "")).toBe(false);
    expect(accountMayChange("PUT", "/api/account/run-on/x", "")).toBe(false);
    expect(accountOwnRead("/api/account/run-on")).toBe(true);
  });

  it("keeps a pick per account, and one account never sees or changes another's", async () => {
    gpuOf("ana");
    expect(await read(await call("PUT", "ana", { runOn: "gpu" }))).toEqual({ status: 200, body: { runOn: "gpu" } });
    expect(await read(await call("GET", "ana"))).toEqual({ status: 200, body: { runOn: "gpu" } });
    expect(await read(await call("GET", "ben"))).toEqual({ status: 200, body: { runOn: null } });
    expect((await call("PUT", "ben", { runOn: "site" })).status).toBe(200);
    expect(runOn.getRunOn(ids.ana)).toEqual({ runOn: "gpu" });
    expect(runOn.getRunOn(ids.ben)).toEqual({ runOn: "site" });
    // A new pick replaces the old one: one row per account.
    expect((await call("PUT", "ana", { runOn: "site" })).status).toBe(200);
    expect(db().prepare("SELECT COUNT(*) AS n FROM account_run_on WHERE account_id = ?").get(ids.ana)).toEqual({ n: 1 });
  });

  it("only a place the account has: a GPU connected, a key saved", async () => {
    expect(await read(await call("PUT", "ana", { runOn: "gpu" }))).toMatchObject({ status: 409, body: { code: "connect-gpu" } });
    expect(await read(await call("PUT", "ana", { runOn: "key" }))).toMatchObject({ status: 409, body: { code: "add-key" } });
    keys.saveAccountKey(ids.ana, "replicate", "r8_test_key_for_ana");
    // The key it names when it has it, else the one it has.
    expect(await read(await call("PUT", "ana", { runOn: "key", key: "fal" }))).toEqual({ status: 200, body: { runOn: "key", runKey: "replicate" } });
    keys.removeAccountKey(ids.ana, "replicate");
  });

  it("refuses anything else, and is nobody's but an account's", async () => {
    expect((await call("PUT", "ana", { runOn: "cloud" })).status).toBe(400);
    expect((await call("PUT", "ana", { runOn: "site", extra: 1 })).status).toBe(400);
    const guest = await route.PUT(new Request("http://localhost:3000/api/account/run-on", { method: "PUT", headers: { host: "localhost:3000" }, body: JSON.stringify({ runOn: "site" }) }));
    expect(guest.status).toBe(404);
  });
});

describe("the status (hosted runs on)", () => {
  beforeEach(() => hostedOn());

  it("sends the pick to that account only, never to a guest", async () => {
    gpuOf("ana");
    runOn.setRunOn(ids.ana, { runOn: "gpu" });
    expect((await visitorStatus(auth.accountById(ids.ana)!)).viewer).toMatchObject({ hosted: true, runOn: "gpu" });
    expect((await visitorStatus(auth.accountById(ids.ben)!)).viewer).not.toHaveProperty("runOn");
    expect(JSON.stringify((await visitorStatus(null)).viewer)).not.toMatch(/runOn|runKey|ranOwn/);
  });

  it("a key's pick names its provider", async () => {
    keys.saveAccountKey(ids.ben, "fal", "fal_key_id:fal_key_secret_for_ben");
    runOn.setRunOn(ids.ben, { runOn: "key", runKey: "fal" });
    expect((await visitorStatus(auth.accountById(ids.ben)!)).viewer).toMatchObject({ runOn: "key", runKey: "fal" });
    keys.removeAccountKey(ids.ben, "fal");
  });

  it("a pick whose place is gone is dropped (its runs go to this install's GPUs again)", async () => {
    runOn.setRunOn(ids.ana, { runOn: "gpu" });
    expect((await visitorStatus(auth.accountById(ids.ana)!)).viewer).not.toHaveProperty("runOn");
    expect(runOn.getRunOn(ids.ana)).toBeNull();
    runOn.setRunOn(ids.ana, { runOn: "key", runKey: "fal" });
    expect((await visitorStatus(auth.accountById(ids.ana)!)).viewer).not.toHaveProperty("runOn");
    expect(runOn.getRunOn(ids.ana)).toBeNull();
  });

  it("the one-time note: only for an account with a GPU or key that ran there before it ever ran here, and no pick yet", async () => {
    const row = (account: string, place: "pool" | null, at: number) =>
      db()
        .prepare(
          "INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, created_at, updated_at) VALUES (?, 'image', 'oss-z-image-turbo', 'open', 'comfyui', 't2i', 'image', 'done', ?, ?, ?)",
        )
        .run(`g-${account}-${at}`, JSON.stringify({ feature: "image", modelId: "oss-z-image-turbo", account, ...(place && { place }) }), at, at);
    const ranOwn = async (who: string) => !!(await visitorStatus(auth.accountById(ids[who])!)).viewer.ranOwn;
    gpuOf("ana");
    expect(await ranOwn("ana")).toBe(false);
    row(ids.ana, null, 1000);
    expect(await ranOwn("ana")).toBe(true);
    // A run here later doesn't change it; a pick (OK or Keep my GPU) ends it on every device.
    row(ids.ana, "pool", 2000);
    expect(await ranOwn("ana")).toBe(true);
    runOn.setRunOn(ids.ana, { runOn: "site" });
    expect(await ranOwn("ana")).toBe(false);
    // An account that ran here first and connected its GPU after never ran elsewhere first: no note.
    row(ids.cy, "pool", 1000);
    row(ids.cy, null, 3000);
    gpuOf("cy");
    expect(await ranOwn("cy")).toBe(false);
    // Nothing of its own (no GPU, no key): nothing to keep, no note.
    row(ids.ben, null, 1000);
    expect(await ranOwn("ben")).toBe(false);
  });
});

describe("one decision order for a run that names no place (hosted runs on)", () => {
  it("no pick: the install's default (its own GPU first while online, unless the policy puts these GPUs first)", async () => {
    hostedOn();
    gpuOf("ana", true);
    expect((await decidePlace(auth.accountById(ids.ana)!, req, undefined)).kind).toBe("own");
    billing.resetBillingCache();
    hostedOn("pool");
    expect((await decidePlace(auth.accountById(ids.ana)!, req, undefined)).kind).toBe("pool");
  });

  it("its GPU picked: there at once, online or not, never asked about, whatever the policy prefers", async () => {
    hostedOn("pool");
    for (const online of [true, false]) {
      gpuOf("ana", online);
      runOn.setRunOn(ids.ana, { runOn: "gpu" });
      expect((await decidePlace(auth.accountById(ids.ana)!, req, undefined)).kind).toBe("own");
      expect(await poolQuote(auth.accountById(ids.ana)!, req, undefined)).toBeNull();
      expect(poolMayTake(auth.accountById(ids.ana)!, undefined)).toBe(false);
    }
  });

  it("these GPUs picked: here first, even with its own GPU online on an install that puts it first", async () => {
    hostedOn();
    gpuOf("ana", true);
    runOn.setRunOn(ids.ana, { runOn: "site" });
    expect((await decidePlace(auth.accountById(ids.ana)!, req, undefined)).kind).toBe("pool");
    expect((await poolQuote(auth.accountById(ids.ana)!, req, undefined))?.quote).toBeTruthy();
    expect(poolMayTake(auth.accountById(ids.ana)!, undefined)).toBe(true);
  });

  it("these GPUs picked while its own GPU doesn't answer: here, never the question about its GPU", async () => {
    hostedOn();
    gpuOf("ana", false);
    // With no pick that is asked about (409, "Run on …").
    const asked = await decidePlace(auth.accountById(ids.ana)!, req, undefined);
    expect(asked.kind === "refuse" && asked.refusal.status).toBe(409);
    runOn.setRunOn(ids.ana, { runOn: "site" });
    expect((await decidePlace(auth.accountById(ids.ana)!, req, undefined)).kind).toBe("pool");
  });

  it("a place the run names wins over the pick, and never changes it (Retry, Run on …)", async () => {
    hostedOn();
    gpuOf("ana", true);
    runOn.setRunOn(ids.ana, { runOn: "gpu" });
    expect((await decidePlace(auth.accountById(ids.ana)!, req, "pool")).kind).toBe("pool");
    runOn.setRunOn(ids.ana, { runOn: "site" });
    expect((await decidePlace(auth.accountById(ids.ana)!, req, "own")).kind).toBe("own");
    expect(runOn.getRunOn(ids.ana)).toEqual({ runOn: "site" });
  });

  it("what these GPUs don't take still runs on its own GPU when these GPUs are picked", async () => {
    hostedOn();
    gpuOf("ana", true);
    runOn.setRunOn(ids.ana, { runOn: "site" });
    const loras = { ...req, loras: [{ file: "x.safetensors", url: "https://huggingface.co/x/x.safetensors" }] };
    expect((await decidePlace(auth.accountById(ids.ana)!, loras, undefined)).kind).toBe("own");
  });
});

describe("a pick goes when its place goes", () => {
  beforeEach(() => hostedOn());

  it("forgetting the GPU drops a pick of it, and the answer says so (the page says where runs go now)", async () => {
    gpuOf("ana");
    runOn.setRunOn(ids.ana, { runOn: "gpu" });
    const r = await read(await gpuRoute.DELETE(new Request("http://localhost:3000/api/account/gpu", { method: "DELETE", headers: { cookie: cookies.ana, host: "localhost:3000" } })));
    expect(r).toMatchObject({ status: 200, body: { gpu: null, runOnCleared: true } });
    expect(runOn.getRunOn(ids.ana)).toBeNull();
    // A pick of these GPUs stays.
    gpuOf("ana");
    runOn.setRunOn(ids.ana, { runOn: "site" });
    const kept = await read(await gpuRoute.DELETE(new Request("http://localhost:3000/api/account/gpu", { method: "DELETE", headers: { cookie: cookies.ana, host: "localhost:3000" } })));
    expect(kept.body).not.toHaveProperty("runOnCleared");
    expect(runOn.getRunOn(ids.ana)).toEqual({ runOn: "site" });
  });

  it("removing the key drops a pick of it", async () => {
    keys.saveAccountKey(ids.ben, "fal", "fal_key_id:fal_key_secret_for_ben");
    runOn.setRunOn(ids.ben, { runOn: "key", runKey: "fal" });
    const ctx = { params: Promise.resolve({ provider: "fal" }) } as Parameters<typeof keyRoute.DELETE>[1];
    const r = await read(await keyRoute.DELETE(new Request("http://localhost:3000/api/account/keys/fal", { method: "DELETE", headers: { cookie: cookies.ben, host: "localhost:3000", "content-type": "application/json" }, body: "{}" }), ctx));
    expect(r).toMatchObject({ status: 200, body: { runOnCleared: true } });
    expect(runOn.getRunOn(ids.ben)).toBeNull();
  });

  it("goes with a deleted account (registered at start in instrumentation.ts)", async () => {
    expect(fs.readFileSync("src/instrumentation.ts", "utf8")).toMatch(/onAccountDeleted\(clearRunOn\)/);
    runOn.setRunOn(ids.cy, { runOn: "site" });
    await removeAccount(ids.cy);
    expect(db().prepare("SELECT COUNT(*) AS n FROM account_run_on WHERE account_id = ?").get(ids.cy)).toEqual({ n: 0 });
  });
});
