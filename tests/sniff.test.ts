import { describe, expect, it } from "vitest";
import { sniffMedia } from "@/lib/sniff";

const pad = (b: Buffer | string) => Buffer.concat([typeof b === "string" ? Buffer.from(b, "latin1") : b, Buffer.alloc(64)]);
const riff = (form: string) => pad(Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from(form, "latin1")]));
const ftyp = (brand: string) => pad(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftyp" + brand, "latin1")]));
// EBML header with a DocType element (0x42 0x82, size 0x84 = 4 bytes, or 0x88 = 8).
const ebml = (doc: string) => pad(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x80 | doc.length]), Buffer.from(doc, "latin1")]));

describe("sniffMedia: the type of a file is what its bytes say", () => {
  it("knows pictures", () => {
    expect(sniffMedia(pad(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))).toEqual({ contentType: "image/png", kind: "image" });
    expect(sniffMedia(pad(Buffer.from([0xff, 0xd8, 0xff, 0xe0])))).toEqual({ contentType: "image/jpeg", kind: "image" });
    expect(sniffMedia(riff("WEBPVP8 "))).toEqual({ contentType: "image/webp", kind: "image" });
  });

  it("knows clips", () => {
    expect(sniffMedia(ftyp("isom"))).toEqual({ contentType: "video/mp4", kind: "video" });
    expect(sniffMedia(ftyp("qt  "))).toEqual({ contentType: "video/quicktime", kind: "video" });
    expect(sniffMedia(ebml("webm"))).toEqual({ contentType: "video/webm", kind: "video" });
    expect(sniffMedia(ebml("matroska"))).toEqual({ contentType: "video/x-matroska", kind: "video" });
    expect(sniffMedia(riff("AVI LIST"))).toEqual({ contentType: "video/x-msvideo", kind: "video" });
  });

  it("knows sound", () => {
    expect(sniffMedia(ftyp("M4A "))).toEqual({ contentType: "audio/mp4", kind: "audio" });
    expect(sniffMedia(ebml("webm"), "audio/webm")).toEqual({ contentType: "audio/webm", kind: "audio" });
    expect(sniffMedia(riff("WAVEfmt "))).toEqual({ contentType: "audio/wav", kind: "audio" });
    expect(sniffMedia(pad("OggS"))).toEqual({ contentType: "audio/ogg", kind: "audio" });
    expect(sniffMedia(pad("fLaC"))).toEqual({ contentType: "audio/flac", kind: "audio" });
    expect(sniffMedia(pad("ID3\x04"))).toEqual({ contentType: "audio/mpeg", kind: "audio" });
    expect(sniffMedia(pad(Buffer.from([0xff, 0xfb, 0x90, 0x64])))).toEqual({ contentType: "audio/mpeg", kind: "audio" });
  });

  it("refuses GIF (unless allowed), SVG, HTML and ZIP, whatever the declared type", () => {
    expect(sniffMedia(pad("GIF89a"), "image/gif")).toBeNull();
    expect(sniffMedia(pad("GIF89a"), "image/gif", { gif: true })).toEqual({ contentType: "image/gif", kind: "image" });
    expect(sniffMedia(pad('<svg xmlns="http://www.w3.org/2000/svg">'), "image/svg+xml")).toBeNull();
    expect(sniffMedia(pad("<!doctype html><script>alert(1)</script>"), "image/png")).toBeNull();
    expect(sniffMedia(pad("PK\x03\x04"), "video/mp4")).toBeNull();
    expect(sniffMedia(Buffer.from("ab"))).toBeNull();
  });
});
