"use client";

import { History, Loader2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsGuest, useLibrary } from "@/lib/api";
import type { Generation } from "@/lib/catalog/types";
import { normalizeKinetic } from "@/lib/motion/kinetic-catalog";
import { cn } from "@/lib/utils";
import { iconButton, sheetClass } from "./controls";
import { jobLine, type KineticJobs } from "./jobs";

/**
 * Versions: small pictures of the rest frame saved as results, each carrying its recipe. Restore loads one; when what
 * is open differs from the last version saved or restored, it asks first. Either way what was open goes on the undo
 * stack, so Undo brings it back. A guest sees only the Save version button (which asks them to sign up).
 */

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export const recipeOfResult = (g: Generation): unknown => (g.request.params?.extra as Record<string, unknown> | undefined)?.motion;

export function VersionsSheet({ open, onClose, side, jobs, onSaveVersion, onRestore, dirty }: { open: boolean; onClose: () => void; side: "bottom" | "right"; jobs: KineticJobs; onSaveVersion: () => Promise<unknown>; onRestore: (g: Generation) => void; dirty: boolean }) {
  const guest = useIsGuest();
  const list = useLibrary({ features: ["kinetic-version"], statuses: ["succeeded"], limit: 24 }, { enabled: open && !guest });
  const items = useMemo(() => (list.data?.pages.flat() ?? []).filter((g) => g.status === "succeeded" && g.outputs[0]), [list.data]);
  const [ask, setAsk] = useState<Generation | null>(null);
  const busy = jobs.job?.kind === "version";
  const title = useRef<HTMLHeadingElement>(null);
  const restore = (g: Generation) => {
    if (dirty) setAsk(g);
    else onRestore(g);
  };
  return (
    <>
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent
          side={side}
          showCloseButton={false}
          className={sheetClass}
          data-kinetic-sheet="versions"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            title.current?.focus();
          }}
        >
          <SheetHeader className="flex-row items-start gap-2 pb-3">
            <div className="min-w-0 flex-1">
              <SheetTitle ref={title} tabIndex={-1} className="outline-none">
                Versions
              </SheetTitle>
              <SheetDescription className="text-[13px]">Keep this state to come back to. Each version is saved with your results.</SheetDescription>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className={iconButton}>
              <X className="size-4" />
            </button>
          </SheetHeader>
          <div className="min-w-0 space-y-3 px-4 pb-4">
            <button type="button" data-kinetic-save="version" onClick={() => void onSaveVersion()} disabled={!!jobs.job} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[14px] font-medium text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <History className="size-4" />}
              {busy ? jobLine(jobs.job) : jobs.job ? "Saving another one…" : "Save version"}
            </button>
            {!guest && items.length > 0 && (
              <ul className="grid grid-cols-2 gap-2" data-kinetic-versions>
                {items.map((g) => {
                  const ok = !!normalizeKinetic(recipeOfResult(g));
                  return (
                    <li key={g.id} className="min-w-0 overflow-hidden rounded-xl border bg-card">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={g.outputs[0].url} alt="" loading="lazy" className="aspect-square w-full bg-muted object-contain" />
                      <div className="min-w-0 p-2">
                        <p className="truncate text-[12px] font-medium">{(g.request.title ?? "").replace(/^Version · /, "") || "Version"}</p>
                        <p className="text-[12px] text-muted-foreground tabular-nums">{when(g.createdAt)}</p>
                        <button type="button" disabled={!ok} onClick={() => restore(g)} data-kinetic-restore={g.id} className={cn("mt-1 h-11 w-full rounded-full bg-secondary text-[13px] font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40")}>
                          Restore
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {!guest && list.isSuccess && items.length === 0 && <p className="py-2 text-center text-[13px] text-muted-foreground">Your saved versions show here.</p>}
            {!guest && list.hasNextPage && (
              <button type="button" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className="h-11 w-full rounded-full border text-[13px] font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                Show more
              </button>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <AlertDialog open={!!ask} onOpenChange={(v) => !v && setAsk(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Keep what you have?</AlertDialogTitle>
            <AlertDialogDescription>Save it as a version first. Either way, Undo brings it back.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="h-11"
              variant="outline"
              onClick={() => {
                const g = ask;
                setAsk(null);
                if (g) onRestore(g);
              }}
            >
              Don&apos;t save
            </AlertDialogAction>
            <AlertDialogAction
              className="h-11"
              onClick={() => {
                const g = ask;
                setAsk(null);
                // Restores only once the version is saved (a failed save keeps what is open).
                if (g) void onSaveVersion().then((saved) => saved && onRestore(g));
              }}
            >
              Save version
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
