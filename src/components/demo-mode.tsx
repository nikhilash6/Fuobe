"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Cpu, KeyRound, Loader2, PowerOff, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { openConnect } from "@/components/gpu/open-connect";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { saveSettings, useIsOwner, useStatus } from "@/lib/api";
import { toastError } from "@/lib/refusals";
import {
  PLACEHOLDER_ACTION_LABELS,
  PLACEHOLDER_CHIP,
  PLACEHOLDERS_ON,
  isPlaceholder,
  placeholderActions,
  placeholderLine,
  type PlaceholderAction,
} from "@/lib/demo-mode";
import { cn } from "@/lib/utils";

/**
 * Placeholder results (src/lib/demo-mode.ts): off by default, on only by the owner's choice in Settings, for a tour.
 * While on, the sidebar shows "Placeholders on", a chip whose click turns them off (with Undo). Every result the demo
 * provider made carries a "Placeholder" chip; for the owner it opens a small card with the ways to the real thing:
 * the ComfyUI on this computer (the connect card), an API key (Settings), and placeholders off.
 */

const ICONS: Record<PlaceholderAction, typeof Cpu> = { computer: Cpu, key: KeyRound, off: PowerOff };

const ROW =
  "flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] font-medium transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60 sm:min-h-9";

/** Save the switch, refresh what reads it, and say so (turning off offers Undo). */
function useSetPlaceholders() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const apply = async (on: boolean): Promise<boolean> => {
    setBusy(true);
    try {
      await saveSettings({ demoMode: on ? "on" : "off" });
      await Promise.all([qc.invalidateQueries({ queryKey: ["status"] }), qc.invalidateQueries({ queryKey: ["settings"] })]);
      return true;
    } catch (e) {
      toastError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    if (!(await apply(false))) return false;
    toast.success("Placeholder results are off", {
      description: "Runs now make the real thing, or ask you to connect ComfyUI or add a key first.",
      action: { label: "Undo", onClick: () => void apply(true) },
    });
    return true;
  };
  return { busy, turnOff };
}

function PlaceholderCard({ close }: { close: () => void }) {
  const status = useStatus().data;
  const { busy, turnOff } = useSetPlaceholders();
  const actions = placeholderActions({ owner: true, engineMode: status?.engineMode, demoMode: status?.demoMode });
  return (
    <>
      <div className="space-y-1 px-1 pt-0.5">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Sparkles aria-hidden className="size-3.5 text-highlight-foreground dark:text-highlight" /> {PLACEHOLDER_CHIP}
        </p>
        <p className="text-[13px] leading-snug text-muted-foreground">{placeholderLine(status?.demoMode)}</p>
      </div>
      <div className="flex flex-col gap-0.5">
        {actions.map((a) => {
          const Icon = ICONS[a];
          const inner = (
            <>
              {a === "off" && busy ? <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" /> : <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
              {PLACEHOLDER_ACTION_LABELS[a]}
            </>
          );
          if (a === "key")
            return (
              <Link key={a} href="/settings#cloud" className={ROW} onClick={close}>
                {inner}
              </Link>
            );
          return (
            <button
              key={a}
              type="button"
              className={ROW}
              disabled={a === "off" && busy}
              onClick={async () => {
                if (a === "off") {
                  if (await turnOff()) close();
                  return;
                }
                close();
                // The button said "Use the ComfyUI on this computer": the connect card opens already looking.
                openConnect(true);
              }}
            >
              {inner}
            </button>
          );
        })}
      </div>
    </>
  );
}

/**
 * The sidebar's "Placeholders on" while the switch is on (the owner's only: nobody else's runs make placeholders). A
 * click turns them off at once, with Undo in the toast; Settings has the switch itself.
 */
export function PlaceholdersOnChip({ className }: { className?: string }) {
  const { busy, turnOff } = useSetPlaceholders();
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void turnOff()}
      title="Turn off placeholder results"
      aria-label={`${PLACEHOLDERS_ON}. Turn off placeholder results`}
      className={cn(
        "group/chip inline-flex h-6 w-fit max-w-full items-center gap-1 rounded-full bg-highlight/25 pr-1.5 pl-2 text-[11px] font-medium text-highlight-foreground transition-colors outline-none hover:bg-highlight/40 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60 dark:text-highlight",
        className,
      )}
    >
      <span className="min-w-0 truncate">{PLACEHOLDERS_ON}</span>
      {busy ? <Loader2 aria-hidden className="size-3 shrink-0 animate-spin" /> : <X aria-hidden className="size-3 shrink-0 opacity-70 group-hover/chip:opacity-100" />}
    </button>
  );
}

/**
 * "Placeholder" on a result the demo provider made (nothing for any other). `overlay`: over the media, in a tile's
 * corner (`className` places the strip it sits in: "absolute top-2"); otherwise inline, in a row of text (`className`
 * goes on the chip). For the owner it opens the ways to the real thing; for anyone else it is a label.
 */
export function PlaceholderChip({ g, overlay, className }: { g: { provider?: string | null } | null | undefined; overlay?: boolean; className?: string }) {
  const owner = useIsOwner();
  const [open, setOpen] = useState(false);
  if (!isPlaceholder(g)) return null;
  const look = cn(
    "pointer-events-auto inline-flex h-7 max-w-full items-center gap-1 rounded-full px-2.5 text-[12px] font-medium whitespace-nowrap",
    overlay ? "bg-black/65 text-white backdrop-blur" : "bg-highlight/25 text-highlight-foreground dark:text-highlight",
    !overlay && className,
  );
  const label = (
    <>
      <Sparkles aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{PLACEHOLDER_CHIP}</span>
    </>
  );
  const chip = !owner ? (
    <span className={look} data-placeholder-chip="">
      {label}
    </span>
  ) : (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-placeholder-chip=""
          aria-label="Placeholder: not a real result. Show the ways to the real thing"
          onClick={(e) => e.stopPropagation()}
          className={cn(look, "transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring", overlay ? "hover:bg-black/80" : "hover:bg-highlight/40")}
        >
          {label}
          <ChevronDown aria-hidden className="size-3 shrink-0" />
        </button>
      </PopoverTrigger>
      {/* Clicks inside never reach a tile or card underneath (React passes them up through the portal). */}
      <PopoverContent
        side="bottom"
        align="start"
        collisionPadding={16}
        className="w-[min(18rem,calc(100vw-2rem))] gap-2 p-2"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <PlaceholderCard close={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
  if (!overlay) return chip;
  // A strip clear of the tile's right-hand icons; only the chip takes the pointer.
  return <div className={cn("pointer-events-none right-10 left-2 flex", className)}>{chip}</div>;
}
