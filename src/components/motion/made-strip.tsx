"use client";

import { Play } from "lucide-react";
import { useMemo, useState } from "react";
import { Viewer } from "@/components/studio/viewer";
import { useGenerations, useIsGuest } from "@/lib/api";
import type { Generation } from "@/lib/catalog/types";
import { motionTemplateOf } from "@/lib/library";

/**
 * "Made with this template": the clips saved from a code-drawn template (the owner's Library, or an account's own
 * runs: the list is scoped by the server). Each opens the normal result viewer, where it downloads.
 */

export const KINETIC_FEATURE = "marketing-kinetic";

export function MadeStrip({ templateId }: { templateId: string }) {
  const guest = useIsGuest();
  // The server picks this template's clips, so a long Library never hides them.
  const list = useGenerations({ features: [KINETIC_FEATURE], template: templateId, statuses: ["succeeded"], limit: 12 });
  const mine = useMemo(() => (guest ? [] : (list.data ?? []).filter((g) => g.status === "succeeded" && g.outputs[0] && motionTemplateOf(g) === templateId).slice(0, 12)), [list.data, templateId, guest]);
  const [open, setOpen] = useState<Generation | null>(null);
  if (!mine.length) return null;
  return (
    <section aria-label="Made with this template" className="min-w-0">
      <h3 className="mb-2 text-[13px] font-medium">Made with this template</h3>
      <div className="scrollbar-none -mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 pb-1">
        {mine.map((g) => {
          const o = g.outputs[0];
          const poster = typeof o.meta?.poster === "string" ? o.meta.poster : undefined;
          return (
            <button key={g.id} type="button" onClick={() => setOpen(g)} aria-label={`Open saved clip: ${(g.request.prompt ?? "").slice(0, 80)}`} data-kinetic-made={g.id} className="relative h-28 shrink-0 overflow-hidden rounded-xl bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ aspectRatio: o.width && o.height ? `${o.width} / ${o.height}` : "9 / 16" }}>
              {poster ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={poster} alt="" className="size-full object-cover" loading="lazy" />
              ) : (
                <video src={o.url} muted playsInline preload="metadata" className="size-full object-cover" />
              )}
              <span className="absolute right-1.5 bottom-1.5 grid size-6 place-items-center rounded-full bg-black/45 text-white backdrop-blur" aria-hidden>
                <Play className="size-3 fill-current" />
              </span>
            </button>
          );
        })}
      </div>
      {open && <Viewer generation={open} index={0} onClose={() => setOpen(null)} />}
    </section>
  );
}
