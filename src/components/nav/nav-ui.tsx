"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useHydrated, useViewer } from "@/lib/api";
import type { NavCover, NavCovers } from "@/lib/nav-covers";
import type { MegaId } from "@/lib/mega-menus";
import { viewerKindOf, type LauncherGroupId, type ViewerKind } from "@/lib/nav-model";
import { installInputModality } from "./input-modality";

/*
 * The app frame's shared state: the covers the server resolved for the nav (preset id → thumb and poster URLs), who is
 * looking, and which of the bar's panels or the phone's sheets is open. One provider for the top bar, the phone tabs and
 * their sheets, so "All studios" anywhere opens the launcher on a desktop and the Studios sheet on a phone (openArea).
 */

export type NavSheet = "studios" | "create" | "you";

/** Below this width the phone chrome (bottom tabs and sheets) shows instead of the top bar (Tailwind's md). */
export const PHONE_QUERY = "(max-width: 767px)";

export interface NavUi {
  /** The bar's open grouped menu (Studios, Apps, Motions & effects, Canvas): one at a time. */
  openMenu: MegaId | null;
  setOpenMenu(v: MegaId | null): void;
  /** The column the open menu was opened for (openArea(id, group)): it takes focus first. */
  menuGroup: string | undefined;
  /** Where focus goes back to when the menu closes with Esc: what opened it, when that was not its own button. */
  menuReturnTo(): HTMLElement | null;
  sheet: NavSheet | null;
  setSheet(v: NavSheet | null): void;
  /** The family the Studios sheet shows (Studios, Apps, Motions & effects, Canvas). */
  sheetFamily: MegaId;
  /** The chip the Studios sheet starts on (openArea(id, group)); undefined = All. */
  sheetGroup: string | undefined;
  /** A menu's whole set: its grouped menu from the md breakpoint up, the Studios sheet on that family on a phone. */
  openArea(id: MegaId, group?: string): void;
  /** Every studio (openArea("studios", group)). */
  openStudios(group?: LauncherGroupId): void;
}

const NavUiContext = createContext<NavUi | null>(null);
const CoversContext = createContext<NavCovers>({});

export function NavUiProvider({ covers, children }: { covers: NavCovers; children: React.ReactNode }) {
  const [menu, setMenu] = useState<{ id: MegaId | null; group?: string }>({ id: null });
  const [sheet, setSheetState] = useState<{ sheet: NavSheet | null; family: MegaId; group?: string }>({ sheet: null, family: "studios" });
  const menuReturn = useRef<HTMLElement | null>(null);
  // Which input leads (keyboard or pointer), for the nav states: one highlighted row at a time.
  useEffect(() => installInputModality(), []);

  // Opened or closed by a menu's own button: focus goes back to it. openArea() says otherwise.
  const setOpenMenu = useCallback((id: MegaId | null) => {
    menuReturn.current = null;
    setMenu((m) => (m.id === id && !m.group ? m : { id }));
  }, []);
  const menuReturnTo = useCallback(() => menuReturn.current, []);
  const setSheet = useCallback((v: NavSheet | null) => setSheetState((s) => ({ sheet: v, family: v === "studios" && s.sheet === "studios" ? s.family : "studios" })), []);
  const openArea = useCallback((id: MegaId, group?: string) => {
    const phone = typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches;
    if (phone) {
      setSheetState({ sheet: "studios", family: id, group });
      return;
    }
    const at = typeof document !== "undefined" ? document.activeElement : null;
    menuReturn.current = at instanceof HTMLElement && at !== document.body ? at : null;
    setMenu({ id, group });
  }, []);
  const openStudios = useCallback((group?: LauncherGroupId) => openArea("studios", group), [openArea]);

  const ui = useMemo<NavUi>(
    () => ({
      openMenu: menu.id,
      setOpenMenu,
      menuGroup: menu.id ? menu.group : undefined,
      menuReturnTo,
      sheet: sheet.sheet,
      setSheet,
      sheetFamily: sheet.family,
      sheetGroup: sheet.sheet === "studios" ? sheet.group : undefined,
      openArea,
      openStudios,
    }),
    [menu, sheet, setOpenMenu, menuReturnTo, setSheet, openArea, openStudios],
  );

  return (
    <CoversContext.Provider value={covers}>
      <NavUiContext.Provider value={ui}>{children}</NavUiContext.Provider>
    </CoversContext.Provider>
  );
}

const CLOSED: NavUi = {
  openMenu: null,
  setOpenMenu: () => {},
  menuGroup: undefined,
  menuReturnTo: () => null,
  sheet: null,
  setSheet: () => {},
  sheetFamily: "studios",
  sheetGroup: undefined,
  openArea: () => {},
  openStudios: () => {},
};

/** The open panels and sheets. Outside the provider (a test, a page rendered alone) everything is closed and inert. */
export function useNavUi(): NavUi {
  return useContext(NavUiContext) ?? CLOSED;
}

/** A preset's cover as the nav shows it (thumb and poster), or undefined when the server resolved none for that id. */
export function useNavCover(presetId: string | undefined): NavCover | undefined {
  const covers = useContext(CoversContext);
  return presetId && Object.hasOwn(covers, presetId) ? covers[presetId] : undefined;
}

/**
 * Who is looking, once known: undefined while hydrating (the server's shell is the same for everyone) and until
 * /api/auth/me answers. Owner-only items render only after this says "owner".
 */
export function useViewerKind(): ViewerKind | undefined {
  const hydrated = useHydrated();
  const viewer = useViewer().data;
  return hydrated ? viewerKindOf(viewer) : undefined;
}
