import { changeLine } from "@/lib/catalog/made";
import type { Generation } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

/**
 * Under a run (the feed card, the run details): each setting it was made at differently from what it asked, in one small
 * muted line ("Quality: asked for 2K · made at 1080p (the most this model makes)"), what changed while it ran (its
 * notice: "Made with Qwen-Image 2.1 · Ideogram 4 declined this one"), and, for the owner's eyes only, what Ideogram 4
 * returned in place of a picture. Nothing when it made what it asked.
 */
export function MadeNote({ g, className }: { g: Pick<Generation, "made" | "declinedCards"> & { request: Pick<Generation["request"], "notice"> }; className?: string }) {
  const changes = g.made?.changes ?? [];
  const notice = g.request.notice?.trim();
  if (!changes.length && !notice && !g.declinedCards?.length) return null;
  return (
    <ul className={cn("space-y-0.5 text-[11.5px] leading-snug text-pretty text-muted-foreground", className)} aria-label="Made differently from what was asked">
      {changes.map((c) => (
        <li key={c.setting + c.label}>{changeLine(c)}</li>
      ))}
      {notice && <li>{notice}</li>}
      {!!g.declinedCards?.length && (
        <li>
          <DeclinedCards cards={g.declinedCards} />
        </li>
      )}
    </ul>
  );
}

/**
 * The owner's line on a run Ideogram 4 declined: a link to each picture it returned in place of one, with the two
 * measures that took it for the "blocked" card, so a false catch can be told from the card.
 */
export function DeclinedCards({ cards, className }: { cards: NonNullable<Generation["declinedCards"]>; className?: string }) {
  return (
    <span className={className}>
      Ideogram 4 declined: what it returned{" "}
      {cards.map((c, i) => (
        <span key={c.url + i}>
          {i > 0 && ", "}
          <a href={c.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
            {cards.length > 1 ? `picture ${i + 1}` : "picture"}
          </a>{" "}
          (colour spread {c.spread}, {Math.round(c.grey * 100)}% grey)
        </span>
      ))}
    </span>
  );
}
