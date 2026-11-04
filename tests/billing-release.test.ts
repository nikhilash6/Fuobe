import http from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { listenInRange, startFakeBilling, type FakeBilling } from "./helpers/fake-billing";
import { startFakeComfy, type FakeComfy } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

// A run whose rows can't be made after its price was set aside: the hold is released once (docs/billing-hook.md).
vi.mock("@/server/generations", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/generations")>();
  return {
    ...real,
    createGenerations: () => {
      throw new Error("Something broke while the run was being made");
    },
  };
});

const dir = tempDir("fuobe-billing-release-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
process.env.FUOBE_HOSTED_RUNS = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_MODERATION_URL;
globalThis.__fuobeTestDiskFree = 1e13;

const probe = http.createServer();
const comfyPort = await listenInRange(probe);
await new Promise<void>((r) => probe.close(() => r()));
const comfy: FakeComfy = await startFakeComfy({ output: "image", delayMs: 0 }, comfyPort);
process.env.COMFYUI_URL = comfy.url;

const auth = await import("@/server/auth");
const generationsRoute = await import("@/app/api/generations/route");

let fake: FakeBilling;
let cookie = "";
beforeAll(async () => {
  fake = await startFakeBilling();
  process.env.FUOBE_BILLING_URL = fake.url;
  process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
  auth.setPassword("install password");
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(auth.createAccount("release@example.com", "long enough").id).value}`;
});
afterAll(async () => {
  globalThis.__fuobeTestDiskFree = undefined;
  for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN"]) delete process.env[k];
  await fake.close();
  await comfy.close();
});

describe("a run that can't be made after its reserve", () => {
  it("sends one release for its hold", async () => {
    const text = JSON.stringify({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox", shown: { amount: 7, priceVersion: "v7" } });
    const r = await generationsRoute.POST(new Request("http://localhost:3000/api/generations", { method: "POST", headers: { cookie, host: "localhost:3000", "content-type": "application/json", "content-length": String(text.length) }, body: text }));
    expect(r.status).toBe(422);
    expect(fake.calls_of("/v1/reserve")).toHaveLength(1);
    const end = Date.now() + 10_000;
    while (!fake.calls_of("/v1/release").length && Date.now() < end) await new Promise((res) => setTimeout(res, 50));
    const releases = fake.calls_of("/v1/release");
    expect(releases).toHaveLength(1);
    const hold = [...fake.holds.keys()][0];
    expect(releases[0].body).toEqual({ holdId: hold, reason: "not-created" });
    expect(fake.holds.get(hold)!.released).toBe(true);
  });
});
