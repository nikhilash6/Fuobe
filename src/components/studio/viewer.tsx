"use client";

import { ChevronLeft, ChevronRight, Columns2, Copy, Info, Layers, MoreHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { OPERATION_LABELS, type Generation, type OutputFile } from "@/lib/catalog/types";
import { formatCost, timeAgo } from "@/lib/format";
import { PRESETS as GRADE_PRESETS } from "@/lib/grade";
import { trashDaysLeft, userTitle } from "@/lib/library";
import { editOnlyFormat, isLayered, layerInfo, outputActions, type OutputAction } from "@/lib/output-actions";
import { useEngineMode, useLikelyVisitor } from "@/lib/api";
import { cn } from "@/lib/utils";
import { copyWithToast } from "@/lib/clipboard";
import { CompareSlider } from "./compare-slider";
import { ACTION_ICONS, downloadUrl, SaveElementForm, useActionRunner } from "./result-actions";
import { LayersStack, ModelViewer, TextReader, VideoFileCard } from "./result-media";
import { ReviewSelect } from "@/components/library/review";
import { PlaceholderChip } from "@/components/demo-mode";
import { NextSteps } from "@/components/nav/next-steps";


/** One line of the details; `center` lines the label up with a control (the Review picker) instead of a text value's first line. */
function Row({ label, value, mono, center }: { label: string; value?: React.ReactNode; mono?: boolean; center?: boolean }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className={cn("flex justify-between gap-4 py-1.5 text-[13px]", center && "items-center")}>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 text-right break-words", mono && "font-mono")}>{value}</span>
    </div>
  );
}

/**
 * Keys the viewer leaves alone: typing, browser shortcuts (⌘F, ⌘D…), held-down repeats, a focused
 * player, and keys meant for a picker or menu (the Review picker and ⋯ menus jump to the item you
 * type, R for Rejected, without preventDefault, so R would also Reuse and close the viewer).
 */
function ignoreKey(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented) return true;
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t.isContentEditable || t.closest("input,textarea,select,[contenteditable],[role=combobox],[role=listbox],[role=menu]")) return true;
  // Arrows and space seek / play in a focused <video> or <audio>.
  return !!t.closest("video,audio,model-viewer") && (e.key.startsWith("Arrow") || e.key === " ");
}

/** A text field of an output's meta (a stem's name, a transcript's language), capitalised. */
function metaText(o: OutputFile | undefined, key: string): string | undefined {
  const v = o?.meta?.[key];
  return typeof v === "string" && v ? v[0].toUpperCase() + v.slice(1) : undefined;
}

