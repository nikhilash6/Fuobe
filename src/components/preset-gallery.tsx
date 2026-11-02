"use client";

import Link from "next/link";
import { Cloud, Cpu, Lock, Search, Sparkles, X } from "lucide-react";
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { CardPending, IntentLink } from "@/components/intent-link";
import { PRESET_ICONS } from "@/components/preset-icons";
import { PresetPreview, usePreviewPlayback } from "@/components/preset-preview";
import { GALLERY_GRID } from "@/components/skeletons";
import { useProgressive } from "@/components/use-progressive";
import { CardChip, badgeKey, parseBadgeKey } from "@/components/gpu/readiness-chip";
import { useGpuBadges } from "@/hooks/use-gpu";
import { useEngineMode, useViewer } from "@/lib/api";
import { matchesSearch, previewFlip, readMoreTap, searchText, TAP_TO_READ, type PresetCardData } from "@/lib/preset-cards";
import { cn } from "@/lib/utils";

/** A tiny label shown on hover/focus (CSS only: a gallery has hundreds of these). */
function EngineChip({ engine }: { engine: "cloud" | "open" }) {
  const label = engine === "cloud" ? "Runs on cloud models" : "Runs on open-source models";
  const Icon = engine === "cloud" ? Cloud : Cpu;
  return (
    <span role="img" aria-label={label} className="group/eng pointer-events-auto relative grid size-5 place-items-center rounded-full bg-black/35 text-white">
      <Icon className="size-3" />
      <span
        aria-hidden
        className="pointer-events-none absolute right-0 bottom-full z-10 mb-1.5 rounded-md bg-tooltip px-2 py-1 text-[11px] whitespace-nowrap text-tooltip-foreground opacity-0 shadow-soft transition-opacity group-hover/eng:opacity-100"
      >
        {engine === "cloud" ? "Cloud" : "Open source"}
      </span>
    </span>
  );
}

export const PresetCard = memo(function PresetCard({
  preset,
  href,
  compact,
  bare,
  caption,
  place,
  sizes,
  engine,
  gpu,
  gpuName,
}: {
  preset: PresetCardData;
  href: string;
  compact?: boolean;
  /** The picture, the name and the description only: no category icon or engine chips (Home's rows). */
  bare?: boolean;
  /** A short line in place of the description (Home's rows); the description stays the tooltip. */
  caption?: string;
  /** Where in the shared cycle its clip starts when it plays by itself (PresetPreview). */
  place?: number;
  /** How wide its picture shows (PresetPreview). */
  sizes?: string;
  /** Settings → Engine mode: with one engine locked in, the other's chip would suggest a route the user turned off. */
  engine?: "cloud" | "open";
  /** Its state on the viewer's GPU (a badge as one string, badgeKey), or none. */
  gpu?: string;
  gpuName?: string;
}) {
  const badge = engine !== "cloud" ? parseBadgeKey(gpu) : null;
  const Icon = PRESET_ICONS[preset.icon] ?? Sparkles;
  const { ref, playing, asked, handlers } = usePreviewPlayback<HTMLAnchorElement>(preset.id, preset.preview);
  const [more, setMore] = useState(false);
  return (
    // Prefetched on hover or touch, not on sight: a gallery shows hundreds of these.
    <IntentLink
      ref={ref}
      href={href}
      {...handlers}
      className="group/card flex min-w-0 flex-col gap-2 rounded-xl p-1.5 transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-muted">
        <PresetPreview preview={preset.preview} hue={preset.hue} playing={playing} asked={asked} place={place} sizes={sizes} flip={previewFlip(preset)} />
        {!bare && (
          <>
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/40 to-transparent" />
            <span className="pointer-events-none absolute bottom-1.5 left-1.5 grid size-6 place-items-center rounded-md bg-black/30 text-white">
              <Icon className="size-3.5" />
            </span>
            <span className="pointer-events-none absolute right-1.5 bottom-1.5 flex gap-1">
              {/* With one engine every card runs on it: a chip only where cards differ. */}
              {!engine && preset.cloud && <EngineChip engine="cloud" />}
              {!engine && preset.open && <EngineChip engine="open" />}
            </span>
          </>
        )}
        {preset.top && (
          <span className="absolute top-1.5 left-1.5 rounded-[4px] bg-highlight px-1 text-[10px] font-semibold text-highlight-foreground">Popular</span>
        )}
        {badge && (
          <span className="pointer-events-none absolute top-1.5 right-1.5">
            <CardChip badge={badge} gpu={gpuName} />
          </span>
        )}
        <CardPending />
      </div>
      <div className="min-w-0 px-0.5">
        <p className="truncate text-[13px] font-medium">{preset.name}</p>
        {!compact && (
          // Two lines hold the card's place in the grid and stay inside the card on hover (a panel over the next
          // row read as broken); the full text is the tooltip and the preset's own page. A phone has no tooltip: a
          // tap on the text opens it in place (readMoreTap), so the gallery stays even until someone asks.
          <p
            title={preset.description}
            data-more={more || undefined}
            onClick={(e) => {
              const next = readMoreTap(e.currentTarget, more, window.matchMedia(TAP_TO_READ).matches);
              if (next === null) return;
              e.preventDefault();
              setMore(next);
            }}
            className={cn("text-[12px] leading-snug text-muted-foreground", !more && "line-clamp-2")}
          >
            {caption ?? preset.description}
          </p>
        )}
      </div>
    </IntentLink>
  );
});

