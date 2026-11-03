"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useGenerationActions } from "@/lib/api";
import type { Generation } from "@/lib/catalog/types";

/**
 * An account's "Delete for good…" on a result (its ⋯ menu, in any feed or the viewer): an account has no Trash, so the
 * delete can't be undone, and it is asked first. One host (in the app's providers) answers every menu.
 */

const EVENT = "fuobe:delete-for-good";

interface Ask {
  gs: Generation[];
  after?: () => void;
}

/** Ask before an account's results are deleted for good; `after` runs once it's confirmed (a viewer closes). */
export function askDeleteForGood(gs: Generation[], after?: () => void): void {
  if (gs.length) window.dispatchEvent(new CustomEvent<Ask>(EVENT, { detail: { gs, after } }));
}

const running = (g: Generation) => g.status === "queued" || g.status === "running";

export function DeleteForGoodHost() {
  const actions = useGenerationActions();
  const [ask, setAsk] = useState<Ask | null>(null);
  useEffect(() => {
    const on = (e: Event) => setAsk((e as CustomEvent<Ask>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const n = ask?.gs.length ?? 0;
  const active = ask?.gs.some(running) ?? false;
  return (
    <AlertDialog open={!!ask} onOpenChange={(v) => !v && setAsk(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {n === 1 ? "this for good" : `${n} results for good`}?</AlertDialogTitle>
          <AlertDialogDescription>
            {n === 1 ? "It's" : "They're"} removed with {n === 1 ? "its" : "their"} files and can&apos;t be recovered.
            {active && (n === 1 ? " It's still running, so it's stopped first." : " Any still running are stopped first.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (!ask) return;
              void actions.deleteOwn(ask.gs).then((done) => done && toast(done === 1 ? "Deleted for good" : `Deleted ${done} for good`));
              ask.after?.();
            }}
          >
            Delete for good
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
