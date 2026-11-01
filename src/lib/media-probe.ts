/**
 * Just enough of the common media containers to know a file's shape before a job runs: duration, displayed
 * size, frame rate / count, which tracks it has and how many audio channels. Reads MP4 / MOV / M4A (ISO-BMFF),
 * WAV, FLAC and MP3 from the bytes in memory; anything else (WebM, MKV, Ogg…) is "unknown" (null) and callers fall
 * back to safe defaults.
 */
export interface MediaInfo {
  /**
   * "webm": read by the server's WebM / Matroska reader (src/server/webm-probe.ts), for the ComfyUI uploads;
   * "image": a still's size (src/lib/image-size.ts), so "auto" can follow a start frame's shape.
   */
  container: "mp4" | "wav" | "flac" | "mp3" | "webm" | "avi" | "image";
  /** Seconds (the longest track). */
  duration?: number;
  /** Seconds of picture (the video track alone). */
  videoDuration?: number;
  /** Displayed size (a 90° rotation matrix swaps the stored width and height). */
  width?: number;
  height?: number;
  fps?: number;
  frames?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  /**
   * Audio channels, where the header says: WAV, FLAC, MP3, and an MP4 / MOV / M4A's first sound track (its sample
   * entry, or an AAC track's own config); the server's WebM / Matroska reader adds them for those.
   */
  channels?: number;
}

const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/**
 * `size`: the whole file's length when `data` is only its first bytes (a WAV's sound data and a constant-rate MP3's
 * length are read from it). Leave it out when `data` is the whole file.
 */
export function probeMedia(data: Uint8Array, size = data.length): MediaInfo | null {
  try {
    if (data.length < 12) return null;
    const total = Math.max(size, data.length);
    if (fourcc(data, 0) === "RIFF" && fourcc(data, 8) === "WAVE") return probeWav(data, total);
    if (fourcc(data, 0) === "fLaC") return probeFlac(data);
    if (fourcc(data, 4) === "ftyp" || ["moov", "mdat", "free", "wide", "skip"].includes(fourcc(data, 4))) return probeIsoBmff(data);
    return probeMp3(data, total);
  } catch {
    return null;
  }
}

/** A WAV, FLAC or MP3 (an ID3 tag or a frame at the very start): its header at the start says what the file is. */
const headerSays = (head: Uint8Array) =>
  (fourcc(head, 0) === "RIFF" && fourcc(head, 8) === "WAVE") || fourcc(head, 0) === "fLaC" || fourcc(head, 0).startsWith("ID3") || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);

// ---------------------------------------------------------------------------
// Probing a file without reading all of it

/** Reads the bytes [start, end) of a file. */
export type ReadRange = (start: number, end: number) => Promise<Uint8Array>;

const HEAD_BYTES = 256 * 1024;
const MAX_MOOV_BYTES = 64 * 1024 * 1024;
const ISO_TOP = ["ftyp", "moov", "mdat", "free", "wide", "skip"];
/**
 * The most top-level boxes walked before the moov box. A real MP4 / MOV has a handful (ftyp, free, wide, mdat, uuid…;
 * a fragmented one puts its moov first). A crafted file of millions of empty boxes would otherwise cost one read each.
 */
const MAX_TOP_BOXES = 64;

/**
 * {@link probeMedia} without reading the whole file: an MP4 / MOV is walked box header by box header
 * to its moov box (at the start, or after the media data like a camera file) and only that is read,
 * so a 200 MB clip costs a few small reads. A WAV, FLAC or MP3 is read from its header (the first read);
 * other containers are probed when the whole file fits in the first read, else unknown (null).
 */
export async function probeMediaRanges(read: ReadRange, size: number): Promise<MediaInfo | null> {
  try {
    const head = await read(0, Math.min(size, HEAD_BYTES));
    if (head.length < 12) return null;
    if (!ISO_TOP.includes(fourcc(head, 4))) return size <= head.length ? probeMedia(head) : headerSays(head) ? probeMedia(head, size) : null;
    for (let o = 0, n = 0; o + 8 <= size; n++) {
      if (n >= MAX_TOP_BOXES) return null;
      const h = o + 16 <= head.length ? head.subarray(o, o + 16) : await read(o, Math.min(size, o + 16));
      if (h.length < 8) return null;
      const d = new DataView(h.buffer, h.byteOffset, h.byteLength);
      let len = d.getUint32(0);
      if (len === 1) {
        if (h.length < 16) return null;
        len = Number(d.getBigUint64(8));
      } else if (len === 0) len = size - o;
      if (len < 8) return null;
      if (fourcc(h, 4) === "moov") {
        if (len > MAX_MOOV_BYTES) return null;
        const end = Math.min(size, o + len);
        return probeMedia(end <= head.length ? head.subarray(o, end) : await read(o, end));
      }
      o += len;
    }
    return null;
  } catch {
    return null;
  }
}