function Details({ g, index }: { g: Generation; index: number }) {
  const p = g.request.params ?? {};
  const title = userTitle(g);
  if (g.feature === "upload") {
    return (
      <div className="space-y-4">
        <p className="font-heading text-[20px] leading-snug break-words">{title}</p>
        <div className="divide-y rounded-lg border px-3">
          <Row label="Source" value="Your upload" />
          <Row label="Type" value={g.outputs[index]?.contentType} />
          <Row label="Added" value={timeAgo(g.createdAt)} />
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div>
        <p className="font-heading text-[20px] leading-snug">{title}</p>
        {g.prompt && g.prompt !== title && <p className="mt-1 line-clamp-6 text-[12px] leading-relaxed break-words text-muted-foreground">Sent to the model: {g.prompt}</p>}
        {g.prompt && (
          <button
            onClick={() => void copyWithToast(g.prompt ?? "", "Prompt copied")}
            className="mt-1 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <Copy className="size-3" /> Copy prompt
          </button>
        )}
      </div>
      <div className="divide-y rounded-lg border px-3">
        <Row label="Model" value={g.modelName ?? g.modelId} />
        <Row label="Made on" value={g.provider === "mock" ? "Placeholder" : g.provider === "local" ? "In your browser" : g.engine === "open" ? "Your GPU" : "Cloud"} />
        <Row label="Mode" value={OPERATION_LABELS[g.op]} />
        <Row label={g.modelId.startsWith("fuobe-soul") ? "Look" : "Preset"} value={g.presetName} />
        <Row label="Finish" value={finishText(g.outputs[index])} />
        <Row label="Step" value={g.request.step?.label} />
        {isLayered(g) && <Row label="Layer" value={`${layerInfo(g.outputs[index], index).name} · ${index + 1} of ${g.outputs.length}`} />}
        <Row label="Stem" value={metaText(g.outputs[index], "stem")} />
        <Row label="Language" value={metaText(g.outputs[index], "language") ?? p.targetLanguage} />
        <Row label="Aspect ratio" value={p.aspectRatio ?? g.aspectRatio} />
        <Row label="Quality" value={p.resolution} />
        <Row label="Duration" value={p.duration ? `${p.duration}s` : undefined} />
        <Row label="Seed" value={p.seed} mono />
        <Row label="Cost" value={g.costUsd != null ? formatCost(g.costUsd) : undefined} mono />
        <Row label="Made" value={timeAgo(g.createdAt)} />
        {g.deletedAt && <Row label="In Trash" value={`${trashDaysLeft(g.deletedAt)} days left`} />}
        {!g.deletedAt && <Row label="Review" center value={<ReviewSelect g={g} />} />}
      </div>
      {g.request.negativePrompt && <p className="text-[12px] text-muted-foreground">Negative: {g.request.negativePrompt}</p>}
    </div>
  );
}

/** A Fuobe Soul result's post steps: the grade preset and the overlay, applied in the browser (or still to come). */
function finishText(o: OutputFile | undefined): string | undefined {
  const m = o?.meta;
  if (!m || (!m.grade && !m.overlay)) return undefined;
  const grade = typeof m.grade === "string" ? (GRADE_PRESETS.find((p) => p.id === m.grade)?.name ?? m.grade) : undefined;
  const overlay = m.overlay === "date-stamp" ? "date stamp" : m.overlay === "cctv" ? "CCTV caption" : m.overlay === "photo-booth" ? "photo-booth print" : undefined;
  const what = [grade && `${grade} grade`, overlay].filter(Boolean).join(" + ");
  return m.finished ? what : `${what} (applied when it opens in a studio)`;
}

function LayerList({ g, index, all, onPick, onAll }: { g: Generation; index: number; all: boolean; onPick: (i: number) => void; onAll: () => void }) {
  const layers = g.outputs.map((o, i) => ({ o, i, ...layerInfo(o, i) })).sort((a, b) => b.z - a.z);
  const item = "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent";
  return (
    <div className="space-y-1">
      <p className="px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Layers</p>
      <button onClick={onAll} className={cn(item, all && "bg-brand-faint text-brand-text")}>
        <Layers className="size-4" /> All layers
      </button>
      {layers.map((l) => (
        <button key={l.o.url} onClick={() => onPick(l.i)} className={cn(item, !all && index === l.i && "bg-brand-faint text-brand-text")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={l.o.url} alt="" className="checkerboard size-8 shrink-0 rounded object-contain" />
          <span className="min-w-0 truncate">{l.name}</span>
        </button>
      ))}
    </div>
  );
}

export function Viewer({
  generation: g,
  index,
  onClose,
  onPrev,
  onNext,
  onReuse,
  onIndex,
}: {
  generation: Generation;
  index: number;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onReuse?: (g: Generation) => void;
  /** Switch between the outputs of this generation (layers). */
  onIndex?: (index: number) => void;
}) {
  const o = g.outputs[index] ?? g.outputs[0];
  const layered = isLayered(g);
  // Edits, inpaints, upscales and app results can be compared with the image they started from.
  const source = o.kind === "image" && g.op !== "t2i" && !layered ? g.request.inputs?.images?.[0] : undefined;
  const [comparing, setComparing] = useState(false);
  const [allLayers, setAllLayers] = useState(layered);
  const [drawer, setDrawer] = useState(false);
  const [saving, setSaving] = useState(false);
  // A video this browser can't decode (HEVC or 10-bit H.264 on some systems): shown as a file to download instead.
  const [failedVideo, setFailedVideo] = useState<string | null>(null);
  const run = useActionRunner({ onReuse: onReuse && ((x) => (onReuse(x), onClose())), onCompare: () => setComparing((v) => !v), onDeleted: onClose });
  const engineMode = useEngineMode();
  const visitor = useLikelyVisitor();
  const list = useMemo(() => outputActions(g, index, { reuse: !!onReuse, compare: !!source, inViewer: true, engineMode, visitor }), [g, index, onReuse, source, engineMode, visitor]);

  // Read the latest values from the key handler without re-subscribing on every render.
  const latest = useRef({ list, run, g, index, onPrev, onNext, source });
  useEffect(() => {
    latest.current = { list, run, g, index, onPrev, onNext, source };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ignoreKey(e)) return;
      const { list, run, g, index, onPrev, onNext, source } = latest.current;
      const act = (id: OutputAction["id"]) => {
        const a = list.find((x) => x.id === id);
        if (!a) return false;
        if (a.href && a.download !== undefined) downloadUrl(a.href, a.download);
        else run(a, g, index);
        return true;
      };
      const k = e.key.toLowerCase();
      if (e.key === "ArrowLeft" && onPrev) onPrev();
      else if (e.key === "ArrowRight" && onNext) onNext();
      else if (k === "f") act("favorite");
      else if (k === "p") act("pin");
      else if (k === "c" && source) setComparing((v) => !v);
      else if (k === "d") act("download");
      else if (k === "r") act("reuse");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Swipe left / right to browse on touch screens.
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    swipe.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = swipe.current;
    swipe.current = null;
    const t = e.changedTouches[0];
    if (!s || !t || Date.now() - s.t > 600) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) onNext?.();
    else onPrev?.();
  };

  const primary = list.find((a) => a.placement === "primary");
  const bar = list.filter((a) => a.placement === "bar");
  // "Copy prompt" sits under the title in the details, and the review status is picked there too.
  const menu = list.filter((a) => a.placement === "menu" && a.id !== "copy-prompt" && a.id !== "review");

  const actionButton = (a: OutputAction, opts: { variant?: "default" | "secondary" | "ghost"; className?: string; onDone?: () => void } = {}) => {
    const Icon = ACTION_ICONS[a.id];
    const label = a.id === "favorite" ? (g.favorite ? "Favorited" : "Favorite") : a.id === "save-character" ? "Save as element" : a.label;
    const icon = <Icon className={cn(a.id === "favorite" && g.favorite && "fill-current text-highlight")} />;
    const cls = cn(a.destructive && "text-destructive hover:text-destructive", opts.className);
    const variant = a.destructive ? "ghost" : (opts.variant ?? "secondary");
    if (a.href && a.download !== undefined) {
      return (
        <Button key={a.id} asChild variant={variant} size="sm" className={cls}>
          <a href={a.href} download={a.download} onClick={opts.onDone}>
            {icon} {label}
          </a>
        </Button>
      );
    }
    if (a.href) {
      return (
        <Button key={a.id} asChild variant={variant} size="sm" className={cls}>
          <Link href={a.href} prefetch={false}>
            {icon} {label}
          </Link>
        </Button>
      );
    }
    if (a.id === "save-character") {
      return (
        <Popover key={a.id} open={saving} onOpenChange={setSaving}>
          <PopoverTrigger asChild>
            <Button variant={variant} size="sm" className={cls}>
              {icon} {label}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" collisionPadding={12} className="w-72">
            <SaveElementForm g={g} o={o} onDone={() => setSaving(false)} />
          </PopoverContent>
        </Popover>
      );
    }
    return (
      <Button
        key={a.id}
        variant={variant}
        size="sm"
        className={cls}
        aria-pressed={a.id === "favorite" ? g.favorite : a.id === "compare" ? comparing : a.id === "pin" ? !!g.pinnedAt : undefined}
        onClick={() => {
          run(a, g, index);
          opts.onDone?.();
        }}
      >
        {icon} {label}
      </Button>
    );
  };

  const pro = editOnlyFormat(g, o);
  const media =
    o.kind === "video" ? (
      pro || failedVideo === o.url ? (
        <div className="aspect-video w-[min(90%,560px)] overflow-hidden rounded-xl">
          <VideoFileCard output={o} format={pro} />
        </div>
      ) : (
        <video key={o.url} src={o.url} controls autoPlay loop playsInline onError={() => setFailedVideo(o.url)} className="max-h-full max-w-full" />
      )
    ) : o.kind === "audio" ? (
      <audio key={o.url} src={o.url} controls autoPlay className="w-[min(90%,560px)]" />
    ) : o.kind === "text" ? (
      <div className="size-full max-w-3xl bg-background text-foreground sm:rounded-xl">
        <TextReader output={o} />
      </div>
    ) : o.kind === "model3d" ? (
      <ModelViewer key={o.url} output={o} g={g} />
    ) : layered && allLayers ? (
      <LayersStack g={g} className="max-h-full" />
    ) : comparing && source ? (
      <CompareSlider before={source} after={o.url} alt={g.prompt ?? ""} />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img key={o.url} src={o.url} alt={g.prompt ?? ""} className={cn("max-h-full max-w-full object-contain", layered && "checkerboard")} />
    );

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[100svh] w-screen max-w-none gap-0 overflow-hidden rounded-none p-0 sm:max-w-none md:h-[min(92vh,900px)] md:w-[min(96vw,1400px)] md:rounded-xl"
      >
        <DialogTitle className="sr-only">{userTitle(g)}</DialogTitle>
        <DialogDescription className="sr-only">Preview, actions and details</DialogDescription>
        <div className="relative flex min-w-0 flex-1 flex-col bg-media">
          <div className="relative flex min-h-0 flex-1 items-center justify-center p-0 md:p-2" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            {media}
            {/* A placeholder says so here too, with the ways out (clear of the phone's close button on the right). */}
            <PlaceholderChip g={g} overlay className="absolute top-3 left-3 right-16 md:right-3" />
            {source && (
              <button
                onClick={() => setComparing((v) => !v)}
                className={cn(
                  "absolute bottom-4 left-1/2 hidden h-9 -translate-x-1/2 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium backdrop-blur transition-colors md:inline-flex",
                  comparing ? "bg-white text-black" : "bg-white/15 text-white hover:bg-white/25",
                )}
              >
                <Columns2 className="size-4" /> {comparing ? "Hide original" : "Compare"}
              </button>
            )}
            {onPrev && (
              <button onClick={onPrev} aria-label="Previous" className="absolute top-1/2 left-3 hidden size-10 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white backdrop-blur hover:bg-white/20 md:grid">
                <ChevronLeft className="size-5" />
              </button>
            )}
            {onNext && (
              <button onClick={onNext} aria-label="Next" className="absolute top-1/2 right-3 hidden size-10 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white backdrop-blur hover:bg-white/20 md:grid">
                <ChevronRight className="size-5" />
              </button>
            )}
          </div>

          {/* Phones: the main actions stay at the bottom; the rest and the details are in a drawer. */}
          <div className="flex shrink-0 items-center gap-1.5 border-t border-white/10 bg-media px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
            {onPrev ? (
              <button onClick={onPrev} aria-label="Previous" className="grid size-10 shrink-0 place-items-center rounded-full text-white/90 hover:bg-white/10">
                <ChevronLeft className="size-5" />
              </button>
            ) : (
              <span className="size-10 shrink-0" />
            )}
            <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
              {primary && actionButton(primary, { variant: "default", className: "rounded-full" })}
              {bar.map((a) => {
                const Icon = ACTION_ICONS[a.id];
                const cls = "grid size-10 shrink-0 place-items-center rounded-full text-white/90 hover:bg-white/10";
                return a.href && a.download !== undefined ? (
                  <a key={a.id} href={a.href} download={a.download} aria-label={a.label} className={cls}>
                    <Icon className="size-5" />
                  </a>
                ) : (
                  <button key={a.id} aria-label={a.label} aria-pressed={a.id === "favorite" ? g.favorite : undefined} onClick={() => run(a, g, index)} className={cls}>
                    <Icon className={cn("size-5", a.id === "favorite" && g.favorite && "fill-current text-highlight")} />
                  </button>
                );
              })}
              <button onClick={() => setDrawer(true)} aria-label="More actions and details" className="grid size-10 shrink-0 place-items-center rounded-full text-white/90 hover:bg-white/10">
                <MoreHorizontal className="size-5" />
              </button>
            </div>
            {onNext ? (
              <button onClick={onNext} aria-label="Next" className="grid size-10 shrink-0 place-items-center rounded-full text-white/90 hover:bg-white/10">
                <ChevronRight className="size-5" />
              </button>
            ) : (
              <span className="size-10 shrink-0" />
            )}
          </div>
        </div>

        <aside className="hidden w-80 shrink-0 flex-col border-l bg-card md:flex">
          <div className="flex items-center justify-between px-4 pt-3">
            <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
              <Info className="size-3.5" /> Details
            </span>
            <button onClick={onClose} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
            <Details g={g} index={index} />
            {/* Where this result can go next, with it attached (a layer is a part: it goes on from the Layers editor). */}
            {!layered && <NextSteps g={g} index={index} variant="list" max={5} onNavigate={onClose} />}
            {layered && (
              <LayerList
                g={g}
                index={index}
                all={allLayers}
                onAll={() => setAllLayers(true)}
                onPick={(i) => {
                  setAllLayers(false);
                  onIndex?.(i);
                }}
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 border-t p-3">
            {primary && actionButton(primary, { variant: "default" })}
            {bar.map((a) => actionButton(a))}
            {menu.filter((a) => !a.destructive && a.id !== "compare").map((a) => actionButton(a))}
            {menu.filter((a) => a.destructive).map((a) => actionButton(a, { className: "col-span-2" }))}
          </div>
          <p className="flex flex-wrap gap-x-3 gap-y-1 border-t px-4 py-2 text-[11px] text-muted-foreground">
            {(onPrev || onNext) && (
              <span>
                <Kbd>←</Kbd> <Kbd>→</Kbd> browse
              </span>
            )}
            {!g.deletedAt && g.feature !== "upload" && (
              <span>
                <Kbd>F</Kbd> favorite
              </span>
            )}
            {!g.deletedAt && g.feature !== "upload" && (
              <span>
                <Kbd>P</Kbd> pin
              </span>
            )}
            {source && (
              <span>
                <Kbd>C</Kbd> compare
              </span>
            )}
            <span>
              <Kbd>D</Kbd> download
            </span>
            {onReuse && (
              <span>
                <Kbd>R</Kbd> reuse
              </span>
            )}
          </p>
        </aside>

        <button onClick={onClose} className="absolute top-3 right-3 grid size-10 place-items-center rounded-full bg-black/40 text-white backdrop-blur md:hidden" aria-label="Close">
          <X className="size-5" />
        </button>

        <Sheet open={drawer} onOpenChange={setDrawer}>
          <SheetContent side="bottom" className="max-h-[85svh] gap-0 rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))] md:hidden">
            <SheetHeader className="pb-2">
              <SheetTitle className="text-[15px]">More</SheetTitle>
              <SheetDescription className="sr-only">Every action and the details of this result</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 overflow-y-auto px-4">
              {/* The next steps first: on a phone this sheet is where they are. */}
              {!layered && <NextSteps g={g} index={index} variant="list" max={5} onNavigate={onClose} />}
              <div className="grid grid-cols-2 gap-2">
                {source && (
                  <Button variant="secondary" size="sm" aria-pressed={comparing} onClick={() => (setComparing((v) => !v), setDrawer(false))}>
                    <Columns2 /> {comparing ? "Hide original" : "Compare"}
                  </Button>
                )}
                {menu.filter((a) => !a.destructive && a.id !== "compare").map((a) => actionButton(a, { onDone: () => a.id !== "save-character" && setDrawer(false) }))}
                {menu.filter((a) => a.destructive).map((a) => actionButton(a, { className: "col-span-2", onDone: () => setDrawer(false) }))}
              </div>
              {layered && (
                <LayerList
                  g={g}
                  index={index}
                  all={allLayers}
                  onAll={() => setAllLayers(true)}
                  onPick={(i) => {
                    setAllLayers(false);
                    onIndex?.(i);
                  }}
                />
              )}
              <Details g={g} index={index} />
            </div>
          </SheetContent>
        </Sheet>
      </DialogContent>
    </Dialog>
  );
}
