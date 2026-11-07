"use client";

import { Check, ChevronDown, Heart, Layers, Loader2, MoreHorizontal, Pin, RotateCcw } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { tileRatio } from "@/components/studio/feed";
import { TileActions, useCanHover, type RunnerOptions } from "@/components/studio/result-actions";
import { LayersStack, MediaThumb, SmallThumb } from "@/components/studio/result-media";
import { OPERATION_LABELS, type Generation } from "@/lib/catalog/types";
import { elapsed, timeAgo } from "@/lib/format";
import { cardStateWords, coverOf, trashDaysLeft, userTitle, type LibraryEntry } from "@/lib/library";
import { isLayered, shownOutputs } from "@/lib/output-actions";
import { pendingWords } from "@/lib/pending-words";
import { POOL_WORDS } from "@/lib/relay";
import { cn } from "@/lib/utils";
import { PlaceholderChip } from "@/components/demo-mode";
import { TroubleActions, TroubleDetails } from "@/components/gpu/trouble";
import { RunTroubleActions } from "@/components/gpu/run-trouble-actions";
import { DRAG_TYPE } from "./folders";
import { ReviewBadge } from "./review";
import { autoLine } from "@/lib/auto-image";
import type { Layout } from "./view-options";

/** Stable callbacks from the Library (refs inside), so cards re-render only when their own data changes. */
export interface CardApi {
  open: (g: Generation, index: number) => void;
  /** Toggle these generations; shift extends a range from the last toggled card. */
  toggle: (key: string, ids: string[], shift: boolean) => void;
  expand: (key: string) => void;
  /** What a drag carries: the whole selection when the card is part of it. */
  dragIds: (ids: string[]) => string[];
  retry: (g: Generation) => void;
  runner: RunnerOptions;
}

/** A card's width / height: square in the Square layout, else its cover's own shape. */
export function cardRatio(e: LibraryEntry, layout: Layout): number {
  if (layout === "square") return 1;
  if (e.type === "stack") {
    const c = coverOf(e.items);
    return c ? tileRatio(c.g) : 1;
  }
  const g = e.g;
  return g.status === "succeeded" ? (isLayered(g) ? Math.max(tileRatio(g), 0.8) : tileRatio(g)) : Math.max(tileRatio(g), 0.8);
}

const LIST_MENU ="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-background hover:text-foreground";

const idsOf = (e: LibraryEntry) => (e.type === "single" ? [e.g.id] : e.items.map((g) => g.id));

/** A run's state in a Library list row: on this install's GPUs, the words its tile says. */
export function listStatus(g: Pick<Generation, "status" | "place">): string {
  if (g.status === "canceled") return "Canceled";
  if (g.place === "pool") return g.status === "failed" ? "Didn't come out right" : g.status === "queued" ? POOL_WORDS.inLine : POOL_WORDS.working;
  return g.status === "failed" ? "Failed" : g.status === "queued" ? "Queued" : "Rendering";
}

/**
 * A run's cover while it goes or after it failed. An account's own GPU or key: what came back (small) and the way out
 * (Start your pod, Check my GPU, Replace key…), the buttons kept in view first (the words give way on a small card).
 * `small`: a list row's thumbnail (the row's own text says the rest).
 */
