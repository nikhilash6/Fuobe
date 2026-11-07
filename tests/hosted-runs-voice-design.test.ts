import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FAKE_POLICY, listenOnFreePort, startFakeBilling, type FakeBilling } from "./helpers/fake-billing";
import { startFakeComfy, type FakeComfy } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

// Design a voice on hosted runs (FUOBE_HOSTED_RUNS=1): an account with no GPU of its own may design a voice on this
// install's ComfyUI like any open model, priced by the billing service as an audio run. A clone reads a voice sample,
// so it follows the policy's audio uploads, and the hosted Qwen3-TTS on fal never runs there.
const dir = tempDir("fuobe-hosted-voice-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_HOSTED_RUNS;
delete process.env.FUOBE_MODERATION_URL;
globalThis.__fuobeTestDiskFree = 1e13;

const probe = http.createServer();
const comfyPort = await listenOnFreePort(probe);
await new Promise<void>((r) => probe.close(() => r()));
const comfy: FakeComfy = await startFakeComfy({ output: "image", delayMs: 0 }, comfyPort);
process.env.COMFYUI_URL = comfy.url;

const auth = await import("@/server/auth");
const billing = await import("@/server/billing");
const { decidePlace, poolQuote } = await import("@/server/hosted-run");

let fake: FakeBilling;
let account: NonNullable<ReturnType<typeof auth.accountById>>;
beforeAll(async () => {
  fake = await startFakeBilling();
  auth.setPassword("install password");
  account = auth.accountById(auth.createAccount("voices@example.com", "long enough").id)!;
});
afterAll(async () => {
  globalThis.__fuobeTestDiskFree = undefined;
  for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN"]) delete process.env[k];
  await fake.close();
  await comfy.close();
});
beforeEach(() => {
  billing.resetBillingCache();
  process.env.FUOBE_HOSTED_RUNS = "1";
  process.env.FUOBE_BILLING_URL = fake.url;
  process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
  fake.policy = { ...FAKE_POLICY };
});

const design = (modelId: string) => ({ feature: "audio" as const, modelId, engine: "open" as const, op: "voice-design" as const, prompt: "Hello there.", params: { voiceDescription: "A warm older narrator." } });
const clone = { feature: "audio" as const, modelId: "oss-qwen3-tts", engine: "open" as const, op: "tts" as const, prompt: "A new line.", inputs: { voiceAudio: "/api/files/uploads/take.wav" }, params: { voiceTranscript: "Hello there." } };

describe("Design a voice on this install's GPUs", () => {
  it("plans and prices both open voice designers there as audio runs", async () => {
    for (const modelId of ["oss-qwen3-tts", "oss-voxcpm2"]) {
      const before = fake.calls_of("/v1/quote").length;
      const q = await poolQuote(account, design(modelId), undefined);
      expect(q, modelId).not.toBeNull();
      expect(q!.planned!.model.id).toBe(modelId);
      expect(q!.planned!.op).toBe("voice-design");
      expect(q!.planned!.route.provider).toBe("comfyui");
      expect(q!.quote).toMatchObject({ amount: 7, priceVersion: "v7" });
      const sent = fake.calls_of("/v1/quote").slice(before);
      expect(sent).toHaveLength(1);
      expect((sent[0].body as { run: Record<string, unknown> }).run).toMatchObject({ place: "pool", model: modelId, op: "voice-design", kind: "audio", engine: "open" });
      expect((await decidePlace(account, design(modelId), undefined)).kind).toBe("pool");
    }
  });

  it("a clone reads a voice sample: offered only when the policy takes audio uploads", async () => {
    const refused = await decidePlace(account, clone, undefined);
    expect(refused.kind).toBe("refuse");
    if (refused.kind === "refuse") expect(refused.refusal.body).toMatchObject({ code: "connect-gpu", error: "This file runs self-hosted" });
    fake.policy = { ...FAKE_POLICY, uploads: { ...FAKE_POLICY.uploads, audio: true } };
    billing.resetBillingCache();
    expect((await decidePlace(account, clone, undefined)).kind).toBe("pool");
  });

  it("the policy's deny list keeps a voice designer off; the hosted Qwen3-TTS on fal is never priced there", async () => {
    fake.policy = { ...FAKE_POLICY, pool: { deny: ["oss-voxcpm2"] } };
    billing.resetBillingCache();
    // Refused by the price check, so Run is off before it is pressed (an account with no GPU of its own to run it on).
    expect((await poolQuote(account, design("oss-voxcpm2"), undefined))?.quote).toMatchObject({ allowed: false, code: "not-offered" });
    expect(await poolQuote(account, design("oss-qwen3-tts"), undefined)).not.toBeNull();
    expect(await poolQuote(account, { ...design("qwen-3-tts"), engine: "cloud" }, undefined)).toBeNull();
    expect((await decidePlace(account, { ...design("qwen-3-tts"), engine: "cloud" }, undefined)).kind).toBe("own");
  });

  it("hosted runs off: nothing is planned there", async () => {
    delete process.env.FUOBE_HOSTED_RUNS;
    expect(await poolQuote(account, design("oss-qwen3-tts"), undefined)).toBeNull();
    expect((await decidePlace(account, design("oss-qwen3-tts"), undefined)).kind).toBe("own");
  });
});
