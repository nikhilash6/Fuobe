import zlib from "node:zlib";

/**
 * 3D files a job sends to a GPU worker (a saved splat for Any Angle's angles, a GLB for Hi3D's refine), checked by their
 * bytes as the worker's results are (computer/http.ts outputType): a splat is a real .spz and is made again, a GLB is a
 * whole binary glTF 2. An account sends a splat or a GLB whose every buffer and picture is inside the file; the owner's
 * own jobs may also send a .ply. bin/lib/worker/model-file.mjs checks the same on the worker.
 */
export type ModelFormat = "spz" | "glb" | "ply";

export const MODEL_INPUT_MAX_BYTES = 300 * 2 ** 20;
/** The most points a splat sent to a worker holds (TripoSplat makes 262,144). */
export const SPZ_MAX_POINTS = 2 ** 22;

const SPZ_MAGIC = 0x5053474e;
const GLB_MAGIC = 0x46546c67;
const GLB_JSON = 0x4e4f534a;
const SH_DIMS = [0, 3, 8, 15];

/** The 3D format of a file, by its type or else its name; null for anything else. */
export function modelFormat(contentType: string, name: string): ModelFormat | null {
  const type = contentType.split(";")[0].trim().toLowerCase();
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (type === "model/x-spz" || (!type.startsWith("model/") && ext === "spz")) return "spz";
  if (type === "model/gltf-binary" || (!type.startsWith("model/") && ext === "glb")) return "glb";
  if (type === "model/ply" || (!type.startsWith("model/") && ext === "ply")) return "ply";
  return null;
}

/** May this principal send a file of this format to the workers? */
export const modelTaken = (format: ModelFormat, account: boolean): boolean => format !== "ply" || !account;

/**
 * A splat's points, unpacked: gzip, the "NGSP" header (version 1 to 3, 1 to SPZ_MAX_POINTS points, SH degree 0 to 3), and
 * exactly the bytes those points take, nothing after them. Null for anything else.
 */
export function spzPoints(data: Buffer): Buffer | null {
  if (data.length < 18 || data.length > MODEL_INPUT_MAX_BYTES || data[0] !== 0x1f || data[1] !== 0x8b || data[2] !== 8) return null;
  try {
    const head = zlib.gunzipSync(data.subarray(0, Math.min(data.length, 4096)), { finishFlush: zlib.constants.Z_SYNC_FLUSH, maxOutputLength: 1 << 20 });
    if (head.length < 16 || head.readUInt32LE(0) !== SPZ_MAGIC) return null;
    const version = head.readUInt32LE(4);
    const points = head.readUInt32LE(8);
    const sh = head[12];
    if (version < 1 || version > 3 || points < 1 || points > SPZ_MAX_POINTS || sh > 3) return null;
    const each = (version === 1 ? 6 : 9) + 1 + 3 + 3 + (version >= 3 ? 4 : 3) + SH_DIMS[sh] * 3;
    const size = 16 + points * each;
    const raw = zlib.gunzipSync(data, { maxOutputLength: size });
    return raw.length === size ? raw : null;
  } catch {
    return null;
  }
}

/** A real splat made again: its checked points in a fresh gzip (no name, comment or anything after the stream). */
export function splatAgain(data: Buffer): Buffer | null {
  const raw = spzPoints(data);
  return raw ? zlib.gzipSync(raw) : null;
}

/** Every buffer and picture of a GLB's JSON is inside the file (no URI, or a data: URI). */
function selfContained(j: { buffers?: unknown; images?: unknown }): boolean {
  const list = (v: unknown) => (v === undefined ? [] : Array.isArray(v) ? v : null);
  const parts = [list(j.buffers), list(j.images)];
  if (parts.some((x) => x === null)) return false;
  return parts.flat().every((x) => {
    const uri = (x as { uri?: unknown } | null)?.uri;
    return uri === undefined || (typeof uri === "string" && uri.startsWith("data:"));
  });
}

/** Is this a binary glTF 2 whose every buffer and picture is inside the file? Reads only the header and the JSON chunk. */
export function glbSelfContained(b: Buffer): boolean {
  if (b.length < 20 || b.readUInt32LE(0) !== GLB_MAGIC || b.readUInt32LE(4) !== 2 || b.readUInt32LE(16) !== GLB_JSON) return false;
  const len = b.readUInt32LE(12);
  if (20 + len > b.length) return false;
  try {
    const j = JSON.parse(b.subarray(20, 20 + len).toString("utf8"));
    return !!j && typeof j === "object" && selfContained(j);
  } catch {
    return false;
  }
}

/**
 * A whole binary glTF 2: its header's length is the file's, its first chunk is its JSON (an object), and its chunks end
 * exactly at the file's end. `account`: its buffers and pictures are inside it too.
 */
export function isGlb(b: Buffer, account: boolean): boolean {
  if (b.length < 28 || b.length > MODEL_INPUT_MAX_BYTES || b.readUInt32LE(0) !== GLB_MAGIC || b.readUInt32LE(4) !== 2 || b.readUInt32LE(8) !== b.length) return false;
  if (b.readUInt32LE(16) !== GLB_JSON) return false;
  let at = 12;
  while (at < b.length) {
    if (at + 8 > b.length) return false;
    const len = b.readUInt32LE(at);
    at += 8 + len;
  }
  if (at !== b.length) return false;
  try {
    const len = b.readUInt32LE(12);
    const j = JSON.parse(b.subarray(20, 20 + len).toString("utf8"));
    return !!j && typeof j === "object" && !Array.isArray(j) && (!account || selfContained(j));
  } catch {
    return false;
  }
}

/** A .ply's header: "ply", its format, and "end_header" within its first 64 KB. */
export function isPly(b: Buffer): boolean {
  if (b.length > MODEL_INPUT_MAX_BYTES) return false;
  const head = b.subarray(0, 64 * 1024).toString("latin1");
  const end = head.indexOf("end_header");
  return /^ply\r?\n/.test(head) && end > 0 && /\nformat (ascii|binary_little_endian|binary_big_endian) 1\.0\r?\n/.test(head.slice(0, end));
}

/** A 3D file for the workers, checked (and a splat made again); null when it isn't one they take from this principal. */
export function modelForWorkers(format: ModelFormat, data: Buffer, account: boolean): Buffer | null {
  if (!modelTaken(format, account) || data.length > MODEL_INPUT_MAX_BYTES) return null;
  if (format === "spz") return splatAgain(data);
  if (format === "glb") return isGlb(data, account) ? data : null;
  return isPly(data) ? data : null;
}
