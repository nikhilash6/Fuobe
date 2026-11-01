"use client";

import { Brush, Eraser, Loader2, Redo2, RotateCcw, Type, Undo2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { uploadFile } from "@/lib/api";
import type { MotionPaths } from "@/lib/motion-paths";
import { keyCombo, useModKey } from "@/lib/keys";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";

/**
 * Paint on top of an image.
 * - "mask": paint the area to change (Inpaint). Exports a black/white mask plus a red overlay
 *   preview, so models without a mask input can still be told where to edit.
 * - "draw": scribble arrows, shapes and notes in colour (Draw to Edit / Draw to Video).
 *   Exports the annotated image.
 */
export type SketchMode = "mask" | "draw";

export type Stroke =
  | { type: "path"; points: [number, number][]; size: number; color: string; erase: boolean }
  | { type: "text"; at: [number, number]; text: string; size: number; color: string };

type PathStroke = Extract<Stroke, { type: "path" }>;

export interface SketchResult {
  /** mask mode: white = change. */
  mask?: string;
  /** mask mode: the image with the painted area tinted red. draw mode: the annotated image. */
  overlay: string;
  /** Small preview for the composer chip. */
  preview: string;
  /** draw mode: every brush stroke as a motion path, normalised to the image (Wan-Move draw-to-video). */
  motion?: MotionPaths;
  /** The strokes, in image pixels, so the drawing can be reopened and touched up. */
  strokes: Stroke[];
}

const COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#ffffff", "#111111"];
const MASK_TINT = "rgba(255, 59, 48, 0.55)";
const MASK_RED = "rgba(255,59,48,1)";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't load the image"));
    img.src = src;
  });
}

