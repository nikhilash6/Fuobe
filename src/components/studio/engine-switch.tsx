"use client";

import { Cloud, Cpu, Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { KEY_ADDED_EVENT, openAddKey } from "@/components/keys/your-keys";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Engine } from "@/lib/catalog/types";
import { useEngineMode, useHydrated, useStatus, useViewer } from "@/lib/api";
import { CLOUD_KEYLESS_TIP, CLOUD_PANEL_STAY_EVENT, engineCaption, engineHintKey, engineHintText, openCloudPanel, visitorEngine, visitorEngineLabel, visitorPick, type VisitorEngine } from "@/lib/engine-ux";
import { placeOf, type Place } from "@/lib/place-name";
import { accountEngine } from "@/lib/your-keys";
import { cn } from "@/lib/utils";
import { radioKeys, radioTab } from "./radio-keys";

const OPTIONS: { value: Engine; label: string; icon: typeof Cloud; tip: string }[] = [
  { value: "cloud", label: "Cloud", icon: Cloud, tip: "Frontier paid models via your fal.ai / Replicate key" },
  { value: "open", label: "Open source", icon: Cpu, tip: "Open-weight models running on your ComfyUI server" },
];

/**
 * A side's tooltip words: an account's own (who pays, where it runs), else the side's own; with hosted runs on (`place`:
 * their place name), open models run free there.
 */
export function engineTip(value: Engine, account: ReturnType<typeof accountEngine>, place: Place | null): string {
  if (account && "tips" in account) return account.tips[value];
  if (value === "open" && place) return `Open models, free on ${place.text}`;
  return OPTIONS.find((o) => o.value === value)!.tip;
}

/**
 * Segmented control with a sliding white thumb (Liner-style). `md` (page headers) turns
 * icon-only below the sm breakpoint so titles keep their line on phones (`compact` does the same
 * for `sm`, e.g. in Assist's one-row footer); the tooltips and aria labels still name each engine.
 * `wordless`: no "Add key" on a phone either, in a header that has no room for it (the lock and the label still say it).
 * `selfHostedOnly`: a tool that runs on a self-hosted Fuobe only (its page says so to a guest or an account), where
 * anyone but the owner gets a plain badge: no way to Your GPU or a key, which wouldn't run it.
 * A guest or an account while open models run free on this install's GPUs gets both sides, always (VisitorSwitch);
 * `hint`: a studio's own switch, where an account without a key reads a one-time hint about Cloud.
 */
