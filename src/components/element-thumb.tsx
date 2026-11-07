"use client";

import { Video } from "lucide-react";
import { useEffect, useState } from "react";
import { CLIP_FRAME_AT, frameSize, stillCache, thumbSource } from "@/lib/clip-thumb";
import { cn } from "@/lib/utils";

/** One frame of a clip, scaled down and kept as a JPEG object URL; null when this browser can't read the clip. */
async function grabStill(clip: string): Promise<string | null> {
  if (typeof document === "undefined") return null;
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  const event = (name: string) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), 10000);
      v.addEventListener(name, () => (clearTimeout(t), resolve()), { once: true });
      v.addEventListener("error", () => (clearTimeout(t), reject(new Error("unreadable"))), { once: true });
    });
  try {
    const loaded = event("loadeddata");
    v.src = clip;
    await loaded;
    const at = Math.min(CLIP_FRAME_AT, Math.max(0, (v.duration || CLIP_FRAME_AT) - 0.05));
    if (Math.abs(v.currentTime - at) > 0.01) {
      const seeked = event("seeked");
      v.currentTime = at;
      await seeked;
    }
    const size = frameSize(v.videoWidth, v.videoHeight);
    if (!size.width) return null;
    const c = document.createElement("canvas");
    c.width = size.width;
    c.height = size.height;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
    return blob ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  } finally {
    v.removeAttribute("src");
    v.load();
  }
}

const stills = stillCache(grabStill);

/** The mark that says a thumbnail is a clip: a small camera on a dark disc. */
export function ClipMark({ className, size = "sm" }: { className?: string; size?: "xs" | "sm" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none grid place-items-center rounded-full bg-black/60 text-white shadow-sm ring-1 ring-white/25",
        size === "xs" ? "size-3.5" : "size-6 backdrop-blur-sm",
        className,
      )}
    >
      <Video className={size === "xs" ? "size-2" : "size-3.5"} strokeWidth={size === "xs" ? 2.75 : 2.25} />
    </span>
  );
}

/**
 * An element's reference drawn as a thumbnail. A photo is the same <img> as ever (`className` on it). A clip shows a still
 * of itself (its `poster` when one is known, else a frame grabbed in the browser), in a box that takes `className`, with
 * the clip mark in its corner (`mark="none"` leaves it to the caller, as a chip too small for it does). A clip that can't
 * be read shows the mark alone, never a broken image.
 */
export function ElementThumb({
  src,
  poster,
  alt = "",
  className,
  loading,
  mark = "corner",
}: {
  src: string;
  poster?: string | null;
  alt?: string;
  className?: string;
  loading?: "lazy" | "eager";
  mark?: "corner" | "none";
}) {
  const s = thumbSource(src, poster);
  if (s.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={s.src} alt={alt} loading={loading} className={className} />;
  }
  return <ClipStill clip={s.clip} poster={s.poster} alt={alt} className={className} loading={loading} mark={mark} />;
}

function ClipStill({ clip, poster, alt, className, loading, mark }: { clip: string; poster?: string; alt: string; className?: string; loading?: "lazy" | "eager"; mark: "corner" | "none" }) {
  // The poster first; if it fails to load, a frame from the clip.
  const [posterFailed, setPosterFailed] = useState(false);
  const usePoster = !!poster && !posterFailed;
  // The grabbed still: known at once when this clip was grabbed before, else once its grab ends (null: can't be read).
  const [got, setGot] = useState<{ clip: string; still: string | null } | null>(null);
  const [broken, setBroken] = useState<string | null>(null);
  const known = stills.peek(clip);
  const still = broken === clip ? null : known !== undefined ? known : got?.clip === clip ? got.still : undefined;
  useEffect(() => {
    if (usePoster || stills.peek(clip) !== undefined) return;
    let gone = false;
    void stills.get(clip).then((s) => {
      if (!gone) setGot({ clip, still: s });
    });
    return () => {
      gone = true;
    };
  }, [clip, usePoster]);
  const shown = usePoster ? poster : still;
  return (
    <span className={cn("relative block overflow-hidden bg-muted", className)} role={alt ? "img" : undefined} aria-label={alt || undefined}>
      {shown && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shown} alt="" loading={loading} onError={usePoster ? () => setPosterFailed(true) : () => setBroken(clip)} className="absolute inset-0 size-full object-cover" />
      )}
      {!usePoster && still === null && (
        <span className="absolute inset-0 grid place-items-center text-muted-foreground">
          <Video className={mark === "corner" ? "size-7" : "size-3.5"} />
        </span>
      )}
      {mark === "corner" && (usePoster || still !== null) && <ClipMark className="absolute right-1.5 bottom-1.5" />}
    </span>
  );
}
