"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { IntentLink } from "@/components/intent-link";
import { cn } from "@/lib/utils";

export interface BeforeAfterPair {
  id: string;
  name: string;
  before: string;
  after: string;
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
 * An app's before and after, to drag between, with a tab per app. The first time it's mostly in view (and both
 * pictures are in), the handle sweeps once to show it moves; any drag, tap or key stops that, and with reduced motion
 * it never moves by itself. A mouse moves the handle as it's pressed; a finger moves it once it goes sideways, or where
 * it taps, so a scroll that starts on the picture leaves the handle where it was. Stills only: it plays no clip.
 *
 * From lg to xl (beside the sidebar) the tabs stand in a column next to the picture, in the room it leaves.
 */
export function BeforeAfter({ pairs }: { pairs: BeforeAfterPair[] }) {
  const [tab, setTab] = useState(0);
  const [pos, setPos] = useState(50);
  /** Bumped as each picture comes in, to look again whether the peek can start. */
  const [loaded, setLoaded] = useState(0);
  const [inView, setInView] = useState(false);
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
    return () => io.disconnect();
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
  const preload = (p: BeforeAfterPair) => {
    for (const src of [p.before, p.after]) new Image().src = src;
  };
  const value = Math.round(pos);

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
        <div key={pair.id} className="absolute inset-0 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150">
          {/* Both enlarged alike (pair.zoom), so an edge in the source never shows; the after is cut at the handle. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pair.before}
            alt=""
            width={512}
            height={384}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded((n) => n + 1)}
            className="absolute inset-0 size-full object-cover"
            style={{ scale: pair.zoom }}
          />
          <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pair.after}
              alt=""
              width={512}
              height={384}
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={() => setLoaded((n) => n + 1)}
              className="absolute inset-0 size-full object-cover"
              style={{ scale: pair.zoom }}
            />
          </div>
        </div>
        <span className={cn(TAG, "left-2.5")}>{beforeTag}</span>
        <span className={cn(TAG, "right-2.5")}>{afterTag}</span>
        <span aria-hidden className="pointer-events-none absolute inset-y-0 -ml-px w-0.5 bg-white shadow-[0_0_6px_rgb(0_0_0/35%)]" style={{ left: `${pos}%` }} />
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
          className="absolute top-1/2 -mt-3.5 -ml-3.5 grid size-7 place-items-center rounded-full bg-white text-black shadow-[0_2px_8px_rgb(0_0_0/30%)] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          style={{ left: `${pos}%` }}
        >
          <svg viewBox="0 0 16 16" aria-hidden className="size-3.5" fill="currentColor">
            <path d="M6 4 2 8l4 4V4Zm4 0v8l4-4-4-4Z" />
          </svg>
        </span>
      </div>
      <div className="min-w-0 lg:max-xl:flex-1">
        <div
          role="tablist"
          aria-label="Apps to compare"
          className="mt-2 flex gap-1.5 lg:max-xl:mt-0 lg:max-xl:flex-col"
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
              className={cn(
                "flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg p-1 text-[12px] font-medium text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-sm:h-9 sm:justify-start sm:pr-2 xl:flex-col xl:items-stretch xl:gap-1 xl:pr-1 xl:pb-1.5",
                i === tab && "bg-muted text-foreground",
              )}
            >
              {/* A phone's tabs are words alone, and from xl (a narrower picture) the thumb stands over the name, so each
                  name fits whole. The sketch's paper edge is cropped as in the picture. */}
              <span className="hidden shrink-0 overflow-hidden rounded-md sm:block sm:h-[42px] sm:w-14 xl:h-10 xl:w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumb} alt="" width={56} height={42} loading="lazy" decoding="async" className="size-full object-cover" style={{ scale: p.zoom }} />
              </span>
              <span className="truncate leading-tight xl:text-center">{p.name}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-muted-foreground lg:max-xl:mt-4 lg:max-xl:flex-col lg:max-xl:items-start lg:max-xl:gap-1.5 lg:max-xl:px-1">
          <span>Drag to compare</span>
          <IntentLink href={pair.href} className="inline-flex items-center gap-1 font-medium text-brand-text hover:underline underline-offset-2">
            Try {pair.name} <ArrowRight className="size-3.5" />
          </IntentLink>
        </div>
      </div>
    </div>
  );
}
