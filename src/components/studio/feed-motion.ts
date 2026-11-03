"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { reducedMotion } from "@/lib/ui-motion";

/**
 * The feed's motion (motion.css: [data-enter], [data-arrive], [data-follow]). Only what happens while the studio is
 * open moves: a request just sent, and a result that finishes then. A feed that loads, a page that opens and a scroll
 * back show everything as it is, still.
 */

/** Runs this tab has seen in progress: when one of them finishes, its result arrives with motion. */
const live = new Set<string>();
/** The last "Keep going with this picture" row's height: a run on its way keeps that much room under it, so its row lands without pushing the feed. */
let rowHeight = 0;

/** The most a mark stays: an element that never animates (off screen, skipped) doesn't keep it to animate later. */
const MARK_MAX = 1500;

function mark(el: HTMLElement | null, attr: "data-enter" | "data-arrive" | "data-follow", i = 0) {
  if (!el || reducedMotion()) return;
  el.style.setProperty("--i", String(i));
  el.setAttribute(attr, "");
  let timer = 0;
  const clear = () => {
    window.clearTimeout(timer);
    el.removeEventListener("animationend", done);
    el.removeAttribute(attr);
  };
  // A result's light sweep (its ::after) is the last of its motion.
  const done = (e: AnimationEvent) => {
    if (e.target === el && (attr !== "data-arrive" || e.pseudoElement === "::after")) clear();
  };
  el.addEventListener("animationend", done);
  timer = window.setTimeout(clear, MARK_MAX);
}

/** A pending tile: its run is in progress in this tab. */
export function useLiveRun(id: string) {
  useEffect(() => {
    live.add(id);
  }, [id]);
}

/** A result tile: it settles in, with one light passing over it, when its run finished while the studio was open. */
export function useArrival<T extends HTMLElement>(id: string, index: number) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    if (!live.has(id)) return;
    mark(ref.current, "data-arrive", index);
    // Every tile and the row of the same run mount in this commit: they all see it first.
    queueMicrotask(() => live.delete(id));
  }, [id, index]);
  return ref;
}

/** A request's section: it rises in when it was just sent (in progress, made in the last moments), never on a load. */
export function useEnter<T extends HTMLElement>(id: string, active: boolean, createdAt: number) {
  const ref = useRef<T>(null);
  const seen = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (seen.current === id) return;
    seen.current = id;
    if (active && Date.now() - createdAt < 15_000) mark(ref.current, "data-enter");
  }, [id, active, createdAt]);
  return ref;
}

/** The next-steps row under the newest result: remembers its height, and follows its result in when that just arrived. */
export function useFollowRow<T extends HTMLElement>(id: string) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.offsetHeight > 0) rowHeight = el.offsetHeight;
    if (live.has(id)) mark(el, "data-follow");
  }, [id]);
  return ref;
}

/** The room a run on its way keeps for its row (0 until a row has been seen on this page). */
export function reservedRowHeight(): number {
  return rowHeight;
}
