"use client";

import { MoreHorizontal, Plus, Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { IntentLink } from "@/components/intent-link";
import { Kbd } from "@/components/ui/kbd";
import { NEW_CREATION_HREF } from "@/lib/nav";
import { area, areaOfPath, areaPageOf, type AreaId } from "@/lib/nav-areas";
import { activeEntry, entry, type NavEntry } from "@/lib/nav-model";
import { isPlainClick, useTappedTab } from "@/lib/use-tapped-tab";
import { cn } from "@/lib/utils";
import { CoverThumb, NavIcon } from "./cover-thumb";
import { CreateMenu } from "./create-menu";
import { CARD_ROW, MENU_ROW_2, ROW_LINE, rowName, SeeAllRow } from "./nav-row";
import { useNavUi, useViewerKind } from "./nav-ui";
import { useSearchPalette } from "./search-context";
import { BarPills } from "./status-chips";
import { NavPrefetcher, warmNav } from "./nav-prefetch";
import type { FetchedMegaId } from "@/lib/mega-menus";
import { loadMenusNow } from "./mega-data";
import { MegaLauncher, preloadMegaPanel } from "./mega-launcher";
import { BarCardMenu } from "./bar-split";
import { BarIndicator, BarMenusProvider, BarScrim, BarStage, CloseMenusOnRoute, useBarController } from "./bar-menus";
import { ViewerSlot } from "./viewer-slot";

export { prefetchHrefs } from "./nav-prefetch";

/*
 * The top bar (md and up): the wordmark, Create, Studios (the launcher), Fuobe FX, Apps, Motions & effects, Canvas, Assist and
 * Library; search; New creation; who is looking. 56 px on every page. What doesn't fit moves into More, by CSS alone
 * (nothing is measured, so nothing moves after the first paint):
 *   1600 and up   everything, search 280 px, a guest's Log in
 *   1440-1599     the same, search 220 px (Apps, Motions & effects and Canvas each carry a chevron)
 *   1280-1439     Canvas and Assist in More, search 200 px
 *   1024-1279     Apps and Motions & effects in More too
 *   768-1023      the same, Fuobe FX in More too, search and New creation as icon buttons
 * Measured with the site's fonts for a guest, an account and the owner, a classic scrollbar's width to spare at every
 * width. Below md the phone tabs take over (phone-tabs.tsx).
 */

/**
 * A plain bar link (Assist, Library). Its states are the nav's (nav-states.css): the highlight on hover or keyboard
 * focus, and for the open page (aria-current) a pip under the words, never a fill. The items with a menu are
 * BAR_TRIGGER (bar-split.tsx).
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
  /** Fuobe FX: its studios and their modes (FX_HOME). */
  fx: boolean;
  canvas: boolean;
  /** /canvas itself (the Canvas item's own page). */
  canvasHome: boolean;
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
    fx: area === "fx",
    canvas: e?.id === "canvas",
    canvasHome: pathname === "/canvas",
    assist: e?.id === "assist",
    library: e?.kind === "library",
    page: pathname ? areaPageOf(pathname) : undefined,
  };
}

type Active = ReturnType<typeof barActive>;
const NONE: Active = barActive("");

function RichItem({ e, current, row }: { e: NavEntry; current: boolean; row: number }) {
  return (
    <IntentLink href={e.href} aria-current={current ? "page" : undefined} data-col={0} data-row={row} className={cn(CARD_ROW, MENU_ROW_2)}>
      <CoverThumb id={e.cover} size="row" icon={e.icon} eager />
      <span className="flex min-w-0 flex-col">
        <span className={rowName(current)}>{e.label}</span>
        <span className={ROW_LINE}>{e.what}</span>
      </span>
    </IntentLink>
  );
}

const pick = (ids: string[]) => ids.map((id) => entry(id)).filter((e): e is NavEntry => !!e);

/** The open page among the galleries and tools in a menu (the menu's content renders on the client only, when open). */
function useOn(): (e: NavEntry) => boolean {
  const pathname = usePathname();
  return (e) => pathname === e.href || pathname.startsWith(`${e.href}/`);
}

const MOTIONS_AREA_HREF = area("motions").href;

