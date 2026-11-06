/**
 * A part of an MP4 or MOV clip, cut without encoding it again: the samples from a key frame on are copied as they are,
 * with new sample tables, so the picture and the sound keep their quality and the cut takes a moment. It starts on the
 * key frame at or before the time asked for (a clip can only start on one), and keeps the length asked for from there.
 *
 * Reads only the file's header boxes (`read`), and says which byte ranges of the original make the new file's sound and
 * picture, so a browser builds it from slices of the file it has (a Blob) without holding the clip in memory.
 *
 * Takes a plain (not fragmented) ISO-BMFF file with a picture or sound track. Anything else (WebM, a fragmented MP4, a
 * QuickTime file with raw PCM sound) gives null, and the caller says so in words.
 */

export type ReadRange = (start: number, end: number) => Promise<Uint8Array>;

/** A piece of the new file: bytes made here, or a range of the original. */
export type CutPart = Uint8Array | { start: number; end: number };

interface Track {
  /** The trak box's children, kept to copy (tkhd, mdia's hdlr, minf's own boxes). */
  tkhd: Uint8Array;
  mdhd: Uint8Array;
  hdlr: Uint8Array;
  /** minf's children other than stbl (vmhd/smhd, dinf), as they are. */
  minfRest: Uint8Array[];
  stsd: Uint8Array;
  handler: string;
  timescale: number;
  /** The track's edit: the delay before it (movie timescale) and where in its media it starts (media timescale). */
  edit: { delay: number; mediaTime: number } | null;
  sizes: Uint32Array;
  offsets: Float64Array;
  dts: Float64Array;
  durs: Uint32Array;
  /** Composition offsets, when the track has them. */
  ctts: Int32Array | null;
  cttsVersion: number;
  /** Key frames (sample indexes), when the track lists them (null: every sample is one). */
  sync: Uint8Array | null;
  sdi: Uint32Array;
}

export interface Mp4Index {
  /** The clip's length in seconds. */
  seconds: number;
  /** Where its key frames are, in seconds (where a part can start). */
  keyframes: number[];
  hasVideo: boolean;
  hasAudio: boolean;
  /** @internal */
  ftyp: Uint8Array | null;
  /** @internal moov's own boxes to copy (udta, meta) */
  moovRest: Uint8Array[];
  /** @internal */
  mvhd: Uint8Array;
  /** @internal */
  movieTimescale: number;
  /** @internal */
  tracks: Track[];
}

/** The most samples a track may list: past it (raw PCM sound in a MOV lists one per sound frame), no cut here. */
const MAX_SAMPLES = 2_000_000;
/** The largest header (moov) read: a clip of up to 200 MB has one of a few MB. */
const MAX_MOOV = 64 * 1024 * 1024;

const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** The boxes inside `b` (from `from`), each with its type and its bytes (header included). */
function children(b: Uint8Array, from = 0): { type: string; box: Uint8Array; body: Uint8Array }[] {
  const out: { type: string; box: Uint8Array; body: Uint8Array }[] = [];
  const v = view(b);
  let at = from;
  while (at + 8 <= b.length) {
    let size = v.getUint32(at);
    const type = fourcc(b, at + 4);
    let head = 8;
    if (size === 1) {
      if (at + 16 > b.length) break;
      size = Number(v.getBigUint64(at + 8));
      head = 16;
    } else if (size === 0) size = b.length - at;
    if (size < head || at + size > b.length) throw new Error("bad box");
    out.push({ type, box: b.subarray(at, at + size), body: b.subarray(at + head, at + size) });
    at += size;
  }
  return out;
}

const child = (b: Uint8Array, type: string) => children(b).find((c) => c.type === type);

/** A full box's version, and its body after version and flags. */
const full = (body: Uint8Array) => ({ version: body[0], rest: body.subarray(4), v: view(body.subarray(4)) });

