"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { CoverImg } from "@/components/template-cover";
import type { FashionTemplate } from "@/lib/catalog/packs";
import { templateCover } from "@/lib/template-covers";
import { cn } from "@/lib/utils";

/** A template's name as its card shows it: every word capitalised ("Ultra bold" becomes "Ultra Bold"). */
export const titleCase = (name: string) => name.replace(/(^|[\s-])(\p{Ll})/gu, (_, a: string, c: string) => a + c.toUpperCase());

/** A fine noise layer (film grain) drawn by the browser, no image file. */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .9 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** The branded tile a template shows until its cover is published: its two colours as soft studio light, and its name. */
function BrandTile({ name, hues }: { name: string; hues: [number, number] }) {
  const [a, b] = hues;
  const background = `radial-gradient(70% 55% at 50% 30%, oklch(0.9 0.06 ${a} / 0.75), transparent 70%), linear-gradient(160deg, oklch(0.62 0.15 ${a}), oklch(0.3 0.09 ${b}))`;
  return (
    <span role="img" aria-label={`${name} preview`} className="relative block size-full" style={{ background }}>
      <span aria-hidden className="absolute inset-0 opacity-30 mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
      <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
      <span aria-hidden className="absolute inset-x-4 bottom-4 font-heading text-[clamp(1.25rem,2.6vw,2.25rem)] leading-[1.05] text-white drop-shadow-sm">
        {name}
      </span>
    </span>
  );
}

/**
 * A template's preview: its real cover's slides in a carousel (arrows on hover, dots below; templateCover, and only the
 * slide in view loads). Until its cover is published, a branded tile in the template's colours with its name.
 */
export function TemplatePreview({ t, className }: { t: Pick<FashionTemplate, "id" | "name" | "hues">; className?: string }) {
  const [slide, setSlide] = useState(0);
  const cover = templateCover("fashion", t.id);
  const n = cover ? cover.frames.length : 1;
  const at = slide % n;
  const arrow = "absolute top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-background/85 text-foreground opacity-0 shadow-soft transition outline-none group-hover/tpl:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50";
  return (
    <span className={cn("group/tpl relative block overflow-hidden", className)}>
      {cover ? (
        <span role="img" aria-label={`${t.name} preview ${at + 1} of ${n}`} className="block size-full bg-muted">
          <CoverImg key={at} frame={cover.frames[at]} sizes="(max-width: 1024px) 50vw, 370px" />
        </span>
      ) : (
        <BrandTile name={titleCase(t.name)} hues={t.hues} />
      )}
      {n > 1 && (
        <>
          <button type="button" aria-label="Previous preview" onClick={(e) => (e.stopPropagation(), setSlide((s) => (s + n - 1) % n))} className={cn(arrow, "left-1.5")}>
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" aria-label="Next preview" onClick={(e) => (e.stopPropagation(), setSlide((s) => (s + 1) % n))} className={cn(arrow, "right-1.5")}>
            <ChevronRight className="size-4" />
          </button>
        </>
      )}
      <span className={cn("absolute inset-x-0 bottom-2 flex justify-center gap-1", n < 2 && "hidden")}>
        {Array.from({ length: n }, (_, i) => (
          <span key={i} className={cn("size-1.5 rounded-full bg-white/60", i === at && "bg-white")} />
        ))}
      </span>
    </span>
  );
}
