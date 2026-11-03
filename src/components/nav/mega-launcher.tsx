"use client";

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { IntentLink } from "@/components/intent-link";
import { MEGA_AREAS, megaMove, megaPanelId, TILE_COLS, type MegaId } from "@/lib/mega-menus";
import { launcherActive, studioCount } from "@/lib/nav-model";
import { isPlainClick } from "@/lib/use-tapped-tab";
import { cn } from "@/lib/utils";
import { BAR_CHEVRON, BAR_LABEL, BAR_SPLIT, BarChevron, useHoverIntent } from "./bar-split";
import { warmMenu } from "./mega-data";
import { useNavUi } from "./nav-ui";
import { useSearchPalette } from "./search-context";
import { warmNav, type NavPanel } from "./nav-prefetch";

/*
 * The bar's grouped menus: Studios, Apps, Motions & effects and Canvas, one panel under the bar each, grouped by what
 * you want to make, one click and no scrolling (down to 1280x720). A disclosure for navigation (a button that shows a
 * panel of links), not a menu: Tab walks the links in order, and arrow keys move in the grid (up and down a column,
 * left and right to the same place in the next one). Esc, a click outside or focus leaving it closes it; Esc gives
 * focus back to what opened it. One open at a time: opening one closes the others and the bar's Radix menus.
 *
 * The item's name goes to the area's page; its chevron (a click, Enter or Space) or ArrowDown on the name opens the
 * panel. Resting the mouse on an item opens it too (not on the item of the page you are on; it closes again when the
 * pointer leaves the item and the panel, unless a click or a key pinned it), and while one is open, moving onto another
 * item switches to that one at once, as a menubar does. The panel is mounted, hidden, the first time the
 * pointer or focus comes to the item, so its data and lead covers load before it opens. The panel's body (its links,
 * cards and tiles: mega-panel.tsx) is a chunk of its own, loaded then or once the page is idle (preloadMegaPanel).
 */

/** The Studios panel's id (kept: the browser checks and the "All studios" buttons name it). */
export const LAUNCHER_ID = megaPanelId("studios");

/** Every studio on one page, with covers and lines ("See all", the bar item's name). */
export const STUDIOS_AREA_HREF = MEGA_AREAS.studios.href;

/** Kept for the Studios checks: the arrow keys' moves (megaMove). */
export const launcherMove = megaMove;

/** The launcher entry a page is on (a hub mode not in the launcher counts as its studio), for aria-current. */
export function launcherCurrent(pathname: string): string | undefined {
  return launcherActive(pathname);
}

/** The panel: under the bar, as wide as it, scrolling inside only when the window is too short for it. */
export const LAUNCHER_PANEL =
  "absolute inset-x-0 top-full max-h-[calc(100dvh-3.5rem)] overflow-y-auto overscroll-contain border-b border-sidebar-border bg-popover text-popover-foreground shadow-heavy motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-150";

/** The routes a menu's links lead to that load ahead when it opens (each row also loads on hover: IntentLink). */
const WARM: Record<MegaId, NavPanel> = { studios: "studios", apps: "more", motions: "more", canvas: "more" };

/** The item of a menu the open page is (aria-current): a studio, an app, a preset, a ready board. */
export function megaCurrent(id: MegaId, pathname: string, search = ""): string | undefined {
  if (id === "studios") return launcherActive(pathname);
  if (id === "apps") return /^\/apps\/([^/]+)$/.exec(pathname)?.[1];
  if (id === "motions") return pathname === "/video" ? (new URLSearchParams(search).get("preset") ?? undefined) : undefined;
  return /^\/canvas\/start\/([^/]+)$/.exec(pathname)?.[1];
}

/** The panel's body, loaded the first time it is asked for (once: the import is cached). */
const loadPanel = () => import("./mega-panel");
const LazyPanel = lazy(() => loadPanel().then((m) => ({ default: m.MegaPanel })));

/** Loads the panel's body ahead (the bar does when the page is idle; hover and focus on an item do too). */
export function preloadMegaPanel(): void {
  void loadPanel().catch(() => {});
}

