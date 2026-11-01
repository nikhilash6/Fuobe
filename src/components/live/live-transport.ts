"use client";

import { parseComfyBinary, parseComfyText } from "@/lib/comfy-ws";
import { loopbackFetch } from "@/lib/gpu/browser-check";
import { FrameReader, type LiveEvent } from "@/lib/live/frames";
import { buildLiveGraph, LIVE_FILES, LIVE_OUTPUT, liveGraphProblem, slotBindings, type LiveGraphParams } from "@/lib/live/graph";
import { inputName, pictureExt, PICTURE_TYPES, pngSize, sha256Hex } from "@/lib/live/names";
import { LiveScheduler, type Slot } from "@/lib/live/scheduler";
import { editSize, type Aspect } from "@/lib/live/sizes";
import { normalize, renderKey } from "@/lib/live/text";
import { graphProblem, localBase, readPath, writePath } from "@/lib/local-comfy";
import { imageSize } from "@/lib/image-size";

/**
 * How the live editor reaches ComfyUI. Two ways, one interface:
 *
 * - ServerTransport: through Fuobe's server (a local install, or an account's linked GPU): one streamed POST per
 *   render (POST /api/live/render), status over server-sent events.
 * - ChannelTransport: from this tab straight to the ComfyUI on this computer ("Use the ComfyUI on this computer"): the
 *   graph is built here, checked by the relay's rules and the live graph check, and sent to 127.0.0.1 with this tab's own
 *   client id; only prompts and pictures this tab made are ever touched. No server hop per render.
 */

export interface RenderReq {
  seq: number;
  slot: Slot;
  urgent?: boolean;
  text: string;
  /** compose (lab): the kept texts and the live text as one instruction. */
  compose?: string;
  seed: number;
  size: number;
  keepRes: number;
  base?: string;
  refs?: string[];
  mask?: string;
  aspect: Aspect;
  method: string;
}

export interface RenderOut {
  data: Uint8Array;
  type: string;
  w: number;
  h: number;
  /** ComfyUI's render time. */
  ms: number;
  sha256: string;
  key: string;
  /** A kept master: where Fuobe keeps it, and its name in ComfyUI. */
  masterUrl?: string;
  masterName?: string;
  /** Reused the settled render on screen (no new render). */
  reused?: boolean;
}

export type RenderResult = { ok: true; out: RenderOut } | { ok: false; dropped: string } | { ok: false; error: string; code?: string };

export interface StagedPicture {
  name: string;
  w: number;
  h: number;
  sha256: string;
}

export interface LiveFacts {
  nodes: number;
  highvram: boolean | null;
  /** Model files ComfyUI doesn't list (folder/file). */
  missing: string[];
}

export type OpenResult = ({ ok: true; seed: number } & LiveFacts) | { ok: false; error: string; code?: string };

export interface TransportStatus {
  online: boolean;
  running: "ours" | "other" | null;
  queue: number;
  otherRan: boolean;
}

export interface LiveTransport {
  kind: "server" | "link" | "computer";
  open(): Promise<OpenResult>;
  /** Stage a Fuobe file (the picture being edited, a reference). */
  stageFile(url: string): Promise<StagedPicture>;
  /** Stage bytes made here (a painted mask; on the computer path, a kept master). */
  stageBytes(bytes: Uint8Array, kind: "mask" | "master"): Promise<StagedPicture>;
  render(req: RenderReq, onEvent: (e: LiveEvent) => void): Promise<RenderResult>;
  hurry(seq: number): void;
  /** Stop renders that no longer matter (the base changed, live was switched off). */
  cancel(match: (seq: number, slot: Slot) => boolean): void;
  onStatus(fn: (s: TransportStatus) => void): () => void;
  close(): void;
}

/** The key a render is cached by (the server computes the same). */
export function keyOf(r: Pick<RenderReq, "base" | "refs" | "mask" | "text" | "compose" | "seed" | "size" | "keepRes" | "aspect" | "method" | "slot">): string {
  const keep = r.slot === "keep" || r.slot === "settle";
  const prompt = r.method === "compose" && r.compose !== undefined ? r.compose : normalize(r.text);
  return renderKey({ base: r.base ?? "", refs: r.refs, mask: r.mask, text: prompt, seed: r.seed, size: keep ? r.keepRes : r.size, aspect: r.aspect, method: r.method, quality: keep ? "keep" : "live" });
}

// ---------------------------------------------------------------------------
// Through Fuobe's server