type RunsOn = "all" | "cloud" | "open";
const RUNS_ON: { value: RunsOn; label: string; icon?: typeof Cloud }[] = [
  { value: "all", label: "All" },
  { value: "cloud", label: "Cloud", icon: Cloud },
  { value: "open", label: "Open source", icon: Cpu },
];

/** "Runs on: All · Cloud · Open source", as a radio group with arrow-key support. */
function RunsOnControl({ value, onChange, locked, owner }: { value: RunsOn; onChange: (v: RunsOn) => void; locked?: "cloud" | "open"; owner: boolean }) {
  // Only the owner has Settings → Engine mode; with one engine there is nothing for a visitor to pick.
  if (locked && !owner) return null;
  if (locked)
    return (
      <Link
        href="/settings#engine"
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 text-[13px] text-muted-foreground hover:text-foreground"
        title="Set in Settings → Engine mode"
      >
        <Lock className="size-3.5" /> {locked === "open" ? "Open source only" : "Cloud only"}
      </Link>
    );
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span id="runs-on-label" className="text-[12px] whitespace-nowrap text-muted-foreground">
        Runs on
      </span>
      <div
        role="radiogroup"
        aria-labelledby="runs-on-label"
        className="flex h-9 items-center rounded-full bg-muted p-0.5"
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          e.preventDefault();
          const i = RUNS_ON.findIndex((o) => o.value === value);
          const next = RUNS_ON[(i + (e.key === "ArrowRight" ? 1 : RUNS_ON.length - 1)) % RUNS_ON.length];
          onChange(next.value);
          (e.currentTarget.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
        }}
      >
        {RUNS_ON.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            tabIndex={value === o.value ? 0 : -1}
            data-value={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:px-3",
              value === o.value && "bg-background text-foreground shadow-soft",
            )}
          >
            {o.icon && <o.icon className="size-3.5" />}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Keeps data-fade-start / data-fade-end on a horizontal scroller in sync with its scroll position. */
export function useFadeEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      el.toggleAttribute("data-fade-start", el.scrollLeft > 2);
      el.toggleAttribute("data-fade-end", el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  return ref;
}

/**
 * A card that opens a tool of its own (Live edit), shown before the presets: the same card chrome, its own link. Only
 * on the All tab with no search, or when the search matches its words; never when the gallery shows cloud tools only.
 */
export interface LinkCard {
  href: string;
  title: string;
  line: string;
  /** More words a search finds it by. */
  words?: string;
  badge?: string;
  /** Its picture: a node (a playing demo), drawn in the card's 4:3 frame. */
  cover: React.ReactNode;
}

function LeadingCard({ card }: { card: LinkCard }) {
  return (
    <Link href={card.href} className="group/card flex min-w-0 flex-col gap-2 rounded-xl p-1.5 transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" data-leading-card>
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-muted">
        {card.cover}
        {card.badge && <span className="pointer-events-none absolute top-1.5 right-1.5 rounded-full bg-highlight px-1.5 py-0.5 text-[10.5px] font-semibold text-highlight-foreground">{card.badge}</span>}
      </div>
      <div className="min-w-0 px-0.5 pb-0.5">
        <p className="truncate text-[14px] font-medium">{card.title}</p>
        <p className="line-clamp-2 text-[12.5px] text-muted-foreground">{card.line}</p>
      </div>
    </Link>
  );
}

const FIRST_PAGE = 30;
const PAGE = 40;

const GRID = GALLERY_GRID;

