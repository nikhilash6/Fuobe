"use client";

import { Check } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PresetPreview } from "@/components/preset-preview";
import { createPickerPlayback } from "@/lib/picker-playback";
import type { PresetCover } from "@/lib/preset-covers";
import { browserPlaybackEnv } from "@/lib/preview-playback";
import { cn } from "@/lib/utils";

/** One picker tile plays at a time, across every picker (rules in lib/picker-playback.ts). */
const playback = createPickerPlayback(browserPlaybackEnv);

/**
 * Whether a picker's tile plays its clip, and the handlers to spread on it: hovered with a mouse or focused from the
 * keyboard, after a short rest; `highlighted`, a list's row the arrow keys moved to (where the device can hover);
 * else, while none of those plays, `picked`. The pointer or focus leaving the picked tile doesn't stop its clip.
 */
export function usePickerPlayback(id: string, { picked = false, highlighted = false } = {}) {
  const playing = useSyncExternalStore(
    playback.subscribe,
    () => playback.plays(id, picked),
    () => false,
  );
  useEffect(() => {
    if (!highlighted || !playback.canHover()) return;
    playback.play(id);
    return () => playback.stop(id);
  }, [id, highlighted]);
  useEffect(() => () => playback.stop(id), [id]);
  return {
    playing,
    handlers: {
      onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && playback.play(id),
      onPointerLeave: (e: React.PointerEvent) => e.pointerType === "mouse" && playback.stop(id, picked),
      // Keyboard focus only: a tap (or click) focuses the tile too.
      onFocus: (e: React.FocusEvent) => e.currentTarget.matches(":focus-visible") && playback.play(id),
      onBlur: () => playback.stop(id, picked),
    },
  };
}

/**
 * The scroll box a picker's tiles sit in. Native lazy loading measures from the screen (over a thousand pixels
 * around it), so a small box of a hundred tiles would load most of their posters at once: a tile in a box waits
 * until it is within one box height of the part in view instead.
 */
const ScrollBox = createContext<React.RefObject<HTMLElement | null> | null>(null);
export const CoverScrollBox = ScrollBox.Provider;

/** One observer per scroll box, for all its tiles. */
const boxes = new WeakMap<Element, { io: IntersectionObserver; near: Map<Element, () => void> }>();

function whenNear(el: Element, box: Element, onNear: () => void): () => void {
  let b = boxes.get(box);
  if (!b) {
    const near = new Map<Element, () => void>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) near.get(e.target)?.();
      },
      { root: box, rootMargin: "100% 0px" },
    );
    b = { io, near };
    boxes.set(box, b);
  }
  const { io, near } = b;
  near.set(el, onNear);
  io.observe(el);
  return () => {
    io.unobserve(el);
    near.delete(el);
  };
}

/**
 * A preset's picture in a picker (the camera motion and Mix grids, Cinema Studio's moves, the chips): its real
 * cover, the one its gallery card shows (presetCover), else `fallback`, the drawn tile. The poster's small copy
 * loads lazily and the clip goes over it only while `playing` (usePickerPlayback: hovered, keyboard-focused,
 * highlighted or picked, one at a time). `className` gives the box its size or aspect ratio, so nothing shifts while
 * the poster loads. A picked tile is marked on the picture: a check (the tile says it's picked, aria-pressed), or
 * its place in an order, which a screen reader reads with the tile's name.
 */
export function CoverTile({
  cover,
  playing = false,
  picked,
  fallback,
  className,
}: {
  cover: PresetCover | undefined;
  playing?: boolean;
  picked?: boolean | number;
  fallback?: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const box = useContext(ScrollBox);
  // Differs on the server (no IntersectionObserver), which is fine: a picker mounts when it opens, never by hydration.
  const [near, setNear] = useState(() => !box || typeof IntersectionObserver === "undefined");
  const hasCover = !!cover;
  useEffect(() => {
    const el = ref.current;
    const root = box?.current;
    if (near || !hasCover || !el || !root) return;
    return whenNear(el, root, () => setNear(true));
  }, [near, hasCover, box]);
  return (
    <span ref={ref} className={cn("relative block shrink-0 overflow-hidden bg-muted", className)}>
      {/* The galleries' cover: the lazy poster (here its small copy), and the clip over it only while it plays. The
          scene is only for procedural previews. */}
      {cover ? near && <PresetPreview preview={{ poster: cover.thumb, video: cover.video, scene: "portrait" }} hue={0} playing={playing} /> : fallback}
      {picked !== undefined && picked !== false && (
        <span
          data-picked=""
          aria-hidden={picked === true || undefined}
          className="absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground shadow-sm ring-1 ring-black/15"
        >
          {picked === true ? <Check className="size-3" strokeWidth={3} /> : picked}
        </span>
      )}
    </span>
  );
}
