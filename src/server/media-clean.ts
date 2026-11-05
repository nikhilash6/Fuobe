import "server-only";
/**
 * Files on a share page go out without the generation data saved inside them. ComfyUI writes its
 * whole API prompt (every node's inputs: the prompt, the negative prompt, seeds, LoRAs, input file
 * names) and the workflow into what it saves: PNG text chunks, MP4/MOV and WebM/MKV tags, FLAC, MP3
 * and Ogg tags, GLB asset.extras, an SVG <metadata> block. Other tools write EXIF/XMP. A page whose
 * owner hid the prompts must not hand them out in its files, so the share files route serves every
 * file through these patches (src/server/file-response.ts, `clean`).
 *
 * Each patch blanks bytes in place without changing the file's size or any offset: a metadata
 * chunk or box is renamed to one every reader skips (a private PNG chunk, MP4 `free`, Matroska
 * `Void`, FLAC PADDING, RIFF `JUNK`, a JPEG comment) and its contents are zeroed (an Ogg comment is
 * overwritten with blanks and its page's checksum worked out again). So byte ranges
 * (video seeking) work on the cleaned file exactly as on the stored one, and nothing is copied: the
 * patches overlay the stream as it is read. A file whose structure can't be read where metadata
 * lives gives null (the route then refuses it); formats that carry none (text, GIF, PLY, …) pass.
 */
import fs from "node:fs";
import { Transform } from "node:stream";

/** Bytes to write at `at`, or `length` bytes of `fill` there. */
export type Patch = { at: number; bytes: Buffer } | { at: number; length: number; fill: number };

const span = (p: Patch) => ("bytes" in p ? p.bytes.length : p.length);
const zeros = (at: number, length: number): Patch => ({ at, length, fill: 0 });

/** A chunk of the file read from `pos`, with the patches that touch it applied (a copy when any does). */
export function overlay(chunk: Buffer, pos: number, patches: Patch[]): Buffer {
  let out = chunk;
  const end = pos + chunk.length;
  for (const p of patches) {
    const s = p.at;
    const e = s + span(p);
    if (e <= pos || s >= end) continue;
    if (out === chunk) out = Buffer.from(chunk);
    const from = Math.max(s, pos);
    const to = Math.min(e, end);
    if ("bytes" in p) p.bytes.copy(out, from - pos, from - s, to - s);
    else out.fill(p.fill, from - pos, to - pos);
  }
  return out;
}

/** A stream transform that applies the patches to a file read from `start`. */
export function patchStream(patches: Patch[], start: number): Transform {
  let pos = start;
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      const out = overlay(chunk, pos, patches);
      pos += chunk.length;
      done(null, out);
    },
  });
}

// ---------------------------------------------------------------------------
// Reading

/** A file read by its descriptor, or a file already in memory (`fd` a Buffer). */
class Reader {
  constructor(
    private readonly fd: number | Buffer,
    readonly size: number,
  ) {}
  read(at: number, n: number): Buffer {
    const len = Math.max(0, Math.min(n, this.size - at));
    if (typeof this.fd !== "number") return Buffer.from(this.fd.subarray(at, at + len));
    const buf = Buffer.alloc(len);
    let got = 0;
    while (got < len) {
      const r = fs.readSync(this.fd, buf, got, len - got, at + got);
      if (!r) break;
      got += r;
    }
    return got === len ? buf : buf.subarray(0, got);
  }
}

class Unreadable extends Error {}
const need = (ok: boolean) => {
  if (!ok) throw new Unreadable();
};

// CRC-32 (PNG chunks).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: (Buffer | number)[]): number {
  let c = 0xffffffff;
  for (const p of parts) {
    if (typeof p === "number") for (let i = 0; i < p; i++) c = CRC_TABLE[c & 0xff] ^ (c >>> 8);
    else for (const b of p) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const u32be = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};

// ---------------------------------------------------------------------------
// Formats

/** PNG: tEXt / zTXt / iTXt / eXIf become a private chunk every decoder skips ("fuPd"), zeroed, with a fresh CRC. */
function png(r: Reader): Patch[] {
  const out: Patch[] = [];
  const NAME = Buffer.from("fuPd");
  let at = 8;
  for (;;) {
    const h = r.read(at, 8);
    need(h.length === 8);
    const len = h.readUInt32BE(0);
    const type = h.toString("latin1", 4, 8);
    need(at + 12 + len <= r.size);
    if (type === "tEXt" || type === "zTXt" || type === "iTXt" || type === "eXIf") {
      out.push({ at: at + 4, bytes: NAME }, zeros(at + 8, len), { at: at + 8 + len, bytes: u32be(crc32([NAME, len])) });
    }
    at += 12 + len;
    if (type === "IEND" || at >= r.size) return out;
  }
}