function parseTrack(trak: Uint8Array, movieTimescale: number): Track | null {
  const tkhd = child(trak, "tkhd");
  const mdia = child(trak, "mdia");
  if (!tkhd || !mdia) return null;
  const mdhd = child(mdia.body, "mdhd");
  const hdlr = child(mdia.body, "hdlr");
  const minf = child(mdia.body, "minf");
  if (!mdhd || !hdlr || !minf) return null;
  const handler = fourcc(hdlr.body, 8);
  if (handler !== "vide" && handler !== "soun") return null;
  const m = full(mdhd.body);
  const timescale = m.version === 1 ? m.v.getUint32(16) : m.v.getUint32(8);
  const minfKids = children(minf.body);
  const stbl = minfKids.find((c) => c.type === "stbl");
  if (!stbl || !timescale) return null;
  const s = children(stbl.body);
  const get = (t: string) => s.find((c) => c.type === t);
  const stsd = get("stsd");
  const stts = get("stts");
  const stsc = get("stsc");
  const stsz = get("stsz");
  const stco = get("stco") ?? get("co64");
  if (!stsd || !stts || !stsc || !stsz || !stco) return null;

  // Sizes.
  const z = full(stsz.body);
  const fixed = z.v.getUint32(0);
  const n = z.v.getUint32(4);
  if (!n || n > MAX_SAMPLES) return null;
  const sizes = new Uint32Array(n);
  for (let i = 0; i < n; i++) sizes[i] = fixed || z.v.getUint32(8 + i * 4);

  // Decode times and durations.
  const dts = new Float64Array(n);
  const durs = new Uint32Array(n);
  {
    const t = full(stts.body);
    const entries = t.v.getUint32(0);
    let i = 0;
    let time = 0;
    for (let e = 0; e < entries && i < n; e++) {
      const count = t.v.getUint32(4 + e * 8);
      const delta = t.v.getUint32(8 + e * 8);
      for (let k = 0; k < count && i < n; k++, i++) {
        dts[i] = time;
        durs[i] = delta;
        time += delta;
      }
    }
    if (i < n) return null;
  }

  // Composition offsets.
  let ctts: Int32Array | null = null;
  let cttsVersion = 0;
  const cttsBox = get("ctts");
  if (cttsBox) {
    const c = full(cttsBox.body);
    cttsVersion = c.version;
    ctts = new Int32Array(n);
    const entries = c.v.getUint32(0);
    let i = 0;
    for (let e = 0; e < entries && i < n; e++) {
      const count = c.v.getUint32(4 + e * 8);
      const off = c.v.getInt32(8 + e * 8);
      for (let k = 0; k < count && i < n; k++, i++) ctts[i] = off;
    }
  }

  // Key frames.
  let sync: Uint8Array | null = null;
  const stss = get("stss");
  if (stss) {
    const k = full(stss.body);
    sync = new Uint8Array(n);
    const entries = k.v.getUint32(0);
    for (let e = 0; e < entries; e++) {
      const at = k.v.getUint32(4 + e * 4) - 1;
      if (at >= 0 && at < n) sync[at] = 1;
    }
  }

  // Chunks: each sample's offset and description.
  const co = full(stco.body);
  const chunks = co.v.getUint32(0);
  const chunkAt = (c: number) => (stco.type === "co64" ? Number(co.v.getBigUint64(4 + c * 8)) : co.v.getUint32(4 + c * 4));
  const sc = full(stsc.body);
  const scEntries = sc.v.getUint32(0);
  const offsets = new Float64Array(n);
  const sdi = new Uint32Array(n);
  let i = 0;
  for (let e = 0; e < scEntries && i < n; e++) {
    const first = sc.v.getUint32(4 + e * 12) - 1;
    const per = sc.v.getUint32(8 + e * 12);
    const desc = sc.v.getUint32(12 + e * 12);
    const last = e + 1 < scEntries ? sc.v.getUint32(4 + (e + 1) * 12) - 1 : chunks;
    for (let c = first; c < last && i < n; c++) {
      let at = chunkAt(c);
      for (let k = 0; k < per && i < n; k++, i++) {
        offsets[i] = at;
        sdi[i] = desc;
        at += sizes[i];
      }
    }
  }
  if (i < n) return null;

  // The edit: an empty first edit is a delay; the next one says where the media starts.
  let edit: Track["edit"] = null;
  const elst = child(trak, "edts") && child(child(trak, "edts")!.body, "elst");
  if (elst) {
    const l = full(elst.body);
    const entries = l.v.getUint32(0);
    const wide = l.version === 1;
    const step = wide ? 20 : 12;
    let delay = 0;
    for (let e = 0; e < entries; e++) {
      const o = 4 + e * step;
      const segment = wide ? Number(l.v.getBigUint64(o)) : l.v.getUint32(o);
      const media = wide ? Number(l.v.getBigInt64(o + 8)) : l.v.getInt32(o + 4);
      if (media === -1) {
        delay += segment;
        continue;
      }
      edit = { delay, mediaTime: media };
      break;
    }
  }
  void movieTimescale;
  return {
    tkhd: tkhd.box,
    mdhd: mdhd.box,
    hdlr: hdlr.box,
    minfRest: minfKids.filter((c) => c.type !== "stbl").map((c) => c.box),
    stsd: stsd.box,
    handler,
    timescale,
    edit,
    sizes,
    offsets,
    dts,
    durs,
    ctts,
    cttsVersion,
    sync,
    sdi,
  };
}

