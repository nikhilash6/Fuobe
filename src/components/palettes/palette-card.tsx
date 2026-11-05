"use client";

import { Check, Loader2, MoreHorizontal, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cardStrip, type Palette } from "@/lib/catalog/palettes";
import { cn } from "@/lib/utils";

/** Equal stripes of a palette's colours (background first, as on the parity studio's cards). */
export function Strip({ colors, className }: { colors: string[]; className?: string }) {
  return (
    <span aria-hidden className={cn("flex overflow-hidden", className)}>
      {colors.map((c, i) => (
        <span key={`${c}-${i}`} className="h-full min-w-0 flex-1" style={{ background: c }} />
      ))}
    </span>
  );
}

/** A small round swatch for chips and pickers: the palette's colours as a conic wheel. */
export function SwatchDot({ colors, className }: { colors: string[]; className?: string }) {
  const stops = colors.length ? colors.map((c, i) => `${c} ${(i / colors.length) * 360}deg ${((i + 1) / colors.length) * 360}deg`).join(", ") : "var(--muted) 0deg 360deg";
  return <span aria-hidden className={cn("inline-block size-4 shrink-0 rounded-full ring-1 ring-foreground/10", className)} style={{ background: `conic-gradient(${stops})` }} />;
}

/**
 * A palette card: a 16:9 picture with a 5 px colour strip along the bottom (or pure stripes when
 * there's no picture), the name under it, a ring and a check when it's selected.
 */
export function PaletteCard({
  palette,
  selected,
  onSelect,
  onDelete,
  pending,
}: {
  palette: Pick<Palette, "id" | "name" | "colors" | "background" | "thumb" | "source">;
  selected?: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  /** Colours are still being extracted. */
  pending?: boolean;
}) {
  const strip = cardStrip(palette);
  return (
    <div className="group/card relative min-w-0">
      <button
        type="button"
        onClick={onSelect}
        disabled={pending}
        aria-pressed={selected}
        title={pending ? "Extracting colors from your images. You can use this palette once it's ready." : `${palette.name}: ${strip.join(" ")}`}
        className={cn(
          "block w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          selected && "[&>span:first-child]:ring-2 [&>span:first-child]:ring-primary",
        )}
      >
        <span className="relative block aspect-video overflow-hidden rounded-lg bg-muted ring-offset-2 ring-offset-background">
          {palette.thumb ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={palette.thumb} alt="" loading="lazy" className="size-full object-cover" />
              <Strip colors={strip} className="absolute inset-x-0 bottom-0 h-[5px]" />
            </>
          ) : (
            <Strip colors={strip} className="size-full" />
          )}
          {pending && (
            <span className="absolute inset-0 grid place-items-center bg-background/60">
              <Loader2 className="size-4 animate-spin" />
            </span>
          )}
          {selected && (
            <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
              <Check className="size-3" />
            </span>
          )}
        </span>
        <span className="mt-1 block truncate px-0.5 text-[12px] font-medium">{palette.name}</span>
      </button>
      {onDelete && palette.source !== "builtin" && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Palette options for ${palette.name}`}
              className="absolute top-1.5 left-1.5 grid size-6 place-items-center rounded-full bg-background/85 opacity-100 shadow-soft transition outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:opacity-0 sm:group-hover/card:opacity-100 sm:focus-visible:opacity-100"
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