export function EngineSwitch({
  value,
  onChange,
  size = "md",
  compact = size === "md",
  wordless,
  selfHostedOnly,
  hint,
}: {
  value: Engine;
  onChange: (e: Engine) => void;
  size?: "sm" | "md";
  compact?: boolean;
  wordless?: boolean;
  selfHostedOnly?: boolean;
  hint?: boolean;
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
  // Hosted runs: open models run free on this studio's GPUs, said with their place name (a guest's tip too).
  const place = hydrated && status?.viewer?.hosted ? placeOf(status.viewer.placeName) : null;
  // A guest or an account while hosted runs are on: both sides, always, with what each costs (the owner and a
  // self-hosted install keep the switch below exactly as it was).
  const visitor = hydrated && !owner && !selfHostedOnly ? visitorEngine(status) : null;
  if (visitor)
    return (
      <VisitorSwitch
        value={value}
        onChange={onChange}
        size={size}
        compact={compact}
        wordless={wordless}
        visitor={visitor}
        mode={mode}
        account={account}
        hintFor={hint && !visitor.guest && visitor.keyless ? viewer?.account?.email : undefined}
      />
    );
  const idx = OPTIONS.findIndex((o) => o.value === value);
  if (mode !== "both" || locked) {
    // One engine and nothing to change: only the owner (Settings) or an account that can add a key gets a badge.
    if (!hydrated || !viewer || (!owner && !(locked?.addKey && !selfHostedOnly))) return null;
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
        {compact && !wordless && !selfHostedOnly && locked?.addKey && <span className="sm:hidden">Add key</span>}
      </>
    );
    // An account opens "Add your key" right here (a plain click; Settings → Your keys in a new tab), or Your GPU when
    // the studio runs open-source models only: the way to paid models is its own key.
    if (locked && !selfHostedOnly) {
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
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link href="/settings" aria-label={`${text} — change in Settings`} className={cn(cls, "hover:text-foreground")}>
            {body}
            <Lock className="size-3 opacity-60" />
          </Link>
        </TooltipTrigger>
        <TooltipContent>{text} · locked in Settings → Engine mode</TooltipContent>
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
              <span className="font-medium">{o.label}</span> · {engineTip(o.value, account, place)}
            </span>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

/** A visitor's sides: Open source first (free there), then Cloud (its own key). */
const VISITOR_ORDER: Engine[] = ["open", "cloud"];

/**
 * A guest's or an account's switch while hosted runs are on: "Open source" with "Free · {place}" under it, and "Cloud"
 * with "Your key" (and a lock while it has none). Without a key, Cloud opens the Cloud panel and the switch stays on
 * Open source (a run there would fail); once a key is saved from that panel, the switch moves to Cloud by itself.
 */
function VisitorSwitch({
  value,
  onChange,
  size,
  compact,
  wordless,
  visitor,
  mode,
  account,
  hintFor,
}: {
  value: Engine;
  onChange: (e: Engine) => void;
  size: "sm" | "md";
  compact: boolean;
  wordless?: boolean;
  visitor: VisitorEngine;
  mode: string;
  account: ReturnType<typeof accountEngine>;
  hintFor?: string;
}) {
  const { keyless, place } = visitor;
  // The panel was opened from this switch: a key saved there (for no model in particular) moves it to Cloud.
  const asked = useRef(false);
  const moveToCloud = useRef(false);
  useEffect(() => {
    const added = (e: Event) => {
      if (asked.current && !(e as CustomEvent<{ modelId?: string }>).detail?.modelId) moveToCloud.current = true;
      asked.current = false;
    };
    const stayed = () => (asked.current = false);
    window.addEventListener(KEY_ADDED_EVENT, added);
    window.addEventListener(CLOUD_PANEL_STAY_EVENT, stayed);
    return () => {
      window.removeEventListener(KEY_ADDED_EVENT, added);
      window.removeEventListener(CLOUD_PANEL_STAY_EVENT, stayed);
    };
  }, []);
  // (The status answers with the key, the engine mode turns "both", and the switch can move.)
  useEffect(() => {
    if (!moveToCloud.current || mode !== "both") return;
    moveToCloud.current = false;
    onChange("cloud");
  }, [mode, onChange]);
  const showCloud = () => {
    asked.current = true;
    openCloudPanel();
  };
  const shown: Engine = keyless ? "open" : value;
  const idx = VISITOR_ORDER.indexOf(shown);
  // A phone keeps a short caption under each icon, unless the header has no room for words at all.
  const phoneWords = compact && !wordless;
  const control = (
    <div
      role="radiogroup"
      aria-label="Engine"
      data-engine-switch="visitor"
      onKeyDown={radioKeys}
      className={cn("relative inline-grid shrink-0 grid-cols-2 rounded-full bg-muted p-0.5", size === "sm" ? "h-9" : "h-9 sm:h-10")}
    >
      <span
        aria-hidden
        className="absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-background shadow-soft transition-transform duration-300 ease-move"
        style={{ transform: `translateX(${idx * 100}%)` }}
      />
      {VISITOR_ORDER.map((side) => {
        const o = OPTIONS.find((x) => x.value === side)!;
        const on = shown === side;
        const caption = side === "open" ? engineCaption.open(place) : engineCaption.cloud;
        const short = side === "open" ? "Free" : "Key";
        return (
          <Tooltip key={side}>
            <TooltipTrigger asChild>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={radioTab(on)}
                aria-label={visitorEngineLabel(side, visitor)}
                onClick={() => {
                  const to = visitorPick(side, visitor);
                  if (to === "panel") showCloud();
                  else onChange(to);
                }}
                className={cn(
                  "relative z-10 flex min-w-0 flex-col justify-center gap-[3px] rounded-full leading-none transition-colors",
                  compact ? "items-center px-2.5 sm:items-start sm:px-4" : "items-start px-4",
                  on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="flex items-center gap-1.5 text-[13px] font-medium whitespace-nowrap">
                  <o.icon className="size-3.5" />
                  <span className={cn(compact && "hidden sm:inline")}>{o.label}</span>
                </span>
                <span
                  className={cn(
                    "flex max-w-[9.5rem] items-center gap-1 text-[10.5px] font-medium whitespace-nowrap",
                    side === "open" ? "text-success" : "text-muted-foreground",
                    compact && !phoneWords && "max-sm:hidden",
                  )}
                >
                  {side === "cloud" && keyless && <Lock className="size-2.5 shrink-0" aria-hidden />}
                  {phoneWords && <span className="sm:hidden">{short}</span>}
                  <span className={cn("truncate", phoneWords && "max-sm:hidden")}>{caption}</span>
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              <span>
                <span className="font-medium">{o.label}</span> · {side === "cloud" && keyless ? CLOUD_KEYLESS_TIP : engineTip(side, account, place)}
              </span>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
  return hintFor ? (
    <EngineHint email={hintFor} place={place} onSee={showCloud}>
      {control}
    </EngineHint>
  ) : (
    control
  );
}

/**
 * The one-time hint by a studio's switch, for an account without a key: open models are free there, and Cloud is one
 * key away. Closed for good (in this browser, for this account) by either button, Esc, or a tap outside.
 */
function EngineHint({ email, place, onSee, children }: { email: string; place: Place; onSee: () => void; children: React.ReactNode }) {
  const key = engineHintKey(email);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let seen = true;
    try {
      seen = localStorage.getItem(key) === "1";
    } catch {}
    // A moment after the page settles, so it points at the switch where it ends up.
    const t = seen ? undefined : setTimeout(() => setOpen(true), 600);
    return () => clearTimeout(t);
  }, [key]);
  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(key, "1");
    } catch {}
  };
  const words = engineHintText(place);
  return (
    <Popover open={open} onOpenChange={(o) => !o && close()}>
      <PopoverAnchor asChild>
        <span className="inline-flex shrink-0" onClickCapture={() => open && close()}>
          {children}
        </span>
      </PopoverAnchor>
      <PopoverContent
        role="note"
        data-engine-hint=""
        side="bottom"
        align="end"
        sideOffset={10}
        collisionPadding={12}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-[min(18rem,calc(100vw-24px))] gap-3 rounded-xl p-3.5 shadow-strong"
      >
        <PopoverPrimitive.Arrow width={14} height={7} className="fill-popover" />
        <p className="text-[13px] leading-snug">
          <span className="font-medium">{words.lead}</span> <span className="text-muted-foreground">{words.rest}</span>
        </p>
        <div className="flex justify-end gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            onClick={() => {
              close();
              onSee();
            }}
          >
            {words.see}
          </Button>
          <Button size="sm" className="rounded-full" onClick={close}>
            {words.ok}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
