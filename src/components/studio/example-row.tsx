"use client";

import dynamic from "next/dynamic";
import { useId } from "react";
import type { StudioExampleRow } from "@/lib/studio-examples";
import { cn } from "@/lib/utils";

/** The covers are their own chunk, as in the studios (studio-page.tsx): only a page that shows the row loads them. */
const ShowcaseTile = dynamic(() => import("@/components/home/showcase-tile").then((m) => m.ShowcaseTile));

/** A tile's width: half a phone, else a quarter of the row (1000 px at most). */
const SIZES = "(min-width: 640px) 240px, 50vw";

/**
 * "See what it makes" on a tool or a project list (Layers, Genjutsu, Katana, Cinema, Ads Studio…), from the page's
 * studioExamples() (src/lib/studio-examples.ts): real covers, each opening its app, or its motion or effect in the
 * Video studio. The studios' own row (studio-page.tsx) is the same, and picks a move in place.
 */
export function ExampleRow({ row, className }: { row: StudioExampleRow; className?: string }) {
  const heading = useId();
  if (!row.tiles.length) return null;
  return (
    <section aria-labelledby={heading} className={cn("mx-auto w-full max-w-[1000px]", className)}>
      <h2 id={heading} className="mb-2 text-center text-[12.5px] font-medium text-muted-foreground">
        {row.heading}
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {row.tiles.map((e, i) => (
          <ShowcaseTile key={e.card.id} card={e.card} kind={e.kind} caption={e.caption} href={e.href} index={i} sizes={SIZES} small />
        ))}
      </div>
    </section>
  );
}
