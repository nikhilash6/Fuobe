"use client";

import { ArrowRight, Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { IntentLink } from "@/components/intent-link";
import { Kbd } from "@/components/ui/kbd";
import { area } from "@/lib/nav-areas";
import { isNew, launcherActive, launcherColumns, studioCount, type NavEntry, type ViewerKind } from "@/lib/nav-model";
import { isPlainClick } from "@/lib/use-tapped-tab";
import { cn } from "@/lib/utils";
import { BAR_CHEVRON, BAR_LABEL, BAR_SPLIT, BarChevron } from "./bar-split";
import { CoverThumb } from "./cover-thumb";
import { useNavUi, useViewerKind } from "./nav-ui";
import { useSearchPalette } from "./search-context";
import { warmNav } from "./nav-prefetch";

/*
 * Studios: every studio on one panel under the bar, grouped by what you want to make, one click and no scrolling (down to
 * 1280x720, and 1024x768). A disclosure for navigation (a button that shows a panel of links), not a menu: Tab walks the
 * links in order, and arrow keys move in the grid (up and down a column, left and right to the same place in the next
 * one). Esc, a click outside or focus leaving it closes it; Esc gives focus back to what opened it.
 */

export const LAUNCHER_ID = "studios-launcher";

/** Every studio on one page, with covers and lines ("See all", the bar item's name). */
export const STUDIOS_AREA_HREF = area("studios").href;

export type LauncherKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End";

/**
 * Where an arrow key goes from `at` in columns of `lengths` links (row 0 is the lead card): up and down within the
 * column, stopping at its ends; left and right to the same row of the neighbouring column, or its last when shorter;
 * Home and End to the column's first and last. Null when the key goes nowhere (an edge, another key).
 */
export function launcherMove(lengths: readonly number[], at: { col: number; row: number }, key: string): { col: number; row: number } | null {
  const { col, row } = at;
  const len = lengths[col] ?? 0;
  if (!len) return null;
  let next: { col: number; row: number } | null = null;
  if (key === "ArrowDown") next = row < len - 1 ? { col, row: row + 1 } : null;
  else if (key === "ArrowUp") next = row > 0 ? { col, row: row - 1 } : null;
  else if (key === "Home") next = { col, row: 0 };
  else if (key === "End") next = { col, row: len - 1 };
  else if (key === "ArrowLeft" || key === "ArrowRight") {
    let c = col + (key === "ArrowLeft" ? -1 : 1);
    while (c >= 0 && c < lengths.length && !lengths[c]) c += key === "ArrowLeft" ? -1 : 1;
    next = c >= 0 && c < lengths.length ? { col: c, row: Math.min(row, lengths[c] - 1) } : null;
  }
  return next && (next.col !== col || next.row !== row) ? next : null;
}

/** The launcher entry a page is on (a hub mode not in the launcher counts as its studio), for aria-current. */
export function launcherCurrent(pathname: string): string | undefined {
  return launcherActive(pathname);
}

/** The panel: under the bar, as wide as it, scrolling inside only when the window is too short for it. */
export const LAUNCHER_PANEL =
  "absolute inset-x-0 top-full max-h-[calc(100dvh-3.5rem)] overflow-y-auto overscroll-contain border-b border-sidebar-border bg-popover text-popover-foreground shadow-heavy motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-150";

const LINK_FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-ring";

function NewBadge() {
  return <span className="shrink-0 rounded-full bg-highlight px-1.5 py-px text-[10px] leading-4 font-semibold text-highlight-foreground">New</span>;
}

function LeadCard({ e, col, current, now }: { e: NavEntry; col: number; current: boolean; now: number }) {
  return (
    <IntentLink
      href={e.href}
      data-col={col}
      data-row={0}
      aria-current={current ? "page" : undefined}
      className={cn(
        "group/lead flex flex-col overflow-hidden rounded-[14px] border bg-card text-card-foreground hover:border-border-strong motion-safe:transition-colors motion-reduce:transition-none",
        current && "border-brand-text/40 bg-brand-faint",
        LINK_FOCUS,
      )}
    >
      <CoverThumb
        id={e.cover}
        size="lead"
        icon={e.icon}
        eager
        className="max-h-[max(64px,calc(100dvh-592px))] rounded-none md:max-lg:max-h-[max(56px,calc(100dvh-460px))]"
      />
      <span className="flex min-w-0 flex-col gap-0.5 px-3 pt-2.5 pb-3 md:max-lg:px-2.5 md:max-lg:py-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn("truncate text-[14px] leading-snug font-semibold md:max-lg:text-[13px]")}>{e.label}</span>
          {isNew(e, now) && <NewBadge />}
        </span>
        <span className="line-clamp-2 text-[12px] leading-[1.35] text-muted-foreground md:max-lg:hidden">{e.what}</span>
      </span>
    </IntentLink>
  );
}

function Row({ e, col, row, current, now }: { e: NavEntry; col: number; row: number; current: boolean; now: number }) {
  return (
    <IntentLink
      href={e.href}
      data-col={col}
      data-row={row}
      aria-current={current ? "page" : undefined}
      title={e.label}
      className={cn(
        "flex min-h-11 items-center gap-2.5 rounded-[10px] px-2 py-1.5 hover:bg-accent motion-safe:transition-colors motion-reduce:transition-none md:max-lg:min-h-9 md:max-lg:px-1.5",
        current && "bg-brand-faint",
        LINK_FOCUS,
      )}
    >
      {/* Six columns leave a row its name and line below 1440 px, and its name alone below 1280 px. */}
      <CoverThumb id={e.cover} size="row" icon={e.icon} eager className="max-[1439.98px]:hidden" />
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn("truncate text-[13px] leading-snug font-medium max-xl:line-clamp-2 max-xl:whitespace-normal", current && "font-semibold")}>{e.label}</span>
          {isNew(e, now) && <NewBadge />}
        </span>
        <span className="line-clamp-2 text-[11.5px] leading-snug text-muted-foreground max-xl:hidden">{e.what}</span>
      </span>
    </IntentLink>
  );
}

