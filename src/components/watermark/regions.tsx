"use client";

import { Check } from "lucide-react";
import { useRef } from "react";
import { regionAt, type Region } from "@/lib/watermark";
import { cn } from "@/lib/utils";

/** The finger's reach: small marks are hit within this many CSS pixels of their outline. */
const REACH_PX = 22;

const pct = (n: number, of: number) => `${(n / of) * 100}%`;

/**
 * The picture with each mark outlined (its tight box) and named by a chip. A tap keeps a mark (dashed outline, "Kept") or
 * takes it back; where marks overlap, the smallest under the finger wins. Taps only, nothing to drag. The chip row under
 * it gives the same toggles to keyboards and screen readers.
 */
export function RegionsView({
  src,
  width,
  height,
  regions,
  onToggle,
  dim,
  working,
  children,
}: {
  src: string;
  width: number;
  height: number;
  regions: Region[];
  onToggle?: (id: string) => void;
  /** The picture is dimmed (a removal is running). */
  dim?: boolean;
  /** The marks being removed show a moving line. */
  working?: boolean;
  children?: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const tap = (e: React.MouseEvent) => {
    if (!onToggle || !box.current) return;
    const r = box.current.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = ((e.clientX - r.left) / r.width) * width;
    const y = ((e.clientY - r.top) / r.height) * height;
    const hit = regionAt(regions, x, y, (REACH_PX / r.width) * width);
    if (hit) onToggle(hit.id);
  };
  return (
    <div
      ref={box}
      className={cn("relative w-full touch-manipulation overflow-hidden rounded-2xl bg-media select-none", onToggle && "cursor-pointer")}
      style={{ aspectRatio: `${width} / ${height}` }}
      onClick={tap}
      data-wm-regions={regions.length}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Your photo" draggable={false} className={cn("absolute inset-0 block size-full object-contain transition-opacity duration-300", dim && "opacity-55")} />
      {regions.map((g) => {
        const [x0, y0, x1, y1] = g.box;
        const atTop = y0 / height < 0.06;
        return (
          <div
            key={g.id}
            aria-hidden="true"
            data-wm-region={g.id}
            data-on={g.on || undefined}
            className={cn(
              "pointer-events-none absolute rounded-[10px] border-2 transition-colors duration-150",
              g.on ? "border-white bg-white/12 shadow-[0_0_0_1px_rgb(0_0_0/.45),inset_0_0_0_1px_rgb(0_0_0/.25)]" : "border-dashed border-white/70 bg-transparent shadow-[0_0_0_1px_rgb(0_0_0/.25)]",
              working && !g.on && "opacity-0",
            )}
            style={{ left: pct(x0, width), top: pct(y0, height), width: pct(x1 - x0, width), height: pct(y1 - y0, height) }}
          >
            {!working && (
              <span
                className={cn(
                  "absolute left-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-4 font-semibold whitespace-nowrap shadow-[0_1px_3px_rgb(0_0_0/.35)]",
                  atTop ? "top-1 left-1" : "-top-6",
                  g.on ? "bg-white text-[#141210]" : "bg-[rgb(10_8_6/.6)] text-white backdrop-blur-[6px]",
                )}
              >
                {g.on ? g.chip : "Kept"}
              </span>
            )}
            {working && g.on && <span className="absolute inset-x-0 top-0 h-[2px] animate-wm-sweep bg-white/90 motion-reduce:animate-pulse" />}
          </div>
        );
      })}
      {children}
    </div>
  );
}

/** Every mark as a toggle under the picture: the same choice as tapping it, for tiny or overlapping marks and screen readers. */
export function RegionChips({ regions, onToggle }: { regions: Region[]; onToggle: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Marks found">
      {regions.map((g, i) => (
        <button
          key={g.id}
          type="button"
          aria-pressed={!g.on}
          aria-label={`${g.chip} ${i + 1}: ${g.on ? "will be removed. Tap to keep it." : "kept. Tap to remove it."}`}
          onClick={() => onToggle(g.id)}
          data-wm-chip={g.id}
          className={cn(
            "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
            g.on ? "border-border-strong bg-background text-foreground" : "border-dashed border-border-strong bg-muted text-muted-foreground",
          )}
        >
          {g.on ? <span className="size-2 rounded-full bg-foreground" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
          {g.chip}
          {!g.on && <span className="text-[12px]">· Kept</span>}
        </button>
      ))}
    </div>
  );
}
