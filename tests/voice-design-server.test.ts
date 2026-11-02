import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Design a voice on the server: an Element voice keeps the model, the words and the take's line; fal's
 * Qwen3-TTS routes send the right fields; a sample is cloned in two steps (clone-voice, then text-to-speech with the
 * embedding it returns), and a saved voice keeps that embedding so its next line skips the clone. No paid call is made:
 * fetch is stubbed and nothing reaches fal.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-voice-design-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const { createElement, getElement, updateElement } = await import("@/server/elements");
const { listAssets, saveFile } = await import("@/server/storage");
const { keepVoiceEmbedding, savedVoiceFor } = await import("@/server/voices");
const { runAsTenant } = await import("@/server/tenant");
const { buildPayload } = await import("@/lib/catalog/payload");
const { getModel } = await import("@/lib/catalog");
const { planGeneration } = await import("@/lib/catalog/plan");
const elementsRoute = await import("@/app/api/elements/route");
const { createGenerations, getGeneration } = await import("@/server/generations");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const wav = () => saveFile({ data: Buffer.from("RIFF0000WAVEfmt "), contentType: "audio/wav", name: "take.wav", source: "upload" }).url;
const qwen = getModel("qwen-3-tts")!;
const route = (op: string) => qwen.routes.find((r) => r.op === op)!;

beforeAll(() => {
  setSetting("demoMode", "off");
  setSetting("enhanceProvider", "none");
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("Element voices keep a designed voice", () => {
  it("stores the model, the words and the line; a new clip drops the old clip's embedding", () => {
    const clip = wav();
    const el = createElement({ name: "Old Narrator", kind: "voice", references: [clip], voice: { modelId: "oss-qwen3-tts", engine: "open", description: "A warm older male voice.", transcript: "Hello there." } });
    expect(getElement(el.id)!.voice).toEqual({ modelId: "oss-qwen3-tts", engine: "open", description: "A warm older male voice.", transcript: "Hello there." });
    updateElement(el.id, { voice: { ...el.voice!, embedding: "/api/files/uploads/x.bin" } });
    expect(getElement(el.id)!.voice!.embedding).toBe("/api/files/uploads/x.bin");
    // A rename keeps it; a new recording is a different voice: no embedding and no line of the old take.
    updateElement(el.id, { name: "Narrator" });
    expect(getElement(el.id)!.voice!.embedding).toBe("/api/files/uploads/x.bin");
    updateElement(el.id, { references: [wav()] });
    expect(getElement(el.id)!.voice).toEqual({ modelId: "oss-qwen3-tts", engine: "open", description: "A warm older male voice." });
    // Only voices carry one.
    expect(createElement({ name: "Prop", kind: "prop", references: [], description: "a mug", voice: { modelId: "oss-qwen3-tts", engine: "open" } }).voice).toBeUndefined();
  });

  it("POST /api/elements takes a take from a model that designs voices, never an embedding", async () => {
    const post = (body: unknown) => elementsRoute.POST(new Request("http://localhost/api/elements", { method: "POST", body: JSON.stringify(body) }));
    const clip = wav();
    const ok = await post({ name: "Bright Host", kind: "voice", references: [clip], voice: { modelId: "qwen-3-tts", description: "A bright young voice.", transcript: "Hi!", embedding: "https://evil.example/x" } });
    expect(ok.status).toBe(201);
    const el = (await ok.json()) as { voice: Record<string, unknown> };
    expect(el.voice).toEqual({ modelId: "qwen-3-tts", engine: "cloud", description: "A bright young voice.", transcript: "Hi!" });
    // A model that doesn't design voices, a voice with no take, or a voice on a character is refused.
    expect((await post({ name: "X", kind: "voice", references: [clip], voice: { modelId: "elevenlabs-v4" } })).status).toBe(400);
    expect((await post({ name: "X", kind: "voice", references: [], description: "words", voice: { modelId: "oss-voxcpm2" } })).status).toBe(400);
    expect((await post({ name: "X", kind: "character", references: [clip], voice: { modelId: "oss-voxcpm2" } })).status).toBe(400);
  });
});

describe("Qwen3-TTS on fal: the three routes' payloads", () => {
  it("voice design sends the line as text and the words as prompt, with room for a long line", () => {
    expect(route("voice-design").endpoint).toBe("fal-ai/qwen-3-tts/voice-design/1.7b");
    const p = buildPayload(route("voice-design").map!, { prompt: "Hello there.", voiceDescription: "  A warm, gravelly narrator.  " });
    expect(p).toEqual({ text: "Hello there.", prompt: "A warm, gravelly narrator.", max_new_tokens: 4096 });
  });

  it("text to speech speaks with a premade voice, or with a cloned voice's embedding and what its sample says", () => {
    const tts = route("tts");
    expect(tts.endpoint).toBe("fal-ai/qwen-3-tts/text-to-speech/1.7b");
    expect(buildPayload(tts.map!, { prompt: "Line.", voice: "Serena", language: "English" } as never)).toMatchObject({ text: "Line.", voice: "Serena", max_new_tokens: 4096 });
    const cloned = buildPayload(tts.map!, { prompt: "Line.", voiceAudio: "https://v3.fal.media/files/take.wav", voiceEmbedding: "https://v3.fal.media/files/e.safetensors", voiceTranscript: "Hello there." });
    expect(cloned).toEqual({ text: "Line.", speaker_voice_embedding_file_url: "https://v3.fal.media/files/e.safetensors", reference_text: "Hello there.", max_new_tokens: 4096 });
    // The sample itself is never sent to text to speech: it is cloned first.
    expect(JSON.stringify(cloned)).not.toContain("take.wav");
    expect(tts.map!.cloneFirst).toEqual({ endpoint: "fal-ai/qwen-3-tts/clone-voice/1.7b", audio: "audio_url", text: "reference_text", output: "speaker_embedding" });
  });

  it("is priced per 1,000 characters, and a sample is needed or a premade voice", () => {
    expect(qwen.pricing).toMatchObject({ unit: "request", usd: 0.09 });
    expect(qwen.options.voices?.map((v) => v.id)).toContain("Uncle_Fu");
    expect(() => planGeneration({ feature: "voice-design", modelId: "qwen-3-tts", op: "voice-design", prompt: "Hi" }, getModel, () => undefined)).toThrow(/Describe the voice/);
    expect(planGeneration({ feature: "voice-design", modelId: "qwen-3-tts", op: "voice-design", prompt: "Hi", params: { voiceDescription: "warm", numOutputs: 3 } }, getModel, () => undefined).jobs).toBe(3);
  });
});

/** A stand-in for fal's queue: records what was sent and answers like fal. */
function fakeFal() {
  const sent: { url: string; body?: unknown }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    sent.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/fal-ai/qwen-3-tts/clone-voice/1.7b")) return json({ request_id: "c1", status_url: "https://queue.fal.run/fal-ai/qwen-3-tts/requests/c1/status", response_url: "https://queue.fal.run/fal-ai/qwen-3-tts/requests/c1", cancel_url: "https://queue.fal.run/x" });
    if (url.includes("/requests/c1/status")) return json({ status: "COMPLETED" });
    if (url.endsWith("/requests/c1")) return json({ speaker_embedding: { url: "https://v3.fal.media/files/voice.safetensors" } });
    return json({ request_id: "t1", status_url: "https://queue.fal.run/fal-ai/qwen-3-tts/requests/t1/status", response_url: "https://queue.fal.run/fal-ai/qwen-3-tts/requests/t1", cancel_url: "https://queue.fal.run/y" });
  }) as typeof fetch;
  return { sent, restore: () => void (globalThis.fetch = real) };
}

