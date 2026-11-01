import "server-only";
import { nanoid } from "nanoid";
import type { LiveEvent } from "@/lib/live/frames";
import { buildLiveGraph, type LiveGraphParams } from "@/lib/live/graph";
import { inputName, pictureExt, PICTURE_TYPES, pngSize } from "@/lib/live/names";
import { LiveScheduler, type LiveJob, type Outcome, type Slot } from "@/lib/live/scheduler";
import { onOwnGpu, type OwnGpu } from "../providers/comfyui";
import { LiveRenderError, renderLive, stageInput, waitOnline, type LivePicture } from "./comfy-live";

/**
 * Live edit sessions on the server path (one per tab): the scheduler (src/lib/live/scheduler.ts) that keeps one render
 * of the tab's in ComfyUI at a time, the pictures it staged (by content name, with Fuobe's copy, so a ComfyUI that
 * restarted and lost its input folder gets them again), and the newest settled renders (full-quality PNG masters of
 * the text on screen, held for 2 minutes so Keep stores exactly those bytes). Sessions end 10 minutes after their
 * last use.
 */

export const SESSION_IDLE_MS = 10 * 60_000;
const SETTLED_KEPT = 6;
const SETTLED_MS = 2 * 60_000;
/** Fuobe's copies of staged pictures kept in memory per session (masters at 2048 are ~10 MB): older ones are re-read. */
const COPIES_KEPT = 12;

export interface RenderPayload {
  params: LiveGraphParams;
  /** Keep: the settled render to store as it is, when it is still held. */
  fromSettled?: string;
  onEvent: (e: LiveEvent) => void;
}

export interface Rendered extends LivePicture {
  sha256: string;
  /** Reused a settled render (no new render). */
  reused?: boolean;
}

export interface Staged {
  name: string;
  w: number;
  h: number;
  sha256: string;
  /** Fuobe's copy, to stage again (a file URL to re-read when the bytes were let go). */
  data?: Uint8Array;
  type: string;
  reread?: () => Promise<Uint8Array>;
}

export interface LiveSession {
  id: string;
  /** "owner" or "acct:<id>". */
  principal: string;
  gpu?: OwnGpu;
  seed: number;
  lastUsed: number;
  scheduler: LiveScheduler<RenderPayload, Rendered>;
  staged: Map<string, Staged>;
  settled: Map<string, { pic: Rendered; at: number }>;
}

declare global {
  var __fuobeLiveEdit: { sessions: Map<string, LiveSession>; sweep?: ReturnType<typeof setInterval> } | undefined;
}

type Store = { sessions: Map<string, LiveSession>; sweep?: ReturnType<typeof setInterval> };

const store = (): Store => {
  const s: Store = (globalThis.__fuobeLiveEdit ??= { sessions: new Map<string, LiveSession>() });
  if (!s.sweep) {
    s.sweep = setInterval(() => {
      const now = Date.now();
      for (const [id, x] of s.sessions) if (now - x.lastUsed > SESSION_IDLE_MS) endSession(id);
    }, 60_000);
    s.sweep.unref?.();
  }
  return s;
};

const SESSION_ID = /^lv_[A-Za-z0-9_-]{16}$/;

/** A tab's session, renewed: the same one when the id is its own, else a new one. */
export function openSession(principal: string, gpu: OwnGpu | undefined, id?: string): LiveSession {
  const s = store();
  const had = id && SESSION_ID.test(id) ? s.sessions.get(id) : undefined;
  if (had && had.principal === principal) {
    had.lastUsed = Date.now();
    had.gpu = gpu;
    return had;
  }
  const session: LiveSession = {
    id: `lv_${nanoid(16)}`,
    principal,
    gpu,
    seed: Math.floor(Math.random() * 2 ** 31),
    lastUsed: Date.now(),
    staged: new Map(),
    settled: new Map(),
    scheduler: undefined as unknown as LiveSession["scheduler"],
  };
  session.scheduler = new LiveScheduler<RenderPayload, Rendered>({ run: (job, signal) => run(session, job, signal) });
  s.sessions.set(session.id, session);
  return session;
}

/** The principal's own session, or null. */
export function sessionOf(principal: string, id: unknown): LiveSession | null {
  if (typeof id !== "string" || !SESSION_ID.test(id)) return null;
  const s = store().sessions.get(id);
  if (!s || s.principal !== principal) return null;
  s.lastUsed = Date.now();
  return s;
}

