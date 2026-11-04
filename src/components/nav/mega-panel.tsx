"use client";

import { ArrowRight, RotateCw, Search } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { Fragment, lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { IntentLink } from "@/components/intent-link";
import { Kbd } from "@/components/ui/kbd";
import { MEGA_AREAS, ROW_CAPS, studiosMenu, TILE_COLS, type MegaColumn, type MegaId, type MegaItem, type MegaModel } from "@/lib/mega-menus";
import { isNew, subParent, type ViewerKind } from "@/lib/nav-model";
import { cn } from "@/lib/utils";
import { CoverThumb } from "./cover-thumb";
import { useMegaMenu } from "./mega-data";
import { megaCurrent, MegaSkeleton } from "./mega-launcher";
import { useViewerKind } from "./nav-ui";

/*
 * A grouped menu's panel body (the bar's MegaLauncher): its count line, See all and search, then its columns of links.
 * Loaded on its own, when the pointer or focus first comes to a bar item with a menu or once the page is idle, so the
 * links, cards and tiles cost the pages nothing until then.
 */

/**
 * A list row from this index on hides on a short window, so the panel never scrolls (the fetched menus; Studios fits).
 * A menu with family headings (Motions & effects) gives a short window's last row to that heading line.
 */
const ROW_HIDE = (i: number, families = false) =>
  cn(
    i >= ROW_CAPS.short - (families ? 1 : 0) && "[@media(max-height:799.98px)]:hidden",
    i >= ROW_CAPS.mid && "[@media(max-height:959.98px)]:hidden",
    i >= ROW_CAPS.tall && "hidden",
  );

function NewBadge() {
  return <span className="shrink-0 rounded-full bg-highlight px-1.5 py-px text-[10px] leading-4 font-semibold text-highlight-foreground">New</span>;
}

/** A column's first card: its cover, name and one line. `row` 1 under the owner's New board (Canvas), its cover shorter by that button. */
export function LeadCard({ e, col, row = 0, current, inside, now }: { e: MegaItem; col: number; row?: number; current: boolean; inside?: boolean; now: number }) {
  return (
    <IntentLink
      href={e.href}
      data-col={col}
      data-row={row}
      aria-current={current ? "page" : undefined}
      data-active={inside ? "" : undefined}
      className="nav-row group/lead flex flex-col overflow-hidden rounded-[14px] border bg-card text-card-foreground"
    >
      <CoverThumb
        id={e.navCover}
        cover={e.cover}
        size="lead"
        icon={e.icon}
        eager
        className={cn(
          "rounded-none md:max-lg:max-h-[max(56px,calc(100dvh-460px))]",
          row ? "max-h-[max(64px,calc(100dvh-640px))]" : "max-h-[max(64px,calc(100dvh-592px))]",
        )}
      />
      <span className="nav-mark-start flex min-w-0 flex-col gap-0.5 px-3 pt-2.5 pb-3 md:max-lg:px-2.5 md:max-lg:py-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[14px] leading-[18px] font-semibold md:max-lg:text-[13px]">{e.label}</span>
          {isNew(e, now) && <NewBadge />}
        </span>
        <span title={e.line} className="truncate text-[12px] leading-4 text-muted-foreground md:max-lg:hidden">
          {e.line}
        </span>
      </span>
    </IntentLink>
  );
}

function Row({ e, col, row, current, inside, now, className }: { e: MegaItem; col: number; row: number; current: boolean; inside?: boolean; now: number; className?: string }) {
  return (
    <IntentLink
      href={e.href}
      data-col={col}
      data-row={row}
      aria-current={current ? "page" : undefined}
      data-active={inside ? "" : undefined}
      title={e.line ? `${e.label}: ${e.line}` : e.label}
      className={cn("nav-row nav-mark-start -mx-2 flex min-h-11 items-center gap-3 rounded-[10px] px-2 py-1.5 md:max-lg:min-h-10", className)}
    >
      {/* Six columns leave a row its name and line below 1440 px, and its name alone below 1280 px. Its picture loads
          when the row shows (lazy): a row hidden by the window's height never fetches it. */}
      <CoverThumb id={e.navCover} cover={e.cover} size="row" icon={e.icon} className="max-[1439.98px]:hidden" />
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn("truncate text-[13px] leading-[18px] font-medium max-xl:line-clamp-2 max-xl:whitespace-normal", (current || inside) && "font-semibold")}>{e.label}</span>
          {isNew(e, now) && <NewBadge />}
        </span>
        {/* A studio whose links become one line on a short window gives that line its own line's room. */}
        <span className={cn("truncate text-[12px] leading-4 text-muted-foreground max-xl:hidden", e.subsLine && "[@media(max-height:799.98px)]:hidden")}>{e.line}</span>
      </span>
    </IntentLink>
  );
}

