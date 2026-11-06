import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/**
 * Replicate's Files API takes files under 100 MB: https://replicate.com/docs/topics/predictions/input-files ("This will
 * work for files up to 100MB") and https://api.replicate.com/openapi.json (POST /v1/files answers 413
 * application/problem+json "Files must be less than 100MB in size"). Scribe v2 itself takes recordings up to 3 GB and 10
 * hours (https://replicate.com/elevenlabs/scribe-v2/api), and Fuobe takes uploads up to 200 MB, so a 10-minute stereo WAV
 * (105.8 MB) or a long clip has to reach Replicate some other way. No key, no network: fetch is answered here.
 */
process.env.FUOBE_DATA_DIR = tempDir("fuobe-rep-file-limit-");

const { replicateProvider } = await import("@/server/providers/replicate");
const { getModel } = await import("@/lib/catalog");
const { routesFor } = await import("@/lib/catalog/plan");

const hasFfmpeg = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"]).status === 0;

type Sent = { url: string; form?: { name: string; type: string; size: number } };
async function stubbed<T>(fn: () => Promise<T>) {
  const real = globalThis.fetch;
  const sent: Sent[] = [];
  globalThis.fetch = (async (u: string, init: RequestInit = {}) => {
    const content = init.body instanceof FormData ? (init.body.get("content") as File) : undefined;
    sent.push({ url: String(u), ...(content && { form: { name: content.name, type: content.type, size: content.size } }) });
    if (content && content.size >= 100_000_000)
      return new Response(JSON.stringify({ detail: "Files must be less than 100MB in size" }), { status: 413, headers: { "content-type": "application/problem+json" } });
    return new Response(JSON.stringify({ id: "f1", urls: { get: "https://api.replicate.com/v1/files/f1" } }), { status: 201 });
  }) as typeof fetch;
  try {
    const result = await fn().then(
      (v) => ({ ok: true as const, v }),
      (e: Error) => ({ ok: false as const, e }),
    );
    return { result, sent };
  } finally {
    globalThis.fetch = real;
  }
}

/** A silent 16-bit PCM WAV: `seconds` long, stereo at 44.1 kHz. */
function silentWav(seconds: number): Buffer {
  const bytes = seconds * 44_100 * 2 * 2;
  const b = Buffer.alloc(44 + bytes);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + bytes, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(44_100, 24);
  b.writeUInt32LE(44_100 * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(bytes, 40);
  return b;
}

const route = (id: string, op: string) => routesFor(getModel(id)!, op as never).find((r) => r.provider === "replicate")!;

describe("Replicate's Files API limit (100 MB)", () => {
  it("never uploads a file of 100 MB or more, and says why in plain words", async () => {
    const { result, sent } = await stubbed(() => replicateProvider.prepareFile!(Buffer.alloc(100_000_000, 1), "image/png", "big.png", route("lyria-3", "music")));
    expect(sent).toEqual([]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.e.message).toMatch(/under 100 MB/);
  });

  it("still sends a file just under 100 MB through the Files API", async () => {
    const { result, sent } = await stubbed(() => replicateProvider.prepareFile!(Buffer.alloc(99_000_000, 1), "video/mp4", "clip.mp4", route("scribe-v2", "transcribe")));
    expect(result).toEqual({ ok: true, v: "https://api.replicate.com/v1/files/f1" });
    expect(sent.map((s) => s.form)).toEqual([{ name: "clip.mp4", type: "video/mp4", size: 99_000_000 }]);
  });

  it.skipIf(!hasFfmpeg)("sends a transcript's 10-minute WAV (105.8 MB) as a small speech copy", async () => {
    const wav = silentWav(600);
    expect(wav.length).toBeGreaterThanOrEqual(100_000_000);
    const { result, sent } = await stubbed(() => replicateProvider.prepareFile!(wav, "audio/wav", "talk.wav", route("scribe-v2", "transcribe")));
    expect(result).toEqual({ ok: true, v: "https://api.replicate.com/v1/files/f1" });
    expect(sent).toHaveLength(1);
    expect(sent[0].form).toMatchObject({ name: "talk.ogg", type: "audio/ogg" });
    expect(sent[0].form!.size).toBeLessThan(5_000_000);
  }, 120_000);
});
