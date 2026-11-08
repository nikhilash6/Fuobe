"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  CAMERA_MOVES,
  isCover,
  LAYER_DEPTH,
  LAYER_OFFSET,
  moveVars,
  PREVIEW_LAYERS,
  sceneLayer,
  scenePoster,
  thumbOf,
  type MoveSpec,
  type PresetPreview as Preview,
  type PreviewLayer,
  type PreviewScene,
} from "@/lib/preset-cards";
import { coverFraming } from "@/lib/cover-framing";
import { coverWidth, pickWidth } from "@/lib/media-pick";
import { releaseVideo } from "@/lib/media-release";
import { glyphFor } from "@/lib/move-glyphs";
import { presetClipCopies, presetStillSources } from "@/lib/preset-hd";
import { autoplays, browserPlaybackEnv, createPlaybackStore, playsWhenAsked, previewKind, untilPlace, type AutoPlay } from "@/lib/preview-playback";
import { cn } from "@/lib/utils";

/** Which previews play, shared by every card and the preset header (rules in lib/preview-playback.ts). */
const store = createPlaybackStore(browserPlaybackEnv);

/**
 * "Pause previews" (Home's first screen, the bar's menus): one setting for every page, remembered on this device, so a
 * viewer who paused because their computer struggles finds previews still paused on the next visit. Blocked storage
 * keeps it for the visit only.
 */
const PAUSE_KEY = "fuobe:previews";
try {
  if (typeof window !== "undefined" && localStorage.getItem(PAUSE_KEY) === "paused") store.setPaused(true);
} catch {}

/** Whether the viewer paused previews (false until hydrated, as on the server). */
export const usePreviewsPaused = () => useSyncExternalStore(store.subscribe, store.isPaused, () => false);

export function setPreviewsPaused(paused: boolean) {
  store.setPaused(paused);
  try {
    if (paused) localStorage.setItem(PAUSE_KEY, "paused");
    else localStorage.removeItem(PAUSE_KEY);
  } catch {}
}

/**
 * Wire a card element to the playback store. Returns whether its preview should play (and whether the
 * viewer asked for it: a hover, focus or tap), the handlers to spread on the card (hover and keyboard
 * focus, after a short rest) and `onTap`, which plays or stops it from a touch (for an element a tap
 * doesn't otherwise use). A clip plays by itself while the card is in view (with `auto: "touch"`, only
 * where nothing can hover); with `always`, any preview that moves does (the preset header).
 */
export function usePreviewPlayback<T extends HTMLElement>(
  id: string,
  preview: Pick<Preview, "video" | "move" | "fx">,
  { always = false, auto = "always" }: { always?: boolean; auto?: AutoPlay } = {},
) {
  const ref = useRef<T | null>(null);
  // 0: at rest, 1: playing by itself, 2: playing because the viewer asked.
  const state = useSyncExternalStore(
    store.subscribe,
    () => (store.isPlaying(id) ? (store.isAsked(id) ? 2 : 1) : 0),
    () => 0,
  );
  const playing = state > 0;
  const kind = previewKind(preview);
  useEffect(() => {
    const el = ref.current;
    if (!el || !(always ? kind !== "still" : autoplays(kind, store.canHover(), auto))) return;
    return store.watch(el, id);
  }, [id, kind, always, auto]);
  useEffect(() => () => store.stop(id), [id]);
  const on = () => playsWhenAsked(kind, store.reducedMotion()) && store.play(id);
  const off = () => store.stop(id);
  return {
    ref,
    playing,
    asked: state === 2,
    handlers: {
      onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && on(),
      onPointerLeave: (e: React.PointerEvent) => e.pointerType === "mouse" && off(),
      // Keyboard focus only: a tap (or click) focuses the card too, and would start (and download) its clip.
      onFocus: (e: React.FocusEvent) => e.currentTarget.matches(":focus-visible") && on(),
      onBlur: off,
    },
    onTap: (e: React.PointerEvent) => e.pointerType !== "mouse" && playsWhenAsked(kind, store.reducedMotion()) && store.toggle(id),
  };
}

