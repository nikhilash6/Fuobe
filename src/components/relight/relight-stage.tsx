"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_LIGHTS, type Light } from "@/lib/relight/lights";
import type { BlendMode } from "@/lib/relight/engine";
import type { AlignFit, Subject } from "@/lib/relight/shader";
import { cn } from "@/lib/utils";
import { fit, picSize, RelightRenderer, type Pic } from "./relight-renderer";

export interface StageScene {
  depth: Pic;
  matte: Pic;
  subjectDepth: number;
  /** Where the cut-out says the subject is (null: too small to say). */
  subject: Subject | null;
}

export interface StageProps {
  photo: Pic | null;
  alt: string;
  relit: Pic | null;
  align: AlignFit | null;
  scene: StageScene | null;
  lights: Light[];
  selected: string | null;
  intensity: number;
  blend: BlendMode;
  glow: boolean;
  ambient: number;
  /** A line under the photo while something runs ("Reading the scene…"). */
  status?: string | null;
  /** A light sweep over the photo while Generate runs. */
  working?: boolean;
  onTap: (x: number, y: number) => void;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onRemove: (id: string) => void;
  onAddDefault: () => void;
  onGenerate: () => void;
  /** Tapping the selected light again: show its chips. */
  onOpenLight: (id: string) => void;
  /** Drawn on every frame the stage paints (the e2e test reads it). */
  onPainted?: (ms: number) => void;
  className?: string;
}

const HOLD_MS = 350;
const MOVE_PX = 8;

/** How big the preview texture may be: phones 1280 on the long side, desktops 2048. */
function previewMax(): number {
  if (typeof window === "undefined") return 1280;
  return window.matchMedia?.("(pointer: coarse)").matches || window.innerWidth < 768 ? 1280 : 2048;
}

/**
 * The photo with its lights: the WebGL preview (or the blended result), a marker per light, tap to place or select,
 * press and hold to see the original. Dragging a light and the keyboard are extras: the chips and taps do it all.
 */