/** A clip's index from its header boxes, or null when it can't be cut here (see the file's comment). */
export async function readMp4Index(read: ReadRange, size: number): Promise<Mp4Index | null> {
  try {
    let at = 0;
    let ftyp: Uint8Array | null = null;
    let moov: Uint8Array | null = null;
    while (at + 8 <= size) {
      const head = await read(at, Math.min(size, at + 16));
      const v = view(head);
      let boxSize = v.getUint32(0);
      const type = fourcc(head, 4);
      if (boxSize === 1) boxSize = Number(v.getBigUint64(8));
      else if (boxSize === 0) boxSize = size - at;
      if (boxSize < 8) return null;
      if (type === "moof" || type === "sidx" || type === "styp") return null;
      if (type === "ftyp") ftyp = await read(at, at + boxSize);
      if (type === "moov") {
        if (boxSize > MAX_MOOV) return null;
        moov = await read(at, at + boxSize);
      }
      at += boxSize;
    }
    if (!moov) return null;
    const kids = children(moov, 8);
    if (kids.some((k) => k.type === "mvex")) return null;
    const mvhd = kids.find((k) => k.type === "mvhd");
    if (!mvhd) return null;
    const mv = full(mvhd.body);
    const movieTimescale = mv.version === 1 ? mv.v.getUint32(16) : mv.v.getUint32(8);
    if (!movieTimescale) return null;
    const tracks = kids
      .filter((k) => k.type === "trak")
      .map((k) => parseTrack(k.body, movieTimescale))
      .filter((t): t is Track => !!t);
    if (!tracks.length) return null;
    const ref = tracks.find((t) => t.handler === "vide") ?? tracks[0];
    const end = (t: Track) => (t.dts[t.dts.length - 1] + t.durs[t.durs.length - 1]) / t.timescale;
    const keyframes: number[] = [];
    for (let i = 0; i < ref.dts.length; i++) if (!ref.sync || ref.sync[i]) keyframes.push(ref.dts[i] / ref.timescale);
    return {
      seconds: Math.max(...tracks.map(end)),
      keyframes,
      hasVideo: tracks.some((t) => t.handler === "vide"),
      hasAudio: tracks.some((t) => t.handler === "soun"),
      ftyp,
      moovRest: kids.filter((k) => k.type === "udta" || k.type === "meta").map((k) => k.box),
      mvhd: mvhd.box,
      movieTimescale,
      tracks,
    };
  } catch {
    return null;
  }
}

