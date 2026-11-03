"use client";

import { Play, Zap } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavUi } from "@/components/nav/nav-ui";
import { usePreviewPlayback, usePreviewsPaused } from "@/components/preset-preview";
import type { BentoPicture } from "@/lib/home-bento";
import { releaseVideo } from "@/lib/media-release";
import { browserPlaybackEnv } from "@/lib/preview-playback";
import { s } from "./home-bento-classes";

/*
 * The first screen's few islands (home-bento.tsx): the switch that lets it move, its two clips, the typing on the live
 * tile and the numbers tile's launcher. Everything else on it is HTML from the server.
 */

/** Whether the page has loaded (the clips wait for it) and whether the first screen may move now (BentoMotion). */
const motion = (() => {
  let loaded = false;
  let play = false;
  const subs = new Set<() => void>();
  const emit = () => subs.forEach((f) => f());
  return {
    subscribe(f: () => void) {
      subs.add(f);
      return () => void subs.delete(f);
    },
    loaded: () => loaded,
    play: () => play,
    setLoaded() {
      if (loaded) return;
      loaded = true;
      emit();
    },
    setPlay(b: boolean) {
      if (play === b) return;
      play = b;
      emit();
    },
  };
})();

const useLoaded = () => useSyncExternalStore(motion.subscribe, motion.loaded, () => false);
const usePlay = () => useSyncExternalStore(motion.subscribe, motion.play, () => false);

/** Runs `cb` once the page has loaded and the browser is idle: the first screen's stills come first. */
function afterLoad(cb: () => void): () => void {
  let id = 0;
  let cancelled = false;
  const idle = () => {
    if (cancelled) return;
    if (typeof requestIdleCallback === "function") id = requestIdleCallback(cb, { timeout: 2000 });
    else id = window.setTimeout(cb, 200);
  };
  if (document.readyState === "complete") idle();
  else window.addEventListener("load", idle, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener("load", idle);
    if (typeof cancelIdleCallback === "function") cancelIdleCallback(id);
    clearTimeout(id);
  };
}

/**
 * Lets the first screen move: data-play="1" on the section while it is at least 15 % on screen, the tab is visible, the
 * page has loaded and previews aren't paused (Pause previews); "0" once one of those stops holding, so every animation
 * freezes where it is. Under reduced motion or Save-Data it is never set, and everything rests on its still frame.
 */
export function BentoMotion({ target }: { target: string }) {
  const paused = usePreviewsPaused();
  useEffect(() => {
    const el = document.getElementById(target);
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let inView = false;
    let loaded = motion.loaded();
    const update = () => {
      const on = loaded && inView && !document.hidden && !paused && !reduced.matches && !browserPlaybackEnv.saveData();
      if (on) el.dataset.play = "1";
      else if (el.dataset.play) el.dataset.play = "0";
      motion.setPlay(on);
    };
    const io = new IntersectionObserver(
      ([e]) => {
        inView = e.isIntersecting && e.intersectionRatio >= 0.15;
        update();
      },
      { threshold: [0, 0.15, 0.3] },
    );
    io.observe(el);
    const cancel = afterLoad(() => {
      loaded = true;
      motion.setLoaded();
      update();
    });
    document.addEventListener("visibilitychange", update);
    reduced.addEventListener("change", update);
    return () => {
      cancel();
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
      reduced.removeEventListener("change", update);
    };
  }, [paused, target]);
  return null;
}

/**
 * A tile's clip, over its still: it joins the site's playback rules (preset-preview.tsx) once the page has loaded, so
 * it plays in view, at most a few at once, never under reduced motion, Save-Data or Pause previews, and a hover or
 * keyboard focus on its tile still plays it. Its source is set only when it first plays. Once started it stays mounted
 * and pauses on its frame. `progress`: a line along the bottom follows the clip; `glyph`: a play sign until it plays.
 */
