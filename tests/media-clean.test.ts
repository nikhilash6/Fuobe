import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { metadataPatches, overlay, patchStream, type Patch } from "@/server/media-clean";
import { tempDir } from "./helpers/temp-dir";

/**
 * Files on share pages lose the generation data saved inside them (ComfyUI writes its prompt and
 * workflow into PNG text chunks, MP4/WebM/FLAC/MP3/Ogg tags, GLB extras and SVG metadata). Each
 * fixture here is a small, well-formed file of that format carrying SECRET where that tool puts it.
 */
const dir = tempDir("fuobe-clean-");

const SECRET = "SECRET violet tiger prompt";
let n = 0;
function file(data: Buffer, ext: string): string {
  const p = path.join(dir, `f${n++}.${ext}`);
  fs.writeFileSync(p, data);
  return p;
}

/** The file as the share route sends it. */
function cleaned(p: string, type = ""): Buffer {
  const patches = metadataPatches(p, type);
  expect(patches, p).not.toBeNull();
  const data = fs.readFileSync(p);
  const out = overlay(data, 0, patches!);
  expect(out.length).toBe(data.length); // same size: byte ranges and offsets stay valid
  return out;
}

const u32be = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(v);
  return b;
};
const u32le = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
};
const u16be = (v: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(v);
  return b;
};

const CRC = Array.from({ length: 256 }, (_, k) => {
  let c = k;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type: string, data: Buffer) => Buffer.concat([u32be(data.length), Buffer.from(type, "latin1"), data, u32be(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])))]);

function pngChunks(b: Buffer): { type: string; data: Buffer; crcOk: boolean }[] {
  const out = [];
  for (let at = 8; at < b.length; ) {
    const len = b.readUInt32BE(at);
    const type = b.toString("latin1", at + 4, at + 8);
    const data = b.subarray(at + 8, at + 8 + len);
    out.push({ type, data, crcOk: crc32(b.subarray(at + 4, at + 8 + len)) === b.readUInt32BE(at + 8 + len) });
    at += 12 + len;
  }
  return out;
}

const box = (type: string, ...children: Buffer[]) => {
  const body = Buffer.concat(children);
  return Buffer.concat([u32be(8 + body.length), Buffer.from(type, "latin1"), body]);
};

