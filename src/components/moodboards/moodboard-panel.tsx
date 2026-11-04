"use client";

import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { radioKeys, radioTab } from "@/components/studio/radio-keys";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { MoodboardPick } from "@/lib/catalog/palettes";
import { cn } from "@/lib/utils";
import { onAttr, TAB_PILL, TabRow } from "@/components/ui/tab-row";
import { BoardCover, CuratedCover, StatusBadge } from "./cards";
import { CreateMoodboardDialog } from "./create-moodboard";
import { useCuratedSet, useMoodboards } from "./hooks";
import { COPY, CURATED_TABS, curatedPick, inCuratedTab, toPick } from "./logic";

const SETS = [
  ["soul-v2", "Soul 2.0"],
  ["soul-v1", "Soul"],
] as const;
type CuratedSet = (typeof SETS)[number][0];

/**
 * The composer's Moodboard panel: Curated (Fuobe Soul's looks: Soul 2.0's 33 and Soul's 106) and My
 * moodboards, search, Create moodboard. It opens on Soul 2.0's looks, or on the set of the look already picked.
 */
export function MoodboardPanel({ value, onPick }: { value?: MoodboardPick; onPick: (m?: MoodboardPick) => void }) {
  const { data, isLoading } = useMoodboards();
  const [tab, setTab] = useState<"curated" | "mine">(value?.kind === "personal" ? "mine" : "curated");
  const [set, setSet] = useState<CuratedSet>(value?.kind === "curated" ? (value.source ?? "soul-v2") : "soul-v2");
  const [cat, setCat] = useState("All presets");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const needle = q.trim().toLowerCase();
  const looks = useCuratedSet(set);
  const curated = useMemo(
    () => looks.filter((c) => (needle ? `${c.name} ${c.description}`.toLowerCase().includes(needle) : inCuratedTab(c, cat))),
    [looks, needle, cat],
  );
  const mine = useMemo(() => (data?.items ?? []).filter((m) => !needle || m.name.toLowerCase().includes(needle)), [data, needle]);
  const card = "group block w-full min-w-0 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

  return (
    <div className="min-w-0 space-y-2.5">
      <div className="flex items-center gap-2">
        <TabRow role="tablist" aria-label="Moodboards" fade={false}>
          {(
            [
              ["curated", "Curated"],
              ["mine", "My moodboards"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={TAB_PILL}
              {...onAttr(tab === id)}
            >
              {label}
            </button>
          ))}
        </TabRow>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-[12px] font-medium text-primary-foreground transition hover:bg-primary/90"
        >
          <Plus className="size-3.5" /> Create moodboard
        </button>
      </div>
      <label className="flex h-8 items-center gap-2 rounded-md border bg-background px-2 focus-within:border-primary">
        <Search className="size-3.5 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search presets..." aria-label="Search presets" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
      </label>

      {tab === "curated" ? (
        <>
          <div className="flex min-w-0 items-center gap-2">
            <div role="radiogroup" aria-label="Curated set" onKeyDown={radioKeys} className="inline-flex shrink-0 rounded-full border p-0.5">
              {SETS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={set === id}
                  tabIndex={radioTab(set === id)}
                  onClick={() => (setSet(id), setCat("All presets"))}
                  className={cn("h-6 rounded-full px-2.5 text-[11.5px] font-medium text-muted-foreground transition", set === id && "bg-secondary text-foreground")}
                >
                  {label}
                </button>
              ))}
            </div>
            {!needle && (
              <div className="scrollbar-none flex min-w-0 flex-1 gap-1 overflow-x-auto">
                {CURATED_TABS[set].map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={cat === c}
                    onClick={() => setCat(c)}
                    className={cn("h-7 shrink-0 rounded-full px-2.5 text-[12px] font-medium transition-colors", cat === c ? "bg-brand-faint text-brand-text" : "text-muted-foreground hover:bg-accent")}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid max-h-[46svh] grid-cols-3 gap-1.5 overflow-y-auto sm:max-h-[320px]">
            {curated.map((c) => (
              <button
                key={c.id}
                type="button"
                title={c.description || c.name}
                aria-label={c.name}
                aria-pressed={value?.id === c.id}
                onClick={() => onPick(value?.id === c.id ? undefined : curatedPick(c))}
                className={card}
              >
                <CuratedCover m={c} className={cn("aspect-[3/4] rounded-lg ring-offset-2 ring-offset-background", value?.id === c.id && "ring-2 ring-primary")} />
              </button>
            ))}
            {!curated.length && <p className="col-span-3 py-6 text-center text-[13px] text-muted-foreground">No presets match “{q}”</p>}
          </div>
        </>
      ) : (
        <div className="grid max-h-[50svh] grid-cols-2 gap-2 overflow-y-auto sm:max-h-[340px]">
          {isLoading ? (
            Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="aspect-square" />)
          ) : mine.length ? (
            mine.map((m) => {
              const ready = m.status === "complete";
              const btn = (
                <button
                  type="button"
                  aria-disabled={!ready}
                  aria-pressed={value?.id === m.id}
                  onClick={() => ready && onPick(value?.id === m.id ? undefined : toPick(m))}
                  className={cn(card, !ready && "cursor-not-allowed opacity-70")}
                >
                  <span className={cn("relative block aspect-square overflow-hidden rounded-lg ring-offset-2 ring-offset-background", value?.id === m.id && "ring-2 ring-primary")}>
                    <BoardCover m={m} className="size-full" />
                    <StatusBadge status={m.status} className="absolute top-1.5 left-1.5" />
                  </span>
                  <span className="mt-1 block truncate px-0.5 text-[12px] font-medium">{m.name}</span>
                </button>
              );
              return ready ? (
                <div key={m.id}>{btn}</div>
              ) : (
                <Tooltip key={m.id}>
                  <TooltipTrigger asChild>{btn}</TooltipTrigger>
                  <TooltipContent>{m.status === "failed" ? (m.error ?? "Failed") : COPY.notReady}</TooltipContent>
                </Tooltip>
              );
            })
          ) : (
            <div className="col-span-2 rounded-xl border border-dashed p-4 text-center">
              <p className="text-[13px] font-medium">Create your moodboard</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">{COPY.recommended}</p>
            </div>
          )}
        </div>
      )}
      <p className="text-[11.5px] text-muted-foreground">
        Fuobe Soul applies a curated look whole (its LoRAs and words); other models get the look in words, or your board&apos;s images as style references.{" "}
        <Link href="/moodboards" className="text-brand-text underline underline-offset-2">
          Manage moodboards
        </Link>
      </p>
      <CreateMoodboardDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={() => {
          setTab("mine");
        }}
      />
    </div>
  );
}
