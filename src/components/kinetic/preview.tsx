"use client";

import { Check, ChevronDown, Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { measureText } from "@/components/ads/render";
import { loadClip, type ClipSource } from "@/components/motion/clip-source";
import { drawDisplayList, type Sources } from "@/components/motion/draw";
import { useMotionInputs, useReducedMotion, type MotionInputs } from "@/components/motion/player";
import { drawFrame } from "@/components/motion/render";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { videoNodeOf } from "@/lib/motion/display";
import type { Recipe } from "@/lib/motion/recipe";
import type { Scene, ScenePlan } from "@/lib/motion/scene";
import { exportSize, previewSize } from "@/lib/motion/sizes";
import { quantize } from "@/lib/motion/time";
import { cn } from "@/lib/utils";
import { readChoice, writeChoice } from "./draft";
import { usePlayhead, usePlaying, type TimeStore } from "./time-store";

/**
 * Kinetic's preview: the same scene code as the export, drawn at an absolute time on every animation frame. Its mode
 * (Auto, Fast, Balanced, Sharp) only sets how many pixels it draws and whether grain shows while it plays; it is never
 * part of the recipe and never read by the export, so it never changes a saved file.
 */

export const PREVIEW_MODES = ["auto", "fast", "balanced", "sharp"] as const;
export type PreviewMode = (typeof PREVIEW_MODES)[number];
export const PREVIEW_MODE_NAMES: Record<PreviewMode, { name: string; line: string }> = {
  auto: { name: "Auto", line: "Sharp when it can, lighter on a busy device" },
  fast: { name: "Fast", line: "Half the pixels, no grain while it plays" },
  balanced: { name: "Balanced", line: "Steady detail" },
  sharp: { name: "Sharp", line: "Full detail; a paused frame as it will save" },
};

export function usePreviewMode(): [PreviewMode, (m: PreviewMode) => void] {
  // Read at once: the editor only renders in the browser.
  const [mode, setMode] = useState<PreviewMode>(() => readChoice("preview", PREVIEW_MODES, "auto"));
  return [
    mode,
    (m) => {
      setMode(m);
      writeChoice("preview", m);
    },
  ];
}

export interface ClipInputs {
  source: ClipSource | null;
  info: { w: number; h: number; duration: number } | null;
  /** The clip couldn't be opened (gone or unreadable). */
  failed: boolean;
}

/** The recipe's clip (Kinetic's video layer), loaded as a muted video. */
export function useClipInputs(url: string | null | undefined): ClipInputs {
  const [state, setState] = useState<ClipInputs & { url: string | null }>({ url: null, source: null, info: null, failed: false });
  useEffect(() => {
    if (!url) return;
    let live = true;
    let src: ClipSource | null = null;
    const ctl = new AbortController();
    void loadClip(url, { signal: ctl.signal })
      .then((s) => {
        src = s;
        if (live) setState({ url, source: s, info: s.info, failed: false });
        else s.dispose();
      })
      .catch(() => live && setState({ url, source: null, info: null, failed: true }));
    return () => {
      live = false;
      ctl.abort();
      src?.dispose();
    };
  }, [url]);
  if (!url || state.url !== url) return { source: null, info: null, failed: false };
  return state;
}

/** Everything the preview and the renders need besides the recipe: the pictures, the fonts and the clip. */
export interface KineticInputs extends MotionInputs {
  clip: ClipInputs;
}

export function useKineticInputs(recipe: Recipe | null): KineticInputs {
  const inputs = useMotionInputs(recipe);
  const clip = useClipInputs(recipe?.layers?.video?.src);
  return useMemo(() => ({ ...inputs, clip, sources: clip.source ? { ...inputs.sources, clips: new Map([["clip", clip.source.el]]) } : inputs.sources }), [inputs, clip]);
}

/** A scene planned for a recipe with its inputs (memoised on the recipe's JSON). */
export function useKineticPlan(scene: Scene | null, recipe: Recipe | null, inputs: KineticInputs): ScenePlan | null {
  const key = recipe ? JSON.stringify(recipe) : "";
  const info = inputs.clip.info;
  return useMemo(() => {
    if (!scene || !recipe || !inputs.ready) return null;
    try {
      return scene.plan({ recipe, measure: measureText, logo: inputs.logo, images: inputs.images, outlines: inputs.outlines, ...(info && { clips: { clip: info } }) });
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, key, inputs.version, inputs.ready, info]);
}

declare global {
  interface Window {
    /** Set by an end-to-end test to read the preview's frame times. */
    __kineticStats?: { frames: number[] };
  }
}

export interface KineticPreviewProps {
  plan: ScenePlan | null;
  recipe: Recipe;
  inputs: KineticInputs;
  time: TimeStore;
  mode: PreviewMode;
  label: string;
  /** Where it rests with reduced motion (the scene's telling moment; its last frame by default). */
  hold?: number;
  className?: string;
  style?: React.CSSProperties;
}

/** The big preview canvas. It writes the playhead; the transport and the timeline read it. */
export function KineticPreview({ plan, recipe, inputs, time, mode, label, hold, className, style }: KineticPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const playing = usePlaying(time);
  const [visible, setVisible] = useState(true);
  const [shown, setShown] = useState(true);
  const quality = useRef({ scale: 1, steps: 0, slow: [] as number[], fastSince: 0 });
  const sharpReq = useRef(0);
  const sharpCanvases = useRef<[HTMLCanvasElement, HTMLCanvasElement] | null>(null);
  useEffect(
    () => () => {
      for (const x of sharpCanvases.current ?? []) Object.assign(x, { width: 0, height: 0 });
      sharpCanvases.current = null;
    },
    [],
  );
  const duration = recipe.duration;
  const sources: Sources = inputs.sources;
  const clip = inputs.clip.source;

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.01 });
    io.observe(el);
    const vis = () => setShown(!document.hidden);
    document.addEventListener("visibilitychange", vis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  // Reduced motion: the resting frame, and nothing plays until Play is pressed.
  useEffect(() => {
    if (reduced && plan) {
      time.setPlaying(false);
      time.set(Math.min(plan.rest, hold ?? plan.rest));
    }
  }, [reduced, plan, time, hold]);

  /** The backing size for a mode (`still`: a paused frame). */
  const backing = (still: boolean) => {
    const c = canvasRef.current!;
    const cap = previewSize(recipe.size);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const css = c.clientWidth || cap.w;
    if (mode === "sharp") {
      const ex = exportSize(recipe.size);
      return Math.max(16, Math.round(Math.min(ex.w, css * dpr)));
    }
    let w = Math.min(cap.w, css * dpr);
    if (mode === "fast" && !still) w /= 2;
    if (mode === "auto" && !still) w *= quality.current.scale;
    return Math.max(16, Math.round(w));
  };

  const paint = (t: number, still: boolean) => {
    const c = canvasRef.current;
    if (!c || !plan) return;
    const w = backing(still);
    const h = Math.max(16, Math.round((w * plan.design.h) / plan.design.w));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext("2d", { alpha: false });
    if (!ctx) return;
    const list = plan.evaluate(t);
    const v = videoNodeOf(list);
    if (v && clip) clip.follow(v.time, !still && playing, mode === "fast" ? 0.25 : 1 / 30);
    drawDisplayList(ctx, list, sources, { grain: !(mode === "fast" && !still) });
  };

  /** Sharp, paused: the frame as it will save (export size, its motion blur), a quarter size first; the newest asked wins. */
  const renderView = (t: number) => {
    const c = canvasRef.current;
    if (!c || !plan) return;
    const id = ++sharpReq.current;
    const ex = exportSize(recipe.size);
    const step = (k: number) => {
      if (id !== sharpReq.current) return;
      const w = Math.max(16, Math.round(ex.w * k));
      const h = Math.max(16, Math.round(ex.h * k));
      // Two canvases kept for the component and resized (new ones per step add up against a phone's canvas memory).
      const pair = (sharpCanvases.current ??= [document.createElement("canvas"), document.createElement("canvas")]);
      const [target, scratch] = pair;
      for (const x of pair) {
        if (x.width !== w || x.height !== h) Object.assign(x, { width: w, height: h });
      }
      drawFrame(plan, t, target, scratch, sources, { fps: recipe.fps, samples: recipe.export.blurSamples, shutter: recipe.export.shutter, duration });
      if (id !== sharpReq.current) return;
      c.width = w;
      c.height = h;
      c.getContext("2d", { alpha: false })?.drawImage(target, 0, 0);
      if (k < 1) setTimeout(() => step(1), 30);
    };
    setTimeout(() => step(0.25), 0);
  };

  const moving = playing && visible && shown && !!plan;

  // A still frame (paused, scrubbed, or a change while paused).
  useEffect(() => {
    if (moving || !plan) return;
    const t = Math.min(time.get(), plan.rest);
    if (mode === "sharp") {
      paint(t, true);
      renderView(t);
    } else paint(t, true);
    const redraw = () => (mode === "sharp" ? renderView(time.get()) : paint(time.get(), true));
    clip?.el.addEventListener("seeked", redraw);
    const off = time.onSeek((v) => {
      const at = Math.min(plan.rest, Math.max(0, v));
      time.set(at);
      if (mode === "sharp") {
        paint(at, true);
        renderView(at);
      } else paint(at, true);
    });
    return () => {
      off();
      clip?.el.removeEventListener("seeked", redraw);
      sharpReq.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moving, plan, mode, sources, clip]);

  useEffect(() => {
    if (!moving || !plan) return;
    let raf = 0;
    let from = time.get() >= plan.rest ? 0 : time.get();
    let start = performance.now();
    const off = time.onSeek((v) => {
      from = Math.min(plan.rest, Math.max(0, v));
      start = performance.now();
    });
    const tick = (now: number) => {
      let t = from + (now - start) / 1000;
      if (t >= duration) {
        t %= duration;
        from = 0;
        start = now - t * 1000;
      }
      time.set(t);
      const t0 = performance.now();
      paint(t, false);
      const spent = performance.now() - t0;
      window.__kineticStats?.frames.push(spent);
      if (mode === "auto") {
        // A slow second steps the backing store down (twice at most); three fast seconds step it back.
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
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      off();
      clip?.el.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moving, plan, duration, mode, sources, clip]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      data-kinetic-player="main"
      className={cn("block h-auto max-w-full rounded-2xl bg-muted shadow-soft", className)}
      style={{ aspectRatio: `${plan?.design.w ?? 9} / ${plan?.design.h ?? 16}`, ...style }}
    />
  );
}

const fmt = (t: number) => `${t.toFixed(1)} s`;

/** Play, the scrub bar (arrow keys a frame, Shift a second), the time and the preview mode. */
export function Transport({ time, duration, fps, rest, mode, onMode }: { time: TimeStore; duration: number; fps: number; rest: number; mode: PreviewMode; onMode: (m: PreviewMode) => void }) {
  const t = usePlayhead(time);
  const playing = usePlaying(time);
  const frame = 1 / fps;
  const go = (v: number) => {
    time.setPlaying(false);
    time.seek(Math.min(rest, Math.max(0, quantize(v + 1e-9, fps))));
  };
  return (
    <div className="flex min-w-0 items-center gap-1" data-kinetic-transport>
      <button
        type="button"
        onClick={() => {
          if (!playing && time.get() >= rest - 1e-6) time.seek(0);
          time.setPlaying(!playing);
        }}
        aria-label={playing ? "Pause" : "Play"}
        className="grid size-11 shrink-0 place-items-center rounded-full bg-foreground text-background outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
      </button>
      <input
        type="range"
        min={0}
        max={duration}
        step={frame}
        value={Math.min(duration, t)}
        aria-label="Time"
        aria-valuetext={fmt(t)}
        onChange={(e) => go(Number(e.target.value))}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const dir = e.key === "ArrowRight" ? 1 : -1;
          go(time.get() + dir * (e.shiftKey ? 1 : frame));
        }}
        className="k-range h-11 min-w-0 flex-1 cursor-pointer"
        style={{ "--fill": `${(Math.min(duration, t) / Math.max(1e-6, duration)) * 100}%` } as React.CSSProperties}
      />
      <span className="shrink-0 text-right text-[12px] tabular-nums text-muted-foreground" aria-live="off">
        {t.toFixed(1)} <span className="opacity-70">/ {fmt(duration)}</span>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="inline-flex h-11 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Preview: ${PREVIEW_MODE_NAMES[mode].name}`}>
            <span className="hidden sm:inline">Preview:</span> {PREVIEW_MODE_NAMES[mode].name}
            <ChevronDown className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-[12px]">Preview quality (never changes what saves)</DropdownMenuLabel>
          {PREVIEW_MODES.map((m) => (
            <DropdownMenuItem key={m} onSelect={() => onMode(m)} className="min-h-11 items-start gap-2 py-2">
              <Check className={cn("mt-0.5 size-4 shrink-0", m === mode ? "opacity-100" : "opacity-0")} />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{PREVIEW_MODE_NAMES[m].name}</span>
                <span className="block text-[12px] text-muted-foreground">{PREVIEW_MODE_NAMES[m].line}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
