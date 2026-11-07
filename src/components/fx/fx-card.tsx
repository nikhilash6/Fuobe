import { CardPending, IntentLink } from "@/components/intent-link";
import { StudioName } from "@/components/home/home-islands";
import { FxCompare } from "@/components/fx/fx-compare";
import type { FxView } from "@/lib/fx-compare";

/**
 * A Fuobe FX item's card with its before and after (FxCompare) in place of a cover: the same frame, name and line as a
 * studio's card beside it. The focused card's arrow keys move its divider; a finger's tap on the picture shows the
 * other side, and the name opens the page.
 */
export function FxCard({ href, label, line, view, sizes }: { href: string; label: string; line: string; view: FxView; sizes: string }) {
  return (
    <IntentLink href={href} className="group/studio flex min-w-0 flex-col gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="relative isolate block aspect-[4/3] overflow-hidden rounded-lg bg-muted">
        <FxCompare view={view} sizes={sizes} keys className="absolute inset-0" />
        <CardPending />
      </span>
      <StudioName label={label} line={line} />
    </IntentLink>
  );
}
