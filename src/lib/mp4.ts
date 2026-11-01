/**
 * A minimal MP4 writer for one H.264 video track of already-encoded frames (WebCodecs AVC chunks in "avc" format, with
 * the encoder's avcC as the decoder description). Blockout to film renders its grey box in the browser, and the cloud
 * models that read it (Seedance 2.5's reference clips: MP4 or MOV) don't take WebM. ISO base media file layout: ftyp,
 * then moov first (so a player or a provider can start before the end), then one mdat holding every frame in one chunk.
 * Frames are in decode order with no reordering (WebCodecs' H.264 encoder makes no B-frames), so no composition offsets.
 * Pure: no DOM.
 */

import type { EncodedFrame } from "./webm";

export interface Mp4Track {
  width: number;
  height: number;
  fps: number;
  /** The avcC record (VideoDecoderConfig.description from the encoder's first chunk). */
  avcC: Uint8Array;
}

/** Ticks a second: 90 kHz divides 16, 24, 25, 30 and 60 fps exactly. */
const TIMESCALE = 90_000;

const enc = new TextEncoder();

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, Math.max(0, Math.round(n)) >>> 0);
  return b;
}
function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, Math.max(0, Math.round(n)) & 0xffff);
  return b;
}
const zeros = (n: number) => new Uint8Array(n);

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A box: size, four-character type, body. */
function box(type: string, ...body: Uint8Array[]): Uint8Array {
  const data = concat(body);
  return concat([u32(data.length + 8), enc.encode(type), data]);
}
/** A full box: a box whose body starts with version (1 byte) and flags (3 bytes). */
const full = (type: string, version: number, flags: number, ...body: Uint8Array[]) => box(type, new Uint8Array([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...body);

/** The identity transform every track header and the movie header carry. */
const MATRIX = concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);

function moov(track: Mp4Track, frames: readonly EncodedFrame[], dataOffset: number): Uint8Array {
  const delta = Math.round(TIMESCALE / Math.max(1, track.fps));
  const mediaDuration = delta * frames.length;
  const movieMs = Math.round((frames.length * 1000) / Math.max(1, track.fps));
  const mvhd = full("mvhd", 0, 0, u32(0), u32(0), u32(1000), u32(movieMs), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(2));
  const tkhd = full("tkhd", 0, 3, u32(0), u32(0), u32(1), u32(0), u32(movieMs), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(track.width * 65536), u32(track.height * 65536));
  const mdhd = full("mdhd", 0, 0, u32(0), u32(0), u32(TIMESCALE), u32(mediaDuration), u16(0x55c4), u16(0));
  const hdlr = full("hdlr", 0, 0, u32(0), enc.encode("vide"), zeros(12), enc.encode("VideoHandler\0"));
  const vmhd = full("vmhd", 0, 1, u16(0), zeros(6));
  const dinf = box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1)));
  const avc1 = box(
    "avc1",
    zeros(6),
    u16(1),
    zeros(16),
    u16(track.width),
    u16(track.height),
    u32(0x00480000),
    u32(0x00480000),
    u32(0),
    u16(1),
    zeros(32),
    u16(0x0018),
    u16(0xffff),
    box("avcC", track.avcC),
  );
  const stsd = full("stsd", 0, 0, u32(1), avc1);
  const stts = full("stts", 0, 0, u32(1), u32(frames.length), u32(delta));
  const keys = frames.flatMap((f, i) => (f.key ? [u32(i + 1)] : []));
  const stss = full("stss", 0, 0, u32(keys.length), ...keys);
  const stsc = full("stsc", 0, 0, u32(1), u32(1), u32(frames.length), u32(1));
  const stsz = full("stsz", 0, 0, u32(0), u32(frames.length), ...frames.map((f) => u32(f.data.length)));
  const stco = full("stco", 0, 0, u32(1), u32(dataOffset));
  const stbl = box("stbl", stsd, stts, stss, stsc, stsz, stco);
  const minf = box("minf", vmhd, dinf, stbl);
  const mdia = box("mdia", mdhd, hdlr, minf);
  const trak = box("trak", tkhd, mdia);
  return box("moov", mvhd, trak);
}

/**
 * One MP4 file of `frames` (H.264, AVCC length-prefixed NAL units as WebCodecs gives them in "avc" format) at
 * `track.fps`: frame i is shown at i / fps and lasts 1 / fps, so a reader counts exactly frames.length frames.
 */
export function muxMp4(track: Mp4Track, frames: readonly EncodedFrame[]): Uint8Array {
  if (!frames.length) throw new Error("No frames to write");
  if (!frames[0].key) throw new Error("The first frame must be a keyframe");
  const ftyp = box("ftyp", enc.encode("isom"), u32(512), enc.encode("isomiso2avc1mp41"));
  // moov's size doesn't depend on the offset it records, so measure it once, then write it with the real offset.
  const size = moov(track, frames, 0).length;
  const offset = ftyp.length + size + 8;
  const mdat = box("mdat", ...frames.map((f) => f.data));
  return concat([ftyp, moov(track, frames, offset), mdat]);
}
