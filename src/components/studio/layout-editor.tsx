"use client";

import { ArrowDownToLine, ClipboardCopy, FileJson, FlaskConical, Import, Plus, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { copyWithToast } from "@/lib/clipboard";
import type { ModelDef } from "@/lib/catalog/types";
import { boxesAt, drawnBox, inkOn, keyResizedBox, KIND_COLOR, movedBox, newBox, nudgedBox, pickBox, resizedBox, type Handle } from "@/lib/layout-edit";
import { layoutCompilerFor, parseLayout, readsBoxes, type LayoutBox, type LayoutCanvas as CanvasType, type LayoutDraft, type LayoutItem, type LayoutLabel, type LayoutSource } from "@/lib/layout-prompt";
import { cn } from "@/lib/utils";
import { radioKeys, radioTab } from "./radio-keys";

/**
 * The Layout editor (Image studio, Layout mode): the picture's canvas in its aspect ratio, a box drawn per element and
 * one row per box (an object, a character or exact words). Built like the sketch editor (a dialog over the composer);
 * the box maths is src/lib/layout-edit.ts. Desktop: the rows beside the canvas. Phones: the canvas on top and the rows
 * in a sheet under it; boxes drag by touch (pointer events, no page scroll on the canvas).
 */

export interface LayoutEditorResult {
  layout: LayoutDraft;
  /** The whole picture in words: the composer's prompt. */
  caption: string;
  aspect?: string;
}

/** The size a canvas renders at, for the editor's pixels, the compiled prompt and the size line. */
export interface EditorCanvas {
  width: number;
  height: number;
  asked: { width: number; height: number };
  exact: boolean;
}

const LABELS: { value: LayoutLabel; label: string }[] = [
  { value: "object", label: "Object" },
  { value: "character", label: "Character" },
  { value: "text", label: "Text" },
];
const CANVASES: { value: CanvasType; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "multi_panel", label: "Panels" },
  { value: "collage", label: "Collage" },
];
/** Box outlines by kind when a box has no colour of its own. */
const SOURCE_WORDS: Record<LayoutSource, string> = {
  fuobe: "a Fuobe layout",
  linxce: "a ComfyUI layout draft",
  compiled: "a MOSS-Image prompt",
  scene: "a scene prompt",
  elements: "bounding boxes",
};
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLE_POS: Record<Handle, string> = {
  nw: "left-0 top-0 cursor-nwse-resize",
  n: "left-1/2 top-0 cursor-ns-resize",
  ne: "left-full top-0 cursor-nesw-resize",
  e: "left-full top-1/2 cursor-ew-resize",
  se: "left-full top-full cursor-nwse-resize",
  s: "left-1/2 top-full cursor-ns-resize",
  sw: "left-0 top-full cursor-nesw-resize",
  w: "left-0 top-1/2 cursor-ew-resize",
};

const ratioOf = (aspect: string | undefined) => {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect ?? "");
  return m ? Number(m[1]) / Number(m[2]) : 1;
};
const colorOf = (it: LayoutItem) => it.color ?? KIND_COLOR[it.label];
const pct = (v: number) => `${v * 100}%`;
/** Typing focus: keys there edit text, not boxes. */
const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function LayoutEditor(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  layout: LayoutDraft;
  caption: string;
  aspect: string | undefined;
  /** The aspect ratios the model offers (the canvas can change shape here). */
  aspects?: string[];
  /** The canvas the model renders for an aspect ratio. */
  canvasFor: (aspect: string | undefined) => EditorCanvas;
  model?: ModelDef;
  onDone: (r: LayoutEditorResult) => void;
}) {
  const content = useRef<HTMLDivElement>(null);
  const escapeRef = useRef<() => boolean>(() => false);
  // Closing the editor any way (Escape, a press outside it) keeps what was drawn, as Done does: there is no Cancel.
  const keepRef = useRef<() => void>(() => {});
  return (
    <Dialog
      open={props.open}
      onOpenChange={(o) => {
        if (!o) keepRef.current();
        props.onOpenChange(o);
      }}
    >
      <DialogContent
        ref={content}
        showCloseButton={false}
        aria-describedby="layout-editor-hint"
        className="flex h-[100svh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 outline-none sm:h-[min(92vh,880px)] sm:w-[min(96vw,1180px)] sm:max-w-none sm:rounded-xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          content.current?.focus();
        }}
        onEscapeKeyDown={(e) => {
          if (escapeRef.current()) e.preventDefault();
        }}
      >
        {props.open && <LayoutBoard {...props} escapeRef={escapeRef} keepRef={keepRef} />}
      </DialogContent>
    </Dialog>
  );
}

