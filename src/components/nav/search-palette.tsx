"use client";

import { useQuery } from "@tanstack/react-query";
import { Command as CommandPrimitive } from "cmdk";
import { Loader2, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Dialog as DialogPrimitive } from "radix-ui";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSkills } from "@/components/assist/hooks";
import { Kbd } from "@/components/ui/kbd";
import { signInHref, useEngineMode, useGenerations, useModelAccess } from "@/lib/api";
import type { Generation } from "@/lib/catalog/types";
import { indexEntries, KIND_LABELS, skillEntries } from "@/lib/command-search";
import { useModKey } from "@/lib/keys";
import { entriesFor, entry, LAUNCHER_GROUPS, launcherEntries, studioCount, visibleTo, type LauncherGroupId, type NavEntry } from "@/lib/nav-model";
import { isExternal, isThemeAction, navSearchEntries, searchNav, type NavHit, type SearchResult } from "@/lib/nav-search";
import { cn } from "@/lib/utils";
import { useViewerKind } from "./nav-ui";
import { fetchPaletteIndex, PALETTE_INDEX_KEY, type PaletteScope, type PaletteSession } from "./search-context";
import { AlsoTile, BestRow, HitRow, RecentRow, sectionHeading, StudioTile } from "./search-results";

/*
 * The search palette: one field that finds every studio, tool, app, camera motion, effect, model, setting and recent
 * creation by what you want to make ("ad for my perfume"), and below it every studio at once, filtered by goal. A
 * dialog over the page on a laptop; the whole screen on a phone. Loaded on its own (search-context.tsx).
 */

// The viewer is only needed once a recent creation is opened from the palette.
const Viewer = lazy(() => import("@/components/studio/viewer").then((m) => ({ default: m.Viewer })));

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Enter and Space belong to a button inside the palette, not to the list's selected row (cmdk acts on Enter). */
const keepKeys = (e: React.KeyboardEvent) => {
  if (e.key === "Enter" || e.key === " ") e.stopPropagation();
};

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** On the page and shown (a launcher link is gone once the launcher closes). */
function shownEl(el: Element | null | undefined): el is HTMLElement {
  if (!(el instanceof HTMLElement) || !el.isConnected) return false;
  return typeof el.checkVisibility === "function" ? el.checkVisibility() : el.getClientRects().length > 0;
}

/**
 * Focus back to what had it when the palette opened; when that is hidden now (a link of the launcher, which closed),
 * to the Studios button, else to the page.
 */
export function returnFocus(el: Element | null) {
  const to = shownEl(el) ? el : [...document.querySelectorAll("[data-studios-trigger]")].find(shownEl) ?? document.getElementById("content");
  to?.focus({ preventScroll: true });
}

