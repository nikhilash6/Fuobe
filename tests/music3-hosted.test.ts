import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listenInRange, startFakeBilling, type FakeBilling } from "./helpers/fake-billing";
import { startFakeComfy, type FakeComfy } from "./helpers/fake-comfy-runner";

// Full songs under public sign-up: an account's song on this install's GPUs (hosted runs) plans and prices as any studio run
// (MiniMax Music 3 and YuE2 are open models on core nodes); a model that needs words is refused before anything is
// priced or held.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-music3-hosted-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_HOSTED_RUNS;
delete process.env.FUOBE_BILLING_URL;
delete process.env.FUOBE_MODERATION_URL;
globalThis.__fuobeTestDiskFree = 1e13;

const probe = http.createServer();
const comfyPort = await listenInRange(probe);
await new Promise<void>((r) => probe.close(() => r()));
const comfy: FakeComfy = await startFakeComfy({ output: "image", delayMs: 0 }, comfyPort);
process.env.COMFYUI_URL = comfy.url;

const auth = await import("@/server/auth");
const generationsRoute = await import("@/app/api/generations/route");
const { resetRates } = await import("@/server/rate");
const billing = await import("@/server/billing");

let fake: FakeBilling;
let cookie = "";
beforeAll(async () => {
  fake = await startFakeBilling();
  auth.setPassword("install password");
  const a = auth.createAccount("songs@example.com", "long enough").id;
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(a).value}`;
});
afterAll(async () => {
  globalThis.__fuobeTestDiskFree = undefined;
  for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN"]) delete process.env[k];
  await fake.close();
  await comfy.close();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});
beforeEach(() => {
  resetRates();
  billing.resetBillingCache();
  process.env.FUOBE_HOSTED_RUNS = "1";
  process.env.FUOBE_BILLING_URL = fake.url;
  process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
  fake.calls.length = 0;
  fake.policy = { hosted: true, pool: {}, uploads: { image: true, video: false, audio: false }, limits: { activeRuns: 7, waiting: 7, runsPerHour: 70, outputsPerRun: 2, maxMegapixels: 7, maxSeconds: 600, keepDays: 7, spaceBytes: 7 }, ttlS: 0 };
});

const post = (body: unknown, query = "") => {
  const text = JSON.stringify(body);
  return generationsRoute.POST(
    new Request(`http://localhost:3000/api/generations${query}`, { method: "POST", headers: { cookie, host: "localhost:3000", "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }, body: text }),
  );
};
const song = { feature: "audio", modelId: "oss-minimax-music-3", op: "music", prompt: "Acoustic pop, 96 BPM", params: { duration: 180, extra: { lyrics: "[Verse]\nMorning light" } } };

describe("songs on this install's GPUs (hosted runs)", () => {
  it("prices an account's MiniMax Music 3 song there, with its op, model and seconds", async () => {
    const p = await post(song, "?preview=1");
    expect(p.status).toBe(200);
    expect(((await p.json()) as { place: string }).place).toBe("pool");
    const quote = fake.calls_of("/v1/quote").at(-1)!.body as { run: { model: string; op: string; kind: string; seconds: number; engine: string } };
    expect(quote.run).toMatchObject({ model: "oss-minimax-music-3", op: "music", kind: "audio", seconds: 180, engine: "open" });
  });

  it("YuE2 needs its lyrics before anything is priced or held", async () => {
    const r = await post({ ...song, modelId: "oss-yue2", params: { duration: 120 } });
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: string }).error).toMatch(/^YuE2 sings your lyrics/);
    expect(fake.calls_of("/v1/reserve")).toHaveLength(0);
  });
});
