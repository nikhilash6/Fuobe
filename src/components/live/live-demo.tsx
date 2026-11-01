"use client";

import { Check, CornerDownLeft, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A recorded live edit session, played back: the text types itself into the dock, the picture follows, Keep pulses, a
 * step joins the trail, and a compare sweep shows the before and after. It loops, pauses off screen and in a hidden
 * tab, and under reduced motion it is a still before/after. No GPU, no requests: guests, Home and the Apps card see it.
 */

export const LIVE_DEMO = "/previews/live-edit/demo.json";

interface DemoFrame {
  src: string;
  small?: string;
}
type DemoStep =
  /** live: a live frame (the pill says Live); the recording's real times join it once there are real-GPU numbers. */
  | { type: "frame"; frame: string; live?: boolean; ms: number }
  | { type: "type"; text: string; ms: number }
  | { type: "keep"; label: string; ms: number }
  | { type: "compare"; ms: number }
  | { type: "pause"; ms: number };
interface Demo {
  size: [number, number];
  frames: Record<string, DemoFrame>;
  script: DemoStep[];
}

let loaded: Promise<Demo | null> | null = null;
const loadDemo = () => (loaded ??= fetch(LIVE_DEMO).then((r) => (r.ok ? (r.json() as Promise<Demo>) : null)).catch(() => null));

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

interface View {
  frame: string;
  /** The frame under it, fading out. */
  under: string | null;
  typed: string;
  steps: string[];
  keepPulse: boolean;
  compare: number | null;
  pill: string;
}

export function LiveDemo({ compact, className, onTypeAttempt }: { compact?: boolean; className?: string; onTypeAttempt?: () => void }) {
  const [demo, setDemo] = useState<Demo | null>(null);
  const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const [view, setView] = useState<View>({ frame: "before", under: null, typed: "", steps: [], keepPulse: false, compare: null, pill: "Live" });

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
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    const vis = () => setVisible((v) => v && document.visibilityState === "visible");
    const back = () => document.visibilityState === "visible" && setVisible(el.getBoundingClientRect().bottom > 0);
    document.addEventListener("visibilitychange", vis);
    document.addEventListener("visibilitychange", back);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", vis);
      document.removeEventListener("visibilitychange", back);
    };
  }, []);

  // The player: one step at a time, each with its own small animation, then round again.
  useEffect(() => {
    if (!demo || reduced || !visible) return;
    let alive = true;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const wait = (ms: number) => new Promise<void>((r) => timers.add(setTimeout(r, ms)));
    const frameOf = (s: DemoStep) => (s.type === "frame" ? s.frame : null);
    const first = demo.script.map(frameOf).find(Boolean) ?? Object.keys(demo.frames)[0];
    void (async () => {
      while (alive) {
        setView({ frame: first, under: null, typed: "", steps: [], keepPulse: false, compare: null, pill: "Live" });
        let typed = "";
        for (const s of demo.script) {
          if (!alive) return;
          if (s.type === "frame") {
            setView((v) => ({ ...v, under: v.frame === s.frame ? v.under : v.frame, frame: s.frame, pill: s.live ? "Live" : v.pill }));
            await wait(s.ms);
          } else if (s.type === "type") {
            const per = Math.max(28, Math.floor(s.ms / Math.max(1, s.text.length)));
            for (const ch of s.text) {
              if (!alive) return;
              typed += ch;
              const t = typed;
              setView((v) => ({ ...v, typed: t }));
              await wait(per + (ch === " " ? 40 : 0));
            }
          } else if (s.type === "keep") {
            setView((v) => ({ ...v, keepPulse: true }));
            await wait(380);
            typed = "";
            setView((v) => ({ ...v, keepPulse: false, typed: "", steps: [...v.steps, s.label], pill: "Kept ✓" }));
            await wait(s.ms - 380);
          } else if (s.type === "compare") {
            const t0 = performance.now();
            while (alive && performance.now() - t0 < s.ms) {
              const p = (performance.now() - t0) / s.ms;
              setView((v) => ({ ...v, compare: 50 + 42 * Math.sin(p * Math.PI * 2) }));
              await wait(33);
            }
            setView((v) => ({ ...v, compare: null }));
          } else await wait(s.ms);
        }
      }
    })();
    return () => {
      alive = false;
      for (const t of timers) clearTimeout(t);
    };
  }, [demo, reduced, visible]);

  const src = (id: string | null) => {
    const f = id ? demo?.frames[id] : undefined;
    return f ? (compact && f.small ? f.small : f.src) : "";
  };
  const firstFrame = demo ? Object.keys(demo.frames)[0] : null;
  const lastFrame = demo ? Object.keys(demo.frames).at(-1)! : null;
  const ratio = demo ? `${demo.size[0]} / ${demo.size[1]}` : "4 / 3";

  return (
    <div ref={box} className={cn("relative isolate overflow-hidden rounded-2xl bg-media text-white", className)} style={{ aspectRatio: compact ? ratio : undefined }} data-live-demo>
      {demo && (reduced ? (
        <StillCompare before={src(firstFrame)} after={src(lastFrame)} />
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {view.under && <img key={`u-${view.under}`} src={src(view.under)} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img key={`f-${view.frame}`} src={src(view.frame)} alt="A live edit of a portrait" className="absolute inset-0 size-full animate-[live-fade_140ms_ease-out] object-cover" draggable={false} />
          {view.compare !== null && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src(firstFrame)} alt="" className="absolute inset-0 size-full object-cover" style={{ clipPath: `inset(0 ${100 - view.compare}% 0 0)` }} draggable={false} />
              <span className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_8px_rgba(0,0,0,.5)]" style={{ left: `${view.compare}%` }} />
            </>
          )}
        </>
      ))}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/10" />
      <span className={cn("absolute inline-flex items-center gap-1.5 rounded-full bg-black/45 font-medium backdrop-blur", compact ? "top-1.5 left-1.5 px-2 py-0.5 text-[10.5px]" : "top-3 left-3 px-2.5 py-1 text-[11px]")} role="status" aria-live="off">
        <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
        {view.pill}
      </span>
      {!compact && view.steps.length > 0 && (
        <div className="absolute top-3 right-3 flex max-w-[60%] items-center gap-1 overflow-hidden text-[11px]">
          <span className="rounded-full bg-black/45 px-2 py-0.5 backdrop-blur">Original</span>
          {view.steps.map((s, i) => (
            <span key={i} className="truncate rounded-full bg-white/90 px-2 py-0.5 font-medium text-black">
              {i + 1} · {s}
            </span>
          ))}
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
          {/* The end of the text stays in view as it grows. */}
          <span className={cn("flex min-w-0 overflow-hidden whitespace-nowrap", view.typed && "justify-end")}>{view.typed || <span className="text-white/55">Type a change…</span>}</span>
          <span className="-ml-1.5 h-4 w-px shrink-0 animate-[live-caret_1s_steps(1)_infinite] bg-white/80" />
        </button>
        <span className={cn("inline-flex shrink-0 items-center justify-center gap-1 rounded-xl bg-white font-medium text-black transition-transform", compact ? "size-8" : "h-11 px-3.5 text-[13px]", view.keepPulse && "scale-95 ring-4 ring-primary/60")} aria-label={compact ? "Keep" : undefined}>
          {view.steps.length && !view.typed ? <Check className="size-3.5" /> : <CornerDownLeft className="size-3.5" />}
          {!compact && "Keep"}
        </span>
      </div>
    </div>
  );
}

function StillCompare({ before, after }: { before: string; after: string }) {
  const [pos, setPos] = useState(50);
  return (
    <div className="absolute inset-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={after} alt="After a live edit" className="absolute inset-0 size-full object-cover" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={before} alt="Before" className="absolute inset-0 size-full object-cover" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
      <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Compare before and after" className="absolute inset-x-6 top-1/2 opacity-0" />
      <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-white" style={{ left: `${pos}%` }} />
    </div>
  );
}