export function SearchPalette({ session, onClose, takeReturn }: { session: PaletteSession; onClose: () => void; takeReturn: () => Element | null }) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [viewing, setViewing] = useState<Generation | null>(null);
  // Set when the palette closes onto something else (a page, the viewer): focus stays with that.
  const leaving = useRef(false);

  const pick = useCallback(
    (href: string, id?: string) => {
      onClose();
      if (isThemeAction(href)) return setTheme(resolvedTheme === "dark" ? "light" : "dark");
      if (isExternal(href)) return void window.open(href, "_blank", "noopener,noreferrer");
      leaving.current = true;
      // Signing up or in comes back to this page.
      if (id === "signup" || id === "login") return router.push(signInHref(id, `${location.pathname}${location.search}`));
      router.push(href);
    },
    [onClose, router, resolvedTheme, setTheme],
  );
  const openRecent = useCallback(
    (g: Generation) => {
      leaving.current = true;
      onClose();
      setViewing(g);
    },
    [onClose],
  );
  // Dismissed (Esc, Cancel, a click outside, Ctrl+K again): focus goes back where it was (the field you were typing
  // in, the search button), not to the top of the page.
  const restoreFocus = useCallback(
    (e: Event) => {
      e.preventDefault();
      const el = takeReturn();
      if (leaving.current) {
        leaving.current = false;
        return;
      }
      returnFocus(el);
    },
    [takeReturn],
  );

  return (
    <>
      <DialogPrimitive.Root open={session.open} onOpenChange={(o) => !o && onClose()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] motion-safe:duration-150 motion-safe:data-open:animate-in motion-safe:data-open:fade-in-0 motion-safe:data-closed:animate-out motion-safe:data-closed:fade-out-0" />
          <DialogPrimitive.Content
            onCloseAutoFocus={restoreFocus}
            className={cn(
              "fixed inset-0 z-50 flex h-dvh w-full flex-col overflow-hidden bg-popover text-popover-foreground outline-none",
              "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
              "md:inset-auto md:top-[58px] md:left-1/2 md:h-auto md:max-h-[min(784px,calc(100dvh-116px))] md:w-[760px] md:max-w-[calc(100vw-2rem)] md:-translate-x-1/2 md:rounded-[18px] md:border md:pt-0 md:pb-0 md:shadow-heavy",
              "motion-safe:duration-150 motion-safe:data-open:animate-in motion-safe:data-open:fade-in-0 motion-safe:data-closed:animate-out motion-safe:data-closed:fade-out-0 md:motion-safe:data-open:zoom-in-98",
            )}
          >
            <DialogPrimitive.Title className="sr-only">Search Fuobe</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Find a studio, a tool, an app, a camera motion, an effect, a model, a setting or a recent creation, or browse every studio.
            </DialogPrimitive.Description>
            <PaletteBody key={session.id} initialQuery={session.query ?? ""} initialGroup={session.group} initialScope={session.scope} onPick={pick} onOpenRecent={openRecent} onClose={onClose} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      {viewing && (
        <Suspense fallback={null}>
          <Viewer generation={viewing} index={0} onClose={() => setViewing(null)} />
        </Suspense>
      )}
    </>
  );
}

type Group = LauncherGroupId | "all";

/**
 * Keeps aria-activedescendant on the field and the list on the row that is selected. The selection is ours (each query
 * starts on its best match), and cmdk only updates the id it announces on its own arrow-key moves.
 */
function useActiveDescendant(input: React.RefObject<HTMLInputElement | null>, list: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = list.current;
    if (!root) return;
    const sync = () => {
      const id = root.querySelector("[cmdk-item][data-selected=true]")?.id;
      for (const el of [input.current, root]) {
        if (!el) continue;
        if (id) {
          if (el.getAttribute("aria-activedescendant") !== id) el.setAttribute("aria-activedescendant", id);
        }
        else el.removeAttribute("aria-activedescendant");
      }
    };
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-selected"] });
    return () => mo.disconnect();
  }, [input, list]);
}

/**
 * The row the list starts on. cmdk keeps no selection once the rows change (the filtering is ours): each new query
 * starts on its best match, so Enter opens it; with nothing typed, on the first studio. The arrows move from there.
 */
export function startValue(searching: boolean, result: SearchResult, recents: Pick<Generation, "id">[], tiles: Pick<NavEntry, "id">[]): string {
  const tile = tiles[0] ? `tile:${tiles[0].id}` : "";
  if (!searching) return tile;
  const first = result.best[0] ?? result.also[0] ?? result.groups[0]?.hits[0];
  return first?.key ?? (recents[0] ? `recent:${recents[0].id}` : tile);
}

