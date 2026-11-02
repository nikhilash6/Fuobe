"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { activeEntry, type NavEntry } from "@/lib/nav-model";
import { EXPLORE_KEY, parseExplored, withExplored } from "@/lib/nav-explore";

/** The kinds a visit counts for: a studio, a create tool, a preset hub (Apps, Camera motions, Effects). */
const EXPLORABLE: ReadonlySet<NavEntry["kind"]> = new Set<NavEntry["kind"]>(["studio", "create", "presets"]);

/**
 * The entry a page counts as explored: its studio, create tool or preset hub (a hub's modes and a studio's own pages
 * count as the studio: /audio/clean is Audio). Undefined for Home, the Library, Settings and other pages.
 */
export function exploredEntry(pathname: string, search: URLSearchParams): NavEntry | undefined {
  const e = activeEntry(pathname, search);
  return e && EXPLORABLE.has(e.kind) ? e : undefined;
}

// ---------------------------------------------------------------------------
// What this browser has explored: localStorage only (no server, no cookie), every access guarded.

const listeners = new Set<() => void>();
/** The last list read, kept while the stored text is the same, so a snapshot is the same array between renders. */
let cached: { raw: string | null; list: string[] } = { raw: null, list: [] };

/**
 * The entry ids this browser has explored (oldest first), or null when storage can't be read (a private window,
 * blocked site data): then nothing about exploring is shown, rather than a count that never moves.
 */
export function readExplored(): string[] | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(EXPLORE_KEY);
  } catch {
    return null;
  }
  if (raw !== cached.raw) cached = { raw, list: parseExplored(raw) };
  return cached.list;
}

/** Notes an entry as explored. Quietly does nothing when storage is blocked or full. */
export function markExplored(id: string): void {
  const list = readExplored();
  if (!list) return;
  const next = withExplored([...list], id);
  if (next.length === list.length && next.every((x, i) => x === list[i])) return;
  try {
    window.localStorage.setItem(EXPLORE_KEY, JSON.stringify(next));
  } catch {
    return;
  }
  for (const l of listeners) l();
}

/** Calls `onChange` when the explored list changes here or in another tab; returns the unsubscribe. */
export function subscribeExplored(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab explored something (or site data was cleared: key null).
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === EXPLORE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The explored ids, kept in step across tabs; null on the server, while hydrating, and when storage is blocked. */
export function useExplored(): string[] | null {
  return useSyncExternalStore(subscribeExplored, readExplored, () => null);
}

/**
 * Marks each studio, create tool or preset hub explored as it is opened (rendered once by the chrome, inside
 * Suspense: it reads the URL). Renders nothing.
 */
export function ExploreTracker() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    const e = exploredEntry(pathname, new URLSearchParams(search));
    if (e) markExplored(e.id);
  }, [pathname, search]);
  return null;
}
