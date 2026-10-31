"use client";

import { Loader2, Minus, Plus, TriangleAlert, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAskBeforeUpload } from "@/lib/api";
import { FRAMES_HINT, frameRange, frameRole, frameTimes, KEYFRAME_SNAP, MAX_KEYFRAMES, secondsLabel } from "@/lib/catalog/keyframes";
import type { FrameAttachment } from "@/lib/composer";
import { cn } from "@/lib/utils";
import { ACCEPT, kindOfFile, MediaSlot, SlotPreview, wrongKindMessage, type SlotValue } from "./media-slot";

export interface FramesNotice {
  text: string;
  /** "warn": Generate waits for it; "info": what the model will do. */
  tone: "info" | "warn";
  action?: { label: string; onClick: () => void };
}

const pct = (t: number, duration: number) => `${duration > 0 ? (t / duration) * 100 : 0}%`;

/**
 * Frames mode's strip (Kling 4.0's Frames, Higgsfield G02): up to 10 frame tiles in order, each with
 * its time, a ruler to drag them along (snapped to 0.1 s; the first is the start frame and stays at 0),
 * and the clip's length. Positions are fractions of the clip, so a longer clip stretches them.
 */
export function FramesStrip({
  frames,
  duration,
  durations,
  onDuration,
  onMove,
  onFrame,
  onFrameFile,
  onAddFile,
  onAddPick,
  onClose,
  notice,
}: {
  frames: FrameAttachment<SlotValue>[];
  duration: number;
  durations: number[];
  onDuration: (seconds: number) => void;
  /** Frame i dragged (or stepped with the keys) to this many seconds. */
  onMove: (i: number, seconds: number) => void;
  /** Frame i replaced by another still, or taken out (null). */
  onFrame: (i: number, v: SlotValue | null) => void;
  onFrameFile: (i: number, f: File) => void;
  onAddFile: (f: File) => void;
  onAddPick: (v: SlotValue) => void;
  onClose: () => void;
  notice?: FramesNotice | null;
}) {
  const titleId = useId();
  const hintId = useId();
  const times = frameTimes(frames.map((f) => f.at), duration);
  return (
    <div role="group" aria-labelledby={titleId} aria-describedby={hintId} data-frames-strip className="space-y-1.5 px-1 pt-1 pb-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-1">
        <span id={titleId} className="text-[13px] font-medium">
          Frames
        </span>
        <span id={hintId} className="order-last basis-full text-[12px] leading-snug text-muted-foreground sm:order-none sm:basis-auto">
          {FRAMES_HINT}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <LengthStepper value={duration} options={durations} onDuration={onDuration} />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onClose}
                aria-label="Turn off Frames"
                className="grid size-7 place-items-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <X className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Back to a start and an end frame</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="scrollbar-none flex items-start gap-2 overflow-x-auto px-1 pt-1.5">
        {frames.map((f, i) => (
          <FrameTile
            key={f.value.id ?? `${f.value.ref}-${i}`}
            index={i}
            role={frameRole(i, frames.length, f.at)}
            value={f.value}
            time={times[i]}
            onChange={(v) => onFrame(i, v)}
            onFile={(file) => onFrameFile(i, file)}
          />
        ))}
        {frames.length < MAX_KEYFRAMES && (
          <div className="flex shrink-0 flex-col items-center gap-1">
            <MediaSlot slotKey="frames" label={frames.length ? "Add frame" : "Start frame"} kind="image" required={!frames.length} value={null} onChange={(v) => v && onAddPick(v)} onFile={onAddFile} />
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {frames.length} of {MAX_KEYFRAMES}
            </span>
          </div>
        )}
      </div>

      {frames.length > 0 && <Ruler frames={frames} times={times} duration={duration} onMove={onMove} />}

      {notice && (
        // A warning (Generate waits for it) reads in the body colour beside an amber icon: amber text on white is under 4.5:1.
        <p className={cn("flex items-start gap-1.5 px-1 text-[12px] leading-snug", notice.tone === "warn" ? "text-foreground" : "text-muted-foreground")} role={notice.tone === "warn" ? "status" : undefined}>
          {notice.tone === "warn" && <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-warning" />}
          <span>
            {notice.text}
            {notice.action && (
              <>
                {" "}
                <button type="button" onClick={notice.action.onClick} className="font-medium text-brand-text underline-offset-2 hover:underline">
                  {notice.action.label}
                </button>
              </>
            )}
          </span>
        </p>
      )}
    </div>
  );
}

