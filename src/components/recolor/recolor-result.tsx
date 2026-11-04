"use client";

import { Columns2, Download, Loader2, Palette } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { colourChip, CUSTOM_COLOUR } from "@/lib/catalog/recolor";
import type { Generation } from "@/lib/catalog/types";
import { downloadHref } from "@/lib/library";
import { cn } from "@/lib/utils";

/** The colour a run asked for: its swatch, or the custom code in its words. */
export function runColour(g: Pick<Generation, "request" | "prompt">): { label: string; hex: string } | null {
  const picked = g.request.presetOptions?.colour;
  if (picked && picked !== CUSTOM_COLOUR) return colourChip(picked);
  const hex = (g.request.prompt ?? g.prompt ?? "").match(/#[0-9a-f]{6}/i)?.[0];
  return hex ? colourChip(hex) : null;
}

/**
 * The new photo, and the original while it is held (a press on a phone, a mouse button on a computer). Compare does the
 * same as a tap, for anyone who can't hold.
 */
function HoldCompare({ before, after, label }: { before?: string; after: string; label: string }) {
  const [held, setHeld] = useState(false);
  const [pinned, setPinned] = useState(false);
  const showBefore = !!before && (held || pinned);
  return (
    <div className="space-y-2">
      <div
        className="relative overflow-hidden rounded-xl bg-media select-none [-webkit-touch-callout:none]"
        onPointerDown={() => before && setHeld(true)}
        onPointerUp={() => setHeld(false)}
        onPointerLeave={() => setHeld(false)}
        onPointerCancel={() => setHeld(false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={after} alt={label} className="block aspect-[4/5] w-full object-contain" draggable={false} />
        {before && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={before} alt="The original photo" className={cn("absolute inset-0 size-full object-contain transition-opacity duration-150", showBefore ? "opacity-100" : "opacity-0")} draggable={false} />
        )}
        <span className="pointer-events-none absolute top-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">{showBefore ? "Original" : "New colour"}</span>
      </div>
      {before && (
        <div className="flex items-center gap-2">
          <Button variant={pinned ? "secondary" : "outline"} size="sm" className="rounded-full" aria-pressed={pinned} onClick={() => setPinned((p) => !p)}>
            <Columns2 className="size-3.5" /> Compare
          </Button>
          <span className="text-[11px] text-muted-foreground">or hold the photo</span>
        </div>
      )}
    </div>
  );
}

/** One colour's run: running, failed or done, with its swatch. */
export function RecolorResult({ g, onMore }: { g: Generation; onMore: (url: string) => void }) {
  const colour = runColour(g);
  const before = g.request.inputs?.images?.[0];
  const out = g.status === "succeeded" ? g.outputs.find((o) => o.kind === "image") : undefined;
  const busy = g.status === "queued" || g.status === "running";
  const name = `${colour?.label ?? "Recolor"}.png`;
  return (
    <article className="space-y-2 rounded-2xl border bg-background p-2.5 shadow-soft">
      <div className="flex items-center gap-2 px-0.5">
        <span className="size-4 shrink-0 rounded-full border border-black/10" style={{ background: colour?.hex ?? "transparent" }} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{colour?.label ?? "New colour"}</span>
        {colour && <span className="font-mono text-[11px] text-muted-foreground">{colour.hex}</span>}
      </div>
      {out ? (
        <HoldCompare before={before} after={out.url} label={`The photo in ${colour?.label.toLowerCase() ?? "its new colour"}`} />
      ) : (
        <div className="relative overflow-hidden rounded-xl bg-media">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {before && <img src={before} alt="" className="block aspect-[4/5] w-full object-contain opacity-40" draggable={false} />}
          <div className="absolute inset-0 grid place-items-center p-4 text-center">
            {busy ? (
              <p className="inline-flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-[13px] text-white backdrop-blur" role="status">
                <Loader2 className="size-3.5 animate-spin" /> Recolouring…{g.progress ? ` ${Math.round(g.progress * 100)}%` : ""}
              </p>
            ) : (
              <p className="rounded-xl bg-black/60 px-3 py-2 text-[13px] text-white backdrop-blur" role="alert">
                {g.error ?? "This colour didn't come out. Try again."}
              </p>
            )}
          </div>
        </div>
      )}
      {out && (
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" className="rounded-full" asChild>
            <a href={downloadHref(out.url, name)} download>
              <Download className="size-3.5" /> Download
            </a>
          </Button>
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => onMore(out.url)}>
            <Palette className="size-3.5" /> Recolor more
          </Button>
        </div>
      )}
    </article>
  );
}
