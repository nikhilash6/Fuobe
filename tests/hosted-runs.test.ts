import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listenOnFreePort, startFakeBilling, type FakeBilling } from "./helpers/fake-billing";
import { startFakeComfy, TINY_MP4, TINY_PNG, type FakeComfy } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

// Hosted runs (FUOBE_HOSTED_RUNS=1): off, everything is as before; on, an account with no GPU of its own may run in
// the studios on this install's ComfyUI, and every other tool still needs its own GPU.
const dir = tempDir("fuobe-hosted-runs-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_HOSTED_RUNS;
delete process.env.FUOBE_BILLING_URL;
delete process.env.FUOBE_MODERATION_URL;
globalThis.__fuobeTestDiskFree = 1e13;

const probe = http.createServer();
const comfyPort = await listenOnFreePort(probe);
await new Promise<void>((r) => probe.close(() => r()));
const comfy: FakeComfy = await startFakeComfy({ output: "image", delayMs: 0 }, comfyPort);
process.env.COMFYUI_URL = comfy.url;

const auth = await import("@/server/auth");
const generationsRoute = await import("@/app/api/generations/route");
const uploadsRoute = await import("@/app/api/uploads/route");
const { proxy } = await import("@/proxy");
const { NextRequest } = await import("next/server");
const { resetRates } = await import("@/server/rate");
const billing = await import("@/server/billing");
const { visitorStatus } = await import("@/server/account-gpu");
const { poolAllows } = await import("@/server/hosted");

let fake: FakeBilling;
let a = "";
let cookie = "";
beforeAll(async () => {
  fake = await startFakeBilling();
  auth.setPassword("install password");
  a = auth.createAccount("hosted@example.com", "long enough").id;
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(a).value}`;
});
afterAll(async () => {
  globalThis.__fuobeTestDiskFree = undefined;
  for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_HOSTED_FREE", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN"]) delete process.env[k];
  await fake.close();
  await comfy.close();
});
beforeEach(() => {
  resetRates();
  billing.resetBillingCache();
  delete process.env.FUOBE_HOSTED_RUNS;
  delete process.env.FUOBE_HOSTED_FREE;
  delete process.env.FUOBE_BILLING_URL;
  fake.policy = { hosted: true, pool: {}, uploads: { image: true, video: false, audio: false }, limits: { activeRuns: 7, waiting: 7, runsPerHour: 70, outputsPerRun: 2, maxMegapixels: 7, maxSeconds: 7, keepDays: 7, spaceBytes: 7 }, ttlS: 0 };
});

const headers = (extra: Record<string, string> = {}) => ({ cookie, host: "localhost:3000", ...extra });
const viaProxy = (url: string, method = "POST") => proxy(new NextRequest(`http://localhost:3000${url}`, { method, headers: headers({ "content-type": "application/json" }), body: method === "POST" ? "{}" : undefined }));
const post = (body: unknown) => {
  const text = JSON.stringify(body);
  return generationsRoute.POST(new Request("http://localhost:3000/api/generations", { method: "POST", headers: headers({ "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }), body: text }));
};
const upload = (bytes: Buffer, type: string, name: string) =>
  uploadsRoute.POST(new Request("http://localhost:3000/api/uploads", { method: "POST", headers: headers({ "content-type": type, "x-file-name": name, "content-length": String(bytes.length) }), body: new Uint8Array(bytes) }));

describe("hosted runs off (the default)", () => {
  it("an account with no GPU or key: runs and uploads say Connect your GPU, and the status says nothing new", async () => {
    const r = await viaProxy("/api/generations");
    expect(r.status).toBe(403);
    expect(((await r.json()) as { code: string }).code).toBe("connect-gpu");
    expect((await upload(TINY_PNG, "image/png", "me.png")).status).toBe(403);
    const s = await visitorStatus(auth.accountById(a)!);
    expect(s.viewer.hosted).toBeUndefined();
    expect(s.viewer.balance).toBeUndefined();
  });
});

describe("hosted runs on", () => {
  beforeEach(() => {
    process.env.FUOBE_HOSTED_RUNS = "1";
    // Free for every account here: no billing service answers for these runs unless a test sets one.
    process.env.FUOBE_HOSTED_FREE = "1";
  });

  it("stay closed with nothing to answer for them: no billing service, and not free", async () => {
    delete process.env.FUOBE_HOSTED_FREE;
    const r = await post({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { code: string }).code).toBe("connect-gpu");
    expect((await visitorStatus(auth.accountById(a)!)).viewer.hosted).toBeUndefined();
    expect((await upload(TINY_PNG, "image/png", "me.png")).status).toBe(403);
  });

  it("a studio run reaches the route; other tools still need the account's own GPU", async () => {
    const r = await viaProxy("/api/generations");
    expect(r.status).not.toBe(403);
    const other = await viaProxy("/api/enhance");
    expect(other.status).toBe(403);
    expect(((await other.json()) as { code: string }).code).toBe("own-gpu-tool");
  });

  it("an account may add pictures for its runs here, not clips (the default policy)", async () => {
    expect((await upload(TINY_PNG, "image/png", "me.png")).status).toBe(201);
    const clip = await upload(TINY_MP4, "video/mp4", "me.mp4");
    expect(clip.status).toBe(403);
    expect(((await clip.json()) as { code: string }).code).toBe("connect-gpu");
  });

  it("the status says hosted runs are open", async () => {
    const s = await visitorStatus(auth.accountById(a)!);
    expect(s.viewer.hosted).toBe(true);
    expect((await visitorStatus(null)).viewer.hosted).toBe(true);
  });

  it("refuses here what runs only on an account's own GPU: extra LoRAs, a model the policy leaves out", async () => {
    const loras = await post({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox", loras: [{ file: "x.safetensors", url: "https://huggingface.co/x/x.safetensors" }] });
    expect(loras.status).toBe(403);
    expect(((await loras.json()) as { code: string }).code).toBe("not-offered");
    process.env.FUOBE_BILLING_URL = fake.url;
    process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
    fake.policy = { ...fake.policy, pool: { deny: ["oss-z-image-turbo"] } };
    const denied = await post({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("x-fuobe-billing")).toBe("not-offered");
  });

  it("an account the policy keeps off this install's GPUs gets today's answer", async () => {
    process.env.FUOBE_BILLING_URL = fake.url;
    process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
    fake.policy = { ...fake.policy, hosted: false };
    const r = await post({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox" });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { code: string }).code).toBe("connect-gpu");
    expect((await visitorStatus(auth.accountById(a)!)).viewer.hosted).toBeUndefined();
  });

  it("QMA · 96 views (an edit with its own LoRA in the recipe) plans and prices on this install's GPU", async () => {
    process.env.FUOBE_BILLING_URL = fake.url;
    process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
    const up = (await (await upload(TINY_PNG, "image/png", "product.png")).json()) as { url: string };
    const { decidePlace, poolQuote } = await import("@/server/hosted-run");
    const { QMA_MODEL } = await import("@/lib/qma");
    const req = { feature: "image", modelId: QMA_MODEL, op: "edit" as const, prompt: "studio light", inputs: { images: [up.url] }, params: { numOutputs: 1, extra: { horizontal_angle: 180, vertical_angle: 0, zoom: 5 } } };
    const place = await decidePlace(auth.accountById(a)!, req, undefined);
    expect(place.kind).toBe("pool");
    if (place.kind !== "pool") return;
    expect(place.planned.model.id).toBe(QMA_MODEL);
    expect(place.planned.route.provider).toBe("comfyui");
    const quoted = await poolQuote(auth.accountById(a)!, req, undefined);
    expect(quoted?.planned.model.id).toBe(QMA_MODEL);
    expect(quoted?.quote).toBeTruthy();
  });

  it("the pool's allow and deny lists, for models and apps", () => {
    expect(poolAllows({ pool: {} }, "m")).toBe(true);
    expect(poolAllows({ pool: { allow: ["m"] } }, "m")).toBe(true);
    expect(poolAllows({ pool: { allow: ["n"] } }, "m")).toBe(false);
    expect(poolAllows({ pool: { deny: ["m"] } }, "m")).toBe(false);
    expect(poolAllows({ pool: { apps: { deny: ["app-x"] } } }, "m", "app-x")).toBe(false);
    expect(poolAllows({ pool: { apps: { allow: ["app-y"] } } }, "m", "app-x")).toBe(false);
  });

  it("an install whose ComfyUI is on the owner's computer doesn't offer hosted runs", async () => {
    process.env.COMFYUI_WHERE = "computer";
    try {
      const { poolReady } = await import("@/server/hosted");
      expect(poolReady()).toBe(false);
    } finally {
      delete process.env.COMFYUI_WHERE;
    }
  });
});
