"use client";

import dynamic from "next/dynamic";
import { useLinkStatus } from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { Fragment, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, ChevronsUpDown, Clapperboard, Cpu, LogIn, LogOut, Moon, Plus, Search, Settings2, Sun, UserPlus, X } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { CommandPalette, CommandPaletteProvider, useCommandPalette } from "@/components/command-palette";
import { GitHubMark } from "@/components/github-mark";
import { IntentLink } from "@/components/intent-link";
import { JobNotifications } from "@/components/job-notifications";
import { NAV, type NavGroupDef } from "@/components/nav-items";
import { SkillBuilderProvider } from "@/components/skills/skill-builder-provider";
import { awayFix, openConnect, useComputerSupport } from "@/components/gpu/open-connect";
import { usePagePlace } from "@/components/gpu/use-page-place";
import { ownGpuOf, signInHref, signOut, useEngineMode, useHydrated, useStatus, useViewer, VIEWER_KEY, type StatusInfo } from "@/lib/api";
import { deviceLabel } from "@/lib/gpu/readiness";
import { useModKey } from "@/lib/keys";
import { fullScreenStudio, groupId, NAV_CLOSED_KEY, navActive, NEW_CREATION_HREF, parseClosed, scrollFades, sidebarCookie, SIDEBAR_STATE_SCRIPT, sidebarOpenFromCookie } from "@/lib/nav";
import { cn } from "@/lib/utils";

// The note of a tab that runs the person's jobs on their own computer's ComfyUI (only for someone whose runs go there).
const ComputerNote = dynamic(() => import("@/components/gpu/computer-runner").then((m) => m.ComputerNote), { ssr: false });

const NO_SEARCH = new URLSearchParams();

function StatusDot({ ok }: { ok: boolean | undefined }) {
  return <span className={cn("size-1.5 shrink-0 rounded-full", ok ? "bg-success" : "bg-subtle-foreground")} />;
}

/**
 * The row's label. While the clicked row's route loads (useLinkStatus) it marks the row, which tints
 * (has-[[data-pending]]), so the click shows at once even when the next page takes a moment. Nothing
 * animates: a shimmer or pulse here costs main-thread frames during the very navigation it waits for
 * (measured: about +100 ms per click with the CPU slowed 4x).
 */
