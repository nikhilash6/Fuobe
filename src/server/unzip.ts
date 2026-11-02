import "server-only";
import { inflateRawSync } from "node:zlib";

/**
 * The files of a zip archive (stored or deflated entries), read from its central directory: what a provider answers with
 * when its result is several files in one download (Mureka's stems). Directories and macOS resource forks are left out.
 * Bounded: at most `maxFiles` entries and `maxBytes` of unpacked data, else it throws.
 */
export function unzip(buf: Buffer, o: { maxFiles?: number; maxBytes?: number } = {}): { name: string; data: Buffer }[] {
  const maxFiles = o.maxFiles ?? 64;
  const maxBytes = o.maxBytes ?? 512 * 1024 * 1024;
  // The end of central directory record: its signature within the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip archive");
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  if (count > maxFiles) throw new Error(`The archive holds ${count} files, more than ${maxFiles}`);
  const out: { name: string; data: Buffer }[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) throw new Error("The archive's directory is damaged");
    const method = buf.readUInt16LE(at + 10);
    const packed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || name.startsWith("__MACOSX/") || name.split("/").pop()!.startsWith("._")) continue;
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error("The archive's entries are damaged");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + packed);
    total += size;
    if (total > maxBytes) throw new Error("The archive unpacks to more than Fuobe keeps from one result");
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw, { maxOutputLength: maxBytes }) : null;
    if (!data) throw new Error(`The archive uses a compression Fuobe can't read (method ${method})`);
    out.push({ name, data });
  }
  return out;
}