/**
 * The launcher's columns as links (no behaviour): one per group, its label, the lead card and the rest. `current`: the
 * open page's entry id. `now`: the clock for the "New" badges.
 */
export function LauncherColumns({ kind, current, now }: { kind: ViewerKind | undefined; current?: string; now: number }) {
  const ids = useId();
  return (
    <div className="grid grid-cols-6 gap-4 2xl:gap-6">
      {launcherColumns(kind).map((c, ci) => (
        <div key={c.group.id} data-group={c.group.id} className="flex min-w-0 flex-col gap-2">
          <p id={`${ids}-${c.group.id}`} className="px-0.5 text-[11px] leading-4 font-semibold tracking-[.08em] text-brand-text uppercase">
            {c.group.label}
          </p>
          <ul aria-labelledby={`${ids}-${c.group.id}`} className="flex flex-col gap-0.5">
            <li className="pb-1.5">
              <LeadCard e={c.lead} col={ci} current={current === c.lead.id} now={now} />
            </li>
            {c.rest.map((e, ri) => (
              <li key={e.id}>
                <Row e={e} col={ci} row={ri + 1} current={current === e.id} now={now} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The panel's body once it is shown or warmed: it reads the path (client only: the panel never renders on the server). */
export function LauncherPanel({ onClose, onSearch }: { onClose: () => void; onSearch: () => void }) {
  const kind = useViewerKind();
  const pathname = usePathname();
  const [now] = useState(() => Date.now());
  // A new page (a link here, back, a notification) closes it.
  const shownAt = useRef(pathname);
  useEffect(() => {
    if (shownAt.current === pathname) return;
    shownAt.current = pathname;
    onClose();
  }, [pathname, onClose]);
  return (
    <div className="mx-auto max-w-[1440px] px-6 pt-5 pb-6 lg:px-10 lg:pt-6 lg:pb-7">
      <div className="flex items-center gap-3.5 pb-4">
        <p className="text-[13px] text-muted-foreground">{studioCount()} studios, grouped by what you want to make</p>
        {/* A plain link in Tab order before the grid; the grid's arrow keys skip it (it has no data-col). */}
        <IntentLink
          href={STUDIOS_AREA_HREF}
          aria-current={pathname === STUDIOS_AREA_HREF ? "page" : undefined}
          aria-label="See all studios"
          className={cn("group/all -ml-1 inline-flex h-9 items-center gap-1 rounded-[10px] px-2 text-[13px] font-medium text-brand-text hover:bg-brand-faint", LINK_FOCUS)}
        >
          See all
          <ArrowRight aria-hidden className="size-3.5 motion-safe:transition-transform group-hover/all:translate-x-0.5" />
        </IntentLink>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onSearch}
          aria-keyshortcuts="/"
          className={cn("inline-flex h-9 items-center gap-2 rounded-[10px] px-2.5 text-[13px] font-medium text-brand-text hover:bg-brand-faint", LINK_FOCUS)}
        >
          <Search aria-hidden className="size-4" />
          Search all apps, effects and tools
          <Kbd aria-hidden className="[@media(hover:none)]:hidden">
            /
          </Kbd>
        </button>
      </div>
      <LauncherColumns kind={kind} current={launcherCurrent(pathname)} now={now} />
    </div>
  );
}

/**
 * The bar's Studios item and its panel: its name goes to /studios, its chevron (or ArrowDown on the name) opens the
 * panel. The panel hangs from the bar (the header is its positioned parent) and spans it. It
 * is mounted, hidden, the first time the pointer or focus comes to the item, so its covers are loading before the click.
 * `active`: a studio's page is open; `current`: /studios itself; `onTap`: the name was clicked.
 */
export function StudiosLauncher({ active, current, onTap }: { active?: boolean; current?: boolean; onTap?: (href: string) => void }) {
  const { launcherOpen: open, setLauncherOpen, launcherGroup, launcherReturnTo } = useNavUi();
  const search = useSearchPalette();
  const [warm, setWarm] = useState(false);
  const shown = warm || open;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  // Opened with this button: it takes focus to the first lead card. Opened from elsewhere (an "All studios" button,
  // openStudios): focus goes to the lead card of the group asked for.
  const byButton = useRef(false);

  const close = useCallback(
    (returnFocus: boolean) => {
      const back = launcherReturnTo();
      setLauncherOpen(false);
      if (returnFocus) (back?.isConnected ? back : trigger.current)?.focus();
    },
    [launcherReturnTo, setLauncherOpen],
  );
  const closeQuietly = useCallback(() => close(false), [close]);

  useEffect(() => {
    if (!open) return;
    // Opened: the routes one click here leads to start loading.
    warmNav("studios");
    const col = byButton.current ? 0 : Math.max(0, launcherColumns(undefined).findIndex((c) => c.group.id === (launcherGroup ?? "film")));
    byButton.current = false;
    panel.current?.querySelector<HTMLElement>(`[data-col="${col}"][data-row="0"]`)?.focus();
  }, [open, launcherGroup]);

  // While open: a press outside closes it (the press goes on to what it was on), and Esc closes it from anywhere.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
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

  const toggle = () => {
    if (open) return close(false);
    byButton.current = true;
    setWarm(true);
    setLauncherOpen(true);
  };

  const onPanelKey = (e: React.KeyboardEvent) => {
    const at = (e.target as HTMLElement).closest<HTMLElement>("[data-col]");
    if (!at || !panel.current) return;
    const lengths = [...panel.current.querySelectorAll("[data-group]")].map((g) => g.querySelectorAll("[data-col]").length);
    const next = launcherMove(lengths, { col: Number(at.dataset.col), row: Number(at.dataset.row) }, e.key);
    if (/^(Arrow|Home$|End$)/.test(e.key)) e.preventDefault();
    if (next) panel.current.querySelector<HTMLElement>(`[data-col="${next.col}"][data-row="${next.row}"]`)?.focus();
  };

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
        data-active={active || undefined}
        data-open={open || undefined}
        className={BAR_SPLIT}
        // The panel mounts, hidden, so its covers load before a click (it opens by a click or a key only: it spans the
        // page, so resting the pointer on the bar never covers it).
        onPointerEnter={() => setWarm(true)}
      >
        <IntentLink
          href={STUDIOS_AREA_HREF}
          aria-current={current ? "page" : undefined}
          aria-label={`Studios, ${studioCount()} studios`}
          className={BAR_LABEL}
          onFocus={() => setWarm(true)}
          onClick={(e) => {
            if (open) close(false);
            if (isPlainClick(e)) onTap?.(STUDIOS_AREA_HREF);
          }}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" || e.altKey || e.metaKey || e.ctrlKey || open) return;
            e.preventDefault();
            toggle();
          }}
        >
          Studios
          <span className="rounded-full bg-brand-faint px-1.5 py-px text-[11px] leading-4 font-semibold text-brand-text tabular-nums">{studioCount()}</span>
        </IntentLink>
        <button
          ref={trigger}
          type="button"
          aria-label="Studios menu"
          aria-expanded={open}
          // The panel is on the page once warmed (hover, focus) or open.
          aria-controls={shown ? LAUNCHER_ID : undefined}
          data-studios-trigger
          data-state={open ? "open" : "closed"}
          className={BAR_CHEVRON}
          onFocus={() => setWarm(true)}
          // Click, Enter and Space open it with focus on the first lead card (arrow keys and Tab go on from there).
          onClick={toggle}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" || open) return;
            e.preventDefault();
            toggle();
          }}
        >
          <BarChevron />
        </button>
      </div>
      {shown && (
        <section
          ref={panel}
          id={LAUNCHER_ID}
          aria-label="All studios"
          hidden={!open}
          onKeyDown={onPanelKey}
          onClick={(e) => {
            if ((e.target as Element).closest("a[href]")) close(false);
          }}
          className={LAUNCHER_PANEL}
        >
          <LauncherPanel
            onClose={closeQuietly}
            onSearch={() => {
              // Studios gets focus first, so it is where Esc in the search comes back to (the panel is gone by then).
              close(true);
              search.open();
            }}
          />
        </section>
      )}
    </div>
  );
}

/** Dims the page under the open launcher (decoration: presses go through to the page, which closes the launcher). */
export function LauncherScrim() {
  const { launcherOpen } = useNavUi();
  if (!launcherOpen) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-14 bottom-0 z-[39] hidden bg-overlay md:block motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150 print:hidden"
    />
  );
}