function NavLabel({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return (
    <span data-pending={pending || undefined} className={cn(pending && "opacity-70")}>
      {children}
    </span>
  );
}

function Items({ group, pathname, search }: { group: NavGroupDef; pathname: string; search: URLSearchParams }) {
  const hrefs = group.items.map((i) => i.href);
  return group.items.map((item) => {
    const active = navActive(item.href, pathname, search, hrefs);
    return (
      <SidebarMenuItem key={item.href} className={cn(group.compact && "min-w-0")}>
        <SidebarMenuButton
          asChild
          isActive={active}
          tooltip={item.label}
          className={cn(
            "h-8 text-[13px] has-[[data-pending]]:bg-sidebar-accent data-[active=true]:font-semibold",
            group.compact && "h-7 gap-1.5 px-2 text-[12px]",
          )}
        >
          <IntentLink href={item.href} eager={item.eager} aria-current={active ? "page" : undefined} title={group.compact && item.short ? item.label : undefined}>
            <item.icon />
            <NavLabel>{group.compact ? (item.short ?? item.label) : item.label}</NavLabel>
          </IntentLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  });
}

/** Query links (`?tab=favorites`) need the search params, which only exist at request time. */
function WithSearch({ group, pathname }: { group: NavGroupDef; pathname: string }) {
  return <Items group={group} pathname={pathname} search={useSearchParams()} />;
}

/** Reads the pathname (runtime data) inside Suspense so routes can still prerender. */
function ActiveItems({ group }: { group: NavGroupDef }) {
  const pathname = usePathname();
  if (!group.items.some((i) => i.href.includes("?"))) return <Items group={group} pathname={pathname} search={NO_SEARCH} />;
  return (
    <Suspense fallback={<Items group={group} pathname={pathname} search={NO_SEARCH} />}>
      <WithSearch group={group} pathname={pathname} />
    </Suspense>
  );
}

/** The folded groups: remembered in this browser, else Engine (DEFAULT_NAV_CLOSED), also on the server. */
function readClosed(): string[] {
  try {
    return parseClosed(typeof window === "undefined" ? null : localStorage.getItem(NAV_CLOSED_KEY));
  } catch {
    return parseClosed(null);
  }
}

function NavGroup({ group, open, onToggle }: { group: NavGroupDef; open: boolean; onToggle: () => void }) {
  const id = groupId(group.label);
  return (
    <SidebarGroup data-nav-group={id} data-open={open ? "true" : "false"} className="group/nav py-1">
      {group.collapsible ? (
        <SidebarGroupLabel asChild className="text-[11px] font-medium tracking-wide uppercase">
          <button
            type="button"
            data-nav-toggle
            aria-expanded={open}
            aria-controls={`nav-${id}`}
            onClick={onToggle}
            className="w-full cursor-pointer hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            {group.label}
            {/* Folded, the label says how much is inside. */}
            <span className="ml-auto font-normal tracking-normal tabular-nums group-data-[open=true]/nav:hidden">{group.items.length}</span>
            <ChevronRight className="ml-1 size-3.5 transition-transform group-data-[open=true]/nav:ml-auto group-data-[open=true]/nav:rotate-90" />
          </button>
        </SidebarGroupLabel>
      ) : (
        <SidebarGroupLabel className="text-[11px] font-medium tracking-wide uppercase">{group.label}</SidebarGroupLabel>
      )}
      <SidebarMenu id={`nav-${id}`} data-nav-items className={cn(group.compact && "grid grid-cols-2 gap-0.5")}>
        <Suspense fallback={<Items group={group} pathname="" search={NO_SEARCH} />}>
          <ActiveItems group={group} />
        </Suspense>
      </SidebarMenu>
    </SidebarGroup>
  );
}

/**
 * Inline script that runs while the HTML is parsed: the server always renders the sidebar
 * expanded, this applies the remembered state before the first paint. On the client it renders as
 * inert text/plain (React warns about executable scripts it renders itself).
 */
function SidebarStateScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: SIDEBAR_STATE_SCRIPT }}
    />
  );
}

/**
 * Scrolls `el` into the scrolling `box` as little as it takes, its top first when it doesn't fit, clear of the box's
 * faded edges (24px above, 40px below).
 */
function reveal(box: HTMLElement | null, el: Element | null | undefined) {
  if (!box || !el) return;
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const below = r.bottom + 40 - b.bottom;
  if (below > 0) box.scrollTop += Math.min(below, Math.max(0, r.top - b.top - 24));
  else if (r.top - 24 < b.top) box.scrollTop -= b.top - r.top + 24;
}

/**
 * Brings the open page's row into view when the page changes: with Studios open, Engine's rows (Models, Settings…)
 * sit below the fold. Inside Suspense: the pathname is runtime data.
 */
function RevealActive({ box }: { box: React.RefObject<HTMLDivElement | null> }) {
  const pathname = usePathname();
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // Again whenever the list's box changes size (the guest's Sign up row arrives and pushes it down), until the
    // person scrolls or clicks in it themselves.
    let theirs = false;
    const show = () => theirs || reveal(el, el.querySelector('[data-active="true"]'));
    const mine = () => (theirs = true);
    const frame = requestAnimationFrame(show);
    const resized = new ResizeObserver(show);
    resized.observe(el);
    for (const e of ["wheel", "touchstart", "pointerdown", "keydown"]) el.addEventListener(e, mine, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      for (const e of ["wheel", "touchstart", "pointerdown", "keydown"]) el.removeEventListener(e, mine);
    };
  }, [pathname, box]);
  return null;
}

/** Tells the shell which page is open (the pathname is runtime data, so it's read inside Suspense). */
function PathWatcher({ onPath }: { onPath: (pathname: string) => void }) {
  const pathname = usePathname();
  useEffect(() => onPath(pathname), [pathname, onPath]);
  return null;
}

