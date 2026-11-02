"use client";

import { ArrowRight, Plus } from "lucide-react";
import { usePathname } from "next/navigation";
import { useId } from "react";
import { IntentLink } from "@/components/intent-link";
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { navActive, NEW_CREATION_HREF } from "@/lib/nav";
import { area } from "@/lib/nav-areas";
import { CREATE_COLUMNS, entry, visibleTo, type NavEntry, type ViewerKind } from "@/lib/nav-model";
import { cn } from "@/lib/utils";
import { BarSplitMenu } from "./bar-split";
import { NavIcon } from "./cover-thumb";
import { useViewerKind } from "./nav-ui";

/*
 * Create: the tools that start from words or a picture, in two labelled columns. The bar's Create menu (a menu: arrow
 * keys, typeahead, Esc and focus return come with it) and the phone's Create sheet (a plain list) show the same items.
 * "New creation" (a fresh composer on Home) closes both.
 */

/**
 * A nav menu row: a clear ring on the row the keyboard is on, and a brand bar at the start of the open page's row (the
 * tint alone is too close to the hover one to tell them apart).
 */
export const NAV_MENU_ITEM =
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-[current]:shadow-[inset_3px_0_0_var(--brand-text)]";

/** The two columns, in order: kept in the navigation model, so the /create page (a server component) reads them too. */
export { CREATE_COLUMNS };

/** The Create columns this viewer may see. */
export function createColumns(kind: ViewerKind | undefined): { label: string; entries: NavEntry[] }[] {
  return CREATE_COLUMNS.map((c) => ({
    label: c.label,
    entries: c.ids.map((id) => entry(id)).filter((e): e is NavEntry => !!e && visibleTo(e, kind)),
  }));
}

/** Every page the Create menu links to (the bar marks Create when one of them is open). */
export const CREATE_HREFS: readonly string[] = CREATE_COLUMNS.flatMap((c) => c.ids.map((id) => entry(id)?.href ?? "")).filter(Boolean);

/** The current page among `hrefs` (a page below a link counts, as in the sidebar). */
function current(pathname: string, href: string, hrefs: readonly string[]) {
  return navActive(href, pathname, new URLSearchParams(), [...hrefs]);
}

/**
 * The Create items. `menu`: rows of the bar's menu (inside DropdownMenuContent). `sheet`: the phone's Create sheet, 48 px
 * rows with "New creation" first, full width; `onNavigate` closes the sheet when a row is followed.
 */
export function CreateList({ variant, onNavigate }: { variant: "menu" | "sheet"; onNavigate?: () => void }) {
  const kind = useViewerKind();
  const pathname = usePathname();
  const columns = createColumns(kind);
  const ids = useId();
  if (variant === "menu")
    return (
      <>
        <div className="grid grid-cols-2 gap-x-1">
          {columns.map((c, i) => (
            <DropdownMenuGroup key={c.label} aria-labelledby={`${ids}-${i}`} className="flex min-w-0 flex-col">
              <DropdownMenuLabel id={`${ids}-${i}`} className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-[.08em] text-brand-text uppercase">
                {c.label}
              </DropdownMenuLabel>
              {c.entries.map((e) => {
                const on = current(pathname, e.href, CREATE_HREFS);
                return (
                  <DropdownMenuItem key={e.id} asChild className={cn("min-h-11 items-start gap-2.5 rounded-lg px-2.5 py-2 data-[current]:bg-brand-faint", NAV_MENU_ITEM)}>
                    <IntentLink href={e.href} eager={e.eager} aria-current={on ? "page" : undefined} data-current={on || undefined}>
                      <NavIcon name={e.icon} className="mt-0.5 size-4 text-muted-foreground" />
                      <span className="flex min-w-0 flex-col">
                        <span className={cn("text-[13.5px] leading-tight font-medium", on && "font-semibold")}>{e.label}</span>
                        <span className="truncate text-[12px] leading-snug text-muted-foreground">{e.what}</span>
                      </span>
                    </IntentLink>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          ))}
        </div>
        <DropdownMenuSeparator className="my-1.5" />
        <div className="grid grid-cols-2 gap-x-1">
          <DropdownMenuItem asChild className={cn("h-10 gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium", NAV_MENU_ITEM)}>
            <IntentLink href={NEW_CREATION_HREF} eager>
              <Plus aria-hidden className="size-4 text-brand-text" />
              New creation
              <Kbd aria-hidden className="ml-auto [@media(hover:none)]:hidden">
                ↵
              </Kbd>
            </IntentLink>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className={cn("group/all h-10 gap-2 rounded-lg px-2.5 text-[13.5px] font-medium text-brand-text", NAV_MENU_ITEM)}>
            <IntentLink href={CREATE_AREA_HREF} aria-current={pathname === CREATE_AREA_HREF ? "page" : undefined} aria-label="See all of Create">
              See all
              <ArrowRight aria-hidden className="size-4 motion-safe:transition-transform group-hover/all:translate-x-0.5" />
            </IntentLink>
          </DropdownMenuItem>
        </div>
      </>
    );
  const follow = (e: React.MouseEvent) => {
    if ((e.target as Element).closest("a[href]")) onNavigate?.();
  };
  return (
    <div className="flex flex-col gap-4" onClick={follow}>
      <IntentLink
        href={NEW_CREATION_HREF}
        eager
        className="flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Plus aria-hidden className="size-5" />
        New creation
      </IntentLink>
      {columns.map((c, i) => (
        <section key={c.label} aria-labelledby={`${ids}-s${i}`} className="flex flex-col">
          <h3 id={`${ids}-s${i}`} className="px-1 pb-1 text-[11px] font-semibold tracking-[.08em] text-brand-text uppercase">
            {c.label}
          </h3>
          <ul className="flex flex-col">
            {c.entries.map((e) => {
              const on = current(pathname, e.href, CREATE_HREFS);
              return (
                <li key={e.id}>
                  <IntentLink
                    href={e.href}
                    eager={e.eager}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-xl px-2 py-1.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-colors",
                      on && "bg-brand-faint",
                    )}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-muted">
                      <NavIcon name={e.icon} className="size-[18px] text-foreground" />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className={cn("text-[15px] leading-tight font-medium", on && "font-semibold")}>{e.label}</span>
                      <span className="truncate text-[12.5px] text-muted-foreground">{e.what}</span>
                    </span>
                  </IntentLink>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Create's own page: everything it holds, with covers ("See all" in the menu and on the phone's sheet). */
export const CREATE_AREA_HREF = area("create").href;

/**
 * The bar's Create item: its name goes to /create, its chevron (or ArrowDown, or resting on it with a mouse) opens the
 * menu. `active`: a Create page is open; `current`: /create itself; `onTap`: the name was clicked.
 */
export function CreateMenu({ active, current, onTap }: { active?: boolean; current?: boolean; onTap?: (href: string) => void }) {
  return (
    <BarSplitMenu
      href={CREATE_AREA_HREF}
      label="Create"
      name="Create menu"
      active={active}
      current={current}
      panel="create"
      onTap={onTap}
      contentClassName="w-[520px] max-w-[calc(100vw-24px)] p-1.5"
    >
      <CreateList variant="menu" />
    </BarSplitMenu>
  );
}
