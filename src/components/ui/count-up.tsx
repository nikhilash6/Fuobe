"use client";

import { useEffect, useRef } from "react";
import { counts, countUp, firstSight, onceVisible, reducedMotion } from "@/lib/ui-motion";

/** Numbers that have counted up this session (each once; without storage, once per page view). */
const SEEN_KEY = "fuobe:counted";

function seen(key: string): boolean {
  try {
    return (JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? "[]") as string[]).includes(key);
  } catch {
    return false;
  }
}

function markSeen(key: string) {
  try {
    const list = JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? "[]") as string[];
    if (!list.includes(key)) sessionStorage.setItem(SEEN_KEY, JSON.stringify([...list, key].slice(-200)));
  } catch {
    // Private mode or storage off: it may count again on another visit, which is fine.
  }
}

/**
 * A number that settles up to its value the first time it scrolls on screen (once per session): from about 70 % to the
 * value in 600 ms, in tabular figures with its width held, so nothing beside it moves. The server renders the final
 * value (no JS, screen readers and a print read that). A number under 10 doesn't count; a number already on screen when
 * its page shows (a fresh load or a page arriving by a link) is drawn final, so it never competes with the page's own
 * motion; under reduced motion it never counts. Where it is comes from the browser's intersection pass, not a layout read.
 */
export function CountUp({ value, id, className }: { value: number; /** Tells apart two counts of the same value on a page. */ id?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !counts(value) || reducedMotion()) return;
    const key = `${location.pathname}|${id ?? ""}|${value}`;
    if (seen(key)) return;
    let stop = () => {};
    let cancelVisible = () => {};
    const cancelSight = firstSight(el, (where) => {
      if (where === "on") return markSeen(key);
      cancelVisible = onceVisible(el, () => {
        markSeen(key);
        stop = countUp(el, value);
      });
    });
    return () => {
      cancelSight();
      cancelVisible();
      stop();
    };
  }, [value, id]);
  return (
    <span ref={ref} className={className} style={{ display: "inline-block", minWidth: `${String(value).length}ch`, fontVariantNumeric: "tabular-nums" }}>
      {value}
    </span>
  );
}
