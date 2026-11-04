"use client";

import { usePathname } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { ArrowRight, XIcon } from "lucide-react";
import { IntentLink } from "@/components/intent-link";
import { AccountSections } from "@/components/nav/account-menu";
import { CreateList } from "@/components/nav/create-menu";
import { PHONE_QUERY, useNavUi, type NavSheet } from "@/components/nav/nav-ui";
import { useSearchPalette } from "@/components/nav/search-context";
import { ComputerNoteBlock } from "@/components/nav/status-chips";
import { FamilySwitch, StudiosSheet } from "@/components/nav/studios-sheet";
import { MEGA_AREAS, type MegaId } from "@/lib/mega-menus";
import { warmNav } from "@/components/nav/nav-prefetch";
import { area } from "@/lib/nav-areas";
import { cn } from "@/lib/utils";

const TITLES: Record<NavSheet, string> = { studios: "Studios", create: "Create", you: "You" };

/** "See all" in a sheet's header: the area's own page, with covers and lines. */
const SEE_ALL: Partial<Record<NavSheet, string>> = { create: area("create").href };

/** A drag down this far on the sheet's top (handle and title) closes it, in px. */
const SWIPE_CLOSE = 56;

/** Closes the sheets when the page changes some other way than a tap in them (search, a notification, back). */
function CloseOnNavigate({ onPath }: { onPath: () => void }) {
  const pathname = usePathname();
  const last = useRef(pathname);
  useEffect(() => {
    if (last.current === pathname) return;
    last.current = pathname;
    onPath();
  }, [pathname, onPath]);
  return null;
}

/** On the page and shown (not inside a closed sheet, a hidden bar or a collapsed header). */
function visible(el: Element | null | undefined): el is HTMLElement {
  if (!(el instanceof HTMLElement) || !el.isConnected) return false;
  return typeof el.checkVisibility === "function" ? el.checkVisibility() : el.getClientRects().length > 0;
}

/**
 * Where focus goes when the sheet closes: the tab of the sheet on screen when a tab opened it (Studios, then a tap on
 * You, closes back to You), else what opened it (an "All studios" button), else that tab, else a full-screen
 * studio's Menu button, else the page.
 */
export function sheetReturnTarget(opener: HTMLElement | null, shown: NavSheet, tapped?: HTMLElement | null): HTMLElement | null {
  // A tab tapped over the open sheet (Studios again, Home, Library): focus stays on it.
  if (visible(tapped)) return tapped;
  const tab = document.querySelector(`[data-phone-tabs] [data-tab="${shown}"]`);
  const fromTab = !!opener?.closest("[data-phone-tabs]");
  if (fromTab && visible(tab)) return tab;
  if (visible(opener)) return opener;
  if (visible(tab)) return tab;
  const menu = [...document.querySelectorAll("[data-phone-nav-button]")].find(visible);
  if (menu) return menu as HTMLElement;
  return document.getElementById("content");
}

function YouSheet() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pb-1">
      <ComputerNoteBlock />
      <AccountSections variant="sheet" />
    </div>
  );
}

/**
 * The phone's sheets (below md): Studios, Create and You, opened by the tab bar (or by "All studios" anywhere, and by a
 * full-screen studio's menu button). One bottom sheet whose body follows the open tab, so going from one tab to another
 * swaps the body instead of closing one sheet and opening the next. It ends at the tab bar, which stays above its scrim
 * and tappable: a tap there is the tab's own (Studios again closes, another tab switches, Home and Library go there),
 * never a tap outside that closes the sheet first. Modal otherwise: focus stays inside, Esc and the close button close
 * it, and focus goes back to what opened it.
 */
