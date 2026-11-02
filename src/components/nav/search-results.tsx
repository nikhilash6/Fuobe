"use client";

import { Command as CommandPrimitive } from "cmdk";
import { ChevronRight, Clapperboard, CornerDownLeft, Film, LayoutGrid, Play, Wand2 } from "lucide-react";
import { MediaThumb } from "@/components/studio/result-media";
import type { Generation } from "@/lib/catalog/types";
import { userTitle } from "@/lib/library";
import type { NavEntry } from "@/lib/nav-model";
import type { NavHit } from "@/lib/nav-search";
import { cn } from "@/lib/utils";
import { CoverThumb } from "./cover-thumb";

/*
 * The search palette's rows and tiles. Each is a cmdk item (role="option"), so the arrow keys reach every one of them
 * from the search field, and Enter opens the selected one. The cover boxes have fixed sizes: nothing moves when a
 * picture arrives.
 */

/** A section's heading, as the launcher's columns have them. */
export const sectionHeading =
  "**:[[cmdk-group-heading]]:mb-1.5 **:[[cmdk-group-heading]]:ml-1.5 **:[[cmdk-group-heading]]:text-[11px] **:[[cmdk-group-heading]]:leading-[14px] **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:uppercase **:[[cmdk-group-heading]]:tracking-[.08em] **:[[cmdk-group-heading]]:text-brand-text";

/** A selected row: a tint and a brand ring strong enough to find (focus stays in the field; cmdk marks it data-selected). */
const selected = "data-[selected=true]:bg-accent data-[selected=true]:shadow-[inset_0_0_0_1.5px_var(--brand-text)]";

/** What kind of thing a hit is, as the tag at the end of its row says it. */
export function kindTag(hit: Pick<NavHit, "kind" | "navKind">): string {
  switch (hit.kind) {
    case "studio":
      return "Studio";
    case "tool":
      return "Tool";
    case "app":
      return "App";
    case "motion":
      return "Motion";
    case "effect":
      return "Effect";
    case "model":
      return "Model";
    case "skill":
      return "Skill";
    case "setting":
      return "Settings";
    case "recent":
      return "Recent";
  }
  return hit.navKind === "create" ? "Create" : hit.navKind === "action" ? "Action" : "Page";
}

const KIND_ICON = { app: LayoutGrid, motion: Film, effect: Wand2, model: Clapperboard, skill: Play } as const;

/** A hit's picture: its nav cover, an index preset's own small cover, or its icon on the muted fill. */
function HitCover({ hit, size }: { hit: NavHit; size: "thumb" | "chip" | "row" }) {
  if (hit.cover?.startsWith("/")) {
    const box = { thumb: "h-12 w-16 rounded-[8px]", chip: "h-[42px] w-14 rounded-[8px]", row: "h-[27px] w-9 rounded-[6px]" }[size];
    const [w, h] = { thumb: [64, 48], chip: [56, 42], row: [36, 27] }[size];
    return (
      <span aria-hidden className={cn("relative block shrink-0 overflow-hidden bg-muted", box)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- versioned static covers, sized by the box */}
        <img src={hit.cover} width={w} height={h} alt="" loading="lazy" decoding="async" draggable={false} className="absolute inset-0 size-full object-cover" />
      </span>
    );
  }
  // A nav entry: its cover, else its icon (CoverThumb draws either in the same box).
  if (hit.cover || hit.icon) return <CoverThumb id={hit.cover} size={size} icon={hit.icon} />;
  const Icon = KIND_ICON[hit.kind as keyof typeof KIND_ICON] ?? LayoutGrid;
  const box = { thumb: "h-12 w-16 rounded-[8px]", chip: "h-[42px] w-14 rounded-[8px]", row: "h-[27px] w-9 rounded-[6px]" }[size];
  return (
    <span aria-hidden className={cn("relative grid shrink-0 place-items-center bg-muted text-muted-foreground", box)}>
      <Icon className="size-4" />
    </span>
  );
}

function Tag({ hit }: { hit: NavHit }) {
  const studio = hit.kind === "studio";
  return (
    <span
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center rounded-full px-2.5 text-[11.5px] font-medium",
        studio ? "bg-brand-faint text-brand-text" : "bg-secondary text-secondary-foreground",
      )}
    >
      {kindTag(hit)}
    </span>
  );
}

/** The Enter keycap on the selected best match. */
function EnterCap() {
  return (
    <span
      aria-hidden
      className="hidden h-[22px] w-[26px] shrink-0 items-center justify-center rounded-md border border-b-2 border-border bg-background group-data-[selected=true]/hit:inline-flex [@media(hover:none)]:hidden!"
    >
      <CornerDownLeft className="size-3" />
    </span>
  );
}

