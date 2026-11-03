/**
 * The site's motion in numbers, for scripts: the same tokens as src/app/motion.css (CSS reads those; this file is
 * for what CSS can't do: staggers, count-ups, reveal-once, and the reduced-motion check). No dependency.
 * Under prefers-reduced-motion every duration and delay is 0 and every change lands at once.
 */

export const MOTION = { fast: 120, base: 200, slow: 320, page: 380, count: 600, stagger: 40 } as const;
export type MotionToken = keyof typeof MOTION;

export const EASE = {
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  enter: "cubic-bezier(0.08, 0.82, 0.17, 1)",
  exit: "cubic-bezier(0.3, 0, 1, 1)",
  emphasised: "cubic-bezier(0.32, 0.72, 0, 1)",
} as const;

/** The most steps a stagger takes: later items move with the last one. */
export const STAGGER_CAP = 6;

/**
 * The event that shows sections waiting to reveal before a scroll lands on them: dispatch it on `document` with
 * `detail: { target }` (an element, or its id or "#id") before an in-page jump starts. Links to "#…" do it by themselves.
 */
export const REVEAL_EVENT = "fuobe:reveal-to";

/** True when the system asks for less motion (false on the server, where nothing moves anyway). */
export function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A token in milliseconds: 0 under reduced motion. */
export function ms(token: MotionToken, reduce = reducedMotion()): number {
  return reduce ? 0 : MOTION[token];
}

/** The delay of item `i` in a staggered group (ms): `step` each, capped at `cap` steps; 0 under reduced motion. */
export function stagger(i: number, step: number = MOTION.stagger, cap: number = STAGGER_CAP, reduce = reducedMotion()): number {
  if (reduce || !(i > 0)) return 0;
  return Math.min(Math.floor(i), cap) * step;
}

/** The count-up curve: a quartic ease-out, 0 → 1 (quick at first, no crawl at the end). */
export function easeOutQuart(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 4;
}

/** Where a count-up starts: about 70 % of the value (so it reads as settling, not as counting from zero). */
export function countFrom(value: number): number {
  return Math.round(value * 0.7);
}

/** A number counts up only when it is a whole number of at least 10. */
export function counts(value: number): boolean {
  return Number.isInteger(value) && value >= 10;
}

/** The number shown `elapsed` ms into a count-up to `to` lasting `duration` ms. */
export function countAt(to: number, elapsed: number, duration: number = MOTION.count): number {
  if (duration <= 0 || elapsed >= duration) return to;
  const from = countFrom(to);
  return Math.round(from + (to - from) * easeOutQuart(elapsed / duration));
}

/**
 * Counts `el`'s text up to `to` (rAF, text only). Under reduced motion, or for a number under 10, the final value is
 * written at once. Returns a cancel, which also writes the final value.
 */
export function countUp(el: HTMLElement, to: number, { duration = MOTION.count, reduce = reducedMotion() }: { duration?: number; reduce?: boolean } = {}): () => void {
  const done = () => {
    el.textContent = String(to);
  };
  if (reduce || !counts(to) || duration <= 0) {
    done();
    return () => {};
  }
  let raf = 0;
  const start = performance.now();
  const tick = (now: number) => {
    const t = now - start;
    el.textContent = String(countAt(to, t, duration));
    if (t < duration) raf = requestAnimationFrame(tick);
  };
  el.textContent = String(countFrom(to));
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    done();
  };
}

/**
 * Whether a page change is a new place (it gets the page motion). Not when the link was a tab in the page's own tab
 * row (`fromTabRow`: Marketing's row holds /marketing and /ads alike), nor within one first path segment (a hub's tabs
 * /audio → /audio/music, a page's own sections ?tab=…, the same page again): those change in place.
 */
