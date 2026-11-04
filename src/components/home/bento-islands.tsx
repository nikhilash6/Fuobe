"use client";

import { Zap } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavUi } from "@/components/nav/nav-ui";
import { usePreviewPlayback, usePreviewsPaused } from "@/components/preset-preview";
import type { BentoPicture } from "@/lib/home-bento";
import { REEL_FADE_MS, fadeDue, nextInReel, reelProgress, reelSources, type ReelClip } from "@/lib/home-reel";
import { coverWidth, pickWidth, type Sized } from "@/lib/media-pick";
import { releaseVideo } from "@/lib/media-release";
import { browserPlaybackEnv } from "@/lib/preview-playback";
import { s } from "./home-bento-classes";

/*
 * The first screen's few islands (home-bento.tsx): the switch that lets it move, the video tile's reel, the 3D tile's
 * clip, the typing on the live tile and the numbers tile's launcher. Everything else on it is HTML from the server.
 */

/** Whether the page has loaded (the first screen's animations wait for it) and whether it may move now (BentoMotion). */
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

/** The clips' shape (width / height): both tiles play 4:3 renders (scripts/gen-home-bento.mjs). */
const CLIP_ASPECT = 4 / 3;

/** The width of the copy the tile's still shows (its file is named `<name>-<width>.avif` or `.jpg`), or 0. */
function stillWidth(el: HTMLElement): number {
  const src = el.parentElement?.querySelector<HTMLImageElement>("picture img")?.currentSrc ?? "";
  const m = /-(\d+)\.(?:avif|jpg)(?:\?|$)/.exec(src);
  return m ? Number(m[1]) : 0;
}

/**
 * Calls `cb` once the tile's own still (the picture before `el` in its tile) has loaded and been painted, and the
 * browser has a moment: the still is the first thing the tile shows, and the clip never holds it up.
 */
function afterStill(el: HTMLElement, cb: () => void): () => void {
  const img = el.parentElement?.querySelector<HTMLImageElement>("picture img");
  let raf = 0;
  let idle = 0;
  const go = () => {
    raf = requestAnimationFrame(() => {
      if (typeof requestIdleCallback === "function") idle = requestIdleCallback(cb, { timeout: 600 });
      else idle = window.setTimeout(cb, 100);
    });
  };
  if (!img || (img.complete && img.naturalWidth > 0)) go();
  else {
    img.addEventListener("load", go, { once: true });
    img.addEventListener("error", go, { once: true });
  }
  return () => {
    img?.removeEventListener("load", go);
    img?.removeEventListener("error", go);
    cancelAnimationFrame(raf);
    if (typeof cancelIdleCallback === "function") cancelIdleCallback(idle);
    clearTimeout(idle);
  };
}

/**
 * A tile's clip, over its still: it joins the site's playback rules (preset-preview.tsx) as soon as the tile's still is
 * on screen (not only once the whole page has loaded), so it plays in view, at most a few at once, never under reduced
 * motion, Save-Data or Pause previews, and a hover or keyboard focus on its tile still plays it. Its source is set only
 * when it first plays: the narrowest of `clips` at least as wide as the tile shows it on this screen (its box under
 * `object-fit: cover`, times the pixel ratio) and at least as wide as the copy of the still the browser chose, and that
 * one stays. The still is that clip's own first frame
 * (scripts/gen-home-bento.mjs), and the clip shows only once it has that frame, so the change from one to the other
 * can't be seen: no sign, no flash, nothing moves. Once started it stays mounted and pauses on its frame. `progress`: a
 * line along the bottom follows the clip.
 */
