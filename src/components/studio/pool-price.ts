"use client";

import { useOwnSetupPress } from "@/components/own-setup";
import { toolPoolPrice, type ToolPoolPrice } from "@/lib/run-place";

/**
 * A tool page's Run for a run on this studio's GPUs, from the tool's own price check (`?preview=1` or its estimate,
 * which adds `{ place: "pool", quote, line }` when the run goes there): `pool` says what the price slot shows instead of
 * the page's own words (null: the run goes to the person's own GPU or key, so the page says its own), `off` turns Run off
 * (refused, in the service's words), `go` opens the person's own setup instead of running when that is the answer, and
 * `headers` carry the price shown with Run.
 */
export function usePoolRun(check: unknown): { pool: ToolPoolPrice | null; off: boolean; go: (run: () => void) => void; headers: Record<string, string> } {
  const press = useOwnSetupPress();
  const pool = toolPoolPrice(check);
  return {
    pool,
    off: !!pool?.refused && !pool.setup,
    go: (run) => {
      if (pool?.setup) press(pool.setup, run);
      else run();
    },
    headers: pool?.headers ?? {},
  };
}
