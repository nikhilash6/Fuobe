import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Kling 4.0's clip limits on the server (nm10-kling-4): an edit keeps the clip's own length, so the clip is held to the
 * edit's sides and shape even when the request named a length, and a clip element outside 3–8 s is refused, both
 * before anything goes to fal. No paid call is made: fetch is stubbed and nothing reaches fal.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-kling-4-server-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

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
const clip = (seconds: number, width?: number, height?: number) =>
  saveFile({ data: mp4(seconds, width, height), contentType: "video/mp4", name: `clip-${seconds}-${width ?? 1280}.mp4`, source: "upload" }).url;

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("Kling 4.0's clip limits before fal is asked", () => {
  it("refuses an edit's too-wide clip although the request named a length, and a clip element over 8 s", async () => {
    setSetting("falKey", "fal_test_key_123456");
    const real = globalThis.fetch;
    const asked: string[] = [];
    globalThis.fetch = (async (url: string) => {
      asked.push(String(url));
      return new Response(JSON.stringify({ request_id: "r1", status_url: "https://queue.fal.test/s", response_url: "https://queue.fal.test/r", cancel_url: "https://queue.fal.test/c" }), { status: 200 });
    }) as typeof fetch;
    const { falProvider: fal } = await import("@/server/providers/fal");
    const upload = fal.prepareFile;
    fal.prepareFile = async (_d, _t, name) => `https://v3.fal.media/files/${name}`;
    const failed = async (id: string) => {
      for (let i = 0; i < 200 && getGeneration(id)!.status !== "failed"; i++) await sleep(25);
      return getGeneration(id)!;
    };
    try {
      // 3000×700 is 4.3:1, past the edit's 2.5:1; the duration the composer sends doesn't skip the check.
      const [wide] = createGenerations({
        feature: "video-edit",
        modelId: "kling-4",
        engine: "cloud",
        op: "v2v",
        prompt: "make it snow",
        inputs: { video: clip(8, 3000, 700) },
        params: { duration: 5, resolution: "720p" },
      });
      expect(await failed(wide.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/2\.5:1 \(wide\), and this one is 3000×700: crop it first/) });
      // A 10 s clip as an element: Kling takes 3–8 s ones.
      const [element] = createGenerations({
        feature: "video",
        modelId: "kling-4",
        engine: "cloud",
        op: "ref2v",
        prompt: "@Element1 walks in",
        inputs: { videos: [clip(10)] },
        params: { duration: 5, resolution: "720p", elements: [{ video: 0 }] },
      });
      expect(await failed(element.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/3–8 s clips as elements, and this one is 10 s/) });
      expect(asked.filter((u) => u.includes("kling/v4"))).toEqual([]);
    } finally {
      globalThis.fetch = real;
      fal.prepareFile = upload;
      setSetting("falKey", "");
    }
  });
});
