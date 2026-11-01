"use client";

import { Ban, CheckCircle2, ExternalLink, Globe, Info, Search } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { FLAG_LABEL, kindLabel, type LicenceFlag, type LicenceList, type LicenceRow } from "@/lib/licences";
import { cn } from "@/lib/utils";

type Filter = "all" | "clear" | LicenceFlag;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "clear", label: "Commercial use OK" },
  { value: "conditions", label: FLAG_LABEL.conditions },
  { value: "non-commercial", label: FLAG_LABEL["non-commercial"] },
  { value: "territory", label: FLAG_LABEL.territory },
];

const chip = (active: boolean) =>
  cn(
    "h-8 shrink-0 rounded-full px-3 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent",
    active && "bg-secondary text-foreground",
  );

const FLAG_STYLE: Record<LicenceFlag, { icon: typeof Ban; tone: string; fill: string }> = {
  "non-commercial": { icon: Ban, tone: "text-destructive", fill: "bg-destructive/10 dark:bg-destructive/20" },
  territory: { icon: Globe, tone: "text-warning", fill: "bg-warning/15" },
  conditions: { icon: Info, tone: "text-muted-foreground", fill: "bg-secondary" },
};

const badge = "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium whitespace-nowrap text-foreground [&>svg]:size-3";

function FlagBadge({ row }: { row: LicenceRow }) {
  if (!row.flags.length)
    return (
      <span className={cn(badge, "bg-success/12")}>
        <CheckCircle2 className="text-success" aria-hidden /> Commercial use OK
      </span>
    );
  return (
    <>
      {row.flags.map((f) => {
        const { icon: Icon, tone, fill } = FLAG_STYLE[f];
        return (
          <span key={f} className={cn(badge, fill)}>
            <Icon className={tone} aria-hidden /> {f === "territory" && row.excludes ? `Not in ${row.excludes}` : FLAG_LABEL[f]}
          </span>
        );
      })}
    </>
  );
}

function Row({ row }: { row: LicenceRow }) {
  return (
    <li className="flex flex-col gap-1.5 py-3.5 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium [overflow-wrap:anywhere]">{row.name}</p>
        <p className="text-[12px] text-muted-foreground">
          {row.inCatalog ? `${row.by} · ` : ""}
          {kindLabel(row.kind)}
        </p>
        {row.licences.map((l, i) => (
          <p key={l} className="mt-1 text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {row.links[i] ? (
              <a href={row.links[i] ?? undefined} target="_blank" rel="noreferrer" className="underline-offset-2 hover:text-foreground hover:underline">
                {l}
                <ExternalLink className="ml-1 inline size-3 align-[-1px]" aria-hidden />
                <span className="sr-only"> (the licence, in a new tab)</span>
              </a>
            ) : (
              l
            )}
          </p>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 sm:max-w-[45%] sm:justify-end">
        <FlagBadge row={row} />
        {row.notices.map((n) => (
          <span key={n} className="inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium whitespace-nowrap">
            Shows “{n}”
          </span>
        ))}
      </div>
    </li>
  );
}

function matches(row: LicenceRow, filter: Filter, q: string): boolean {
  if (filter === "clear" ? row.flags.length > 0 : filter !== "all" && !row.flags.includes(filter)) return false;
  if (!q) return true;
  return [row.name, row.by, row.kind, ...row.licences].some((s) => s.toLowerCase().includes(q));
}

/** The licence list with its filters: what's free to use commercially, and what isn't. */
export function LicencesView({ list }: { list: LicenceList }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());
  const shown = list.rows.filter((r) => matches(r, filter, q));
  const catalog = shown.filter((r) => r.inCatalog);
  const library = shown.filter((r) => !r.inCatalog);
  const count = (f: Filter) => (f === "all" ? list.counts.all : list.counts[f]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative w-full lg:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models or licences"
            aria-label="Search models or licences"
            className="h-9 w-full rounded-full border bg-background pr-3 pl-9 text-[14px] outline-none placeholder:text-subtle-foreground focus:border-primary focus:ring-4 focus:ring-brand-faint"
          />
        </div>
        <div role="group" aria-label="Filter by licence" className="flex min-w-0 flex-wrap items-center gap-1">
          {FILTERS.map((f) => (
            <button key={f.value} type="button" aria-pressed={filter === f.value} className={chip(filter === f.value)} onClick={() => setFilter(f.value)}>
              {f.label} <span className="ml-0.5 tabular-nums opacity-70">{count(f.value)}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {shown.length} models shown
      </p>
      {!shown.length && <p className="py-8 text-center text-[13px] text-muted-foreground">Nothing matches. Try another word or filter.</p>}

      {catalog.length > 0 && (
        <section aria-labelledby="lic-models">
          <h3 id="lic-models" className="text-[15px] font-semibold">
            Open models in Fuobe&apos;s studios <span className="font-normal text-muted-foreground tabular-nums">· {catalog.length}</span>
          </h3>
          <ul className="divide-y">
            {catalog.map((r) => (
              <Row key={r.id} row={r} />
            ))}
          </ul>
        </section>
      )}
      {library.length > 0 && (
        <section aria-labelledby="lic-library" className="pt-4">
          <h3 id="lic-library" className="text-[15px] font-semibold">
            Also in the workflow library <span className="font-normal text-muted-foreground tabular-nums">· {library.length}</span>
          </h3>
          <p className="mt-1 text-[12px] text-muted-foreground">Workflows ready on your ComfyUI that no studio runs yet, or alternatives to the ones above.</p>
          <ul className="divide-y">
            {library.map((r) => (
              <Row key={r.id} row={r} />
            ))}
          </ul>
        </section>
      )}

      {filter === "all" && !q && list.noWeights.length > 0 && (
        <p className="border-t pt-4 text-[12px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">No model weights:</span> {list.noWeights.join(", ")}
          {list.noWeightsLibrary > 0 ? `, and ${list.noWeightsLibrary} more library workflows` : ""}. They run on ComfyUI&apos;s own nodes (GPL-3.0, like ComfyUI) and
          FFmpeg.
        </p>
      )}
    </div>
  );
}
