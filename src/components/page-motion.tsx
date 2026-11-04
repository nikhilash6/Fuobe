"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { fadeInOnLoad, MOTION, newPlace, reducedMotion, revealOnScroll, tabRowOf } from "@/lib/ui-motion";

/** What a loading placeholder looks like in the page (route skeletons say aria-busy; the Skeleton primitive has its slot). */
const SKELETON = '[aria-busy="true"], [data-slot="skeleton"], .animate-skeleton';
/** Content with motion of its own (a studio's result tiles, a request just sent): the skeleton hand-over leaves it alone. */
const OWN_MOTION = "[data-gen-id], [data-arrive], [data-enter], [data-own-motion]";
/**
 * What stays still while a page arrives: a bar the page pins (sticky or fixed, at any breakpoint, or a section-tab
 * band, sticky by its own CSS) and anything marked data-page-still. A translate on one of them, or on what holds one,
 * would carry a sticky bar or re-anchor a fixed one.
 */
const STILL = '[data-page-still], .tab-band, [class*="sticky"], [class~="fixed"], [class*=":fixed"]';
/** The longest a page keeps arriving: a page that streams in late just appears. */
const PAGE_IN_MAX = 3000;
/** A click on a tab this recently (ms) makes the page change it causes an in-place one. */
const TAB_WINDOW = 1500;

/** Back and Forward within this long of a popstate are the browser's own: they stay instant. */
const POP_WINDOW = 1000;

function isSkeleton(n: Node): boolean {
  return n instanceof Element && (n.matches(SKELETON) || n.querySelector(SKELETON) !== null);
}

function eachImage(n: Node, fn: (img: HTMLImageElement) => void) {
  if (n instanceof HTMLImageElement) fn(n);
  else if (n instanceof Element) n.querySelectorAll("img").forEach(fn);
}

/**
 * Marks the blocks of the page that arrive (data-page-item): the page's top blocks, except that every pinned bar
 * (STILL) stays as it is and every block holding one is split into its children, down to the bar. Class and attribute
 * reads only: no layout. Returns the blocks marked.
 */
function markPageItems(content: HTMLElement): HTMLElement[] {
  const holders = new Set<Element>();
  for (const still of content.querySelectorAll(STILL)) {
    for (let n = still.parentElement; n && n !== content && !holders.has(n); n = n.parentElement) holders.add(n);
  }
  const items: HTMLElement[] = [];
  const walk = (parent: Element) => {
    for (const c of parent.children) {
      if (!(c instanceof HTMLElement) || c.matches(STILL) || c.tagName === "SCRIPT" || c.tagName === "STYLE") continue;
      if (holders.has(c)) walk(c);
      else items.push(c);
    }
  };
  walk(content);
  for (const el of items) el.setAttribute("data-page-item", "");
  return items;
}

/**
 * The page's motion, mounted once in the app frame (StudioChrome). It moves nothing itself: it sets the attributes
 * motion.css animates, only after the first paint and never under reduced motion.
 * - A new place (another first path segment, by a link or code, not Back/Forward, not a tab in the page's own tab
 *   row): #content[data-page-in] for the length of the arrival, and data-page-item on the blocks that arrive (never a
 *   pinned bar), so the new page (and its content when it streams in after its skeleton) fades in and settles.
 * - Content that replaces its skeleton in the same commit: data-motion-reveal (a quick fade and 4 px rise), except
 *   content with motion of its own (a studio's results).
 * - Pictures added after the first paint fade in on load; while a page arrives, and on a fresh load, only those off
 *   screen (the first screen shows as it loads, under the page's own fade).
 * - Sections marked data-reveal below the screen: they reveal once, on scroll.
 */
type PageIn = { started: number; timer: number; items: HTMLElement[] };

/** Ends arrival p (if it is still the current one): the page is simply there. */
function endPageIn(content: HTMLElement, p: PageIn, current: { current: PageIn | null }) {
  if (current.current !== p) return;
  delete content.dataset.pageIn;
  for (const el of p.items) el.removeAttribute("data-page-item");
  current.current = null;
}

