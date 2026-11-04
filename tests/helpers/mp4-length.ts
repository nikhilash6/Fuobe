import fs from "node:fs";

/** An MP4's length in seconds, from its movie header box (mvhd): no ffprobe needed. */
export function mp4Seconds(file: string): number {
  const buf = fs.readFileSync(file);
  const at = buf.indexOf("mvhd");
  if (at < 0) throw new Error(`${file} has no movie header`);
  const v1 = buf[at + 4] === 1;
  const scale = buf.readUInt32BE(at + (v1 ? 24 : 16));
  const length = v1 ? Number(buf.readBigUInt64BE(at + 28)) : buf.readUInt32BE(at + 20);
  return length / scale;
}

/** An MP4's first track's picture size in pixels, from its track header box (tkhd, version 0). */
export function mp4Size(file: string): { w: number; h: number } {
  const buf = fs.readFileSync(file);
  const at = buf.indexOf("tkhd");
  if (at < 0 || buf[at + 4] !== 0) throw new Error(`${file} has no version 0 track header`);
  return { w: buf.readUInt32BE(at + 80) >>> 16, h: buf.readUInt32BE(at + 84) >>> 16 };
}
