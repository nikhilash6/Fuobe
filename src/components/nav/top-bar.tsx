"use client";

import { ChevronDown, MoreHorizontal, Plus, Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { IntentLink } from "@/components/intent-link";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { NEW_CREATION_HREF } from "@/lib/nav";
import { activeEntry, entry, type NavEntry } from "@/lib/nav-model";
import { isPlainClick, useTappedTab } from "@/lib/use-tapped-tab";
import { cn } from "@/lib/utils";
import { CoverThumb, NavIcon } from "./cover-thumb";
import { CreateMenu, NAV_MENU_ITEM } from "./create-menu";
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

/** A bar item (link, menu button, the launcher's button). data-active: the page is one of its destinations. */
export const BAR_ITEM =
  "group/bar-item inline-flex h-10 shrink-0 [@media(pointer:coarse)]:h-11 items-center gap-1.5 rounded-[10px] px-2.5 text-[14px] whitespace-nowrap text-foreground/80 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-colors data-[active]:bg-accent data-[active]:font-semibold data-[active]:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-semibold aria-[current=page]:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground min-[1440px]:px-3.5";

/** Which bar items hold the open page (Create for the create tools, Studios for a studio or one of its tools…). */
export function barActive(pathname: string): { create: boolean; studios: boolean; apps: boolean; motions: boolean; canvas: boolean; assist: boolean; library: boolean } {
  const e = pathname ? activeEntry(pathname, new URLSearchParams()) : undefined;
  return {
    create: e?.kind === "create",
    studios: e?.kind === "studio",
    apps: e?.id === "apps",
    motions: e?.id === "motions" || e?.id === "effects",
    canvas: e?.id === "canvas",
    assist: e?.id === "assist",
    library: e?.kind === "library",
  };
}

type Active = ReturnType<typeof barActive>;
const NONE: Active = barActive("");

function RichItem({ e, current }: { e: NavEntry; current: boolean }) {
  return (
    <DropdownMenuItem asChild className={cn("min-h-12 gap-3 rounded-lg px-2 py-1.5 data-[current]:bg-brand-faint", NAV_MENU_ITEM)}>
      <IntentLink href={e.href} aria-current={current ? "page" : undefined} data-current={current || undefined}>
        <CoverThumb id={e.cover} size="row" icon={e.icon} eager />
        <span className="flex min-w-0 flex-col">
          <span className={cn("text-[13.5px] leading-tight font-medium", current && "font-semibold")}>{e.label}</span>
          <span className="truncate text-[12px] leading-snug text-muted-foreground">{e.what}</span>
        </span>
      </IntentLink>
    </DropdownMenuItem>
  );
}

const pick = (ids: string[]) => ids.map((id) => entry(id)).filter((e): e is NavEntry => !!e);

/** The open page among the galleries and tools in a menu (the menu's content renders on the client only, when open). */
function useOn(): (e: NavEntry) => boolean {
  const pathname = usePathname();
  return (e) => pathname === e.href || pathname.startsWith(`${e.href}/`);
}

function MotionsItems() {
  const on = useOn();
  return pick(["motions", "effects"]).map((e) => <RichItem key={e.id} e={e} current={on(e)} />);
}

/** Motions & effects: the two preset galleries, with their covers. */
function MotionsMenu({ active }: { active: Active }) {
  return (
    <DropdownMenu modal={false} onOpenChange={(o) => o && warmNav("more")}>
      <DropdownMenuTrigger className={cn(BAR_ITEM, "hidden xl:inline-flex")} data-active={active.motions || undefined}>
        Motions &amp; effects
        <ChevronDown aria-hidden className="size-3.5 text-muted-foreground group-data-[state=open]/bar-item:rotate-180 motion-safe:transition-transform" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="w-80 p-1.5">
        <MotionsItems />
      </DropdownMenuContent>
    </DropdownMenu>
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
      {pick(["canvas", "assist"]).map((e) => {
        return (
          <DropdownMenuItem key={e.id} asChild className={cn("min-h-12 gap-3 rounded-lg px-2 py-1.5 data-[current]:bg-brand-faint", NAV_MENU_ITEM)}>
            <IntentLink href={e.href} eager={e.eager} aria-current={on(e) ? "page" : undefined} data-current={on(e) || undefined}>
              <span className="grid h-[27px] w-9 shrink-0 place-items-center rounded-[6px] bg-muted">
                <NavIcon name={e.icon} className="size-4 text-muted-foreground" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[13.5px] leading-tight font-medium">{e.label}</span>
                <span className="truncate text-[12px] leading-snug text-muted-foreground">{e.what}</span>
              </span>
            </IntentLink>
          </DropdownMenuItem>
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
        className={cn(BAR_ITEM, "min-[1440px]:hidden max-xl:data-[narrow]:bg-accent max-xl:data-[narrow]:font-semibold max-xl:data-[narrow]:text-foreground")}
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
      <CreateMenu className={BAR_ITEM} active={active.create} />
      <StudiosLauncher className={BAR_ITEM} active={active.studios} />
      <IntentLink href="/apps" onClick={tap("/apps")} aria-current={cur(active.apps)} className={cn(BAR_ITEM, "hidden xl:inline-flex")}>
        Apps
      </IntentLink>
      <MotionsMenu active={active} />
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
        "inline-flex h-10 shrink-0 items-center gap-2 rounded-[10px] text-[13.5px] [@media(pointer:coarse)]:h-11 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-colors",
        "w-10 justify-center hover:bg-accent hover:text-foreground [@media(pointer:coarse)]:w-11",
        "lg:max-[1439.98px]:w-[200px] lg:justify-start lg:border lg:border-input lg:bg-background/60 lg:px-3 lg:hover:border-border-strong lg:hover:bg-background min-[1440px]:w-[280px]",
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
      className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full border border-border-strong px-2.5 text-[14px] font-semibold whitespace-nowrap text-foreground outline-none hover:bg-accent focus-visible:ring-2 [@media(pointer:coarse)]:h-11 [html[data-viewer]:not([data-viewer=guest])_&]:border-transparent [html[data-viewer]:not([data-viewer=guest])_&]:bg-primary [html[data-viewer]:not([data-viewer=guest])_&]:text-primary-foreground [html[data-viewer]:not([data-viewer=guest])_&]:hover:bg-primary/90 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar motion-safe:transition-colors lg:pr-4 lg:pl-3"
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
        className="sticky top-0 z-40 hidden h-14 items-center gap-1 border-b border-sidebar-border bg-sidebar/90 px-4 backdrop-blur-md md:flex lg:max-[1439.98px]:px-5 min-[1440px]:px-6 print:hidden"
      >
        <nav aria-label="Main" className="flex min-w-0 items-center gap-0.5">
          <IntentLink
            href="/"
            eager
            aria-label="Fuobe home"
            className="mr-1.5 inline-flex shrink-0 items-center self-stretch rounded-md px-1 font-heading text-[24px] leading-none outline-none focus-visible:ring-2 focus-visible:ring-ring lg:mr-3"
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
