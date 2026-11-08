"use client";

import { Film } from "lucide-react";
import { useState } from "react";
import { FILM_LOOK_GROUPS, filmLook, filmLookThumb, FILM_LOOKS, type FilmLook } from "@/lib/film-looks";
import { cn } from "@/lib/utils";
import { Chip, ClearableChip } from "./chip";
import { radioKeys, radioTab } from "./radio-keys";
import { ResponsivePanel } from "./responsive-panel";

/**
 * MOSS-Image's Film look picker (params.extra.filmLook): Fuobe's tested film and camera looks, grouped, each with a
 * thumbnail made from its own test render. The server adds the look around the words when the picture is made, so the
 * prompt box keeps the person's words as written. A popover on desktop, a bottom sheet on phones; its own chunk.
 */

const ALL = "All looks";

function Thumb({ look, className, sizes = "120px", width = 320 }: { look: FilmLook; className?: string; sizes?: string; width?: 320 | 640 }) {
  const small = filmLookThumb(look.id, 320);
  const large = filmLookThumb(look.id, 640);
  return (
    <picture className={cn("block overflow-hidden bg-muted", className)}>
      <source type="image/avif" srcSet={`${small.avif} 320w, ${large.avif} 640w`} sizes={sizes} />
      <source type="image/webp" srcSet={`${small.webp} 320w, ${large.webp} 640w`} sizes={sizes} />
      <img src={(width === 640 ? large : small).webp} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
    </picture>
  );
}

export default function FilmLookChip({ value, onChange, disabled }: { value?: string; onChange: (id: string | undefined) => void; disabled?: string }) {
  const [open, setOpen] = useState(false);
  const picked = filmLook(value);
  const [tab, setTab] = useState<string>(picked?.group ?? ALL);
  const groups = FILM_LOOK_GROUPS.filter((g) => FILM_LOOKS.some((l) => l.group === g));
  const items = tab === ALL ? FILM_LOOKS : FILM_LOOKS.filter((l) => l.group === tab);
  return (
    <ClearableChip active={!!picked} onClear={() => onChange(undefined)} clearLabel="No film look">
      <ResponsivePanel
        open={open}
        onOpenChange={setOpen}
        title="Film look"
        description="Film and camera looks for MOSS-Image. Fuobe adds the look around your words when the picture is made; your prompt stays as you wrote it."
        className="w-[min(92vw,500px)] p-2"
        trigger={
          <Chip icon={picked ? undefined : Film} active={!!picked} aria-label={`Film look: ${picked?.name ?? "none"}`} title={disabled}>
            {picked && <Thumb look={picked} className="size-4 rounded-full" sizes="16px" />}
            <span className="max-w-32 truncate">{picked?.name ?? "Film look"}</span>
          </Chip>
        }
      >
        {disabled && <p className="mb-2 rounded-md bg-muted px-2 py-1.5 text-[12px] text-muted-foreground">{disabled}</p>}
        {/* Filters of the grid below (not tabs with panels): a radio group, arrow keys move and pick. */}
        <div role="radiogroup" aria-label="Film look groups" onKeyDown={radioKeys} className="scrollbar-none -mx-0.5 mb-2 flex gap-1 overflow-x-auto px-0.5">
          {[ALL, ...groups].map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={tab === t}
              tabIndex={radioTab(tab === t)}
              onClick={() => setTab(t)}
              className={cn(
                "h-7 shrink-0 rounded-full px-2.5 text-[12px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                tab === t ? "bg-brand-faint text-brand-text" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="grid max-h-80 grid-cols-3 gap-1.5 overflow-y-auto sm:grid-cols-4">
          {items.map((l) => (
            <button
              key={l.id}
              type="button"
              aria-pressed={picked?.id === l.id}
              title={l.blurb}
              onClick={() => {
                onChange(picked?.id === l.id ? undefined : l.id);
                setOpen(false);
              }}
              className={cn("group flex min-w-0 flex-col gap-1 rounded-lg p-1 text-left ring-primary transition hover:bg-accent", picked?.id === l.id && "ring-2")}
            >
              <span className="relative aspect-[3/4] w-full overflow-hidden rounded-md">
                <Thumb look={l} className="size-full transition-transform duration-300 group-hover:scale-105" />
              </span>
              <span className="truncate px-0.5 text-[12px] font-medium">{l.name}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 border-t px-0.5 pt-2 text-[12px] text-muted-foreground">
          {picked ? (
            <>
              <span className="font-medium text-foreground">{picked.name}.</span> {picked.blurb}.
              {picked.mono && " Black and white: colour words in your prompt are left out of this picture."}
            </>
          ) : (
            "Pick a look: describe the scene in your prompt, and the look takes care of the colour, grain and contrast."
          )}
        </p>
      </ResponsivePanel>
    </ClearableChip>
  );
}
