"use client";

import { useEffect, useRef, useState } from "react";
import {
  FX_REST,
  followsPointer,
  fxLoupeSources,
  fxSources,
  fxStripSrc,
  fxWideSources,
  hoverFiles,
  keyPos,
  LENS,
  LENS_DETAIL,
  lensHome,
  loupePan,
  nextShow,
  posAt,
  reframeVars,
  restFor,
  showPos,
  stripFrames,
  stripShift,
  tapToggles,
  type FxShow,
  type FxView,
} from "@/lib/fx-compare";
import { reducedMotion } from "@/lib/ui-motion";
import { cn } from "@/lib/utils";

/*
 * A Fuobe FX item's before and after, as its card's picture (the /fx page, the Fuobe FX menu). Stills only, at rest a
 * still split with a hairline and tiny "Before" and "After" tags (fx-compare.css draws every state):
 *   pair, depth  a mouse moves the divider; the after (a depth pass for depth) is cut there
 *   matte        the same, the cut-out on a transparency checkerboard
 *   loupe        at rest the divider sits near the left (the sharp after fills the card); a lens under the mouse:
 *                the soft before detail on its left, the sharp after on its right
 *   reframe      the wide still with the tall crop's box outlined; the outside dims under the mouse
 *   strip        frame 1; under the mouse, the output's frames as a flipbook
 * A finger's tap shows the after, the next the before (the card's name still opens the page). With reduced motion the
 * divider stays put and nothing plays: a tap still toggles. `keys`: the arrow keys on the focused card (its link) move
 * the divider, step the flipbook or show the crop (off in the menu, whose arrow keys move between links).
 *
 * The pointer only sets CSS variables, once a frame: a hover never lays anything out. The lens's details and the
 * flipbook's frames are asked for only once the card is pointed at, tapped or keyed.
 */

interface Props {
  view: FxView;
  /** The box's width for the srcsets (the 480 or the 960 copy). */
  sizes: string;
  /** Load at rest at once (a menu about to open) instead of when it comes near the screen. */
  eager?: boolean;
  keys?: boolean;
  className?: string;
}

/** One side at its two sizes, AVIF first, else WebP. */
function Side({ view, side, sizes, eager }: { view: FxView; side: "before" | "after"; sizes: string; eager?: boolean }) {
  const s = fxSources(view, side);
  return (
    <picture>
      <source type="image/avif" srcSet={s.avif} sizes={sizes} />
      <img src={s.src} srcSet={s.webp} sizes={sizes} width={480} height={360} alt="" loading={eager ? "eager" : "lazy"} decoding="async" draggable={false} />
    </picture>
  );
}

function Tags() {
  return (
    <>
      <span className="fxc-tag" data-side="before">
        Before
      </span>
      <span className="fxc-tag" data-side="after">
        After
      </span>
    </>
  );
}