export class ServerTransport implements LiveTransport {
  kind: "server" | "link" = "server";
  private sessionId = "";
  private inflight = new Map<number, { ctl: AbortController; slot: Slot }>();
  private es: EventSource | null = null;
  private listeners = new Set<(s: TransportStatus) => void>();
  private status: TransportStatus = { online: false, running: null, queue: 0, otherRan: false };

  async open(): Promise<OpenResult> {
    let stored: string | undefined;
    try {
      stored = sessionStorage.getItem("fuobe-live:session") ?? undefined;
    } catch {}
    const res = await fetch("/api/live/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: stored }) });
    const j = (await res.json().catch(() => ({}))) as { sessionId?: string; mode?: "server" | "link"; seed?: number; nodes?: { version?: number }; highvram?: boolean | null; missing?: string[]; error?: string; code?: string };
    if (!res.ok || !j.sessionId) return { ok: false, error: j.error ?? `Live edit didn't start (${res.status})`, code: j.code };
    this.sessionId = j.sessionId;
    this.kind = j.mode === "link" ? "link" : "server";
    try {
      sessionStorage.setItem("fuobe-live:session", j.sessionId);
    } catch {}
    this.listen();
    return { ok: true, seed: j.seed ?? 0, nodes: j.nodes?.version ?? 0, highvram: j.highvram ?? null, missing: j.missing ?? [] };
  }

  private listen() {
    this.es?.close();
    const es = new EventSource(`/api/live/events?session=${encodeURIComponent(this.sessionId)}`);
    this.es = es;
    es.addEventListener("status", (ev) => {
      try {
        this.status = JSON.parse((ev as MessageEvent).data) as TransportStatus;
        for (const l of this.listeners) l(this.status);
      } catch {}
    });
    es.onerror = () => {
      this.status = { ...this.status, online: false };
      for (const l of this.listeners) l(this.status);
    };
  }

  onStatus(fn: (s: TransportStatus) => void) {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  async stageFile(url: string): Promise<StagedPicture> {
    const res = await fetch("/api/live/inputs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: this.sessionId, file: url }) });
    const j = (await res.json().catch(() => ({}))) as { name?: string; width?: number; height?: number; sha256?: string; error?: string };
    if (!res.ok || !j.name) throw new Error(j.error ?? `Couldn't add the picture (${res.status})`);
    return { name: j.name, w: j.width ?? 0, h: j.height ?? 0, sha256: j.sha256 ?? "" };
  }

  async stageBytes(bytes: Uint8Array): Promise<StagedPicture> {
    const res = await fetch("/api/live/inputs", { method: "POST", headers: { "content-type": "image/png", "x-live-session": this.sessionId }, body: bytes as BodyInit });
    const j = (await res.json().catch(() => ({}))) as { name?: string; width?: number; height?: number; sha256?: string; error?: string };
    if (!res.ok || !j.name) throw new Error(j.error ?? `Couldn't add the picture (${res.status})`);
    return { name: j.name, w: j.width ?? 0, h: j.height ?? 0, sha256: j.sha256 ?? "" };
  }

  async render(req: RenderReq, onEvent: (e: LiveEvent) => void): Promise<RenderResult> {
    const ctl = new AbortController();
    this.inflight.set(req.seq, { ctl, slot: req.slot });
    const key = keyOf(req);
    try {
      const res = await fetch("/api/live/render", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: this.sessionId, ...req }), signal: ctl.signal });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        return { ok: false, error: j.error ?? `The render failed (${res.status})`, code: j.code ?? (res.status === 410 ? "session" : undefined) };
      }
      const reader = res.body.getReader();
      const fr = new FrameReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const f of fr.push(value)) {
          if (f.kind === "event") {
            if (f.event.type === "dropped") return { ok: false, dropped: f.event.why };
            if (f.event.type === "error") return { ok: false, error: f.event.message, code: f.event.code };
            onEvent(f.event);
          } else {
            const h = f.header;
            return { ok: true, out: { data: f.data, type: h.type, w: h.w, h: h.h, ms: h.ms, sha256: h.sha256 ?? (await sha256Hex(f.data)), key, ...(h.url && { masterUrl: h.url }), ...(h.name && { masterName: h.name }) } };
          }
        }
      }
      return { ok: false, dropped: "closed" };
    } catch {
      if (ctl.signal.aborted) return { ok: false, dropped: "cancelled" };
      return { ok: false, error: "Lost the connection to Fuobe", code: "offline" };
    } finally {
      this.inflight.delete(req.seq);
    }
  }

  hurry(): void {
    // The server's scheduler hurries an urgent request itself (it carries `urgent`).
  }

  cancel(match: (seq: number, slot: Slot) => boolean): void {
    const seqs: number[] = [];
    for (const [seq, f] of this.inflight)
      if (match(seq, f.slot) && f.slot !== "keep") {
        f.ctl.abort();
        seqs.push(seq);
      }
    // A backup for a browser whose aborted request doesn't reach the server.
    if (seqs.length) void fetch("/api/live/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: this.sessionId, seqs }), keepalive: true }).catch(() => {});
  }

  close(): void {
    this.cancel(() => true);
    this.es?.close();
    this.es = null;
  }
}