interface ShellState {
  /** The page that's open (PathWatcher keeps it current). */
  path: string;
  /** The expanded/collapsed choice in the cookie. */
  remembered: boolean;
  /** Opened or closed by hand in a full-screen studio (fullScreenStudio): lasts while you stay in it. */
  peek: { studio: string; open: boolean } | null;
}

/**
 * SidebarProvider that starts from the remembered expanded/collapsed state (the shadcn cookie). In a
 * full-screen studio (fullScreenStudio) the sidebar folds to its rail instead; opening it there
 * lasts until you leave that studio, and neither writes the cookie.
 */
export function SidebarShell({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  // The first client render reads the cookie and the URL itself, as the pre-paint script does, so hydration matches.
  const [state, setState] = useState<ShellState>(() => ({
    path: typeof window === "undefined" ? "" : window.location.pathname,
    remembered: typeof document === "undefined" ? true : sidebarOpenFromCookie(document.cookie),
    peek: null,
  }));
  const studio = fullScreenStudio(state.path);
  const open = studio ? state.peek?.studio === studio && state.peek.open : state.remembered;
  // Both callbacks are stable, so a new page alone leaves the provider's context as it was and the
  // sidebar doesn't render again on every navigation. A change is filed by the page it applies to
  // (the state's own path), never by the page a stale callback was made on.
  const onOpenChange = useCallback(
    (value: boolean) =>
      setState((s) => {
        const at = fullScreenStudio(s.path);
        return at ? { ...s, peek: { studio: at, open: value } } : { ...s, remembered: value };
      }),
    [],
  );
  const onPath = useCallback(
    (path: string) =>
      setState((s) => {
        if (s.path === path) return s;
        const at = fullScreenStudio(path);
        return { ...s, path, peek: at && s.peek?.studio === at ? s.peek : null };
      }),
    [],
  );
  // Only the remembered choice reaches the cookie: a studio's fold or peek never does.
  useEffect(() => {
    if (sidebarOpenFromCookie(document.cookie) !== state.remembered) document.cookie = sidebarCookie(state.remembered);
  }, [state.remembered]);
  return (
    <SidebarProvider open={open} onOpenChange={onOpenChange} persistOpen={false} style={style}>
      <Suspense fallback={null}>
        <PathWatcher onPath={onPath} />
      </Suspense>
      {children}
    </SidebarProvider>
  );
}

/** The first stop for keyboard users: jumps past the sidebar to the page (WCAG 2.4.1). */
function SkipLink() {
  return (
    <a
      href="#content"
      onClick={(e) => {
        // Focus the page without adding #content to the URL (Settings reads its hash for deep links).
        const main = document.getElementById("content");
        if (!main) return;
        e.preventDefault();
        main.focus();
      }}
      className="sr-only rounded-md bg-background px-3 py-2 text-[13px] font-medium shadow-strong focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:outline-2 focus:outline-ring"
    >
      Skip to content
    </a>
  );
}

/** The app frame: sidebar + inset sheet. Used by the studio layout and the root not-found page. */
export function StudioChrome({ children }: { children: React.ReactNode }) {
  return (
    // The shell stays static: the remembered collapsed state is read on the client (and applied
    // before first paint by AppSidebar's inline script), not from cookies() on the server.
    <CommandPaletteProvider>
      {/* Make a skill from any result's ⋯ menu: a page's, the ⌘K palette's and a job notification's viewer. */}
      <SkillBuilderProvider>
        <SidebarShell style={{ "--sidebar-width": "15.5rem", "--sidebar-width-icon": "3.25rem" } as React.CSSProperties}>
          <SkipLink />
          <AppSidebar />
          <SidebarInset
            id="content"
            tabIndex={-1}
            className="min-h-svh min-w-0 outline-none md:m-0 md:mt-2 md:rounded-none md:rounded-tl-xl md:border-t-[0.5px] md:border-l-[0.5px] md:shadow-[-2px_0_6px_rgba(0,0,0,.02)] md:peer-data-[variant=inset]:m-0 md:peer-data-[variant=inset]:mt-2 md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:rounded-tl-xl"
          >
            {children}
          </SidebarInset>
          <CommandPalette />
          <JobNotifications />
        </SidebarShell>
      </SkillBuilderProvider>
    </CommandPaletteProvider>
  );
}

/**
 * Keeps a vertical scroller's fades (.fade-y) in sync: data-more-above / data-more-below, and how deep
 * each fade is (scrollFades), so a fade hints at items past the edge without dimming a row that fits.
 */
function useScrollFades<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const { above, below } = scrollFades(el);
      el.toggleAttribute("data-more-above", above > 0);
      el.toggleAttribute("data-more-below", below > 0);
      el.style.setProperty("--fade-t", `${above}px`);
      el.style.setProperty("--fade-b", `${below}px`);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  return ref;
}

