import { afterEach, describe, expect, it, vi } from "vitest";
import { probeBlob, probeMedia, probeMediaRanges, probeMediaRangesSync, probeUrl } from "@/lib/media-probe";

const u32 = (...v: number[]) =>
  Buffer.concat(
    v.map((n) => {
      const b = Buffer.alloc(4);
      b.writeUInt32BE(n >>> 0);
      return b;
    }),
  );
const box = (type: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length);
  head.write(type, 4);
  return Buffer.concat([head, body]);
};

/** ISO-BMFF with a video trak (optionally rotated 90°) and an optional sound trak; moov after mdat like a camera file. */
function mp4({ w = 1920, h = 1080, rotate = false, audio = true, frames = 300, fps = 30 } = {}): Buffer {
  const scale = 600;
  const dur = Math.round((frames / fps) * scale);
  const mvhd = box("mvhd", u32(0, 0, 0, scale, dur + (audio ? 12 : 0)), Buffer.alloc(80));
  const matrix = rotate ? u32(0, 0x10000, 0, 0xffff0000, 0, 0, 0, 0, 0x40000000) : u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);
  const tkhd = box("tkhd", u32(0, 0, 0, 1, 0, dur), Buffer.alloc(16), matrix, u32(w << 16, h << 16));
  const video = box(
    "trak",
    tkhd,
    box("mdia", box("mdhd", u32(0, 0, 0, fps * 1000, frames * 1000), Buffer.alloc(4)), box("hdlr", u32(0, 0), Buffer.from("vide"), Buffer.alloc(12)), box("minf", box("stbl", box("stts", u32(0, 2, frames - 1, 1000, 1, 1000))))),
  );
  const sound = box("trak", box("mdia", box("mdhd", u32(0, 0, 0, 48000, 48000 * 10), Buffer.alloc(4)), box("hdlr", u32(0, 0), Buffer.from("soun"), Buffer.alloc(12))));
  return Buffer.concat([box("ftyp", Buffer.from("mp42"), u32(0)), box("mdat", Buffer.alloc(64)), box("moov", mvhd, video, ...(audio ? [sound] : []))]);
}

/** An audio-only MP4 / M4A whose sound track's first sample entry is `entry`. */
function soundOnly(entry: Buffer): Buffer {
  const stsd = box("stsd", u32(0, 1), entry);
  const sound = box("trak", box("mdia", box("mdhd", u32(0, 0, 0, 48000, 48000 * 2), Buffer.alloc(4)), box("hdlr", u32(0, 0), Buffer.from("soun"), Buffer.alloc(12)), box("minf", box("stbl", stsd))));
  return Buffer.concat([box("ftyp", Buffer.from("M4A "), u32(0)), box("moov", box("mvhd", u32(0, 0, 0, 1000, 2000), Buffer.alloc(80)), sound)]);
}

/** An AudioSampleEntry: SampleEntry (6 reserved, data reference 1), version, revision, vendor, channelcount, sample size… */
function audioEntry(type: string, channels: number, children: Buffer[] = [], version = 0, extra = Buffer.alloc(0)): Buffer {
  const fields = Buffer.alloc(28);
  fields.writeUInt16BE(1, 6);
  fields.writeUInt16BE(version, 8);
  fields.writeUInt16BE(channels, 16);
  fields.writeUInt16BE(16, 18);
  fields.writeUInt32BE(48000 * 65536, 24);
  return box(type, fields, extra, ...children);
}

/** An esds box whose AudioSpecificConfig is AAC-LC, 48 kHz, with this channelConfiguration. */
function esds(layout: number): Buffer {
  const asc = Buffer.from([(2 << 3) | (3 >> 1), ((3 & 1) << 7) | (layout << 3)]);
  const dsi = Buffer.concat([Buffer.from([0x05, asc.length]), asc]);
  const dcd = Buffer.concat([Buffer.from([0x04, 13 + dsi.length, 0x40, 0x15]), Buffer.alloc(11), dsi]);
  const es = Buffer.concat([Buffer.from([0x03, 3 + dcd.length, 0, 1, 0]), dcd]);
  return box("esds", u32(0), es);
}

