"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { IntentLink } from "@/components/intent-link";
import { onAttr, TAB_PILL, TabRow } from "@/components/ui/tab-row";
import { reducedMotion } from "@/lib/ui-motion";
import { cn } from "@/lib/utils";

/**
 * Shows a pair's two pictures together: when neither has loaded yet (after hydration, or a tab just picked), the pair
 * waits hidden (motion.css: [data-pair]) and fades in once both are there, instead of an empty frame, then one side,
 * then the other. Server HTML and a page without JS show the pictures as they load; one already showing is never hidden.
 */
function usePairTogether(key: string) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion()) return;
    const imgs = [...el.querySelectorAll("img")];
    if (imgs.length < 2 || imgs.some((i) => i.complete)) return;
    el.dataset.pair = "wait";
    let left = imgs.length;
    // Each picture ends with a load or an error; once both have, the pair shows.
    const show = () => {
      for (const i of imgs) {
        i.removeEventListener("load", one);
        i.removeEventListener("error", one);
      }
      el.dataset.pair = "in";
    };
    const one = () => --left <= 0 && show();
    for (const i of imgs) {
      i.addEventListener("load", one);
      i.addEventListener("error", one);
    }
    return show;
  }, [key]);
  return ref;
}

/** One side's picture: a 512 px still, and with HD stills its 960 and 1280 px copies (each with its version). */
export interface BeforeAfterStill {
  src: string;
  hd?: { 960: string; 1280: string };
}

