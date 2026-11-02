"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { CircleUserRound, House, Library, Search } from "lucide-react";
import { CoverThumb } from "@/components/nav/cover-thumb";
import { useNavUi, useViewerKind } from "@/components/nav/nav-ui";
import { IntentLink } from "@/components/intent-link";
import { isNew, LAUNCHER_GROUPS, launcherActive, launcherEntries, type LauncherGroupId, type NavEntry } from "@/lib/nav-model";

/** A goal chip: 32 px to look at, 44 px to tap (the row's padding holds the larger hit area). */
const CHIP =
  "nav-focus relative h-8 min-w-11 shrink-0 rounded-full border border-border bg-secondary px-[7px] text-[12px] font-medium text-secondary-foreground after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] active:bg-[var(--nav-press)] aria-pressed:border-transparent aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:active:bg-foreground/85 motion-safe:transition-colors";

function Tile({ entry, current }: { entry: NavEntry; current: boolean }) {
  const fresh = isNew(entry);
  return (
    <li className="min-w-0">
      <IntentLink
        href={entry.href}
        aria-current={current ? "page" : undefined}
        className="nav-row nav-mark-under group/tile flex flex-col items-center gap-1 rounded-[16px] px-0.5 pt-1 pb-2.5 text-center"
      >
        <span className="relative">
          <CoverThumb
            id={entry.cover}
            icon={entry.icon}
            size="tile"
            eager
            className="size-13"
          />
          {fresh && (
            <span aria-hidden className="absolute -top-1 -right-1.5 rounded-full bg-highlight px-1 py-px text-[9px] leading-none font-semibold text-highlight-foreground">
              New
            </span>
          )}
        </span>
        <span aria-hidden className="line-clamp-2 text-[11px] leading-[1.2] text-foreground/85 group-aria-[current=page]/tile:font-semibold group-aria-[current=page]/tile:text-foreground">
          {entry.short ?? entry.label}
        </span>
        <span className="sr-only">
          {entry.label}
          {fresh ? ", new" : ""}
        </span>
      </IntentLink>
    </li>
  );
}

const SHORTCUT =
  "nav-focus flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl bg-secondary px-2 text-[12.5px] font-medium text-secondary-foreground active:bg-[var(--nav-press)]";

/**
 * Where to go from a full-screen studio, which has no tab bar: Home, Library, You and Search, above the studios. Only
 * there (html[data-fullscreen-studio]); with the tab bar on screen these are its tabs.
 */
function Shortcuts({ onSearch }: { onSearch: () => void }) {
  const { setSheet } = useNavUi();
  return (
    <div className="hidden shrink-0 grid-cols-4 gap-2 px-4 [html[data-fullscreen-studio]_&]:grid">
      <IntentLink href="/" eager className={SHORTCUT}>
        <House className="size-4" aria-hidden /> Home
      </IntentLink>
      <IntentLink href="/library" eager className={SHORTCUT}>
        <Library className="size-4" aria-hidden /> Library
      </IntentLink>
      <button type="button" className={SHORTCUT} onClick={() => setSheet("you")}>
        <CircleUserRound className="size-4" aria-hidden /> You
      </button>
      <button type="button" className={SHORTCUT} onClick={onSearch}>
        <Search className="size-4" aria-hidden /> Search
      </button>
    </div>
  );
}

/**
 * The Studios sheet's body (the phone's launcher): every studio on one screen as cover tiles, grouped by what you want to
 * make, with chips that narrow it to one group. All of them fit a 390 x 844 phone without scrolling; a shorter screen
 * scrolls the grid inside the sheet, never the page. The frame, its title and its close button are PhoneSheets'.
 */
export function StudiosSheet({ group: initial, onSearch }: { group?: LauncherGroupId; onSearch: () => void }) {
  const kind = useViewerKind();
  const pathname = usePathname() ?? "";
  const [group, setGroup] = useState<LauncherGroupId | null>(initial ?? null);
  const tiles = launcherEntries(kind, group ?? undefined);
  const current = launcherActive(pathname);
  const chips: { id: LauncherGroupId | null; label: string }[] = [{ id: null, label: "All" }, ...LAUNCHER_GROUPS.map((g) => ({ id: g.id, label: g.chip }))];
  return (
    <>
      <Shortcuts onSearch={onSearch} />
      <div role="group" aria-label="Show the studios for one goal" className="flex shrink-0 gap-1 overflow-x-auto px-4 py-1.5 scrollbar-none">
        {chips.map((c) => (
          <button key={c.id ?? "all"} type="button" aria-pressed={group === c.id} className={CHIP} onClick={() => setGroup(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
        <ul aria-label={group ? LAUNCHER_GROUPS.find((g) => g.id === group)?.label : "All studios"} className="grid grid-cols-5 gap-x-1 gap-y-0.5 pb-1">
          {tiles.map((e) => (
            <Tile key={e.id} entry={e} current={e.id === current} />
          ))}
        </ul>
      </div>
    </>
  );
}
