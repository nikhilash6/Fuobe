"use client";

import { Cloud, Cpu, Lock } from "lucide-react";
import Link from "next/link";
import { openAddKey } from "@/components/keys/your-keys";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Engine } from "@/lib/catalog/types";
import { useEngineMode, useHydrated, useStatus, useViewer } from "@/lib/api";
import { accountEngine } from "@/lib/your-keys";
import { cn } from "@/lib/utils";
import { radioKeys, radioTab } from "./radio-keys";

const OPTIONS: { value: Engine; label: string; icon: typeof Cloud; tip: string }[] = [
  { value: "cloud", label: "Cloud", icon: Cloud, tip: "Frontier paid models via your fal.ai / Replicate key" },
  { value: "open", label: "Open source", icon: Cpu, tip: "Open-weight models running on your ComfyUI server" },
];

/**
 * Segmented control with a sliding white thumb (Liner-style). `md` (page headers) turns
 * icon-only below the sm breakpoint so titles keep their line on phones (`compact` does the same
 * for `sm`, e.g. in Assist's one-row footer); the tooltips and aria labels still name each engine.
 * `wordless`: no "Add key" on a phone either, in a header that has no room for it (the lock and the label still say it).
 */
export function EngineSwitch({
  value,
  onChange,
  size = "md",
  compact = size === "md",
  wordless,
}: {
  value: Engine;
  onChange: (e: Engine) => void;
  size?: "sm" | "md";
  compact?: boolean;
  wordless?: boolean;
}) {
  const mode = useEngineMode();
  // Until hydrated, the server's switch (as useEngineMode): a viewer or status that lands mid-hydration must not change it.
  const hydrated = useHydrated();
  const viewer = useViewer().data;
  const status = useStatus().data;
  // Only the owner can change the engine mode (Settings): anyone else gets a plain badge, not a link to a page they can't use.
  const owner = hydrated && viewer?.owner === true;
  // An account (public sign-up): locked on open source until it adds its own key, and why; with one, who pays.
  const account = accountEngine(hydrated ? status : undefined);
  const locked = account && "locked" in account ? account.locked : null;
  const idx = OPTIONS.findIndex((o) => o.value === value);
  if (mode !== "both" || locked) {
    const o = OPTIONS.find((x) => x.value === (locked ? "open" : mode))!;
    const text = locked?.text ?? (mode === "open" ? "Open source only" : "Cloud only");
    const cls = cn(
      "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors",
      size === "sm" ? "h-8" : "h-8 sm:h-9",
    );
    const body = (
      <>
        <o.icon className="size-3.5" />
        <span className={cn(compact && "hidden sm:inline")}>{text}</span>
        {/* A phone has room for two words: what to do about the lock. */}
        {compact && !wordless && locked?.addKey && <span className="sm:hidden">Add key</span>}
      </>
    );
    // An account opens "Add your key" right here (a plain click; Settings → Your keys in a new tab), or Your GPU when
    // the studio runs open-source models only: the way to paid models is its own key.
    if (locked) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href={locked.href}
              aria-label={`${text}. ${locked.tip}`}
              className={cn(cls, "hover:text-foreground")}
              onClick={(e) => {
                if (!locked.addKey || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                openAddKey("fal");
              }}
            >
              {body}
              <Lock className="size-3 opacity-60" />
            </Link>
          </TooltipTrigger>
          <TooltipContent className="max-w-72">{locked.tip}</TooltipContent>
        </Tooltip>
      );
    }
    return owner ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link href="/settings" aria-label={`${text} — change in Settings`} className={cn(cls, "hover:text-foreground")}>
            {body}
            <Lock className="size-3 opacity-60" />
          </Link>
        </TooltipTrigger>
        <TooltipContent>{text} · locked in Settings → Engine mode</TooltipContent>
      </Tooltip>
    ) : (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className={cls}>
            {body}
          </span>
        </TooltipTrigger>
        <TooltipContent>{mode === "open" ? "This studio runs open-source models, free on your own GPU" : "This studio runs paid cloud models"}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <div
      role="radiogroup"
      aria-label="Engine"
      onKeyDown={radioKeys}
      className={cn("relative inline-grid shrink-0 grid-cols-2 rounded-full bg-muted p-0.5", size === "sm" ? "h-8" : "h-8 sm:h-9")}
    >
      <span
        aria-hidden
        className="absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-background shadow-soft transition-transform duration-300 ease-move"
        style={{ transform: `translateX(${idx * 100}%)` }}
      />
      {OPTIONS.map((o) => (
        <Tooltip key={o.value}>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="radio"
              aria-checked={value === o.value}
              tabIndex={radioTab(value === o.value)}
              aria-label={o.label}
              onClick={() => onChange(o.value)}
              className={cn(
                "relative z-10 flex items-center justify-center gap-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors",
                compact ? "w-9 sm:w-auto sm:px-3" : "px-3",
                value === o.value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <o.icon className="size-3.5" />
              {/* One name at every size ("Open" alone read like a verb next to Home's send button). */}
              <span className={cn(compact && "hidden sm:inline")}>{o.label}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {/* One span: the tooltip lays its children out in a row. */}
            <span>
              <span className="font-medium">{o.label}</span> · {account && "tips" in account ? account.tips[o.value] : o.tip}
            </span>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
