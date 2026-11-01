"use client";

import { Cloud, Cpu, Info, Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { memo, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useProgressive } from "@/components/use-progressive";
import { useToday } from "@/hooks/use-today";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import Link from "next/link";
import { IntentLink } from "@/components/intent-link";
import { useEngine, useHydrated, useModelAccess, useStatus } from "@/lib/api";
import { providerEngine } from "@/lib/catalog/engines";
import { PROVIDER_NAME } from "@/lib/licences";
import { offered } from "@/lib/model-access";
import type { Engine, MediaKind, ProviderId } from "@/lib/catalog/types";
import { enginesLabel, modelSearchText, rowPriceOn, type ModelRow } from "@/lib/model-rows";
import { cn } from "@/lib/utils";

const KIND_LABEL: Partial<Record<MediaKind, string>> = { image: "Image", video: "Video", audio: "Audio", text: "Text", model3d: "3D" };

const chip = (active: boolean) =>
  cn(
    "h-8 shrink-0 rounded-full px-3 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent",
    active && "bg-secondary text-foreground",
  );

/**
 * Where a model runs, behind a small button: the providers by name, and the endpoints and id under "Technical details"
 * (long, and only some people need them). `only`: the install runs one engine, so only its routes count.
 */
function RouteDetails({ row, only }: { row: ModelRow; only?: Engine }) {
  const routes = only ? row.routes.filter((r) => providerEngine(r.slice(0, r.indexOf(":")) as ProviderId) === only) : row.routes;
  const providers = [...new Set(routes.map((r) => r.slice(0, r.indexOf(":"))))].map((p) => PROVIDER_NAME[p] ?? p);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[12px] whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Info className="size-3.5" />
          {/* The name starts with the visible text ("3 routes"), so speech users can say it. */}
          <span className="max-sm:sr-only">
            {routes.length} route{routes.length === 1 ? "" : "s"}
          </span>
          <span className="sr-only">: where {row.name} runs</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={12} className="w-[min(92vw,420px)] p-3">
        <p className="text-[12px] font-medium">{row.name} runs on</p>
        <p className="mt-1 text-[13px]">{providers.join(" · ")}</p>
        {row.href && (
          <IntentLink href={row.href} className="mt-2 inline-block text-[13px] font-medium text-brand-text underline-offset-2 hover:underline">
            Open it
          </IntentLink>
        )}
        <details className="mt-2">
          <summary className="cursor-pointer text-[12px] text-muted-foreground hover:text-foreground">Technical details</summary>
          <ul className="mt-1.5 space-y-1">
            {routes.map((r) => (
              <li key={r} className="font-mono text-[11px] break-all text-muted-foreground">
                {r}
              </li>
            ))}
          </ul>
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">id {row.id}</p>
        </details>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One model; `today` (the browser's day, null while the page prerenders) picks a launch price or the list price. `only`:
 * the install runs one engine (a visitor's is open), so a Fuobe Original shows that engine alone.
 */
const Row = memo(function Row({ m, today, only }: { m: ModelRow; today: number | null; only?: Engine }) {
  const price = rowPriceOn(m, today, only);
  const engines = only ? m.engines.filter((e) => e === only) : m.engines;
  return (
    <tr className="align-top hover:bg-accent/50">
      <td className="px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-1.5 font-medium">
          {engines.includes("open") && <Cpu className="size-3.5 shrink-0 md:hidden" aria-label="Open source" />}
          {engines.includes("cloud") && <Cloud className="size-3.5 shrink-0 md:hidden" aria-label="Cloud" />}
          {m.href ? (
            <IntentLink href={m.href} className="underline-offset-2 hover:text-brand-text hover:underline">
              {m.name}
            </IntentLink>
          ) : (
            m.name
          )}
          {m.badges.map((b) => (
            <span
              key={b}
              className={cn(
                "rounded-[4px] bg-secondary px-1 text-[10px] leading-4 font-medium text-secondary-foreground",
                b === "New" && "bg-highlight text-highlight-foreground",
                b === "Top" && "bg-brand-faint text-brand-text",
              )}
            >
              {b}
            </span>
          ))}
        </div>
        <div className="text-[12px] text-muted-foreground">
          {m.vendor} — {m.tagline}
        </div>
        {m.note && <div className="mt-0.5 text-[11px] text-muted-foreground">{m.note}</div>}
        <div className="mt-1 text-[11px] text-muted-foreground md:hidden">
          {price && <span className="font-mono text-muted-foreground sm:hidden">{price} · </span>}
          {m.ops.join(" · ")}
        </div>
      </td>
      <td className="hidden px-4 py-3 whitespace-nowrap md:table-cell">
        <span className="inline-flex items-center gap-1">
          {engines.includes("open") && <Cpu className="size-3.5" />}
          {engines.includes("cloud") && <Cloud className="size-3.5" />}
          {enginesLabel(engines)}
        </span>
      </td>
      <td className="hidden px-4 py-3 text-[12px] text-muted-foreground md:table-cell">{m.ops.join(" · ")}</td>
      <td className="hidden px-4 py-3 font-mono text-[12px] whitespace-nowrap sm:table-cell">{price}</td>
      <td className="px-2 py-2.5 text-right">
        <RouteDetails row={m} only={only} />
      </td>
    </tr>
  );
});

/**
 * The page's line under its title, by the install's engine mode once it is known (a visitor's is open source only:
 * the cloud runs on the owner's keys, which a visitor never uses).
 */
export function ModelsIntro() {
  const hydrated = useHydrated();
  const mode = useStatus().data?.engineMode;
  const known = hydrated ? mode : undefined;
  return (
    <>
      Every model Fuobe can drive.
      {known &&
        (known === "open"
          ? " On this studio, each runs as a ComfyUI workflow on your own GPU."
          : known === "cloud"
            ? " On this studio, each runs through your fal.ai or Replicate key."
            : " Cloud models run through your fal.ai or Replicate key; open-source models run as ComfyUI workflows on your own GPU.")}
      {known && " Click a name to open it where it runs."}
    </>
  );
}

/**
 * A link's ?q= (the ⌘K palette's "open this model" for models no studio offers) fills the search.
 * It reads the URL, so it sits under its own Suspense: the table itself stays in the static page.
 */
function UrlQuery({ onQuery }: { onQuery: (q: string) => void }) {
  const q = useSearchParams().get("q");
  useEffect(() => {
    if (q !== null) onQuery(q);
  }, [q, onQuery]);
  return null;
}

export function ModelsTable({ models }: { models: ModelRow[] }) {
  const [engineChoice, setEngine] = useState<Engine | "all">("all");
  const [, , mode] = useEngine();
  const engine: Engine | "all" = mode === "both" ? engineChoice : mode;
  const [kind, setKind] = useState<MediaKind | "all">("all");
  const [q, setQ] = useState("");
  const term = useDeferredValue(q.trim().toLowerCase());
  const today = useToday();
  // Settings → Models & licences: what is switched off leaves the list (an Original stays for the engine still on).
  const access = useModelAccess();
  const on = useMemo(() => (access ? models.filter((m) => offered(access, m.id)) : models), [models, access]);
  const switchedOff = models.length - on.length;
  const index = useMemo(() => on.map((m) => [m, modelSearchText(m)] as const), [on]);
  const kinds = useMemo(() => [...new Set(models.map((m) => m.kind))], [models]);
  // What the search can reach: the engine's models (a visitor's engine is open source only).
  const searchable = useMemo(() => index.filter(([m]) => engine === "all" || (m.engines.includes(engine) && offered(access, m.id, engine))), [index, engine, access]);
  const list = useMemo(() => searchable.filter(([m, text]) => (kind === "all" || m.kind === kind) && (!term || text.includes(term))).map(([m]) => m), [searchable, kind, term]);
  const only = mode === "both" ? undefined : mode;
  // The Cloud list has the Fuobe Originals too (they run on both engines), so it says how many: Home and Project
  // status count them once, under open source.
  const originals = engine === "cloud" ? list.filter((m) => m.vendor === "Fuobe Original").length : 0;
  // 40 rows in the page's HTML, the rest as you scroll.
  const { shown, hasMore, moreFrom, sentinel, left } = useProgressive(list.length, `${engine}|${kind}|${term}`, 40, 60);
  const rows = useRef<HTMLTableSectionElement>(null);
  return (
    <div className="space-y-4">
      <Suspense fallback={null}>
        <UrlQuery onQuery={setQ} />
      </Suspense>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative w-full lg:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              // Typing takes over from the link: drop its ?q=, so the same link fills the search again later.
              if (new URLSearchParams(window.location.search).has("q")) {
                const url = new URL(window.location.href);
                url.searchParams.delete("q");
                window.history.replaceState(null, "", url);
              }
            }}
            placeholder={`Search ${searchable.length} ${engine === "open" ? "open-source " : engine === "cloud" ? "cloud " : ""}models`}
            aria-label="Search models"
            className="h-9 w-full rounded-full border bg-background pr-3 pl-9 text-[14px] outline-none placeholder:text-subtle-foreground focus:border-primary focus:ring-4 focus:ring-brand-faint"
          />
        </div>
        <div className="scrollbar-none -mx-1 flex min-w-0 items-center gap-1 overflow-x-auto px-1">
          {only ? (
            // One engine: nothing to choose, so a label rather than a button that does nothing.
            <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 text-[13px] font-medium whitespace-nowrap">
              {only === "open" ? <Cpu className="size-3.5" aria-hidden /> : <Cloud className="size-3.5" aria-hidden />}
              {only === "open" ? "Open source" : "Cloud"}
            </span>
          ) : (
            (["all", "cloud", "open"] as const).map((e) => (
              <button key={e} type="button" aria-pressed={engine === e} className={chip(engine === e)} onClick={() => setEngine(e)}>
                {e === "all" ? "All engines" : e === "cloud" ? "Cloud" : "Open source"}
              </button>
            ))
          )}
          <span className="mx-1 h-5 w-px shrink-0 bg-border" />
          {(["all", ...kinds] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} className={chip(kind === k)} onClick={() => setKind(k)}>
              {k === "all" ? "All media" : (KIND_LABEL[k] ?? k)}
            </button>
          ))}
        </div>
        <span className="text-[13px] whitespace-nowrap text-muted-foreground tabular-nums lg:ml-auto" aria-live="polite">
          {list.length} models{originals > 0 && `, ${originals} of them Fuobe Originals`}
        </span>
      </div>
      {switchedOff > 0 && (
        <p className="text-[13px] text-muted-foreground">
          {switchedOff} {switchedOff === 1 ? "model is" : "models are"} turned off in{" "}
          <Link href="/settings/models" className="text-brand-text underline-offset-2 hover:underline">
            Settings → Models &amp; licences
          </Link>
          .
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-muted/50 text-[12px] text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 font-medium sm:px-4">Model</th>
              <th className="hidden px-4 py-2.5 font-medium md:table-cell">Engine</th>
              <th className="hidden px-4 py-2.5 font-medium md:table-cell">Can do</th>
              <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Price</th>
              <th className="px-2 py-2.5">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody ref={rows} className="divide-y">
            {list.slice(0, shown).map((m) => (
              <Row key={m.id} m={m} today={today} only={only} />
            ))}
          </tbody>
        </table>
        {hasMore && (
          <div className="flex justify-center border-t p-3">
            <button
              ref={sentinel}
              type="button"
              onClick={(e) => moreFrom(e, rows.current)}
              className="h-9 rounded-full border bg-background px-4 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Show more · {left} left
            </button>
          </div>
        )}
        {!list.length && <p className="py-12 text-center text-[13px] text-muted-foreground">No models match{term ? ` “${q.trim()}”` : " these filters"}.</p>}
      </div>
    </div>
  );
}
