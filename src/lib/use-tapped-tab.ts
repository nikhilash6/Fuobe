"use client";

import { useCallback, useLayoutEffect, useState } from "react";

/**
 * The tab just tapped in a bar of route tabs, to show as the current one in the very next frame, before the new route
 * commits. It lasts while the address is the one it was tapped on: once the route moves the address says which tab is
 * current. It is also dropped when the page is hidden (a page kept for Back), so going back shows that page's own tab.
 */
export function useTappedTab<T>(pathname: string | null): [T | null, (tab: T) => void] {
  const [tapped, setTapped] = useState<{ at: string | null; tab: T } | null>(null);
  // The route moved (or Back / Forward): the address says now.
  if (tapped && tapped.at !== pathname) setTapped(null);
  useLayoutEffect(() => () => setTapped(null), []);
  const tap = useCallback((tab: T) => setTapped({ at: pathname, tab }), [pathname]);
  return [tapped && tapped.at === pathname ? tapped.tab : null, tap];
}

/** A plain left click that navigates this tab (a modifier or another button opens a new tab or window instead). */
export function isPlainClick(e: React.MouseEvent): boolean {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}