export function PageMotion() {
  const pathname = usePathname();
  const prev = useRef<string | null>(null);
  const popAt = useRef(-Infinity);
  const tabAt = useRef<{ path: string; at: number } | null>(null);
  const pageIn = useRef<PageIn | null>(null);
  // The reveals waiting on this page (each cancel shows its section).
  const reveals = useRef<(() => void)[]>([]);
  const revealRaf = useRef(0);
  /** Looks for new data-reveal sections after the next frame (the page has painted by then). */
  const scanReveals = useCallback(() => {
    cancelAnimationFrame(revealRaf.current);
    revealRaf.current = requestAnimationFrame(() => {
      const content = document.getElementById("content");
      if (content) reveals.current.push(revealOnScroll(content));
    });
  }, []);

  useEffect(() => {
    const onPop = () => (popAt.current = performance.now());
    // Capture: it runs before the router's own listener (which may stop the event); the Navigation API names a
    // traversal too, where there is one.
    const onNavigate = (e: Event) => (e as Event & { navigationType?: string }).navigationType === "traverse" && onPop();
    // A tab in the page's own tab row: the page it opens changes in place.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!a || !tabRowOf(a)) return;
      try {
        tabAt.current = { path: new URL(a.getAttribute("href") ?? "", location.href).pathname, at: performance.now() };
      } catch {
        tabAt.current = null;
      }
    };
    const nav = (window as Window & { navigation?: EventTarget }).navigation;
    window.addEventListener("popstate", onPop, true);
    document.addEventListener("click", onClick, true);
    nav?.addEventListener("navigate", onNavigate);
    return () => {
      window.removeEventListener("popstate", onPop, true);
      document.removeEventListener("click", onClick, true);
      nav?.removeEventListener("navigate", onNavigate);
    };
  }, []);

  // Before the new page's first paint: mark it as arriving.
  useLayoutEffect(() => {
    const from = prev.current;
    prev.current = pathname;
    const tab = tabAt.current;
    tabAt.current = null;
    const fromTabRow = !!tab && tab.path === pathname && performance.now() - tab.at < TAB_WINDOW;
    if (!newPlace(from, pathname, { fromTabRow }) || performance.now() - popAt.current < POP_WINDOW || reducedMotion()) return;
    const content = document.getElementById("content");
    if (!content) return;
    if (pageIn.current) {
      window.clearTimeout(pageIn.current.timer);
      for (const el of pageIn.current.items) el.removeAttribute("data-page-item");
    }
    const items = markPageItems(content);
    content.dataset.pageIn = "";
    const p: PageIn = { started: performance.now(), timer: 0, items };
    p.timer = window.setTimeout(() => endPageIn(content, p, pageIn), MOTION.page + 120);
    pageIn.current = p;
  }, [pathname]);

  // Skeleton → content, late pictures, and a page that streams in while it arrives.
  useEffect(() => {
    const content = document.getElementById("content");
    if (!content || reducedMotion() || typeof MutationObserver === "undefined") return;
    // The first screen's own pictures load as they always did; the lazy ones off screen fade in when they arrive.
    content.querySelectorAll<HTMLImageElement>('img[loading="lazy"]').forEach((img) => fadeInOnLoad(img, { offScreenOnly: true }));
    const mo = new MutationObserver((records) => {
      const p = pageIn.current;
      const swapped = new Set<Node>();
      let added = false;
      for (const r of records) {
        for (const n of r.removedNodes) if (isSkeleton(n)) swapped.add(r.target);
        if (r.addedNodes.length) added = true;
      }
      if (!added) return;
      if (p) {
        // Still arriving: a new block of the page (content streaming in after its skeleton) arrives too, and the
        // arrival lasts a little longer. Changes inside a block already arriving (a number, a picture) don't extend it.
        const fresh = markPageItems(content).filter((el) => !p.items.includes(el));
        if (fresh.length) {
          p.items.push(...fresh);
          window.clearTimeout(p.timer);
          const left = Math.max(0, PAGE_IN_MAX - (performance.now() - p.started));
          p.timer = window.setTimeout(() => endPageIn(content, p, pageIn), Math.min(left, MOTION.page + 120));
        }
      }
      for (const r of records) {
        for (const n of r.addedNodes) {
          eachImage(n, (img) => fadeInOnLoad(img, { offScreenOnly: !!p }));
          if (n instanceof Element && (n.matches("[data-reveal]") || n.querySelector("[data-reveal]"))) scanReveals();
          if (p || !swapped.has(r.target) || !(n instanceof HTMLElement) || isSkeleton(n)) continue;
          if (n.closest(OWN_MOTION) || n.querySelector(OWN_MOTION)) continue;
          n.dataset.motionReveal = "";
          const done = (e: AnimationEvent) => {
            if (e.target !== n) return;
            n.removeEventListener("animationend", done);
            delete n.dataset.motionReveal;
          };
          n.addEventListener("animationend", done);
        }
      }
    });
    mo.observe(content, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [scanReveals]);

  // Sections below the screen reveal as they come on screen (once per page view; a print shows them all).
  useEffect(() => {
    const showAll = () => {
      cancelAnimationFrame(revealRaf.current);
      for (const c of reveals.current.splice(0)) c();
    };
    scanReveals();
    window.addEventListener("beforeprint", showAll);
    return () => {
      window.removeEventListener("beforeprint", showAll);
      showAll();
    };
  }, [pathname, scanReveals]);

  return null;
}
