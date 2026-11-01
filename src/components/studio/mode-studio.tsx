"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { StudioCatalog } from "@/lib/studio-catalog";
import { cn } from "@/lib/utils";
import { StudioPage } from "./studio-page";
import type { StudioConfig } from "./studio-context";
import { useEdgeFade } from "./use-edge-fade";

export interface ModeTab {
  id: string;
  label: string;
  href: string;
}

/** A tab chosen with the keyboard: the next mode's tabs (each mode's page draws its own) take the focus back. */
let refocus = false;

/**
 * Underline tabs on their own row under the page title; they scroll sideways (with faded edges) on phones. Each mode is
 * its own history entry, so Back returns to the mode before.
 */
export function ModeTabs({ tabs, current }: { tabs: ModeTab[]; current: string }) {
  const [ref, fade] = useEdgeFade<HTMLDivElement>();
  const active = useRef<HTMLAnchorElement>(null);
  // Keep the selected tab in view when the row scrolls (only the row: the page stays put).
  useEffect(() => {
    const el = active.current;
    const row = ref.current;
    if (!el || !row) return;
    const left = el.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + el.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left - 12;
    if (refocus) {
      refocus = false;
      el.focus({ preventScroll: true });
    }
  }, [current, ref]);
  return (
    <nav aria-label="Modes" className="border-b">
      <div ref={ref} style={fade} className="scrollbar-none flex gap-1 overflow-x-auto px-3 sm:px-6">
        {tabs.map((m) => {
          const on = m.id === current;
          return (
            <Link
              key={m.id}
              ref={on ? active : undefined}
              href={m.href}
              scroll={false}
              // A keyboard's Enter is a click with no pointer (detail 0).
              onClick={(e) => (refocus = e.detail === 0)}
              aria-current={on ? "page" : undefined}
              className={cn(
                "relative flex h-10 shrink-0 items-center rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                "after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors focus-visible:after:bg-ring",
                on && "text-foreground after:bg-foreground",
              )}
            >
              {m.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** One mode of a hub (Audio, Video tools, Upscale): its studio with the hub's tabs. Each mode has its own path. */
export function ModeStudio({ tabs, current, config, catalog }: { tabs: ModeTab[]; current: string; config: StudioConfig; catalog: StudioCatalog }) {
  return <StudioPage config={config} catalog={catalog} tabs={<ModeTabs tabs={tabs} current={current} />} />;
}
