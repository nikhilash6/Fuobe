"use client";

import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { IntentLink } from "@/components/intent-link";
import { PILL, PILL_ICON, PILL_TAP } from "@/components/home/pill";
import { useExplored } from "@/components/nav/explore-tracker";
import { useViewerKind } from "@/components/nav/nav-ui";
import { useSearchPalette } from "@/components/nav/search-context";
import { onAttr, reducedMotion, TAB_PILL, TabRow } from "@/components/ui/tab-row";
import { glideTo } from "@/lib/glide-scroll";
import { area, type AreaId } from "@/lib/nav-areas";
import { navIcon } from "@/lib/nav-icons";
import { entry, subLabel, visibleTo, type NavEntry } from "@/lib/nav-model";
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

/** The parts of a section that come in one after the other: its heading, then each card, then its pills. */
function revealParts(section: HTMLElement): Element[] {
  const s = section.querySelector("section") ?? section;
  const parts: Element[] = [];
  for (const c of s.children) {
    if (c.classList.contains("grid")) parts.push(...c.children);
    else parts.push(c);
  }
  return parts;
}

/** A section's gentle arrival: opacity and a 10 px rise, staggered. It only ever plays from hidden to shown. */
function reveal(section: HTMLElement) {
  if (reducedMotion()) return;
  revealParts(section).forEach((p, i) => {
    if (typeof p.animate !== "function") return;
    p.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], {
      duration: 480,
      delay: Math.min(i, 8) * 45,
      easing: "cubic-bezier(0.25, 0.8, 0.25, 1)",
      fill: "backwards",
    });
  });
}

/**
 * The area's section tabs, kept under the bar (the phone's or the desktop's) in a band of the page's background while
 * its sections scroll by: links, so they work before the page hydrates. The tab of the section being read is selected
 * (aria-current), and the fill slides to it as the page scrolls; a phone's row scrolls sideways inside itself and keeps
 * it in sight. A tap glides the page to its section (an instant jump with reduced motion), and that tab is selected from
 * the tap on, not stepping through the sections passed on the way. Each section comes in gently the first time it
 * reaches the screen (never the ones already there at load).
 */
