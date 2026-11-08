"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  aiming,
  restDue,
  restMove,
  restStart,
  switchDirection,
  switchesAtOnce,
  travelling,
  type BarMenuAction,
  type BarMenuId,
  type BarMenuState,
  type Box,
  type MenuVia,
  type Move,
  type Pt,
  type Rest,
} from "@/lib/bar-intent";
import { megaMove } from "@/lib/mega-menus";
import { ms, NAV_INTENT } from "@/lib/ui-motion";
import { useNavUi } from "./nav-ui";

/*
 * The top bar's six menus (Create, Studios, Apps, Motions & effects, Canvas, More) under one controller, so every item
 * behaves the same way, on every page:
 *
 *   mouse     resting on an item opens its menu (NAV_INTENT.rest; a glide along the bar opens nothing); while one is
 *             open, moving onto another item switches at once, unless the pointer is heading into the open menu (the
 *             safe triangle, a short hold). A menu the pointer opened closes a moment after the pointer leaves it.
 *   click     toggles: a click opens the menu (it still closes once the mouse leaves it, as a hover-opened one does); a
 *             click on a menu the pointer opened keeps it; the next click closes it. A double click counts once.
 *             Ctrl/Cmd-click or a middle click opens the item's page in a new tab.
 *   touch/pen never hover: a tap toggles, a tap on another item switches, a tap outside only closes.
 *   keys      Enter/Space toggle (focus stays on the item); ArrowDown/ArrowUp open and focus the first/last row;
 *             Left/Right/Home/End move along the bar (an open menu follows); Esc closes and gives focus back.
 *
 * The state is NavUi's (one menu at most, bar-intent.ts's reducer); this file owns the one timer, the pointer's recent
 * moves, and where each item and its menu are on the page. Each item is one <button aria-expanded aria-controls>,
 * each menu a <section> of links straight after it (a disclosure, not an ARIA menu).
 */

type Part = {
  trigger?: HTMLElement | null;
  surface?: HTMLElement | null;
  /** A full-width panel under the bar (not a card under its item). */
  big?: boolean;
  /** Its data and code are here (a hover open waits a moment for them). */
  ready?: () => boolean;
  /** Start loading its data and code. */
  warm?: () => void;
};

type Timer = { kind: "open" | "close" | "switch"; id: BarMenuId; h: number };
type Handlers<E extends HTMLElement> = {
  onPointerEnter: (e: React.PointerEvent<E>) => void;
  onPointerMove: (e: React.PointerEvent<E>) => void;
  onPointerLeave: (e: React.PointerEvent<E>) => void;
};
export type TriggerHandlers = Handlers<HTMLButtonElement> & {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onAuxClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onMouseDown: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  onFocus: () => void;
};
export type SurfaceHandlers = Handlers<HTMLElement> & {
  onClick: (e: React.MouseEvent<HTMLElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
};

export interface BarController {
  register(id: BarMenuId, patch: Part): () => void;
  part(id: BarMenuId): Part | undefined;
  trigger(id: BarMenuId): TriggerHandlers;
  surface(id: BarMenuId): SurfaceHandlers;
  /** Keys on the bar itself: Left/Right/Home/End between its items. */
  navKey(e: React.KeyboardEvent<HTMLElement>): void;
  /** Closes `id` if it is the open menu (focus back to its item when `focusBack`). */
  close(id: BarMenuId, focusBack?: boolean): void;
  /** Focus a row of the open menu once it shows. */
  focusIn(id: BarMenuId, which: "first" | "last" | { group: string }): void;
  install(): () => void;
}

/** Visible on the page (not inside a hidden row or a closed panel). */
export const shows = (el: Element) =>
  typeof (el as HTMLElement).checkVisibility === "function" ? (el as HTMLElement).checkVisibility() : el.getClientRects().length > 0;

const now = () => performance.now();
/** Keys that move focus inside an open menu. */
const MOVE_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Tab"]);
const isKeyboard = () => typeof document !== "undefined" && document.documentElement.dataset.input === "keyboard";
const box = (el: Element | null | undefined): Box | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width || r.height ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
};

