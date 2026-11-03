import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { muxWebM, type EncodedFrame } from "@/lib/webm";
import { tempDir } from "./helpers/temp-dir";

/** The WebM writer behind the browser's path render (N7-5): real VP8 frames in, a file ffmpeg reads frame for frame. */

const has = (bin: string) => {
  try {
    execFileSync(bin, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

/** VP8 frames out of an IVF file (32-byte header, then 12-byte frame headers). */
function ivfFrames(buf: Buffer): EncodedFrame[] {
  const frames: EncodedFrame[] = [];
  let at = buf.readUInt16LE(6);
  while (at + 12 <= buf.length) {
    const size = buf.readUInt32LE(at);
    const data = new Uint8Array(buf.subarray(at + 12, at + 12 + size));
    frames.push({ data, key: (data[0] & 1) === 0 });
    at += 12 + size;
  }
  return frames;
}

describe("muxWebM", () => {
  it("writes an EBML header, a webm doc type and one SimpleBlock per frame", () => {
    const frames = Array.from({ length: 5 }, (_, i) => ({ data: new Uint8Array([i, i, i]), key: i === 0 }));
    const out = muxWebM({ codec: "V_VP8", width: 64, height: 32, fps: 16 }, frames);
    expect([...out.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    expect(Buffer.from(out).includes(Buffer.from("webm"))).toBe(true);
    expect(Buffer.from(out).includes(Buffer.from("V_VP8"))).toBe(true);
    // SimpleBlock id 0xA3, size 7 (4-byte block header + 3 bytes), track 1.
    let blocks = 0;
    for (let i = 0; i + 2 < out.length; i++) if (out[i] === 0xa3 && out[i + 1] === 0x87 && out[i + 2] === 0x81) blocks++;
    expect(blocks).toBe(5);
  });

  it.skipIf(!has("ffmpeg") || !has("ffprobe"))("muxes real VP8 frames into a file ffmpeg decodes frame for frame at the given rate", () => {
    const dir = tempDir("fuobe-webm-");
    try {
      const ivf = path.join(dir, "in.ivf");
      execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=96x64:rate=16", "-frames:v", "81", "-c:v", "libvpx", "-g", "30", "-f", "ivf", ivf]);
      const frames = ivfFrames(fs.readFileSync(ivf));
      expect(frames).toHaveLength(81);
      const file = path.join(dir, "out.webm");
      fs.writeFileSync(file, muxWebM({ codec: "V_VP8", width: 96, height: 64, fps: 16 }, frames));
      const probe = JSON.parse(
        execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,nb_read_frames,avg_frame_rate:format=duration", "-of", "json", file]).toString(),
      );
      expect(probe.streams[0]).toMatchObject({ codec_name: "vp8", width: 96, height: 64, nb_read_frames: "81" });
      expect(Number(probe.format.duration)).toBeCloseTo(81 / 16, 1);
      const [n, d] = String(probe.streams[0].avg_frame_rate).split("/").map(Number);
      expect(n / d).toBeCloseTo(16, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
