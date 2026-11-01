"use client";

import { Play } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { DEMO_MEDIA, DEMO_START, demoReducer, FLASH_MS, gainsFor, isRunning, playLabel, type DemoState } from "@/lib/av/clean-voice-demo";
import { cn } from "@/lib/utils";

/**
 * Clean up voice's demo, for anyone who hasn't cleaned a file of their own yet: a photo of a woman talking in a busy
 * brasserie, and one tap to hear her. Both takes (the room as recorded, her voice alone) start together through Web Audio,
 * one AudioContext with a gain each, so a switch happens at the same moment in her speech; the picture softens with the
 * sound. What happens when is decided in src/lib/av/clean-voice-demo.ts.
 */

type Win = Window & { webkitAudioContext?: typeof AudioContext };
type Nav = Navigator & { audioSession?: { type: string } };

const decode = (ctx: AudioContext, bytes: ArrayBuffer) => new Promise<AudioBuffer>((ok, no) => ctx.decodeAudioData(bytes, ok, no));

/** Stops clips quietly: a stopped clip doesn't count as the end of the demo. */
function stopAll(sources: AudioBufferSourceNode[]) {
  for (const s of sources) {
    s.onended = null;
    try {
      s.stop();
    } catch {}
  }
}

/** iPhone: play like a video does, with the ringer switch on silent too (asked before the sound starts). */
function playThroughSilentSwitch() {
  try {
    const session = (navigator as Nav).audioSession;
    if (session) session.type = "playback";
  } catch {}
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.arrayBuffer();
}

