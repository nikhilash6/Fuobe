/**
 * ComfyUI's live socket (/ws?clientId=…), as the Fuobe tab reads it: JSON events (status, execution_start, progress,
 * executing, execution_success / error / interrupted, execution_cached) and binary preview frames. A binary frame is a
 * 4-byte big-endian event type, then: type 1, a 4-byte image type (1 JPEG, 2 PNG) and the image; type 4, a 4-byte
 * metadata length, its JSON (prompt_id, node_id, image_type) and the image. Anything else, or anything malformed, is
 * ignored. Pure.
 */

export type ComfyEvent =
  | { type: "status"; queueRemaining?: number }
  | { type: "execution_start"; promptId: string }
  | { type: "progress"; promptId?: string; value: number; max: number; node?: string }
  | { type: "executing"; promptId?: string; node: string | null }
  | { type: "executed"; promptId?: string; node?: string }
  | { type: "cached"; promptId?: string; nodes: string[] }
  | { type: "success"; promptId: string }
  | { type: "error"; promptId: string; message?: string; nodeType?: string }
  | { type: "interrupted"; promptId: string };

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function parseComfyText(text: string): ComfyEvent | null {
  let msg: { type?: unknown; data?: Record<string, unknown> };
  try {
    msg = JSON.parse(text) as typeof msg;
  } catch {
    return null;
  }
  const d = msg?.data && typeof msg.data === "object" ? msg.data : {};
  const promptId = str(d.prompt_id);
  switch (msg?.type) {
    case "status": {
      const q = num((d.status as { exec_info?: { queue_remaining?: unknown } } | undefined)?.exec_info?.queue_remaining);
      return { type: "status", ...(q !== undefined && { queueRemaining: q }) };
    }
    case "execution_start":
      return promptId ? { type: "execution_start", promptId } : null;
    case "progress": {
      const value = num(d.value);
      const max = num(d.max);
      if (value === undefined || max === undefined) return null;
      return { type: "progress", promptId, value, max, ...(str(d.node) && { node: str(d.node) }) };
    }
    case "executing":
      return { type: "executing", promptId, node: str(d.node) ?? null };
    case "executed":
      return { type: "executed", promptId, node: str(d.node) };
    case "execution_cached":
      return { type: "cached", promptId, nodes: Array.isArray(d.nodes) ? d.nodes.filter((n): n is string => typeof n === "string") : [] };
    case "execution_success":
      return promptId ? { type: "success", promptId } : null;
    case "execution_error":
      return promptId ? { type: "error", promptId, message: str(d.exception_message), nodeType: str(d.node_type) } : null;
    case "execution_interrupted":
      return promptId ? { type: "interrupted", promptId } : null;
    default:
      return null;
  }
}

export interface ComfyPreview {
  /** image/jpeg or image/png. */
  type: string;
  data: Uint8Array;
  /** Set on type-4 frames (a newer ComfyUI): whose preview it is. */
  promptId?: string;
}

/** The longest preview metadata read (a few hundred bytes in practice). */
const MAX_META = 64 * 1024;

export function parseComfyBinary(buf: ArrayBuffer | Uint8Array): ComfyPreview | null {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b.length < 8) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const event = view.getUint32(0);
  if (event === 1) {
    const kind = view.getUint32(4);
    const type = kind === 2 ? "image/png" : kind === 1 ? "image/jpeg" : null;
    if (!type || b.length <= 8) return null;
    return { type, data: b.subarray(8) };
  }
  if (event === 4) {
    const len = view.getUint32(4);
    if (len > MAX_META || 8 + len >= b.length) return null;
    let meta: { prompt_id?: unknown; image_type?: unknown };
    try {
      meta = JSON.parse(new TextDecoder().decode(b.subarray(8, 8 + len))) as typeof meta;
    } catch {
      return null;
    }
    const type = meta.image_type === "image/png" ? "image/png" : meta.image_type === "image/jpeg" ? "image/jpeg" : null;
    if (!type) return null;
    return { type, data: b.subarray(8 + len), ...(typeof meta.prompt_id === "string" && { promptId: meta.prompt_id }) };
  }
  return null;
}