function wav(seconds: number, rate = 22050, channels = 1): Buffer {
  const data = Buffer.alloc(Math.round(seconds * rate) * 2 * channels);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2 * channels, 28);
  h.writeUInt16LE(2 * channels, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

describe("media probe", () => {
  it("reads an MP4's length, size, frame rate and tracks, with moov after the media data", () => {
    expect(probeMedia(mp4())).toEqual({ container: "mp4", hasVideo: true, hasAudio: true, duration: 10.02, videoDuration: 10, width: 1920, height: 1080, frames: 300, fps: 30 });
    expect(probeMedia(mp4({ audio: false, frames: 120, fps: 24 }))).toMatchObject({ hasAudio: false, duration: 5, videoDuration: 5, fps: 24, frames: 120 });
  });

  it("swaps width and height for a phone clip stored with a 90° rotation", () => {
    expect(probeMedia(mp4({ rotate: true }))).toMatchObject({ width: 1080, height: 1920 });
  });

  it("reads WAV, FLAC and MP3 lengths", () => {
    expect(probeMedia(wav(2.5))).toEqual({ container: "wav", duration: 2.5, hasVideo: false, hasAudio: true, channels: 1 });
    expect(probeMedia(wav(1, 48000, 2))).toMatchObject({ duration: 1, channels: 2 });
    // Split soundtrack splits a file with more than 2 channels in mono (ComfyUI saves at most stereo): the header says how many there are.
    expect(probeMedia(wav(1, 48000, 6))?.channels).toBe(6);
    // FLAC STREAMINFO: 44.1 kHz, 132300 samples = 3 s
    const flac = Buffer.alloc(42);
    flac.write("fLaC", 0);
    flac.writeUInt32BE(34, 4); // block header: STREAMINFO, 34 bytes
    const rate = 44100;
    const total = 132300;
    flac[18] = rate >> 12;
    flac[19] = (rate >> 4) & 0xff;
    flac[20] = ((rate & 0xf) << 4) | (1 << 1);
    flac[21] = 0xf0 | Math.floor(total / 2 ** 32);
    flac.writeUInt32BE(total >>> 0, 22);
    expect(probeMedia(flac)).toEqual({ container: "flac", duration: 3, hasVideo: false, hasAudio: true, channels: 2 });
    // MP3 with a Xing header: MPEG-1 Layer III, 44.1 kHz stereo, 100 frames × 1152 samples
    const mp3 = Buffer.alloc(417 * 3);
    mp3.set([0xff, 0xfb, 0x90, 0x00], 0);
    mp3.write("Xing", 4 + 32);
    mp3.writeUInt32BE(1, 4 + 32 + 4);
    mp3.writeUInt32BE(100, 4 + 32 + 8);
    expect(probeMedia(mp3)?.duration).toBeCloseTo((100 * 1152) / 44100, 6);
    expect(probeMedia(mp3)?.channels).toBe(2);
    // CBR without a header: 128 kbps → bytes × 8 / bitrate
    const cbr = Buffer.alloc(16000);
    cbr.set([0xff, 0xfb, 0x90, 0x00], 0);
    expect(probeMedia(cbr)?.duration).toBeCloseTo(1, 6);
  });

  it("reads an MP4 / MOV sound track's channel count: an AAC track's own config, else the sample entry", () => {
    // ffmpeg's 5.1 AAC: the entry says 6, and so does the AudioSpecificConfig.
    expect(probeMedia(soundOnly(audioEntry("mp4a", 6, [esds(6)])))).toEqual({ container: "mp4", hasVideo: false, hasAudio: true, duration: 2, channels: 6 });
    // An encoder that leaves the entry at its template value of 2: the AAC config is right (7 = 7.1, eight channels).
    expect(probeMedia(soundOnly(audioEntry("mp4a", 2, [esds(6)])))?.channels).toBe(6);
    expect(probeMedia(soundOnly(audioEntry("mp4a", 2, [esds(7)])))?.channels).toBe(8);
    expect(probeMedia(soundOnly(audioEntry("mp4a", 2, [esds(2)])))?.channels).toBe(2);
    // AC-3 and PCM entries: channelcount.
    expect(probeMedia(soundOnly(audioEntry("ac-3", 6)))?.channels).toBe(6);
    expect(probeMedia(soundOnly(audioEntry("sowt", 1)))?.channels).toBe(1);
    // A QuickTime version 2 entry keeps the real count after its fixed fields (the 16-bit one reads 3).
    const v2 = Buffer.alloc(36);
    v2.writeUInt32BE(72, 0);
    v2.writeDoubleBE(48000, 4);
    v2.writeUInt32BE(6, 12);
    expect(probeMedia(soundOnly(audioEntry("lpcm", 3, [], 2, v2)))?.channels).toBe(6);
    // A sound track with no sample table: no count.
    expect(probeMedia(mp4())?.channels).toBeUndefined();
  });

  it("says nothing about containers it doesn't read", () => {
    expect(probeMedia(Buffer.from("\x1aE\xdf\xa3 webm header....."))).toBeNull();
    expect(probeMedia(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]))).toBeNull();
    expect(probeMedia(Buffer.alloc(4))).toBeNull();
  });
});

