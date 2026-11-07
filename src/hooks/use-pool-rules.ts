"use client";

import { useEngineMode, useHydrated, useStatus } from "@/lib/api";
import { useMemo } from "react";
import { tryFreeFor, type PoolRules } from "@/lib/pool-rules";
import { hereOf, type Here } from "@/lib/runnable-here";

/**
 * What this studio's GPUs keep off for this viewer (hosted runs on, no GPU of its own): pickers show it with its
 * own-setup label (src/lib/pool-rules.ts), and Run opens that setup. Undefined when nothing is kept off, with hosted runs off, or for a viewer with its own GPU.
 */
export function usePoolRules(): PoolRules | undefined {
  const v = useStatus().data?.viewer;
  return v?.hosted && !v.gpu.connected ? v.pool : undefined;
}

/** The words on preset cards ("Try free", tryFreeFor), once the page has hydrated: null until then, and with none. */
export function useTryFree(): ReturnType<typeof tryFreeFor> {
  const hydrated = useHydrated();
  const v = useStatus().data?.viewer;
  const mode = useEngineMode();
  return hydrated ? tryFreeFor(v, mode) : null;
}

/**
 * Where this viewer's open runs go to this install's GPUs, with what they run now (src/lib/runnable-here.ts hereOf): the
 * pickers order, tag and default by it. The owner's status has no viewer, and carries `pool` only while his ComfyUI runs
 * on the workers. Null until the page has hydrated, and where nothing here has a say.
 */
export function useHere(): Here | null {
  const hydrated = useHydrated();
  const s = useStatus().data;
  return useMemo(() => (hydrated ? hereOf(s, !!s && !s.viewer) : null), [hydrated, s]);
}