/** The clip's length: one of the lengths the model (or the open chain) makes. */
function LengthStepper({ value, options, onDuration }: { value: number; options: number[]; onDuration: (seconds: number) => void }) {
  const sorted = [...new Set(options)].sort((a, b) => a - b);
  const i = sorted.indexOf(value);
  const lower = i < 0 ? sorted.findLast((x) => x < value) : sorted[i - 1];
  const higher = i < 0 ? sorted.find((x) => x > value) : sorted[i + 1];
  return (
    <div role="group" aria-label="Clip length" className="flex items-center gap-0.5 rounded-full bg-muted p-0.5">
      <button
        type="button"
        onClick={() => lower !== undefined && onDuration(lower)}
        disabled={lower === undefined}
        aria-label="Shorter clip"
        className="grid size-6 place-items-center rounded-full transition-colors outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40"
      >
        <Minus className="size-3" />
      </button>
      <span className="min-w-9 text-center text-[12px] font-medium tabular-nums" aria-live="polite">
        {value} s
      </span>
      <button
        type="button"
        onClick={() => higher !== undefined && onDuration(higher)}
        disabled={higher === undefined}
        aria-label="Longer clip"
        className="grid size-6 place-items-center rounded-full transition-colors outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40"
      >
        <Plus className="size-3" />
      </button>
    </div>
  );
}

