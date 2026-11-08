"use client";

import { ArrowRight, ChevronRight, Plus, RotateCw, Search } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { Fragment, lazy, memo, Suspense, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { IntentLink } from "@/components/intent-link";
import { PausePreviews } from "@/components/pause-previews";
import { usePreviewsPaused } from "@/components/preset-preview";
import { Kbd } from "@/components/ui/kbd";
import { NEW_CREATION_HREF } from "@/lib/nav";
import { bundledMenu, MEGA_AREAS, type MegaColumn, type MegaId, type MegaItem, type MegaModel } from "@/lib/mega-menus";
import { isNew, subParent, type ViewerKind } from "@/lib/nav-model";
import { cn } from "@/lib/utils";
import { clipsAllowed, CoverThumb, useAliveCard, useHasClip } from "./cover-thumb";
import { useMegaMenu } from "./mega-data";
import { megaCurrent, MegaSkeleton } from "./mega-launcher";
import { useViewerKind } from "./nav-ui";

/*
 * A bar menu's panel body (the bar's MegaLauncher): its count line, See all, Pause previews and search; a row of tabs
 * (All, then each group); then every tool as a picture tile. "All" flows the tiles down balanced columns, each group
 * starting with its name wherever it falls, so every column ends at about the same height; a group's tab shows that
 * group alone as a grid. The tiles on screen play their clips, a few at a time (useMenuPlayer). Loaded on its own, when
 * the pointer or focus first comes to a bar item or once the page is idle, so it costs the pages nothing until then.
 */

/** Columns of tiles by the window's width: three on a tablet, four from lg, five from xl (the Tailwind classes below). */
const COLUMNS = "columns-3 lg:columns-4 xl:columns-5";
const GRID = "grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";
const columnsAt = (w: number) => (w >= 1280 ? 5 : w >= 1024 ? 4 : 3);

/**
 * A tile's picture width for its srcset: a fifth of the panel (at most 1680 px less its 24 px sides and 12 px gaps) from
 * xl, a quarter from lg, a third below.
 */
export const TILE_SIZES = "(min-width: 1680px) 316px, (min-width: 1280px) calc((100vw - 96px) / 5), (min-width: 1024px) calc((100vw - 84px) / 4), calc((100vw - 72px) / 3)";

/** How many tiles play their clips at once: enough to bring the menu to life, few enough for any laptop. */
export const PLAY_AT_ONCE = 8;

function NewBadge() {
  return (
    <span data-new className="shrink-0 rounded-full bg-highlight px-1.5 py-px text-[10px] leading-4 font-semibold text-highlight-foreground">
      New
    </span>
  );
}

/**
 * One tool: its picture (4:3), name and line, as one link; a studio's features as small links under it. `playing`:
 * the menu's player has it on (its clip plays over the still, where it has one); a mouse resting on it or the keys
 * focusing it plays it too. `eager`: on the menu's first screen, so its picture loads with the panel.
 */
const MegaTile = memo(function MegaTile({ e, current, inside, now, playing, eager, subCurrent }: { e: MegaItem; current: boolean; inside: boolean; now: number; playing: boolean; eager: boolean; subCurrent?: string }) {
  const { alive, handlers } = useAliveCard();
  const clip = useHasClip(e.navCover, e.cover);
  return (
    <div data-tile={e.id} data-clip={clip ? "" : undefined} className="mb-3 break-inside-avoid">
      <IntentLink
        {...handlers}
        href={e.href}
        data-key=""
        aria-current={current ? "page" : undefined}
        data-active={inside ? "" : undefined}
        title={e.line ? `${e.label}: ${e.line}` : e.label}
        className="nav-row group/tile flex flex-col overflow-hidden rounded-[12px] border bg-card text-card-foreground"
      >
        <CoverThumb id={e.navCover} cover={e.cover} size="card" icon={e.icon} eager={eager} alive={alive || playing} shared={playing && !alive} sizes={TILE_SIZES} className="rounded-none" />
        <span className="flex min-w-0 flex-col gap-0.5 px-[11px] pt-2 pb-2.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn("truncate text-[13.5px] leading-[18px] font-medium", (current || inside) && "font-semibold")}>{e.label}</span>
            {isNew(e, now) && <NewBadge />}
          </span>
          {e.line && <span className="truncate text-[12px] leading-4 text-muted-foreground">{e.line}</span>}
        </span>
      </IntentLink>
      {/* A studio's features (its tabs and modes): every one a click away from the menu. */}
      {e.subs && e.subs.length > 0 && (
        <ul aria-label={`In ${e.label}`} data-subs={e.id} className="flex flex-wrap gap-1 px-0.5 pt-1.5">
          {e.subs.map((s) => (
            <li key={s.id} className="min-w-0">
              <IntentLink
                href={s.href}
                data-key=""
                data-sub=""
                aria-current={subCurrent === s.id ? "page" : undefined}
                aria-label={s.name}
                title={s.line}
                className={cn(
                  "nav-row inline-flex h-7 max-w-full items-center gap-1 rounded-full px-2.5 text-[12px] [@media(pointer:coarse)]:h-9",
                  s.more ? "font-medium text-brand-text" : "bg-muted/70 text-muted-foreground hover:text-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground",
                )}
              >
                <span className="truncate">{s.label}</span>
                {s.more && <ArrowRight aria-hidden className="size-3 shrink-0" />}
              </IntentLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

/** A group's tools in the order the menu shows them: its lead, then the rest (a studio listed under another left out). */
const groupItems = (c: MegaColumn): MegaItem[] => [...(c.lead ? [c.lead] : []), ...c.rows].filter((e) => !e.under);

/**
 * The arrow keys' places (bar-menus.tsx: gridKey reads data-col and data-row): set from where the links land, since the
 * flowing columns decide that. Each link takes the column of its tile's left edge and the next row down in it; set
 * again whenever the layout changes (a tab, the window's size, the owner's Canvas column arriving).
 */
function usePlaceKeys(root: React.RefObject<HTMLElement | null>, key: unknown) {
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const place = () => {
      const links = [...el.querySelectorAll<HTMLElement>("[data-key], [data-col]")].filter((l) => l.offsetParent !== null);
      const lefts: number[] = [];
      const colOf = (l: HTMLElement) => {
        const x = Math.round(((l.closest<HTMLElement>("[data-tile], [data-block]") ?? l).getBoundingClientRect().left));
        let i = lefts.findIndex((v) => Math.abs(v - x) < 6);
        if (i < 0) i = lefts.push(x) - 1;
        return i;
      };
      const placed = links.map((l) => ({ l, col: colOf(l), top: l.getBoundingClientRect().top }));
      const order = [...lefts].sort((a, b) => a - b);
      const cols = new Map<number, typeof placed>();
      for (const p of placed) {
        const c = order.indexOf(lefts[p.col]);
        (cols.get(c) ?? cols.set(c, []).get(c)!).push(p);
      }
      for (const [c, list] of cols) {
        list.sort((a, b) => a.top - b.top);
        list.forEach((p, r) => {
          p.l.dataset.col = String(c);
          p.l.dataset.row = String(r);
        });
      }
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [root, key]);
}

/**
 * The menu's player: the tiles on screen with a clip play it, at most PLAY_AT_ONCE, the first ones first. Nothing plays
 * while the panel is closed or scrolled past, in a hidden tab, with previews paused (Pause previews), under reduced
 * motion or when saving data. Returns the ids playing.
 */
const NONE: ReadonlySet<string> = new Set();

function useMenuPlayer(root: React.RefObject<HTMLElement | null>, key: unknown): ReadonlySet<string> {
  const paused = usePreviewsPaused();
  const [allowed] = useState(() => typeof window !== "undefined" && clipsAllowed());
  const [ids, setIds] = useState<ReadonlySet<string>>(NONE);
  const off = paused || !allowed;
  useEffect(() => {
    const el = root.current;
    if (!el || off) return;
    const tiles = [...el.querySelectorAll<HTMLElement>("[data-tile][data-clip]")];
    const order = new Map(tiles.map((t, i) => [t, i]));
    const seen = new Set<HTMLElement>();
    const update = () => {
      const next = document.hidden ? [] : [...seen].sort((a, b) => order.get(a)! - order.get(b)!).slice(0, PLAY_AT_ONCE).map((t) => t.dataset.tile!);
      setIds((prev) => (prev.size === next.length && next.every((id) => prev.has(id)) ? prev : new Set(next)));
    };
    // The panel scrolls inside itself: its section is the box the tiles must be in to count as on screen.
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          if (e.isIntersecting) seen.add(e.target as HTMLElement);
          else seen.delete(e.target as HTMLElement);
        }
        update();
      },
      { root: el.closest("section"), threshold: 0.6 },
    );
    tiles.forEach((t) => io.observe(t));
    document.addEventListener("visibilitychange", update);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [root, key, off]);
  return off ? NONE : ids;
}

/** The Canvas menu's first column for the owner (New board, recent boards): loaded only once the owner opens it. */
const CanvasOwnerStart = lazy(() => import("./mega-canvas-owner"));

/** The owner's Canvas start while it loads: the New board button and a tile, at their final sizes. */
function OwnerStartSkeleton() {
  return (
    <div aria-hidden className="mb-3 flex flex-col gap-2 break-inside-avoid">
      <span className="h-10 rounded-[10px] bg-muted" />
      <span className="aspect-[4/3] w-full rounded-[12px] bg-muted" />
    </div>
  );
}

/**
 * A menu's tools: the tabs, then "All" (every group, flowing down balanced columns) or one group as a grid. `current`:
 * the open page's item id. `now`: the clock for the "New" badges.
 */
export function MegaGrid({ model, current, now, kind }: { model: MegaModel; current?: string; now: number; kind?: ViewerKind }) {
  const ids = useId();
  const [tab, setTab] = useState(-1);
  const group = tab >= 0 ? model.columns[tab] : undefined;
  const root = useRef<HTMLDivElement>(null);
  const layout = `${model.id}:${tab}`;
  usePlaceKeys(root, layout);
  const playing = useMenuPlayer(root, layout);
  // On a studio's feature (Genjutsu's Restyle, Upscale's Video), its studio is marked as holding the page too.
  const holder = current ? subParent(current) : undefined;
  // The tiles at the top of each column load with the panel (so it never opens on empty boxes); the rest when they show.
  const [cols] = useState(() => (typeof window === "undefined" ? 5 : columnsAt(window.innerWidth)));
  const all = model.columns.flatMap(groupItems);
  const firstScreen = new Set<string>();
  if (group) groupItems(group).slice(0, cols * 2).forEach((e) => firstScreen.add(e.id));
  else for (let c = 0; c < cols; c++) all.slice(Math.floor((c * all.length) / cols), Math.floor((c * all.length) / cols) + 3).forEach((e) => firstScreen.add(e.id));
  const pick = (i: number) => {
    setTab(i);
    root.current?.closest("section")?.scrollTo({ top: 0 });
  };
  const tile = (e: MegaItem) => (
    <MegaTile key={e.id} e={e} current={current === e.id} inside={holder === e.id} now={now} playing={playing.has(e.id)} eager={firstScreen.has(e.id)} subCurrent={current} />
  );
  // Each family's name (Camera motions, Effects) heads its first group.
  const familyHeads = new Map<string, NonNullable<MegaModel["families"]>[number]>();
  for (const f of model.families ?? []) {
    const first = model.columns.find((c) => c.family === f.id);
    if (first) familyHeads.set(first.id, f);
  }
  return (
    <div ref={root}>
      {/* One row of names: All, then each group (its count beside it). Pinned under the panel's header as it scrolls. */}
      <div role="group" aria-label={`Show in ${MEGA_AREAS[model.id].label}`} className="sticky top-[var(--mega-head,0px)] z-10 -mx-6 mb-4 flex gap-1 overflow-x-auto border-b bg-popover px-6 [scrollbar-width:none]">
        {[{ label: "All", n: all.length }, ...model.columns.map((c) => ({ label: c.label, n: groupItems(c).length }))].map((t, i) => {
          const on = tab === i - 1;
          return (
            <button
              key={t.label}
              type="button"
              aria-pressed={on}
              onClick={() => pick(i - 1)}
              className={cn(
                "nav-row -mb-px inline-flex h-10 shrink-0 items-center gap-1.5 rounded-none border-b-2 px-3 text-[13.5px] font-medium whitespace-nowrap [@media(pointer:coarse)]:h-11",
                on ? "border-brand-text text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              <span className="text-[12px] font-normal text-muted-foreground tabular-nums">{t.n}</span>
            </button>
          );
        })}
      </div>
      {group ? (
        <div className={cn("grid gap-x-3", GRID)}>{groupItems(group).map(tile)}</div>
      ) : (
        <div className={cn("gap-x-3", COLUMNS)}>
          {model.columns.map((c, ci) => {
            const famHead = familyHeads.get(c.id);
            const owner = c.owner === "canvas-start" && kind === "owner";
            const items = groupItems(c);
            return (
              <Fragment key={c.id}>
                {famHead && (
                  <p data-family={famHead.id} className="break-after-avoid pt-1 pb-2 font-heading text-[22px] leading-7 text-brand-text">
                    {famHead.label} <span className="font-sans text-[12px] text-muted-foreground tabular-nums">{famHead.count}</span>
                  </p>
                )}
                <p id={`${ids}-${c.id}`} data-group={c.id} className="break-inside-avoid break-after-avoid pb-2">
                  <button type="button" onClick={() => pick(ci)} aria-label={`Show only ${c.label}`} className="nav-row -mx-1.5 flex w-[calc(100%+12px)] min-w-0 items-baseline gap-1.5 rounded-[8px] px-1.5 py-1 text-left">
                    <span className="truncate text-[13.5px] font-semibold">{c.label}</span>
                    <span className="text-[12px] text-muted-foreground tabular-nums">{items.length}</span>
                    <ChevronRight aria-hidden className="ml-auto size-3.5 shrink-0 self-center text-muted-foreground" />
                  </button>
                </p>
                {owner ? (
                  <div data-block="" className="mb-3 break-inside-avoid">
                    <Suspense fallback={<OwnerStartSkeleton />}>
                      <CanvasOwnerStart col={0} labelledBy={`${ids}-${c.id}`} fallback={c.lead && tile(c.lead)} />
                    </Suspense>
                  </div>
                ) : (
                  items.map(tile)
                )}
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Studios' tools as the bar shows them (the checks render it alone). */
export function LauncherColumns({ kind, current, now }: { kind: ViewerKind | undefined; current?: string; now: number }) {
  return <MegaGrid model={bundledMenu("studios", kind)} current={current} now={now} kind={kind} />;
}

/**
 * The pictures a closed panel holds ready for its first frame: those it loads with the panel (the tiles at the top of
 * each column), decoded, so it never opens on empty boxes that fill in after. Resolves once each one is decoded or
 * failed, or after `cap` ms.
 */
function decodePictures(root: HTMLElement, cap = 4000): Promise<void> {
  const imgs = [...root.querySelectorAll<HTMLImageElement>('img:not([loading="lazy"]):not([fetchpriority="low"])')];
  return Promise.race([Promise.allSettled(imgs.map((i) => i.decode())).then(() => {}), new Promise<void>((r) => window.setTimeout(r, cap))]);
}

/**
 * The panel's body once it is shown or warmed: it reads the path (client only: the panel never renders on the server).
 * `onPrimed`: its menu is here and its first screen's pictures are decoded (a hover open waits a moment for it).
 */
export function MegaPanel({ id, onClose, onSearch, onPrimed }: { id: MegaId; onClose: () => void; onSearch: () => void; onPrimed?: () => void }) {
  const kind = useViewerKind();
  const pathname = usePathname();
  const { model, failed, retry } = useMegaMenu(id, kind);
  const [now] = useState(() => Date.now());
  // A new page (a link here, back, a notification) closes it.
  const shownAt = useRef(pathname);
  useEffect(() => {
    if (shownAt.current === pathname) return;
    shownAt.current = pathname;
    onClose();
  }, [pathname, onClose]);
  const area = MEGA_AREAS[id];
  // The query too: moving from one preset to another (/video?preset=…) keeps the path.
  const search = useSearchParams()?.toString() ?? "";
  const root = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const primed = useRef(onPrimed);
  useEffect(() => {
    primed.current = onPrimed;
  });
  useEffect(() => {
    const el = root.current;
    if (!model || !el) return;
    let live = true;
    void decodePictures(el).then(() => live && primed.current?.());
    return () => {
      live = false;
    };
  }, [model]);
  // The tabs pin under the header row as the panel scrolls: its height is where they stop.
  useLayoutEffect(() => {
    const h = head.current;
    const el = root.current;
    if (!h || !el) return;
    const set = () => el.style.setProperty("--mega-head", `${h.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(h);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={root} className="max-w-[1680px] px-6 pb-6 lg:pb-7">
      <div ref={head} className="sticky top-0 z-20 -mx-6 flex min-h-10 items-center gap-3 bg-popover px-6 pt-5 pb-3 lg:pt-6">
        <p className="text-[13px] text-muted-foreground" data-count-line>
          {model ? model.countLine : failed ? "Couldn't load this menu" : " "}
        </p>
        {/* A plain link in Tab order before the tiles; the arrow keys skip it (it has no data-key). */}
        <IntentLink
          href={area.href}
          aria-current={pathname === area.href ? "page" : undefined}
          aria-label={model?.seeAll.name ?? `See all ${area.label.toLowerCase()}`}
          data-see-all
          className="nav-row group/all -ml-1 inline-flex h-8 items-center gap-1 rounded-[8px] px-2 text-[13px] font-medium text-brand-text [@media(pointer:coarse)]:h-11"
        >
          See all
          <ArrowRight aria-hidden className="size-3.5 motion-safe:transition-transform group-hover/all:translate-x-0.5" />
        </IntentLink>
        {id === "create" && (
          <IntentLink href={NEW_CREATION_HREF} eager className="nav-row inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[13px] font-medium [@media(pointer:coarse)]:h-11">
            <Plus aria-hidden className="size-3.5 text-brand-text" />
            New creation
          </IntentLink>
        )}
        {failed && (
          <button type="button" onClick={retry} className="nav-row inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2 text-[13px] font-medium">
            <RotateCw aria-hidden className="size-3.5" />
            Try again
          </button>
        )}
        <span className="flex-1" />
        <PausePreviews className="h-8 [@media(pointer:coarse)]:h-11" />
        <button
          type="button"
          onClick={onSearch}
          aria-keyshortcuts="/"
          className="nav-row inline-flex h-10 items-center gap-2 rounded-[10px] px-2.5 text-[13px] font-medium text-brand-text"
        >
          <Search aria-hidden className="size-4" />
          <span className="max-lg:hidden">Search all apps, effects and tools</span>
          <span className="lg:hidden">Search</span>
          <Kbd aria-hidden className="[@media(hover:none)]:hidden">
            /
          </Kbd>
        </button>
      </div>
      {model ? <MegaGrid model={model} kind={kind} current={megaCurrent(id, pathname, search)} now={now} /> : failed ? null : <MegaSkeleton id={id} />}
    </div>
  );
}

/** Kept for the Studios checks: the Studios panel's body. */
export function LauncherPanel({ onClose, onSearch }: { onClose: () => void; onSearch: () => void }) {
  return <MegaPanel id="studios" onClose={onClose} onSearch={onSearch} />;
}