describe("a clone in two steps on fal", () => {
  it("clones the sample, then speaks with the embedding; the adapter says which embedding it made", async () => {
    setSetting("falKey", "fal_test_key_123456");
    const fal = fakeFal();
    const { falProvider } = await import("@/server/providers/fal");
    try {
      const res = await falProvider.submit({
        generationId: "g1",
        model: qwen,
        route: route("tts"),
        input: { prompt: "A new line.", voiceAudio: "https://v3.fal.media/files/take.wav", voiceTranscript: "Hello there." },
      });
      expect(fal.sent.map((s) => s.url.replace("https://queue.fal.run/", ""))).toEqual([
        "fal-ai/qwen-3-tts/clone-voice/1.7b",
        "fal-ai/qwen-3-tts/requests/c1/status",
        "fal-ai/qwen-3-tts/requests/c1",
        "fal-ai/qwen-3-tts/text-to-speech/1.7b",
      ]);
      expect(fal.sent[0].body).toEqual({ audio_url: "https://v3.fal.media/files/take.wav", reference_text: "Hello there." });
      expect(fal.sent[3].body).toEqual({ text: "A new line.", speaker_voice_embedding_file_url: "https://v3.fal.media/files/voice.safetensors", reference_text: "Hello there.", max_new_tokens: 4096 });
      expect(res.meta?.voiceEmbedding).toBe("https://v3.fal.media/files/voice.safetensors");
      // An embedding already kept: one call, straight to speech.
      fal.sent.length = 0;
      const again = await falProvider.submit({ generationId: "g2", model: qwen, route: route("tts"), input: { prompt: "More.", voiceAudio: "https://v3.fal.media/files/take.wav", voiceEmbedding: "https://v3.fal.media/files/kept.safetensors" } });
      expect(fal.sent.map((s) => s.url)).toEqual(["https://queue.fal.run/fal-ai/qwen-3-tts/text-to-speech/1.7b"]);
      expect(again.meta?.voiceEmbedding).toBeUndefined();
    } finally {
      fal.restore();
    }
  });

  it("a saved voice keeps the embedding fal made, from fal only, and never inside an account's work", async () => {
    const clip = wav();
    const el = createElement({ name: "Kept", kind: "voice", references: [clip], voice: { modelId: "qwen-3-tts", engine: "cloud", transcript: "Hi there." } });
    const file = async () => ({ data: Buffer.from("safetensors-bytes"), contentType: "application/octet-stream", url: "" });
    // Not fal's: nothing is fetched or kept.
    expect(await keepVoiceEmbedding(clip, "https://evil.example/voice.safetensors", file)).toBeNull();
    expect(await keepVoiceEmbedding(clip, "http://v3.fal.media/voice.safetensors", file)).toBeNull();
    // Inside an account's work the owner's voices aren't there at all.
    await runAsTenant({ kind: "account", id: "acct-1" }, async () => {
      expect(savedVoiceFor(clip)).toBeNull();
      expect(await keepVoiceEmbedding(clip, "https://v3.fal.media/files/voice.safetensors", file)).toBeNull();
    });
    const kept = await keepVoiceEmbedding(`${clip}?v=1`, "https://v3.fal.media/files/voice.safetensors", file);
    expect(kept).toMatch(/^\/api\/files\//);
    expect(getElement(el.id)!.voice!.embedding).toBe(kept);
    expect(fs.readFileSync(path.join(dir, "files", kept!.slice("/api/files/".length)), "utf8")).toBe("safetensors-bytes");
    // Kept once: a second clone doesn't replace it.
    expect(await keepVoiceEmbedding(clip, "https://v3.fal.media/files/other.safetensors", file)).toBeNull();
  });

  it("two lines cloning at once keep one embedding and store no spare file; fal's storage bucket is accepted, the rest of the host is not", async () => {
    const clip = wav();
    const el = createElement({ name: "Raced", kind: "voice", references: [clip], voice: { modelId: "qwen-3-tts", engine: "cloud", transcript: "Hi." } });
    const derived = () => listAssets({ source: "derived", limit: 1000 }).length;
    const bytes = async () => ({ data: Buffer.from("emb"), contentType: "application/octet-stream", url: "" });
    // Another bucket on the same host is not fal's.
    expect(await keepVoiceEmbedding(clip, "https://storage.googleapis.com/someone-else/voice.safetensors", bytes)).toBeNull();
    const before = derived();
    // The first download finishes after the second one has kept its file.
    let release!: () => void;
    const slow = (async () => {
      await new Promise<void>((r) => (release = r));
      return bytes();
    }) as typeof bytes;
    const first = keepVoiceEmbedding(clip, "https://storage.googleapis.com/falserverless/files/a.safetensors", slow);
    const second = await keepVoiceEmbedding(clip, "https://v3.fal.media/files/b.safetensors", bytes);
    release();
    expect(await first).toBeNull();
    expect(second).toMatch(/^\/api\/files\//);
    expect(getElement(el.id)!.voice!.embedding).toBe(second);
    expect(derived()).toBe(before + 1);
    // On its own, fal's bucket is kept like its CDN.
    const other = createElement({ name: "Bucket", kind: "voice", references: [wav()], voice: { modelId: "qwen-3-tts", engine: "cloud" } });
    expect(await keepVoiceEmbedding(other.references[0], "https://storage.googleapis.com/falserverless/files/c.safetensors", bytes)).toMatch(/^\/api\/files\//);
  });

  it("a run with a saved voice sends its kept embedding and its line, and makes no clone", async () => {
    setSetting("falKey", "fal_test_key_123456");
    const clip = wav();
    const emb = saveFile({ data: Buffer.from("emb"), contentType: "application/octet-stream", name: "e.safetensors", source: "derived" }).url;
    createElement({ name: "Ready", kind: "voice", references: [clip], voice: { modelId: "qwen-3-tts", engine: "cloud", transcript: "The take's line.", embedding: emb } });
    const fal = fakeFal();
    const { falProvider } = await import("@/server/providers/fal");
    const upload = falProvider.prepareFile;
    falProvider.prepareFile = async (_d, _t, name) => `https://v3.fal.media/files/${name}`;
    try {
      const [g] = createGenerations({ feature: "audio", modelId: "qwen-3-tts", engine: "cloud", op: "tts", prompt: "Say this.", inputs: { voiceAudio: clip } });
      const spoke = () => fal.sent.some((s) => s.url.endsWith("/text-to-speech/1.7b"));
      for (let i = 0; i < 200 && !spoke() && getGeneration(g.id)!.status !== "failed"; i++) await sleep(25);
      expect(getGeneration(g.id)!.error).toBeNull();
      const calls = fal.sent.filter((s) => s.url.startsWith("https://queue.fal.run/fal-ai/qwen-3-tts/"));
      expect(calls.map((s) => s.url)).toEqual(["https://queue.fal.run/fal-ai/qwen-3-tts/text-to-speech/1.7b"]);
      expect(calls[0].body).toMatchObject({ text: "Say this.", speaker_voice_embedding_file_url: expect.stringMatching(/^https:\/\/v3\.fal\.media\/files\//), reference_text: "The take's line." });
    } finally {
      falProvider.prepareFile = upload;
      fal.restore();
    }
  });
});