export function BentoClip({ id, clips, progress }: { id: string; clips: Sized[]; progress?: boolean }) {
  const [armed, setArmed] = useState(false);
  // The width of the still the browser chose (its srcset), once it is up: the clip is at least that copy, so the still
  // and the clip's first frame are the same picture.
  const [stillW, setStillW] = useState(0);
  const { ref, playing, handlers } = usePreviewPlayback<HTMLSpanElement>(id, armed ? { video: clips[0].src } : {});
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return afterStill(el, () => {
      setStillW(stillWidth(el));
      setArmed(true);
    });
  }, [ref]);
  // The pixels of width the tile needs, kept up to date with its size until the clip starts.
  const [need, setNeed] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setNeed(coverWidth(e.contentRect.width, e.contentRect.height, CLIP_ASPECT, window.devicePixelRatio || 1)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  const [clip, setClip] = useState<string | null>(null);
  if (playing && !clip) setClip(pickWidth(clips, Math.max(need, stillW)).src);
  const started = clip !== null;
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
      {clip && <video ref={video} src={clip} muted loop playsInline preload="auto" data-ready={ready || undefined} onLoadedData={() => setReady(true)} />}
      {progress && (
        <span className={s.progress}>
          <i ref={bar} />
        </span>
      )}
    </span>
  );
}

/** Whether the viewer asked for less motion or less data: the reel then plays its first clip alone, and only when asked. */
const holdsStill = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches || browserPlaybackEnv.saveData();

/**
 * One clip of the reel, in its own element (keyed by `k`, its place in the order the reel has played): it lets go of
 * its source when it leaves, so a clip that has played stops costing memory. `shown`: on screen; `incoming`: it fades
 * in over the clip ending, at the reel's pace.
 */
function ReelVideo({
  k,
  clip,
  src,
  loop,
  shown,
  incoming,
  register,
  onLoaded,
  onPlaying,
  onEnded,
}: {
  k: number;
  clip: ReelClip;
  src: string;
  loop: boolean;
  shown: boolean;
  incoming: boolean;
  register: (k: number, v: HTMLVideoElement | null) => void;
  onLoaded: (k: number) => void;
  onPlaying: (k: number) => void;
  onEnded: (k: number) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    register(k, v);
    return () => {
      register(k, null);
      releaseVideo(v);
    };
  }, [k, register]);
  return (
    <video
      ref={ref}
      src={src}
      muted
      loop={loop}
      playsInline
      preload="auto"
      style={{ objectPosition: clip.position }}
      data-clip={clip.id}
      data-max={Math.max(...clip.clips.map((c) => c.w))}
      data-ready={shown || undefined}
      data-in={incoming || undefined}
      onLoadedData={() => onLoaded(k)}
      onPlaying={() => onPlaying(k)}
      onEnded={() => onEnded(k)}
    />
  );
}

/** The latest of two places in the reel's order (each "this one has loaded / played / ended" only moves forward). */
const later = (k: number) => (prev: number) => Math.max(prev, k);

/**
 * The video tile's reel (src/lib/home-reel.ts): its clips one after another, each played once, each crossfading into
 * the next for REEL_FADE_MS as it ends, and after the last the first again. It plays by the same rules as a tile's clip
 * (BentoClip): it joins the site's playback rules once its still is painted, plays only on screen and in a visible tab,
 * pauses where it is, and each clip is the narrowest copy at least as wide as the tile needs on this screen (and as the
 * copy of the still the browser chose). The still is the first clip's first frame, and that clip shows only once it has
 * that frame: no sign, no flash, nothing moves. Only the clip playing and the one after it are loaded, the next one
 * only once the current one plays. Under reduced motion or Save-Data nothing plays by itself; a hover or keyboard focus
 * plays the first clip alone, on a loop. `progress`: a line along the bottom follows the whole reel.
 */