describe("probing without reading the whole file (Trim, the Ad Multiplier)", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A camera-style file: 4 MB of media data with the moov box after it (or before: faststart), optionally a 64-bit mdat size. */
  function big({ faststart = false, large = false } = {}): Buffer {
    const whole = mp4();
    const ftyp = whole.subarray(0, 16);
    const moov = whole.subarray(16 + 72);
    const media = Buffer.alloc(4 * 1024 * 1024);
    const mdat = large ? Buffer.concat([u32(1), Buffer.from("mdat"), u32(0, 16 + media.length), media]) : box("mdat", media);
    return Buffer.concat(faststart ? [ftyp, moov, mdat] : [ftyp, mdat, moov]);
  }
  const reader = (buf: Buffer) => {
    const reads: [number, number][] = [];
    const read = async (start: number, end: number) => (reads.push([start, end]), new Uint8Array(buf.subarray(start, end)));
    return { read, reads, bytes: () => reads.reduce((n, [a, b]) => n + (b - a), 0) };
  };
  const expected = probeMedia(mp4());

  it("finds the moov box by its box headers and reads only that, wherever it sits", async () => {
    for (const opts of [{}, { faststart: true }, { large: true }]) {
      const buf = big(opts);
      const r = reader(buf);
      expect(await probeMediaRanges(r.read, buf.length), JSON.stringify(opts)).toEqual(expected);
      expect(r.bytes()).toBeLessThan(300 * 1024);
    }
  });

  it("reads a dropped File in slices", async () => {
    const buf = big();
    const blob = new Blob([new Uint8Array(buf)]);
    const slice = vi.spyOn(blob, "slice");
    expect(await probeBlob(blob)).toEqual(expected);
    expect(slice.mock.calls.every(([a, b]) => (b ?? 0) - (a ?? 0) <= 256 * 1024)).toBe(true);
  });

  it("asks the server for byte ranges, and copes with one that sends the whole file", async () => {
    const buf = big();
    let sent = 0;
    const serve = (ranges: boolean) =>
      vi.fn(async (_url: string, init?: RequestInit) => {
        const m = /bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get("range") ?? "");
        if (!ranges || !m) return (sent += buf.length), new Response(new Uint8Array(buf), { status: 200 });
        const end = Math.min(Number(m[2]), buf.length - 1);
        const part = buf.subarray(Number(m[1]), end + 1);
        sent += part.length;
        return new Response(new Uint8Array(part), { status: 206, headers: { "Content-Range": `bytes ${m[1]}-${end}/${buf.length}` } });
      });
    vi.stubGlobal("fetch", serve(true));
    expect(await probeUrl("/api/files/clip.mp4")).toEqual(expected);
    expect(sent).toBeLessThan(300 * 1024);
    vi.stubGlobal("fetch", serve(false));
    expect(await probeUrl("/api/files/clip.mp4")).toEqual(expected);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404 })));
    expect(await probeUrl("/api/files/gone.mp4")).toBeNull();
  });

  it("reads a big WAV, FLAC or MP3 from its header alone (Split soundtrack's 2 GB films, the mixer's FLAC stems)", async () => {
    // A WAV header for 600 s of 48 kHz 5.1, the rest never read.
    const head = wav(0, 48000, 6);
    head.writeUInt32LE(600 * 48000 * 12, 40);
    head.writeUInt32LE(36 + 600 * 48000 * 12, 4);
    const size = 44 + 600 * 48000 * 12;
    const r = reader(Buffer.concat([head, Buffer.alloc(300 * 1024)]));
    expect(await probeMediaRanges(r.read, size)).toEqual({ container: "wav", duration: 600, hasVideo: false, hasAudio: true, channels: 6 });
    expect(r.reads).toEqual([[0, 256 * 1024]]);
    // A CBR MP3 without a Xing header: the length from the whole file's size, not the bytes read.
    const mp3 = Buffer.alloc(300 * 1024);
    mp3.set([0xff, 0xfb, 0x90, 0x00], 0);
    expect((await probeMediaRanges(reader(mp3).read, 16000 * 60))?.duration).toBeCloseTo(60, 6);
  });

  it("probes other containers only when the whole file fits in the first read", async () => {
    const wav = Buffer.alloc(44);
    wav.write("RIFF", 0);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt32LE(4, 28);
    wav.write("data", 36);
    wav.writeUInt32LE(0, 40);
    const small = reader(Buffer.concat([wav, Buffer.alloc(400)]));
    expect((await probeMediaRanges(small.read, 444))?.container).toBe("wav");
    const webm = Buffer.concat([Buffer.from("\x1aE\xdf\xa3 webm header....."), Buffer.alloc(1024 * 1024)]);
    const r = reader(webm);
    expect(await probeMediaRanges(r.read, webm.length)).toBeNull();
    expect(r.reads).toHaveLength(1);
  });
});