export function StatusCover({ g, small, actionable }: { g: Generation; small?: boolean; /** The account's own Library: the buttons act (Pick another model opens the run's studio with it). */ actionable?: boolean }) {
  // On this install's GPUs (hosted runs): the words of its tile, in line with its place and wait, then working.
  const pool = g.place === "pool";
  if (g.status === "queued" || g.status === "running") {
    const pct = g.progress != null ? Math.round(g.progress * 100) : null;
    const { label, place } = pendingWords(g);
    const waiting = g.status === "queued" ? g.waiting : undefined;
    return (
      <div className="relative size-full bg-muted">
        <div className="skeleton-sweep absolute inset-0 animate-skeleton" />
        {!small && (
          <div className="absolute inset-x-0 bottom-0 space-y-1 p-3">
            <p className="flex items-center gap-1.5 text-[13px] font-medium">
              <Loader2 aria-hidden data-run-spinner className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
              <span className="shimmer-text animate-shimmer-text truncate">{label}</span>
            </p>
            {place && <p className="truncate text-[11px] text-muted-foreground">{place}</p>}
            <p className="font-mono text-[11px] text-muted-foreground">
              {pct != null ? `${pct}% · ` : ""}
              {elapsed(g.createdAt)}
            </p>
            {/* Waiting for its own GPU or key: what helps meanwhile (it goes on by itself). */}
            {waiting &&
              (actionable ? (
                <RunTroubleActions g={g} actions={waiting.actions} skip={["retry"]} max={2} compact />
              ) : (
                <TroubleActions actions={waiting.actions} skip={["retry", "run-with-key"]} max={2} compact />
              ))}
          </div>
        )}
      </div>
    );
  }
  if (small) return <div className="size-full border border-dashed bg-background" />;
  const trouble = g.status === "failed" ? g.trouble : undefined;
  return (
    <div className="flex size-full flex-col justify-between gap-2 border border-dashed bg-background p-3">
      <div className="flex min-h-0 flex-col gap-1 overflow-hidden">
        {pool && g.status === "failed" ? (
          // One plain sentence, as its tile says it.
          <p className="line-clamp-5 shrink-0 text-[13px] leading-snug font-medium break-words">{g.error || POOL_WORDS.failed}</p>
        ) : (
          <>
            <p className="shrink-0 text-[13px] font-medium">{g.status === "canceled" ? "Canceled" : "Couldn't generate this one"}</p>
            {g.error && <p className="line-clamp-3 text-[12px] leading-snug break-words text-muted-foreground @[16rem]:line-clamp-4">{g.error}</p>}
          </>
        )}
        {/* The details line goes first when the card is small. */}
        {trouble && <TroubleDetails details={trouble.details} className="hidden @[16rem]:block" />}
      </div>
      {trouble &&
        (actionable ? (
          <RunTroubleActions g={g} className="shrink-0" actions={trouble.actions} skip={["retry"]} max={2} compact context="run" />
        ) : (
          <TroubleActions className="shrink-0" actions={trouble.actions} skip={["retry"]} max={2} compact />
        ))}
    </div>
  );
}

function Cover({ g, fit }: { g: Generation; fit: boolean }) {
  if (g.status !== "succeeded" || !g.outputs.length) return <StatusCover g={g} actionable={!g.deletedAt} />;
  if (isLayered(g)) return <LayersStack g={g} />;
  return <MediaThumb output={g.outputs[0]} g={g} fit={fit} className={cn(fit && "bg-muted")} />;
}

function SelectDot({ selected, visible, onToggle, label }: { selected: boolean; visible: boolean; onToggle: (shift: boolean) => void; label: string }) {
  return (
    <button
      role="checkbox"
      aria-checked={selected}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(e.shiftKey);
      }}
      className={cn(
        "absolute top-2 left-2 z-10 grid size-6 place-items-center rounded-full border-2 transition-opacity",
        selected ? "border-primary bg-primary text-primary-foreground" : "border-white/90 bg-black/25 text-transparent backdrop-blur",
        visible || selected ? "opacity-100" : "opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100",
      )}
    >
      <Check className="size-3.5" strokeWidth={3} />
    </button>
  );
}

