"use client";

import { ArrowDownAZ, Hash, ListOrdered } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { CoverScrollBox, CoverTile, usePickerPlayback } from "@/components/cover-tile";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CAMERA_MOVES, cinemaMoveRoute, type CameraMove } from "@/lib/catalog/cinema";
import type { Engine } from "@/lib/catalog/types";
import { moveCover } from "@/lib/preset-covers";

/*
 * The camera moves list of Cinema Studio's "#" picker and the Director panel's Movement tab, with each move's cover.
 * Its own chunk (with the covers map and the clip player): camera-moves.tsx loads it with next/dynamic when it shows.
 */

/** Name matches first (prefix, then word start, then anywhere), the slug and the hint after. */
function moveScore(value: string, search: string, keywords?: string[]): number {
  const q = search.trim().toLowerCase();
  if (!q) return 1;
  const name = value.toLowerCase();
  if (name.startsWith(q)) return 1;
  if (name.split(/\s+/).some((w) => w.startsWith(q))) return 0.9;
  if (name.includes(q)) return 0.8;
  const [slug = "", hint = ""] = (keywords ?? []).map((k) => k.toLowerCase());
  if (slug.includes(q.replace(/\s+/g, "-"))) return 0.6;
  return hint.includes(q) ? 0.2 : 0;
}

/** How Fuobe Cinema drives a move on this engine, given a start frame (a small badge in the picker). */
function routeBadge(m: CameraMove, engine: Engine, civitai?: boolean): string | null {
  const r = cinemaMoveRoute(m.slug, engine, true, { civitai });
  return r.via === "camera-lora" ? "Camera LoRA" : r.via === "lora" ? "LoRA" : r.via === "fun-camera" ? "Fun Camera" : r.via === "hosted-move" ? "Focus move" : null;
}

/**
 * One move: the cover of the camera motion it runs (its clip plays while the pointer rests on the row, or while the
 * arrow keys highlight it), with its place in the shot's order on it once picked; the move's name, how it runs and
 * its hint.
 */
function MoveRow({ move: m, badge, order, highlighted, onPick }: { move: CameraMove; badge: string | null; order: number; highlighted: boolean; onPick: () => void }) {
  const { playing, handlers } = usePickerPlayback(m.slug, { highlighted });
  return (
    <CommandItem value={m.name} keywords={[m.slug, m.hint]} onSelect={onPick} {...handlers} className="group/move items-start gap-2.5 py-2">
      <CoverTile
        cover={moveCover(m)}
        playing={playing}
        picked={order >= 0 ? order + 1 : undefined}
        className="mt-0.5 h-9 w-12 rounded-md"
        fallback={
          <span className="absolute inset-0 grid place-items-center text-muted-foreground">
            <Hash className="size-3.5" />
          </span>
        }
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] font-medium">
          {m.name}
          {badge && <span className="rounded-full bg-brand-faint px-1.5 py-px text-[10px] font-medium text-brand-text">{badge}</span>}
        </span>
        <span className="block text-[12px] leading-snug text-muted-foreground">{m.hint}</span>
      </span>
      <span className="mt-0.5 shrink-0 text-[11px] font-medium text-brand-text opacity-0 group-data-[selected=true]/move:opacity-100">Use</span>
    </CommandItem>
  );
}

export function MoveList({
  engine,
  badges = true,
  civitai,
  selected,
  onPick,
  defaultQuery,
  autoFocus,
}: {
  engine: Engine;
  /** Say how Fuobe Cinema drives each move (off when a partner model gets the moves in words). */
  badges?: boolean;
  /** A civitai key is set (false: a cloud move whose LoRA downloads from civitai runs on its words, so no badge). */
  civitai?: boolean;
  selected: string[];
  onPick: (slug: string) => void;
  /** What was typed after "#" in the prompt (the list mounts fresh each time the picker opens). */
  defaultQuery?: string;
  autoFocus?: boolean;
}) {
  const [sort, setSort] = useState<"default" | "name">("default");
  const [query, setQuery] = useState(defaultQuery ?? "");
  // The highlighted row (its value, the move's name): controlled, as cmdk only reports it then.
  const [highlighted, setHighlighted] = useState("");
  // Whether the keys moved the highlight last. cmdk also highlights the row under the pointer and keeps it after the
  // pointer leaves the list, so a row the pointer is on plays from the pointer itself (MoveRow's handlers).
  const [keyed, setKeyed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const moves = useMemo(() => (sort === "name" ? [...CAMERA_MOVES].sort((a, b) => a.name.localeCompare(b.name)) : CAMERA_MOVES), [sort]);
  return (
    <Command
      loop
      className="bg-transparent"
      filter={moveScore}
      value={highlighted}
      onValueChange={setHighlighted}
      onKeyDown={() => setKeyed(true)}
      onPointerMove={() => setKeyed(false)}
    >
      <div className="flex items-center gap-1 pr-1">
        <div className="min-w-0 flex-1">
          <CommandInput placeholder="Search camera moves…" value={query} onValueChange={setQuery} autoFocus={autoFocus} />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setSort((s) => (s === "default" ? "name" : "default"))}
              className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={sort === "default" ? "Sort by name" : "Default order"}
            >
              {sort === "default" ? <ArrowDownAZ className="size-4" /> : <ListOrdered className="size-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{sort === "default" ? "Sort: Name (A–Z)" : "Sort: Default"}</TooltipContent>
        </Tooltip>
      </div>
      <CoverScrollBox value={box}>
        <CommandList ref={box} className="max-h-[min(52vh,360px)]">
          <CommandEmpty>No camera moves match your search</CommandEmpty>
          <CommandGroup>
            {moves.map((m) => (
              <MoveRow
                key={m.slug}
                move={m}
                badge={badges ? routeBadge(m, engine, civitai) : null}
                order={selected.indexOf(m.slug)}
                highlighted={keyed && highlighted === m.name}
                onPick={() => onPick(m.slug)}
              />
            ))}
          </CommandGroup>
        </CommandList>
      </CoverScrollBox>
    </Command>
  );
}
