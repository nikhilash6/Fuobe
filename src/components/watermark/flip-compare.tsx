"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** How long a press must last to count as a hold (Before while held) rather than a tap (flip). */
export const HOLD_MS = 250;

/**
 * The result in place of the picture: a tap flips between After and Before, a press held over 250 ms shows Before until it
 * lets go. No slider, nothing to drag. Keyboard: Space holds Before, B flips. Before is always the original upload.
 * Keyed by the result where it's used, so a new result starts on After.
 */
export function FlipCompare({ before, after, width, height, children }: { before: string; after: string; width: number; height: number; children?: React.ReactNode }) {
  const [flipped, setFlipped] = useState(false);
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const showBefore = holding || flipped;
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    held.current = false;
    timer.current = setTimeout(() => {
      held.current = true;
      setHolding(true);
    }, HOLD_MS);
  };
  const up = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (held.current) setHolding(false);
    else setFlipped((f) => !f);
    held.current = false;
  };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    held.current = false;
    setHolding(false);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={showBefore ? "Showing the original. Tap to see the clean picture." : "Showing the clean picture. Tap to see the original."}
      aria-pressed={showBefore}
      data-wm-compare={showBefore ? "before" : "after"}
      className="relative w-full cursor-pointer touch-manipulation overflow-hidden rounded-2xl bg-media outline-none select-none focus-visible:ring-3 focus-visible:ring-ring [-webkit-touch-callout:none]"
      style={{ aspectRatio: `${width} / ${height}` }}
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === " " && !e.repeat) {
          e.preventDefault();
          setHolding(true);
        } else if (e.key === "b" || e.key === "B" || e.key === "Enter") {
          e.preventDefault();
          setFlipped((f) => !f);
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " ") {
          e.preventDefault();
          setHolding(false);
        }
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={after} alt="The clean picture" draggable={false} className="absolute inset-0 block size-full object-contain" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={before}
        alt="The original picture"
        draggable={false}
        aria-hidden={!showBefore}
        className={cn("absolute inset-0 block size-full object-contain transition-opacity duration-150 motion-reduce:transition-none", showBefore ? "opacity-100" : "opacity-0")}
      />
      <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-[rgb(10_8_6/.6)] px-3 py-1 text-[13px] font-medium text-white backdrop-blur-[10px]" aria-hidden="true">
        {showBefore ? "Before" : "After"}
      </span>
      {children}
    </div>
  );
}
