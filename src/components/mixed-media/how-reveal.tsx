"use client";

import { PresetPreview, usePreviewPlayback } from "@/components/preset-preview";
import type { StudioExampleRow } from "@/lib/studio-examples";

/**
 * "How it works" opens on one look playing out: a real clip drawn again in the look (studioExamples("mixed-media")),
 * resting on the look and playing in view, as a look card does. A picture to watch, not a link.
 */
export function HowReveal({ row }: { row: StudioExampleRow }) {
  const [tile] = row.tiles;
  const { ref, playing, asked, handlers, onTap } = usePreviewPlayback<HTMLDivElement>(tile.card.id, tile.card.preview);
  return (
    <figure className="mx-auto mt-8 max-w-[512px]">
      <p className="mb-2 text-center text-[12.5px] font-medium text-muted-foreground">{row.heading}</p>
      <div ref={ref} {...handlers} onPointerUp={onTap} className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-muted">
        <PresetPreview preview={tile.card.preview} hue={tile.card.hue} playing={playing} asked={asked} sizes="(min-width: 560px) 512px, 100vw" />
      </div>
      <figcaption className="mt-2 text-center text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground">{tile.card.name}</span> · {tile.caption}
      </figcaption>
    </figure>
  );
}
