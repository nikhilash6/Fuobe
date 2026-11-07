// 3D files a job sends to the worker's ComfyUI (a saved splat for Any Angle's angles, a GLB for Hi3D's refine), checked
// by their bytes before anything reads them, as the studio checks them before it sends them (src/server/model-input.ts):
// a splat is unpacked, its points counted to the byte, and written again as a fresh .spz; a GLB is a whole binary
// glTF 2, and an account's has every buffer and picture inside it. A .ply comes only with the owner's own jobs.
import zlib from "node:zlib";

export const MODEL_MAX_BYTES = 300 * 2 ** 20;
export const SPZ_MAX_POINTS = 2 ** 22;

const SPZ_MAGIC = 0x5053474e;
const GLB_MAGIC = 0x46546c67;
const GLB_JSON = 0x4e4f534a;
const SH_DIMS = [0, 3, 8, 15];

/** The 3D format of a job's input, by its type or else its name; null for anything else. */
export function modelFormat(input) {
  const type = String(input?.contentType ?? "").split(";")[0].trim().toLowerCase();
  const ext = /\.([a-z0-9]+)$/i.exec(String(input?.name ?? ""))?.[1]?.toLowerCase();
  const byName = !type.startsWith("model/");
  if (type === "model/x-spz" || (byName && ext === "spz")) return "spz";
  if (type === "model/gltf-binary" || (byName && ext === "glb")) return "glb";
  if (type === "model/ply" || (byName && ext === "ply")) return "ply";
  return null;
}

/** A splat's points, unpacked and checked to the byte, or null. */
export function spzPoints(data) {
  if (!Buffer.isBuffer(data) || data.length < 18 || data.length > MODEL_MAX_BYTES || data[0] !== 0x1f || data[1] !== 0x8b || data[2] !== 8) return null;
  try {
    const head = zlib.gunzipSync(data.subarray(0, Math.min(data.length, 4096)), { finishFlush: zlib.constants.Z_SYNC_FLUSH, maxOutputLength: 1 << 20 });
    if (head.length < 16 || head.readUInt32LE(0) !== SPZ_MAGIC) return null;
    const version = head.readUInt32LE(4);
    const points = head.readUInt32LE(8);
    const sh = head[12];
    if (version < 1 || version > 3 || points < 1 || points > SPZ_MAX_POINTS || sh > 3) return null;
    const size = 16 + points * ((version === 1 ? 6 : 9) + 1 + 3 + 3 + (version >= 3 ? 4 : 3) + SH_DIMS[sh] * 3);
    const raw = zlib.gunzipSync(data, { maxOutputLength: size });
    return raw.length === size ? raw : null;
  } catch {
    return null;
  }
}

const selfContained = (j) => {
  const list = (v) => (v === undefined ? [] : Array.isArray(v) ? v : null);
  const parts = [list(j.buffers), list(j.images)];
  if (parts.some((x) => x === null)) return false;
  return parts.flat().every((x) => x?.uri === undefined || (typeof x.uri === "string" && x.uri.startsWith("data:")));
};

/** A whole binary glTF 2 (its chunks end at its end, its JSON an object); an account's with nothing outside it. */
export function isGlb(b, account) {
  if (!Buffer.isBuffer(b) || b.length < 28 || b.length > MODEL_MAX_BYTES || b.readUInt32LE(0) !== GLB_MAGIC || b.readUInt32LE(4) !== 2 || b.readUInt32LE(8) !== b.length) return false;
  if (b.readUInt32LE(16) !== GLB_JSON) return false;
  let at = 12;
  while (at < b.length) {
    if (at + 8 > b.length) return false;
    at += 8 + b.readUInt32LE(at);
  }
  if (at !== b.length) return false;
  try {
    const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString("utf8"));
    return !!j && typeof j === "object" && !Array.isArray(j) && (!account || selfContained(j));
  } catch {
    return false;
  }
}

/** A .ply's header: "ply", its format, and "end_header" within its first 64 KB. */
export function isPly(b) {
  if (!Buffer.isBuffer(b) || b.length > MODEL_MAX_BYTES) return false;
  const head = b.subarray(0, 64 * 1024).toString("latin1");
  const end = head.indexOf("end_header");
  return /^ply\r?\n/.test(head) && end > 0 && /\nformat (ascii|binary_little_endian|binary_big_endian) 1\.0\r?\n/.test(head.slice(0, end));
}

/**
 * A 3D input as its ComfyUI gets it: a splat made again, a GLB or the owner's .ply as it came once checked. Null when it
 * isn't a real one, or isn't a kind this job's principal sends (`account`: an account's job ticket).
 */
export function modelAgain(format, data, account) {
  if (format === "spz") {
    const raw = spzPoints(data);
    return raw ? zlib.gzipSync(raw) : null;
  }
  if (format === "glb") return isGlb(data, account) ? data : null;
  if (format === "ply") return !account && isPly(data) ? data : null;
  return null;
}
