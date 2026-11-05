"use client";

import { useEngineMode, useHydrated, useStatus } from "@/lib/api";
import { tryFreeFor, type PoolRules } from "@/lib/pool-rules";

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
