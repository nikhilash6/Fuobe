/**
 * Qwen3-TTS's clone step (FieldMap.cloneFirst, src/server/providers/fal.ts cloneVoice) waits on fal.ai's queue for at most
 * its limit. A clone still queued or running then is cancelled on fal.ai (PUT its cancel_url: fal.ai's queue API, "Cancel a
 * request", https://fal.ai/docs/api-reference/inference-api/queue/cancel), not left to run and be billed while the run fails
 * and a retry clones the sample again.
 */
import { afterEach, expect, it, vi } from "vitest";

process.env.FAL_KEY = "test-fal-key";

const Q = "https://queue.fal.run/fal-ai/qwen-3-tts";
const cf = { endpoint: "fal-ai/qwen-3-tts/clone-voice/1.7b", audio: "audio_url", text: "reference_text", output: "speaker_embedding" };

afterEach(() => vi.unstubAllGlobals());

function fakeQueue(status: () => Record<string, unknown>) {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url: String(url), method });
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (method === "POST") return json({ request_id: "r1", status_url: `${Q}/requests/r1/status`, response_url: `${Q}/requests/r1`, cancel_url: `${Q}/requests/r1/cancel` });
    if (method === "PUT") return json({ status: "CANCELLATION_REQUESTED" });
    if (String(url).endsWith("/status")) return json(status());
    return json({ speaker_embedding: { url: "https://v3b.fal.media/files/b/t/clone_out.safetensors" } });
  });
  return calls;
}

it("a clone that runs past its limit is cancelled on fal.ai", async () => {
  const calls = fakeQueue(() => ({ status: "IN_QUEUE", queue_position: 4 }));
  const { cloneVoice } = await import("@/server/providers/fal");
  await expect(cloneVoice(cf, "https://v3b.fal.media/files/b/t/voice.wav", undefined, 700)).rejects.toThrow(/too long/);
  expect(calls.filter((c) => c.method === "PUT").map((c) => c.url)).toEqual([`${Q}/requests/r1/cancel`]);
});

it("a clone that finishes in time is not cancelled, and its file comes back", async () => {
  const calls = fakeQueue(() => ({ status: "COMPLETED" }));
  const { cloneVoice } = await import("@/server/providers/fal");
  await expect(cloneVoice(cf, "https://v3b.fal.media/files/b/t/voice.wav", "What it says.", 5000)).resolves.toBe("https://v3b.fal.media/files/b/t/clone_out.safetensors");
  expect(calls.some((c) => c.method === "PUT")).toBe(false);
});
