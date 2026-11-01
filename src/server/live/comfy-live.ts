import "server-only";
import { nanoid } from "nanoid";
import { parseComfyBinary, parseComfyText } from "@/lib/comfy-ws";
import type { LiveEvent } from "@/lib/live/frames";
import { LIVE_FILES, LIVE_OUTPUT, type LiveGraph } from "@/lib/live/graph";
import { comfyRequest, ownGpu } from "../providers/comfyui";
import { getSetting } from "../settings";

/**
 * Live edit's own line to ComfyUI (the server path: a local install, or an account's linked GPU). The provider's
 * socket belongs to the job runner and ignores pictures, so live edit keeps its own, with its own client id: its save
 * node sends each finished picture over it, and nothing is written to disk or read back through /view. A render is
 * registered before its prompt is posted (a fast finish can't be missed), posted at the front of ComfyUI's queue, and
 * taken out of the history once its picture is in. Stopping one deletes it while it waits and interrupts it while it
 * runs; only Fuobe's own live prompts are ever touched.
 *
 * On an account's linked GPU there is no socket (fetchPublic only): the picture is saved to temp and read back, with
 * the history polled every 80 ms.
 */

export interface LivePicture {
  data: Uint8Array;
  type: string;
  w: number;
  h: number;
  /** ComfyUI's time, from the start of the render to the picture. */
  ms: number;
}

export type LiveFailure = "offline" | "missing-input" | "missing-nodes" | "failed" | "stopped";

export class LiveRenderError extends Error {
  readonly code: LiveFailure;
  constructor(message: string, code: LiveFailure) {
    super(message);
    this.code = code;
  }
}

export interface LiveStatus {
  online: boolean;
  /** What ComfyUI is running now: one of ours, someone else's job, or nothing. */
  running: "ours" | "other" | null;
  /** Prompts waiting or running in ComfyUI. */
  queue: number;
  /** Another job ran since our last render (the model may have been unloaded: warm up first). */
  otherRan: boolean;
}

interface Waiter {
  id: string;
  started: boolean;
  startedAt: number;
  onEvent: (e: LiveEvent) => void;
  resolve: (p: LivePicture) => void;
  reject: (e: Error) => void;
}

interface LiveSocket {
  url: string;
  clientId: string;
  ws?: WebSocket;
  online: boolean;
  backoff: number;
  timer?: ReturnType<typeof setTimeout>;
  waiters: Map<string, Waiter>;
  listeners: Set<(s: LiveStatus) => void>;
  status: LiveStatus;
  /** Ours, waiting in ComfyUI's queue. */
  waiting: number;
}

declare global {
  var __fuobeLiveSocket: LiveSocket | undefined;
}

const comfyUrl = () => getSetting("comfyUrl").replace(/\/+$/, "");

/** The live socket for the install's ComfyUI (one per process, kept across hot reloads), connecting if it isn't. */
export function liveSocket(): LiveSocket {
  const url = comfyUrl();
  let s = globalThis.__fuobeLiveSocket;
  if (s && s.url !== url) {
    closeSocket(s, "ComfyUI's address changed");
    s = undefined;
  }
  if (!s) {
    s = { url, clientId: `fuobe-live-${nanoid(10)}`, online: false, backoff: 250, waiters: new Map(), listeners: new Set(), status: { online: false, running: null, queue: 0, otherRan: false }, waiting: 0 };
    globalThis.__fuobeLiveSocket = s;
  }
  if (!s.ws && !s.timer) connect(s);
  return s;
}

function setStatus(s: LiveSocket, patch: Partial<LiveStatus>) {
  const next = { ...s.status, ...patch };
  if (JSON.stringify(next) === JSON.stringify(s.status)) return;
  s.status = next;
  for (const l of s.listeners) {
    try {
      l(next);
    } catch {}
  }
}

/** Hear the socket's status (online, who runs, the queue). Returns the unsubscribe. */
export function onLiveStatus(fn: (s: LiveStatus) => void): () => void {
  const s = liveSocket();
  s.listeners.add(fn);
  fn(s.status);
  return () => s.listeners.delete(fn);
}