export function FxCompare({ view, sizes, eager, keys, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [show, setShow] = useState<FxShow>("rest");
  /** Its hover files are asked for (the lens's details, the flipbook's frames). */
  const [armed, setArmed] = useState(false);
  const [ready, setReady] = useState(false);
  const loaded = useRef(0);
  const rest = restFor(view);
  const pos = useRef(rest);
  const at = useRef<{ x: number; y: number } | null>(null);
  const raf = useRef(0);
  const pointer = useRef("mouse");
  const stripAt = useRef(0);
  const showRef = useRef(show);
  const kind = view.kind;
  const divides = kind === "pair" || kind === "depth" || kind === "matte" || kind === "loupe";
  const extra = hoverFiles(view).length;
  const frames = stripFrames(view);

  const setPos = (n: number) => {
    pos.current = n;
    ref.current?.style.setProperty("--fxc-pos", `${n}%`);
  };
  const arm = () => {
    if (extra) setArmed(true);
  };
  /** A hover file came (or failed): counted once it is decoded too, so the lens or flipbook never shows an empty frame. */
  const oneLoaded = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const done = () => {
      loaded.current += 1;
      if (loaded.current >= extra) setReady(true);
    };
    if (e.type === "load") void e.currentTarget.decode().then(done, done);
    else done();
  };

  // A tap's side: the divider goes all the way (or back to rest); the lens sits over the loupe's own place.
  useEffect(() => {
    showRef.current = show;
    const el = ref.current;
    if (!el) return;
    if (divides) setPos(showPos(show, rest));
    if (kind === "loupe" && show === "after") {
      const [x, y] = lensHome(view.loupe, el.clientWidth, el.clientHeight);
      const [dx, dy] = loupePan(0.5, 0.5, LENS_DETAIL, LENS);
      el.style.setProperty("--fxc-x", `${x}px`);
      el.style.setProperty("--fxc-y", `${y}px`);
      el.style.setProperty("--fxc-dx", `${dx}px`);
      el.style.setProperty("--fxc-dy", `${dy}px`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new side moves it
  }, [show]);

  // The arrow keys on the focused card (its link), where its list doesn't use them itself.
  useEffect(() => {
    const el = ref.current;
    const card = keys ? el?.closest("a") : null;
    if (!el || !card) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      e.preventDefault();
      if (extra) setArmed(true);
      if (kind === "strip") {
        stripAt.current = Math.min(frames - 1, Math.max(0, stripAt.current + (e.key === "ArrowRight" ? 1 : -1)));
        el.style.setProperty("--fxc-shift", `${stripShift(stripAt.current, frames)}%`);
      } else if (kind === "reframe") setShow(e.key === "ArrowRight" ? "after" : "rest");
      else {
        const next = keyPos(pos.current, e.key, e.shiftKey);
        if (next !== null) setPos(next);
      }
    };
    card.addEventListener("keydown", onKey);
    return () => card.removeEventListener("keydown", onKey);
  }, [keys, kind, extra, frames]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  /** The pointer's latest place, applied once a frame: the divider, or the lens and its detail. */
  const apply = () => {
    raf.current = 0;
    const el = ref.current;
    const p = at.current;
    if (!el || !p) return;
    const r = el.getBoundingClientRect();
    if (kind === "loupe") {
      const x = p.x - r.left;
      const y = p.y - r.top;
      const [dx, dy] = loupePan(x / r.width, y / r.height, LENS_DETAIL, LENS);
      el.style.setProperty("--fxc-x", `${x}px`);
      el.style.setProperty("--fxc-y", `${y}px`);
      el.style.setProperty("--fxc-dx", `${dx}px`);
      el.style.setProperty("--fxc-dy", `${dy}px`);
    } else if (divides) setPos(posAt(p.x, r.left, r.width));
  };

  const onPointerEnter = (e: React.PointerEvent) => {
    pointer.current = e.pointerType;
    if (!followsPointer(e.pointerType, reducedMotion())) return;
    const el = ref.current!;
    arm();
    if (showRef.current !== "rest") setShow("rest");
    el.dataset.hover = "";
    if (kind !== "loupe" && divides) el.dataset.fxcFollow = "";
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!followsPointer(e.pointerType, reducedMotion()) || !divides) return;
    const el = ref.current!;
    if (el.dataset.hover === undefined) onPointerEnter(e);
    at.current = { x: e.clientX, y: e.clientY };
    if (!raf.current) raf.current = requestAnimationFrame(apply);
  };
  const onPointerLeave = () => {
    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    delete el.dataset.hover;
    delete el.dataset.fxcFollow;
    if (divides) setPos(showPos(showRef.current, rest));
  };

  return (
    <span
      ref={ref}
      aria-hidden
      data-fxc={kind}
      data-fx-id={view.id}
      data-show={show}
      data-armed={armed ? "" : undefined}
      data-ready={ready ? "" : undefined}
      className={cn("fxc", className)}
      style={
        kind === "reframe"
          ? (reframeVars(view.rect) as React.CSSProperties)
          : kind === "strip"
            ? ({ "--fxc-frames": frames, "--fxc-last": `${stripShift(frames - 1, frames)}%` } as React.CSSProperties)
            : rest !== FX_REST
              ? ({ "--fxc-pos": `${rest}%` } as React.CSSProperties)
              : undefined
      }
      onPointerEnter={onPointerEnter}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onPointerDown={(e) => {
        pointer.current = e.pointerType;
      }}
      onClick={(e) => {
        // A finger's tap shows the other side; the card's name opens its page. A mouse's click opens it as ever.
        if (!tapToggles(pointer.current)) return;
        e.preventDefault();
        arm();
        setShow((s) => nextShow(s));
      }}
    >
      {kind === "reframe" ? (
        <span className="fxc-wide">
          {/* eslint-disable-next-line @next/next/no-img-element -- versioned static still */}
          <img
            src={fxWideSources(view).src}
            srcSet={fxWideSources(view).webp}
            sizes={sizes}
            width={480}
            height={270}
            alt=""
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            draggable={false}
          />
          <span className="fxc-shade" />
          <span className="fxc-rect">
            <span className="fxc-tag">9:16</span>
          </span>
        </span>
      ) : kind === "strip" ? (
        <>
          <Side view={view} side="before" sizes={sizes} eager={eager} />
          {armed && (
            <span className="fxc-strip">
              {/* eslint-disable-next-line @next/next/no-img-element -- the flipbook's frames, asked for on hover only */}
              <img src={fxStripSrc(view)} width={480 * frames} height={360} alt="" decoding="async" draggable={false} onLoad={oneLoaded} onError={oneLoaded} />
            </span>
          )}
          <span className="fxc-ticks">
            {Array.from({ length: frames }, (_, i) => (
              <i key={i} />
            ))}
          </span>
        </>
      ) : (
        <>
          <Side view={view} side="before" sizes={sizes} eager={eager} />
          <span className="fxc-after">
            <Side view={view} side="after" sizes={sizes} eager={eager} />
          </span>
          <span className="fxc-line" />
          <Tags />
          {kind === "loupe" && armed && (
            <span className="fxc-lens">
              {(["before", "after"] as const).map((side) => {
                const s = fxLoupeSources(view, side);
                return (
                  <span key={side} className="fxc-lens-detail" data-side={side}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- the lens's detail, asked for on hover only */}
                    <img src={s.src} srcSet={s.srcSet} sizes={`${LENS_DETAIL}px`} width={240} height={240} alt="" decoding="async" draggable={false} onLoad={oneLoaded} onError={oneLoaded} />
                  </span>
                );
              })}
            </span>
          )}
        </>
      )}
    </span>
  );
}
