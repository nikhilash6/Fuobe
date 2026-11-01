"use client";

import dynamic from "next/dynamic";
import { Check, Hash, Loader2, X } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { moveBySlug } from "@/lib/catalog/cinema";
import type { Engine } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

/**
 * The camera moves list, with each move's cover (move-list.tsx): its own chunk, with the covers map and the clip
 * player, loaded when the "#" picker or the Director panel's Movement tab shows it rather than with every Cinema
 * Studio page.
 */
export const MoveList = dynamic(() => import("./move-list").then((m) => m.MoveList), {
  loading: () => (
    <div className="grid h-40 place-items-center" role="status" aria-label="Loading camera moves">
      <Loader2 className="size-4 animate-spin text-muted-foreground" />
    </div>
  ),
});

/** Load the moves list ahead, once a move is likely: a video prompt being typed, the # button or Movement tab pointed at. */
export const prefetchMoves = () => void import("./move-list");


/** "#" picker: opens from the # button or when "#" is typed in the prompt; several moves per shot, in order. */
export function MovePicker({
  open,
  onOpenChange,
  engine,
  badges,
  civitai,
  selected,
  onPick,
  initialQuery,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  engine: Engine;
  badges?: boolean;
  civitai?: boolean;
  selected: string[];
  onPick: (slug: string) => void;
  initialQuery?: string;
}) {
  const trigger = (
    <Tooltip>
      <TooltipTrigger asChild>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-full transition-colors",
              selected.length ? "bg-brand-faint text-brand-text hover:bg-brand-faint-hover" : "bg-secondary text-secondary-foreground hover:bg-accent",
            )}
            aria-label="Add a camera move"
            onPointerEnter={prefetchMoves}
            onFocus={prefetchMoves}
          >
            <Hash className="size-3.5" />
          </button>
        </PopoverTrigger>
      </TooltipTrigger>
      <TooltipContent>Direct a camera move · type #</TooltipContent>
    </Tooltip>
  );
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {trigger}
      <PopoverContent className="w-[min(92vw,400px)] p-0" align="start" side="top" collisionPadding={12}>
        <div className="border-b px-3 pt-3 pb-2">
          <p className="text-[13px] font-medium">Direct a camera move</p>
          <p className="text-[12px] text-muted-foreground">Adds to the prompt box, or type # there. Several per shot; order matters.</p>
        </div>
        <MoveList
          engine={engine}
          badges={badges}
          civitai={civitai}
          selected={selected}
          defaultQuery={initialQuery}
          autoFocus
          onPick={(slug) => {
            onPick(slug);
            onOpenChange(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** The shot's moves as ordered tags: drag or Alt+←/→ to reorder, × or Backspace to remove. */
export function MoveChips({ moves, onChange }: { moves: string[]; onChange: (m: string[]) => void }) {
  const [drag, setDrag] = useState<number | null>(null);
  if (!moves.length) return null;
  const move = (from: number, to: number) => {
    if (to < 0 || to >= moves.length || from === to) return;
    const next = [...moves];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    onChange(next);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2 pb-1.5" role="list" aria-label="Camera moves, in order">
      {moves.map((slug, i) => {
        const m = moveBySlug(slug);
        return (
          <span
            key={`${slug}-${i}`}
            role="listitem"
            draggable
            onDragStart={(e) => {
              setDrag(i);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (drag !== null) move(drag, i);
              setDrag(null);
            }}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.altKey && e.key === "ArrowLeft") move(i, i - 1);
              else if (e.altKey && e.key === "ArrowRight") move(i, i + 1);
              else if (e.key === "Backspace" || e.key === "Delete") onChange(moves.filter((_, j) => j !== i));
            }}
            title={m?.hint}
            className="inline-flex h-7 cursor-grab items-center gap-1 rounded-full bg-brand-faint pr-1 pl-1.5 text-[12px] font-medium text-brand-text outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          >
            <span className="grid size-4 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground">{i + 1}</span>#{m?.name ?? slug}
            <button type="button" onClick={() => onChange(moves.filter((_, j) => j !== i))} className="grid size-5 place-items-center rounded-full hover:bg-brand-faint-hover" aria-label={`Remove ${m?.name ?? slug}`}>
              <X className="size-3" />
            </button>
          </span>
        );
      })}
      {moves.length > 1 && (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Check className="size-3" /> runs in this order
        </span>
      )}
    </div>
  );
}
