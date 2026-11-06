"use client";

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEngine, type StatusInfo } from "./api";
import { refreshPriceChecks } from "./hosted";
import type { Place } from "./place-name";
import type { RunOnPick } from "./run-place";
import type { CloudProvider } from "./your-keys";

/**
 * The browser's side of where an account's runs go (hosted runs; src/server/run-on.ts): the Run on list, Settings →
 * Your GPU, the one-time note and "Use it for my runs" write the account's pick with one call, kept on the server for
 * every device. The page follows it at once (the status is updated before the server answers).
 */

export const RUN_ON_PATH = "/api/account/run-on";

/** Said once when a place the runs went to is gone (its key removed, its GPU forgotten). */
export const runsGoNowText = (place: Place): string => `Your runs go to ${place.text} now.`;

/** The account's pick as the page shows it at once, before the server answers. */
export function noteRunOn(qc: QueryClient, runOn: RunOnPick | null, runKey?: CloudProvider): void {
  qc.setQueryData<StatusInfo>(["status"], (s) => {
    if (!s?.viewer) return s;
    const { runOn: _r, runKey: _k, ranOwn: _o, ...viewer } = s.viewer;
    void _r;
    void _k;
    void _o;
    return {
      ...s,
      viewer: {
        ...viewer,
        ...(runOn && { runOn }),
        ...(runOn === "key" && runKey && { runKey }),
      },
    };
  });
}

/**
 * The engine the studios move to when the account's pick is kept: Cloud for its key, Open source when it moves away
 * from its key, none otherwise (the person's own switch stays).
 */
export const keyEngine = (was: RunOnPick | null | undefined, now: RunOnPick | null): "cloud" | "open" | null => (now === "key" ? "cloud" : was === "key" ? "open" : null);

/** Keep the account's pick (PUT /api/account/run-on). Throws the server's words when it can't. */
export async function putRunOn(runOn: RunOnPick, key?: CloudProvider): Promise<{ runOn: RunOnPick | null; runKey?: CloudProvider }> {
  const res = await fetch(RUN_ON_PATH, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runOn, ...(key && { key }) }),
  });
  const b = (await res.json().catch(() => ({}))) as {
    runOn?: RunOnPick | null;
    runKey?: CloudProvider;
    error?: string;
  };
  if (!res.ok) throw new Error(b.error ?? "That didn't save. Try once more.");
  return { runOn: b.runOn ?? null, ...(b.runKey && { runKey: b.runKey }) };
}

/**
 * Pick where the account's runs go: shown at once, kept on the server, and the status and the price checks asked again
 * (the price and the line follow the place). A refusal puts the status back and says why.
 */
export function useSetRunOn() {
  const qc = useQueryClient();
  const [, setEngine] = useEngine();
  return useMutation({
    mutationFn: ({ runOn, key }: { runOn: RunOnPick; key?: CloudProvider }) => putRunOn(runOn, key),
    onMutate: ({ runOn, key }) => {
      const was = qc.getQueryData<StatusInfo>(["status"])?.viewer?.runOn;
      noteRunOn(qc, runOn, key);
      return { was };
    },
    onSuccess: (r, _asked, ctx) => {
      noteRunOn(qc, r.runOn, r.runKey);
      // The studios follow a pick made anywhere (Settings, a tool page's note): a key runs on Cloud, and a pick away
      // from the key back on Open source.
      const next = keyEngine(ctx?.was, r.runOn);
      if (next) setEngine(next);
    },
    onError: (e) => toast((e as Error).message, { id: "run-on" }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["status"] });
      refreshPriceChecks(qc);
    },
  });
}
