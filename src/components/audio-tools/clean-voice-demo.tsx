"use client";

import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useId, useReducer, useRef, useState } from "react";
import {
  createDemoAudio,
  DEMO_MEDIA,
  DEMO_START,
  demoReducer,
  FLASH_MS,
  isRunning,
  playLabel,
  switchDue,
  type DemoAudio,
  type DemoState,
} from "@/lib/av/clean-voice-demo";
import { cn } from "@/lib/utils";

/**
 * Clean up voice's demo, for anyone who hasn't cleaned a file of their own yet: a photo of a woman talking in a noisy
 * restaurant, and one tap to take the noise away. Both takes (the room as recorded, her voice alone) start together
 * through Web Audio, one AudioContext with a gain each, so a switch happens at the same moment in her speech; the picture
 * softens with the sound. What happens when is decided in src/lib/av/clean-voice-demo.ts.
 */

type Win = Window & { webkitAudioContext?: typeof AudioContext };
type Nav = Navigator & { audioSession?: { type: string } };

/** A clip that hasn't arrived by then counts as not loaded (the button offers to try again). */
const FETCH_TIMEOUT_MS = 15_000;

const decode = (ctx: AudioContext, bytes: ArrayBuffer) => new Promise<AudioBuffer>((ok, no) => ctx.decodeAudioData(bytes, ok, no));

/** iPhone: play like a video does, with the ringer switch on silent too (asked before the sound starts). */
function playThroughSilentSwitch() {
  try {
    const session = (navigator as Nav).audioSession;
    if (session) session.type = "playback";
  } catch {}
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(FETCH_TIMEOUT_MS) : undefined;
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.arrayBuffer();
}

