import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cutMp4, keyframeAtOrBefore, readMp4Index, type CutPart } from "@/lib/av/mp4-cut";
import { probeMedia } from "@/lib/media-probe";
import { tempDir } from "./helpers/temp-dir";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const dir = tempDir("fuobe-mp4-cut-");

const reader = (buf: Uint8Array) => async (a: number, b: number) => buf.subarray(a, b);
const join = (src: Uint8Array, parts: CutPart[]) => Buffer.concat(parts.map((p) => (p instanceof Uint8Array ? p : src.subarray(p.start, p.end))));
const probe = (file: string) =>
  JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,duration,nb_frames", "-of", "json", file]).toString()) as {
    format: { duration: string };
    streams: { codec_type: string; duration?: string; nb_frames?: string }[];
  };

function clip(name: string, args: string[]): string {
  const out = path.join(dir, name);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=24", "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000", "-t", "6", ...args, out]);
  return out;
}

describe("mp4 cut: what it refuses", () => {
  it("gives null for a file that isn't a plain MP4 or MOV", async () => {
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0x1f, 0x42, 0x86, 0x81, 0x01]);
    expect(await readMp4Index(reader(webm), webm.length)).toBeNull();
    const junk = new Uint8Array(64).fill(7);
    expect(await readMp4Index(reader(junk), junk.length)).toBeNull();
  });

  it("starts a part on the key frame at or before the time asked", () => {
    const index = { keyframes: [0, 0.5, 1, 1.5, 2] };
    expect(keyframeAtOrBefore(index, 1.3)).toBe(1);
    expect(keyframeAtOrBefore(index, 1.5)).toBe(1.5);
    expect(keyframeAtOrBefore(index, 9)).toBe(2);
    expect(keyframeAtOrBefore(index, 0)).toBe(0);
  });
});

describe.skipIf(!hasFfmpeg)("mp4 cut: real clips", () => {
  const cases = [
    { name: "h264-aac.mp4", args: ["-c:v", "libx264", "-g", "12", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k"] },
    { name: "h264-aac-faststart.mp4", args: ["-c:v", "libx264", "-g", "12", "-bf", "0", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart"] },
    { name: "h264-aac.mov", args: ["-c:v", "libx264", "-g", "12", "-pix_fmt", "yuv420p", "-c:a", "aac"] },
  ];
  for (const c of cases) {
    it(`cuts ${c.name} from a key frame, keeping both tracks and their length`, async () => {
      const file = clip(c.name, c.args);
      const src = new Uint8Array(fs.readFileSync(file));
      const index = await readMp4Index(reader(src), src.length);
      expect(index).not.toBeNull();
      expect(index!.hasVideo && index!.hasAudio).toBe(true);
      expect(index!.seconds).toBeCloseTo(6, 0);
      expect(index!.keyframes.slice(0, 3)).toEqual([0, 0.5, 1]);

      const cut = cutMp4(index!, 2.3, 2)!;
      expect(cut.from).toBe(2);
      expect(cut.seconds).toBe(2);
      const out = path.join(dir, `cut-${c.name}`);
      const bytes = join(src, cut.parts);
      expect(bytes.length).toBe(cut.bytes);
      fs.writeFileSync(out, bytes);
      // Decodes without an error, and is the part asked for.
      const decode = spawnSync("ffmpeg", ["-v", "error", "-i", out, "-f", "null", "-"]);
      expect(decode.stderr.toString()).toBe("");
      const p = probe(out);
      expect(Number(p.format.duration)).toBeGreaterThan(1.9);
      expect(Number(p.format.duration)).toBeLessThan(2.15);
      const video = p.streams.find((s) => s.codec_type === "video")!;
      const audio = p.streams.find((s) => s.codec_type === "audio")!;
      expect(Number(video.nb_frames)).toBe(48);
      expect(Number(audio.duration)).toBeGreaterThan(1.9);
      // Our own reader agrees, and the first frame is the source's frame at 2 s (testsrc draws its clock).
      expect(probeMedia(new Uint8Array(bytes))?.duration).toBeGreaterThan(1.9);
      const frameAt = (f: string, ss?: string) =>
        execFileSync("ffmpeg", ["-v", "error", ...(ss ? ["-ss", ss] : []), "-i", f, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
      const a = frameAt(out);
      const b = frameAt(file, "2");
      let diff = 0;
      for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
      expect(diff / a.length).toBeLessThan(2);
    });
  }

  it("keeps a part at the end of the clip to what is left", async () => {
    const file = clip("end.mp4", ["-c:v", "libx264", "-g", "12", "-pix_fmt", "yuv420p", "-c:a", "aac"]);
    const src = new Uint8Array(fs.readFileSync(file));
    const index = (await readMp4Index(reader(src), src.length))!;
    const cut = cutMp4(index, 5, 4)!;
    expect(cut.from).toBe(5);
    expect(cut.seconds).toBeCloseTo(1, 1);
    const out = path.join(dir, "cut-end.mp4");
    fs.writeFileSync(out, join(src, cut.parts));
    expect(spawnSync("ffmpeg", ["-v", "error", "-i", out, "-f", "null", "-"]).stderr.toString()).toBe("");
  });

  it("gives null for a fragmented MP4", async () => {
    const file = clip("frag.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "frag_keyframe+empty_moov"]);
    const src = new Uint8Array(fs.readFileSync(file));
    expect(await readMp4Index(reader(src), src.length)).toBeNull();
  });
});