/** A row to focus in a menu: its first lead row, its first column's last row, or the asked-for column's first. */
function rowIn(surface: HTMLElement, which: "first" | "last" | { group: string }): HTMLElement | null {
  if (typeof which === "object") {
    const g = surface.querySelector<HTMLElement>(`[data-group="${CSS.escape(which.group)}"] [data-row="0"]`);
    if (g && shows(g)) return g;
    return rowIn(surface, "first");
  }
  const col = [...surface.querySelectorAll<HTMLElement>('[data-col="0"]')].filter(shows);
  col.sort((a, b) => Number(a.dataset.row) - Number(b.dataset.row));
  return (which === "first" ? col[0] : col[col.length - 1]) ?? null;
}

export function createBarController(act: (a: BarMenuAction) => BarMenuState, state: () => BarMenuState, returnTo: () => HTMLElement | null): BarController {
  const parts = new Map<BarMenuId, Part>();
  let timer: Timer | null = null;
  let rest: Rest | null = null;
  /** The item and the menu under the mouse. */
  let hoverOn: BarMenuId | null = null;
  let overSurface: BarMenuId | null = null;
  /** Where the pointer left the open menu's item (the safe triangle's tip). */
  let exit: Pt | null = null;
  const moves: Move[] = [];
  let lastType = "mouse";

  const clear = () => {
    if (timer) clearTimeout(timer.h);
    timer = null;
  };
  const arm = (kind: Timer["kind"], id: BarMenuId, delay: number, fn: () => void) => {
    clear();
    const t: Timer = { kind, id, h: 0 };
    t.h = window.setTimeout(
      () => {
        if (timer !== t) return;
        timer = null;
        fn();
      },
      Math.max(0, delay),
    );
    timer = t;
  };
  /** The pointer's way just now: its last few moves of the last 100 ms (or its last two, after a pause). */
  const recentMoves = (t: number) => {
    const recent = moves.filter((m) => t - m.t <= 100);
    return recent.length >= 2 ? recent.slice(-4) : moves.slice(-2);
  };
  const isAiming = (id: BarMenuId) => {
    const t = now();
    return aiming(exit, box(parts.get(id)?.surface), recentMoves(t), t);
  };
  const track = (x: number, y: number) => {
    moves.push({ x, y, t: now() });
    if (moves.length > 10) moves.shift();
  };
  /**
   * A menu is going (closing, or replaced by `to`) with focus on one of its rows: focus moves to its item (or to the
   * new menu's item) instead of falling to the page. Focus is only ever in a menu that the keys or the item already had.
   */
  const handBack = (from: BarMenuId, to?: BarMenuId) => {
    const a = document.activeElement;
    if (!a || !parts.get(from)?.surface?.contains(a)) return;
    parts.get(to ?? from)?.trigger?.focus({ preventScroll: true });
  };

  const open = (id: BarMenuId, mode: "hover" | "pinned", via: MenuVia) => {
    clear();
    rest = null;
    act({ type: "open", id, mode, via, clicked: via === "key", now: now() });
  };
  /** Onto another item while a menu is open (or just closed): it takes over at once, in the open one's mode. */
  const switchTo = (id: BarMenuId) => {
    const s = state();
    if (s.id) handBack(s.id, id);
    open(id, s.id ? s.mode : "hover", "pointer");
  };
  const close = (id: BarMenuId, focusBack = false) => {
    const s = state();
    if (s.id !== id) return;
    clear();
    const back = focusBack ? (s.via === "area" && returnTo()?.isConnected ? returnTo() : parts.get(id)?.trigger) : null;
    if (!back) handBack(id);
    act({ type: "close", id, now: now() });
    back?.focus();
  };
  const hoverOpen = (id: BarMenuId) => {
    const started = now();
    const go = () => {
      if (hoverOn !== id) return;
      const ready = parts.get(id)?.ready;
      // The data is on its way: wait a moment for it, so the menu opens whole rather than as a skeleton.
      if (ready && !ready() && now() - started < NAV_INTENT.dataWait) return arm("open", id, 16, go);
      open(id, "hover", "pointer");
    };
    go();
  };
  const armRest = (id: BarMenuId) => {
    if (!rest) return;
    const r = rest;
    const due = restDue(r);
    // Due by the cap (the pointer never stopped): it opens only if the pointer is not still drifting along the bar.
    const capped = due < r.anchor.t + NAV_INTENT.rest;
    arm("open", id, due - now(), () => {
      const t = now();
      if (capped && travelling(moves, t)) {
        const last = moves[moves.length - 1];
        rest = restStart(last.x, last.y, t);
        return armRest(id);
      }
      hoverOpen(id);
    });
  };
  const armClose = (id: BarMenuId, held = 0) => {
    arm("close", id, held ? 50 : NAV_INTENT.grace, () => {
      const s = state();
      if (s.id !== id || s.mode !== "hover" || hoverOn === id || overSurface === id) return;
      // Still heading into the menu (a long diagonal): hold the close a little longer.
      if (held < NAV_INTENT.aimMax && isAiming(id)) return armClose(id, held + 50);
      handBack(id);
      act({ type: "close", id, now: now() });
    });
  };
  /**
   * Crossing `id` on the way into the open menu: its switch waits (aimHold), and a little longer while the pointer
   * keeps heading in (a wide item crossed slowly), up to aimMax; a stop or a turn along the bar switches at once.
   */
  const holdSwitch = (id: BarMenuId, held = 0) => {
    arm("switch", id, held ? 50 : NAV_INTENT.aimHold, () => {
      if (hoverOn !== id) return;
      const s = state();
      if (s.id && s.id !== id && held < NAV_INTENT.aimMax && isAiming(s.id)) return holdSwitch(id, held + 50);
      switchTo(id);
    });
  };
  const warm = (id: BarMenuId) => parts.get(id)?.warm?.();
  const hubOf = (id: BarMenuId) => parts.get(id)?.trigger?.dataset.href;
  const newTab = (href: string) => window.open(href, "_blank", "noopener");

  const focusIn: BarController["focusIn"] = (id, which) => {
    const start = now();
    const tick = () => {
      if (state().id !== id) return;
      const s = parts.get(id)?.surface;
      const el = s && rowIn(s, which);
      if (el) {
        el.focus();
        if (document.activeElement === el) return;
      }
      if (now() - start < 4000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const triggers = new Map<BarMenuId, TriggerHandlers>();
  const surfaces = new Map<BarMenuId, SurfaceHandlers>();

  const trigger = (id: BarMenuId): TriggerHandlers => {
    const had = triggers.get(id);
    if (had) return had;
    const h: TriggerHandlers = {
      onPointerEnter(e) {
        warm(id);
        if (e.pointerType !== "mouse") return;
        hoverOn = id;
        const s = state();
        if (s.id === id) {
          if (timer?.id === id && timer.kind === "close") clear();
          return;
        }
        if (switchesAtOnce(s, now())) {
          // The browser sends enter before the move that caused it: count this point first, so the check below sees
          // where the pointer is now, not where it was inside the item it left.
          track(e.clientX, e.clientY);
          // Crossing this item on the way into the open menu (a diagonal from its item): hold the switch a moment.
          if (s.id && isAiming(s.id)) return holdSwitch(id);
          return switchTo(id);
        }
        rest = restStart(e.clientX, e.clientY, now());
        armRest(id);
      },
      onPointerMove(e) {
        if (e.pointerType !== "mouse" || timer?.id !== id) return;
        if (timer.kind === "open" && rest) {
          const r = restMove(rest, e.clientX, e.clientY, now());
          if (r !== rest) {
            rest = r;
            armRest(id);
          }
        } else if (timer.kind === "switch") {
          const s = state();
          if (!s.id || !isAiming(s.id)) switchTo(id);
        }
      },
      onPointerLeave(e) {
        if (e.pointerType !== "mouse") return;
        if (hoverOn === id) hoverOn = null;
        if (timer?.id === id && timer.kind !== "close") {
          clear();
          rest = null;
        }
        const s = state();
        if (s.id !== id) return;
        exit = { x: e.clientX, y: e.clientY };
        if (s.mode === "hover") armClose(id);
      },
      onClick(e) {
        const pt = (e.nativeEvent as PointerEvent).pointerType;
        // A mouse double click counts once (its second click would close what the first opened); two quick taps are two.
        if (e.detail > 1 && (pt || lastType) === "mouse") return;
        const href = hubOf(id);
        if ((e.ctrlKey || e.metaKey) && href) {
          e.preventDefault();
          newTab(href);
          return;
        }
        const via: MenuVia = e.detail === 0 && !pt ? "key" : (pt || lastType) === "mouse" ? "pointer" : "touch";
        clear();
        rest = null;
        warm(id);
        act({ type: "click", id, via, now: now() });
      },
      onAuxClick(e) {
        const href = hubOf(id);
        if (e.button !== 1 || !href) return;
        e.preventDefault();
        newTab(href);
      },
      onMouseDown(e) {
        // A middle press opens the page in a new tab (on release), never the browser's autoscroll.
        if (e.button === 1) e.preventDefault();
      },
      onKeyDown(e) {
        if (e.altKey || e.ctrlKey || e.metaKey || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
        e.preventDefault();
        warm(id);
        open(id, "pinned", "key");
        focusIn(id, e.key === "ArrowDown" ? "first" : "last");
      },
      onFocus() {
        warm(id);
      },
    };
    triggers.set(id, h);
    return h;
  };

  const surface = (id: BarMenuId): SurfaceHandlers => {
    const had = surfaces.get(id);
    if (had) return had;
    const h: SurfaceHandlers = {
      onPointerEnter(e) {
        if (e.pointerType !== "mouse" || state().id !== id) return;
        overSurface = id;
        warm(id);
        // Reached the open menu: its close, or a switch held for the way here, is off.
        if (timer && (timer.kind === "switch" || (timer.kind === "close" && timer.id === id))) clear();
      },
      onPointerMove(e) {
        // The mouse moves the keyboard's place: the row under it takes focus (quietly: the ring is the keyboard's), so the
        // arrow keys go on from where the mouse left off and only one row is ever highlighted. Only while focus is
        // already this menu's (its item, a row) or nowhere: a field being typed in keeps focus, and its keys.
        if (e.pointerType !== "mouse") return;
        const a = document.activeElement;
        const p = parts.get(id);
        if (a && a !== document.body && !p?.trigger?.contains(a) && !p?.surface?.contains(a)) return;
        const at = (e.target as HTMLElement).closest<HTMLElement>("[data-col]");
        if (at && at !== a) at.focus({ preventScroll: true });
      },
      onPointerLeave(e) {
        if (e.pointerType !== "mouse") return;
        if (overSurface === id) overSurface = null;
        const s = state();
        if (s.id === id && s.mode === "hover") {
          exit = null;
          armClose(id);
        }
      },
      onClick(e) {
        // A link followed: the menu closes with it.
        if ((e.target as Element).closest("a[href]")) close(id);
      },
      onKeyDown(e) {
        // Keys moving inside a menu the pointer opened take it over: it no longer closes as the pointer leaves.
        const s = state();
        if (MOVE_KEYS.has(e.key) && s.id === id && s.mode === "hover") {
          if (timer?.kind === "close") clear();
          act({ type: "keys", id });
        }
        gridKey(e);
      },
    };
    surfaces.set(id, h);
    return h;
  };

  const navKey: BarController["navKey"] = (e) => {
    const el = e.target as HTMLElement;
    if (!el.matches("[data-bar-item]") || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-bar-item]")].filter(shows);
    const i = items.indexOf(el);
    if (i < 0) return;
    const n = items.length;
    const next = items[e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (i + (e.key === "ArrowLeft" ? n - 1 : 1)) % n];
    e.preventDefault();
    const s = state();
    const nid = next.dataset.barMenu as BarMenuId | undefined;
    if (s.id) {
      if (nid) {
        warm(nid);
        open(nid, "pinned", "key");
      } else close(s.id);
    }
    next.focus();
  };

  const install = () => {
    const onMove = (e: PointerEvent) => {
      lastType = e.pointerType;
      if (e.pointerType !== "mouse") return;
      track(e.clientX, e.clientY);
    };
    /** Drops the click of this one tap (where it pressed, soon after); a tap that became a scroll leaves no blocker. */
    const swallowClick = (down: PointerEvent) => {
      const stop = (ev: MouseEvent) => {
        done();
        if (Math.hypot(ev.clientX - down.clientX, ev.clientY - down.clientY) >= 10) return;
        ev.preventDefault();
        ev.stopPropagation();
      };
      const cancel = (ev: PointerEvent) => {
        if (ev.pointerId === down.pointerId) done();
      };
      const t = window.setTimeout(() => done(), 500);
      const done = () => {
        window.clearTimeout(t);
        document.removeEventListener("click", stop, true);
        document.removeEventListener("pointercancel", cancel, true);
      };
      document.addEventListener("click", stop, true);
      document.addEventListener("pointercancel", cancel, true);
    };
    /** A resize hid the open menu's item (the bar drops items as it narrows): its menu closes with it. */
    const onResize = () => {
      const s = state();
      const t = s.id ? parts.get(s.id)?.trigger : null;
      if (s.id && (!t || !shows(t))) {
        clear();
        act({ type: "close", id: s.id, now: now() });
      }
    };
    const onDown = (e: PointerEvent) => {
      lastType = e.pointerType;
      const s = state();
      if (!s.id) return;
      const target = e.target as Element | null;
      // A press on an item is the item's own (its click switches or toggles); a press in the open menu is the menu's.
      if (target?.closest?.("[data-bar-menu]") || parts.get(s.id)?.surface?.contains(target)) return;
      close(s.id);
      // A tap meant to dismiss never follows a link on the dimmed page under it.
      if (e.pointerType === "touch" || e.pointerType === "pen") swallowClick(e);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const s = state();
      if (!s.id) return;
      e.preventDefault();
      const p = parts.get(s.id);
      const a = document.activeElement;
      const inside = !!a && (!!p?.trigger?.contains(a) || !!p?.surface?.contains(a));
      // Opened by the pointer while typing elsewhere: Esc closes it and focus stays where it is.
      close(s.id, inside || s.via === "area");
    };
    const onFocusOut = (e: FocusEvent) => {
      const s = state();
      if (!s.id) return;
      const to = e.relatedTarget as Element | null;
      if (!to) return;
      const p = parts.get(s.id);
      const inOpen = (n: Node | null) => !!n && (!!p?.trigger?.contains(n) || !!p?.surface?.contains(n));
      if (!inOpen(e.target as Node) || inOpen(to)) return;
      // A press on another item focuses it before its click switches: that click decides, not the focus.
      if (to.closest?.("[data-bar-menu]") && !isKeyboard()) return;
      close(s.id);
    };
    document.addEventListener("pointermove", onMove, { capture: true, passive: true });
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("resize", onResize);
    return () => {
      clear();
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("resize", onResize);
    };
  };

  return {
    register(id, patch) {
      const p = parts.get(id) ?? {};
      Object.assign(p, patch);
      parts.set(id, p);
      return () => {
        for (const k of Object.keys(patch) as (keyof Part)[]) if (p[k] === patch[k]) delete p[k];
      };
    },
    part: (id) => parts.get(id),
    trigger,
    surface,
    navKey,
    close,
    focusIn,
    install,
  };
}

/**
 * Arrow keys in a menu's grid of links (each link has data-col and data-row): up and down a column, left and right to
 * the same place in the next one, Home and End. The links that show count (a row hidden by the window's height is
 * skipped). ArrowDown on "See all" (data-see-all, before the grid) goes to the first lead row.
 */
export function gridKey(e: React.KeyboardEvent<HTMLElement>) {
  const root = e.currentTarget;
  const target = e.target as HTMLElement;
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (target.matches("[data-see-all]") && e.key === "ArrowDown") {
    const first = rowIn(root, "first");
    if (first) {
      e.preventDefault();
      first.focus();
    }
    return;
  }
  const at = target.closest<HTMLElement>("[data-col]");
  if (!at) return;
  const cols: HTMLElement[][] = [];
  for (const el of root.querySelectorAll<HTMLElement>("[data-col]")) {
    if (!shows(el)) continue;
    (cols[Number(el.dataset.col)] ??= []).push(el);
  }
  for (let i = 0; i < cols.length; i++) (cols[i] ??= []).sort((x, y) => Number(x.dataset.row) - Number(y.dataset.row));
  const col = Number(at.dataset.col);
  const row = cols[col]?.indexOf(at) ?? -1;
  if (row < 0) return;
  const next = megaMove(
    cols.map((c) => c.length),
    { col, row },
    e.key,
  );
  if (/^(Arrow|Home$|End$)/.test(e.key)) e.preventDefault();
  if (next) cols[next.col][next.row]?.focus();
}

const BarCtx = createContext<BarController | null>(null);

/** The bar's menu controller (null outside the bar: a menu rendered alone in a check is inert). */
export function useBarController(): BarController | null {
  return useContext(BarCtx);
}

/** Holds the controller for the bar and what hangs from it (its menus, the open highlight, the dimmed page). */
export function BarMenusProvider({ children }: { children: React.ReactNode }) {
  const { menuAct, menuNow, menuReturnTo, menu } = useNavUi();
  const ctl = useMemo(() => createBarController(menuAct, menuNow, menuReturnTo), [menuAct, menuNow, menuReturnTo]);
  useEffect(() => ctl.install(), [ctl]);
  // Opened from a button elsewhere (openArea, "All studios"): the asked-for column (or the first row) takes focus.
  useEffect(() => {
    if (menu.id && menu.via === "area") ctl.focusIn(menu.id, menu.group ? { group: menu.group } : "first");
  }, [ctl, menu.id, menu.via, menu.group, menu.seq]);
  return <BarCtx.Provider value={ctl}>{children}</BarCtx.Provider>;
}

/**
 * A new page (a link, back or forward, a notification; a change of query counts) closes the open menu, unless the
 * pointer opened it and is on it now (it rested on an item while the page was loading). Reads the URL: render it
 * inside Suspense.
 */
export function CloseMenusOnRoute() {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const url = `${pathname}?${query}`;
  const ctl = useBarController();
  const { menuNow, menuAct } = useNavUi();
  const at = useRef(url);
  useEffect(() => {
    if (at.current === url) return;
    at.current = url;
    const s = menuNow();
    if (!s.id) return;
    const p = ctl?.part(s.id);
    const held = s.mode === "hover" && (!!p?.trigger?.matches(":hover") || !!p?.surface?.matches(":hover"));
    if (!held) menuAct({ type: "close", now: performance.now() });
  }, [url, ctl, menuNow, menuAct]);
  return null;
}

/**
 * A menu's surface on the page: "open", "exit" (its exit is playing: inert, still painted) or "gone" (hidden). Exits
 * take the fast token (0 under reduced motion).
 */
export function usePresence(open: boolean): "open" | "exit" | "gone" {
  const [gone, setGone] = useState(!open);
  if (open && gone) setGone(false);
  useEffect(() => {
    if (open) return;
    const t = window.setTimeout(() => setGone(true), ms("fast"));
    return () => window.clearTimeout(t);
  }, [open]);
  return open ? "open" : gone ? "gone" : "exit";
}

/**
 * One bar menu's wiring: registers its item and surface with the controller and says how its surface moves.
 * `big`: a full-width panel (Studios, Apps, Motions & effects, Canvas); else a card under its item (Create, More).
 */
export function useBarMenu(id: BarMenuId, { big = false, ready, warm }: { big?: boolean; ready?: () => boolean; warm?: () => void } = {}) {
  const ctl = useBarController();
  const { menu } = useNavUi();
  const open = menu.id === id;
  const phase = usePresence(open);
  useEffect(() => ctl?.register(id, { big, ready, warm }), [ctl, id, big, ready, warm]);
  const triggerRef = useCallback((el: HTMLButtonElement | null) => ctl?.register(id, { trigger: el }), [ctl, id]);
  const surfaceRef = useCallback((el: HTMLElement | null) => ctl?.register(id, { surface: el }), [ctl, id]);
  // How it comes in and goes out: a switch between two big panels slides sideways (the way the pointer went);
  // anything else enters from the bar and leaves the same way.
  const other = open ? menu.prev : menu.id;
  const sideways = big && !!other && !!ctl?.part(other)?.big;
  const dir = open ? switchDirection(menu.prev, id) : switchDirection(id, menu.id);
  // A cross-fade: the new content comes in from half there (motion.css) as the old one leaves (two thirds of fast), so
  // the sheet is never seen empty, even while the pointer sweeps across several items.
  const motion =
    sideways && dir
      ? open
        ? { "--enter-x": `calc(var(--motion-d2) * ${dir})`, "--enter-y": "0px" }
        : { "--exit-x": `calc(var(--motion-d2) * ${-dir})`, "--exit-y": "0px", "--exit-fade": "calc(var(--motion-fast) * .67)" }
      : {};
  return {
    open,
    phase,
    /** A switch from another panel: no column cascade, the content changes as one piece. */
    entered: open && sideways ? ("switch" as const) : ("fresh" as const),
    style: motion as React.CSSProperties,
    triggerRef,
    surfaceRef,
    trigger: ctl?.trigger(id),
    surface: ctl?.surface(id),
    close: (focusBack = false) => ctl?.close(id, focusBack),
  };
}

/** The open item's highlight: one fill that slides from item to item as the open menu changes. */
export function BarIndicator() {
  const ctl = useBarController();
  const { menu } = useNavUi();
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const trig = menu.id ? ctl?.part(menu.id)?.trigger : null;
    if (!trig) {
      el.removeAttribute("data-on");
      return;
    }
    /** Puts the highlight on the item; false when the item is hidden (a narrower window). */
    const place = () => {
      const host = el.parentElement?.getBoundingClientRect();
      const r = trig.getBoundingClientRect();
      if (!host || !r.width) return false;
      el.style.width = `${r.width}px`;
      el.style.height = `${r.height}px`;
      el.style.translate = `${r.left - host.left}px ${r.top - host.top}px`;
      return true;
    };
    // Slides only from one open item to the next; from nothing it shows in place. The slide moves transform only: the
    // box takes the new item's size at once and starts scaled to the old one's width, then settles (FLIP).
    const slide = el.hasAttribute("data-on") && !!menu.prev;
    const was = slide ? { w: parseFloat(el.style.width), t: el.style.translate } : null;
    el.removeAttribute("data-slide");
    const shown = place();
    const w = parseFloat(el.style.width);
    if (shown && was && w > 0 && was.w > 0) {
      const to = el.style.translate;
      el.style.translate = was.t;
      el.style.scale = `${was.w / w} 1`;
      void el.offsetWidth;
      el.setAttribute("data-slide", "");
      el.style.translate = to;
      el.style.scale = "1 1";
    } else el.style.scale = "1 1";
    el.toggleAttribute("data-on", shown);
    // No highlight left between the items that show when its item hides.
    const follow = () => el.toggleAttribute("data-on", place());
    const ro = new ResizeObserver(follow);
    ro.observe(trig);
    window.addEventListener("resize", follow);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", follow);
    };
  }, [ctl, menu.id, menu.prev]);
  return <span ref={ref} aria-hidden data-bar-indicator className="pointer-events-none absolute top-0 left-0 rounded-[10px] print:hidden" />;
}

/**
 * The sheet under the bar that the four big panels share: one surface whose bottom edge moves to the open panel's
 * height (by transform only), so a switch from Studios to Apps grows or shrinks it rather than cutting.
 */
export function BarStage() {
  const ctl = useBarController();
  const { menu } = useNavUi();
  const ref = useRef<HTMLDivElement>(null);
  const big = menu.id && ctl?.part(menu.id)?.big ? menu.id : null;
  const morph = !!big && !!menu.prev && !!ctl?.part(menu.prev)?.big;
  const phase = usePresence(!!big);
  useLayoutEffect(() => {
    // On the bar, so the panels read it too: during a switch each one is cut at the sheet's moving edge (motion.css).
    const host = ref.current?.closest<HTMLElement>("[data-top-bar]") ?? ref.current;
    const panel = big ? ctl?.part(big)?.surface : null;
    if (!host || !panel) return;
    const set = () => host.style.setProperty("--panel-h", `${panel.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(panel);
    return () => ro.disconnect();
  }, [ctl, big]);
  return (
    <div
      ref={ref}
      aria-hidden
      data-mega-stage
      data-phase={phase}
      data-open={big ? "" : undefined}
      data-morph={morph ? "" : undefined}
      className="pointer-events-none absolute inset-x-0 top-full h-[calc(100dvh-3.5rem)] overflow-hidden print:hidden"
    >
      <div data-mega-backdrop className="absolute inset-0">
        <div data-mega-sheet className="absolute inset-0 border-b border-sidebar-border bg-popover shadow-heavy" />
      </div>
    </div>
  );
}

/** Dims the page under any open menu (decoration: presses go through to the page, which closes the menu). */
export function BarScrim() {
  const { openMenu } = useNavUi();
  return <div aria-hidden data-bar-scrim data-open={openMenu ? "" : undefined} className="pointer-events-none fixed inset-x-0 top-14 bottom-0 z-[39] hidden bg-overlay md:block print:hidden" />;
}