/** A live render ran (ours): the model is loaded again. */
export function markWarm(): void {
  const s = globalThis.__fuobeLiveSocket;
  if (s) setStatus(s, { otherRan: false });
}

function closeSocket(s: LiveSocket, why: string) {
  clearTimeout(s.timer);
  s.timer = undefined;
  const ws = s.ws;
  s.ws = undefined;
  if (ws) {
    ws.onclose = null;
    ws.onmessage = null;
    ws.onerror = null;
    try {
      ws.close();
    } catch {}
  }
  for (const w of s.waiters.values()) w.reject(new LiveRenderError(why, "offline"));
  s.waiters.clear();
  s.waiting = 0;
}

function connect(s: LiveSocket) {
  s.timer = undefined;
  let ws: WebSocket;
  try {
    ws = new WebSocket(`${s.url.replace(/^http/, "ws")}/ws?clientId=${s.clientId}`);
  } catch {
    return retry(s);
  }
  ws.binaryType = "arraybuffer";
  s.ws = ws;
  ws.onopen = () => {
    s.online = true;
    s.backoff = 250;
    setStatus(s, { online: true });
  };
  ws.onclose = () => {
    if (s.ws !== ws) return;
    s.ws = undefined;
    s.online = false;
    for (const w of s.waiters.values()) w.reject(new LiveRenderError("ComfyUI went away. Reconnecting…", "offline"));
    s.waiters.clear();
    s.waiting = 0;
    setStatus(s, { online: false, running: null });
    retry(s);
  };
  ws.onerror = () => {};
  ws.onmessage = (ev) => {
    if (typeof ev.data !== "string") return picture(s, new Uint8Array(ev.data as ArrayBuffer));
    const e = parseComfyText(ev.data);
    if (!e) return;
    if (e.type === "status") {
      const queue = e.queueRemaining ?? 0;
      const oursRunning = [...s.waiters.values()].some((w) => w.started);
      const ours = s.waiting + (oursRunning ? 1 : 0);
      const other = queue > ours;
      setStatus(s, { queue, running: oursRunning ? "ours" : other ? "other" : null, ...(other && { otherRan: true }) });
      return;
    }
    const w = "promptId" in e && e.promptId ? s.waiters.get(e.promptId) : undefined;
    if (!w) return;
    if (e.type === "execution_start") {
      w.started = true;
      w.startedAt = Date.now();
      s.waiting = Math.max(0, s.waiting - 1);
      setStatus(s, { running: "ours" });
      w.onEvent({ type: "started" });
    } else if (e.type === "progress" && e.max <= 8) {
      w.onEvent({ type: "progress", value: e.value, max: e.max });
    } else if (e.type === "error") {
      w.reject(new LiveRenderError(e.message ?? "The render failed", e.nodeType === "LoadImageFuobeLive" ? "missing-input" : "failed"));
    } else if (e.type === "interrupted") {
      w.reject(new LiveRenderError("Stopped", "stopped"));
    }
  };
}

function retry(s: LiveSocket) {
  if (globalThis.__fuobeLiveSocket !== s || s.timer) return;
  // Jittered backoff, 250 ms to 3 s.
  const wait = Math.min(3000, s.backoff) * (0.75 + Math.random() * 0.5);
  s.backoff = Math.min(3000, s.backoff * 2);
  s.timer = setTimeout(() => connect(s), wait);
  s.timer.unref?.();
}

function picture(s: LiveSocket, bytes: Uint8Array) {
  const p = parseComfyBinary(bytes);
  if (!p?.promptId) return;
  const w = s.waiters.get(p.promptId);
  if (!w || (!p.live && p.node !== LIVE_OUTPUT)) return;
  w.resolve({ data: p.data.slice(), type: p.type, w: p.width ?? 0, h: p.height ?? 0, ms: Date.now() - (w.startedAt || Date.now()) });
}

