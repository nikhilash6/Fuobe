"use client";

import { useSyncExternalStore } from "react";

const DAY = 86_400_000;

/** The start of today in UTC (ms). A launch price holds to the end of its last day (UTC), so the day is all a price needs. */
export const startOfDayUtc = (now: number) => now - (now % DAY);

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
const tell = () => listeners.forEach((l) => l());

/** Just after the next UTC midnight, the day changes (one timer for every price on the page). */
function arm() {
  timer = setTimeout(() => {
    tell();
    arm();
  }, DAY - (Date.now() % DAY) + 1000);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (listeners.size === 1) {
    arm();
    // A laptop that slept through midnight: the day is read again when the page is seen.
    document.addEventListener("visibilitychange", tell);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size) return;
    if (timer) clearTimeout(timer);
    timer = null;
    document.removeEventListener("visibilitychange", tell);
  };
}

/**
 * The day it is (its UTC midnight, in ms) for a price with a launch promo (src/lib/catalog/promo.ts): null on the server
 * and while the page hydrates, so a page prerendered at build time never reads the clock and shows no launch-priced
 * model's price until the browser knows the day; then the price of the day the person looks, changing at UTC midnight.
 */
export function useToday(): number | null {
  return useSyncExternalStore(subscribe, () => startOfDayUtc(Date.now()), () => null);
}
