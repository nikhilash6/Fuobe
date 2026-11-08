"use client";

import { createElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import { releaseVideo } from "@/lib/media-release";
import { navIcon } from "@/lib/nav-icons";
import type { MegaCover } from "@/lib/mega-menus";
import type { NavIconName } from "@/lib/nav-model";
import { reducedMotion } from "@/lib/ui-motion";
import { cn } from "@/lib/utils";
import { useNavCover } from "./nav-ui";

/** The end of a cover clip a loop from inside it never shows (s): where an effect fades back to its photo. */
const CLIP_TAIL = 0.4;
/** How long a clip takes to fade over its still, and back (ms; the class below says the same). */
const CLIP_FADE = 200;

/** How long a mouse stays on a card before it comes alive (ms). */
const ALIVE_AFTER = 120;

/** The one cover clip playing on hover (a card under the pointer: one decoder at a time). A menu's player runs its own (shared). */
let playingClip: HTMLVideoElement | null = null;

/** Sent on window when the browser refuses to start a muted clip (iOS Low Power Mode, an autoplay policy). */
export const AUTOPLAY_BLOCKED = "fuobe:autoplay-blocked";

/** Clips play unless the viewer asks for less motion or to save data. */
export function clipsAllowed(): boolean {
  if (reducedMotion()) return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !conn?.saveData;
}

/**
 * A menu card that comes alive while a mouse is over it or the keys focus it (never on a tap: a touch screen keeps its
 * stills): `alive` goes to its CoverThumb, `handlers` on the card's link.
 */
export function useAliveCard() {
  const [alive, setAlive] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // A pointer that stays a moment (ALIVE_AFTER): one passing over on its way elsewhere starts nothing.
  const on = (delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAlive(true), delay);
  };
  const off = () => {
    window.clearTimeout(timer.current);
    setAlive(false);
  };
  return {
    alive,
    handlers: {
      onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && on(ALIVE_AFTER),
      onPointerLeave: (e: React.PointerEvent) => e.pointerType === "mouse" && off(),
      onFocus: (e: React.FocusEvent<HTMLElement>) => e.currentTarget.matches(":focus-visible") && on(0),
      onBlur: off,
    },
  };
}

/**
 * A cover's clip over its still: it shows once its first frame is drawn (so the still stays until then: never a blank
 * frame) and fades in; `leaving`, it fades back out to the still. `at`: a still from inside the clip (a template's
 * peak frame), where it starts and loops back to, short of the clip's last stretch. `shared`: one of several playing
 * at once (a menu's player, which keeps their number down), so it leaves the others playing.
 */
function CoverClip({ src, at, leaving, focus, shared }: { src: string; at?: number; leaving: boolean; focus?: string; shared?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [drawn, setDrawn] = useState(false);
  useLayoutEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (!shared) {
      if (playingClip && playingClip !== v) playingClip.pause();
      playingClip = v;
    }
    let live = true;
    let from = 0;
    const seek = () => {
      if (at !== undefined && v.duration && at < v.duration - CLIP_TAIL - 0.3) {
        from = at;
        v.currentTime = at;
      }
    };
    // Shown once a frame is on screen; a loop from inside the clip comes back before its tail.
    const frame = () => {
      if (!live) return;
      setDrawn(true);
      if (from && v.duration && v.currentTime >= v.duration - CLIP_TAIL) v.currentTime = from;
      if ("requestVideoFrameCallback" in v) v.requestVideoFrameCallback(frame);
    };
    const playing = () => ("requestVideoFrameCallback" in v ? v.requestVideoFrameCallback(frame) : frame());
    const tail = () => {
      if (from && v.duration && v.currentTime >= v.duration - CLIP_TAIL) v.currentTime = from;
    };
    v.addEventListener("loadedmetadata", seek, { once: true });
    v.addEventListener("playing", playing, { once: true });
    v.addEventListener("timeupdate", tail);
    v.src = src;
    void v.play().catch((e: unknown) => {
      // Refused (not just interrupted by a pause): a menu's player stops asking for the rest of the visit.
      if (shared && e instanceof DOMException && e.name === "NotAllowedError") window.dispatchEvent(new Event(AUTOPLAY_BLOCKED));
    });
    return () => {
      live = false;
      v.removeEventListener("timeupdate", tail);
      if (playingClip === v) playingClip = null;
      releaseVideo(v);
    };
  }, [src, at, shared]);
  return (
    <video
      ref={ref}
      muted
      playsInline
      loop={at === undefined}
      preload="auto"
      aria-hidden
      tabIndex={-1}
      data-cover-clip=""
      data-on={drawn && !leaving ? "" : undefined}
      className="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-200 ease-out data-[on]:opacity-100"
      style={{ objectPosition: focus ?? "50% 25%" }}
    />
  );
}

