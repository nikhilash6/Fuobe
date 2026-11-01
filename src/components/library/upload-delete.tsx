"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { UploadDeleteContext } from "@/components/studio/result-actions";
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
import { assetUsage, useDeleteUpload } from "@/lib/api";
import type { Generation } from "@/lib/catalog/types";
import { toastError } from "@/lib/refusals";

type Check = { state: "checking" } | { state: "free" } | { state: "used"; usedBy: string } | { state: "error"; message: string };

/**
 * Deleting an upload (the Library's Uploads tab and its viewer): first ask the server where the
 * file is used. Nothing: confirm, then delete it for good (uploads skip the Trash, as on Higgsfield).
 * Something: say where, so the person knows what to remove first.
 */
export function UploadDeleteProvider({ children }: { children: React.ReactNode }) {
  const remove = useDeleteUpload();
  const [pending, setPending] = useState<{ g: Generation; after?: () => void; check: Check } | null>(null);
  const ask = useCallback((g: Generation, after?: () => void) => {
    setPending({ g, after, check: { state: "checking" } });
    assetUsage(g.id)
      .then((u) => setPending((p) => (p?.g.id === g.id ? { ...p, check: u.usedBy ? { state: "used", usedBy: u.usedBy } : { state: "free" } } : p)))
      .catch((e: Error) => setPending((p) => (p?.g.id === g.id ? { ...p, check: { state: "error", message: e.message } } : p)));
  }, []);
  const check = pending?.check;
  const name = pending?.g.request.prompt?.trim() || "this upload";
  return (
    <UploadDeleteContext.Provider value={ask}>
      {children}
      <AlertDialog open={!!pending} onOpenChange={(v) => !v && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">{check?.state === "used" ? "This upload is still in use" : `Delete “${name}”?`}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {check?.state === "checking" && (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="size-3.5 animate-spin" /> Checking where it&apos;s used…
                  </span>
                )}
                {check?.state === "free" && "Nothing in your library uses it. The file is removed for good and can't be recovered."}
                {check?.state === "used" && (
                  <>
                    It&apos;s used by {check.usedBy}. Keep the upload, or delete what uses it first: removing the file now would break that.
                  </>
                )}
                {check?.state === "error" && check.message}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {check?.state === "used" || check?.state === "error" ? (
              <AlertDialogCancel>OK</AlertDialogCancel>
            ) : (
              <>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={check?.state !== "free"}
                  onClick={() => {
                    if (!pending) return;
                    remove.mutate(pending.g.id, {
                      onSuccess: () => toast("Upload deleted"),
                      onError: (e) => toastError(e),
                    });
                    pending.after?.();
                  }}
                >
                  Delete upload
                </AlertDialogAction>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </UploadDeleteContext.Provider>
  );
}