export function AreaTabs({ tabs, label }: { tabs: AreaTab[]; label: string }) {
  const band = useRef<HTMLElement>(null);
  const [on, setOn] = useState<string | null>(null);
  const key = tabs.map((t) => t.section).join(",");
  // The section a tap is gliding to: the scroll-spy waits until it lands. Then `landed` keeps that tab selected until the
  // page moves again (a last section too short to reach the top still is the one asked for).
  const going = useRef<string | null>(null);
  const landed = useRef<{ id: string; y: number } | null>(null);
  const shown = useRef(new Map<string, number>());
  const spy = useCallback(() => {
    if (going.current) return;
    if (landed.current && Math.abs(window.scrollY - landed.current.y) < 2) return;
    landed.current = null;
    const ids = key.split(",");
    // At the very end of the page, the last section on screen: it may never reach the top.
    const end = window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
    const last = end ? ids.findLast((id) => (document.getElementById(id)?.getBoundingClientRect().top ?? Infinity) < window.innerHeight * 0.6) : undefined;
    // Otherwise the first section (in page order) under the bar and the tabs: the one being read.
    const first = last ?? ids.find((id) => (shown.current.get(id) ?? 0) > 0);
    if (first) return setOn(first);
    // None under the bar: above the first section (a page that opens with a wall), the first tab is the way in; between
    // sections or past the last, the tab stays as it was.
    const head = document.getElementById(ids[0]);
    if (head && head.getBoundingClientRect().top > 120) setOn(ids[0]);
  }, [key]);

  // The end of the page changes no section's place under the bar, so the scroll itself is watched too.
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          spy();
        });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, [spy]);

  useEffect(() => {
    if (!key || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) shown.current.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        spy();
      },
      { rootMargin: "-120px 0px -45% 0px", threshold: [0, 0.01] },
    );
    // Arrivals: a section nearing the screen (just before it shows, so it starts hidden) for the first time.
    const seen = new Set<Element>();
    let initial = true;
    const arrive = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting || seen.has(e.target)) continue;
          seen.add(e.target);
          arrive.unobserve(e.target);
          if (!initial) reveal(e.target as HTMLElement);
        }
        initial = false;
      },
      { rootMargin: "0px 0px 120px 0px" },
    );
    for (const id of key.split(",")) {
      const el = document.getElementById(id);
      if (!el) continue;
      io.observe(el);
      arrive.observe(el);
    }
    return () => {
      io.disconnect();
      arrive.disconnect();
    };
  }, [key, spy]);

  // Stuck under the bar: the hairline under the band.
  useEffect(() => {
    const el = band.current;
    if (!el) return;
    let raf = 0;
    const check = () => {
      raf = 0;
      const top = parseFloat(getComputedStyle(el).top) || 0;
      el.toggleAttribute("data-stuck", window.scrollY > 0 && el.getBoundingClientRect().top <= top + 0.5);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const go = (e: React.MouseEvent<HTMLAnchorElement>, t: AreaTab) => {
    // A new tab or window (a modifier, the middle button) leaves this page as it is.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const target = document.getElementById(t.section);
    if (!target) return;
    e.preventDefault();
    going.current = t.section;
    setOn(t.section);
    if (location.hash !== t.href) history.pushState(history.state, "", t.href);
    landed.current = null;
    void glideTo(target).then((done) => {
      if (going.current !== t.section) return;
      going.current = null;
      if (done) landed.current = { id: t.section, y: window.scrollY };
      // Landed (or the visitor took over): the scroll-spy says again, after the last scroll has been seen.
      requestAnimationFrame(spy);
    });
  };

  return (
    <nav ref={band} aria-label={label} className="tab-band mt-5">
      <TabRow follow>
        {tabs.map((t) => {
          const Icon = navIcon(t.icon);
          const current = on !== null && t.section === on;
          return (
            <a key={t.href} href={t.href} data-section={t.section} aria-current={current ? "true" : undefined} onClick={(e) => go(e, t)} className={TAB_PILL} {...onAttr(current)}>
              <Icon aria-hidden />
              {t.label}
            </a>
          );
        })}
      </TabRow>
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

/** A studio's feature as a pill in its row on /studios: its tab's name, no icon (the row names the studio). */
const subPillOf = (e: NavEntry) => (
  <li key={e.id}>
    <IntentLink href={e.href} className={cn(PILL, PILL_TAP)}>
      {subLabel(e)}
    </IntentLink>
  </li>
);

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

/** The owner's own pills in a section's row (a mode only the owner sees), added once the viewer is known. `sub`: a studio's feature row. */
export function OwnerPills({ ids, sub }: { ids: string[]; sub?: boolean }) {
  const kind = useViewerKind();
  if (kind !== "owner") return null;
  const list = ids.map(entry).filter((e): e is NavEntry => !!e && visibleTo(e, kind));
  return <>{list.map((e) => (sub ? subPillOf(e) : pillOf(e)))}</>;
}

/** A studio's feature row on /studios that only the owner has (Cinema Studio's Blockout), added once the viewer is known. */
export function OwnerSubRow({ parent, ids }: { parent: string; ids: string[] }) {
  const kind = useViewerKind();
  const p = entry(parent);
  if (kind !== "owner" || !p) return null;
  const list = ids.map(entry).filter((e): e is NavEntry => !!e && visibleTo(e, kind));
  if (!list.length) return null;
  return (
    <li className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4">
      <p className="shrink-0 pt-1.5 text-[13px] leading-5 font-medium sm:w-40">{p.label}</p>
      <ul aria-label={`In ${p.label}`} className="flex flex-wrap gap-x-1.5 gap-y-3">
        {list.map(subPillOf)}
      </ul>
    </li>
  );
}
