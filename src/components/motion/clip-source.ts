"use client";

/**
 * The person's own clip as a picture source for Kinetic's video layer: one muted, inline <video> per clip, read from
 * its stored file (same origin, so the canvas stays readable). The preview lets it play natively and puts it back in
 * step when it drifts by more than a frame; an export seeks it exactly before every frame (seeked, then the next
 * presented frame), so every motion-blur moment of a frame draws the same picture. A seek that doesn't land fails the
 * render with a clear message rather than drawing whatever frame the video shows.
 */

/** Seeks land this far past the asked time, so a time exactly on a frame boundary never shows the frame before. */
const SEEK_NUDGE = 1e-4;
/** How long a clip may take to show its first frame, and one seek to land (it is tried twice). */
const LOAD_MS = 15_000;
const SEEK_MS = 4_000;

export const CLIP_OPEN_ERROR = "We can't open that clip.";
export const CLIP_SEEK_ERROR = "We can't read that clip. Try an MP4 or WebM clip saved on Fuobe.";

export interface ClipSource {
  url: string;
  el: HTMLVideoElement;
  info: { w: number; h: number; duration: number };
  /** Puts the clip exactly on the picture shown at `time` (seconds into the clip). Rejects when the seek doesn't land. */
  seek(time: number): Promise<void>;
  /** The preview: plays natively from `time` while `playing`, re-seeking when it drifts past `tolerance` seconds. */
  follow(time: number, playing: boolean, tolerance: number): void;
  dispose(): void;
}

const aborted = () => new DOMException("Stopped", "AbortError");

/** Waits for `ev` on the video; rejects on its error event, after `ms`, or when `signal` aborts. */
function waitFor(el: HTMLVideoElement, ev: string, ms: number, signal?: AbortSignal, message = CLIP_SEEK_ERROR): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(aborted());
    const off = () => {
      clearTimeout(timer);
      el.removeEventListener(ev, ok);
      el.removeEventListener("error", bad);
      signal?.removeEventListener("abort", stop);
    };
    const ok = () => {
      off();
      resolve();
    };
    const bad = () => {
      off();
      reject(new Error(message));
    };
    const stop = () => {
      off();
      reject(aborted());
    };
    const timer = setTimeout(bad, ms);
    el.addEventListener(ev, ok, { once: true });
    el.addEventListener("error", bad, { once: true });
    signal?.addEventListener("abort", stop, { once: true });
  });
}

type FrameMeta = { mediaTime: number };
type FrameCallbackVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: FrameMeta) => void) => number };

/**
 * The next presented frame's media time (requestVideoFrameCallback), at most `ms`; null when none was presented in time
 * (the picture didn't change) or the browser has no frame callback.
 */
function nextFrame(el: FrameCallbackVideo, ms = 250): Promise<number | null> {
  if (!el.requestVideoFrameCallback) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (t: number | null) => {
      if (done) return;
      done = true;
      resolve(t);
    };
    setTimeout(() => finish(null), ms);
    el.requestVideoFrameCallback!((_now, meta) => finish(meta.mediaTime));
  });
}

/** Loads a stored clip (its first frame decoded) as a picture source; gives up after 15 s or when `signal` aborts. */
export async function loadClip(url: string, o: { signal?: AbortSignal } = {}): Promise<ClipSource> {
  const el = document.createElement("video") as FrameCallbackVideo;
  el.muted = true;
  el.playsInline = true;
  el.preload = "auto";
  el.crossOrigin = "anonymous";
  el.setAttribute("playsinline", "");
  el.setAttribute("muted", "");
  const release = () => {
    el.pause();
    el.removeAttribute("src");
    el.load();
  };
  try {
    const ready = waitFor(el, "loadeddata", LOAD_MS, o.signal, CLIP_OPEN_ERROR);
    el.src = url;
    // Some browsers (iOS) never start loading a video that isn't on the page until asked.
    el.load();
    if (el.readyState < 2) await ready;
    else void ready.catch(() => undefined);
  } catch (e) {
    release();
    throw e;
  }

  /**
   * What the video shows: the presented frame's media time, and the clip's frame length once two presented frames
   * one frame apart have been seen. A seek that lands inside the frame on show (an export faster than the clip) skips
   * waiting for a new frame that never comes.
   */
  let shown: number | null = null;
  let lastTarget: number | null = null;
  const gaps: number[] = [];
  const frameLen = () => {
    if (gaps.length < 2) return null;
    const min = Math.min(...gaps);
    // Two gaps of the same smallest size: that is one frame of the clip.
    return gaps.filter((g) => Math.abs(g - min) < 1e-3).length >= 2 ? min : null;
  };

  let pending: Promise<void> = Promise.resolve();
  const signal = o.signal;
  const seekNow = async (time: number) => {
    if (signal?.aborted) throw aborted();
    const target = Math.max(0, Math.min(el.duration || time, time + SEEK_NUDGE));
    if (!el.paused) el.pause();
    if (Math.abs(el.currentTime - target) < 1e-6 && !el.seeking) return;
    const step = lastTarget === null ? null : target - lastTarget;
    lastTarget = target;
    const f = frameLen();
    // The same picture: the clip's frame on show covers this time, and the export steps finer than the clip's frames.
    if (f && shown !== null && step !== null && step > 0 && f > step * 1.2 && target >= shown - 1e-6 && target < shown + f - 1e-3) return;
    let presented: Promise<number | null> = Promise.resolve(null);
    for (let attempt = 0; ; attempt++) {
      const seeked = waitFor(el, "seeked", SEEK_MS, signal);
      presented = nextFrame(el);
      el.currentTime = target;
      try {
        await seeked;
        break;
      } catch (e) {
        if ((e as Error).name === "AbortError" || attempt >= 1) throw e;
      }
    }
    const t = await presented;
    if (t === null) {
      // No new frame: the picture on show stays (its time is known only when a frame was presented).
      if (!el.requestVideoFrameCallback) shown = null;
      return;
    }
    if (shown !== null && t > shown + 1e-4) {
      gaps.push(t - shown);
      if (gaps.length > 24) gaps.shift();
    }
    shown = t;
  };
  return {
    url,
    el,
    info: { w: el.videoWidth, h: el.videoHeight, duration: el.duration },
    seek(time) {
      // One seek at a time, in order; a failed seek doesn't block the ones after it from failing on their own.
      const next = pending.catch(() => undefined).then(() => seekNow(time));
      pending = next;
      return next;
    },
    follow(time, playing, tolerance) {
      shown = null;
      lastTarget = null;
      const target = Math.max(0, Math.min(el.duration, time));
      if (!playing) {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - target) > tolerance / 2 && !el.seeking) el.currentTime = target + SEEK_NUDGE;
        return;
      }
      if (target >= el.duration - 0.01) {
        // Held on its last frame.
        if (!el.paused) el.pause();
        return;
      }
      if (Math.abs(el.currentTime - target) > tolerance && !el.seeking) el.currentTime = target;
      if (el.paused) void el.play().catch(() => undefined);
    },
    dispose: release,
  };
}