/** A tool's studio before its name ("Audio › Clean up voice"), or a preset's gallery ("Camera motions › Dolly In"). */
function Name({ hit, crumb, className }: { hit: NavHit; crumb?: string; className?: string }) {
  return (
    <span className={cn("block truncate", className)}>
      {crumb && (
        <>
          <span className="font-medium text-muted-foreground">{crumb}</span>
          <ChevronRight aria-hidden className="mx-1 inline size-3 align-[-1px] text-muted-foreground" />
        </>
      )}
      {hit.label}
    </span>
  );
}

const crumbOf = (hit: NavHit) => hit.from ?? (hit.kind === "tool" ? hit.hint : undefined);

/** A best match: a 64x48 cover, its name and line, what it is, and the Enter keycap when selected. */
export function BestRow({ hit, onPick }: { hit: NavHit; onPick: (h: NavHit) => void }) {
  return (
    <CommandPrimitive.Item
      value={hit.key}
      onSelect={() => onPick(hit)}
      className={cn("group/hit flex h-[58px] cursor-pointer items-center gap-3.5 rounded-xl py-[5px] pr-3 pl-[5px] outline-none", selected)}
    >
      <HitCover hit={hit} size="thumb" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Name hit={hit} crumb={crumbOf(hit)} className="text-[14.5px] font-semibold" />
        <span className="truncate text-[12.5px] text-muted-foreground">{hit.what ?? hit.hint}</span>
      </span>
      <Tag hit={hit} />
      <EnterCap />
    </CommandPrimitive.Item>
  );
}

/** "Also try": a preset tile with where it comes from. */
export function AlsoTile({ hit, onPick }: { hit: NavHit; onPick: (h: NavHit) => void }) {
  return (
    <CommandPrimitive.Item
      value={hit.key}
      onSelect={() => onPick(hit)}
      className={cn("group/hit flex h-14 min-w-0 cursor-pointer items-center gap-3 rounded-xl py-[5px] pr-3 pl-[5px] outline-none", selected)}
    >
      <HitCover hit={hit} size="chip" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Name hit={hit} crumb={crumbOf(hit)} className="text-[14px] font-semibold" />
        <span className="truncate text-[12.5px] text-muted-foreground">{hit.what ?? hit.hint}</span>
      </span>
      <Tag hit={hit} />
    </CommandPrimitive.Item>
  );
}

/** Any other match, in its kind's group. */
export function HitRow({ hit, onPick }: { hit: NavHit; onPick: (h: NavHit) => void }) {
  return (
    <CommandPrimitive.Item
      value={hit.key}
      onSelect={() => onPick(hit)}
      className={cn("group/hit flex h-11 cursor-pointer items-center gap-3 rounded-[10px] pr-3 pl-1 text-[14px] outline-none", selected)}
    >
      <HitCover hit={hit} size="row" />
      <Name hit={hit} crumb={hit.kind === "tool" ? hit.hint : undefined} className="min-w-0 flex-1 font-medium" />
      {hit.kind !== "tool" && (hit.what ?? hit.hint) && (
        <span className="max-w-[45%] shrink-0 truncate pl-2 text-[12px] text-muted-foreground max-sm:hidden">{hit.what ?? hit.hint}</span>
      )}
    </CommandPrimitive.Item>
  );
}

/** A studio in "Every studio": a 36x27 cover and its name (the short one on a phone), on up to two lines. */
export function StudioTile({ e, onPick }: { e: NavEntry; onPick: (e: NavEntry) => void }) {
  return (
    <CommandPrimitive.Item
      value={`tile:${e.id}`}
      keywords={[e.label]}
      onSelect={() => onPick(e)}
      className={cn("group/hit flex h-11 min-w-0 cursor-pointer items-center gap-2.5 rounded-[10px] pr-2 pl-1 outline-none md:h-10", selected)}
    >
      <CoverThumb id={e.cover} size="row" icon={e.icon} />
      <span className="line-clamp-2 min-w-0 text-[13px] leading-[1.2] font-medium text-foreground">
        <span className="md:hidden">{e.short ?? e.label}</span>
        <span className="max-md:hidden">{e.label}</span>
      </span>
    </CommandPrimitive.Item>
  );
}

/** A recent creation: its picture, its title and the model that made it. Opens the viewer. */
export function RecentRow({ g, onOpen }: { g: Generation; onOpen: (g: Generation) => void }) {
  return (
    <CommandPrimitive.Item
      value={`recent:${g.id}`}
      onSelect={() => onOpen(g)}
      className={cn("group/hit flex h-14 min-w-0 cursor-pointer items-center gap-3 rounded-xl py-1 pr-3 pl-1 outline-none", selected)}
    >
      <span aria-hidden className="relative h-12 w-16 shrink-0 overflow-hidden rounded-[8px] bg-muted">
        {g.outputs[0] && <MediaThumb output={g.outputs[0]} g={g} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[14px] font-semibold">{userTitle(g)}</span>
        <span className="truncate text-[12.5px] text-muted-foreground">{g.modelName}</span>
      </span>
    </CommandPrimitive.Item>
  );
}
