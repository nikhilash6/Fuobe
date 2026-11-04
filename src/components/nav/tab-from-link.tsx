"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useLayoutEffect } from "react";

/*
 * A studio tab that a link can open: the bar's menus, the phone's Studios sheet and search link a studio's tabs by a
 * query (/character-sheet?mode=cast, /photodump?tab=instadump). The tab follows the address on load and whenever a link
 * changes it; picking a tab writes it back (linkTab), so the address can be shared and a link to another tab still
 * switches it. The tab is set before the browser paints (a layout effect), so a link from the menus opens straight on it.
 */

function ReadTab<T extends string>({ param, ids, onTab }: { param: string; ids: readonly T[]; onTab: (id: T) => void }) {
  const value = useSearchParams().get(param);
  useLayoutEffect(() => {
    if (value && (ids as readonly string[]).includes(value)) onTab(value as T);
  }, [value, ids, onTab]);
  return null;
}

/** Opens the tab the address names (`?<param>=<id>`, one of `ids`). Under its own Suspense: it reads the URL. */
export function TabFromLink<T extends string>(props: { param: string; ids: readonly T[]; onTab: (id: T) => void }) {
  return (
    <Suspense fallback={null}>
      <ReadTab {...props} />
    </Suspense>
  );
}

/** Puts a picked tab in the address (`?<param>=<id>`) without a new history entry or a navigation. */
export function linkTab(param: string, id: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (url.searchParams.get(param) === id) return;
  url.searchParams.set(param, id);
  window.history.replaceState(null, "", url);
}