const layerVars = (l: PreviewLayer) => ({ "--d": LAYER_DEPTH[l], "--o": LAYER_OFFSET[l] }) as React.CSSProperties;

/** The other still a transition wipes to. */
const NEXT_SCENE: Record<PreviewScene, PreviewScene> = { landscape: "city", city: "landscape", portrait: "landscape", product: "portrait" };

function Sparks({ n = 6 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className="pv-spark" style={{ "--i": i } as React.CSSProperties} />
      ))}
    </>
  );
}

function Dup({ src, className }: { src: string; className: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" draggable={false} decoding="async" className={`pv-img ${className}`} />;
}

/** Per-treatment overlay markup; the look and motion live in globals.css (`.pv-*`). */
function Fx({ fx, scene }: { fx: NonNullable<Preview["fx"]>; scene: PreviewScene }) {
  const poster = scenePoster(scene);
  switch (fx) {
    case "fire":
      return (
        <>
          <i className="pv-fire" />
          <i className="pv-fire pv-fire-2" />
          <Sparks n={5} />
        </>
      );
    case "water":
      return (
        <>
          <i className="pv-wave" />
          <i className="pv-wave pv-wave-2" />
        </>
      );
    case "ice":
      return (
        <>
          <i className="pv-frost" />
          <Sparks n={4} />
        </>
      );
    case "wind":
      return <i className="pv-streaks" />;
    case "lightning":
      return (
        <>
          <svg className="pv-bolt" viewBox="0 0 40 100" aria-hidden>
            <path d="M24 0 L8 52 H20 L12 100 L34 40 H22 L30 0Z" />
          </svg>
          <i className="pv-flash" />
        </>
      );
    case "explode":
      return (
        <>
          <i className="pv-burst" />
          <i className="pv-flash" />
          <Sparks n={6} />
        </>
      );
    case "glow":
      return (
        <>
          <i className="pv-halo" />
          <Sparks n={6} />
        </>
      );
    case "sparkle":
      return <Sparks n={9} />;
    case "petals":
      return (
        <>
          {Array.from({ length: 8 }, (_, i) => (
            <i key={i} className="pv-petal" style={{ "--i": i } as React.CSSProperties} />
          ))}
        </>
      );
    case "relight":
      return (
        <>
          <i className="pv-shade" />
          <i className="pv-light" />
        </>
      );
    case "dark":
      return (
        <>
          <i className="pv-vignette" />
          <i className="pv-blood" />
        </>
      );
    case "flare":
      return (
        <>
          <i className="pv-flare" />
          <i className="pv-flash pv-flash-soft" />
        </>
      );
    case "morph":
    case "swap":
      return (
        <>
          <Dup src={sceneLayer(scene, "subject")} className={`pv-wipe-v ${fx === "morph" ? "pv-morph" : "pv-recolor"}`} />
          <i className="pv-seam pv-seam-h" />
        </>
      );
    case "grade":
      return (
        <>
          <Dup src={poster} className="pv-wipe-h pv-graded" />
          <i className="pv-seam pv-seam-v" />
        </>
      );
    case "halftone":
      return (
        <>
          <span className="pv-wipe-h pv-halftone">
            <Dup src={poster} className="pv-inked" />
          </span>
          <i className="pv-seam pv-seam-v" />
        </>
      );
    case "sharpen":
      return (
        <>
          <Dup src={poster} className="pv-wipe-h pv-soft" />
          <i className="pv-seam pv-seam-v pv-knob" />
        </>
      );
    case "wipe":
      return (
        <>
          <Dup src={scenePoster(NEXT_SCENE[scene])} className="pv-wipe-h" />
          <i className="pv-seam pv-seam-v" />
        </>
      );
    case "glitch":
      return (
        <>
          <Dup src={poster} className="pv-rgb" />
          <Dup src={poster} className="pv-slice" />
          <Dup src={poster} className="pv-slice pv-slice-2" />
        </>
      );
    case "tiny":
      return <i className="pv-ring" />;
    case "scan":
      return (
        <>
          <i className="pv-grid" />
          <i className="pv-scanline" />
          <i className="pv-brackets" />
        </>
      );
    case "shine":
      return <i className="pv-shine" />;
    case "frame":
      return (
        <>
          <i className="pv-brackets pv-brackets-wide" />
          <i className="pv-rec" />
        </>
      );
    case "play":
      return (
        <>
          <i className="pv-progress" />
          <i className="pv-play" />
        </>
      );
    case "crack":
      return (
        <>
          <svg className="pv-crack" viewBox="0 0 100 75" preserveAspectRatio="none" aria-hidden>
            <path d="M62 30 L69 22 L77 23 L86 10 L93 7 M62 30 L73 35 L86 33 L100 41 M62 30 L64 43 L58 54 L61 75 M62 30 L51 31 L41 25 L23 27 L0 19 M62 30 L53 41 L45 48 L31 62 L24 75 M62 30 L60 17 L54 7 L56 0 M77 23 L80 31 M51 31 L49 40 M58 54 L50 58" />
            <circle cx="62" cy="30" r="2.2" />
          </svg>
          <i className="pv-flash" />
        </>
      );
    case "pop":
    default:
      return <Sparks n={6} />;
  }
}

/** The cover clips' shape (width / height): every one is 4:3. */
const CLIP_ASPECT = 4 / 3;

/** When the clips' shared cycle began (performance.now()), set by the first clip ready to play by itself (Clip). */
let cycleStart: number | undefined;

/** The end of an effect clip that a loop ending early (rest.until) never reaches (s): where it fades back to its photo. */
export const CLIP_TAIL = 0.4;

/**
 * A real cover's clip, mounted only while it plays (a browser allows a page only so many live
 * players, a phone fewer), over the poster until its first frame is ready. The poster is that
 * frame, so starting and stopping never flashes.
 *
 * A card resting on the clip's peak frame (`rest`) starts from that frame when it plays by itself,
 * and shows once the seek there is done, with a short fade. Its loop comes back to just before the
 * change starts (`rest.from`), not to the clip's still opening, and a hover or tap (`asked`) starts
 * there, so the change builds up at once.
 *
 * `place` (staggered) holds a clip that plays by itself on its first frame, once it's ready, until
 * the shared clock reaches that place in its cycle (untilPlace): the clips of a row start apart
 * however long each one takes to load, so they never loop in step. The clock starts with the first
 * clip ready, which plays at once. A hover or tap never waits.
 */
function Clip({ src, rest, asked, place, focus }: { src: string; rest?: Preview["rest"]; asked: boolean; place?: number; focus?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  // Where it starts, fixed when it mounts: asked for, where the change starts; by itself, the frame the card rests on.
  const [start] = useState(() => (rest ? (asked ? rest.from : rest.at) : 0));
  const [due, setDue] = useState(place === undefined || asked);
  if (!due && asked) setDue(true);
  // A layout effect: a page kept hidden after navigating away (Activity) keeps its elements, and a
  // video only stops when told to. The source is set here too, so a page shown again plays again.
  // It plays at once, which is what makes a phone load it; a clip with a place to wait for holds below.
  useLayoutEffect(() => {
    const v = ref.current;
    if (!v) return;
    // The narrowest copy at least as wide as the box shows it on this screen (preset-hd.ts; most clips have one).
    v.src = pickWidth(presetClipCopies(src), coverWidth(v.clientWidth, v.clientHeight, CLIP_ASPECT, window.devicePixelRatio || 1)).src;
    void v.play().catch(() => {});
    return () => {
      releaseVideo(v);
      setReady(false);
    };
  }, [src]);
  useEffect(() => {
    const v = ref.current;
    if (!v || !ready) return;
    if (due) {
      if (v.paused) void v.play().catch(() => {});
      return;
    }
    v.pause();
    const now = performance.now();
    cycleStart ??= now - place!;
    const t = setTimeout(() => setDue(true), untilPlace(place!, now - cycleStart));
    return () => clearTimeout(t);
  }, [ready, due, place]);
  // A loop that ends before the clip does (rest.until): back to rest.from from there, checked on every frame shown where
  // the browser says when one is (requestVideoFrameCallback), else on each time update. The clip's last stretch
  // (CLIP_TAIL), where an effect fades back to its photo, is never shown.
  const until = rest?.until;
  const from = rest?.from ?? 0;
  useEffect(() => {
    const v = ref.current;
    if (!v || until === undefined) return;
    const end = () => Math.min(until, Number.isFinite(v.duration) && v.duration > 0 ? v.duration - CLIP_TAIL : until);
    const check = () => {
      if (v.currentTime >= end()) v.currentTime = from;
    };
    if (typeof v.requestVideoFrameCallback === "function") {
      let id = 0;
      const tick = () => {
        check();
        id = v.requestVideoFrameCallback(tick);
      };
      id = v.requestVideoFrameCallback(tick);
      return () => v.cancelVideoFrameCallback(id);
    }
    v.addEventListener("timeupdate", check);
    return () => v.removeEventListener("timeupdate", check);
  }, [until, from]);
  const seeks = start > 0;
  return (
    <video
      ref={ref}
      muted
      loop={!rest}
      playsInline
      preload="auto"
      onLoadedMetadata={seeks ? (e) => void (e.currentTarget.currentTime = start) : undefined}
      onLoadedData={seeks ? undefined : () => setReady(true)}
      onSeeked={seeks ? () => setReady(true) : undefined}
      onEnded={
        rest
          ? (e) => {
              e.currentTarget.currentTime = rest.from;
              void e.currentTarget.play().catch(() => {});
            }
          : undefined
      }
      className={cn("absolute inset-0 size-full object-cover", rest && "transition-opacity duration-150", !ready && "opacity-0")}
      style={focus ? { objectPosition: focus } : undefined}
      aria-hidden
    />
  );
}

/**
 * A preset's preview: its real cover when it has one (a clip that plays, or a still), otherwise the
 * procedural version, a camera move over a layered sample still (motions) or an animated treatment (effects, apps).
 * At rest it shows the poster frame (and the treatment's still frame); `playing` runs it. A clip is
 * only fetched while it plays; the depth layers a camera move needs are only mounted once the card first plays.
 */
export const PresetPreview = memo(function PresetPreview({
  preview,
  hue,
  playing,
  asked = false,
  place,
  flip,
  loading = "lazy",
  fetchPriority,
  sizes,
}: {
  preview: Preview;
  hue: number;
  playing: boolean;
  /** It plays because the viewer asked (usePreviewPlayback's `asked`): a clip resting on its peak starts where the change starts. */
  asked?: boolean;
  /** Where (ms into the shared cycle, staggered) a clip that plays by itself starts, holding its first frame till then (Clip). */
  place?: number;
  /** Mirror the still (see previewFlip). */
  flip?: boolean;
  /** A real cover's still: "eager" above the fold (Home's wall), lazy everywhere else. */
  loading?: "eager" | "lazy";
  /** "high" for the page's largest picture (Next's image guide: instead of preloading it). */
  fetchPriority?: "high";
  /** How wide a real cover's still shows (the img's `sizes`): with it, a small screen gets the 320 px copy (thumbOf). */
  sizes?: string;
}) {
  const [armed, setArmed] = useState(false);
  if (playing && !armed) setArmed(true);

  // A real cover: the card's image as rendered, without the procedural preview's tint, bleed or
  // mirroring (and no move glyph: the picture shows the preset itself), with its clip over it while it plays.
  if (preview.video || isCover(preview)) {
    const still = preview.rest?.src ?? preview.poster;
    // How the cover sits in a frame of another shape (cover-framing.ts): a focus point, or the whole picture.
    const framing = coverFraming(still);
    const focus = framing?.focus;
    // Larger copies (preset-hd.ts), where the cover has them: the box takes one at least as wide as it shows.
    const hd = sizes ? presetStillSources(still, thumbOf(still)) : undefined;
    const img = (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={still}
        srcSet={hd ? hd.jpeg : sizes ? `${thumbOf(still)} 320w, ${still} 512w` : undefined}
        sizes={sizes}
        alt=""
        width={512}
        height={384}
        draggable={false}
        loading={loading}
        fetchPriority={fetchPriority}
        decoding={fetchPriority ? undefined : "async"}
        className="absolute inset-0 size-full object-cover"
        style={focus ? { objectPosition: focus } : undefined}
        aria-hidden
      />
    );
    const cover = (
      <>
        {hd ? (
          <picture>
            <source type="image/avif" srcSet={hd.avif} sizes={sizes} />
            {img}
          </picture>
        ) : (
          img
        )}
        {preview.video && playing && <Clip src={preview.video} rest={preview.rest} asked={asked} place={place} focus={focus} />}
      </>
    );
    if (framing?.fit !== "whole") return cover;
    // The whole 4:3 picture, as large as the frame allows and centred (the frame's size in container units), over
    // the still filling the frame, blurred and dimmed. That backdrop is a background only a frame of another shape
    // draws (.cover-whole in globals.css): in a 4:3 frame the picture covers it, and it is neither fetched nor painted.
    return (
      <span className="cover-whole absolute inset-0 grid place-items-center" aria-hidden>
        <span
          className="cover-whole-backdrop absolute inset-0 scale-125 bg-cover bg-center blur-xl brightness-[0.7] saturate-[1.3]"
          style={{ "--cover-bg": `url(${sizes ? thumbOf(still) : still})` } as CSSProperties}
        />
        <span className="relative aspect-[4/3] w-[min(100cqw,133.334cqh)] overflow-hidden shadow-[0_10px_30px_-6px_rgb(0_0_0/0.6)] ring-1 ring-white/10">
          {cover}
        </span>
      </span>
    );
  }

  const spec: MoveSpec | undefined = preview.move ? CAMERA_MOVES[preview.move] : undefined;
  const glyph = preview.move ? glyphFor(preview.move) : undefined;
  const style = { "--pv-hue": hue, ...(spec ? moveVars(spec) : {}) } as React.CSSProperties;
  return (
    <div
      className="pv"
      style={style}
      data-playing={playing || undefined}
      data-profile={spec?.profile}
      data-stage={spec?.stage}
      data-through={spec?.through || undefined}
      data-fx={preview.fx}
      data-flip={flip || undefined}
      aria-hidden
    >
      <div className="pv-cam">
        <div className="pv-shake">
          {/* The poster stays underneath, so nothing flashes while the layers load. */}
          {/* A camera move's poster rests partway into the move (the subject layer's transform). */}
          {spec ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.poster} alt="" draggable={false} decoding="async" className="pv-img pv-poster pv-layer" style={layerVars("subject")} />
          ) : (
            <Dup src={preview.poster} className="pv-poster" />
          )}
          {spec &&
            armed &&
            PREVIEW_LAYERS.map((l) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={l} src={sceneLayer(preview.scene, l)} alt="" draggable={false} decoding="async" className={`pv-img pv-layer pv-l-${l}`} style={layerVars(l)} />
            ))}
          {/* The preset's hue recolors the still only; the treatment keeps its own colors. */}
          <i className="pv-tint" />
          {preview.fx && (
            <div className="pv-fx">
              <Fx fx={preview.fx} scene={preview.scene} />
            </div>
          )}
        </div>
      </div>
      {glyph && (
        <svg className="pv-glyph" viewBox="0 0 48 36" aria-hidden>
          {glyph.map((part, i) => (
            <path key={i} d={part.d} data-dashed={part.dashed || undefined} />
          ))}
        </svg>
      )}
    </div>
  );
});
