"use client";

import { Loader2, Minus, Plus, TriangleAlert, X } from "lucide-react";
import { Fragment, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ENGINE_TIMING,
  gapLabel,
  gapSeconds,
  keyTimes,
  lengthLabel,
  MAX_GAP_FRAMES,
  MIN_GAP_FRAMES,
  moveKey,
  SPEEDS,
  stepGap,
  totalFrames,
  totalSeconds,
  type GapTiming,
  type InbetweenTiming,
  type PlaybackFps,
} from "@/lib/inbetween";
import type { Engine } from "@/lib/catalog/types";
import { useAskBeforeUpload, useEngine, useLikelyVisitor } from "@/lib/api";
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

/** Keyframe animation's controls (Fuobe Animation): each gap's timing, the playback rate and a still mouth. */
export interface FramesAnimation {
  timing: InbetweenTiming;
  engine: Engine;
  onTiming: (t: InbetweenTiming) => void;
  stillMouth: boolean;
  onStillMouth: (on: boolean) => void;
}

const pct = (t: number, duration: number) => `${duration > 0 ? (t / duration) * 100 : 0}%`;

/**
 * Frames mode's strip (Kling 4.0's Frames, parity gap G02): up to 10 frame tiles in order, each with
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
  style,
  animation,
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
  /** Style: Animation, when Fuobe Animation can run here. */
  style?: { on: boolean; onChange: (on: boolean) => void; engine: Engine };
  animation?: FramesAnimation;
}) {
  const titleId = useId();
  const hintId = useId();
  const styleId = useId();
  // An animation's keyframes sit where their gaps' timing puts them; the film is as long as the gaps.
  const length = animation ? totalSeconds(animation.timing) : duration;
  const times = animation ? keyTimes(animation.timing) : frameTimes(frames.map((f) => f.at), duration);
  const setGap = (i: number, g: GapTiming) => animation?.onTiming({ ...animation.timing, gaps: animation.timing.gaps.map((x, j) => (j === i ? g : x)) });
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
          {style && (
            <label htmlFor={styleId} className="mr-1 flex cursor-pointer items-center gap-1.5 text-[12px] font-medium">
              <Switch id={styleId} checked={style.on} onCheckedChange={style.onChange} aria-describedby={`${styleId}-hint`} />
              Animation
              <span id={`${styleId}-hint`} className="sr-only">
                The in-betweens drawn in an anime style, with a timing for each gap{style.engine === "open" ? ", free on your GPU" : ""}
              </span>
            </label>
          )}
          {animation ? (
            <span className="rounded-full bg-muted px-2.5 py-1 text-[12px] font-medium tabular-nums" aria-live="polite" data-animation-length>
              {lengthLabel(length)} · {totalFrames(animation.timing)} frames
            </span>
          ) : (
            <LengthStepper value={duration} options={durations} onDuration={onDuration} />
          )}
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
          <Fragment key={f.value.id ?? `${f.value.ref}-${i}`}>
            {animation && i > 0 && animation.timing.gaps[i - 1] && (
              <GapChip index={i - 1} gap={animation.timing.gaps[i - 1]} fps={animation.timing.fps} engine={animation.engine} onChange={(g) => setGap(i - 1, g)} />
            )}
            <FrameTile
              index={i}
              role={animation ? (i === 0 ? "Start frame" : i === frames.length - 1 ? "End frame" : "Middle frame") : frameRole(i, frames.length, f.at)}
              value={f.value}
              time={times[i] ?? 0}
              onChange={(v) => onFrame(i, v)}
              onFile={(file) => onFrameFile(i, file)}
            />
          </Fragment>
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

      {frames.length > 0 && (
        <Ruler
          frames={frames}
          times={times}
          duration={Math.max(length, 0.1)}
          onMove={animation ? (i, seconds) => animation.onTiming(moveKey(animation.timing, i, seconds)) : onMove}
          lastFree={!!animation}
        />
      )}

      {animation && <AnimationOptions animation={animation} />}

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
function Ruler({
  frames,
  times,
  duration,
  onMove,
  lastFree,
}: {
  frames: FrameAttachment<SlotValue>[];
  times: number[];
  duration: number;
  onMove: (i: number, seconds: number) => void;
  /** An animation: the last keyframe can move later (the film grows with it). */
  lastFree?: boolean;
}) {
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
          const [lo, hi0] = frameRange(times, i, duration);
          const hi = lastFree && i === frames.length - 1 ? hi0 + 5 : hi0;
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

/** One gap's timing on the strip, between its two keyframes: frames and speed, and a popover to change them and its words. */
function GapChip({ index, gap, fps, engine, onChange }: { index: number; gap: GapTiming; fps: PlaybackFps; engine: Engine; onChange: (g: GapTiming) => void }) {
  const can = ENGINE_TIMING[engine];
  const name = `keyframes ${index + 1} and ${index + 2}`;
  // The GPU-only speeds are pointed out only where the GPU is there to switch to (the owner, both engines on).
  const visitor = useLikelyVisitor();
  const engineMode = useEngine()[2];
  const gpuHint = !visitor && engineMode === "both";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-gap-chip={index}
          aria-label={`Timing between ${name}: ${gap.frames} frames, ${gap.speed === 1 ? "every frame" : `every ${gap.speed}th frame`}, ${lengthLabel(gapSeconds(gap, fps))}`}
          className="mt-3.5 flex h-8 shrink-0 flex-col items-center justify-center rounded-full border bg-background px-2 text-[10.5px] leading-tight font-medium tabular-nums shadow-soft outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span>{gapLabel(gap)}</span>
          <span className="text-muted-foreground">{lengthLabel(gapSeconds(gap, fps))}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3 p-3" align="center">
        <p className="text-[13px] font-medium">
          Keyframes {index + 1} → {index + 2}
        </p>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-muted-foreground">Frames drawn</span>
          <div role="group" aria-label="Frames drawn" className="flex items-center gap-0.5 rounded-full bg-muted p-0.5">
            <button type="button" aria-label="Fewer frames" disabled={gap.frames <= MIN_GAP_FRAMES} onClick={() => onChange(stepGap(gap, -1))} className="grid size-6 place-items-center rounded-full hover:bg-background disabled:opacity-40">
              <Minus className="size-3" />
            </button>
            <span className="min-w-10 text-center text-[12px] font-medium tabular-nums">{gap.frames}</span>
            <button type="button" aria-label="More frames" disabled={gap.frames >= MAX_GAP_FRAMES} onClick={() => onChange(stepGap(gap, 1))} className="grid size-6 place-items-center rounded-full hover:bg-background disabled:opacity-40">
              <Plus className="size-3" />
            </button>
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-muted-foreground">Speed</span>
            <div role="radiogroup" aria-label="Speed" className="flex items-center gap-0.5 rounded-full bg-muted p-0.5">
              {SPEEDS.map((sp) => {
                const allowed = can.speeds.includes(sp);
                return (
                  <button
                    key={sp}
                    type="button"
                    role="radio"
                    aria-checked={gap.speed === sp}
                    disabled={!allowed}
                    title={allowed || !gpuHint ? undefined : "On your GPU"}
                    onClick={() => onChange({ ...gap, speed: sp })}
                    className={cn("h-6 min-w-8 rounded-full px-1.5 text-[12px] font-medium tabular-nums disabled:opacity-40", gap.speed === sp ? "bg-background shadow-soft" : "hover:bg-background/60")}
                  >
                    ×{sp}
                  </button>
                );
              })}
            </div>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {engine === "open" ? "Faster keeps every 2nd, 3rd or 4th frame, for a snappier move." : `In the cloud every frame is kept.${gpuHint ? " ×2–×4 are on your GPU." : ""}`} This gap plays for {lengthLabel(gapSeconds(gap, fps))}.
          </p>
        </div>
        <label className="block space-y-1">
          <span className="text-[12px] text-muted-foreground">What happens in this gap (optional)</span>
          <Input value={gap.prompt ?? ""} maxLength={500} placeholder="she jumps and lands" onChange={(e) => onChange({ ...gap, prompt: e.target.value || undefined })} className="h-8 text-[13px]" />
        </label>
      </PopoverContent>
    </Popover>
  );
}

/** The animation's playback rate and the still-mouth switch, under the ruler. */
function AnimationOptions({ animation }: { animation: FramesAnimation }) {
  const mouthId = useId();
  const rates = ENGINE_TIMING[animation.engine].rates;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[12px]">
      <div role="radiogroup" aria-label="Playback" className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Playback</span>
        <div className="flex items-center gap-0.5 rounded-full bg-muted p-0.5">
          {rates.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={animation.timing.fps === r}
              onClick={() => animation.onTiming({ ...animation.timing, fps: r })}
              className={cn("h-6 rounded-full px-2 font-medium tabular-nums", animation.timing.fps === r ? "bg-background shadow-soft" : "hover:bg-background/60")}
            >
              {r} fps{r === 16 && rates.length > 1 ? " · true time" : ""}
            </button>
          ))}
        </div>
      </div>
      <label htmlFor={mouthId} className="flex cursor-pointer items-center gap-1.5">
        <Switch id={mouthId} checked={animation.stillMouth} onCheckedChange={animation.onStillMouth} />
        Keep mouth still
      </label>
    </div>
  );
}
