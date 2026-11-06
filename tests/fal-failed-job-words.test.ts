import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeFal, type FakeCloud } from "./helpers/fake-cloud";
import { tempDir } from "./helpers/temp-dir";

/**
 * A job fal.ai finished as failed keeps fal.ai's reason. fal.ai's status is COMPLETED for a failed job too, with only
 * `error`, which is "Invalid status code: 422" when the model refused the input (fal.ai docs: Webhooks, Response errors).
 * The result answers the job's own error (Queue API reference, Get result: "If the model returned an error, this operation
 * returns the same error"): here a content_policy_violation's detail[]. A content flag must read as one.
 * Stand-in fal.ai (tests/helpers/fake-cloud.ts): no real key, no paid call.
 */
const dir = tempDir("fuobe-fal-failed-job-");
process.env.FUOBE_DATA_DIR = dir;
delete process.env.FUOBE_PASSWORD;

const auth = await import("@/server/auth");
const keys = await import("@/server/account-keys");
const { setSetting } = await import("@/server/settings");
const { runAsTenant } = await import("@/server/tenant");
const { falProvider, cloneVoice } = await import("@/server/providers/fal");
const { diagnoseKey } = await import("@/lib/diagnose");
const { getModel } = await import("@/lib/catalog");

const FLAGGED = {
  detail: [
    {
      loc: ["body", "prompt"],
      msg: "The content could not be processed because it contained material flagged by a content checker.",
      type: "content_policy_violation",
      url: "https://docs.fal.ai/errors#content_policy_violation",
    },
  ],
};

let fal: FakeCloud;
let A = "";
beforeAll(async () => {
  fal = await startFakeFal();
  globalThis.__fuobeTestFalUrl = fal.url;
  fal.keys["owner-good"] = "good";
  fal.keys["acct-good"] = "good";
  setSetting("falKey", "owner-good");
  auth.setPassword("install password");
  A = auth.createAccount("failed-job-a@example.com", "long enough").id;
  keys.saveAccountKey(A, "fal", "acct-good");
});
afterAll(async () => {
  fal.script = null;
  globalThis.__fuobeTestFalUrl = undefined;
  await fal.close();
});

/** Every job fails: its status COMPLETED with fal.ai's short error, its result `result`. */
function failingJobs(result: { status: number; body?: unknown }) {
  fal.script = (r) => {
    const path = r.path.split("?")[0];
    if (r.method !== "GET" || !path.includes("/requests/")) return null;
    if (path.endsWith("/status")) return { status: 200, body: { status: "COMPLETED", request_id: "x", logs: [], metrics: {}, error: "Invalid status code: 422" } };
    return result;
  };
}

async function failedRun() {
  const model = getModel("nano-banana-pro")!;
  const route = model.routes.find((r) => r.provider === "fal" && r.op === "t2i")!;
  const sent = await falProvider.submit({ generationId: "g", model, route, input: { prompt: "p" } as never });
  return falProvider.poll({ externalId: sent.externalId, meta: sent.meta!, route, model, createdAt: Date.now() });
}

describe("a job fal.ai finished as failed keeps fal.ai's reason", () => {
  it("the owner's run says what the model refused", async () => {
    failingJobs({ status: 422, body: FLAGGED });
    const r = await failedRun();
    expect(r).toEqual({ state: "failed", error: expect.stringMatching(/^fal 422: body\.prompt: The content could not be processed because it contained material flagged/) });
  });

  it("an account's run reads as a content flag, not as a run fal.ai couldn't finish", async () => {
    failingJobs({ status: 422, body: FLAGGED });
    const r = await runAsTenant({ kind: "account", id: A }, failedRun);
    expect(r.state).toBe("failed");
    const d = diagnoseKey({ stage: "poll", failed: true, text: (r as { error: string }).error }, { provider: "fal" });
    expect(d.cause).toBe("content-flag");
  });

  it("a result that can't be read for a passing reason keeps the status's words, and the poll still ends", async () => {
    failingJobs({ status: 503, body: { detail: "Service unavailable" } });
    const r = await runAsTenant({ kind: "account", id: A }, failedRun);
    expect(r).toEqual({ state: "failed", error: "Invalid status code: 422" });
  });

  it("a voice clone step that failed keeps the model's words in its details", async () => {
    failingJobs({ status: 422, body: FLAGGED });
    const e = (await cloneVoice({ endpoint: "fal-ai/qwen-3-tts/clone-voice/1.7b", audio: "audio_url", output: "speaker_embedding" } as never, "https://v3b.fal.media/files/b/x/v.mp3").catch(
      (x: unknown) => x,
    )) as Error & { said?: string };
    expect(e.said).toMatch(/^fal 422: body\.prompt: The content could not be processed/);
  });
});
