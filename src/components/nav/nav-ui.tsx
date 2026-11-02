"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useHydrated, useViewer } from "@/lib/api";
import type { NavCover, NavCovers } from "@/lib/nav-covers";
import { viewerKindOf, type LauncherGroupId, type ViewerKind } from "@/lib/nav-model";
import { installInputModality } from "./input-modality";

/*
 * The app frame's shared state: the covers the server resolved for the nav (preset id → thumb and poster URLs), who is
 * looking, and which of the bar's panels or the phone's sheets is open. One provider for the top bar, the phone tabs and
 * their sheets, so "All studios" anywhere opens the launcher on a desktop and the Studios sheet on a phone.
 */

export type NavSheet = "studios" | "create" | "you";

/** Below this width the phone chrome (bottom tabs and sheets) shows instead of the top bar (Tailwind's md). */
export const PHONE_QUERY = "(max-width: 767px)";

export interface NavUi {
  launcherOpen: boolean;
  setLauncherOpen(v: boolean): void;
  /** The column the launcher was opened for (openStudios(group)): it takes focus first. */
  launcherGroup: LauncherGroupId | undefined;
  /** Where focus goes back to when the launcher closes with Esc: what opened it, when that was not its own button. */
  launcherReturnTo(): HTMLElement | null;
  sheet: NavSheet | null;
  setSheet(v: NavSheet | null): void;
  /** The chip the Studios sheet starts on (openStudios(group)); undefined = All. */
  sheetGroup: LauncherGroupId | undefined;
  /** Every studio: the launcher from the md breakpoint up, the Studios sheet on a phone. */
  openStudios(group?: LauncherGroupId): void;
}

const NavUiContext = createContext<NavUi | null>(null);
const CoversContext = createContext<NavCovers>({});

export function NavUiProvider({ covers, children }: { covers: NavCovers; children: React.ReactNode }) {
  const [launcher, setLauncher] = useState<{ open: boolean; group?: LauncherGroupId }>({ open: false });
  const [sheet, setSheetState] = useState<{ sheet: NavSheet | null; group?: LauncherGroupId }>({ sheet: null });
  const launcherReturn = useRef<HTMLElement | null>(null);
  // Which input leads (keyboard or pointer), for the nav states: one highlighted row at a time.
  useEffect(() => installInputModality(), []);

  // Opened or closed by the launcher's own button: focus goes back to it. openStudios() says otherwise.
  const setLauncherOpen = useCallback((open: boolean) => {
    launcherReturn.current = null;
    setLauncher((l) => (l.open === open && !l.group ? l : { open }));
  }, []);
  const launcherReturnTo = useCallback(() => launcherReturn.current, []);
  const setSheet = useCallback((v: NavSheet | null) => setSheetState({ sheet: v }), []);
  const openStudios = useCallback((group?: LauncherGroupId) => {
    const phone = typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches;
    if (phone) {
      setSheetState({ sheet: "studios", group });
      return;
    }
    const at = typeof document !== "undefined" ? document.activeElement : null;
    launcherReturn.current = at instanceof HTMLElement && at !== document.body ? at : null;
    setLauncher({ open: true, group });
  }, []);

  const ui = useMemo<NavUi>(
    () => ({
      launcherOpen: launcher.open,
      setLauncherOpen,
      launcherGroup: launcher.open ? launcher.group : undefined,
      launcherReturnTo,
      sheet: sheet.sheet,
      setSheet,
      sheetGroup: sheet.sheet === "studios" ? sheet.group : undefined,
      openStudios,
    }),
    [launcher, sheet, setLauncherOpen, launcherReturnTo, setSheet, openStudios],
  );

  return (
    <CoversContext.Provider value={covers}>
      <NavUiContext.Provider value={ui}>{children}</NavUiContext.Provider>
    </CoversContext.Provider>
  );
}

const CLOSED: NavUi = {
  launcherOpen: false,
  setLauncherOpen: () => {},
  launcherGroup: undefined,
  launcherReturnTo: () => null,
  sheet: null,
  setSheet: () => {},
  sheetGroup: undefined,
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