/** JPEG: EXIF/XMP (APP1), APP3–APP13, APP15 and comments become zeroed comments. JFIF, ICC (APP2) and Adobe (APP14) stay. */
function jpeg(r: Reader): Patch[] {
  const out: Patch[] = [];
  let at = 2;
  for (;;) {
    const h = r.read(at, 4);
    need(h.length >= 2 && h[0] === 0xff);
    const m = h[1];
    if (m === 0xff) {
      at += 1; // fill byte
      continue;
    }
    if (m === 0xd9 || m === 0xda) return out; // end, or the image data (no metadata after it)
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      at += 2;
      continue;
    }
    need(h.length === 4);
    const len = h.readUInt16BE(2);
    need(len >= 2 && at + 2 + len <= r.size);
    const app = m >= 0xe0 && m <= 0xef;
    if ((app && m !== 0xe0 && m !== 0xe2 && m !== 0xee) || m === 0xfe) out.push({ at: at + 1, bytes: Buffer.from([0xfe]) }, zeros(at + 4, len - 2));
    at += 2 + len;
  }
}

/**
 * RIFF (WebP, WAV, RF64): metadata chunks become JUNK, zeroed; WebP's VP8X flags stop announcing
 * EXIF/XMP. A file written to a pipe can't go back to fill in its sizes (0 or 0xFFFFFFFF, and RF64
 * keeps the real ones elsewhere), so a size past the end of the file means "to the end".
 */
function riff(r: Reader, webp: boolean): Patch[] {
  const out: Patch[] = [];
  const META = webp ? new Set(["EXIF", "XMP "]) : new Set(["LIST", "id3 ", "ID3 ", "bext", "iXML", "_PMX", "XMP ", "EXIF"]);
  const declared = r.read(4, 4).readUInt32LE(0);
  const end = declared === 0 ? r.size : Math.min(r.size, 8 + declared);
  let at = 12;
  while (at + 8 <= end) {
    const h = r.read(at, 9);
    const id = h.toString("latin1", 0, 4);
    const len = h.readUInt32LE(4);
    // A chunk running past the end (a streamed `data` chunk, a cut-off file) is the last one.
    const last = at + 8 + len > r.size;
    if (META.has(id)) out.push({ at, bytes: Buffer.from("JUNK") }, zeros(at + 8, last ? r.size - at - 8 : len));
    if (webp && id === "VP8X" && h.length === 9 && h[8] & 0x0c) out.push({ at: at + 8, bytes: Buffer.from([h[8] & ~0x0c]) });
    if (last) break;
    at += 8 + len + (len & 1);
  }
  return out;
}

