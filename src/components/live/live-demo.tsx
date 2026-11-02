"use client";

import { Zap } from "lucide-react";
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  cameraFor,
  changesWord,
  countChanges,
  type Demo,
  type DemoView,
  demoEnds,
  FADE_MS,
  frameOrder,
  LIVE_DEMO,
  LIVE_DEMO_V,
  pillText,
  startView,
  SWEEP_MS,
  sweepPath,
  typeDelays,
  viewBefore,
  ZOOM_MAX,
  ZOOM_MS,
} from "@/lib/live/demo";
import { cn } from "@/lib/utils";

/**
 * A recorded live edit session, played back: one prompt that keeps growing. The camera moves in on the area a change
 * touches, the words type themselves onto the end of the prompt in the dock, each live frame is drawn across the
 * picture as it arrives, the full-quality picture settles, the camera pulls back out and the change count goes up;
 * at the end a compare sweep shows the original against the last picture. It loops, pauses off screen and in a hidden
 * tab and picks up where it stopped, and under reduced motion it is a still before/after. Frames load only once the
 * player is in view. No GPU, no requests beyond the files: guests, Home and the Apps card see it.
 */

export { LIVE_DEMO };

let loaded: Promise<Demo | null> | null = null;
// A failed fetch is not kept, so the next player tries again.
const loadDemo = () =>
  (loaded ??= fetch(`${LIVE_DEMO}?v=${LIVE_DEMO_V}`)
    .then((r) => (r.ok ? (r.json() as Promise<Demo>) : null))
    .catch(() => null)
    .then((d) => {
      if (!d) loaded = null;
      return d;
    }));

