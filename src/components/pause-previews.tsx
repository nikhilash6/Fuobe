"use client";

import { Pause, Play } from "lucide-react";
import { setPreviewsPaused, usePreviewsPaused } from "@/components/preset-preview";
import { cn } from "@/lib/utils";

/**
 * Stops every preview playing by itself, on every page (Home's first screen, the bar's menus, the galleries), remembered
 * on this device (preset-preview.tsx); a hover still plays one where a card allows it. One setting: pausing here pauses
 * everywhere.
 */
export function PausePreviews({ className }: { className?: string }) {
  const paused = usePreviewsPaused();
  const Icon = paused ? Play : Pause;
  const label = paused ? "Play previews" : "Pause previews";
  return (
    <button
      type="button"
      onClick={() => setPreviewsPaused(!paused)}
      aria-label={label}
      aria-pressed={paused}
      title={label}
      // 44 px to tap: its hit area reaches past its 28 px circle.
      className={cn(
        "relative inline-flex size-7 shrink-0 items-center justify-center gap-1.5 rounded-full border text-[12px] text-muted-foreground transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-accent hover:text-foreground sm:w-[8.5rem]",
        className,
      )}
    >
      <Icon className="size-3" />
      <span className="max-sm:hidden">{label}</span>
    </button>
  );
}
