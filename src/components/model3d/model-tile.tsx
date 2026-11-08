"use client";

import { Box } from "lucide-react";
import { createElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import { viewerGlb } from "@/lib/av/model3d";
import type { OutputFile } from "@/lib/catalog/types";
import { releaseVideo } from "@/lib/media-release";
import type { ReadyPreview3d } from "@/lib/preview3d";
import { reducedMotion } from "@/lib/ui-motion";
import { cn } from "@/lib/utils";
import { loadModelViewer } from "./model-viewer";

/** How long a mouse stays on a tile before its model turns (ms): one passing over on its way elsewhere starts nothing. */
const TURN_AFTER = 120;

/** The one turntable playing: a grid plays only the tile under the pointer (or, on a touch screen, the one in view). */
let playing: HTMLVideoElement | null = null;

/** Turntables play unless the viewer asks for less motion or to save data. */
function turnsAllowed(): boolean {
  if (reducedMotion()) return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !conn?.saveData;
}

/** The studio colour at a preview's corners: what a tile shows before its still arrives. */
const STUDIO_FILL = "bg-[#dad8d4] dark:bg-[#141417]";

/**
 * The preview's studio sweep, continued past a square still in a wider or taller tile (a letterboxed one), so the still
 * sits in it with no seam: the sweep scripts/model3d/preview3d-core.mjs draws (backdrop()), centred on the still, sized
 * by the tile's shorter side (container units).
 */
const SWEEP_STOPS = [0, 0.25, 0.5, 0.75, 1].map((f) => [f, f ** 1.5] as const);
const sweep = (c0: number[], c1: number[]) => {
  const stops = SWEEP_STOPS.map(([f, t]) => `rgb(${c0.map((v, k) => Math.round(v + (c1[k] - v) * t)).join(" ")}) ${f * 100}%`).join(", ");
  // The still's sweep is centred at 42 % of its height, 0.78 of its side wide and 0.78 / 1.15 high.
  return `radial-gradient(78cqmin 67.8cqmin at 50% calc(50% - 8cqmin), ${stops})`;
};
const SWEEP = { light: sweep([246, 245, 243], [218, 216, 212]), dark: sweep([44, 44, 48], [20, 20, 23]) };

function StudioSweep() {
  return (
    <>
      <div aria-hidden className="absolute inset-0 dark:hidden" style={{ backgroundImage: SWEEP.light }} />
      <div aria-hidden className="absolute inset-0 hidden dark:block" style={{ backgroundImage: SWEEP.dark }} />
    </>
  );
}

/**
 * A 3D result as a tile: its preview's still (the light or the dark studio, with the theme), and its turntable playing
 * muted and looped over it while a mouse rests on the tile or the keys focus it (on a touch screen: while the tile is
 * in view). The clip shows only once its first frame is drawn, and fades back to the still: never a blank frame. The
 * 3D file itself is never loaded here; the viewer loads it when the result is opened.
 */
export function ModelTile({ preview, fit, autoPlay, className }: { preview: ReadyPreview3d; fit?: boolean; autoPlay?: boolean; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  const object = fit ? "object-contain" : "object-cover";
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    // The tile's own button or link takes the pointer and the focus.
    const host = (el.closest("a,button,[tabindex]") as HTMLElement | null) ?? el;
    let timer = 0;
    const start = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => turnsAllowed() && setOn(true), delay);
    };
    const stop = () => {
      window.clearTimeout(timer);
      setOn(false);
    };
    const enter = (e: PointerEvent) => e.pointerType === "mouse" && start(TURN_AFTER);
    const leave = (e: PointerEvent) => e.pointerType === "mouse" && stop();
    const focus = () => host.matches(":focus-visible") && start(0);
    host.addEventListener("pointerenter", enter);
    host.addEventListener("pointerleave", leave);
    host.addEventListener("focus", focus);
    host.addEventListener("blur", stop);
    // A touch screen has no hover: the tile turns while most of it is in view.
    let io: IntersectionObserver | null = null;
    if (autoPlay || (typeof window.matchMedia === "function" && window.matchMedia("(hover: none)").matches)) {
      io = new IntersectionObserver(([e]) => (e.intersectionRatio >= 0.6 ? start(autoPlay ? 0 : 250) : stop()), { threshold: [0, 0.6] });
      io.observe(el);
    }
    return () => {
      window.clearTimeout(timer);
      host.removeEventListener("pointerenter", enter);
      host.removeEventListener("pointerleave", leave);
      host.removeEventListener("focus", focus);
      host.removeEventListener("blur", stop);
      io?.disconnect();
    };
  }, [autoPlay]);
  const { mounted, leaving } = usePresence(on);
  return (
    <div ref={root} className={cn("relative size-full overflow-hidden [container-type:size]", STUDIO_FILL, className)} data-model-tile="">
      {fit && <StudioSweep />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={preview.poster.light} alt="" loading="lazy" decoding="async" className={cn("absolute inset-0 size-full dark:hidden", object)} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={preview.poster.dark} alt="" loading="lazy" decoding="async" className={cn("absolute inset-0 hidden size-full dark:block", object)} />
      {mounted && <TurnClip preview={preview} leaving={leaving} object={object} />}
    </div>
  );
}

