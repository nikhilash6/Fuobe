import "server-only";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { MIX_MAX_BYTES, MIX_PART_BYTES } from "@/lib/av/split";
import { adoptFile, scratchDir, type Asset } from "./storage";

/**
 * Split soundtrack's Export mix (and "Put back on the video", which exports first): the browser writes the mix as a
 * 16-bit WAV and sends it here in parts of MIX_PART_BYTES, which skip the sign-in proxy (it holds at most 4 MB of a
 * body; the route runs its checks and reads no more than PART_MAX) and the server appends to a scratch file without
 * holding the mix in memory. The first part starts with the WAV header, which says how big the file will be (at most
 * MIX_MAX_BYTES); the last one turns the file into an upload in the Library. A 5.1 film clip's mix outgrows the 200 MB
 * upload cap after about six minutes; this doesn't.
 */

export class MixExportError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** A part may be a little over MIX_PART_BYTES (the first one carries the header). */
export const PART_MAX = MIX_PART_BYTES + 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{16}$/;
const PART_FILE = /^mix-[A-Za-z0-9_-]{16}\.wav\.part$/;
/** Exports nobody finished are removed when the next one starts. */
const STALE_MS = 6 * 60 * 60 * 1000;

const partPath = (id: string) => path.join(scratchDir(), `mix-${id}.wav.part`);

/** The file size a 16-bit PCM WAV header declares, or null when it isn't one. */
export function declaredWavBytes(head: Buffer): number | null {
  if (head.length < 44) return null;
  const tag = (o: number) => head.toString("latin1", o, o + 4);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt " || head.readUInt16LE(20) !== 1 || head.readUInt16LE(34) !== 16) return null;
  return head.readUInt32LE(4) + 8;
}

function headOf(file: string): Buffer {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(44);
    fs.readSync(fd, buf, 0, 44, 0);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

function sweep() {
  const dir = scratchDir();
  for (const f of fs.readdirSync(dir)) {
    if (!PART_FILE.test(f)) continue;
    const abs = path.join(dir, f);
    try {
      if (Date.now() - fs.statSync(abs).mtimeMs > STALE_MS) fs.rmSync(abs, { force: true });
    } catch {}
  }
}

const mb = (bytes: number) => `${Math.round(bytes / 1024 ** 2)} MB`;

/**
 * One part of an export: the first (no `id`, offset 0) starts it; the others carry its `id` and the offset they start
 * at (the bytes received so far). Gives the export's id and the bytes received, or, for the `last` part, the Library
 * asset of the finished WAV.
 */
export function receiveMixPart(o: { id?: string | null; offset: number; data: Buffer; last: boolean; name?: string | null }): { id: string; received: number } | Asset {
  if (o.data.length > PART_MAX) throw new MixExportError(`A part can be at most ${mb(PART_MAX)}`, 413);
  let id = o.id ?? "";
  let file: string;
  let total: number;
  if (!id) {
    if (o.offset !== 0) throw new MixExportError("Start the export from its first part", 409);
    const declared = declaredWavBytes(o.data);
    if (declared === null) throw new MixExportError("An export is a 16-bit PCM WAV file", 415);
    if (declared > MIX_MAX_BYTES) throw new MixExportError(`That mix is over the ${mb(MIX_MAX_BYTES)} an export can be`, 413);
    total = declared;
    sweep();
    id = nanoid(16);
    file = partPath(id);
    fs.writeFileSync(file, o.data, { flag: "wx" });
  } else {
    if (!ID.test(id)) throw new MixExportError("That export doesn't exist", 404);
    file = partPath(id);
    let size: number;
    try {
      size = fs.statSync(/*turbopackIgnore: true*/ file).size;
    } catch {
      throw new MixExportError("That export expired — export the mix again", 404);
    }
    if (o.offset !== size) throw new MixExportError(`That part doesn't follow on (the export has ${size} bytes)`, 409);
    total = declaredWavBytes(headOf(file)) ?? 0;
    if (size + o.data.length > total) throw new MixExportError("That's more audio than the WAV header says", 413);
    fs.appendFileSync(file, o.data);
  }
  const received = fs.statSync(/*turbopackIgnore: true*/ file).size;
  if (received > total) {
    fs.rmSync(file, { force: true });
    throw new MixExportError("That's more audio than the WAV header says", 413);
  }
  if (!o.last) return { id, received };
  if (received !== total) throw new MixExportError(`The export stopped short (${received} of ${total} bytes) — export the mix again`, 409);
  const name = (o.name?.trim() || "Mix").slice(0, 196);
  return adoptFile({ from: file, contentType: "audio/wav", name: /\.wav$/i.test(name) ? name : `${name}.wav`, source: "upload" });
}