/** "Search ⌘K": opens the palette (the keycaps only where there's a keyboard). */
function SearchRow() {
  const palette = useCommandPalette();
  const { isMobile, setOpenMobile } = useSidebar();
  const mod = useModKey();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={`Search (${mod} K)`}
        className="h-8 text-[13px]"
        aria-keyshortcuts="Meta+K Control+K"
        aria-haspopup="dialog"
        onClick={() => {
          if (isMobile) setOpenMobile(false);
          palette.setOpen(true);
        }}
      >
        <Search />
        <span>Search</span>
        <span className="ml-auto flex gap-0.5 group-data-[collapsible=icon]:hidden [@media(hover:none)]:hidden">
          <Kbd>{mod}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * Runs while the HTML is parsed: `<html data-viewer="owner">` in a browser where the owner was signed in last time, so
 * the row kept for "Sign up / Log in" (or an account's menu) isn't drawn and then taken away on every page load.
 */
const VIEWER_SCRIPT = `(function(){try{var v=localStorage.getItem("${VIEWER_KEY}");if(v)document.documentElement.setAttribute("data-viewer",v)}catch(e){}})()`;

/** The row's place while the viewer isn't known (in the server's shell too: ViewerRow reads the query, so it's the fallback there). */
function ViewerRowPlaceholder() {
  return (
    <>
      <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: VIEWER_SCRIPT }} />
      <SidebarMenuItem aria-hidden className="mt-1 mb-2 h-8 group-data-[collapsible=icon]:h-[70px] [html[data-viewer='owner']_&]:hidden [html[data-viewer='account']_&]:hidden" />
    </>
  );
}

/**
 * Public sign-up, signed out: "Sign up" and "Log in", coming back to this page with its query (a preset picked…). Until
 * the viewer is known the row keeps its height, so the menu under it doesn't move when it comes (except in a browser the
 * owner or an account used last: they get no row here). Under Suspense: it reads the path.
 */