/** A filled frame: its still (click or drop to replace it), its number, its time, and remove. */
function FrameTile({
  index,
  role,
  value,
  time,
  onChange,
  onFile,
}: {
  index: number;
  role: ReturnType<typeof frameRole>;
  value: SlotValue;
  time: number;
  onChange: (v: SlotValue | null) => void;
  onFile: (f: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const name = index === 0 ? "the start frame" : `frame ${index + 1}`;
  // Someone whose upload would be refused (a guest, an account with no GPU or key) gets its card, not the file chooser.
  const askFirst = useAskBeforeUpload();
  const take = (f: File | undefined) => {
    if (!f || askFirst()) return;
    if (kindOfFile(f) !== "image") return void toast(wrongKindMessage("image"));
    onFile(f);
  };
  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <div
        className="relative size-14 shrink-0"
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          take(e.dataTransfer.files?.[0]);
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => askFirst() || input.current?.click()}
              aria-label={`Frame ${index + 1}, ${role.toLowerCase()} at ${secondsLabel(time)}: replace`}
              className={cn("size-full overflow-hidden rounded-xl border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/50", over && "ring-2 ring-primary")}
            >
              <SlotPreview value={{ ...value, name: "" }} />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {role}
            {index > 0 && ` · ${secondsLabel(time)}`} — click or drop to replace
          </TooltipContent>
        </Tooltip>
        {value.uploading && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-xl bg-background/60" role="status" aria-label="Uploading">
            <Loader2 className="size-4 animate-spin" />
          </div>
        )}
        <span aria-hidden className="pointer-events-none absolute bottom-1 left-1 grid h-4 min-w-4 place-items-center rounded-full bg-background/90 px-1 text-[10px] font-semibold tabular-nums">
          {index + 1}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background shadow-soft"
          aria-label={`Remove ${name}`}
        >
          <X className="size-3" />
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT.image}
          hidden
          onChange={(e) => {
            take(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <span className="text-[11px] font-medium text-muted-foreground tabular-nums">{index === 0 ? "Start" : secondsLabel(time)}</span>
    </div>
  );
}

/** Seconds between labelled ticks for a clip this long. */
const labelEvery = (d: number) => (d <= 5 ? 1 : d <= 10 ? 2 : d <= 20 ? 5 : 10);

/**
 * The time ruler: one marker per frame at its time. Drag a marker (it snaps to 0.1 s and stays between
 * its neighbours), or focus it and use the arrow keys (0.1 s; Shift or Page Up / Down: 1 s; Home / End).
 */
function Ruler({ frames, times, duration, onMove }: { frames: FrameAttachment<SlotValue>[]; times: number[]; duration: number; onMove: (i: number, seconds: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const secondsAt = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    return r && r.width ? ((clientX - r.left) / r.width) * duration : 0;
  };
  const every = labelEvery(duration);
  const ticks = Array.from({ length: Math.floor(duration) + 1 }, (_, t) => t);
  const labels = ticks.filter((t) => t % every === 0 && duration - t >= every / 2).concat(duration);
  return (
    <div className="px-3.5 pt-0.5">
      <div ref={track} className="relative h-9 select-none">
        <div aria-hidden className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" />
        {ticks.map((t) => (
          <span key={t} aria-hidden className={cn("absolute top-1/2 w-px -translate-y-1/2 bg-border-strong", t % every === 0 ? "h-3" : "h-1.5")} style={{ left: pct(t, duration) }} />
        ))}
        {frames.map((f, i) => {
          const thumb = <SlotPreview value={{ ...f.value, name: "" }} />;
          const base = "absolute top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full border-2 border-background bg-muted shadow-soft ring-1 ring-border";
          if (i === 0)
            return (
              <span key={f.value.id ?? i} role="img" aria-label="Frame 1, the start frame, at 0 s" className={base} style={{ left: 0 }}>
                {thumb}
              </span>
            );
          const [lo, hi] = frameRange(times, i, duration);
          const step = (by: number) => onMove(i, times[i] + by);
          return (
            <button
              key={f.value.id ?? i}
              type="button"
              role="slider"
              aria-label={`Frame ${i + 1} time`}
              aria-valuemin={lo}
              aria-valuemax={hi}
              aria-valuenow={times[i]}
              aria-valuetext={secondsLabel(times[i])}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.focus();
                e.currentTarget.setPointerCapture(e.pointerId);
                setActive(i);
              }}
              onPointerMove={(e) => {
                if (active === i && e.currentTarget.hasPointerCapture(e.pointerId)) onMove(i, secondsAt(e.clientX));
              }}
              onPointerUp={() => setActive(null)}
              onPointerCancel={() => setActive(null)}
              onKeyDown={(e) => {
                const big = e.shiftKey ? 1 : KEYFRAME_SNAP;
                const moves: Record<string, () => void> = {
                  ArrowRight: () => step(big),
                  ArrowUp: () => step(big),
                  ArrowLeft: () => step(-big),
                  ArrowDown: () => step(-big),
                  PageUp: () => step(1),
                  PageDown: () => step(-1),
                  Home: () => onMove(i, lo),
                  End: () => onMove(i, hi),
                };
                const move = moves[e.key];
                if (!move) return;
                e.preventDefault();
                move();
              }}
              className={cn(
                base,
                "z-10 cursor-grab touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
                active === i && "z-20 cursor-grabbing ring-2 ring-primary",
              )}
              style={{ left: pct(times[i], duration) }}
            >
              {thumb}
            </button>
          );
        })}
        {active !== null && (
          <span aria-hidden className="pointer-events-none absolute -top-5 z-30 -translate-x-1/2 rounded-md bg-foreground px-1.5 py-0.5 text-[11px] font-medium text-background tabular-nums" style={{ left: pct(times[active], duration) }}>
            {secondsLabel(times[active])}
          </span>
        )}
      </div>
      <div aria-hidden className="relative h-3.5 text-[10px] text-muted-foreground tabular-nums">
        {labels.map((t, k) => (
          <span key={t} className={cn("absolute top-0 whitespace-nowrap", k === 0 ? "" : t === duration ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: pct(t, duration) }}>
            {secondsLabel(t)}
          </span>
        ))}
      </div>
    </div>
  );
}