export function CleanVoiceDemo({
  name = "Clean up voice",
  ready = true,
  className,
}: {
  name?: string;
  /** False while the page doesn't yet know whether to show the demo: it keeps its place, unseen, and fetches nothing. */
  ready?: boolean;
  className?: string;
}) {
  const [state, dispatch] = useReducer(demoReducer, DEMO_START);
  // The last automatic switch whose "Noise removed" has gone again.
  const [shown, setShown] = useState(0);
  const toast = state.flash > shown;
  const headingId = useId();
  const stateRef = useRef<DemoState>(state);
  const ctxRef = useRef<AudioContext | null>(null);
  const bytesRef = useRef<Promise<ArrayBuffer[]> | null>(null);
  const audioRef = useRef<DemoAudio | null>(null);
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

  // Fetch the clips as soon as the demo shows, so the first tap plays at once.
  useEffect(() => {
    if (ready) bytes().catch(() => {});
  }, [ready, bytes]);

  /** The AudioContext, made and resumed inside the tap (a phone only lets a tap start sound). */
  const context = () => {
    if (!ctxRef.current) {
      const AC = window.AudioContext ?? (window as Win).webkitAudioContext;
      if (!AC) return null;
      playThroughSilentSwitch();
      let ctx: AudioContext;
      try {
        ctx = new AC();
      } catch {
        return null;
      }
      // A call, the lock screen or another app can stop the sound: show it as paused, so one tap resumes it.
      ctx.onstatechange = () => {
        if (ctx.state !== "running") dispatch({ type: "interrupted" });
      };
      ctxRef.current = ctx;
    }
    ctxRef.current.resume().catch(() => {});
    return ctxRef.current;
  };

  // A new run: both clips from the top, at the gains of the mode it starts in.
  useEffect(() => {
    // Only a start asks for one (the page coming back into view runs this again with nothing to start).
    if (!state.run || stateRef.current.phase !== "loading") return;
    let cancelled = false;
    (async () => {
      const ctx = ctxRef.current;
      if (!ctx) throw new Error("No sound");
      if (!audioRef.current) {
        const raw = await bytes();
        // decodeAudioData takes its buffer over: decode copies, so a later decode still has the bytes.
        const buffers = await Promise.all(raw.map((b) => decode(ctx, b.slice(0))));
        if (cancelled || ctxRef.current !== ctx) return;
        audioRef.current = createDemoAudio(ctx, buffers);
      }
      if (cancelled) return;
      audioRef.current.start(stateRef.current.clean, () => dispatch({ type: "ended" }));
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
    audioRef.current?.switchTo(state.clean, state.ramp);
  }, [state.clean, state.ramp]);

  // The progress line and the automatic switch follow the clips' own clock (it stops while paused).
  useEffect(() => {
    if (state.phase !== "playing") {
      if (barRef.current && state.phase !== "paused") barRef.current.style.width = state.phase === "done" ? "100%" : "0%";
      return;
    }
    let raf = 0;
    const step = () => {
      const audio = audioRef.current;
      if (!audio) return;
      const t = audio.elapsed();
      if (barRef.current) barRef.current.style.width = `${Math.min(100, (t / audio.length) * 100)}%`;
      if (switchDue(stateRef.current, t)) dispatch({ type: "time", t });
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

  // A hidden tab pauses the demo (a phone would otherwise keep playing it in the background).
  useEffect(() => {
    const onHide = () => {
      if (!document.hidden || stateRef.current.phase !== "playing") return;
      ctxRef.current?.suspend().catch(() => {});
      dispatch({ type: "interrupted" });
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  // Leaving the page (or the page being kept aside for a quick way back) stops the sound and starts the demo over.
  useEffect(
    () => () => {
      audioRef.current?.stop();
      audioRef.current = null;
      const ctx = ctxRef.current;
      ctxRef.current = null;
      if (ctx) {
        ctx.onstatechange = null;
        ctx.close().catch(() => {});
      }
      setShown(stateRef.current.flash);
      dispatch({ type: "reset" });
    },
    [],
  );

  const tap = () => {
    const s = stateRef.current;
    if (s.phase === "loading") return;
    const ctx = ctxRef.current;
    // Stopped from outside while it looked like it was playing: this tap brings the sound back.
    if (s.phase === "playing" && ctx && ctx.state !== "running") return void ctx.resume().catch(() => {});
    if (s.phase === "playing") ctx?.suspend().catch(() => {});
    else if (s.phase === "paused") ctx?.resume().catch(() => {});
    else if (!context()) return void dispatch({ type: "failed", unsupported: true });
    dispatch({ type: "tap" });
  };
  const choose = (clean: boolean) => {
    if (!isRunning(stateRef.current) && !context()) return void dispatch({ type: "failed", unsupported: true });
    dispatch({ type: "choose", clean });
  };

  const playing = state.phase === "playing";
  const moving = isRunning(state) || state.phase === "done";
  const buttonShown = !playing;

  return (
    <section
      className={cn("mx-auto grid w-full max-w-[760px] gap-[18px] transition-opacity duration-300 motion-reduce:transition-none", !ready && "invisible opacity-0", className)}
      aria-labelledby={headingId}
    >
      <header className="grid gap-1.5">
        <span className="text-[12px] font-medium tracking-[.06em] text-muted-foreground uppercase">{name}</span>
        <h2 id={headingId} className="font-heading text-[clamp(34px,7vw,48px)] leading-[1.05] tracking-[-.01em] text-balance">
          Studio-clean voice from any recording.
        </h2>
        <p className="max-w-[52ch] text-[15px] leading-[1.55] text-muted-foreground">
          Recorded on a phone in a noisy restaurant. Press play and the noise disappears while she keeps talking.
        </p>
      </header>

      <div
        role="group"
        aria-label="Demo: a woman talking in a noisy restaurant"
        onClick={tap}
        className="relative isolate aspect-[4/3] w-full max-w-full cursor-pointer touch-manipulation overflow-hidden rounded-xl bg-media [-webkit-tap-highlight-color:transparent]"
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
            alt="A woman talking at a marble table in a busy restaurant, waiters and diners behind her"
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
          <span data-demo-state>{state.clean ? "Voice only" : "Noisy restaurant"}</span>
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

        {/* Hidden while it plays, but still reachable from the keyboard: focused, it shows as Pause. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            tap();
          }}
          className={cn(
            "absolute inset-x-0 bottom-[22px] z-[3] mx-auto inline-flex min-h-[52px] w-fit cursor-pointer touch-manipulation items-center gap-2.5 rounded-full border-0 bg-white/92 pr-[22px] pl-4 text-[15px] leading-none font-semibold whitespace-nowrap text-[#141210] shadow-[0_10px_30px_rgb(0_0_0/.35)] transition-[opacity,translate] duration-350 ease-in-out outline-none focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ring motion-reduce:transition-none",
            buttonShown ? "opacity-100" : "pointer-events-none translate-y-1.5 opacity-0 focus-visible:pointer-events-auto focus-visible:translate-y-0 focus-visible:opacity-100",
          )}
        >
          {playing ? <Pause className="size-[22px] fill-current" aria-hidden="true" /> : <Play className="size-[22px] fill-current" aria-hidden="true" />}
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
                "min-h-11 cursor-pointer touch-manipulation rounded-full px-[18px] text-[14px] leading-none font-medium transition-[background-color,color] duration-250 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
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