/**
 * Below the window height a studio's links need, they hide, so the panel never scrolls inside. With a mouse they are
 * 24 px names; on a touch screen pills 44 px to tap (nav-subs.css), so they need a taller window there.
 */
const HIDE_SHORT: Record<800 | 880 | 960, string> = {
  800: "[@media(max-height:799.98px)]:hidden",
  880: "[@media(max-height:879.98px)]:hidden",
  960: "[@media(max-height:959.98px)]:hidden",
};
const HIDE_TOUCH: Record<800 | 880 | 960, string> = {
  800: "[@media(pointer:coarse)_and_(max-height:1023.98px)]:hidden",
  880: "[@media(pointer:coarse)_and_(max-height:1099.98px)]:hidden",
  960: "[@media(pointer:coarse)_and_(max-height:1199.98px)]:hidden",
};
/** `line`: with a mouse they become one line of names there instead (nav-subs.css), so only a touch screen hides them. */
const hideBelow = (h: 800 | 880 | 960, line = false) => cn(!line && HIDE_SHORT[h], HIDE_TOUCH[h]);

/**
 * What a studio holds inside (its tabs and modes), as links under its card or row: names only, smaller and quieter
 * than the rows, hung from a hairline under the studio (nav-subs.css: with a mouse, two 24 px names to a
 * row's 48 px, so the columns' rows stay in line; pills on a touch screen; one wrapped line of names below the height a
 * studio with `subsLine` needs). `row`: the first link's place for the arrow keys (they go down from the studio through
 * its links to the next row). `current`: the open page's feature. `under`: links under a row, whose names start where
 * the row's name does.
 */
function SubLinks({ e, col, row, current, under }: { e: MegaItem; col: number; row: number; current?: string; under?: boolean }) {
  if (!e.subs?.length) return null;
  // An odd number of links ends half a row short: a 24 px pad fills it (the owner's taller-window links come in twos).
  const odd = e.subs.filter((s) => !s.from).length % 2 === 1;
  return (
    <ul
      aria-label={`In ${e.label}`}
      data-subs={e.id}
      data-odd={odd ? "" : undefined}
      data-subs-line={e.subsLine ? "" : undefined}
      className={cn("nav-subs ml-[17px] border-l border-border pl-1 max-[1439.98px]:ml-1.5", under && "min-[1440px]:pl-[21px]", e.subsFrom && hideBelow(e.subsFrom, e.subsLine))}
    >
      {e.subs.map((s, i) => (
        <li key={s.id} data-from={s.from ? "" : undefined} className={cn(s.from && hideBelow(s.from))}>
          <IntentLink
            href={s.href}
            data-col={col}
            data-row={row + i}
            data-sub=""
            aria-current={current === s.id ? "page" : undefined}
            aria-label={s.name}
            title={s.line}
            className={cn(
              "nav-row nav-mark-start group/sub flex items-center gap-1",
              s.more ? "font-medium text-brand-text" : "text-muted-foreground hover:text-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground",
            )}
          >
            <span className="truncate">{s.label}</span>
            {s.more && <ArrowRight aria-hidden className="size-3 shrink-0 motion-safe:transition-transform group-hover/sub:translate-x-0.5" />}
          </IntentLink>
        </li>
      ))}
    </ul>
  );
}

/**
 * A ready board as a 16:9 tile: its peak frame (the finished scene), its name and one line. The first row's pictures
 * load with the panel; a later row's when it shows (lazy: a row hidden by the window's height never fetches its own).
 */
function Tile({ e, col, row, current, eager }: { e: MegaItem; col: number; row: number; current: boolean; eager: boolean }) {
  return (
    <IntentLink
      href={e.href}
      data-col={col}
      data-row={row}
      aria-current={current ? "page" : undefined}
      title={e.line ? `${e.label}: ${e.line}` : e.label}
      className="nav-row nav-mark-under flex min-w-0 flex-col gap-1.5 rounded-[12px] p-1.5"
    >
      <CoverThumb cover={e.cover} size="tile16" icon={e.icon} eager={eager} />
      <span className="flex min-w-0 flex-col px-0.5">
        <span className={cn("truncate text-[13px] leading-[18px] font-medium", current && "font-semibold")}>{e.label}</span>
        <span className="truncate text-[12px] leading-4 text-muted-foreground">{e.line}</span>
      </span>
    </IntentLink>
  );
}

/** Tiles across a tiles column. */
const across = (c: MegaColumn) => Math.min(c.span ?? 1, TILE_COLS);

/**
 * Where each column's links sit for the arrow keys: its first key column and first row. A list column is one key
 * column, a tiles column one per tile across. Tiles columns one under the other (Canvas' sections) share their key
 * columns, the lower one's rows after the upper one's, so ArrowDown goes on from one section into the next.
 */
