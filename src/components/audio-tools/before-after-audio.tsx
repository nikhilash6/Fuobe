"use client";

import { Loader2, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { clock } from "@/lib/av/audio-tools";
import { cn } from "@/lib/utils";

/**
 * Before / after for a voice: both files play from one shared playhead, each through its own gain, and the Before | After
 * switch (keys B and A, Space to play) crossfades the two in 30 ms, so the switch happens at the same moment in the
 * speech. Over it, a spectrogram of both (an FFT of 1024 points in the browser, drawn once), with a divider that shows
 * the before on its left and the after on its right; the divider follows the switch and can be dragged.
 *
 * The comparison is only fair at the same level: the node matches the after's speech level to the before's, and the
 * demo pairs are made that way.
 */

/** Files bigger than this are compared with two plain players (decoding both would take too much memory). */
const DECODE_MAX_BYTES = 96 * 1024 * 1024;
const FFT = 1024;
const COLUMNS = 480;
const ROWS = 160;

async function sizeOf(url: string): Promise<number | undefined> {
  try {
    const r = await fetch(url, { headers: { Range: "bytes=0-0" } });
    const total = Number(/\/(\d+)\s*$/.exec(r.headers.get("content-range") ?? "")?.[1] ?? r.headers.get("content-length"));
    await r.body?.cancel().catch(() => {});
    return total > 0 ? total : undefined;
  } catch {
    return undefined;
  }
}

/** In-place radix-2 FFT of (re, im), n a power of two. */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** A dark-to-bright colour for a level 0…1 (black, violet, orange, pale yellow). */
function heat(v: number): [number, number, number] {
  const stops: [number, number, number, number][] = [
    [0, 4, 4, 12],
    [0.35, 84, 26, 128],
    [0.65, 222, 82, 66],
    [1, 252, 246, 186],
  ];
  const x = Math.max(0, Math.min(1, v));
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [p0, r0, g0, b0] = stops[i - 1];
      const [p1, r1, g1, b1] = stops[i];
      const t = (x - p0) / (p1 - p0);
      return [r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t];
    }
  }
  return [252, 246, 186];
}

/** The spectrogram of a buffer (its channels mixed), COLUMNS x ROWS, frequency rising upwards, linear to the Nyquist rate. */
export function spectrogram(buf: AudioBuffer, columns = COLUMNS, rows = ROWS): ImageData | null {
  if (typeof ImageData === "undefined") return null;
  const n = buf.length;
  const mono = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels;
  }
  const img = new ImageData(columns, rows);
  const win = new Float32Array(FFT).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT - 1)));
  const re = new Float32Array(FFT);
  const im = new Float32Array(FFT);
  const bins = FFT / 2;
  for (let x = 0; x < columns; x++) {
    const start = Math.floor((x / columns) * Math.max(0, n - FFT));
    for (let i = 0; i < FFT; i++) {
      re[i] = (mono[start + i] ?? 0) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let y = 0; y < rows; y++) {
      // Each row averages its bins (rows < bins).
      const b0 = Math.floor((y / rows) * bins);
      const b1 = Math.max(b0 + 1, Math.floor(((y + 1) / rows) * bins));
      let p = 0;
      for (let b = b0; b < b1; b++) p += re[b] * re[b] + im[b] * im[b];
      const db = 10 * Math.log10(p / (b1 - b0) / (FFT * FFT) + 1e-12);
      const [r, g, bl] = heat((db + 110) / 90);
      const o = ((rows - 1 - y) * columns + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = bl;
      img.data[o + 3] = 255;
    }
  }
  return img;
}

type Side = "before" | "after";

function silence(nodes: AudioBufferSourceNode[]) {
  for (const n of nodes) {
    n.onended = null;
    try {
      n.stop();
    } catch {}
  }
}

type PlayerProps = {
  before: string;
  after: string;
  labels?: { before: string; after: string };
  className?: string;
  autoFocus?: boolean;
};

/** One player per pair: a new pair starts from a fresh one (its own audio context, decoded files and playhead). */
export function BeforeAfterAudio(props: PlayerProps) {
  return <Player key={`${props.before}|${props.after}`} {...props} />;
}

