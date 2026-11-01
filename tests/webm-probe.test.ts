import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { probeWebm } from "@/server/webm-probe";

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name));

describe("probeWebm", () => {
  it("reads a WebM's length, size, frame rate and whether it has sound", () => {
    expect(probeWebm(fixture("shorts-sound.webm"))).toMatchObject({ hasAudio: true, hasVideo: true, width: 96, height: 64, channels: 1 });
    const silent = probeWebm(fixture("shorts-silent.webm"))!;
    expect(silent).toMatchObject({ hasAudio: false, hasVideo: true, width: 96, height: 64 });
    expect(silent.duration).toBeCloseTo(6, 1);
  });

  it("isn't fooled by other files", () => {
    expect(probeWebm(fixture("shorts-12s.mp4"))).toBeNull();
    expect(probeWebm(Buffer.from("not a video at all"))).toBeNull();
    expect(probeWebm(Buffer.alloc(0))).toBeNull();
  });

  it("reads a recording whose Segment has an unknown size and no Duration (MediaRecorder)", () => {
    const el = (id: number[], body: Buffer) => Buffer.concat([Buffer.from(id), Buffer.from([0x80 | body.length]), body]);
    const u = (n: number) => Buffer.from([n]);
    const track = (type: number, extra: Buffer = Buffer.alloc(0)) => el([0xae], Buffer.concat([el([0x83], u(type)), extra]));
    const video = el([0xe0], Buffer.concat([el([0xb0], Buffer.from([0x02, 0x80])), el([0xba], Buffer.from([0x01, 0x68]))]));
    const tracks = el([0x16, 0x54, 0xae, 0x6b], Buffer.concat([track(1, video), track(2)]));
    const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], Buffer.from("webm")));
    // Segment with the "unknown size" marker (all ones), then an unknown-size Cluster.
    const segment = Buffer.concat([Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), tracks, Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0xff]), Buffer.alloc(32)]);
    // An audio track without an Audio element: Matroska's default of one channel.
    expect(probeWebm(Buffer.concat([header, segment]))).toEqual({ hasAudio: true, hasVideo: true, width: 640, height: 360, channels: 1 });
  });

  it("says how many channels the first sound track has (Split soundtrack splits a 5.1 file in mono: ComfyUI saves at most stereo)", () => {
    const el = (id: number[], body: Buffer) => Buffer.concat([Buffer.from(id), Buffer.from([0x80 | body.length]), body]);
    const u = (n: number) => Buffer.from([n]);
    const audio = (channels: number) => el([0xae], Buffer.concat([el([0x83], u(2)), el([0xe1], Buffer.concat([el([0xb5], Buffer.from([0x40, 0xe7, 0x70, 0, 0, 0, 0, 0])), el([0x9f], u(channels))]))]));
    const tracks = el([0x16, 0x54, 0xae, 0x6b], Buffer.concat([audio(6), audio(2)]));
    const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], Buffer.from("webm")));
    const segment = Buffer.concat([Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), tracks]);
    expect(probeWebm(Buffer.concat([header, segment]))).toEqual({ hasAudio: true, hasVideo: false, channels: 6 });
  });
});
