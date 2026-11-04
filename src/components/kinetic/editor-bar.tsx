"use client";

import { ArrowLeft, Check, Expand, LayoutGrid, MoreHorizontal, Redo2, Shrink, Undo2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { KINETIC_SCENES, type KineticEntry } from "@/lib/motion/kinetic-catalog";
import { cn } from "@/lib/utils";
import { iconButton } from "./controls";

/** The editor's bar: back to all scenes, the scene's name, Undo and Redo, Large preview (desktop) and More. */
export function EditorBar({
  entry,
  onBack,
  onScene,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  large,
  onLarge,
  onVersions,
  onExport,
}: {
  entry: KineticEntry;
  onBack: () => void;
  onScene: (e: KineticEntry) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  large: boolean;
  onLarge: (v: boolean) => void;
  onVersions: () => void;
  onExport: () => void;
}) {
  return (
    <div className="flex h-14 min-w-0 items-center gap-1 border-b bg-background px-2 sm:px-3" data-kinetic-bar>
      <button type="button" onClick={onBack} className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
        <ArrowLeft className="size-4" /> <span className="hidden sm:inline">All scenes</span>
        <span className="sr-only sm:hidden">All scenes</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring xl:hidden" aria-label="Scenes">
            <LayoutGrid className="size-4" /> <span className="hidden md:inline">Scenes</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {KINETIC_SCENES.map((e) => (
            <DropdownMenuItem key={e.slug} onSelect={() => onScene(e)} className="min-h-11 gap-2">
              <Check className={cn("size-4", e.slug === entry.slug ? "opacity-100" : "opacity-0")} />
              {e.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <h1 className="min-w-0 flex-1 truncate px-1 font-heading text-[18px] leading-tight sm:text-[20px]">{entry.name}</h1>
      <button type="button" onClick={onUndo} disabled={!canUndo} aria-label="Undo" className={iconButton}>
        <Undo2 className="size-4" />
      </button>
      <button type="button" onClick={onRedo} disabled={!canRedo} aria-label="Redo" className={iconButton}>
        <Redo2 className="size-4" />
      </button>
      <button type="button" onClick={() => onLarge(!large)} aria-pressed={large} aria-label="Large preview" className={cn(iconButton, "hidden lg:grid")}>
        {large ? <Shrink className="size-4" /> : <Expand className="size-4" />}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="More" className={iconButton}>
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-[12px]">{entry.name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onVersions} className="min-h-11">
            Versions
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onExport} className="min-h-11">
            Export options
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
