"use client";

import { Aperture, CalendarDays, Clapperboard, FileText, Handshake, LayoutGrid, Megaphone, Music4, Shirt } from "lucide-react";
import { WORKSHOP_FORMATS, WORKSHOP_GROUPS, type PlayFormat } from "@/lib/chat/catalog";
import { cn } from "@/lib/utils";

export const WORKSHOP_ICON = {
  brief: FileText,
  board: LayoutGrid,
  shots: Clapperboard,
  style: Shirt,
  photo: Aperture,
  song: Music4,
  calendar: CalendarDays,
  campaign: Megaphone,
  pitch: Handshake,
} as const;

/** A format's cover: its picture, or its colours and its line icon until the picture is made. */
export function WorkshopCover({ format, className }: { format: PlayFormat; className?: string }) {
  const Icon = WORKSHOP_ICON[format.icon];
  return (
    <span className={cn("relative block overflow-hidden", className)} style={{ background: `linear-gradient(150deg, ${format.accent[0]} 0%, ${format.accent[1]} 120%)` }} aria-hidden>
      {format.cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={format.cover} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
      ) : (
        <Icon className="absolute top-[18%] left-1/2 size-[30%] -translate-x-1/2 text-white/80" strokeWidth={1} />
      )}
    </span>
  );
}

/** The Workshop's formats in their three groups, as tall cards like the characters'. */
export function WorkshopGrid({ onPick }: { onPick: (p: PlayFormat) => void }) {
  return (
    <div className="space-y-10">
      {WORKSHOP_GROUPS.map((g) => (
        <section key={g.id} aria-labelledby={`workshop-${g.id}`}>
          <div className="mb-3.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id={`workshop-${g.id}`} className="font-heading text-[26px] leading-none">
              {g.label}
            </h2>
            <p className="text-[13.5px] text-muted-foreground">{g.note}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {WORKSHOP_FORMATS.filter((p) => p.group === g.id).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick(p)}
                className="group relative block w-full overflow-hidden rounded-[18px] text-left [transform:translateZ(0)] focus-visible:ring-4 focus-visible:ring-brand-faint focus-visible:outline-none"
                aria-label={`${p.name}: ${p.blurb}`}
              >
                <WorkshopCover format={p} className="aspect-[4/5] w-full transition-transform duration-500 ease-out group-hover:scale-[1.03] motion-reduce:transition-none" />
                <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-3.5 pt-14 text-white">
                  <span className="block font-heading text-[21px] leading-tight sm:text-[23px]">{p.name}</span>
                  <span className="mt-1 line-clamp-2 block text-[12.5px] leading-snug text-white/80">{p.blurb}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