export function newPlace(from: string | null, to: string, { fromTabRow = false }: { fromTabRow?: boolean } = {}): boolean {
  if (from === null || fromTabRow) return false;
  const first = (p: string) => p.split(/[?#]/)[0].split("/").filter(Boolean)[0] ?? "";
  return first(from) !== first(to);
}

/**
 * A tab row in the page: a nav, tablist or tab row that marks the current page (aria-current / aria-selected). A link
 * in one is a tab: following it changes the page in place.
 */
export function tabRowOf(link: Element): Element | null {
  const row = link.closest('[data-tab-row], [role="tablist"], nav');
  if (!row || !row.closest("#content")) return null;
  return row.querySelector('[aria-current="page"], [aria-selected="true"]') ? row : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Seen once: shared IntersectionObservers, read only in their callbacks (never a layout read of our own).

type Reveal = () => void;
let observer: IntersectionObserver | null = null;
const waiting = new WeakMap<Element, Reveal>();
/** Set by the first callback of any observer here: the browser does deliver them. */
let observersAlive = false;

function sharedObserver(): IntersectionObserver | null {
  if (observer || typeof IntersectionObserver === "undefined") return observer;
  observer = new IntersectionObserver(
    (entries) => {
      observersAlive = true;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const run = waiting.get(e.target);
        observer?.unobserve(e.target);
        waiting.delete(e.target);
        run?.();
      }
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0 },
  );
  return observer;
}

/** Calls `run` once, the first time `el` comes on screen. Returns a cancel. Without IntersectionObserver it runs now. */
export function onceVisible(el: Element, run: Reveal): () => void {
  const io = sharedObserver();
  if (!io) {
    run();
    return () => {};
  }
  waiting.set(el, run);
  io.observe(el);
  return () => {
    waiting.delete(el);
    io.unobserve(el);
  };
}

/** Where an element was when first looked at: on screen, or off it (below it, or above it). */
export type Sight = "on" | "below" | "above";
let sightObserver: IntersectionObserver | null = null;
const sightWaiting = new WeakMap<Element, (s: Sight) => void>();

/**
 * Calls `run` once with where `el` is now (on screen, below or above it), from the browser's own next intersection
 * pass: no forced layout. Returns a cancel. Without IntersectionObserver it says "on" (so nothing is hidden).
 */
export function firstSight(el: Element, run: (s: Sight) => void): () => void {
  if (!sightObserver && typeof IntersectionObserver !== "undefined") {
    sightObserver = new IntersectionObserver((entries) => {
      observersAlive = true;
      for (const e of entries) {
        const cb = sightWaiting.get(e.target);
        sightObserver?.unobserve(e.target);
        sightWaiting.delete(e.target);
        const rootH = e.rootBounds?.height ?? window.innerHeight;
        cb?.(e.isIntersecting ? "on" : e.boundingClientRect.top >= rootH ? "below" : "above");
      }
    });
  }
  if (!sightObserver) {
    run("on");
    return () => {};
  }
  sightWaiting.set(el, run);
  sightObserver.observe(el);
  return () => {
    sightWaiting.delete(el);
    sightObserver?.unobserve(el);
  };
}

/** The element a "#id" (or an id, or an element) names. */
function targetOf(t: Element | string | null | undefined): Element | null {
  if (!t) return null;
  if (typeof t !== "string") return t;
  const id = t.startsWith("#") ? t.slice(1) : t;
  if (!id) return null;
  try {
    return document.getElementById(decodeURIComponent(id));
  } catch {
    return document.getElementById(id);
  }
}

/** The longest the page waits for the browser's first intersection pass before it shows every section anyway. */
const REVEAL_SAFETY = 3000;

/**
 * Sections marked data-reveal that start below the screen fade in and settle 8 px when they first come on screen
 * (their data-reveal-item children follow, 40 ms apart, 6 steps at most). Never hidden: a section on screen or above
 * it, any section under reduced motion, on a page opened at a #part, or in a print. A jump within the page (a "#…"
 * link, a hash change, REVEAL_EVENT, find in page) shows its target and every section above it at once, with no
 * transition, so the scroll lands on them ready. If the browser never reports where sections are within 3 s, they
 * all show. Returns a cancel that shows all.
 */
export function revealOnScroll(root: ParentNode, { reduce = reducedMotion() }: { reduce?: boolean } = {}): () => void {
  if (reduce || typeof document === "undefined" || location.hash) return () => {};
  /** Each section still waiting (on its first look or on its scroll), with what stops that wait. */
  const pending = new Map<HTMLElement, () => void>();
  for (const el of root.querySelectorAll<HTMLElement>("[data-reveal]:not([data-reveal=in]):not([data-reveal=wait]):not([data-reveal=now]):not([data-reveal=look])")) {
    el.dataset.reveal = "look";
    pending.set(
      el,
      firstSight(el, (where) => {
        if (where !== "below") {
          pending.delete(el);
          el.dataset.reveal = "in";
          return;
        }
        el.querySelectorAll<HTMLElement>("[data-reveal-item]").forEach((item, i) => item.style.setProperty("--i", String(Math.min(i, STAGGER_CAP))));
        el.dataset.reveal = "wait";
        pending.set(
          el,
          onceVisible(el, () => {
            pending.delete(el);
            el.dataset.reveal = "in";
          }),
        );
      }),
    );
  }
  if (!pending.size) return () => {};

  /** Shows `el` now, with no transition (it stays "now": the section is simply there). */
  const showNow = (el: HTMLElement) => {
    pending.get(el)?.();
    pending.delete(el);
    el.dataset.reveal = "now";
  };
  const revealTo = (t: Element | string | null | undefined) => {
    const target = targetOf(t);
    if (!target) return;
    for (const el of [...pending.keys()]) {
      // The section holds the target, or comes before it in the page.
      if (el.contains(target) || target.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) showNow(el);
    }
  };
  const onClick = (e: MouseEvent) => {
    const a = (e.target as Element | null)?.closest?.("a[href]");
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("#")) return revealTo(href);
    try {
      const url = new URL(href, location.href);
      if (url.hash && url.pathname === location.pathname && url.search === location.search) revealTo(url.hash);
    } catch {
      // Not a URL: nothing to show.
    }
  };
  const onHash = () => revealTo(location.hash);
  const onEvent = (e: Event) => revealTo((e as CustomEvent<{ target?: Element | string }>).detail?.target);
  // Find in page opens a hidden=until-found part first: whatever section holds it shows.
  const onMatch = (e: Event) => revealTo(e.target as Element);
  document.addEventListener("click", onClick, true);
  document.addEventListener(REVEAL_EVENT, onEvent);
  document.addEventListener("beforematch", onMatch, true);
  window.addEventListener("hashchange", onHash);
  const safety = window.setTimeout(() => {
    if (!observersAlive) for (const el of [...pending.keys()]) showNow(el);
  }, REVEAL_SAFETY);

  return () => {
    window.clearTimeout(safety);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener(REVEAL_EVENT, onEvent);
    document.removeEventListener("beforematch", onMatch, true);
    window.removeEventListener("hashchange", onHash);
    for (const [el, stop] of pending) {
      stop();
      el.dataset.reveal = "in";
    }
    pending.clear();
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Pictures that arrive after the first paint fade in when they load.

/**
 * Whether a picture should wait hidden and fade in: not loaded yet, not the page's main picture, not styled by its own
 * code, not inside something with its own motion (a result settling into its tile, its next steps following it, a
 * request rising in).
 */
export function fadesIn(img: HTMLImageElement): boolean {
  if (img.complete || img.dataset.fade !== undefined || img.dataset.noFade !== undefined) return false;
  if (img.getAttribute("fetchpriority") === "high") return false;
  // A picture whose own code fades or hides it (an inline opacity, an opacity class) keeps doing so.
  if (img.style.opacity || /(^|\s)(opacity-|transition-opacity)/.test(img.className)) return false;
  if (img.closest?.("[data-arrive], [data-follow], [data-enter], [data-own-motion]")) return false;
  return !!img.getAttribute("src") || !!img.getAttribute("srcset");
}

/**
 * Holds `img` hidden until it loads, then fades it in (CSS: img[data-fade]). An error shows the frame under it.
 * offScreenOnly: only when it is off screen now (asked of the browser's next intersection pass, never a layout read),
 * for a page's first screen, which shows as it loads.
 */
export function fadeInOnLoad(img: HTMLImageElement, { offScreenOnly = false }: { offScreenOnly?: boolean } = {}): void {
  if (!fadesIn(img)) return;
  if (offScreenOnly) {
    firstSight(img, (where) => where !== "on" && fadeInOnLoad(img));
    return;
  }
  const show = () => {
    img.removeEventListener("load", show);
    img.removeEventListener("error", fail);
    img.dataset.fade = "in";
  };
  const fail = () => {
    img.removeEventListener("load", show);
    img.removeEventListener("error", fail);
    delete img.dataset.fade;
  };
  img.addEventListener("load", show);
  img.addEventListener("error", fail);
  // It may have finished between the check and the listeners: then it simply shows.
  if (img.complete) return fail();
  img.dataset.fade = "wait";
}

/**
 * The top-bar menus' intent timings (ms, px). Not motion: they stay the same under reduced motion, because they guard
 * against menus opening by accident while the pointer crosses the bar.
 */
export const NAV_INTENT = {
  /** The pointer rests this long on an item before its menu opens. */
  rest: 120,
  /** "Rests" = stays within this many px of where it stopped. */
  restSlop: 8,
  /** The menu opens anyway after this long on one item. */
  restCap: 600,
  /** A menu the pointer opened closes this long after the pointer left it and its item. */
  grace: 300,
  /** An item entered this soon after a menu closed opens at once (and at once while one is open). */
  switchWindow: 300,
  /** A switch waits at most this long while the pointer heads into the open menu. */
  aimHold: 100,
  /** Heading into the open menu holds a close at most this long beyond the grace. */
  aimMax: 300,
  /** A pointer that has not moved for this long has stopped (no longer heading anywhere). */
  aimStop: 60,
  /** A hover open waits at most this long for its menu's data. */
  dataWait: 150,
  /** A loading menu shows its skeleton only after this long. */
  skeletonGrace: 150,
  /** The dimmed page starts to fade only once nothing has been open this long. */
  scrimHold: 120,
} as const;