/** Reads the bytes [start, end) of a file at once (a file on this computer's disk). */
export type ReadRangeSync = (start: number, end: number) => Uint8Array;

/**
 * {@link probeMediaRanges} for a file read at once (on the server's own disk), never all of it: an MP4 / MOV's moov box
 * (none over `maxMoov`), or the first `headBytes` of anything else, which is enough for a WAV, FLAC or MP3 with the
 * file's size.
 */
export function probeMediaRangesSync(read: ReadRangeSync, size: number, opts: { headBytes?: number; maxMoov?: number } = {}): MediaInfo | null {
  const maxMoov = opts.maxMoov ?? MAX_MOOV_BYTES;
  try {
    const head = read(0, Math.min(size, opts.headBytes ?? HEAD_BYTES));
    if (head.length < 12) return null;
    if (!ISO_TOP.includes(fourcc(head, 4))) return probeMedia(head, size);
    for (let o = 0, n = 0; o + 8 <= size; n++) {
      if (n >= MAX_TOP_BOXES) return null;
      const h = o + 16 <= head.length ? head.subarray(o, o + 16) : read(o, Math.min(size, o + 16));
      if (h.length < 8) return null;
      const d = new DataView(h.buffer, h.byteOffset, h.byteLength);
      let len = d.getUint32(0);
      if (len === 1) {
        if (h.length < 16) return null;
        len = Number(d.getBigUint64(8));
      } else if (len === 0) len = size - o;
      if (len < 8) return null;
      if (fourcc(h, 4) === "moov") {
        if (len > maxMoov) return null;
        const end = Math.min(size, o + len);
        return probeMedia(end <= head.length ? head.subarray(o, end) : read(o, end));
      }
      o += len;
    }
    return null;
  } catch {
    return null;
  }
}

/** Probe a dropped file (a File or Blob) by reading only the parts that say what it is. */
export function probeBlob(blob: Blob): Promise<MediaInfo | null> {
  return probeMediaRanges(async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer()), blob.size);
}

/**
 * Probe a file by URL with Range requests (/api/files answers them), so only its header and moov
 * box are downloaded. A server that ignores Range sends the whole file, which is probed as it is.
 */
