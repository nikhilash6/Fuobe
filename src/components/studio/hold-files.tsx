"use client";

import { useHydrated, useStatus } from "@/lib/api";
import { HoldFilesCtx } from "@/lib/held-files";

/**
 * Around a studio composer: with hosted runs on, a guest's files are kept in this browser until sign-up instead of
 * opening "Create a free account" (src/lib/held-files.ts). Off, and for anyone signed in, nothing changes.
 */
export function HoldFilesForGuests({ children }: { children: React.ReactNode }) {
  const hydrated = useHydrated();
  const v = useStatus().data?.viewer;
  return <HoldFilesCtx.Provider value={hydrated && v?.kind === "guest" && !!v.hosted}>{children}</HoldFilesCtx.Provider>;
}