/** Each frame file is fetched and decoded once per page, however many players show it. */
const decoded = new Map<string, Promise<void>>();
function ready(url: string) {
  let p = decoded.get(url);
  if (!p) {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    // A failed decode is tried again the next time the frame is needed.
    p = img.decode().catch(() => {
      decoded.delete(url);
    });
    decoded.set(url, p);
  }
  return p;
}
/** A slow file never stalls the loop for long. */
const READY_CAP_MS = 1200;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(q.matches);
    on();
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function LiveDemo({ compact, className, onTypeAttempt }: { compact?: boolean; className?: string; onTypeAttempt?: () => void }) {
  const [demo, setDemo] = useState<Demo | null>(null);
  const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  // Nothing plays or loads until the observer says the player is in view.
  const [visible, setVisible] = useState(false);
  const [view, setView] = useState<DemoView | null>(null);
  /** The script step to run next, kept across pauses so the loop picks up where it stopped. */
  const at = useRef(0);

  useEffect(() => {
    let alive = true;
    void loadDemo().then((d) => alive && setDemo(d));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // One callback can carry several entries for the player; the newest is the one that counts.
    const io = new IntersectionObserver(
      (es) => {
        const e = es[es.length - 1];
        if (e) setVisible(e.isIntersecting && document.visibilityState === "visible");
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    const onVis = () => {
      if (document.visibilityState !== "visible") return setVisible(false);
      const r = el.getBoundingClientRect();
      setVisible(r.bottom > 0 && r.top < window.innerHeight);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const src = (id: string | null) => {
    const f = id ? demo?.frames[id] : undefined;
    return f ? (compact && f.small ? f.small : f.src) : "";
  };

  // The player: one step at a time, each with its own small animation, then round again.
  useEffect(() => {
    if (!demo || reduced || !visible) return;
    let alive = true;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const wait = (ms: number) =>
      new Promise<void>((r) => {
        const t = setTimeout(() => {
          timers.delete(t);
          r();
        }, ms);
        timers.add(t);
      });
    const url = (id: string) => {
      const f = demo.frames[id];
      return f ? (compact && f.small ? f.small : f.src) : "";
    };
    const shown = (id: string) => Promise.race([ready(url(id)), wait(READY_CAP_MS)]);
    const order = frameOrder(demo);
    const { before, after } = demoEnds(demo);
    // Every frame starts loading now, in the order the script shows them.
    for (const id of order) void ready(url(id));
    void (async () => {
      await shown(order[0] ?? before);
      if (!alive) return;
      let i = at.current;
      let typed = "";
      if (i > 0) {
        const v = viewBefore(demo, i);
        typed = v.typed;
        setView(v);
      } else setView((v) => startView(before, v && v.frame !== before ? v.frame : null));
      while (alive) {
        for (; i < demo.script.length; i++) {
          if (!alive) return;
          at.current = i;
          const s = demo.script[i];
          if (s.type === "frame") {
            await shown(s.frame);
            if (!alive) return;
            // The same frame again (the original at a new round) keeps its slower fade back.
            setView(
              (v) =>
                v && {
                  ...v,
                  under: v.frame === s.frame ? v.under : v.frame,
                  frame: s.frame,
                  fade: v.frame === s.frame ? v.fade : FADE_MS,
                  sweep: !!s.live,
                },
            );
            await wait(s.ms);
          } else if (s.type === "zoom") {
            setView((v) => v && { ...v, zoom: s.box });
            if (s.ms > 0) await wait(s.ms);
          } else if (s.type === "type") {
            const base = typed;
            const delays = typeDelays(s.text, s.ms);
            for (let c = 0; c < delays.length; c++) {
              if (!alive) return;
              const t = base + [...s.text].slice(0, c + 1).join("");
              setView((v) => v && { ...v, typed: t });
              await wait(delays[c]);
            }
            typed = base + s.text;
          } else if (s.type === "change") {
            setView((v) => v && { ...v, changes: v.changes + 1 });
            await wait(s.ms);
          } else if (s.type === "compare") {
            const t0 = performance.now();
            while (alive && performance.now() - t0 < s.ms) {
              const p = (performance.now() - t0) / s.ms;
              setView((v) => v && { ...v, compare: 50 + 42 * Math.sin(p * Math.PI * 2) });
              await wait(33);
            }
            setView((v) => v && { ...v, compare: null });
          } else await wait(s.ms);
        }
        if (!alive) return;
        // Round again: the last picture fades back to the original.
        i = 0;
        at.current = 0;
        typed = "";
        setView((v) => startView(before, v ? (v.frame !== before ? v.frame : null) : after !== before ? after : null));
      }
    })();
    return () => {
      alive = false;
      for (const t of timers) clearTimeout(t);
    };
  }, [demo, reduced, visible, compact]);

  const ends = demo ? demoEnds(demo) : null;
  // Under reduced motion the still compare shows, with nothing left over from a loop that was playing.
  const v = ends && (reduced || !view) ? startView(ends.before) : view;
  const ratio = demo ? `${demo.size[0]} / ${demo.size[1]}` : "4 / 3";
  const pill = v ? pillText(v, compact) : { main: "Live", count: null };
  const changes = v?.changes ?? 0;
  const showImages = visible || view !== null;
  // The small card keeps the whole picture: zoomed in, the typing bar would cover the change.
  const cam = cameraFor(v?.zoom ?? null, compact ? 1 : ZOOM_MAX);
  const sweep = sweepPath(cam);
  // The typed text fades on the left only once it is wider than the bar; short text shows whole.
  const typedOuter = useRef<HTMLSpanElement>(null);
  const typedInner = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);
  const typedNow = v?.typed ?? "";
  useLayoutEffect(() => {
    const o = typedOuter.current;
    const i = typedInner.current;
    setClipped(!!typedNow && !!o && !!i && i.offsetWidth > o.clientWidth + 1);
  }, [typedNow]);

  return (
    <div ref={box} className={cn("@container relative isolate overflow-hidden rounded-2xl bg-media text-white", className)} style={{ aspectRatio: compact ? ratio : undefined }} data-live-demo>
      {demo && ends && v && showImages && (reduced ? (
        <StillCompare before={src(ends.before)} after={src(ends.after)} changes={countChanges(demo)} />
      ) : (
        // The camera: it glides in on the area a step changes while the live frames arrive, and back out to keep.
        <div
          className="absolute inset-0 origin-top-left"
          style={
            {
              transform: `translate(${cam.x * 100}%, ${cam.y * 100}%) scale(${cam.s})`,
              transition: `transform ${ZOOM_MS}ms cubic-bezier(.45,0,.2,1)`,
              "--sweep-from": `${sweep.from}%`,
              "--sweep-to": `${sweep.to}%`,
              "--scan-from": `${sweep.scanFrom}%`,
              "--scan-to": `${sweep.scanTo}%`,
            } as CSSProperties
          }
          data-live-camera={cam.s > 1 ? cam.s : undefined}
        >
          {/* Both pictures sit in one keyed list, so the frame that drops underneath keeps its painted image. */}
          {[v.under, v.frame]
            .filter((id): id is string => !!id)
            .map((id) => {
              const top = id === v.frame;
              return (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={id}
                  src={src(id)}
                  alt={top ? "A live edit of a portrait" : ""}
                  className="absolute inset-0 size-full object-cover"
                  style={top ? { animation: v.sweep ? `live-sweep ${SWEEP_MS}ms cubic-bezier(.45,0,.55,1)` : v.fade ? `live-fade ${v.fade}ms ease-out` : "none" } : undefined}
                  onError={
                    top
                      ? (e) => {
                          e.currentTarget.style.visibility = "hidden";
                        }
                      : undefined
                  }
                  draggable={false}
                />
              );
            })}
          {/* The leading edge of a live frame as it is drawn across. */}
          {v.sweep && (
            <span key={`s-${v.frame}`} className="pointer-events-none absolute inset-0 opacity-0" style={{ animation: `live-scan ${SWEEP_MS}ms cubic-bezier(.45,0,.55,1)` }} aria-hidden>
              <span className="absolute inset-y-0 left-0 w-10 -translate-x-1/2 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
              <span className="absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-white/70 shadow-[0_0_10px_rgba(255,255,255,.6)]" />
            </span>
          )}
          {v.compare !== null && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src(ends.before)} alt="" className="absolute -inset-px object-cover" style={{ width: "calc(100% + 2px)", height: "calc(100% + 2px)", clipPath: `inset(-2px ${100 - v.compare}% -2px 0)` }} draggable={false} />
              <span className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_8px_rgba(0,0,0,.5)]" style={{ left: `${v.compare}%` }} />
            </>
          )}
        </div>
      ))}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/10" />
      <span className={cn("absolute inline-flex items-center gap-1.5 rounded-full bg-black/45 font-medium whitespace-nowrap backdrop-blur", compact ? "top-1.5 left-1.5 px-2 py-0.5 text-[10.5px]" : "top-3 left-3 px-2.5 py-1 text-[11px]")} role="status" aria-live="off">
        <span className="size-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse" />
        {pill.main}
        {pill.count && <span className="text-white/75">· {pill.count}</span>}
      </span>
      {/* The compare sweep has its own labels; the count steps aside while it plays. */}
      {!compact && v && <ChangeCount changes={v.changes} hidden={v.compare !== null} />}
      {v && v.compare !== null && (
        <div className={cn("pointer-events-none absolute inset-x-3 flex justify-between text-[11px] font-medium", compact ? "inset-x-2 bottom-12" : "bottom-16")} data-live-compare>
          <span className="rounded-full bg-black/45 px-2 py-0.5 backdrop-blur">Original</span>
          <span className="rounded-full bg-white/90 px-2 py-0.5 text-black">{changesWord(changes)}</span>
        </div>
      )}
      <div className={cn("absolute inset-x-3 bottom-3 flex items-center gap-2", compact && "inset-x-2 bottom-2")}>
        <button
          type="button"
          tabIndex={onTypeAttempt ? 0 : -1}
          onClick={onTypeAttempt}
          className={cn("flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-white/12 text-left ring-1 ring-white/15 backdrop-blur-md", compact ? "h-8 px-2 text-[11.5px]" : "h-11 px-3 text-[14px]")}
          aria-label="Type a change"
        >
          <Zap className={cn("shrink-0 text-amber-300", compact ? "size-3" : "size-3.5")} />
          {/* The end of the text stays in view as it grows; text cut off on the left fades out rather than ending mid-letter. */}
          <span
            ref={typedOuter}
            className={cn("flex min-w-0 overflow-hidden whitespace-nowrap", v?.typed && "justify-end", v?.typed && clipped && "[mask-image:linear-gradient(90deg,transparent,#000_1.25rem)]")}
            data-live-typed-clipped={(v?.typed && clipped) || undefined}
          >
            {v?.typed ? (
              <span ref={typedInner} className="shrink-0" data-live-typed>
                {v.typed}
              </span>
            ) : (
              <span className="truncate text-white/55">Type a change, then keep adding…</span>
            )}
          </span>
          <span className="-ml-1.5 h-4 w-px shrink-0 bg-white/80 motion-safe:animate-[live-caret_1s_steps(1)_infinite]" />
        </button>
      </div>
    </div>
  );
}

/**
 * How many changes the one prompt holds so far: "One prompt" and the count, which pops each time a change settles. The
 * words themselves are in the dock.
 */
export function ChangeCount({ changes, hidden }: { changes: number; hidden?: boolean }) {
  if (!changes) return null;
  return (
    <div className={cn("pointer-events-none absolute top-3 right-3 flex items-center gap-1 text-[11px] transition-opacity duration-300", hidden && "opacity-0")} aria-hidden={hidden || undefined} data-live-count={changes}>
      <span className="shrink-0 rounded-full bg-black/45 px-2 py-0.5 backdrop-blur max-[420px]:hidden">One prompt</span>
      <span key={changes} className="shrink-0 rounded-full bg-white/95 px-2 py-0.5 font-medium text-black tabular-nums ring-2 ring-primary/60 animate-[live-chip_260ms_ease-out]">
        {changesWord(changes)}
      </span>
    </div>
  );
}

function StillCompare({ before, after, changes }: { before: string; after: string; changes: number }) {
  const [pos, setPos] = useState(50);
  return (
    <div className="absolute inset-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={after} alt="After a live edit" className="absolute inset-0 size-full object-cover" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={before} alt="Before" className="absolute inset-0 size-full object-cover" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
      <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Compare before and after" className="absolute inset-x-6 top-1/2 opacity-0" />
      <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-white" style={{ left: `${pos}%` }} />
      {changes > 0 && (
        <div className="pointer-events-none absolute inset-x-3 top-12 flex justify-between text-[11px] font-medium">
          <span className="rounded-full bg-black/45 px-2 py-0.5 backdrop-blur">Original</span>
          <span className="rounded-full bg-white/90 px-2 py-0.5 text-black">{changesWord(changes)}</span>
        </div>
      )}
    </div>
  );
}