type Drag =
  | { mode: "draw"; x0: number; y0: number; x1: number; y1: number; id: number; min: number }
  | { mode: "move"; index: number; box: LayoutBox; sx: number; sy: number; moved: boolean; id: number; before: LayoutItem[] }
  | { mode: "resize"; index: number; box: LayoutBox; handle: Handle; sx: number; sy: number; id: number; before: LayoutItem[] };

/** What Undo goes back to (the editor's own: a toast behind the dialog can't be pressed). */
interface Snapshot {
  items: LayoutItem[];
  caption: string;
  tags: string;
  canvasType: CanvasType;
  aspect: string;
}

function LayoutBoard({
  onOpenChange,
  layout,
  caption: startCaption,
  aspect: startAspect,
  aspects,
  canvasFor,
  model,
  onDone,
  escapeRef,
  keepRef,
}: Parameters<typeof LayoutEditor>[0] & { escapeRef: React.RefObject<() => boolean>; keepRef: React.RefObject<() => void> }) {
  const [items, setItems] = useState<LayoutItem[]>(layout.items);
  const [canvasType, setCanvasType] = useState<CanvasType>(layout.summary.canvas);
  const [tags, setTags] = useState(layout.summary.meta.join(", "));
  const [caption, setCaption] = useState(startCaption);
  const [aspect, setAspect] = useState(startAspect ?? layout.aspect ?? "1:1");
  const [selected, setSelected] = useState<number | null>(layout.items.length ? 0 : null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [importing, setImporting] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const board = useRef<HTMLDivElement>(null);
  const lastPress = useRef<{ x: number; y: number } | null>(null);
  const size = canvasFor(aspect);
  const ratio = ratioOf(aspect);

  const draft = useMemo<LayoutDraft>(
    () => ({
      summary: {
        caption: caption.trim(),
        meta: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        canvas: canvasType,
        ...(layout.summary.palette?.length && { palette: layout.summary.palette }),
      },
      items,
      aspect,
    }),
    [caption, tags, canvasType, items, aspect, layout.summary.palette],
  );

  // Escape first closes Import, then lets go of a selected box, then closes the editor (which keeps the boxes, as Done does).
  useEffect(() => {
    escapeRef.current = () => {
      if (importing) return (setImporting(false), true);
      if (selected !== null) return (setSelected(null), true);
      return false;
    };
  }, [escapeRef, importing, selected]);

  const keep = () => onDone({ layout: { ...draft, summary: { ...draft.summary, caption: "" } }, caption, aspect });
  useEffect(() => {
    keepRef.current = keep;
  });
  const finish = () => {
    keep();
    onOpenChange(false);
  };

  const patch = (i: number, p: Partial<LayoutItem>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  /** Keep the state before a change Undo can take back (drawing, moving, resizing, removing, importing). */
  const remember = (over: Partial<Snapshot> = {}) => setHistory((h) => [...h.slice(-49), { items, caption, tags, canvasType, aspect, ...over }]);
  const undo = () => {
    const last = history.at(-1);
    if (!last) return;
    setHistory(history.slice(0, -1));
    setItems(last.items);
    setCaption(last.caption);
    setTags(last.tags);
    setCanvasType(last.canvasType);
    setAspect(last.aspect);
    setSelected((s) => (s !== null && s < last.items.length ? s : null));
  };
  const remove = (i: number) => {
    remember();
    setItems((xs) => xs.filter((_, j) => j !== i));
    setSelected((s) => (s === null ? null : s === i ? (items.length > 1 ? Math.max(0, i - 1) : null) : s > i ? s - 1 : s));
  };
  const add = (box: LayoutBox) => {
    remember();
    setItems((xs) => [...xs, { label: "object", caption: "", box }]);
    setSelected(items.length);
    setSheetOpen(true);
  };

  /** The smallest box a drag draws, in canvas pixels: 8 px on screen (a tap's drift on a phone isn't a box). */
  const minDrawn = () => (8 * size.width) / (board.current?.getBoundingClientRect().width || size.width);

  /** Pointer position in canvas pixels. */
  const at = (e: React.PointerEvent) => {
    const r = board.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * size.width, y: ((e.clientY - r.top) / r.height) * size.height, sx: e.clientX, sy: e.clientY };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const handle = (e.target as HTMLElement).closest<HTMLElement>("[data-handle]")?.dataset.handle as Handle | undefined;
    const p = at(e);
    board.current?.setPointerCapture(e.pointerId);
    if (handle && selected !== null) {
      setDrag({ mode: "resize", index: selected, box: items[selected].box, handle, sx: p.x, sy: p.y, id: e.pointerId, before: items });
      return;
    }
    // A box's number tab picks that box; elsewhere a press picks from the boxes under it (again on the same spot: the next one down).
    // Shift or Alt draws a new box even over others (a headline on a product).
    const tab = (e.target as HTMLElement).closest<HTMLElement>("[data-box-tab]")?.dataset.boxTab;
    const stack =
      e.shiftKey || e.altKey
        ? []
        : boxesAt(
            items.map((x) => x.box),
            p.x / size.width,
            p.y / size.height,
          );
    const again = !!lastPress.current && Math.hypot(lastPress.current.x - p.sx, lastPress.current.y - p.sy) < 6;
    const picked = tab !== undefined ? Number(tab) : pickBox(stack, selected, again);
    if (picked === null) {
      lastPress.current = null;
      setSelected(null);
      setDrag({ mode: "draw", x0: p.x, y0: p.y, x1: p.x, y1: p.y, id: e.pointerId, min: minDrawn() });
      return;
    }
    setSelected(picked);
    setDrag({ mode: "move", index: picked, box: items[picked].box, sx: p.x, sy: p.y, moved: false, id: e.pointerId, before: items });
    lastPress.current = { x: p.sx, y: p.sy };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.id !== e.pointerId) return;
    const p = at(e);
    if (drag.mode === "draw") return setDrag({ ...drag, x1: p.x, y1: p.y });
    const dx = p.x - drag.sx;
    const dy = p.y - drag.sy;
    if (drag.mode === "move") {
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      if (!drag.moved) setDrag({ ...drag, moved: true });
      patch(drag.index, { box: movedBox(drag.box, dx, dy, size.width, size.height) });
      return;
    }
    patch(drag.index, { box: resizedBox(drag.box, drag.handle, dx, dy, size.width, size.height) });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.id !== e.pointerId) return;
    if (drag.mode === "draw") {
      const box = drawnBox(drag.x0, drag.y0, drag.x1, drag.y1, size.width, size.height, drag.min);
      if (box) add(box);
    }
    // A drag isn't a press on the same spot: the next press there picks the top box again.
    if (drag.mode === "move" && drag.moved) lastPress.current = null;
    if (drag.mode !== "draw" && drag.before[drag.index]?.box !== items[drag.index]?.box) remember({ items: drag.before });
    setDrag(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (typing(e.target)) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      return undo();
    }
    if (selected === null || !items[selected]) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(selected);
      // The box's tab had focus and goes with it: the canvas keeps it, so the keys go on working.
      board.current?.focus();
      return;
    }
    const box = e.altKey ? keyResizedBox(items[selected].box, e.key, e.shiftKey, size.width, size.height) : nudgedBox(items[selected].box, e.key, e.shiftKey, size.width, size.height);
    if (box) {
      e.preventDefault();
      // Undo takes back a nudge or a resize (a held key is one step).
      if (!e.repeat) remember();
      patch(selected, { box });
    }
  };

  const ghost = drag?.mode === "draw" ? drawnBox(drag.x0, drag.y0, drag.x1, drag.y1, size.width, size.height, drag.min) : null;
  const compiled = () => layoutCompilerFor(model)(draft, size.width, size.height).prompt;
  const textErrors = items.map((it) => it.label === "text" && !it.text?.trim());
  const reads = !model || readsBoxes(model);

  const importText = (text: string): boolean => {
    const parsed = parseLayout(text, { width: size.width, height: size.height });
    if (!parsed) {
      toast.error("No layout found there: paste a Fuobe or ComfyUI layout, a MOSS-Image prompt or bounding boxes");
      return false;
    }
    remember();
    const own = parsed.draft.aspect && aspects?.includes(parsed.draft.aspect) ? parsed.draft.aspect : undefined;
    setItems(parsed.draft.items);
    if (parsed.draft.summary.caption.trim()) setCaption(parsed.draft.summary.caption.trim());
    if (parsed.draft.summary.meta.length) setTags(parsed.draft.summary.meta.join(", "));
    setCanvasType(parsed.draft.summary.canvas);
    if (own) setAspect(own);
    setSelected(parsed.draft.items.length ? 0 : null);
    const n = parsed.draft.items.length;
    toast(`Imported ${n} box${n === 1 ? "" : "es"} from ${SOURCE_WORDS[parsed.from]} · Undo is under the canvas`, { id: "layout-import" });
    return true;
  };

  const rows = (
    <div className="space-y-3">
      <div className="space-y-2 rounded-xl border p-3">
        <label htmlFor="layout-caption" className="text-[12px] font-medium">
          The whole picture
        </label>
        <Textarea id="layout-caption" value={caption} onChange={(e) => setCaption(e.target.value)} rows={2} placeholder="A warm autumn sale poster for a candle shop" className="min-h-0 resize-none text-[13px]" />
        <div className="flex flex-wrap items-center gap-2">
          <span id="layout-canvas-label" className="text-[12px] text-muted-foreground">
            Canvas
          </span>
          <Segmented label="Canvas" labelledBy="layout-canvas-label" options={CANVASES} value={canvasType} onChange={setCanvasType} />
        </div>
        <Input aria-label="Style tags (optional, comma separated)" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Style tags (optional): poster, flat design" className="h-8 text-[13px]" />
      </div>
      {items.length === 0 && <p className="px-1 text-[13px] text-muted-foreground">Drag on the picture to draw a box for each thing to place: a headline, a product, a person.</p>}
      {items.map((it, i) => (
        <BoxRow
          key={i}
          index={i}
          item={it}
          selected={selected === i}
          error={textErrors[i]}
          onSelect={() => setSelected(i)}
          onChange={(p) => patch(i, p)}
          onRemove={() => remove(i)}
        />
      ))}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2 sm:px-4">
        <DialogTitle className="font-heading text-[18px] font-normal">Layout</DialogTitle>
        <Badge variant="secondary" className="h-5 gap-1 rounded-full px-2 text-[11px]">
          <FlaskConical className="size-3" /> Experimental
        </Badge>
        <div className="ml-auto flex items-center gap-1.5">
          {aspects && aspects.length > 1 && (
            <select
              aria-label="Aspect ratio"
              value={aspect}
              onChange={(e) => setAspect(e.target.value)}
              className="h-8 rounded-full border bg-background px-2.5 text-[13px] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {/* Auto is a square canvas here; it stays listed only while it is the choice, so the select shows what is drawn. */}
              {aspects
                .filter((a) => a !== "auto" || aspect === "auto")
                .map((a) => (
                  <option key={a} value={a}>
                    {a === "auto" ? "Auto (square canvas)" : a}
                  </option>
                ))}
            </select>
          )}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="h-8 rounded-full px-3 text-[13px]">
                <FileJson className="size-3.5" /> Import / Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onSelect={() => setImporting(true)}>
                <Import /> Import a layout…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!items.length} onSelect={() => void copyWithToast(compiled(), `${model?.name ?? "Model"} prompt copied`)}>
                <ClipboardCopy /> Copy the compiled prompt
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copyWithToast(JSON.stringify(draft, null, 2), "Layout copied")}>
                <ClipboardCopy /> Copy the layout (JSON)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => downloadJson(draft)}>
                <ArrowDownToLine /> Download the layout (.json)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" className="h-8 rounded-full px-4" onClick={finish}>
            Done
          </Button>
        </div>
        <DialogDescription id="layout-editor-hint" className="w-full text-[12px] leading-snug text-muted-foreground max-sm:sr-only">
          Drag to draw a box, then say what goes in it; hold Shift to draw over another box. With a box picked, arrow keys move it, Alt+arrows resize it (Shift for bigger steps) and Delete removes it. Layout prompts are experimental in MOSS-Image&apos;s own guide: boxes guide the picture, they don&apos;t pin it.
        </DialogDescription>
      </header>

      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        {/* The canvas, in the picture's shape. */}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-muted/40 p-3 sm:p-5">
          <div className="relative flex min-h-0 w-full flex-1 items-center justify-center" style={{ containerType: "size" }}>
            <div
              ref={board}
              role="application"
              aria-label={`Layout canvas, ${size.width} by ${size.height}: drag to draw a box (Shift to draw over another). With a box picked, arrow keys move it, Alt with arrow keys resizes it and Delete removes it.`}
              tabIndex={0}
              data-layout-canvas
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={onKeyDown}
              className="relative touch-none rounded-md border-2 border-dashed border-border-strong bg-background bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:33.333%_33.333%] select-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
              style={{ aspectRatio: `${ratio}`, width: `min(100cqw, calc(100cqh * ${ratio}))` }}
            >
              {items.map((it, i) => (
                <div
                  key={i}
                  data-layout-box={i + 1}
                  className={cn("absolute rounded-[3px] border-2", selected === i ? "z-10 shadow-[0_0_0_2px_var(--background)]" : "opacity-90")}
                  style={{ left: pct(it.box[0]), top: pct(it.box[1]), width: pct(it.box[2] - it.box[0]), height: pct(it.box[3] - it.box[1]), borderColor: colorOf(it), background: `color-mix(in oklab, ${colorOf(it)} 14%, transparent)` }}
                >
                  <button
                    type="button"
                    data-box-tab={i}
                    onFocus={() => setSelected(i)}
                    onClick={() => setSelected(i)}
                    aria-label={`Box ${i + 1}: ${it.label === "text" ? `the words ${it.text || "(not typed yet)"}` : it.caption || it.label}`}
                    aria-pressed={selected === i}
                    className="absolute bottom-full -left-0.5 flex h-5 min-w-5 items-center justify-center rounded-t-md px-1.5 text-[11px] leading-none font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:min-w-7"
                    style={{ background: colorOf(it), color: inkOn(colorOf(it)) }}
                  >
                    {i + 1}
                  </button>
                  <span className="pointer-events-none absolute inset-x-1.5 top-1 line-clamp-2 text-[11px] leading-tight break-words text-foreground/80">
                    {it.label === "text" ? (it.text ? `“${it.text}”` : "") : it.caption}
                  </span>
                  {selected === i &&
                    HANDLES.map((h) => (
                      <span
                        key={h}
                        data-handle={h}
                        aria-hidden
                        className={cn("absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-background [@media(pointer:coarse)]:size-5", HANDLE_POS[h])}
                        style={{ borderColor: colorOf(it) }}
                      />
                    ))}
                </div>
              ))}
              {ghost && (
                <div
                  className="pointer-events-none absolute rounded-[3px] border-2 border-dashed border-primary bg-primary/10"
                  style={{ left: pct(ghost[0]), top: pct(ghost[1]), width: pct(ghost[2] - ghost[0]), height: pct(ghost[3] - ghost[1]) }}
                />
              )}
              {!items.length && !ghost && (
                <p className="pointer-events-none absolute inset-0 grid place-items-center p-4 text-center text-[13px] text-muted-foreground">Drag here to draw your first box</p>
              )}
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[12px]" onClick={() => add(newBox(items.length))}>
              <Plus className="size-3.5" /> Add box
            </Button>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[12px]" onClick={undo} disabled={!history.length} aria-keyshortcuts="Control+Z Meta+Z">
              <Undo2 className="size-3.5" /> Undo
            </Button>
            <span className="tabular-nums">
              {aspect} · {size.exact ? "" : "about "}
              {size.width} × {size.height}
            </span>
            {!reads && <span>This model reads the layout as words, not exact positions.</span>}
          </div>
        </div>

        {/* The rows: beside the canvas on desktop, in a sheet under it on phones. */}
        <aside
          aria-label="Boxes"
          className={cn(
            "flex min-h-0 flex-col border-t bg-popover max-sm:rounded-t-2xl max-sm:shadow-strong sm:w-[380px] sm:border-t-0 sm:border-l",
            // A fixed height on phones, so the canvas keeps its size while rows come and go.
            sheetOpen ? "max-sm:h-[46svh]" : "max-sm:h-12",
          )}
        >
          <button
            type="button"
            onClick={() => setSheetOpen((v) => !v)}
            aria-expanded={sheetOpen}
            className="relative flex h-12 shrink-0 items-center gap-2 px-4 pt-1.5 text-left text-[13px] font-medium sm:hidden"
          >
            <span aria-hidden className="absolute top-1.5 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-border-strong" />
            {items.length ? `${items.length} box${items.length === 1 ? "" : "es"}` : "No boxes yet"}
            {selected !== null && <span className="text-muted-foreground">· box {selected + 1} picked</span>}
            <span className="ml-auto text-[12px] text-brand-text">{sheetOpen ? "Hide" : "Show"}</span>
          </button>
          <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4", !sheetOpen && "max-sm:hidden")}>
            {importing ? <ImportPanel onImport={(t) => importText(t) && setImporting(false)} onCancel={() => setImporting(false)} /> : rows}
          </div>
        </aside>
      </div>
    </div>
  );
}