describe("a crafted MP4 can't make the box walk read without end", () => {
  /** "ftyp", then `n` empty 8-byte "free" boxes, then a real moov: without a cap, each box past the first read is one more read. */
  function freeBoxes(n: number): Buffer {
    const whole = mp4();
    const free = Buffer.alloc(8 * n);
    for (let i = 0; i < n; i++) {
      free.writeUInt32BE(8, i * 8);
      free.write("free", i * 8 + 4);
    }
    return Buffer.concat([whole.subarray(0, 16), free, whole.subarray(16 + 72)]);
  }

  it("gives up after a few dozen top-level boxes, with only a few reads (at once and in turns)", async () => {
    const buf = freeBoxes(400_000); // 3.2 MB of boxes: past the first read, one 16-byte read per box without a cap
    let reads = 0;
    const sync = (start: number, end: number) => (reads++, new Uint8Array(buf.subarray(start, end)));
    expect(probeMediaRangesSync(sync, buf.length, { headBytes: 1024 * 1024 })).toBeNull();
    expect(reads).toBeLessThan(100);
    reads = 0;
    const inTurns = async (start: number, end: number) => (reads++, new Uint8Array(buf.subarray(start, end)));
    expect(await probeMediaRanges(inTurns, buf.length)).toBeNull();
    expect(reads).toBeLessThan(100);
  });

  it("still finds the moov of a real file after a handful of top-level boxes", async () => {
    const buf = freeBoxes(6);
    expect(probeMediaRangesSync((s, e) => new Uint8Array(buf.subarray(s, e)), buf.length)).toEqual(probeMedia(mp4()));
    expect(await probeMediaRanges(async (s, e) => new Uint8Array(buf.subarray(s, e)), buf.length)).toEqual(probeMedia(mp4()));
  });
});
