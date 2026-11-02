"use client";

import { memo, useMemo } from "react";
import { PresetPreview, usePreviewPlayback } from "@/components/preset-preview";
import { NO_COVER, templatePreview, type CoverFrame, type TemplateCover } from "@/lib/template-covers";
import { cn } from "@/lib/utils";

/**
 * A template tile's playback, as the gallery cards': spread `handlers` on the card and give it `ref`. A clip plays by
 * itself while in view (a few at once, never with reduced motion or Save-Data), and on hover, focus or tap. A tile
 * without a clip (a still, or its drawn art) never plays: the hooks run all the same.
 */
export function useCoverPlayback<T extends HTMLElement>(key: string, cover: TemplateCover | undefined) {
  const preview = useMemo(() => (cover ? templatePreview(cover) : NO_COVER), [cover]);
  return usePreviewPlayback<T>(`tpl:${key}`, preview);
}

/**
 * A tile's real cover, filling the tile (which is `relative` and sized): its poster, lazy, its 320 px copy where the
 * tile is small (`sizes`), and its clip over it while it plays.
 */
export const CoverArt = memo(function CoverArt({ cover, sizes, playing = false, asked = false }: { cover: TemplateCover; sizes: string; playing?: boolean; asked?: boolean }) {
  const preview = useMemo(() => templatePreview(cover), [cover]);
  return <PresetPreview preview={preview} hue={0} playing={playing} asked={asked} sizes={sizes} />;
});

/** One still of a cover (a slide, a contact sheet's cell): lazy, its 320 px copy where it shows small. */
export function CoverImg({ frame, sizes, className }: { frame: CoverFrame; sizes: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={frame.src}
      srcSet={`${frame.thumb} 320w, ${frame.src} 768w`}
      sizes={sizes}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      className={cn("size-full object-cover", className)}
      aria-hidden
    />
  );
}

/** The chip on an example picture in an empty list (Character Sheet, Storyboard, Elements): what the tool makes. */
export function ExampleChip({ className }: { className?: string }) {
  return <span className={cn("pointer-events-none absolute top-2 left-2 rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-medium text-foreground shadow-soft", className)}>Example</span>;
}