export async function probeUrl(url: string): Promise<MediaInfo | null> {
  try {
    const first = await fetch(url, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } });
    if (!first.ok) return null;
    const head = new Uint8Array(await first.arrayBuffer());
    const total = first.status === 206 ? Number(/\/(\d+)\s*$/.exec(first.headers.get("content-range") ?? "")?.[1]) : head.length;
    if (first.status !== 206 || !Number.isFinite(total) || total <= head.length) return probeMedia(head);
    return probeMediaRanges(async (start, end) => {
      if (end <= head.length) return head.subarray(start, end);
      const res = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` } });
      if (res.status !== 206) throw new Error("no ranges");
      return new Uint8Array(await res.arrayBuffer());
    }, total);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ISO-BMFF (mp4, mov, m4a)

interface Box {
  type: string;
  start: number; // payload start
  end: number;
}

function* boxes(d: DataView, start: number, end: number): Generator<Box> {
  let o = start;
  while (o + 8 <= end) {
    let size = d.getUint32(o);
    const type = String.fromCharCode(d.getUint8(o + 4), d.getUint8(o + 5), d.getUint8(o + 6), d.getUint8(o + 7));
    let header = 8;
    if (size === 1) {
      if (o + 16 > end) return;
      size = Number(d.getBigUint64(o + 8));
      header = 16;
    } else if (size === 0) size = end - o;
    if (size < header) return;
    yield { type, start: o + header, end: Math.min(end, o + size) };
    o += size;
  }
}

const child = (d: DataView, parent: Box, type: string) => {
  for (const b of boxes(d, parent.start, parent.end)) if (b.type === type) return b;
  return undefined;
};

/** [timescale, duration] of an mvhd / mdhd box (same layout). */
function timing(d: DataView, b: Box): [number, number] {
  if (d.getUint8(b.start) === 1) return [d.getUint32(b.start + 20), Number(d.getBigUint64(b.start + 24))];
  return [d.getUint32(b.start + 12), d.getUint32(b.start + 16)];
}

/**
 * A sound track's channel count from its first sample entry (stsd): an AAC track's AudioSpecificConfig (esds) when it
 * names a layout, else the entry's channelcount (QuickTime version 2 entries keep the real count further on); 0 when
 * none says.
 */
function soundChannels(d: DataView, stsd: Box): number {
  const entry = boxes(d, stsd.start + 8, stsd.end).next().value;
  // SampleEntry (6 reserved, data reference index) then version, revision, vendor, channelcount.
  if (!entry || entry.start + 28 > entry.end) return 0;
  const version = d.getUint16(entry.start + 8);
  let channels = version === 2 && entry.start + 44 <= entry.end ? d.getUint32(entry.start + 40) : d.getUint16(entry.start + 16);
  if (entry.type === "mp4a") {
    const extra = version === 1 ? 16 : version === 2 ? 36 : 0;
    for (const b of boxes(d, entry.start + 28 + extra, entry.end)) if (b.type === "esds") channels = aacChannels(d, b) || channels;
  }
  return channels > 0 && channels <= 64 ? channels : 0;
}

/** An esds box's AudioSpecificConfig channelConfiguration as a count (1–6, 7 = 7.1 = 8 channels); 0 when it doesn't say. */
function aacChannels(d: DataView, esds: Box): number {
  let o = esds.start + 4; // version + flags
  // A descriptor: tag, then a size of 1–4 bytes (7 bits each).
  const descriptor = (tag: number): number | null => {
    if (o + 2 > esds.end || d.getUint8(o) !== tag) return null;
    o++;
    let size = 0;
    for (let i = 0; i < 4 && o < esds.end; i++) {
      const b = d.getUint8(o++);
      size = (size << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return size;
  };
  if (descriptor(0x03) === null || o + 3 > esds.end) return 0; // ES_Descriptor
  const flags = d.getUint8(o + 2);
  o += 3;
  if (flags & 0x80) o += 2; // dependsOn_ES_ID
  if (flags & 0x40 && o < esds.end) o += 1 + d.getUint8(o); // URL
  if (flags & 0x20) o += 2; // OCR_ES_Id
  if (descriptor(0x04) === null) return 0; // DecoderConfigDescriptor
  o += 13;
  if (descriptor(0x05) === null || o + 2 > esds.end) return 0; // DecoderSpecificInfo = AudioSpecificConfig
  // audioObjectType (5 bits; 31 = escape, 6 more), samplingFrequencyIndex (4; 15 = 24 more), channelConfiguration (4).
  let pos = 0;
  const take = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++, pos++) {
      const at = o + (pos >> 3);
      if (at >= esds.end) return -1;
      v = (v << 1) | ((d.getUint8(at) >> (7 - (pos & 7))) & 1);
    }
    return v;
  };
  if (take(5) === 31) take(6);
  if (take(4) === 15) take(24);
  const layout = take(4);
  return layout >= 1 && layout <= 6 ? layout : layout === 7 ? 8 : 0;
}

function probeIsoBmff(data: Uint8Array): MediaInfo | null {
  const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let moov: Box | undefined;
  for (const b of boxes(d, 0, data.length)) if (b.type === "moov") moov = b;
  if (!moov) return null;
  const info: MediaInfo = { container: "mp4", hasVideo: false, hasAudio: false };
  const mvhd = child(d, moov, "mvhd");
  if (mvhd) {
    const [scale, dur] = timing(d, mvhd);
    if (scale && dur) info.duration = dur / scale;
  }
  for (const trak of boxes(d, moov.start, moov.end)) {
    if (trak.type !== "trak") continue;
    const mdia = child(d, trak, "mdia");
    const hdlr = mdia && child(d, mdia, "hdlr");
    const handler = hdlr ? fourcc(data, hdlr.start + 8) : "";
    if (handler === "soun" && !info.hasAudio) {
      info.hasAudio = true;
      const minf = mdia && child(d, mdia, "minf");
      const stsd = minf && child(d, minf, "stbl") && child(d, child(d, minf, "stbl")!, "stsd");
      const channels = stsd ? soundChannels(d, stsd) : 0;
      if (channels > 0) info.channels = channels;
    }
    if (handler !== "vide" || info.hasVideo) continue;
    info.hasVideo = true;
    const tkhd = child(d, trak, "tkhd");
    if (tkhd) {
      const v = d.getUint8(tkhd.start);
      const m = tkhd.start + (v === 1 ? 52 : 40); // the matrix
      const a = d.getInt32(m);
      const dd = d.getInt32(m + 16);
      let w = d.getUint32(m + 36) / 65536;
      let h = d.getUint32(m + 40) / 65536;
      if (a === 0 && dd === 0) [w, h] = [h, w]; // rotated 90° / 270°
      if (w && h) Object.assign(info, { width: Math.round(w), height: Math.round(h) });
    }
    const mdhd = mdia && child(d, mdia, "mdhd");
    const stbl = mdia && child(d, mdia, "minf") && child(d, child(d, mdia, "minf")!, "stbl");
    const stts = stbl && child(d, stbl, "stts");
    if (stts) {
      const n = d.getUint32(stts.start + 4);
      let frames = 0;
      for (let i = 0; i < n && stts.start + 8 + i * 8 + 8 <= stts.end; i++) frames += d.getUint32(stts.start + 8 + i * 8);
      if (frames) info.frames = frames;
    }
    if (mdhd) {
      const [scale, dur] = timing(d, mdhd);
      if (scale && dur) {
        info.videoDuration = dur / scale;
        info.duration ??= dur / scale;
        if (info.frames) info.fps = Math.round((info.frames / (dur / scale)) * 1000) / 1000;
      }
    }
  }
  return info;
}

// ---------------------------------------------------------------------------
// WAV, FLAC, MP3

function probeWav(data: Uint8Array, total = data.length): MediaInfo | null {
  const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let byteRate = 0;
  let channels = 0;
  for (let o = 12; o + 8 <= data.length; ) {
    const id = fourcc(data, o);
    let size = d.getUint32(o + 4, true);
    if (id === "fmt ") {
      channels = d.getUint16(o + 10, true);
      byteRate = d.getUint32(o + 16, true);
    }
    if (id === "data") {
      if (!size || size === 0xffffffff || o + 8 + size > total) size = total - o - 8; // streamed header
      return byteRate ? { container: "wav", duration: size / byteRate, hasVideo: false, hasAudio: true, ...(channels > 0 && { channels }) } : null;
    }
    o += 8 + size + (size % 2);
  }
  return null;
}

function probeFlac(data: Uint8Array): MediaInfo | null {
  // STREAMINFO is always the first metadata block: 20-bit sample rate, 3-bit channels - 1, 36-bit total samples.
  const o = 8 + 10;
  const rate = (data[o] << 12) | (data[o + 1] << 4) | (data[o + 2] >> 4);
  const channels = ((data[o + 2] >> 1) & 0x07) + 1;
  const total = (data[o + 3] & 0x0f) * 2 ** 32 + ((data[o + 4] << 24) >>> 0) + (data[o + 5] << 16) + (data[o + 6] << 8) + data[o + 7];
  if (!rate) return null;
  return { container: "flac", ...(total ? { duration: total / rate } : {}), hasVideo: false, hasAudio: true, channels };
}

const MP3_BITRATES: Record<string, number[]> = {
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function probeMp3(data: Uint8Array, total = data.length): MediaInfo | null {
  let o = 0;
  if (fourcc(data, 0).startsWith("ID3")) o = 10 + ((data[6] & 0x7f) << 21) + ((data[7] & 0x7f) << 14) + ((data[8] & 0x7f) << 7) + (data[9] & 0x7f);
  // The first frame header within a few KB of the tag.
  for (const limit = Math.min(data.length - 4, o + 8192); o < limit; o++) if (data[o] === 0xff && (data[o + 1] & 0xe0) === 0xe0) break;
  if (o + 4 > data.length || data[o] !== 0xff) return null;
  const version = (data[o + 1] >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  const layer = (data[o + 1] >> 1) & 3; // 1 = Layer III
  if (version === 1 || layer !== 1) return null;
  const bitrate = (MP3_BITRATES[version === 3 ? "1-3" : "2-3"][data[o + 2] >> 4] ?? 0) * 1000;
  const rate = MP3_RATES[version]?.[(data[o + 2] >> 2) & 3];
  if (!rate) return null;
  const mono = data[o + 3] >> 6 === 3;
  const samplesPerFrame = version === 3 ? 1152 : 576;
  const side = version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17;
  const x = o + 4 + side;
  const tag = fourcc(data, x);
  if ((tag === "Xing" || tag === "Info") && data[x + 7] & 1) {
    const frames = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(x + 8);
    return { container: "mp3", duration: (frames * samplesPerFrame) / rate, hasVideo: false, hasAudio: true, channels: mono ? 1 : 2 };
  }
  if (!bitrate) return null;
  return { container: "mp3", duration: ((total - o) * 8) / bitrate, hasVideo: false, hasAudio: true, channels: mono ? 1 : 2 };
}
