"use client";

import { type RefObject, useEffect } from "react";

/**
 * A looping demo video that plays only while a quarter of it is on screen and the tab is visible, and rests (paused,
 * nothing decoding) otherwise, so it never costs the page frames it doesn't show. Under reduced motion it stays on its
 * poster.
 */
export function usePlayInView(ref: RefObject<HTMLVideoElement | null>, enabled = true) {
  useEffect(() => {
    const v = ref.current;
    if (!v || !enabled) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    let inView = false;
    const sync = () => {
      if (inView && document.visibilityState === "visible") {
        if (v.preload !== "auto") v.preload = "auto";
        void v.play().catch(() => {});
      } else v.pause();
    };
    const io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            ([e]) => {
              inView = e.isIntersecting;
              sync();
            },
            { threshold: 0.25 },
          );
    if (io) io.observe(v);
    else {
      inView = true;
      sync();
    }
    document.addEventListener("visibilitychange", sync);
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      v.pause();
    };
  }, [ref, enabled]);
}