/** What the palette lists and searches; mounted afresh on each open. */
export function PaletteBody({
  initialQuery,
  initialGroup,
  initialScope,
  onPick,
  onOpenRecent,
  onClose,
}: {
  initialQuery: string;
  initialGroup?: LauncherGroupId;
  /** Search only these pages (an area's), until its chip is removed. */
  initialScope?: PaletteScope;
  onPick: (href: string, id?: string) => void;
  onOpenRecent: (g: Generation) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(initialQuery);
  const [group, setGroup] = useState<Group>(initialGroup ?? "all");
  const [scope, setScope] = useState(initialScope);
  const dq = useDebounced(q.trim(), 200);
  const kind = useViewerKind();
  const mode = useEngineMode();
  const access = useModelAccess();
  const index = useQuery({ queryKey: PALETTE_INDEX_KEY, queryFn: fetchPaletteIndex, staleTime: Infinity });
  const recent = useGenerations({ q: dq || undefined, limit: 5, statuses: ["succeeded"] }, { keepPrevious: true });
  // Skills that run by themselves: "Run <skill>…" opens its Run form.
  const skills = useSkills();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useActiveDescendant(input, list);

  // Nothing a viewer can't see is searched (and before the viewer is known: what a guest may see).
  // Inside an area: its pages only (no apps, models or skills), until the chip is removed.
  const scoped = useMemo(() => (scope ? scope.ids.map(entry).filter((e): e is NavEntry => !!e && visibleTo(e, kind)) : undefined), [scope, kind]);
  const nav = useMemo(() => navSearchEntries(scoped ?? entriesFor(kind)), [scoped, kind]);
  const entries = useMemo(
    () =>
      scoped ? nav : [...nav, ...skillEntries(skills.data ?? []), ...(index.data ? indexEntries(index.data, mode, access, { owner: kind === "owner" }) : [])],
    [scoped, nav, skills.data, index.data, mode, access, kind],
  );
  // Not deferred: ranking every entry takes a millisecond or two, and Enter must act on what was typed.
  const result = useMemo(() => searchNav(q, entries), [q, entries]);
  const searching = !!q.trim();
  const recentItems = (recent.data ?? []).filter((g) => g.outputs[0]);
  const tiles = useMemo(() => scoped ?? launcherEntries(kind, group === "all" ? undefined : group), [scoped, kind, group]);

  const best = startValue(searching, result, recentItems, tiles);
  const [moved, setMoved] = useState<{ q: string; group: Group; value: string } | null>(null);
  const selected = moved?.q === q && moved.group === group ? moved.value : best;

  const total = result.best.length + result.also.length + result.groups.reduce((n, g) => n + g.hits.length, 0) + (searching ? recentItems.length : 0);
  const announce = useDebounced(searching ? (total ? `${total} result${total === 1 ? "" : "s"}` : "No results") : "", 300);

  const pickHit = (h: NavHit) => onPick(h.href, h.id);
  const pickTile = (e: NavEntry) => onPick(e.href, e.id);
  const groupLabel = group === "all" ? undefined : LAUNCHER_GROUPS.find((g) => g.id === group)?.label;

  return (
    <CommandPrimitive
      shouldFilter={false}
      loop
      value={selected}
      onValueChange={(value) => setMoved({ q, group, value })}
      label="Search Fuobe"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex h-[68px] shrink-0 items-center gap-3.5 border-b border-brand-text/25 pr-3.5 pl-[22px] max-md:pl-4">
        <Search aria-hidden className="size-5 shrink-0 text-brand-text" />
        {scope && (
          <button
            type="button"
            onKeyDown={keepKeys}
            onClick={() => {
              setScope(undefined);
              input.current?.focus();
            }}
            aria-label={`Searching in ${scope.label}. Search everything instead`}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-brand-text/40 bg-brand-faint pr-1.5 pl-2.5 text-[13px] font-medium text-brand-text hover:bg-brand-faint/70 [@media(pointer:coarse)]:h-11",
              focusRing,
            )}
          >
            In {scope.label}
            <X aria-hidden className="size-3.5" />
          </button>
        )}
        <CommandPrimitive.Input
          ref={input}
          value={q}
          onValueChange={setQ}
          autoFocus
          placeholder="What do you want to make?"
          aria-label="Search studios, apps, motions and effects"
          className="h-11 min-w-0 flex-1 bg-transparent text-[20px] caret-brand-text outline-none placeholder:text-muted-foreground max-md:text-[17px]"
        />
        {index.isLoading && searching && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Loading the catalog" />}
        {q && (
          <button
            type="button"
            aria-label="Clear search"
            onKeyDown={keepKeys}
            onClick={() => {
              setQ("");
              input.current?.focus();
            }}
            className={cn("grid size-10 shrink-0 place-items-center rounded-[10px] text-muted-foreground hover:bg-accent hover:text-foreground max-md:size-11 [@media(pointer:coarse)]:size-11", focusRing)}
          >
            <X className="size-4" />
          </button>
        )}
        {/* Touch screens have no Esc (and a phone shows the palette full screen): a visible way out. */}
        <button
          type="button"
          onKeyDown={keepKeys}
          onClick={onClose}
          // Its name starts with the words it shows (Esc on a desktop, Cancel on a phone), for voice control.
          className={cn(
            "h-10 shrink-0 rounded-[10px] border bg-secondary px-3 max-md:h-11 [@media(pointer:coarse)]:h-11 text-[12px] font-medium text-secondary-foreground hover:bg-accent max-md:border-0 max-md:bg-transparent max-md:px-2 max-md:text-[15px] max-md:text-brand-text [@media(hover:none)]:border-0 [@media(hover:none)]:bg-transparent [@media(hover:none)]:text-[15px] [@media(hover:none)]:text-brand-text",
            focusRing,
          )}
        >
          <span className="max-md:hidden [@media(hover:none)]:hidden">
            Esc<span className="sr-only"> (close search)</span>
          </span>
          <span className="md:hidden [@media(hover:none)]:inline!">
            Cancel<span className="sr-only"> search</span>
          </span>
        </button>
      </div>

      {/* The goal chips: buttons, so outside the list (a listbox holds options only). With nothing typed they head the
          studios right under them; while searching the studios come last, under their own heading. */}
      {!searching && !scoped && (
        <div className="shrink-0 px-5 pt-2.5 max-md:px-3">
          <div className="flex flex-wrap items-center gap-x-2.5 py-1 md:h-10 md:flex-nowrap md:py-0">
            <span aria-hidden className="ml-1.5 text-[11px] leading-[14px] font-semibold tracking-[.08em] text-brand-text uppercase">
              Every studio
            </span>
            <span className="text-[12px] text-muted-foreground">{groupLabel ? `${tiles.length} in ${groupLabel}` : studioCount()}</span>
            <div
              role="group"
              aria-label="Show the studios for one goal"
              className="-mx-1 flex w-full items-center gap-0.5 overflow-x-auto px-1 scrollbar-none md:ml-auto md:w-auto md:overflow-visible"
            >
              {(["all", ...LAUNCHER_GROUPS.map((g) => g.id)] as Group[]).map((id) => {
                const g = LAUNCHER_GROUPS.find((x) => x.id === id);
                const on = group === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    aria-label={g ? g.label : "All studios"}
                    onKeyDown={keepKeys}
                    onClick={() => setGroup(id)}
                    className={cn("group/chip flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full px-0.5 md:h-10", focusRing)}
                  >
                    <span
                      className={cn(
                        "inline-flex h-7 items-center rounded-full border px-[11px] text-[12px] font-medium motion-safe:transition-colors",
                        on ? "border-brand-text/40 bg-brand-faint text-brand-text" : "border-border text-muted-foreground group-hover/chip:text-foreground",
                      )}
                    >
                      {g ? g.chip : "All"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <CommandPrimitive.List ref={list} className={cn("min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-5 pb-3 outline-none max-md:px-3", searching ? "pt-3.5" : "pt-1")}>
        {searching && (
          <>
            {total === 0 && (
              <p className="py-8 text-center text-[13px] text-muted-foreground">
                {index.isLoading ? "Looking through apps, motions and models…" : `Nothing matches “${q.trim()}”. Try a shorter word, or pick a studio below.`}
              </p>
            )}
            {result.best.length > 0 && (
              <CommandPrimitive.Group heading="Best matches" className={cn("mb-4", sectionHeading)}>
                <div className="flex flex-col gap-0.5">
                  {result.best.map((h) => (
                    <BestRow key={h.key} hit={h} onPick={pickHit} />
                  ))}
                </div>
              </CommandPrimitive.Group>
            )}
            {result.also.length > 0 && (
              <CommandPrimitive.Group heading="Also try" className={cn("mb-4", sectionHeading)}>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {result.also.map((h) => (
                    <AlsoTile key={h.key} hit={h} onPick={pickHit} />
                  ))}
                </div>
              </CommandPrimitive.Group>
            )}
            {result.groups.map((g) => (
              <CommandPrimitive.Group key={g.kind} heading={g.label} className={cn("mb-4", sectionHeading)}>
                {g.hits.map((h) => (
                  <HitRow key={h.key} hit={h} onPick={pickHit} />
                ))}
              </CommandPrimitive.Group>
            ))}
            {recentItems.length > 0 && (
              <CommandPrimitive.Group heading={KIND_LABELS.recent} className={cn("mb-4", sectionHeading)}>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {recentItems.map((g) => (
                    <RecentRow key={g.id} g={g} onOpen={onOpenRecent} />
                  ))}
                </div>
              </CommandPrimitive.Group>
            )}
          </>
        )}
        <CommandPrimitive.Group
          heading={scope ? `In ${scope.label} · ${tiles.length}` : groupLabel ? `Every studio · ${tiles.length} in ${groupLabel}` : "Every studio"}
          className={cn(searching ? cn("border-t pt-3", sectionHeading) : scoped ? cn("pt-3", sectionHeading) : "**:[[cmdk-group-heading]]:sr-only")}
        >
          <div className="grid grid-cols-2 gap-x-2 min-[420px]:grid-cols-3 md:grid-cols-4">
            {tiles.map((e) => (
              <StudioTile key={e.id} e={e} onPick={pickTile} />
            ))}
          </div>
        </CommandPrimitive.Group>
        {!searching && recentItems.length > 0 && (
          <CommandPrimitive.Group heading="Jump back in" className={cn("mt-3 border-t pt-3", sectionHeading)}>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {recentItems.slice(0, 4).map((g) => (
                <RecentRow key={g.id} g={g} onOpen={onOpenRecent} />
              ))}
            </div>
          </CommandPrimitive.Group>
        )}
      </CommandPrimitive.List>

      <div role="status" aria-live="polite" className="sr-only">
        {announce}
      </div>
      <Hints />
    </CommandPrimitive>
  );
}

function Hints() {
  const mod = useModKey();
  const cap = "h-[22px] min-w-[22px] rounded-md border border-b-2 bg-secondary px-1.5 text-[11px] text-foreground";
  return (
    <div className="flex h-[46px] shrink-0 items-center gap-3 border-t bg-muted/40 px-[22px] text-[12px] text-muted-foreground max-md:hidden [@media(hover:none)]:hidden">
      <span className="flex items-center gap-1">
        <Kbd className={cap}>↑</Kbd>
        <Kbd className={cap}>↓</Kbd>
        <span className="ml-1">to move</span>
      </span>
      <span aria-hidden>·</span>
      <span className="flex items-center gap-2">
        <Kbd className={cap}>Enter</Kbd> to open
      </span>
      <span aria-hidden>·</span>
      <span className="flex items-center gap-2">
        <Kbd className={cap}>Esc</Kbd> to close
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        Open it from anywhere with <Kbd className={cap}>/</Kbd> or <Kbd className={cap}>{mod === "⌘" ? "⌘K" : "Ctrl+K"}</Kbd>
      </span>
    </div>
  );
}
