"use client";

import { usePathname } from "next/navigation";
import { Suspense, useEffect } from "react";
import { CircleUserRound, House, LayoutGrid, Library, Plus, type LucideIcon } from "lucide-react";
import { IntentLink } from "@/components/intent-link";
import { useNavUi, useViewerKind } from "@/components/nav/nav-ui";
import { activePhoneTab, keyboardOpen, toggleSheet, typesText, type PhoneSheet, type PhoneTab } from "@/components/nav/phone-nav";
import { avatarDot, useShownStatus } from "@/components/nav/status-chips";
import { NavPrefetcher } from "@/components/nav/nav-prefetch";
import { useEngineMode } from "@/lib/api";
import { navActive } from "@/lib/nav";
import { activeEntry } from "@/lib/nav-model";
import { cn } from "@/lib/utils";

const NO_SEARCH = new URLSearchParams();

type TabDot = ReturnType<typeof avatarDot>;

/** One cell: at least 64 x 56, the icon in a 44 x 28 pill that tints when its tab is selected. */
const CELL =
  "nav-row group/tab flex h-full min-w-0 flex-col items-center justify-center gap-1 rounded-xl text-[11px] leading-none font-medium text-muted-foreground select-none data-[active]:text-foreground";

function TabFace({ icon: Icon, label, dot }: { icon: LucideIcon; label: string; dot?: TabDot }) {
  return (
    <>
      <span className="relative grid h-7 w-11 place-items-center rounded-full motion-safe:transition-colors motion-safe:duration-150 group-data-[active]/tab:bg-brand-faint group-data-[active]/tab:text-brand-text">
        <Icon className="size-[22px]" strokeWidth={1.75} aria-hidden />
        {dot && (
          <span
            aria-hidden
            data-dot={dot}
            className={cn("absolute top-0 right-1.5 size-2 rounded-full ring-2 ring-sidebar", dot === "ok" ? "bg-success" : "bg-warning")}
          />
        )}
      </span>
      <span className="max-w-full truncate">{label}</span>
    </>
  );
}

/**
 * The You tab's dot, by the avatar's rules (the owner's setup, an account's own GPU when it answers, never a guest's):
 * after hydration only, so the server's shell and the first client render agree, and it takes no space when it comes.
 */
function useYouDot(): TabDot {
  const kind = useViewerKind();
  const status = useShownStatus();
  const mode = useEngineMode();
  return avatarDot(kind, status, mode);
}

function Tabs({ pathname }: { pathname: string }) {
  const { sheet, setSheet } = useNavUi();
  const entry = pathname ? activeEntry(pathname, NO_SEARCH) : undefined;
  const active = activePhoneTab(pathname, sheet, entry);
  const dot = useYouDot();
  const sheetTab = (tab: PhoneSheet, label: string, icon: LucideIcon, tabDot?: TabDot) => (
    <button
      type="button"
      className={CELL}
      data-tab={tab}
      data-active={active === tab || undefined}
      aria-haspopup="dialog"
      aria-expanded={sheet === tab}
      aria-controls={sheet === tab ? "phone-sheet" : undefined}
      onClick={() => setSheet(toggleSheet(sheet, tab))}
    >
      <TabFace icon={icon} label={label} dot={tabDot} />
    </button>
  );
  const linkTab = (tab: PhoneTab, href: string, label: string, icon: LucideIcon) => {
    const current = !!pathname && navActive(href, pathname, NO_SEARCH);
    return (
      <IntentLink
        href={href}
        eager
        className={CELL}
        data-tab={tab}
        data-active={active === tab || undefined}
        aria-current={current ? "page" : undefined}
        // Over an open sheet the tab still goes where it says: the sheet closes on the way.
        onClick={() => setSheet(null)}
      >
        <TabFace icon={icon} label={label} />
      </IntentLink>
    );
  };
  return (
    <>
      {linkTab("home", "/", "Home", House)}
      {sheetTab("create", "Create", Plus)}
      {sheetTab("studios", "Studios", LayoutGrid)}
      {linkTab("library", "/library", "Library", Library)}
      {sheetTab("you", "You", CircleUserRound, dot)}
    </>
  );
}

/** Reads the pathname (runtime data on a project's page) inside Suspense, so the shell around it still prerenders. */
function RouteTabs() {
  return <Tabs pathname={usePathname() ?? ""} />;
}

/**
 * `html[data-keyboard-open]` while the on-screen keyboard is up (focus in a text field and the visible viewport much
 * shorter than the page's): the tab bar steps aside, so it never rides on top of the keyboard over the field. The full
 * height is the one measured while nobody was typing, so a browser that also shrinks the page itself is read the same.
 */
function useKeyboardFlag() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const html = document.documentElement;
    let full = Math.max(window.innerHeight, vv.height);
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      // After focusout the new focus isn't set yet: read it a frame later.
      frame = requestAnimationFrame(() => {
        const typing = typesText(document.activeElement as HTMLInputElement | null);
        if (!typing) full = Math.max(window.innerHeight, vv.height);
        html.toggleAttribute("data-keyboard-open", keyboardOpen(vv.height, full, typing));
      });
    };
    vv.addEventListener("resize", update);
    window.addEventListener("focusin", update);
    window.addEventListener("focusout", update);
    window.addEventListener("orientationchange", update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", update);
      window.removeEventListener("focusin", update);
      window.removeEventListener("focusout", update);
      window.removeEventListener("orientationchange", update);
      html.removeAttribute("data-keyboard-open");
    };
  }, []);
}

/**
 * The phone's tab bar (below md): Home, Create, Studios, Library and You, fixed to the bottom above the home indicator.
 * Create, Studios and You open their sheets (PhoneSheets). Steps aside in a full-screen studio (its header button opens
 * the menu sheet instead), while the keyboard is up, and in print. While a sheet is open it sits above the sheet's
 * scrim and stays tappable, so another tab is one tap away.
 */
export function PhoneTabs() {
  const { sheet } = useNavUi();
  useKeyboardFlag();
  return (
    <nav
      aria-label="Main"
      data-phone-tabs
      className={cn(
        "pointer-events-auto fixed inset-x-0 bottom-0 grid h-[calc(4rem+env(safe-area-inset-bottom))] grid-cols-5 border-t border-sidebar-border bg-sidebar/95 pt-[3px] pr-[max(0.5rem,env(safe-area-inset-right))] pb-[calc(0.25rem+env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] backdrop-blur md:hidden print:hidden [html[data-fullscreen-studio]_&]:hidden [html[data-keyboard-open]_&]:hidden",
        sheet ? "z-[60]" : "z-40",
      )}
    >
      <Suspense fallback={<Tabs pathname="" />}>
        <RouteTabs />
      </Suspense>
      {/* Gives the sheets' route warming the router (the bar mounts one too: either serves). */}
      <NavPrefetcher />
    </nav>
  );
}