export function keyPlaces(columns: readonly MegaColumn[]): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = [];
  let next = 0;
  columns.forEach((c, i) => {
    const prev = columns[i - 1];
    if (c.variant === "tiles" && prev?.variant === "tiles") {
      out.push({ col: out[i - 1].col, row: out[i - 1].row + Math.ceil(prev.rows.length / across(prev)) });
      return;
    }
    out.push({ col: next, row: 0 });
    next += c.variant === "tiles" ? across(c) : 1;
  });
  return out;
}

/** Grid tracks a column takes: its span from lg (six tracks), the whole row below it (three). */
const SPAN: Record<number, string> = { 1: "", 2: "col-span-3 lg:col-span-2", 3: "col-span-3", 4: "col-span-3 lg:col-span-4", 6: "col-span-3 lg:col-span-6" };

/** The Canvas menu's first column for the owner (New board, recent boards): loaded only once the owner opens it. */
const CanvasOwnerStart = lazy(() => import("./mega-canvas-owner"));

/** The owner's first Canvas column while it loads: the New board button, then a lead card, at their final sizes. */
function OwnerStartSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-2">
      <span className="h-10 rounded-[10px] bg-muted" />
      <span className="aspect-[4/3] max-h-[max(64px,calc(100dvh-640px))] w-full rounded-t-[14px] bg-muted" />
      <span className="-mt-2 h-[59px] rounded-b-[14px] bg-muted/60" />
    </div>
  );
}

/**
 * A menu's columns as links (no behaviour): one per group, its label, then the lead card and rows (or the cover
 * tiles). Family headings (Motions & effects) sit over their own columns: in the order they are read, and from lg in
 * one row above all of them. `current`: the open page's item id. `now`: the clock for the "New" badges.
 */
