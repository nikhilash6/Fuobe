"use client";

import { Plus } from "lucide-react";
import { usePathname } from "next/navigation";
import { useId } from "react";
import { IntentLink } from "@/components/intent-link";
import { DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { navActive, NEW_CREATION_HREF } from "@/lib/nav";
import { area } from "@/lib/nav-areas";
import { CREATE_COLUMNS, entry, visibleTo, type NavEntry, type ViewerKind } from "@/lib/nav-model";
import { cn } from "@/lib/utils";
import { BarSplitMenu } from "./bar-split";
import { NavIcon } from "./cover-thumb";
import { useViewerKind } from "./nav-ui";
import { MENU_HEADING, MENU_ROW_1, MENU_ROW_2, NavMenuItem, ROW_LINE, rowName, SeeAllRow, SHEET_HEADING, SHEET_ROW } from "./nav-row";

/*
 * Create: the tools that start from words or a picture, in two labelled columns. The bar's Create menu (a menu: arrow
 * keys, typeahead, Esc and focus return come with it) and the phone's Create sheet (a plain list) show the same items.
 * "New creation" (a fresh composer on Home) closes both.
 */

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
        <div className="grid grid-cols-2 gap-x-1.5" data-menu-columns>
          {columns.map((c, i) => (
            <DropdownMenuGroup key={c.label} aria-labelledby={`${ids}-${i}`} data-menu-column={i} className="flex min-w-0 flex-col">
              <DropdownMenuLabel id={`${ids}-${i}`} className={MENU_HEADING}>
                {c.label}
              </DropdownMenuLabel>
              {c.entries.map((e) => {
                const on = current(pathname, e.href, CREATE_HREFS);
                return (
                  <NavMenuItem key={e.id} asChild className={cn(MENU_ROW_2, "items-start")}>
                    <IntentLink href={e.href} eager={e.eager} aria-current={on ? "page" : undefined}>
                      <NavIcon name={e.icon} className="nav-icon mt-px size-4 text-muted-foreground" />
                      <span className="flex min-w-0 flex-col">
                        <span className={rowName(on)}>{e.label}</span>
                        <span className={ROW_LINE}>{e.what}</span>
                      </span>
                    </IntentLink>
                  </NavMenuItem>
                );
              })}
            </DropdownMenuGroup>
          ))}
        </div>
        <DropdownMenuSeparator className="mx-2.5 my-1.5" />
        {/* The foot: two rows on the columns' grid (Left and Right move between them too). */}
        <div className="grid grid-cols-2 gap-x-1.5" data-menu-columns>
          <DropdownMenuGroup data-menu-column={0} className="flex min-w-0 flex-col">
            <NavMenuItem asChild className={cn(MENU_ROW_1, "font-medium")}>
              <IntentLink href={NEW_CREATION_HREF} eager>
                <Plus aria-hidden className="size-4 text-brand-text" />
                New creation
                <Kbd aria-hidden className="ml-auto [@media(hover:none)]:hidden">
                  ↵
                </Kbd>
              </IntentLink>
            </NavMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuGroup data-menu-column={1} className="flex min-w-0 flex-col">
            <SeeAllRow href={CREATE_AREA_HREF} name="See all of Create" />
          </DropdownMenuGroup>
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
        className="nav-focus-out flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground nav-hover:bg-primary/90 active:bg-primary/85"
      >
        <Plus aria-hidden className="size-5" />
        New creation
      </IntentLink>
      {columns.map((c, i) => (
        <section key={c.label} aria-labelledby={`${ids}-s${i}`} className="flex flex-col">
          <h3 id={`${ids}-s${i}`} className={SHEET_HEADING}>
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
                    className={cn(SHEET_ROW, "py-1.5")}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-muted">
                      <NavIcon name={e.icon} className="nav-icon size-[18px] text-foreground" />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className={rowName(on, "text-[15px] leading-5 font-medium")}>{e.label}</span>
                      <span className="truncate text-[12.5px] leading-4 text-muted-foreground">{e.what}</span>
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
 * Left and Right in the menu's two columns: the same row of the other column, or its last when that one is shorter.
 * `lengths`: the rows in each column. Null when the key goes nowhere (an edge, another key).
 */
export function columnMove(lengths: readonly number[], at: { col: number; row: number }, key: string): { col: number; row: number } | null {
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  const col = at.col + (key === "ArrowLeft" ? -1 : 1);
  const len = lengths[col] ?? 0;
  if (col < 0 || col >= lengths.length || !len) return null;
  return { col, row: Math.min(at.row, len - 1) };
}

/** Moves the menu's highlight across its columns (Radix's own keys are Up, Down, Home, End and typeahead). */
function onColumnsKey(e: React.KeyboardEvent<HTMLElement>) {
  const item = (e.target as HTMLElement).closest<HTMLElement>('[role="menuitem"]');
  const column = item?.closest<HTMLElement>("[data-menu-column]");
  const grid = column?.closest<HTMLElement>("[data-menu-columns]");
  if (!item || !column || !grid) return;
  const columns = [...grid.querySelectorAll<HTMLElement>(":scope > [data-menu-column]")].map((c) => [...c.querySelectorAll<HTMLElement>('[role="menuitem"]')]);
  const col = Number(column.dataset.menuColumn);
  const next = columnMove(
    columns.map((c) => c.length),
    { col, row: columns[col]?.indexOf(item) ?? 0 },
    e.key,
  );
  if (!next) return;
  e.preventDefault();
  columns[next.col]?.[next.row]?.focus();
}

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
      onContentKeyDown={onColumnsKey}
    >
      <CreateList variant="menu" />
    </BarSplitMenu>
  );
}
