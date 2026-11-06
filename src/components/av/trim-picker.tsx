"use client";

import { Loader2, Pause, Play, Scissors, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keyframeAtOrBefore } from "@/lib/av/mp4-cut";
import { cn } from "@/lib/utils";
import { filmstrip } from "./filmstrip";
import { soundPeaks } from "./fit-audio";

/**
 * Pick the part of a sound or a clip to use, when it is longer than a tool takes. Phones first:
 * - a waveform (a sound) or a strip of stills (a clip), with a window of the allowed length to drag, and big handles at
 *   both ends to make it shorter (never longer than the tool takes, never shorter than it needs);
 * - a long file shows the stretch around the window, with a bar under it for the whole file (tap it to go there);
 * - Play plays just the chosen part (a clip's in the preview above);
 * - the start and end times, and the part's length;
 * - "Use this part" and "Cancel".
 * A clip's part starts on a key frame (`keyframes`): the start snaps to the one at or before it when it is let go.
 * Arrow keys move each handle and the window by a second (Shift: ten).
 */

export interface TrimPickerProps {
  /** The file: one in this browser, or a stored file's address. */
  source: Blob | string;
  kind: "audio" | "video";
  /** Its whole length, in seconds. */
  seconds: number;
  /** The longest part the tool takes, and the shortest it needs. */
  max: number;
  min?: number;
  /** What is asked, in a line ("This one is 4:12. Remix takes up to 3:00: pick the part to use"). */
  line: string;
  /** Where a part can start (a clip's key frames), in seconds. */
  keyframes?: number[];
  /** The button's words ("Use this part"). */
  useLabel?: string;
  busy?: boolean;
  onUse: (from: number, to: number) => void;
  onCancel: () => void;
  className?: string;
}

/** Bars over the whole file (a long one shows a stretch of them). */
const BARS = 1200;
/** The track shows at most this many window lengths, so the window is never a sliver. */
const ZOOM = 4;

/** "75.3" -> "1:15" (or "1:15.3" when tenths matter). */
export function stamp(t: number, tenths = false): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const sec = tenths ? rest.toFixed(1).padStart(4, "0") : String(Math.floor(rest + 1e-6)).padStart(2, "0");
  return `${m}:${sec}`;
}

/** "30 s", "2 min 05 s". */
function lengthWords(t: number, tenths: boolean): string {
  if (t < 60) return `${tenths ? t.toFixed(1) : Math.round(t)} s`;
  const m = Math.floor(t / 60);
  const s = Math.round(t - m * 60);
  return s ? `${m} min ${String(s).padStart(2, "0")} s` : `${m} min`;
}

type Drag = { mode: "start" | "end" | "move"; grab: number } | null;

