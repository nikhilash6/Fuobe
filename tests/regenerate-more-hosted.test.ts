import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listenInRange, startFakeBilling, type FakeBilling } from "./helpers/fake-billing";
import { startFakeComfy, type FakeComfy } from "./helpers/fake-comfy-runner";

// MiniMax H3 at 2K with hosted runs on (review 6 of package n7-10): an account's 2K run on this install's GPUs is planned
// and priced with each take's Open-H3 Regenerate finish beside its 768p draft, and a policy that keeps the finish's model
// off those GPUs keeps the whole run off, priced or run.
// Regenerate is switched off for now (REGEN_OFFERED); these tests check it as it runs once switched on.
// tests/regenerate-offered.test.ts checks that nothing offers it while it is off.
vi.mock("@/lib/catalog/regenerate", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/catalog/regenerate")>()), REGEN_OFFERED: true }));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-regen-hosted-"));
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
const comfy: FakeComfy = await startFakeComfy({ output: "video", delayMs: 0 }, comfyPort);
process.env.COMFYUI_URL = comfy.url;

const auth = await import("@/server/auth");
const billing = await import("@/server/billing");
const { resetRates } = await import("@/server/rate");
const { decidePlace, poolQuote } = await import("@/server/hosted-run");
const R = await import("@/lib/catalog/regenerate");

let fake: FakeBilling;
let a = "";
beforeAll(async () => {
  fake = await startFakeBilling();
  auth.setPassword("install password");
  a = auth.createAccount("hosted-2k@example.com", "long enough").id;
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
  fake.policy = { hosted: true, pool: {}, uploads: { image: true, video: false, audio: false }, limits: { activeRuns: 7, waiting: 7, runsPerHour: 70, outputsPerRun: 2, maxMegapixels: 7, maxSeconds: 7, keepDays: 7, spaceBytes: 7 }, ttlS: 0 };
});

const twoK = (resolution = "2K") => ({ feature: "video", modelId: R.H3_OPEN_MODEL, op: "t2v" as const, prompt: "A lighthouse in a storm", params: { resolution, duration: 5, numOutputs: 2 } });
const finishes = (n: number) => Array.from({ length: n }, () => ({ model: R.REGEN_MODEL, op: "upscale-video" }));

describe("MiniMax H3 at 2K on this install's GPUs", () => {
  it("plans and prices each take's finish beside its draft", async () => {
    const place = await decidePlace(auth.accountById(a)!, twoK(), undefined);
    expect(place.kind).toBe("pool");
    if (place.kind !== "pool") return;
    expect(place.planned.model.id).toBe(R.H3_OPEN_MODEL);
    expect(place.planned.steps).toEqual(finishes(2));
    const before = fake.calls_of("/v1/quote").length;
    const quoted = await poolQuote(auth.accountById(a)!, twoK(), undefined);
    expect(quoted?.planned.steps).toEqual(finishes(2));
    const sent = fake.calls_of("/v1/quote").slice(before).at(-1)?.body as { run: { model: string; jobs: number; steps?: unknown } };
    expect(sent.run).toMatchObject({ model: R.H3_OPEN_MODEL, jobs: 2, steps: finishes(2) });
    // 768p is the model alone.
    expect((await poolQuote(auth.accountById(a)!, twoK("768p"), undefined))?.planned.steps).toBeUndefined();
  });

  it("a policy that keeps Open-H3 Regenerate off these GPUs keeps the 2K run off; 768p still runs here", async () => {
    fake.policy = { ...fake.policy, pool: { deny: [R.REGEN_MODEL] } };
    expect(await poolQuote(auth.accountById(a)!, twoK(), undefined)).toBeNull();
    expect((await decidePlace(auth.accountById(a)!, twoK(), undefined)).kind).toBe("refuse");
    expect((await decidePlace(auth.accountById(a)!, twoK("768p"), undefined)).kind).toBe("pool");
  });
});
