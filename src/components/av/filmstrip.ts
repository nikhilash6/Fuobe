"use client";

/**
 * Stills from a clip for a trim picker's strip: `count` frames spread over its length (or over `range`), read in this browser by seeking a
 * hidden video (nothing is sent anywhere). Frames that can't be read (a format this browser can't show) are left out:
 * an empty list means none could be.
 */
export async function filmstrip(src: string, seconds: number, count: number, height = 96, signal?: AbortSignal, range?: { from: number; to: number }): Promise<string[]> {
  if (typeof document === "undefined" || !(seconds > 0)) return [];
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.playsInline = true;
  v.crossOrigin = "anonymous";
  const once = (ev: string, ms: number) =>
    new Promise<boolean>((resolve) => {
      const done = (ok: boolean) => {
        clearTimeout(t);
        v.removeEventListener(ev, onOk);
        v.removeEventListener("error", onErr);
        resolve(ok);
      };
      const onOk = () => done(true);
      const onErr = () => done(false);
      const t = setTimeout(() => done(false), ms);
      v.addEventListener(ev, onOk);
      v.addEventListener("error", onErr);
    });
  try {
    const loaded = once("loadeddata", 15_000);
    v.src = src;
    if (!(await loaded) || !v.videoWidth) return [];
    const h = height;
    const w = Math.max(1, Math.round((v.videoWidth / v.videoHeight) * h));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) break;
      const from = range?.from ?? 0;
      const span = (range?.to ?? seconds) - from;
      const at = Math.min(seconds - 0.05, from + ((i + 0.5) / count) * span);
      const seeked = once("seeked", 5_000);
      v.currentTime = Math.max(0, at);
      if (!(await seeked)) continue;
      try {
        ctx.drawImage(v, 0, 0, w, h);
        out.push(canvas.toDataURL("image/jpeg", 0.7));
      } catch {
        return out;
      }
    }
    return out;
  } finally {
    v.removeAttribute("src");
    v.load();
  }
}