function ViewerRow() {
  const viewer = useViewer().data;
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const here = search ? `${pathname}?${search}` : pathname;
  const kind = !viewer ? undefined : viewer.owner ? "owner" : viewer.account ? "account" : viewer.publicSignup ? "guest" : "owner";
  useEffect(() => {
    if (!kind) return;
    try {
      localStorage.setItem(VIEWER_KEY, kind);
    } catch {}
    document.documentElement.setAttribute("data-viewer", kind);
  }, [kind]);
  if (!kind) return <ViewerRowPlaceholder />;
  if (kind !== "guest") return null;
  return (
    <SidebarMenuItem className="mt-1 mb-2 flex gap-1.5 group-data-[collapsible=icon]:flex-col">
      <SidebarMenuButton asChild tooltip="Sign up free" className="h-8 flex-1 justify-center bg-primary text-[13px] text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground">
        <a href={signInHref("signup", here)}>
          <UserPlus />
          <span>Sign up</span>
        </a>
      </SidebarMenuButton>
      <SidebarMenuButton asChild tooltip="Log in" className="h-8 flex-1 justify-center border border-sidebar-border text-[13px]">
        <a href={signInHref("login", here)}>
          <LogIn />
          <span>Log in</span>
        </a>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * "Your GPU" in the status strip: a visitor's own (public sign-up), never the install's, or the owner's computer. A
 * guest is sent to sign up first; anyone else without one opens "Connect your GPU"; a connected one says whether it
 * answers.
 */
function YourGpuChip({ gpu, guest }: { gpu: NonNullable<StatusInfo["viewer"]>["gpu"]; guest: boolean }) {
  const cls = "flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent group-data-[collapsible=icon]:hidden";
  const g = gpu;
  // ComfyUI on this computer is closed, or runs without Fuobe's setting: the finder, at that step (elsewhere: /connect).
  const fix = awayFix(g.connected ? g : undefined, useComputerSupport());
  if (g.connected) {
    const vram = g.vramBytes ? `${Math.round(g.vramBytes / 2 ** 30)} GB` : "";
    const inner = (
      <>
        <span className="flex items-center gap-2">
          <StatusDot ok={g.online} /> Your GPU
          <span className="ml-auto">{g.online ? "online" : g.comfy === "down" ? "ComfyUI not running" : g.comfy === "no-setting" ? "needs a setting" : "offline"}</span>
        </span>
        {(g.device || vram || g.mode === "computer") && (
          <span className="truncate text-[11px]">{[g.mode === "computer" && "Your computer", deviceLabel(g.device), vram && `${vram} VRAM`].filter(Boolean).join(" · ")}</span>
        )}
      </>
    );
    return fix ? (
      <button type="button" className={cls} onClick={fix}>
        {inner}
      </button>
    ) : (
      <IntentLink href="/connect" className={cls}>
        {inner}
      </IntentLink>
    );
  }
  const body = (
    <span className="flex items-center gap-2">
      <StatusDot ok={false} /> Your GPU
      <span className="ml-auto font-medium text-brand-text">Connect</span>
    </span>
  );
  return guest ? (
    <a href={signInHref("signup", "/connect")} className={cls}>
      {body}
    </a>
  ) : (
    <button type="button" className={cls} onClick={() => openConnect(true)}>
      {body}
    </button>
  );
}

/**
 * Who is signed in (public sign-up): an account's email, with Settings, Your GPU and Sign out. Nothing
 * for the owner or a guest. In the rail it's the initial alone; on a phone the menu opens upward. Until hydrated it is
 * the server's HTML (no row), even when the viewer query has already answered; until the viewer is known, a browser an
 * account used last keeps the row's height, so the footer doesn't move when it comes.
 */
function AccountRow() {
  const hydrated = useHydrated();
  const viewer = useViewer().data;
  const account = hydrated ? viewer?.account : undefined;
  const { isMobile } = useSidebar();
  if (!account) return hydrated && viewer ? null : <div aria-hidden className="hidden h-9 group-data-[collapsible=icon]:h-8 [html[data-viewer='account']_&]:block" />;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton className="h-9 px-1.5 text-[13px] group-data-[collapsible=icon]:p-1! data-[state=open]:bg-sidebar-accent" aria-label={`Account: ${account.email}`}>
              <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-faint text-[11px] font-semibold text-brand-text">
                {account.email.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate" title={account.email}>
                {account.email}
              </span>
              <ChevronsUpDown className="text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          {/* As wide as the email (on one line, up to 22rem), never narrower than the row: an address breaks only when it must,
              and the menu keeps clear of the screen's edges. */}
          <DropdownMenuContent
            side={isMobile ? "top" : "right"}
            align="end"
            collisionPadding={8}
            className="w-max max-w-[min(22rem,var(--radix-dropdown-menu-content-available-width))] min-w-[max(14rem,var(--radix-dropdown-menu-trigger-width))]"
          >
            <DropdownMenuLabel className="font-normal">
              <span className="block text-[11px]">Signed in as</span>
              <span className="block text-[13px] [overflow-wrap:anywhere] text-foreground">{account.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <IntentLink href="/settings">
                <Settings2 /> Settings
              </IntentLink>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <IntentLink href="/connect">
                <Cpu /> Your GPU
              </IntentLink>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void signOut()}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppSidebar() {
  const { resolvedTheme, setTheme } = useTheme();
  const { isMobile, setOpenMobile } = useSidebar();
  // On phones the sidebar is a drawer over the page: any link tapped in it closes it.
  const closeOnLink = (e: React.MouseEvent) => {
    if (isMobile && (e.target as Element).closest("a[href]")) setOpenMobile(false);
  };
  const content = useScrollFades<HTMLDivElement>();
  // Until hydrated, the server's (status-less) sidebar: a status that lands mid-hydration must not change it.
  const hydrated = useHydrated();
  const statusData = useStatus().data;
  const status = hydrated ? statusData : undefined;
  const computer = useViewer().data?.computer === true && hydrated;
  const cloud = status && (status.providers.fal?.configured || status.providers.replicate?.configured);
  const comfy = status?.providers.comfyui?.configured;
  const mode = useEngineMode();
  // The owner's GPU as "Your GPU": on the owner's computer, or (a hosted studio with nothing connected) one to connect.
  const place = usePagePlace();
  // Not in Paid APIs only mode: ComfyUI isn't used there, wherever it runs.
  const ownerGpu = status && !status.viewer && mode !== "cloud" && (status.ownerGpu || (place === "hosted" && !comfy)) ? (ownGpuOf(status) ?? { connected: false }) : null;
  const ready = mode === "open" ? comfy : mode === "cloud" ? cloud : cloud || comfy;
  const [closed, setClosed] = useState(readClosed);
  const toggle = useCallback((id: string) => {
    setClosed((c) => {
      const next = c.includes(id) ? c.filter((x) => x !== id) : [...c, id];
      try {
        localStorage.setItem(NAV_CLOSED_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  return (
    <>
      <Sidebar variant="inset" collapsible="icon">
        {/* The whole sidebar is the app's navigation landmark (the page is the one main landmark). */}
        <nav aria-label="Main" className="flex min-h-0 w-full flex-1 flex-col">
          <SidebarHeader className="pt-3" onClick={closeOnLink}>
            <div className="flex h-9 items-center justify-between gap-2 px-1 group-data-[collapsible=icon]:justify-center">
              <IntentLink href="/" eager className="flex items-center gap-2 group-data-[collapsible=icon]:hidden">
                <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground shadow-soft">
                  <Clapperboard className="size-4" />
                </span>
                <span className="font-heading text-[22px] leading-none">Fuobe</span>
              </IntentLink>
              {isMobile ? (
                <Button variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={() => setOpenMobile(false)} aria-label="Close menu">
                  <X />
                </Button>
              ) : (
                <SidebarTrigger className="text-muted-foreground" />
              )}
            </div>
            <SidebarMenu>
              <Suspense fallback={<ViewerRowPlaceholder />}>
                <ViewerRow />
              </Suspense>
              <SearchRow />
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="New creation" className="h-8 text-[13px] has-[[data-pending]]:bg-sidebar-accent">
                  <IntentLink href={NEW_CREATION_HREF} eager>
                    <Plus />
                    <NavLabel>New creation</NavLabel>
                  </IntentLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent ref={content} onClick={closeOnLink} className="scrollbar-none fade-y group-data-[collapsible=icon]:overflow-y-auto">
            {NAV.map((group, i) => {
              const id = groupId(group.label);
              return (
                <Fragment key={id}>
                  {/* Icon mode hides the group labels: a hairline keeps the groups apart. */}
                  {i > 0 && <SidebarSeparator className="my-1 hidden group-data-[collapsible=icon]:block" />}
                  <NavGroup
                    group={group}
                    open={!group.collapsible || !closed.includes(id)}
                    onToggle={() => {
                      toggle(id);
                      // A group opened near the bottom scrolls up into view, once its rows are on the page.
                      if (closed.includes(id)) requestAnimationFrame(() => reveal(content.current, content.current?.querySelector(`[data-nav-group="${id}"]`)));
                    }}
                  />
                </Fragment>
              );
            })}
            <Suspense fallback={null}>
              <RevealActive box={content} />
            </Suspense>
          </SidebarContent>
          <SidebarFooter className="gap-1 border-t border-sidebar-border" onClick={closeOnLink}>
            {computer && <ComputerNote />}
            {status?.viewer ? (
              <YourGpuChip gpu={status.viewer.gpu} guest={status.viewer.kind === "guest"} />
            ) : ownerGpu ? (
              <>
                {mode !== "open" && (
                  <IntentLink href="/settings" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent group-data-[collapsible=icon]:hidden">
                    <StatusDot ok={!!cloud} /> Cloud models
                    <span className="ml-auto">{cloud ? "connected" : "add key"}</span>
                  </IntentLink>
                )}
                <YourGpuChip gpu={ownerGpu} guest={false} />
                {(mode !== "both" || (!ready && status?.demoMode !== "off")) && (
                  <div className="flex flex-col gap-1.5 px-2 pb-1 text-[11px] text-muted-foreground group-data-[collapsible=icon]:hidden">
                    {mode !== "both" && <span>{mode === "open" ? "Open source only" : "Paid APIs only"}</span>}
                    {!ready && status?.demoMode !== "off" && (
                      <span className="w-fit rounded-sm bg-highlight/25 px-1.5 py-0.5 text-highlight-foreground dark:text-highlight">Demo mode · placeholder outputs</span>
                    )}
                  </div>
                )}
              </>
            ) : !status ? (
              // Not known yet: no "add key / offline" the install may not have, for a visitor who never sees them.
              <div aria-hidden className="flex h-[30px] items-center px-2 group-data-[collapsible=icon]:hidden">
                <Skeleton className="h-3 w-2/3" />
              </div>
            ) : (
            <IntentLink
              href="/settings"
              className="flex flex-col gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent group-data-[collapsible=icon]:hidden"
            >
              {mode !== "open" && (
                <span className="flex items-center gap-2">
                  <StatusDot ok={cloud} /> Cloud models
                  <span className="ml-auto">{cloud ? "connected" : "add key"}</span>
                </span>
              )}
              {mode !== "cloud" && (
                <span className="flex items-center gap-2">
                  <StatusDot ok={comfy} /> ComfyUI
                  <span className="ml-auto">{comfy ? "online" : "offline"}</span>
                </span>
              )}
              {mode !== "both" && <span className="text-[11px] text-muted-foreground">{mode === "open" ? "Open source only" : "Paid APIs only"}</span>}
              {status && !ready && status.demoMode !== "off" && (
                <span className="mt-0.5 rounded-sm bg-highlight/25 px-1.5 py-0.5 text-[11px] text-highlight-foreground dark:text-highlight">
                  Demo mode · placeholder outputs
                </span>
              )}
            </IntentLink>
            )}
            <SidebarMenu className="flex-row gap-1 group-data-[collapsible=icon]:flex-col">
              <SidebarMenuItem className="min-w-0 flex-1">
                <SidebarMenuButton tooltip="Toggle theme" className="h-8 text-[13px]" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
                  <Sun className="hidden dark:block" />
                  <Moon className="dark:hidden" />
                  <span className="hidden dark:inline">Light mode</span>
                  <span className="dark:hidden">Dark mode</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem className="shrink-0">
                <SidebarMenuButton asChild tooltip="Source code on GitHub" className="h-8 w-8 justify-center p-0 text-[13px]">
                  <a href="https://github.com/workingprototype/fuobe" target="_blank" rel="noreferrer" title="Source code on GitHub">
                    <GitHubMark />
                    <span className="sr-only">Source code on GitHub</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <AccountRow />
          </SidebarFooter>
        </nav>
        <SidebarRail />
      </Sidebar>
      <SidebarStateScript />
    </>
  );
}
