import type { Generation } from "@/lib/catalog/types";
import { autoLine } from "@/lib/auto-image";
import { AddAutoPattern } from "@/components/add-auto-pattern";
import { cn } from "@/lib/utils";

type NoteRun = Pick<Generation, "declinedCards" | "status" | "modelId" | "modelName"> & {
  request: Pick<Generation["request"], "notice" | "modelId" | "auto" | "prompt">;
};

/**
 * Under a run (the feed card, the run details): what made a run of Auto ("Auto · made
 * with Krea 2 Realism · Ideogram 4 declined this one"), what changed while it ran (its notice: "Made with Qwen-Image 2.1 ·
 * Ideogram 4 declined this one"), and, for the owner's eyes only, what Ideogram 4 returned in place of a picture, for
 * which words. A setting a model makes differently is said before the run, where it can still be changed; after the run
 * the views show only the value it was made at (shownSettings), never a value the studio didn't offer.
 */
export function MadeNote({ g, className }: { g: NoteRun; className?: string }) {
  const auto = autoLine(g);
  const notice = g.request.notice?.trim();
  if (!auto && !notice && !g.declinedCards?.length) return null;
  return (
    <ul className={cn("space-y-0.5 text-[11.5px] leading-snug text-pretty text-muted-foreground", className)} aria-label="How this run was made">
      {auto && <li>{auto}</li>}
      {notice && <li>{notice}</li>}
      {!!g.declinedCards?.length && (
        <li>
          <DeclinedCards cards={g.declinedCards} words={g.request.prompt} />
        </li>
      )}
    </ul>
  );
}

/**
 * The owner's line on a run Ideogram 4 declined: a link to each picture it returned in place of one, with the two
 * measures that took it for the "blocked" card, so a false catch can be told from the card; the words it declined
 * (`words`, where the view doesn't show them already); and "Add a pattern", which sends such words to Krea 2 Realism
 * next time Auto picks (Settings → Auto image model).
 */
export function DeclinedCards({ cards, words, className }: { cards: NonNullable<Generation["declinedCards"]>; words?: string; className?: string }) {
  const said = words?.trim();
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
      {said && <span className="block break-words">Words: “{said.length > 400 ? `${said.slice(0, 400)}…` : said}”</span>}
      <AddAutoPattern />
    </span>
  );
}
