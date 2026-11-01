/**
 * The live render stream (POST /api/live/render answers with it, `application/x-fuobe-live`). Each frame is one type
 * byte, a 4-byte big-endian length and the payload:
 *
 * - `J`: a JSON event ({ type: "queued", pos } · { type: "started" } · { type: "progress", value, max } ·
 *   { type: "dropped", why } · { type: "error", message } · { type: "reconnecting" });
 * - `I`: a picture: a 4-byte header length, the JSON header (FrameHeader), then the image bytes.
 *
 * Pure, so the route, the tab and the tests share it.
 */

export const LIVE_STREAM_TYPE = "application/x-fuobe-live";

/** The largest frame read (a 4096² PNG master fits). */
export const MAX_FRAME_BYTES = 96 * 2 ** 20;

export interface FrameHeader {
  seq: number;
  slot: string;
  key: string;
  w: number;
  h: number;
  /** image/webp, image/png or image/jpeg. */
  type: string;
  /** ComfyUI's time for the render, from start to picture. */
  ms: number;
  sha256?: string;
  /** A kept master saved by the server, and its input name in ComfyUI. */
  masterId?: string;
  url?: string;
  name?: string;
}

export type LiveEvent =
  | { type: "queued"; pos: number }
  | { type: "started" }
  | { type: "progress"; value: number; max: number }
  | { type: "dropped"; why: string }
  | { type: "error"; message: string; code?: string }
  | { type: "reconnecting" };

export type Frame = { kind: "event"; event: LiveEvent } | { kind: "image"; header: FrameHeader; data: Uint8Array };

const enc = new TextEncoder();
const dec = new TextDecoder();

function wrap(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.length);
  out[0] = type;
  new DataView(out.buffer).setUint32(1, payload.length);
  out.set(payload, 5);
  return out;
}

export const eventFrame = (e: LiveEvent): Uint8Array => wrap(0x4a, enc.encode(JSON.stringify(e)));

export function imageFrame(header: FrameHeader, data: Uint8Array): Uint8Array {
  const h = enc.encode(JSON.stringify(header));
  const payload = new Uint8Array(4 + h.length + data.length);
  new DataView(payload.buffer).setUint32(0, h.length);
  payload.set(h, 4);
  payload.set(data, 4 + h.length);
  return wrap(0x49, payload);
}

export class FrameError extends Error {}

/** Reads frames from chunks as they arrive (a chunk may hold several frames, or part of one). */
export class FrameReader {
  private buf = new Uint8Array(0);

  push(chunk: Uint8Array): Frame[] {
    const joined = new Uint8Array(this.buf.length + chunk.length);
    joined.set(this.buf);
    joined.set(chunk, this.buf.length);
    this.buf = joined;
    const out: Frame[] = [];
    for (;;) {
      if (this.buf.length < 5) break;
      const view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
      const type = this.buf[0];
      const len = view.getUint32(1);
      if (type !== 0x4a && type !== 0x49) throw new FrameError(`Unknown frame type ${type}`);
      if (len > MAX_FRAME_BYTES) throw new FrameError("Frame too large");
      if (this.buf.length < 5 + len) break;
      const payload = this.buf.slice(5, 5 + len);
      this.buf = this.buf.slice(5 + len);
      out.push(parse(type, payload));
    }
    return out;
  }

  /** Bytes left over: a stream that ended inside a frame. */
  get pending(): number {
    return this.buf.length;
  }
}

function parse(type: number, payload: Uint8Array): Frame {
  if (type === 0x4a) {
    try {
      return { kind: "event", event: JSON.parse(dec.decode(payload)) as LiveEvent };
    } catch {
      throw new FrameError("Bad event");
    }
  }
  if (payload.length < 4) throw new FrameError("Bad picture frame");
  const hl = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0);
  if (4 + hl > payload.length) throw new FrameError("Bad picture header");
  let header: FrameHeader;
  try {
    header = JSON.parse(dec.decode(payload.subarray(4, 4 + hl))) as FrameHeader;
  } catch {
    throw new FrameError("Bad picture header");
  }
  return { kind: "image", header, data: payload.slice(4 + hl) };
}
