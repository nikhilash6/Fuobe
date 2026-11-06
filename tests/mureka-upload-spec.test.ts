/**
 * Mureka's song tools against the stand-in fal.ai, as the official docs say they behave:
 * - Mureka's files/upload takes an MP3 or M4A ("audio": also 10 MB at most) for a song Extend or Remix didn't make
 *   (platform.mureka.ai, POST /v1/files/upload): any other is refused before anything is sent or paid for, and one of Mureka's
 *   own songs goes by its id whatever its file is.
 * - fal.ai never retries a synchronous run (fal.run), and marks a temporary failure with X-Fal-Needs-Retry: 1 (its sync API
 *   reference): the upload is sent again, twice at most; one marked 0 is not.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeFal, type FakeCloud } from "./helpers/fake-cloud";
import { tempDir } from "./helpers/temp-dir";

process.env.FUOBE_DATA_DIR = tempDir("fuobe-mureka-upload-");
process.env.COMFYUI_URL = "http://127.0.0.1:9";
delete process.env.FUOBE_PASSWORD;
globalThis.__fuobeTestDiskFree = 1e13;

const { setSetting } = await import("@/server/settings");
const { createGenerations, getGeneration } = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");

/** A WAV of `seconds` at 8 kHz mono 8-bit, silent. */
const wav = (seconds: number) => {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + seconds * 8000, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(8000, 24);
  h.writeUInt32LE(8000, 28);
  h.writeUInt16LE(1, 32);
  h.writeUInt16LE(8, 34);
  h.write("data", 36);
  h.writeUInt32LE(seconds * 8000, 40);
  return Buffer.concat([h, Buffer.alloc(seconds * 8000, 128)]);
};
/** An MP3 frame header repeated: 128 kbps, 44.1 kHz (418 bytes a frame, 26 ms). */
const mp3 = (seconds: number) => {
  const frame = Buffer.alloc(418);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  return Buffer.concat(Array.from({ length: Math.ceil(seconds / 0.026122) }, () => frame));
};
const file = (name: string, contentType: string, data: Buffer) => saveFile({ name, contentType, source: "upload", data }).url;

let fal: FakeCloud;
beforeAll(async () => {
  fal = await startFakeFal();
  globalThis.__fuobeTestFalUrl = fal.url;
  fal.keys["owner-fal"] = "good";
  setSetting("falKey", "owner-fal");
});
afterAll(async () => {
  globalThis.__fuobeTestFalUrl = undefined;
  await fal.close();
});

const uploads = () => fal.log.filter((r) => r.method === "POST" && r.path.split("?")[0] === "/mureka/api/files/upload");
const submits = (ep: string) => fal.log.filter((r) => r.method === "POST" && r.path.split("?")[0] === `/${ep}`);
async function run(modelId: string, audio: string, extra: Record<string, unknown>, prompt = "") {
  const [g] = createGenerations({ feature: "song-tools", modelId, engine: "cloud", prompt, inputs: { audio }, params: { extra } } as never);
  for (let i = 0; i < 600 && !["failed", "succeeded"].includes(getGeneration(g.id)!.status); i++) {
    await globalThis.__fuobeRunner?.tick();
    await new Promise((r) => setTimeout(r, 20));
  }
  return getGeneration(g.id)!;
}

// Skipped until the server side lands: src/lib/lyrics.ts songToolProblem, src/server/generations.ts prepSong and src/server/providers/fal.ts uploadSong (retry on X-Fal-Needs-Retry). It fails without that change.
describe.skip("a song Mureka's files/upload takes", () => {
  it("refuses a WAV for Extend and Remix before anything reaches fal.ai, and sends one of Mureka's own by its id", async () => {
    fal.log.length = 0;
    fal.script = null;
    const extend = await run("mureka-extend", file("bed.wav", "audio/wav", wav(30)), { lyrics: "[Verse]\nmore" });
    expect(extend.status).toBe("failed");
    expect(extend.error).toBe("Extend takes an MP3 or M4A song: this one is a WAV file. Save it as an MP3 and add it again");
    const remix = await run("mureka-remix", file("song.wav", "audio/wav", wav(30)), { lyrics: "[Verse]\nla" }, "jazz trio");
    expect(remix.error).toBe("Remix takes an MP3 or M4A song: this one is a WAV file. Save it as an MP3 and add it again");
    expect(uploads()).toEqual([]);
    expect(fal.log.filter((r) => r.method === "POST" && !r.path.startsWith("/storage/") && !r.path.startsWith("/upload/"))).toEqual([]);
    // One of Mureka's own (its id): no upload, whatever the file is.
    const own = await run("mureka-extend", file("own.wav", "audio/wav", wav(30)), { lyrics: "[Verse]\nmore", songId: "song_1" });
    expect(own.status).toBe("succeeded");
    expect(uploads()).toEqual([]);
    expect(JSON.parse(submits("mureka/v8/song/extend")[0].body)).toMatchObject({ song_id: "song_1", extend_at: 30000 });
  });
});

describe.skip("fal.ai's synchronous upload", () => {
  it("is sent again when fal.ai marks the failure temporary (X-Fal-Needs-Retry: 1), and not when it doesn't", async () => {
    fal.log.length = 0;
    let first = true;
    fal.script = (r) => {
      if (r.path.split("?")[0] !== "/mureka/api/files/upload") return null;
      if (first) {
        first = false;
        return { status: 503, body: { detail: "Could not connect to runner", error_type: "runner_connection_error" }, headers: { "X-Fal-Needs-Retry": "1" } };
      }
      return { status: 200, body: { id: "upload_9", purpose: "audio" } };
    };
    const ok = await run("mureka-extend", file("song.mp3", "audio/mpeg", mp3(20)), { lyrics: "[Verse]\nmore" });
    expect(ok.status).toBe("succeeded");
    expect(uploads()).toHaveLength(2);
    expect(JSON.parse(submits("mureka/v8/song/extend")[0].body)).toMatchObject({ upload_audio_id: "upload_9" });

    fal.log.length = 0;
    fal.script = (r) =>
      r.path.split("?")[0] === "/mureka/api/files/upload"
        ? { status: 422, body: { detail: [{ loc: ["body", "file_url"], msg: "Unsupported audio format", type: "value_error" }] }, headers: { "X-Fal-Needs-Retry": "0" } }
        : null;
    const refused = await run("mureka-extend", file("song2.mp3", "audio/mpeg", mp3(20)), { lyrics: "[Verse]\nmore" });
    expect(refused.status).toBe("failed");
    expect(refused.error).toMatch(/Unsupported audio format/);
    expect(uploads()).toHaveLength(1);
    fal.script = null;
  });
});
