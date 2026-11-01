/**
 * A minimal WebM writer for the browser's turntable recording (turntable.ts): one VP8 or VP9 video track, every
 * frame in memory (a few seconds), each at the timestamp it was given. Unlike MediaRecorder's WebM it has a
 * duration and cues, so players and the frame sampler know its length and can seek.
 *
 * Layout: EBML header, then a Segment of Info (1 ms timestamps, duration), Tracks, Cues (before the clusters,
 * so no SeekHead is needed) and one Cluster per key frame.
 */

export interface WebmFrame {
  data: Uint8Array;
  /** Microseconds from the start (WebCodecs' EncodedVideoChunk.timestamp). */
  timestamp: number;
  key: boolean;
}

type Part = Uint8Array;

const concat = (parts: Part[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** An element ID: its bytes as written (the length marker is part of the ID). */
function idBytes(id: number): Part {
  const bytes: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Uint8Array.from(bytes);
}

/** A data size as an EBML variable-length integer (the shortest that fits; all-ones is reserved). */
function sizeBytes(n: number): Part {
  let len = 1;
  while (n >= 2 ** (7 * len) - 1) len++;
  const out = new Uint8Array(len);
  let v = n;
  for (let i = len - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] |= 0x80 >> (len - 1);
  return out;
}

/** An unsigned integer, big-endian, in `width` bytes (or the fewest that hold it). */
function uintBytes(n: number, width?: number): Part {
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v % 256);
  while (bytes.length < (width ?? 1)) bytes.unshift(0);
  return Uint8Array.from(bytes);
}

const el = (id: number, ...body: Part[]): Part => {
  const data = concat(body);
  return concat([idBytes(id), sizeBytes(data.length), data]);
};
const uint = (id: number, n: number, width?: number) => el(id, uintBytes(n, width));
const str = (id: number, s: string) => el(id, Uint8Array.from(s, (c) => c.charCodeAt(0) & 0x7f));
const float = (id: number, n: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, n);
  return el(id, b);
};

/** The EBML IDs used here (Matroska / WebM spec names). */
export const WEBM_IDS = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimestampScale: 0x2ad7b1,
  Duration: 0x4489,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  CodecID: 0x86,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueClusterPosition: 0xf1,
  Cluster: 0x1f43b675,
  Timestamp: 0xe7,
  SimpleBlock: 0xa3,
} as const;
const I = WEBM_IDS;

/** Mux encoded frames (in order, the first a key frame) into a WebM file. */
export function muxWebm(o: { codec: "V_VP8" | "V_VP9"; width: number; height: number; fps: number; frames: WebmFrame[] }): Blob {
  if (!o.frames.length || !o.frames[0].key) throw new Error("A WebM needs frames, starting with a key frame");
  const ms = (us: number) => Math.round(us / 1000);
  const frameMs = 1000 / o.fps;
  const header = el(
    I.EBML,
    uint(0x4286, 1), // EBMLVersion
    uint(0x42f7, 1), // EBMLReadVersion
    uint(0x42f2, 4), // EBMLMaxIDLength
    uint(0x42f3, 8), // EBMLMaxSizeLength
    str(0x4282, "webm"), // DocType
    uint(0x4287, 2), // DocTypeVersion (SimpleBlock)
    uint(0x4285, 2), // DocTypeReadVersion
  );
  const last = o.frames[o.frames.length - 1];
  const info = el(I.Info, uint(I.TimestampScale, 1_000_000), float(I.Duration, ms(last.timestamp) + frameMs), str(0x4d80, "Fuobe"), str(0x5741, "Fuobe"));
  const tracks = el(
    I.Tracks,
    el(
      I.TrackEntry,
      uint(0xd7, 1), // TrackNumber
      uint(0x73c5, 1), // TrackUID
      uint(0x9c, 0), // FlagLacing
      str(I.CodecID, o.codec),
      uint(0x83, 1), // TrackType: video
      uint(0x23e383, Math.round(1e9 / o.fps)), // DefaultDuration (ns)
      el(I.Video, uint(I.PixelWidth, o.width), uint(I.PixelHeight, o.height)),
    ),
  );
  // One cluster per key frame; block times are relative to the cluster's (16-bit, so a cluster spans < 32 s).
  const clusters: { time: number; bytes: Part }[] = [];
  let group: WebmFrame[] = [];
  const close = () => {
    if (!group.length) return;
    const time = ms(group[0].timestamp);
    const blocks = group.map((f) => {
      const head = new Uint8Array(4);
      head[0] = 0x81; // track 1
      new DataView(head.buffer).setInt16(1, ms(f.timestamp) - time);
      head[3] = f.key ? 0x80 : 0;
      return el(I.SimpleBlock, head, f.data);
    });
    clusters.push({ time, bytes: el(I.Cluster, uint(I.Timestamp, time), ...blocks) });
    group = [];
  };
  for (const f of o.frames) {
    if (f.key || (group.length && ms(f.timestamp) - ms(group[0].timestamp) > 30_000)) close();
    group.push(f);
  }
  close();
  // Cues sit before the clusters: positions are 8 bytes wide, so the cues' own size doesn't depend on them.
  const cues = (positions: number[]) =>
    el(
      I.Cues,
      ...clusters.map((c, i) => el(I.CuePoint, uint(I.CueTime, c.time), el(I.CueTrackPositions, uint(0xf7, 1), uint(I.CueClusterPosition, positions[i], 8)))),
    );
  const cuesSize = cues(clusters.map(() => 0)).length;
  const positions: number[] = [];
  let at = info.length + tracks.length + cuesSize;
  for (const c of clusters) {
    positions.push(at);
    at += c.bytes.length;
  }
  const segment = el(I.Segment, info, tracks, cues(positions), ...clusters.map((c) => c.bytes));
  return new Blob([concat([header, segment]) as Uint8Array<ArrayBuffer>], { type: "video/webm" });
}
