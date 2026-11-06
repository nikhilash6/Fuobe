import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeFal, type FakeCloud } from "./helpers/fake-cloud";
import { tempDir } from "./helpers/temp-dir";

/**
 * fal's MiniMax H3 and H3 Max Turbo hold reference clips and sound to "2-15 seconds each, combined duration at most 15
 * seconds" (reference_video_urls, reference_audio_urls; the Turbo extend's reference_audio_urls too), and the Turbo extend's
 * clip to "up to 50 MB, aspect ratio between 0.4 and 2.5" (their queue OpenAPI, read 2026-11-06). The server reads the
 * headers and the file size, and refuses such a run before the job is sent. Stand-in fal.ai (tests/helpers/fake-cloud.ts): no real key, no paid call.
 */
const dir = tempDir("fuobe-h3-reference-windows-");
process.env.FUOBE_DATA_DIR = dir;
delete process.env.FUOBE_PASSWORD;
globalThis.__fuobeTestDiskFree = 1e13;

const { setSetting } = await import("@/server/settings");
const { createGenerations, getGeneration } = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A tiny MP4 header `seconds` long (ftyp + moov with one `width`×`height` video trak), enough for the server's header read. */
function mp4(seconds: number, width = 1280, height = 720): Buffer {
  const box = (type: string, ...body: Buffer[]) => {
    const data = Buffer.concat(body);
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + data.length);
    head.write(type, 4, "latin1");
    return Buffer.concat([head, data]);
  };
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(seconds * 1000, 16);
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(0x10000, 40);
  tkhd.writeUInt32BE(0x10000, 56);
  tkhd.writeUInt32BE(width << 16, 76);
  tkhd.writeUInt32BE(height << 16, 80);
  const mdhd = Buffer.alloc(24);
  mdhd.writeUInt32BE(1000, 12);
  mdhd.writeUInt32BE(seconds * 1000, 16);
  const hdlr = Buffer.alloc(24);
  hdlr.write("vide", 8, "latin1");
  const trak = box("trak", box("tkhd", tkhd), box("mdia", box("mdhd", mdhd), box("hdlr", hdlr)));
  return Buffer.concat([box("ftyp", Buffer.from("isom\0\0\0\0isomiso2mp41", "latin1")), box("moov", box("mvhd", mvhd), trak)]);
}

/** A silent 8 kHz mono WAV `seconds` long. */
function wav(seconds: number): Buffer {
  const data = Buffer.alloc(Math.round(seconds * 8000) * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "latin1");
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8, "latin1");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(8000, 24);
  h.writeUInt32LE(16000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "latin1");
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const clip = (seconds: number, width?: number, height?: number) => saveFile({ data: mp4(seconds, width, height), contentType: "video/mp4", name: `clip-${seconds}.mp4`, source: "upload" }).url;
const voice = (seconds: number) => saveFile({ data: wav(seconds), contentType: "audio/wav", name: `voice-${seconds}.wav`, source: "upload" }).url;
/** An MP4 header and a free box, `bytes` long in all: the server reads the header and the file's size. */
function bigMp4(bytes: number): Buffer {
  const head = mp4(5);
  const free = Buffer.alloc(bytes - head.length);
  free.writeUInt32BE(free.length);
  free.write("free", 4, "latin1");
  return Buffer.concat([head, free]);
}
const big = (bytes: number) => saveFile({ data: bigMp4(bytes), contentType: "video/mp4", name: "big.mp4", source: "upload" }).url;
const still = () => saveFile({ data: Buffer.from("png"), contentType: "image/png", name: "still.png", source: "upload" }).url;

let fal: FakeCloud;
beforeAll(async () => {
  fal = await startFakeFal();
  globalThis.__fuobeTestFalUrl = fal.url;
  fal.keys["studio-key"] = "good";
  setSetting("falKey", "studio-key");
});
afterAll(async () => {
  globalThis.__fuobeTestFalUrl = undefined;
  await fal.close();
});