const post = (p: string, body: unknown) => comfyRequest(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Wait until the install's ComfyUI socket is up again, at most `ms` (true on a linked GPU: no socket). */
export async function waitOnline(ms: number): Promise<boolean> {
  if (ownGpu()) return true;
  return online(liveSocket(), ms);
}

/** Wait for the socket to be up, at most `ms`. */
async function online(s: LiveSocket, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (!s.online && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  return s.online;
}

async function refusal(res: Response): Promise<LiveRenderError> {
  const text = await res.text().catch(() => "");
  let body: { error?: { type?: string; message?: string; extra_info?: { class_type?: string } } } = {};
  try {
    body = JSON.parse(text);
  } catch {}
  if (body.error?.type === "missing_node_type") return new LiveRenderError("Fuobe's live nodes aren't installed in ComfyUI", "missing-nodes");
  return new LiveRenderError(body.error?.message ? `ComfyUI refused the render: ${body.error.message}` : `ComfyUI answered ${res.status}`, "failed");
}

/**
 * One render: the graph's picture, or a LiveRenderError. `signal` stops it (deleted while queued, interrupted while
 * running). `onEvent` hears started and progress.
 */
export async function renderLive(graph: LiveGraph, signal: AbortSignal, onEvent: (e: LiveEvent) => void): Promise<LivePicture> {
  if (ownGpu()) return renderPolling(graph, signal, onEvent);
  const s = liveSocket();
  if (!(await online(s, 3000))) throw new LiveRenderError("Can't reach ComfyUI. Reconnecting…", "offline");
  const id = crypto.randomUUID();
  let settle!: { resolve: (p: LivePicture) => void; reject: (e: Error) => void };
  const done = new Promise<LivePicture>((resolve, reject) => (settle = { resolve, reject }));
  // Awaited below; a rejection while the prompt is still being posted must not count as unhandled.
  done.catch(() => {});
  const waiter: Waiter = {
    id,
    started: false,
    startedAt: 0,
    onEvent,
    resolve: (p) => {
      s.waiters.delete(id);
      settle.resolve(p);
    },
    reject: (e) => {
      if (s.waiters.get(id) === waiter && !waiter.started) s.waiting = Math.max(0, s.waiting - 1);
      s.waiters.delete(id);
      settle.reject(e);
    },
  };
  s.waiters.set(id, waiter);
  s.waiting++;
  const stop = () => {
    const started = waiter.started;
    waiter.reject(new LiveRenderError("Stopped", "stopped"));
    void post("/queue", { delete: [id] }).catch(() => undefined);
    if (started) void post("/interrupt", { prompt_id: id }).catch(() => undefined);
  };
  if (signal.aborted) stop();
  else signal.addEventListener("abort", stop, { once: true });
  try {
    const res = await post("/prompt", { prompt: graph, prompt_id: id, client_id: s.clientId, front: true });
    if (!res.ok) waiter.reject(await refusal(res));
    else {
      res.body?.cancel().catch(() => {});
      onEvent({ type: "queued", pos: Math.max(0, s.status.queue) });
    }
  } catch (e) {
    waiter.reject(new LiveRenderError((e as Error).message || "Can't reach ComfyUI", "offline"));
  }
  try {
    const p = await done;
    markWarm();
    return p;
  } finally {
    signal.removeEventListener("abort", stop);
    // Live renders don't pile up in ComfyUI's history.
    void post("/history", { delete: [id] }).catch(() => undefined);
  }
}

/** An account's linked GPU: no socket; the picture is saved to temp and read back. */
async function renderPolling(graph: LiveGraph, signal: AbortSignal, onEvent: (e: LiveEvent) => void): Promise<LivePicture> {
  const id = crypto.randomUUID();
  const g = structuredClone(graph);
  if (g[LIVE_OUTPUT]) g[LIVE_OUTPUT].inputs.to = "temp";
  const t0 = Date.now();
  const res = await post("/prompt", { prompt: g, prompt_id: id, client_id: "fuobe-live-link", front: true }).catch((e: Error) => {
    throw new LiveRenderError(e.message, "offline");
  });
  if (!res.ok) throw await refusal(res);
  res.body?.cancel().catch(() => {});
  onEvent({ type: "queued", pos: 0 });
  let started = false;
  try {
    for (;;) {
      if (signal.aborted) throw new LiveRenderError("Stopped", "stopped");
      await new Promise((r) => setTimeout(r, 80));
      const h: Record<string, HistoryEntry> = await comfyRequest(`/history/${id}`).then((r) => (r.ok ? (r.json() as Promise<Record<string, HistoryEntry>>) : {}));
      const entry = h[id];
      if (!entry) {
        if (!started) {
          started = true;
          onEvent({ type: "started" });
        }
        continue;
      }
      const err = entry.status?.messages?.find(([t]) => t === "execution_error")?.[1] as { exception_message?: string; node_type?: string } | undefined;
      if (err) throw new LiveRenderError(err.exception_message ?? "The render failed", err.node_type === "LoadImageFuobeLive" ? "missing-input" : "failed");
      const img = entry.outputs?.[LIVE_OUTPUT]?.images?.[0];
      if (!img || img.type !== "temp" || !/^[\w.-]+$/.test(img.filename)) throw new LiveRenderError("The render made no picture", "failed");
      const view = await comfyRequest(`/view?${new URLSearchParams({ filename: img.filename, subfolder: "", type: "temp" })}`);
      if (!view.ok) throw new LiveRenderError("Couldn't read the picture", "failed");
      const data = new Uint8Array(await view.arrayBuffer());
      return { data, type: view.headers.get("content-type") ?? "image/webp", w: 0, h: 0, ms: Date.now() - t0 };
    }
  } catch (e) {
    if (signal.aborted) {
      void post("/queue", { delete: [id] }).catch(() => undefined);
      void post("/interrupt", { prompt_id: id }).catch(() => undefined);
    }
    throw e;
  } finally {
    void post("/history", { delete: [id] }).catch(() => undefined);
  }
}

type HistoryEntry = { outputs?: Record<string, { images?: { filename: string; subfolder?: string; type: string }[] }>; status?: { messages?: [string, unknown][] } };

/** Put a picture in ComfyUI's input folder under its content name (skipped when it is already there). */
export async function stageInput(name: string, data: Uint8Array, type: string, force = false): Promise<void> {
  if (!force) {
    const head = await comfyRequest(`/view?${new URLSearchParams({ filename: name, subfolder: "", type: "input" })}`, { method: "HEAD" }).catch(() => undefined);
    if (head?.ok) return;
  }
  const form = new FormData();
  form.append("image", new Blob([data as BlobPart], { type }), name);
  form.append("type", "input");
  form.append("overwrite", "true");
  const res = await comfyRequest("/upload/image", { method: "POST", body: form }).catch((e: Error) => {
    throw new LiveRenderError(e.message, "offline");
  });
  if (!res.ok) throw new LiveRenderError(`ComfyUI refused the picture (${res.status})`, "failed");
  res.body?.cancel().catch(() => {});
}

/** The model files live edit reads, by folder. */
const FILES: [string, string][] = [
  ["diffusion_models", LIVE_FILES.unet],
  ["text_encoders", LIVE_FILES.clip],
  ["vae", LIVE_FILES.vae],
  ["loras", LIVE_FILES.lora],
];

/**
 * Whether ComfyUI has Fuobe's live nodes (their version, or 0), whether it runs with --highvram or --gpu-only, and the
 * model files its folders don't list ("folder/file"; a folder that can't be read lists nothing missing).
 */
export async function liveFacts(): Promise<{ nodes: number; highvram: boolean | null; missing: string[] }> {
  const missing = (
    await Promise.all(
      FILES.map(async ([folder, file]) => {
        const list = await comfyRequest(`/models/${folder}`)
          .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
          .catch(() => null);
        return Array.isArray(list) && !list.includes(file) ? `${folder}/${file}` : null;
      }),
    )
  ).filter((x): x is string => !!x);
  const [nodes, stats] = await Promise.all([
    comfyRequest("/fuobe/live")
      .then(async (r) => (r.ok ? Number(((await r.json()) as { version?: unknown }).version) || 0 : 0))
      .catch(() => 0),
    comfyRequest("/system_stats")
      .then(async (r) => (r.ok ? ((await r.json()) as { system?: { argv?: string[] } }) : null))
      .catch(() => null),
  ]);
  const argv = stats?.system?.argv;
  return { nodes, highvram: Array.isArray(argv) ? argv.includes("--highvram") || argv.includes("--gpu-only") : null, missing };
}
