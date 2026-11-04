"use client";

import { KeyRound, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { CuratedCover } from "@/components/moodboards/cards";
import { curatedLook } from "@/components/moodboards/logic";
import { DEFAULT_LOOK, lookCard, lookSet, type SoulLookCard } from "@/lib/catalog/soul-cards";
import { cn } from "@/lib/utils";
import { Chip, ClearableChip } from "./chip";
import { radioKeys, radioTab } from "./radio-keys";
import { ResponsivePanel } from "./responsive-panel";

/**
 * Fuobe Soul's Look picker: Soul's 106 looks and Soul 2.0's 33 (the request's presetId), with the look's
 * strength (presetStrength scales its LoRAs). Covers are drawn like the Moodboard panel's curated looks (no
 * preview media is copied from anywhere). A popover on desktop, a bottom sheet on phones; its own chunk.
 */

const FAMILIES = [
  ["v2", "Soul 2.0"],
  ["v1", "Soul"],
] as const;

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function LookChip({
  value,
  strength,
  onChange,
  onStrength,
  none,
}: {
  /** The look's id (Soul's default look when unset, or no look when `none` is set). */
  value?: string;
  strength: number;
  onChange: (id: string | undefined, look?: SoulLookCard) => void;
  onStrength: (v: number) => void;
  /** Unset means no look at all (a storyboard without one), shown as this label; picking General then sends its id. */
  none?: string;
}) {
  const [open, setOpen] = useState(false);
  const picked = value ? lookCard(value) : none ? undefined : lookCard(DEFAULT_LOOK);
  const [family, setFamily] = useState<"v1" | "v2">(picked?.family ?? "v2");
  const [tab, setTab] = useState("All presets");
  const [q, setQ] = useState("");
  const set = useMemo(() => lookSet(family), [family]);
  const tabs = ["All presets", ...set.categories];
  const items = useMemo(() => {
    const words = q.trim().toLowerCase();
    // A search looks through both families.
    const pool = words ? [...lookSet("v2").items, ...lookSet("v1").items] : set.items;
    return pool.filter((l) => (words ? `${l.name} ${l.description}`.toLowerCase().includes(words) : tab === "All presets" || l.categories.includes(tab)));
  }, [q, set, tab]);
  return (
    <ClearableChip active={!!value} onClear={() => onChange(undefined)} clearLabel={none ? `Back to ${none.toLowerCase()}` : "Back to the General look"}>
      <ResponsivePanel
        open={open}
        onOpenChange={setOpen}
        title="Look"
        description="Soul's looks on open weights: words, LoRAs and a grade"
        className="w-[min(92vw,480px)] p-2"
        trigger={
          <Chip icon={picked ? undefined : Sparkles} active={!!value} aria-label={`Look: ${picked?.name ?? none ?? "General"}`}>
            {picked && <CuratedCover m={{ name: "", ...curatedLook(picked.id) }} className="size-4 rounded-full" sizes="16px" />}
            <span className="max-w-32 truncate">{picked?.name ?? none ?? "Look"}</span>
            {strength < 1 && <span className="text-muted-foreground tabular-nums">{pct(strength)}</span>}
          </Chip>
        }
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {/* Filters of the grid below (not tabs with panels): a radio group each, arrow keys move and pick. */}
          <div role="radiogroup" aria-label="Soul version" onKeyDown={radioKeys} className="inline-flex shrink-0 rounded-full bg-muted p-0.5">
            {FAMILIES.map(([f, label]) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={family === f}
                tabIndex={radioTab(family === f)}
                onClick={() => {
                  setFamily(f);
                  setTab("All presets");
                }}
                className={cn(
                  "h-7 rounded-full px-3 text-[12px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  family === f ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search looks"
              aria-label="Search looks"
              className="h-8 w-full min-w-0 rounded-md border bg-background pr-2 pl-7 text-sm outline-none focus:border-primary"
            />
          </label>
        </div>
        {!q && (
          <div role="radiogroup" aria-label="Look categories" onKeyDown={radioKeys} className="scrollbar-none -mx-0.5 mb-2 flex gap-1 overflow-x-auto px-0.5">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={tab === t}
                tabIndex={radioTab(tab === t)}
                onClick={() => setTab(t)}
                className={cn(
                  "h-7 shrink-0 rounded-full px-2.5 text-[12px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  tab === t ? "bg-brand-faint text-brand-text" : "text-muted-foreground hover:bg-accent",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        )}
        <div className="grid max-h-80 grid-cols-3 gap-1.5 overflow-y-auto sm:grid-cols-4">
          {items.map((l) => (
            <button
              key={l.id}
              type="button"
              aria-pressed={picked?.id === l.id}
              title={l.description}
              onClick={() => {
                onChange(l.id === DEFAULT_LOOK && !none ? undefined : l.id, l);
                setOpen(false);
              }}
              className={cn("group flex min-w-0 flex-col gap-1 rounded-lg p-1 text-left ring-primary transition hover:bg-accent", picked?.id === l.id && "ring-2")}
            >
              <span className="relative aspect-[3/4] w-full overflow-hidden rounded-md">
                <CuratedCover m={{ name: "", ...curatedLook(l.id) }} className="size-full transition-transform duration-300 group-hover:scale-105" />
                {l.civitai && (
                  <span
                    aria-hidden
                    className="absolute right-1 bottom-1 grid size-4 place-items-center rounded-full bg-black/45 text-white"
                    title="Its LoRA downloads from civitai: add your free civitai key in Settings → LoRAs"
                  >
                    <KeyRound className="size-2.5" aria-hidden />
                  </span>
                )}
              </span>
              <span className="truncate px-0.5 text-[12px] font-medium">{l.name}</span>
              {l.civitai && <span className="sr-only">: its LoRA downloads from civitai and needs your free civitai key</span>}
            </button>
          ))}
          {!items.length && <p className="col-span-full py-8 text-center text-[13px] text-muted-foreground">No looks match “{q}”</p>}
        </div>
        {picked && (
          <div className="mt-2 space-y-2 border-t pt-2">
            <p className="line-clamp-2 px-0.5 text-[12px] text-muted-foreground">
              <span className="font-medium text-foreground">{picked.name}.</span> {picked.description}
              {picked.civitai && " Its LoRA downloads from civitai: add your free civitai key in Settings → LoRAs (without it the look's words still apply)."}
              {picked.hd && " Made for Fuobe Soul HD (cleaner lettering)."}
            </p>
            <label className="flex items-center gap-3 px-0.5">
              <span className="shrink-0 text-[12px] text-muted-foreground">Strength</span>
              <Slider value={[Math.round(strength * 100)]} min={0} max={100} step={5} onValueChange={([v]) => onStrength(v / 100)} aria-label="Look strength" className="flex-1" />
              <span className="w-9 shrink-0 text-right text-[12px] tabular-nums">{pct(strength)}</span>
            </label>
          </div>
        )}
      </ResponsivePanel>
    </ClearableChip>
  );
}
