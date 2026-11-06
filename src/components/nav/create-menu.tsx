"use client";

import { Plus } from "lucide-react";
import { usePathname } from "next/navigation";
import { useId } from "react";
import { IntentLink } from "@/components/intent-link";
import { navActive, NEW_CREATION_HREF } from "@/lib/nav";
import { area } from "@/lib/nav-areas";
import { CREATE_COLUMNS, entry, visibleTo, type NavEntry, type ViewerKind } from "@/lib/nav-model";
import { cn } from "@/lib/utils";
import { BarCardMenu } from "./bar-split";
import { warmNav } from "./nav-prefetch";
import { NavIcon } from "./cover-thumb";
import { useViewerKind } from "./nav-ui";
import { CARD_ROW, MENU_HEADING, MENU_ROW_1, MENU_ROW_2, ROW_LINE, rowName, SeeAllRow, SHEET_HEADING, SHEET_ROW } from "./nav-row";

/*
 * Create: the tools that start from words or a picture, in two labelled columns. The bar's Create card (links in a
 * grid: arrow keys move up and down a column and across to the other, Esc gives focus back to the item) and the
 * phone's Create sheet (a plain list) show the same items.
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
        {/* The area's own page: first in Tab order (the item, then See all, then the rows), at the top right. */}
        <div className="absolute top-1.5 right-1.5 z-10">
          <SeeAllRow href={CREATE_AREA_HREF} name="See all of Create" data-see-all className="h-8" />
        </div>
        <div className="grid grid-cols-2 gap-x-1.5">
          {columns.map((c, i) => (
            <div key={c.label} role="group" aria-labelledby={`${ids}-${i}`} className="flex min-w-0 flex-col">
              <div id={`${ids}-${i}`} className={MENU_HEADING}>
                {c.label}
              </div>
              {c.entries.map((e, r) => {
                const on = current(pathname, e.href, CREATE_HREFS);
                return (
                  <IntentLink
                    key={e.id}
                    href={e.href}
                    eager={e.eager}
                    aria-current={on ? "page" : undefined}
                    data-col={i}
                    data-row={r}
                    className={cn(CARD_ROW, MENU_ROW_2, "items-start")}
                  >
                    <NavIcon name={e.icon} className="nav-icon mt-px size-4 text-muted-foreground" />
                    <span className="flex min-w-0 flex-col">
                      <span className={rowName(on)}>{e.label}</span>
                      <span className={ROW_LINE}>{e.what}</span>
                    </span>
                  </IntentLink>
                );
              })}
            </div>
          ))}
        </div>
        <div role="separator" className="mx-2.5 my-1.5 h-px bg-border" />
        <IntentLink href={NEW_CREATION_HREF} eager data-col={0} data-row={columns[0]?.entries.length ?? 0} className={cn(CARD_ROW, MENU_ROW_1, "font-medium")}>
          <Plus aria-hidden className="size-4 text-brand-text" />
          New creation
        </IntentLink>
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

/** Opened: the routes its rows lead to start loading. */
const warmCreate = () => warmNav("create");

/**
 * The bar's Create item: one button that opens the Create card (resting on it with a mouse, a click, a tap, Enter,
 * Space or ArrowDown). Its page (/create) is the card's first link, "See all". `active`: a Create page is open.
 */
export function CreateMenu({ active }: { active?: boolean }) {
  return (
    <BarCardMenu id="create" href={CREATE_AREA_HREF} label="Create" active={active} onOpen={warmCreate} cardClassName="relative w-[520px] max-w-[calc(100vw-24px)]">
      <CreateList variant="menu" />
    </BarCardMenu>
  );
}