/** Mounted while `on`, and for the fade after it: the clip fades back to its still, then lets go of its decoder. */
function usePresence(on: boolean): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(on);
  if (on && !mounted) setMounted(true);
  useEffect(() => {
    if (on || !mounted) return;
    const t = window.setTimeout(() => setMounted(false), 240);
    return () => window.clearTimeout(t);
  }, [on, mounted]);
  return { mounted, leaving: mounted && !on };
}

/** The turntable over the still, for the page's theme: shown once a frame is drawn, faded out when `leaving`. */
function TurnClip({ preview, leaving, object }: { preview: ReadyPreview3d; leaving: boolean; object: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [drawn, setDrawn] = useState(false);
  useLayoutEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (playing && playing !== v) playing.pause();
    playing = v;
    let live = true;
    const tone = document.documentElement.classList.contains("dark") ? "dark" : "light";
    const frame = () => live && setDrawn(true);
    const shown = () => ("requestVideoFrameCallback" in v ? v.requestVideoFrameCallback(frame) : frame());
    v.addEventListener("playing", shown, { once: true });
    // AV1 where the browser plays it (smaller), else H.264.
    const av1 = preview.webm?.[tone] && v.canPlayType('video/webm; codecs="av01.0.05M.08"') === "probably";
    v.src = av1 ? preview.webm![tone] : preview.clip[tone];
    void v.play().catch(() => {});
    return () => {
      live = false;
      if (playing === v) playing = null;
      releaseVideo(v);
    };
  }, [preview]);
  return (
    <video
      ref={ref}
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden
      tabIndex={-1}
      data-on={drawn && !leaving ? "" : undefined}
      className={cn("absolute inset-0 size-full opacity-0 transition-opacity duration-200 ease-out data-[on]:opacity-100", object)}
    />
  );
}

/**
 * A 3D result with no preview of its own yet (an older result while its preview is made, or a file the server can't
 * draw): the photo it was made from, on the studio fill, with a small 3D mark; with no photo, a GLB is drawn in the
 * browser once the tile is in view (model-viewer, still, its whole model framed); only a file nothing can show keeps
 * the plain 3D card.
 */
export function ModelStandIn({ output, photo, fit, className }: { output: OutputFile; photo?: string; fit?: boolean; className?: string }) {
  if (photo) {
    return (
      <div className={cn("relative size-full overflow-hidden", STUDIO_FILL, className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo} alt="" loading="lazy" decoding="async" className={cn("absolute inset-0 size-full", fit ? "object-contain" : "object-cover")} />
        <span
          className="absolute top-2 left-2 inline-flex h-5 items-center gap-1 rounded-full bg-black/55 px-1.5 text-[10px] font-medium text-white backdrop-blur"
          aria-hidden
        >
          <Box className="size-3" /> 3D
        </span>
      </div>
    );
  }
  const glb = /\.glb(?:[?#]|$)/i.test(output.url) || output.contentType === "model/gltf-binary";
  if (glb) return <BrowserStill output={output} className={className} />;
  return <PlainCard className={className} />;
}

function PlainCard({ className }: { className?: string }) {
  return (
    <div className={cn("flex size-full flex-col items-center justify-center gap-2 bg-muted text-muted-foreground", className)}>
      <Box className="size-8" />
      <span className="text-[12px] font-medium">3D model</span>
    </div>
  );
}

/** A GLB drawn in the browser as a still, once its tile is in view (the fallback when no preview was made). */
function BrowserStill({ output, className }: { output: OutputFile; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = root.current;
    if (!el || near) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  useEffect(() => {
    if (!near) return;
    let live = true;
    loadModelViewer().then(
      () => live && setReady(true),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [near]);
  if (failed) return <PlainCard className={className} />;
  return (
    <div ref={root} className={cn("relative size-full overflow-hidden", STUDIO_FILL, className)}>
      {ready &&
        createElement("model-viewer", {
          src: viewerGlb(output),
          alt: "",
          loading: "lazy",
          reveal: "auto",
          "interaction-prompt": "none",
          "environment-image": "neutral",
          "tone-mapping": "neutral",
          "shadow-intensity": "0.8",
          "camera-orbit": "0deg 75deg 105%",
          style: {
            width: "100%",
            height: "100%",
            background: "transparent",
            pointerEvents: "none",
            "--poster-color": "transparent",
            "--progress-bar-height": "0",
          },
        })}
    </div>
  );
}
