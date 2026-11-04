"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/*
 * One look for every row of tabs or chips (src/app/tab-row.css): a `TabRow` holds `tabPill` items, and the selected one
 * carries `data-on` (`onAttr(on)`). The row adds the fill that slides from the old selection to the new one, keeps
 * hover from lighting a pill the page scrolled under a resting mouse, and fades its edges while it scrolls sideways.
 * Each row keeps its own behaviour: links or buttons, roles, keys.
 */

/** A tab or chip in a row. */
export const TAB_PILL = "tab-pill";

/** The class of a row (for a row that is not a TabRow, such as a Radix TabsList). */
export const TAB_ROW = "tab-row";

/** The selected pill: marked data-on, or data-state="active" (a Radix tab). */
const ON = ".tab-pill[data-on], .tab-pill[data-state=\"active\"]";

/** The selected item's mark: spread on the item (`{...onAttr(on)}`). */
export const onAttr = (on: boolean) => (on ? { "data-on": "" } : {});

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The sliding fill of a row: put on the row element (it renders `<TabIndicator />` inside). It follows the item marked
 * `data-on`, also when the mark moves by itself (a scroll-spy) or a pill changes size (fonts loading).
 */
export function useTabIndicator(row: React.RefObject<HTMLElement | null>, { follow = false, memory }: { follow?: boolean; memory?: string } = {}) {
  useIsoLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    let placed = false;
    let lastOn: Element | null = null;
    // A row drawn again by the next page (a suite whose pages each draw the header): the fill starts where it was left.
    const from = memory ? REMEMBERED.get(memory) : undefined;
    if (from) {
      setVars(el, from);
      el.setAttribute("data-ind", "");
      placed = true;
      lastOn = el;
    }
    let raf = 0;
    const place = () => {
      raf = 0;
      const on = el.querySelector<HTMLElement>(ON);
      if (!on || !on.checkVisibility()) {
        el.removeAttribute("data-ind");
        lastOn = null;
        return;
      }
      const r = el.getBoundingClientRect();
      const p = on.getBoundingClientRect();
      if (!p.width) return;
      const x = Math.round(p.left - r.left - el.clientLeft + el.scrollLeft);
      const y = Math.round(p.top - r.top - el.clientTop + el.scrollTop);
      const w = Math.round(p.width);
      const h = Math.round(p.height);
      // Slides only from one pill to another; the first placing (and a pill that only resized) just sets it.
      const moving = placed && lastOn !== null && lastOn !== on && !reducedMotion();
      if (moving && !el.hasAttribute("data-ind-moving")) {
        // The old place has to be drawn once before the transition can start from it.
        void el.offsetWidth;
      }
      el.toggleAttribute("data-ind-moving", moving);
      setVars(el, { x, y, w, h });
      if (memory) REMEMBERED.set(memory, { x, y, w, h });
      el.setAttribute("data-ind", "");
      if (follow && lastOn !== on && el.scrollWidth > el.clientWidth + 1) {
        // The selected pill stays in sight in a row that scrolls sideways (only the row moves, never the page).
        const left = x - (el.clientWidth - w) / 2;
        el.scrollTo({ left: Math.max(0, left), behavior: placed && !reducedMotion() ? "smooth" : "auto" });
      }
      placed = true;
      lastOn = on;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    place();
    const mo = new MutationObserver((list) => {
      // A new selection is placed in this frame (before paint), so the old fill never lingers for a frame.
      if (list.some((m) => m.type === "attributes" || m.addedNodes.length || m.removedNodes.length)) {
        if (raf) cancelAnimationFrame(raf);
        place();
      }
    });
    mo.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-on", "data-state", "hidden", "class"] });
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    for (const p of el.querySelectorAll(".tab-pill")) ro.observe(p);
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName === "transform") el.removeAttribute("data-ind-moving");
    };
    el.addEventListener("transitionend", onEnd);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      mo.disconnect();
      ro.disconnect();
      el.removeEventListener("transitionend", onEnd);
    };
  }, [row, follow, memory]);
}

