import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { muxMp4 } from "@/lib/mp4";

/** The browser's MP4 writer (Blockout to film's grey-box render for the cloud): its boxes, and a real decoder reading it. */

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

/** Boxes at the top level, or inside one: [type, start, size]. */
function boxes(b: Uint8Array, from = 0, to = b.length): [string, number, number][] {
  const out: [string, number, number][] = [];
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let at = from; at + 8 <= to; ) {
    const size = v.getUint32(at);
    out.push([new TextDecoder().decode(b.subarray(at + 4, at + 8)), at, size]);
    if (size < 8) break;
    at += size;
  }
  return out;
}
function find(b: Uint8Array, pathTypes: string[]): [number, number] {
  let from = 0;
  let to = b.length;
  for (const t of pathTypes) {
    const hit = boxes(b, from, to).find(([x]) => x === t);
    if (!hit) throw new Error(`no ${t}`);
    from = hit[1] + 8;
    to = hit[1] + hit[2];
  }
  return [from, to];
}

describe("muxMp4", () => {
  const frames = [
    { data: Uint8Array.from([0, 0, 0, 2, 0x65, 1]), key: true },
    { data: Uint8Array.from([0, 0, 0, 3, 0x41, 2, 3]), key: false },
    { data: Uint8Array.from([0, 0, 0, 2, 0x41, 4]), key: false },
  ];
  const avcC = Uint8Array.from([1, 0x42, 0, 0x1f, 0xff, 0xe0, 0]);

  it("writes ftyp, moov, then mdat, with the sample table pointing at each frame", () => {
    const out = muxMp4({ width: 64, height: 48, fps: 24, avcC }, frames);
    expect(boxes(out).map(([t]) => t)).toEqual(["ftyp", "moov", "mdat"]);
    const v = new DataView(out.buffer);
    const [stco] = find(out, ["moov", "trak", "mdia", "minf", "stbl", "stco"]);
    const offset = v.getUint32(stco + 8);
    expect([...out.subarray(offset, offset + 6)]).toEqual([...frames[0].data]);
    const [stsz] = find(out, ["moov", "trak", "mdia", "minf", "stbl", "stsz"]);
    expect([v.getUint32(stsz + 8), v.getUint32(stsz + 12), v.getUint32(stsz + 16)]).toEqual([3, 6, 7]);
    const [stts] = find(out, ["moov", "trak", "mdia", "minf", "stbl", "stts"]);
    expect([v.getUint32(stts + 4), v.getUint32(stts + 8), v.getUint32(stts + 12)]).toEqual([1, 3, 3750]);
    const [stss] = find(out, ["moov", "trak", "mdia", "minf", "stbl", "stss"]);
    expect([v.getUint32(stss + 4), v.getUint32(stss + 8)]).toEqual([1, 1]);
    const [avc1] = find(out, ["moov", "trak", "mdia", "minf", "stbl", "stsd"]);
    expect(boxes(out, avc1 + 8)[0][0]).toBe("avc1");
  });

  it("refuses an empty list and a first frame that isn't a keyframe", () => {
    expect(() => muxMp4({ width: 64, height: 48, fps: 24, avcC }, [])).toThrow(/No frames/);
    expect(() => muxMp4({ width: 64, height: 48, fps: 24, avcC }, frames.slice(1))).toThrow(/keyframe/);
  });

  it.skipIf(!hasFfmpeg)("makes a file ffmpeg decodes frame for frame", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-mp4-"));
    try {
      const raw = path.join(dir, "in.h264");
      execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=64x48:rate=24", "-frames:v", "30", "-c:v", "libx264", "-bf", "0", "-g", "24", "-pix_fmt", "yuv420p", "-x264-params", "aud=1", "-f", "h264", raw]);
      const bytes = new Uint8Array(fs.readFileSync(raw));
      // Annex B → NAL units (3- or 4-byte start codes).
      const nals: Uint8Array[] = [];
      let start = -1;
      for (let i = 0; i + 3 <= bytes.length; i++) {
        if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
          if (start >= 0) nals.push(bytes.subarray(start, i > 0 && bytes[i - 1] === 0 ? i - 1 : i));
          start = i + 3;
          i += 2;
        }
      }
      nals.push(bytes.subarray(start));
      const sps = nals.find((n) => (n[0] & 31) === 7)!;
      const pps = nals.find((n) => (n[0] & 31) === 8)!;
      const avc = Uint8Array.from([1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 255, ...sps, 1, pps.length >> 8, pps.length & 255, ...pps]);
      // Access units start at each delimiter (type 9); a frame is its NAL units, length-prefixed.
      const units: Uint8Array[][] = [];
      for (const n of nals) {
        const type = n[0] & 31;
        if (type === 9) units.push([]);
        else if (type !== 7 && type !== 8) units[units.length - 1].push(n);
      }
      const frames = units.map((u) => {
        const parts = u.flatMap((n) => [Uint8Array.from([n.length >>> 24, (n.length >> 16) & 255, (n.length >> 8) & 255, n.length & 255]), n]);
        const data = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
        let at = 0;
        for (const p of parts) {
          data.set(p, at);
          at += p.length;
        }
        return { data, key: u.some((n) => (n[0] & 31) === 5) };
      });
      expect(frames).toHaveLength(30);
      const file = path.join(dir, "out.mp4");
      fs.writeFileSync(file, muxMp4({ width: 64, height: 48, fps: 24, avcC: avc }, frames));
      const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,nb_read_frames,r_frame_rate", "-of", "json", file]).toString());
      expect(probe.streams[0]).toMatchObject({ codec_name: "h264", width: 64, height: 48, nb_read_frames: "30", r_frame_rate: "24/1" });
      const decode = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"]);
      expect(decode.status).toBe(0);
      expect(decode.stderr.toString()).toBe("");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
