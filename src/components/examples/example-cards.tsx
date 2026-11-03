"use client";

import { ArrowRight, Check, Eye, Play, Sparkles } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { PresetPreview, usePreviewPlayback } from "@/components/preset-preview";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { exampleKey, type ExampleCard, type ExampleInput, type ExampleMedia, type ExampleRowData } from "@/lib/examples/types";
import { hasHdStill } from "@/lib/preset-hd";
import { ROW_GAP, ROW_GRID, ROW_HEADING, rowColumns, rowSection, rowWidth, type ExampleAspect, type RowLayout } from "./example-row-frame";
import { staggered } from "@/lib/preview-playback";
import { cn } from "@/lib/utils";

/**
 * "Start from an example": a card per example, with what came out filling it and what went in as a small picture in its
 * corner, then its line, its words and its settings. One tap loads it into the page's composer (`onPick`); a look-only
 * card opens a sheet with everything it was made from, and a cover from another page opens that page.
 */

/** What a card does when tapped. */
export type ExamplePick = (card: ExampleCard) => void;

export type { ExampleAspect };

/** A real cover's still has a 320 px copy beside it (thumbs/), used on small screens, or larger copies (preset-hd.ts). */
const hasCopies = (src: string) => /^\/previews\/presets\/(peak\/)?[^/]+\.(jpg|webp)\?/.test(src) || hasHdStill(src);

function pillText(card: ExampleCard, active: boolean): string {
  if (active) return "In the composer";
  if (card.load.via !== "look") return "Use";
  if (card.inputs.length) return "See how";
  // A cover from another page opens it; a look-only example opens its sheet.
  return card.load.href ? "Try it" : "See it";
}

function ariaLabel(card: ExampleCard): string {
  if (card.load.via !== "look") return `Use this example: ${card.caption}`;
  if (card.inputs.length) return `See how it was made: ${card.caption}`;
  if (!card.load.href) return `See it: ${card.caption}`;
  return `${card.title ? `${card.title}: ` : ""}${card.caption}. Try it`;
}

/** A corner picture's short name, when a card has two ("Target" and "Face", "Start" and "End"). */
const SHORT_LABELS: Record<string, string> = { "Target photo": "Target", "Start frame": "Start", "End frame": "End", "Color reference": "Colors" };
const shortLabel = (input: ExampleInput) => (input.label ? (SHORT_LABELS[input.label] ?? input.label) : undefined);