function Player({ before, after, labels = { before: "Before", after: "After" }, className, autoFocus }: PlayerProps) {
  const ctx = useRef<AudioContext | null>(null);
  const gains = useRef<Partial<Record<Side, GainNode>>>({});
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const started = useRef<{ at: number; offset: number } | null>(null);
  const [buffers, setBuffers] = useState<Partial<Record<Side, AudioBuffer>>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [plain, setPlain] = useState(false);
  const [side, setSide] = useState<Side>("after");
  const [divider, setDivider] = useState(0.5);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const switchId = useId();

  // One audio context per pair, both files decoded once (or two plain players for files too big to decode here).
  useEffect(() => {
    let live = true;
    let ac: AudioContext | null = null;
    try {
      ac = new AudioContext();
    } catch {
      // No WebAudio here: two plain players.
      queueMicrotask(() => live && setPlain(true));
      return () => {
        live = false;
      };
    }
    ctx.current = ac;
    for (const s of ["before", "after"] as const) {
      const g = ac.createGain();
      g.gain.value = s === "after" ? 1 : 0;
      g.connect(ac.destination);
      gains.current[s] = g;
    }
    void (async () => {
      const sizes = await Promise.all([sizeOf(before), sizeOf(after)]);
      if (!live) return;
      if (sizes.some((n) => n && n > DECODE_MAX_BYTES)) return void setPlain(true);
      for (const [s, url] of [
        ["before", before],
        ["after", after],
      ] as const)
        void fetch(url)
          .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.arrayBuffer();
          })
          .then((data) => ac!.decodeAudioData(data))
          .then((buf) => live && setBuffers((b) => ({ ...b, [s]: buf })))
          .catch(() => live && setFailed("Couldn't load the audio in the browser — download it instead"));
    })();
    return () => {
      live = false;
      silence(sources.current);
      sources.current = [];
      started.current = null;
      ctx.current = null;
      gains.current = {};
      void ac?.close();
    };
  }, [before, after]);

  const ready = !!buffers.before && !!buffers.after;
  const length = useMemo(() => Math.max(buffers.before?.duration ?? 0, buffers.after?.duration ?? 0), [buffers]);

  // The spectrograms, drawn once per pair, then cut at the divider.
  const images = useMemo(() => (ready ? { before: spectrogram(buffers.before!), after: spectrogram(buffers.after!) } : null), [ready, buffers]);
  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext("2d");
    if (!c || !g || !images?.before || !images.after) return;
    const cut = Math.round(divider * COLUMNS);
    g.putImageData(images.after, 0, 0);
    g.putImageData(images.before, 0, 0, 0, 0, cut, ROWS);
  }, [images, divider]);

  const stop = useCallback(() => {
    if (started.current && ctx.current) setPosition(Math.min(length, started.current.offset + ctx.current.currentTime - started.current.at));
    silence(sources.current);
    sources.current = [];
    started.current = null;
    setPlaying(false);
  }, [length]);

  const play = useCallback(
    (from?: number) => {
      const ac = ctx.current;
      if (!ac || !ready) return;
      silence(sources.current);
      void ac.resume();
      const offset = Math.max(0, Math.min(from ?? position, length - 0.05));
      const when = ac.currentTime + 0.02;
      sources.current = (["before", "after"] as const).map((s) => {
        const src = ac.createBufferSource();
        src.buffer = buffers[s]!;
        src.connect(gains.current[s]!);
        src.start(when, Math.min(offset, src.buffer.duration));
        return src;
      });
      const longest = sources.current.reduce((a, b) => ((b.buffer?.duration ?? 0) > (a.buffer?.duration ?? 0) ? b : a));
      longest.onended = () => {
        started.current = null;
        sources.current = [];
        setPlaying(false);
        setPosition(0);
      };
      started.current = { at: when, offset };
      setPosition(offset);
      setPlaying(true);
    },
    [buffers, length, position, ready],
  );

  // The playhead, about 20 times a second while playing.
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      if (started.current && ctx.current) setPosition(Math.max(0, Math.min(length, started.current.offset + ctx.current.currentTime - started.current.at)));
    }, 50);
    return () => clearInterval(t);
  }, [playing, length]);

  /** Switch sides: a 30 ms crossfade at this very moment, and the divider shows that side whole. */
  const pick = useCallback((s: Side) => {
    setSide(s);
    setDivider(s === "before" ? 1 : 0);
    const ac = ctx.current;
    if (!ac) return;
    for (const k of ["before", "after"] as const) gains.current[k]?.gain.setTargetAtTime(k === s ? 1 : 0, ac.currentTime, 0.01);
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest("input, textarea, [role=slider]")) return;
    const k = e.key.toLowerCase();
    if (k === "b") pick("before");
    else if (k === "a") pick("after");
    else if (k === " ") {
      e.preventDefault();
      if (playing) stop();
      else play();
    } else return;
  };

  const dragTo = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return;
    setDivider(Math.max(0, Math.min(1, (clientX - r.left) / r.width)));
  };

  if (plain)
    return (
      <div className={cn("grid gap-3 sm:grid-cols-2", className)}>
        {(["before", "after"] as const).map((s) => (
          <div key={s} className="min-w-0 space-y-1">
            <p className="text-[12px] font-medium text-muted-foreground">{labels[s]}</p>
            <audio src={s === "before" ? before : after} controls preload="metadata" className="h-9 w-full min-w-0" aria-label={labels[s]} />
          </div>
        ))}
      </div>
    );

  const at = length ? position / length : 0;
  return (
    <div className={cn("min-w-0 space-y-2 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring", className)} tabIndex={0} onKeyDown={onKey} autoFocus={autoFocus} aria-label="Before and after player: B for before, A for after, Space to play">
      <div
        ref={box}
        className="relative h-36 w-full touch-none overflow-hidden rounded-xl bg-[#04040c] select-none sm:h-44"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).dataset.handle) {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            return;
          }
          const r = box.current!.getBoundingClientRect();
          const t = ((e.clientX - r.left) / r.width) * length;
          if (playing) play(t);
          else setPosition(t);
        }}
        onPointerMove={(e) => (e.buttons & 1 && (e.target as HTMLElement).dataset.handle ? dragTo(e.clientX) : undefined)}
      >
        <canvas ref={canvas} width={COLUMNS} height={ROWS} className="absolute inset-0 h-full w-full" aria-hidden />
        {!ready && !failed && (
          <span className="absolute inset-0 grid place-items-center text-[12px] text-white/70">
            <Loader2 className="size-4 animate-spin" />
          </span>
        )}
        <span className="pointer-events-none absolute top-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">{labels.before}</span>
        <span className="pointer-events-none absolute top-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">{labels.after}</span>
        <span className="pointer-events-none absolute inset-y-0 w-px bg-white/90" style={{ left: `${at * 100}%` }} aria-hidden />
        <div
          data-handle="1"
          role="slider"
          tabIndex={0}
          aria-label="Divider between before and after"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(divider * 100)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setDivider((d) => Math.max(0, d - 0.05));
            else if (e.key === "ArrowRight") setDivider((d) => Math.min(1, d + 0.05));
          }}
          className="absolute inset-y-0 z-10 w-6 -translate-x-1/2 cursor-ew-resize outline-none focus-visible:ring-2 focus-visible:ring-white"
          style={{ left: `${divider * 100}%` }}
        >
          <span data-handle="1" className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_6px_rgba(0,0,0,0.6)]" />
          <span data-handle="1" className="absolute top-1/2 left-1/2 size-5 -translate-1/2 rounded-full border-2 border-white bg-black/60" />
        </div>
      </div>
      {failed && (
        <p className="text-[12px] text-destructive" role="alert">
          {failed}
        </p>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button size="sm" className="rounded-full" disabled={!ready} onClick={() => (playing ? stop() : play())} aria-label={playing ? "Pause" : "Play"}>
          {!ready ? <Loader2 className="size-3.5 animate-spin" /> : playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          {playing ? "Pause" : "Play"}
        </Button>
        <div role="radiogroup" aria-label="Hear" id={switchId} className="inline-flex gap-0.5 rounded-full bg-muted p-0.5">
          {(["before", "after"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={side === s}
              onClick={() => pick(s)}
              className={cn("h-8 rounded-full px-3 text-[13px] font-medium transition", side === s ? "bg-background text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground")}
            >
              {labels[s]}
              <kbd className="ml-1.5 hidden font-mono text-[10px] text-muted-foreground sm:inline">{s === "before" ? "B" : "A"}</kbd>
            </button>
          ))}
        </div>
        <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
          {clock(position)} / {clock(length)}
        </span>
        <Slider
          min={0}
          max={Math.max(0.1, length)}
          step={0.05}
          value={[Math.min(position, length)]}
          onValueChange={([v]) => (playing ? play(v) : setPosition(v))}
          disabled={!ready}
          aria-label="Position"
          aria-valuetext={`${clock(position)} of ${clock(length)}`}
          className="min-w-[7rem] flex-1 basis-32"
        />
      </div>
    </div>
  );
}
