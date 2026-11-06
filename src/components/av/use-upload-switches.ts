"use client";

import { useQuery } from "@tanstack/react-query";
import { readUploadSwitches, UPLOAD_SWITCH_DEFAULTS, type UploadSwitches } from "@/lib/av/upload-switches";

/** The query that holds the upload switches (Settings changes them and refreshes it). */
export const UPLOAD_SWITCHES_KEY = ["upload-switches"] as const;

/** Read again after a minute. */
const FRESH_MS = 60_000;
let last: { at: number; value: UploadSwitches } | null = null;

async function fetchSwitches(): Promise<UploadSwitches> {
  const res = await fetch("/api/site/uploads", { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  const value = readUploadSwitches(((await res.json()) as { switches?: unknown }).switches);
  last = { at: Date.now(), value };
  return value;
}

/**
 * The owner's upload switches (src/lib/av/upload-switches.ts), read once a page loads and again when it comes back into
 * view, so a change applies without a deploy. All on while they load or when they can't be read.
 */
export function useUploadSwitches(): UploadSwitches {
  const q = useQuery({ queryKey: UPLOAD_SWITCHES_KEY, queryFn: fetchSwitches, staleTime: FRESH_MS, retry: 1 });
  return q.data ?? UPLOAD_SWITCH_DEFAULTS;
}

/** The same, outside React (an upload on its way): the last read when it is fresh, else read now; all on if it can't be. */
export async function uploadSwitchesNow(): Promise<UploadSwitches> {
  if (last && Date.now() - last.at < FRESH_MS) return last.value;
  return fetchSwitches().catch(() => last?.value ?? UPLOAD_SWITCH_DEFAULTS);
}
