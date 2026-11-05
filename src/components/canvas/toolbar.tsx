"use client";

import { ArrowUpRight, Circle, Copy, Eraser, Group, Hand, MessageCircle, MousePointer2, MoreHorizontal, Pencil, Plus, Square, StickyNote, Table, Trash2, Type, type LucideIcon } from "lucide-react";
import { memo, useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { onAttr, TAB_PILL, TabRow } from "@/components/ui/tab-row";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BOARD_LIMITS, SHAPE_LABEL, type BoardColor } from "@/lib/catalog/canvas-board";
import { useModKey } from "@/lib/keys";
import { cn } from "@/lib/utils";
import { BOARD_COLOR_VAR, Swatches } from "./board";

/** What a drag or click on the board does (the parity studio's toolbar: V, H, D, E, N, ⇧T, R, T, C). */
export type Tool = "select" | "hand" | "draw" | "erase" | "note" | "table" | "shape" | "text" | "comment";
export type DragShape = "rect" | "ellipse" | "arrow";

export const TOOL_KEYS: Record<string, Tool> = { v: "select", h: "hand", d: "draw", e: "erase", n: "note", r: "shape", t: "text", c: "comment" };

const TOOLS: { tool: Tool; label: string; key: string; icon: LucideIcon; hint: string }[] = [
  { tool: "select", label: "Select", key: "V", icon: MousePointer2, hint: "Drag to select · scroll or hold Space to pan · pinch or ⌘-scroll to zoom" },
  { tool: "hand", label: "Pan", key: "H", icon: Hand, hint: "Drag to move around the board" },
  { tool: "draw", label: "Draw", key: "D", icon: Pencil, hint: "Draw freehand on the board" },
  { tool: "erase", label: "Eraser", key: "E", icon: Eraser, hint: "Drag over drawings and shapes to erase them" },
  { tool: "note", label: "Sticky note", key: "N", icon: StickyNote, hint: "Click to place a note (Enter: in the middle)" },
  { tool: "table", label: "Table", key: "⇧T", icon: Table, hint: "Click to place a table: what it feeds runs once per row" },
  { tool: "shape", label: "Shapes", key: "R", icon: Square, hint: "Drag to draw a shape (Enter: in the middle)" },
  { tool: "text", label: "Text", key: "T", icon: Type, hint: "Click to write on the board (Enter: in the middle)" },
  { tool: "comment", label: "Comment", key: "C", icon: MessageCircle, hint: "Click to pin a comment (Enter: in the middle)" },
];

const SHAPE_ICON: Record<DragShape, LucideIcon> = { rect: Square, ellipse: Circle, arrow: ArrowUpRight };

/** Tools that draw with a colour. */
const INKED = new Set<Tool>(["draw", "shape", "text"]);

