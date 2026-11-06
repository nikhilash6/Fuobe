"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KEY_INFO_REFRESH_GAP_MS, KEY_INFO_URL, type KeyInfoAnswer } from "@/lib/key-info";

/*
 * Connected accounts in the browser: GET /api/key-info, asked only when the account menu or the You sheet opens, or a
 * Settings card scrolls into view (never on page load), then kept a minute. ["key-info"] is the menu's view,
 * ["key-info", "detail"] Settings' (with this month's spend where the key may read it). A key added, replaced or
 * removed invalidates both (["key-info"]).
 */

export const keyInfoKey = (detail: boolean) => (detail ? ["key-info", "detail"] : ["key-info"]);

async function fetchKeyInfo(detail: boolean, refresh: boolean): Promise<KeyInfoAnswer> {
  const q = new URLSearchParams({ ...(detail && { detail: "1" }), ...(refresh && { refresh: "1" }) }).toString();
  const res = await fetch(q ? `${KEY_INFO_URL}?${q}` : KEY_INFO_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw Object.assign(new Error("Couldn't load the accounts"), { status: res.status });
  return (await res.json()) as KeyInfoAnswer;
}

/** The saved keys' accounts, once `enabled` (the menu is open, the card was seen). */
export function useKeyInfo({ enabled, detail = false }: { enabled: boolean; detail?: boolean }) {
  return useQuery({
    queryKey: keyInfoKey(detail),
    queryFn: () => fetchKeyInfo(detail, false),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** When this page last asked for a refresh: every Refresh button waits 10 s from it (the server asks no sooner). */
let lastRefresh = 0;

/** Refresh: ask the providers again, then show the answer. The button waits 10 s after each press. */
export function useRefreshKeyInfo(detail = false) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [cooling, setCooling] = useState(() => Date.now() - lastRefresh < KEY_INFO_REFRESH_GAP_MS);
  useEffect(() => {
    if (!cooling) return;
    const t = setTimeout(() => setCooling(false), Math.max(0, lastRefresh + KEY_INFO_REFRESH_GAP_MS - Date.now()));
    return () => clearTimeout(t);
  }, [cooling]);
  const refresh = async () => {
    if (busy || cooling) return;
    lastRefresh = Date.now();
    setCooling(true);
    setBusy(true);
    try {
      const data = await fetchKeyInfo(detail, true);
      qc.setQueryData(keyInfoKey(detail), data);
      // Settings' answer holds everything the menu's does; the menu's lacks the spend, so Settings asks again later.
      if (detail) qc.setQueryData(keyInfoKey(false), data);
      else void qc.invalidateQueries({ queryKey: keyInfoKey(true), exact: true });
    } catch {
      // What was shown stays (the next look asks again), and the press is answered: the figures on show are the earlier ones.
      toast.error("Couldn't refresh the balance just now. The figures shown are from the last check: try again in a moment.");
    } finally {
      setBusy(false);
    }
  };
  return { refresh, busy, cooling };
}