/** The key frame a part asked to start at `from` really starts on (the one at or before it). */
export function keyframeAtOrBefore(index: Pick<Mp4Index, "keyframes">, from: number): number {
  let best = index.keyframes[0] ?? 0;
  for (const k of index.keyframes) {
    if (k <= from + 1e-6) best = k;
    else break;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Writing

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const size = 8 + parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(size);
  const v = view(out);
  v.setUint32(0, size);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let at = 8;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function fullBox(type: string, version: number, flags: number, body: Uint8Array): Uint8Array {
  const head = new Uint8Array(4);
  head[0] = version;
  head[1] = (flags >> 16) & 255;
  head[2] = (flags >> 8) & 255;
  head[3] = flags & 255;
  return box(type, head, body);
}

function u32s(values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const v = view(out);
  values.forEach((x, i) => v.setUint32(i * 4, x >>> 0));
  return out;
}

/** A copy of a header box (mvhd, tkhd or mdhd) with its duration set (its own version's width). */
function withDuration(src: Uint8Array, kind: "mvhd" | "tkhd" | "mdhd", duration: number): Uint8Array {
  const out = src.slice();
  const v = view(out);
  const version = out[8];
  // Offsets from the box's start: 8 header + 4 version and flags, then the times.
  const at = version === 1 ? (kind === "tkhd" ? 12 + 8 + 8 + 4 + 4 : 12 + 8 + 8 + 4) : kind === "tkhd" ? 12 + 4 + 4 + 4 + 4 : 12 + 4 + 4 + 4;
  if (version === 1) v.setBigUint64(at, BigInt(Math.round(duration)));
  else v.setUint32(at, Math.min(0xffffffff, Math.round(duration)));
  return out;
}

/** Run-length entries of a sequence. */
function runs(values: ArrayLike<number>): [count: number, value: number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < values.length; i++) {
    const last = out[out.length - 1];
    if (last && last[1] === values[i]) last[0]++;
    else out.push([1, values[i]]);
  }
  return out;
}

export interface Mp4Cut {
  /** The new file, in order. */
  parts: CutPart[];
  /** Its size in bytes. */
  bytes: number;
  /** Where in the original it starts (the key frame), and how long it is, in seconds. */
  from: number;
  seconds: number;
}

/**
 * The part of `seconds` from the key frame at or before `from`, as the new file's parts: its header boxes (made here) and
 * the original's byte ranges for its sound and picture. Null when nothing would be left.
 */
export function cutMp4(index: Mp4Index, from: number, seconds: number): Mp4Cut | null {
  const start = keyframeAtOrBefore(index, from);
  const end = Math.min(index.seconds, start + seconds);
  if (end - start <= 0) return null;

  type Sel = { t: Track; idx: number[]; duration: number };
  const sel: Sel[] = [];
  for (const t of index.tracks) {
    const a = start * t.timescale;
    const b = end * t.timescale;
    const idx: number[] = [];
    for (let i = 0; i < t.dts.length; i++) if (t.dts[i] >= a - 0.5 && t.dts[i] < b - 0.5) idx.push(i);
    // A picture track starts on its key frame (its index starts there: the key frame's time is `start`).
    if (!idx.length) continue;
    const duration = idx.reduce((s, i) => s + t.durs[i], 0);
    sel.push({ t, idx, duration });
  }
  if (!sel.length) return null;

  // The sound and picture in the original's order (they stay interleaved as they were), and each sample's new offset.
  const order: { s: number; i: number; off: number; size: number }[] = [];
  sel.forEach((x, s) => x.idx.forEach((i) => order.push({ s, i, off: x.t.offsets[i], size: x.t.sizes[i] })));
  order.sort((p, q) => p.off - q.off);
  const newOffset = sel.map((x) => new Float64Array(x.idx.length));
  const position = sel.map((x) => new Map(x.idx.map((i, k) => [i, k])));
  let payload = 0;
  const ranges: { start: number; end: number }[] = [];
  for (const o of order) {
    newOffset[o.s][position[o.s].get(o.i)!] = payload;
    payload += o.size;
    const last = ranges[ranges.length - 1];
    if (last && last.end === o.off) last.end += o.size;
    else ranges.push({ start: o.off, end: o.off + o.size });
  }

  const movieTs = index.movieTimescale;
  const trackBoxes = (base: number) =>
    sel.map(({ t, idx, duration }) => {
      const k = sel.findIndex((x) => x.t === t);
      const offs = newOffset[k];
      const n = idx.length;
      const stts = runs(idx.map((i) => t.durs[i]));
      const parts: Uint8Array[] = [t.stsd];
      parts.push(fullBox("stts", 0, 0, u32s([stts.length, ...stts.flat()])));
      if (t.ctts) {
        const c = runs(idx.map((i) => t.ctts![i]));
        parts.push(fullBox("ctts", t.cttsVersion, 0, u32s([c.length, ...c.flat()])));
      }
      if (t.sync) {
        const keys: number[] = [];
        idx.forEach((i, j) => t.sync![i] && keys.push(j + 1));
        parts.push(fullBox("stss", 0, 0, u32s([keys.length, ...keys])));
      }
      // One sample per chunk, a new entry where the description changes.
      const sc: number[] = [];
      idx.forEach((i, j) => {
        if (j === 0 || t.sdi[i] !== t.sdi[idx[j - 1]]) sc.push(j + 1, 1, t.sdi[i]);
      });
      parts.push(fullBox("stsc", 0, 0, u32s([sc.length / 3, ...sc])));
      parts.push(fullBox("stsz", 0, 0, u32s([0, n, ...idx.map((i) => t.sizes[i])])));
      parts.push(fullBox("stco", 0, 0, u32s([n, ...Array.from(offs, (o) => base + o)])));
      const stbl = box("stbl", ...parts);
      const minf = box("minf", ...t.minfRest, stbl);
      const mdia = box("mdia", withDuration(t.mdhd, "mdhd", duration), t.hdlr, minf);
      const movieDuration = (duration / t.timescale) * movieTs;
      const edits: Uint8Array[] = [];
      if (t.edit) {
        const entries: number[] = [];
        if (t.edit.delay > 0) entries.push(Math.round(t.edit.delay), 0xffffffff, 0x00010000);
        entries.push(Math.round(movieDuration), t.edit.mediaTime >>> 0, 0x00010000);
        edits.push(box("edts", fullBox("elst", 0, 0, u32s([entries.length / 3, ...entries]))));
      }
      return { trak: box("trak", withDuration(t.tkhd, "tkhd", movieDuration + (t.edit?.delay ?? 0)), ...edits, mdia), movieDuration: movieDuration + (t.edit?.delay ?? 0) };
    });

  const ftyp = index.ftyp ?? box("ftyp", new Uint8Array([105, 115, 111, 109, 0, 0, 2, 0, 105, 115, 111, 109, 105, 115, 111, 50, 109, 112, 52, 49]));
  const build = (base: number) => {
    const traks = trackBoxes(base);
    const mvhd = withDuration(index.mvhd, "mvhd", Math.max(...traks.map((x) => x.movieDuration)));
    return box("moov", mvhd, ...traks.map((x) => x.trak), ...index.moovRest);
  };
  // The header's size doesn't depend on the offsets in it (32-bit each): measured once, then made with them.
  const wide = payload + 8 > 0xffffffff;
  const mdatHead = new Uint8Array(wide ? 16 : 8);
  const mv = view(mdatHead);
  if (wide) {
    mv.setUint32(0, 1);
    mv.setBigUint64(8, BigInt(payload + 16));
  } else mv.setUint32(0, payload + 8);
  mdatHead.set([109, 100, 97, 116], 4);
  const size = build(0).length;
  const moov = build(ftyp.length + size + mdatHead.length);
  const parts: CutPart[] = [ftyp, moov, mdatHead, ...ranges];
  return { parts, bytes: ftyp.length + moov.length + mdatHead.length + payload, from: start, seconds: end - start };
}