export function TrimPicker({ source, kind, seconds, max, min = 0, line, keyframes, useLabel = "Use this part", busy, onUse, onCancel, className }: TrimPickerProps) {
  const longest = Math.min(max, seconds);
  const shortest = Math.min(Math.max(0.5, min), longest);
  const [start, setStart] = useState(0);
  const [len, setLen] = useState(longest);
  const end = start + len;
  const tenths = longest < 60;
  // The stretch the track shows: all of a short file, a few window lengths of a long one.
  const span = seconds <= longest * ZOOM ? seconds : longest * ZOOM;
  const zoomed = span < seconds;
  const [view, setView] = useState(0);
  // Keep the window in view.
  const shownFrom = Math.min(Math.max(view, end - span), start, Math.max(0, seconds - span));
  const viewFrom = Math.max(0, shownFrom);
  if (viewFrom !== view) setView(viewFrom);
  const viewTo = viewFrom + span;

  // The file's address for the players (a file in this browser gets one of its own while the picker is open).
  const [url, setUrl] = useState<string | null>(typeof source === "string" ? source : null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a file in this browser gets an address while the picker is open
    if (typeof source === "string") return setUrl(source);
    const u = URL.createObjectURL(source);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [source]);

  // A sound's waveform.
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [peaksFailed, setPeaksFailed] = useState(false);
  useEffect(() => {
    if (kind !== "audio") return;
    let gone = false;
    void (async () => {
      try {
        const blob = typeof source === "string" ? await (await fetch(source)).blob() : source;
        const p = await soundPeaks(blob, BARS);
        if (!gone) setPeaks(p);
      } catch {
        if (!gone) setPeaksFailed(true);
      }
    })();
    return () => {
      gone = true;
    };
  }, [kind, source]);

  // A clip's stills, for the stretch shown (again once a long one's stretch settles).
  const [frames, setFrames] = useState<string[] | null>(null);
  const [framesFor, setFramesFor] = useState<string | null>(null);
  const stripKey = `${Math.round(viewFrom * 10)}`;
  useEffect(() => {
    if (kind !== "video" || !url) return;
    const c = new AbortController();
    const t = setTimeout(async () => {
      const shots = await filmstrip(url, seconds, 8, 96, c.signal, zoomed ? { from: viewFrom, to: viewFrom + span } : undefined);
      if (!c.signal.aborted) {
        setFrames(shots);
        setFramesFor(stripKey);
      }
    }, zoomed && framesFor !== null ? 350 : 0);
    return () => {
      clearTimeout(t);
      c.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, url, seconds, stripKey]);

  // Playing the part.
  const media = useRef<HTMLAudioElement & HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [head, setHead] = useState<number | null>(null);
  const raf = useRef(0);
  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    media.current?.pause();
    setPlaying(false);
    setHead(null);
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const range = useRef({ start, end });
  useEffect(() => {
    range.current = { start, end };
  }, [start, end]);
  const play = useCallback(async () => {
    const el = media.current;
    if (!el) return;
    if (playing) return stop();
    el.currentTime = range.current.start;
    try {
      await el.play();
    } catch {
      return;
    }
    setPlaying(true);
    const tick = () => {
      const now = el.currentTime;
      if (now >= range.current.end || el.paused || el.ended) {
        el.pause();
        el.currentTime = range.current.start;
        setPlaying(false);
        setHead(null);
        return;
      }
      setHead(now);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [playing, stop]);
  // A clip's preview shows the part's first frame while it isn't playing.
  useEffect(() => {
    const el = media.current;
    if (kind !== "video" || !el || playing) return;
    const t = setTimeout(() => {
      if (el.readyState >= 1) el.currentTime = start + 0.01;
    }, 60);
    return () => clearTimeout(t);
  }, [kind, start, playing, url]);

  // Moving the window and its ends.
  const set = useCallback(
    (s: number, l: number) => {
      // Whole seconds (tenths for a short part), as the times say them.
      const q = tenths ? 10 : 1;
      const L = Math.min(longest, Math.max(shortest, Math.round(l * q) / q));
      setLen(L);
      setStart(Math.min(Math.max(0, Math.round(s * q) / q), Math.max(0, seconds - L)));
    },
    [longest, shortest, seconds, tenths],
  );
  const snap = useCallback(() => {
    if (!keyframes?.length) return;
    setStart((s) => {
      const k = keyframeAtOrBefore({ keyframes }, s + 1e-3);
      return k;
    });
  }, [keyframes]);

  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag>(null);
  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return viewFrom + ((clientX - r.left) / Math.max(1, r.width)) * span;
  };
  const onDown = (mode: "start" | "end" | "move" | "track", e: React.PointerEvent) => {
    if (busy) return;
    e.preventDefault();
    e.stopPropagation();
    stop();
    const t = timeAt(e.clientX);
    if (mode === "track") {
      // A tap beside the window brings it there (centred), and the drag goes on from there.
      const s = Math.min(Math.max(0, t - len / 2), seconds - len);
      set(s, len);
      drag.current = { mode: "move", grab: t - s };
    } else drag.current = { mode, grab: mode === "move" ? t - start : 0 };
    track.current?.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const t = timeAt(e.clientX);
    if (d.mode === "move") set(t - d.grab, len);
    else if (d.mode === "start") {
      const s = Math.min(Math.max(t, end - longest, 0), end - shortest);
      set(s, end - s);
    } else {
      const e2 = Math.min(Math.max(t, start + shortest), start + longest, seconds);
      set(start, e2 - start);
    }
  };
  const onUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    track.current?.releasePointerCapture?.(e.pointerId);
    snap();
  };
  const keys = (mode: "start" | "end" | "move", e: React.KeyboardEvent) => {
    const step = (e.shiftKey ? 10 : 1) * (e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : 0);
    const edge = e.key === "Home" ? -Infinity : e.key === "End" ? Infinity : 0;
    if (!step && !edge) return;
    e.preventDefault();
    stop();
    const by = edge || step;
    if (mode === "move") set(start + by, len);
    else if (mode === "start") {
      const s = Math.min(Math.max(start + by, end - longest, 0), end - shortest);
      set(s, end - s);
    } else {
      const e2 = Math.min(Math.max(end + by, start + shortest), start + longest, seconds);
      set(start, e2 - start);
    }
    if (mode !== "end") requestAnimationFrame(snap);
  };

  // Where things sit on the track, in %.
  const pct = (t: number) => ((t - viewFrom) / span) * 100;
  const left = pct(start);
  const right = 100 - pct(end);
  const shownBars = useMemo(() => {
    if (!peaks) return null;
    const a = Math.floor((viewFrom / seconds) * peaks.length);
    const b = Math.ceil((viewTo / seconds) * peaks.length);
    const slice = peaks.slice(a, b);
    // About 70 bars across, whatever the stretch.
    const every = Math.max(1, Math.round(slice.length / 70));
    const out: number[] = [];
    for (let i = 0; i < slice.length; i += every) out.push(Math.max(...slice.slice(i, i + every)));
    return out;
  }, [peaks, viewFrom, viewTo, seconds]);

  const loading = kind === "audio" ? !peaks && !peaksFailed : frames === null;
  const playLabel = playing ? "Stop" : "Play this part";

  return (
    <div className={cn("space-y-3 rounded-2xl border bg-card p-3 text-foreground shadow-sm sm:p-4", className)} data-trim-picker>
      <p className="text-[13px] leading-snug text-foreground">{line}</p>

      {kind === "video" && url && (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video ref={media} src={url} playsInline preload="auto" className="mx-auto block max-h-[38vh] w-full object-contain" onEnded={stop} />
        </div>
      )}
      {kind === "audio" && url && <audio ref={media} src={url} preload="auto" onEnded={stop} className="hidden" />}

      <div className="space-y-2">
        <div
          ref={track}
          className="relative h-16 touch-none rounded-xl bg-muted select-none"
          onPointerDown={(e) => onDown("track", e)}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {/* The file: its waveform, or a strip of stills. */}
          <div className="absolute inset-0 overflow-hidden rounded-xl">
            {kind === "audio" && shownBars && <Bars bars={shownBars} className="text-muted-foreground/40" />}
            {/* The part's own tint. */}
            <div className="pointer-events-none absolute inset-y-0 bg-primary/10" style={{ left: `${left}%`, right: `${right}%` }} />
            {kind === "audio" && shownBars && <Bars bars={shownBars} className="text-primary" style={{ clipPath: `inset(0 ${right}% 0 ${left}%)` }} />}
            {kind === "video" && frames && frames.length > 0 && (
              <div className="flex h-full">
                {frames.map((f, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={f} alt="" draggable={false} className="h-full min-w-0 flex-1 object-cover" />
                ))}
              </div>
            )}
            {loading && <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-muted via-muted-foreground/10 to-muted" />}
            {/* Outside the part: dimmed. */}
            <div className="pointer-events-none absolute inset-y-0 left-0 bg-background/65" style={{ width: `${Math.max(0, left)}%` }} />
            <div className="pointer-events-none absolute inset-y-0 right-0 bg-background/65" style={{ width: `${Math.max(0, right)}%` }} />
          </div>

          {/* The part: drag it, or its ends. */}
          <div
            role="slider"
            tabIndex={0}
            aria-label="Move the part"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, Math.round(seconds - len))}
            aria-valuenow={Math.round(start)}
            aria-valuetext={`${stamp(start, tenths)} to ${stamp(end, tenths)}`}
            className="absolute inset-y-0 cursor-grab rounded-xl border-[3px] border-primary outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:cursor-grabbing"
            style={{ left: `${left}%`, right: `${right}%` }}
            onPointerDown={(e) => onDown("move", e)}
            onKeyDown={(e) => keys("move", e)}
          >
            {head !== null && <span className="pointer-events-none absolute inset-y-1 w-0.5 rounded-full bg-foreground" style={{ left: `${((head - start) / Math.max(0.01, len)) * 100}%` }} />}
          </div>
          <Handle side="start" at={left} label="Start of the part" value={start} text={stamp(start, tenths)} onPointerDown={(e) => onDown("start", e)} onKeyDown={(e) => keys("start", e)} max={seconds} />
          <Handle side="end" at={100 - right} label="End of the part" value={end} text={stamp(end, tenths)} onPointerDown={(e) => onDown("end", e)} onKeyDown={(e) => keys("end", e)} max={seconds} />
        </div>

        {zoomed && (
          <div
            className="relative h-2.5 touch-none rounded-full bg-muted"
            aria-hidden
            onPointerDown={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const t = ((e.clientX - r.left) / r.width) * seconds;
              stop();
              set(t - len / 2, len);
              requestAnimationFrame(snap);
            }}
          >
            <span className="absolute inset-y-0 rounded-full bg-muted-foreground/25" style={{ left: `${(viewFrom / seconds) * 100}%`, width: `${(span / seconds) * 100}%` }} />
            <span className="absolute inset-y-0 rounded-full bg-primary" style={{ left: `${(start / seconds) * 100}%`, width: `${Math.max(1.5, (len / seconds) * 100)}%` }} />
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void play()}
          disabled={busy || !url}
          aria-label={playLabel}
          title={playLabel}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform active:scale-95 disabled:opacity-50"
        >
          {playing ? <Pause className="size-4.5 fill-current" /> : <Play className="ml-0.5 size-4.5 fill-current" />}
        </button>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-[15px] font-medium tabular-nums" aria-live="polite">
            {stamp(start, tenths)} – {stamp(end, tenths)}
          </p>
          <p className="text-[12px] text-muted-foreground tabular-nums">
            {lengthWords(len, tenths)} of {stamp(seconds)}
            {keyframes?.length ? " · starts on a key frame" : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            stop();
            onUse(start, end);
          }}
          disabled={busy}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-foreground px-4 text-[14px] font-medium text-background disabled:opacity-60 sm:flex-none"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Scissors className="size-4" />}
          {useLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            stop();
            onCancel();
          }}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-4 text-[14px] font-medium text-foreground hover:bg-accent"
        >
          <X className="size-4" />
          Cancel
        </button>
      </div>
    </div>
  );
}

