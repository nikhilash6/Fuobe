"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearDraft, readDraft, restoredDraft, saveDraft, savePendingRun, takePendingRun, type PendingRun, type ShownPrice } from "@/lib/guest-draft";
import { replaceAttachment } from "@/lib/composer";
import { readHeld } from "@/lib/held-files";
import { uploadHeld, type SlotValue } from "./media-slot";
import type { Draft } from "./studio-context";

/**
 * A guest's whole draft through sign-up (hosted runs on; src/lib/guest-draft.ts), for the studio composer:
 * - a guest whose files are kept in this browser (`hold`) has the draft saved for this page as it changes;
 * - once who is looking is known, a saved draft comes back (its kept files with fresh previews); for an account (just
 *   signed up) its kept files are uploaded as the account's own, and the run its guest pressed is handed back (`pending`)
 *   for the composer to start once the price check agrees.
 * Nothing happens for the owner, nor for a guest with hosted runs off (nothing is saved for them).
 */
export function useGuestDraft({ hold, viewer, draft, setDraft }: { hold: boolean; viewer: "guest" | "account" | undefined; draft: Draft; setDraft: (patch: Partial<Draft> | ((d: Draft) => Partial<Draft>)) => void }) {
  const path = useRef<string | null>(null);
  useEffect(() => {
    path.current = window.location.pathname;
  }, []);

  const [pending, setPending] = useState<PendingRun | null>(null);
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !viewer || !path.current) return;
    restored.current = true;
    const here = path.current;
    if (viewer === "account") {
      const run = takePendingRun(here);
      if (run) setPending(run);
    }
    const kept = readDraft<Draft>(here);
    if (!kept) return;
    // Back as an account: the draft is its own from here on (saved no more), and its kept files go up now.
    const account = viewer === "account";
    if (account) clearDraft(here);
    const { draft: draftNow, held } = restoredDraft(kept, account) as { draft: Draft; held: SlotValue[] };
    // A prompt the link brought (?prompt=) wins over the saved words, as it does for the words kept per page.
    setDraft((d) => ({ ...draftNow, prompt: d.prompt || draftNow.prompt }));
    const swap = (id: string | undefined, v: SlotValue | null) => id && setDraft((d) => replaceAttachment(d, id, v) ?? {});
    for (const v of held) {
      if (account) {
        void uploadHeld(v).then((up) => swap(v.id, up));
        continue;
      }
      // Still a guest: the kept file shows again (a file the browser no longer has leaves the draft).
      void readHeld(v.held!).then((file) => swap(v.id, file ? { ...v, preview: URL.createObjectURL(file) } : null));
    }
  }, [viewer, setDraft]);

  // Saved as it changes, while the guest's files are kept here (never before a saved draft was read back).
  useEffect(() => {
    if (hold && restored.current && path.current) saveDraft(path.current, draft as unknown as Parameters<typeof saveDraft>[1]);
  }, [hold, draft]);

  /** A guest pressed Run: the draft and the run (with the price it showed) wait for the sign-up. */
  const keepRun = useCallback(
    (shown: ShownPrice) => {
      if (!path.current) return;
      saveDraft(path.current, draft as unknown as Parameters<typeof saveDraft>[1]);
      savePendingRun(path.current, shown);
    },
    [draft],
  );

  return { pending, clearPending: useCallback(() => setPending(null), []), keepRun };
}
