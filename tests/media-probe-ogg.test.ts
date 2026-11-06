/**
 * Ogg sound (Vorbis and Opus) read from its pages (RFC 3533): the first page's identification header gives the channels and
 * rate, the last page's granule position the samples to its end (Opus: at 48 kHz, less the pre-skip, RFC 7845). Before, an
 * Ogg voice had no length, so fal's H3 Max lip sync window (5 s to 15 minutes) and its per-second price were skipped for it.
 */
import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import { voiceWindowProblem } from "@/lib/catalog/clip-windows";
import { probeMedia, probeMediaRanges, probeMediaRangesSync } from "@/lib/media-probe";
import { mediaFacts } from "@/server/media-facts";

/** One Ogg page (the CRC is not checked by the reader, so it is left 0). */
function page(granule: bigint, serial: number, seq: number, body: Uint8Array, type = 0): Uint8Array {
  const segs: number[] = [];
  for (let n = body.length; ; n -= 255) {
    segs.push(Math.min(255, n));
    if (n < 255) break;
  }
  const out = new Uint8Array(27 + segs.length + body.length);
  const d = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53], 0);
  out[5] = type;
  d.setBigUint64(6, granule, true);
  d.setUint32(14, serial, true);
  d.setUint32(18, seq, true);
  out[26] = segs.length;
  out.set(segs, 27);
  out.set(body, 27 + segs.length);
  return out;
}

const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

function vorbisId(channels: number, rate: number): Uint8Array {
  const b = new Uint8Array(30);
  const d = new DataView(b.buffer);
  b[0] = 1;
  b.set(new TextEncoder().encode("vorbis"), 1);
  b[11] = channels;
  d.setUint32(12, rate, true);
  b[29] = 1;
  return b;
}

function opusHead(channels: number, preSkip: number): Uint8Array {
  const b = new Uint8Array(19);
  const d = new DataView(b.buffer);
  b.set(new TextEncoder().encode("OpusHead"), 0);
  b[8] = 1;
  b[9] = channels;
  d.setUint16(10, preSkip, true);
  d.setUint32(12, 44100, true);
  return b;
}

/** An Ogg file: its id page, `filler` bytes of audio pages, and a last page ending at `granule`. */
function ogg(id: Uint8Array, granule: bigint, filler = 1000, serial = 7): Uint8Array {
  const audio: Uint8Array[] = [];
  for (let left = filler, seq = 2; left > 0; left -= 4000, seq++) audio.push(page(-1n & 0xffffffffffffffffn, serial, seq, new Uint8Array(Math.min(4000, left))));
  return join(page(0n, serial, 0, id, 2), page(0n, serial, 1, new Uint8Array(40)), ...audio, page(granule, serial, 99, new Uint8Array(200), 4));
}

describe("Ogg sound from its pages", () => {
  it("Vorbis: channels and rate from the id header, the length from the last granule position", () => {
    expect(probeMedia(ogg(vorbisId(2, 44100), 143_325n))).toEqual({ container: "ogg", hasVideo: false, hasAudio: true, channels: 2, duration: 3.25 });
  });

  it("Opus: 48 kHz granule positions less the pre-skip", () => {
    expect(probeMedia(ogg(opusHead(1, 312), 360_312n))).toMatchObject({ container: "ogg", channels: 1, duration: 7.5 });
  });

  it("a last page without a granule position (-1) is passed over for the one before it", () => {
    const file = join(ogg(vorbisId(1, 48000), 240_000n), page(0xffffffffffffffffn, 7, 100, new Uint8Array(50)));
    expect(probeMedia(file)?.duration).toBe(5);
  });

  it("only the first bytes: the sound is known, its length is not; with the file's size, its end is read", async () => {
    const file = ogg(vorbisId(2, 48000), 48000n * 600n, 400_000);
    expect(probeMedia(file.subarray(0, 4096), file.length)).toEqual({ container: "ogg", hasVideo: false, hasAudio: true, channels: 2 });
    const reads: [number, number][] = [];
    const read = (s: number, e: number) => (reads.push([s, e]), file.subarray(s, e));
    expect(probeMediaRangesSync(read, file.length)?.duration).toBe(600);
    expect(await probeMediaRanges(async (s, e) => file.subarray(s, e), file.length)).toMatchObject({ container: "ogg", duration: 600 });
    // The head and the last 72 KB, never the whole file.
    expect(reads.every(([s, e]) => e - s <= 256 * 1024)).toBe(true);
  });

  it("an Ogg of anything else (Theora video) is not read as sound", () => {
    const theora = new Uint8Array(42);
    theora[0] = 0x80;
    theora.set(new TextEncoder().encode("theora"), 1);
    expect(probeMedia(ogg(theora, 1000n))).toBeNull();
  });
});

describe("an Ogg voice on H3 Max lip sync", () => {
  it("is held to fal's 5 s minimum like any other voice", () => {
    const lipsync = getModel("minimax-h3-max-lipsync")!;
    const short = mediaFacts(ogg(opusHead(1, 312), 48000n * 3n + 312n));
    expect(short).toMatchObject({ duration: 3, hasAudio: true });
    expect(voiceWindowProblem(lipsync, short.duration!)).toMatch(/needs at least 5 s of audio, and this is 3 s/);
    expect(voiceWindowProblem(lipsync, mediaFacts(ogg(vorbisId(1, 44100), 44100n * 12n)).duration!)).toBeNull();
  });
});
