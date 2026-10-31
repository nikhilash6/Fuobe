"use client";

import { ArrowRight } from "lucide-react";
import { preload } from "react-dom";
import { CardPending, IntentLink } from "@/components/intent-link";
import { PresetPreview, usePreviewPlayback } from "@/components/preset-preview";
import { thumbOf, type PresetCardData } from "@/lib/preset-cards";
import { staggered } from "@/lib/preview-playback";
import { cn } from "@/lib/utils";

/** How wide a tile shows: half a phone, a quarter from sm, half again beside the sidebar from md, a quarter from lg. */
const SIZES = "(min-width: 1024px) 25vw, (min-width: 768px) 50vw, (min-width: 640px) 25vw, 50vw";
/** Where tiles 5 to 8 show (the wall has four columns): a tablet held upright, and a desktop. */
const FOUR_UP = "(min-width: 640px) and (max-width: 767px), (min-width: 1024px)";

/**
 * A tile of Home's wall: a real cover that plays in view, its name, and what it does. On a desktop the line and a
 * "Try it" pill come in on hover or focus; on touch the line always shows. The first tile is the page's largest
 * picture, fetched first. Tiles 5 to 8 are hidden (and never fetched) where the wall has two columns; where it has
 * four, they're on the first screen, so they're asked for with the page, not after its layout as a lazy image is.
 */
export function ShowcaseTile({
  card,
  kind,
  caption,
  href,
  index,
  sizes = SIZES,
  small = false,
  onNavigate,
}: {
  card: PresetCardData;
  kind: string;
  caption: string;
  href: string;
  index: number;
  /** How wide the tile shows, where it isn't on Home's wall (a studio's row of four, under its composer). */
  sizes?: string;
  /**
   * A tile that is small at every width (a studio's row): it gets the taller, darker shade of a phone's tile, and it is
   * never the page's largest picture, so even the first isn't fetched ahead of the rest.
   */
  small?: boolean;
  /** Called as the link navigates in the app; preventDefault() keeps the page (a studio picks the tile's move itself). */
  onNavigate?: React.ComponentProps<typeof IntentLink>["onNavigate"];
}) {
  const { ref, playing, asked, handlers } = usePreviewPlayback<HTMLAnchorElement>(card.id, card.preview);
  const still = card.preview.rest?.src ?? card.preview.poster;
  if (index >= 4) preload(still, { as: "image", imageSrcSet: `${thumbOf(still)} 320w, ${still} 512w`, imageSizes: SIZES, media: FOUR_UP });
  return (
    <IntentLink
      ref={ref}
      href={href}
      onNavigate={onNavigate}
      {...handlers}
      // In the order it shows: the kind (from xl), the name, the line.
      aria-label={`${kind}: ${card.name}, ${caption}. Try it`}
      className={cn(
        "group/tile relative isolate block overflow-hidden rounded-xl bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        index >= 4 && "max-sm:hidden md:max-lg:hidden",
      )}
    >
      <div className="relative aspect-[4/3] ease-out motion-safe:transition-transform motion-safe:duration-[400ms] motion-safe:group-hover/tile:scale-[1.03]">
        <PresetPreview
          preview={card.preview}
          hue={card.hue}
          playing={playing}
          asked={asked}
          place={staggered(index)}
          sizes={sizes}
          loading={index < 4 ? "eager" : "lazy"}
          fetchPriority={index === 0 && !small ? "high" : undefined}
        />
      </div>
      {/* A small tile (a phone's, or four across a tablet) is short: a taller, darker shade keeps its white words readable over a bright picture. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t to-transparent",
          small ? "h-[70%] via-black/40 from-black/75" : "h-[45%] from-black/65 max-md:h-[70%] max-md:via-black/40 max-md:from-black/75",
        )}
      />
      <span aria-hidden className="pointer-events-none absolute inset-x-3 bottom-2.5 flex min-w-0 flex-col text-left text-white [text-shadow:0_1px_2px_rgb(0_0_0/30%)]">
        <span className="hidden text-[11px] tracking-wide text-white/75 uppercase xl:block">{kind}</span>
        <span className="truncate text-[14px] leading-snug font-medium">{card.name}</span>
        {/* Whole, on a second line where a tile is narrow. */}
        <span className="line-clamp-2 text-[12px] leading-snug text-white/80 transition-opacity duration-150 group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100 [@media(hover:hover)]:opacity-0">
          {caption}
        </span>
      </span>
      <span
        aria-hidden
        className="pointer-events-none absolute top-2.5 right-2.5 inline-flex h-7 translate-y-1 items-center gap-1 rounded-full bg-white px-3 text-[12px] font-medium text-black opacity-0 shadow-soft transition duration-150 group-hover/tile:translate-y-0 group-hover/tile:opacity-100 group-focus-visible/tile:translate-y-0 group-focus-visible/tile:opacity-100"
      >
        Try it <ArrowRight className="size-3" />
      </span>
      <CardPending />
    </IntentLink>
  );
}