export function PhoneSheets() {
  const { sheet, setSheet, sheetGroup, sheetFamily } = useNavUi();
  // The Studios sheet's family (Studios, Apps, Motions & effects, Canvas): where openArea() asked, then as switched.
  const [family, setFamily] = useState<MegaId>(sheetFamily);
  const [askedFamily, setAskedFamily] = useState({ sheet, sheetFamily });
  if (askedFamily.sheet !== sheet || askedFamily.sheetFamily !== sheetFamily) {
    setAskedFamily({ sheet, sheetFamily });
    if (sheet === "studios") setFamily(sheetFamily);
  }
  const search = useSearchPalette();
  // The body on screen: the open sheet's, and the last one's while the sheet slides away.
  const [shown, setShown] = useState<NavSheet>(sheet ?? "studios");
  if (sheet && sheet !== shown) setShown(sheet);
  const opener = useRef<HTMLElement | null>(null);
  const tapped = useRef<HTMLElement | null>(null);
  const handoff = useRef(false);
  const drag = useRef<number | null>(null);
  const close = useCallback(() => setSheet(null), [setSheet]);

  // Widened to the desktop layout (a tablet turned, a window resized), or opened there at all: the sheet is hidden from
  // md up, so it closes rather than hold focus out of sight. The bar's menus take over.
  useEffect(() => {
    if (!sheet) return;
    // A sheet opened (from a tab, or a full-screen studio's Menu): the routes one tap in it leads to start loading.
    if (sheet !== "you") warmNav(sheet);
    const mq = window.matchMedia(PHONE_QUERY);
    const onChange = () => !mq.matches && close();
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [sheet, close]);

  /** Search from a sheet: the sheet goes and the full-screen search comes; Esc there returns to the tab that opened it. */
  const openSearch = useCallback(() => {
    handoff.current = true;
    const back = opener.current;
    close();
    // A frame later the sheet no longer holds focus, so the search can note where to send it back.
    requestAnimationFrame(() => {
      if (back?.isConnected) back.focus({ preventScroll: true });
      search.open();
    });
  }, [close, search]);

  return (
    <>
      <Suspense fallback={null}>
        <CloseOnNavigate onPath={close} />
      </Suspense>
      <SheetPrimitive.Root open={sheet !== null} onOpenChange={(open) => !open && close()}>
        <SheetPrimitive.Portal>
          <SheetPrimitive.Overlay
            data-slot="sheet-overlay"
            className="fixed inset-x-0 top-0 bottom-[var(--chrome-bottom,0px)] z-50 bg-overlay md:hidden motion-safe:duration-150 motion-safe:data-open:animate-in motion-safe:data-open:fade-in-0 motion-safe:data-closed:animate-out motion-safe:data-closed:fade-out-0"
          />
          <SheetPrimitive.Content
            id="phone-sheet"
            data-slot="sheet-content"
            data-sheet={shown}
            aria-describedby={undefined}
            onOpenAutoFocus={() => {
              const at = document.activeElement;
              opener.current = at instanceof HTMLElement && at !== document.body ? at : null;
              tapped.current = null;
            }}
            onCloseAutoFocus={(e) => {
              // The sheet has no trigger of its own for Radix to return to: focus goes back here. Handed to the search,
              // which has focus now, it stays there.
              e.preventDefault();
              const handed = handoff.current;
              handoff.current = false;
              if (handed) return;
              sheetReturnTarget(opener.current, shown, tapped.current)?.focus({ preventScroll: true });
              tapped.current = null;
              opener.current = null;
            }}
            onInteractOutside={(e) => {
              const target = e.detail.originalEvent.target;
              const tab = target instanceof Element ? target.closest<HTMLElement>("[data-phone-tabs] [data-tab]") : null;
              if (target instanceof Element && target.closest("[data-phone-tabs]")) e.preventDefault();
              if (tab) tapped.current = tab;
            }}
            onClickCapture={(e) => {
              // A link in the sheet goes to its page and the sheet closes (a new-tab click leaves it open).
              const a = (e.target as Element).closest("a[href]");
              if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && a.getAttribute("target") !== "_blank") close();
            }}
            className={cn(
              "fixed inset-x-0 bottom-[var(--chrome-bottom,0px)] z-50 flex max-h-[calc(100dvh-var(--chrome-bottom,0px)-2.5rem)] data-[sheet=studios]:h-[calc(100dvh-var(--chrome-bottom,0px)-2.5rem)] flex-col gap-2.5 rounded-t-[22px] border-t border-border bg-popover pt-2 pr-[env(safe-area-inset-right)] pb-3 pl-[env(safe-area-inset-left)] text-popover-foreground shadow-heavy outline-none md:hidden",
              // No tab bar under it in a full-screen studio: it keeps clear of the home indicator itself.
              "[html[data-fullscreen-studio]_&]:pb-[max(0.75rem,env(safe-area-inset-bottom))]",
              "motion-safe:duration-200 motion-safe:data-open:animate-in motion-safe:data-open:fade-in-0 motion-safe:data-open:slide-in-from-bottom-10 motion-safe:data-closed:animate-out motion-safe:data-closed:fade-out-0 motion-safe:data-closed:slide-out-to-bottom-10",
            )}
          >
            <div
              className="flex shrink-0 touch-none flex-col gap-1.5"
              onPointerDown={(e) => {
                if (e.pointerType !== "mouse") drag.current = e.clientY;
              }}
              onPointerUp={(e) => {
                if (drag.current !== null && e.clientY - drag.current > SWIPE_CLOSE) close();
                drag.current = null;
              }}
              onPointerCancel={() => (drag.current = null)}
            >
              <span aria-hidden className="mx-auto h-1 w-10 rounded-full bg-border-strong" />
              <div className={cn("flex items-center pr-2", shown === "studios" ? "gap-1 pl-3" : "gap-3 pl-4")}>
                <SheetPrimitive.Title className={cn("font-heading text-[28px] leading-none font-normal text-foreground", shown === "studios" && "sr-only")}>
                  {shown === "studios" ? MEGA_AREAS[family].label : TITLES[shown]}
                </SheetPrimitive.Title>
                {shown === "studios" && <FamilySwitch family={family} onFamily={setFamily} />}
                {SEE_ALL[shown] && (
                  // A link in the sheet: following it closes the sheet (onClickCapture above).
                  <IntentLink
                    href={SEE_ALL[shown]}
                    aria-label={`See all ${TITLES[shown].toLowerCase()}`}
                    className="nav-row group/all ml-auto inline-flex h-11 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-brand-text"
                  >
                    See all
                    <ArrowRight aria-hidden className="size-4" />
                  </IntentLink>
                )}
                <SheetPrimitive.Close
                  className={cn(
                    "nav-row grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground nav-hover:text-foreground",
                    !SEE_ALL[shown] && shown !== "studios" && "ml-auto",
                  )}
                >
                  <XIcon className="size-5" aria-hidden />
                  <span className="sr-only">Close</span>
                </SheetPrimitive.Close>
              </div>
            </div>
            {shown === "studios" ? (
              // Opened again for another group while open: it starts over on that chip.
              <StudiosSheet key={`${family}:${family === sheetFamily ? (sheetGroup ?? "all") : "all"}`} family={family} group={family === sheetFamily ? sheetGroup : undefined} onSearch={openSearch} />
            ) : shown === "create" ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-1">
                <CreateList variant="sheet" onNavigate={close} />
              </div>
            ) : (
              <YouSheet />
            )}
          </SheetPrimitive.Content>
        </SheetPrimitive.Portal>
      </SheetPrimitive.Root>
    </>
  );
}