/** What came out: a clip that plays in view (its still first), or a picture. */
function Output({ card, index, playing, asked, sizes }: { card: ExampleCard; index: number; playing: boolean; asked: boolean; sizes: string }) {
  const out = card.output;
  if (out.kind === "video") {
    const still = out.rest?.src ?? out.poster ?? out.src;
    return (
      <PresetPreview
        preview={{ poster: out.poster ?? still, video: out.src, ...(out.rest && { rest: out.rest }), scene: "portrait" }}
        hue={0}
        playing={playing}
        asked={asked}
        place={staggered(index)}
        sizes={hasCopies(still) ? sizes : undefined}
        loading={index < 2 ? "eager" : "lazy"}
      />
    );
  }
  const small = out.poster ?? out.src;
  // A preset's still cover with larger copies: the card takes one as wide as it shows (PresetPreview's picture).
  if (hasHdStill(small)) {
    return <PresetPreview preview={{ poster: small, scene: "portrait" }} hue={0} playing={false} sizes={sizes} loading={index < 2 ? "eager" : "lazy"} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={small}
      srcSet={out.poster && out.poster !== out.src ? `${out.poster} 512w, ${out.src} 960w` : undefined}
      sizes={out.poster ? sizes : undefined}
      alt=""
      width={out.w ?? 512}
      height={out.h ?? 384}
      loading={index < 2 ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      className="absolute inset-0 size-full object-cover"
    />
  );
}

/** One input in the corner: a picture, a clip's still with a play mark, or a recording's mark. */
function InsetThumb({ input, label, className }: { input: ExampleInput; label?: string; className?: string }) {
  const m = input.media;
  if (m.kind === "audio") {
    return (
      <span className={cn("grid aspect-square place-items-center rounded-[10px] bg-background/95 text-foreground ring-2 ring-background", className)}>
        <Play className="size-4" aria-hidden />
      </span>
    );
  }
  const src = m.thumb ?? m.poster ?? m.src;
  return (
    <span className={cn("relative block overflow-hidden rounded-[10px] bg-muted shadow-soft ring-2 ring-background", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" loading="lazy" decoding="async" draggable={false} className="aspect-[4/3] size-full object-cover" />
      {m.kind === "video" && (
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid size-5 place-items-center rounded-full bg-black/55 text-white">
            <Play className="size-2.5 fill-current" aria-hidden />
          </span>
        </span>
      )}
      {label && <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-px text-center text-[10px] leading-3.5 font-medium text-white">{label}</span>}
    </span>
  );
}

/** What went in, in the card's corner: one picture, two stacked, or a start and an end frame. */
function Insets({ inputs }: { inputs: ExampleInput[] }) {
  if (!inputs.length) return null;
  const start = inputs.find((i) => i.slot === "image");
  const end = inputs.find((i) => i.slot === "endImage");
  if (start && end) {
    return (
      <span aria-hidden className="pointer-events-none absolute top-2 left-2 flex w-[52%] items-center gap-1">
        <InsetThumb input={start} label="Start" className="w-[46%]" />
        <ArrowRight className="size-3 shrink-0 text-white drop-shadow" />
        <InsetThumb input={end} label="End" className="w-[46%]" />
      </span>
    );
  }
  const shown = inputs.slice(0, 2);
  const two = shown.length > 1;
  // Two pictures sit at the top, clear of the label in the bottom corner, each with its name.
  return (
    <span aria-hidden className={cn("pointer-events-none absolute left-2 flex w-[30%] gap-1", two ? "top-2 flex-col" : "bottom-2 flex-col-reverse")}>
      {shown.map((i) => (
        <InsetThumb key={i.slot} input={i} label={two ? shortLabel(i) : undefined} />
      ))}
    </span>
  );
}

/** The card. The whole card is one tap target. */
export function ExampleCardView({
  card,
  index,
  active = false,
  onPick,
  aspect = "4/3",
  sizes = "(min-width: 640px) 240px, 50vw",
  className,
}: {
  card: ExampleCard;
  index: number;
  active?: boolean;
  onPick: ExamplePick;
  aspect?: ExampleAspect;
  sizes?: string;
  className?: string;
}) {
  const clip = card.output.kind === "video" ? card.output.src : undefined;
  const { ref, playing, asked, handlers } = usePreviewPlayback<HTMLElement>(card.id, { video: clip });
  const media = (
    <span className={cn("@container relative block w-full overflow-hidden rounded-xl bg-muted", aspect === "3/4" ? "aspect-[3/4]" : "aspect-[4/3]", active && "ring-2 ring-primary ring-offset-2 ring-offset-background")}>
      <Output card={card} index={index} playing={playing} asked={asked} sizes={sizes} />
      <Insets inputs={card.inputs} />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute right-2 bottom-2 inline-flex h-8 items-center gap-1 rounded-full px-3 text-[12px] font-medium shadow-soft transition duration-150",
          // A narrow card keeps its picture clear: the mark alone (its words stay for a screen reader).
          active && "@max-[12.5rem]:px-2.5",
          active ? "bg-primary text-primary-foreground" : "bg-white text-black",
          // Phones always show it; a desktop on hover or focus.
          !active && "[@media(hover:hover)]:translate-y-1 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/ex:translate-y-0 [@media(hover:hover)]:group-hover/ex:opacity-100 [@media(hover:hover)]:group-focus-visible/ex:translate-y-0 [@media(hover:hover)]:group-focus-visible/ex:opacity-100",
        )}
      >
        {active ? <Check className="size-3" /> : card.load.via === "look" && (card.inputs.length || !card.load.href) ? <Eye className="size-3" /> : <Sparkles className="size-3" />}
        <span className={cn(active && "@max-[12.5rem]:sr-only")}>{pillText(card, active)}</span>
      </span>
    </span>
  );
  const text = (
    <span className="mt-2 flex min-w-0 flex-col gap-1 text-left">
      {card.title && <span className="truncate text-[13px] leading-snug font-medium">{card.title}</span>}
      <span className={cn("line-clamp-2 text-[13px] leading-snug", card.title ? "text-muted-foreground" : "font-medium")}>{card.caption}</span>
      {card.words && <span className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">“{card.words}”</span>}
      {card.chips?.length ? (
        <span className="flex flex-wrap gap-1">
          {card.chips.map((c) => (
            <span key={c} className="rounded-full bg-muted px-2 py-0.5 text-[11px] leading-4 text-muted-foreground">
              {c}
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
  const cls = cn(
    "group/ex block w-full min-w-0 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    className,
  );
  // A cover from another page opens that page.
  if (card.load.via === "look" && !card.inputs.length && card.load.href) {
    return (
      <Link ref={ref as React.Ref<HTMLAnchorElement>} href={card.load.href} {...handlers} aria-label={ariaLabel(card)} data-example={card.id} className={cls}>
        {media}
        {text}
      </Link>
    );
  }
  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
      {...handlers}
      onClick={() => onPick(card)}
      aria-label={ariaLabel(card)}
      aria-pressed={card.load.via === "look" ? undefined : active}
      data-example={card.id}
      className={cls}
    >
      {media}
      {text}
    </button>
  );
}

/** How wide a grid's card shows (its picture's `sizes`), by how many cards it has: as the grid below lays them out. */
function gridSizes(n: number): string {
  if (n === 1) return "(min-width: 392px) 360px, calc(100vw - 32px)";
  if (n === 2) return "(min-width: 640px) 252px, 50vw";
  if (n === 3) return "(min-width: 640px) 245px, 50vw";
  return "(min-width: 1032px) 240px, (min-width: 640px) 25vw, 50vw";
}

/**
 * Cards in a grid: two across a phone, up to four across a desktop. On its own (the Examples sheet) one to three cards
 * stay centred at a card's width; inside a row (`bare`) the row's frame sets the width, so its heading lines up with it.
 */
export function ExampleGrid({
  cards,
  activeId,
  onPick,
  aspect,
  bare = false,
  maxColumns,
  className,
}: {
  cards: ExampleCard[];
  activeId?: string;
  onPick: ExamplePick;
  aspect?: ExampleAspect;
  bare?: boolean;
  maxColumns?: 2 | 4;
  className?: string;
}) {
  return (
    <div data-example-grid className={cn(ROW_GRID, ROW_GAP, rowColumns(cards.length, maxColumns), !bare && rowWidth(cards.length), className)}>
      {cards.map((c, i) => (
        <ExampleCardView key={c.id} card={c} index={i} active={!!activeId && exampleKey(c) === activeId} onPick={onPick} aspect={aspect} sizes={gridSizes(cards.length)} />
      ))}
    </div>
  );
}

/**
 * A row under a composer or an upload box: its heading on the cards' left edge, and its cards. Look-only cards open
 * their sheet here. Its frame (example-row-frame.tsx) is the one its skeleton draws while this code loads.
 */
export function ExampleRow({
  row,
  activeId,
  onPick,
  aspect,
  layout = "centred",
  maxColumns,
  className,
}: {
  row: ExampleRowData;
  activeId?: string;
  /** Loads a card into the page's composer; left out, every card is looked at. */
  onPick?: ExamplePick;
  aspect?: ExampleAspect;
  /** "column" under a studio's composer (the row fills the composer's column), "centred" as a section of its own. */
  layout?: RowLayout;
  /** 2 keeps two cards across: a row in a narrow box. */
  maxColumns?: 2 | 4;
  className?: string;
}) {
  const heading = useId();
  const [looking, setLooking] = useState<ExampleCard | null>(null);
  if (!row.cards.length) return null;
  const pick: ExamplePick = (c) => (c.load.via === "look" || !onPick ? setLooking(c) : onPick(c));
  return (
    <section aria-labelledby={heading} data-examples className={cn(rowSection(layout), className)}>
      <div className={rowWidth(row.cards.length, layout)}>
        <h2 id={heading} className={ROW_HEADING}>
          {row.heading}
        </h2>
        <ExampleGrid cards={row.cards} activeId={activeId} onPick={pick} aspect={aspect} maxColumns={maxColumns} bare />
      </div>
      <ExampleSheet card={looking} onOpenChange={(o) => !o && setLooking(null)} />
    </section>
  );
}

/**
 * The cards inside a preset's header (an app's page, a motion or effect picked in the Video studio): a strip that
 * scrolls sideways on a phone (one card fills it), a row on a desktop.
 */
export function ExampleStrip({ cards, activeId, onPick }: { cards: ExampleCard[]; activeId?: string; onPick: ExamplePick }) {
  const [looking, setLooking] = useState<ExampleCard | null>(null);
  const pick: ExamplePick = (c) => (c.load.via === "look" ? setLooking(c) : onPick(c));
  const one = cards.length === 1;
  return (
    <div data-examples>
      <p className="mb-2 text-[12px] font-medium text-muted-foreground">Start from an example</p>
      <div className={cn("scrollbar-none -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1", one && "overflow-visible")}>
        {cards.map((c, i) => (
          <ExampleCardView
            key={c.id}
            card={c}
            index={i}
            active={!!activeId && exampleKey(c) === activeId}
            onPick={pick}
            sizes={one ? "(min-width: 640px) 440px, 90vw" : "200px"}
            className={cn("shrink-0 snap-start", one ? "w-full max-w-[360px] sm:max-w-[440px]" : "w-[160px] sm:w-[200px]")}
          />
        ))}
      </div>
      <ExampleSheet card={looking} onOpenChange={(o) => !o && setLooking(null)} />
    </div>
  );
}

/** A file of an example, large: a picture, a clip with its controls, or a recording. */
function Large({ media, label }: { media: ExampleMedia; label: string }) {
  if (media.kind === "video") return <video src={media.src} poster={media.poster} controls playsInline loop muted preload="none" className="w-full rounded-xl bg-muted" aria-label={label} />;
  if (media.kind === "audio") return <audio src={media.src} controls preload="none" className="w-full" aria-label={label} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={media.src} alt={label} loading="lazy" decoding="async" className="w-full rounded-xl bg-muted object-cover" />;
}

function SheetBody({ card, onUse }: { card: ExampleCard; onUse?: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      {card.inputs.length ? (
        <div>
          <p className="mb-2 text-[12px] font-medium text-muted-foreground">What went in</p>
          <div className={cn("grid gap-2", card.inputs.length > 1 ? "grid-cols-2" : "grid-cols-1 sm:max-w-[60%]")}>
            {card.inputs.map((i) => (
              <figure key={i.slot} className="min-w-0">
                <Large media={i.media} label={i.label ?? "What went in"} />
                {i.label && <figcaption className="mt-1 text-[12px] text-muted-foreground">{i.label}</figcaption>}
              </figure>
            ))}
          </div>
        </div>
      ) : null}
      {card.words && <p className="text-[13px] text-pretty">“{card.words}”</p>}
      {card.chips?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {card.chips.map((c) => (
            <span key={c} className="rounded-full bg-muted px-2.5 py-1 text-[12px] text-muted-foreground">
              {c}
            </span>
          ))}
        </div>
      ) : null}
      <div>
        <p className="mb-2 text-[12px] font-medium text-muted-foreground">What came out</p>
        <Large media={card.output} label={card.caption} />
      </div>
      {onUse && (
        <Button onClick={onUse} className="h-11 self-start rounded-full px-5">
          Use this example
        </Button>
      )}
    </div>
  );
}

/** Everything an example was made from, to look at: a bottom sheet on a phone, a dialog on a desktop. */
export function ExampleSheet({ card, onOpenChange, onUse }: { card: ExampleCard | null; onOpenChange: (open: boolean) => void; onUse?: () => void }) {
  const mobile = useIsMobile();
  const open = !!card;
  if (mobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[88svh] gap-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
          <SheetHeader className="pr-12 pb-2">
            <SheetTitle className="font-sans text-[15px] font-semibold">{card?.caption ?? "Example"}</SheetTitle>
            <SheetDescription className="sr-only">What went in and what came out</SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto px-4 pb-4">{card && <SheetBody card={card} onUse={onUse} />}</div>
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88svh] overflow-y-auto sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>{card?.caption ?? "Example"}</DialogTitle>
          <DialogDescription className="sr-only">What went in and what came out</DialogDescription>
        </DialogHeader>
        {card && <SheetBody card={card} onUse={onUse} />}
      </DialogContent>
    </Dialog>
  );
}

/** Once there are results: "Examples" by the composer opens the same cards in a sheet. */
export function ExamplesButton({ cards, activeId, onPick, className }: { cards: ExampleCard[]; activeId?: string; onPick: ExamplePick; className?: string }) {
  const [open, setOpen] = useState(false);
  const [looking, setLooking] = useState<ExampleCard | null>(null);
  const mobile = useIsMobile();
  if (!cards.length) return null;
  const pick: ExamplePick = (c) => {
    if (c.load.via === "look") return setLooking(c);
    setOpen(false);
    onPick(c);
  };
  const grid = <ExampleGrid cards={cards} activeId={activeId} onPick={pick} className={cards.length > 1 ? "sm:grid-cols-2" : undefined} />;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "relative inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors before:absolute before:-inset-1 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          className,
        )}
      >
        <Sparkles className="size-3.5" />
        Examples
      </button>
      {mobile ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="max-h-[88svh] gap-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
            <SheetHeader className="pr-12 pb-2">
              <SheetTitle className="font-sans text-[15px] font-semibold">Start from an example</SheetTitle>
              <SheetDescription className="sr-only">Tap one to load it into the composer</SheetDescription>
            </SheetHeader>
            <div className="overflow-y-auto px-4 pb-4">{grid}</div>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-h-[88svh] overflow-y-auto sm:max-w-[720px]">
            <DialogHeader>
              <DialogTitle>Start from an example</DialogTitle>
              <DialogDescription>Tap one to load it into the composer.</DialogDescription>
            </DialogHeader>
            {grid}
          </DialogContent>
        </Dialog>
      )}
      <ExampleSheet card={looking} onOpenChange={(o) => !o && setLooking(null)} />
    </>
  );
}