export function BentoReel({ id, reel, progress }: { id: string; reel: ReelClip[]; progress?: boolean }) {
  const [armed, setArmed] = useState(false);
  const [stillW, setStillW] = useState(0);
  const { ref, playing, handlers } = usePreviewPlayback<HTMLSpanElement>(id, armed ? { video: reel[0].clips[0].src } : {});
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return afterStill(el, () => {
      setStillW(stillWidth(el));
      setArmed(true);
    });
  }, [ref]);
  const [need, setNeed] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setNeed(coverWidth(e.contentRect.width, e.contentRect.height, CLIP_ASPECT, window.devicePixelRatio || 1)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  // Chosen when it first plays, and kept: each clip's copy, and whether the reel turns or its first clip loops alone.
  const [plan, setPlan] = useState<{ srcs: string[]; turns: boolean } | null>(null);
  if (playing && !plan) setPlan({ srcs: reelSources(reel, Math.max(need, stillW)), turns: reel.length > 1 && !holdsStill() });
  const turns = !!plan?.turns;

  // `seq`: how many clips have played before the one on screen (it is clip seq % n). Each element is keyed by its seq,
  // so a clip that comes round again is a new element.
  const n = reel.length;
  const [seq, setSeq] = useState(0);
  const [loaded, setLoaded] = useState(-1);
  const [started, setStarted] = useState(-1);
  const [due, setDue] = useState(-1);
  // The next clip loads once this one plays; it fades in once this one is near its end (or has ended) and it has its
  // first frame.
  const nextOn = turns && started >= seq;
  const fading = nextOn && due >= seq && loaded > seq;
  const els = useRef(new Map<number, HTMLVideoElement>());
  const [register] = useState(() => (k: number, v: HTMLVideoElement | null) => void (v ? els.current.set(k, v) : els.current.delete(k)));
  const bar = useRef<HTMLElement>(null);
  const on = useRef(handlers);
  useEffect(() => {
    on.current = handlers;
  });

  // The tile is the link: its keyboard focus plays the reel as a card's does.
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

  // Play or pause the clip on screen, and the one fading in over it; the next one waits on its first frame.
  useEffect(() => {
    const cur = els.current.get(seq);
    const next = els.current.get(seq + 1);
    if (cur) {
      if (playing) void cur.play().catch(() => {});
      else cur.pause();
    }
    if (next) {
      if (playing && fading) void next.play().catch(() => {});
      else next.pause();
    }
  }, [playing, seq, fading, plan, nextOn]);

  // Once the next clip has faded in, it takes this one's place (and this one's element goes).
  useEffect(() => {
    if (!fading) return;
    const t = window.setTimeout(() => setSeq((x) => Math.max(x, seq + 1)), REEL_FADE_MS);
    return () => clearTimeout(t);
  }, [fading, seq]);

  // A frame at a time while it plays: the line follows the reel, and the fade is due REEL_FADE_MS before a clip's end.
  useEffect(() => {
    const v = els.current.get(seq);
    const b = bar.current;
    if (!v || !playing || loaded < seq) return;
    let raf = 0;
    let marked = false;
    const tick = () => {
      if (b) b.style.transform = `scaleX(${turns ? reelProgress(seq % n, n, v.currentTime, v.duration) : v.duration > 0 ? v.currentTime / v.duration : 0})`;
      if (turns && !marked && fadeDue(v.currentTime, v.duration)) {
        marked = true;
        setDue(later(seq));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loaded, seq, turns, n]);

  const playingNow = plan ? [{ k: seq, i: seq % n }, ...(nextOn ? [{ k: seq + 1, i: nextInReel(seq % n, n) }] : [])] : [];
  return (
    <span ref={ref} aria-hidden className={s.clip} data-reel={plan ? seq % n : undefined} onPointerEnter={handlers.onPointerEnter} onPointerLeave={handlers.onPointerLeave}>
      {plan &&
        playingNow.map(({ k, i }) => (
          <ReelVideo
            key={k}
            k={k}
            clip={reel[i]}
            src={plan.srcs[i]}
            loop={!turns}
            shown={loaded >= k && (k === seq || fading)}
            incoming={k > seq}
            register={register}
            onLoaded={(x) => setLoaded(later(x))}
            onPlaying={(x) => setStarted(later(x))}
            onEnded={(x) => setDue(later(x))}
          />
        ))}
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
