"use client";

import { useSyncExternalStore } from "react";

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

let settled = false;
let started = false;
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!started) {
    started = true;
    whenIdle(() => {
      settled = true;
      for (const l of listeners) l();
    });
  }
  return () => listeners.delete(cb);
}

/** True once the page has loaded and the browser has had an idle moment (false on the server and while hydrating). */
export function useSettled(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => settled,
    () => false,
  );
}