interface Place {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where each remembered row last had its fill. */
const REMEMBERED = new Map<string, Place>();

function setVars(el: HTMLElement, { x, y, w, h }: Place) {
  el.style.setProperty("--ti-x", `${x}px`);
  el.style.setProperty("--ti-y", `${y}px`);
  el.style.setProperty("--ti-h", `${h}px`);
  el.style.setProperty("--ti-r", `${x + w - h / 2}px`);
  el.style.setProperty("--ti-s", `${Math.max(0, w - h) / 100}`);
}

/** The fill that slides under the selected pill (inside a row that uses useTabIndicator). */
export function TabIndicator() {
  return (
    <span aria-hidden className="tab-ind">
      <span />
      <span />
      <span />
    </span>
  );
}

/**
 * A row scrolled under a resting mouse (the page moving, the mouse still) lights no pill: hover waits until the mouse
 * moves again. Also marks the ends of a row that scrolls sideways (.fade-x), when `fade` is on.
 */
function useRowHoverAndEdges(row: React.RefObject<HTMLElement | null>, fade: boolean) {
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    let still = false;
    const onScroll = () => {
      if (still) return;
      still = true;
      el.setAttribute("data-still", "");
    };
    const onMove = () => {
      if (!still) return;
      still = false;
      el.removeAttribute("data-still");
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("pointermove", onMove, { passive: true });
    let ro: ResizeObserver | undefined;
    const edges = () => {
      el.toggleAttribute("data-fade-start", el.scrollLeft > 2);
      el.toggleAttribute("data-fade-end", el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };
    if (fade) {
      edges();
      el.addEventListener("scroll", edges, { passive: true });
      ro = new ResizeObserver(edges);
      ro.observe(el);
    }
    return () => {
      window.removeEventListener("scroll", onScroll);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("scroll", edges);
      ro?.disconnect();
    };
  }, [row, fade]);
}

type RowProps = React.HTMLAttributes<HTMLElement> & {
  /** The element: a `nav` for links to pages or sections, a `div` (default) for tabs or chips. */
  as?: "div" | "nav" | "ul";
  /** Keep the selected pill in sight when the row scrolls sideways. */
  follow?: boolean;
  /** Fade the row's ends while there is more past them (a row that scrolls sideways). */
  fade?: boolean;
  /** A name for a row each page draws again: its fill slides on from where the last page left it. */
  memory?: string;
};

/** A row of tabs or chips: one look, a fill that slides to the selected pill, and no hover left behind by a scroll. */
export const TabRow = forwardRef<HTMLElement, RowProps>(function TabRow({ as = "div", follow, fade = true, memory, className, children, ...props }, ref) {
  const own = useRef<HTMLElement | null>(null);
  useImperativeHandle(ref, () => own.current as HTMLElement);
  useTabIndicator(own, { follow, memory });
  useRowHoverAndEdges(own, fade);
  const set = useCallback((el: HTMLElement | null) => {
    own.current = el;
  }, []);
  const Tag = as as "div";
  return (
    <Tag ref={set as React.Ref<HTMLDivElement>} data-tab-row="" className={cn(TAB_ROW, fade && "fade-x", className)} {...(props as React.HTMLAttributes<HTMLDivElement>)}>
      <TabIndicator />
      {children}
    </Tag>
  );
});

/**
 * Fades a content area in when what it shows changes (a mode tab, a chip that filters a grid): the new content is there
 * at once and only its opacity eases, so a switch is never slower. Nothing on the first render or with reduced motion.
 */
export function useSwapFade<T extends HTMLElement>(key: unknown) {
  const ref = useRef<T>(null);
  useFadeOn(ref, key);
  return ref;
}

/** useSwapFade on an element that already has a ref. */
export function useFadeOn(ref: React.RefObject<HTMLElement | null>, key: unknown) {
  const first = useRef(true);
  useIsoLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    // null: the content is still the old one (its replacement is on the way); it fades when the new one comes.
    if (key === null || !el || reducedMotion() || typeof el.animate !== "function") return;
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "cubic-bezier(0.25, 0.8, 0.25, 1)" });
  }, [key, ref]);
}
