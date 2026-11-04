"use client";

import { useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { PaletteIndex } from "@/lib/command-search";
import type { LauncherGroupId } from "@/lib/nav-model";

/*
 * The search palette's switch: open it from anywhere (the bar's search field, the phone's search icon, / and Ctrl+K
 * or ⌘K), and close it. Only this and the shortcuts are in every page's code; the palette itself (its list, its
 * ranking and the navigation's search words) loads on its own the first time it is wanted, or a moment before, when
 * a pointer rests on the search field.
 */

/** A search inside one area page (/create, /studios): only its pages, named on a chip that removes it. */
export interface PaletteScope {
  label: string;
  /** NavEntry ids. */
  ids: string[];
}

export interface SearchPaletteApi {
  isOpen: boolean;
  /** Open on a query, on "Every studio" filtered to one group, or inside one area (`scope`). */
  open(opts?: { query?: string; group?: LauncherGroupId; scope?: PaletteScope }): void;
  close(): void;
  /** Load the palette and its catalog now, before it's opened (hover or focus on a search control). */
  warm(): void;
}

export interface PaletteSession {
  open: boolean;
  /** Changes on every open: the palette starts fresh (empty query, top of the list) each time. */
  id: number;
  query?: string;
  group?: LauncherGroupId;
  scope?: PaletteScope;
}

/** The apps, motions, effects and models the palette searches (prerendered: GET /api/search-index). */
export const PALETTE_INDEX_KEY = ["palette-index"] as const;
export const fetchPaletteIndex = async (): Promise<PaletteIndex> => (await fetch("/api/search-index")).json();

const loadPalette = () => import("./search-palette");
const SearchPalette = dynamic(() => loadPalette().then((m) => m.SearchPalette), { ssr: false });

const Ctx = createContext<SearchPaletteApi | null>(null);

const INERT: SearchPaletteApi = { isOpen: false, open: () => {}, close: () => {}, warm: () => {} };

/** Opens and closes the search palette. Outside the provider (a page rendered alone, a test) it does nothing. */
export function useSearchPalette(): SearchPaletteApi {
  return useContext(Ctx) ?? INERT;
}

/** Where typing a "/" means a slash, not search: a field, an editor, or a workspace with its own keys. */
export function typesText(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const el = target as Element;
  return !!el.closest("input, textarea, select, [contenteditable]:not([contenteditable=false]), [data-hotkeys-off]");
}

/** Ctrl+K (⌘K on Apple keyboards): toggles the palette from anywhere, a text field included. */
export function isPaletteToggle(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";
}

/**
 * "/" opens the palette when nothing else wants the key: no modifier, nobody handled it, not while typing, and not
 * over a dialog or a menu that is open.
 */
export function slashOpens(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "defaultPrevented" | "isComposing" | "target">,
  doc: Pick<Document, "querySelector"> | undefined = typeof document === "undefined" ? undefined : document,
): boolean {
  if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || e.isComposing) return false;
  if (typesText(e.target)) return false;
  return !doc?.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"]');
}

export function SearchPaletteProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<PaletteSession>({ open: false, id: 0 });
  // The palette's code is fetched (and mounted, closed) the first time it's warmed or opened, never before.
  const [loaded, setLoaded] = useState(false);
  const openRef = useRef(false);
  /** What had focus when the palette opened: it gets focus back when the palette closes without going anywhere. */
  const returnTo = useRef<Element | null>(null);
  const client = useQueryClient();

  const warm = useCallback(() => {
    setLoaded(true);
    void loadPalette();
    void client.prefetchQuery({ queryKey: PALETTE_INDEX_KEY, queryFn: fetchPaletteIndex, staleTime: Infinity });
  }, [client]);

  const open = useCallback(
    (opts?: { query?: string; group?: LauncherGroupId; scope?: PaletteScope }) => {
      if (!openRef.current) returnTo.current = typeof document === "undefined" ? null : document.activeElement;
      openRef.current = true;
      warm();
      setSession((s) => ({ open: true, id: s.id + 1, query: opts?.query, group: opts?.group, scope: opts?.scope }));
    },
    [warm],
  );

  // What gets focus back (once) when the palette closes without going anywhere.
  const takeReturn = useCallback(() => {
    const el = returnTo.current;
    returnTo.current = null;
    return el;
  }, []);

  const close = useCallback(() => {
    openRef.current = false;
    setSession((s) => (s.open ? { ...s, open: false } : s));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isPaletteToggle(e)) {
        e.preventDefault();
        if (openRef.current) close();
        else open();
        return;
      }
      if (!openRef.current && slashOpens(e)) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const api = useMemo<SearchPaletteApi>(() => ({ isOpen: session.open, open, close, warm }), [session.open, open, close, warm]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {loaded && <SearchPalette session={session} onClose={close} takeReturn={takeReturn} />}
    </Ctx.Provider>
  );
}
