import "server-only";
import { nanoid } from "nanoid";
import { LIVE_NODES_VERSION, liveNodesState } from "@/lib/comfy-live-nodes";
import { parseComfyBinary, parseComfyText } from "@/lib/comfy-ws";
import type { LiveEvent } from "@/lib/live/frames";
import { RENDER_DEADLINE_MS } from "@/lib/live/scheduler";
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
 * the history polled every 80 ms. Every render has a deadline, and one ComfyUI no longer has ends: nothing waits forever.
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
  /** Ours, stopped before they were seen to start: interrupted if they start after all. */
  stopped: Set<string>;
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
    s = { url, clientId: `fuobe-live-${nanoid(10)}`, online: false, backoff: 250, waiters: new Map(), listeners: new Set(), status: { online: false, running: null, queue: 0, otherRan: false }, waiting: 0, stopped: new Set() };
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
    if (!w) {
      // One of ours that was stopped started anyway (the delete came too late): interrupt it, now that it is ours running.
      if (e.type === "execution_start" && s.stopped.delete(e.promptId)) void post("/interrupt", { prompt_id: e.promptId }).catch(() => undefined);
      return;
    }
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
    } else if (e.type === "success" || (e.type === "executing" && e.node === null)) {
      // Finished, and no picture came (the picture is always sent before this): an old copy of the nodes served from
      // ComfyUI's cache. Never wait forever.
      w.reject(new LiveRenderError("ComfyUI finished without sending the picture. Update Fuobe's live nodes.", "failed"));
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

export { RENDER_DEADLINE_MS };
/** How often a render that hasn't finished checks that ComfyUI still has it (a restart or a cleared queue drops it without a word). */
export const GONE_CHECK_MS = 4000;
/** The largest picture read back from a linked GPU (a 4096 px PNG master fits with room to spare). */
export const MAX_PICTURE_BYTES = 80 * 2 ** 20;

/** Whether ComfyUI still has a prompt, waiting or running (null: it couldn't be asked). */
async function inQueue(id: string): Promise<boolean | null> {
  try {
    const r = await comfyRequest("/queue");
    if (!r.ok) return null;
    const q = (await r.json()) as { queue_running?: unknown[][]; queue_pending?: unknown[][] };
    return [...(q.queue_running ?? []), ...(q.queue_pending ?? [])].some((row) => Array.isArray(row) && row[1] === id);
  } catch {
    return null;
  }
}

/**
 * Take a prompt of ours off ComfyUI: deleted if it waits, interrupted if it runs. An interrupt goes only to a prompt
 * known to be ours and running (an older ComfyUI stops whatever runs, whatever prompt an interrupt names): one not yet
 * seen to start is remembered, and interrupted if it starts after all.
 */
function takeOff(s: LiveSocket, id: string, started: boolean) {
  void post("/queue", { delete: [id] }).catch(() => undefined);
  if (started) void post("/interrupt", { prompt_id: id }).catch(() => undefined);
  else {
    s.stopped.add(id);
    if (s.stopped.size > 200) s.stopped.delete(s.stopped.values().next().value!);
  }
}

/** The same on a linked GPU (no events): interrupted only when its queue shows this prompt running. */
async function takeOffPolled(id: string) {
  await post("/queue", { delete: [id] }).catch(() => undefined);
  try {
    const r = await comfyRequest("/queue");
    const q = r.ok ? ((await r.json()) as { queue_running?: unknown[][] }) : {};
    if ((q.queue_running ?? []).some((row) => Array.isArray(row) && row[1] === id)) await post("/interrupt", { prompt_id: id });
  } catch {}
}

/**
 * One render: the graph's picture, or a LiveRenderError. `signal` stops it (deleted while queued, interrupted while
 * running). `onEvent` hears started and progress. A render ends, one way or another: by its picture, an error, a stop,
 * ComfyUI finishing without a picture, ComfyUI no longer having the prompt, or `deadlineMs`.
 */
export async function renderLive(graph: LiveGraph, signal: AbortSignal, onEvent: (e: LiveEvent) => void, deadlineMs: number = RENDER_DEADLINE_MS.keep): Promise<LivePicture> {
  if (signal.aborted) throw new LiveRenderError("Stopped", "stopped");
  if (ownGpu()) return renderPolling(graph, signal, onEvent, deadlineMs);
  const s = liveSocket();
  if (!(await online(s, 3000))) throw new LiveRenderError("Can't reach ComfyUI. Reconnecting…", "offline");
  // Stopped while waiting for the socket: nothing was sent, nothing to take off.
  if (signal.aborted) throw new LiveRenderError("Stopped", "stopped");
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
  const end = (e: LiveRenderError) => {
    const started = waiter.started;
    const had = s.waiters.get(id) === waiter;
    waiter.reject(e);
    if (had) takeOff(s, id, started);
  };
  const stop = () => end(new LiveRenderError("Stopped", "stopped"));
  signal.addEventListener("abort", stop, { once: true });
  const deadline = setTimeout(() => end(new LiveRenderError("ComfyUI took too long with this render", "failed")), deadlineMs);
  deadline.unref?.();
  // A prompt ComfyUI dropped without a word (a cleared queue, a restart the socket didn't see): gone twice in a row.
  let gone = 0;
  const watch = setInterval(() => {
    if (!s.waiters.has(id)) return;
    void inQueue(id).then((has) => {
      gone = has === false ? gone + 1 : 0;
      if (gone >= 2) waiter.reject(new LiveRenderError("ComfyUI dropped the render", "failed"));
    });
  }, GONE_CHECK_MS);
  watch.unref?.();
  try {
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
    // Stopped while the prompt was on its way: the first delete may have arrived before it, so take it off again.
    if (signal.aborted) takeOff(s, id, false);
    const p = await done;
    markWarm();
    return p;
  } finally {
    clearTimeout(deadline);
    clearInterval(watch);
    signal.removeEventListener("abort", stop);
    // Live renders don't pile up in ComfyUI's history.
    void post("/history", { delete: [id] }).catch(() => undefined);
  }
}

/** A response body, read up to `max` bytes (null when it is larger). */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** An account's linked GPU: no socket; the picture is saved to temp and read back. */
async function renderPolling(graph: LiveGraph, signal: AbortSignal, onEvent: (e: LiveEvent) => void, deadlineMs: number): Promise<LivePicture> {
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
  let lastCheck = Date.now();
  let gone = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new LiveRenderError("Stopped", "stopped");
      if (Date.now() - t0 > deadlineMs) throw new LiveRenderError("ComfyUI took too long with this render", "failed");
      await new Promise((r) => setTimeout(r, 80));
      const h: Record<string, HistoryEntry> = await comfyRequest(`/history/${id}`).then((r) => (r.ok ? (r.json() as Promise<Record<string, HistoryEntry>>) : {}));
      const entry = h[id];
      if (!entry) {
        if (!started) {
          started = true;
          onEvent({ type: "started" });
        }
        if (Date.now() - lastCheck >= GONE_CHECK_MS) {
          lastCheck = Date.now();
          const has = await inQueue(id);
          gone = has === false ? gone + 1 : 0;
          if (gone >= 2) throw new LiveRenderError("ComfyUI dropped the render", "failed");
        }
        continue;
      }
      const err = entry.status?.messages?.find(([t]) => t === "execution_error")?.[1] as { exception_message?: string; node_type?: string } | undefined;
      if (err) throw new LiveRenderError(err.exception_message ?? "The render failed", err.node_type === "LoadImageFuobeLive" ? "missing-input" : "failed");
      const img = entry.outputs?.[LIVE_OUTPUT]?.images?.[0];
      if (!img || img.type !== "temp" || !/^[\w.-]+$/.test(img.filename)) throw new LiveRenderError("The render made no picture", "failed");
      const view = await comfyRequest(`/view?${new URLSearchParams({ filename: img.filename, subfolder: "", type: "temp" })}`);
      if (!view.ok) {
        view.body?.cancel().catch(() => {});
        throw new LiveRenderError("Couldn't read the picture", "failed");
      }
      const data = await readCapped(view, MAX_PICTURE_BYTES);
      if (!data) throw new LiveRenderError("The picture is too large", "failed");
      return { data, type: view.headers.get("content-type") ?? "image/webp", w: 0, h: 0, ms: Date.now() - t0 };
    }
  } catch (e) {
    // Stopped, dropped or too slow: off ComfyUI (ours only).
    if (!(e instanceof LiveRenderError) || e.code !== "missing-input") void takeOffPolled(id);
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
 * Whether ComfyUI has Fuobe's live nodes (their version when it is exactly this copy, or 0; outdated: another copy),
 * whether it runs with --highvram or --gpu-only, and the model files its folders don't list ("folder/file"; a folder
 * that can't be read lists nothing missing).
 */
export async function liveFacts(): Promise<{ nodes: number; outdated: boolean; highvram: boolean | null; missing: string[] }> {
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
      .then(async (r) => (r.ok ? ((await r.json()) as unknown) : null))
      .catch(() => null),
    comfyRequest("/system_stats")
      .then(async (r) => (r.ok ? ((await r.json()) as { system?: { argv?: string[] } }) : null))
      .catch(() => null),
  ]);
  const argv = stats?.system?.argv;
  const state = liveNodesState(nodes);
  return { nodes: state === "ok" ? LIVE_NODES_VERSION : 0, outdated: state === "outdated", highvram: Array.isArray(argv) ? argv.includes("--highvram") || argv.includes("--gpu-only") : null, missing };
}
