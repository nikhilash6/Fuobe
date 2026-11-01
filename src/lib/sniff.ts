/**
 * What a file is, from its first bytes (at least 64): the stored type of an upload is this one, never the type the
 * client declared, so a page or a script can't be stored as a picture. Pictures (PNG, JPEG, WebP; GIF only when
 * `gif` is allowed), clips (MP4, MOV, WebM, Matroska, AVI) and sound (MP3, WAV, OGG, FLAC, M4A, WebM). Never SVG or
 * HTML. Null when it is none of these.
 */
export type SniffKind = "image" | "video" | "audio";

export interface Sniffed {
  contentType: string;
  kind: SniffKind;
}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/** The EBML DocType of a WebM / Matroska file ("webm" or "matroska"), read from its header. */
function ebmlDocType(b: Uint8Array): string | null {
  // The DocType element: id 0x4282, a one-byte size (0x80 | n), then n bytes.
  for (let i = 4; i < Math.min(b.length - 3, 64); i++) {
    if (b[i] === 0x42 && b[i + 1] === 0x82) {
      const n = b[i + 2] & 0x7f;
      if (b[i + 2] & 0x80 && n > 0 && i + 3 + n <= b.length) return ascii(b, i + 3, n).toLowerCase();
    }
  }
  return null;
}

export function sniffMedia(head: Uint8Array, declared?: string, opts: { gif?: boolean } = {}): Sniffed | null {
  const b = head;
  if (b.length < 4) return null;
  const said = (declared ?? "").split(";")[0].trim().toLowerCase();
  // Pictures.
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { contentType: "image/png", kind: "image" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { contentType: "image/jpeg", kind: "image" };
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return { contentType: "image/webp", kind: "image" };
  if (opts.gif && b.length >= 6 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return { contentType: "image/gif", kind: "image" };
  // ISO base media (MP4, MOV, M4A): "ftyp" at offset 4, then the brand.
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp") {
    const brand = ascii(b, 8, 4);
    if (brand === "qt  ") return { contentType: "video/quicktime", kind: "video" };
    // An M4A says so in its brand; other sound in an MP4 box goes by the type declared.
    if (brand === "M4A " || brand === "M4B " || said.startsWith("audio/")) return { contentType: "audio/mp4", kind: "audio" };
    return { contentType: "video/mp4", kind: "video" };
  }
  // A QuickTime file that starts with another atom ("moov", "mdat", "wide", "free").
  if (b.length >= 8 && ["moov", "mdat", "wide", "free", "skip"].includes(ascii(b, 4, 4)) && said === "video/quicktime") return { contentType: "video/quicktime", kind: "video" };
  // WebM and Matroska.
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    const doc = ebmlDocType(b);
    if (doc === "webm") return said.startsWith("audio/") ? { contentType: "audio/webm", kind: "audio" } : { contentType: "video/webm", kind: "video" };
    if (doc === "matroska") return { contentType: "video/x-matroska", kind: "video" };
    return null;
  }
  // RIFF: AVI and WAV.
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF") {
    const form = ascii(b, 8, 4);
    if (form === "AVI ") return { contentType: "video/x-msvideo", kind: "video" };
    if (form === "WAVE") return { contentType: "audio/wav", kind: "audio" };
    return null;
  }
  if (ascii(b, 0, 4) === "OggS") return { contentType: "audio/ogg", kind: "audio" };
  if (ascii(b, 0, 4) === "fLaC") return { contentType: "audio/flac", kind: "audio" };
  // MP3: an ID3 tag, or an MPEG audio frame sync (11 bits set; layer bits not 00).
  if (ascii(b, 0, 3) === "ID3") return { contentType: "audio/mpeg", kind: "audio" };
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0) return { contentType: "audio/mpeg", kind: "audio" };
  return null;
}
