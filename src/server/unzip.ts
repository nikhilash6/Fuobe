import "server-only";
import { promisify } from "node:util";
import { inflateRaw } from "node:zlib";

const inflate = promisify(inflateRaw);

/**
 * The files of a zip archive (stored or deflated entries), read from its central directory: what a provider answers with
 * when its result is several files in one download (Mureka's stems). Directories and macOS resource forks are left out.
 * Bounded by what is actually unpacked, never by what the headers claim: at most `maxFiles` entries and `maxBytes` of
 * unpacked data (each entry inflates into what is left of that budget, off the event loop). Entries that share or overlap
 * their bytes, run past the archive, or unpack to a length other than the one declared are refused, so a crafted archive
 * can't multiply one small entry into many large files.
 */
export async function unzip(buf: Buffer, o: { maxFiles?: number; maxBytes?: number } = {}): Promise<{ name: string; data: Buffer }[]> {
  const maxFiles = o.maxFiles ?? 64;
  const maxBytes = o.maxBytes ?? 512 * 1024 * 1024;
  const tooMuch = () => new Error("The archive unpacks to more than Fuobe keeps from one result");
  const damaged = () => new Error("The archive's entries are damaged");
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
  const dirStart = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || dirStart === 0xffffffff) throw new Error("The archive is in a format Fuobe can't read (ZIP64)");
  if (count > maxFiles) throw new Error(`The archive holds ${count} files, more than ${maxFiles}`);
  if (dirStart > eocd) throw new Error("The archive's directory is damaged");
  const out: { name: string; data: Buffer }[] = [];
  // Each entry's bytes (local header to the end of its data): no two may share any.
  const spans: [number, number][] = [];
  let total = 0;
  let at = dirStart;
  for (let n = 0; n < count; n++) {
    if (at + 46 > eocd || buf.readUInt32LE(at) !== 0x02014b50) throw new Error("The archive's directory is damaged");
    const flags = buf.readUInt16LE(at + 8);
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
    if (flags & 0x1) throw new Error("The archive is password-protected");
    if (local + 30 > dirStart || buf.readUInt32LE(local) !== 0x04034b50) throw damaged();
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const end = start + packed;
    if (end > dirStart) throw damaged();
    if (spans.some(([a, b]) => local < b && a < end)) throw damaged();
    spans.push([local, end]);
    // The declared size turns an honest oversized archive away before any work; the bytes unpacked are what count.
    if (total + size > maxBytes) throw tooMuch();
    const raw = buf.subarray(start, end);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      const room = maxBytes - total;
      try {
        // One byte past the room left, so an entry that would overflow it is caught rather than cut short.
        data = await inflate(raw, { maxOutputLength: room + 1 });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") throw tooMuch();
        throw damaged();
      }
    } else throw new Error(`The archive uses a compression Fuobe can't read (method ${method})`);
    total += data.length;
    if (total > maxBytes) throw tooMuch();
    if (data.length !== size) throw damaged();
    out.push({ name, data });
  }
  return out;
}
