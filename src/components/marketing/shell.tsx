"use client";

import { Clapperboard, Copy, LayoutTemplate, MousePointerClick, Target } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { EngineSwitch } from "@/components/studio/engine-switch";
import { useEngine } from "@/lib/api";
import type { Engine } from "@/lib/catalog/types";
import { useIdlePrefetch } from "@/lib/idle-prefetch";
import { cn } from "@/lib/utils";
import { isPlainClick, useTappedTab } from "@/lib/use-tapped-tab";

export type SuiteTab = "studio" | "click" | "ads" | "multiplier";

const TABS: { id: SuiteTab; href: string; label: string; icon: typeof Target }[] = [
  { id: "studio", href: "/marketing", label: "Marketing Studio", icon: LayoutTemplate },
  { id: "click", href: "/marketing/click-to-ad", label: "Click to Ad", icon: MousePointerClick },
  { id: "ads", href: "/ads", label: "Ads Studio", icon: Target },
  { id: "multiplier", href: "/ads/multiplier", label: "Ad Multiplier", icon: Copy },
];

/**
 * The marketing suite's sticky header: title, the four tools as tabs, and the engine switch. selfHostedOnly: a tool that
 * runs on a self-hosted Fuobe only (Marketing Studio, Click to Ad), see EngineSwitch.
 */
export function MarketingHeader({
  title,
  active,
  engine,
  onEngine,
  right,
  selfHostedOnly,
}: {
  title: string;
  active: SuiteTab;
  engine?: Engine;
  onEngine?: (e: Engine) => void;
  right?: React.ReactNode;
  selfHostedOnly?: boolean;
}) {
  const nav = useRef<HTMLElement>(null);
  // Each tool's page draws this header: the tab tapped here is the current one from the next frame on, until the new page
  // (with its own header) replaces this one.
  const [tapped, tap] = useTappedTab<SuiteTab>(active);
  const current = tapped ?? active;
  // The other tools are the likeliest next tap: their pages go ahead of the sidebar's routes (the "page" lane), so a busy
  // prefetch queue never leaves a tab waiting on the server.
  useIdlePrefetch(
    TABS.filter((t) => t.id !== active).map((t) => t.href),
    "page",
  );
  // On a phone the tabs scroll sideways: bring the current one into view.
  useEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const box = nav.current;
    if (!el || !box) return;
    if (el.offsetLeft + el.offsetWidth > box.scrollLeft + box.clientWidth || el.offsetLeft < box.scrollLeft) box.scrollLeft = el.offsetLeft - 12;
  }, [active]);
  return (
    <header className="sticky top-0 z-30 border-b border-transparent bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="flex h-14 min-w-0 items-center gap-2 px-3 sm:px-6">
        <SidebarTrigger className="md:hidden" />
        <h1 className="min-w-0 truncate font-heading text-[22px] leading-none">{title}</h1>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {right}
          {engine && onEngine && <EngineSwitch value={engine} onChange={onEngine} selfHostedOnly={selfHostedOnly} />}
        </div>
      </div>
      <nav ref={nav} aria-label="Marketing tools" className="scrollbar-none -mb-px flex gap-1 overflow-x-auto px-3 sm:px-6">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            aria-current={t.id === current ? "page" : undefined}
            onClick={(e) => isPlainClick(e) && tap(t.id)}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2.5 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
              t.id === current && "border-primary text-foreground",
            )}
          >
            <t.icon className="size-3.5" />
            {t.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

/** The engine for marketing views (shared with every studio: the same switch, the same Settings lock). */
export function useMarketingEngine() {
  const [engine, setEngine, mode] = useEngine();
  return { engine: mode === "both" ? engine : (mode as Engine), setEngine, mode };
}

export const EmptyIcon = ({ icon: Icon = Clapperboard }: { icon?: typeof Clapperboard }) => (
  <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-brand-faint text-brand-text">
    <Icon className="size-6" />
  </div>
);
