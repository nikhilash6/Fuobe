import zlib from "node:zlib";
import { describe, expect, it } from "vitest";

const { decodePng, encodePng } = await import("@/server/png");

function crc32(b: Buffer): number {
  let crc = 0xffffffff;
  for (const x of b) {
    crc ^= x;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(width: number, height: number, idat: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

describe("decodePng has limits", () => {
  it("refuses a picture over 40 megapixels before inflating anything", () => {
    const t = Date.now();
    expect(() => decodePng(png(100_000, 100_000, zlib.deflateSync(Buffer.alloc(10))))).toThrow(/megapixels/);
    expect(Date.now() - t).toBeLessThan(500);
  });

  it("stops inflating at what the picture needs (a deflate bomb)", () => {
    // 4 × 4 RGBA needs 4 × (16 + 1) = 68 bytes; this inflates to 64 MB.
    const bomb = zlib.deflateSync(Buffer.alloc(64 * 2 ** 20));
    expect(() => decodePng(png(4, 4, bomb))).toThrow();
  });

  it("still decodes a normal picture", () => {
    const img = { width: 3, height: 2, data: Buffer.alloc(3 * 2 * 4, 200) };
    expect(decodePng(encodePng(img))).toMatchObject({ width: 3, height: 2 });
  });
});
