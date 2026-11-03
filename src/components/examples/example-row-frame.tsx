import type { ExampleCard, ExampleRowData } from "@/lib/examples/types";
import { cn } from "@/lib/utils";

/**
 * The frame of a row of example cards, shared by the row and by its skeleton so the two always take the same place:
 * the space above it, its heading on the cards' left edge, and the cards' columns and width. Kept free of the cards'
 * code (and the clip player it brings): a studio page draws the skeleton before that chunk arrives.
 */

/**
 * How a row sits on its page:
 * - "column": under a studio's composer. The row fills the composer's column (its caller gives it the composer's
 *   width), so the heading and the cards line up with the composer's edges.
 * - "centred": a section of its own on a wider page. One to three cards stay centred at a card's comfortable width.
 */
export type RowLayout = "column" | "centred";

/** A card's shape: 4:3, or 3:4 on the vertical studios. */
export type ExampleAspect = "4/3" | "3/4";

/** The cards' columns: two across a phone, up to four across a larger screen. */
export function rowColumns(count: number): string {
  if (count === 1) return "grid-cols-1";
  return cn("grid-cols-2", count === 3 ? "sm:grid-cols-3" : count > 3 && "sm:grid-cols-4");
}

/** The cards' width: one card is never wider than 360 px; a centred row of two or three keeps them card-sized. */
export function rowWidth(count: number, layout: RowLayout = "centred"): string | undefined {
  if (count === 1) return cn("max-w-[360px]", layout === "centred" && "mx-auto");
  if (layout === "column") return undefined;
  if (count === 2) return "mx-auto max-w-[520px]";
  if (count === 3) return "mx-auto max-w-[760px]";
  return undefined;
}

/** The row's own box: a centred row is at most 1000 px across its page; a column row takes its column's width. */
export const rowSection = (layout: RowLayout = "centred") => cn("w-full", layout === "centred" && "mx-auto max-w-[1000px]");

/** The row's heading ("Start from an example", "More to try"): a section title on the cards' left edge. */
export const ROW_HEADING = "mb-4 text-left text-[15px] leading-6 font-medium text-foreground";

/** The gap between the cards. */
export const ROW_GAP = "gap-3 sm:gap-4";

/** A line of text in a card's skeleton: the line's own height, with a bar in it. */
function Line({ h, bar, w }: { h: string; bar: string; w: string }) {
  return (
    <span className={cn("flex items-center", h)}>
      <span className={cn("rounded-full bg-muted", bar, w)} />
    </span>
  );
}

/** A card's skeleton: its picture, then the lines it has (its title, its line, its words, its settings). */
function CardSkeleton({ card, aspect }: { card: ExampleCard; aspect: ExampleAspect }) {
  return (
    <div data-example-skeleton className="min-w-0">
      <div className={cn("skeleton-sweep animate-skeleton rounded-xl bg-muted", aspect === "3/4" ? "aspect-[3/4]" : "aspect-[4/3]")} />
      <div className="mt-2 flex flex-col gap-1">
        {card.title && <Line h="h-[18px]" bar="h-3" w="w-4/5" />}
        <span className="flex flex-col">
          <Line h="h-[18px]" bar="h-3" w={card.title ? "w-11/12" : "w-full"} />
          {!card.title && <Line h="h-[18px]" bar="h-3" w="w-1/2" />}
        </span>
        {card.words && (
          <span className="flex flex-col">
            <Line h="h-[16.5px]" bar="h-2.5" w="w-full" />
            <Line h="h-[16.5px]" bar="h-2.5" w="w-2/3" />
          </span>
        )}
        {card.chips?.length ? <span className="h-5 w-9 rounded-full bg-muted" /> : null}
      </div>
    </div>
  );
}

/**
 * The row while its cards' code loads: the same heading, and a skeleton of each card (its picture and the lines it will
 * have) in the cards' own grid, so nothing moves when they arrive.
 */
export function ExampleRowSkeleton({
  row,
  aspect = "4/3",
  layout = "centred",
  className,
}: {
  row: ExampleRowData;
  aspect?: ExampleAspect;
  layout?: RowLayout;
  className?: string;
}) {
  const n = row.cards.length;
  if (!n) return null;
  return (
    <section aria-busy="true" aria-label={row.heading} data-examples-loading className={cn(rowSection(layout), className)}>
      <div className={rowWidth(n, layout)}>
        <p aria-hidden className={ROW_HEADING}>
          {row.heading}
        </p>
        <div aria-hidden className={cn("grid", ROW_GAP, rowColumns(n))}>
          {row.cards.map((c) => (
            <CardSkeleton key={c.id} card={c} aspect={aspect} />
          ))}
        </div>
      </div>
    </section>
  );
}