export function MegaColumns({ model, current, now, kind }: { model: MegaModel; current?: string; now: number; kind?: ViewerKind }) {
  const ids = useId();
  const capped = model.id !== "studios";
  const families = !!model.families?.length;
  const tileColumns = model.columns.filter((c) => c.variant === "tiles").length;
  const places = keyPlaces(model.columns);
  // On a studio's feature (Genjutsu's Restyle, Upscale's Video), its studio is marked as holding the page too.
  const holder = current ? subParent(current) : undefined;

  const column = (c: MegaColumn, ci: number) => {
    const { col, row: firstRow } = places[ci];
    const labelId = `${ids}-${c.id}`;
    const label = (
      <p id={labelId} title={c.label} className="truncate text-[11px] leading-4 font-semibold tracking-[.08em] text-brand-text uppercase">
        {c.label}
      </p>
    );
    // Two tiles sections stack on the right (Canvas): the first column takes both rows.
    const place = cn(SPAN[c.span ?? 1], families && "lg:row-start-2", tileColumns > 1 && c.variant !== "tiles" && "lg:row-span-2");
    if (c.owner === "canvas-start" && kind === "owner") {
      return (
        <div key={c.id} data-group={c.id} className={cn("flex min-w-0 flex-col gap-2", place)}>
          {label}
          <Suspense fallback={<OwnerStartSkeleton />}>
            <CanvasOwnerStart col={col} labelledBy={labelId} fallback={c.lead && <LeadCard e={c.lead} col={col} row={1} current={false} now={now} />} />
          </Suspense>
        </div>
      );
    }
    if (c.variant === "tiles") {
      const n = across(c);
      return (
        <div key={c.id} data-group={c.id} className={cn("flex min-w-0 flex-col gap-2", place)}>
          <div className="flex min-w-0 items-center gap-2">
            {label}
            {c.more && (
              <IntentLink href={c.more.href} className="nav-row group/all -my-2 ml-auto inline-flex h-8 shrink-0 items-center gap-1 rounded-[8px] px-2 text-[12px] font-medium text-brand-text">
                {c.more.label}
                <ArrowRight aria-hidden className="size-3.5 motion-safe:transition-transform group-hover/all:translate-x-0.5" />
              </IntentLink>
            )}
          </div>
          <ul aria-labelledby={labelId} className="grid gap-x-3 gap-y-2" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
            {c.rows.map((e, i) => {
              const row = Math.floor(i / n);
              // Two sections: one row of tiles each below 900 px of height, two from 900 px.
              return (
                <li key={e.id} className={cn(tileColumns > 1 && row >= 1 && "[@media(max-height:899.98px)]:hidden")}>
                  <Tile e={e} col={col + (i % n)} row={firstRow + row} current={current === e.id} eager={row === 0} />
                </li>
              );
            })}
          </ul>
        </div>
      );
    }
    // A studio listed under another (Ads Studio under Marketing Studio) is one of its links, not a row of its own.
    const rows = c.rows.filter((e) => !e.under);
    // Places for the arrow keys, top to bottom: the lead (0), its links, then each row and its links.
    let next = 1 + (c.lead?.subs?.length ?? 0);
    const at = rows.map((e) => {
      const r = next;
      next += 1 + (e.subs?.length ?? 0);
      return r;
    });
    return (
      <div key={c.id} data-group={c.id} className={cn("flex min-w-0 flex-col gap-2", place)}>
        {label}
        <ul aria-labelledby={labelId} className="flex flex-col gap-0.5">
          {c.lead && (
            <li className="pb-1.5">
              <LeadCard e={c.lead} col={col} current={current === c.lead.id} inside={holder === c.lead.id} now={now} />
              <SubLinks e={c.lead} col={col} row={1} current={current} />
            </li>
          )}
          {rows.map((e, ri) => (
            <li key={e.id} className={capped ? ROW_HIDE(ri, families) : undefined}>
              <Row e={e} col={col} row={at[ri]} current={current === e.id} inside={holder === e.id} now={now} />
              <SubLinks e={e} col={col} row={at[ri] + 1} current={current} under />
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-6 lg:grid-cols-6 2xl:gap-x-6">
      {families
        ? model.families!.map((f) => (
            <Fragment key={f.id}>
              <div className={cn("flex items-center gap-2 border-b pb-1.5 lg:row-start-1", f.span >= 3 ? "col-span-3" : SPAN[f.span])} data-family={f.id}>
                <p className="text-[12px] leading-4 font-semibold text-foreground">
                  {f.label} <span className="font-normal text-muted-foreground tabular-nums">· {f.count}</span>
                </p>
                <IntentLink href={f.href} aria-label={`See all ${f.label.toLowerCase()}`} className="nav-row group/all ml-auto inline-flex h-8 items-center gap-1 rounded-[8px] px-2 text-[12px] font-medium text-brand-text">
                  See all
                  <ArrowRight aria-hidden className="size-3.5 motion-safe:transition-transform group-hover/all:translate-x-0.5" />
                </IntentLink>
              </div>
              {model.columns.map((c, ci) => (c.family === f.id ? column(c, ci) : null))}
            </Fragment>
          ))
        : model.columns.map(column)}
    </div>
  );
}


/** Studios' columns as the bar shows them (the checks render it alone). */
export function LauncherColumns({ kind, current, now }: { kind: ViewerKind | undefined; current?: string; now: number }) {
  return <MegaColumns model={studiosMenu(kind)} current={current} now={now} kind={kind} />;
}

/** The panel's body once it is shown or warmed: it reads the path (client only: the panel never renders on the server). */
export function MegaPanel({ id, onClose, onSearch }: { id: MegaId; onClose: () => void; onSearch: () => void }) {
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
  return (
    <div className="max-w-[1440px] px-6 pt-5 pb-6 lg:pt-6 lg:pb-7">
      <div className="flex min-h-10 items-center gap-3.5 pb-4">
        <p className="text-[13px] text-muted-foreground" data-count-line>
          {model ? model.countLine : failed ? "Couldn't load this menu" : " "}
        </p>
        {/* A plain link in Tab order before the grid; the grid's arrow keys skip it (it has no data-col). */}
        <IntentLink
          href={area.href}
          aria-current={pathname === area.href ? "page" : undefined}
          aria-label={model?.seeAll.name ?? `See all ${area.label.toLowerCase()}`}
          data-see-all
          className="nav-row group/all -ml-1 inline-flex h-9 items-center gap-1 rounded-[10px] px-2 text-[13px] font-medium text-brand-text"
        >
          See all
          <ArrowRight aria-hidden className="size-3.5 motion-safe:transition-transform group-hover/all:translate-x-0.5" />
        </IntentLink>
        {failed && (
          <button type="button" onClick={retry} className="nav-row inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2 text-[13px] font-medium">
            <RotateCw aria-hidden className="size-3.5" />
            Try again
          </button>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onSearch}
          aria-keyshortcuts="/"
          className="nav-row inline-flex h-10 items-center gap-2 rounded-[10px] px-2.5 text-[13px] font-medium text-brand-text"
        >
          <Search aria-hidden className="size-4" />
          Search all apps, effects and tools
          <Kbd aria-hidden className="[@media(hover:none)]:hidden">
            /
          </Kbd>
        </button>
      </div>
      {model ? <MegaColumns model={model} kind={kind} current={megaCurrent(id, pathname, search)} now={now} /> : failed ? null : <MegaSkeleton id={id} />}
    </div>
  );
}

/** Kept for the Studios checks: the Studios panel's body. */
export function LauncherPanel({ onClose, onSearch }: { onClose: () => void; onSearch: () => void }) {
  return <MegaPanel id="studios" onClose={onClose} onSearch={onSearch} />;
}