export function endSession(id: string): void {
  const s = store().sessions.get(id);
  if (!s) return;
  s.scheduler.close();
  store().sessions.delete(id);
}

const within = <T,>(s: LiveSession, fn: () => T): T => (s.gpu ? onOwnGpu(s.gpu, fn) : fn());

/** Stage a picture for this session (by its content name) and remember Fuobe's copy. */
export async function stage(s: LiveSession, data: Uint8Array, reread?: () => Promise<Uint8Array>): Promise<Staged> {
  const ext = pictureExt(data);
  if (!ext) throw new LiveRenderError("Only PNG, JPEG or WebP pictures", "failed");
  const { name, sha256 } = await inputName(data, ext);
  const had = s.staged.get(name);
  if (had) {
    had.data ??= data;
    return had;
  }
  const size = ext === "png" ? pngSize(data) : await sizeOf(data);
  const type = PICTURE_TYPES[ext];
  await within(s, () => stageInput(name, data, type));
  const st: Staged = { name, w: size?.w ?? 0, h: size?.h ?? 0, sha256, data, type, reread };
  s.staged.set(name, st);
  // Keep the newest copies in memory; older ones are read again from their file when needed.
  const withData = [...s.staged.values()].filter((x) => x.data && x.reread);
  for (const x of withData.slice(0, Math.max(0, withData.length - COPIES_KEPT))) x.data = undefined;
  return st;
}

async function sizeOf(data: Uint8Array): Promise<{ w: number; h: number } | null> {
  const { imageSize } = await import("@/lib/image-size");
  const s = imageSize(Buffer.from(data));
  return s ? { w: s.width, h: s.height } : null;
}

/** Stage every picture a graph reads again (ComfyUI restarted and lost its input folder). */
async function restage(s: LiveSession, names: string[]) {
  for (const n of names) {
    const st = s.staged.get(n);
    if (!st) throw new LiveRenderError("A picture of this session is gone. Add it again.", "missing-input");
    const data = st.data ?? (st.reread ? await st.reread() : undefined);
    if (!data) throw new LiveRenderError("A picture of this session is gone. Add it again.", "missing-input");
    await within(s, () => stageInput(n, data, st.type, true));
  }
}

async function run(s: LiveSession, job: LiveJob<RenderPayload>, signal: AbortSignal): Promise<Rendered> {
  const { params, fromSettled, onEvent } = job.payload;
  if (job.slot === "keep" && fromSettled) {
    const held = s.settled.get(fromSettled);
    if (held) return { ...held.pic, reused: true };
  }
  const { graph, staged } = buildLiveGraph(params);
  for (const n of staged) if (!s.staged.has(n)) throw new LiveRenderError("That picture wasn't added to this session", "missing-input");
  const once = () => within(s, () => renderLive(graph, signal, onEvent));
  let pic: LivePicture | undefined;
  for (let tries = 0; !pic; tries++) {
    try {
      pic = await once();
    } catch (e) {
      if (!(e instanceof LiveRenderError) || signal.aborted || tries >= 2) throw e;
      if (e.code === "offline") {
        // ComfyUI restarted or the line dropped: send it again once it is back (the tab hears "reconnecting").
        onEvent({ type: "reconnecting" });
        if (!(await within(s, () => waitOnline(8000)))) throw e;
      } else if (e.code === "missing-input") {
        // The input folder lost our pictures (a restart): stage them again from Fuobe's copies, then try once more.
        await restage(s, staged);
      } else throw e;
    }
  }
  const size = pic.type === "image/png" ? pngSize(pic.data) : null;
  const out: Rendered = { ...pic, w: pic.w || size?.w || 0, h: pic.h || size?.h || 0, sha256: (await inputName(pic.data, "png")).sha256 };
  if (job.slot === "settle") {
    const now = Date.now();
    for (const [k, v] of s.settled) if (now - v.at > SETTLED_MS) s.settled.delete(k);
    s.settled.set(job.key, { pic: out, at: now });
    while (s.settled.size > SETTLED_KEPT) s.settled.delete(s.settled.keys().next().value!);
  }
  return out;
}

/** Submit a render for the session. */
export function submit(s: LiveSession, job: { seq: number; slot: Slot; key: string; urgent?: boolean; payload: RenderPayload }): Promise<Outcome<Rendered>> {
  return s.scheduler.submit(job);
}

/** Fuobe's copy of a staged picture (a kept master's bytes), if held. */
export const stagedCopy = (s: LiveSession, name: string) => s.staged.get(name);
