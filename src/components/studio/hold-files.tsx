"use client";

import { useEffect } from "react";
import { useHydrated, useStatus } from "@/lib/api";
import { savedHeldIds } from "@/lib/guest-draft";
import { HoldFilesCtx, sweepHeld } from "@/lib/held-files";

/**
 * Around a studio composer: with hosted runs on, a guest's files are kept in this browser until sign-up instead of
 * opening "Create a free account" (src/lib/held-files.ts). Off, and for anyone signed in, nothing changes. As the page
 * opens, kept files nobody needs any more are cleared: for a guest, those no draft saved in this tab holds (and older
 * than a day); for anyone else, those older than a day.
 */
export function HoldFilesForGuests({ children }: { children: React.ReactNode }) {
  const hydrated = useHydrated();
  const v = useStatus().data?.viewer;
  const holds = hydrated && v?.kind === "guest" && !!v.hosted;
  useEffect(() => {
    if (hydrated) void sweepHeld(holds ? savedHeldIds() : null);
  }, [hydrated, holds]);
  return <HoldFilesCtx.Provider value={holds}>{children}</HoldFilesCtx.Provider>;
}