export function BentoClip({ id, clip, progress, glyph }: { id: string; clip: string; progress?: boolean; glyph?: boolean }) {
  const loaded = useLoaded();
  const { ref, playing, handlers } = usePreviewPlayback<HTMLSpanElement>(id, loaded ? { video: clip } : {});
  const [started, setStarted] = useState(false);
  if (playing && !started) setStarted(true);
  const [ready, setReady] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const bar = useRef<HTMLElement>(null);
  const on = useRef(handlers);
  useEffect(() => {
    on.current = handlers;
  });

  // The tile is the link: its keyboard focus plays the clip as a card's does.
  useEffect(() => {
    const a = ref.current?.closest("a");
    if (!a) return;
    const focus = () => on.current.onFocus({ currentTarget: a } as unknown as React.FocusEvent);
    const blur = () => on.current.onBlur();
    a.addEventListener("focus", focus);
    a.addEventListener("blur", blur);
    return () => {
      a.removeEventListener("focus", focus);
      a.removeEventListener("blur", blur);
    };
  }, [ref]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (playing) void v.play().catch(() => {});
    else v.pause();
  }, [playing, started]);

  // The line follows the clip itself, a frame at a time while it plays: it can't drift from it.
  useEffect(() => {
    const v = video.current;
    const b = bar.current;
    if (!v || !b || !playing || !ready) return;
    let raf = 0;
    const tick = () => {
      if (v.duration > 0) b.style.transform = `scaleX(${v.currentTime / v.duration})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, ready]);

  useEffect(() => {
    const v = video.current;
    return () => releaseVideo(v);
  }, [started]);

  return (
    <span ref={ref} aria-hidden className={s.clip} onPointerEnter={handlers.onPointerEnter} onPointerLeave={handlers.onPointerLeave}>
      {started && <video ref={video} src={clip} muted loop playsInline preload="auto" data-ready={ready || undefined} onLoadedData={() => setReady(true)} />}
      {glyph && (
        <span className={s.playGlyph} data-on={(playing && ready) || undefined}>
          <Play className="size-6" fill="#fff" stroke="#fff" />
        </span>
      )}
      {progress && (
        <span className={s.progress}>
          <i ref={bar} />
        </span>
      )}
    </span>
  );
}

/** How long each part of the live tile's loop takes, in ms. */
const TYPE_MS = 55;
const FADE_MS = 320;
const HOLD_MS = 1400;
const BACK_MS = 250;

/**
 * The live tile: the Live edit session's own words typed one character at a time, each phrase followed by the picture
 * it made (a 320 ms crossfade), held, then the next phrase in its place; after the last, back to the first picture and
 * round again. Before the page moves (and under reduced motion) it shows the first picture and the first phrase whole.
 * The later pictures are fetched only when it first plays, while the first phrase holds.
 */
export function LiveTyping({ frames, phrases, sizes }: { frames: BentoPicture[]; phrases: string[]; sizes: string }) {
  const play = usePlay();
  const [text, setText] = useState(phrases[0]);
  const [shown, setShown] = useState(0);
  const [back, setBack] = useState(false);
  // The later pictures are asked for once it first plays: they load while the first phrase holds.
  const [fetched, setFetched] = useState(false);
  if (play && !fetched) setFetched(true);
  // The first phrase is already shown whole, so the loop starts at its end: its picture fades in, then phrase two types.
  const begun = useRef(false);
  const step = useRef({ phrase: 0, char: phrases[0].length, phase: "type" as "type" | "fade" | "hold" | "back" });

  useEffect(() => {
    if (!play) return;
    const st = step.current;
    let t = 0;
    const run = () => {
      const phrase = phrases[st.phrase];
      if (st.phase === "type") {
        if (st.char < phrase.length) {
          st.char += 1;
          setText(phrase.slice(0, st.char));
          t = window.setTimeout(run, TYPE_MS);
          return;
        }
        st.phase = "fade";
        setBack(false);
        setShown(st.phrase + 1);
        t = window.setTimeout(run, FADE_MS);
        return;
      }
      if (st.phase === "fade") {
        st.phase = "hold";
        t = window.setTimeout(run, HOLD_MS);
        return;
      }
      // The last phrase stays in the field until the next one's first character replaces it: it is never empty.
      if (st.phase === "hold") {
        if (st.phrase + 1 < phrases.length) {
          st.phrase += 1;
          st.char = 0;
          st.phase = "type";
          t = window.setTimeout(run, TYPE_MS);
          return;
        }
        st.phase = "back";
        setBack(true);
        setShown(0);
        t = window.setTimeout(run, BACK_MS + 400);
        return;
      }
      st.phrase = 0;
      st.char = 0;
      st.phase = "type";
      t = window.setTimeout(run, TYPE_MS);
    };
    // The first time, the first phrase holds a moment while the next pictures load; after that it carries on where it stopped.
    const wait = !begun.current ? HOLD_MS : st.phase === "type" ? TYPE_MS : 0;
    begun.current = true;
    t = window.setTimeout(run, wait);
    return () => clearTimeout(t);
    // The loop picks up where it stopped when the tile plays again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);

  return (
    <>
      {frames.map((f, i) =>
        i === 0 || fetched ? (
          <picture key={i} className={s.pic}>
            <source type="image/avif" srcSet={f.avif.map((a) => `${a.src} ${a.w}w`).join(", ")} sizes={sizes} />
            <img
              src={f.fallback}
              alt=""
              width={512}
              height={384}
              fetchPriority="low"
              decoding="async"
              draggable={false}
              className={`${s.fill} ${s.frame}`}
              data-on={i <= shown || undefined}
              data-back={back || undefined}
            />
          </picture>
        ) : null,
      )}
      <span aria-hidden className={s.pill}>
        <Zap className="size-3.5" />
        <span className={s.typed}>
          <span>{text}</span>
        </span>
        <span className={s.caret} />
      </span>
    </>
  );
}

/**
 * The numbers tile: a link to the Studios section, which opens every studio where it can (the launcher on a desktop,
 * the Studios sheet on a phone) instead. A modified click still follows the link.
 */
export function NumbersLink({ children, ...props }: React.ComponentProps<"a">) {
  const { openStudios } = useNavUi();
  return (
    <a
      {...props}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        openStudios();
      }}
    >
      {children}
    </a>
  );
}
