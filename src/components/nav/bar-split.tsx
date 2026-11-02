"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { IntentLink } from "@/components/intent-link";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { isPlainClick } from "@/lib/use-tapped-tab";
import { cn } from "@/lib/utils";
import { warmNav, type NavPanel } from "./nav-prefetch";
import { useNavUi } from "./nav-ui";

/*
 * A bar item with a page and a menu (Create, Studios, Motions & effects): one pill made of two controls. Its name is a
 * link to the area's page (/create, /studios, /motions-and-effects); the chevron beside it opens the menu, as does
 * ArrowDown on the name, and, with a mouse, resting on the item (not on the item of the page you are on). A touch
 * screen never opens it by hovering: a tap on the name goes to the page, a tap on the chevron opens the menu.
 *
 * States are the nav's (nav-states.css): each half has the highlight on hover or keyboard focus and the pressed fill;
 * the pill shows the open page's pip under it (data-active inside the area, aria-current="page" on the name on the
 * area's own page), and while the menu is open (data-open, data-state="open" on the chevron) foreground words and a
 * turned chevron, never a fill. The pill is exactly as wide as a plain item with a chevron (the name keeps its padding on the left, the
 * chevron takes the right padding and the gap), so the bar never grows.
 */

/** The pill around the two controls. */
export const BAR_SPLIT =
  "nav-mark-under group/bar-item inline-flex h-10 shrink-0 items-stretch rounded-[10px] text-[14px] whitespace-nowrap text-foreground/80 [@media(pointer:coarse)]:h-11 data-[active]:font-semibold data-[active]:text-foreground has-[[aria-current=page]]:font-semibold has-[[aria-current=page]]:text-foreground data-[open]:text-foreground";

/** The name: the area's page. */
export const BAR_LABEL = "nav-row inline-flex items-center gap-1.5 rounded-l-[10px] pr-1 pl-2.5 nav-hover:text-foreground focus-visible:text-foreground min-[1440px]:pl-3.5";

/** The chevron: the menu. 26 px wide (30 from 1440) with a mouse; 44 px to tap. */
export const BAR_CHEVRON =
  "nav-row inline-flex w-[26px] items-center justify-center rounded-r-[10px] text-muted-foreground nav-hover:text-foreground focus-visible:text-foreground data-[state=open]:text-foreground min-[1440px]:w-[30px] [@media(pointer:coarse)]:w-11";

export const BarChevron = () => <ChevronDown aria-hidden className="size-3.5 group-data-[open]/bar-item:rotate-180 motion-safe:transition-transform" />;

/**
 * How long the pointer rests on an item before its menu opens (long enough that sweeping along the bar to the search
 * opens nothing), and how long after it leaves before it closes.
 */
export const HOVER_OPEN_MS = 300;
export const HOVER_CLOSE_MS = 250;
/** Only a mouse (a fine pointer that can hover) opens a menu by resting on it. */
export const HOVER_QUERY = "(hover: hover) and (pointer: fine)";

const canHover = (e: React.PointerEvent) => e.pointerType === "mouse" && typeof window !== "undefined" && window.matchMedia(HOVER_QUERY).matches;

/**
 * Open on rest, close on leave, for a menu opened by hovering only: a menu opened by a click or a key stays until it is
 * closed (pinned). `open`: whether it is open now; `onOpen`/`onClose` change it; `off`: resting opens nothing (the
 * item is the page you are on, so its menu would only cover it). Put `enter`/`leave` on the item and on its panel, so
 * moving from one to the other keeps it open.
 */
export function useHoverIntent(open: boolean, onOpen: () => void, onClose: () => void, off = false) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Opened by hovering and not pinned since. */
  const byHover = useRef(false);
  const openRef = useRef(open);
  const cancel = useCallback(() => clearTimeout(timer.current), []);
  useEffect(() => cancel, [cancel]);
  useEffect(() => {
    openRef.current = open;
    // Closed some other way (Esc, a click outside, a row followed): the next hover starts afresh.
    if (!open) byHover.current = false;
  }, [open]);

  const enter = useCallback(
    (e: React.PointerEvent) => {
      if (!canHover(e)) return;
      cancel();
      if (openRef.current || off) return;
      timer.current = setTimeout(() => {
        byHover.current = true;
        onOpen();
      }, HOVER_OPEN_MS);
    },
    [cancel, onOpen, off],
  );
  const leave = useCallback(
    (e: React.PointerEvent) => {
      if (!canHover(e)) return;
      cancel();
      if (!openRef.current || !byHover.current) return;
      timer.current = setTimeout(() => {
        byHover.current = false;
        onClose();
      }, HOVER_CLOSE_MS);
    },
    [cancel, onClose],
  );
  /** A click or a key took over: no timer, and the menu stays open until closed. */
  const pin = useCallback(() => {
    cancel();
    byHover.current = false;
  }, [cancel]);
  return { enter, leave, cancel, pin, openedByHover: () => byHover.current };
}

