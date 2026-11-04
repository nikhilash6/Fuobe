import { ArrowRight, ChevronDown, ExternalLink } from "lucide-react";
import type { Thanks, ThanksLicence, ThanksMaker, ThanksProject } from "@/lib/thanks";
import { ThanksList } from "./thanks-list";

/** Model makers shown before "Show more". */
const MAKERS_SHOWN = 12;

const LINK =
  "inline-flex min-h-11 items-center gap-1 text-[13px] font-medium text-brand-text underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:min-h-0";
const SUMMARY =
  "inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-md text-[13px] font-medium text-brand-text select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:min-h-8 [&::-webkit-details-marker]:hidden";

function Out({ href, children, className = LINK }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
      <ExternalLink className="size-3 shrink-0 opacity-70" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function Licence({ licence }: { licence: ThanksLicence }) {
  return licence.url ? <Out href={licence.url}>{licence.name}</Out> : <span className="text-[13px] font-medium">{licence.name}</span>;
}

/** "In 20 models and tools" with a Show all list, or the one name when there is one. */
function Users({ names }: { names: string[] }) {
  if (names.length === 1) return <p className="mt-1 text-[13px] text-muted-foreground">In {names[0]}</p>;
  return (
    <details className="group mt-1">
      <summary className={SUMMARY}>
        <span className="font-normal text-muted-foreground">In {names.length} models and tools</span>
        <span className="ml-1.5">Show all</span>
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <ul className="mt-2 mb-1 space-y-1.5 border-l pl-3 text-[13px] leading-snug text-pretty text-muted-foreground">
        {names.map((n) => (
          <li key={n} className="[overflow-wrap:anywhere]">
            {n}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Maker({ m }: { m: ThanksMaker }) {
  return (
    <li className="min-w-0">
      <a
        href={`#by-${m.id}`}
        className="group/maker flex h-full min-h-11 items-start justify-between gap-3 rounded-xl border bg-background px-4 py-3 transition-colors hover:border-foreground/25 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="min-w-0">
          <span className="block text-[15px] font-medium [overflow-wrap:anywhere]">{m.name}</span>
          <span className="mt-0.5 block text-[12.5px] leading-snug text-pretty text-muted-foreground">
            {m.models.map((f, i) => (
              <span key={f}>
                {i > 0 && " · "}
                <span className="whitespace-nowrap">{f}</span>
              </span>
            ))}
          </span>
        </span>
        <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[12.5px] whitespace-nowrap text-brand-text tabular-nums">
          {m.count} {m.count === 1 ? "tool" : "tools"}
          <span className="sr-only">, show them below</span>
          <ArrowRight className="size-3.5 transition-transform group-hover/maker:translate-x-0.5" aria-hidden />
        </span>
      </a>
    </li>
  );
}

function Project({ p }: { p: ThanksProject }) {
  return (
    <li className="flex min-w-0 flex-col rounded-xl border bg-background px-4 py-3">
      <Out
        href={p.url}
        className="inline-flex min-h-11 items-center gap-1 self-start text-[15px] font-medium underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:min-h-0"
      >
        {p.name}
      </Out>
      {p.maker && p.maker !== p.name && <p className="text-[12px] text-muted-foreground [overflow-wrap:anywhere]">{p.maker}</p>}
      <p className="mt-1 text-[12.5px] leading-snug text-pretty text-muted-foreground">{p.use}</p>
      {p.licence && (
        <p className="mt-auto pt-1">
          <Licence licence={p.licence} />
        </p>
      )}
    </li>
  );
}

/**
 * Thanks & licences: Built on (ComfyUI first, Hugging Face where the open model files come from, the model makers, and the names
 * some licences ask Fuobe to show), then every model, LoRA, node pack and library in groups (ThanksList, which
 * searches them and filters them by maker).
 */
export function ThanksView({ thanks }: { thanks: Thanks }) {
  const [comfy, ...projects] = thanks.builtOn;
  const shown = thanks.makers.slice(0, MAKERS_SHOWN);
  const more = thanks.makers.slice(MAKERS_SHOWN);
  return (
    <div data-thanks className="min-w-0">
      <section aria-labelledby="thanks-built-on" className="mb-10">
        <h2 id="thanks-built-on" className="border-b pb-2 font-heading text-[24px] leading-tight">
          Built on
        </h2>

        {comfy && (
          <div className="relative mt-3 overflow-hidden rounded-2xl border bg-brand-faint p-5 sm:p-7">
            <p className="text-[12.5px] font-medium text-brand-text">Thank you, {comfy.maker}</p>
            <p className="mt-1 font-heading text-[34px] leading-none sm:text-[44px]">{comfy.name}</p>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-pretty">{comfy.use} It is free and open, and Fuobe would not exist without it.</p>
            <p className="mt-3 flex flex-wrap items-center gap-x-4">
              <Out href={comfy.url}>Its code</Out>
              {comfy.licence && <Licence licence={comfy.licence} />}
            </p>
          </div>
        )}

        {projects.length > 0 && (
          <ul className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Project key={p.id} p={p} />
            ))}
          </ul>
        )}

        {thanks.makers.length > 0 && (
          <div className="mt-8">
            <h3 id="thanks-makers" className="font-heading text-[22px] leading-tight">
              The model makers
            </h3>
            <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-pretty text-muted-foreground">
              The labs and people who publish the open models Fuobe runs. Thank you for sharing them. Tap one to see where Fuobe uses its models.
            </p>
            <ul className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((m) => (
                <Maker key={m.id} m={m} />
              ))}
            </ul>
            {more.length > 0 && (
              <details className="group mt-2.5">
                <summary className={SUMMARY}>
                  Show {more.length} more makers
                  <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <ul className="mt-2.5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {more.map((m) => (
                    <Maker key={m.id} m={m} />
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {thanks.credits.length > 0 && (
          <div className="mt-8">
            <h3 id="thanks-credits" className="font-heading text-[22px] leading-tight">
              Named with thanks
            </h3>
            <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-pretty text-muted-foreground">
              Some licences ask us to show their name, like a &ldquo;Built with&rdquo; line. We&apos;re glad to.
            </p>
            <ul className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {thanks.credits.map((c) => (
                <li key={c.text} className="min-w-0 rounded-xl border bg-background px-4 py-3">
                  <p className="font-heading text-[24px] leading-tight [overflow-wrap:anywhere]">{c.text}</p>
                  <Users names={c.names} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <ThanksList groups={thanks.groups} makers={thanks.makers} />

      <p className="mt-10 max-w-2xl text-[12px] leading-relaxed text-pretty text-muted-foreground">
        This list is a guide, not legal advice. Read a model&apos;s own licence before you sell what you make with it.
      </p>
    </div>
  );
}