/** Fuobe FX's own page, as More lists it where the bar has no room for its item. */
const FX_ENTRY = entry(area("fx").entryId)!;

/** Fuobe FX in More: its page, with an icon (it has no cover of its own) and its line. */
function FxRow({ current, row }: { current: boolean; row: number }) {
  return (
    <IntentLink href={FX_ENTRY.href} aria-current={current ? "page" : undefined} data-col={0} data-row={row} className={cn(CARD_ROW, MENU_ROW_2)}>
      <span className="grid h-[27px] w-9 shrink-0 place-items-center rounded-[6px] bg-muted">
        <NavIcon name={FX_ENTRY.icon} className="nav-icon size-4 text-muted-foreground" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={rowName(current)}>{FX_ENTRY.label}</span>
        <span className={ROW_LINE}>{FX_ENTRY.what}</span>
      </span>
    </IntentLink>
  );
}

function MoreItems() {
  const on = useOn();
  return (
    <>
      <div className="lg:hidden">
        <FxRow current={on(FX_ENTRY)} row={0} />
      </div>
      {pick(["apps", "motions", "effects"]).map((e, i) => (
        <div key={e.id} className="xl:hidden">
          <RichItem e={e} current={on(e)} row={1 + i} />
        </div>
      ))}
      <div className="xl:hidden">
        <SeeAllRow href={MOTIONS_AREA_HREF} name="See all motions & effects" data-col={0} data-row={4} className="mt-1" />
        <div role="separator" className="mx-2.5 my-1.5 h-px bg-border" />
      </div>
      {pick(["canvas", "assist"]).map((e, i) => (
        <IntentLink key={e.id} href={e.href} eager={e.eager} aria-current={on(e) ? "page" : undefined} data-col={0} data-row={5 + i} className={cn(CARD_ROW, MENU_ROW_2)}>
          <span className="grid h-[27px] w-9 shrink-0 place-items-center rounded-[6px] bg-muted">
            <NavIcon name={e.icon} className="nav-icon size-4 text-muted-foreground" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className={rowName(on(e))}>{e.label}</span>
            <span className={ROW_LINE}>{e.what}</span>
          </span>
        </IntentLink>
      ))}
    </>
  );
}

/** Opened: the routes its rows lead to start loading. */
const warmMore = () => warmNav("more");

/** More: the bar's items that don't fit at this width (each hides here where the bar shows it). One button, as every menu item. */
function MoreMenu({ active }: { active: Active }) {
  return (
    <BarCardMenu
      id="more"
      label="More"
      icon={<MoreHorizontal aria-hidden className="size-4" />}
      onOpen={warmMore}
      cardClassName="w-80"
      className="min-[1440px]:hidden"
      // Marked when it holds the open page at this width: Canvas and Assist always; Apps, Motions and Effects below xl.
      active={active.canvas || active.assist}
      data-narrow={active.apps || active.motions || undefined}
      // Fuobe FX is in it below lg only.
      data-narrow-lg={active.fx || undefined}
    >
      <MoreItems />
    </BarCardMenu>
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
      {/* An item is marked anywhere in its area, its own page (/create, /studios …) included. */}
      <CreateMenu active={active.create || active.page === "create"} />
      <MegaLauncher id="studios" active={active.studios || active.page === "studios"} />
      <MegaLauncher id="fx" active={active.fx || active.page === "fx"} className="hidden lg:inline-flex" />
      <MegaLauncher id="apps" active={active.apps || active.page === "apps"} className="hidden xl:inline-flex" />
      <MegaLauncher id="motions" active={active.motions || active.page === "motions"} className="hidden xl:inline-flex" />
      <MegaLauncher id="canvas" active={active.canvas || active.canvasHome} className="hidden min-[1440px]:inline-flex" />
      <IntentLink href="/assist" eager data-bar-item="" onClick={tap("/assist")} aria-current={cur(active.assist)} className={cn(BAR_ITEM, "hidden min-[1440px]:inline-flex")}>
        Assist
      </IntentLink>
      <IntentLink href="/library" eager data-bar-item="" onClick={tap("/library")} aria-current={cur(active.library)} className={BAR_ITEM}>
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
        "lg:max-[1439.98px]:w-[200px] lg:justify-start lg:border lg:border-input lg:bg-background/60 lg:px-3 lg:nav-hover:border-border-strong lg:nav-hover:bg-background lg:active:bg-background min-[1440px]:max-[1599.98px]:w-[220px] min-[1600px]:w-[280px]",
      )}
    >
      <Search aria-hidden className="size-[18px] shrink-0 lg:size-4" />
      {/* Its name is the words it shows: "Search Fuobe" to 1599 px, the longer line from 1600 where the field is 280 px
          wide (sr-only below lg). One line always: not-sr-only would let it wrap. */}
      <span className="sr-only min-w-0 flex-1 truncate text-left lg:not-sr-only lg:whitespace-nowrap">
        <span className="min-[1600px]:hidden">Search Fuobe</span>
        <span className="hidden min-[1600px]:inline">Search studios, apps, effects…</span>
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

