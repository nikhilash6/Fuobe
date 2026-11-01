import "server-only";
import zlib from "node:zlib";
import { tenant } from "./tenant";

/**
 * Minimal 8-bit PNG decode/encode, enough to convert the masks Fuobe's own editor exports
 * (and most other non-interlaced 8-bit PNGs) between provider conventions:
 *   white — white = change (ComfyUI, FLUX Fill)      black — black = change (Ideogram)
 *   alpha — transparent = change (OpenAI GPT Image)
 */
export type MaskFormat = "white" | "black" | "alpha";

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** The largest picture decodePng takes in an account's work (40 megapixels: 160 MB of RGBA). */
export const MAX_PNG_PIXELS = 40_000_000;
/** The owner's own pictures: far more (a 48 MP photo's mask, a large face mosaic), still a bound (2 GB of RGBA). */
export const OWNER_MAX_PNG_PIXELS = 500_000_000;

/** The pixel limit for the work in hand: an account's or a visitor's (tenant.ts), or the owner's. */
export const pngPixelLimit = (): number => (tenant() ? MAX_PNG_PIXELS : OWNER_MAX_PNG_PIXELS);

interface Decoded {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Buffer;
}

export function decodePng(buf: Buffer, maxPixels = pngPixelLimit()): Decoded {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error("Not a PNG");
  let off = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const kind = buf.toString("ascii", off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (kind === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      type = body[9];
      interlace = body[12];
    } else if (kind === "IDAT") idat.push(body);
    else if (kind === "IEND") break;
    off += 12 + len;
  }
  const ch = CHANNELS[type];
  if (depth !== 8 || !ch || interlace) throw new Error("Unsupported PNG (need 8-bit, non-interlaced, no palette)");
  // Refused before anything is inflated: a few kilobytes can claim gigabytes of pixels.
  if (!width || !height || width * height > maxPixels) throw new Error(`That picture is over ${Math.round(maxPixels / 1e6)} megapixels`);
  // Never more than the picture needs (a row of filter byte + pixels, per row).
  const raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: height * (width * ch + 1) });
  const stride = width * ch;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = px.subarray(y * stride, (y + 1) * stride);
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = v & 0xff;
    }
  }
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * ch;
    const [r, g, b] = ch >= 3 ? [px[s], px[s + 1], px[s + 2]] : [px[s], px[s], px[s]];
    const alpha = ch === 4 ? px[s + 3] : ch === 2 ? px[s + 1] : 255;
    data.set([r, g, b, alpha], i * 4);
  }
  return { width, height, data };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(kind: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(kind, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

export function encodePng({ width, height, data }: Decoded): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([SIG, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Convert a white-means-change mask to another convention. */
export function convertMask(png: Buffer, to: MaskFormat): Buffer {
  if (to === "white") return png;
  const img = decodePng(png);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // Treat transparent pixels as "keep" and bright opaque pixels as "change".
    const change = (d[i] + d[i + 1] + d[i + 2]) / 3 > 127 && d[i + 3] > 127;
    if (to === "black") d.set(change ? [0, 0, 0, 255] : [255, 255, 255, 255], i);
    else d.set(change ? [0, 0, 0, 0] : [0, 0, 0, 255], i);
  }
  return encodePng(img);
}
