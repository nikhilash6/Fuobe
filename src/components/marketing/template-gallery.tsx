"use client";

import { Play, Search, Zap } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { useEdgeFade } from "@/components/studio/use-edge-fade";
import { useCoverPlayback } from "@/components/template-cover";
import { CATEGORIES, FORMATS, interleaved, isCodeTemplate, templatesFor, type MarketingCategory, type MarketingTemplate } from "@/lib/catalog/marketing";
import { templateCover } from "@/lib/template-covers";
import { cn } from "@/lib/utils";
import { TemplatePreview } from "./template-preview";

export type MediaFilter = "all" | "image" | "video";

export function TemplateCard({ t, selected, onPick }: { t: MarketingTemplate; selected: boolean; onPick: (t: MarketingTemplate) => void }) {
  const f = FORMATS[t.format];
  const video = f.kind === "video";
  // Drawn by Kinetic Motion in the browser: no model, so it plays at once.
  const instant = isCodeTemplate(t);
  // Its real cover when it has one (a clip plays as the gallery cards' do), else its drawn preview.
  const cover = templateCover("marketing", t.id);
  const { ref, playing, asked, handlers } = useCoverPlayback<HTMLButtonElement>(`marketing/${t.id}`, cover);
  return (
    <button
      ref={ref}
      type="button"
      {...handlers}
      onClick={() => onPick(t)}
      aria-pressed={selected}
      className={cn("group/tpl min-w-0 rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", selected && "ring-2 ring-primary ring-offset-2 ring-offset-background")}
    >
      <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-muted transition-transform duration-300 ease-move group-hover/tpl:scale-[1.015]">
        <TemplatePreview id={t.id} look={t.look} video={video} cover={cover} playing={playing} asked={asked} sizes="(max-width: 640px) 50vw, 220px" />
        <span className="absolute top-2 left-2 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">{f.cardLabel}</span>
        {instant && (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
            <Zap className="size-3" /> Instant
          </span>
        )}
        {video && (
          <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-black/45 text-white backdrop-blur" aria-hidden>
            <Play className="size-3 fill-current" />
          </span>
        )}
      </div>
      <p className="mt-2 truncate px-0.5 text-[13px] font-medium">{t.name}</p>
      {/* Named by what it shows (the format chip, then the name), so speech users can say it. */}
      <span className="sr-only">{video ? ", video template" : ", template"}{instant ? ", instant" : ""}</span>
    </button>
  );
}

/** "Explore templates": categories, Images/Videos, search, and the cards. */
export function TemplateGallery({ category, onCategory, media, onMedia, selected, onPick }: { category: MarketingCategory | "all"; onCategory: (c: MarketingCategory | "all") => void; media: MediaFilter; onMedia: (m: MediaFilter) => void; selected?: string; onPick: (t: MarketingTemplate) => void }) {
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim().toLowerCase());
  const [show, setShow] = useState(30);
  const list = useMemo(() => {
    const base = templatesFor(category, media);
    const found = query ? base.filter((t) => `${t.name} ${FORMATS[t.format].cardLabel} ${FORMATS[t.format].name} ${t.prompt}`.toLowerCase().includes(query)) : base;
    const ordered = category === "all" && !query ? interleaved(found) : found;
    // Templates with a real cover lead; the rest keep their order after them.
    return [...ordered].sort((a, b) => Number(!templateCover("marketing", a.id)) - Number(!templateCover("marketing", b.id)));
  }, [category, media, query]);
  const [fadeRef, fadeStyle] = useEdgeFade<HTMLDivElement>();
  return (
    <section aria-labelledby="explore-templates">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="explore-templates" className="font-heading text-[24px] leading-tight">
          Explore templates
        </h2>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <label className="relative min-w-0">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates" aria-label="Search templates" className="h-8 w-44 rounded-full border bg-background pr-3 pl-8 text-[13px] outline-none focus:border-primary" />
          </label>
          <div role="radiogroup" aria-label="Media" className="inline-flex rounded-full bg-muted p-0.5">
            {(["all", "image", "video"] as const).map((m) => (
              <button key={m} role="radio" aria-checked={media === m} onClick={() => onMedia(m)} className={cn("h-7 rounded-full px-3 text-[12px] font-medium text-muted-foreground", media === m && "bg-background text-foreground shadow-soft")}>
                {m === "all" ? "All" : m === "image" ? "Images" : "Videos"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div ref={fadeRef} style={fadeStyle} className="scrollbar-none mt-3 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={category === c.id}
            onClick={() => {
              onCategory(c.id);
              setShow(30);
            }}
            className={cn("inline-flex h-8 shrink-0 items-center rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors", category === c.id ? "bg-foreground text-background" : "bg-secondary text-secondary-foreground hover:bg-accent")}
          >
            {c.label}
          </button>
        ))}
      </div>
      {list.length ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {list.slice(0, show).map((t) => (
              <TemplateCard key={t.id} t={t} selected={t.id === selected} onPick={onPick} />
            ))}
          </div>
          {list.length > show && (
            <div className="mt-6 flex justify-center">
              <button type="button" onClick={() => setShow((n) => n + 40)} className="h-9 rounded-full bg-secondary px-4 text-[13px] font-medium hover:bg-accent">
                Show more ({list.length - show})
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="py-16 text-center">
          <p className="font-heading text-[22px]">No templates match “{q}”</p>
          <button type="button" onClick={() => setQ("")} className="mt-3 text-[13px] font-medium text-brand-text hover:underline">
            Clear search
          </button>
        </div>
      )}
    </section>
  );
}
