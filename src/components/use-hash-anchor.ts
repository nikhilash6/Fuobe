"use client";

import { useEffect } from "react";

/*
 * A Settings section reached by a link to its #id: /settings#your-keys from the account menu's "Add a key", a model
 * picker or a refused run, /settings#cloud from the owner's "Check key". These sections render only after the page is
 * hydrated, so the browser finds no anchor when the page loads. Sections above them also grow when their own data
 * arrives (Your GPU looks for ComfyUI on this computer), which pushes the section out of view after a jump to it, and
 * what is below them may still be loading, so the page can end before the section reaches the top. Once the section
 * exists, this scrolls to it and keeps it at the top while the page settles. The hold ends when the reader scrolls,
 * taps, clicks or types, or after HOLD_MS.
 */

/** The longest time a section is held at the top. */
export const HOLD_MS = 10_000;

/** The reader takes over: the hold ends at once. */
export const READER_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/**
 * Scrolls `el` to the top (its scroll-margin applies) and keeps it there while anything above it changes size. Returns
 * the function that ends the hold early.
 */
export function keepInView(el: Element, holdMs = HOLD_MS): () => void {
  let done = false;
  let top = 0;
  // The page ended before the section could reach the top (what is below it was still loading).
  let short = false;
  const page = document.documentElement;
  const align = () => {
    el.scrollIntoView({ block: "start" });
    top = el.getBoundingClientRect().top;
    short = window.scrollY + window.innerHeight >= page.scrollHeight - 1;
  };
  const ro = new ResizeObserver(() => {
    if (done) return;
    if (!el.isConnected) return stop();
    if (short || Math.abs(el.getBoundingClientRect().top - top) > 1) align();
  });
  // Everything that sits above the section in the page: its earlier siblings, and those of each element around it.
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    for (let s = n.previousElementSibling; s; s = s.previousElementSibling) ro.observe(s);
  }
  // And the whole page: it grows when what is below loads (room to scroll the section up), or when a part is put above.
  ro.observe(page);
  const timer = setTimeout(stop, holdMs);
  for (const t of READER_EVENTS) window.addEventListener(t, stop, { capture: true, passive: true });
  function stop() {
    if (done) return;
    done = true;
    ro.disconnect();
    clearTimeout(timer);
    for (const t of READER_EVENTS) window.removeEventListener(t, stop, { capture: true });
  }
  align();
  return stop;
}

/** The id the page's address points to ("your-keys" for /settings#your-keys), or "". */
export function hashId(hash: string): string {
  try {
    return decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return "";
  }
}

/**
 * For a section with this `id`: once `ready` (the section is in the page), and when the address points to it, scroll
 * to it and hold it in view while the page settles.
 */
export function useHashAnchor(id: string, ready: boolean): void {
  useEffect(() => {
    if (!ready || hashId(window.location.hash) !== id) return;
    const el = document.getElementById(id);
    return el ? keepInView(el) : undefined;
  }, [id, ready]);
}
