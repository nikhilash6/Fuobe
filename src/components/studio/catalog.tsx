"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { onEngine } from "@/lib/catalog/engines";
import type { Engine, ModelDef, Preset } from "@/lib/catalog/types";
import { useEngine, useModelAccess } from "@/lib/api";
import { offered } from "@/lib/model-access";
import type { StudioCatalog } from "@/lib/studio-catalog";
import type { StudioConfig } from "./studio-context";

/**
 * Model and preset lookups for one studio, without the whole catalog in the page bundle.
 *
 * The server passes the studio's slice (`StudioCatalog`) as a prop. Anything outside it — the
 * camera motions and effects for the preset picker, a preset handed over in the URL, a model a
 * reused generation ran on — comes from the full catalog, loaded as a separate chunk on demand.
 */

type FullCatalog = typeof import("@/lib/catalog");

let full: FullCatalog | null = null;
let loading: Promise<FullCatalog> | null = null;
const subscribers = new Set<() => void>();

/** Load the full catalog chunk (once). Safe to call on hover to prefetch. */
export function loadFullCatalog(): Promise<FullCatalog> {
  loading ??= import("@/lib/catalog").then((m) => {
    full = m;
    subscribers.forEach((f) => f());
    return m;
  });
  return loading;
}

const subscribe = (cb: () => void) => {
  subscribers.add(cb);
  return () => void subscribers.delete(cb);
};

function useFullCatalog(): FullCatalog | null {
  return useSyncExternalStore(subscribe, () => full, () => null);
}

export interface CatalogApi {
  /** The studio's models are known (false only while a studio without a server slice loads it). */
  ready: boolean;
  models: ModelDef[];
  getModel: (id: string) => ModelDef | undefined;
  getPreset: (id: string) => Preset | undefined;
  /** Camera motions / effects, once the full catalog is loaded (null before). */
  presets: { motion: Preset[]; effect: Preset[] } | null;
  /** True once the full catalog chunk has arrived. */
  complete: boolean;
  /** Whether Settings → Models & licences offers the model (on this engine): `models` leaves the others out. */
  offered: (id: string, engine?: Engine) => boolean;
}

const Ctx = createContext<CatalogApi | null>(null);

/** The studio's catalog, or null outside a studio (a tile shown on another page). */
export function useOptionalCatalog(): CatalogApi | null {
  return useContext(Ctx);
}

export function useCatalog(): CatalogApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCatalog outside CatalogProvider");
  return c;
}

export function CatalogProvider({ catalog, config, children }: { catalog?: StudioCatalog; config: StudioConfig; children: React.ReactNode }) {
  const fullCatalog = useFullCatalog();
  // A Fuobe Original runs on both engines: the studio sees it as it runs on the engine switched to (its routes,
  // its price or "Free"), so it is in both engines' model lists.
  const [engine] = useEngine();
  const access = useModelAccess();
  // Studios rendered from client code (an element's page) have no server slice: compute it from the lazy chunk.
  const [lazy, setLazy] = useState<StudioCatalog | null>(null);
  useEffect(() => {
    if (catalog) return;
    let live = true;
    void import("@/lib/studio-catalog").then((m) => live && setLazy(m.studioCatalog(config)));
    return () => {
      live = false;
    };
  }, [catalog, config]);
  const slice = catalog ?? lazy;
  const value = useMemo<CatalogApi>(() => {
    // Models switched off in Settings → Models & licences leave the lists (an Original, the engine it's off on); a
    // lookup by id still finds them, so a generation that ran on one keeps its name.
    const all = (slice?.models ?? []).map((m) => onEngine(m, engine));
    const models = access ? all.filter((m) => offered(access, m.id, engine)) : all;
    const index = new Map([...all, ...(slice?.lookup ?? [])].map((m) => [m.id, m]));
    const view = (m: ModelDef | undefined) => (m ? onEngine(m, engine) : undefined);
    return {
      ready: !!slice,
      models,
      getModel: (id) => index.get(id) ?? view(fullCatalog?.getModel(id)),
      getPreset: (id) => (config.preset?.id === id ? config.preset : fullCatalog?.getPreset(id)),
      presets: fullCatalog ? { motion: fullCatalog.MOTIONS, effect: fullCatalog.EFFECTS } : null,
      complete: !!fullCatalog,
      offered: (id, e) => offered(access, id, e),
    };
  }, [slice, fullCatalog, config.preset, engine, access]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