describe("media metadata", () => {
  it("PNG: text and EXIF chunks become a private chunk decoders skip, zeroed, with valid CRCs; pixels untouched", () => {
    const idat = zlib.deflateSync(Buffer.from([0, 10, 20, 30, 255]));
    const src = Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      pngChunk("IHDR", Buffer.from("00000001000000010806000000", "hex")),
      pngChunk("tEXt", Buffer.from(`prompt\0{"6": {"inputs": {"text": "${SECRET}"}}}`, "latin1")),
      pngChunk("zTXt", Buffer.concat([Buffer.from("workflow\0\0", "latin1"), zlib.deflateSync(Buffer.from(SECRET))])),
      pngChunk("iTXt", Buffer.from(`parameters\0\0\0\0\0${SECRET}`, "utf8")),
      pngChunk("IDAT", idat),
      pngChunk("eXIf", Buffer.from(`MM\0*${SECRET}`, "latin1")),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    const out = cleaned(file(src, "png"));
    const chunks = pngChunks(out);
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "fuPd", "fuPd", "fuPd", "IDAT", "fuPd", "IEND"]);
    expect(chunks.every((c) => c.crcOk)).toBe(true);
    expect(chunks.filter((c) => c.type === "fuPd").every((c) => c.data.every((x) => x === 0))).toBe(true);
    expect(zlib.inflateSync(chunks[4].data)).toEqual(Buffer.from([0, 10, 20, 30, 255]));
    expect(out.toString("latin1")).not.toContain("SECRET");
  });

  it("JPEG: EXIF/XMP and comments become empty comments; JFIF, ICC and Adobe segments and the image stay", () => {
    const seg = (m: number, data: Buffer) => Buffer.concat([Buffer.from([0xff, m]), u16be(data.length + 2), data]);
    const scan = Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]);
    const src = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
      seg(0xe1, Buffer.from(`Exif\0\0MM\0*${SECRET}`, "latin1")),
      seg(0xe2, Buffer.from("ICC_PROFILE\0\x01\x01profile", "latin1")),
      seg(0xed, Buffer.from(`Photoshop 3.0\0${SECRET}`, "latin1")),
      seg(0xfe, Buffer.from(SECRET, "latin1")),
      seg(0xee, Buffer.from("Adobe\0\x64\0\0\0\0\x01", "latin1")),
      seg(0xdb, Buffer.alloc(65, 1)),
      seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
      scan,
      Buffer.from([0xff, 0xd9]),
    ]);
    const out = cleaned(file(src, "jpg"));
    expect(out.toString("latin1")).not.toContain("SECRET");
    expect(out.toString("latin1")).toContain("JFIF");
    expect(out.toString("latin1")).toContain("ICC_PROFILE");
    expect(out.toString("latin1")).toContain("Adobe");
    const markers: number[] = [];
    for (let at = 2; out[at] === 0xff && out[at + 1] !== 0xda; at += 2 + out.readUInt16BE(at + 2)) markers.push(out[at + 1]);
    expect(markers).toEqual([0xe0, 0xfe, 0xe2, 0xfe, 0xfe, 0xee, 0xdb]);
    expect(out.subarray(out.length - 2 - scan.length)).toEqual(src.subarray(src.length - 2 - scan.length));
  });

  it("WebP: EXIF and XMP chunks become JUNK and VP8X stops announcing them", () => {
    const chunk = (id: string, data: Buffer) => Buffer.concat([Buffer.from(id, "latin1"), u32le(data.length), data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
    const body = Buffer.concat([
      Buffer.from("WEBP"),
      chunk("VP8X", Buffer.from([0x0c | 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
      chunk("VP8L", Buffer.from("not-really-pixels")),
      chunk("EXIF", Buffer.from(`MM\0*${SECRET}`, "latin1")),
      chunk("XMP ", Buffer.from(`<x:xmpmeta>${SECRET}</x:xmpmeta>`)),
    ]);
    const out = cleaned(file(Buffer.concat([Buffer.from("RIFF"), u32le(body.length), body]), "webp"));
    expect(out.toString("latin1")).not.toContain("SECRET");
    expect(out.toString("latin1")).not.toMatch(/EXIF|XMP /);
    expect(out[20] & 0x0c).toBe(0); // VP8X flags: no EXIF, no XMP
    expect(out[20] & 0x10).toBe(0x10); // the alpha flag stays
    expect(out.toString("latin1")).toContain("not-really-pixels");
  });

  it("WAV: INFO and ID3 chunks become JUNK; the samples stay", () => {
    const chunk = (id: string, data: Buffer) => Buffer.concat([Buffer.from(id, "latin1"), u32le(data.length), data]);
    const body = Buffer.concat([Buffer.from("WAVE"), chunk("fmt ", Buffer.alloc(16, 1)), chunk("LIST", Buffer.from(`INFOICMT${SECRET}`)), chunk("data", Buffer.from("samples!"))]);
    const out = cleaned(file(Buffer.concat([Buffer.from("RIFF"), u32le(body.length), body]), "wav"));
    expect(out.toString("latin1")).not.toContain("SECRET");
    expect(out.toString("latin1")).toContain("JUNK");
    expect(out.toString("latin1")).toContain("samples!");
  });

  it("WAV written to a pipe (sizes left at 0xFFFFFFFF) or as RF64: still cleaned, not refused", () => {
    const chunk = (id: string, data: Buffer, size = data.length) => Buffer.concat([Buffer.from(id, "latin1"), u32le(size), data]);
    const body = (riff: string) =>
      Buffer.concat([Buffer.from(riff), u32le(0xffffffff), Buffer.from("WAVE"), chunk("fmt ", Buffer.alloc(16, 1)), chunk("LIST", Buffer.from(`INFOINAM${SECRET}`)), chunk("data", Buffer.from("samples!"), 0xffffffff)]);
    for (const riff of ["RIFF", "RF64"]) {
      const out = cleaned(file(body(riff), "wav"));
      expect(out.toString("latin1"), riff).not.toContain("SECRET");
      expect(out.toString("latin1")).toContain("JUNK");
      expect(out.subarray(out.length - 8).toString()).toBe("samples!");
    }
    // A metadata chunk cut off by the end of the file is blanked to the end.
    const cut = Buffer.concat([Buffer.from("RIFF"), u32le(0), Buffer.from("WAVE"), chunk("fmt ", Buffer.alloc(16, 1)), chunk("LIST", Buffer.from(`INFOINAM${SECRET}`), 4000)]);
    expect(cleaned(file(cut, "wav")).toString("latin1")).not.toContain("SECRET");
  });

  it("MP4 / WebM cut off in their media data (a stopped recording, a partial download) are cleaned, not refused", () => {
    const meta = box("udta", box("meta", Buffer.alloc(4), box("ilst", box("©cmt", box("data", Buffer.alloc(8), Buffer.from(SECRET))))));
    const mp4 = Buffer.concat([box("ftyp", Buffer.from("isom\0\0\x02\0isom", "latin1")), box("moov", box("mvhd", Buffer.alloc(100)), meta), u32be(5000), Buffer.from("mdatframes")]);
    expect(cleaned(file(mp4, "mp4")).toString("latin1")).not.toContain("SECRET");
    // …but not when the cut is in the movie box (where metadata lives).
    expect(metadataPatches(file(Buffer.concat([box("ftyp", Buffer.from("isom")), u32be(5000), Buffer.from("moov"), meta]), "mp4"))).toBeNull();

    const el = (id: number[], data: Buffer, size = data.length) => Buffer.concat([Buffer.from(id), Buffer.from([0x40 | (size >> 8), size & 0xff]), data]);
    const webm = Buffer.concat([
      el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], Buffer.from("webm"))),
      el([0x18, 0x53, 0x80, 0x67], Buffer.concat([el([0x12, 0x54, 0xc3, 0x67], el([0x73, 0x73], Buffer.from(SECRET))), el([0x1f, 0x43, 0xb6, 0x75], Buffer.from("cut-frames"), 3000)]), 4000),
    ]);
    const out = cleaned(file(webm, "webm"));
    expect(out.toString("latin1")).not.toContain("SECRET");
    expect(out.toString("latin1")).toContain("cut-frames");
  });

  it("MP4 / MOV: the movie's and tracks' user data and metadata become free boxes; media data and offsets stay", () => {
    const ilst = box("meta", Buffer.alloc(4), box("hdlr", Buffer.alloc(20)), box("ilst", box("©cmt", box("data", Buffer.alloc(8), Buffer.from(SECRET)))));
    const src = Buffer.concat([
      box("ftyp", Buffer.from("isom\0\0\x02\0isomavc1", "latin1")),
      box("moov", box("mvhd", Buffer.alloc(100)), box("trak", box("tkhd", Buffer.alloc(84)), box("udta", box("name", Buffer.from(SECRET)))), box("udta", ilst)),
      // A 64-bit-size mdat (largesize) holding the frames.
      Buffer.concat([u32be(1), Buffer.from("mdat"), Buffer.from([0, 0, 0, 0, 0, 0, 0, 16 + 6]), Buffer.from("frames")]),
    ]);
    const out = cleaned(file(src, "mp4"));
    expect(out.toString("latin1")).not.toContain("SECRET");
    expect(out.toString("latin1")).not.toContain("udta");
    expect(out.toString("latin1")).toContain("mvhd");
    expect(out.toString("latin1")).toContain("tkhd");
    expect(out.subarray(out.length - 6).toString()).toBe("frames");
  });

  it("MP4: keeps an AVIF/HEIF image's top-level meta (its picture is described there)", () => {
    const src = Buffer.concat([box("ftyp", Buffer.from("avif\0\0\0\0mif1", "latin1")), box("meta", Buffer.alloc(4), box("pitm", Buffer.alloc(6))), box("mdat", Buffer.from("pixels"))]);
    expect(metadataPatches(file(src, "avif"))).toEqual([]);
  });

  it("WebM / MKV: Tags and the segment title become Void elements; clusters (even of unknown size) stay", () => {
    const vint = (v: number) => Buffer.from([0x80 | v]); // sizes < 127
    const el = (id: number[], data: Buffer) => Buffer.concat([Buffer.from(id), vint(data.length), data]);
    const unknown = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    const src = Buffer.concat([
      el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], Buffer.from("webm"))),
      Buffer.from([0x18, 0x53, 0x80, 0x67]),
      unknown, // a Segment of unknown size (a live writer)
      el([0x15, 0x49, 0xa9, 0x66], Buffer.concat([el([0x2a, 0xd7, 0xb1], Buffer.from([0x0f, 0x42, 0x40])), el([0x7b, 0xa9], Buffer.from(SECRET))])),
      Buffer.from([0x1f, 0x43, 0xb6, 0x75]),
      unknown, // a Cluster of unknown size
      el([0xe7], Buffer.from([0])),
      el([0xa3], Buffer.from("a-frame")),
      el([0x12, 0x54, 0xc3, 0x67], el([0x73, 0x73], el([0x67, 0xc8], Buffer.concat([el([0x45, 0xa3], Buffer.from("PROMPT")), el([0x44, 0x87], Buffer.from(SECRET))])))),
    ]);
    const out = cleaned(file(src, "webm"));
    expect(out.toString("latin1")).not.toContain("SECRET");
    expect(out.toString("latin1")).not.toContain("PROMPT");
    expect(out.toString("latin1")).toContain("a-frame");
    expect(out.includes(Buffer.from([0x12, 0x54, 0xc3, 0x67]))).toBe(false);
    expect(out.includes(Buffer.from([0x2a, 0xd7, 0xb1]))).toBe(true); // TimecodeScale stays
  });

  it("FLAC: Vorbis comments become padding (a leading ID3 tag too); the stream info stays", () => {
    const block = (type: number, last: boolean, data: Buffer) => Buffer.concat([Buffer.from([(last ? 0x80 : 0) | type, data.length >> 16, (data.length >> 8) & 0xff, data.length & 0xff]), data]);
    const id3 = Buffer.concat([Buffer.from("ID3\x04\0\0\0\0\0", "latin1"), Buffer.from([SECRET.length]), Buffer.from(SECRET)]);
    const src = Buffer.concat([id3, Buffer.from("fLaC"), block(0, false, Buffer.alloc(34, 7)), block(4, true, Buffer.from(`\x05\0\0\0Lavf3\x01\0\0\0${SECRET}`, "latin1")), Buffer.from("audio-frames")]);
    const out = cleaned(file(src, "flac"));
    expect(out.toString("latin1")).not.toContain("SECRET");
    const at = out.indexOf("fLaC") + 4 + 4 + 34;
    expect(out[at]).toBe(0x81); // the last block, now PADDING
    expect(out.toString("latin1")).toContain("audio-frames");
  });

  it("MP3: the ID3v2 frames become padding and an ID3v1 tag is emptied; the audio stays", () => {
    const frames = Buffer.concat([Buffer.from("TXXX", "latin1"), u32be(SECRET.length + 8), Buffer.from([0, 0, 3]), Buffer.from(`prompt\0${SECRET}`, "latin1")]);
    const size = frames.length;
    const id3 = Buffer.concat([Buffer.from("ID3\x04\0\x40", "latin1"), Buffer.from([0, 0, size >> 7, size & 0x7f]), frames]);
    const v1 = Buffer.concat([Buffer.from("TAG"), Buffer.from(SECRET.padEnd(124, "\0")), Buffer.from([12])]);
    const audio = Buffer.from([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4]);
    const out = cleaned(file(Buffer.concat([id3, audio, v1]), "mp3"), "audio/mpeg");
    expect(out.toString("latin1")).not.toContain("SECRET");
    expect(out.subarray(0, 3).toString()).toBe("ID3");
    expect(out[5]).toBe(0); // no extended header any more
    expect(out.subarray(10, 10 + size).every((x) => x === 0)).toBe(true);
    expect(out.subarray(10 + size, 10 + size + audio.length)).toEqual(audio);
    expect(out.subarray(out.length - 128, out.length - 125).toString()).toBe("TAG");
    expect(out[out.length - 1]).toBe(0xff); // no genre
  });

  it("Ogg: comments are blanked in place and the page checksum is worked out again", () => {
    const OGG = Array.from({ length: 256 }, (_, k) => {
      let c = k << 24;
      for (let i = 0; i < 8; i++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
      return c >>> 0;
    });
    const oggCrc = (b: Buffer) => {
      let c = 0;
      for (const x of b) c = ((c << 8) ^ OGG[((c >>> 24) ^ x) & 0xff]) >>> 0;
      return c;
    };
    const page = (seq: number, packet: Buffer) => {
      const head = Buffer.alloc(27);
      head.write("OggS", 0, "latin1");
      head.writeUInt32LE(77, 14);
      head.writeUInt32LE(seq, 18);
      head[26] = 1;
      const p = Buffer.concat([head, Buffer.from([packet.length]), packet]);
      p.writeUInt32LE(oggCrc(p), 22);
      return p;
    };
    const comment = `PROMPT=${SECRET}`;
    const tags = Buffer.concat([Buffer.from("OpusTags"), u32le(4), Buffer.from("Lavf"), u32le(1), u32le(comment.length), Buffer.from(comment)]);
    const src = Buffer.concat([page(0, Buffer.from("OpusHead\x01\x02\0\0\x80\xbb\0\0\0\0\0", "latin1")), page(1, tags), page(2, Buffer.from("audio"))]);
    const out = cleaned(file(src, "ogg"));
    expect(out.toString("latin1")).not.toContain("SECRET");
    expect(out.toString("latin1")).toContain("Lavf");
    const second = out.subarray(src.indexOf("OggS", 1), src.lastIndexOf("OggS"));
    const zeroed = Buffer.from(second);
    zeroed.writeUInt32LE(0, 22);
    expect(second.readUInt32LE(22)).toBe(oggCrc(zeroed));
    expect(out.subarray(out.length - 5).toString()).toBe("audio");
  });

  it("GLB: asset.extras goes, the JSON chunk keeps its length (spaces), the binary chunk stays", () => {
    const json = Buffer.from(JSON.stringify({ asset: { version: "2.0", generator: "ComfyUI", extras: { prompt: SECRET } }, scenes: [{ nodes: [] }] }));
    const pad = (4 - (json.length % 4)) % 4;
    const jsonChunk = Buffer.concat([u32le(json.length + pad), Buffer.from("JSON"), json, Buffer.alloc(pad, 0x20)]);
    const bin = Buffer.concat([u32le(4), Buffer.from("BIN\0", "latin1"), Buffer.from("mesh")]);
    const total = 12 + jsonChunk.length + bin.length;
    const out = cleaned(file(Buffer.concat([Buffer.from("glTF"), u32le(2), u32le(total), jsonChunk, bin]), "glb"));
    const len = out.readUInt32LE(12);
    const doc = JSON.parse(out.subarray(20, 20 + len).toString()) as { asset: Record<string, unknown> };
    expect(doc.asset).toEqual({ version: "2.0", generator: "ComfyUI" });
    expect(out.subarray(out.length - 4).toString()).toBe("mesh");
    expect(out.toString("latin1")).not.toContain("SECRET");
  });

  it("SVG: the <metadata> element is emptied", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">\n  <metadata>\n<![CDATA[\n{"prompt": "${SECRET} ünïcode"}\n]]>\n</metadata><rect width="1" height="1"/></svg>`;
    const out = cleaned(file(Buffer.from(svg), "svg"), "image/svg+xml").toString();
    expect(out).not.toContain("SECRET");
    expect(out).toMatch(/<metadata>\s+<\/metadata><rect/);
  });

  it("passes files without embedded metadata, and refuses a file it can't read where metadata lives", () => {
    expect(metadataPatches(file(Buffer.from(`a transcript mentioning ${SECRET}`), "txt"), "text/plain")).toEqual([]);
    expect(metadataPatches(file(Buffer.from("GIF89a\x01\0\x01\0\0\0\0;", "latin1"), "gif"))).toEqual([]);
    const truncated = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), u32be(5000), Buffer.from("tEXtprompt")]);
    expect(metadataPatches(file(truncated, "png"))).toBeNull();
    expect(metadataPatches(file(Buffer.concat([box("ftyp", Buffer.from("isom")), u32be(9999), Buffer.from("moov")]), "mp4"))).toBeNull();
  });

  it("applies patches across chunk boundaries and from a range's start", async () => {
    const data = Buffer.from("0123456789abcdefghij");
    const patches: Patch[] = [
      { at: 3, bytes: Buffer.from("XYZ") },
      { at: 8, length: 6, fill: 0x2e },
    ];
    expect(overlay(data, 0, patches).toString()).toBe("012XYZ67......efghij");
    // A range starting at 5, arriving in three pieces.
    const parts = [data.subarray(5, 9), data.subarray(9, 12), data.subarray(12, 16)];
    const chunks: Buffer[] = [];
    for await (const c of Readable.from(parts).pipe(patchStream(patches, 5))) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe("Z67......ef");
    expect(data.toString()).toBe("0123456789abcdefghij"); // the stored bytes aren't touched
  });
});
