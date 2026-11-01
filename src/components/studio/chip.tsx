"use client";

import { X } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const chipBase = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
export const chipIdle = "bg-secondary text-secondary-foreground hover:bg-accent";
export const chipOn = "bg-brand-faint text-brand-text hover:bg-brand-faint-hover";

/** A toolbar chip (32 px pill). Forwards its ref so it can be a Popover/Sheet trigger. */
export const Chip = forwardRef<HTMLButtonElement, React.ComponentProps<"button"> & { icon?: React.ComponentType<{ className?: string }>; active?: boolean }>(function Chip(
  { icon: Icon, children, active, className, ...props },
  ref,
) {
  return (
    <button ref={ref} type="button" {...props} className={cn(chipBase, active ? chipOn : chipIdle, className)}>
      {Icon && <Icon className="size-3.5" />}
      {children}
    </button>
  );
});

/**
 * A selected chip with its own clear button next to it (a real, focusable button, so the choice
 * can be removed from the keyboard). `children` is the trigger chip. It stays in the same wrapper
 * either way (laid out as if there were none until picked), so a pick doesn't remount it: Mix's
 * popover stays open after a pick, and its grid and the clip playing in it go on.
 */
export function ClearableChip({ active, onClear, clearLabel, children }: { active: boolean; onClear: () => void; clearLabel: string; children: React.ReactNode }) {
  return (
    <span
      className={
        active
          ? "inline-flex shrink-0 items-center rounded-full bg-brand-faint text-brand-text [&>button:first-child]:bg-transparent [&>button:first-child]:pr-1.5 [&>button:first-child:hover]:bg-brand-faint-hover"
          : "contents"
      }
    >
      {children}
      {active && (
        <button
          type="button"
          onClick={onClear}
          aria-label={clearLabel}
          className="mr-1 -ml-0.5 grid size-6 place-items-center rounded-full opacity-70 transition outline-none hover:bg-brand-faint-hover hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <X className="size-3.5" />
        </button>
      )}
    </span>
  );
}