export function RelightStage(p: StageProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const renderer = useRef<RelightRenderer | null>(null);
  const [failed, setFailed] = useState(false);
  const [original, setOriginal] = useState(false);
  const [cssSize, setCssSize] = useState<[number, number]>([0, 0]);
  const press = useRef<{ x: number; y: number; timer: number; held: boolean; moved: boolean } | null>(null);
  const drag = useRef<{ id: string; pointer: number; x: number; y: number; moved: boolean; wasSelected: boolean } | null>(null);
  const latest = useRef(p);
  useEffect(() => {
    latest.current = p;
  });

  // One context for the stage's life.
  useEffect(() => {
    if (!canvas.current) return;
    try {
      renderer.current = new RelightRenderer(canvas.current);
    } catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- WebGL can only be tried once the canvas is mounted
      setFailed(true);
    }
    const c = canvas.current;
    const lost = (e: Event) => {
      e.preventDefault();
      setFailed(true);
    };
    c.addEventListener("webglcontextlost", lost);
    return () => {
      c.removeEventListener("webglcontextlost", lost);
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, []);

  // The stage's size on screen.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCssSize([el.clientWidth, el.clientHeight]));
    ro.observe(el);
    setCssSize([el.clientWidth, el.clientHeight]);
    return () => ro.disconnect();
  }, []);

  // Pictures go to the GPU when they change, not on every draw.
  useEffect(() => {
    renderer.current?.set("uPhoto", p.photo ? fit(p.photo, previewMax()) : null);
  }, [p.photo]);
  useEffect(() => {
    renderer.current?.set("uRelit", p.relit ? fit(p.relit, previewMax()) : null);
  }, [p.relit]);
  useEffect(() => {
    renderer.current?.set("uDepth", p.scene?.depth ?? null);
    renderer.current?.set("uMatte", p.scene?.matte ?? null);
  }, [p.scene]);

  const [pw, ph] = p.photo ? picSize(p.photo) : [4, 3];
  const aspect = pw / Math.max(1, ph);

  // One draw per change.
  useEffect(() => {
    const r = renderer.current;
    if (!r || !p.photo || !cssSize[0]) return;
    const frame = requestAnimationFrame(() => {
      const t0 = performance.now();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const max = Math.min(previewMax(), r.maxSize);
      let w = Math.round(cssSize[0] * dpr);
      let h = Math.round(w / aspect);
      const s = Math.min(1, max / Math.max(w, h));
      w = Math.max(1, Math.round(w * s));
      h = Math.max(1, Math.round(h * s));
      r.draw(
        {
          lights: p.lights,
          intensity: p.intensity,
          aspect,
          scene: { hasScene: !!p.scene, subjectDepth: p.scene?.subjectDepth ?? 0.5, subject: p.scene?.subject ?? undefined },
          mode: p.relit ? "result" : "preview",
          blend: p.blend,
          glow: p.glow,
          original,
          align: p.align ?? undefined,
          ambient: p.ambient,
        },
        w,
        h,
      );
      p.onPainted?.(performance.now() - t0);
    });
    return () => cancelAnimationFrame(frame);
    // p.onPainted is a report, not an input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.photo, p.relit, p.scene, p.lights, p.intensity, p.blend, p.glow, p.align, p.ambient, original, cssSize, aspect]);

  const spot = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, 1 - (clientY - r.top) / r.height)) };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-light]")) return;
    if (e.button !== 0) return;
    const timer = window.setTimeout(() => {
      if (press.current && !press.current.moved) {
        press.current.held = true;
        setOriginal(true);
      }
    }, HOLD_MS);
    press.current = { x: e.clientX, y: e.clientY, timer, held: false, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d && d.pointer === e.pointerId) {
      // A finger wobbles: a light moves once the press travels a few pixels, so a tap still selects it.
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= MOVE_PX) return;
      d.moved = true;
      const s = spot(e.clientX, e.clientY);
      latest.current.onMove(d.id, s.x, s.y);
      return;
    }
    const pr = press.current;
    if (pr && !pr.moved && Math.hypot(e.clientX - pr.x, e.clientY - pr.y) > MOVE_PX) {
      pr.moved = true;
      clearTimeout(pr.timer);
    }
  };
  const endPress = (e: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const d = drag.current;
    if (d && d.pointer === e.pointerId) {
      drag.current = null;
      if (!d.moved && d.wasSelected) latest.current.onOpenLight(d.id);
      return;
    }
    const pr = press.current;
    press.current = null;
    if (!pr) return;
    clearTimeout(pr.timer);
    if (pr.held) return setOriginal(false);
    if (cancelled || pr.moved) return;
    const s = spot(e.clientX, e.clientY);
    latest.current.onTap(s.x, s.y);
  };

  const onMarkerDown = (e: React.PointerEvent<HTMLButtonElement>, l: Light) => {
    e.stopPropagation();
    const wasSelected = p.selected === l.id;
    p.onSelect(l.id);
    // A light can be dragged with a finger too; the side and height chips and a tap where it goes move it as well.
    box.current?.setPointerCapture(e.pointerId);
    drag.current = { id: l.id, pointer: e.pointerId, x: e.clientX, y: e.clientY, moved: false, wasSelected };
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const sel = p.lights.find((l) => l.id === p.selected);
    const step = e.shiftKey ? 0.08 : 0.02;
    const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (move[e.key] && sel) {
      e.preventDefault();
      p.onMove(sel.id, sel.x + move[e.key][0], sel.y + move[e.key][1]);
    } else if ((e.key === "Delete" || e.key === "Backspace") && sel) {
      e.preventDefault();
      p.onRemove(sel.id);
    } else if (/^[1-3]$/.test(e.key) && p.lights[Number(e.key) - 1]) {
      p.onSelect(p.lights[Number(e.key) - 1].id);
    } else if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      p.onAddDefault();
    } else if (e.key === "g" || e.key === "G") {
      e.preventDefault();
      p.onGenerate();
    } else if (e.key === " ") {
      e.preventDefault();
      setOriginal(true);
    }
  };
  const onKeyUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === " ") setOriginal(false);
  };

  return (
    <div className={cn("relative", p.className)}>
      <div
        ref={box}
        role="group"
        tabIndex={0}
        aria-label={`${p.alt}. Tap to place a light (up to ${MAX_LIGHTS}); press and hold to see the original.`}
        aria-keyshortcuts="1 2 3 ArrowLeft ArrowRight ArrowUp ArrowDown Delete N G Space"
        data-testid="relight-stage"
        data-original={original ? "1" : undefined}
        className="relative w-full touch-manipulation overflow-hidden rounded-2xl bg-media outline-none select-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ aspectRatio: `${pw} / ${ph}` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endPress(e)}
        onPointerCancel={(e) => endPress(e, true)}
        onPointerLeave={(e) => press.current && e.pointerType === "mouse" && endPress(e, true)}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
      >
        <canvas ref={canvas} className={cn("absolute inset-0 size-full", failed && "hidden")} aria-hidden />
        {failed && p.photo instanceof HTMLImageElement && (
          // Without WebGL: the photo, the relit picture faded over it by Intensity.
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.photo.src} alt="" className="absolute inset-0 size-full object-cover" />
            {p.relit instanceof HTMLImageElement && !original && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.relit.src} alt="" className="absolute inset-0 size-full object-cover" style={{ opacity: p.intensity }} />
            )}
          </>
        )}
        {p.working && <div aria-hidden className="pointer-events-none absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/10 to-transparent" />}
        {!original &&
          p.lights.map((l, i) => (
            <button
              key={l.id}
              type="button"
              data-light={l.id}
              aria-label={`Light ${i + 1}${p.selected === l.id ? " (selected)" : ""}`}
              aria-pressed={p.selected === l.id}
              onPointerDown={(e) => onMarkerDown(e, l)}
              onClick={(e) => {
                // Keyboard activation (pointer taps are handled on pointer down).
                if (e.detail === 0) p.onSelect(l.id);
              }}
              className="absolute grid size-11 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
              style={{ left: `${l.x * 100}%`, top: `${(1 - l.y) * 100}%` }}
            >
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full border-2 text-[11px] font-semibold text-black/80 shadow-[0_0_0_1px_rgba(0,0,0,0.35),0_2px_8px_rgba(0,0,0,0.35)]",
                  l.behind ? "border-dashed" : "border-solid",
                  p.selected === l.id ? "scale-110 border-white ring-2 ring-white/70" : "border-white/80",
                )}
                style={{ background: l.color }}
              >
                {i + 1}
              </span>
            </button>
          ))}
        {original && <span className="pointer-events-none absolute top-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[12px] text-white">Original</span>}
      </div>
      {p.status && (
        <div className="mt-1.5 flex items-center gap-2 text-[12px] text-muted-foreground" role="status" aria-live="polite">
          <span className="relative h-0.5 w-16 overflow-hidden rounded-full bg-muted">
            <span className="absolute inset-y-0 left-0 w-1/2 animate-pulse rounded-full bg-primary" />
          </span>
          {p.status}
        </div>
      )}
    </div>
  );
}