// ---------------------------------------------------------------------------
// From this tab to the ComfyUI on this computer

interface ChannelJob {
  req: RenderReq;
  params: LiveGraphParams;
  key: string;
  onEvent: (e: LiveEvent) => void;
}

interface Waiter {
  started: boolean;
  startedAt: number;
  onEvent: (e: LiveEvent) => void;
  resolve: (p: { data: Uint8Array; type: string; w: number; h: number; ms: number }) => void;
  reject: (e: Error & { code?: string }) => void;
}

const fail = (message: string, code: string) => Object.assign(new Error(message), { code });

export class ChannelTransport implements LiveTransport {
  kind = "computer" as const;
  private base: string;
  private clientId = `fuobe-live-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  private ws: WebSocket | null = null;
  private online = false;
  private backoff = 250;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  /** Prompt ids this tab minted: the only ones it may stop or take out of the history. */
  private ownIds: string[] = [];
  /** Names this tab staged, with its own copy of their bytes (to stage again after ComfyUI restarts). */
  private names = new Map<string, { bytes: Uint8Array; type: string; w: number; h: number; sha256: string }>();
  private waiters = new Map<string, Waiter>();
  private listeners = new Set<(s: TransportStatus) => void>();
  private status: TransportStatus = { online: false, running: null, queue: 0, otherRan: false };
  private waiting = 0;
  private scheduler: LiveScheduler<ChannelJob, RenderOut>;

  constructor(port: number, host = "127.0.0.1") {
    this.base = localBase(port, host);
    this.scheduler = new LiveScheduler<ChannelJob, RenderOut>({ run: (job, signal) => this.run(job.payload, signal) });
  }

  private set(patch: Partial<TransportStatus>) {
    const next = { ...this.status, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.status)) return;
    this.status = next;
    for (const l of this.listeners) l(next);
  }

  onStatus(fn: (s: TransportStatus) => void) {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private get(path: string) {
    return loopbackFetch(`${this.base}${readPath(path)}`);
  }

  private post(path: string, body: unknown) {
    const p = writePath(path, body, { promptIds: this.ownIds, names: [...this.names.keys()] });
    return loopbackFetch(`${this.base}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  async open(): Promise<OpenResult> {
    this.closed = false;
    try {
      const stats = await this.get("/system_stats");
      if (!stats.ok) return { ok: false, error: "ComfyUI on this computer didn't answer", code: "offline" };
      const argv = ((await stats.json()) as { system?: { argv?: string[] } }).system?.argv;
      const nodes = await this.get("/fuobe/live").then(async (r) => (r.ok ? Number(((await r.json()) as { version?: number }).version) || 0 : 0)).catch(() => 0);
      const missing: string[] = [];
      for (const [folder, file] of [["diffusion_models", LIVE_FILES.unet], ["text_encoders", LIVE_FILES.clip], ["vae", LIVE_FILES.vae], ["loras", LIVE_FILES.lora]] as const) {
        const list = await this.get(`/models/${folder}`).then((r) => (r.ok ? (r.json() as Promise<string[]>) : null)).catch(() => null);
        if (Array.isArray(list) && !list.includes(file)) missing.push(`${folder}/${file}`);
      }
      this.connect();
      return { ok: true, seed: Math.floor(Math.random() * 2 ** 31), nodes, highvram: Array.isArray(argv) ? argv.includes("--highvram") || argv.includes("--gpu-only") : null, missing };
    } catch {
      return { ok: false, error: "Can't reach the ComfyUI on this computer", code: "offline" };
    }
  }