export const AssetCard = memo(function AssetCard({
  entry,
  layout,
  fit,
  selecting,
  selected,
  expanded,
  api,
}: {
  entry: LibraryEntry;
  layout: Layout;
  fit: boolean;
  selecting: boolean;
  selected: boolean;
  expanded?: boolean;
  api: CardApi;
}) {
  const canHover = useCanHover();
  const [hot, setHot] = useState<false | "bar" | "menu">(false);
  const stack = entry.type === "stack" ? entry : null;
  const cover = useMemo(() => (stack ? coverOf(stack.items) : null), [stack]);
  const g = stack ? (cover?.g ?? stack.items[0]) : (entry as Extract<LibraryEntry, { type: "single" }>).g;
  const ids = useMemo(() => idsOf(entry), [entry]);
  const title = stack ? stack.title : userTitle(g);
  const trashed = !!g.deletedAt;
  const done = g.status === "succeeded" && g.outputs.length > 0;
  const ratio = cardRatio(entry, layout);

  // A run that is still going, failed or was stopped has nothing to open yet: its card shows why, with no pointer or hover.
  const acts = selecting || !!stack || done;
  const activate = (shift: boolean) => {
    if (selecting) api.toggle(entry.key, ids, shift);
    else if (stack) api.expand(entry.key);
    else if (done) api.open(g, 0);
  };
  // The card handles mouse clicks; keyboards and screen readers use this button over it, a sibling of
  // the card's other buttons (none sits inside another). It lets the pointer through to the media.
  const target = (
    <button
      type="button"
      aria-label={stack ? `${title} — ${stack.label}` : selecting ? `Select “${title}”` : done ? `Open “${title}”` : `${title} — ${cardStateWords(g.status)}`}
      aria-pressed={selecting ? selected : undefined}
      aria-expanded={stack && !selecting ? !!expanded : undefined}
      onClick={(e) => {
        e.stopPropagation();
        activate(e.shiftKey);
      }}
      onKeyDown={(e) => {
        // Shift+Enter extends a selection like a shift-click.
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();
        activate(e.shiftKey);
      }}
      className="pointer-events-none absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    />
  );
  const common = {
    onClick: (e: React.MouseEvent) => activate(e.shiftKey),
    draggable: canHover && !trashed,
    onDragStart: (e: React.DragEvent) => {
      const dragged = api.dragIds(ids);
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragged));
      e.dataTransfer.setData("text/plain", `${dragged.length} item${dragged.length === 1 ? "" : "s"}`);
      e.dataTransfer.effectAllowed = "move";
    },
    onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && !hot && setHot("bar"),
    onFocus: () => canHover && !hot && setHot("bar"),
  };
  const showActions = !selecting && !stack && done;
  // Audio keeps its player at the bottom of the card: its actions go along the top.
  const audio = done && !stack && g.outputs[0].kind === "audio";
  const count = shownOutputs(g).length;
  // Touch screens: just a ⋯ button that opens every action (at the top for audio, by the badges).
  const touchMenu =
    showActions &&
    !canHover &&
    (hot === "menu" ? (
      <TileActions g={g} index={0} opts={api.runner} menuOnly className={audio ? undefined : "absolute right-2 bottom-2"} />
    ) : (
      <button
        aria-label="More actions"
        onClick={(e) => {
          e.stopPropagation();
          setHot("menu");
        }}
        className={cn("grid size-8 place-items-center rounded-lg bg-black/45 text-white backdrop-blur", !audio && "absolute right-2 bottom-2")}
      >
        <MoreHorizontal className="size-4" />
      </button>
    ));
  const badges = (
    <>
      <div className={cn("absolute top-2 right-2 flex items-center gap-1.5", audio && canHover && "group-focus-within/card:opacity-0 group-hover/card:opacity-0")}>
        {!stack && !trashed && <ReviewBadge narrow status={g.review} />}
        {!stack && count > 1 && !isLayered(g) && <span className="rounded-full bg-black/55 px-1.5 py-0.5 font-mono text-[11px] text-white backdrop-blur">×{count}</span>}
        {g.pinnedAt && !stack && !trashed && (
          <span className="grid size-5 place-items-center rounded-full bg-black/55 text-white backdrop-blur" title="Pinned">
            <Pin className="size-3" aria-label="Pinned" />
          </span>
        )}
        {g.favorite && !stack && <Heart className="m-0.5 size-4 fill-highlight text-highlight drop-shadow" />}
        {audio && touchMenu}
      </div>
      {trashed && (
        <span className="absolute bottom-2 left-2 rounded-full bg-background/85 px-2 py-0.5 text-[11px] font-medium backdrop-blur">
          {trashDaysLeft(g.deletedAt!)} days left
        </span>
      )}
    </>
  );
  const actions = canHover
    ? showActions &&
      hot === "bar" && (
        <TileActions
          g={g}
          index={0}
          opts={api.runner}
          tone={audio ? "surface" : "media"}
          className={cn(
            // Audio: clear of the select dot in the corner.
            audio ? "absolute inset-x-0 top-0 p-2 pl-10" : "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 pt-8",
            "opacity-0 transition-opacity duration-100 group-focus-within/card:opacity-100 group-hover/card:opacity-100",
          )}
        />
      )
    : !audio && touchMenu;

  if (layout === "list") {
    return (
      <div
        {...common}
        className={cn("group/card relative flex min-h-16 items-center gap-3 rounded-xl px-2 py-2", acts && "cursor-pointer hover:bg-accent", selected && "bg-brand-faint hover:bg-brand-faint-hover")}
      >
        {target}
        <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
          {stack ? cover ? <SmallThumb output={cover.o} g={cover.g} /> : <StatusCover g={g} small /> : done ? <SmallThumb output={g.outputs[0]} g={g} /> : <StatusCover g={g} small />}
          <SelectDot selected={selected} visible={selecting} onToggle={(s) => api.toggle(entry.key, ids, s)} label={`Select ${title}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[14px] font-medium">{title}</span>
            {g.pinnedAt && !stack && !trashed && <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="Pinned" />}
            {!stack && !trashed && <ReviewBadge status={g.review} className="bg-muted" />}
            {!stack && !selecting && <PlaceholderChip g={g} className="h-6 shrink-0 px-2 text-[11px]" />}
          </p>
          <p className="truncate text-[12px] text-muted-foreground">
            {stack ? `${stack.label} · ` : `${g.modelName ?? g.modelId} · ${OPERATION_LABELS[g.op]} · `}
            {trashed ? `${trashDaysLeft(g.deletedAt!)} days left in Trash` : timeAgo(g.createdAt)}
            {/* "Rendering", as the Status filter calls it: "In progress" is a review status. */}
            {!stack && g.status !== "succeeded" && ` · ${listStatus(g)}`}
          </p>
          {/* What made a run of Auto ("Auto · made with Ideogram 4"), and what changed while it ran ("Made with Krea 2 Realism · Ideogram 4 declined this one"). */}
          {!stack && autoLine(g) && <p className="truncate text-[12px] text-muted-foreground">{autoLine(g)}</p>}
          {!stack && g.request.notice && <p className="truncate text-[12px] text-muted-foreground">{g.request.notice}</p>}
          {/* An account's own GPU or key: the way out, in the row (its thumbnail is too small for it). */}
          {!stack && !trashed && (g.status === "failed" ? g.trouble : g.status === "queued" ? g.waiting : undefined) && (
            <RunTroubleActions g={g} className="mt-1" actions={(g.status === "failed" ? g.trouble : g.waiting)!.actions} skip={["retry"]} max={1} compact context={g.status === "failed" ? "run" : "other"} />
          )}
        </div>
        {g.favorite && !stack && <Heart className="size-4 shrink-0 fill-highlight text-highlight" />}
        {stack && <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />}
        {!stack && (g.status === "failed" || g.status === "canceled") && !trashed && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              api.retry(g);
            }}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-secondary px-2.5 text-[12px] font-medium hover:bg-accent"
          >
            <RotateCcw className="size-3" /> Retry
          </button>
        )}
        {showActions &&
          (hot === "menu" ? (
            <TileActions g={g} index={0} opts={api.runner} menuOnly triggerClassName={LIST_MENU} />
          ) : (
            <button
              aria-label="More actions"
              onClick={(e) => {
                e.stopPropagation();
                setHot("menu");
              }}
              className={LIST_MENU}
            >
              <MoreHorizontal className="size-4" />
            </button>
          ))}
      </div>
    );
  }

  return (
    <div className="group/card relative">
      {stack && (
        // The stack look: two sheets peeking out behind the cover.
        <>
          <div className="absolute inset-x-3 -top-1.5 h-4 rounded-xl bg-border" aria-hidden />
          <div className="absolute inset-x-1.5 -top-0.75 h-4 rounded-xl bg-border-strong" aria-hidden />
        </>
      )}
      <div
        {...common}
        className={cn(
          "@container relative w-full overflow-hidden rounded-xl bg-muted transition-[box-shadow]",
          acts && "cursor-pointer",
          !selecting && done && !stack && "cursor-zoom-in",
          selected && "ring-3 ring-primary",
          expanded && "ring-2 ring-border-strong",
        )}
        style={{ aspectRatio: ratio }}
      >
        {stack ? cover ? <MediaThumb output={cover.o} g={cover.g} fit={fit} /> : <StatusCover g={g} /> : <Cover g={g} fit={fit} />}
        {target}
        {selected && <div className="pointer-events-none absolute inset-0 bg-primary/15" />}
        {stack && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-3 pt-10 text-white">
            <p className="line-clamp-2 font-heading text-[17px] leading-snug">{title}</p>
            <p className="mt-0.5 flex items-center gap-1 text-[12px] text-white/80">
              <Layers className="size-3" /> {stack.label}
            </p>
          </div>
        )}
        {badges}
        {/* A placeholder says so on the card, past the select dot (not while selecting: a tap there selects). */}
        {!stack && done && !selecting && !trashed && (
          <PlaceholderChip g={g} overlay className={cn("absolute top-2", audio && canHover && "group-focus-within/card:opacity-0 group-hover/card:opacity-0 focus-within:opacity-100! has-data-[state=open]:opacity-100!")} />
        )}
        <SelectDot selected={selected} visible={selecting} onToggle={(s) => api.toggle(entry.key, ids, s)} label={`Select ${title}`} />
        {actions}
        {!stack && (g.status === "failed" || g.status === "canceled") && !trashed && !selecting && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              api.retry(g);
            }}
            className="absolute bottom-2 left-2 inline-flex h-7 items-center gap-1.5 rounded-full bg-secondary px-2.5 text-[12px] font-medium hover:bg-accent"
          >
            <RotateCcw className="size-3" /> Retry
          </button>
        )}
      </div>
    </div>
  );
});