export function PresetGallery({
  presets,
  categories,
  href,
  noun = "presets",
  leading,
}: {
  /** In the order the All view shows them (featuredGallery): a category or a search keeps it. */
  presets: PresetCardData[];
  /** The category tabs, in catalog order. */
  categories: string[];
  /** "{id}" is replaced with the preset id. */
  href: string;
  /** Plural shown in the result count, e.g. "effects". */
  noun?: string;
  /** Tools of their own shown first (LinkCard). */
  leading?: LinkCard[];
}) {
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [runsOnChoice, setRunsOn] = useState<RunsOn>("all");
  // "both" until hydrated, so the server HTML and the first client render agree.
  const mode = useEngineMode();
  const locked = mode === "both" ? undefined : mode;
  const runsOn: RunsOn = locked ?? runsOnChoice;
  const query = useDeferredValue(q.trim().toLowerCase());

  const index = useMemo(() => presets.map((p) => [p, searchText(p)] as const), [presets]);
  const cats = useMemo(() => ["All", ...categories], [categories]);
  const list = useMemo(
    () =>
      index
        .filter(([p, text]) => (cat === "All" || p.category === cat) && (!query || matchesSearch(text, query)) && (runsOn === "all" || p[runsOn]))
        .map(([p]) => p),
    [index, cat, query, runsOn],
  );
  // Cards render a page at a time; a new filter starts from the first page again.
  const { shown, hasMore, moreFrom, sentinel, left } = useProgressive(list.length, `${cat}|${query}|${runsOn}`, FIRST_PAGE, PAGE);
  const grid = useRef<HTMLDivElement>(null);

  const strip = useFadeEdges<HTMLDivElement>();
  const stale = q.trim().toLowerCase() !== query;
  const lead = (leading ?? []).filter((c) => cat === "All" && runsOn !== "cloud" && (!query || matchesSearch(`${c.title} ${c.line} ${c.words ?? ""}`.toLowerCase(), query)));
  // One fetch of the viewer's chips (the GPU pre-flight); each card gets one string.
  const badges = useGpuBadges().data;
  const viewer = useViewer().data;
  const visitor = !!viewer && viewer.publicSignup && !viewer.owner;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${presets.length} ${noun}`}
              aria-label={`Search ${noun}`}
              className="h-9 w-full rounded-full border bg-background pr-9 pl-9 text-[14px] outline-none placeholder:text-subtle-foreground focus:border-primary focus:ring-4 focus:ring-brand-faint [&::-webkit-search-cancel-button]:hidden"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 sm:ml-auto sm:justify-end">
            <span className="order-last text-[12px] whitespace-nowrap text-muted-foreground tabular-nums sm:order-first sm:mr-2" aria-live="polite">
              {list.length === presets.length ? `${presets.length} ${noun}` : `${list.length} of ${presets.length}`}
            </span>
            <RunsOnControl value={runsOn} onChange={setRunsOn} locked={locked} owner={!!viewer?.owner} />
          </div>
        </div>
        {/* Its line is kept (unseen) until the viewer and its chips are known, so the strip and grid don't move when it comes. */}
        {(!viewer || (visitor && (!badges || (!badges.connected && !badges.off)))) && (
          <p className={cn("text-[13px] text-muted-foreground", !(visitor && badges) && "invisible", !viewer && "[html[data-viewer='owner']_&]:hidden")} aria-hidden={!(visitor && badges) || undefined}>
            <Link href="/connect" tabIndex={visitor && badges ? undefined : -1} className="font-medium text-brand-text underline-offset-2 hover:underline">
              Connect your GPU
            </Link>{" "}
            to see what runs on it.
          </p>
        )}
        <div
          ref={strip}
          role="group"
          aria-label="Categories"
          // From sm up every category shows (wrapped): a mouse can't scroll a row whose scrollbar is hidden.
          className="fade-x scrollbar-none -mx-1 flex snap-x scroll-px-1 gap-1 overflow-x-auto px-1 sm:flex-wrap sm:overflow-visible"
        >
          {cats.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={cat === c}
              onFocus={(e) => e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}
              onClick={(e) => {
                setCat(c);
                e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
              }}
              className={cn(
                "h-8 shrink-0 snap-start rounded-full px-3 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                cat === c && "bg-secondary text-foreground",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      {list.length || lead.length ? (
        <>
          <div ref={grid} className={cn(GRID, "transition-opacity", stale && "opacity-70")}>
            {lead.map((c) => (
              <LeadingCard key={c.href} card={c} />
            ))}
            {list.slice(0, shown).map((p) => (
              <PresetCard key={p.id} preset={p} href={href.replace("{id}", p.id)} engine={locked} gpu={p.open ? badgeKey(badges?.presets[p.id]) : undefined} gpuName={badges?.gpu} />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                ref={sentinel}
                type="button"
                onClick={(e) => moreFrom(e, grid.current)}
                className="h-9 rounded-full border bg-background px-4 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Show more · {left} left
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="py-16 text-center">
          <p className="font-heading text-[22px]">{query ? `No matches for “${q.trim()}”` : `No ${noun} here`}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {runsOn !== "all" && !locked ? "Show all, or clear the filters." : "Try another word or category."}
          </p>
          <button
            type="button"
            onClick={() => {
              setQ("");
              setCat("All");
              if (!locked) setRunsOn("all");
            }}
            className="mt-4 h-8 rounded-full border px-3 text-[13px] font-medium hover:bg-accent"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
