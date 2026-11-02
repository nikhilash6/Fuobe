"use client";

import { Pause, Play, Repeat } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadImage, measureText } from "@/components/ads/render";
import type { Recipe } from "@/lib/motion/recipe";
import { loadScene } from "@/lib/motion/registry";
import type { LogoInfo, Scene, ScenePlan } from "@/lib/motion/scene";
import { previewSize, type SizeSpec } from "@/lib/motion/sizes";
import { cn } from "@/lib/utils";
import { drawDisplayList, logoInfoFor, type Sources } from "./draw";
import { fontsReady } from "./fonts";

/**
 * The live preview: the same scene code as the export, drawn on every animation frame at an absolute time (a dropped
 * frame skips ahead, it never slows the motion). It pauses when the tab is hidden or the player is off screen; with
 * reduced motion it shows the rest frame and waits for Play. Its canvas keeps a small backing store (and drops it a step
 * on a slow device), which never touches what an export makes.
 */

export interface MotionInputs {
  ready: boolean;
  sources: Sources;
  logo: LogoInfo | null;
  /** Bumps when the fonts or the logo arrive (the layout is measured again). */
  version: number;
}

const EMPTY_SOURCES: Sources = { images: new Map() };

/** The logo and fonts a recipe needs, loaded (the preview draws with a fallback font until its own arrives). */
export function useMotionInputs(recipe: Recipe | null): MotionInputs {
  const logoUrl = recipe?.brand.logo || null;
  const heading = recipe?.brand.fonts.heading;
  const body = recipe?.brand.fonts.body;
  const text = recipe ? Object.values(recipe.fields).join(" ") : "";
  const [state, setState] = useState<MotionInputs>({ ready: false, sources: EMPTY_SOURCES, logo: null, version: 0 });
  useEffect(() => {
    let live = true;
    void (async () => {
      const img = logoUrl ? await loadImage(logoUrl).catch(() => null) : null;
      const logo = img && logoUrl ? await logoInfoFor(logoUrl, img).catch(() => null) : null;
      await fontsReady([heading, body], { text }).catch(() => undefined);
      if (!live) return;
      const images = new Map<string, CanvasImageSource>();
      if (img) images.set("logo", img);
      setState((s) => ({ ready: true, sources: { images }, logo, version: s.version + 1 }));
    })();
    return () => {
      live = false;
    };
  }, [logoUrl, heading, body, text]);
  return state;
}

/** The scene for an id, once loaded. */
export function useScene(id: string | null): Scene | null {
  const [scene, setScene] = useState<{ id: string; scene: Scene } | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    void loadScene(id).then((s) => live && setScene({ id, scene: s }));
    return () => {
      live = false;
    };
  }, [id]);
  return scene && scene.id === id ? scene.scene : null;
}