export function CleanVoiceDemo({ name = "Clean up voice", className }: { name?: string; className?: string }) {
  const [state, dispatch] = useReducer(demoReducer, DEMO_START);
  // The last automatic switch whose "Noise removed" has gone again.
  const [shown, setShown] = useState(0);
  const toast = state.flash > shown;
  const stateRef = useRef<DemoState>(state);
  const ctxRef = useRef<AudioContext | null>(null);
  const bytesRef = useRef<Promise<ArrayBuffer[]> | null>(null);
  const buffersRef = useRef<AudioBuffer[] | null>(null);
  const gainsRef = useRef<GainNode[] | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const t0Ref = useRef(0);
  const lengthRef = useRef(8);
  const barRef = useRef<HTMLElement>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /** Both clips' bytes, fetched once (again after a failure). */
  const bytes = useCallback(() => {
    bytesRef.current ??= Promise.all([fetchBytes(DEMO_MEDIA.noisy), fetchBytes(DEMO_MEDIA.clean)]).catch((e) => {
      bytesRef.current = null;
      throw e;
    });
    return bytesRef.current;
  }, []);

  // Fetch the clips straight away, so the first tap plays at once.
  useEffect(() => {
    bytes().catch(() => {});
  }, [bytes]);

  /** The AudioContext, made and resumed inside the tap (a phone only lets a tap start sound). */
  const context = () => {
    if (!ctxRef.current) {
      const AC = window.AudioContext ?? (window as Win).webkitAudioContext;
      if (!AC) return null;
      playThroughSilentSwitch();
      ctxRef.current = new AC();
    }
    ctxRef.current.resume().catch(() => {});
    return ctxRef.current;
  };

  // A new run: both clips from the top, at the gains of the mode it starts in.
  useEffect(() => {
    if (!state.run) return;
    let cancelled = false;
    (async () => {
      const ctx = ctxRef.current;
      if (!ctx) throw new Error("No Web Audio");
      if (!buffersRef.current) {
        const raw = await bytes();
        // decodeAudioData takes its buffer over: decode copies, so a later decode still has the bytes.
        buffersRef.current = await Promise.all(raw.map((b) => decode(ctx, b.slice(0))));
        lengthRef.current = Math.min(...buffersRef.current.map((b) => b.duration));
      }
      if (cancelled) return;
      stopAll(sourcesRef.current);
      sourcesRef.current = [];
      const target = gainsFor(stateRef.current.clean);
      const gains = buffersRef.current.map((_, i) => {
        const g = ctx.createGain();
        g.gain.value = target[i];
        g.connect(ctx.destination);
        return g;
      });
      const t0 = ctx.currentTime + 0.05;
      const sources = buffersRef.current.map((b, i) => {
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(gains[i]);
        s.start(t0);
        return s;
      });
      sources[0].onended = () => dispatch({ type: "ended" });
      gainsRef.current = gains;
      sourcesRef.current = sources;
      t0Ref.current = t0;
      dispatch({ type: "started" });
    })().catch(() => {
      if (!cancelled) dispatch({ type: "failed" });
    });
    return () => {
      cancelled = true;
    };
  }, [state.run, bytes]);

  // A switch: both gains ramp at once, so the voice carries on where it was.
  useEffect(() => {
    const ctx = ctxRef.current;
    const gains = gainsRef.current;
    if (!ctx || !gains) return;
    const now = ctx.currentTime;
    gainsFor(state.clean).forEach((v, i) => {
      const g = gains[i].gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(v, now + Math.max(state.ramp, 0.01));
    });
  }, [state.clean, state.ramp]);

  // The progress line and the automatic switch follow the clips' own clock (it stops while paused).
  useEffect(() => {
    if (state.phase !== "playing") {
      if (state.phase === "done" && barRef.current) barRef.current.style.width = "100%";
      return;
    }
    let raf = 0;
    const step = () => {
      const ctx = ctxRef.current;
      if (!ctx) return;
      const t = Math.max(0, ctx.currentTime - t0Ref.current);
      if (barRef.current) barRef.current.style.width = `${Math.min(100, (t / lengthRef.current) * 100)}%`;
      const s = stateRef.current;
      if (s.auto && !s.clean) dispatch({ type: "time", t });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [state.phase]);

  // "Noise removed", for a moment, when the noise goes by itself.
  useEffect(() => {
    if (!state.flash) return;
    const flash = state.flash;
    const t = setTimeout(() => setShown(flash), FLASH_MS);
    return () => clearTimeout(t);
  }, [state.flash]);

  // Leaving the page stops the sound.
  useEffect(
    () => () => {
      stopAll(sourcesRef.current);
      sourcesRef.current = [];
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    },
    [],
  );

  const tap = () => {
    const s = stateRef.current;
    if (s.phase === "loading") return;
    if (s.phase === "playing") ctxRef.current?.suspend().catch(() => {});
    else if (s.phase === "paused") ctxRef.current?.resume().catch(() => {});
    else if (!context()) return void dispatch({ type: "failed" });
    dispatch({ type: "tap" });
  };
  const choose = (clean: boolean) => {
    if (!isRunning(stateRef.current) && !context()) return void dispatch({ type: "failed" });
    dispatch({ type: "choose", clean });
  };

  const playing = state.phase === "playing";
  const moving = isRunning(state) || state.phase === "done";
  const buttonShown = !playing;

  return (
    <section className={cn("mx-auto grid w-full max-w-[760px] gap-[18px]", className)} aria-labelledby="clean-voice-demo">
      <header className="grid gap-1.5">
        <span className="text-[12px] font-medium tracking-[.06em] text-muted-foreground uppercase">{name}</span>
        <h2 id="clean-voice-demo" className="font-heading text-[clamp(34px,7vw,48px)] leading-[1.05] tracking-[-.01em] text-balance">
          Hear her, not the room.
        </h2>
        <p className="max-w-[52ch] text-[15px] leading-[1.55] text-muted-foreground">
          A phone recording from a packed brasserie: music, clatter and every other table. Tap play and the room falls away while she keeps talking.
        </p>
      </header>

      <div
        role="group"
        aria-label="Demo: a woman talking in a busy brasserie"
        onClick={tap}
        className="relative isolate aspect-[4/3] w-full max-w-full cursor-pointer overflow-hidden rounded-xl bg-media [-webkit-tap-highlight-color:transparent]"
      >
        <div
          className={cn(
            "absolute inset-0 origin-[50%_38%] transition-transform duration-[9s] ease-[cubic-bezier(.2,.6,.3,1)] motion-reduce:scale-100 motion-reduce:transition-none",
            moving && "scale-[1.045]",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={DEMO_MEDIA.room}
            alt="A woman talking at a marble table in a packed Paris brasserie, waiters and diners behind her"
            width={1280}
            height={960}
            fetchPriority="high"
            draggable={false}
            className="absolute inset-0 block size-full object-cover select-none"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={DEMO_MEDIA.quiet}
            alt=""
            width={1280}
            height={960}
            draggable={false}
            data-demo-quiet
            className={cn("absolute inset-0 block size-full object-cover transition-opacity duration-1000 ease-in-out select-none motion-reduce:transition-none", state.clean ? "opacity-100" : "opacity-0")}
          />
        </div>

        <span
          className="absolute top-3 left-3 z-[2] inline-flex items-center gap-2 rounded-full bg-[rgb(10_8_6/.55)] py-1.5 pr-3 pl-2.5 text-[13px] font-medium text-white backdrop-blur-[10px]"
          aria-live="polite"
        >
          <span className={cn("size-2 rounded-full motion-reduce:animate-none", state.clean ? "bg-[#7ee2b8]" : "bg-[#ffb347]", playing && !state.clean && "animate-live-dot")} />
          <span data-demo-state>{state.clean ? "Voice only" : "Busy brasserie"}</span>
        </span>

        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute top-1/2 left-1/2 z-[2] -translate-x-1/2 rounded-full bg-[rgb(10_8_6/.6)] px-[18px] py-2.5 font-heading text-[26px] leading-[1.1] tracking-[.01em] whitespace-nowrap text-white backdrop-blur-[10px] transition-[opacity,translate] duration-600 ease-in-out motion-reduce:transition-none",
            toast ? "-translate-y-1/2 opacity-100" : "-translate-y-[40%] opacity-0",
          )}
        >
          Noise removed
        </span>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            tap();
          }}
          tabIndex={buttonShown ? 0 : -1}
          className={cn(
            "absolute bottom-[22px] left-1/2 z-[3] inline-flex min-h-[52px] -translate-x-1/2 cursor-pointer items-center gap-2.5 rounded-full border-0 bg-white/92 pr-[22px] pl-4 text-[15px] leading-none font-semibold text-[#141210] shadow-[0_10px_30px_rgb(0_0_0/.35)] transition-[opacity,translate] duration-350 ease-in-out outline-none focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ring motion-reduce:transition-none",
            buttonShown ? "opacity-100" : "pointer-events-none translate-y-1.5 opacity-0",
          )}
        >
          <Play className="size-[22px] fill-current" aria-hidden="true" />
          <span>{playLabel(state)}</span>
        </button>

        <div className="absolute inset-x-0 bottom-0 z-[2] h-[3px] bg-white/18" aria-hidden="true">
          <i ref={barRef} className="block h-full w-0 bg-white" />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex gap-1 rounded-full bg-muted p-1" role="group" aria-label="Noise">
          {[
            { clean: false, label: "Noise on" },
            { clean: true, label: "Noise off" },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              aria-pressed={state.clean === o.clean}
              onClick={() => choose(o.clean)}
              className={cn(
                "min-h-11 cursor-pointer rounded-full px-[18px] text-[14px] leading-none font-medium transition-[background-color,color] duration-250 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                state.clean === o.clean ? "bg-background text-foreground shadow-[0_1px_3px_rgb(0_0_0/.12)]" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="m-0 text-[13px] text-muted-foreground" data-demo-hint>
          {state.hint}
        </p>
      </div>

      <p className="max-w-[60ch] border-t pt-3.5 text-[13px] text-muted-foreground">
        Same 8 seconds, same moment in her sentence: switching only changes what you hear around her voice.
      </p>
    </section>
  );
}