/** Mounted while `on`, and for the fade after it (`leaving`): a clip fades back to its still, then lets go of its decoder. */
function useClipPresence(on: boolean): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(on);
  if (on && !mounted) setMounted(true);
  useEffect(() => {
    if (on || !mounted) return;
    const t = window.setTimeout(() => setMounted(false), CLIP_FADE + 40);
    return () => window.clearTimeout(t);
  }, [on, mounted]);
  return { mounted, leaving: mounted && !on };
}

/*
 * A nav cover: a real preset still in a box of fixed size, so nothing moves when the picture arrives. The box shows
 * the muted fill until then (and the entry's icon when the preset has no cover). Covers are decoration next to a
 * written name, so the image is alt="" and the box is hidden from assistive tech.
 */

export type CoverSize = "row" | "tile" | "lead" | "card" | "thumb" | "chip" | "pill" | "wide" | "tile16";

interface SizeSpec {
  /** The box (size, shape); a caller's className can override any of it. */
  box: string;
  /** The image's intrinsic size for its width/height attributes (posters are 512x384, thumbs 320x240). */
  w: number;
  h: number;
  /**
   * Which copy to load: the 96 px mini for the smallest boxes (the 320 px thumb where a cover has no mini), the 320 px
   * thumb for small boxes; fluid boxes pick by `sizes` between thumb and poster, or among the cover's larger copies
   * when it has them (MegaCover.hd).
   */
  src: "mini" | "thumb" | "both";
  /** The box's width for the srcset (a caller whose box is another width gives its own: CoverThumb's `sizes`). */
  sizes: string;
}

export const COVER_SIZES: Record<CoverSize, SizeSpec> = {
  /** 36x27: a launcher row, a search grid tile. */
  row: { box: "h-[27px] w-9 rounded-[6px]", w: 36, h: 27, src: "mini", sizes: "36px" },
  /** 56x56: the phone Studios sheet. */
  tile: { box: "size-14 rounded-[14px]", w: 56, h: 56, src: "mini", sizes: "56px" },
  /** 4:3, full width: a launcher column's lead card. */
  lead: { box: "aspect-[4/3] w-full rounded-[12px]", w: 512, h: 384, src: "both", sizes: "(min-width: 1024px) 272px, 72px" },
  /** 4:3, full width: a goal band's studio card. */
  card: { box: "aspect-[4/3] w-full rounded-[14px]", w: 512, h: 384, src: "both", sizes: "(min-width: 768px) 248px, 160px" },
  /** 64x48: a search result row. */
  thumb: { box: "h-12 w-16 rounded-[8px]", w: 64, h: 48, src: "thumb", sizes: "64px" },
  /** 56x42: a one-tap preset chip. */
  chip: { box: "h-[42px] w-14 rounded-[8px]", w: 56, h: 42, src: "thumb", sizes: "56px" },
  /** 40x40: a next-step pill. */
  pill: { box: "size-10 rounded-[10px]", w: 40, h: 40, src: "thumb", sizes: "40px" },
  /** 16:9, full width: the "next to try" card. */
  wide: { box: "aspect-video w-full rounded-[10px]", w: 512, h: 288, src: "both", sizes: "300px" },
  /** 16:9, full width: a ready-board tile (the Canvas menu's, 222 to 262 px; the phone sheet's): its caller gives `sizes`. */
  tile16: { box: "aspect-video w-full rounded-[10px]", w: 320, h: 180, src: "both", sizes: "262px" },
};

