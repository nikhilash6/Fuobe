"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { PrefetchOptions } from "next/dist/shared/lib/app-router-context.shared-runtime";

/** Runs `fn` once the browser is idle after the page has loaded (soon after, where requestIdleCallback is missing). Returns a cancel. */
export function whenIdle(fn: () => void): () => void {
  let idle = 0;
  let timer = 0;
  const schedule = () => {
    if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(fn, { timeout: 2000 });
    else timer = window.setTimeout(fn, 300);
  };
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });
  return () => {
    window.removeEventListener("load", schedule);
    if (idle) window.cancelIdleCallback(idle);
    if (timer) window.clearTimeout(timer);
  };
}

/**
 * Who asked for an idle prefetch: `nav` = the app's own navigation (the sidebar's rows), `page` = the page's own tabs (a
 * hub's modes), the likeliest next tap, which go first.
 */
export type PrefetchLane = "nav" | "page";

interface Job {
  href: string;
  run: () => void;
}

const lanes: Record<PrefetchLane, Set<Job>> = { nav: new Set(), page: new Set() };
let flushing = false;

/**
 * Calls `done` once the server has answered a prefetch for each of `hrefs` and the prefetch traffic has then been quiet
 * for `quiet` ms (Resource Timing; the requests that came before this call count too), at the latest after `max` ms.
 */
export function afterPrefetched(hrefs: string[], done: () => void, quiet = 500, max = 8000): void {
  const want = new Set(hrefs.map((h) => new URL(h, window.location.href).pathname));
  let last = performance.now();
  let over = false;
  let timer = 0;
  let cap = 0;
  let observer: PerformanceObserver | null = null;
  const finish = () => {
    if (over) return;
    over = true;
    observer?.disconnect();
    window.clearTimeout(timer);
    window.clearTimeout(cap);
    done();
  };
  const check = () => {
    window.clearTimeout(timer);
    const still = quiet - (performance.now() - last);
    if (!want.size && still <= 0) finish();
    else timer = window.setTimeout(check, Math.max(50, still));
  };
  cap = window.setTimeout(finish, max);
  try {
    observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceResourceTiming[]) {
        if (!e.name.includes("_rsc=")) continue;
        want.delete(new URL(e.name).pathname);
        last = Math.max(last, e.responseEnd);
      }
      check();
    });
    observer.observe({ type: "resource", buffered: true });
  } catch {
    // No Resource Timing: the cap decides.
  }
  check();
}

function flush() {
  flushing = false;
  const page = [...lanes.page];
  const nav = [...lanes.nav];
  lanes.page.clear();
  lanes.nav.clear();
  for (const job of page) job.run();
  // Next serves a prefetch's route tree and shell (the sidebar's forty-odd routes) before any route's URL-specific part (a
  // hub mode's own page, a tab's page), so the sidebar's rows go out only once the page's own tabs are in and the page's
  // own prefetches (its links on screen) have gone quiet.
  if (nav.length) afterPrefetched(page.map((job) => job.href), () => nav.forEach((job) => job.run()));
}

/** Queues one prefetch of `href` (`run`) for the next idle moment, in its lane. Returns a cancel. */
export function queueIdlePrefetch(lane: PrefetchLane, href: string, run: () => void): () => void {
  const job = { href, run };
  lanes[lane].add(job);
  if (!flushing) {
    flushing = true;
    whenIdle(flush);
  }
  return () => lanes[lane].delete(job);
}

/**
 * router.prefetch's options. `full`: what <Link prefetch={true}> asks for, the whole page with its URL data (a prerendered
 * page comes from the static cache), rather than only the route's shared shell.
 */
export function prefetchOptions(full: boolean, onInvalidate?: () => void): PrefetchOptions {
  return { kind: full ? "full" : "auto", onInvalidate } as unknown as PrefetchOptions;
}

/**
 * Prefetches `hrefs` once the page has loaded and the browser is idle, also links that are off screen (scrolled out of a
 * phone's tab row, below the sidebar's fold), and again whenever Next says the prefetched copy went stale. A tap then
 * renders from the client cache instead of waiting a round trip.
 */
export function useIdlePrefetch(hrefs: readonly string[] | null, lane: PrefetchLane, full = false): void {
  const router = useRouter();
  const key = hrefs?.join("\n") ?? "";
  useEffect(() => {
    if (!key) return;
    let live = true;
    const cancels: (() => void)[] = [];
    for (const href of key.split("\n")) {
      const run = () => {
        if (live) router.prefetch(href, prefetchOptions(full, () => live && cancels.push(queueIdlePrefetch(lane, href, run))));
      };
      cancels.push(queueIdlePrefetch(lane, href, run));
    }
    return () => {
      live = false;
      for (const cancel of cancels) cancel();
    };
  }, [key, lane, full, router]);
}
