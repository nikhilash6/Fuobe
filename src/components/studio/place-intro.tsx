"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useHydrated, useStatus } from "@/lib/api";
import { placeIntro, type PlaceIntro as Intro } from "@/lib/place-intro";
import type { RunOnPick } from "@/lib/run-place";
import { useSetRunOn } from "@/lib/run-on";
import { cn } from "@/lib/utils";

/**
 * The one-time note above a run button for an account whose runs moved to this studio's GPUs when hosted runs went on
 * (src/lib/place-intro.ts says who and the words). Both buttons keep a pick on the server, so it shows once for the
 * account, on any device. `onKeep`: what the page does besides (the composer moves its engine to Cloud for a key).
 */

function useIntro(
  run: string,
  chip?: string,
): {
  intro: Intro | null;
  keep: (runOn: RunOnPick) => void;
  busy: boolean;
} {
  const hydrated = useHydrated();
  const v = useStatus().data?.viewer;
  const setRunOn = useSetRunOn();
  const intro = hydrated ? placeIntro(v, run, chip) : null;
  return {
    intro,
    keep: (runOn) =>
      setRunOn.mutate({
        runOn,
        ...(runOn === "key" && intro?.keep.key && { key: intro.keep.key }),
      }),
    busy: setRunOn.isPending,
  };
}

/** The composer's note, a dismissible line above Generate. */
export function PlaceIntro({ run, onKeep, className }: { run: string; onKeep?: (runOn: "gpu" | "key") => void; className?: string }) {
  const { intro, keep, busy } = useIntro(run);
  if (!intro) return null;
  return (
    <div
      role="note"
      data-place-intro=""
      className={cn(
        "mx-1 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-dashed px-3 py-2 text-[12px] leading-snug text-muted-foreground",
        className,
      )}
    >
      <p className="min-w-0 flex-1 basis-56">
        <span className="font-medium text-foreground">{intro.lead}</span> {intro.rest}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => (keep(intro.keep.runOn), onKeep?.(intro.keep.runOn))}
          className="inline-flex h-7 w-fit items-center rounded-full bg-highlight px-2.5 text-[12px] font-medium text-highlight-foreground hover:opacity-90 disabled:opacity-60"
        >
          {intro.keep.label}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => keep("site")}
          className="inline-flex h-7 w-fit items-center rounded-full bg-secondary px-2.5 text-[12px] font-medium hover:bg-accent disabled:opacity-60"
        >
          OK
        </button>
      </div>
    </div>
  );
}

/**
 * A tool page's note (its place chip has no line above its Run): the same words and buttons, once per page, as a note
 * that stays until one is pressed. `chip`: the place chip's words, which the note points at.
 */
export function PlaceIntroNote({ run, chip }: { run: string; chip?: string }) {
  const { intro, keep } = useIntro(run, chip);
  const lead = intro?.lead;
  useEffect(() => {
    if (!intro) return;
    toast(intro.lead, {
      id: "place-intro",
      description: intro.rest,
      duration: Infinity,
      action: {
        label: intro.keep.label,
        onClick: () => keep(intro.keep.runOn),
      },
      cancel: { label: "OK", onClick: () => keep("site") },
    });
    // Once per note: its words change only when the viewer does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead]);
  return null;
}
