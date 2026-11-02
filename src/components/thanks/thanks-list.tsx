"use client";

import { ExternalLink, Search, X } from "lucide-react";
import { memo, useDeferredValue, useMemo, useState } from "react";
import { searchText, type ThanksGroup, type ThanksRow } from "@/lib/thanks";

/**
 * Thanks & licences' list: a search box, chips that jump to each group, then the groups, one row each (name and maker,
 * what Fuobe uses it for, its licence and any condition). A search keeps the rows that have every word typed.
 */
export function ThanksList({ groups }: { groups: ThanksGroup[] }) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const index = useMemo(() => groups.map((g) => ({ ...g, rows: g.rows.map((r) => ({ row: r, text: searchText(r) })) })), [groups]);
  const shown = useMemo(() => {
    const words = deferred.toLowerCase().split(/\s+/).filter(Boolean);
    return index.map((g) => ({ ...g, rows: words.length ? g.rows.filter((r) => words.every((w) => r.text.includes(w))) : g.rows }));
  }, [index, deferred]);
  const any = shown.some((g) => g.rows.length);

  return (
    <>
      <div className="sticky top-12 z-10 -mx-4 border-b bg-background/90 px-4 py-2 backdrop-blur sm:-mx-8 sm:px-8 md:top-0">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <label className="relative block min-w-0 lg:w-80 lg:shrink-0">
            <span className="sr-only">Search models, LoRAs, node packs and libraries</span>
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, maker or licence"
              className="h-11 w-full min-w-0 rounded-full border bg-background pr-11 pl-10 text-[14px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear the search"
                className="absolute top-1/2 right-0 grid size-11 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <X className="size-4" />
              </button>
            )}
          </label>
          <nav aria-label="Jump to a group" className="-mx-4 min-w-0 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-8 sm:px-8 lg:mx-0 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
            <ul className="flex w-max gap-1.5 lg:w-auto lg:flex-wrap">
              {shown
                .filter((g) => g.rows.length)
                .map((g) => (
                  <li key={g.id}>
                    <a
                      href={`#thanks-${g.id}`}
                      onClick={(e) => {
                        const to = document.getElementById(`thanks-${g.id}`);
                        if (!to) return;
                        e.preventDefault();
                        to.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
                        history.replaceState(null, "", `#thanks-${g.id}`);
                      }}
                      className="inline-flex h-11 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:h-9"
                    >
                      {g.title}
                      <span className="text-muted-foreground tabular-nums">{g.rows.length}</span>
                    </a>
                  </li>
                ))}
            </ul>
          </nav>
        </div>
      </div>

      {shown.map((g) =>
        g.rows.length ? (
          <section
            key={g.id}
            id={`thanks-${g.id}`}
            aria-labelledby={`thanks-${g.id}-title`}
            className="scroll-mt-40 pt-8 md:scroll-mt-28"
          >
            <h2 id={`thanks-${g.id}-title`} className="flex items-baseline gap-2 border-b pb-2 font-heading text-[24px] leading-tight">
              {g.title}
              <span className="font-sans text-[13px] text-muted-foreground tabular-nums">{g.rows.length}</span>
            </h2>
            <ul className="divide-y">
              {g.rows.map(({ row }) => (
                <Row key={row.id} row={row} />
              ))}
            </ul>
          </section>
        ) : null,
      )}
      {!any && (
        <p role="status" className="py-12 text-center text-[14px] text-muted-foreground">
          Nothing matches that search.
        </p>
      )}
    </>
  );
}

const LINK =
  "inline-flex min-h-11 items-center gap-1 text-[13px] font-medium [overflow-wrap:anywhere] text-brand-text underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:min-h-0";

const Row = memo(function Row({ row }: { row: ThanksRow }) {
  return (
    <li className="grid min-w-0 gap-x-6 gap-y-1 py-3 sm:grid-cols-[1fr_1.3fr_1fr] [&>*]:min-w-0">
      <div>
        <p className="text-[14px] font-medium [overflow-wrap:anywhere]">{row.name}</p>
        {row.maker && <p className="text-[12px] text-muted-foreground [overflow-wrap:anywhere]">{row.maker}</p>}
      </div>
      <p className="text-[13px] leading-snug text-pretty text-muted-foreground">{row.use}</p>
      <div>
        <p className="flex flex-wrap items-center gap-x-3">
          {row.licences.map((l) => {
            const href = l.url ?? row.url;
            return href ? (
              <a key={l.name} href={href} target="_blank" rel="noreferrer" className={LINK}>
                {l.name}
                <ExternalLink className="size-3 shrink-0 opacity-70" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              <span key={l.name} className="text-[13px] font-medium [overflow-wrap:anywhere]">
                {l.name}
              </span>
            );
          })}
        </p>
        {row.condition && <p className="text-[12px] leading-snug text-pretty text-foreground/80">{row.condition}</p>}
        {row.credits?.map((c) => (
          <p key={c} className="mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11.5px] text-muted-foreground">
            Credit: {c}
          </p>
        ))}
      </div>
    </li>
  );
});
