"use client";

import { lazy, memo, startTransition, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { MEGA_AREAS, megaMove, megaPanelId, TILE_COLS, type MegaId } from "@/lib/mega-menus";
import { activeEntry, launcherActive, subActive } from "@/lib/nav-model";
import { cn } from "@/lib/utils";
import { shows, useBarController, useBarMenu } from "./bar-menus";
import { BarTrigger } from "./bar-split";
import { menuReady, menusSettled, warmMenu } from "./mega-data";
import { useSearchPalette } from "./search-context";
import { warmNav, type NavPanel } from "./nav-prefetch";

/*
 * The bar's grouped menus: Studios, Apps, Motions & effects and Canvas, one panel under the bar each, grouped by what
 * you want to make, one click and no scrolling (down to 1280x720). A disclosure for navigation (a button that shows a
 * panel of links), not a menu: Tab walks the links in order ("See all" first), and arrow keys move in the grid (up and
 * down a column, left and right to the same place in the next one).
 *
 * How the item opens and closes its panel (rest, click, tap, keys, switching from one to the next) is the bar's
 * controller's (bar-menus.tsx), the same for all six menus. The panel's body (its links, cards and tiles:
 * mega-panel.tsx) is a chunk of its own, loaded when the pointer or focus comes near or soon after the page is ready
 * (preloadMegaPanel), so the first open never waits for it.
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

/**
 * The panel: under the bar, as wide as it, on the bar's shared sheet (it has no background of its own, so a switch
 * cross-fades two panels over one surface); scrolling inside only when the window is too short for it.
 */
export const LAUNCHER_PANEL = "absolute inset-x-0 top-full max-h-[calc(100dvh-3.5rem)] overflow-y-auto overscroll-contain text-popover-foreground";

/** The routes a menu's links lead to that load ahead when it opens (each row also loads on hover: IntentLink). */
const WARM: Record<MegaId, NavPanel> = { studios: "studios", apps: "more", motions: "more", canvas: "more", fx: "fx" };

/** The item of a menu the open page is (aria-current): a studio or one of its features, an app, a preset, a ready board. */
export function megaCurrent(id: MegaId, pathname: string, search = ""): string | undefined {
  if (id === "studios") return subActive(pathname, search) ?? launcherActive(pathname);
  if (id === "apps") return /^\/apps\/([^/]+)$/.exec(pathname)?.[1];
  if (id === "motions") return pathname === "/video" ? (new URLSearchParams(search).get("preset") ?? undefined) : undefined;
  if (id === "fx") return /^\/apps\/([^/]+)$/.exec(pathname)?.[1] ?? subActive(pathname, search) ?? activeEntry(pathname, new URLSearchParams(search))?.id;
  return /^\/canvas\/start\/([^/]+)$/.exec(pathname)?.[1];
}

/** The panel's body, loaded the first time it is asked for (once: the import is cached). */
let panelLoaded = false;
const loadPanel = () =>
  import("./mega-panel").then((m) => {
    panelLoaded = true;
    return m;
  });
/** Memoised: a ready panel stays as it is while the bar's menus open, close and switch (it re-renders on its own data). */
const LazyPanel = lazy(() => loadPanel().then((m) => ({ default: memo(m.MegaPanel) })));

/** Loads the panel's body ahead (the bar does when the page is idle; hover and focus on an item do too). */
export function preloadMegaPanel(): void {
  void loadPanel().catch(() => {});
}

/** The big panels in the bar's order (the order they get ready in when the pointer's place is not known). */
const BAR_ORDER: readonly MegaId[] = ["studios", "fx", "apps", "motions", "canvas"];
/** Each mounted panel: what gets it ready, whether its item shows at this width, and whether its pictures are ready. */
const primers = new Map<MegaId, { heat: () => void; shows: () => boolean; at: () => number | undefined; done: boolean }>();
let primeQueue: MegaId[] | null = null;
let priming: { id: MegaId; timer: number } | null = null;

/** The next panel in the queue whose item shows gets ready; the one after it waits for its pictures (3 s at most). */
function primeNext(): void {
  while (primeQueue?.length) {
    const id = primeQueue.shift()!;
    const p = primers.get(id);
    if (!p || p.done || !p.shows()) continue;
    priming = { id, timer: window.setTimeout(() => primed(id), 3000) };
    p.heat();
    return;
  }
}

/** `id`'s first screen is ready (or its time ran out): the next panel's turn. */
function primed(id: MegaId): void {
  const p = primers.get(id);
  if (p) p.done = true;
  if (priming?.id !== id) return;
  window.clearTimeout(priming.timer);
  priming = null;
  primeNext();
}

/**
 * The pointer or focus came to the bar: every big panel whose item shows renders its body, closed, so its first
 * screen's pictures load and decode before it opens, and a switch from one to the next never shows empty boxes. One
 * panel at a time, nearest the pointer first (`x`: where it came in; else the bar's order), so a slow connection gets
 * the ones it is about to open whole first (the item the pointer is on gets its own ready at once, as ever).
 */
export function primeMegaPanels(x?: number): void {
  if (primeQueue) return;
  const far = (id: MegaId) => {
    const c = x === undefined ? undefined : primers.get(id)?.at();
    return c === undefined ? Infinity : Math.abs(c - x!);
  };
  primeQueue = [...BAR_ORDER].sort((a, b) => far(a) - far(b));
  // The pictures wait for the panels' code and the menus' data, so on a slow connection they never hold up an open.
  void loadPanel()
    .catch(() => {})
    .then(menusSettled)
    .then(primeNext);
}

/** While a menu's data (or the panel's body) is on its way: its columns at their final sizes, so nothing moves when it comes. */
export function MegaSkeleton({ id }: { id?: MegaId }) {
  if (id === "canvas") {
    return (
      <div aria-hidden data-mega-skeleton className="grid grid-cols-3 gap-x-4 gap-y-6 lg:grid-cols-6 lg:gap-x-3">
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
    <div aria-hidden data-mega-skeleton className="grid grid-cols-3 gap-x-4 gap-y-6 lg:grid-cols-6 lg:gap-x-3">
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

/**
 * A bar item with a full-width panel (Studios, Apps, Motions & effects, Canvas): one button that shows and hides the
 * panel. The panel hangs from the bar (the header is its positioned parent), spans it, and sits on the bar's shared
 * sheet (BarStage). It is in the DOM straight after its item (Tab goes item, panel, next item), hidden and inert while
 * closed; its body loads the first time the pointer or focus comes near (or soon after the page is ready).
 * `active`: one of the area's pages is open (its own page included).
 */
export function MegaLauncher({ id, active, className }: { id: MegaId; active?: boolean; className?: string }) {
  const area = MEGA_AREAS[id];
  const search = useSearchPalette();
  const [warm, setWarm] = useState(false);
  const heat = useCallback(() => {
    warmMenu(id);
    preloadMegaPanel();
    setWarm(true);
  }, [id]);
  // Its first screen's pictures are decoded (MegaPanel's onPrimed): a hover open waits a moment for them too.
  const pictures = useRef(false);
  const onPrimed = useCallback(() => {
    pictures.current = true;
    primed(id);
  }, [id]);
  const ready = useCallback(() => panelLoaded && menuReady(id) && pictures.current, [id]);
  const { open, phase, close, entered, style, trigger, surface, triggerRef, surfaceRef } = useBarMenu(id, { big: true, ready, warm: heat });
  const shown = warm || open;
  const ctl = useBarController();

  // Its place in the bar's queue of panels getting ready (primeMegaPanels): only while its item shows at this width.
  useEffect(() => {
    const t = () => ctl?.part(id)?.trigger;
    const at = () => {
      const r = t()?.getBoundingClientRect();
      return r?.width ? r.left + r.width / 2 : undefined;
    };
    // Rendered as a transition: the closed body's render yields to the pointer and keys (never one long task).
    const prime = () => {
      warmMenu(id);
      preloadMegaPanel();
      startTransition(() => setWarm(true));
    };
    primers.set(id, { heat: prime, shows: () => !!t() && shows(t()!), at, done: pictures.current });
    return () => {
      primers.delete(id);
    };
  }, [ctl, id]);

  // The body's callbacks keep one identity, so the memoised body never re-renders when a menu opens or switches.
  const closeRef = useRef(close);
  const searchRef = useRef(search);
  useEffect(() => {
    closeRef.current = close;
    searchRef.current = search;
  });
  const onClose = useCallback(() => closeRef.current(), []);
  const onSearch = useCallback(() => {
    // The item gets focus first, so it is where Esc in the search comes back to (the panel is gone by then).
    closeRef.current(true);
    searchRef.current.open();
  }, []);

  // Opened: the routes one click here leads to start loading.
  useEffect(() => {
    if (open) warmNav(WARM[id]);
  }, [open, id]);

  return (
    <>
      <BarTrigger
        id={id}
        panelId={megaPanelId(id)}
        href={area.href}
        label={area.label}
        active={active}
        open={open}
        handlers={trigger}
        triggerRef={triggerRef}
        data-mega={id}
        data-mega-trigger={id}
        data-studios-trigger={id === "studios" || undefined}
        /* Open, its hit area reaches down to the panel: resting in the gap between them keeps the menu. */
        className={cn("data-[open]:after:absolute data-[open]:after:inset-x-0 data-[open]:after:top-full data-[open]:after:h-2 data-[open]:after:content-['']", className)}
      />
      <section
        ref={surfaceRef}
        id={megaPanelId(id)}
        data-mega-panel={id}
        data-phase={phase}
        data-mega-enter={entered}
        aria-label={area.panel}
        hidden={phase === "gone"}
        inert={phase !== "open"}
        aria-hidden={phase === "exit" || undefined}
        style={style}
        {...surface}
        className={LAUNCHER_PANEL}
      >
        {shown && (
          /* The body's place while its chunk loads: the count line's height, then the columns' skeleton. */
          <Suspense
            fallback={
              <div className="max-w-[1680px] px-6 pt-5 pb-6 lg:pt-6 lg:pb-7">
                <div className="min-h-10 pb-4" />
                <MegaSkeleton id={id} />
              </div>
            }
          >
            <LazyPanel
              id={id}
              onPrimed={onPrimed}
              onClose={onClose}
              onSearch={onSearch}
            />
          </Suspense>
        )}
      </section>
    </>
  );
}