export interface BeforeAfterPair {
  id: string;
  name: string;
  before: BeforeAfterStill;
  after: BeforeAfterStill;
  /** The before's 320 px copy (thumbOf, with the before's version), on its tab. */
  thumb: string;
  /** What each side shows: "Sketch", "Photo". */
  tags: string[];
  /** How much both pictures are enlarged, so an edge in the source never shows. */
  zoom: number;
  href: string;
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
/** The one-time peek: where the handle goes, and how long it takes, once the picture is mostly in view. */
const PEEK = [50, 80, 20, 50];
const PEEK_MS = 1400;
/** How far (px) a finger moves sideways before it drags the handle; up or down first, it's scrolling the page. */
const DRAG_SLOP = 6;
const TAG = "pointer-events-none absolute top-2.5 rounded bg-black/60 px-1.5 text-[11px] leading-5 text-white";
/**
 * How wide the picture shows, enlarged by the pair's zoom: 460 px from xl, 512 px where the screen has room for that,
 * and on a narrower phone the screen's width less its 1rem gutters. The browser picks the copy that screen needs: a 1x
 * desktop or 2x phone the 960, a 2x desktop or 3x phone the 1280.
 */
const sizesOf = (zoom: number) =>
  `(min-width: 1280px) ${Math.ceil(460 * zoom)}px, (min-width: 544px) ${Math.ceil(512 * zoom)}px, calc((100vw - 2rem) * ${zoom})`;
const srcSetOf = (s: BeforeAfterStill) => (s.hd ? `${s.src} 512w, ${s.hd[960]} 960w, ${s.hd[1280]} 1280w` : s.src);

/**
 * One side, filling the box and enlarged by `zoom`: its 512 px still, and with `hd` its 960 and 1280 px copies (when
 * it has them), for the browser to pick from by the screen.
 */
export function BeforeAfterPicture({ still, zoom, hd, onLoad }: { still: BeforeAfterStill; zoom: number; hd: boolean; onLoad?: () => void }) {
  return (
    <picture>
      {hd && still.hd && <source srcSet={srcSetOf(still)} sizes={sizesOf(zoom)} />}
      <img
        src={still.src}
        alt=""
        width={512}
        height={384}
        loading="lazy"
        decoding="async"
        draggable={false}
        onLoad={onLoad}
        className="absolute inset-0 size-full object-cover"
        style={{ scale: zoom }}
      />
    </picture>
  );
}

/**
 * An app's before and after, to drag between, with a tab per app. The first time it's mostly in view (and both
 * pictures are in), the handle sweeps once to show it moves; any drag, tap or key stops that, and with reduced motion
 * it never moves by itself. A mouse moves the handle as it's pressed; a finger moves it once it goes sideways, or where
 * it taps, so a scroll that starts on the picture leaves the handle where it was. Stills only: it plays no clip.
 *
 * It sits screens below the fold, so its pictures load lazily, each its 512 px still at first. Then the screen gets the
 * 960 or 1280 px copy it needs (srcset), asked for only once the picture comes within a screen of view and the page
 * has loaded: a browser fetches lazy images well ahead, and on a slow line those would hold up the page's largest
 * paint.
 *
 * From lg to xl the tabs stand in a column next to the picture, in the room it leaves.
 */
export function BeforeAfter({ pairs }: { pairs: BeforeAfterPair[] }) {
  const [tab, setTab] = useState(0);
  const [pos, setPos] = useState(50);
  /** Bumped as each picture comes in, to look again whether the peek can start. */
  const [loaded, setLoaded] = useState(0);
  const [inView, setInView] = useState(false);
  /** Set once the picture comes within a screen of view and the page has loaded: only then may it take its larger copies. */
  const [near, setNear] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  /** Where a finger came down, until it moves sideways (then it drags) or lifts (a tap). */
  const touch = useRef<{ x: number; y: number } | null>(null);
  /** Set once the peek ran, or the viewer moved the handle first. */
  const peeked = useRef(false);
  const frame = useRef(0);
  const id = useId();
  const pair = pairs[tab];
  const [beforeTag, afterTag] = pair.tags;

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => {
      if (e.intersectionRatio < 0.6) return;
      setInView(true);
      io.disconnect();
    }, { threshold: 0.6 });
    io.observe(el);
    // Near, and the page loaded: on a phone the slider can start within a screen, and its copies must not share the
    // line with the page's first pictures.
    const ready = () => setNear(true);
    const soon = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      soon.disconnect();
      if (document.readyState === "complete") ready();
      else window.addEventListener("load", ready, { once: true });
    }, { rootMargin: "100% 0px" });
    soon.observe(el);
    return () => {
      io.disconnect();
      soon.disconnect();
      window.removeEventListener("load", ready);
    };
  }, []);

  useEffect(() => {
    // Both pictures in (a load before hydration fires no onLoad, so look at them too).
    const shown = [...(box.current?.querySelectorAll("img") ?? [])].every((img) => img.complete && img.naturalWidth > 0);
    if (!inView || !shown || peeked.current) return;
    peeked.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / PEEK_MS);
      const leg = Math.min(PEEK.length - 2, Math.floor(p * (PEEK.length - 1)));
      const local = p * (PEEK.length - 1) - leg;
      setPos(PEEK[leg] + (PEEK[leg + 1] - PEEK[leg]) * easeInOut(local));
      if (p < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, [inView, loaded]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /** The viewer takes over: no more peeking. */
  const take = () => {
    peeked.current = true;
    cancelAnimationFrame(frame.current);
  };
  const at = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    return clamp(((clientX - r.left) / r.width) * 100);
  };
  const moveTo = (clientX: number) => {
    take();
    setPos(at(clientX));
  };
  const pick = (i: number) => {
    if (i === tab) return;
    take();
    setTab(i);
    setPos(50);
  };
  /** The pictures a tab shows, fetched as it's pointed at: the same file the picture will pick. */
  const preload = (p: BeforeAfterPair) => {
    for (const s of [p.before, p.after]) {
      const img = new Image();
      if (s.hd) {
        img.sizes = sizesOf(p.zoom);
        img.srcset = srcSetOf(s);
      } else img.src = s.src;
    }
  };
  const value = Math.round(pos);
  const together = usePairTogether(pair.id);

  return (
    <div className="w-full max-w-[512px] lg:max-xl:flex lg:max-xl:max-w-none lg:max-xl:items-start lg:max-xl:gap-4 xl:max-w-[460px]">
      <div
        ref={box}
        id={`${id}-panel`}
        role="tabpanel"
        aria-label={`${pair.name}: ${beforeTag} and ${afterTag}`}
        className="relative isolate aspect-[4/3] cursor-ew-resize touch-pan-y overflow-hidden rounded-xl bg-muted select-none lg:max-xl:w-[512px] lg:max-xl:shrink-0"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          if (e.pointerType === "mouse") moveTo(e.clientX);
          else touch.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const t = touch.current;
          if (t) {
            const dx = Math.abs(e.clientX - t.x);
            if (dx < DRAG_SLOP || dx < Math.abs(e.clientY - t.y)) return;
            touch.current = null;
          }
          moveTo(e.clientX);
        }}
        onPointerUp={(e) => {
          // A tap moves the handle there.
          if (dragging.current && touch.current) moveTo(e.clientX);
          dragging.current = false;
          touch.current = null;
        }}
        onPointerCancel={() => {
          // The page took the touch to scroll: the handle stays where it was.
          dragging.current = false;
          touch.current = null;
        }}
      >
        <div key={pair.id} ref={together} data-own-motion className="absolute inset-0 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150">
          {/* Both enlarged alike (pair.zoom), so an edge in the source never shows; the after is cut at the handle. */}
          <BeforeAfterPicture still={pair.before} zoom={pair.zoom} hd={near} onLoad={() => setLoaded((n) => n + 1)} />
          <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
            <BeforeAfterPicture still={pair.after} zoom={pair.zoom} hd={near} onLoad={() => setLoaded((n) => n + 1)} />
          </div>
        </div>
        <span className={cn(TAG, "left-2.5")}>{beforeTag}</span>
        <span className={cn(TAG, "right-2.5")}>{afterTag}</span>
        {/* The handle and its line move by transform (a full-width layer shifted by pos %): no layout while it plays. */}
        <span className="pointer-events-none absolute inset-0" style={{ transform: `translateX(${pos}%)` }}>
          <span aria-hidden className="absolute inset-y-0 left-0 -ml-px w-0.5 bg-white shadow-[0_0_6px_rgb(0_0_0/35%)]" />
          <span
            role="slider"
            tabIndex={0}
            aria-label={`Compare ${beforeTag.toLowerCase()} and ${afterTag.toLowerCase()}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={value}
            aria-valuetext={`${beforeTag} ${value}%, ${afterTag} ${100 - value}%`}
            onKeyDown={(e) => {
              const big = e.shiftKey ? 25 : 5;
              const next =
                e.key === "ArrowLeft" || e.key === "ArrowDown" ? pos - big : e.key === "ArrowRight" || e.key === "ArrowUp" ? pos + big : e.key === "Home" ? 0 : e.key === "End" ? 100 : null;
              if (next === null) return;
              e.preventDefault();
              take();
              setPos(clamp(next));
            }}
            className="pointer-events-auto absolute top-1/2 left-0 -mt-3.5 -ml-3.5 grid size-7 place-items-center rounded-full bg-white text-black shadow-[0_2px_8px_rgb(0_0_0/30%)] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <svg viewBox="0 0 16 16" aria-hidden className="size-3.5" fill="currentColor">
              <path d="M6 4 2 8l4 4V4Zm4 0v8l4-4-4-4Z" />
            </svg>
          </span>
        </span>
      </div>
      <div className="min-w-0 lg:max-xl:flex-1">
        <TabRow
          role="tablist"
          aria-label="Apps to compare"
          fade={false}
          className="mt-2 lg:max-xl:mt-0 lg:max-xl:flex-col lg:max-xl:items-stretch"
          onKeyDown={(e) => {
            const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"];
            if (!keys.includes(e.key)) return;
            e.preventDefault();
            const next = (tab + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : pairs.length - 1)) % pairs.length;
            pick(next);
            (e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next] as HTMLElement | undefined)?.focus();
          }}
        >
          {pairs.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={i === tab}
              aria-controls={`${id}-panel`}
              tabIndex={i === tab ? 0 : -1}
              onClick={() => pick(i)}
              onPointerEnter={() => preload(p)}
              onFocus={() => preload(p)}
              // Each tab takes an equal share of the row (stacked from lg to xl). A phone's tabs are words alone, so each
              // name fits whole.
              className={cn(TAB_PILL, "min-w-0 flex-1 max-sm:px-3.5 lg:max-xl:flex-none lg:max-xl:justify-start")}
              {...onAttr(i === tab)}
            >
              {/* The sketch's paper edge is cropped as in the picture. */}
              <span className="tab-thumb max-sm:hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumb} alt="" width={20} height={20} loading="lazy" decoding="async" style={{ scale: p.zoom }} />
              </span>
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </TabRow>
        <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-muted-foreground lg:max-xl:mt-4 lg:max-xl:flex-col lg:max-xl:items-start lg:max-xl:gap-1.5 lg:max-xl:px-1">
          <span>Drag to compare</span>
          <IntentLink
            href={pair.href}
            // 44 px to tap: its hit area reaches past the words.
            className="relative inline-flex items-center gap-1 font-medium text-brand-text underline-offset-2 after:absolute after:-inset-x-1 after:-inset-y-3.5 after:content-[''] hover:underline"
          >
            Try {pair.name} <ArrowRight className="size-3.5" />
          </IntentLink>
        </div>
      </div>
    </div>
  );
}
