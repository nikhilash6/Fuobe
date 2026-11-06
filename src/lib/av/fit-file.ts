/**
 * What an upload needs before it goes (src/lib/upload.ts), decided from the file's type and name only: the browser half
 * (src/components/av/fit-file.ts) then converts it. The upload route takes PNG, JPEG, WebP or GIF pictures, MP4, MOV,
 * WebM, MKV or AVI clips and MP3, WAV, OGG, FLAC, M4A or WebM sound (an account: a picture of up to 25 MB and
 * 40 megapixels, a sound of up to 50 MB).
 *
 * - A type the route knows under another name (Chrome's audio/x-m4a): sent under the route's name, as it is.
 * - A photo the route can't take (HEIC, AVIF, TIFF, BMP): converted to a JPEG (a WebP when it may have see-through parts).
 * - A sound the route can't take (AAC, Opus, AIFF, CAF, WMA, AMR): converted to an MP3.
 * - Refused for its size or type all the same (an account's caps, an account's GIF): made to fit once, and sent again.
 * Each conversion follows the owner's switches (src/lib/av/upload-switches.ts).
 */

/** The route's own names for types browsers name otherwise. */
const ALIASES: Record<string, string> = {
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/aacp": "audio/aac",
  "audio/x-flac": "audio/flac",
  "audio/wave": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "audio/mp3": "audio/mpeg",
  "audio/x-mp3": "audio/mpeg",
  "audio/x-mpeg": "audio/mpeg",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
};

const TAKEN = /^(image\/(png|jpeg|webp|gif)|video\/.+|audio\/(mpeg|wav|x-wav|ogg|flac|mp4|webm))$/;

/** By extension, for a file the browser gives no type. */
const EXT_TYPE: Record<string, string> = {
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  tif: "image/tiff",
  tiff: "image/tiff",
  bmp: "image/bmp",
  aac: "audio/aac",
  opus: "audio/opus",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  caf: "audio/x-caf",
  wma: "audio/x-ms-wma",
  amr: "audio/amr",
  m4a: "audio/mp4",
};

const ext = (name: string) => /\.([a-z0-9]{2,5})$/i.exec(name)?.[1]?.toLowerCase() ?? "";

/** The file's type as the upload route reads it ("" when only its name could say, and it doesn't). */
export function uploadType(file: { type?: string; name?: string }): string {
  const t = (file.type ?? "").split(";")[0].trim().toLowerCase();
  const given = t && t !== "application/octet-stream" ? t : (EXT_TYPE[ext(file.name ?? "")] ?? "");
  return ALIASES[given] ?? given;
}

export type FileFit =
  /** Send it as it is (under `type` when that differs from the file's own). */
  | { kind: "send"; type?: string }
  /** Convert a photo, or a sound. */
  | { kind: "photo" }
  | { kind: "sound" };

/** What a file needs before it is sent: from its type and name only. */
export function fitBeforeSend(file: { type?: string; name?: string }): FileFit {
  const type = uploadType(file);
  if (!type || TAKEN.test(type)) return { kind: "send", ...(type && type !== (file.type ?? "").toLowerCase() && { type }) };
  if (type.startsWith("image/")) return { kind: "photo" };
  if (type.startsWith("audio/")) return { kind: "sound" };
  return { kind: "send" };
}

/** An account's caps (src/server/account-files.ts ACCOUNT_LIMITS: a test keeps them the same). */
export const ACCOUNT_PHOTO_BYTES = 25 * 1024 * 1024;
export const ACCOUNT_PHOTO_PIXELS = 40_000_000;
export const ACCOUNT_SOUND_BYTES = 50 * 1024 * 1024;

/**
 * After the route refused a file (413: too big; 415: a type it doesn't take): what to make of it, or null when there's
 * nothing to fit (a clip, a full allowance, anything else).
 */
export function fitAfterRefusal(file: { type?: string; name?: string; size: number }, status: number): FileFit | null {
  if (status !== 413 && status !== 415) return null;
  const type = uploadType(file);
  if (type.startsWith("image/")) return { kind: "photo" };
  if (type.startsWith("audio/")) return { kind: "sound" };
  return null;
}

/** Whether a photo may have see-through parts (kept as a WebP where the browser saves one). */
export const mayHaveAlpha = (file: { type?: string; name?: string }) => /^image\/(png|webp|gif|avif|heic|heif|tiff)$/.test(uploadType(file));
