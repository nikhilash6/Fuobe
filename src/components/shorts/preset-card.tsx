"use client";

import { Check, Pencil, Plus } from "lucide-react";
import { memo } from "react";
import { PresetPreview, usePreviewPlayback } from "@/components/preset-preview";
import { isCover, type PresetPreview as Preview } from "@/lib/preset-cards";
import { cn } from "@/lib/utils";
import { LookMotif } from "./look-motif";

/**
 * A selectable look card (Shorts Studio and Mixed Media): the look's real cover when it has one (a still, or a
 * clip that plays as the galleries' do), else the procedural preview from the galleries (plays on hover or focus;
 * on phones, by itself while in view) with the look's motif, then its name and one line.
 */
export const LookCard = memo(function LookCard({
  id,
  name,
  description,
  preview,
  hue,
  selected,
  onSelect,
  badge,
}: {
  id: string;
  name: string;
  description: string;
  preview: Preview;
  hue: number;
  selected: boolean;
  onSelect: (id: string) => void;
  badge?: string;
}) {
  const { ref, playing, asked, handlers } = usePreviewPlayback<HTMLButtonElement>(id, preview);
  const real = !!preview.video || isCover(preview);
  return (
    <button
      ref={ref}
      type="button"
      {...handlers}
      onClick={() => onSelect(id)}
      aria-pressed={selected}
      data-look={id}
      className={cn(
        "group/card card-motion flex min-w-0 flex-col gap-2 rounded-xl p-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
        selected && "bg-brand-faint hover:bg-brand-faint-hover",
      )}
    >
      <div className={cn("relative aspect-[4/5] w-full overflow-hidden rounded-lg bg-muted ring-offset-2 ring-offset-background transition-shadow", selected && "ring-2 ring-primary")}>
        <PresetPreview preview={preview} hue={hue} playing={playing} asked={asked} sizes={real ? "(max-width: 640px) 50vw, 210px" : undefined} />
        {/* The preset's own motif (lettering, scribbles, paper, a grid…), so similar treatments read apart; a real cover shows the look itself. */}
        {!real && <LookMotif id={id} hue={hue} />}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 z-[7] h-12 bg-gradient-to-t from-black/40 to-transparent" />
        {badge && <span className="absolute top-1.5 left-1.5 z-[8] rounded-[4px] bg-black/45 px-1.5 text-[10px] font-medium text-white backdrop-blur">{badge}</span>}
        {selected && (
          <span className="absolute top-1.5 right-1.5 z-[8] grid size-6 place-items-center rounded-full bg-primary text-primary-foreground shadow-soft">
            <Check className="size-3.5" />
          </span>
        )}
      </div>
      <div className="min-w-0 px-0.5">
        <p className="truncate text-[13px] font-medium">{name}</p>
        <p className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">{description}</p>
      </div>
    </button>
  );
});

/** A custom preset: its reference images as a mosaic. */
export function CustomCard({
  id,
  name,
  description,
  references,
  selected,
  onSelect,
  onEdit,
}: {
  id: string;
  name: string;
  description: string;
  references: string[];
  selected: boolean;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  const tiles = references.slice(0, 4);
  return (
    <div className={cn("group/card relative flex min-w-0 flex-col gap-2 rounded-xl p-1.5 transition-colors hover:bg-accent", selected && "bg-brand-faint hover:bg-brand-faint-hover")}>
      <button
        type="button"
        onClick={() => onSelect(id)}
        aria-pressed={selected}
        data-look={id}
        className="flex min-w-0 flex-col gap-2 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className={cn("relative grid aspect-[4/5] w-full gap-0.5 overflow-hidden rounded-lg bg-muted ring-offset-2 ring-offset-background", tiles.length > 1 && "grid-cols-2", selected && "ring-2 ring-primary")}>
          {tiles.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={src} alt="" loading="lazy" className={cn("size-full object-cover", tiles.length === 3 && i === 0 && "row-span-2")} />
          ))}
          <span className="absolute top-1.5 left-1.5 rounded-[4px] bg-black/45 px-1.5 text-[10px] font-medium text-white backdrop-blur">Created by you</span>
          {selected && (
            <span className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground shadow-soft">
              <Check className="size-3.5" />
            </span>
          )}
        </div>
        <div className="min-w-0 px-0.5">
          <p className="truncate pr-7 text-[13px] font-medium">{name}</p>
          <p className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">{description || `${references.length} reference image${references.length === 1 ? "" : "s"}`}</p>
        </div>
      </button>
      <button
        type="button"
        onClick={() => onEdit(id)}
        aria-label={`Edit ${name}`}
        className="absolute right-2 bottom-[2.6rem] grid size-7 place-items-center rounded-full text-muted-foreground opacity-100 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 sm:opacity-0 sm:group-hover/card:opacity-100"
      >
        <Pencil className="size-3.5" />
      </button>
    </div>
  );
}

/** "Create a preset from references". */
export function CreateCard({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group/card flex min-w-0 flex-col gap-2 rounded-xl p-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
      <div className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong text-muted-foreground transition-colors group-hover/card:border-primary group-hover/card:text-brand-text">
        <span className="grid size-10 place-items-center rounded-full bg-brand-faint text-brand-text">
          <Plus className="size-5" />
        </span>
        <span className="px-3 text-center text-[12px] leading-snug">From your references</span>
      </div>
      <div className="min-w-0 px-0.5">
        <p className="truncate text-[13px] font-medium">Create a preset</p>
        <p className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">Up to 10 images of the look you want</p>
      </div>
    </button>
  );
}