/** A scene planned for a recipe (memoised on the recipe and the loaded inputs). */
export function usePlan(scene: Scene | null, recipe: Recipe | null, inputs: MotionInputs): ScenePlan | null {
  const key = recipe ? JSON.stringify(recipe) : "";
  return useMemo(() => {
    if (!scene || !recipe || !inputs.ready) return null;
    return scene.plan({ recipe, measure: measureText, logo: inputs.logo });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, key, inputs.version, inputs.ready]);
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

interface Stats {
  frames: number[];
}
declare global {
  interface Window {
    /** Set by an end-to-end test to read the preview's frame times. */
    __kineticStats?: Stats;
  }
}

const fmt = (t: number) => `${t.toFixed(1)} s`;

export interface MotionPlayerProps {
  plan: ScenePlan | null;
  sources: Sources;
  size: SizeSpec;
  duration: number;
  fps: number;
  /** What the picture shows, for screen readers. */
  label: string;
  /** Play, scrub and loop under the picture. */
  controls?: boolean;
  /** Small chips animate only while active (hovered or focused); others show their rest frame. */
  active?: boolean;
  /** The time shown while inactive (a chip's telling moment); the rest frame by default. */
  poster?: number;
  className?: string;
}

export function MotionPlayer({ plan, sources, size, duration, fps, label, controls = true, active = true, poster, className }: MotionPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const [playing, setPlaying] = useState(true);
  const [loop, setLoop] = useState(true);
  const [time, setTime] = useState(0);
  const [visible, setVisible] = useState(true);
  const [pageShown, setPageShown] = useState(true);
  const [askedPlay, setAskedPlay] = useState(false);
  const clock = useRef({ start: 0, from: 0 });
  const timeRef = useRef(0);
  const quality = useRef({ scale: 1, steps: 0, slow: [] as number[], fastSince: 0 });

  // Reduced motion: the rest frame until Play is pressed.
  const moving = playing && active && visible && pageShown && (!reduced || askedPlay) && !!plan;

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.01 });
    io.observe(el);
    const vis = () => setPageShown(!document.hidden);
    document.addEventListener("visibilitychange", vis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  /** Draws `t` at the backing size the box and the quality allow. */
  const draw = (t: number) => {
    const c = canvasRef.current;
    if (!c || !plan) return;
    const max = previewSize(size);
    const dpr = Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
    const cssW = c.clientWidth || max.w;
    const w = Math.max(16, Math.round(Math.min(max.w, cssW * dpr) * quality.current.scale));
    const h = Math.max(16, Math.round((w * plan.design.h) / plan.design.w));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext("2d", { alpha: false });
    if (ctx) drawDisplayList(ctx, plan.evaluate(t), sources);
  };

  // Still frames: the rest frame (not playing, reduced motion, a chip at rest) or the scrubbed time.
  useEffect(() => {
    if (moving || !plan) return;
    const t = !active ? (poster ?? plan.rest) : reduced && !askedPlay ? plan.rest : timeRef.current;
    draw(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moving, plan, active, reduced, askedPlay, sources, time, poster]);

  useEffect(() => {
    if (!moving || !plan) return;
    let raf = 0;
    clock.current = { start: performance.now(), from: timeRef.current >= duration ? 0 : timeRef.current };
    let lastLabel = 0;
    const tick = (now: number) => {
      let t = clock.current.from + (now - clock.current.start) / 1000;
      if (t >= duration) {
        if (loop) {
          t %= duration;
          clock.current = { start: now - t * 1000, from: 0 };
        } else {
          t = duration;
          timeRef.current = t;
          setTime(t);
          setPlaying(false);
          draw(plan.rest);
          return;
        }
      }
      timeRef.current = t;
      const t0 = performance.now();
      draw(t);
      const spent = performance.now() - t0;
      window.__kineticStats?.frames.push(spent);
      // Auto quality: a slow second steps the backing store down (twice at most); three fast seconds step it back.
      const q = quality.current;
      q.slow.push(spent);
      if (q.slow.length >= 60) {
        const sorted = [...q.slow].sort((a, b) => a - b);
        const median = sorted[sorted.length >> 1];
        q.slow = [];
        if (median > 24 && q.steps < 2) {
          q.steps++;
          q.scale *= 0.75;
          q.fastSince = 0;
        } else if (median < 12 && q.steps > 0) {
          q.fastSince ||= now;
          if (now - q.fastSince > 3000) {
            q.steps--;
            q.scale /= 0.75;
            q.fastSince = 0;
          }
        } else q.fastSince = 0;
      }
      if (controls && now - lastLabel > 100) {
        lastLabel = now;
        setTime(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moving, plan, duration, loop, sources]);

  const frame = 1 / fps;
  const seek = (t: number) => {
    const v = Math.min(duration, Math.max(0, t));
    timeRef.current = v;
    clock.current = { start: performance.now(), from: v };
    setTime(v);
    if (!moving) draw(v);
  };

  return (
    <div className={cn("min-w-0", className)}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        data-kinetic-player={controls ? "main" : "chip"}
        className="block h-auto w-full max-w-full rounded-lg bg-muted"
        style={{ aspectRatio: `${plan?.design.w ?? 9} / ${plan?.design.h ?? 16}` }}
      />
      {controls && (
        <div className="mt-1.5 flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={() => {
              if (moving) {
                setPlaying(false);
                return;
              }
              setAskedPlay(true);
              setPlaying(true);
            }}
            aria-label={moving ? "Pause" : "Play"}
            className="grid size-11 shrink-0 place-items-center rounded-full text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            {moving ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={duration}
            step={frame}
            value={Math.min(duration, time)}
            aria-label="Time"
            aria-valuetext={fmt(time)}
            onChange={(e) => {
              setPlaying(false);
              seek(Number(e.target.value));
            }}
            onKeyDown={(e) => {
              if (!e.shiftKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
              e.preventDefault();
              setPlaying(false);
              seek(timeRef.current + (e.key === "ArrowRight" ? 1 : -1));
            }}
            className="h-11 min-w-0 flex-1 cursor-pointer accent-[var(--brand,currentColor)]"
          />
          <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">{fmt(time)}</span>
          <button
            type="button"
            onClick={() => setLoop((v) => !v)}
            aria-pressed={loop}
            aria-label="Loop"
            className={cn("grid size-11 shrink-0 place-items-center rounded-full outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", loop ? "text-foreground" : "text-muted-foreground/60")}
          >
            <Repeat className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