  private connect() {
    if (this.closed) return;
    this.timer = undefined;
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${this.base.replace(/^http/, "ws")}${readPath(`/ws?clientId=${this.clientId}`)}`);
    } catch {
      return this.retry();
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      this.online = true;
      this.backoff = 250;
      this.set({ online: true });
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.online = false;
      for (const w of this.waiters.values()) w.reject(fail("ComfyUI went away. Reconnecting…", "offline"));
      this.waiters.clear();
      this.waiting = 0;
      this.set({ online: false, running: null });
      this.retry();
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") {
        const p = parseComfyBinary(new Uint8Array(ev.data as ArrayBuffer));
        const w = p?.promptId ? this.waiters.get(p.promptId) : undefined;
        if (p && w && (p.live || p.node === LIVE_OUTPUT)) w.resolve({ data: p.data.slice(), type: p.type, w: p.width ?? 0, h: p.height ?? 0, ms: performance.now() - (w.startedAt || performance.now()) });
        return;
      }
      const e = parseComfyText(ev.data);
      if (!e) return;
      if (e.type === "status") {
        const queue = e.queueRemaining ?? 0;
        const runningOurs = [...this.waiters.values()].some((w) => w.started);
        const other = queue > this.waiting + (runningOurs ? 1 : 0);
        this.set({ queue, running: runningOurs ? "ours" : other ? "other" : null, ...(other && { otherRan: true }) });
        return;
      }
      const w = "promptId" in e && e.promptId ? this.waiters.get(e.promptId) : undefined;
      if (!w) return;
      if (e.type === "execution_start") {
        w.started = true;
        w.startedAt = performance.now();
        this.waiting = Math.max(0, this.waiting - 1);
        this.set({ running: "ours" });
        w.onEvent({ type: "started" });
      } else if (e.type === "progress" && e.max <= 8) w.onEvent({ type: "progress", value: e.value, max: e.max });
      else if (e.type === "error") w.reject(fail(e.message ?? "The render failed", e.nodeType === "LoadImageFuobeLive" ? "missing-input" : "failed"));
      else if (e.type === "interrupted") w.reject(fail("Stopped", "stopped"));
    };
  }

  private retry() {
    if (this.closed || this.timer) return;
    const wait = Math.min(3000, this.backoff) * (0.75 + Math.random() * 0.5);
    this.backoff = Math.min(3000, this.backoff * 2);
    this.timer = setTimeout(() => this.connect(), wait);
  }

  private async upload(name: string, bytes: Uint8Array, type: string) {
    const body = { name, type: "input", overwrite: "true" };
    writePath("/upload/image", body, { promptIds: this.ownIds, names: [...this.names.keys()] });
    const form = new FormData();
    form.append("image", new Blob([bytes as BlobPart], { type }), name);
    form.append("type", "input");
    form.append("overwrite", "true");
    const res = await loopbackFetch(`${this.base}/upload/image`, { method: "POST", body: form });
    if (!res.ok) throw fail(`ComfyUI refused the picture (${res.status})`, "failed");
  }

  private async stage(bytes: Uint8Array): Promise<StagedPicture> {
    const ext = pictureExt(bytes);
    if (!ext) throw new Error("Only PNG, JPEG or WebP pictures");
    const { name, sha256 } = await inputName(bytes, ext);
    const had = this.names.get(name);
    if (had) return { name, w: had.w, h: had.h, sha256 };
    const size = (ext === "png" ? pngSize(bytes) : null) ?? (() => {
      const s = imageSize(bytes);
      return s ? { w: s.width, h: s.height } : { w: 0, h: 0 };
    })();
    this.names.set(name, { bytes, type: PICTURE_TYPES[ext], w: size.w, h: size.h, sha256 });
    await this.upload(name, bytes, PICTURE_TYPES[ext]);
    return { name, w: size.w, h: size.h, sha256 };
  }

  async stageFile(url: string): Promise<StagedPicture> {
    // Fuobe's own file (same site), then into ComfyUI under its content name.
    if (!url.startsWith("/api/files/") && !url.startsWith("blob:")) throw new Error("Only your own files");
    const res = await fetch(url);
    if (!res.ok) throw new Error("Couldn't read the picture");
    return this.stage(new Uint8Array(await res.arrayBuffer()));
  }

  stageBytes(bytes: Uint8Array): Promise<StagedPicture> {
    return this.stage(bytes);
  }

  render(req: RenderReq, onEvent: (e: LiveEvent) => void): Promise<RenderResult> {
    const base = req.base ? this.names.get(req.base) : undefined;
    const liveLong = base?.w ? Math.max(...editSize(req.size, base.w, base.h)) : req.size;
    const bind = slotBindings(req.slot, { liveSize: req.size, keepRes: req.keepRes, hasMask: !!req.mask, to: "socket", liveLongSide: liveLong });
    const prompt = req.method === "compose" && req.compose !== undefined ? req.compose : normalize(req.text);
    const params: LiveGraphParams = {
      prompt: req.slot === "warm" ? "warm-up" : prompt,
      seed: req.slot === "warm" ? 0 : req.seed,
      ...bind,
      ...(req.base && { base: req.base }),
      ...(req.refs?.length && { refs: req.refs }),
      ...(req.mask && { mask: req.mask }),
      ...(!req.base && { aspect: req.aspect }),
    };
    const key = keyOf(req);
    return this.scheduler.submit({ seq: req.seq, slot: req.slot, key, urgent: req.urgent, payload: { req, params, key, onEvent } }).then((o) => (o.ok ? { ok: true, out: o.result } : "dropped" in o ? { ok: false, dropped: o.dropped } : { ok: false, error: o.error }));
  }

  hurry(seq: number): void {
    this.scheduler.hurry(seq);
  }

  cancel(match: (seq: number, slot: Slot) => boolean): void {
    this.scheduler.cancel((j) => j.slot !== "keep" && match(j.seq, j.slot));
  }

  private async online_(ms: number) {
    const end = performance.now() + ms;
    while (!this.online && performance.now() < end && !this.closed) await new Promise((r) => setTimeout(r, 30));
    return this.online;
  }

  private async run(job: ChannelJob, signal: AbortSignal): Promise<RenderOut> {
    for (let tries = 0; ; tries++) {
      try {
        return await this.once(job, signal);
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (signal.aborted || tries >= 2) throw e;
        if (code === "offline") {
          job.onEvent({ type: "reconnecting" });
          if (!(await this.online_(8000))) throw e;
        } else if (code === "missing-input") {
          // ComfyUI lost its input folder (a restart): send this tab's pictures again.
          const { staged } = buildLiveGraph(job.params);
          for (const n of staged) {
            const c = this.names.get(n);
            if (c) await this.upload(n, c.bytes, c.type);
          }
        } else throw e;
      }
    }
  }

  private async once(job: ChannelJob, signal: AbortSignal): Promise<RenderOut> {
    if (!(await this.online_(3000))) throw fail("Can't reach ComfyUI. Reconnecting…", "offline");
    const { graph, staged } = buildLiveGraph(job.params);
    // The tab's own checks, before anything reaches ComfyUI: the relay's loader rule and the live graph's shape.
    const names = [...this.names.keys()];
    const problem = graphProblem(graph, staged.filter((n) => names.includes(n))) ?? liveGraphProblem(graph, names);
    if (problem) throw fail(problem, "failed");
    const id = crypto.randomUUID();
    this.ownIds.push(id);
    if (this.ownIds.length > 200) this.ownIds.splice(0, this.ownIds.length - 200);
    const t0 = performance.now();
    const done = new Promise<{ data: Uint8Array; type: string; w: number; h: number; ms: number }>((resolve, reject) => {
      const w: Waiter = {
        started: false,
        startedAt: 0,
        onEvent: job.onEvent,
        resolve: (p) => {
          this.waiters.delete(id);
          resolve(p);
        },
        reject: (e) => {
          if (this.waiters.get(id) === w && !w.started) this.waiting = Math.max(0, this.waiting - 1);
          this.waiters.delete(id);
          reject(e);
        },
      };
      this.waiters.set(id, w);
    });
    done.catch(() => {});
    this.waiting++;
    const stop = () => {
      const w = this.waiters.get(id);
      const started = !!w?.started;
      w?.reject(fail("Stopped", "stopped"));
      void this.post("/queue", { delete: [id] }).catch(() => {});
      if (started) void this.post("/interrupt", { prompt_id: id }).catch(() => {});
    };
    signal.addEventListener("abort", stop, { once: true });
    try {
      const res = await this.post("/prompt", { prompt: graph, prompt_id: id, client_id: this.clientId, front: true });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { type?: string; message?: string } };
        this.waiters.get(id)?.reject(body.error?.type === "missing_node_type" ? fail("Fuobe's live nodes aren't installed in ComfyUI", "missing-nodes") : fail(body.error?.message ?? `ComfyUI answered ${res.status}`, "failed"));
      } else job.onEvent({ type: "queued", pos: this.status.queue });
      const p = await done;
      this.set({ otherRan: false });
      const sha256 = await sha256Hex(p.data);
      const size = p.type === "image/png" ? pngSize(p.data) : null;
      return { data: p.data, type: p.type, w: p.w || size?.w || 0, h: p.h || size?.h || 0, ms: p.ms || performance.now() - t0, sha256, key: job.key };
    } finally {
      signal.removeEventListener("abort", stop);
      void this.post("/history", { delete: [id] }).catch(() => {});
    }
  }

  close(): void {
    this.closed = true;
    this.scheduler.cancelAll("closed");
    clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  }
}