export function CoverThumb({
  id,
  cover: given,
  size,
  icon,
  eager,
  low,
  alive,
  shared,
  sizes: boxSizes,
  className,
}: {
  /** A preset id with a real cover (NavEntry.cover, a goal tap's preset); undefined shows the fallback. */
  id?: string;
  /** The cover itself, at its URLs (a fetched menu's), instead of a preset id. */
  cover?: MegaCover;
  size: CoverSize;
  /** Shown on the muted fill when there is no cover. */
  icon?: NavIconName;
  /** Load at once (a panel about to open) instead of when it comes near the screen. */
  eager?: boolean;
  /** Load after the pictures around it (a menu's small row pictures, after its lead covers). */
  low?: boolean;
  /**
   * Its card is pointed at or focused (useAliveCard): its clip plays over the still, where it has one; else the still
   * leans in a little. Neither under reduced motion; no clip when saving data.
   */
  alive?: boolean;
  /** Its clip is one of several a menu's player runs at once (CoverClip's `shared`). */
  shared?: boolean;
  /** A fluid box's width for the srcset, when it isn't its size's usual one (a lead card two tracks wide, a phone's tile). */
  sizes?: string;
  className?: string;
}) {
  const nav = useNavCover(given ? undefined : id);
  const cover: MegaCover | undefined = given ?? nav;
  const s = COVER_SIZES[size];
  const small = s.src === "mini" ? (cover?.mini ?? cover?.thumb) : cover?.thumb;
  const sizes = s.src === "both" ? (boxSizes ?? s.sizes) : undefined;
  // Its larger copies, where it has them (the Canvas menu's covers): AVIF first, else JPEG, the narrowest at least as
  // wide as the box on this screen, so a 2x or 3x screen never shows a copy stretched past its own pixels.
  const hd = sizes ? cover?.hd : undefined;
  // How the cover sits in a box of another shape (cover-framing.ts): a square keeps its top part by default, where faces are.
  const whole = cover?.framing?.fit === "whole";
  const [allowed] = useState(() => typeof window !== "undefined" && clipsAllowed());
  // A fetched menu's cover names its clip; a Studios lead's nav cover gives its version (nav-covers.ts).
  const clip = !allowed ? undefined : (cover?.clip ?? (id && nav?.clipV ? `/previews/presets/${id}.mp4?v=${nav.clipV}` : undefined));
  const { mounted, leaving } = useClipPresence(!!alive && !!clip);
  const clipEl = clip && mounted && <CoverClip src={clip} at={cover?.clipAt} leaving={leaving} focus={cover?.framing?.focus} shared={shared} />;
  const still = cover && (
    // eslint-disable-next-line @next/next/no-img-element -- versioned static covers, sized by the box (no optimizer round trip)
    <img
      src={small}
      srcSet={hd ? hd.jpeg : sizes ? `${cover.thumb} 320w, ${cover.poster} 512w` : undefined}
      sizes={sizes}
      width={s.w}
      height={s.h}
      alt=""
      loading={eager ? "eager" : "lazy"}
      fetchPriority={low ? "low" : undefined}
      decoding="async"
      draggable={false}
      className="absolute inset-0 size-full object-cover motion-safe:transition-[scale] motion-safe:duration-700 motion-safe:ease-out motion-safe:group-data-[alive=lean]/cover:scale-[1.045]"
      style={{ objectPosition: cover.framing?.focus ?? "50% 25%" }}
    />
  );
  const img = hd ? (
    <picture>
      <source type="image/avif" srcSet={hd.avif} sizes={sizes} />
      {still}
    </picture>
  ) : (
    still
  );
  return (
    <span
      aria-hidden
      data-cover={cover ? (id ?? "") : undefined}
      data-alive={alive && cover ? (clip ? "clip" : "lean") : undefined}
      className={cn("group/cover relative block shrink-0 overflow-hidden bg-muted", s.box, className)}
    >
      {cover && whole ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- the same small copy, blurred behind the whole picture */}
          <img src={small} alt="" loading={eager ? "eager" : "lazy"} decoding="async" draggable={false} className="absolute inset-0 size-full scale-125 object-cover blur-md brightness-[0.7] saturate-[1.3]" />
          <span className="absolute inset-0 grid place-items-center [container-type:size]">
            <span className="relative aspect-[4/3] w-[min(100cqw,133.334cqh)] overflow-hidden">
              {img}
              {clipEl}
            </span>
          </span>
        </>
      ) : cover ? (
        <>
          {img}
          {clipEl}
        </>
      ) : icon ? (
        <NavIcon name={icon} className="absolute inset-0 m-auto size-[42%] max-h-6 max-w-6 text-muted-foreground" />
      ) : null}
    </span>
  );
}

/** Whether a cover (inline, or a nav cover by preset id) has a clip to play. */
export function useHasClip(id: string | undefined, cover: MegaCover | undefined): boolean {
  const nav = useNavCover(cover ? undefined : id);
  return !!(cover?.clip ?? (id && nav?.clipV));
}

/** A model icon by name (NavEntry.icon), decorative. */
export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  return createElement(navIcon(name), { "aria-hidden": true, className });
}
