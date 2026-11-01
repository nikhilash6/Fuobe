/**
 * The name a picture gets in ComfyUI's input folder: "fuobe_lv" and 20 characters of its sha256 (base64url). The same
 * bytes always get the same name, so ComfyUI's cache keeps the loader and the reference encode while only the text
 * changes, and nothing is uploaded twice. WebCrypto, so the tab and the server share it.
 */

export const LIVE_INPUT = /^fuobe_lv[A-Za-z0-9_-]{20}\.(png|jpg|webp)$/;

export type PictureExt = "png" | "jpg" | "webp";

const b64url = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const hex = (d: Uint8Array) => [...d].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));
}

/** The input name of these bytes, and their sha256 (hex). */
export async function inputName(bytes: Uint8Array, ext: PictureExt): Promise<{ name: string; sha256: string }> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return { name: `fuobe_lv${b64url(d).slice(0, 20)}.${ext}`, sha256: hex(d) };
}

/** The extension of a picture by its first bytes, or null. */
export function pictureExt(b: Uint8Array): PictureExt | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  return null;
}

export const PICTURE_TYPES: Record<PictureExt, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

/** A PNG's size from its IHDR, or null. */
export function pngSize(b: Uint8Array): { w: number; h: number } | null {
  if (pictureExt(b) !== "png" || b.length < 24) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { w: v.getUint32(16), h: v.getUint32(20) };
}
