"use client";

import { Clapperboard, Copy, LayoutTemplate, MousePointerClick, Target } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { PhoneNavButton } from "@/components/nav/phone-nav-button";
import { EngineSwitch } from "@/components/studio/engine-switch";
import { useEngine } from "@/lib/api";
import type { Engine } from "@/lib/catalog/types";
import { useIdlePrefetch } from "@/lib/idle-prefetch";
import { onAttr, TAB_PILL, TabRow } from "@/components/ui/tab-row";
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
  // The other tools are the likeliest next tap: their pages go ahead of the navigation's routes (the "page" lane), so a busy
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
    <header className="max-md:sticky top-chrome z-30 border-b border-transparent bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="flex h-14 min-w-0 items-center gap-2 px-4 sm:px-6">
        <h1 className="min-w-0 truncate font-heading text-[22px] leading-none">{title}</h1>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {right}
          {engine && onEngine && <EngineSwitch value={engine} onChange={onEngine} selfHostedOnly={selfHostedOnly} />}
        </div>
        <PhoneNavButton />
      </div>
      <TabRow ref={nav} as="nav" memory="marketing-suite" aria-label="Marketing tools" className="m-0 px-4 pt-0.5 pb-1.5 sm:px-6">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            aria-current={t.id === current ? "page" : undefined}
            onClick={(e) => isPlainClick(e) && tap(t.id)}
            className={TAB_PILL}
            {...onAttr(t.id === current)}
          >
            <t.icon />
            {t.label}
          </Link>
        ))}
      </TabRow>
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
