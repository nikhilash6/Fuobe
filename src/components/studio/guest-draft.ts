"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearDraft, readDraft, restoredDraft, restoredPrompt, sameDraft, saveDraft, savePendingRun, takePendingRun, type PendingRun, type ShownPrice } from "@/lib/guest-draft";
import type { OwnSetup } from "@/lib/own-setup";
import { replaceAttachment } from "@/lib/composer";
import { readHeld } from "@/lib/held-files";
import { uploadHeld, type SlotValue } from "./media-slot";
import type { Draft } from "./studio-context";

/**
 * Upload a restored draft's kept files as the new account's own: each one takes its stand-in's place as it lands, or
 * leaves the draft when it didn't come back (`lost` is said first, in the same turn, so the run its guest pressed
 * never starts without it).
 */
export function uploadKept(held: SlotValue[], up: (v: SlotValue) => Promise<SlotValue | null>, on: { lost: () => void; swap: (id: string | undefined, v: SlotValue | null) => void }): Promise<void> {
  return Promise.all(
    held.map((v) =>
      up(v).then((next) => {
        if (!next) on.lost();
        on.swap(v.id, next);
      }),
    ),
  ).then(() => undefined);
}

/**
 * A guest's whole draft through sign-up (hosted runs on; src/lib/guest-draft.ts), for the studio composer:
 * - a guest whose files are kept in this browser (`hold`) has the draft saved for this page as it changes;
 * - once who is looking is known, a saved draft comes back (its kept files with fresh previews); for an account (just
 *   signed up) its kept files are uploaded as the account's own, and the run its guest pressed is handed back (`pending`,
 *   with whether the draft is still the one Run was pressed on) for the composer to start once the price check agrees.
 *   `lost`: a kept file didn't come back, so that run waits for the person.
 * Nothing happens for the owner, nor for a guest with hosted runs off (nothing is saved for them).
 */
export function useGuestDraft({ hold, viewer, draft, setDraft }: { hold: boolean; viewer: "guest" | "account" | undefined; draft: Draft; setDraft: (patch: Partial<Draft> | ((d: Draft) => Partial<Draft>)) => void }) {
  const path = useRef<string | null>(null);
  useEffect(() => {
    path.current = window.location.pathname;
  }, []);

  const [pending, setPending] = useState<(PendingRun & { same: boolean }) | null>(null);
  const [lost, setLost] = useState(false);
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !viewer || !path.current) return;
    restored.current = true;
    const here = path.current;
    const kept = readDraft<Draft>(here);
    let pressed = false;
    if (viewer === "account") {
      const run = takePendingRun(here);
      pressed = !!run && sameDraft(run, kept);
      if (run) setPending({ ...run, same: pressed });
    }
    if (!kept) return;
    // Back as an account: the draft is its own from here on (saved no more), and its kept files go up now.
    const account = viewer === "account";
    if (account) clearDraft(here);
    const { draft: draftNow, held } = restoredDraft(kept, account) as { draft: Draft; held: SlotValue[] };
    // A prompt the link brought (?prompt=) wins over the saved words, except for the run its guest pressed.
    setDraft((d) => ({ ...draftNow, prompt: restoredPrompt(d.prompt, draftNow.prompt, pressed) }));
    const swap = (id: string | undefined, v: SlotValue | null) => id && setDraft((d) => replaceAttachment(d, id, v) ?? {});
    if (account) {
      void uploadKept(held, uploadHeld, { lost: () => setLost(true), swap });
      return;
    }
    // Still a guest: the kept file shows again (a file the browser no longer has leaves the draft).
    for (const v of held) void readHeld(v.held!).then((file) => swap(v.id, file ? { ...v, preview: URL.createObjectURL(file) } : null));
  }, [viewer, setDraft]);

  // Saved as it changes, while the guest's files are kept here (never before a saved draft was read back).
  useEffect(() => {
    if (hold && restored.current && path.current) saveDraft(path.current, draft as unknown as Parameters<typeof saveDraft>[1]);
  }, [hold, draft]);

  /**
   * A guest pressed Run: the draft and the run (with the price it showed, and the draft it was pressed on) wait for the
   * sign-up. `setup`: pressed on an item that runs on one's own GPU or key, whose setup opens then instead.
   */
  const keepRun = useCallback(
    (shown: ShownPrice, setup?: OwnSetup) => {
      if (!path.current) return;
      const kept = draft as unknown as Parameters<typeof saveDraft>[1];
      saveDraft(path.current, kept);
      savePendingRun(path.current, shown, kept, setup);
    },
    [draft],
  );

  return { pending, lost, clearPending: useCallback(() => setPending(null), []), keepRun };
}
