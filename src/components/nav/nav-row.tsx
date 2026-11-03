"use client";

import { ArrowRight } from "lucide-react";
import { usePathname } from "next/navigation";
import { DropdownMenu as MenuPrimitive } from "radix-ui";
import { IntentLink } from "@/components/intent-link";
import { cn } from "@/lib/utils";

/*
 * The nav's rows, one anatomy and one set of states for every menu, sheet and panel (the states are in
 * app/nav-states.css: highlight, focus ring, pressed, current, open, disabled). On a 4 px scale:
 *   menu panel   6 px padding, rows 10 px radius, 10 px inline padding, 12 px between icon and words
 *   menu rows    48 px with a line under the name, 40 px with the name alone
 *   headings     11 px capitals, on the rows' icon column
 *   sheet rows   48 px, content on the sheet's 16 px gutter (the fill reaches 8 px past it)
 */

/**
 * A menu item's pointer leave: the highlight stays on the row the mouse left (Radix clears it unless the leave is
 * default-prevented), so the arrow keys go on from there, as they do in search.
 */
export function keepHighlight(e: React.PointerEvent) {
  e.preventDefault();
}

/** A row of a desktop menu: a Radix item (the mouse moves the keyboard's highlight) with the nav's states. */
export function NavMenuItem({ className, onPointerLeave, ...props }: React.ComponentProps<typeof MenuPrimitive.Item>) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      onPointerLeave={(e) => {
        onPointerLeave?.(e);
        keepHighlight(e);
      }}
      className={cn(
        "nav-row nav-mark-start flex cursor-pointer items-center gap-3 rounded-[10px] px-2.5 text-[13.5px] select-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

/** A row of a bar card (Create, More): a plain link with the nav's states (the bar's controller moves focus with the mouse). */
export const CARD_ROW =
  "nav-row nav-mark-start flex cursor-pointer items-center gap-3 rounded-[10px] px-2.5 text-[13.5px] select-none [&_svg]:pointer-events-none [&_svg]:shrink-0";

/** "See all": the area's own page, a one-line link in the brand's colour (`name`: for a screen reader). */
export function SeeAllRow({ href, name, className, ...rest }: { href: string; name: string; className?: string } & Omit<React.ComponentProps<typeof IntentLink>, "href">) {
  const pathname = usePathname();
  return (
    <IntentLink
      href={href}
      aria-current={pathname === href ? "page" : undefined}
      aria-label={name}
      className={cn(CARD_ROW, "group/all h-10 gap-2 font-medium text-brand-text", className)}
      {...rest}
    >
      See all
      <ArrowRight aria-hidden className="size-4 motion-safe:transition-transform group-hover/all:translate-x-0.5 group-focus-visible/all:translate-x-0.5" />
    </IntentLink>
  );
}

/** A two-line menu row (name and line): 48 px. */
export const MENU_ROW_2 = "min-h-12 py-[7px]";
/** A one-line menu row (name alone): 40 px. */
export const MENU_ROW_1 = "h-10";
/** A menu's group heading, on the rows' icon column. */
export const MENU_HEADING = "px-2.5 pt-2 pb-1 text-[11px] leading-4 font-semibold tracking-[.08em] text-brand-text uppercase";
/** A row's name and its line. */
export const ROW_NAME = "text-[13.5px] leading-[18px] font-medium";
export const ROW_LINE = "truncate text-[12px] leading-4 text-muted-foreground";

/** A row of a phone sheet: 48 px; the words sit on the sheet's gutter and the fill reaches 8 px past it. */
export const SHEET_ROW = "nav-row nav-mark-start -mx-2 flex min-h-12 items-center gap-3 rounded-xl px-2 text-left";
/** A sheet's group heading, on the gutter. */
export const SHEET_HEADING = "pb-1 text-[11px] leading-4 font-semibold tracking-[.08em] text-brand-text uppercase";

/** Names a row's weight: semibold for the open page, medium otherwise. */
export function rowName(current: boolean | undefined, base = ROW_NAME) {
  return cn(base, current && "font-semibold");
}
