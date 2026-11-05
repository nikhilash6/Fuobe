"use client";

import { ChevronDown } from "lucide-react";
import { forwardRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { RUN_ON_FOOTER, type RunOnPick, type RunOnRow } from "@/lib/run-place";
import { cn } from "@/lib/utils";
import { ResponsivePanel } from "./responsive-panel";

/**
 * "Run on": where an account's runs go while hosted runs are on (this studio's GPUs, its own GPU, its own key), for a
 * person who has a choice for this item (src/lib/run-place.ts placeRows). A pick applies at once and holds for its next
 * runs on every device (src/lib/run-on.ts). The composer's price chip opens it ("Free ▾"); a tool page's place chip
 * lists the same rows; Settings → Your GPU shows them as "Where your runs go".
 */

/** The rows as a radio list: the place, the line under it, a green dot for a GPU that answers. */
export function RunOnList({
  rows,
  onPick,
  footer = RUN_ON_FOOTER,
  disabled,
  label = "Run on",
  className,
}: {
  rows: readonly RunOnRow[];
  onPick: (id: RunOnPick) => void;
  /** Under the rows (none: null). */
  footer?: string | null;
  disabled?: boolean;
  /** The list's name for screen readers. */
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-0.5", className)}>
      <div role="radiogroup" aria-label={label} className="space-y-0.5">
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={r.selected}
            data-run-on={r.id}
            disabled={disabled}
            onClick={() => r.selected || onPick(r.id)}
            // Phones: rows of 48 px or more.
            className={cn(
              "flex min-h-12 w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60 sm:min-h-10",
              r.selected && "bg-brand-faint hover:bg-brand-faint",
            )}
          >
            <span
              aria-hidden
              className={cn("grid size-4 shrink-0 place-items-center rounded-full border", r.selected ? "border-primary" : "border-border-strong")}
            >
              {r.selected && <span className="size-2 rounded-full bg-primary" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{r.label}</span>
              <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
                {r.online && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />}
                <span className="min-w-0 truncate">{r.sub}</span>
              </span>
            </span>
          </button>
        ))}
      </div>
      {footer && <p className="px-2.5 pt-1.5 text-[12px] text-muted-foreground">{footer}</p>}
    </div>
  );
}

/** The chip's button: the price words and a caret ("Free ▾", "Free · your GPU ▾", "≈ $0.04 · your key ▾"). */
const RunOnButton = forwardRef<HTMLButtonElement, React.ComponentProps<"button"> & { text: string; short?: string }>(function RunOnButton(
  { text, short, className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...props}
      className={cn(
        "inline-flex h-7 max-w-full min-w-0 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-[12px] font-medium text-muted-foreground tabular-nums transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
    >
      {short ? (
        <>
          <span className="truncate sm:hidden">{short}</span>
          <span className="hidden truncate sm:inline">{text}</span>
        </>
      ) : (
        <span className="truncate">{text}</span>
      )}
      <ChevronDown aria-hidden className="size-3 shrink-0 opacity-70" />
    </button>
  );
});

/**
 * The composer's price chip with its Run on list: the price words and a caret; it opens a popover (desktop) or a bottom
 * sheet (phone) titled "Run on". `tooltip`: where the run goes and the wait ("Runs on our GPUs · Next in line").
 */
export function RunOnChip({
  rows,
  text,
  short,
  tooltip,
  ariaLabel,
  onPick,
  pending,
  className,
}: {
  rows: readonly RunOnRow[];
  /** The chip's words without the caret. */
  text: string;
  /** Shorter words on phones. */
  short?: string;
  tooltip?: React.ReactNode;
  ariaLabel: string;
  onPick: (id: RunOnPick) => void;
  pending?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // A phone's sheet says the title in its own header; the desktop popover says it here.
  const mobile = useIsMobile();
  return (
    <ResponsivePanel
      open={open}
      onOpenChange={setOpen}
      title="Run on"
      tooltip={open ? undefined : tooltip}
      align="end"
      focusSelf
      className="w-[min(92vw,320px)] p-1.5"
      trigger={<RunOnButton text={text} short={short} aria-label={ariaLabel} data-run-on-chip="" className={className} />}
    >
      {!mobile && <p className="px-2.5 pt-1 pb-1.5 text-[13px] font-semibold">Run on</p>}
      <RunOnList
        rows={rows}
        disabled={pending}
        onPick={(id) => {
          onPick(id);
          setOpen(false);
        }}
      />
    </ResponsivePanel>
  );
}
