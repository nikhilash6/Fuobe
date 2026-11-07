"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { BarMenuId } from "@/lib/bar-intent";
import { cn } from "@/lib/utils";
import { useBarMenu, type TriggerHandlers } from "./bar-menus";

/*
 * A bar item with a menu (Create, Studios, Apps, Motions & effects, Canvas, More): one button, one hit area, one
 * highlight. It shows and hides its menu (aria-expanded, aria-controls: the menu's section, straight after it); a plain
 * click never leaves the page. Its area's own page is the menu's first link ("See all"), and Ctrl/Cmd-click or a middle
 * click opens that page in a new tab (data-href).
 *
 * States are the nav's (nav-states.css): the highlight on hover or keyboard focus, the pressed fill, the open page's pip
 * under it (data-active: one of the area's pages is open), and while its menu is open foreground words, a turned
 * chevron and the bar's one open highlight (BarIndicator) behind it.
 */

/**
 * The item: 40 px (44 to tap), 10 px left and 8 px right of the words (8 and 8 from 1440 px, 12 and 10 from 1600 px), then
 * the chevron.
 */
export const BAR_TRIGGER =
  "nav-row nav-mark-under group/bar-item inline-flex h-10 shrink-0 items-center gap-1 rounded-[10px] pr-2 pl-2.5 text-[14px] whitespace-nowrap text-foreground/80 nav-hover:text-foreground focus-visible:text-foreground data-[open]:text-foreground data-[active]:font-semibold data-[active]:text-foreground min-[1440px]:pl-2 min-[1600px]:pr-2.5 min-[1600px]:pl-3 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11";

/** The chevron: a quiet mark inside the item (no box of its own); it turns while the menu is open. */
export const BarChevron = () => (
  <ChevronDown
    aria-hidden
    data-bar-chevron
    className="size-3 shrink-0 text-muted-foreground group-hover/bar-item:text-foreground group-data-[open]/bar-item:text-foreground"
  />
);

/**
 * The item. `id`: its menu; `panelId`: its section's id; `href`: its area's page (none for More); `label`: its words
 * (the accessible name, unless `name` says more: "Studios, 29 studios"); `active`: one of its pages is open.
 */
export function BarTrigger({
  id,
  panelId,
  href,
  label,
  name,
  icon,
  active,
  open,
  handlers,
  triggerRef,
  className,
  ...rest
}: {
  id: BarMenuId;
  panelId: string;
  href?: string;
  label: React.ReactNode;
  name?: string;
  icon?: React.ReactNode;
  active?: boolean;
  open: boolean;
  handlers?: TriggerHandlers;
  triggerRef?: React.Ref<HTMLButtonElement>;
  className?: string;
} & Omit<React.ComponentProps<"button">, "id" | "ref" | "onClick">) {
  return (
    <button
      ref={triggerRef}
      type="button"
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={name}
      aria-current={active ? "true" : undefined}
      data-bar-menu={id}
      data-bar-item=""
      data-href={href}
      data-active={active || undefined}
      data-open={open || undefined}
      className={cn(BAR_TRIGGER, className)}
      {...handlers}
      {...rest}
    >
      {icon}
      {label}
      <BarChevron />
    </button>
  );
}

/**
 * A bar item whose menu is a card under it (Create, More): the same one button and the same controller as the big
 * panels, with the card hanging 8 px under the item, left-aligned to it (the 8 px band counts as the card, so the
 * pointer can cross it). Its rows render once the pointer or focus comes near (or it opens).
 */
export function BarCardMenu({
  id,
  href,
  label,
  name,
  icon,
  active,
  className,
  cardClassName,
  onOpen,
  children,
  ...rest
}: {
  id: BarMenuId;
  href?: string;
  label: string;
  name?: string;
  icon?: React.ReactNode;
  active?: boolean;
  /** The wrapper's (which widths show the item). */
  className?: string;
  cardClassName?: string;
  /** It opened (start loading what its rows lead to). */
  onOpen?: () => void;
  children: React.ReactNode;
} & Omit<React.ComponentProps<"button">, "id" | "ref" | "onClick" | "className" | "children">) {
  const [near, setNear] = useState(false);
  const heat = useCallback(() => setNear(true), []);
  const { open, phase, trigger, surface, triggerRef, surfaceRef } = useBarMenu(id, { warm: heat });
  useEffect(() => {
    if (open) onOpen?.();
  }, [open, onOpen]);
  const panelId = `${id}-menu`;
  return (
    <div className={cn("relative inline-flex shrink-0", className)}>
      <BarTrigger id={id} panelId={panelId} href={href} label={label} name={name} icon={icon} active={active} open={open} handlers={trigger} triggerRef={triggerRef} {...rest} />
      <section
        ref={surfaceRef}
        id={panelId}
        data-bar-card={id}
        data-phase={phase}
        aria-label={label}
        hidden={phase === "gone"}
        inert={phase !== "open"}
        aria-hidden={phase === "exit" || undefined}
        {...surface}
        className="absolute top-full left-0 z-50 pt-2"
      >
        <div
          className={cn(
            "max-h-[calc(100dvh-4.5rem)] overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl bg-popover p-1.5 text-popover-foreground shadow-md ring-1 ring-foreground/10",
            cardClassName,
          )}
        >
          {(near || phase !== "gone") && children}
        </div>
      </section>
    </div>
  );
}
