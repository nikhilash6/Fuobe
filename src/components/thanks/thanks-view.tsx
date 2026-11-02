import type { Thanks } from "@/lib/thanks";
import { ThanksList } from "./thanks-list";

/**
 * Thanks & licences: the names some licences ask Fuobe to show, then every model, LoRA, node pack and library in groups
 * (ThanksList, which searches them).
 */
export function ThanksView({ thanks }: { thanks: Thanks }) {
  return (
    <div data-thanks className="min-w-0">
      {thanks.credits.length > 0 && (
        <section aria-labelledby="thanks-credits" className="mb-8 rounded-2xl border bg-muted/30 p-4 sm:p-6">
          <h2 id="thanks-credits" className="text-[13px] font-semibold tracking-wide text-muted-foreground uppercase">
            Credits
          </h2>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {thanks.credits.map((c) => (
              <li key={c.text} className="min-w-0">
                <p className="font-heading text-[22px] leading-tight [overflow-wrap:anywhere]">{c.text}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-pretty text-muted-foreground">{c.names.join(", ")}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ThanksList groups={thanks.groups} />

      <p className="mt-10 max-w-2xl text-[12px] leading-relaxed text-pretty text-muted-foreground">
        This list is a guide, not legal advice. Read a model&apos;s own licence before you sell what you make with it.
      </p>
    </div>
  );
}
