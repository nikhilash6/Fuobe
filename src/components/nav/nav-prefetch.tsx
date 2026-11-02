"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { queueIdlePrefetch } from "@/lib/idle-prefetch";
import { entriesFor, type ViewerKind } from "@/lib/nav-model";

/*
 * Loading a panel's routes ahead: when the launcher, Create, More or a phone sheet opens, the pages one tap in it leads
 * to start loading while the browser is idle, in the idle queue's "nav" lane (src/lib/idle-prefetch.ts), so the open
 * page's own tabs go first. Each link also prefetches on its own when hovered (IntentLink).
 */

/** A panel whose routes load when it opens: the launcher (and the Studios sheet), Create, More. */
export type NavPanel = "studios" | "create" | "more";

const MORE_IDS = ["apps", "motions", "effects", "canvas", "assist"];

/**
 * The routes one tap in a panel leads to (`panel`), or in all of them with the library's (no `panel`): on the site, once
 * each.
 */
export function prefetchHrefs(kind: ViewerKind | undefined, panel?: NavPanel): string[] {
  const hrefs = entriesFor(kind)
    .filter((e) =>
      panel === "studios"
        ? !!e.group
        : panel === "create"
          ? e.kind === "create"
          : panel === "more"
            ? MORE_IDS.includes(e.id)
            : !!e.group || e.kind === "create" || e.kind === "library",
    )
    .map((e) => e.href)
    .filter((h) => h.startsWith("/") && !h.includes("#"));
  return [...new Set(hrefs)];
}

/** A browser asking to save data, or on a slow connection: the panels' routes are not loaded ahead. */
function saveData(): boolean {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!conn && (!!conn.saveData || /(^|-)2g$|^3g$/.test(conn.effectiveType ?? ""));
}

const warmedHrefs = new Set<string>();
let prefetchOne: ((href: string) => void) | null = null;
let queued: string[] = [];
let cancels: (() => void)[] = [];

function flush() {
  if (!prefetchOne || !queued.length) return;
  const go = prefetchOne;
  const list = queued;
  queued = [];
  for (const href of list) cancels.push(queueIdlePrefetch("nav", href, () => go(href)));
}

/**
 * A panel opened (the launcher, Create, More, a phone sheet): the routes one tap in it leads to start loading once the
 * browser is idle, so that tap never waits a round trip. Only that panel's routes, each once per page load, and only
 * when it opens, not on every page load or every pointer that crosses the bar. A browser asking to save data or on a
 * slow connection skips it (the links still prefetch one by one on hover).
 */
export function warmNav(panel: NavPanel) {
  if (typeof navigator === "undefined" || saveData()) return;
  // The routes are the same for everyone (none of them is owner-only): no need to wait for the viewer.
  const fresh = prefetchHrefs(undefined, panel).filter((h) => !warmedHrefs.has(h));
  if (!fresh.length) return;
  for (const h of fresh) warmedHrefs.add(h);
  queued.push(...fresh);
  flush();
}

/** Mounted once per frame (the bar and the phone tabs both mount it; the last one wins): gives warmNav() the router. */
export function NavPrefetcher() {
  const router = useRouter();
  useEffect(() => {
    const own = (href: string) => router.prefetch(href);
    prefetchOne = own;
    flush();
    return () => {
      if (prefetchOne !== own) return;
      prefetchOne = null;
      for (const cancel of cancels) cancel();
      cancels = [];
    };
  }, [router]);
  return null;
}