const IMAGE_BRANDS = new Set(["avif", "avis", "heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);
const XMP_UUID = "be7acfcb97a942e89c71999491e3afac";

/** MP4 / MOV: user data and metadata boxes in the movie and its tracks (and an XMP uuid box) become `free`, zeroed. */
function isoBmff(r: Reader): Patch[] {
  const out: Patch[] = [];
  const blank = (start: number, header: number, end: number) => out.push({ at: start + 4, bytes: Buffer.from("free") }, zeros(start + header, end - start - header));
  // `cut`: the file's own top level, where the last box may run past the end (a cut-off download,
  // a recording that stopped): it then ends with the file. Inside a box sizes must add up.
  const boxes = (from: number, to: number, cut = false) => {
    const list: { type: string; start: number; header: number; end: number }[] = [];
    let at = from;
    while (at + 8 <= to) {
      const h = r.read(at, 16);
      let size = h.readUInt32BE(0);
      let header = 8;
      if (size === 1) {
        need(h.length === 16);
        size = Number(h.readBigUInt64BE(8));
        header = 16;
      } else if (size === 0) size = to - at;
      need(size >= header);
      const type = h.toString("latin1", 4, 8);
      if (at + size > to) {
        need(cut && type !== "moov");
        list.push({ type, start: at, header, end: to });
        return list;
      }
      list.push({ type, start: at, header, end: at + size });
      at += size;
    }
    need(at === to || to - at < 8);
    return list;
  };
  const top = boxes(0, r.size, true);
  const ftyp = top.find((b) => b.type === "ftyp");
  const brand = ftyp ? r.read(ftyp.start + 8, 4).toString("latin1") : "";
  // A HEIF/AVIF image keeps its top-level meta: that's where its picture is described.
  const movie = top.some((b) => b.type === "moov") && !IMAGE_BRANDS.has(brand);
  // The movie's and each track's user data and metadata; the track list is inside moov.
  const walk = (list: typeof top, parent: "" | "moov" | "trak") => {
    for (const b of list) {
      if ((parent === "" && b.type === "moov") || (parent === "moov" && b.type === "trak")) walk(boxes(b.start + b.header, b.end), b.type as "moov" | "trak");
      else if ((b.type === "udta" || b.type === "meta") && (parent !== "" || movie)) blank(b.start, b.header, b.end);
      else if (b.type === "uuid" && parent === "" && r.read(b.start + b.header, 16).toString("hex") === XMP_UUID) blank(b.start, b.header, b.end);
    }
  };
  walk(top, "");
  return out;
}

const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const CLUSTER = 0x1f43b675;
const TAGS = 0x1254c367;
const INFO = 0x1549a966;
const TITLE = 0x7ba9;
/** Segment-level elements: one of these ends a cluster of unknown size. */
const CLUSTER_ENDS = new Set([0x114d9b74, INFO, 0x1654ae6b, CLUSTER, 0x1c53bb6b, 0x1941a469, 0x1043a770, TAGS]);

/** WebM / MKV: the Tags element (where every tag lives) and the segment's Title become Void elements of the same length. */
function matroska(r: Reader): Patch[] {
  const out: Patch[] = [];
  const vint = (at: number, keepMarker: boolean) => {
    const b = r.read(at, 8);
    need(b.length > 0 && b[0] !== 0);
    const len = Math.clz32(b[0]) - 23;
    need(len <= 8 && b.length >= len);
    let value = keepMarker ? b[0] : b[0] & (0xff >> len);
    let ones = value === 0xff >> len;
    for (let i = 1; i < len; i++) {
      value = value * 256 + b[i];
      ones &&= b[i] === 0xff;
    }
    return { len, value, unknown: !keepMarker && ones };
  };
  const element = (at: number) => {
    const id = vint(at, true);
    const size = vint(at + id.len, false);
    return { id: id.value, start: at, data: at + id.len + size.len, end: size.unknown ? null : at + id.len + size.len + size.value };
  };
  const voidOf = (start: number, end: number) => {
    const total = end - start;
    const k = Math.min(8, total - 1);
    const v = total - 1 - k;
    const head = Buffer.alloc(1 + k);
    head[0] = 0xec;
    let rest = v;
    for (let i = k; i >= 1; i--) {
      head[i] = rest % 256;
      rest = Math.floor(rest / 256);
    }
    head[1] |= 1 << (8 - k);
    out.push({ at: start, bytes: head }, zeros(start + 1 + k, v));
  };
  let at = 0;
  while (at < r.size) {
    const e = element(at);
    if (e.id === EBML) {
      need(e.end !== null && e.end <= r.size);
      at = e.end!;
      continue;
    }
    need(e.id === SEGMENT);
    const segEnd = Math.min(e.end ?? r.size, r.size);
    let c = e.data;
    while (c < segEnd) {
      const child = element(c);
      if (child.end !== null) {
        // A cut-off file: its last cluster (or cues) ends with the file; cut metadata isn't readable.
        if (child.end > segEnd) {
          need(child.id !== TAGS && child.id !== INFO);
          break;
        }
        if (child.id === TAGS) voidOf(child.start, child.end);
        // The segment's title (ffmpeg writes a "title" tag there).
        if (child.id === INFO) {
          for (let i = child.data; i < child.end; ) {
            const field = element(i);
            need(field.end !== null && field.end <= child.end);
            if (field.id === TITLE) voidOf(field.start, field.end!);
            i = field.end!;
          }
        }
        c = child.end;
        continue;
      }
      // A cluster of unknown size (a live writer) ends where the next segment-level element starts.
      need(child.id === CLUSTER);
      c = child.data;
      while (c < segEnd) {
        const inner = element(c);
        if (CLUSTER_ENDS.has(inner.id)) break;
        need(inner.end !== null && inner.end <= segEnd);
        c = inner.end!;
      }
    }
    at = segEnd;
  }
  return out;
}

/** An ID3v2 tag at `at`: its frames become padding (zeros). Returns where the audio starts. */
function id3v2(r: Reader, at: number, out: Patch[]): number {
  const h = r.read(at, 10);
  need(h.length === 10);
  const size = (h[6] & 0x7f) * 2 ** 21 + (h[7] & 0x7f) * 2 ** 14 + (h[8] & 0x7f) * 2 ** 7 + (h[9] & 0x7f);
  need(at + 10 + size <= r.size);
  out.push({ at: at + 5, bytes: Buffer.from([0]) }, zeros(at + 10, size));
  return at + 10 + size + (h[5] & 0x10 ? 10 : 0);
}

/** MP3: the ID3v2 tag's frames become padding; an ID3v1 tag at the end is emptied. */
function mp3(r: Reader): Patch[] {
  const out: Patch[] = [];
  if (r.read(0, 3).toString("latin1") === "ID3") id3v2(r, 0, out);
  // An empty ID3v1 tag (no genre) rather than 128 zero bytes a decoder would take for audio.
  if (r.size >= 128 && r.read(r.size - 128, 3).toString("latin1") === "TAG") out.push(zeros(r.size - 125, 124), { at: r.size - 1, bytes: Buffer.from([0xff]) });
  return out;
}

/** FLAC: VORBIS_COMMENT blocks become PADDING, zeroed (and a leading ID3 tag is blanked). */
function flac(r: Reader): Patch[] {
  const out: Patch[] = [];
  let at = r.read(0, 3).toString("latin1") === "ID3" ? id3v2(r, 0, out) : 0;
  need(r.read(at, 4).toString("latin1") === "fLaC");
  at += 4;
  for (;;) {
    const h = r.read(at, 4);
    need(h.length === 4);
    const last = h[0] & 0x80;
    const type = h[0] & 0x7f;
    const len = h.readUIntBE(1, 3);
    need(at + 4 + len <= r.size);
    if (type === 4) out.push({ at, bytes: Buffer.from([last | 1]) }, zeros(at + 4, len));
    at += 4 + len;
    if (last) return out;
  }
}

const OGG_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n << 24;
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Ogg (Opus, Vorbis, Theora): each comment in the comment header becomes "_=" and spaces; its pages get fresh CRCs. */
function ogg(r: Reader): Patch[] {
  // The first stream's second packet, as pieces of page bodies.
  const pieces: { page: number; from: number; len: number }[] = [];
  const pages = new Map<number, number>(); // page start → page end
  let serial: number | null = null;
  let packet = 0;
  let at = 0;
  while (packet < 2) {
    const h = r.read(at, 27);
    need(h.length === 27 && h.toString("latin1", 0, 4) === "OggS");
    const table = r.read(at + 27, h[26]);
    need(table.length === h[26]);
    let off = at + 27 + table.length;
    const end = off + table.reduce((a, b) => a + b, 0);
    need(end <= r.size);
    serial ??= h.readUInt32LE(14);
    if (h.readUInt32LE(14) === serial) {
      for (const seg of table) {
        if (packet === 1) {
          pieces.push({ page: at, from: off, len: seg });
          pages.set(at, end);
        }
        off += seg;
        if (seg < 255 && ++packet === 2) break;
      }
    }
    at = end;
  }
  const body = Buffer.concat(pieces.map((p) => r.read(p.from, p.len)));
  const head = body.toString("latin1", 0, 8);
  const start = head === "OpusTags" ? 8 : /^[\x03\x81](vorbis|theora)$/.test(body.toString("latin1", 0, 7)) ? 7 : -1;
  if (start < 0) return []; // another codec's header: no comments in this layout
  const edited = Buffer.from(body);
  let p = start;
  need(p + 4 <= body.length);
  p += 4 + body.readUInt32LE(p);
  need(p + 4 <= body.length);
  const count = body.readUInt32LE(p);
  p += 4;
  for (let i = 0; i < count; i++) {
    need(p + 4 <= body.length);
    const len = body.readUInt32LE(p);
    p += 4;
    need(p + len <= body.length);
    edited.fill(0x20, p, p + len);
    edited.write("_=".slice(0, len), p, "latin1");
    p += len;
  }
  // Rewrite each page that carries the packet, with its CRC worked out again.
  const out: Patch[] = [];
  let k = 0;
  for (const [page, end] of pages) {
    const bytes = r.read(page, end - page);
    for (const piece of pieces) {
      if (piece.page === page) edited.copy(bytes, piece.from - page, k, k + piece.len);
      if (piece.page === page) k += piece.len;
    }
    bytes.writeUInt32LE(0, 22);
    let c = 0;
    for (const b of bytes) c = ((c << 8) ^ OGG_TABLE[((c >>> 24) ^ b) & 0xff]) >>> 0;
    bytes.writeUInt32LE(c, 22);
    out.push({ at: page, bytes });
  }
  return out;
}

/** GLB: the JSON chunk without `extras` on the asset or the root, padded with spaces to its old length. */
function glb(r: Reader): Patch[] {
  const h = r.read(12, 8);
  need(h.length === 8 && h.toString("latin1", 4, 8) === "JSON");
  const len = h.readUInt32LE(0);
  need(20 + len <= r.size && len < 64 * 1024 * 1024);
  const text = r.read(20, len).toString("utf8");
  let doc: { asset?: { extras?: unknown }; extras?: unknown };
  try {
    doc = JSON.parse(text) as typeof doc;
  } catch {
    throw new Unreadable();
  }
  if (doc.asset?.extras === undefined && doc.extras === undefined) return [];
  delete doc.asset?.extras;
  delete doc.extras;
  const next = Buffer.from(JSON.stringify(doc), "utf8");
  need(next.length <= len);
  return [{ at: 20, bytes: Buffer.concat([next, Buffer.alloc(len - next.length, 0x20)]) }];
}

/** SVG: what's inside each <metadata> element becomes spaces. */
function svg(r: Reader): Patch[] {
  need(r.size < 32 * 1024 * 1024);
  const text = r.read(0, r.size).toString("latin1");
  const lower = text.toLowerCase();
  const out: Patch[] = [];
  const open = /<metadata\b[^>]*>/gi;
  for (let m = open.exec(text); m; m = open.exec(text)) {
    const from = m.index + m[0].length;
    const close = lower.indexOf("</metadata", from);
    need(close >= 0);
    if (close > from) out.push({ at: from, length: close - from, fill: 0x20 });
    open.lastIndex = close;
  }
  return out;
}

/** The patches that clear a file's embedded metadata ([] when it has none), or null when it can't be read. */
export function metadataPatches(abs: string, contentType = ""): Patch[] | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(abs, "r");
    const r = new Reader(fd, fs.fstatSync(fd).size);
    const head = r.read(0, 16);
    const at = (s: string, i = 0) => head.toString("latin1", i, i + s.length) === s;
    if (head.length >= 8 && head.readUInt32BE(0) === 0x89504e47) return png(r);
    if (head[0] === 0xff && head[1] === 0xd8) return jpeg(r);
    if (at("RIFF") && at("WEBP", 8)) return riff(r, true);
    if ((at("RIFF") || at("RF64")) && at("WAVE", 8)) return riff(r, false);
    if (head.length >= 4 && head.readUInt32BE(0) === EBML) return matroska(r);
    if (at("glTF")) return glb(r);
    if (at("OggS")) return ogg(r);
    if (at("fLaC")) return flac(r);
    // An ID3 tag starts MP3s and, now and then, a FLAC file: what follows it tells them apart.
    if (at("ID3")) return r.read(id3v2(r, 0, []), 4).toString("latin1") === "fLaC" ? flac(r) : mp3(r);
    if (/audio\/(mpeg|mp3)/.test(contentType)) return mp3(r);
    if (head.length >= 8 && /^(ftyp|moov|mdat|free|skip|wide|pnot|uuid)$/.test(head.toString("latin1", 4, 8))) return isoBmff(r);
    if (contentType === "image/svg+xml") return svg(r);
    return [];
  } catch (e) {
    if (e instanceof Unreadable || e instanceof RangeError) return null;
    throw e;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const cache = new Map<string, Patch[] | null>();

/** metadataPatches, remembered per file version (path, size, modified time). Stored files don't change. */
export function cachedPatches(abs: string, stat: { size: number; mtimeMs: number }, contentType: string): Patch[] | null {
  const key = `${abs}\0${stat.size}\0${stat.mtimeMs}`;
  if (cache.has(key)) return cache.get(key)!;
  const patches = metadataPatches(abs, contentType);
  if (cache.size >= 500) cache.delete(cache.keys().next().value!);
  cache.set(key, patches);
  return patches;
}

// ---------------------------------------------------------------------------
// Pictures sent on to another machine

/**
 * A JPEG's EXIF block made again with only its orientation (1 to 8): "Exif", a big-endian TIFF header and one IFD with
 * the one tag. 32 bytes: it fits in any EXIF segment that held an orientation.
 */
function orientationOnly(orientation: number): Buffer {
  const b = Buffer.alloc(32);
  b.write("Exif", 0, "latin1");
  b.write("MM", 6, "latin1");
  b.writeUInt16BE(42, 8);
  b.writeUInt32BE(8, 10);
  b.writeUInt16BE(1, 14);
  b.writeUInt16BE(0x0112, 16);
  b.writeUInt16BE(3, 18);
  b.writeUInt32BE(1, 20);
  b.writeUInt16BE(orientation, 24);
  return b;
}

/** A JPEG's EXIF orientation (other than 1), read from its first EXIF segment: the patches that keep only it there. */
function keepOrientation(r: Reader): Patch[] {
  let at = 2;
  for (;;) {
    const h = r.read(at, 4);
    if (h.length < 4 || h[0] !== 0xff) return [];
    const m = h[1];
    if (m === 0xff) {
      at += 1;
      continue;
    }
    if (m === 0xd9 || m === 0xda) return [];
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      at += 2;
      continue;
    }
    const len = h.readUInt16BE(2);
    if (len < 2) return [];
    if (m === 0xe1 && len - 2 >= 32 && r.read(at + 4, 6).toString("latin1") === "Exif\0\0") {
      const exif = r.read(at + 4, len - 2);
      const o = tiffOrientation(exif);
      // After the patches that blank the segment: it stays EXIF, with the orientation alone in it.
      return o && o !== 1 ? [{ at: at + 1, bytes: Buffer.from([0xe1]) }, { at: at + 4, bytes: orientationOnly(o) }] : [];
    }
    at += 2 + len;
  }
}

/** The orientation tag (0x0112) of IFD0 in an EXIF block ("Exif\0\0" and a TIFF header), or null. */
function tiffOrientation(exif: Buffer): number | null {
  const start = 6;
  if (exif.length < start + 8) return null;
  const le = exif.toString("latin1", start, start + 2) === "II";
  if (!le && exif.toString("latin1", start, start + 2) !== "MM") return null;
  const u16 = (o: number) => (le ? exif.readUInt16LE(o) : exif.readUInt16BE(o));
  const u32 = (o: number) => (le ? exif.readUInt32LE(o) : exif.readUInt32BE(o));
  const ifd = start + u32(start + 4);
  if (ifd + 2 > exif.length) return null;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > exif.length) return null;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

/**
 * A picture with what it carries besides its pixels blanked, as the share files are (the same patches): a JPEG's EXIF,
 * XMP, comments and other application segments, a PNG's text and EXIF chunks, a WebP's EXIF and XMP, an SVG's
 * metadata. Nothing is decoded, and the size and every offset stay. A JPEG keeps its EXIF orientation (alone in its EXIF
 * segment), so it shows the way it did. The same bytes back when there was nothing to blank; null for any other kind of
 * picture (a GIF, say: it is made again from its pixels instead), or one that can't be read where such data lives.
 */
export function pictureWithoutMetadata(data: Buffer, contentType = ""): Buffer | null {
  try {
    const r = new Reader(data, data.length);
    const head = r.read(0, 16);
    const at = (s: string, i = 0) => head.toString("latin1", i, i + s.length) === s;
    let patches: Patch[] = [];
    if (head.length >= 8 && head.readUInt32BE(0) === 0x89504e47) patches = png(r);
    else if (head[0] === 0xff && head[1] === 0xd8) patches = [...jpeg(r), ...keepOrientation(r)];
    else if (at("RIFF") && at("WEBP", 8)) patches = riff(r, true);
    else if (contentType.split(";")[0].trim().toLowerCase() === "image/svg+xml") patches = svg(r);
    else return null;
    return patches.length ? overlay(data, 0, patches) : data;
  } catch (e) {
    if (e instanceof Unreadable || e instanceof RangeError) return null;
    throw e;
  }
}
