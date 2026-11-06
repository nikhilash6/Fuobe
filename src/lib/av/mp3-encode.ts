import { Mp3Encoder } from "@breezystack/lamejs";

/**
 * PCM to MP3 with LAME (lamejs, pure JavaScript), a block at a time: runs in a browser Web Worker
 * (src/components/av/mp3.worker.ts), on the main thread where a worker can't start, and in tests. One or two channels of
 * float samples (-1 to 1), constant bit rate.
 */

function toInt16(src: Float32Array): Int16Array {
  const out = new Int16Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const s = Math.max(-1, Math.min(1, src[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** An MP3 made a block at a time: `push` each block of channels (the same length), then `end` for the file's parts. */
export class Mp3Stream {
  private enc: Mp3Encoder;
  private parts: Uint8Array[] = [];
  constructor(
    private channels: number,
    sampleRate: number,
    kbps: number,
  ) {
    if (channels < 1 || channels > 2) throw new Error("No sound to convert");
    this.enc = new Mp3Encoder(channels, sampleRate, kbps);
  }
  push(block: Float32Array[]) {
    const left = toInt16(block[0]);
    const out = this.channels === 2 ? this.enc.encodeBuffer(left, toInt16(block[1])) : this.enc.encodeBuffer(left);
    if (out.length) this.parts.push(new Uint8Array(out));
  }
  end(): Uint8Array[] {
    const out = this.enc.flush();
    if (out.length) this.parts.push(new Uint8Array(out));
    return this.parts;
  }
}

/** Samples per block: 32 MP3 frames (MPEG-1 Layer III frames hold 1152). */
export const MP3_BLOCK = 1152 * 32;

/** The whole MP3 of `channels` at once (tests; the browser streams blocks instead). */
export async function encodeMp3(channels: Float32Array[], sampleRate: number, kbps: number, breathe?: () => void | Promise<void>): Promise<Uint8Array[]> {
  const s = new Mp3Stream(Math.min(2, channels.length), sampleRate, kbps);
  for (let at = 0; at < channels[0].length; at += MP3_BLOCK) {
    s.push(channels.slice(0, 2).map((c) => c.subarray(at, at + MP3_BLOCK)));
    if (breathe) await breathe();
  }
  return s.end();
}
