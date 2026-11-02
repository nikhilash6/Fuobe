"use client";

import { ChevronDown, MoreHorizontal, Plus, Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { IntentLink } from "@/components/intent-link";
import { DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { NEW_CREATION_HREF } from "@/lib/nav";
import { area, areaOfPath, areaPageOf, type AreaId } from "@/lib/nav-areas";
import { activeEntry, entry, type NavEntry } from "@/lib/nav-model";
import { isPlainClick, useTappedTab } from "@/lib/use-tapped-tab";
import { cn } from "@/lib/utils";
import { BarSplitMenu } from "./bar-split";
import { CoverThumb, NavIcon } from "./cover-thumb";
import { CreateMenu } from "./create-menu";
import { MENU_ROW_2, NavMenuItem, ROW_LINE, rowName, SeeAllRow } from "./nav-row";
import { useViewerKind } from "./nav-ui";
import { useSearchPalette } from "./search-context";
import { BarPills } from "./status-chips";
import { NavPrefetcher, warmNav } from "./nav-prefetch";
import { LauncherScrim, StudiosLauncher } from "./studios-launcher";
import { ViewerSlot } from "./viewer-slot";

export { prefetchHrefs } from "./nav-prefetch";

/*
 * The top bar (md and up): the wordmark, Create, Studios (the launcher), Apps, Motions & effects, Canvas, Assist and
 * Library; search; New creation; who is looking. 56 px on every page. What doesn't fit moves into More, by CSS alone
 * (nothing is measured, so nothing moves after the first paint):
 *   1440 and up   everything, search 280 px, a guest's Log in
 *   1280-1439     Canvas and Assist in More, search 200 px
 *   1024-1279     Apps and Motions & effects in More too
 *   768-1023      the same, search and New creation as icon buttons
 * Measured with the site's fonts for a guest, an account and the owner, a classic scrollbar's width to spare at every
 * width. Below md the phone tabs take over (phone-tabs.tsx).
 */

/**
 * A bar item (link, menu button, the launcher's button). Its states are the nav's (nav-states.css): the highlight on
 * hover or keyboard focus, foreground words and a turned chevron while its menu is open, and for the open page (aria-current, or data-active: the page is
 * one of its destinations) a pip under the words, never a fill.
 */
export const BAR_ITEM =
  "nav-row nav-mark-under group/bar-item inline-flex h-10 shrink-0 [@media(pointer:coarse)]:h-11 items-center gap-1.5 rounded-[10px] px-2.5 text-[14px] whitespace-nowrap text-foreground/80 nav-hover:text-foreground focus-visible:text-foreground data-[state=open]:text-foreground data-[active]:font-semibold data-[active]:text-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground min-[1440px]:px-3.5";

/**
 * Which bar item holds the open page, one item per page (areaOfPath): Create for the create tools, Studios for a studio
 * or one of its tools, Apps for the apps, Motions & effects for both galleries, each for its own area page; Canvas,
 * Assist and Library for theirs. `page`: the area whose own page this is (its name is marked aria-current).
 */
export function barActive(pathname: string): {
  create: boolean;
  studios: boolean;
  apps: boolean;
  motions: boolean;
  canvas: boolean;
  assist: boolean;
  library: boolean;
  page: AreaId | undefined;
} {
  const e = pathname ? activeEntry(pathname, new URLSearchParams()) : undefined;
  const area = pathname ? areaOfPath(pathname) : undefined;
  return {
    create: area === "create",
    studios: area === "studios",
    apps: area === "apps",
    motions: area === "motions",
    canvas: e?.id === "canvas",
    assist: e?.id === "assist",
    library: e?.kind === "library",
    page: pathname ? areaPageOf(pathname) : undefined,
  };
}

type Active = ReturnType<typeof barActive>;
const NONE: Active = barActive("");

function RichItem({ e, current }: { e: NavEntry; current: boolean }) {
  return (
    <NavMenuItem asChild className={MENU_ROW_2}>
      <IntentLink href={e.href} aria-current={current ? "page" : undefined}>
        <CoverThumb id={e.cover} size="row" icon={e.icon} eager />
        <span className="flex min-w-0 flex-col">
          <span className={rowName(current)}>{e.label}</span>
          <span className={ROW_LINE}>{e.what}</span>
        </span>
      </IntentLink>
    </NavMenuItem>
  );
}

const pick = (ids: string[]) => ids.map((id) => entry(id)).filter((e): e is NavEntry => !!e);

/** The open page among the galleries and tools in a menu (the menu's content renders on the client only, when open). */
function useOn(): (e: NavEntry) => boolean {
  const pathname = usePathname();
  return (e) => pathname === e.href || pathname.startsWith(`${e.href}/`);
}

const MOTIONS_AREA_HREF = area("motions").href;

function MotionsItems() {
  const on = useOn();
  return (
    <>
      {pick(["motions", "effects"]).map((e) => (
        <RichItem key={e.id} e={e} current={on(e)} />
      ))}
      <SeeAllRow href={MOTIONS_AREA_HREF} name="See all motions & effects" className="mt-1" />
    </>
  );
}

/** Motions & effects: its name goes to the page with both; the menu holds the two preset galleries, with their covers. */
function MotionsMenu({ active, onTap }: { active: Active; onTap?: (href: string) => void }) {
  return (
    <BarSplitMenu
      href={MOTIONS_AREA_HREF}
      label="Motions & effects"
      name="Motions & effects menu"
      active={active.motions}
      current={active.page === "motions"}
      panel="more"
      onTap={onTap}
      className="hidden xl:inline-flex"
      contentClassName="w-80 p-1.5"
    >
      <MotionsItems />
    </BarSplitMenu>
  );
}

function MoreItems() {
  const on = useOn();
  return (
    <>
      {pick(["apps", "motions", "effects"]).map((e) => (
        <div key={e.id} className="xl:hidden">
          <RichItem e={e} current={on(e)} />
        </div>
      ))}
      <div className="xl:hidden">
        <SeeAllRow href={MOTIONS_AREA_HREF} name="See all motions & effects" className="mt-1" />
        <DropdownMenuSeparator className="mx-2.5 my-1.5" />
      </div>
      {pick(["canvas", "assist"]).map((e) => {
        return (
          <NavMenuItem key={e.id} asChild className={MENU_ROW_2}>
            <IntentLink href={e.href} eager={e.eager} aria-current={on(e) ? "page" : undefined}>
              <span className="grid h-[27px] w-9 shrink-0 place-items-center rounded-[6px] bg-muted">
                <NavIcon name={e.icon} className="nav-icon size-4 text-muted-foreground" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className={rowName(on(e))}>{e.label}</span>
                <span className={ROW_LINE}>{e.what}</span>
              </span>
            </IntentLink>
          </NavMenuItem>
        );
      })}
    </>
  );
}

/** More: the bar's items that don't fit at this width (each hides here where the bar shows it). */
function MoreMenu({ active }: { active: Active }) {
  return (
    <DropdownMenu modal={false} onOpenChange={(o) => o && warmNav("more")}>
      <DropdownMenuTrigger
        // Marked when it holds the open page at this width: Canvas and Assist always; Apps, Motions and Effects below xl.
        className={cn(BAR_ITEM, "min-[1440px]:hidden max-xl:data-[narrow]:font-semibold max-xl:data-[narrow]:text-foreground")}
        data-active={active.canvas || active.assist || undefined}
        data-narrow={active.apps || active.motions || undefined}
      >
        <MoreHorizontal aria-hidden className="size-4" />
        More
        <ChevronDown aria-hidden className="size-3.5 text-muted-foreground group-data-[state=open]/bar-item:rotate-180 motion-safe:transition-transform" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="w-80 p-1.5">
        <MoreItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The bar's links and menus, with the open page's item marked (`active`). `onTap`: a link was clicked, so it is marked
 * from the next frame on, before its page arrives.
 */
function BarLinks({ active, onTap }: { active: Active; onTap?: (href: string) => void }) {
  const cur = (on: boolean) => (on ? "page" : undefined);
  const tap = (href: string) => (e: React.MouseEvent) => isPlainClick(e) && onTap?.(href);
  return (
    <>
      <CreateMenu active={active.create} current={active.page === "create"} onTap={onTap} />
      <StudiosLauncher active={active.studios} current={active.page === "studios"} onTap={onTap} />
      <IntentLink href="/apps" onClick={tap("/apps")} aria-current={cur(active.apps)} className={cn(BAR_ITEM, "hidden xl:inline-flex")}>
        Apps
      </IntentLink>
      <MotionsMenu active={active} onTap={onTap} />
      <IntentLink href="/canvas" onClick={tap("/canvas")} aria-current={cur(active.canvas)} className={cn(BAR_ITEM, "hidden min-[1440px]:inline-flex")}>
        Canvas
      </IntentLink>
      <IntentLink href="/assist" eager onClick={tap("/assist")} aria-current={cur(active.assist)} className={cn(BAR_ITEM, "hidden min-[1440px]:inline-flex")}>
        Assist
      </IntentLink>
      <IntentLink href="/library" eager onClick={tap("/library")} aria-current={cur(active.library)} className={BAR_ITEM}>
        Library
      </IntentLink>
      <MoreMenu active={active} />
    </>
  );
}

/** Reads the path (runtime data) inside Suspense, so the shell still prerenders; the fallback marks nothing. */
function ActiveBarLinks() {
  const pathname = usePathname();
  const [tapped, onTap] = useTappedTab<string>(pathname);
  return <BarLinks active={barActive(tapped ?? pathname)} onTap={onTap} />;
}

/** Search, styled as a field from lg (an icon button at md): opens the palette; hover or focus starts loading it. */
function SearchField() {
  const search = useSearchPalette();
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-keyshortcuts="/ Meta+K Control+K"
      onClick={() => search.open()}
      onPointerEnter={() => search.warm()}
      onFocus={() => search.warm()}
      className={cn(
        "nav-focus inline-flex h-10 shrink-0 items-center gap-2 rounded-[10px] text-[13.5px] [@media(pointer:coarse)]:h-11 text-muted-foreground motion-safe:transition-colors",
        "w-10 justify-center nav-hover:bg-[var(--nav-hi)] nav-hover:text-foreground active:bg-[var(--nav-press)] [@media(pointer:coarse)]:w-11",
        "lg:max-[1439.98px]:w-[200px] lg:justify-start lg:border lg:border-input lg:bg-background/60 lg:px-3 lg:nav-hover:border-border-strong lg:nav-hover:bg-background lg:active:bg-background min-[1440px]:w-[280px]",
      )}
    >
      <Search aria-hidden className="size-[18px] shrink-0 lg:size-4" />
      {/* Its name is the words it shows: "Search Fuobe" to 1439 px, the longer line from 1440 (sr-only below lg). */}
      <span className="sr-only min-w-0 flex-1 truncate text-left lg:not-sr-only">
        <span className="min-[1440px]:hidden">Search Fuobe</span>
        <span className="hidden min-[1440px]:inline">Search studios, apps, effects…</span>
      </span>
      <Kbd aria-hidden className="hidden lg:inline-flex [@media(hover:none)]:hidden">
        /
      </Kbd>
    </button>
  );
}

/**
 * New creation: Home with a fresh composer. Text from lg; an icon with its name for screen readers at md. Filled for an
 * account or the owner; an outline for a guest (html[data-viewer], set before the first paint), whose one filled button
 * is Sign up.
 */
function NewCreation() {
  return (
    <IntentLink
      href={NEW_CREATION_HREF}
      eager
      className="nav-focus-out inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full border border-border-strong px-2.5 text-[14px] font-semibold whitespace-nowrap text-foreground nav-hover:bg-[var(--nav-hi)] active:bg-[var(--nav-press)] [@media(pointer:coarse)]:h-11 [html[data-viewer]:not([data-viewer=guest])_&]:border-transparent [html[data-viewer]:not([data-viewer=guest])_&]:bg-primary [html[data-viewer]:not([data-viewer=guest])_&]:text-primary-foreground [html[data-viewer]:not([data-viewer=guest])_&]:nav-hover:bg-primary/90 [html[data-viewer]:not([data-viewer=guest])_&]:active:bg-primary/85 motion-safe:transition-colors lg:pr-4 lg:pl-3"
    >
      <Plus aria-hidden className="size-[18px]" />
      <span className="sr-only lg:not-sr-only">New creation</span>
    </IntentLink>
  );
}

/** The right-hand cluster's live parts read who is looking once (one subscription for the pills and the avatar). */
function RightCluster() {
  const kind = useViewerKind();
  return (
    <>
      <BarPills kind={kind} />
      <SearchField />
      <NewCreation />
      <ViewerSlot />
    </>
  );
}

/** The bar. Hidden below md and in print; same height on every page, full-screen studios included. */
export function TopBar() {
  return (
    <>
      <header
        data-top-bar
        className="sticky top-0 z-40 hidden h-14 items-center gap-1 border-b border-sidebar-border bg-sidebar/90 pr-4 pl-5 backdrop-blur-md md:flex lg:max-[1439.98px]:pr-5 min-[1440px]:pr-6 print:hidden"
      >
        <nav aria-label="Main" className="flex min-w-0 items-center gap-0.5">
          <IntentLink
            href="/"
            eager
            aria-label="Fuobe home"
            className="nav-focus mr-1.5 inline-flex shrink-0 items-center self-stretch rounded-md px-1 font-heading text-[24px] leading-none lg:mr-3"
          >
            Fuobe
          </IntentLink>
          <Suspense fallback={<BarLinks active={NONE} />}>
            <ActiveBarLinks />
          </Suspense>
        </nav>
        <span className="min-w-2 flex-1" />
        <div className="flex shrink-0 items-center gap-2">
          <RightCluster />
        </div>
      </header>
      <LauncherScrim />
      <NavPrefetcher />
    </>
  );
}
