"use client";

import { useCallback, useSyncExternalStore } from "react";
import { queueIdlePrefetch } from "@/lib/idle-prefetch";
import { FETCHED_MENUS, menuUrl, studiosMenu, unpackMenu, type FetchedMegaId, type MegaId, type MegaModel } from "@/lib/mega-menus";
import type { ViewerKind } from "@/lib/nav-model";

/*
 * The fetched menus' data (Apps, Motions & effects, Canvas): one small static file each (/nav-menus/<id>), asked for
 * once per page load, never with the page itself. The bar asks when the browser is idle (prefetchMenus) or when the
 * pointer or focus first comes to the item (loadMenu); a phone only when its sheet shows that family. A failed
 * request is forgotten, so the next warm tries again.
 */

type Entry = { state: "loading"; promise: Promise<MegaModel> } | { state: "ready"; model: MegaModel } | { state: "failed" };

const entries = new Map<FetchedMegaId, Entry>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

/** Starts loading a menu's data (once; again after a failure). */
export function loadMenu(id: FetchedMegaId): void {
  const e = entries.get(id);
  if (e && e.state !== "failed") return;
  const promise = fetch(menuUrl(id)).then(async (r) => {
    if (!r.ok) throw new Error(`${menuUrl(id)} answered ${r.status}`);
    return unpackMenu(await r.json());
  });
  entries.set(id, { state: "loading", promise });
  changed();
  promise.then(
    (model) => {
      entries.set(id, { state: "ready", model });
      changed();
    },
    () => {
      entries.set(id, { state: "failed" });
      changed();
    },
  );
}

/** A grouped menu: Studios at once (it's in the bundle), the others once loaded. */
export function warmMenu(id: MegaId): void {
  if (id !== "studios") loadMenu(id);
}

/** A browser asking to save data, or on a slow connection: menus load when asked for only. */
function saveData(): boolean {
  if (typeof navigator === "undefined") return true;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!conn && (!!conn.saveData || /(^|-)2g$|^3g$/.test(conn.effectiveType ?? ""));
}

/** After the page has loaded, when the browser is idle: the data (no pictures) of the menus whose bar item shows. */
export function prefetchMenus(ids: readonly FetchedMegaId[] = FETCHED_MENUS): () => void {
  if (saveData()) return () => {};
  const cancels = ids.map((id) => queueIdlePrefetch("nav", menuUrl(id), () => loadMenu(id)));
  return () => cancels.forEach((c) => c());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export interface MenuState {
  model?: MegaModel;
  failed: boolean;
  retry(): void;
}

/** A menu's data for who is looking: Studios from the navigation model, the others as loaded (undefined until then). */
export function useMegaMenu(id: MegaId, kind: ViewerKind | undefined): MenuState {
  const entry = useSyncExternalStore(
    subscribe,
    () => (id === "studios" ? undefined : entries.get(id)),
    () => undefined,
  );
  const retry = useCallback(() => {
    if (id !== "studios") loadMenu(id);
  }, [id]);
  if (id === "studios") return { model: studiosMenu(kind), failed: false, retry };
  return { model: entry?.state === "ready" ? entry.model : undefined, failed: entry?.state === "failed", retry };
}

/** For tests: forget every loaded menu. */
export function resetMenus() {
  entries.clear();
  changed();
}

/** A menu's data is here (Studios always is): a hover open waits a moment for it (bar-menus.tsx), never a click. */
export function menuReady(id: MegaId): boolean {
  return id === "studios" || entries.get(id)?.state === "ready";
}

/** At once (not when idle): the data of these menus, unless the browser asks to save data. */
export function loadMenusNow(ids: readonly FetchedMegaId[]): void {
  if (saveData()) return;
  ids.forEach(loadMenu);
}
