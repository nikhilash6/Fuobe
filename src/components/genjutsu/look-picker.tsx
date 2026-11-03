"use client";

import { Search } from "lucide-react";
import { nanoid } from "nanoid";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { CuratedCover } from "@/components/moodboards/cards";
import { curatedLook } from "@/components/moodboards/logic";
import { fileToList, MediaSlot, type SlotValue } from "@/components/studio/media-slot";
import { LookCard } from "@/components/shorts/preset-card";
import { tabKeys } from "@/components/shorts/ui";
import { GENJUTSU, type GenjutsuLook } from "@/lib/catalog/genjutsu";
import { coveredFirst, SHORTS_PRESETS, shortsPreview } from "@/lib/catalog/shorts";
import { SOUL_LOOK_CARDS } from "@/lib/catalog/soul-cards";
import { cn } from "@/lib/utils";
import { onAttr, TAB_PILL, TabRow } from "@/components/ui/tab-row";

export type LookSource = "fuobe" | "soul" | "custom";

/**
 * Restyle's look: one of the 44 Shorts looks, one of Fuobe Soul's 139 looks (its words and LoRAs restyle the first
 * frame, every frame follows it), or your own look from up to 8 images and a few words. Every look runs on both engines.
 */
export function LookPicker({
  look,
  onLook,
  source,
  onSource,
  custom,
  onCustom,
  words,
  onWords,
}: {
  look: GenjutsuLook | null;
  onLook: (l: GenjutsuLook) => void;
  source: LookSource;
  onSource: (s: LookSource) => void;
  custom: SlotValue[];
  onCustom: (update: (xs: SlotValue[]) => SlotValue[]) => void;
  words: string;
  onWords: (w: string) => void;
}) {
  const [q, setQ] = useState("");
  const tabs: { id: LookSource; label: string }[] = [
    { id: "fuobe", label: "Looks" },
    { id: "soul", label: "Soul looks" },
    { id: "custom", label: "Your own" },
  ];
  const words_ = q.trim().toLowerCase();
  const presets = useMemo(() => coveredFirst(words_ ? SHORTS_PRESETS.filter((p) => `${p.name} ${p.category} ${p.description}`.toLowerCase().includes(words_)) : SHORTS_PRESETS), [words_]);
  const souls = useMemo(() => (words_ ? SOUL_LOOK_CARDS.filter((l) => `${l.name} ${l.description} ${l.categories.join(" ")}`.toLowerCase().includes(words_)) : SOUL_LOOK_CARDS), [words_]);
  return (
    <div className="space-y-3">
      <TabRow role="tablist" aria-label="Where the look comes from" onKeyDown={tabKeys} fade={false}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`look-tab-${t.id}`}
            aria-selected={source === t.id}
            aria-controls={`look-panel-${t.id}`}
            tabIndex={source === t.id ? 0 : -1}
            onClick={() => onSource(t.id)}
            className={cn(TAB_PILL, "min-w-0 flex-1 px-2")}
            {...onAttr(source === t.id)}
          >
            {t.label}
          </button>
        ))}
      </TabRow>

      {source !== "custom" && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={source === "soul" ? "Search 139 Soul looks — film, flash, editorial…" : "Search 44 looks — claymation, comic, watercolour…"}
            aria-label="Search looks"
            className="h-8 pl-8 text-[13px]"
          />
        </div>
      )}

      {source === "fuobe" && (
        <div role="tabpanel" id="look-panel-fuobe" aria-labelledby="look-tab-fuobe" className="grid max-h-[460px] grid-cols-3 gap-1 overflow-y-auto pr-0.5 sm:grid-cols-4 xl:grid-cols-5">
          {presets.map((p) => (
            <LookCard
              key={p.id}
              id={p.id}
              name={p.name}
              description={p.description}
              preview={shortsPreview(p)}
              hue={p.hue}
              selected={look?.kind === "preset" && look.id === p.id}
              onSelect={(id) => onLook({ kind: "preset", id })}
            />
          ))}
          {!presets.length && <p className="col-span-full py-6 text-center text-[13px] text-muted-foreground">No look matches “{q}”.</p>}
        </div>
      )}

      {source === "soul" && (
        <div role="tabpanel" id="look-panel-soul" aria-labelledby="look-tab-soul" className="space-y-2">
          <p className="text-[12px] text-muted-foreground">Fuobe Soul&apos;s looks: their words and LoRAs restyle the first frame, and every frame follows it.</p>
          <div className="grid max-h-[460px] grid-cols-3 gap-1.5 overflow-y-auto pr-0.5 sm:grid-cols-4 xl:grid-cols-5">
            {souls.map((l) => {
              const on = look?.kind === "soul" && look.id === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={on}
                  title={l.description}
                  onClick={() => onLook({ kind: "soul", id: l.id })}
                  className={cn("group flex min-w-0 flex-col gap-1 rounded-xl p-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", on && "bg-brand-faint hover:bg-brand-faint-hover")}
                >
                  <span className={cn("relative aspect-[4/5] w-full overflow-hidden rounded-lg", on && "ring-2 ring-primary")}>
                    <CuratedCover m={{ name: "", ...curatedLook(l.id) }} className="size-full" />
                  </span>
                  <span className="truncate px-0.5 text-[13px] font-medium">{l.name}</span>
                  <span className="px-0.5 text-[11px] text-muted-foreground">{l.family === "v2" ? "Soul 2.0" : "Soul"}</span>
                </button>
              );
            })}
            {!souls.length && <p className="col-span-full py-6 text-center text-[13px] text-muted-foreground">No Soul look matches “{q}”.</p>}
          </div>
        </div>
      )}

      {source === "custom" && (
        <div role="tabpanel" id="look-panel-custom" aria-labelledby="look-tab-custom" className="space-y-2.5">
          <p className="text-[12px] text-muted-foreground">Up to {GENJUTSU.maxLookImages} images of the look you want — stills, paintings, frames from a film. Every frame takes their colours, textures and style.</p>
          <div className="flex flex-wrap gap-2">
            {custom.map((v) => (
              <MediaSlot key={v.id} label="Look image" kind="image" value={v} onChange={(nv) => onCustom((xs) => (nv ? xs.map((x) => (x.id === v.id ? { ...nv, id: v.id } : x)) : xs.filter((x) => x.id !== v.id)))} />
            ))}
            {custom.length < GENJUTSU.maxLookImages && (
              <MediaSlot label={custom.length ? "Add image" : "Add an image"} kind="image" value={null} onChange={(v) => v && onCustom((xs) => [...xs, { ...v, id: v.id ?? nanoid(8) }])} onFile={(f) => fileToList(f, onCustom, "image")} />
            )}
          </div>
          <Input value={words} onChange={(e) => onWords(e.target.value)} maxLength={300} placeholder="In a few words (optional) — e.g. “grainy 70s film, warm and faded”" aria-label="Describe your look" className="h-8 text-[13px]" />
        </div>
      )}
    </div>
  );
}
