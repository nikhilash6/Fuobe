/**
 * The fitting step (src/lib/av/fit-upload.ts) with Mureka's song tools as its rules (src/lib/av/song-fit.ts): a file a
 * tool can't take as it is gets converted to an MP3 in the browser, or a part of it offered, decided from its length; past
 * the caps a phone can read (200 MB, 15 minutes) it is refused in one line and never uploaded. The MP3 encoder
 * (src/lib/av/mp3-encode.ts) runs here for real: its file reads back at the right length and size, and the server's own
 * check (songToolProblem) takes it.
 */
import { describe, expect, it } from "vitest";
import { clock, convertedLine, fitMaxSeconds, fitSourceKind, FIT_SOURCE_MAX_BYTES, mp3Kbps, mp3Name, planAudioFit, secondsAt } from "@/lib/av/fit-upload";
import { encodeMp3 } from "@/lib/av/mp3-encode";
import { murekaSongRule, SONG_FIT_MAX_BYTES } from "@/lib/av/song-fit";
import { songFormat, songToolProblem } from "@/lib/lyrics";
import { probeMedia } from "@/lib/media-probe";

const MB = 1_000_000;
const extend = murekaSongRule("song-extend")!;
const remix = murekaSongRule("song-remix")!;
const stems = murekaSongRule("song-stems")!;

describe("Mureka's rules", () => {
  it("covers Extend, Remix and Stems only", () => {
    expect(murekaSongRule("music")).toBeNull();
    expect(murekaSongRule(undefined)).toBeNull();
    expect(convertedLine(extend)).toBe("Converted to MP3 for Mureka");
  });

  it("keeps an MP3 or M4A the tool takes as it is", () => {
    expect(planAudioFit(extend, { format: "mp3", bytes: 9 * MB, seconds: 400 })).toEqual({ kind: "keep" });
    expect(planAudioFit(extend, { format: "m4a", bytes: 9 * MB })).toEqual({ kind: "keep" });
    // Extend has no length rule: a long MP3 under 10 MB goes as it is.
    expect(planAudioFit(extend, { format: "mp3", bytes: 9 * MB, seconds: 20 * 60 })).toEqual({ kind: "keep" });
    // Remix has no size rule.
    expect(planAudioFit(remix, { format: "mp3", bytes: 14 * MB, seconds: 300 })).toEqual({ kind: "keep" });
  });
});

describe("converting, decided by length", () => {
  it("converts a WAV, a FLAC, a video's sound and an MP3 over 10 MB, at 128 kbit/s or better when it fits", () => {
    expect(planAudioFit(extend, { format: "wav", bytes: 40 * MB, seconds: 4 * 60 })).toEqual({ kind: "convert", kbps: 320 });
    expect(planAudioFit(stems, { format: "flac", bytes: 30 * MB, seconds: 6 * 60 })).toEqual({ kind: "convert", kbps: 192 });
    expect(planAudioFit(remix, { format: "mp4", video: true, bytes: 150 * MB, seconds: 5 * 60 })).toEqual({ kind: "convert", kbps: 256 });
    expect(planAudioFit(extend, { format: "mp3", bytes: 14 * MB, seconds: 10 * 60 })).toEqual({ kind: "convert", kbps: 128 });
  });

  it("goes down to 96 kbit/s, never lower: past that it offers a part", () => {
    expect(planAudioFit(extend, { format: "wav", bytes: 140 * MB, seconds: 12 * 60 })).toEqual({ kind: "convert", kbps: 96 });
    const p = planAudioFit(extend, { format: "wav", bytes: 160 * MB, seconds: 14 * 60 });
    expect(p).toEqual({ kind: "trim", seconds: 14 * 60, max: fitMaxSeconds(extend), line: `This one is 14:00. Extend takes up to ${clock(fitMaxSeconds(extend))}: pick the part to use` });
    expect(mp3Kbps(fitMaxSeconds(extend), SONG_FIT_MAX_BYTES)).toBe(96);
  });

  it("offers Remix the part it takes of a longer song, even an MP3", () => {
    expect(planAudioFit(remix, { format: "mp3", bytes: 9 * MB, seconds: 7 * 60 })).toMatchObject({ kind: "trim", max: 350, line: "This one is 7:00. Remix takes up to 5:50: pick the part to use" });
    // Too short can't be fixed: the tool's own check says so.
    expect(planAudioFit(remix, { format: "mp3", bytes: 1 * MB, seconds: 5 })).toEqual({ kind: "keep" });
  });

  it("never reads a file past the caps, and says the largest it takes", () => {
    expect(planAudioFit(extend, { format: "wav", bytes: 10_000 * MB })).toEqual({ kind: "refuse", line: "The largest file this takes is 200 MB. Use a shorter clip" });
    expect(planAudioFit(remix, { format: "mp4", video: true, bytes: FIT_SOURCE_MAX_BYTES + 1, seconds: 60 })).toMatchObject({ kind: "refuse" });
    expect(planAudioFit(extend, { format: "wav", bytes: 100 * MB, seconds: 40 * 60 })).toEqual({
      kind: "refuse",
      line: "This file is 40:00. A part can be cut here from a file of up to 15:00: use a shorter clip",
    });
    expect(planAudioFit(extend, { format: "wav", bytes: 10 * MB })).toMatchObject({ kind: "refuse", line: expect.stringContaining("couldn't read this file's length") });
  });
});