/** While a menu's data (or the panel's body) is on its way: its columns at their final sizes, so nothing moves when it comes. */
export function MegaSkeleton({ id }: { id?: MegaId }) {
  if (id === "canvas") {
    return (
      <div aria-hidden className="grid grid-cols-3 gap-x-4 gap-y-6 lg:grid-cols-6 2xl:gap-x-6">
        <div className="col-span-3 flex flex-col gap-2 lg:col-span-2">
          <span className="h-4 w-24 rounded bg-muted" />
          <span className="aspect-[4/3] max-h-[max(64px,calc(100dvh-592px))] w-full rounded-t-[14px] bg-muted" />
          <span className="-mt-2 h-[60px] rounded-b-[14px] bg-muted/60" />
        </div>
        <div className="col-span-3 flex flex-col gap-2 lg:col-span-4">
          <span className="h-4 w-28 rounded bg-muted" />
          <span className="grid gap-x-3 gap-y-2" style={{ gridTemplateColumns: `repeat(${TILE_COLS}, minmax(0, 1fr))` }}>
            {Array.from({ length: TILE_COLS * 2 }, (_, i) => (
              <span key={i} className="flex flex-col gap-1.5 p-1.5">
                <span className="aspect-video rounded-[10px] bg-muted" />
                <span className="h-[34px] rounded bg-muted/50" />
              </span>
            ))}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div aria-hidden className="grid grid-cols-3 gap-x-4 gap-y-6 lg:grid-cols-6 2xl:gap-x-6">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <span className="h-4 w-24 rounded bg-muted" />
          <span className="aspect-[4/3] max-h-[max(64px,calc(100dvh-592px))] w-full rounded-t-[14px] bg-muted" />
          <span className="-mt-2 h-[60px] rounded-b-[14px] bg-muted/60" />
          {Array.from({ length: 7 }, (_, r) => (
            <span key={r} className={cn("h-11 rounded-[10px] bg-muted/50", r >= 6 && "[@media(max-height:799.98px)]:hidden")} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Visible on the page (not inside a hidden row or a closed panel). */
const shows = (el: Element) => (typeof (el as HTMLElement).checkVisibility === "function" ? (el as HTMLElement).checkVisibility() : el.getClientRects().length > 0);

/**
 * A bar item with a grouped menu: its name goes to the area's page, its chevron (or ArrowDown on the name) opens the
 * panel. The panel hangs from the bar (the header is its positioned parent) and spans it.
 * `active`: one of the area's pages is open; `current`: the area's own page; `onTap`: the name was clicked.
 */
export function MegaLauncher({
  id,
  active,
  current,
  onTap,
  className,
}: {
  id: MegaId;
  active?: boolean;
  current?: boolean;
  onTap?: (href: string) => void;
  className?: string;
}) {
  const { openMenu, setOpenMenu, menuGroup, menuReturnTo } = useNavUi();
  const open = openMenu === id;
  const area = MEGA_AREAS[id];
  const search = useSearchPalette();
  const [warm, setWarm] = useState(false);
  const shown = warm || open;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const label = useRef<HTMLAnchorElement>(null);
  const panel = useRef<HTMLElement>(null);
  // How it was opened: with its button or a key (focus to the first lead card), from the name (Esc comes back to the
  // name), or from elsewhere (openArea: the group asked for).
  const how = useRef<"button" | "name" | "hover" | null>(null);
  // Opened while another of the bar's grouped menus was open: it takes that one's place without a second entrance.
  const [switched, setSwitched] = useState(false);
  // Counts each opening (a click on a menu the mouse opened counts too: focus moves in then).
  const [opening, setOpening] = useState(0);

  const heat = useCallback(() => {
    warmMenu(id);
    preloadMegaPanel();
    setWarm(true);
  }, [id]);

  const close = useCallback(
    (returnFocus: boolean) => {
      const back = menuReturnTo();
      const from = how.current;
      how.current = null;
      setOpenMenu(null);
      if (returnFocus) (back?.isConnected ? back : from === "name" ? label.current : trigger.current)?.focus();
    },
    [menuReturnTo, setOpenMenu],
  );
  const closeQuietly = useCallback(() => {
    if (openMenu === id) close(false);
  }, [close, openMenu, id]);

  const show = useCallback(
    (by: "button" | "name" | "hover") => {
      how.current = by;
      setSwitched(!!openMenu && openMenu !== id);
      setOpening((n) => n + 1);
      heat();
      setOpenMenu(id);
    },
    [heat, openMenu, id, setOpenMenu],
  );

  // Resting the mouse opens it (never on its own page, which it would only cover).
  const hover = useHoverIntent(
    open,
    useCallback(() => show("hover"), [show]),
    useCallback(() => close(false), [close]),
    !!current,
  );

  useEffect(() => {
    if (!open) return;
    // Opened: the routes one click here leads to start loading.
    warmNav(WARM[id]);
    // Opened by resting the mouse: focus stays where it was (a prompt being typed keeps its keys).
    if (how.current === "hover") return;
    const byKey = how.current === "button" || how.current === "name";
    // The panel's links may come a moment later (a fetched menu): focus the asked-for column's lead once there.
    const focus = () => {
      const p = panel.current;
      if (!p) return false;
      const group = !byKey && menuGroup ? p.querySelector<HTMLElement>(`[data-group="${menuGroup}"] [data-row="0"]`) : null;
      const at = group ?? p.querySelector<HTMLElement>('[data-col="0"][data-row="0"]');
      at?.focus();
      return !!at;
    };
    if (focus()) return;
    const obs = new MutationObserver(() => focus() && obs.disconnect());
    if (panel.current) obs.observe(panel.current, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [open, opening, menuGroup, id]);

  // While open: a press outside closes it (the press goes on to what it was on), and Esc closes it from anywhere.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      // A press on another grouped menu's item opens that one in this one's place (no second entrance), closing this.
      if ((e.target as Element | null)?.closest?.("[data-mega]")) return;
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      close(true);
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
    };
  }, [open, close]);

  const toggle = (by: "button" | "name") => {
    // Opened by resting the mouse: a click keeps it open (pinned) and moves focus in, as on a closed one.
    if (open && hover.openedByHover()) {
      hover.pin();
      how.current = by;
      setOpening((n) => n + 1);
      return;
    }
    hover.pin();
    if (open) return close(false);
    show(by);
  };

  const onPanelKey = (e: React.KeyboardEvent) => {
    const at = (e.target as HTMLElement).closest<HTMLElement>("[data-col]");
    if (!at || !panel.current) return;
    // Columns as the keys see them: the links that show, top to bottom (a row hidden by the window's height is skipped,
    // and a section under another goes on from it).
    const cols: HTMLElement[][] = [];
    for (const el of panel.current.querySelectorAll<HTMLElement>("[data-col]")) {
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
  };

  // The mouse moves the keyboard's place: the link under it takes focus (quietly: the ring is the keyboard's), so the
  // arrow keys go on from where the mouse left off and only one link is ever highlighted.
  const onPanelPointer = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const at = (e.target as HTMLElement).closest<HTMLElement>("[data-col]");
    if (at && at !== document.activeElement) at.focus({ preventScroll: true });
  };

  const n = id === "studios" ? studioCount() : undefined;
  return (
    <div
      ref={root}
      className="contents"
      onBlur={(e) => {
        // Focus went somewhere else on the page (Tab past the last link, a click on a field): close. Focus lost to
        // nothing (a press on the panel's padding) keeps it open; a press outside closes it above.
        const to = e.relatedTarget as Node | null;
        if (open && to && !root.current?.contains(to)) close(false);
      }}
    >
      <div
        data-bar-split
        data-mega={id}
        data-active={active || undefined}
        data-open={open || undefined}
        className={cn(BAR_SPLIT, className)}
        // The panel mounts, hidden, so its data and covers load before it opens.
        onPointerEnter={(e) => {
          heat();
          hover.enter(e, !!openMenu && openMenu !== id);
        }}
        onPointerLeave={hover.leave}
      >
        <IntentLink
          ref={label}
          href={area.href}
          aria-current={current ? "page" : undefined}
          aria-label={n !== undefined ? `${area.label}, ${n} studios` : undefined}
          className={BAR_LABEL}
          onFocus={heat}
          onClick={(e) => {
            if (open) close(false);
            if (isPlainClick(e)) onTap?.(area.href);
          }}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" || e.altKey || e.metaKey || e.ctrlKey || open) return;
            e.preventDefault();
            toggle("name");
          }}
        >
          {area.label}
          {n !== undefined && <span className="rounded-full bg-brand-faint px-1.5 py-px text-[11px] leading-4 font-semibold text-brand-text tabular-nums">{n}</span>}
        </IntentLink>
        <button
          ref={trigger}
          type="button"
          aria-label={area.menu}
          aria-expanded={open}
          // The panel is on the page once warmed (hover, focus) or open.
          aria-controls={shown ? megaPanelId(id) : undefined}
          data-studios-trigger={id === "studios" || undefined}
          data-mega-trigger={id}
          data-state={open ? "open" : "closed"}
          className={BAR_CHEVRON}
          onFocus={heat}
          // Click, Enter and Space open it with focus on the first lead card (arrow keys and Tab go on from there).
          onClick={() => toggle("button")}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" || open) return;
            e.preventDefault();
            toggle("button");
          }}
        >
          <BarChevron />
        </button>
      </div>
      {shown && (
        <section
          ref={panel}
          id={megaPanelId(id)}
          data-mega-panel={id}
          aria-label={area.panel}
          hidden={!open}
          onKeyDown={onPanelKey}
          onPointerMove={onPanelPointer}
          onClick={(e) => {
            if ((e.target as Element).closest("a[href]")) close(false);
          }}
          onPointerEnter={hover.enter}
          onPointerLeave={hover.leave}
          data-switched={switched || undefined}
          className={cn(LAUNCHER_PANEL, switched && "motion-safe:animate-none")}
        >
          {/* The body's place while its chunk loads: the count line's height, then the columns' skeleton. */}
          <Suspense
            fallback={
              <div className="max-w-[1440px] px-6 pt-5 pb-6 lg:pt-6 lg:pb-7">
                <div className="min-h-10 pb-4" />
                <MegaSkeleton id={id} />
              </div>
            }
          >
            <LazyPanel
              id={id}
              onClose={closeQuietly}
              onSearch={() => {
                // The item gets focus first, so it is where Esc in the search comes back to (the panel is gone by then).
                close(true);
                search.open();
              }}
            />
          </Suspense>
        </section>
      )}
    </div>
  );
}

/** The bar's Studios item (MegaLauncher for Studios). */
export function StudiosLauncher(props: { active?: boolean; current?: boolean; onTap?: (href: string) => void }) {
  return <MegaLauncher id="studios" {...props} />;
}

/** Dims the page under an open grouped menu (decoration: presses go through to the page, which closes the menu). */
export function MegaScrim() {
  const { openMenu } = useNavUi();
  if (!openMenu) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-14 bottom-0 z-[39] hidden bg-overlay md:block motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150 print:hidden"
    />
  );
}

/** Kept name: the scrim under the launcher. */
export const LauncherScrim = MegaScrim;