/**
 * Opened by resting the pointer: focus stays where it was (a prompt being typed keeps its keys, and the menu's type-to-jump
 * never takes them). Radix's root menu content takes onOpenAutoFocus at run time; its public props leave it out.
 */
const keepFocusOnHover = (byHover: () => boolean) =>
  ({
    onOpenAutoFocus: (e: Event) => {
      if (byHover()) e.preventDefault();
    },
  }) as unknown as Partial<React.ComponentProps<typeof DropdownMenuContent>>;

/**
 * A split item whose menu is a Radix menu (Create, Motions & effects): arrow keys, typeahead, Esc and focus return come
 * with it. `name`: the chevron's accessible name ("Create menu"); `panel`: the routes to load ahead when it opens;
 * `onTap`: the name was clicked (the bar marks it at once).
 */
export function BarSplitMenu({
  href,
  label,
  name,
  active,
  current,
  panel,
  onTap,
  className,
  contentClassName,
  onContentKeyDown,
  children,
}: {
  href: string;
  label: React.ReactNode;
  name: string;
  active?: boolean;
  current?: boolean;
  panel: NavPanel;
  onTap?: (href: string) => void;
  className?: string;
  contentClassName?: string;
  /** Keys the menu's content handles beyond Radix's own (the Create menu's Left and Right across its columns). */
  onContentKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const { launcherOpen, setLauncherOpen } = useNavUi();
  const pill = useRef<HTMLDivElement>(null);
  const nameLink = useRef<HTMLAnchorElement>(null);
  const chevron = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  /** Opened from the name with ArrowDown: the first row takes focus, and Esc brings it back to the name. */
  const focusFirst = useRef(false);
  const fromName = useRef(false);
  /** Closed because the pointer left: focus stays where it is (on the page), not on the chevron. */
  const quietClose = useRef(false);

  /** Open or close. `pinned`: by a click or a key, so its rows start loading; a bare hover loads them only once the pointer reaches the menu. */
  const show = useCallback(
    (o: boolean, pinned = true) => {
      if (o) {
        // The menu lines up with the pill's left edge, not the chevron's.
        const p = pill.current?.getBoundingClientRect();
        const c = chevron.current?.getBoundingClientRect();
        if (p && c) setOffset(p.left - c.left);
        if (pinned) warmNav(panel);
      }
      setOpen(o);
    },
    [panel],
  );
  // Opened from the name with ArrowDown: once the menu has taken focus, its first row gets it.
  useEffect(() => {
    if (!open || !focusFirst.current) return;
    focusFirst.current = false;
    const id = requestAnimationFrame(() => content.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);
  const hover = useHoverIntent(
    open,
    useCallback(() => {
      fromName.current = false;
      // One panel at a time: the Studios launcher, open from a click, gives way (focus stays where it is).
      if (launcherOpen) setLauncherOpen(false);
      show(true, false);
    }, [show, launcherOpen, setLauncherOpen]),
    useCallback(() => {
      quietClose.current = true;
      show(false);
    }, [show]),
    current,
  );

  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(o) => {
        if (o) {
          hover.pin();
          fromName.current = false;
        }
        show(o);
      }}
    >
      <div
        ref={pill}
        data-bar-split
        data-active={active || undefined}
        data-open={open || undefined}
        className={cn(BAR_SPLIT, className)}
        onPointerEnter={hover.enter}
        onPointerLeave={hover.leave}
      >
        <IntentLink
          ref={nameLink}
          href={href}
          aria-current={current ? "page" : undefined}
          className={BAR_LABEL}
          onClick={(e) => {
            hover.cancel();
            if (open) {
              quietClose.current = true;
              setOpen(false);
            }
            if (isPlainClick(e)) onTap?.(href);
          }}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" || e.altKey || e.metaKey || e.ctrlKey) return;
            e.preventDefault();
            focusFirst.current = true;
            fromName.current = true;
            hover.pin();
            show(true);
          }}
        >
          {label}
        </IntentLink>
        <DropdownMenuTrigger
          ref={chevron}
          aria-label={name}
          className={BAR_CHEVRON}
          onPointerDown={(e) => {
            // Open by hovering: a click on the chevron keeps it open (pins it) rather than closing it.
            if (open && hover.openedByHover()) {
              e.preventDefault();
              hover.pin();
            }
          }}
        >
          <BarChevron />
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent
        ref={content}
        align="start"
        alignOffset={offset}
        sideOffset={8}
        collisionPadding={12}
        className={contentClassName}
        onKeyDown={onContentKeyDown}
        onPointerEnter={(e) => {
          hover.enter(e);
          warmNav(panel);
        }}
        onPointerLeave={hover.leave}
        {...keepFocusOnHover(hover.openedByHover)}
        onCloseAutoFocus={(e) => {
          if (quietClose.current) {
            quietClose.current = false;
            e.preventDefault();
            return;
          }
          // Opened from the name with ArrowDown: Esc goes back to the name, not the chevron.
          if (fromName.current) {
            fromName.current = false;
            e.preventDefault();
            nameLink.current?.focus();
          }
        }}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