describe("numbers", () => {
  it("fits about 10 minutes at 128 kbit/s and 13:35 at 96 under 10 MB", () => {
    expect(clock(secondsAt(128, SONG_FIT_MAX_BYTES))).toBe("10:11");
    expect(clock(secondsAt(96, SONG_FIT_MAX_BYTES))).toBe("13:35");
    for (const s of [30, 180, 350, 600, 815]) expect((s * mp3Kbps(s, SONG_FIT_MAX_BYTES)! * 1000) / 8).toBeLessThan(SONG_FIT_MAX_BYTES);
    expect(mp3Kbps(14 * 60, SONG_FIT_MAX_BYTES)).toBeNull();
  });

  it("knows a sound or video file by its type or name", () => {
    expect(fitSourceKind({ type: "audio/flac", name: "a.flac" })).toBe("audio");
    expect(fitSourceKind({ type: "", name: "VID_0001.MOV" })).toBe("video");
    expect(fitSourceKind({ type: "image/png", name: "a.png" })).toBeNull();
    expect(mp3Name("Take 2.wav")).toBe("Take 2.mp3");
    expect(mp3Name("/api/files/up/abc.flac")).toBe("abc.mp3");
  });
});

describe("the MP3 encoder", () => {
  const tone = (seconds: number, rate = 44100) => {
    const n = Math.round(seconds * rate);
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      l[i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / rate);
      r[i] = 0.4 * Math.sin((2 * Math.PI * 660 * i) / rate);
    }
    return [l, r];
  };
  const join = (parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };

  it("makes an MP3 of the right length and size that Mureka's check takes", async () => {
    const seconds = 6;
    let calls = 0;
    const mp3 = join(await encodeMp3(tone(seconds), 44100, 128, () => void calls++));
    expect(calls).toBeGreaterThan(1);
    // An MPEG-1 Layer III frame sync, and the length the server reads from the file.
    expect(mp3[0]).toBe(0xff);
    expect(mp3[1] & 0xfe).toBe(0xfa);
    const info = probeMedia(mp3);
    expect(info?.duration).toBeGreaterThan(seconds - 0.2);
    expect(info?.duration).toBeLessThan(seconds + 0.2);
    expect(mp3.length).toBeGreaterThan(0.9 * ((seconds * 128_000) / 8));
    expect(mp3.length).toBeLessThan(1.1 * ((seconds * 128_000) / 8));
    expect(songToolProblem("song-extend", { format: songFormat("audio/mpeg", "a.mp3"), bytes: mp3.length, seconds: info?.duration }, false)).toBeNull();
  });

  it("encodes one channel too", async () => {
    const mp3 = join(await encodeMp3([tone(2)[0]], 44100, 96));
    expect(probeMedia(mp3)?.duration).toBeGreaterThan(1.8);
  });
});