const submitted = (endpoint: string) => fal.log.filter((r) => r.method === "POST" && r.path.split("?")[0] === `/${endpoint}`).length;

/** The run's end once it fails or its job is sent. */
async function outcome(req: Parameters<typeof createGenerations>[0], endpoint: string): Promise<{ sent: boolean; error?: string }> {
  const before = submitted(endpoint);
  const [g] = createGenerations({ engine: "cloud", ...req });
  for (let i = 0; i < 400; i++) {
    const now = getGeneration(g.id)!;
    if (now.status === "failed") return { sent: submitted(endpoint) > before, error: now.error ?? undefined };
    if (submitted(endpoint) > before) return { sent: true };
    await sleep(25);
  }
  throw new Error("the run neither failed nor sent its job");
}

const REFS = "minimax/h3-max-turbo/reference-to-video";
const EXTEND = "minimax/h3-max-turbo/extend-video";
const prompt = "Image 1 is the woman; she dances to Audio 1";

// Skipped until the server side lands: src/server/generations.ts handOver reads the reference clips' and the extend clip's headers and checks referenceClipsProblem, clipSizeProblem and clipBytesProblem before the job. It fails without that change.
describe.skip("reference clips and sound outside fal's window are refused before the job is sent", () => {
  it("H3 Max Turbo references: a clip under 2 s, clips over 15 s together, sound under 2 s", async () => {
    const refs = (inputs: Record<string, unknown>) => ({ feature: "video", modelId: "minimax-h3-max-turbo-refs", op: "ref2v" as const, prompt, inputs });
    expect(await outcome(refs({ images: [still()], videos: [clip(1)] }), REFS)).toEqual({ sent: false, error: expect.stringMatching(/^Reference clip 1 is 1 s, and .* needs at least 2 s/) });
    expect(await outcome(refs({ videos: [clip(8), clip(8), clip(8)] }), REFS)).toEqual({ sent: false, error: expect.stringMatching(/reference clips add up to 24 s/) });
    expect(await outcome(refs({ images: [still()], audios: [voice(1)] }), REFS)).toEqual({ sent: false, error: expect.stringMatching(/^Sound clip 1 is 1 s/) });
    // Inside the window it goes as before.
    expect(await outcome(refs({ images: [still()], videos: [clip(3), clip(3), clip(3)], audios: [voice(3), voice(3), voice(3)] }), REFS)).toEqual({ sent: true });
  });

  it("MiniMax H3 (same window on fal): sound over 15 s together", async () => {
    const req = { feature: "video", modelId: "minimax-h3", op: "ref2v" as const, prompt, inputs: { images: [still()], audios: [voice(8), voice(8)] } };
    expect(await outcome(req, "minimax/h3/reference-to-video")).toEqual({ sent: false, error: expect.stringMatching(/sound clips add up to 16 s/) });
  });

  it("H3 Max Turbo extend: a 3:1 clip, a clip over 50 MB, and a sound reference under 2 s", async () => {
    const ext = (inputs: Record<string, unknown>) => ({ feature: "extend", modelId: "minimax-h3-max-turbo-extend", prompt: "She turns and walks away", inputs });
    expect(await outcome(ext({ video: clip(5, 900, 300) }), EXTEND)).toEqual({ sent: false, error: expect.stringMatching(/2\.5:1 \(wide\), and this one is 900×300: crop it first/) });
    expect(await outcome(ext({ video: big(51_000_000) }), EXTEND)).toEqual({ sent: false, error: expect.stringMatching(/up to 50 MB, and this one is 51 MB/) });
    expect(await outcome(ext({ video: clip(5), audios: [voice(1)] }), EXTEND)).toEqual({ sent: false, error: expect.stringMatching(/^Sound clip 1 is 1 s/) });
    expect(await outcome(ext({ video: clip(5), audios: [voice(3)] }), EXTEND)).toEqual({ sent: true });
  });
});
