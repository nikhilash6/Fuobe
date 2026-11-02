"use client";

import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { IntentLink } from "@/components/intent-link";
import { PILL, PILL_ICON, PILL_TAP } from "@/components/home/pill";
import { useExplored } from "@/components/nav/explore-tracker";
import { GOAL_TAB, GOAL_TAB_ON } from "@/components/nav/goal-tab";
import { useViewerKind } from "@/components/nav/nav-ui";
import { useSearchPalette } from "@/components/nav/search-context";
import { useFadeEdges } from "@/components/use-fade-edges";
import { area, type AreaId } from "@/lib/nav-areas";
import { navIcon } from "@/lib/nav-icons";
import { entry, visibleTo, type NavEntry } from "@/lib/nav-model";
import { cn } from "@/lib/utils";

/*
 * The area pages' few live parts: the search that looks inside the area, the section tabs that follow the scroll,
 * "Jump back in" and the owner's own pills. Everything else on the page is server HTML.
 */

/** What an area's search field says. */
const SEARCH_WORDS: Partial<Record<AreaId, string>> = { create: "Search tools to make and edit…", studios: "Search studios…" };

/** Search inside the area: a button styled as a field, opening the site's search on this area's pages only. */
export function AreaSearch({ id, ids, className }: { id: AreaId; ids: string[]; className?: string }) {
  const search = useSearchPalette();
  const { label } = area(id);
  const words = SEARCH_WORDS[id] ?? `Search ${label.toLowerCase()}…`;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={() => search.open({ scope: { label, ids } })}
      onPointerEnter={() => search.warm()}
      onFocus={() => search.warm()}
      className={cn(
        "inline-flex h-11 shrink-0 items-center gap-2 rounded-[10px] border border-input bg-background/60 px-3 text-[14px] text-muted-foreground outline-none hover:border-border-strong hover:bg-background focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-colors sm:h-10 sm:text-[13.5px]",
        className,
      )}
    >
      <Search aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">{words}</span>
    </button>
  );
}

export interface AreaTab {
  /** The section it jumps to (#film). */
  href: string;
  label: string;
  icon: string;
  /** The section's id: the tab is marked while that section is the one being read. */
  section: string;
}

/**
 * The area's tabs in the goal row's strip, kept under the bar (the phone's or the desktop's) while its sections scroll
 * by: links, so they work before the page hydrates. The tab of the section being read is marked (aria-current), and
 * scrolled into view in the strip, which a phone scrolls sideways inside itself.
 */
export function AreaTabs({ tabs, label }: { tabs: AreaTab[]; label: string }) {
  const strip = useFadeEdges<HTMLDivElement>();
  const [on, setOn] = useState<string | null>(null);
  const key = tabs.map((t) => t.section).join(",");

  useEffect(() => {
    if (!key || typeof IntersectionObserver === "undefined") return;
    const shown = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) shown.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        // The first section (in page order) under the bar and the tabs: the one being read.
        const first = key.split(",").find((id) => (shown.get(id) ?? 0) > 0);
        setOn(first ?? null);
      },
      { rootMargin: "-120px 0px -45% 0px", threshold: [0, 0.01] },
    );
    for (const id of key.split(",")) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [key]);

  // The marked tab stays in sight in a strip that scrolls sideways (a phone's).
  useEffect(() => {
    const row = strip.current;
    const tab = on ? row?.querySelector<HTMLElement>(`[data-section="${on}"]`) : null;
    if (!row || !tab || row.scrollWidth <= row.clientWidth) return;
    const left = tab.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2;
    row.scrollTo({ left, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [on, strip]);

  return (
    <nav
      aria-label={label}
      // Under the phone's bar (48 px and the notch), or the desktop's (top-chrome). Its background and lower rule reach
      // the screen's edges (shadows clipped to its own height), so cards scrolling under it never show at its sides.
      className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 mt-5 flex h-[52px] items-stretch border-y bg-background shadow-[0_0_0_100vmax_var(--background),0_1px_0_100vmax_var(--border)] [clip-path:inset(0_-100vmax_-1px)] max-sm:-mx-4 md:top-chrome"
    >
      <div ref={strip} className="fade-x scrollbar-none relative flex min-w-0 flex-1 snap-x items-stretch gap-0.5 overflow-x-auto max-sm:px-1">
        {tabs.map((t) => {
          const Icon = navIcon(t.icon);
          const current = on !== null && t.section === on;
          return (
            <a key={t.href} href={t.href} data-section={t.section} aria-current={current ? "true" : undefined} className={cn(GOAL_TAB, current && GOAL_TAB_ON)}>
              <Icon aria-hidden className={cn("size-4 shrink-0 md:max-lg:hidden", current ? "text-brand-text" : "text-muted-foreground")} />
              {/* The label's bold copy keeps its width, so marking a tab never moves the ones beside it. */}
              <span className="grid">
                <span className={cn("col-start-1 row-start-1", current ? "font-semibold" : "font-medium")}>{t.label}</span>
                <span aria-hidden className="invisible col-start-1 row-start-1 font-semibold">
                  {t.label}
                </span>
              </span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}

const pillOf = (e: NavEntry, tap = true) => {
  const Icon = navIcon(e.icon);
  return (
    <li key={e.id}>
      <IntentLink href={e.href} className={cn(PILL, tap && PILL_TAP)}>
        <Icon className={PILL_ICON} />
        {e.label}
      </IntentLink>
    </li>
  );
};

/**
 * "Jump back in": the last four pages of this area this browser opened, newest first, for someone signed in. Nothing for
 * a guest, while hydrating, when storage is blocked, or before anything here was opened. It sits under the first
 * section, off screen at load, so nothing moves when it comes.
 */
export function JumpBackIn({ ids }: { ids: string[] }) {
  const kind = useViewerKind();
  const explored = useExplored();
  if (!kind || kind === "guest" || !explored) return null;
  const mine = new Set(ids);
  const recent = [...explored]
    .reverse()
    .filter((id) => mine.has(id))
    .map(entry)
    .filter((e): e is NavEntry => !!e && visibleTo(e, kind))
    .slice(0, 4);
  if (!recent.length) return null;
  return (
    <section aria-labelledby="jump-back-in" className="mt-8 sm:mt-10">
      <h2 id="jump-back-in" className="mb-2 font-sans text-[13px] font-medium">
        Jump back in
      </h2>
      <ul className="flex flex-wrap gap-1.5">{recent.map((e) => pillOf(e))}</ul>
    </section>
  );
}

/** The owner's own pills in a section's row (a mode only the owner sees), added once the viewer is known. */
export function OwnerPills({ ids }: { ids: string[] }) {
  const kind = useViewerKind();
  if (kind !== "owner") return null;
  return <>{ids.map(entry).filter((e): e is NavEntry => !!e && visibleTo(e, kind)).map((e) => pillOf(e))}</>;
}