/**
 * Everything the bar's menus need before their first open: the panels' body (its own chunk) and the data (no
 * pictures) of the grouped menus whose item the bar shows at this width. A phone loads none (its sheet asks when it
 * shows one); a browser saving data loads only the code.
 */
export function warmBar(): void {
  if (!window.matchMedia("(min-width: 768px)").matches) return;
  const ids: FetchedMegaId[] = [];
  if (window.matchMedia("(min-width: 1024px)").matches) ids.push("fx");
  if (window.matchMedia("(min-width: 1280px)").matches) ids.push("apps", "motions");
  if (window.matchMedia("(min-width: 1440px)").matches) ids.push("canvas");
  preloadMegaPanel();
  loadMenusNow(ids);
}

/**
 * Soon after the page has loaded (its first media come first; then idle, or 1.5 s at the latest), so the first hover
 * never meets a skeleton. The pointer or focus coming near the bar warms the menus at once (MainNav).
 */
function MenuPrefetch() {
  useEffect(() => {
    let stop = () => {};
    const schedule = () => {
      if (typeof window.requestIdleCallback !== "function") {
        const t = window.setTimeout(warmBar, 300);
        stop = () => window.clearTimeout(t);
        return;
      }
      const h = window.requestIdleCallback(warmBar, { timeout: 1500 });
      stop = () => window.cancelIdleCallback(h);
    };
    if (document.readyState === "complete") schedule();
    else {
      window.addEventListener("load", schedule, { once: true });
      stop = () => window.removeEventListener("load", schedule);
    }
    return () => stop();
  }, []);
  return null;
}

/** The main nav: its keys (Left and Right along the items); the first pointer or focus near it warms the menus. */
function MainNav({ children }: { children: React.ReactNode }) {
  const ctl = useBarController();
  const warmed = useRef(false);
  const warm = () => {
    if (warmed.current) return;
    warmed.current = true;
    warmBar();
  };
  return (
    <nav aria-label="Main" className="flex min-w-0 items-center gap-0.5" onKeyDown={(e) => ctl?.navKey(e)} onPointerEnter={warm} onFocus={warm}>
      {children}
    </nav>
  );
}

/** The bar's header: marked while a menu is open (the items' own hover fill steps aside for the open highlight). */
function BarHeader({ children }: { children: React.ReactNode }) {
  const { openMenu } = useNavUi();
  return (
    <header
      data-top-bar
      data-menu-open={openMenu ? "" : undefined}
      className="sticky top-0 z-40 hidden h-14 items-center gap-1 border-b border-sidebar-border bg-sidebar/90 pr-4 pl-5 backdrop-blur-md md:flex lg:max-[1439.98px]:pr-5 min-[1440px]:pr-6 print:hidden"
    >
      {children}
    </header>
  );
}

/** The bar. Hidden below md and in print; same height on every page, full-screen studios included. */
export function TopBar() {
  return (
    <BarMenusProvider>
      <BarHeader>
        <BarStage />
        <BarIndicator />
        <MainNav>
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
        </MainNav>
        <span className="min-w-2 flex-1" />
        <div className="flex shrink-0 items-center gap-2">
          <RightCluster />
        </div>
      </BarHeader>
      <BarScrim />
      <Suspense fallback={null}>
        <CloseMenusOnRoute />
      </Suspense>
      <NavPrefetcher />
      <MenuPrefetch />
    </BarMenusProvider>
  );
}
