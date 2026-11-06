import { changeLine } from "@/lib/catalog/made";
import type { Generation } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

/**
 * Under a finished run (the feed card, the run details): each setting it was made at differently from what it asked, in
 * one small muted line ("Quality: asked for 2K · made at 1080p (the most this model makes)"). Nothing when it made
 * what it asked.
 */
export function MadeNote({ g, className }: { g: Pick<Generation, "made">; className?: string }) {
  const changes = g.made?.changes ?? [];
  if (!changes.length) return null;
  return (
    <ul className={cn("space-y-0.5 text-[11.5px] leading-snug text-pretty text-muted-foreground", className)} aria-label="Made differently from what was asked">
      {changes.map((c) => (
        <li key={c.setting + c.label}>{changeLine(c)}</li>
      ))}
    </ul>
  );
}
