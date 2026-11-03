"use client";

import { Check, Clapperboard, Grid3x3, ImageIcon, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { canMakeMp4 } from "@/components/motion/render";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { templateLengths, templateSizes } from "@/lib/motion/template";
import { setDuration, setExport, setFps, setSize, type KineticDoc } from "@/lib/motion/kinetic-doc";
import { templateOf, type KineticEntry } from "@/lib/motion/kinetic-catalog";
import { customSizeProblem, exportSize, KINETIC_FPS, SIZE_LABELS, type SizePreset } from "@/lib/motion/sizes";
import { cn } from "@/lib/utils";
import { Choices, iconButton, Segmented, sheetClass, SliderField } from "./controls";
import { jobLine, type JobKind, type KineticJobs } from "./jobs";
import type { KineticEditor } from "./use-editor";

/**
 * Export options: format, size (the scene's sizes or a custom one), frame rate, length, motion blur and quality, with
 * the three outputs (the clip, a frame at the playhead, a 9-frame contact sheet). Nothing here changes the preview's
 * own quality; MP4 is never swapped for WebM without saying so.
 */


export const KIND_NAMES: Record<JobKind, string> = { clip: "Clip", frame: "Frame", sheet: "Contact sheet", version: "Version" };

/** Whether this browser can make an MP4 at the recipe's size and rate (null while it checks). */
export function useMp4(w: number, h: number, fps: number): boolean | null {
  const [ok, setOk] = useState<{ key: string; ok: boolean } | null>(null);
  const key = `${w}x${h}@${fps}`;
  useEffect(() => {
    let live = true;
    canMakeMp4(w, h, fps)
      .then((v) => live && setOk({ key, ok: v }))
      .catch(() => live && setOk({ key, ok: false }));
    return () => {
      live = false;
    };
  }, [w, h, fps, key]);
  return ok?.key === key ? ok.ok : null;
}

function CustomSize({ value, onChange }: { value: { w: number; h: number }; onChange: (s: { w: number; h: number }) => void }) {
  const [w, setW] = useState(String(value.w));
  const [h, setH] = useState(String(value.h));
  const problem = customSizeProblem(Number(w), Number(h));
  const commit = () => {
    if (!customSizeProblem(Number(w), Number(h))) onChange({ w: Number(w), h: Number(h) });
  };
  const box = "h-11 w-full min-w-0 rounded-xl border bg-background px-3 text-[14px] tabular-nums outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="min-w-0">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <input aria-label="Width in pixels" inputMode="numeric" value={w} onChange={(e) => setW(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} className={box} />
        <span className="text-[13px] text-muted-foreground" aria-hidden>
          ×
        </span>
        <input aria-label="Height in pixels" inputMode="numeric" value={h} onChange={(e) => setH(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} className={box} />
      </div>
      <p className={cn("mt-1 text-[12px]", problem ? "text-destructive" : "text-muted-foreground")}>{problem ?? "Even numbers, 256 to 2160 px a side."}</p>
    </div>
  );
}

export function ExportSheet({
  open,
  onClose,
  side,
  doc,
  entry,
  editor,
  jobs,
  blocked,
  mp4,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  side: "bottom" | "right";
  doc: KineticDoc;
  entry: KineticEntry;
  editor: Pick<KineticEditor, "apply" | "end">;
  jobs: KineticJobs;
  /** Why nothing can save yet (words that don't fit, MP4 that can't be made here), or null. */
  blocked: string | null;
  /** Whether this browser makes an MP4 at this size (null while it checks). */
  mp4: boolean | null;
  onSave: (kind: JobKind) => void;
}) {
  const r = doc.recipe;
  const t = templateOf(entry);
  const sizes = templateSizes(t);
  const lengths = templateLengths(t);
  const px = exportSize(r.size);
  const custom = typeof r.size !== "string";
  const busy = jobLine(jobs.job);
  const title = useRef<HTMLHeadingElement>(null);
  const out = (kind: JobKind, label: string, Icon: typeof Clapperboard) => {
    const mine = jobs.job?.kind === kind;
    return (
      <button
        type="button"
        onClick={() => onSave(kind)}
        disabled={!!blocked || (kind === "clip" && r.export.format === "mp4" && mp4 === false && !jobs.guest) || (!!jobs.job && !mine)}
        data-kinetic-save={kind}
        className={cn("flex h-12 w-full min-w-0 items-center gap-2 rounded-xl px-4 text-[14px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", kind === "clip" ? "bg-primary text-primary-foreground hover:opacity-90" : "bg-secondary hover:bg-accent")}
      >
        {mine ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
        <span className="truncate">{mine ? busy : jobs.job ? "Saving another one…" : label}</span>
      </button>
    );
  };
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side={side}
        showCloseButton={false}
        className={sheetClass}
        data-kinetic-sheet="export"
        onOpenAutoFocus={(e) => {
          // The title takes focus (a heavy ring on Close after a mouse open reads as a mistake).
          e.preventDefault();
          title.current?.focus();
        }}
      >
        <SheetHeader className="flex-row items-start gap-2 pb-3">
          <div className="min-w-0 flex-1">
            <SheetTitle ref={title} tabIndex={-1} className="outline-none">
              Export options
            </SheetTitle>
            <SheetDescription className="text-[13px]">
              How the clip is made. Saved results go to {jobs.saveLabel === "Save to Library" ? "your Library" : "your runs"}, where they download.
              {jobs.account && " You can save about 30 clips or 60 pictures an hour."}
            </SheetDescription>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={iconButton}>
            <X className="size-4" />
          </button>
        </SheetHeader>
        <div className="min-w-0 space-y-4 px-4 pb-2">
          <div className="min-w-0">
            <Segmented
              label="Format"
              choices={[
                { id: "mp4", label: "MP4" },
                { id: "webm", label: "WebM" },
              ]}
              value={r.export.format}
              onChange={(f) => (f === "mp4" && mp4 === false ? undefined : editor.apply((d) => setExport(d, { format: f })))}
            />
            {mp4 === false && <p className="mt-1 text-[12px] text-muted-foreground">This browser can&apos;t make MP4 here. WebM works.</p>}
          </div>
          <div className="min-w-0 space-y-2">
            <Choices
              label="Size"
              choices={[...sizes.map((s) => ({ id: s as string, label: SIZE_LABELS[s] })), { id: "custom", label: "Custom" }]}
              value={custom ? "custom" : (r.size as string)}
              onChange={(id) => editor.apply((d) => setSize(d, id === "custom" ? { w: px.w - (px.w % 2), h: px.h - (px.h % 2) } : (id as SizePreset)))}
            />
            {custom && <CustomSize key={`${px.w}x${px.h}`} value={r.size as { w: number; h: number }} onChange={(s) => editor.apply((d) => setSize(d, s))} />}
          </div>
          <Choices label="Frame rate" choices={KINETIC_FPS.map((f) => ({ id: String(f), label: `${f} fps` }))} value={String(r.fps)} onChange={(f) => editor.apply((d) => setFps(d, Number(f) as typeof r.fps))} note={r.fps === 60 ? "twice the frames" : undefined} />
          {lengths.max > lengths.min && <SliderField label="Length" unit="s" display={(v) => `${v} s`} value={r.duration} min={lengths.min} max={lengths.max} step={lengths.max - lengths.min <= 2 ? 0.5 : 1} onChange={(v) => editor.apply((d) => setDuration(d, v), { gesture: true })} onEnd={editor.end} />}
          <SliderField label="Motion blur samples" display={(v) => (v <= 1 ? "Off" : String(v))} value={r.export.blurSamples} min={1} max={32} step={1} onChange={(v) => editor.apply((d) => setExport(d, { blurSamples: v }), { gesture: true })} onEnd={editor.end} />
          <SliderField label="Shutter" unit="°" display={(v) => `${Math.round(v)}°`} value={r.export.shutter} min={0} max={360} step={15} onChange={(v) => editor.apply((d) => setExport(d, { shutter: v }), { gesture: true })} onEnd={editor.end} disabled={r.export.blurSamples <= 1} />
          <Segmented
            label="Quality"
            choices={[
              { id: "standard", label: "Standard" },
              { id: "high", label: "High" },
            ]}
            value={r.export.quality ?? "standard"}
            onChange={(q) => editor.apply((d) => setExport(d, { quality: q === "high" ? "high" : undefined }))}
          />
          <p className="text-[12px] text-muted-foreground tabular-nums">
            {px.w - (px.w % 2)} × {px.h - (px.h % 2)} · {r.fps} fps · {r.duration} s
          </p>
        </div>
        <div className="sticky bottom-0 min-w-0 space-y-2 border-t bg-popover px-4 pt-3">
          {blocked && <p className="text-[12px] text-destructive">{blocked}</p>}
          {out("clip", "Save clip", Clapperboard)}
          <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
            {out("frame", "Save frame", ImageIcon)}
            {out("sheet", "Save contact sheet", Grid3x3)}
          </div>
          {jobs.job && (
            <button type="button" onClick={jobs.cancel} className="h-11 w-full rounded-full text-[13px] font-medium text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
              Stop
            </button>
          )}
          {jobs.saved.length > 0 && (
            <div className="min-w-0 pb-1" data-kinetic-saved>
              <p className="mb-1 text-[12px] font-medium text-muted-foreground">Saved this visit</p>
              <ul className="space-y-1">
                {jobs.saved.map((s) => (
                  <li key={s.id} className="flex min-h-11 min-w-0 items-center gap-2 text-[13px]">
                    <Check className="size-4 shrink-0 text-primary" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      {KIND_NAMES[s.kind]} · {s.title}
                    </span>
                    <Link href="/library" prefetch={false} className="inline-flex h-11 shrink-0 items-center rounded-full px-3 font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