function pathStyle(ctx: CanvasRenderingContext2D, s: PathStroke, mode: SketchMode, scale: number, forMask: boolean) {
  ctx.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
  ctx.strokeStyle = forMask ? "#ffffff" : mode === "mask" ? MASK_RED : s.color;
  ctx.lineWidth = s.size * scale;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

/** Draw points [from, end) of a path (plus the joint before `from`), so a live stroke grows segment by segment. */
function drawPath(ctx: CanvasRenderingContext2D, s: PathStroke, mode: SketchMode, scale: number, from = 0, forMask = false) {
  const pts = s.points;
  if (!pts.length || from >= pts.length) return;
  pathStyle(ctx, s, mode, scale, forMask);
  ctx.beginPath();
  const start = Math.max(0, from - 1);
  ctx.moveTo(pts[start][0] * scale, pts[start][1] * scale);
  for (let i = start + 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * scale, pts[i][1] * scale);
  if (pts.length === 1) ctx.lineTo(pts[0][0] * scale + 0.01, pts[0][1] * scale);
  ctx.stroke();
  ctx.globalCompositeOperation = "source-over";
}

function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], mode: SketchMode, scale: number, forMask = false) {
  for (const s of strokes) {
    if (s.type === "text") {
      if (forMask) continue;
      ctx.globalCompositeOperation = "source-over";
      ctx.font = `600 ${s.size * scale}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textBaseline = "top";
      ctx.lineWidth = Math.max(2, s.size * scale * 0.12);
      ctx.strokeStyle = s.color === "#111111" ? "#ffffff" : "#000000";
      ctx.strokeText(s.text, s.at[0] * scale, s.at[1] * scale);
      ctx.fillStyle = s.color;
      ctx.fillText(s.text, s.at[0] * scale, s.at[1] * scale);
      continue;
    }
    drawPath(ctx, s, mode, scale, 0, forMask);
  }
  ctx.globalCompositeOperation = "source-over";
}

async function canvasToFile(c: HTMLCanvasElement, name: string): Promise<File> {
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
  if (!blob) throw new Error("Couldn't export the drawing");
  return new File([blob], name, { type: "image/png" });
}

function ToolBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Brush; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          aria-pressed={active}
          className={cn(
            "grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            active && "bg-brand-faint text-brand-text",
          )}
          aria-label={label}
        >
          <Icon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function SketchEditor(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  image: string;
  mode: SketchMode;
  /** Strokes of the drawing being touched up (empty for a new one). */
  initialStrokes?: Stroke[];
  onDone: (r: SketchResult) => void;
}) {
  // The canvas answers Escape first: it closes an open note instead of the whole editor.
  const escapeRef = useRef<() => boolean>(() => false);
  const content = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        ref={content}
        className="flex h-[min(92vh,880px)] w-[min(96vw,1100px)] max-w-none flex-col gap-3 outline-none sm:max-w-none"
        // Focus the editor itself, not the first tool: a tool's tooltip would open on focus and eat the first Escape.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          content.current?.focus();
        }}
        onEscapeKeyDown={(e) => {
          if (escapeRef.current()) e.preventDefault();
        }}
      >
        {props.open && <SketchCanvas {...props} escapeRef={escapeRef} />}
      </DialogContent>
    </Dialog>
  );
}

function SketchCanvas({
  onOpenChange,
  image,
  mode,
  initialStrokes,
  onDone,
  escapeRef,
}: {
  onOpenChange: (o: boolean) => void;
  image: string;
  mode: SketchMode;
  initialStrokes?: Stroke[];
  onDone: (r: SketchResult) => void;
  escapeRef: React.RefObject<() => boolean>;
}) {
  const mod = useModKey();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const ring = useRef<HTMLSpanElement>(null);
  /** Offscreen paint layer at screen resolution: committed strokes plus the live one, opaque. */
  const layer = useRef<HTMLCanvasElement | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [strokes, setStrokes] = useState<Stroke[]>(() => initialStrokes ?? []);
  const [redo, setRedo] = useState<Stroke[]>([]);
  const [tool, setTool] = useState<"brush" | "eraser" | "text">("brush");
  const [size, setSize] = useState(mode === "mask" ? 48 : 10);
  const [color, setColor] = useState(COLORS[0]);
  const [saving, setSaving] = useState(false);
  const drawing = useRef<PathStroke | null>(null);
  /** How many points of the live stroke are already on the layer. */
  const drawn = useRef(0);
  const frame = useRef(0);
  const [note, setNote] = useState<{ at: [number, number]; text: string } | null>(null);
  const noteOpen = useRef(false);

  useEffect(() => {
    loadImage(image).then(setImg, (e) => toastError(e));
  }, [image]);

  // Fit the image into the available area; strokes are stored in image pixels.
  useEffect(() => {
    if (!img || !wrap.current) return;
    const fit = () => {
      const box = wrap.current!.getBoundingClientRect();
      const s = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight, 1.5);
      setView({ w: Math.round(img.naturalWidth * s), h: Math.round(img.naturalHeight * s) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [img]);

  const scale = img && view.w ? view.w / img.naturalWidth : 1;

  /** Show the paint layer: mask paint is tinted at a constant alpha so overlapping strokes don't stack. */
  const composite = useCallback(() => {
    const c = canvas.current;
    const l = layer.current;
    if (!c || !l) return;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.globalAlpha = mode === "mask" ? 0.55 : 1;
    ctx.drawImage(l, 0, 0);
    ctx.globalAlpha = 1;
  }, [mode]);

  /** Repaint the layer from scratch (after undo/redo/clear/commit or a resize): once per change, not per pointer move. */
  const rebuild = useCallback(() => {
    const l = layer.current;
    if (!l) return;
    const dpr = l.width / Math.max(1, view.w);
    const ctx = l.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, l.width, l.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStrokes(ctx, strokes, mode, scale);
    if (drawing.current) {
      drawPath(ctx, drawing.current, mode, scale);
      drawn.current = drawing.current.points.length;
    }
    composite();
  }, [strokes, mode, scale, view.w, composite]);

  // Size the canvases only when the layout changes (resetting width/height reallocates the backing store).
  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c || !view.w) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(view.w * dpr);
    c.height = Math.round(view.h * dpr);
    layer.current ??= document.createElement("canvas");
    layer.current.width = c.width;
    layer.current.height = c.height;
  }, [view.w, view.h, img]);

  useLayoutEffect(() => {
    rebuild();
  }, [rebuild]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /** Draw the live stroke's new points on the layer, at most once per frame. */
  const flush = useCallback(() => {
    frame.current = 0;
    const l = layer.current;
    const d = drawing.current;
    if (!l || !d) return;
    const dpr = l.width / Math.max(1, view.w);
    const ctx = l.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPath(ctx, d, mode, scale, drawn.current);
    drawn.current = d.points.length;
    composite();
  }, [mode, scale, view.w, composite]);

  const schedule = () => {
    if (!frame.current) frame.current = requestAnimationFrame(flush);
  };

  const pos = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
  };

  const commit = (s: Stroke) => {
    setStrokes((x) => [...x, s]);
    setRedo([]);
  };

  const commitNote = () => {
    if (note?.text.trim()) commit({ type: "text", at: note.at, text: note.text.trim().slice(0, 80), size: Math.max(18, size * 2.4) / scale, color });
    setNote(null);
  };

  useEffect(() => {
    noteOpen.current = !!note;
  }, [note]);

  // Escape while writing a note cancels the note; the editor stays open with its strokes.
  useEffect(() => {
    escapeRef.current = () => {
      if (!noteOpen.current) return false;
      setNote(null);
      return true;
    };
    return () => {
      escapeRef.current = () => false;
    };
  }, [escapeRef]);

  const moveRing = (e: React.PointerEvent) => {
    const el = ring.current;
    const c = canvas.current;
    if (!el || !c) return;
    const r = c.getBoundingClientRect();
    el.style.opacity = tool === "text" ? "0" : "1";
    el.style.transform = `translate(${e.clientX - r.left - size / 2}px, ${e.clientY - r.top - size / 2}px)`;
  };

  const onDown = (e: React.PointerEvent) => {
    if (tool === "text") {
      // A click elsewhere keeps the note you were writing, then starts a new one there.
      commitNote();
      setNote({ at: pos(e), text: "" });
      return;
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drawing.current = { type: "path", points: [pos(e)], size: size / scale, color, erase: tool === "eraser" };
    drawn.current = 0;
    schedule();
  };
  const onMove = (e: React.PointerEvent) => {
    moveRing(e);
    const d = drawing.current;
    if (!d) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e]) d.points.push(pos(ev));
    schedule();
  };
  const onUp = () => {
    const d = drawing.current;
    if (!d) return;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    drawing.current = null;
    commit(d);
  };

  const undo = () => {
    setStrokes((x) => {
      if (!x.length) return x;
      setRedo((r) => [...r, x[x.length - 1]]);
      return x.slice(0, -1);
    });
  };
  const redoOne = () => {
    setRedo((r) => {
      if (!r.length) return r;
      setStrokes((x) => [...x, r[r.length - 1]]);
      return r.slice(0, -1);
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redoOne();
        else undo();
      } else if (e.metaKey || e.ctrlKey || e.altKey) return;
      else if (e.key === "b") setTool("brush");
      else if (e.key === "e") setTool("eraser");
      else if (e.key === "t" && mode === "draw") setTool("text");
      else if (e.key === "[") setSize((s) => Math.max(2, s - 4));
      else if (e.key === "]") setSize((s) => Math.min(200, s + 4));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const hasPaint = strokes.some((s) => s.type === "text" || !s.erase);

  const save = async () => {
    if (!img) return;
    setSaving(true);
    try {
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      const make = () => {
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        return [c, c.getContext("2d")!] as const;
      };
      let maskUrl: string | undefined;
      const [ov, octx] = make();
      octx.drawImage(img, 0, 0, W, H);
      if (mode === "mask") {
        const [paintC, pctx] = make();
        drawStrokes(pctx, strokes, mode, 1, true);
        // Mask: black background, white where painted.
        const [mask, mctx] = make();
        mctx.fillStyle = "#000";
        mctx.fillRect(0, 0, W, H);
        mctx.drawImage(paintC, 0, 0);
        maskUrl = (await uploadFile(await canvasToFile(mask, "mask.png"))).url;
        // Overlay: original + red tint where painted.
        const [tint, tctx] = make();
        tctx.drawImage(paintC, 0, 0);
        tctx.globalCompositeOperation = "source-in";
        tctx.fillStyle = MASK_TINT;
        tctx.fillRect(0, 0, W, H);
        octx.drawImage(tint, 0, 0);
      } else {
        // Draw on a transparent layer first so the eraser removes paint, not the photo.
        const [paintC, pctx] = make();
        drawStrokes(pctx, strokes, mode, 1);
        octx.drawImage(paintC, 0, 0);
      }
      const overlay = await uploadFile(await canvasToFile(ov, mode === "mask" ? "mask-overlay.png" : "sketch.png"));
      const motion: MotionPaths | undefined =
        mode === "draw"
          ? {
              aspect: [W, H],
              paths: strokes.flatMap((st) => (st.type === "path" && !st.erase && st.points.length > 1 ? [st.points.map(([x, y]) => [x / W, y / H] as [number, number])] : [])),
            }
          : undefined;
      onDone({ mask: maskUrl, overlay: overlay.url, preview: overlay.url, motion, strokes });
      onOpenChange(false);
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{mode === "mask" ? "Paint what should change" : "Draw your edit"}</DialogTitle>
        <DialogDescription>
          {mode === "mask"
            ? "Brush over the area to replace. Everything you don't paint stays as it is."
            : "Sketch arrows, shapes or write short notes — the model follows them and removes the marks."}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-1.5">
        <ToolBtn active={tool === "brush"} onClick={() => setTool("brush")} icon={Brush} label="Brush (B)" />
        <ToolBtn active={tool === "eraser"} onClick={() => setTool("eraser")} icon={Eraser} label="Eraser (E)" />
        {mode === "draw" && <ToolBtn active={tool === "text"} onClick={() => setTool("text")} icon={Type} label="Add a note (T)" />}
        <div className="mx-2 flex w-40 items-center gap-2">
          <span className="text-[12px] text-muted-foreground">Size</span>
          <Slider value={[size]} min={2} max={200} step={1} onValueChange={([v]) => setSize(v)} aria-label="Brush size" />
        </div>
        {mode === "draw" && (
          <div className="flex items-center gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-pressed={color === c}
                className={cn("size-6 rounded-full border ring-offset-2 ring-offset-background", color === c && "ring-2 ring-primary")}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
              />
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={undo} disabled={!strokes.length} aria-label="Undo">
            <Undo2 />
          </Button>
          <Button variant="ghost" size="icon" onClick={redoOne} disabled={!redo.length} aria-label="Redo">
            <Redo2 />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setStrokes([])} disabled={!strokes.length}>
            <RotateCcw /> Clear
          </Button>
        </div>
      </div>
      <div ref={wrap} className="relative grid min-h-0 flex-1 place-items-center overflow-hidden rounded-lg bg-media">
        {img ? (
          <div className="relative" style={{ width: view.w, height: view.h }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="" className="absolute inset-0 size-full select-none" draggable={false} />
            <canvas
              ref={canvas}
              className={cn("absolute inset-0 size-full touch-none", tool === "text" ? "cursor-text" : "cursor-none")}
              style={{ width: view.w, height: view.h }}
              // Keep focus in the note that pointerdown just opened (the default would move it to the dialog).
              onMouseDown={(e) => tool === "text" && e.preventDefault()}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onPointerLeave={() => ring.current && (ring.current.style.opacity = "0")}
            />
            {note && (
              <input
                autoFocus
                value={note.text}
                onChange={(e) => setNote({ ...note, text: e.target.value })}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") commitNote();
                  if (e.key === "Escape") setNote(null);
                }}
                onBlur={commitNote}
                aria-label="Note text"
                placeholder="Type a note, ↵"
                className="absolute min-w-40 rounded-md border bg-background/95 px-2 py-1 text-sm shadow-normal outline-none"
                style={{ left: note.at[0] * scale, top: note.at[1] * scale, color }}
              />
            )}
            <span
              ref={ring}
              aria-hidden
              className="pointer-events-none absolute top-0 left-0 rounded-full border-2 border-white opacity-0 mix-blend-difference"
              style={{ width: size, height: size }}
            />
          </div>
        ) : (
          <Loader2 className="size-5 animate-spin text-white/70" />
        )}
      </div>
      <DialogFooter className="items-center">
        <p className="mr-auto hidden text-[12px] text-muted-foreground sm:block">[ ] brush size · {keyCombo("Z", { mod })} undo · {keyCombo("Z", { mod, shift: true })} redo{mode === "draw" ? " · T note" : ""}</p>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={save} disabled={!hasPaint || saving}>
          {saving && <Loader2 className="animate-spin" />} {mode === "mask" ? "Use this mask" : "Use this drawing"}
        </Button>
      </DialogFooter>
    </>
  );
}
