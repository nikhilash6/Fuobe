import { describe, expect, it } from "vitest";
import { muxWebm, WEBM_IDS as I, type WebmFrame } from "@/components/model3d/webm";

// The browser turntable recorder's WebM writer (src/components/model3d/webm.ts), read back with a small EBML reader.

type Node = { id: number; start: number; size: number; data: Uint8Array; children?: Node[] };
const MASTERS = new Set<number>([I.EBML, I.Segment, I.Info, I.Tracks, I.TrackEntry, I.Video, I.Cues, I.CuePoint, I.CueTrackPositions, I.Cluster]);

function vint(b: Uint8Array, at: number, keepMarker: boolean): { value: number; len: number } {
  let len = 1;
  while (len <= 8 && !(b[at] & (0x80 >> (len - 1)))) len++;
  let value = keepMarker ? b[at] : b[at] & (0xff >> len);
  for (let i = 1; i < len; i++) value = value * 256 + b[at + i];
  return { value, len };
}

function parse(b: Uint8Array, from = 0, to = b.length, base = from): Node[] {
  const out: Node[] = [];
  let at = from;
  while (at < to) {
    const id = vint(b, at, true);
    const size = vint(b, at + id.len, false);
    const dataAt = at + id.len + size.len;
    const node: Node = { id: id.value, start: at - base, size: size.value, data: b.subarray(dataAt, dataAt + size.value) };
    if (MASTERS.has(id.value)) node.children = parse(b, dataAt, dataAt + size.value, id.value === I.Segment ? dataAt : base);
    out.push(node);
    at = dataAt + size.value;
  }
  return out;
}

const find = (nodes: Node[], id: number) => nodes.filter((n) => n.id === id);
const one = (nodes: Node[], id: number) => {
  const found = find(nodes, id);
  expect(found, id.toString(16)).toHaveLength(1);
  return found[0];
};
const uint = (n: Node) => n.data.reduce((v, x) => v * 256 + x, 0);
const text = (n: Node) => String.fromCharCode(...n.data);

describe("muxWebm", () => {
  const fps = 24;
  // 96 frames at fixed timestamps, a key frame every second, payloads of varying size.
  const frames: WebmFrame[] = Array.from({ length: 96 }, (_, i) => ({ timestamp: Math.round((i * 1e6) / fps), key: i % fps === 0, data: new Uint8Array(10 + (i % 7) * 50).fill(i) }));

  it("writes a WebM with the duration, the track, cues and every frame at its own time", async () => {
    const blob = muxWebm({ codec: "V_VP9", width: 1024, height: 768, fps, frames });
    expect(blob.type).toBe("video/webm");
    const b = new Uint8Array(await blob.arrayBuffer());
    const [ebml, segment, ...rest] = parse(b);
    expect(rest).toEqual([]);
    expect(ebml.id).toBe(I.EBML);
    expect(text(one(ebml.children!, 0x4282))).toBe("webm");
    expect(segment.id).toBe(I.Segment);
    const seg = segment.children!;
    // Info: 1 ms timestamps, 96 frames at 24 fps = 4000 ms.
    const info = one(seg, I.Info).children!;
    expect(uint(one(info, I.TimestampScale))).toBe(1_000_000);
    const duration = one(info, I.Duration);
    expect(new DataView(duration.data.buffer, duration.data.byteOffset, 8).getFloat64(0)).toBeCloseTo(4000, 0);
    // The track.
    const track = one(one(seg, I.Tracks).children!, I.TrackEntry).children!;
    expect(text(one(track, I.CodecID))).toBe("V_VP9");
    const video = one(track, I.Video).children!;
    expect([uint(one(video, I.PixelWidth)), uint(one(video, I.PixelHeight))]).toEqual([1024, 768]);
    // One cluster per key frame (4), each with its 24 frames; cues point at the clusters.
    const clusters = find(seg, I.Cluster);
    expect(clusters).toHaveLength(4);
    const cues = find(one(seg, I.Cues).children!, I.CuePoint);
    expect(cues.map((c) => uint(one(c.children!, I.CueTime)))).toEqual(clusters.map((c) => uint(one(c.children!, I.Timestamp))));
    expect(cues.map((c) => uint(one(one(c.children!, I.CueTrackPositions).children!, I.CueClusterPosition)))).toEqual(clusters.map((c) => c.start));
    const blocks = clusters.flatMap((c) => {
      const t0 = uint(one(c.children!, I.Timestamp));
      return find(c.children!, I.SimpleBlock).map((s) => ({
        track: s.data[0],
        time: t0 + new DataView(s.data.buffer, s.data.byteOffset + 1, 2).getInt16(0),
        key: !!(s.data[3] & 0x80),
        payload: s.data.subarray(4),
      }));
    });
    expect(blocks).toHaveLength(96);
    blocks.forEach((blk, i) => {
      expect(blk.track).toBe(0x81);
      expect(blk.time).toBe(Math.round((i * 1000) / fps));
      expect(blk.key).toBe(i % fps === 0);
      expect(blk.payload).toEqual(frames[i].data);
    });
  });

  it("needs frames that start with a key frame", () => {
    expect(() => muxWebm({ codec: "V_VP8", width: 2, height: 2, fps, frames: [] })).toThrow();
    expect(() => muxWebm({ codec: "V_VP8", width: 2, height: 2, fps, frames: [{ ...frames[1] }] })).toThrow();
  });
});