export const BoardToolbar = memo(function BoardToolbar({
  tool,
  setTool,
  shape,
  setShape,
  ink,
  setInk,
  selected,
  onGroup,
}: {
  tool: Tool;
  setTool: (t: Tool) => void;
  shape: DragShape;
  setShape: (s: DragShape) => void;
  ink: BoardColor;
  setInk: (c: BoardColor) => void;
  /** Nodes selected that a group could frame. */
  selected: number;
  onGroup: () => void;
}) {
  const mod = useModKey();
  return (
    <div className="flex items-center gap-0.5 rounded-full border bg-popover p-1 shadow-normal" role="toolbar" aria-label="Board tools" data-board-ui>
      {TOOLS.map((t, i) => {
        const Icon = t.tool === "shape" ? SHAPE_ICON[shape] : t.icon;
        const active = tool === t.tool;
        return (
          <div key={t.tool} className="flex items-center">
            {(i === 2 || i === 4 || i === 8) && <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setTool(t.tool)}
                  aria-pressed={active}
                  aria-label={`${t.tool === "shape" ? SHAPE_LABEL[shape] : t.label} (${t.key})`}
                  className={cn("grid size-8 place-items-center rounded-full transition-colors", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
                >
                  <Icon className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {t.tool === "shape" ? SHAPE_LABEL[shape] : t.label} <Kbd>{t.key}</Kbd>
                <span className="block text-[11px] opacity-80">{t.hint}</span>
              </TooltipContent>
            </Tooltip>
            {t.tool === "shape" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="-ml-1 grid h-8 w-4 place-items-center rounded-full text-muted-foreground hover:text-foreground" aria-label="Pick a shape">
                    <span className="text-[9px]">▾</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" side="top">
                  {(Object.keys(SHAPE_ICON) as DragShape[]).map((k) => {
                    const I = SHAPE_ICON[k];
                    return (
                      <DropdownMenuItem
                        key={k}
                        onSelect={() => {
                          setShape(k);
                          setTool("shape");
                        }}
                      >
                        <I className="size-4" /> {SHAPE_LABEL[k]}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        );
      })}
      {INKED.has(tool) && (
        <Popover>
          <PopoverTrigger asChild>
            <button className="ml-0.5 grid size-8 place-items-center rounded-full hover:bg-accent" aria-label="Colour">
              <span className="size-4 rounded-full ring-2 ring-border" style={{ background: BOARD_COLOR_VAR[ink] }} />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" className="w-auto rounded-full p-1.5">
            <Swatches value={ink} onChange={setInk} />
          </PopoverContent>
        </Popover>
      )}
      {selected > 0 && (
        <>
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={onGroup} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium hover:bg-accent">
                <Group className="size-4" /> Group
              </button>
            </TooltipTrigger>
            <TooltipContent>
              Frame the {selected === 1 ? "selected node" : `${selected} selected nodes`}: they move and run together <Kbd>{mod}</Kbd>
              <Kbd>G</Kbd>
            </TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Pages

export interface PageOps {
  switchTo: (id: string) => void;
  add: () => void;
  rename: (id: string, name: string) => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
}

/** The id of a page's tab (the board is the tabpanel it labels). */
export const pageTabId = (id: string) => `canvas-page-tab-${id}`;
export const PAGE_PANEL_ID = "canvas-page-panel";

/**
 * The canvas's pages as tabs: each its own board. Double-click a tab to rename it. One tab is in the Tab order
 * (the open page); the arrow keys, Home and End move between tabs and open them.
 */
export const PageTabs = memo(function PageTabs({ pages, active, ops, readOnly }: { pages: { id: string; name: string }[]; active: string; ops: PageOps; readOnly: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const full = pages.length >= BOARD_LIMITS.pages;
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const at = pages.findIndex((p) => p.id === active);
    const to = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? pages.length - 1 : null;
    if (to === null || at < 0 || !(e.target as HTMLElement).matches("[role='tab']")) return;
    e.preventDefault();
    const next = pages[(to + pages.length) % pages.length];
    ops.switchTo(next.id);
    requestAnimationFrame(() => document.getElementById(pageTabId(next.id))?.focus());
  };
  return (
    <div className="flex max-w-full items-center gap-0.5 rounded-full border bg-popover p-1 shadow-normal" data-board-ui>
      <TabRow fade={false} role="tablist" aria-label="Pages" onKeyDown={onKeyDown}>
        {pages.map((p) =>
          editing === p.id ? (
            <input
              key={p.id}
              autoFocus
              defaultValue={p.name}
              maxLength={60}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => {
                setEditing(null);
                const v = e.currentTarget.value.trim();
                if (v && v !== p.name) ops.rename(p.id, v);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditing(null);
                e.stopPropagation();
              }}
              aria-label="Page name"
              className="h-9 w-32 shrink-0 rounded-full border bg-background px-3.5 text-[13.5px] outline-none focus:border-primary"
            />
          ) : (
            <button
              key={p.id}
              id={pageTabId(p.id)}
              role="tab"
              aria-selected={p.id === active}
              aria-controls={PAGE_PANEL_ID}
              tabIndex={p.id === active ? 0 : -1}
              onClick={() => ops.switchTo(p.id)}
              onDoubleClick={() => !readOnly && setEditing(p.id)}
              title={readOnly ? p.name : `${p.name} · double-click to rename`}
              className={cn(TAB_PILL, "max-w-36")}
              {...onAttr(p.id === active)}
            >
              <span className="truncate">{p.name}</span>
            </button>
          ),
        )}
      </TabRow>
      {!readOnly && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Page actions">
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => setTimeout(() => setEditing(active), 0)}>
                <Pencil className="size-4" /> Rename page
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => ops.duplicate(active)} disabled={full}>
                <Copy className="size-4" /> Duplicate page
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => ops.remove(active)} disabled={pages.length < 2}>
                <Trash2 className="size-4" /> Delete page
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={ops.add} disabled={full} className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40" aria-label="Add a page">
                <Plus className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{full ? `A canvas holds up to ${BOARD_LIMITS.pages} pages` : "Add a page: a board of its own"}</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
});
