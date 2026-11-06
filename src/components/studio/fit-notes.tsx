"use client";

import { UnavailableNote } from "@/components/ui/unavailable";
import type { SettingChange } from "@/lib/catalog/made";

/** A picked setting a run makes differently, and the model in the list that makes the one picked (when there is one). */
export type FitNote = SettingChange & { switchTo?: { id: string; name: string } };

/**
 * Before a run, under a studio's settings: each picked value the run makes differently (src/lib/catalog/fitted.ts), in the
 * shared unavailable note, with the one-tap way to what is made ("Use 4:3") or to a model that makes the one picked
 * ("Use Kling 3.0"). `apply` sets it; a note without a way to get it says why alone.
 */
export function FitNotes({ fits, apply, className }: { fits: FitNote[] | undefined; apply: (c: FitNote) => (() => void) | undefined; className?: string }) {
  if (!fits?.length) return null;
  return (
    <div className={className}>
      {fits.map((c) => {
        const run = apply(c);
        const label = c.switchTo ? `Use ${c.switchTo.name}` : `Use ${c.made}`;
        return <UnavailableNote key={c.setting + c.note} reason={{ why: c.note, ...(run && { fix: { label, run } }) }} onClose={() => undefined} />;
      })}
    </div>
  );
}