function downloadJson(draft: LayoutDraft) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "layout.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Segmented<T extends string>({ label, labelledBy, options, value, onChange }: { label: string; labelledBy?: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy} onKeyDown={radioKeys} className="inline-flex rounded-full bg-muted p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={radioTab(on)}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-7 rounded-full px-2.5 text-[12px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
              on ? "bg-background text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function BoxRow({
  index,
  item,
  selected,
  error,
  onSelect,
  onChange,
  onRemove,
}: {
  index: number;
  item: LayoutItem;
  selected: boolean;
  error: boolean;
  onSelect: () => void;
  onChange: (p: Partial<LayoutItem>) => void;
  onRemove: () => void;
}) {
  const n = index + 1;
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <div
      ref={row}
      data-layout-row={n}
      onFocusCapture={onSelect}
      onPointerDown={onSelect}
      className={cn("space-y-2 rounded-xl border p-3 transition-colors", selected ? "border-primary bg-brand-faint/50" : "hover:border-border-strong")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-md text-[12px] font-semibold" style={{ background: colorOf(item), color: inkOn(colorOf(item)) }} aria-hidden>
          {n}
        </span>
        <Segmented label={`Box ${n} is`} options={LABELS} value={item.label} onChange={(label) => onChange({ label, ...(label === "text" ? { text: item.text ?? "" } : {}) })} />
        <button type="button" onClick={onRemove} aria-label={`Remove box ${n}`} className="ml-auto grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <Input aria-label={`Box ${n}: what it looks like`} value={item.caption} onChange={(e) => onChange({ caption: e.target.value })} placeholder="What it looks like" className="h-8 text-[13px]" />
      {item.label === "text" && (
        <div>
          <Input
            aria-label={`Box ${n}: exact words`}
            aria-invalid={error}
            aria-describedby={error ? `layout-words-${n}` : undefined}
            value={item.text ?? ""}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder="Exact words, e.g. 30% OFF"
            className="h-8 text-[13px]"
          />
          {error && (
            <p id={`layout-words-${n}`} className="mt-1 text-[12px] text-destructive">
              Type the words for box {n}
            </p>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <label className="inline-flex items-center gap-1.5">
          <input
            type="color"
            value={item.color ?? KIND_COLOR[item.label]}
            onChange={(e) => onChange({ color: e.target.value })}
            aria-label={`Box ${n}: colour on the canvas (optional)`}
            className="size-6 cursor-pointer rounded border bg-transparent p-0"
          />
          Colour (optional, only on this canvas)
        </label>
        {item.color && (
          <button type="button" onClick={() => onChange({ color: undefined })} className="inline-flex items-center gap-0.5 underline-offset-2 hover:text-foreground hover:underline">
            <X className="size-3" /> Clear
          </button>
        )}
      </div>
    </div>
  );
}

function ImportPanel({ onImport, onCancel }: { onImport: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <p className="text-[13px] font-medium">Import a layout</p>
      <p className="text-[12px] leading-snug text-muted-foreground">
        Paste a Fuobe layout, a ComfyUI layout draft, a MOSS-Image prompt (read on this canvas), a scene prompt or CreateBoundingBoxes boxes. It replaces the boxes here.
      </p>
      <Textarea aria-label="Layout to import" value={text} onChange={(e) => setText(e.target.value)} rows={8} className="font-mono text-[12px]" placeholder='{"summary": …, "items": […]}' />
      <input
        ref={file}
        type="file"
        accept=".json,.txt,application/json,text/plain"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) setText(await f.text());
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onImport(text)} disabled={!text.trim()}>
          Import
        </Button>
        <Button size="sm" variant="secondary" onClick={() => file.current?.click()}>
          From a file…
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
