"use client";

import { useQuery } from "@tanstack/react-query";
import { readUploadSwitches, UPLOAD_SWITCH_DEFAULTS, type UploadSwitches } from "@/lib/av/upload-switches";

/** The query that holds the upload switches (Settings changes them and refreshes it). */
export const UPLOAD_SWITCHES_KEY = ["upload-switches"] as const;

/**
 * The owner's upload switches (src/lib/av/upload-switches.ts), read once a page loads and again when it comes back into
 * view, so a change applies without a deploy. All on while they load or when they can't be read.
 */
export function useUploadSwitches(): UploadSwitches {
  const q = useQuery({
    queryKey: UPLOAD_SWITCHES_KEY,
    queryFn: async () => {
      const res = await fetch("/api/site/uploads", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      return readUploadSwitches(((await res.json()) as { switches?: unknown }).switches);
    },
    staleTime: 60_000,
    retry: 1,
  });
  return q.data ?? UPLOAD_SWITCH_DEFAULTS;
}