function Bars({ bars, className, style }: { bars: number[]; className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox={`0 0 ${bars.length} 100`} preserveAspectRatio="none" className={cn("pointer-events-none absolute inset-x-2 inset-y-0 h-full w-[calc(100%-1rem)]", className)} style={style} aria-hidden>
      {bars.map((p, i) => {
        const h = 8 + p * 76;
        return <rect key={i} x={i + 0.28} width={0.44} y={50 - h / 2} height={h} rx={0.22} fill="currentColor" />;
      })}
    </svg>
  );
}

function Handle({
  side,
  at,
  label,
  value,
  text,
  max,
  onPointerDown,
  onKeyDown,
}: {
  side: "start" | "end";
  at: number;
  label: string;
  value: number;
  text: string;
  max: number;
  onPointerDown: (e: React.PointerEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      aria-valuetext={text}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      // A 44 px target, centred on the window's edge; the bar it shows sits inside the window.
      className={cn(
        "group absolute inset-y-[-6px] z-10 flex w-11 cursor-ew-resize items-center outline-none",
        side === "start" ? "-translate-x-[14px] justify-start pl-[11px]" : "-translate-x-[30px] justify-end pr-[11px]",
      )}
      style={{ left: `${at}%` }}
    >
      <span
        className={cn(
          "flex h-full w-[14px] items-center justify-center bg-primary shadow-md group-focus-visible:ring-2 group-focus-visible:ring-ring",
          side === "start" ? "rounded-l-xl" : "rounded-r-xl",
        )}
      >
        <span className="h-6 w-[3px] rounded-full bg-primary-foreground/90" />
      </span>
    </div>
  );
}
